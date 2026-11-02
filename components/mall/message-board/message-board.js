// 公告栏组件：左侧喇叭 + 右侧单行文字竖向轮播
// 纯展示组件，不关心路由：点击只抛 cardtap 事件，由使用方决定跳哪里。
Component({
  options: {
    // 样式隔离：组件内部只认自己的 wxss，避免「改 A 面板碰到 B 面板」
    styleIsolation: "isolated",
  },

  properties: {
    // 公告文案列表，按数组顺序竖向循环
    list: {
      type: Array,
      value: [],
    },
    // 每条停留时长（ms）
    interval: {
      type: Number,
      value: 3000,
    },
    // 切换动画时长（ms）
    duration: {
      type: Number,
      value: 500,
    },
  },

  data: {
    // 过滤掉空串后的实际渲染列表，避免出现空白轮播项
    items: [],
  },

  observers: {
    list(list) {
      const source = Array.isArray(list) ? list : [];
      this.setData({
        items: source.filter((item) => String(item || "").trim() !== ""),
      });
    },
  },

  methods: {
    onCardTap() {
      this.triggerEvent("cardtap");
    },
  },
});
