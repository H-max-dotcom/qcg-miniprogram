Component({
  properties: {
    title: { type: String, value: "" },
    note: { type: String, value: "" },
    products: { type: Array, value: [] },
    layout: { type: String, value: "grid" },
    priceHint: { type: String, value: "登录后查看价格" },
    moreVisible: { type: Boolean, value: false },
  },
  methods: {
    onMore() {
      this.triggerEvent("more");
    },
    onOpen(event) {
      this.triggerEvent("product", event.detail);
    },
    onAdd(event) {
      this.triggerEvent("add", event.detail);
    },
  },
});
