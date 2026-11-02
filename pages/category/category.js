const { getCategories, getMallMe, getProducts, resolveMallAssetUrl, SAFE_PRICE_UNAVAILABLE_MESSAGE } = require("../../utils/request");
const { getCartCount, getCartItems } = require("../../utils/cart");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
// 本地演示脚手架：后端有数据用后端，后端为空时用本地演示内容兜底（详见 scaffold/index.js）
// 注意：小程序 require 不支持目录索引解析，必须写全 index.js
const scaffold = require("../../scaffold/index.js");
// 分类图标映射：独立零依赖模块（utils/category-icons.js），与首页宫格共用同一份
const { categoryIconPath, DEFAULT_CATEGORY_ICON } = require("../../utils/category-icons");

const DEFAULT_CATEGORIES = [
  { id: "", name: "全部商品", icon: "全", badge: "" },
];

// 滑动联动：scrollTop 越过某分区顶部这么多 px，即认定该分区成为当前分区
const SECTION_ACTIVATE_OFFSET = 8;
// 二级分类同理：二级小标题越过顶部这么多 px 才切高亮，避免标题线附近来回抖
const SUB_ACTIVATE_OFFSET = 8;
// 二级高亮节流（ms）：scroll 事件很密，二级计算最多这么频繁地回写一次；
// 采用「首次立即 + 末尾补一次」的节流，快速滑动停下来后最终高亮一定正确
const SUB_HIGHLIGHT_THROTTLE = 160;
// 点击左栏后的滚动锁时长：平滑滚动动画期间不按 scrollTop 回写高亮，避免高亮乱跳
const PANE_LOCK_DURATION = 600;

// 二级分类分组的锚点 id：必须全局唯一，所以带上父分类 id
function subAnchor(parentId, subId) {
  return `sub-sec-${parentId || "all"}-${subId}`;
}

// 商品挂在哪一个二级分类下。字段优先级：
// subCategoryId（后端主字段）→ mallSubCategoryId / leafCategoryId → 嵌套 subCategory
// → subCategoryName 按名字匹配本区二级 → categoryId（且必须确实等于本区某个二级 id）。
// 名字 / categoryId 这两种兜底都只在「确实命中本区二级」时才采用，
// 避免把一级 id 或一级名称误当二级用。
function resolveProductSubId(product, knownIds, knownNames) {
  if (!product) return "";
  const direct = safeText(
    product.subCategoryId || product.mallSubCategoryId || product.leafCategoryId,
    "",
  );
  if (direct) return direct;
  const nested = product.subCategory;
  const nestedId = safeText(nested && (nested.id || nested.categoryId), "");
  if (nestedId) return nestedId;
  const subName = safeText(product.subCategoryName, "");
  if (subName && knownNames && knownNames[subName]) return knownNames[subName];
  const own = safeText(product.categoryId, "");
  if (own && knownIds && knownIds[own]) return own;
  return "";
}

// ---- 一级分类图标 ----------------------------------------------------------
// 图标来自设计师交付的 assets/icons/icon-*.png（统一 128x128 透明画布、内容等比居中），
// 名称 → 图标的映射表与兜底逻辑统一放在 utils/category-icons.js 的 categoryIconPath()，
// 首页分类宫格和本页左栏共用同一份，避免两处规则漂移。

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
    imageUrl: scaffold.demoAwareAssetUrl(
      item,
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
    // 第二行补充说明：有选中规格时用换算说明；没有选中规格（游客态 / 无可售规格）时补上规格文案
    compactMetaText: [selectedSpecSecondaryLabel, (selectedSpec ? "" : compactSpec), compactMinOrderText].filter(Boolean).join(" · "),
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
  // 图标优先级：后端返回的分类图 → 本地名称映射图标 → icon-default 兜底
  const iconPath = scaffold.demoAwareAssetUrl(item, item.imageUrl || item.iconUrl || item.image)
    || categoryIconPath(name);
  return {
    id: item.id || item.categoryId || "",
    parentId: item.parentId || "",
    level: Number(item.level || 1),
    name,
    icon,
    // 左栏与首页共用：本地图标路径（永远非空，匹配不到就是 icon-default.png）
    iconPath,
    iconFailed: false,
    imageFallbackText: icon,
    imageUrl: iconPath,
    imageFailed: false,
    isDemo: item.__demo === true,
    badge,
    productCount: Number(item.productCount || 0),
  };
}

