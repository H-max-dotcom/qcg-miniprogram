const { request, formatServerDateTime } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
Page({
  data: { storefrontCode: "zhenshang", paymentId: "", ledgerEntryId: "", tab: "", items: [], page: 1, hasMore: false, loading: true, error: "" },
  onLoad(query) { query = query || {}; this.setData({ storefrontCode: resolveStorefrontEntrance(query || {}).storefrontCode, paymentId: String(query.paymentId || ""), ledgerEntryId: String(query.ledgerEntryId || ""), tab: query.tab === "PREPAID" ? "PREPAID" : "" }); },
  onShow() { this._visible = true; return this.refresh(); },
  onHide() { this._visible = false; this._version = (this._version || 0) + 1; this.setData({ items: [], error: "" }); },
  onUnload() { this.onHide(); },
  async refresh() {
    const version = this._version = (this._version || 0) + 1;
    this.setData({ loading: true, error: "", items: [] });
    try {
      const result = await request({ path: "/api/mall/payments/batch-history", storefrontCode: this.data.storefrontCode, data: { paymentId: this.data.paymentId || undefined, ledgerEntryId: this.data.ledgerEntryId || undefined, tab: this.data.tab || undefined, page: this.data.page } });
      if (!this._visible || version !== this._version) return;
      if (result.state !== "AVAILABLE" || !Array.isArray(result.items)) throw new Error("INVALID_HISTORY");
      const labels = { CREATED: "待付款", PROCESSING: "确认中", SUCCEEDED: "付款成功", CLOSED: "已关闭", FAILED: "未成功" };
      this.setData({ items: result.items.map(item => ({ ...item, dateText: formatServerDateTime(item.succeededAt || item.createdAt), statusText: labels[item.status] || "待确认", methodText: item.method === "PREPAID_BALANCE" ? "预付款余额" : "微信支付", expanded: !!(this.data.paymentId || this.data.ledgerEntryId) })), hasMore: result.hasMore === true, loading: false });
    } catch (_) { if (this._visible && version === this._version) this.setData({ loading: false, error: "付款记录暂不可用，请返回自己的待付款中心或重试。" }); }
  },
  toggle(event) { const id = event.currentTarget.dataset.id; this.setData({ items: this.data.items.map(item => ({ ...item, expanded: item.paymentId === id ? !item.expanded : item.expanded })) }); },
  nextPage() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); return this.refresh(); } },
  previousPage() { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); return this.refresh(); } },
  goBack() { wx.navigateBack({ delta: 1 }); },
});
