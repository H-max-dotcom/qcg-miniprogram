const {
  addCartItem,
  assertCartLinesHaveProductUnit,
  clearCart,
  getCartItems,
  getCartLineKey,
  hasValidProductUnitId,
  MISSING_PRODUCT_UNIT_MESSAGE,
  saveCartItems,
  updateCartQuantity,
  updateCartRemark,
} = require("../../utils/cart");
const {
  getAddresses,
  getMallMe,
  getProductDetail,
  getSafeMallErrorMessage,
  OFF_SHELF_CART_MESSAGE,
  quoteMallCart,
  resolveMallAssetUrl,
} = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

function money(value) {
  if (value === null || value === undefined || value === "") return "暂无金额";
  const amount = Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : "暂无金额";
}

function cartInputKey(items) {
  return JSON.stringify((items || []).map((item) => [
    getCartLineKey(item), String(item.quantity), String(item.lineRemark || ""),
  ]));
}

function isDemoCartItem(item) {
  const productId = String((item && item.productId) || "");
  return productId.indexOf("demo-") === 0 || !!(item && (item.isFallback || item.isDemo || item.isMock));
}

function quantityRule(item) {
  const allowDecimalQuantity = !!(item && item.saleMode !== "FIXED_WEIGHT_SPEC" && item.allowDecimalQuantity);
  const minimum = Number((item && (item.minOrderQty || item.mallMinOrderQty)) || 1);
  const safeMinimum = Number.isFinite(minimum) && minimum > 0 ? minimum : 1;
  return {
    allowDecimalQuantity,
    quantityScale: allowDecimalQuantity ? 4 : 0,
    minimum: item && item.saleMode === "FIXED_WEIGHT_SPEC" ? 1 : allowDecimalQuantity ? null : safeMinimum,
    step: 1,
  };
}

function validQuantity(value, item) {
  const quantity = Number(value);
  const rule = quantityRule(item);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!rule.allowDecimalQuantity && !Number.isInteger(quantity)) return null;
  if (rule.minimum != null && quantity < rule.minimum) return null;
  return rule.allowDecimalQuantity ? Number(quantity.toFixed(4)) : quantity;
}

function alignQuantity(value, item) {
  const quantity = Number(value);
  const rule = quantityRule(item);
  if (!Number.isFinite(quantity) || quantity <= 0) return rule.minimum ?? 1;
  if (rule.allowDecimalQuantity) return Number(quantity.toFixed(4));
  return Math.max(Math.ceil(quantity), rule.minimum ?? 1);
}

function quantityInputState(value, item) {
  const text = String(value == null ? "" : value).trim();
  const rule = quantityRule(item);
  const pattern = rule.allowDecimalQuantity
    ? new RegExp(`^\\d*(?:\\.\\d{0,${rule.quantityScale}})?$`)
    : /^\d*$/;
  if (!pattern.test(text)) return { kind: "INVALID_FORMAT", text, rule };
  if (!text || (rule.allowDecimalQuantity && /\.$/.test(text))) {
    return { kind: "EDITING", text, rule };
  }
  const quantity = validQuantity(text, item);
  if (quantity === null) return { kind: "INVALID_RULE", text, rule };
  return { kind: "VALID", text, rule, quantity };
}

function specLabel(option) {
  const spec = String((option && (option.specName || option.unitSpecName)) || "").trim();
  const unit = String((option && option.unitName) || "").trim();
  if (spec && unit && spec !== unit) return `${spec} / ${unit}`;
  return spec || unit || "未命名规格";
}

