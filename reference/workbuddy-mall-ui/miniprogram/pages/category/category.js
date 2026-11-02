const { getCategories, getMallMe, getProducts, resolveMallAssetUrl, SAFE_PRICE_UNAVAILABLE_MESSAGE } = require("../../utils/request");
const { getCartCount, getCartItems } = require("../../utils/cart");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

const DEFAULT_CATEGORIES = [
  { id: "", name: "全部商品", icon: "全", badge: "" },
];

function decodeEntranceText(value) {
  const text = typeof value === "string" ? value : "";
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string") return 0;
  const text = value.trim().replace(/^[¥￥]\s*/, "").replace(/\s*元$/, "");
  // Keep supported RMB formatting, without stripping signs or damaged content
  // into an invented positive price. The server remains the price owner.
  if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(text)) return 0;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return "";
  return String(Number(quantity.toFixed(4)));
}

function safeText(value, fallback) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) return fallback;
  const upper = text.toUpperCase();
  if (upper === "NOT_EXPOSED" || upper === "NULL" || upper === "UNDEFINED") return fallback;
  return text;
}

function isInternalPlaceholder(value) {
  const text = String(value === undefined || value === null ? "" : value).trim().toUpperCase();
  return !text || text === "NOT_EXPOSED" || text === "NULL" || text === "UNDEFINED";
}

function isDemoProduct(item) {
  const productId = String((item && (item.productId || item.id)) || "");
  return productId.indexOf("demo-") === 0 || productId.indexOf("fallback-") === 0 || !!(item && (item.isFallback || item.isDemo || item.isMock));
}

function stockTextFor(item, fallback) {
  if (isDemoProduct(item)) return "当前商品数据不可用";
  if (item.stockHint) return item.stockHint;
  if (item.stockText) return item.stockText;
  if (item.stockStatus === "OUT_OF_STOCK") return "暂时缺货";
  if (item.stockStatus === "LOW_STOCK") return item.canOrderByStock === false ? "库存不足" : "库存偏低";
  if (item.stockStatus === "IN_STOCK") return "可订购";
  return fallback;
}

function normalizeTags(tags, priceVisible, fallbackTags) {
  const source = Array.isArray(tags) && tags.length ? tags : fallbackTags;
  const visibleTags = source
    .map((tag) => safeText(tag, ""))
    .filter(Boolean)
    .filter((tag) => !/^[A-Z0-9_]+$/.test(tag))
    .slice(0, 3);

  return visibleTags;
}

function buildSpecLabel(option) {
  return safeText(option && (option.displayUnitLabel || option.unitName), "")
    || safeText(option && (option.specification || option.specName || option.unitSpecName), "")
    || "未命名单位";
}

function buildSpecSecondaryLabel(option, baseUnit, saleMode) {
  const specName = safeText(option && (option.specification || option.specName || option.unitSpecName), "");
  const unitName = safeText(option && (option.displayUnitLabel || option.unitName), "");
  const providedConversionText = safeText(option && option.conversionText, "");
  const conversionRate = Number(option && (option.conversion ?? option.conversionRate));
  const baseUnitName = safeText(baseUnit, "");
  if (saleMode === "FIXED_WEIGHT_SPEC") {
    return Number.isFinite(conversionRate) && conversionRate > 0 && baseUnitName
      ? `1份 = ${formatQuantity(conversionRate)}${baseUnitName}` : "";
  }
  const conversionText = providedConversionText || (
    Number.isFinite(conversionRate)
    && conversionRate > 0
    && unitName
    && baseUnitName
    && (conversionRate !== 1 || unitName !== baseUnitName)
      ? `1${unitName} = ${formatQuantity(conversionRate)}${baseUnitName}`
      : ""
  );
  return [specName && specName !== unitName ? specName : "", conversionText]
    .filter((value, index, source) => value && source.indexOf(value) === index)
    .join(" · ");
}

