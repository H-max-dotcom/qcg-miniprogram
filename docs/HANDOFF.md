# 全渠供订货商城小程序 · 后端交接文档

> 面向：ERP 后端 / 联调同学
> 版本：2026-11-02（首页改版版）
> 前端仓库：本分支 `miniprogram`（**与 ERP 后端代码完全分离，不在同一份代码树里**）
> ERP 后端仓库：`H-max-dotcom/fmcg-erp`（`main` 分支）／共享仓库 `zrq8870-rgb/fmcg-erp-employee-mobile-collab`

---

## 1. 一句话定位

这是一个**微信原生小程序**（不是 uni-app、不是 Taro），是 FMCG 经销商给下游门店客户用的**订货商城**：客户看商品 → 加购物车 → 报价 → 下单 → 微信支付 → 查订单/预付款账户。

前端**不含任何业务计算与伪造数据**：价格、可用性、库存、活动优惠全部以后端返回为准；小程序只负责展示与交互。

---

## 2. 运行环境与配置

### 2.1 环境映射（唯一来源：`config/runtime.js`）

| 小程序 `envVersion` | 后端 baseURL |
|---|---|
| `develop`（开发版） | `https://mall-acceptance.wzzhenshang.com/__mall060` |
| `trial`（体验版） | `https://mall-acceptance.wzzhenshang.com/__mall060` |
| `release`（正式版） | `https://erp.wzzhenshang.com` |

切换环境只需改 `config/runtime.js`，**页面里没有任何硬编码域名**。

### 2.2 基础信息

| 项 | 值 |
|---|---|
| AppID | `wx9cb4a72f6ae06f6a`（公开客户端标识，**禁止把 AppSecret 写进小程序**） |
| 基础库 | 3.5.8（`project.config.json` 已锁定） |
| `miniprogramRoot` | `.`（仓库根目录即小程序根目录） |
| 默认门店 `storefrontCode` | `zhenshang` |

---

## 3. 请求约定（`utils/request.js` 是唯一出口）

### 3.1 统一 Header

```http
Content-Type: application/json
X-QCG-Customer-Mode: REAL_CUSTOMER
Cookie: <会话 Cookie，登录后有>
Cache-Control: no-cache, no-store, max-age=0   # 仅 GET
Pragma: no-cache                                # 仅 GET
```

### 3.2 门店上下文

**所有** `/api/mall/*` 请求都会自动带上门店参数：

- GET：拼进 query（同时带 `storefrontCode` 和 `mallCode`，值相同，兼容历史字段）
- POST / PATCH / DELETE：放进 JSON body
- GET 额外带 `_mallCanonicalTs=<时间戳>` 防缓存（后端可忽略）

> 例外：`/api/mall/campaign-shares/*` 这类分享态接口用 `includeStorefrontContext: false` 不带门店参数。

### 3.3 成功判定

```js
res.statusCode >= 200 && res.statusCode < 300 && res.data.ok !== false
```

即：**2xx 且响应体 `ok` 不为 `false`** 才算成功。请后端保持 `{ ok: true, data: ... }` 或直接返回业务对象且不出现 `ok: false`。

### 3.4 会话与鉴权（重点）

```
wx.login() → code
  → POST /api/mall/wechat-login
  → 后端 Set-Cookie（会话 Cookie）
  → 小程序把 Cookie 串保存进 Storage
  → 后续所有请求用 header Cookie 带上
```

- **小程序没有 JWT/Authorization 头**，完全走 Cookie 会话；`utils/request.js` 里做了 COOKIE 白名单提取（只收 mall 相关 Cookie）
- 会话失效判定：响应 `401` 或 `403`（**但 `403 + code: "CAPABILITY_DENIED"` 不算失效**，表示能力不足）
- 失效后前端统一提示「登录状态已失效，请重新登录」并走登录流程
- 后端需要保证：`/api/mall/wechat-login` 响应里能拿到会话 Cookie，且后续接口认这个 Cookie

### 3.5 错误码约定（前端已内置文案映射）

| code | 含义 |
|---|---|
| `SESSION_EXPIRED` | 登录态失效 |
| `SESSION_COOKIE_MISSING` | 登录响应没给 Cookie（前端会清会话） |
| `CAPABILITY_DENIED` | 当前角色无此能力（不等同于未登录） |
| `MALL_SHARE_EXPIRED` | 分享内容失效 |

---

## 4. 后端接口清单

全部挂在 `/api/mall` 下（定义见 `utils/request.js`）。

### 4.1 首页 / 商品 / 分类

| 方法 | 路径 | 说明 | 关键返回字段 |
|---|---|---|---|
| GET | `/api/mall/home` | 首页聚合数据 | `mallStorefront`、`homepageV2Enabled`、`homepageModules`、`banners[]`、`weeklyActivities[]`、`productSections[]`、`restockProducts[]`、`recommendProducts[]`、`priceAccess`、`announcement`、`orderGuide`、`customerStatus` |
| GET | `/api/mall/categories` | 商品分类 | `id/name/imageUrl` 等 |
| GET | `/api/mall/products` | 商品列表（分页/筛选） | 商品数组 + 分页字段 |
| GET | `/api/mall/products/{id}` | 商品详情 | 商品 + 价格可见性 |

