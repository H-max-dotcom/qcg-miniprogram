const { getMallFinance, formatServerDateTime } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

Page({
  data: { storefrontCode: "zhenshang", finance: null, loading: false, errorMessage: "" },
  onLoad(query) {
    this._disposed = false;
    this.setData({ storefrontCode: resolveStorefrontEntrance(query || {}).storefrontCode });
  },
  onShow() { this._visible = true; return this.loadFinance(); },
  onHide() {
    this._visible = false;
    this._version = (this._version || 0) + 1;
    this.setData({ finance: null, loading: false, errorMessage: "" });
  },
  onUnload() { this._disposed = true; this.onHide(); },
  onPullDownRefresh() { return this.loadFinance().finally(() => wx.stopPullDownRefresh()); },
  loadFinance() {
    if (this._disposed || !this._visible) return Promise.resolve();
    const version = this._version = (this._version || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._visible && version === this._version && code === this.data.storefrontCode;
    this.setData({ finance: null, loading: true, errorMessage: "" });
    return getMallFinance(code).then((result) => {
      if (!current()) return;
      const finance = result && result.finance;
      if (!finance || !finance.receipts || !Array.isArray(finance.receipts.items) || !finance.unsettled || !Array.isArray(finance.unsettled.items)) throw new Error("INCOMPLETE_FINANCE_READ");
      // Amounts are server facts. Only dates receive presentation formatting.
      this.setData({ loading: false, finance: Object.assign({}, finance, {
        asOfText: formatServerDateTime(finance.asOf),
        receipts: Object.assign({}, finance.receipts, { items: finance.receipts.items.map((item) => Object.assign({}, item, { dateText: formatServerDateTime(item.receiptDate) })) }),
        unsettled: Object.assign({}, finance.unsettled, { items: finance.unsettled.items.map((item) => Object.assign({}, item, { dateText: formatServerDateTime(item.billDate) })) }),
      }) });
    }).catch((error) => {
      if (!current()) return;
      const denied = error && (error.code === "FINANCE_ACCESS_DENIED" || error.code === "NEED_LOGIN");
      this.setData({ finance: null, loading: false, errorMessage: denied ? "当前身份不可查看账户账务，请返回我的页面确认登录与门店身份" : "账户账务读取失败，请重试" });
    });
  },
  goBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 });
    return wx.redirectTo({ url: `/pages/me/me?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },
});