// 「全部商品」静态项也走同一套归一化，保证图标字段齐全
function buildDefaultCategories() {
  return DEFAULT_CATEGORIES.map((item) => normalizeCategory({
    id: item.id,
    name: item.name,
    iconText: item.icon,
  }));
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
    categories: buildDefaultCategories(),
    allCategories: [],
    subcategories: [],
    brands: [],
    activeCategoryId: "",
    activeRootCategoryId: "",
    // 当前高亮的二级分类 id（由滑动联动写入，或点击左栏二级写入）
    activeSubcategoryId: "",
    // 当前高亮的二级分类索引：-1 表示还没进入任何二级分组（此时左栏「本区全部」高亮）
    activeSubIndex: -1,
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
    // ---- 左右联动分区（分区模式）--------------------------------------------
    // 每个一级分类一个区块，右栏按区块渲染，滑动 / 点击双向联动
    sections: [],
    activeIndex: 0,
    activeSectionId: "",
    // 左栏 scroll-into-view 目标（滑动联动时让高亮项保持可见）
    activeSideId: "",
    // 右栏 scroll-into-view 目标（点击左栏时定位到对应分区）
    paneIntoView: "",
    paneAnimating: false,
    // 右栏实测高度（px）：flex 定高后回写，供分区偏移换算使用
    paneHeight: 0,
    // 搜索 / 品牌 / 排序 / 二级分类任一命中时，右栏退化为「单区结果列表」
    singleMode: false,
    cartCount: 0,
    cartAmountText: "预计 ¥0.00",
    productLoadError: "",
    failedProductPage: 0,
    categoryLoadError: "",
  },

  _categoriesLoaded: false,
  _hasShownOnce: false,
  // 分区模式运行期状态：刻意不放进 data，避免高频 setData 引起抖动
  _sectionTops: [],
  _sectionPending: {},
  _sectionsGeneration: 0,
  _paneScrollTop: 0,
  _paneLocked: false,
  _paneLockTimer: null,
  // 二级分类偏移：只量「当前高亮分区」的二级分组，量完记下它属于哪个分区，
  // 分区一变就作废，防止用旧分区的偏移算新分区的高亮
  _subTops: [],
  _subTopsSectionId: "",
  _subTickAt: 0,
  _subTimer: null,

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    this._sectionTops = [];
    this._sectionPending = {};
    this._sectionsGeneration = 0;
    this._paneScrollTop = 0;
    this._paneLocked = false;
    this._subTops = [];
    this._subTopsSectionId = "";
    this._subTickAt = 0;
    this._subTimer = null;
    const options = query || {};
    const entrance = resolveStorefrontEntrance(options);
    const keyword = decodeEntranceText(options.keyword);
    const activeBrand = decodeEntranceText(options.brand);
    this.setData({
      storefrontCode: entrance.storefrontCode,
      activeCategoryId: options.categoryId || "",
      activeBrand,
      activeSection: options.section || "all",
      keyword,
      // 带关键词 / 品牌进场时直接进单区结果列表，其余情况一律走分区联动
      singleMode: !!keyword || !!activeBrand,
    });
    this.refreshCanonicalState();
  },

  onShow() {
    if (this._disposed) return;
    this._inactive = false;
    this._navigatingProductDetail = false;
    this._navigatingCart = false;
    this._paneLocked = false;
    this.loadCustomerState();
    this.refreshCart();
    if (this._searchPending) this.refreshCatalog(true);
    // 从商品详情返回后布局可能变化，重新量一次右栏高度与各分区位置
    this.afterRender(() => this.measurePane());
    // Preserve category/filter/page/scroll state after product detail return.
    this._hasShownOnce = true;
  },

  onHide() {
    this._inactive = true;
    this._customerRequestId = (this._customerRequestId || 0) + 1;
    this.clearPaneLock();
    this.clearSubThrottle();
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
    this.clearPaneLock();
    this.clearSubThrottle();
    this._productRequestId = (this._productRequestId || 0) + 1;
    this._categoryRequestId = (this._categoryRequestId || 0) + 1;
    this._sectionsGeneration = (this._sectionsGeneration || 0) + 1;
    this._navigatingProductDetail = false;
    this._navigatingCart = false;
  },

  onPullDownRefresh() {
    this.refreshCanonicalState({ fromPull: true });
  },

  refreshCanonicalState(options) {
    const opts = options || {};
    return this.loadCategories()
      .then(() => { if (!this._disposed) return this.refreshCatalog(true); })
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
        if (refresh) return this.refreshCatalog(true);
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
    // 客户状态 / 价格权限变化：作废所有在途分区请求，清空分区内容等待重取
    this._sectionsGeneration = (this._sectionsGeneration || 0) + 1;
    this._sectionPending = {};
    this._sectionTops = [];
    this._subTops = [];
    this._subTopsSectionId = "";
    this._paneScrollTop = 0;
    this.clearSubThrottle();
    this.setData({
      products: [],
      page: 1,
      total: 0,
      hasNextPage: false,
      loading: false,
      productLoadError: "",
      failedProductPage: 0,
      sections: this.buildSections(),
      activeIndex: 0,
      activeSectionId: "",
      activeSubcategoryId: "",
      activeSubIndex: -1,
      subcategories: [],
      paneIntoView: "",
    });
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
      .then((rawResult) => {
        if (this._disposed || requestId !== this._categoryRequestId) return;
        // 后端为空 / 只有内部验收分类时，用本地演示分类兜底
        const result = scaffold.applyCategories(rawResult);
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
        const rootCategoryList = buildDefaultCategories().concat(rootCategories).map((item) => Object.assign({}, item, {
          active: activeRootCategoryId === item.id || (!(selected ? selected.id : "") && !item.id),
        }));
        const activeSubcategoryId = selected && selected.parentId ? selected.id : "";
        this.setData({
          categoryLoadError: "",
          allCategories,
          categories: rootCategoryList,
          activeCategoryId: selected ? selected.id : "",
          activeRootCategoryId,
          activeSubcategoryId,
          activeCategoryName: selected ? selected.name : "全部商品",
          activeCategoryPath: selected
            ? (selected.parentId
              ? `${(allCategories.find((item) => item.id === selected.parentId) || {}).name || "分类"} / ${selected.name}`
              : `${selected.name} / 全部`)
            : "全部商品",
          subcategories,
          brands,
          activeBrand,
          // 带二级分类进场时属于「单区结果列表」，否则维持分区联动
          singleMode: this.resolveSingleMode({ activeSubcategoryId }),
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
    // 分区模式下商品由各分区自己懒加载，这里不再走单区查询
    if (!this.data.singleMode) {
      this._searchPending = false;
      return Promise.resolve();
    }
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
    }, () => {
      // 切换模式后内容整体换掉，滚回顶部，避免停留在旧偏移上看到结果尾部
      if (reset !== false) this.scrollPaneTo("pane-top", false);
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
      .then((rawResult) => {
        if (requestId !== this._productRequestId) return;
        // 后端该分类没有商品时，用本地演示商品兜底
        const result = scaffold.applyProducts(rawResult, {
          categoryId: this.data.activeCategoryId,
          keyword: this.data.keyword,
          brandName: this.data.activeBrand,
          section: this.data.activeSection,
          sort: this.data.activeSort,
          page: nextPage,
          pageSize: this.data.pageSize,
        });
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

  // ===== 左右联动：分区模式核心实现 ==========================================
  // 三个关键约束：
  // 1) 右栏高度不手写 calc：先由 flex（100vh − 顶部）定高，引擎按视口计算，
  //    刘海屏 / 安卓都天然正确；再实测回写 paneHeight 做兜底。
  // 2) 分区偏移用实测值：滚动联动靠 measureSections 量出的 offsetTop，
  //    不用估算高度，懒加载进来的分区高度变化也不会算错。
  // 3) 点击定位期间上滚动锁：平滑滚动动画中的中间位置不代表用户意图，
  //    锁内不按 scrollTop 回写高亮，避免左栏高亮乱跳。

  // 依据当前筛选条件判断是否退化为「单区结果列表」
  // 注意：二级分类不在此列。二级分类现在走「分区内定位到二级分组」，
  // 仍然保持左右联动，只有真正跨分区的全局筛选（关键词 / 品牌 / 排序）才降级。
  resolveSingleMode(overrides) {
    const next = Object.assign({
      keyword: this.data.keyword,
      activeBrand: this.data.activeBrand,
      activeSort: this.data.activeSort,
    }, overrides || {});
    return !!next.keyword || !!next.activeBrand || next.activeSort !== "default";
  },

  // 统一入口：按当前模式决定加载分区还是加载单区结果列表
  refreshCatalog(reset) {
    if (this.data.singleMode) return this.loadProducts(reset !== false);
    return this.reloadSections();
  },

  buildSections() {
    return (this.data.categories || []).map((category) => ({
      id: category.id,
      // 锚点 id：「全部商品」的一级 id 是空串，统一补 all 后缀保证 scroll-into-view 可用
      anchor: `sec-${category.id || "all"}`,
      name: category.name,
      iconPath: category.iconPath,
      products: [],
      // 二级分组：商品到位后由 buildSubGroups 生成，为空表示该分区不做二级分组
      subGroups: [],
      page: 0,
      total: 0,
      hasNextPage: false,
      status: "idle",
      loadingMore: false,
      error: "",
    }));
  },

  // 把分区商品按二级分类分组，供右栏渲染小标题 + 左栏二级联动。
  // 分组顺序 = 分类树顺序（与左栏二级列表一一对应），分不到二级的商品统一进「其他」。
  // 若一个商品都分不进任何二级（说明后端没返回二级归属），返回空数组退回扁平列表，
  // 不硬凑一堆「暂无商品」的空分组。
  buildSubGroups(sectionId, products) {
    if (!sectionId) return [];
    const children = (this.data.allCategories || []).filter((item) => item.parentId === sectionId);
    if (!children.length) return [];
    const groups = children.map((child) => ({
      key: child.id,
      id: child.id,
      name: child.name,
      anchor: subAnchor(sectionId, child.id),
      products: [],
    }));
    const byId = {};
    const byName = {};
    groups.forEach((group) => {
      byId[group.id] = group;
      byName[group.name] = group.id;
    });
    const extras = [];
    const extraByKey = {};
    (products || []).forEach((product) => {
      const subId = resolveProductSubId(product, byId, byName);
      if (subId && byId[subId]) {
        byId[subId].products.push(product);
        return;
      }
      const key = subId || "__other";
      if (!extraByKey[key]) {
        const known = subId ? (this.data.allCategories || []).find((item) => item.id === subId) : null;
        extraByKey[key] = {
          key,
          id: subId,
          name: known ? known.name : "其他",
          anchor: subAnchor(sectionId, key),
          products: [],
        };
        extras.push(extraByKey[key]);
      }
      extraByKey[key].products.push(product);
    });
    const matched = groups.reduce((sum, group) => sum + group.products.length, 0);
    if (!matched) return [];
    return groups.concat(extras);
  },

  // 重建分区骨架并拉起当前选中分区（首次进入 / 下拉刷新 / 客户态变化后调用）
  reloadSections() {
    if (this._disposed || this.data.singleMode) return Promise.resolve();
    this._sectionsGeneration = (this._sectionsGeneration || 0) + 1;
    this._sectionPending = {};
    this._sectionTops = [];
    this._subTops = [];
    this._subTopsSectionId = "";
    this._paneScrollTop = 0;
    this.clearPaneLock();
    this.clearSubThrottle();
    const sections = this.buildSections();
    const found = sections.findIndex((section) => section.id === this.data.activeRootCategoryId);
    const index = found < 0 ? 0 : found;
    const active = sections[index] || {};
    // 带二级分类进场（或刷新后恢复）时保留二级高亮，等该分区商品到位再落位到二级分组
    const carriedSub = (this.data.activeSubcategoryId
      && (this.data.allCategories || []).find((item) => item.id === this.data.activeSubcategoryId))
      || null;
    const carriedSubId = carriedSub && carriedSub.parentId === active.id ? carriedSub.id : "";
    this.setData({
      sections,
      activeIndex: index,
      activeSectionId: active.id || "",
      activeCategoryId: carriedSubId || active.id || "",
      activeRootCategoryId: active.id || "",
      activeSubcategoryId: carriedSubId,
      activeSubIndex: -1,
      activeCategoryName: carriedSub ? carriedSub.name : (active.name || "全部商品"),
      activeCategoryPath: carriedSub
        ? `${active.name || "分类"} / ${carriedSub.name}`
        : (active.id ? `${active.name} / 全部` : "全部商品"),
      subcategories: active.id ? (this.data.allCategories || []).filter((item) => item.parentId === active.id) : [],
      categories: (this.data.categories || []).map((item) => Object.assign({}, item, { active: item.id === active.id })),
      activeSideId: `cat-${active.id || "all"}`,
      paneIntoView: "",
      paneAnimating: false,
    }, () => {
      this.measurePane();
      // 首屏只取当前分区与它的下一个分区，其余等滚动 / 点击时再补
      this.ensureSection(index);
      this.ensureSection(index + 1);
      if (carriedSubId) {
        // 二级分组要等商品渲染出来才有锚点，所以先补该分区内容再落位
        this.ensureSection(index).then(() => {
          if (this._disposed || this.data.singleMode || this.data.activeRootCategoryId !== active.id) return;
          this.lockPane(PANE_LOCK_DURATION);
          this.setData({ paneIntoView: "" }, () => {
            if (this._disposed) return;
            this.setData({ paneIntoView: subAnchor(active.id, carriedSubId), paneAnimating: false }, () => {
              this.afterRender(() => this.measureSections());
            });
          });
        });
      } else if (active.anchor) {
        // 定位到当前分区顶部（下拉刷新 / 带 categoryId 进场都走同一条路）
        this.setData({ paneIntoView: active.anchor, paneAnimating: false });
      }
    });
    return Promise.resolve();
  },

  ensureSection(index) {
    if (this.data.singleMode) return Promise.resolve();
    const sections = this.data.sections || [];
    if (!Number.isInteger(index) || index < 0 || index >= sections.length) return Promise.resolve();
    const section = sections[index];
    if (!section || section.status === "loading" || section.status === "ready") return Promise.resolve();
    return this.fetchSection(index, 1);
  },

  // 点击靠后分类时先把它上方的分区补齐：上方空占位会让落位严重偏移
  ensureUpTo(index) {
    const tasks = [];
    for (let i = 0; i <= index; i += 1) tasks.push(this.ensureSection(i));
    return Promise.all(tasks);
  },

  fetchSection(index, page) {
    if (this._disposed || this.data.singleMode) return Promise.resolve();
    const section = (this.data.sections || [])[index];
    if (!section) return Promise.resolve();
    const generation = this._sectionsGeneration;
    this._sectionPending = this._sectionPending || {};
    this._sectionPending[section.anchor] = page;
    this.patchSection(index, page > 1 ? { loadingMore: true, error: "" } : { status: "loading", error: "" });
    const query = {
      categoryId: section.id,
      keyword: "",
      brandName: "",
      section: "all",
      sort: "default",
      page,
      pageSize: this.data.pageSize,
    };
    return getProducts(this.data.storefrontCode, query)
      .then((rawResult) => {
        if (this._disposed || generation !== this._sectionsGeneration) return;
        // 后端该分类没有商品时，用本地演示商品兜底
        const result = scaffold.applyProducts(rawResult, query);
        const nextProducts = (result.items || result.products || []).map(normalizeProduct).filter((item) => item.productId);
        const current = (this.data.sections || [])[index];
        if (!current) return;
        const products = page > 1
          ? current.products
            .concat(nextProducts)
            .filter((item, position, source) => source.findIndex((candidate) => candidate.lineKey === item.lineKey) === position)
          : nextProducts;
        const responseTotal = Number(result.total);
        this.patchSection(index, {
          products,
          // 二级分组与商品同步生成，保证锚点与商品分组永远是同一份数据
          subGroups: this.buildSubGroups(current.id, products),
          page: Number(result.page || page),
          total: Number.isFinite(responseTotal) ? responseTotal : products.length,
          hasNextPage: nextProducts.length > 0 && Boolean(result.hasNextPage),
          status: "ready",
          loadingMore: false,
          error: "",
        }, () => this.measureSections());
        // 顶部计数在分区模式下展示「当前分区已加载件数」
        if (index === this.data.activeIndex) this.setData({ total: products.length });
      })
      .catch(() => {
        if (this._disposed || generation !== this._sectionsGeneration) return;
        if (!(this.data.sections || [])[index]) return;
        this.patchSection(index, page > 1
          ? { loadingMore: false, error: "加载更多失败，请重试" }
          : { status: "error", loadingMore: false, error: "商品加载失败，请点击重试" });
      })
      .finally(() => {
        if (this._sectionPending) delete this._sectionPending[section.anchor];
      });
  },

  // 只改一个分区的字段，避免整表 sections 全量 setData
  patchSection(index, patch, callback) {
    const payload = {};
    Object.keys(patch).forEach((key) => { payload[`sections[${index}].${key}`] = patch[key]; });
    this.setData(payload, callback);
  },

  loadMoreSection(event) {
    const index = Number(event.currentTarget.dataset.index);
    const section = (this.data.sections || [])[index];
    if (!section || section.loadingMore || !section.hasNextPage) return;
    this.fetchSection(index, (section.page || 1) + 1);
  },

  retrySection(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.fetchSection(index, 1);
  },

  // 右栏高度：flex 定高后实测回写。高度始终来自真实布局盒，
  // 所以刘海屏 / 安全区 / 系统字体变化都不会把页面撑长。
  measurePane() {
    if (this._disposed || typeof wx.createSelectorQuery !== "function") return;
    wx.createSelectorQuery().in(this).select(".pane-scroll").boundingClientRect().exec((res) => {
      if (this._disposed) return;
      const rect = res && res[0];
      if (!rect || !rect.height) return;
      const height = Math.round(rect.height);
      if (height <= 0) return;
      if (height === this.data.paneHeight) {
        this.measureSections();
        return;
      }
      this.setData({ paneHeight: height }, () => this.measureSections());
    });
  },

  // 实测每个分区相对右栏内容顶部的偏移，供滑动联动换算 activeIndex；
  // 同一次 exec 里顺带量「当前高亮分区」的二级分组偏移，供二级联动换算 activeSubIndex。
  // 只量当前分区（约 3~5 个节点），不量全部二级，避免节点数随分类数膨胀。
  measureSections() {
    if (this._disposed || this.data.singleMode || typeof wx.createSelectorQuery !== "function") return;
    const sections = this.data.sections || [];
    if (!sections.length) return;
    const active = sections[this.data.activeIndex];
    const subGroups = (active && active.subGroups) || [];
    const query = wx.createSelectorQuery().in(this);
    query.select(".pane-scroll").boundingClientRect();
    sections.forEach((section) => query.select(`#${section.anchor}`).boundingClientRect());
    subGroups.forEach((group) => query.select(`#${group.anchor}`).boundingClientRect());
    query.exec((res) => {
      if (this._disposed) return;
      const pane = res && res[0];
      if (!pane) return;
      const scrollTop = this._paneScrollTop || 0;
      const tops = [];
      sections.forEach((section, index) => {
        const rect = res[index + 1];
        tops.push(rect && rect.top !== undefined
          ? Math.max(0, Math.round(rect.top - pane.top + scrollTop))
          : (tops[index - 1] || 0));
      });
      this._sectionTops = tops;
      const base = sections.length + 1;
      const subTops = [];
      subGroups.forEach((group, index) => {
        const rect = res[base + index];
        subTops.push(rect && rect.top !== undefined
          ? Math.max(0, Math.round(rect.top - pane.top + scrollTop))
          : (subTops[index - 1] || tops[this.data.activeIndex] || 0));
      });
      this._subTops = subTops;
      // 记下这批偏移属于哪个分区：分区一变就作废，不能用旧分区的偏移算新分区
      this._subTopsSectionId = active ? active.id : "";
      // 量完立刻按当前滚动位置校准一次二级高亮，不用等下一次 scroll 事件
      this.applySubHighlight();
    });
  },

  // 按 scrollTop 求出当前二级分组索引；-1 表示还没进入任何二级分组
  resolveSubIndex() {
    const subTops = this._subTops || [];
    const scrollTop = this._paneScrollTop || 0;
    let index = -1;
    for (let i = 0; i < subTops.length; i += 1) {
      if (subTops[i] <= scrollTop + SUB_ACTIVATE_OFFSET) index = i;
      else break;
    }
    return index;
  },

  // 把二级高亮写回 data：只在真正变化时才 setData，滑动过程中不会高频重渲染。
  // 顶部标题同步跟着二级走，保证「左栏高亮」与「顶部当前分类」永远是同一个状态。
  applySubHighlight() {
    if (this._disposed || this.data.singleMode || this._paneLocked) return;
    const active = (this.data.sections || [])[this.data.activeIndex];
    if (!active) return;
    // 该分区没有二级分组：不动高亮（换分区时 activateSection 已经清过）
    if (!active.subGroups || !active.subGroups.length) return;
    // 偏移还没量到当前分区：先不写，等 measureSections 的回调来算，避免用旧偏移算错
    if (this._subTopsSectionId !== active.id) return;
    const index = this.resolveSubIndex();
    const group = index >= 0 ? active.subGroups[index] : null;
    // group.key 用于高亮比对；查询用的 categoryId 优先取真实二级 id，
    // 「其他」这种合成分组没有二级 id，就退回本分区 id
    const subId = group ? group.key : "";
    if (index === this.data.activeSubIndex && subId === this.data.activeSubcategoryId) return;
    this.setData({
      activeSubIndex: index,
      activeSubcategoryId: subId,
      activeCategoryId: group && group.id ? group.id : active.id,
      activeCategoryName: group ? group.name : active.name,
      activeCategoryPath: group
        ? `${active.name} / ${group.name}`
        : (active.id ? `${active.name} / 全部` : "全部商品"),
    });
  },

  // 二级计算节流：scroll 事件很密，这里「首次立即 + 末尾补一次」，
  // 既不会被高频计算拖慢滑动，快速滑动停下后最终高亮也一定是对的。
  scheduleSubHighlight() {
    const now = Date.now();
    const elapsed = now - (this._subTickAt || 0);
    if (elapsed >= SUB_HIGHLIGHT_THROTTLE) {
      this._subTickAt = now;
      this.applySubHighlight();
      return;
    }
    if (this._subTimer) return;
    this._subTimer = setTimeout(() => {
      this._subTimer = null;
      this._subTickAt = Date.now();
      this.applySubHighlight();
    }, SUB_HIGHLIGHT_THROTTLE - elapsed);
  },

  clearSubThrottle() {
    if (this._subTimer) clearTimeout(this._subTimer);
    this._subTimer = null;
  },

  onPaneScroll(event) {
    const scrollTop = Number((event.detail && event.detail.scrollTop) || 0);
    this._paneScrollTop = scrollTop;
    if (this.data.singleMode || this._paneLocked) return;
    const tops = this._sectionTops || [];
    if (!tops.length) return;
    let index = 0;
    for (let i = 0; i < tops.length; i += 1) {
      if (tops[i] <= scrollTop + SECTION_ACTIVATE_OFFSET) index = i;
      else break;
    }
    if (index !== this.data.activeIndex) {
      // 换一级分区：先把二级高亮收回「本区全部」，重亮相后由 measureSections 校准
      this.activateSection(index, false);
      return;
    }
    this.scheduleSubHighlight();
  },

  // 分区高亮：scrollSide=false 由滚动触发（左栏跟随滚动到可见），true 由点击触发
  activateSection(index, scrollSide) {
    if (this.data.singleMode) return;
    const sections = this.data.sections || [];
    if (!Number.isInteger(index) || index < 0 || index >= sections.length) return;
    const target = sections[index];
    if (!scrollSide && index === this.data.activeIndex && this.data.activeSectionId === target.id) return;
    // 换分区先作废旧分区的二级偏移，避免用旧偏移算新分区的高亮
    this._subTops = [];
    this._subTopsSectionId = "";
    this.clearSubThrottle();
    this.setData({
      activeIndex: index,
      activeSectionId: target.id,
      activeCategoryId: target.id,
      activeRootCategoryId: target.id,
      activeCategoryName: target.name,
      activeCategoryPath: target.id ? `${target.name} / 全部` : "全部商品",
      // 换一级分区时二级高亮收回「本区全部」，再由滚动 / 点击重新定位
      activeSubcategoryId: "",
      activeSubIndex: -1,
      subcategories: target.id ? (this.data.allCategories || []).filter((item) => item.parentId === target.id) : [],
      activeSideId: `cat-${target.id || "all"}`,
      categories: (this.data.categories || []).map((item) => Object.assign({}, item, { active: item.id === target.id })),
      // 分区模式下 total 表示当前分区已加载件数
      total: target.products.length,
    });
    // 新分区的二级分组渲染完才量得到偏移，量完 applySubHighlight 会立刻校准高亮
    this.afterRender(() => this.measureSections());
    // 当前分区必须补上（滚到只看到标题时就该出内容），再预取下一个分区。
    // 只向下预取：上方分区高度不再变化，已测出的 offsetTop 不会失效
    this.ensureSection(index);
    this.ensureSection(index + 1);
  },

  // 点击左栏二级分类：平滑定位到该二级分组（分区模式；单区模式另走查询）
  jumpToSubgroup(sectionIndex, subId) {
    const sections = this.data.sections || [];
    const section = sections[sectionIndex];
    const child = (this.data.allCategories || []).find((item) => item.id === subId);
    if (!section) return;
    // 先给左栏即时反馈，避免补数据期间像「没点上」
    this.activateSection(sectionIndex, true);
    this.setData({
      activeSubcategoryId: subId,
      activeSubIndex: -1,
      activeCategoryId: subId,
      activeCategoryName: child ? child.name : section.name,
      activeCategoryPath: child ? `${section.name} / ${child.name}` : section.name,
    });
    this.lockPane(PANE_LOCK_DURATION);
    this.ensureUpTo(sectionIndex).then(() => {
      if (this._disposed || this.data.singleMode) return;
      if (this.data.activeSectionId !== section.id) return;
      // scroll-into-view 值先清空再赋值，保证连续点同一二级也能重新定位
      this.setData({ paneIntoView: "" }, () => {
        if (this._disposed) return;
        this.setData({ paneIntoView: subAnchor(section.id, subId), paneAnimating: true }, () => {
          this.afterRender(() => this.measureSections());
          // 补数据耗时可能已超过首把锁，这里重新计时覆盖滚动动画
          this.lockPane(PANE_LOCK_DURATION);
        });
      });
    });
  },

  jumpToSection(index) {
    const section = (this.data.sections || [])[index];
    if (!section) return;
    // 先给左栏即时反馈，避免补数据期间像「没点上」
    this.activateSection(index, true);
    this.lockPane(PANE_LOCK_DURATION);
    this.ensureUpTo(index).then(() => {
      if (this._disposed || this.data.singleMode) return;
      // scroll-into-view 值先清空再赋值，保证连续点同一分类也能重新定位
      this.setData({ paneIntoView: "" }, () => {
        if (this._disposed) return;
        this.setData({ paneIntoView: section.anchor, paneAnimating: true }, () => {
          this.afterRender(() => this.measureSections());
          // 补数据耗时可能已超过首把锁，这里重新计时覆盖滚动动画
          this.lockPane(PANE_LOCK_DURATION);
        });
      });
    });
  },

  // 滚动锁：点击定位的平滑滚动期间不按 scrollTop 回写高亮
  lockPane(duration) {
    this._paneLocked = true;
    if (this._paneLockTimer) clearTimeout(this._paneLockTimer);
    this._paneLockTimer = setTimeout(() => {
      this._paneLockTimer = null;
      this._paneLocked = false;
      // 解锁后用最新布局校准偏移，下一次滚动即可精准换高亮
      this.measureSections();
    }, duration);
  },

  clearPaneLock() {
    if (this._paneLockTimer) clearTimeout(this._paneLockTimer);
    this._paneLockTimer = null;
    this._paneLocked = false;
  },

  afterRender(callback) {
    if (typeof wx.nextTick === "function") wx.nextTick(callback);
    else setTimeout(callback, 0);
  },

  // 右栏定位：scroll-into-view 的值必须先变一次才会生效，
  // 所以统一走「先清空再赋值」，连续跳同一锚点也有效。
  scrollPaneTo(anchor, animate) {
    if (!anchor) return;
    this.setData({ paneIntoView: "" }, () => {
      if (this._disposed) return;
      this.setData({ paneIntoView: anchor, paneAnimating: animate !== false });
    });
  },

  // 左栏选中态在 JS 侧算好，避免 WXML 里重复写三遍同样的判断
  syncCategoryActive(activeRootId, activeCategoryId) {
    const rootId = activeRootId === undefined ? this.data.activeRootCategoryId : activeRootId;
    const anyId = activeCategoryId === undefined ? this.data.activeCategoryId : activeCategoryId;
    this.setData({
      categories: (this.data.categories || []).map((item) => Object.assign({}, item, {
        active: rootId === item.id || (!anyId && !item.id),
      })),
    });
  },

  selectCategory(event) {
    const id = event.currentTarget.dataset.id || "";
    const selected = this.data.allCategories.find((item) => item.id === id);
    if (id && (!selected || selected.parentId)) return;
    if (!this.data.singleMode) {
      // 分区模式：右侧平滑定位到该分区，左栏高亮由滚动回写，二者天然一致
      const sections = this.data.sections || [];
      const index = sections.findIndex((section) => section.id === id);
      if (index < 0) return;
      this.jumpToSection(index);
      return;
    }
    // 单区模式下点左栏 = 换 categoryId 重新查询（沿用原有行为）
    const subcategories = id ? this.data.allCategories.filter((item) => item.parentId === id) : [];
    this.setData({
      activeCategoryId: id,
      activeRootCategoryId: id,
      activeSubcategoryId: "",
      activeCategoryName: selected ? selected.name : "全部商品",
      activeCategoryPath: selected ? `${selected.name} / 全部` : "全部商品",
      subcategories,
      activeSideId: `cat-${id || "all"}`,
      singleMode: this.resolveSingleMode({ activeSubcategoryId: "" }),
    }, () => {
      this.syncCategoryActive();
      this.refreshCatalog(true);
    });
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

  // 图标加载失败：先退到 icon-default.png；连兜底图也失败才显示文字首字，保证左栏永不空白
  // 用 data-name 定位（「全部商品」的 id 为空串，不能用 id 匹配）
  onCategoryIconError(event) {
    const name = String((event.currentTarget.dataset && event.currentTarget.dataset.name) || "");
    if (!name) return;
    const fallback = DEFAULT_CATEGORY_ICON;
    const markFailed = (items) => (Array.isArray(items) ? items.map((item) => {
      if (item.name !== name) return item;
      if (item.iconPath && item.iconPath !== fallback) {
        return Object.assign({}, item, { iconPath: fallback, imageUrl: fallback });
      }
      return Object.assign({}, item, { iconFailed: true });
    }) : []);
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
    // 分区模式：右侧平滑滚动到该二级分组，左栏高亮由滚动回写，二者天然一致
    if (!this.data.singleMode) {
      const sectionIndex = (this.data.sections || []).findIndex((section) => section.id === selected.parentId);
      if (sectionIndex < 0) return;
      this.jumpToSubgroup(sectionIndex, id);
      return;
    }
    // 单区结果列表模式下点二级 = 换 categoryId 重新查询（沿用原有行为）
    this.setData({
      activeCategoryId: id,
      activeSubcategoryId: id,
      activeCategoryName: selected.name,
      activeCategoryPath: `${root ? root.name : "分类"} / ${selected.name}`,
      singleMode: this.resolveSingleMode({ activeSubcategoryId: id }),
    }, () => this.refreshCatalog(true));
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
    this.setData({
      activeSort: sort,
      draftSort: sort,
      singleMode: this.resolveSingleMode({ activeSort: sort }),
    }, () => this.refreshCatalog(true));
  },

  resetFilter() {
    this.setData({ draftBrand: "", draftSort: "default" });
  },

  applyFilter() {
    this.setData({
      activeBrand: this.data.draftBrand,
      activeSort: this.data.draftSort,
      filterPanelOpen: false,
      // 品牌 / 排序清回默认且无关键词时，自动回到分区联动
      singleMode: this.resolveSingleMode({ activeBrand: this.data.draftBrand, activeSort: this.data.draftSort }),
    }, () => this.refreshCatalog(true));
  },

  inputKeyword(event) {
    const keyword = event.detail.value || "";
    // Invalidate immediately, before the debounce can dispatch the next query.
    this._productRequestId = (this._productRequestId || 0) + 1;
    this._searchPending = true;
    this.setData({
      keyword,
      // 一有输入就切到单区结果列表，避免右侧分区跟着关键词抖动
      singleMode: this.resolveSingleMode({ keyword }),
      products: [], loading: true, page: 1, total: 0, hasNextPage: false, productLoadError: "", failedProductPage: 0,
    });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.refreshCatalog(true);
    }, 320);
  },

  search() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.refreshCatalog(true);
  },

  clearKeyword() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ keyword: "", singleMode: this.resolveSingleMode({ keyword: "" }) }, () => this.refreshCatalog(true));
  },

  retryProducts() {
    if (this.data.loading) return Promise.resolve();
    if (!this.data.singleMode) return this.reloadSections();
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
    const rawIndex = event.currentTarget.dataset.sectionIndex;
    const sectionIndex = rawIndex === undefined || rawIndex === "" ? -1 : Number(rawIndex);
    const section = !this.data.singleMode && Number.isInteger(sectionIndex) && sectionIndex >= 0
      ? (this.data.sections || [])[sectionIndex]
      : null;
    if (!section) {
      this.setData({
        products: this.data.products.map((item) => item.productId === productId
          ? Object.assign({}, item, { imageFailed: true })
          : item),
      });
      return;
    }
    // 只改命中的那一张图，避免整表 sections 全量 setData
    const position = section.products.findIndex((item) => item.productId === productId && !item.imageFailed);
    if (position < 0) return;
    this.setData({ [`sections[${sectionIndex}].products[${position}].imageFailed`]: true });
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
