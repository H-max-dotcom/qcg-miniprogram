// 页面切换的加载缓冲：进入页面时盖一层吉祥物遮罩，最短停留 1 秒
//
// 为什么单独抽出来：
//   各页面自己的 loading 状态各管各的（quoteLoading / accountLoading / ...），
//   这里只做「进入页面时的视觉缓冲」，不掺和业务数据加载，所以任何页面都能接。
//
// 用法（3 步）：
//   1) page.json 注册组件：
//        "usingComponents": { "loading-mask": "/components/loading-mask/loading-mask" }
//   2) page.wxml 放一行：
//        <loading-mask isLoading="{{maskLoading}}" text="加载中..." />
//   3) page.js：
//        const { enterMaskLoading, clearMaskLoading } = require("../../utils/loading-buffer");
//        data: { maskLoading: false, ... }
//        onLoad(...) { enterMaskLoading(this); ... }
//        onUnload() { clearMaskLoading(this); ... }

// 最短展示时长（ms）
const MASK_DURATION_MS = 1000;

// 进入页面：打开遮罩，并在 1 秒后自动收起
function enterMaskLoading(page) {
  if (!page || typeof page.setData !== "function") return;
  clearMaskLoading(page);
  page.setData({ maskLoading: true });
  page._maskTimer = setTimeout(() => {
    page._maskTimer = null;
    if (page._disposed) return;
    page.setData({ maskLoading: false });
  }, MASK_DURATION_MS);
}

// 立即收起 / 清掉定时器（页面销毁时调用，避免在已销毁页面上 setData）
function clearMaskLoading(page) {
  if (!page) return;
  if (page._maskTimer) {
    clearTimeout(page._maskTimer);
    page._maskTimer = null;
  }
}

module.exports = {
  MASK_DURATION_MS,
  enterMaskLoading,
  clearMaskLoading,
};