function normalizeProduct(item) {
  const coreNotSellable = item.mallSellabilityStatus === "NOT_SELLABLE";
  const sellableSpecs = (Array.isArray(item.specOptions) ? item.specOptions : [])
    .filter((option) => option
      && String(option.productUnitId || "").trim()
      && option.isActive !== false
      && option.mallSellable !== false);
  const sellableSpecCount = sellableSpecs.length;
  const selectedSpec = sellableSpecs.find((option) => option.isDefault && option.canOrder)
    || (sellableSpecCount === 1 ? sellableSpecs[0] : null)
    || sellableSpecs.find((option) => option.isDefault)
    || null;
  const requiresSpecSelection = sellableSpecCount > 1 && !selectedSpec;
  const selectedPriceSource = selectedSpec && selectedSpec.displayPrice !== undefined
    ? selectedSpec.displayPrice
    : (selectedSpec && selectedSpec.effectiveMallPrice !== undefined ? selectedSpec.effectiveMallPrice : null);
  const rawDisplayPrice = selectedSpec
    ? selectedPriceSource
    : (requiresSpecSelection ? "" : (item.displayPrice !== undefined
      ? item.displayPrice
      : (item.price !== undefined ? item.price : item.salePrice)));
  const demoProduct = isDemoProduct(item);
  const displayPrice = isInternalPlaceholder(rawDisplayPrice) ? "" : rawDisplayPrice;
  const priceAccess = item.priceAccess;
  const canViewPrice = !!(priceAccess && priceAccess.canViewPrice === true);
  const priceVisible = !demoProduct
    && canViewPrice
    && !requiresSpecSelection
    && (selectedSpec ? selectedSpec.priceVisible === true : item.priceVisible === true)
    && parsePrice(displayPrice) > 0;
  const stockSource = Object.assign({}, item, selectedSpec || {});
  const stockText = safeText(stockTextFor(stockSource, "库存以结算时为准"), "库存以结算时为准");
  const recentPriceText = safeText(item.recentPriceText, "");
  const canOrderByStock = stockSource.canOrderByStock !== false && stockSource.stockStatus !== "OUT_OF_STOCK";
  const productId = String(item.productId || item.id || "");
  const productUnitId = String((selectedSpec && selectedSpec.productUnitId) || "");
  const allowDecimalQuantity = !!((selectedSpec && selectedSpec.allowDecimalQuantity) || item.allowDecimalQuantity);
  const minOrderQtyValue = Number((selectedSpec && (selectedSpec.minOrderQty || selectedSpec.mallMinOrderQty)) || item.minOrderQty || item.mallMinOrderQty || 1);
  const minOrderQty = allowDecimalQuantity ? null : (Number.isFinite(minOrderQtyValue) && minOrderQtyValue > 0 ? minOrderQtyValue : 1);
  const canQuickAdd = !!productId
    && !!productUnitId
    && !requiresSpecSelection
    && !demoProduct
    && !coreNotSellable
    && item.canOrder !== false
    && (!selectedSpec || selectedSpec.canOrder !== false)
    && priceVisible
    && canOrderByStock;
  const priceUnavailableText = coreNotSellable
    ? "暂无报价"
    : canViewPrice
      ? SAFE_PRICE_UNAVAILABLE_MESSAGE
      : "登录认证后查看";
  const actionText = requiresSpecSelection
    ? "请选择单位"
    : (canQuickAdd ? "加入购物车" : (priceVisible ? stockText : priceUnavailableText));
  const selectedSpecLabel = selectedSpec ? buildSpecLabel(selectedSpec) : "";
  const selectedSpecSecondaryLabel = selectedSpec ? buildSpecSecondaryLabel(selectedSpec, item.baseUnit, item.saleMode) : "";
  const compactSpec = safeText(
    selectedSpecLabel || (sellableSpecCount > 1 ? `${sellableSpecCount}个单位可选` : item.spec || item.specification),
    "规格待维护",
  );
  const compactUnitName = selectedSpec ? safeText(selectedSpec.unitName, "件") : (sellableSpecCount > 1 ? "请选择" : safeText(item.unitName || item.unit, "件"));
  const unitDisplayText = selectedSpecLabel || compactUnitName || compactSpec;
  const compactMinOrderText = allowDecimalQuantity ? "可输小数" : `起订 ${minOrderQty}`;
  const primaryStatusText = requiresSpecSelection
    ? "请选择单位"
    : (canQuickAdd ? stockText : (coreNotSellable ? "暂无报价" : (priceVisible ? stockText : (canViewPrice ? "暂不可购买" : "登录后查看价格"))));
  return Object.assign({}, item, {
    productId,
    productUnitId,
    lineKey: productUnitId ? `${productId}:${productUnitId}` : productId,
    categoryId: item.categoryId || item.mallCategoryId || "",
    name: safeText(item.name || item.productName, "未命名商品"),
    imageUrl: resolveMallAssetUrl(
      item.imageUrl
      || item.effectiveImageUrl
      || item.primaryImageUrl
      || (Array.isArray(item.images) && item.images[0] && item.images[0].url)
      || item.image,
    ),
    spec: compactSpec,
    selectedSpecName: safeText((selectedSpec && selectedSpec.specName) || item.unitSpecName, ""),
    unitName: compactUnitName,
    unitDisplayText,
    unitSecondaryText: selectedSpecSecondaryLabel,
    compactMetaText: [selectedSpecSecondaryLabel, compactMinOrderText].filter(Boolean).join(" · "),
    minOrderQty,
    minOrderText: allowDecimalQuantity ? "可输入任意正数小数" : `起订量 ${minOrderQty}`,
    allowDecimalQuantity,
    quantityScale: allowDecimalQuantity ? 4 : 0,
    quantityStep: 1,
    displayPrice: priceVisible ? displayPrice : "",
    priceVisible,
    priceText: priceVisible ? `¥${parsePrice(displayPrice).toFixed(2)}` : "",
    priceUnitText: priceVisible && compactUnitName !== "请选择" ? `/${compactUnitName}` : "",
    priceValue: priceVisible ? parsePrice(displayPrice) : 0,
    icon: safeText(item.icon, "品"),
    stockText: requiresSpecSelection ? "多规格，请先选择" : stockText,
    tags: normalizeTags(item.tags, priceVisible, requiresSpecSelection ? ["多规格"] : []),
    recentPriceText,
    priceHintText: requiresSpecSelection ? "多规格" : (priceVisible ? "价格" : priceUnavailableText),
    priceUnavailableText,
    sellableSpecCount,
    sellableSpecs,
    requiresSpecSelection,
    canOrder: canQuickAdd,
    canAddToCart: canQuickAdd,
    canOrderByStock,
    isFallback: !!item.isFallback || demoProduct,
    isDemo: !!item.isDemo || demoProduct,
    isMock: !!item.isMock || demoProduct,
    actionText,
    primaryStatusText,
    cartQuantity: Number(item.cartQuantity || 0),
    cartQuantityText: formatQuantity(item.cartQuantity),
    imageFailed: false,
  });
}