function enrichItems(items) {
  return (items || []).map((item) => {
    const isDemo = isDemoCartItem(item);
    const hasUnit = hasValidProductUnitId(item);
    const priceVisible = !isDemo && hasUnit && !!item.priceVisible;
    const requiresConfirmation = !!item.requiresConfirmation || !priceVisible;
    const invalidReason = !hasUnit
      ? MISSING_PRODUCT_UNIT_MESSAGE
      : (item.invalidReason || "");
    const canOrder = !isDemo
      && hasUnit
      && !invalidReason
      && item.canOrder !== false
      && item.canAddToCart !== false;
    const rule = quantityRule(item);
    const minOrderQty = rule.minimum;
    return Object.assign({}, item, {
      lineKey: getCartLineKey(item),
      icon: item.icon || "品",
      priceVisible,
      requiresConfirmation,
      canOrder,
      canAddToCart: canOrder,
      invalidReason,
      isFallback: !!item.isFallback || isDemo,
      isDemo: !!item.isDemo || isDemo,
      isMock: !!item.isMock || isDemo,
      stockText: isDemo ? "当前商品数据不可用" : (item.stockHint || item.stockText || ""),
      minOrderQty,
      qtyStep: rule.step,
      quantityScale: rule.quantityScale,
      quantityInputType: rule.allowDecimalQuantity ? "digit" : "number",
      quantityInput: String(item.quantity == null ? "" : item.quantity),
      minOrderText: rule.allowDecimalQuantity ? "可输入任意正数小数" : (item.minOrderText || `起订量 ${minOrderQty}`),
      priceText: priceVisible ? `¥${Number(item.displayPrice || 0).toFixed(2)}` : "价格确认中",
      lineAmountText: priceVisible && item.lineAmount ? money(item.lineAmount) : "重新核算中",
      basePriceText: priceVisible && item.baseUnitPrice != null ? money(item.baseUnitPrice) : "",
      campaignDiscountText: priceVisible && Number(item.lineDiscountAmount) > 0 ? money(item.lineDiscountAmount) : "",
      tags: !hasUnit
        ? ["规格缺失", "不可结算"]
        : (isDemo
          ? ["商品数据不可用", "不可下单"]
          : (item.offShelf ? ["已下架", "不可结算"] : invalidReason
            ? ["待确认", "不可结算"]
            : (priceVisible ? ["价格已确认", "可结算"] : ["价格确认中", "暂不可结算"]))),
      lineRemark: item.lineRemark || "",
      remarkExpanded: !!String(item.lineRemark || "").trim(),
      quantityError: "",
    });
  });
}

