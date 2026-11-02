const { assertCartLinesHaveProductUnit, clearCart, getCartItems, getCartLineKey, hasValidProductUnitId, MISSING_PRODUCT_UNIT_MESSAGE } = require("../../utils/cart");
const { assertOrderItemsHaveProductUnit, getAddresses, getHome, getMallMe, getOrderByClientRequestId, getSafeMallErrorMessage, quoteMallCart, submitMallOrder, request } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
const subscriptions = require("../../utils/subscriptions");

function money(value) {
  if (value === null || value === undefined || value === "") return "暂无金额";
  const amount = Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : "暂无金额";
}

function maskName(value) {
  const text = String(value || "").trim();
  return text ? `${text.slice(0, 1)}${"*".repeat(Math.min(2, Math.max(1, text.length - 1)))}` : "客户联系人";
}

function maskPhone(value) {
  const text = String(value || "").trim();
  if (text.length < 7) return text ? `${text.slice(0, 2)}***` : "电话已保护";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function publicAddress(address) {
  const safe = Object.assign({}, address);
  safe.recipientNameMasked = maskName(safe.recipientName);
  safe.phoneMasked = maskPhone(safe.phone);
  delete safe.recipientName;
  delete safe.phone;
  return safe;
}

function quoteFingerprint(quote) {
  const lines = (Array.isArray(quote && quote.lines) ? quote.lines : [])
    .map((line) => [
      String(line.productId || ""),
      String(line.productUnitId || ""),
      String(line.quantity || ""),
      String(line.priceStatus || ""),
      String(line.unitPrice == null ? "" : line.unitPrice),
      String(line.amount == null ? "" : line.amount),
      String(line.priceSource || "PRICE_PENDING"),
    ].join(":"))
    .sort();
  return JSON.stringify({
    lines,
    eligibleSubtotal: String((quote && quote.eligibleSubtotal) || ""),
    minimumOrderAmount: String((quote && quote.minimumOrderAmount) || ""),
    isMinimumMet: !!(quote && quote.isMinimumMet),
    requiresConfirmation: !!(quote && quote.requiresConfirmation),
  });
}

function isDemoCartItem(item) {
  const productId = String((item && item.productId) || "");
  return productId.indexOf("demo-") === 0 || !!(item && (item.isFallback || item.isDemo || item.isMock));
}

function enrichItems(items) {
  return (items || []).map((item) => {
    const isDemo = isDemoCartItem(item);
    const hasUnit = hasValidProductUnitId(item);
    const priceVisible = !isDemo && hasUnit && !!item.priceVisible;
    const requiresConfirmation = !!item.requiresConfirmation || !priceVisible;
    const canOrder = !isDemo && hasUnit && item.canOrder !== false && item.canAddToCart !== false;
    return Object.assign({}, item, {
      lineKey: getCartLineKey(item),
      icon: item.icon || "品",
      priceVisible,
      requiresConfirmation,
      canOrder,
      canAddToCart: canOrder,
      isFallback: !!item.isFallback || isDemo,
      isDemo: !!item.isDemo || isDemo,
      isMock: !!item.isMock || isDemo,
      stockText: isDemo ? "当前商品数据不可提交" : (item.stockHint || item.stockText || ""),
      priceText: priceVisible ? `¥${Number(item.displayPrice).toFixed(2)}` : "价格确认中",
      lineAmountText: priceVisible && item.lineAmount ? money(item.lineAmount) : "重新核算中",
      basePriceText: priceVisible && item.baseUnitPrice != null ? money(item.baseUnitPrice) : "",
      campaignDiscountText: priceVisible && Number(item.lineDiscountAmount) > 0 ? money(item.lineDiscountAmount) : "",
      lineRemark: item.lineRemark || "",
      invalidReason: hasUnit ? "" : MISSING_PRODUCT_UNIT_MESSAGE,
    });
  });
}

function createClientRequestId(storefrontCode) {
  const random = Math.random().toString(36).slice(2, 10);
  return `mall-${storefrontCode || "default"}-${Date.now()}-${random}`;
}

const PENDING_ORDER_STORAGE_PREFIX = "qcg.mall.pending-order.v1";

function pendingOrderStorageKey(storefrontCode) {
  return `${PENDING_ORDER_STORAGE_PREFIX}:${String(storefrontCode || "zhenshang")}`;
}

function submitIntentFingerprint(data) {
  const items = (data.items || []).map((item) => ({
    productId: String(item.productId || ""),
    productUnitId: String(item.productUnitId || ""),
    quantity: String(item.quantity == null ? "" : item.quantity),
    lineRemark: String(item.lineRemark || "").trim(),
    shareTokens: item.shareTokens || (item.shareToken ? [item.shareToken] : []),
  })).sort((left, right) => (
    `${left.productId}:${left.productUnitId}`.localeCompare(`${right.productId}:${right.productUnitId}`)
  ));
  return JSON.stringify({
    storefrontCode: String(data.storefrontCode || ""),
    addressId: String(data.selectedAddressId || ""),
    remark: String(data.remark || "").trim(),
    customerCouponId: String(data.selectedCouponId || ""),
    campaignShareToken: String(data.campaignShareToken || ""),
    items,
  });
}

function selectedCouponStorageKey(code) { return `qcg.mall.selected-coupon.v1:${code || "zhenshang"}`; }
function readSelectedCoupon(code) {
  try { const value = wx.getStorageSync(selectedCouponStorageKey(code)); return value && value.id ? value : null; } catch { return null; }
}
function clearSelectedCoupon(code) {
  try { wx.removeStorageSync(selectedCouponStorageKey(code)); } catch {}
}
function readCampaignShareToken(code) { try { return String(wx.getStorageSync(`qcg.mall.campaign-share.v1:${code || "zhenshang"}`) || ""); } catch { return ""; } }

function readPendingOrderIntent(storefrontCode) {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return null;
  try {
    const value = wx.getStorageSync(pendingOrderStorageKey(storefrontCode));
    if (!value || typeof value !== "object") return null;
    const clientRequestId = String(value.clientRequestId || "");
    const fingerprint = String(value.fingerprint || "");
    return /^[A-Za-z0-9._:-]{1,120}$/.test(clientRequestId) && fingerprint
      ? { clientRequestId, fingerprint }
      : null;
  } catch {
    return null;
  }
}

function persistPendingOrderIntent(storefrontCode, intent) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    throw Object.assign(new Error("订单提交准备失败，请重新打开结算页"), { code: "IDEMPOTENCY_STORAGE_FAILED" });
  }
  try {
    wx.setStorageSync(pendingOrderStorageKey(storefrontCode), {
      clientRequestId: intent.clientRequestId,
      fingerprint: intent.fingerprint,
      createdAt: Date.now(),
    });
  } catch {
    throw Object.assign(new Error("订单提交准备失败，请重新打开结算页"), { code: "IDEMPOTENCY_STORAGE_FAILED" });
  }
}

