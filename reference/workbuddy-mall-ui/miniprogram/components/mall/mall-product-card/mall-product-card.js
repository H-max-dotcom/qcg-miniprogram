Component({
  properties: {
    product: { type: Object, value: {} },
    priceHint: { type: String, value: "价格确认中" },
    compact: { type: Boolean, value: false },
  },
  data: {
    imgError: false,
  },
  methods: {
    onOpen() {
      this.triggerEvent("open", { id: this.data.product.productId });
    },
    onAdd() {
      this.triggerEvent("add", {
        id: this.data.product.productId,
        lineKey: this.data.product.lineKey,
        productUnitId: this.data.product.productUnitId,
      });
    },
    onImgError() {
      this.setData({ imgError: true });
    },
  },
});