> **首页数据结构注意**：`banners[]` 里每项前端用 `imageUrl`（或 `posterImageUrl`）取图，用 `jumpType + jumpValue` 决定跳转；`priceAccess.canViewPrice` 控制是否显示价格。

### 4.2 购物车 / 报价 / 下单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/mall/cart/quote` | **购物车报价**（返回每行单价、小计、总额、`quoteToken`） |
| POST | `/api/mall/orders` | 创建订单（body 含报价结果与 `quoteToken`） |
| GET | `/api/mall/orders` | 订单列表（`page/pageSize/keyword/customerStatus/status/dateFrom/dateTo`） |
| GET | `/api/mall/orders/{id}` | 订单详情 |
| POST | `/api/mall/orders/{id}/cancel` | 取消订单 |
| POST | `/api/mall/orders/{id}/wechat-receipt` | 微信支付回执 |
| POST | `/api/mall/orders/wechat-payment` | 微信支付单查询/确认 |

> **报价是核心契约**：前端把购物车行（`productId / productUnitId / quantity / quoteToken`）发给后端，后端返回**唯一权威价格**。前端不自己算钱。行上 `quoteToken` 必须原样回传，用于价格锁定与幂等。

### 4.3 账户 / 支付 / 财务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mall/me` | 当前客户身份、绑定状态、会员信息 |
| GET | `/api/mall/account` | 预付款账户（余额/账面/占用等） |
| GET | `/api/mall/finance` | 财务概览 |
| POST | `/api/mall/payments/wechat/intents` | 创建微信支付意图 |
| GET | `/api/mall/payments/customer` | 客户支付记录 |
| GET | `/api/mall/payments/history` / `/batch-history` | 支付历史 / 批量支付历史 |
| GET | `/api/mall/payments/waiting` | 待支付单据 |
| GET | `/api/mall/membership` | 会员等级与权益 |
| GET | `/api/mall/fulfillment` | 履约/配送信息 |

### 4.4 活动 / 优惠券 / 分享

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mall/campaigns` | 活动列表 |
| GET | `/api/mall/campaigns/{code}` | 活动详情 |
| GET | `/api/mall/coupons` | 优惠券列表（可领 + 已领） |
| POST | `/api/mall/coupons` | 领券（`templateId` + `idempotencyKey`）／用券（`customerCouponId` + `idempotencyKey`） |
| GET/POST | `/api/mall/campaign-shares/{shareToken}` | 分享落地（GET 取内容，POST 上报事件 `clientEventId`） |
| GET | `/api/mall/shares` | 分享记录 |
| GET | `/api/mall/subscriptions` | 订阅消息授权记录 |

> **领券必须做幂等**：前端会带 `idempotencyKey`，后端按 key 去重，避免重复领取。

### 4.5 地址 / 注册 / 邀请

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/mall/addresses` | 地址列表 / 新增 |
| GET/PATCH/DELETE | `/api/mall/addresses/{id}` | 地址详情 / 修改 / 删除 |
| POST | `/api/mall/addresses/{id}/default` | 设为默认地址 |
| POST | `/api/mall/register` | 客户注册/补录资料 |
| GET/POST | `/api/mall/invitations/{inviteScene}` | 邀请码校验 / 接受邀请 |
| POST | `/api/mall/wechat-login` | 微信登录（换会话 Cookie） |

---

## 5. 关键业务字段约定

### 5.1 客户身份 `customerStatus` / `customerMode`

| 前端 mode | 触发条件 | 前端表现 |
|---|---|---|
| `GUEST` | 未登录 / 未绑定门店 | 可浏览，**不可看价格、不可下单** |
| `VIEW_ONLY` | 已绑定但当前角色只读 | 可看，下单按钮禁用 |
| `BOUND` | `APPROVED_BOUND_CUSTOMER` | 完整功能（价格、加购、下单、支付） |

### 5.2 价格可见性

- 后端在 `/api/mall/home`、商品接口里返回 `priceAccess.canViewPrice`
- 每个商品还有 `priceVisible / priceText / priceUnavailableText`
- **前端不自己判断"该不该显示价格"**，只按后端字段渲染；`priceText` 缺失时显示 `priceUnavailableText`（如「登录后查看价格」）

### 5.3 首页模块开关（`homepageModules`）

后端返回一组布尔开关，控制首页各模块是否显示：

```json
{ "banner": true, "search": true, "quickEntries": true, "currentCampaigns": true,
  "limitedTime": true, "buyGift": true, "featuredTheme": true, "brandZone": true,
  "categorySelection": true }
```

前端按开关渲染；**关掉哪个后端就不用给对应数据**。

---

## 6. 本次改动（2026-11-02）

只动了**首页 4 个文件** + 新增 1 个工具文件，其它页面保持原样。详见
[CHANGELOG-2026-11-02.md](CHANGELOG-2026-11-02.md)。