function resolvePendingOrderIntent(data) {
  const fingerprint = submitIntentFingerprint(data);
  const pending = readPendingOrderIntent(data.storefrontCode);
  if (pending && pending.fingerprint === fingerprint) return pending;
  const intent = {
    clientRequestId: createClientRequestId(data.storefrontCode),
    fingerprint,
  };
  persistPendingOrderIntent(data.storefrontCode, intent);
  return intent;
}

function clearPendingOrderIntent(storefrontCode, clientRequestId) {
  const pending = readPendingOrderIntent(storefrontCode);
  if (!pending || pending.clientRequestId !== clientRequestId) return;
  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    try {
      wx.removeStorageSync(pendingOrderStorageKey(storefrontCode));
    } catch {
      // A confirmed order is still safe; stale intent will be reconciled by clientRequestId on the next entry.
    }
  }
}

function shouldOpenBindingStatus(code) {
  return [
    "NEED_LOGIN",
    "NEED_PROFILE",
    "PENDING_REVIEW",
    "BINDING_PENDING_REVIEW",
    "REJECTED",
    "BINDING_NOT_ACTIVE",
    "NOT_BOUND_CUSTOMER",
    "NEED_BIND_CUSTOMER",
    "CUSTOMER_NOT_ACTIVE",
  ].includes(code);
}