Page({
  data: {
    storefrontCode: "zhenshang",
    customerMode: "GUEST",
    items: [],
    totalCount: 0,
    totalText: "暂无金额",
    originalTotalText: "暂无金额",
    campaignDiscountTotalText: "暂无金额",
    minimumOrderAmountText: "读取中",
    remainingAmountText: "读取中",
    minimumProgress: 0,
    minimumOrderEnabled: false,
    isMinimumMet: false,
    quoteReady: false,
    quoteLoading: false,
    quoteError: "",
    hasOffShelfItems: false,
    hasPendingPrice: false,
    pendingPriceLineCount: 0,
    recommendations: [],
    ownerName: "",
    ownerPhone: "",
    primaryActionText: "正在核算起送金额",
    navigatingToCheckout: false,
    defaultAddressId: "",
    defaultAddressReady: false,
    defaultAddressLoading: false,
    defaultAddressError: "",
    specPickerOpen: false,
    specPickerLineKey: "",
    specPickerOptions: [],
    specSwitchingKey: "",
  },

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({ storefrontCode: entrance.storefrontCode });
  },

  onShow() {
    this._inactive = false;
    this.resetCheckoutNavigationLock();
    return this.loadCustomerState();
  },

  onHide() {
    this.flushQuantityChanges();
    this.suspendReads();
    this.resetCheckoutNavigationLock();
  },

  onUnload() {
    this.flushQuantityChanges();
    this.suspendReads();
    this.resetCheckoutNavigationLock();
  },

  suspendReads() {
    this._inactive = true;
    this.customerRequestId = Number(this.customerRequestId || 0) + 1;
    this.specRequestId = Number(this.specRequestId || 0) + 1;
    this.resetQuoteState();
    this.resetCheckoutAddress();
    this.closeSpecPicker();
    this.setData({ specSwitchingKey: "" });
  },

  resetQuoteState() {
    this.quoteRequestId = Number(this.quoteRequestId || 0) + 1;
    this.setData({
      quoteReady: false,
      quoteLoading: false,
      quoteError: "",
      hasOffShelfItems: false,
      totalText: "暂无金额",
      originalTotalText: "暂无金额",
      campaignDiscountTotalText: "暂无金额",
      minimumOrderAmountText: "-",
      remainingAmountText: "-",
      minimumProgress: 0,
      minimumOrderEnabled: false,
      isMinimumMet: false,
      hasPendingPrice: false,
      pendingPriceLineCount: 0,
      recommendations: [],
      ownerName: "",
      ownerPhone: "",
    });
  },

  resetCheckoutNavigationLock() {
    if (this.data.navigatingToCheckout) this.setData({ navigatingToCheckout: false });
  },

  beginCheckoutNavigation() {
    if (this.data.navigatingToCheckout) return false;
    this.setData({ navigatingToCheckout: true });
    return true;
  },

  blockCheckoutNavigation(message) {
    this.resetCheckoutNavigationLock();
    wx.showToast({ title: message, icon: "none" });
  },

  loadCustomerState() {
    if (this._inactive) return Promise.resolve(false);
    const requestId = Number(this.customerRequestId || 0) + 1;
    this.customerRequestId = requestId;
    const storefrontCode = this.data.storefrontCode;
    const isCurrent = () => !this._inactive && this.customerRequestId === requestId
      && this.data.storefrontCode === storefrontCode;
    this.setData({ customerMode: "GUEST" });
    this.specRequestId = Number(this.specRequestId || 0) + 1;
    this.closeSpecPicker();
    this.setData({ specSwitchingKey: "" });
    this.resetCheckoutAddress();
    this.refresh();
    return getMallMe(storefrontCode, "CART_PAGE")
      .then((result) => {
        if (!isCurrent()) return false;
        const canOrder = result.customerStatus === "APPROVED_BOUND_CUSTOMER"
          && !!(result.priceAccess && result.priceAccess.canOrder);
        this.setData({ customerMode: canOrder ? "BOUND" : "GUEST" });
        if (canOrder) {
          this.loadCheckoutAddress();
          this.refresh();
        } else {
          this.resetCheckoutAddress();
          this.refresh();
        }
        return canOrder;
      })
      .catch(() => {
        if (!isCurrent()) return false;
        this.setData({ customerMode: "GUEST" });
        this.resetCheckoutAddress();
        return false;
      });
  },

  resetCheckoutAddress() {
    this.addressRequestId = Number(this.addressRequestId || 0) + 1;
    this.setData({
      defaultAddressId: "",
      defaultAddressReady: false,
      defaultAddressLoading: false,
      defaultAddressError: "",
    });
  },

  loadCheckoutAddress() {
    if (this._inactive) return Promise.resolve(null);
    if (this.data.customerMode !== "BOUND") {
      this.resetCheckoutAddress();
      return Promise.resolve(null);
    }
    const requestId = Number(this.addressRequestId || 0) + 1;
    this.addressRequestId = requestId;
    const storefrontCode = this.data.storefrontCode;
    const customerRequestId = this.customerRequestId;
    const isCurrent = () => !this._inactive && this.addressRequestId === requestId
      && this.customerRequestId === customerRequestId && this.data.customerMode === "BOUND"
      && this.data.storefrontCode === storefrontCode;
    this.setData({
      defaultAddressId: "",
      defaultAddressReady: false,
      defaultAddressLoading: true,
      defaultAddressError: "",
    });
    return getAddresses(storefrontCode)
      .then((result) => {
        if (!isCurrent()) return null;
        const addresses = Array.isArray(result.addresses) ? result.addresses : [];
        const erpDefault = addresses.find((address) => (
          address
          && address.addressSource === "ERP_DEFAULT"
          && address.isReadonly === true
          && String(address.id || "").trim()
          && String(address.fullAddress || "").trim()
        ));
        this.setData({
          defaultAddressId: erpDefault ? String(erpDefault.id) : "",
          defaultAddressReady: !!erpDefault,
          defaultAddressLoading: false,
          defaultAddressError: erpDefault ? "" : "暂无可用收货地址",
        });
        return erpDefault || null;
      })
      .catch((error) => {
        if (!isCurrent()) return null;
        this.setData({
          defaultAddressId: "",
          defaultAddressReady: false,
          defaultAddressLoading: false,
          defaultAddressError: getSafeMallErrorMessage(error, "收货地址读取失败，请稍后重试"),
        });
        return null;
      });
  },

  refresh() {
    if (this._inactive) return Promise.resolve(null);
    this.flushQuantityChanges();
    this.resetQuoteState();
    const rawItems = getCartItems(this.data.storefrontCode);
    const items = enrichItems(rawItems.map((item) => Object.assign({}, item, {
      priceVisible: false, lineAmount: null,
    })));
    const totalCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const hasInvalidUnit = items.some((item) => !hasValidProductUnitId(item) || item.invalidReason);
    this.setData({
      items,
      totalCount,
      quoteReady: false,
      quoteLoading: items.length > 0 && !hasInvalidUnit,
      quoteError: hasInvalidUnit ? MISSING_PRODUCT_UNIT_MESSAGE : "",
      minimumOrderEnabled: false,
      primaryActionText: hasInvalidUnit
        ? "请重新选择规格"
        : (items.length ? "正在核算起送金额" : "请先选择商品"),
    });
    if (!items.length) {
      this.setData({
        totalText: "暂无金额",
        minimumOrderAmountText: "-",
        remainingAmountText: "-",
        minimumProgress: 0,
        minimumOrderEnabled: false,
        isMinimumMet: false,
        quoteLoading: false,
        recommendations: [],
      });
      return;
    }
    if (hasInvalidUnit) {
      this.setData({
        quoteLoading: false,
        quoteReady: false,
        isMinimumMet: false,
        recommendations: [],
      });
      return;
    }
    if (this.data.customerMode !== "BOUND") {
      this.setData({
        totalText: "暂无金额",
        minimumOrderAmountText: "-",
        remainingAmountText: "-",
        minimumProgress: 0,
        minimumOrderEnabled: false,
        isMinimumMet: false,
        quoteLoading: false,
        quoteReady: false,
        quoteError: "",
        recommendations: [],
        primaryActionText: "登录后提交",
      });
      return;
    }
    const requestId = this.quoteRequestId;
    const storefrontCode = this.data.storefrontCode;
    const customerRequestId = this.customerRequestId;
    const inputKey = cartInputKey(items);
    const isCurrent = () => !this._inactive && this.quoteRequestId === requestId
      && this.customerRequestId === customerRequestId && this.data.customerMode === "BOUND"
      && this.data.storefrontCode === storefrontCode;
    return quoteMallCart(storefrontCode, items)
      .then((result) => {
        if (!isCurrent()) return;
        if (cartInputKey(getCartItems(storefrontCode)) !== inputKey) return this.refresh();
        const quote = result.quote || {};
        const localByKey = new Map(getCartItems(this.data.storefrontCode).map((item) => [getCartLineKey(item), item]));
        const nextItems = (quote.lines || []).map((line) => {
          const key = getCartLineKey(line);
          const local = localByKey.get(key) || {};
          if (!hasValidProductUnitId(line)) {
            return Object.assign({}, local, line, {
              productUnitId: "",
              invalidReason: MISSING_PRODUCT_UNIT_MESSAGE,
              canOrder: false,
              canAddToCart: false,
              priceVisible: false,
            });
          }
          return Object.assign({}, local, line, {
            saleMode: line.saleMode || "STANDARD",
            baseUnit: line.baseUnit || "",
            unitConversionRate: line.unitConversionRate == null ? null : String(line.unitConversionRate),
            allowDecimalQuantity: line.saleMode !== "FIXED_WEIGHT_SPEC" && line.allowDecimalQuantity === true,
            minOrderQty: line.saleMode === "FIXED_WEIGHT_SPEC" ? 1 : line.minOrderQty,
            campaignName: line.campaignName || "",
            baseUnitPrice: line.baseUnitPrice == null ? null : line.baseUnitPrice,
            lineDiscountAmount: line.lineDiscountAmount == null ? null : line.lineDiscountAmount,
            quantity: Number(line.quantity || 0),
            productUnitId: String(line.productUnitId),
            imageUrl: resolveMallAssetUrl(line.imageUrl) || "",
            priceVisible: !!line.priceVisible,
            requiresConfirmation: !!line.requiresConfirmation,
            canOrder: true,
            canAddToCart: true,
            invalidReason: "",
          });
        });
        const expectedQuantities = new Map(items.map((item) => [getCartLineKey(item), Number(item.quantity)]));
        const quotedKeys = new Set(nextItems.map(getCartLineKey));
        const matchesRequestedLines = nextItems.every((item) => (
          expectedQuantities.get(getCartLineKey(item)) === Number(item.quantity)
        ));
        if (!assertCartLinesHaveProductUnit(nextItems) || nextItems.length !== items.length
          || quotedKeys.size !== items.length || !matchesRequestedLines) {
          this.setData({
            items: enrichItems(items.map((item) => Object.assign({}, item, {
              canOrder: false,
              canAddToCart: false,
              invalidReason: item.invalidReason || "规格已失效，请重新选择",
            }))),
            quoteReady: false,
            quoteLoading: false,
            quoteError: "存在失效规格，请返回商品详情重新选择",
            primaryActionText: "暂不能结算",
            recommendations: [],
            isMinimumMet: false,
          });
          return;
        }
        saveCartItems(nextItems, this.data.storefrontCode);
        const eligible = Number(quote.eligibleSubtotal || 0);
        const minimum = Number(quote.minimumOrderAmount || 0);
        const remaining = Number(quote.remainingAmount || 0);
        this.setData({
          items: enrichItems(nextItems),
          originalTotalText: money(quote.originalTotal),
          campaignDiscountTotalText: money(quote.campaignDiscountTotal),
          totalText: money(eligible),
          minimumOrderAmountText: money(minimum),
          remainingAmountText: money(remaining),
          minimumProgress: minimum > 0 ? Math.min(100, Math.round((eligible / minimum) * 100)) : 0,
          minimumOrderEnabled: minimum > 0,
          isMinimumMet: !!quote.isMinimumMet,
          hasPendingPrice: !!quote.requiresConfirmation,
          pendingPriceLineCount: Number(quote.pendingPriceLineCount || 0),
          quoteReady: true,
          quoteLoading: false,
          quoteError: "",
          recommendations: quote.recommendations || [],
          ownerName: quote.ownerName || "全渠供客服",
          ownerPhone: quote.ownerPhone || "",
          primaryActionText: quote.requiresConfirmation
            ? "商品价格确认中，暂不能结算"
            : quote.isMinimumMet ? "去结算" : `还差 ${money(remaining)} 起送`,
        });
      })
      .catch((error) => {
        if (!isCurrent()) return;
        if (cartInputKey(getCartItems(storefrontCode)) !== inputKey) return this.refresh();
        const message = getSafeMallErrorMessage(error, "商品金额计算失败，请稍后重试");
        const failedLine = error && error.data && error.data.line;
        const failedItem = failedLine && items.find((item) => item.productId === failedLine.productId
          && item.productUnitId === failedLine.productUnitId);
        const offShelf = !!failedItem && error.code === "INVALID_PRODUCT"
          && error.message === OFF_SHELF_CART_MESSAGE;
        this.setData({
          items: enrichItems(items.map((item) => Object.assign({}, item, {
            canOrder: false,
            canAddToCart: false,
            invalidReason: !failedItem || item === failedItem ? message : "",
            offShelf: offShelf && item === failedItem,
          }))),
          quoteReady: false,
          quoteLoading: false,
          quoteError: offShelf ? `部分商品已下架，请移除后结算（${failedItem.name}）` : (failedItem ? `${failedItem.name}：${message}` : message),
          hasOffShelfItems: offShelf,
          primaryActionText: offShelf ? "请移除已下架商品" : "暂不能结算",
          recommendations: [],
          isMinimumMet: false,
        });
      });
  },

  retryQuote() {
    return this.data.customerMode === "BOUND" ? this.refresh() : this.loadCustomerState();
  },

  goProduct(event) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || !this.data.items.some((item) => item.productId === id) || this._openingProduct) return;
    this._openingProduct = true;
    wx.navigateTo({
      url: `/pages/product/detail?id=${encodeURIComponent(id)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}`,
      fail: () => wx.showToast({ title: "商品详情打开失败，请重试", icon: "none" }),
      complete: () => { this._openingProduct = false; },
    });
  },

  minus(event) {
    const item = this.data.items.find((row) => row.lineKey === event.currentTarget.dataset.key);
    if (!item || !hasValidProductUnitId(item)) return;
    this.cancelQuantityChange(item.lineKey);
    const rule = quantityRule(item);
    const next = validQuantity(Number(item.quantity || rule.minimum) - rule.step, item);
    if (next === null) return;
    updateCartQuantity(item.lineKey, next, this.data.storefrontCode);
    this.refresh();
  },

  plus(event) {
    const item = this.data.items.find((row) => row.lineKey === event.currentTarget.dataset.key);
    if (!item || !hasValidProductUnitId(item)) return;
    this.cancelQuantityChange(item.lineKey);
    const rule = quantityRule(item);
    const next = validQuantity(Number(item.quantity || rule.minimum) + rule.step, item);
    if (next === null) return;
    updateCartQuantity(item.lineKey, next, this.data.storefrontCode);
    this.refresh();
  },

  changeQuantity(event) {
    const lineKey = event.currentTarget.dataset.key;
    const index = this.data.items.findIndex((item) => item.lineKey === lineKey);
    const item = this.data.items[index];
    if (!item) return;
    this.resetQuoteState();
    const input = quantityInputState(event.detail.value, item);
    this.setData({
      [`items[${index}].quantityInput`]: input.text,
      [`items[${index}].lineAmountText`]: "重新核算中",
    });
    if (input.kind !== "VALID") {
      this.cancelQuantityChange(lineKey);
      const message = input.kind === "INVALID_FORMAT"
        ? (input.rule.allowDecimalQuantity ? `最多输入 ${input.rule.quantityScale} 位小数` : "当前规格只允许整数数量")
        : (input.kind === "EDITING" ? "" : (input.rule.allowDecimalQuantity ? "数量必须大于 0" : `数量须不小于 ${input.rule.minimum} 且为正整数`));
      this.setData({
        [`items[${index}].quantityError`]: message,
        primaryActionText: "请完成数量输入",
      });
      return;
    }
    this.setData({
      [`items[${index}].quantity`]: input.quantity,
      [`items[${index}].quantityError`]: "",
      quoteReady: false,
      quoteLoading: true,
      primaryActionText: "正在按最新数量更新价格",
    });
    this.scheduleQuantityChange(lineKey, input.quantity);
  },

  confirmQuantity(event) {
    const lineKey = event.currentTarget.dataset.key;
    const item = this.data.items.find((row) => row.lineKey === lineKey);
    if (!item) return;
    const input = quantityInputState(event.detail.value, item);
    this.cancelQuantityChange(lineKey);
    if (input.kind !== "VALID") {
      this.refresh();
      return;
    }
    updateCartQuantity(lineKey, input.quantity, this.data.storefrontCode);
    this.refresh();
  },

  scheduleQuantityChange(lineKey, quantity) {
    this.pendingQuantityValues = Object.assign({}, this.pendingQuantityValues, { [lineKey]: quantity });
    this.quantityTimers = this.quantityTimers || {};
    if (this.quantityTimers[lineKey]) clearTimeout(this.quantityTimers[lineKey]);
    this.quantityTimers[lineKey] = setTimeout(() => {
      delete this.quantityTimers[lineKey];
      const next = this.pendingQuantityValues && this.pendingQuantityValues[lineKey];
      if (this.pendingQuantityValues) delete this.pendingQuantityValues[lineKey];
      if (next == null) return;
      updateCartQuantity(lineKey, next, this.data.storefrontCode);
      this.refresh();
    }, 180);
  },

  cancelQuantityChange(lineKey) {
    if (this.quantityTimers && this.quantityTimers[lineKey]) {
      clearTimeout(this.quantityTimers[lineKey]);
      delete this.quantityTimers[lineKey];
    }
    if (this.pendingQuantityValues) delete this.pendingQuantityValues[lineKey];
  },

  flushQuantityChanges() {
    const pending = this.pendingQuantityValues || {};
    Object.keys(pending).forEach((lineKey) => {
      updateCartQuantity(lineKey, pending[lineKey], this.data.storefrontCode);
      if (this.quantityTimers && this.quantityTimers[lineKey]) clearTimeout(this.quantityTimers[lineKey]);
    });
    this.pendingQuantityValues = {};
    this.quantityTimers = {};
  },

  inputLineRemark(event) {
    updateCartRemark(event.currentTarget.dataset.key, String(event.detail.value || "").slice(0, 100), this.data.storefrontCode);
    this.refresh();
  },

  expandLineRemark(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.items[index]) return;
    this.setData({ [`items[${index}].remarkExpanded`]: true });
  },

  clearLineRemark(event) {
    updateCartRemark(event.currentTarget.dataset.key, "", this.data.storefrontCode);
    this.refresh();
  },

  clear() {
    if (!this.data.items.length) return;
    wx.showModal({
      title: "确认清空购物车",
      content: "清空后商品数量和商品备注将一并移除。",
      confirmText: "确认清空",
      success: (result) => {
        if (!result.confirm) return;
        this.flushQuantityChanges();
        clearCart(this.data.storefrontCode);
        this.refresh();
        wx.showToast({ title: "购物车已清空", icon: "none" });
      },
    });
  },

  removeItem(event) {
    const lineKey = String(event.currentTarget.dataset.key || "");
    const item = this.data.items.find((row) => row.lineKey === lineKey);
    if (!item) return;
    wx.showModal({
      title: "移除商品",
      content: `确认移除 ${item.name || "当前商品"}（${item.spec || item.unitName || "当前规格"}）？`,
      confirmText: "移除",
      success: (result) => {
        if (!result.confirm) return;
        this.cancelQuantityChange(lineKey);
        saveCartItems(
          getCartItems(this.data.storefrontCode).filter((row) => getCartLineKey(row) !== lineKey),
          this.data.storefrontCode,
        );
        this.refresh();
      },
    });
  },

  removeOffShelfItems() {
    const keys = new Set(this.data.items.filter((item) => item.offShelf).map(getCartLineKey));
    if (!keys.size) return;
    const storefrontCode = this.data.storefrontCode;
    const customerRequestId = this.customerRequestId;
    wx.showModal({
      title: "移除已下架商品",
      content: "移除标记为已下架的商品，保留其他商品并重新核算。",
      confirmText: "移除核算",
      success: (result) => {
        if (!result.confirm || this._inactive || this.data.storefrontCode !== storefrontCode
          || this.customerRequestId !== customerRequestId) return;
        keys.forEach((key) => this.cancelQuantityChange(key));
        saveCartItems(getCartItems(storefrontCode).filter((item) => !keys.has(getCartLineKey(item))), storefrontCode);
        this.refresh();
      },
    });
  },

  onProductImageError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const index = this.data.items.findIndex((item) => item.lineKey === dataset.key && item.imageUrl === dataset.src);
    if (index >= 0 && dataset.src) this.setData({ [`items[${index}].imageUrl`]: "" });
  },

  openSpecPicker(event) {
    const lineKey = String(event.currentTarget.dataset.key || "");
    const item = this.data.items.find((row) => row.lineKey === lineKey);
    if (this._inactive || !item || this.data.specSwitchingKey) return;
    const requestId = Number(this.specRequestId || 0) + 1;
    this.specRequestId = requestId;
    const customerRequestId = this.customerRequestId;
    const isCurrent = () => !this._inactive && this.specRequestId === requestId
      && this.customerRequestId === customerRequestId
      && this.data.items.some((row) => row.lineKey === lineKey);
    this.setData({ specSwitchingKey: lineKey });
    getProductDetail(item.productId, this.data.storefrontCode)
      .then((result) => {
        if (!isCurrent()) return;
        const product = result.item || result.product || result || {};
        const options = (Array.isArray(product.specOptions) ? product.specOptions : [])
          .filter((option) => (
            option
            && String(option.productUnitId || "").trim()
            && option.isActive !== false
            && option.canOrder === true
          ))
          .map((option) => Object.assign({}, option, {
            label: specLabel(option),
            selected: String(option.productUnitId) === String(item.productUnitId),
          }));
        if (options.length < 2) {
          wx.showToast({ title: "当前没有其他可售规格", icon: "none" });
          return;
        }
        this.setData({
          specPickerOpen: true,
          specPickerLineKey: lineKey,
          specPickerOptions: options,
        });
      })
      .catch((error) => {
        if (!isCurrent()) return;
        wx.showToast({
          title: getSafeMallErrorMessage(error, "规格读取失败，请稍后重试"),
          icon: "none",
        });
      })
      .finally(() => {
        if (!this._inactive && this.specRequestId === requestId) this.setData({ specSwitchingKey: "" });
      });
  },

  closeSpecPicker() {
    this.setData({ specPickerOpen: false, specPickerLineKey: "", specPickerOptions: [] });
  },

  preventClose() {},

  applySpecSwitch(event) {
    const targetUnitId = String(event.currentTarget.dataset.id || "");
    const lineKey = this.data.specPickerLineKey;
    const selected = this.data.specPickerOptions.find((option) => String(option.productUnitId) === targetUnitId);
    const items = getCartItems(this.data.storefrontCode);
    const current = items.find((item) => getCartLineKey(item) === lineKey);
    if (!selected || !current || targetUnitId === String(current.productUnitId)) {
      this.closeSpecPicker();
      return;
    }
    const targetKey = `${current.productId}:${targetUnitId}`;
    const withoutCurrent = items.filter((item) => getCartLineKey(item) !== lineKey);
    const existing = withoutCurrent.find((item) => getCartLineKey(item) === targetKey);
    const selectedRule = {
      allowDecimalQuantity: current.saleMode !== "FIXED_WEIGHT_SPEC" && selected.allowDecimalQuantity === true,
      minOrderQty: current.saleMode === "FIXED_WEIGHT_SPEC" ? 1 : selected.allowDecimalQuantity === true ? null : Number(selected.minOrderQty || selected.mallMinOrderQty || 1),
      quantityScale: current.saleMode !== "FIXED_WEIGHT_SPEC" && selected.allowDecimalQuantity === true ? 4 : 0,
      qtyStep: 1,
    };
    const nextQuantity = alignQuantity(
      Number(current.quantity || 0) + Number(existing ? existing.quantity || 0 : 0),
      selectedRule,
    );
    const nextRemark = [existing && existing.lineRemark, current.lineRemark]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join("；")
      .slice(0, 100);
    const replacement = Object.assign({}, current, selectedRule, {
      productUnitId: targetUnitId,
      lineKey: targetKey,
      spec: selected.specName || selected.unitSpecName || selected.unitName || "",
      unitName: selected.unitName || "",
      barcode: selected.barcode || "",
      conversionRate: selected.conversionRate == null ? null : selected.conversionRate,
      unitConversionRate: selected.conversionRate == null ? null : String(selected.conversionRate),
      quantity: nextQuantity,
      lineRemark: nextRemark,
      displayPrice: "",
      priceValue: null,
      resolvedPrice: null,
      effectiveMallPrice: null,
      lineAmount: null,
      priceVisible: false,
      priceSource: "PRICE_PENDING",
      requiresConfirmation: true,
      canOrder: true,
      canAddToCart: true,
      invalidReason: "",
      specOptions: this.data.specPickerOptions,
    });
    saveCartItems([...withoutCurrent.filter((item) => getCartLineKey(item) !== targetKey), replacement], this.data.storefrontCode);
    this.closeSpecPicker();
    this.refresh();
  },

  addRecommendation(event) {
    const recommendation = this.data.recommendations.find((item) => (
      `${item.productId}:${item.productUnitId}` === event.currentTarget.dataset.key
    ));
    if (!recommendation || !hasValidProductUnitId(recommendation)) {
      wx.showToast({ title: MISSING_PRODUCT_UNIT_MESSAGE, icon: "none" });
      return;
    }
    const added = addCartItem(recommendation, Number(recommendation.quantity || 1), this.data.storefrontCode);
    if (!added) {
      wx.showToast({ title: "加入失败，请重新选择规格", icon: "none" });
      return;
    }
    wx.showToast({ title: "已加入购物车", icon: "success" });
    this.refresh();
  },

  callOwner() {
    if (!this.data.ownerPhone) {
      wx.showToast({ title: "当前暂无联系电话，请联系公司客服", icon: "none" });
      return;
    }
    wx.makePhoneCall({ phoneNumber: this.data.ownerPhone });
  },

  goCheckout() {
    if (!this.beginCheckoutNavigation()) return;
    if (this.data.items.some((item) => item.offShelf)) {
      this.blockCheckoutNavigation("部分商品已下架，请移除后结算");
      return;
    }
    if (!this.data.items.length) {
      this.blockCheckoutNavigation("购物车为空");
      return;
    }
    if (!assertCartLinesHaveProductUnit(this.data.items)) {
      this.blockCheckoutNavigation(MISSING_PRODUCT_UNIT_MESSAGE);
      return;
    }
    if (this.data.items.some(isDemoCartItem)) {
      this.blockCheckoutNavigation("当前商品数据不可用，请重新选择商品");
      return;
    }
    if (this.data.items.some((item) => !item.canOrder || item.invalidReason)) {
      this.blockCheckoutNavigation("购物车中存在暂不可下单商品，请重新选择");
      return;
    }
    if (this.data.customerMode !== "BOUND") {
      this.resetCheckoutNavigationLock();
      wx.showModal({
        title: "请先完善门店资料",
        content: "完成登录和门店资料后即可提交订单。",
        confirmText: "查看资料",
        success: (result) => {
          if (result.confirm) wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
        },
      });
      return;
    }
    if (!this.data.quoteReady) {
      this.blockCheckoutNavigation(this.data.quoteError || "正在计算商品金额，请稍后重试");
      return;
    }
    if (this.data.hasPendingPrice) {
      this.blockCheckoutNavigation("部分商品价格确认中，请稍后再结算");
      return;
    }
    if (!this.data.defaultAddressReady || !this.data.defaultAddressId) {
      this.blockCheckoutNavigation(this.data.defaultAddressLoading
        ? "正在读取收货地址，请稍后重试"
        : (this.data.defaultAddressError || "暂无可用收货地址"));
      return;
    }
    if (!this.data.isMinimumMet) {
      this.blockCheckoutNavigation(`还差 ${this.data.remainingAmountText} 即可配送`);
      return;
    }
    wx.navigateTo({
      url: `/pages/checkout/checkout?storefrontCode=${this.data.storefrontCode}`,
      fail: () => {
        this.setData({ navigatingToCheckout: false });
        wx.showToast({ title: "结算页打开失败，请重试", icon: "none" });
      },
    });
  },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goCategory() {
    wx.redirectTo({ url: `/pages/category/category?storefrontCode=${this.data.storefrontCode}` });
  },

  goOrders() {
    wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    wx.navigateTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },
});