function normalizeCategory(item, index) {
  const name = safeText(item.name || item.categoryName, "未命名分类");
  const badge = safeText(item.badge || item.tag, "");
  const icon = safeText(item.icon || item.iconText, name.slice(0, 1));
  return {
    id: item.id || item.categoryId || "",
    parentId: item.parentId || "",
    level: Number(item.level || 1),
    name,
    icon,
    imageFallbackText: icon,
    imageUrl: resolveMallAssetUrl(item.imageUrl || item.iconUrl || item.image),
    imageFailed: false,
    badge,
    productCount: Number(item.productCount || 0),
  };
}

function customerCatalogContext(result) {
  const customer = result.customer || {};
  const member = result.member || {};
  const access = result.priceAccess || {};
  return JSON.stringify([
    result.customerStatus, (result.mallStorefront || {}).id, (result.binding || {}).id,
    customer.id, customer.priceLevel, member.memberId, member.memberStatus, member.memberRole,
    access.canViewPrice === true, !!access.canOrder,
  ]);
}

Page({
  data: {
    storefrontCode: "zhenshang",
    customerMode: "GUEST",
    customerCanViewPrice: false,
    customerLoadError: "",
    categories: DEFAULT_CATEGORIES,
    allCategories: [],
    subcategories: [],
    brands: [],
    activeCategoryId: "",
    activeRootCategoryId: "",
    activeSubcategoryId: "",
    activeCategoryName: "全部商品",
    activeCategoryPath: "全部商品",
    activeBrand: "",
    activeSection: "all",
    activeSort: "default",
    draftBrand: "",
    draftSort: "default",
    filterPanelOpen: false,
    sortOptions: [
      { key: "default", label: "默认" },
      { key: "sales", label: "销量" },
      { key: "latest", label: "最新" },
    ],
    products: [],
    keyword: "",
    loading: false,
    page: 1,
    pageSize: 30,
    hasNextPage: false,
    total: 0,
    cartCount: 0,
    cartAmountText: "预计 ¥0.00",
    productLoadError: "",
    failedProductPage: 0,
    categoryLoadError: "",
  },

  _categoriesLoaded: false,
  _hasShownOnce: false,

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    const options = query || {};
    const entrance = resolveStorefrontEntrance(options);
    this.setData({
      storefrontCode: entrance.storefrontCode,
      activeCategoryId: options.categoryId || "",
      activeBrand: decodeEntranceText(options.brand),
      activeSection: options.section || "all",
      keyword: decodeEntranceText(options.keyword),
    });
    this.refreshCanonicalState();
  },

  onShow() {
    if (this._disposed) return;
    this._inactive = false;
    this._navigatingProductDetail = false;
    this._navigatingCart = false;
    this.loadCustomerState();
    this.refreshCart();
    if (this._searchPending) this.loadProducts(true);
    // Preserve category/filter/page/scroll state after product detail return.
    this._hasShownOnce = true;
  },

  onHide() {
    this._inactive = true;
    this._customerRequestId = (this._customerRequestId || 0) + 1;
    this.setData({ customerCanViewPrice: false, customerMode: "RESOLVING" });
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    if (this.data.filterPanelOpen) this.setData({ filterPanelOpen: false });
  },

  onUnload() {
    this._disposed = true;
    this._inactive = true;
    this._customerRequestId = (this._customerRequestId || 0) + 1;
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = null;
    this._productRequestId = (this._productRequestId || 0) + 1;
    this._categoryRequestId = (this._categoryRequestId || 0) + 1;
    this._navigatingProductDetail = false;
    this._navigatingCart = false;
  },

  onPullDownRefresh() {
    this.refreshCanonicalState({ fromPull: true });
  },

  refreshCanonicalState(options) {
    const opts = options || {};
    return this.loadCategories()
      .then(() => { if (!this._disposed) return this.loadProducts(true); })
      .finally(() => {
        if (opts.fromPull && typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      });
  },

  loadCustomerState() {
    if (this._disposed || this._inactive) return Promise.resolve();
    const requestId = this._customerRequestId = (this._customerRequestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && !this._inactive
      && requestId === this._customerRequestId && code === this.data.storefrontCode;
    this.setData({ customerMode: "RESOLVING", customerCanViewPrice: false, customerLoadError: "" });
    return getMallMe(code, "CATEGORY_PAGE")
      .then((result) => {
        if (!current()) return;
        const approved = result.customerStatus === "APPROVED_BOUND_CUSTOMER";
        const canOrder = approved
          && !!(result.priceAccess && result.priceAccess.canOrder);
        const context = customerCatalogContext(result);
        const changed = this._catalogCustomerContext !== undefined && this._catalogCustomerContext !== context;
        const refresh = changed || this._searchPending
          || (this._catalogCustomerContext === undefined && this._categoriesLoaded);
        this._catalogCustomerContext = context;
        if (refresh) this.clearCustomerCatalog();
        this.setData({
          customerMode: canOrder ? "BOUND" : approved ? "VIEW_ONLY" : "GUEST",
          customerCanViewPrice: approved && !!(result.priceAccess && result.priceAccess.canViewPrice === true),
        });
        this.refreshCart();
        if (refresh) return this.loadProducts(true);
      })
      .catch(() => {
        if (!current()) return;
        this._catalogCustomerContext = null;
        this.clearCustomerCatalog();
        this.setData({ customerMode: "GUEST", customerCanViewPrice: false, customerLoadError: "客户状态确认失败，请重试后查看商品价格。" });
      });
  },

  clearCustomerCatalog() {
    this._productRequestId = (this._productRequestId || 0) + 1;
    this.setData({ products: [], page: 1, total: 0, hasNextPage: false, loading: false, productLoadError: "", failedProductPage: 0 });
  },

  retryCustomerState() {
    return this.loadCustomerState();
  },

  refreshCart() {
    const items = getCartItems(this.data.storefrontCode);
    const count = getCartCount(this.data.storefrontCode);
    const total = items.reduce((sum, item) => item.priceVisible ? sum + parsePrice(item.displayPrice) * Number(item.quantity || 0) : sum, 0);
    this.setData({
      cartCount: count,
      cartAmountText: `预计 ¥${total.toFixed(2)}`,
    });
  },

  loadCategories() {
    const requestId = this._categoryRequestId = (this._categoryRequestId || 0) + 1;
    return getCategories(this.data.storefrontCode)
      .then((result) => {
        if (this._disposed || requestId !== this._categoryRequestId) return;
        const allCategories = (result.items || result.categories || []).map(normalizeCategory).filter((item) => item.id);
        const rootCategories = allCategories
          .filter((item) => !item.parentId)
          .map((item) => ({
            ...item,
            childCount: allCategories.filter((candidate) => candidate.parentId === item.id).length,
          }));
        const selected = allCategories.find((item) => item.id === this.data.activeCategoryId);
        const activeRootCategoryId = selected && selected.parentId ? selected.parentId : (selected ? selected.id : "");
        const subcategories = activeRootCategoryId
          ? allCategories.filter((item) => item.parentId === activeRootCategoryId)
          : [];
        const brands = (Array.isArray(result.brands) ? result.brands : [])
          .map((brand) => safeText(brand, ""))
          .filter((brand, index, source) => brand && source.indexOf(brand) === index);
        const activeBrand = brands.includes(this.data.activeBrand) ? this.data.activeBrand : "";
        this._categoriesLoaded = true;
        this.setData({
          categoryLoadError: "",
          allCategories,
          categories: DEFAULT_CATEGORIES.concat(rootCategories),
          activeCategoryId: selected ? selected.id : "",
          activeRootCategoryId,
          activeSubcategoryId: selected && selected.parentId ? selected.id : "",
          activeCategoryName: selected ? selected.name : "全部商品",
          activeCategoryPath: selected
            ? (selected.parentId
              ? `${(allCategories.find((item) => item.id === selected.parentId) || {}).name || "分类"} / ${selected.name}`
              : `${selected.name} / 全部`)
            : "全部商品",
          subcategories,
          brands,
          activeBrand,
        });
      })
      .catch(() => {
        if (this._disposed || requestId !== this._categoryRequestId) return;
        this._categoriesLoaded = false;
        this.setData({
          categoryLoadError: "分类加载失败，请重试。已选条件保持不变。",
        });
      });
  },

  loadProducts(reset) {
    if (this._disposed || this._catalogCustomerContext === null || this.data.customerMode === "RESOLVING") return Promise.resolve();
    if (reset === false && this.data.loading) return;
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = null;
    this._searchPending = false;
    const nextPage = reset === false ? this.data.page + 1 : 1;
    this._productRequestId = (this._productRequestId || 0) + 1;
    const requestId = this._productRequestId;
    this.setData(reset === false ? { loading: true, productLoadError: "", failedProductPage: 0 } : {
      loading: true,
      products: [],
      page: 1,
      total: 0,
      hasNextPage: false,
      productLoadError: "",
      failedProductPage: 0,
    });
    return getProducts(this.data.storefrontCode, {
      categoryId: this.data.activeCategoryId,
      keyword: this.data.keyword,
      brandName: this.data.activeBrand,
      section: this.data.activeSection,
      sort: this.data.activeSort,
      page: nextPage,
      pageSize: this.data.pageSize,
    })
      .then((result) => {
        if (requestId !== this._productRequestId) return;
        const nextProducts = (result.items || result.products || []).map(normalizeProduct).filter((item) => item.productId);
        const products = reset === false
          ? this.data.products.concat(nextProducts).filter((item, index, source) => source.findIndex((candidate) => candidate.lineKey === item.lineKey) === index)
          : nextProducts;
        const responseTotal = Number(result.total);
        this.setData({
          products,
          page: Number(result.page || nextPage),
          total: Number.isFinite(responseTotal) ? responseTotal : products.length,
          hasNextPage: nextProducts.length > 0 && Boolean(result.hasNextPage),
          productLoadError: "",
          failedProductPage: 0,
        });
      })
      .catch(() => {
        if (requestId !== this._productRequestId) return;
        this.setData({
          products: reset === false ? this.data.products : [],
          productLoadError: "商品加载失败，请刷新或联系业务员",
          failedProductPage: nextPage,
          hasNextPage: reset === false ? this.data.hasNextPage : false,
          ...(reset === false ? {} : { page: 1, total: 0 }),
        });
      })
      .finally(() => {
        if (requestId === this._productRequestId) this.setData({ loading: false });
      });
  },

  selectCategory(event) {
    const id = event.currentTarget.dataset.id || "";
    const subcategories = id ? this.data.allCategories.filter((item) => item.parentId === id) : [];
    const selected = this.data.allCategories.find((item) => item.id === id);
    if (id && (!selected || selected.parentId)) return;
    this.setData({
      activeCategoryId: id,
      activeRootCategoryId: id,
      activeSubcategoryId: "",
      activeCategoryName: selected ? selected.name : "全部商品",
      activeCategoryPath: selected ? `${selected.name} / 全部` : "全部商品",
      subcategories,
    }, () => this.loadProducts(true));
  },

  onCategoryImageError(event) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    const markFailed = (items) => (Array.isArray(items) ? items.map((item) => (
      String(item.id) === id ? Object.assign({}, item, { imageFailed: true }) : item
    )) : []);
    this.setData({
      categories: markFailed(this.data.categories),
      allCategories: markFailed(this.data.allCategories),
    });
  },

  selectSubcategory(event) {
    const id = event.currentTarget.dataset.id || "";
    if (!id) return;
    const selected = this.data.allCategories.find((item) => item.id === id);
    if (!selected || selected.parentId !== this.data.activeRootCategoryId) return;
    const root = this.data.allCategories.find((item) => item.id === selected.parentId);
    this.setData({
      activeCategoryId: id,
      activeSubcategoryId: id,
      activeCategoryName: selected.name,
      activeCategoryPath: `${root ? root.name : "分类"} / ${selected.name}`,
    }, () => this.loadProducts(true));
  },

  openFilter() {
    this.setData({
      draftBrand: this.data.activeBrand,
      draftSort: this.data.activeSort,
      filterPanelOpen: true,
    });
  },

  closeFilter() {
    this.setData({ filterPanelOpen: false });
  },

  stopBubble() {},

  selectDraftBrand(event) {
    this.setData({ draftBrand: event.currentTarget.dataset.brand || "" });
  },

  selectDraftSort(event) {
    const sort = event.currentTarget.dataset.sort || "default";
    if (!this.data.sortOptions.some((option) => option.key === sort)) return;
    this.setData({ draftSort: sort });
  },

  selectSort(event) {
    const sort = event.currentTarget.dataset.sort || "default";
    if (!this.data.sortOptions.some((option) => option.key === sort) || sort === this.data.activeSort) return;
    this.setData({ activeSort: sort, draftSort: sort }, () => this.loadProducts(true));
  },

  resetFilter() {
    this.setData({ draftBrand: "", draftSort: "default" });
  },

  applyFilter() {
    this.setData({
      activeBrand: this.data.draftBrand,
      activeSort: this.data.draftSort,
      filterPanelOpen: false,
    }, () => this.loadProducts(true));
  },

  inputKeyword(event) {
    const keyword = event.detail.value || "";
    // Invalidate immediately, before the debounce can dispatch the next query.
    this._productRequestId = (this._productRequestId || 0) + 1;
    this._searchPending = true;
    this.setData({ keyword, products: [], loading: true, page: 1, total: 0, hasNextPage: false, productLoadError: "", failedProductPage: 0 });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.loadProducts(true);
    }, 320);
  },

  search() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.loadProducts(true);
  },

  clearKeyword() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ keyword: "" }, () => this.loadProducts(true));
  },

  retryProducts() {
    if (this.data.loading) return Promise.resolve();
    return this.loadProducts(this.data.failedProductPage <= 1);
  },

  retryCategories() {
    return this.refreshCanonicalState();
  },

  loadMore() {
    if (this.data.hasNextPage && !this.data.loading) return this.loadProducts(false);
  },

  goProduct(event) {
    const productId = String(event.currentTarget.dataset.id || "");
    if (!productId || this._navigatingProductDetail) return;
    this._navigatingProductDetail = true;
    wx.navigateTo({
      url: `/pages/product/detail?id=${productId}&storefrontCode=${this.data.storefrontCode}`,
      fail: (error) => {
        // WeChat can report a timeout while the destination webview is still mounting.
        // Re-check the native route before showing a failure to avoid a false blocker.
        const reconcileNavigation = () => {
          const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
          const current = pages[pages.length - 1];
          const detailOpened = current && current.route === "pages/product/detail"
            && String((current.options && current.options.id) || "") === productId;
          this._navigatingProductDetail = false;
          if (!detailOpened) wx.showToast({ title: "商品详情打开失败，请重试", icon: "none" });
        };
        if (/timeout/i.test(String(error?.errMsg || ""))) setTimeout(reconcileNavigation, 500);
        else reconcileNavigation();
      },
    });
  },

  onImageError(event) {
    const productId = String(event.currentTarget.dataset.id || "");
    if (!productId) return;
    this.setData({
      products: this.data.products.map((item) => item.productId === productId
        ? Object.assign({}, item, { imageFailed: true })
        : item),
    });
  },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goCart() {
    if (this._navigatingCart) return;
    this._navigatingCart = true;
    wx.redirectTo({
      url: `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}`,
      fail: () => {
        this._navigatingCart = false;
        wx.showToast({ title: "购物车打开失败，请重试", icon: "none" });
      },
    });
  },

  goOrders() {
    wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    wx.navigateTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },
});