Page({
  data: {
    storefrontCode: "zhenshang",
    customerMode: "GUEST",
    customerName: "",
    customerCode: "",
    items: [],
    selectedAddressId: "",
    selectedAddress: null,
    availableAddressCount: 0,
    addressState: "LOADING",
    addressStateText: "正在读取收货地址",
    addressLoading: false,
    addressError: "",
    remark: "",
    selectedCouponId: "",
    selectedCouponName: "",
    couponEnabled: false,
    couponDiscountText: "",
    campaignShareToken: "",
    goodsTotalText: "暂无金额",
    originalTotalText: "暂无金额",
    campaignDiscountTotalText: "暂无金额",
    payTotalText: "暂无金额",
    minimumOrderAmountText: "读取中",
    remainingAmountText: "读取中",
    minimumHint: "正在读取起送金额",
    minimumOrderEnabled: false,
    isMinimumMet: false,
    quoteReady: false,
    quoteLoading: false,
    quoteError: "",
    quoteFingerprint: "",
    quoteNeedsConfirmation: false,
    hasPendingPrice: false,
    pendingPriceLineCount: 0,
    minimumOrderDeferred: false,
    ownerName: "",
    ownerPhone: "",
    submitButtonText: "正在核算起送金额",
    submitting: false,
    clientRequestId: "",
    submitUncertain: false,
    submitUncertainMessage: "",
    submittedOrderId: "",
    submittedOrderNo: "",
    submittedOrderStatus: "",
    submittedOrderStatusText: "",
    idempotentHit: false,
  },

  _hasShownOnce: false,

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    const items = enrichItems(getCartItems(entrance.storefrontCode));
    const selectedCoupon = readSelectedCoupon(entrance.storefrontCode);
    this.setData({
      storefrontCode: entrance.storefrontCode,
      items,
      clientRequestId: "",
      selectedCouponId: selectedCoupon ? selectedCoupon.id : "",
      selectedCouponName: selectedCoupon ? selectedCoupon.name : "",
      campaignShareToken: readCampaignShareToken(entrance.storefrontCode),
    });
    this.loadCouponAvailability().then(() => this.loadCustomerState(items));
  },

  onShow() {
    if (!this._hasShownOnce) {
      this._hasShownOnce = true;
      return;
    }
    if (this.data.submittedOrderId) return;
    const items = enrichItems(getCartItems(this.data.storefrontCode));
    const selectedCoupon = readSelectedCoupon(this.data.storefrontCode);
    this.setData({ items, selectedCouponId: selectedCoupon ? selectedCoupon.id : "", selectedCouponName: selectedCoupon ? selectedCoupon.name : "", campaignShareToken: readCampaignShareToken(this.data.storefrontCode) });
    this.loadCouponAvailability().then(() => this.loadCustomerState(items));
  },

  setCouponAvailability(enabled) {
    // Coupon selection belongs to payment after delivery, regardless of the
    // wallet's visibility or a selection left by an older client.
    const couponEnabled = false;
    if (!couponEnabled) clearSelectedCoupon(this.data.storefrontCode);
    this.setData({
      couponEnabled,
      selectedCouponId: couponEnabled ? this.data.selectedCouponId : "",
      selectedCouponName: couponEnabled ? this.data.selectedCouponName : "",
      couponDiscountText: couponEnabled ? this.data.couponDiscountText : "",
    });
    return couponEnabled;
  },

  loadCouponAvailability() {
    return Promise.resolve(this.setCouponAvailability(false));
  },

  loadCustomerState(items) {
    return getMallMe(this.data.storefrontCode, "CHECKOUT_PAGE")
      .then((result) => {
        const canOrder = result.customerStatus === "APPROVED_BOUND_CUSTOMER"
          && !!(result.priceAccess && result.priceAccess.canOrder);
        this.setData({
          customerMode: canOrder ? "BOUND" : "GUEST",
          customerName: result.customer ? result.customer.name || "" : "",
          customerCode: result.customer ? result.customer.code || "" : "",
        });
        if (canOrder) {
          this.loadAddresses().catch(() => {});
          this.loadQuote(items || this.data.items).catch(() => {});
        } else {
          this.resetProtectedCheckoutState();
        }
        return result;
      })
      .catch(() => {
        this.setData({ customerMode: "GUEST" });
        this.resetProtectedCheckoutState();
        return null;
      });
  },

  resetProtectedCheckoutState() {
    this.setData({
      selectedAddressId: "",
      selectedAddress: null,
      availableAddressCount: 0,
      addressState: "LOCKED",
      addressStateText: "完成登录和门店资料后选择收货地址",
      addressLoading: false,
      addressError: "请先完成登录和门店资料",
      quoteReady: false,
      quoteLoading: false,
      quoteError: "",
      minimumOrderEnabled: false,
      isMinimumMet: false,
      goodsTotalText: "暂无金额",
      originalTotalText: "暂无金额",
      campaignDiscountTotalText: "暂无金额",
      couponDiscountText: "",
      payTotalText: "暂无金额",
      submitButtonText: "登录后提交",
    });
  },

  input(event) {
    const key = event.currentTarget.dataset.key;
    const value = key === "remark" ? String(event.detail.value || "").slice(0, 200) : event.detail.value;
    this.setData({ [key]: value });
  },

  loadAddresses() {
    this.setData({ addressLoading: true, addressError: "" });
    return getAddresses(this.data.storefrontCode)
      .then((result) => {
        const addresses = (result.addresses || []).map(publicAddress);
        const approved = addresses.filter((item) => (
          item.status === "APPROVED"
          && item.canCheckout === true
          && String(item.id || "").trim()
          && String(item.fullAddress || "").trim()
        ));
        const selected = approved.find((item) => item.id === this.data.selectedAddressId)
          || approved.find((item) => item.isDefault)
          || approved[0]
          || null;
        const pendingCount = addresses.filter((item) => item.status === "PENDING").length;
        const rejectedCount = addresses.filter((item) => item.status === "REJECTED").length;
        const addressState = selected ? "READY" : pendingCount > 0 ? "ONLY_PENDING" : rejectedCount > 0 ? "ALL_REJECTED" : "EMPTY";
        const addressStateText = selected
          ? "已选择收货地址"
          : addressState === "ONLY_PENDING"
            ? "地址正在确认中，暂不能下单"
            : addressState === "ALL_REJECTED" ? "现有地址未通过，请重新提交" : "暂无可用收货地址";
        this.setData({
          selectedAddressId: selected ? selected.id : "",
          selectedAddress: selected,
          availableAddressCount: approved.length,
          addressState,
          addressStateText,
          addressLoading: false,
          addressError: selected ? "" : addressStateText,
        });
        return addresses;
      })
      .catch((error) => {
        const addressError = getSafeMallErrorMessage(error, "收货地址读取失败");
        this.setData({
          selectedAddressId: "",
          selectedAddress: null,
          availableAddressCount: 0,
          addressState: "ERROR",
          addressStateText: "地址校验失败，请重试",
          addressLoading: false,
          addressError,
        });
        throw error;
      });
  },

  loadQuote(items) {
    const cartItems = items || this.data.items;
    this.setData({ originalTotalText: "暂无金额", campaignDiscountTotalText: "暂无金额", couponDiscountText: "" });
    if (!assertCartLinesHaveProductUnit(cartItems) || !assertOrderItemsHaveProductUnit(cartItems)) {
      this.setData({
        quoteReady: false,
        quoteLoading: false,
        quoteError: MISSING_PRODUCT_UNIT_MESSAGE,
        submitButtonText: "请重新选择规格",
        isMinimumMet: false,
      });
      return Promise.reject(Object.assign(new Error(MISSING_PRODUCT_UNIT_MESSAGE), { code: "INVALID_PRODUCT" }));
    }
    this.setData({
      quoteLoading: true,
      quoteReady: false,
      quoteError: "",
      minimumOrderEnabled: false,
      submitButtonText: "正在核算起送金额",
    });
    return quoteMallCart(this.data.storefrontCode, cartItems)
      .then((result) => {
        const quote = result.quote || {};
        const nextQuoteFingerprint = quoteFingerprint(quote);
        const quoteChanged = !!this.data.quoteFingerprint && this.data.quoteFingerprint !== nextQuoteFingerprint;
        const quoteNeedsConfirmation = quoteChanged || !!this.data.quoteNeedsConfirmation;
        const localByKey = new Map(cartItems.map((item) => [getCartLineKey(item), item]));
        const nextItems = (quote.lines || []).map((line) => Object.assign(
          {},
          localByKey.get(getCartLineKey(line)) || {},
          line,
          {
            campaignName: line.campaignName || "",
            quoteToken: line.quoteToken || undefined,
            baseUnitPrice: line.baseUnitPrice == null ? null : line.baseUnitPrice,
            lineDiscountAmount: line.lineDiscountAmount == null ? null : line.lineDiscountAmount,
            quantity: Number(line.quantity || 0),
            productUnitId: String(line.productUnitId || ""),
            priceVisible: !!line.priceVisible,
            requiresConfirmation: !!line.requiresConfirmation,
            canOrder: !!line.productUnitId,
            canAddToCart: !!line.productUnitId,
          },
        ));
        if (!assertCartLinesHaveProductUnit(nextItems) || nextItems.length !== cartItems.length) {
          this.setData({
            items: enrichItems(cartItems),
            quoteReady: false,
            quoteLoading: false,
            quoteError: "存在失效规格，请返回购物车重新选择",
            submitButtonText: "暂不能提交",
            isMinimumMet: false,
          });
          throw Object.assign(new Error("存在失效规格，请返回购物车重新选择"), { code: "INVALID_PRODUCT" });
        }
        const minimumOrderEnabled = Number(quote.minimumOrderAmount || 0) > 0;
        this.setData({
          items: enrichItems(nextItems),
          originalTotalText: money(quote.originalTotal),
          campaignDiscountTotalText: money(quote.campaignDiscountTotal),
          goodsTotalText: money(quote.confirmedSubtotal || quote.eligibleSubtotal),
          payTotalText: quote.requiresConfirmation ? "最终金额确认中" : money(quote.finalTotal),
          couponDiscountText: quote.coupon ? money(quote.coupon.discountAmount) : "",
          minimumOrderAmountText: money(quote.minimumOrderAmount),
          remainingAmountText: money(quote.remainingAmount),
          minimumHint: !minimumOrderEnabled
            ? "当前未启用最低起送门槛"
            : quote.requiresConfirmation
            ? "部分商品价格确认中，请稍后刷新"
            : quote.isMinimumMet ? "已满足当前起送条件" : `还差 ${money(quote.remainingAmount)} 即可配送`,
          minimumOrderEnabled,
          isMinimumMet: !!quote.isMinimumMet,
          hasPendingPrice: !!quote.requiresConfirmation,
          pendingPriceLineCount: Number(quote.pendingPriceLineCount || 0),
          minimumOrderDeferred: false,
          quoteReady: true,
          quoteLoading: false,
          quoteError: "",
          quoteFingerprint: nextQuoteFingerprint,
          quoteNeedsConfirmation,
          ownerName: quote.ownerName || "全渠供客服",
          ownerPhone: quote.ownerPhone || "",
          submitButtonText: quote.requiresConfirmation
            ? "商品价格确认中，暂不能提交"
            : quote.isMinimumMet ? "提交订单" : `还差 ${money(quote.remainingAmount)} 起送`,
        });
        return Object.assign({}, quote, { quoteChanged });
      })
      .catch((error) => {
        this.setData({
          quoteReady: false,
          quoteLoading: false,
          quoteError: getSafeMallErrorMessage(error, "商品金额计算失败，请返回购物车重试"),
          submitButtonText: "暂不能提交",
        });
        throw error;
      });
  },

  requote() {
    if (this.data.quoteLoading || this.data.submitting || this.data.submittedOrderId) return;
    this.loadQuote(this.data.items)
      .then((quote) => {
        if (!quote.quoteChanged) {
          wx.showToast({ title: "当前价格未变化", icon: "none" });
          return;
        }
        wx.showModal({
          title: "价格已变化",
          content: `最新已确认金额为 ${this.data.goodsTotalText}，请确认后再提交订单。`,
          confirmText: "确认总额",
          success: (result) => {
            if (result.confirm) this.confirmLatestQuote();
          },
        });
      })
      .catch(() => {});
  },

  confirmLatestQuote() {
    if (this.data.hasPendingPrice) {
      wx.showToast({ title: "部分商品价格确认中，暂不能提交", icon: "none" });
      return;
    }
    this.setData({
      quoteNeedsConfirmation: false,
      submitButtonText: this.data.isMinimumMet ? "提交订单" : this.data.submitButtonText,
    });
    wx.showToast({ title: "已确认最新总额", icon: "none" });
  },

  applyMinimumError(error) {
    this.setData({
      goodsTotalText: money(error.eligibleSubtotal),
      payTotalText: money(error.eligibleSubtotal),
      minimumOrderAmountText: money(error.minimumOrderAmount),
      remainingAmountText: money(error.remainingAmount),
      minimumHint: `按最新价格还差 ${money(error.remainingAmount)} 即可配送`,
      isMinimumMet: false,
      quoteReady: true,
      quoteError: "",
      ownerName: error.ownerName || this.data.ownerName || "全渠供客服",
      ownerPhone: error.ownerPhone || this.data.ownerPhone || "",
      submitButtonText: `还差 ${money(error.remainingAmount)} 起送`,
    });
    wx.showModal({
      title: "起送金额有变化",
      content: `按最新价格还差 ${money(error.remainingAmount)}，请返回购物车补充商品。`,
      showCancel: false,
      confirmText: "返回凑单",
      success: () => this.goCart(),
    });
  },

  callOwner() {
    if (!this.data.ownerPhone) {
      wx.showToast({ title: "当前暂无联系电话，请联系公司客服", icon: "none" });
      return;
    }
    wx.makePhoneCall({ phoneNumber: this.data.ownerPhone });
  },

  chooseAddress() {
    wx.navigateTo({
      url: `/pages/address/list?mode=select&storefrontCode=${this.data.storefrontCode}`,
      success: (navigation) => {
        navigation.eventChannel.on("addressSelected", (address) => {
          if (!address || address.status !== "APPROVED" || address.canCheckout !== true) return;
          this.setData({
            selectedAddressId: address.id,
            selectedAddress: publicAddress(address),
            addressState: "READY",
            addressStateText: "已选择收货地址",
            addressError: "",
          });
        });
      },
    });
  },

  applyAddress() {
    wx.navigateTo({ url: `/pages/address/edit?storefrontCode=${this.data.storefrontCode}` });
  },

  subscribeOrderReminders() { subscriptions.requestFromTap(this); },

  applySubmittedOrder(result, clientRequestId, recovered) {
    const order = result.order || result;
    const submittedOrderId = String(order.id || "");
    if (!submittedOrderId) return false;
    const submittedOrderNo = String(order.billNo || order.orderNo || order.id || "");
    const submittedOrderStatus = String(order.status || "SUBMITTED");
    clearCart(this.data.storefrontCode);
    clearPendingOrderIntent(this.data.storefrontCode, clientRequestId);
    this.setData({
      submittedOrderId,
      submittedOrderNo,
      submittedOrderStatus,
      submittedOrderStatusText: submittedOrderStatus === "SUBMITTED" ? "已提交" : "订单已提交",
      idempotentHit: !!(recovered || result.idempotentHit || order.idempotentHit),
      submitUncertain: false,
      submitUncertainMessage: "",
    });
    wx.showToast({ title: recovered ? "订单已确认" : "订单已提交", icon: "success" });
    subscriptions.prepare(this);
    return true;
  },

  recoverSubmittedOrder(clientRequestId) {
    return getOrderByClientRequestId(this.data.storefrontCode, clientRequestId).then((result) => {
      const order = Array.isArray(result.items) ? result.items[0] : null;
      if (!order) return null;
      this.applySubmittedOrder({ order, idempotentHit: true }, clientRequestId, true);
      return order;
    });
  },

  showSubmitUncertain() {
    const message = "订单结果正在确认，请点击“查询提交结果”；请勿重复下单。";
    this.setData({
      submitUncertain: true,
      submitUncertainMessage: message,
      submitButtonText: "查询提交结果",
    });
    wx.showModal({
      title: "正在确认订单结果",
      content: message,
      showCancel: false,
      confirmText: "我知道了",
    });
  },

  submit() {
    if (this.data.submitting || this.data.submittedOrderId) return;
    if (this.data.customerMode !== "BOUND") {
      wx.showModal({
        title: "请完善门店资料",
        content: "完成登录和门店资料后即可提交订单。",
        confirmText: "查看资料",
        success: (result) => {
          if (result.confirm) wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
        },
      });
      return;
    }
    if (!this.data.selectedAddressId) {
      wx.showToast({ title: this.data.addressError || "暂无可用收货地址，请先新增地址", icon: "none" });
      return;
    }
    if (!this.data.items.length) {
      wx.showToast({ title: "购物车为空", icon: "none" });
      return;
    }
    if (!assertCartLinesHaveProductUnit(this.data.items) || !assertOrderItemsHaveProductUnit(this.data.items)) {
      wx.showToast({ title: MISSING_PRODUCT_UNIT_MESSAGE, icon: "none" });
      return;
    }
    if (this.data.items.some(isDemoCartItem)) {
      wx.showToast({ title: "当前商品数据不可提交，请返回商城重新选择商品", icon: "none" });
      return;
    }
    if (this.data.items.some((item) => !item.canOrder || !item.productUnitId)) {
      wx.showToast({ title: "存在暂不可提交商品，请返回商城重新选择", icon: "none" });
      return;
    }
    if (!this.data.quoteReady) {
      wx.showToast({ title: this.data.quoteError || "正在计算商品金额，请稍后重试", icon: "none" });
      return;
    }
    if (this.data.hasPendingPrice) {
      wx.showToast({ title: "部分商品价格确认中，请稍后刷新", icon: "none" });
      return;
    }
    if (this.data.quoteNeedsConfirmation) {
      wx.showToast({ title: "价格已变化，请先确认最新总额", icon: "none" });
      return;
    }
    if (!this.data.isMinimumMet) {
      wx.showToast({ title: this.data.minimumHint, icon: "none" });
      return;
    }
    let intent;
    try {
      intent = resolvePendingOrderIntent(this.data);
    } catch (error) {
      wx.showToast({ title: getSafeMallErrorMessage(error, "订单提交准备失败，请重新打开结算页"), icon: "none" });
      return;
    }
    const clientRequestId = intent.clientRequestId;
    let postAttempted = false;
    this.setData({ submitting: true, clientRequestId, submitUncertain: false, submitUncertainMessage: "" });
    this.recoverSubmittedOrder(clientRequestId)
      .catch((error) => {
        if (error && error.isNetworkError) return null;
        throw error;
      })
      .then((recoveredOrder) => {
        if (recoveredOrder) return { recovered: true };
        return this.loadQuote(this.data.items).then(async (quote) => {
          if (quote.requiresConfirmation) {
            throw Object.assign(new Error("部分商品价格确认中，请稍后刷新"), { code: "MALL_PRICE_PENDING" });
          }
          if (quote.quoteChanged || this.data.quoteNeedsConfirmation) {
            throw Object.assign(new Error("价格已变化，请先确认最新总额"), { code: "MALL_QUOTE_CHANGED" });
          }
          if (!quote.isMinimumMet) {
            this.applyMinimumError(quote);
            throw new Error("MALL_MINIMUM_ORDER_NOT_MET_PRECHECK");
          }
          const deliveryResponse = await request({ path: "/api/mall/fulfillment", storefrontCode: this.data.storefrontCode });
          const deliveryEstimate = deliveryResponse.data && deliveryResponse.data.estimate;
          const deliveryConfirmed = await new Promise((resolve) => wx.showModal({ title: "确认配送安排", content: deliveryEstimate ? `${deliveryEstimate.label}（${deliveryEstimate.date}），是否提交订单？` : "配送日期待商家安排，是否提交订单？", confirmText: "提交订单", success: result => resolve(result.confirm), fail: () => resolve(false) }));
          if (!deliveryConfirmed) return { recovered: true };
          postAttempted = true;
          return submitMallOrder(this.data.storefrontCode, {
            clientRequestId,
            addressId: this.data.selectedAddressId,
            sourceScene: "WECHAT_MINIPROGRAM",
            items: this.data.items.map((item) => ({
              productId: String(item.productId),
              productUnitId: String(item.productUnitId),
              quantity: item.quantity,
              lineRemark: item.lineRemark || "",
              quoteToken: item.quoteToken || undefined,
              shareTokens: item.shareTokens || (item.shareToken ? [item.shareToken] : []),
            })),
            remark: this.data.remark,
            campaignShareToken: this.data.campaignShareToken,
          });
        });
      })
      .then((quote) => {
        if (quote && quote.recovered) return;
        this.applySubmittedOrder(quote, clientRequestId, false);
      })
      .catch((error) => {
        const uncertain = postAttempted && (
          !!(error && error.isNetworkError)
          || error.code === "NETWORK_TIMEOUT"
          || Number(error.statusCode || 0) >= 500
        );
        if (uncertain) {
          return this.recoverSubmittedOrder(clientRequestId)
            .then((order) => {
              if (!order) this.showSubmitUncertain();
            })
            .catch(() => this.showSubmitUncertain());
        }
        if (error.message === "MALL_MINIMUM_ORDER_NOT_MET_PRECHECK") return;
        if (error.code === "MALL_MINIMUM_ORDER_NOT_MET") {
          this.applyMinimumError(error);
          return;
        }
        if (error.code === "MALL_QUOTE_CHANGED") {
          wx.showModal({
            title: "价格已变化",
            content: `最新已确认金额为 ${this.data.goodsTotalText}，请确认后再次提交。`,
            confirmText: "确认总额",
            success: (result) => {
              if (result.confirm) this.confirmLatestQuote();
            },
          });
          return;
        }
        const map = {
          NEED_LOGIN: "请先登录",
          NEED_PROFILE: "请完善门店资料",
          PENDING_REVIEW: "门店资料正在确认中",
          BINDING_PENDING_REVIEW: "门店资料正在确认中",
          REJECTED: "门店资料需要补充，请联系业务员",
          BINDING_NOT_ACTIVE: "当前账号暂不可用，请联系业务员",
          NOT_BOUND_CUSTOMER: "账号未绑定客户资料，请联系业务员或文员",
          NEED_BIND_CUSTOMER: "请先完善门店资料",
          CUSTOMER_NOT_ACTIVE: "当前账号暂不可下单，请联系业务员或客服",
          MALL_PRICE_UNAVAILABLE: "当前规格暂无有效售价，请联系业务员",
          MALL_PRICE_PENDING: "部分商品价格确认中，请稍后刷新",
          MALL_QUOTE_CHANGED: "价格已变化，请先确认最新总额",
          INVALID_PRODUCT: "当前商品或规格暂不可销售，请返回商城重新选择",
          INSUFFICIENT_STOCK: "当前商品库存不足，请调整数量或重新选择商品",
          INVALID_QUANTITY: "商品数量不符合销售规则，请调整数量后重试",
          MISSING_CLIENT_REQUEST_ID: "订单提交准备失败，请重新打开结算页",
          IDEMPOTENCY_CONFLICT: "本次下单内容已变化，请返回购物车确认后重新提交",
          IDEMPOTENCY_STORAGE_FAILED: "订单提交准备失败，请重新打开结算页",
          ADDRESS_REQUIRED: "请选择有效收货地址后再提交订单",
          ADDRESS_NOT_FOUND: "所选收货地址已失效，请重新选择",
          ADDRESS_NOT_EDITABLE: "所选地址暂不可用，请重新选择",
          INVALID_ADDRESS_INPUT: "收货地址信息不完整，请重新编辑",
          STOREFRONT_DISABLED: "商城入口不可用，请重新进入",
        };
        const message = getSafeMallErrorMessage(error, map[error.code] || "订单提交失败，请稍后重试");
        if (shouldOpenBindingStatus(error.code)) {
          wx.showModal({
            title: "请完善门店资料",
            content: message,
            confirmText: "查看资料",
            success: (result) => {
              if (result.confirm) wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
            },
          });
          return;
        }
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => this.setData({ submitting: false }));
  },

  goCart() {
    wx.navigateBack({ delta: 1 });
  },

  goCoupons() {
    return;
  },

  goSubmittedOrder() {
    if (!this.data.submittedOrderId) return;
    wx.navigateTo({
      url: `/pages/orders/detail?id=${encodeURIComponent(this.data.submittedOrderId)}&storefrontCode=${this.data.storefrontCode}`,
    });
  },
});
