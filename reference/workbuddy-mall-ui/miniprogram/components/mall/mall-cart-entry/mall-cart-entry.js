const { formatCartBadgeCount } = require("../../../utils/cart");

Component({
  properties: {
    count: { type: Number, value: 0 },
    selected: { type: Boolean, value: false },
    ariaLabel: { type: String, value: "打开购物车" },
  },

  data: {
    badgeText: "",
  },

  observers: {
    count(value) {
      this.setData({ badgeText: formatCartBadgeCount(value) });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ badgeText: formatCartBadgeCount(this.data.count) });
    },
  },

  methods: {
    openCart() {
      this.triggerEvent("entrytap");
    },
  },
});
