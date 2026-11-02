// 全屏 Loading 遮罩组件（页面内加载用，不是冷启动启动页）
//
// 用途：页面跳转 / 接口请求期间盖一层半透明遮罩，避免出现白屏并阻断误触。
// 用法：
//   1) 页面 json 注册："usingComponents": { "loading-mask": "/components/loading-mask/loading-mask" }
//   2) wxml 中放置： <loading-mask isLoading="{{loading}}" text="正在加载商品..." />
//   3) 请求前 this.setData({ loading: true })，请求结束后置 false
//
// 吉祥物动画：素材被拆成 5 张透明 PNG（assets/loading/rig/），用 WXSS 驱动：
//   body   身体（已抹掉手套与眼珠，露出底色）
//   hand-* 手套 + 袖口搭接边，translateY 上下位移  => 挥手
//   eye-*  眼珠，scaleY 1 -> 0.12 -> 1             => 眨眼
//   整体 translateY                                => 上下浮动
// 全部资源都在包内，不依赖网络，也不受「合法域名」配置影响。
// 若分图层资源异常，自动降级为单张静态吉祥物 imageSrc。
// 注意：遮罩里用的是吉祥物抠图，绝不可换成启动页那张整屏大图。
Component({
  properties: {
    // 是否显示遮罩
    isLoading: {
      type: Boolean,
      value: false,
    },
    // 遮罩背景。默认半透明黑（把页面内容压暗），整页场景可传 transparent
    background: {
      type: String,
      value: "rgba(0, 0, 0, 0.45)",
    },
    // 提示文案
    text: {
      type: String,
      value: "加载中…",
    },
    // 文案颜色（深色遮罩用浅色字，浅色遮罩用深色字）
    textColor: {
      type: String,
      value: "#ffffff",
    },
    // 分图层素材目录
    rigDir: {
      type: String,
      value: "/assets/loading/rig",
    },
    // 降级用的单张静态吉祥物
    imageSrc: {
      type: String,
      value: "/assets/loading/mascot.png",
    },
    // 人形素材偏细长，必须用非正方形尺寸，否则会被压扁/拉伸。
    // 默认约 120px x 190px（375px 视口下），与素材 284:451 原生比例一致。
    // 2026-10-16 按用户要求整体调小约 20%（原 300rpx x 476rpx）。
    imageWidth: {
      type: String,
      value: "240rpx",
    },
    imageHeight: {
      type: String,
      value: "381rpx",
    },
    // 是否播放挥手 / 眨眼 / 浮动动画
    animated: {
      type: Boolean,
      value: true,
    },
    // 是否显示转圈指示器
    showRing: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    // 分图层资源加载失败时置 true，降级为单张静态图
    rigFailed: false,
  },

  methods: {
    onRigError(event) {
      if (this.data.rigFailed) return;
      console.warn(
        "[loading-mask] 分图层素材加载失败，已降级为静态吉祥物",
        event && event.detail
      );
      this.setData({ rigFailed: true });
    },

    // 占位空方法：配合 catchtouchmove 阻止遮罩下方页面滚动
    noop() {},
  },
});
