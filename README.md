# 全渠供 · 订货商城微信小程序（前端）

温州振商 FMCG 的**客户订货商城**微信小程序，原生小程序开发（无第三方框架），对接 ERP 后端 `/api/mall/*` 接口。

> **本仓库定位**
> 本分支（`miniprogram`）**只有小程序前端代码**，与 ERP 后端代码**完全分离**。
> ERP 后端 / 管理端在同仓库的 `main` 分支，或在 `H-max-dotcom/fmcg-erp` 仓库，两者互不覆盖、互不干扰。

## 快速开始

```bash
# 1. 用微信开发者工具「导入项目」，目录选本仓库根目录
# 2. AppID：wx9cb4a72f6ae06f6a（仅公开客户端标识，禁止写入 AppSecret）
# 3. 基础库：3.5.8 及以上（project.config.json 已锁定）
# 4. 编译即可运行；开发版默认连验收后端
```

命令行编译/预览（Windows）：

```bash
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open    --project <本仓库路径>
"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" preview --project <本仓库路径> --qr-format image --qr-output qr.png
```

## 后端接口地址（唯一来源：`config/runtime.js`）

| 小程序环境 | 目标域名 |
|---|---|
| 开发版（develop） | `https://mall-acceptance.wzzhenshang.com/__mall060` |
| 体验版（trial） | `https://mall-acceptance.wzzhenshang.com/__mall060` |
| 正式版（release） | `https://erp.wzzhenshang.com` |

小程序只用 `wx.getAccountInfoSync().miniProgram.envVersion` 自动映射，**不写死地址**。

## 目录

```
app.js / app.json / app.wxss   入口与全局配置（24 个页面）
pages/        页面（index 首页、category 分类、product 商品、cart 购物车、orders 订单、me 我的、account 账户…）
components/   mall/* 业务组件、loading-mask 加载遮罩、coupon-card
utils/        request.js（统一请求/会话）、cart.js、storefront.js、invite.js 等
config/       runtime.js 环境映射
assets/       图标、吉祥物、加载动画分图层素材
scaffold/     演示数据与素材兜底
docs/         交接文档
reference/    WorkBuddy 产出的商城 UI 参考实现（历史参考，非线上代码）
```

## 文档

- **[docs/HANDOFF.md](docs/HANDOFF.md)** —— 交接主文档：架构、接口清单、会话机制、字段约定、联调注意点（**后端同学先看这份**）
- [docs/CHANGELOG-2026-11-02.md](docs/CHANGELOG-2026-11-02.md) —— 本次首页改版与加载策略的改动清单与回滚方式
- [README_微信开发者工具导入说明.md](README_微信开发者工具导入说明.md) —— 原始工程导入与验收口径

## 版本与分支

| 分支 | 内容 |
|---|---|
| `miniprogram` | **本分支**：小程序前端完整代码 |
| `main`（ERP 仓库） | ERP 后端与管理端，与本分支无公共历史 |

## 许可

内部项目，未授权请勿外传。
