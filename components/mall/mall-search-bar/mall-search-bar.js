Component({
  properties: {
    keyword: { type: String, value: "" },
    placeholder: { type: String, value: "搜商品名 / 编码 / 条码 / 品牌" },
  },
  methods: {
    onInput(event) {
      this.triggerEvent("input", { value: event.detail.value });
    },
    onSearch(event) {
      this.triggerEvent("search", { value: event.detail.value || this.data.keyword });
    },
    onSearchTap() {
      this.triggerEvent("search", { value: this.data.keyword });
    },
    onClear() {
      this.triggerEvent("input", { value: "" });
    },
  },
});
