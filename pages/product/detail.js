const { createMallShare, getMallShare, recordMallShareEvent, createClientRequestId, getMallMe, getProductDetail, getSafeMallErrorMessage, resolveMallAssetUrl, SAFE_PRICE_UNAVAILABLE_MESSAGE } = require("../../utils/request");
const { addCartItem, getCartCount, getCartItems, saveCartItems } = require("../../utils/cart");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

const SPEC_PRICE_UNAVAILABLE_MESSAGE = "当前规格暂无有效售价，请联系业务员。";
const SPEC_REQUIRED_MESSAGE = "请先选择规格";
const CUSTOMER_PRICE_REVIEW_MESSAGE = "完成登录和门店资料后可查看价格";
const TECHNICAL_COPY_PATTERN = /MALL-\d+|验收|弱网|重试测试|ProductUnit\s*稳定性|fixture|debug|\btest\b/i;

const EMPTY_PRODUCT = {
  productId: "unavailable",
  name: "商品暂不可用",
  spec: "",
  unitName: "",
  barcode: "",
  displayPrice: "",
  priceVisible: false,
  icon: "",
  stockText: "请刷新或联系业务员",
  minOrderText: "起订量待确认",
  recentPriceText: "",
  showRecentPrice: false,
  tags: [],
  imageUrls: [],
  specOptions: [],
  sellableSpecCount: 0,
  requiresSpecSelection: false,
  canOrder: false,
  canAddToCart: false,
  priceUnavailableText: SPEC_PRICE_UNAVAILABLE_MESSAGE,
};

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string") return 0;
  const text = value.trim().replace(/^[¥￥]\s*/, "").replace(/\s*元$/, "");
  // Validate the whole representation; malformed values remain pending instead
  // of becoming a different positive price. Backend ordering policy is retained.
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(text)) return 0;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "";
  return String(Number(quantity.toFixed(8)));
}

function customerSafeProductName(value) {
  const raw = String(value || "").trim();
  if (!raw) return EMPTY_PRODUCT.name;
  const safeSegments = raw
    .split(/[｜|]/)
    .map((segment) => segment
      .replace(/[（(][^）)]*(?:验收|测试|展示|稳定性|宽度|弱网)[^）)]*[）)]/gi, "")
      .trim())
    .filter((segment) => segment && !TECHNICAL_COPY_PATTERN.test(segment));
  return safeSegments.join(" · ") || "商品";
}

function customerSafeDescription(value) {
  const text = String(value || "").trim();
  return text && !TECHNICAL_COPY_PATTERN.test(text) ? text : "";
}

function validProductQuantity(value, allowDecimalQuantity, minimum) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!allowDecimalQuantity && !Number.isInteger(quantity)) return null;
  if (minimum != null && quantity < minimum) return null;
  return allowDecimalQuantity ? Number(quantity.toFixed(4)) : quantity;
}

function productQuantityInputState(value, product) {
  const text = String(value == null ? "" : value).trim();
  const allowDecimalQuantity = !!(product && product.allowDecimalQuantity);
  const pattern = allowDecimalQuantity ? /^\d*(?:\.\d{0,4})?$/ : /^\d*$/;
  if (!pattern.test(text)) return { kind: "INVALID_FORMAT", text };
  if (!text || (allowDecimalQuantity && /\.$/.test(text))) return { kind: "EDITING", text };
  const quantity = validProductQuantity(text, allowDecimalQuantity, product && product.minOrderQty);
  return quantity == null ? { kind: "INVALID_RULE", text } : { kind: "VALID", text, quantity };
}

function isDemoProduct(item) {
  const productId = String((item && (item.productId || item.id)) || "");
  return productId.indexOf("demo-") === 0 || productId.indexOf("fallback-") === 0 || !!(item && (item.isFallback || item.isDemo || item.isMock));
}

function stockTextFor(item, fallback) {
  if (isDemoProduct(item)) return "商品暂不可下单";
  if (item && item.stockHint) return item.stockHint;
  if (item && item.stockText) return item.stockText;
  if (item && item.stockStatus === "OUT_OF_STOCK") return "暂时缺货";
  if (item && item.stockStatus === "LOW_STOCK") return item.canOrderByStock === false ? "库存不足" : "库存偏低";
  if (item && item.stockStatus === "IN_STOCK") return "可订购";
  return fallback;
}

function buildSpecPresentation(option) {
  const specName = String((option && (option.specName || option.specification || option.unitSpecName)) || "").trim();
  const unitName = String((option && (option.displayUnitLabel || option.unitName)) || "").trim();
  return { primaryLabel: specName || unitName || "未命名规格", secondaryLabel: "" };
}

