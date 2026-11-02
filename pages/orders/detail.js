const {
  cancelOrder,
  formatServerDateTime,
  getOrderDetail,
  reconcileWechatReceipt,
  getMallMe,
  getSafeMallErrorMessage,
} = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
const { prepareRepeatPurchaseItems, appendRepeatPurchaseItems } = require("../../utils/cart");

const REORDER_ERROR_TEXT = {
  MALL_REORDER_NOT_ALLOWED: "当前账号暂不能下单，请联系业务员确认",
  MALL_REORDER_CUSTOMER_CHANGED: "登录门店已变化，请重新打开订单",
  MALL_REORDER_ORDER_CHANGED: "订单商品已变化，请重新确认",
  MALL_REORDER_ORDER_UNAVAILABLE: "订单不存在或无权查看，请刷新",
  MALL_REORDER_INVALID_LINE: "订单有无法确认的规格，请重新选择商品规格",
  MALL_REORDER_INVALID_QUANTITY: "商品数量暂不支持，请手动选购",
  MALL_REORDER_EMPTY: "订单没有可加入购物车的商品",
  MALL_REORDER_CART_REPAIR_REQUIRED: "购物车中有待确认规格，请先整理购物车",
  MALL_REORDER_CART_STORAGE_FAILED: "购物车保存或读取失败，请稍后重试",
};

function repeatPurchaseCustomer(result) {
  const member = result && result.member;
  return result && result.customerStatus === "APPROVED_BOUND_CUSTOMER" && result.customer && result.customer.id
    && result.priceAccess && result.priceAccess.canOrder === true && member && member.memberId && member.memberStatus === "ACTIVE"
    && Array.isArray(member.effectiveMallCapabilities) && member.effectiveMallCapabilities.includes("MALL_ORDER_CREATE")
    ? String(result.customer.id) : "";
}

