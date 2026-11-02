# 2026-11-02 首页改版 + 加载策略

本次改动**只涉及首页 4 个文件**，另新增 1 个工具文件。其它 23 个页面、所有接口契约、所有业务逻辑**一行未动**。

---

## 1. 改了哪些文件

| 文件 | 性质 | 改动 |
|---|---|---|
| `pages/index/index.json` | 修改 | 增加 `"navigationStyle": "custom"`（隐藏原生导航栏） |
| `pages/index/index.js` | 修改 | 3 处：导航尺寸计算、banner 主色采样、加载遮罩策略 |
| `pages/index/index.wxml` | 修改 | 结构重排：轮播置顶 + 搜索框进标题行 + 内容白卡 |
| `pages/index/index.wxss` | 修改 | 文件末尾追加布局层（原规则一条未改） |
| `utils/loading-buffer.js` | 新增 | 页面加载缓冲工具（预留，当前未引用） |

---

## 2. 首页结构变化

### 改前

```
原生导航栏（全渠供）
顶部 topbar（品牌名 + 搜索框 + 游客标签）
营销 banner 组件（圆角卡片）
会员资产 / 公告 / 本周活动 / 常买待补 / 推荐补货…
底部悬浮结算条 + 自定义 tabbar
```

### 改后

```
状态栏 + 无原生导航栏
┌──────────────────────────────┐
│ 全幅轮播（高度 ≈ 屏高 45%）        │  ← 图片铺到屏幕最顶端
│  · 海报 aspectFit 完整显示，不裁字  │
│  · 上下填充区 = 该图主色（一条一条  │
│    采样出来的平均色）              │
│  · 指示点                        │
└──────────────────────────────┘
   12rpx 浅灰分隔带（#E8EEF2）
┌──────────────────────────────┐  ← 左右各内收 24rpx，四角圆角
│ 全渠供    [绿描边胶囊搜索框]       │
│ 门店 · 游客浏览中…        [游客]   │
│ 免运费通知 / 储值·领券 / 本周活动 … │
└──────────────────────────────┘
自定义 tabbar（页面内不显示悬浮结算条，入口仍走 tabbar 购物车）
```

---

## 3. 三块核心实现

### 3.1 自定义导航尺寸（`index.js` · onLoad）

```js
const win = wx.getWindowInfo();
const statusBarHeight = win.statusBarHeight || 20;
let navBarHeight = statusBarHeight + 44;
// 用胶囊按钮位置反推导航区高度，适配刘海屏/非刘海屏
const capsule = wx.getMenuButtonBoundingClientRect();
if (capsule && capsule.height) {
  navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height;
}
// 轮播区约占屏高 45%
const heroHeight = Math.min(520, Math.max(260, Math.round(win.windowHeight * 0.45)));
this.setData({ statusBarHeight, navBarHeight, heroHeight });
```

### 3.2 轮播背景主色采样（`index.js` · resolveBannerColors）

问题：横幅素材是 **16:7 横图**，放进「屏高 45%」的近方形区域时，等比缩放后上下会留白。

做法：

```js
// 离屏 canvas 把每张 banner 缩到 24x24，逐像素求平均 → 得到该图主色
const canvas = wx.createOffscreenCanvas({ type: "2d", width: 24, height: 24 });
const ctx = canvas.getContext("2d");
ctx.drawImage(img, 0, 0, 24, 24);
const data = ctx.getImageData(0, 0, 24, 24).data;
// 平均 → rgb(r,g,b)
```

- 每张图**各自取色**，滑动时背景色跟着变
- 取色失败（老基础库 / 跨域）自动回退品牌绿 `#0E7C52`
- 效果：海报完整不裁字，上下填充是**同色系延伸**，不是模糊也不是贴图

### 3.3 加载遮罩：延迟显示 + 最短停留

要求：**网络快就不出现，出现了至少停 1 秒**。

```js
_loadingDelayMs: 300,   // 300ms 内加载完 → 全程不显示
_minLoadingMs: 1000,    // 一旦显示，至少停留 1 秒

_markLoadingStart() {
  this._loadingShownAt = 0;                       // 还没显示
  this._loadingRevealTimer = setTimeout(() => {   // 300ms 后才真正显示
    this._loadingShownAt = Date.now();
    this.setData({ loading: true });
  }, this._loadingDelayMs);
}

finishLoading() {
  clearTimeout(this._loadingRevealTimer);
  if (!this._loadingShownAt) return;              // 从未显示 → 不做任何事
  const wait = Math.max(0, 1000 - (Date.now() - this._loadingShownAt));
  // 已显示 → 补足到满 1 秒再收
}
```

| 网络情况 | 吉祥物 |
|---|---|
| < 300ms | **完全不出现** |
| 300ms ~ 1s | 出现，显示满 1 秒 |
| > 1s | 出现，数据到了立即收 |
| 加载失败 | 若已出现 → 同样停满 1 秒，避免"白→错误页"突变 |

参数位置：`pages/index/index.js` 的 `_loadingDelayMs` / `_minLoadingMs`。

---

## 4. 回滚方式

### 4.1 整页回滚到改版前

改版前这四个文件在 ERP 仓库的历史里（小程序原始代码曾随 ERP 一起维护）。本仓库是新建的，没有改版前的历史，因此用文件级回滚：

```bash
# 用改版前备份覆盖（本地保留的原始副本）
cp <改版前副本>/pages/index/index.{js,json,wxml,wxss} pages/index/
```

改版前的文件特征：
- `index.json` 没有 `navigationStyle` 字段
- `index.wxml` 以 `<view class="page home-page">` 开头，内部 `<view class="topbar">` 带品牌名 + 搜索框
- `index.js` 的 `data` 里没有 `statusBarHeight / navBarHeight / heroHeight / bannerColors`

### 4.2 只回滚某一个特性

| 想撤销 | 做法 |
|---|---|
| 加载遮罩延迟策略 | 把 `_loadingDelayMs` 改成 `0`，并让 `_markLoadingStart` 直接 `setData({loading:true})` |
| 主色背景 | 删除 `resolveBannerColors` 的调用，`.hero-slide` 背景改回 `#F2F4F6` |
| 自定义导航栏 | 删掉 `index.json` 的 `navigationStyle` 字段即可（`.hero-nav` 占位随之无效） |

---

## 5. 已验证 / 已知问题

**已验证**

- 微信开发者工具 Stable 2.02.2608080 编译通过，无 WXML/WXSS 报错
- 真机预览（iOS/Android 微信）页面结构、轮播、搜索框、白卡显示正常
- 接口无变更，与现网后端兼容

**已知问题**

- 页面切换的吉祥物缓冲曾尝试推广到分类/购物车/我的/订单/账户 5 个页面，出现「我的账户」「订单」白屏，**已全部回滚**，目前只有首页生效
- 轮播依赖素材是横图，若后端/设计后续提供竖版 banner（750×640 左右），可去掉主色填充直接铺满