function minimumOrderText(option) {
  // Only the server's minimum-order fields establish a displayed minimum.
  // Spec names and inventory conversion rates are never quantity units.
  const raw = option && (option.minOrderQty ?? option.mallMinOrderQty);
  const minimum = Number(raw);
  return raw != null && Number.isFinite(minimum) && minimum > 0
    ? `起订 ${formatQuantity(minimum)} 个所选规格` : "";
}

function sortSpecOptions(options) {
  return options.slice().sort((a, b) => {
    const sortA = Number.isFinite(Number(a.sortNo)) ? Number(a.sortNo) : 0;
    const sortB = Number.isFinite(Number(b.sortNo)) ? Number(b.sortNo) : 0;
    if (sortA !== sortB) return sortA - sortB;
    return String(a.productUnitId).localeCompare(String(b.productUnitId));
  });
}

function resolveMinOrderQty(option, fallbackItem) {
  if ((option && option.allowDecimalQuantity) || (fallbackItem && fallbackItem.allowDecimalQuantity)) return null;
  const raw = Number(
    (option && (option.minOrderQty || option.mallMinOrderQty))
    || (fallbackItem && (fallbackItem.minOrderQty || fallbackItem.mallMinOrderQty))
    || 1,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function normalizeSpecOption(option, customerCanViewPrice, baseUnit, saleMode) {
  const productUnitId = String((option && option.productUnitId) || "").trim();
  if (!productUnitId) return null;
  if (option && option.isActive === false) return null;

  const displayPrice = option && option.priceVisible
    ? (option.effectiveMallPrice == null ? option.displayPrice : option.effectiveMallPrice)
    : "";
  const priceValue = parsePrice(displayPrice);
  const hasValidPrice = !!(customerCanViewPrice && option && option.priceVisible === true && priceValue > 0);
  const priceText = hasValidPrice ? `¥${priceValue.toFixed(2)}` : "";
  const requiresConfirmation = !!(option && option.requiresConfirmation) || !hasValidPrice;
  const canOrderByStock = !(option && (option.canOrderByStock === false || option.stockStatus === "OUT_OF_STOCK"));
  const backendCanOrder = !!(option && option.canOrder);
  const canOrder = backendCanOrder && canOrderByStock && option.mallSellable !== false;
  const fixed = saleMode === "FIXED_WEIGHT_SPEC";
  const minOrderQty = fixed ? 1 : resolveMinOrderQty(option, null);
  const allowDecimalQuantity = !fixed && !!(option && option.allowDecimalQuantity);
  const specPresentation = buildSpecPresentation(option);
  const priceUnavailableText = customerCanViewPrice
    ? SPEC_PRICE_UNAVAILABLE_MESSAGE
    : CUSTOMER_PRICE_REVIEW_MESSAGE;

  return Object.assign({}, option, {
    productUnitId,
    specName: (option && (option.specName || option.unitName)) || "未命名规格",
    unitName: (option && option.unitName) || "",
    barcode: (option && option.barcode) || "",
    conversionRate: option && option.conversionRate != null ? option.conversionRate : null,
    label: specPresentation.primaryLabel,
    primaryLabel: specPresentation.primaryLabel,
    secondaryLabel: "",
    conversionText: "",
    displayPrice: hasValidPrice ? displayPrice : "",
    priceValue: hasValidPrice ? priceValue : 0,
    priceText,
    priceVisible: hasValidPrice,
    priceSource: (option && option.priceSource) || "PRICE_PENDING",
    requiresConfirmation,
    explanation: "价格确认中",
    canOrder,
    canOrderByStock,
    disabled: !canOrderByStock,
    minOrderQty,
    qtyStep: 1,
    quantityScale: allowDecimalQuantity ? 4 : 0,
    allowDecimalQuantity,
    quantityInputType: allowDecimalQuantity ? "digit" : "number",
    minOrderText: minimumOrderText(option),
    stockText: stockTextFor(option, "库存待确认"),
    priceUnavailableText,
    isDefault: !!(option && option.isDefault),
    sortNo: option && option.sortNo,
  });
}

function pickDefaultSpec(specOptions) {
  if (!specOptions.length) return null;
  // A permitted quote may be viewed without permission to place an order.
  const hasViewableQuote = (option) => !option.disabled && option.mallSellable !== false
    && option.priceVisible && !option.requiresConfirmation;
  if (specOptions.length === 1) return specOptions[0].canOrder || hasViewableQuote(specOptions[0]) ? specOptions[0] : null;
  const defaultSellable = specOptions.find((option) => option.isDefault && option.canOrder);
  if (defaultSellable) return defaultSellable;
  return specOptions.find((option) => option.isDefault && hasViewableQuote(option)) || null;
}

function applySelectedSpec(baseProduct, selected, quantity) {
  const productId = String(baseProduct.productId || "");
  if (!selected) {
    return Object.assign({}, baseProduct, {
      productUnitId: "",
      lineKey: productId,
      spec: "",
      specLabel: "",
      specSecondaryLabel: "",
      unitName: "",
      barcode: "",
      displayPrice: "",
      priceVisible: false,
      priceText: "",
      priceValue: 0,
      stockText: baseProduct.requiresSpecSelection ? SPEC_REQUIRED_MESSAGE : stockTextFor(baseProduct, EMPTY_PRODUCT.stockText),
      minOrderQty: 1,
      qtyStep: 1,
      minOrderText: baseProduct.requiresSpecSelection ? SPEC_REQUIRED_MESSAGE : "起订量待确认",
      canOrder: false,
      canAddToCart: false,
      canOrderByStock: false,
      priceUnavailableText: baseProduct.requiresSpecSelection
        ? SPEC_REQUIRED_MESSAGE
        : (baseProduct.priceUnavailableText || SPEC_PRICE_UNAVAILABLE_MESSAGE),
      selectedQuantity: 1,
    });
  }

  const fixed = baseProduct.saleMode === "FIXED_WEIGHT_SPEC";
  const minOrderQty = fixed ? 1 : resolveMinOrderQty(selected, baseProduct);
  const allowDecimalQuantity = !fixed && !!selected.allowDecimalQuantity;
  const nextQty = validProductQuantity(quantity, allowDecimalQuantity, minOrderQty) ?? minOrderQty ?? 1;

  const canAdd = !isDemoProduct(baseProduct) && !!selected.productUnitId && !!selected.canOrder;
  return Object.assign({}, baseProduct, {
    productUnitId: selected.productUnitId,
    lineKey: `${productId}:${selected.productUnitId}`,
    spec: selected.specName,
    specLabel: selected.primaryLabel,
    specSecondaryLabel: selected.secondaryLabel,
    unitName: selected.unitName,
    barcode: selected.barcode || "",
    displayPrice: selected.displayPrice,
    priceVisible: !!selected.priceVisible,
    priceSource: selected.priceSource,
    requiresConfirmation: !!selected.requiresConfirmation,
    explanation: selected.explanation,
    priceText: selected.priceText,
    priceValue: selected.priceValue,
    stockText: selected.stockText,
    minOrderQty,
    qtyStep: 1,
    quantityScale: allowDecimalQuantity ? 4 : 0,
    allowDecimalQuantity,
    quantityInputType: allowDecimalQuantity ? "digit" : "number",
    minOrderText: selected.minOrderText,
    canOrder: canAdd,
    canAddToCart: canAdd,
    canOrderByStock: selected.canOrderByStock !== false,
    priceUnavailableText: selected.priceVisible
      ? selected.priceUnavailableText
      : (selected.priceUnavailableText || SPEC_PRICE_UNAVAILABLE_MESSAGE),
    conversionRate: selected.conversionRate,
    unitConversionRate: selected.conversionRate == null ? null : String(selected.conversionRate),
    selectedQuantity: nextQty,
  });
}

function normalizeProduct(raw) {
  const item = raw || {};
  const demoProduct = isDemoProduct(item);
  const customerCanViewPrice = !!(item.priceAccess && item.priceAccess.canViewPrice === true);
  const baseUnit = String(item.baseUnit || "").trim();
  const saleMode = item.saleMode || "STANDARD";
  const recentPriceValue = parsePrice(item.lastDealPrice || item.recentPriceText);
  const hasRecentDeal = customerCanViewPrice && recentPriceValue > 0 && !!item.lastDealDate;
  const rawSpecOptions = Array.isArray(item.specOptions) ? item.specOptions : [];
  const specOptions = sortSpecOptions(
    rawSpecOptions
      .map((option) => normalizeSpecOption(option, customerCanViewPrice, baseUnit, saleMode))
      .filter(Boolean),
  );
  const selected = saleMode === "FIXED_WEIGHT_SPEC" ? null : pickDefaultSpec(specOptions);
  const requiresSpecSelection = specOptions.length > 0 && !selected;
  const productId = String(item.productId || item.id || EMPTY_PRODUCT.productId);
  const unifiedImageUrls = Array.isArray(item.images)
    ? item.images.map((image) => image && image.url)
    : [];
  const imageUrls = Array.from(new Set(
    [item.imageUrl || item.effectiveImageUrl || item.image, item.primaryImageUrl]
      .concat(Array.isArray(item.imageUrls) ? item.imageUrls : [], unifiedImageUrls)
      .map((value) => resolveMallAssetUrl(value))
      .filter(Boolean),
  ));
  const base = Object.assign({}, EMPTY_PRODUCT, item, {
    productId,
    name: customerSafeProductName(item.mallTitle || item.displayName || item.name || item.productName),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    imageFailed: false,
    icon: item.icon || EMPTY_PRODUCT.icon,
    tags: (Array.isArray(item.tags) ? item.tags : EMPTY_PRODUCT.tags)
      .map((tag) => String(tag || "").trim())
      .filter((tag) => tag && !TECHNICAL_COPY_PATTERN.test(tag)),
    recentPriceText: hasRecentDeal
      ? `¥${recentPriceValue.toFixed(2)}`
      : "",
    showRecentPrice: hasRecentDeal,
    description: customerSafeDescription(item.description || item.detailDescription || item.shortDescription),
    specOptions,
    sellableSpecCount: specOptions.length,
    requiresSpecSelection,
    priceUnavailableText: item.mallSellabilityStatus === "NOT_SELLABLE"
      ? "当前商品暂无报价"
      : customerCanViewPrice
        ? SPEC_PRICE_UNAVAILABLE_MESSAGE
        : CUSTOMER_PRICE_REVIEW_MESSAGE,
    customerCanViewPrice,
    isFallback: !!item.isFallback || demoProduct,
    isDemo: !!item.isDemo || demoProduct,
    isMock: !!item.isMock || demoProduct,
  });
  return applySelectedSpec(base, selected, selected ? selected.minOrderQty : 1);
}

function purchasePresentation(product, customerMode, quantityError) {
  if (customerMode === "RESOLVING") {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: "正在确认客户状态" };
  }
  if (customerMode === "VIEW_ONLY") {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: "当前角色仅可浏览，不能购买" };
  }
  if (customerMode !== "BOUND") {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: "完成登录和门店资料后即可购买" };
  }
  if (!product || product.requiresSpecSelection || !product.productUnitId) {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: "请先选择商品规格" };
  }
  if (quantityError) {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: quantityError };
  }
  if (product.canOrderByStock === false) {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: product.stockText || "当前规格库存不足" };
  }
  if (!product.canAddToCart) {
    return { ctaDisabled: true, ctaText: "加入购物车", ctaDisabledReason: "当前规格暂不可购买" };
  }
  return { ctaDisabled: false, ctaText: "加入购物车", ctaDisabledReason: "" };
}