function repeatPurchaseManifest(items) {
  return JSON.stringify(items.map((item) => [item.productId, item.productUnitId, item.quantity])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

const CUSTOMER_STATUS_META = {
  WAITING_FOR_PAYMENT: { acceptText: "本单已确认", deliveryText: "付款后安排发货", text: "待付款", tone: "orange", hint: "本单金额已确认，请付款后等待商家安排发货。" },
  SUBMITTED: { text: "已提交", tone: "orange", acceptText: "等待接单", deliveryText: "等待配送", hint: "我们正在确认商品、价格和配送信息" },
  PROCESSING: { text: "已接单", tone: "green", acceptText: "已接单", deliveryText: "等待配送", hint: "我们正在准备您的商品" },
  ACCEPTED: { text: "已接单", tone: "green", acceptText: "已接单", deliveryText: "等待配送", hint: "我们正在准备您的商品" },
  DELIVERING: { text: "配送中", tone: "green", acceptText: "已接单", deliveryText: "配送中", hint: "正在配送，请保持电话畅通" },
  WAITING_POSTING: { text: "待过账", tone: "orange", acceptText: "已接单", deliveryText: "配送已完成", hint: "等待商家正式过账，无需您确认完成" },
  COMPLETED: { text: "已完成", tone: "gray", acceptText: "已完成", deliveryText: "已完成" },
  CANCELLED: { text: "已取消", tone: "red", acceptText: "已取消", deliveryText: "已取消" },
};

function resolveCustomerStatus(raw) {
  const code = String(raw.customerStatusCode || "").toUpperCase();
  const meta = CUSTOMER_STATUS_META[code];
  if (meta) {
    const text = typeof raw.customerStatusText === "string" && raw.customerStatusText.trim() ? raw.customerStatusText : meta.text;
    return {
      code,
      text,
      hint: typeof raw.customerStatusHint === "string" && raw.customerStatusHint.trim() ? raw.customerStatusHint : meta.hint || "订单状态已更新",
      tone: meta.tone,
      acceptText: code === "PROCESSING" || code === "ACCEPTED" ? text : meta.acceptText,
      deliveryText: meta.deliveryText,
    };
  }
  const value = String(raw.status || raw.customerStatus || "").toUpperCase();
  if (["DELIVERY_ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERING", "SHIPPED"].includes(value)) {
    return { code: "DELIVERING", text: "配送中", hint: "正在配送，请保持电话畅通", tone: "green", acceptText: "已接单", deliveryText: "配送中" };
  }
  if (["CANCELLED", "CLOSED", "REJECTED", "REFUNDED"].includes(value)) {
    return { code: "CANCELLED", text: "已取消", hint: "订单已取消，如有疑问请联系我们", tone: "red", acceptText: "已取消", deliveryText: "已取消" };
  }
  if (value === "COMPLETED") {
    return { code: "COMPLETED", text: "已完成", hint: "订单已完成", tone: "gray", acceptText: "已完成", deliveryText: "已完成" };
  }
  if (["ACCEPTED", "APPROVED", "CLERK_REVIEWED", "CONVERTED", "CONVERTED_TO_SALES_DRAFT", "WAITING_STOCK_CONFIRM", "WAITING_PRICE_CONFIRM", "PROCESSING"].includes(value)) {
    return { code: "PROCESSING", text: "已接单", hint: "我们正在准备您的商品", tone: "green", acceptText: "已接单", deliveryText: "等待配送" };
  }
  return { code: "SUBMITTED", text: "已提交", hint: "我们正在确认商品、价格和配送信息", tone: "orange", acceptText: "等待接单", deliveryText: "等待配送" };
}

function customerReadableOrderNo(value) {
  const text = String(value || "").trim();
  if (!text) return "订单号待返回";
  return `订单号 ${text.length <= 18 ? text : text.slice(-8)}`;
}

function moneyText(value, fallback) {
  if (fallback) return fallback;
  if (value === null || value === undefined || value === "") return "价格确认中";
  const n = Number(value);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : "价格确认中";
}

function normalizeOrder(item) {
  if (!item) return null;
  const raw = item || {};
  const status = resolveCustomerStatus(raw);
  const submittedAtText = formatServerDateTime(raw.submittedAt || raw.createdAt);
  const updatedAtText = formatServerDateTime(raw.updatedAt);
  const marketing = raw.marketingSnapshot && raw.marketingSnapshot.serverAuthoritative === true ? raw.marketingSnapshot : null;
  return Object.assign({}, raw, {
    settlement: raw.settlement ? Object.assign({}, raw.settlement, { paymentTimeText: raw.settlement.paymentTime ? formatServerDateTime(raw.settlement.paymentTime) : "—" }) : null,
    id: raw.id || "",
    orderNo: customerReadableOrderNo(raw.orderNo || raw.billNo || raw.code),
    customerStatusCode: status.code,
    customerStatusText: status.text,
    statusTone: status.tone,
    statusHint: status.hint,
    acceptText: status.acceptText,
    deliveryText: status.deliveryText,
    submittedAtText,
    updatedAtText,
    canCancel: raw.canCancel === true,
    amountText: raw.totalAmount === null ? "最终金额确认中" : moneyText(raw.totalAmount, raw.amountText || raw.totalAmountText),
    confirmedSubtotalText: moneyText(raw.confirmedSubtotal),
    originalTotalText: marketing && marketing.baseTotal != null ? moneyText(marketing.baseTotal) : "",
    campaignDiscountTotalText: marketing && marketing.discountTotal != null ? moneyText(marketing.discountTotal) : "",
    couponDiscountText: marketing && marketing.coupon && marketing.coupon.discountAmount != null ? moneyText(marketing.coupon.discountAmount) : "",
    couponName: marketing && marketing.coupon ? String(marketing.coupon.templateName || "优惠券") : "",
    pendingPriceLineCount: Number(raw.pendingPriceLineCount || 0),
    hasPendingPrice: raw.priceStatus === "PENDING" || raw.priceStatus === "PARTIALLY_PENDING",
    remark: raw.remark || "",
    items: raw.items && raw.items.length ? raw.items.map((row, index) => ({
      id: row.id || `${index}`,
      productId: row.productId || "",
      productUnitId: row.productUnitId || "",
      unitName: row.unitName || "",
      icon: row.icon || "品",
      productName: row.productName || row.name || "商品名称待返回",
      saleMode: row.saleMode || "STANDARD",
      unitConversionRate: row.unitConversionRate == null ? null : String(row.unitConversionRate),
      spec: row.saleMode === "FIXED_WEIGHT_SPEC" ? row.unitSpecSnapshot || row.spec || row.unitName || "规格待返回" : row.spec || row.specification || row.unitName || "规格待返回",
      quantity: row.quantity || 1,
      priceText: row.priceStatus === "PENDING" ? "价格确认中" : moneyText(row.unitPrice, row.priceText || row.displayPrice),
      lineAmountText: row.priceStatus === "PENDING" ? "价格确认中" : moneyText(row.amount),
      priceStatusText: row.priceStatus === "PENDING" ? "价格确认中" : "价格已确认",
      lineRemark: row.lineRemark || row.itemRemark || row.remark || "",
    })) : [],
    reviewDraft: raw.reviewDraft ? {
      deliveryAddress: raw.reviewDraft.deliveryAddress || "",
      expectedDeliveryAtText: formatServerDateTime(raw.reviewDraft.expectedDeliveryAt),
      remark: raw.reviewDraft.remark || "",
      totalAmountText: moneyText(raw.reviewDraft.totalAmount),
      items: (raw.reviewDraft.items || []).map((row, index) => ({
        displayKey: `review-${index}`,
        productName: row.productName || "商品",
        productCode: row.productCode || "",
        saleMode: row.saleMode || "STANDARD",
        spec: row.saleMode === "FIXED_WEIGHT_SPEC" ? row.unitSpecSnapshot || row.spec || row.productUnit || "-" : row.spec || "-",
        productUnit: row.productUnit || "-",
        quantity: row.quantity,
        unitPriceText: moneyText(row.unitPrice),
        amountText: moneyText(row.amount),
        lineTypeText: row.lineType === "GIFT" ? "赠品" : "销售商品",
        remark: row.remark || "",
      })),
      differences: (raw.reviewDraft.differences || []).map((row, index) => ({
        displayKey: `diff-${index}`,
        label: row.label || "订单内容调整",
        field: row.field || "订单内容",
        before: row.before == null ? "-" : String(row.before),
        after: row.after == null ? "-" : String(row.after),
        reason: row.reason || "业务复核调整",
      })),
    } : null,
    customerFeedback: raw.customerFeedback ? {
      reasonLabel: raw.customerFeedback.reasonLabel || "订单需要人工处理",
      message: raw.customerFeedback.message || "业务员会继续处理",
      occurredAtText: formatServerDateTime(raw.customerFeedback.occurredAt),
    } : null,
  });
}

Page({
  data: {
    id: "",
    storefrontCode: "zhenshang",
    order: null,
    loadErrorText: "",
    cancelling: false,
    reordering: false,
    reorderAdded: false,
    reorderError: "",
  },

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    this._wechatReference = query && Object.prototype.hasOwnProperty.call(query, "outTradeNo")
      ? { outTradeNo: query.outTradeNo }
      : query && query.transaction_id && query.merchant_trade_no && query.merchant_id && !query.sub_merchant_id
        ? { transaction_id: query.transaction_id, merchant_trade_no: query.merchant_trade_no, merchant_id: query.merchant_id } : null;
    this._disposed = false;
    this._visible = true;
    this._loadVersion = 0;
    this._cancelInFlight = false;
    this._cancelConfirmation = null;
    this._repeatIntent = null;
    this._repeatEntryPending = Boolean(query && query.reorder === "1");
    this.setData({ id: this._wechatReference ? "" : (query && query.id) || "", storefrontCode: entrance.storefrontCode });
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    this._visible = true;
    this.setData({ cancelling: Boolean(this._cancelInFlight) });
    if (this._wechatReceiptPending) {
      this._wechatReceiptPending = false;
      return reconcileWechatReceipt(this.data.id, this.data.storefrontCode)
        .catch(() => { if (!this._disposed && this._visible) wx.showToast({ title: "收货状态暂未核实，请稍后查看", icon: "none" }); })
        .then(() => this.loadOrder());
    }
    return this.loadOrder();
  },

  confirmWechatReceipt() {
    const receipt = this.data.order && this.data.order.wechatReceipt;
    if (this._disposed || !this._visible || this._wechatReceiptPending || !receipt || receipt.eligible !== true || !receipt.transactionId) return;
    if (typeof wx.openBusinessView !== "function") {
      wx.showToast({ title: "请升级微信后确认收货", icon: "none" });
      return;
    }
    this._wechatReceiptPending = true;
    // Opening or returning from the component never changes ERP/payment/receipt state.
    wx.openBusinessView({ businessType: "weappOrderConfirm", extraData: { transaction_id: receipt.transactionId },
      fail: () => { this._wechatReceiptPending = false; wx.showToast({ title: "未完成确认收货", icon: "none" }); } });
  },

  onHide() {
    this._visible = false;
    this._repeatEntryPending = false;
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._cancelConfirmation = null;
    this._repeatIntent = null;
    this.setData({ order: null, loadErrorText: "", reordering: false, reorderError: "" });
  },

  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._repeatEntryPending = false;
    this._loadVersion = (this._loadVersion || 0) + 1;
    this._cancelConfirmation = null;
    this._repeatIntent = null;
  },

  loadOrder() {
    if (this._disposed || this._visible === false) return Promise.resolve();
    // Consume at the first read: retries and later returns require a fresh user action.
    const repeatEntry = this._repeatEntryPending;
    this._repeatEntryPending = false;
    const id = this.data.id;
    const storefrontCode = this.data.storefrontCode;
    const version = (this._loadVersion || 0) + 1;
    this._loadVersion = version;
    this._repeatIntent = null;
    this.setData({ order: null, loadErrorText: "", reordering: false, reorderAdded: false, reorderError: "" });
    if (!id && !this._wechatReference) {
      this.setData({ loadErrorText: "订单入口已失效，请返回订单列表重新进入" });
      return Promise.resolve();
    }
    const current = () => !this._disposed && this._visible !== false
      && this._loadVersion === version && this.data.id === id && this.data.storefrontCode === storefrontCode;
    return getOrderDetail(id, storefrontCode, this._wechatReference || undefined)
      .then((result) => {
        if (!current()) return;
        if (!result || !result.order || (!this._wechatReference && result.order.id !== id)) {
          this.setData({ order: null, loadErrorText: "订单不存在或无权查看，请返回订单列表重试" });
          return;
        }
        const order = normalizeOrder(result.order);
        if (this._wechatReference) { this._wechatReference = null; this.setData({ id: result.order.id }); }
        this.setData({ order, loadErrorText: "" });
        if (repeatEntry) return this.reorder();
      })
      .catch((error) => {
        if (current()) this.setData({ order: null, loadErrorText: getSafeMallErrorMessage(error, "订单详情加载失败，请刷新或联系业务员") });
      });
  },

  openPayment(event) {
    const id = event.currentTarget.dataset.id;
    if (this._disposed || this._visible === false || !this.data.order || !this.data.order.settlement || !this.data.order.settlement.payments.some(payment => payment.id === id)) return;
    wx.navigateTo({ url: `/pages/payments/payment?mode=history&paymentId=${encodeURIComponent(id)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  cancelOrder(refundDisposition) {
    if (this._disposed || this._visible === false || this._cancelInFlight || this._cancelConfirmation || this._repeatIntent
      || this.data.cancelling || !this.data.order || !this.data.order.canCancel || this.data.order.id !== this.data.id) return;
    const intent = { orderId: this.data.order.id, storefrontCode: this.data.storefrontCode, version: this._loadVersion || 0 };
    const validDisposition = refundDisposition === "PREPAID_BALANCE" || refundDisposition === "OFFLINE_REFUND";
    if (!validDisposition && this.data.order.settlement && Number(this.data.order.settlement.paidAmount) > 0) {
      this._cancelConfirmation = intent;
      wx.showActionSheet({ itemList: ["取消后保留为预付款余额", "取消并申请线下退款（款项将被占用）"],
        success: result => {
          if (this._cancelConfirmation !== intent) return;
          this._cancelConfirmation = null;
          if (!this._disposed && this._visible !== false && this.data.id === intent.orderId
            && (this._loadVersion || 0) === intent.version) this.cancelOrder(result.tapIndex === 0 ? "PREPAID_BALANCE" : "OFFLINE_REFUND");
        },
        fail: () => { if (this._cancelConfirmation === intent) this._cancelConfirmation = null; },
      });
      return;
    }
    if (!validDisposition) refundDisposition = undefined;
    this._cancelConfirmation = intent;
    const currentPage = () => !this._disposed && this._visible !== false
      && this.data.id === intent.orderId && this.data.storefrontCode === intent.storefrontCode;
    wx.showModal({
      title: "确认取消订单",
      content: refundDisposition === "OFFLINE_REFUND"
        ? "订单进入备货或配送后不能取消。如有已付款项，将占用用于线下退款，财务处理期间不可消费。"
        : "订单进入备货或配送后不能取消。如有已付款项，将恢复为可用预付款余额。",
      confirmText: "确认取消",
      confirmColor: "#c93b35",
      success: (result) => {
        if (this._cancelConfirmation !== intent) return;
        this._cancelConfirmation = null;
        if (!result.confirm || !currentPage() || this._cancelInFlight || this.data.cancelling
          || (this._loadVersion || 0) !== intent.version || !this.data.order
          || this.data.order.id !== intent.orderId || !this.data.order.canCancel) return;
        this._cancelInFlight = true;
        this.setData({ cancelling: true });
        return (refundDisposition ? cancelOrder(intent.orderId, intent.storefrontCode, refundDisposition) : cancelOrder(intent.orderId, intent.storefrontCode))
          .then((response) => {
            if (!currentPage()) return;
            if (Number(response.prepaidReleasedAmount) > 0) wx.showModal({ title: "订单已取消", content: response.message, showCancel: false });
            else wx.showToast({ title: "订单已取消", icon: "success" });
            return this.loadOrder();
          })
          .catch((error) => {
            if (!currentPage()) return;
            const message = getSafeMallErrorMessage(error, "订单取消失败，请刷新后重试");
            if (["NEED_LOGIN", "NEED_BIND_CUSTOMER", "CUSTOMER_NOT_ACTIVE"].includes(error.code)) {
              const errorVersion = this._loadVersion;
              wx.showModal({
                title: "请完善门店资料",
                content: message,
                confirmText: "查看资料",
                success: (modalResult) => {
                  if (modalResult.confirm && currentPage() && this._loadVersion === errorVersion) wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${intent.storefrontCode}` });
                },
              });
              return;
            }
            wx.showToast({ title: message, icon: "none" });
            if (error.code === "ORDER_NOT_CANCELLABLE") return this.loadOrder();
          })
          .finally(() => {
            this._cancelInFlight = false;
            if (currentPage()) this.setData({ cancelling: false });
          });
      },
      fail: () => {
        if (this._cancelConfirmation === intent) this._cancelConfirmation = null;
      },
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({ url: `/pages/orders/list?storefrontCode=${this.data.storefrontCode}` });
  },

  openRepeatPurchaseCart() {
    const id = this.data.id;
    const code = this.data.storefrontCode;
    const version = this._loadVersion;
    wx.navigateTo({
      url: `/pages/cart/cart?storefrontCode=${code}`,
      fail: () => {
        if (!this._disposed && this._visible !== false && this.data.id === id && this.data.storefrontCode === code && this._loadVersion === version && this.data.reorderAdded) {
          this.setData({ reorderError: "商品已加入购物车，请点击“已加入，去购物车”重试打开" });
        }
      },
    });
  },

  async reorder() {
    if (this._disposed || this._visible === false || this._repeatIntent || this._cancelInFlight || this._cancelConfirmation
      || this.data.cancelling || !this.data.order || this.data.order.id !== this.data.id) return;
    if (this.data.reorderAdded) return this.openRepeatPurchaseCart();
    const intent = { orderId: this.data.id, storefrontCode: this.data.storefrontCode, version: this._loadVersion || 0, confirmed: false };
    this._repeatIntent = intent;
    this.setData({ reordering: true, reorderError: "" });
    const current = () => this._repeatIntent === intent && !this._disposed && this._visible !== false
      && this.data.id === intent.orderId && this.data.storefrontCode === intent.storefrontCode
      && (this._loadVersion || 0) === intent.version && this.data.order && this.data.order.id === intent.orderId;
    const finish = (error) => {
      if (!current()) return;
      this._repeatIntent = null;
      this.setData({ reordering: false, reorderError: error ? REORDER_ERROR_TEXT[error.code] || getSafeMallErrorMessage(error, "暂时无法加入购物车，请刷新后重试") : "" });
    };
    const readItems = async () => {
      const result = await getOrderDetail(intent.orderId, intent.storefrontCode);
      if (!current()) return null;
      if (!result || !result.order || result.order.id !== intent.orderId) throw { code: "MALL_REORDER_ORDER_UNAVAILABLE" };
      // Use fresh raw quantities, never the detail display's legacy fallback of 1.
      return prepareRepeatPurchaseItems(result.order.items);
    };
    try {
      const me = await getMallMe(intent.storefrontCode);
      if (!current()) return;
      const customerId = repeatPurchaseCustomer(me);
      if (!customerId) throw { code: "MALL_REORDER_NOT_ALLOWED" };
      const items = await readItems();
      if (!current() || !items) return;
      const manifest = repeatPurchaseManifest(items);
      wx.showModal({
        title: "加入购物车",
        content: `将原订单的 ${items.length} 个商品规格加入当前购物车，已有同规格商品数量会合并。此操作不会直接下单，价格、库存和优惠以购物车当前结算为准。`,
        confirmText: "加入",
        success: async (answer) => {
          if (!current() || intent.confirmed) return;
          if (!answer.confirm) return finish();
          intent.confirmed = true;
          try {
            const latest = await getMallMe(intent.storefrontCode);
            if (!current()) return;
            const latestCustomerId = repeatPurchaseCustomer(latest);
            if (!latestCustomerId) throw { code: "MALL_REORDER_NOT_ALLOWED" };
            if (latestCustomerId !== customerId) throw { code: "MALL_REORDER_CUSTOMER_CHANGED" };
            const latestItems = await readItems();
            if (!current() || !latestItems) return;
            if (repeatPurchaseManifest(latestItems) !== manifest) throw { code: "MALL_REORDER_ORDER_CHANGED" };
            appendRepeatPurchaseItems(latestItems, intent.storefrontCode);
            this._repeatIntent = null;
            this.setData({ reordering: false, reorderAdded: true, reorderError: "" });
            this.openRepeatPurchaseCart();
          } catch (error) { finish(error); }
        },
        fail: () => finish({}),
      });
    } catch (error) { finish(error); }
  },
});
