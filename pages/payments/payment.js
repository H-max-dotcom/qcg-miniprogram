const paymentDiagnostics = require("../../utils/wechat-payment-diagnostics");
const { getConfirmedOrderPayment, prepareConfirmedOrderPay, getWaitingPayments, getPaymentHistory, getPaymentCouponOptions, quoteWaitingPayment, validatePaymentQuote, submitWaitingPayment, recoverWaitingPayment } = require("../../utils/payment-read-adapter");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
const acceptancePaymentOnce = require("../../utils/acceptance-payment-once");
Page({
  data: { paymentRestricted: false, recoveryNeeded: false, confirmedOrder: null, couponPickerOpen: false, availableCoupons: [], unavailableCoupons: [], selectedCouponName: "", recordsMode: false, storefrontCode: "zhenshang", orderId: "", state: "LOADING", items: [], order: null, totalCount: null, page: 1, hasMore: false, coupons: [], couponState: "NOT_INTEGRATED", selectedCouponId: "", quote: null, quoting: false, error: "", quoteError: "", paymentConnected: false, prepaidAvailable: false, wechatAvailable: false },
  onLoad(query) { const entrance = resolveStorefrontEntrance(query || {}); this.setData({ paymentId: String(query && query.paymentId || ""), payment: null, requestedCouponId: "", confirming: false, paying: false, method: "PREPAID_BALANCE", insufficient: false, recordsMode: !!(query && (query.tab === "RECORDS" || query.mode === "history")), storefrontCode: entrance.storefrontCode, orderId: String(query && query.orderId || "") }); if (typeof wx.setNavigationBarTitle === "function") wx.setNavigationBarTitle({ title: this.data.recordsMode ? this.data.paymentId ? "付款详情" : "付款记录" : "待付款订单" }); },
  onShow() { this._visible = true; this.setData({ paying: !!this._paymentActive, paymentRestricted: paymentDiagnostics.isRestricted(wx) }); if (acceptancePaymentOnce.enabled(this.data.orderId)) return acceptancePaymentOnce.initialize(this).catch(() => this.setData({ state: "ERROR", error: "请使用当前测试账号登录，再联系商家核验。" })); return this.refresh(); },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; this._quoteGeneration = (this._quoteGeneration || 0) + 1; this.setData({ couponPickerOpen: false, selectedCouponName: "", availableCoupons: [], unavailableCoupons: [], quote: null, selectedCouponId: "", coupons: [], order: null, items: [], state: "LOADING" }); },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    if (this._visible === false) return;
    const generation = this._generation = (this._generation || 0) + 1;
    this._quoteGeneration = (this._quoteGeneration || 0) + 1;
    const current = () => this._visible !== false && generation === this._generation;
    this.setData({ couponPickerOpen: false, selectedCouponName: "", availableCoupons: [], unavailableCoupons: [], state: "LOADING", confirmedOrder: null, error: "", quoteError: "", quote: null, coupons: [], selectedCouponId: "", requestedCouponId: "", items: [], payment: null, order: null, quoting: false, paymentConnected: false, prepaidAvailable: false, wechatAvailable: false });
    try {
      if (this.data.recordsMode) {
        const history = await getPaymentHistory(this.data.storefrontCode, this.data.page, this.data.paymentId);
        if (!current()) return;
        this.setData({ state: "HISTORY_READY", payment: history.payment || null, items: history.items || [], totalCount: history.total ?? null, hasMore: !!history.items && history.page * history.pageSize < history.total });
        return;
      }
      const result = await getWaitingPayments(this.data.storefrontCode, this.data.orderId, this.data.page);
      if (!current()) return;
      if (result.state !== "WAITING_PAYMENT") { this.setData({ state: "NOT_INTEGRATED", totalCount: null }); return; }
      const order = this.data.orderId ? result.items.find(item => item.orderId === this.data.orderId) || null : null;
      this.setData({ state: this.data.orderId && !order ? "NOT_WAITING" : "READY", items: result.items, order, totalCount: result.totalCount, hasMore: result.page * result.pageSize < result.totalCount });
      if (order && order.paymentTiming === "PAY_BEFORE_FULFILLMENT") {
        const confirmedOrder = await getConfirmedOrderPayment(this.data.storefrontCode, order.orderId);
        if (!current()) return;
        this.setData({ confirmedOrder, wechatAvailable: confirmedOrder.wechatAvailable, prepaidAvailable: false, method: "WECHAT_PAY", couponState: "UNAVAILABLE", insufficient: false });
        return;
      }
      if (order) {
        const options = await getPaymentCouponOptions(this.data.storefrontCode, order.receivableId);
        if (!current()) return;
        const prepaidAvailable = options.capabilities?.prepaidBalance === true;
        const wechatAvailable = options.capabilities?.wechatPay === true;
        const coupons = options.state === "READY" && Array.isArray(options.items) ? options.items : [];
        this.setData({ availableCoupons: coupons.filter(item => item.eligible === true), unavailableCoupons: coupons.filter(item => item.eligible !== true), prepaidAvailable, wechatAvailable, method: prepaidAvailable ? "PREPAID_BALANCE" : wechatAvailable ? "WECHAT_PAY" : "", insufficient: false, couponState: options.state, coupons: options.state === "READY" && Array.isArray(options.items) ? options.items : [] });
      }
    } catch (_) { if (current()) this.setData({ state: "ERROR", error: this.data.recordsMode ? "付款记录暂不可用，请稍后重试。" : "待付款数据暂不可用，请稍后重试。" }); }
  },
  openCouponPicker() {
    if (this._visible === false || this.data.paying || this.data.confirming || !this.data.order || this.data.couponState !== "READY") return;
    this.setData({ couponPickerOpen: true });
  },
  closeCouponPicker() {
    if (this.data.quoting) {
      this._quoteGeneration = (this._quoteGeneration || 0) + 1;
      this.setData({ quoting: false, quote: null, selectedCouponId: "", selectedCouponName: "", requestedCouponId: "", paymentConnected: false });
    }
    this.setData({ couponPickerOpen: false });
  },
  stopCouponBubble() {},
  async chooseCoupon(event) {
    if (this._visible === false || this.data.paying || this.data.confirming || !this.data.order || this.data.couponState !== "READY" || !this.methodAvailable(this.data.method)) return;
    const id = String(event.currentTarget.dataset.id || "");
    if (id && !this.data.coupons.some(item => item.id === id && item.eligible === true)) return;
    const generation = this._quoteGeneration = (this._quoteGeneration || 0) + 1;
    const orderId = this.data.order.orderId;
    this.setData({ requestedCouponId: id, selectedCouponId: "", selectedCouponName: "", quote: null, paymentConnected: false, quoteError: "", quoting: true });
    try {
      const result = await quoteWaitingPayment(this.data.storefrontCode, { receivableId: this.data.order.receivableId, customerCouponId: id || null, method: this.data.method });
      if (this._visible === false || generation !== this._quoteGeneration || !this.data.order || this.data.order.orderId !== orderId) return;
      if (result.method !== this.data.method) throw new Error("PAYMENT_METHOD_MISMATCH");
      const quote = validatePaymentQuote(result, orderId, id, this.data.order.receivableId);
      this.setData({ quote, selectedCouponId: quote.customerCouponId || "", selectedCouponName: (this.data.coupons.find(item => item.id === quote.customerCouponId) || {}).name || "不使用优惠券", couponPickerOpen: false, paymentConnected: true,
        insufficient: this.data.method === "PREPAID_BALANCE" && Number(result.prepaidBalance) < Number(result.finalAmount) });
    } catch (_) { if (this._visible !== false && generation === this._quoteGeneration) this.setData({ quoteError: id ? "优惠券未应用，付款金额尚未核验，请重新选券。" : "付款金额尚未核验，请稍后重试。", quote: null, selectedCouponId: "", paymentConnected: false }); }
    finally { if (this._visible !== false && generation === this._quoteGeneration) this.setData({ quoting: false }); }
  },
  methodAvailable(method) { return method === "PREPAID_BALANCE" ? this.data.prepaidAvailable === true : method === "WECHAT_PAY" && this.data.wechatAvailable === true; },
  chooseMethod(event) {
    if (this.data.paying || this.data.confirming) return;
    const method = event.currentTarget.dataset.method;
    if (!this.methodAvailable(method)) return;
    this.setData({ method, quote: null, paymentConnected: false });
    return this.chooseCoupon({ currentTarget: { dataset: { id: this.data.requestedCouponId } } });
  },
  quoteReady() {
    const q = this.data.quote;
    return this._visible !== false && !this.data.quoting && q && this.data.order && q.orderId === this.data.order.orderId
      && q.receivableId === this.data.order.receivableId && (q.customerCouponId || "") === this.data.requestedCouponId
      && (q.customerCouponId || "") === this.data.selectedCouponId && q.method === this.data.method
      && this.methodAvailable(q.method) && !this.data.insufficient && Date.parse(q.expiresAt) > Date.now();
  },
  async pay() {
    if (this.data.method === "WECHAT_PAY" && paymentDiagnostics.isRestricted(wx)) { this.permissionStop(); return; }
    if (this.data.confirmedOrder) return this.payConfirmedOrder();
    if (this.data.paying || this.data.confirming || this.data.recoveryNeeded || !this.quoteReady()) return;
    const quote = this.data.quote, code = this.data.storefrontCode, orderId = quote.orderId;
    this.setData({ confirming: true });
    let consent = false;
    try {
      consent = await new Promise(resolve => wx.showModal({ title: `确认支付 ¥${quote.finalAmount}`,
        content: `原应收 ¥${quote.originalAmount}\n${quote.customerCouponId ? `优惠券 -¥${quote.discountAmount}` : "未使用优惠券"}\n${quote.method === "PREPAID_BALANCE" ? "预付款" : "微信支付"}实付 ¥${quote.finalAmount}`,
        confirmText: "确认支付", success: result => resolve(result.confirm === true), fail: () => resolve(false) }));
    } finally { this.setData({ confirming: false }); }
    if (!consent || !this.quoteReady() || this.data.quote.quoteId !== quote.quoteId) return;
    this._paymentActive = true;
    this.setData({ paying: true, quoteError: "" });
    try {
      const result = await submitWaitingPayment(code, quote.quoteId, `native:${quote.quoteId}`);
      let final = result;
      if (result.clientPayment) {
        let cancelled = false;
        const outcome = await paymentDiagnostics.invoke(wx, result);
        if (outcome.restricted) { this.permissionStop(); return; }
        cancelled = outcome.cancelled;
        final = await recoverWaitingPayment(code, orderId, cancelled);
      }
      if (this._visible !== false) {
        if (final.state === "SUCCEEDED") { this.setData({ recoveryNeeded: false }); wx.showToast({ title: "付款成功", icon: "success" }); await this.refresh(); }
        else this.setData({ recoveryNeeded: final.state !== "CLOSED", quote: null, quoteError: final.state === "CLOSED" ? "付款已取消，优惠券未使用。" : "结果待确认，请查询付款结果。" });
      }
    } catch (error) {
      if (this._visible !== false) {
        const code = String(error && error.code || "");
        this.setData({ recoveryNeeded: true, quote: null, selectedCouponId: "", paymentConnected: false, couponInvalid: /COUPON/.test(code),
          quoteError: /COUPON|QUOTE/.test(code) ? "优惠券或报价已失效，请重新选择并核验金额后付款。" : "付款结果待确认，请查询后再重试。" });
      }
    }
    finally { this._paymentActive = false; if (this._visible !== false) this.setData({ paying: false }); }
  },
  permissionStop() { this.setData({ paymentRestricted: true, recoveryNeeded: false, quoteError: "微信支付权限受限，已停止支付，请联系商家处理。" }); },
  async payConfirmedOrder() {
    if (paymentDiagnostics.isRestricted(wx)) { this.permissionStop(); return; }
    const order = this.data.confirmedOrder;
    if (order && acceptancePaymentOnce.enabled(order.orderId)) return acceptancePaymentOnce.run(this, wx, order, prepareConfirmedOrderPay, recoverWaitingPayment);
    if (this._visible === false || this.data.paying || this.data.confirming || this.data.recoveryNeeded || !order || !order.wechatAvailable) return;
    const generation = this._generation;
    this.setData({ confirming: true });
    let consent = false;
    try { consent = await new Promise(resolve => wx.showModal({ title: `确认支付 ¥${order.amount}`,
      content: `订单 ${order.orderNo}\n业务员已确认本单金额 ¥${order.amount}\n微信支付，不使用优惠券或余额。`,
      confirmText: "确认支付", success: result => resolve(result.confirm === true), fail: () => resolve(false) })); }
    finally { this.setData({ confirming: false }); }
    if (!consent || this._visible === false || generation !== this._generation || this.data.confirmedOrder !== order) return;
    this._paymentActive = true; this.setData({ paying: true, quoteError: "" });
    try {
      const result = await prepareConfirmedOrderPay(this.data.storefrontCode, order);
      if (!result || result.ok !== true || result.orderId !== order.orderId) throw new Error("PAYMENT_PREPARE_INVALID");
      let cancelled = false;
      if (result.clientPayment) {
        const outcome = await paymentDiagnostics.invoke(wx, result);
        if (outcome.restricted) { this.permissionStop(); return; }
        cancelled = outcome.cancelled;
      }
      const final = await recoverWaitingPayment(this.data.storefrontCode, order.orderId, cancelled);
      if (this._visible !== false) {
        if (final.state === "SUCCEEDED") { this.setData({ recoveryNeeded: false }); wx.showToast({ title: "付款成功", icon: "success" }); await this.refresh(); }
        else this.setData({ recoveryNeeded: final.state !== "CLOSED", quoteError: final.state === "CLOSED" ? "付款已取消，可重新发起。" : "付款结果待确认，请查询付款结果。" });
      }
    } catch (_) { if (this._visible !== false) this.setData({ recoveryNeeded: true, quoteError: "金额或付款状态需要重新核验，请查询付款结果并刷新后再试。" }); }
    finally { this._paymentActive = false; if (this._visible !== false) this.setData({ paying: false }); }
  },
  async requoteWithoutCoupon() {
    if (this.data.paying || this.data.confirming || !this.data.couponInvalid) return;
    await this.chooseCoupon({ currentTarget: { dataset: { id: "" } } });
    if (this.data.quote && !this.data.quote.customerCouponId) this.setData({ couponInvalid: false, quoteError: `优惠券已不可用，金额已更新为 ¥${this.data.quote.finalAmount}。请确认新金额后再付款。` });
  },
  async recover() {
    try {
      const result = await recoverWaitingPayment(this.data.storefrontCode, this.data.orderId);
      if (this._visible === false) return;
      if (result.state === "SUCCEEDED") { this.setData({ recoveryNeeded: false }); wx.showToast({ title: "付款成功", icon: "success" }); return this.refresh(); }
      this.setData({ recoveryNeeded: result.state !== "CLOSED", quoteError: result.state === "CLOSED" ? (this.data.confirmedOrder ? "付款已关闭，可重新发起。" : "付款已关闭，可重新选择优惠券付款。") : "尚未确认付款，请稍后再查询。" });
    } catch (_) { if (this._visible !== false) this.setData({ quoteError: "暂未查询到付款结果，请稍后重试。" }); }
  },
  openOrder(event) { const id = String(event.currentTarget.dataset.id || ""); if (this._visible !== false && this.data.items.some(item => item.orderId === id)) wx.navigateTo({ url: `/pages/payments/payment?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&orderId=${encodeURIComponent(id)}` }); },
  openPayment(event) { const id = String(event.currentTarget.dataset.id || ""); if (this._visible !== false && this.data.items.some(item => item.id === id)) wx.navigateTo({ url: `/pages/payments/payment?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&mode=history&paymentId=${encodeURIComponent(id)}` }); },
  nextPage() { if (this.data.hasMore) { this.setData({ page: this.data.page + 1 }); return this.refresh(); } },
  previousPage() { if (this.data.page > 1) { this.setData({ page: this.data.page - 1 }); return this.refresh(); } },
  goBack() { if (this._visible === false) return; wx.navigateBack({ delta: 1 }); },
});