function clearPurchaseState(page) {
  const cleared = normalizeProduct(EMPTY_PRODUCT);
  page.setData({
    product: cleared,
    selectedSpecId: "",
    quantity: 1,
    subtotalText: "价格确认中",
    imageCurrent: 0,
    imageRenderLimit: 0,
    imageLoadStatus: "EMPTY",
    loadedImageUrls: [],
  });
}

Page({
  data: {
    id: "",
    storefrontCode: "zhenshang",
    customerMode: "GUEST",
    product: normalizeProduct(EMPTY_PRODUCT),
    quantity: 1,
    selectedSpecId: "",
    lineRemark: "",
    lineRemarkLength: 0,
    lineRemarkExpanded: false,
    loading: false,
    viewState: "LOADING",
    errorMessage: "",
    subtotalText: "价格确认中",
    specHint: "",
    quantityError: "",
    shareToken: "",
    sharePanelOpen: false,
    sharing: false,
    shareReady: false,
    shareError: "",
    ctaDisabled: true,
    ctaText: "加入购物车",
    ctaDisabledReason: "完成登录和门店资料后即可购买",
    cartFeedbackText: "",
    cartCount: 0,
    imageCurrent: 0,
    imageRenderLimit: 0,
    imageLoadStatus: "EMPTY",
    loadedImageUrls: [],
  },

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    this.clearSharePreparation();
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({
      id: (query && query.id) || "",
      shareToken: String((query && query.shareToken) || ""),
      storefrontCode: entrance.storefrontCode,
    });
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    this._inactive = false;
    this.refreshCartCount();
    return this.loadCustomerState().then((current) => current ? this.loadProduct() : undefined);
  },

  onHide() {
    this._inactive = true;
    this.clearSharePreparation();
    this._customerRequestId = (this._customerRequestId || 0) + 1;
    this._productRequestId = (this._productRequestId || 0) + 1;
    clearPurchaseState(this);
    this.setData({ customerMode: "RESOLVING", loading: false, viewState: "LOADING", errorMessage: "" });
    this.refreshPurchasePresentation();
  },

  onUnload() {
    this._disposed = true;
    this._inactive = true;
    this.clearSharePreparation();
    this._customerRequestId = (this._customerRequestId || 0) + 1;
    this._productRequestId = (this._productRequestId || 0) + 1;
  },

  refreshCartCount() {
    this.setData({ cartCount: getCartCount(this.data.storefrontCode) });
  },

  loadCustomerState() {
    if (this._disposed || this._inactive) return Promise.resolve(false);
    const requestId = this._customerRequestId = (this._customerRequestId || 0) + 1;
    this._productRequestId = (this._productRequestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && !this._inactive && this._customerRequestId === requestId && this.data.storefrontCode === code;
    clearPurchaseState(this);
    this.setData({ customerMode: "RESOLVING", loading: true, viewState: "LOADING", errorMessage: "" });
    this.refreshPurchasePresentation();
    return getMallMe(code, "PRODUCT_DETAIL_PAGE")
      .then((result) => {
        if (!current()) return false;
        const approved = result.customerStatus === "APPROVED_BOUND_CUSTOMER";
        const canOrder = approved
          && !!(result.priceAccess && result.priceAccess.canOrder);
        this.setData({ customerMode: canOrder ? "BOUND" : approved ? "VIEW_ONLY" : "GUEST" });
        this.refreshCartCount();
        this.refreshPurchasePresentation();
        return true;
      })
      .catch(() => {
        if (!current()) return false;
        this.setData({ customerMode: "GUEST", loading: false, viewState: "ERROR", errorMessage: "客户状态确认失败，请检查网络后重试。" });
        this.refreshPurchasePresentation();
        return false;
      });
  },

  loadProduct() {
    if (this._disposed || this._inactive) return Promise.resolve();
    const requestId = this._productRequestId = (this._productRequestId || 0) + 1;
    const customerRequestId = this._customerRequestId;
    const id = this.data.id;
    const token = this.data.shareToken;
    this.clearSharePreparation();
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && !this._inactive && this._productRequestId === requestId
      && this._customerRequestId === customerRequestId && this.data.id === id && this.data.shareToken === token && this.data.storefrontCode === code;
    clearPurchaseState(this);
    if (!id && !token) {
      this.setData({
        loading: false,
        viewState: "EMPTY",
        errorMessage: "商品标识无效，请返回商城重新选择。",
      });
      this.refreshPurchasePresentation();
      return;
    }
    this.setData({ loading: true, viewState: "LOADING", errorMessage: "" });
    this.refreshPurchasePresentation();
    return (token ? getMallShare(code, token) : getProductDetail(id, code))
      .then((result) => {
        if (!current()) return;
        const raw = result && (result.item || result.product || result);
        const productId = String((raw && (raw.productId || raw.id)) || "").trim();
        if (!raw || typeof raw !== "object" || !productId || productId === "unavailable" || (!token && productId !== String(id)) || (token && result.sourceType !== "PRODUCT")) {
          clearPurchaseState(this);
          this.setData({
            viewState: "EMPTY",
            errorMessage: "商品不存在、已下架或暂不可查看，请返回商城重新选择。",
          });
          return;
        }
        this.updateProduct(normalizeProduct(raw));
        this._resolvedShareProductId = productId;
        if (token && typeof recordMallShareEvent === "function") recordMallShareEvent(code, token, { event: "PRODUCT_VIEW", clientEventId: createClientRequestId("share-view"), productId, ...(this.data.product.productUnitId ? { productUnitId: this.data.product.productUnitId } : {}) }).catch(() => {});
        this.setData({ viewState: "READY", errorMessage: "" });
      })
      .catch((error) => {
        if (!current()) return;
        clearPurchaseState(this);
        const unavailable = Number(error && error.statusCode) === 404
          || ["INVALID_PRODUCT", "PRODUCT_NOT_FOUND", "PRODUCT_UNAVAILABLE", "MALL_SHARE_EXPIRED"].includes(String((error && error.code) || ""));
        this.setData({
          viewState: unavailable ? "EMPTY" : "ERROR",
          errorMessage: unavailable
            ? getSafeMallErrorMessage(error, "商品不存在、已下架或暂不可查看，请返回商城重新选择。")
            : getSafeMallErrorMessage(error, "商品详情加载失败，请检查网络后重试。"),
        });
      })
      .finally(() => {
        if (!current()) return;
        this.setData({ loading: false });
        this.refreshPurchasePresentation();
      });
  },

  retryProduct() {
    if (this.data.loading) return;
    return this.loadCustomerState().then((current) => current ? this.loadProduct() : undefined);
  },

  safeBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` }),
    });
  },

  updateProduct(product) {
    const quantity = product.selectedQuantity || product.minOrderQty || 1;
    this.setData({
      product,
      selectedSpecId: product.productUnitId || "",
      quantity,
      lastValidQuantity: quantity,
      specHint: product.requiresSpecSelection ? SPEC_REQUIRED_MESSAGE : "",
      quantityError: "",
      cartFeedbackText: "",
      imageCurrent: 0,
      imageRenderLimit: 0,
      imageLoadStatus: product.imageUrls.length ? "LOADING" : "EMPTY",
      loadedImageUrls: [],
    });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  selectSpec(event) {
    const productUnitId = String(event.currentTarget.dataset.id || "");
    const selected = this.data.product.specOptions.find((option) => option.productUnitId === productUnitId);
    if (!selected) return;
    if (selected.disabled) {
      wx.showToast({ title: selected.stockText || "当前规格暂不可购买", icon: "none" });
      return;
    }

    const nextProduct = applySelectedSpec(
      Object.assign({}, this.data.product, { requiresSpecSelection: false }),
      selected,
      this.data.quantity,
    );
    this.setData({
      selectedSpecId: selected.productUnitId,
      product: nextProduct,
      quantity: nextProduct.selectedQuantity,
      specHint: "",
      quantityError: "",
      cartFeedbackText: "",
    });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  minus() {
    const current = Number(this.data.quantity || this.data.lastValidQuantity || 1);
    const next = validProductQuantity(current - 1, this.data.product.allowDecimalQuantity, this.data.product.minOrderQty);
    if (next == null) return;
    this.setData({ quantity: next, lastValidQuantity: next, quantityError: "", cartFeedbackText: "" });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  plus() {
    const current = Number(this.data.quantity || this.data.lastValidQuantity || 0);
    const next = validProductQuantity(current + 1, this.data.product.allowDecimalQuantity, this.data.product.minOrderQty);
    if (next == null) return;
    this.setData({ quantity: next, lastValidQuantity: next, quantityError: "", cartFeedbackText: "" });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  changeQuantity(event) {
    const input = productQuantityInputState(event.detail.value, this.data.product);
    if (input.kind !== "VALID") {
      const message = input.kind === "INVALID_FORMAT"
        ? (this.data.product.allowDecimalQuantity ? "最多可输入 4 位小数" : "当前商品只允许整数数量")
        : (input.kind === "EDITING" ? "请输入完整的正数数量" : "数量必须大于 0");
      this.setData({ quantity: input.text, quantityError: message });
      this.refreshPurchasePresentation();
      return;
    }
    this.setData({ quantity: input.text, lastValidQuantity: input.quantity, quantityError: "", cartFeedbackText: "" });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  confirmQuantity() {
    if (!this.data.quantityError) return;
    const quantity = Number(this.data.lastValidQuantity || this.data.product.minOrderQty || 1);
    this.setData({ quantity, quantityError: "", cartFeedbackText: "" });
    this.updateSubtotal();
    this.refreshPurchasePresentation();
  },

  inputLineRemark(event) {
    const lineRemark = String((event && event.detail && event.detail.value) || "").slice(0, 100);
    this.setData({
      lineRemark,
      lineRemarkLength: lineRemark.length,
      lineRemarkExpanded: true,
    });
  },

  expandLineRemark() {
    this.setData({ lineRemarkExpanded: true });
  },

  clearLineRemark() {
    this.setData({ lineRemark: "", lineRemarkLength: 0, lineRemarkExpanded: false });
  },

  updateSubtotal() {
    const product = this.data.product;
    if (!product || !product.productUnitId) {
      this.setData({ subtotalText: product && product.requiresSpecSelection ? SPEC_REQUIRED_MESSAGE : "价格确认中" });
      return;
    }
    if (!product.priceVisible || product.requiresConfirmation || !(product.priceValue > 0)) {
      this.setData({ subtotalText: "价格确认中" });
      return;
    }
    this.setData({ subtotalText: "金额以购物车报价为准" });
  },

  refreshPurchasePresentation() {
    const pending = this._disposed || this._inactive || this.data.loading || this.data.viewState !== "READY";
    this.setData(purchasePresentation(this.data.product, pending ? "RESOLVING" : this.data.customerMode, this.data.quantityError));
  },

  addCart() {
    if (this._disposed || this._inactive || this.data.loading || this.data.viewState !== "READY") return;
    const product = this.data.product;
    if (!product) return;
    if (this.data.customerMode !== "BOUND") {
      wx.showToast({ title: this.data.customerMode === "VIEW_ONLY" ? "当前账号仅支持浏览" : "完成登录和门店资料后即可加入购物车", icon: "none" });
      return;
    }
    if (this.data.quantityError) {
      wx.showToast({ title: this.data.quantityError, icon: "none" });
      return;
    }
    if (product.requiresSpecSelection || !product.productUnitId) {
      wx.showToast({ title: SPEC_REQUIRED_MESSAGE, icon: "none" });
      return;
    }
    if (!product.canAddToCart || isDemoProduct(product) || product.productId === "unavailable") {
      wx.showToast({
        title: isDemoProduct(product)
          ? "当前商品数据不可用，请重新选择商品"
          : (product.stockText || "商品暂不可下单，请刷新后重试"),
        icon: "none",
      });
      return;
    }
    const payload = Object.assign({}, product, { lineRemark: this.data.lineRemark, shareToken: this.data.shareToken });
    let added;
    if (product.requiresConfirmation) {
      const items = getCartItems(this.data.storefrontCode);
      const lineKey = `${product.productId}:${product.productUnitId}`;
      const existing = items.find((item) => item.lineKey === lineKey);
      if (existing) {
        existing.quantity = Number(existing.quantity || 0) + Number(this.data.quantity || 1);
        Object.assign(existing, { saleMode: product.saleMode, baseUnit: product.baseUnit, unitConversionRate: product.unitConversionRate, priceValue: null, displayPrice: "", priceVisible: false, requiresConfirmation: true });
        existing.shareTokens = [...new Set([...(existing.shareTokens || (existing.shareToken ? [existing.shareToken] : [])), ...(this.data.shareToken ? [this.data.shareToken] : [])])];
        existing.lineRemark = this.data.lineRemark || existing.lineRemark || "";
      } else {
        items.push(Object.assign({}, payload, {
          lineKey,
          quantity: Number(this.data.quantity || 1),
          displayPrice: "",
          priceValue: null,
          priceVisible: false,
          priceSource: "PRICE_PENDING",
          requiresConfirmation: true,
          canOrder: true,
          canAddToCart: true,
        }));
      }
      added = saveCartItems(items, this.data.storefrontCode) === false ? null : items;
    } else {
      added = addCartItem(payload, this.data.quantity, this.data.storefrontCode);
    }
    if (!added || !added.length) {
      wx.showToast({ title: "加入失败，请重新选择规格", icon: "none" });
      return;
    }
    if (this.data.shareToken) recordMallShareEvent(this.data.storefrontCode, this.data.shareToken, { event: "ADD_CART", clientEventId: createClientRequestId("share-cart"), productId: product.productId, productUnitId: product.productUnitId }).catch(() => {});
    this.setData({ cartFeedbackText: "已加入购物车，可前往购物车查看" });
    this.refreshCartCount();
    wx.showToast({ title: "已加入购物车", icon: "none" });
  },

  goCategory() {
    this.safeBack();
  },

  onImageError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const previousImageUrls = this.data.product.imageUrls || [];
    const eventIndex = Number(dataset.index);
    const failedUrl = String(
      dataset.url
      || (Number.isInteger(eventIndex) ? previousImageUrls[eventIndex] : "")
      || previousImageUrls[this.data.imageCurrent]
      || "",
    );
    const failedIndex = previousImageUrls.indexOf(failedUrl);
    const imageUrls = previousImageUrls.filter((url, index) => (
      failedIndex >= 0 ? index !== failedIndex : url !== failedUrl
    ));
    const loadedImageUrls = (this.data.loadedImageUrls || []).filter((url) => url !== failedUrl);
    let imageCurrent = this.data.imageCurrent;
    if (failedIndex >= 0 && failedIndex < imageCurrent) imageCurrent -= 1;
    imageCurrent = Math.min(imageCurrent, Math.max(0, imageUrls.length - 1));
    const imageRenderLimit = Math.min(
      Math.max(imageCurrent, Number(this.data.imageRenderLimit) || 0),
      Math.max(0, imageUrls.length - 1),
    );
    const currentUrl = imageUrls[imageCurrent] || "";
    this.setData({
      "product.imageUrls": imageUrls,
      "product.imageUrl": imageUrls[0] || "",
      "product.imageFailed": imageUrls.length === 0,
      imageCurrent,
      imageRenderLimit,
      loadedImageUrls,
      imageLoadStatus: imageUrls.length === 0
        ? "EMPTY"
        : (loadedImageUrls.includes(currentUrl) ? "LOADED" : "LOADING"),
    });
  },

  onImageLoad(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const imageUrls = this.data.product.imageUrls || [];
    const eventIndex = Number(dataset.index);
    const loadedUrl = String(
      dataset.url
      || (Number.isInteger(eventIndex) ? imageUrls[eventIndex] : "")
      || "",
    );
    if (!loadedUrl || !imageUrls.includes(loadedUrl)) return;
    const loadedImageUrls = Array.from(new Set((this.data.loadedImageUrls || []).concat(loadedUrl)));
    const currentUrl = imageUrls[this.data.imageCurrent] || "";
    this.setData({
      "product.imageFailed": false,
      loadedImageUrls,
      imageLoadStatus: loadedUrl === currentUrl ? "LOADED" : this.data.imageLoadStatus,
    });
  },

  changeImage(event) {
    const current = Number(event && event.detail && event.detail.current);
    const imageCurrent = Number.isFinite(current) ? current : 0;
    const currentUrl = (this.data.product.imageUrls || [])[imageCurrent] || "";
    this.setData({
      imageCurrent,
      imageRenderLimit: Math.max(Number(this.data.imageRenderLimit) || 0, imageCurrent),
      imageLoadStatus: (this.data.loadedImageUrls || []).includes(currentUrl) ? "LOADED" : "LOADING",
    });
  },

  goCart() {
    const url = `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}`;
    wx.navigateTo({
      url,
      fail: () => wx.redirectTo({
        url,
        fail: () => wx.showToast({ title: "购物车打开失败，请返回后重试", icon: "none" }),
      }),
    });
  },

  isProductShareReady() {
    return !this._disposed && !this._inactive && this.data.viewState === "READY" && !!this.data.product && this.data.customerMode === "BOUND";
  },
  clearSharePreparation() {
    this._shareRequestId = (this._shareRequestId || 0) + 1;
    this._preparedShares = null;
    this.setData({ shareReady: false, sharing: false, sharePanelOpen: false, shareError: "" });
    if (typeof wx.hideShareMenu === "function") wx.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },
  openSharePanel() {
    if (!this.isProductShareReady() || this.data.sharing) return Promise.resolve();
    this.setData({ sharePanelOpen: true, sharing: true, shareReady: false, shareError: "" });
    const requestId = this._shareRequestId = (this._shareRequestId || 0) + 1;
    const payload = { sourceType: "PRODUCT", productId: this._resolvedShareProductId || this.data.product.productId || this.data.id, ...(this.data.shareToken && !this._legacyShare ? { parentToken: this.data.shareToken } : {}) };
    return Promise.all(["MINI_PROGRAM_CARD", "WECHAT"].map(channel => createMallShare(this.data.storefrontCode, Object.assign({}, payload, { channel }))))
      .then(results => {
        if (this._shareRequestId !== requestId || !this.isProductShareReady()) return;
        const friend = results[0] && results[0].share;
        const timeline = results[1] && results[1].share;
        if (!friend || !friend.friend || !timeline || !timeline.timeline || !friend.token || !timeline.token) throw new Error("分享数据暂不可用");
        this._preparedShares = { friend, timeline };
        this.setData({ shareReady: true, sharing: false });
        if (typeof wx.showShareMenu === "function") wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      }).catch(() => {
        if (this._shareRequestId !== requestId || !this.isProductShareReady()) return;
        this._preparedShares = null;
        this.setData({ sharing: false, shareReady: false, shareError: "分享准备失败，请重试" });
      });
  },
  closeSharePanel() { this.setData({ sharePanelOpen: false }); },
  showTimelineGuide() {
    if (!this.hasPreparedShare()) return;
    wx.showModal({ title: "分享到朋友圈", content: "请点击右上角“…”菜单，再选择“分享到朋友圈”。", showCancel: false });
  },
  hasPreparedShare() {
    const shares = this._preparedShares;
    return !!(this.isProductShareReady() && this.data.shareReady && shares && Date.parse(shares.friend.expiresAt) > Date.now() && Date.parse(shares.timeline.expiresAt) > Date.now());
  },
  onShareAppMessage() {
    if (!this.hasPreparedShare()) return { title: "全渠供商城", path: `/pages/index/index?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` };
    return this._preparedShares.friend.friend;
  },
  onShareTimeline() {
    if (!this.hasPreparedShare()) return { title: "全渠供商城", query: "", imageUrl: "" };
    return this._preparedShares.timeline.timeline;
  },
});