| 文件 | 改了什么 |
|---|---|
| `pages/index/index.json` | 加 `navigationStyle: "custom"`（隐藏原生导航栏） |
| `pages/index/index.js` | ①算状态栏/导航区/轮播区高度 ②采样 banner 主色 ③加载遮罩「延迟 300ms + 最短 1 秒」 |
| `pages/index/index.wxml` | 轮播提到屏幕顶部、搜索框移到「全渠供」旁、内容包进内收白色卡片 |
| `pages/index/index.wxss` | 新增布局层（追加，不改原有规则） |
| `utils/loading-buffer.js` | 预留的页面加载缓冲工具（**当前未被引用**） |

**对后端无接口变更**：字段全部沿用现有契约，没有新增/修改任何接口。

---

## 7. 联调注意事项（后端同学常踩的坑）

1. **Cookie 必须能跨请求使用**
   小程序没有 Authorization 头，会话全靠 Cookie。请确认登录响应 `Set-Cookie` 的 `Path=/`、未被 `Secure/SameSite` 卡住，且后续接口认这个 Cookie。

2. **GET 请求会被前端加防缓存参数**
   `_mallCanonicalTs` 是前端加的时间戳，后端忽略即可，但**不要因为它报参数校验失败**。

3. **`storefrontCode` 和 `mallCode` 同时出现**
   历史原因两个字段并存，值相同。后端取任意一个即可，别因为多了一个字段报 400。

4. **`ok: false` 会被当失败**
   即使 HTTP 200，只要 body 里 `ok === false`，前端就按失败处理并展示 `message`。

5. **`403 + CAPABILITY_DENIED` 不是登录失效**
   前端只在普通 401/403 时清会话；能力不足要单独提示。

6. **价格绝不要留空**
   `priceVisible=true` 但 `priceText` 为空会导致页面出现空白金额。要么给 `priceText`，要么置 `priceVisible=false` 同时给 `priceUnavailableText`。

7. **图片域名需加入小程序合法域名**
   banner、商品图、活动海报等如果是独立 CDN 域名，需要在微信公众平台配置 `downloadFile` / `request` 合法域名。

---

## 8. 本地开发 / 调试

```bash
# 微信开发者工具：导入项目 → 选择本仓库根目录
# AppID：wx9cb4a72f6ae06f6a
# 基础库：3.5.8+
```

- 开发版默认连验收后端（`mall-acceptance.wzzhenshang.com/__mall060`）
- `project.private.config.json` 是**本机私有配置，不入库**（`.gitignore` 已排除）
- 命令行预览：

```bash
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" preview ^
  --project <本仓库路径> --qr-format image --qr-output qr.png --qr-size 520
```

- 看真机效果：用 `preview` 生成的二维码，手机微信扫码

---

## 9. 已知问题 / 待办

| 项 | 说明 | 优先级 |
|---|---|---|
| 页面切换加载缓冲未全站铺开 | 曾给 5 个页面加吉祥物遮罩，导致「我的账户」「订单」白屏，已全部回滚；首页那套（延迟 300ms + 最短 1s）保留可用 | 中 |
| 首页轮播图比例 | 横幅素材是 16:7 横图，放进 45% 屏高的区域时用「完整显示 + 主色填充」；若设计出竖版素材（750×640 左右）可直接铺满，无需填充 | 低 |
| `utils/loading-buffer.js` | 预留工具，当前无引用，可删除或后续接入 | 低 |
| 首页顶部导航区是空的 | 只有系统胶囊按钮，没有返回/首页图标；如需可加 | 低 |

---

## 10. 参考代码说明

`reference/workbuddy-mall-ui/` 是**早期用 WorkBuddy 生成的商城首页 UI 参考实现**（独立小程序工程），仅作视觉/交互参考，**不是线上代码**，也不参与本工程编译。

`docs/workbuddy-sessions/` 是早期需求讨论的可读记录（产品背景、视觉要求），需要找「当初为什么这么做」时可以翻。

---

## 11. 仓库地址 / 联系人

| 用途 | 地址 |
|---|---|
| **小程序前端（公开，直接打开即可看）** | https://github.com/H-max-dotcom/qcg-miniprogram |
| 交接文档直达 | https://github.com/H-max-dotcom/qcg-miniprogram/blob/main/docs/HANDOFF.md |
| 改动说明直达 | https://github.com/H-max-dotcom/qcg-miniprogram/blob/main/docs/CHANGELOG-2026-11-02.md |
| ERP 后端（私有） | https://github.com/H-max-dotcom/fmcg-erp |
| 共享仓库（私有，需被邀请） | https://github.com/zrq8870-rgb/fmcg-erp-employee-mobile-collab |

- 小程序 AppID：`wx9cb4a72f6ae06f6a`
- 小程序代码**与 ERP 代码完全分离**：公开仓库只有小程序，不含任何后端代码

> 有任何接口疑问，先看 `utils/request.js` 对应函数的入参/出参处理，再对着本文第 4 节查路径——**前端对字段的依赖都在那里，不会有第三种来源**。
