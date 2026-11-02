const { getMallCampaignDetail, getMallCampaigns, getHome, getProducts, resolveMallAssetUrl, SAFE_PRICE_UNAVAILABLE_MESSAGE } = require("../../utils/request");
const { addCartItem, getCartCount, getCartItems } = require("../../utils/cart");
const { getStorefront, resolveStorefrontEntrance, saveStorefrontCode } = require("../../utils/storefront");
// 本地演示脚手架：后端有数据用后端，后端为空时用本地演示内容兜底（详见 scaffold/index.js）
// 注意：小程序 require 不支持目录索引解析，必须写全 index.js
const scaffold = require("../../scaffold/index.js");
// 分类图标映射：独立零依赖模块（utils/category-icons.js），与分类页左栏共用同一份
const { categoryIconPath } = require("../../utils/category-icons");

const PREFERRED_MAJOR_BRANDS = ["李锦记", "家乐", "厨邦", "海天", "安井", "金龙鱼"];
const HOMEPAGE_MODULE_KEYS = ["search", "banner", "quickEntries", "currentCampaigns", "limitedTime", "buyGift", "featuredTheme", "frequent", "restock", "newProducts", "brandZone", "categorySelection"];

// 会员资产模块（首页新增）的跳转目标。
// 需求给的 /pages/recharge/recharge 与 /pages/coupon/coupon 在 app.json 里均不存在：
// 充值 → 指向实际存在的会员中心；领券 → 指向实际的优惠券中心（注意是 coupons 复数）。
// 两者跳转失败时统一降级为 toast 占位。
const MEMBER_ASSET_ROUTES = {
  recharge: "/pages/membership/membership",
  coupon: "/pages/coupons/coupons",
};

// ---- helpers ---------------------------------------------------------------

function pickText() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function firstFiniteNumber() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value === undefined || value === null || value === "") continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return (Math.round(num * 100) / 100).toFixed(2);
}

function firstQuotedPrice() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value === undefined) continue;
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value !== "string") return null;
    const text = value.trim().replace(/^[¥￥]\s*/, "").replace(/\s*元$/, "");
    if (!/^(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?|\.\d+)$/.test(text)) return null;
    const number = Number(text.replace(/,/g, ""));
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  return null;
}

// 价格永远来自后端解析结果；前端只做展示格式化，不计算客户价、不提交价格。
function normalizeProduct(item, homeCanViewPrice) {
  const productId = pickText(item.productId, item.id);
  const coreNotSellable = item.mallSellabilityStatus === "NOT_SELLABLE";
  const sellableSpecs = (Array.isArray(item.specOptions) ? item.specOptions : [])
    .filter((option) => option
      && pickText(option.productUnitId)
      && option.isActive !== false
      && option.mallSellable !== false);
  const sellableSpecCount = sellableSpecs.length;
  const requiresSpecSelection = sellableSpecCount > 1
    && !sellableSpecs.some((option) => option.isDefault);
  const selectedSpec = requiresSpecSelection
    ? null
    : (
      sellableSpecs.find((option) => option.isDefault && option.canOrder)
      || (sellableSpecCount === 1 ? sellableSpecs[0] : null)
      || sellableSpecs.find((option) => option.isDefault)
      || null
    );
  const productUnitId = selectedSpec
    ? pickText(selectedSpec.productUnitId)
    : (requiresSpecSelection ? "" : pickText(item.productUnitId));
  const priceNum = selectedSpec
    ? firstQuotedPrice(selectedSpec.displayPrice, selectedSpec.effectiveMallPrice, selectedSpec.customerPrice)
    : (requiresSpecSelection ? null : firstQuotedPrice(item.displayPrice, item.customerPrice, item.effectiveMallPrice));
  const canViewPrice = homeCanViewPrice === true && !!(item.priceAccess && item.priceAccess.canViewPrice === true);
  const priceVisible = canViewPrice && !requiresSpecSelection
    && (selectedSpec ? selectedSpec.priceVisible === true : item.priceVisible === true)
    && priceNum !== null
    && priceNum > 0;

  const priceText = priceVisible ? "¥" + formatMoney(priceNum) : "";
  const displayPrice = priceVisible && priceNum !== null && priceNum > 0 ? formatMoney(priceNum) : "";

  const name = pickText(item.displayName, item.mallTitle, item.name) || "未命名商品";
  const spec = requiresSpecSelection
    ? "多规格可选"
    : pickText(selectedSpec && (selectedSpec.specName || selectedSpec.unitName), item.mallSpecText, item.spec);
  const rawTags = Array.isArray(item.tags) ? item.tags : pickText(item.tags).split(/\s+/).filter(Boolean);
  if (requiresSpecSelection && rawTags.indexOf("多规格") < 0) rawTags.unshift("多规格");
  const priceUnavailableText = coreNotSellable
    ? "暂无报价"
    : canViewPrice
      ? SAFE_PRICE_UNAVAILABLE_MESSAGE
      : "登录并绑定客户后查看价格";
  const canQuickAdd = !!productId
    && !!productUnitId
    && !requiresSpecSelection
    && !coreNotSellable
    && item.canOrder !== false
    && item.canAddToCart !== false
    && priceVisible;
  const allowDecimalQuantity = !!(selectedSpec ? selectedSpec.allowDecimalQuantity : item.allowDecimalQuantity);
  const rawMinimum = firstFiniteNumber(selectedSpec && selectedSpec.minOrderQty, item.minOrderQty, item.mallMinOrderQty);
  const minOrderQty = allowDecimalQuantity ? null : (rawMinimum && rawMinimum > 0 ? rawMinimum : 1);

  return {
    productId,
    productUnitId,
    lineKey: productUnitId ? `${productId}:${productUnitId}` : productId,
    name,
    meta: spec,
    spec,
    unitName: pickText(selectedSpec && selectedSpec.unitName, item.unitName, item.mallOrderUnitName, item.baseUnit),
    imageUrl: scaffold.demoAwareAssetUrl(item, pickText(item.imageUrl, item.image)),
    initial: name.slice(0, 1),
    icon: name.slice(0, 1),
    isDemo: item.__demo === true,
    priceVisible,
    priceText,
    displayPrice,
    priceValue: displayPrice ? Number(displayPrice) : 0,
    promotionLabel: item.isPromotion ? pickText(item.promotionLabel, "促销") : "",
    hasPurchased: !!item.hasPurchasedByCurrentCustomer,
    tags: rawTags,
    sellableSpecCount,
    requiresSpecSelection,
    // 后端 canOrder = 绑定客户且价格可见；游客 / 待审核为 false → 不展示加购
    canOrder: canQuickAdd,
    canAddToCart: canQuickAdd,
    allowDecimalQuantity,
    quantityScale: allowDecimalQuantity ? 4 : 0,
    quantityStep: 1,
    minOrderQty,
    minOrderText: allowDecimalQuantity ? "可输入任意正数小数" : `起订量 ${minOrderQty}`,
    priceUnavailableText,
    mallSellabilityStatus: item.mallSellabilityStatus || "NOT_SELLABLE",
    mallSellabilityReasons: Array.isArray(item.mallSellabilityReasons) ? item.mallSellabilityReasons : [],
  };
}

function normalizeCategory(item) {
  const name = pickText(item.name, item.categoryName) || "分类";
  const backendImage = scaffold.demoAwareAssetUrl(item, pickText(item.imageUrl, item.image));
  return {
    id: pickText(item.id, item.categoryId),
    name,
    // 后端没给分类图时用包内图标兜底，避免宫格出现空方块
    imageUrl: backendImage || categoryIconPath(name),
    iconText: pickText(item.iconText, name.slice(0, 1)),
    icon: pickText(item.iconText, name.slice(0, 1)),
    badge: "",
  };
}

function isRootMallCategory(item) {
  const parentId = pickText(item && item.parentId);
  const level = Number(item && item.level);
  return !parentId && (!Number.isFinite(level) || level <= 1);
}

function isInternalStorefrontLabel(value) {
  return /storefront[\s_-]*[ab]|(?:^|\s)[ab]\s*店/i.test(pickText(value));
}

function publicText(value, fallback) {
  const text = pickText(value);
  return !text || isInternalStorefrontLabel(text) ? fallback : text;
}

function customerStatusText(status) {
  const view = buildStatusView(status);
  return `${view.title} · ${view.desc}`;
}

function defaultSectionTitle(key) {
  const map = {
    frequent: "常备补货",
    featured: "推荐补货",
    promotion: "促销专区",
    new: "新品推荐",
    hot: "热销商品",
  };
  return map[key] || "商品推荐";
}

function buildShelves(result) {
  const sections = Array.isArray(result.productSections) ? result.productSections : [];
  const shelves = [];
  sections.forEach((section) => {
    const products = (section.products || []).map(item => normalizeProduct(item, result.priceAccess && result.priceAccess.canViewPrice)).filter((p) => p.productId);
    if (!products.length) return;
    const isFrequent = section.key === "frequent";
    shelves.push({
      key: section.key || "section",
      title: pickText(section.title) || defaultSectionTitle(section.key),
      // GAP-1：frequent 段在无历史/游客时会回退为推荐，section 级不可信；
      // 真正“买过”只按每个商品的 hasPurchasedByCurrentCustomer 角标标注，
      // 不写任何“你的常买”整段断言，也不展示开发/配置说明文案。
      note: "",
      layout: isFrequent ? "scroll" : "grid",
      products: products.slice(0, isFrequent ? 10 : 6),
      moreVisible: true,
    });
  });
  return shelves;
}

function buildBanners(result) {
  const homepageV2 = result.homepageV2Enabled && result.homepageV2 ? result.homepageV2 : null;
  const banners = homepageV2 && Array.isArray(homepageV2.banners)
    ? homepageV2.banners
    : Array.isArray(result.banners) ? result.banners : [];
  return banners
    .filter((b) => b && (pickText(b.imageUrl) || pickText(b.title)))
    .map((b) => ({
      id: pickText(b.id) || pickText(b.title),
      title: pickText(b.title),
      subtitle: pickText(b.subtitle),
      imageUrl: scaffold.demoAwareAssetUrl(b, pickText(b.mobileImageUrl, b.imageUrl)),
      buttonText: pickText(b.buttonText),
      jumpType: pickText(b.jumpType),
      jumpValue: pickText(b.jumpValue),
    }));
}

function buildQuickEntries(result) {
  if (result.homepageV2Enabled && result.homepageV2 && Array.isArray(result.homepageV2.quickEntries)) {
    const iconMap = { campaigns: "活", coupon: "券", frequent: "购", restock: "补", membership: "员", category: "类", orders: "单" };
    return result.homepageV2.quickEntries
      .filter((item) => item && item.enabled === true && Object.prototype.hasOwnProperty.call(iconMap, item.key))
      .map((item) => ({ key: item.key, label: pickText(item.title) || "快捷入口", icon: iconMap[item.key] || "入", enabled: true }));
  }
  return [
    { key: "category", label: "全部分类", icon: "类", enabled: true },
    { key: "frequent", label: "常备补货", icon: "购", enabled: true },
    { key: "orders", label: "我的订单", icon: "单", enabled: true },
  ];
}

function buildHomepageModules(result) {
  const modules = result.homepageV2Enabled && result.homepageV2 && Array.isArray(result.homepageV2.modules)
    ? result.homepageV2.modules
    : [];
  const state = modules.reduce((state, item) => {
    const key = pickText(item && item.key);
    if (key) state[key] = item.enabled === true;
    return state;
  }, {});
  ["limitedTime", "buyGift", "featuredTheme"].forEach(key => { if (!(key in state)) state[key] = state.currentCampaigns === true; });
  return state;
}

function buildHomepageModuleOrder(result) {
  const configured = result.homepageV2Enabled && result.homepageV2 && Array.isArray(result.homepageV2.modules)
    ? result.homepageV2.modules
    : [];
  const seen = {};
  const ordered = configured
    .map((item, index) => ({ key: pickText(item && item.key), index, sort: Number.isFinite(Number(item && item.sort)) ? Number(item.sort) : index }))
    .filter((item) => item.key && !seen[item.key] && (seen[item.key] = true))
    .sort((left, right) => left.sort - right.sort || left.index - right.index);
  const campaignIndex = ordered.findIndex(item => item.key === "currentCampaigns");
  const missingVariants = ["limitedTime", "buyGift", "featuredTheme"].filter(key => !seen[key]).map(key => { seen[key] = true; return { key }; });
  if (campaignIndex >= 0) ordered.splice(campaignIndex + 1, 0, ...missingVariants);
  else ordered.push(...missingVariants);
  HOMEPAGE_MODULE_KEYS.forEach((key) => {
    if (!seen[key]) ordered.push({ key, index: ordered.length, sort: ordered.length });
  });
  const marketingFirst = ["search", "banner", "quickEntries"];
  const displayOrder = marketingFirst.map((key) => ({ key })).concat(ordered.filter((item) => !marketingFirst.includes(item.key)));
  return displayOrder.reduce((state, item, index) => {
    state[item.key] = 100 + index * 10;
    return state;
  }, {});
}

function buildMajorBrands(result) {
  const formalBrands = Array.isArray(result.brands)
    ? result.brands.map((item) => pickText(item)).filter(Boolean)
    : [];
  const available = new Set(formalBrands);
  return PREFERRED_MAJOR_BRANDS
    .filter((name) => available.has(name))
    .map((name) => ({ name, initial: name.slice(0, 1) }));
}

function buildHomepageShelves(result, modules, moduleOrder) {
  const moduleBySection = {
    frequent: "frequent",
    featured: "restock",
    hot: "restock",
    promotion: "currentCampaigns",
    new: "newProducts",
  };
  return buildShelves(result)
    .filter((section) => modules[moduleBySection[section.key]] === true)
    .map((section) => ({ ...section, homepageOrder: moduleOrder[moduleBySection[section.key]] || 900 }));
}

function buildStatusView(status) {
  switch (status) {
    case "APPROVED_BOUND_CUSTOMER":
      return { tone: "approved", icon: "✓", title: "门店已确认", desc: "可以查看价格和提交订单", cta: "" };
    case "REGISTERED_PENDING":
      return { tone: "pending", icon: "⏳", title: "资料确认中", desc: "确认完成后即可查看价格和下单", cta: "查看进度" };
    case "REJECTED":
      return { tone: "blocked", icon: "!", title: "资料需要补充", desc: "请联系业务员完善门店资料", cta: "联系客服" };
    case "DISABLED":
      return { tone: "blocked", icon: "!", title: "账号已停用", desc: "如需恢复请联系业务员或文员", cta: "联系客服" };
    default:
      return { tone: "guest", icon: "◐", title: "游客浏览中", desc: "完成登录和门店资料后可查看价格并下单", cta: "去登录" };
  }
}

function buildPriceHint(status) {
  if (status === "APPROVED_BOUND_CUSTOMER") return "价格确认中";
  if (status === "REGISTERED_PENDING") return "资料确认后可查看价格";
  if (status === "REJECTED" || status === "DISABLED") return "请联系业务员";
  return "登录绑定后可见价";
}

// ---- page ------------------------------------------------------------------

Page({
  async loadReceivableSummary() {
    if (this._disposed || this._inactive || this.data.loading || this.data.errored || this.data.customerStatus !== "APPROVED_BOUND_CUSTOMER") return;
    const identityVersion=this._homeRequestId;
    const code=this.data.storefrontCode;
    const version=this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    try {
      const result=await require('../../utils/request').request({path:'/api/mall/receivables',storefrontCode:this.data.storefrontCode,data:{pageSize:1}});
      if (version===this._receivableVersion && identityVersion===this._homeRequestId && code===this.data.storefrontCode && !this._inactive && !this._disposed && result.state==='OPEN_RECEIVABLES') this.setData({receivableSummary:result.summary});
    } catch (_) { /* An unavailable read does not become a zero balance. */ }
  },
  goReceivableCenter() { wx.navigateTo({url:'/pages/receivables/center?storefrontCode='+encodeURIComponent(this.data.storefrontCode)}); },
  data: {
    // 初始不显示遮罩：网络很快时不应出现吉祥物，慢加载由 _markLoadingStart 延迟显示
    loading: false,
    errored: false,
    storefrontCode: "zhenshang",
    storefront: getStorefront("zhenshang"),
    storefrontName: "",
    homepageV2Enabled: false,
    homepageModules: {},
    homepageModuleOrder: {},
    welcome: "晚上下单，次日按线路配送 · 调味 / 粮油 / 冷链集中补货",
    announcement: "",
    // 公告栏数据源：竖向 swiper 循环播放，一条一行，超长省略不换行
    noticeList: [
      "7:00前单子当日配送，7:00后单子统一隔日配送",
      "满 500 元免运费，偏远门店以结算页实际金额为准",
      "会员储值最高赠 5% 余额，充值后可直接抵扣货款",
    ],
    customerStatus: "GUEST",
    customerMode: "GUEST",
    priceAccess: {},
    memberTagText: "游客",
    customerStatusText: "游客浏览 · 登录绑定后可下单",
    apiStateText: "正在加载商品",
    heroTitle: "门店日常补货",
    heroSubtitle: "查看本周商品和活动",
    heroButtonText: "立即补货",
    restockStatText: "0 件",
    statusView: buildStatusView("GUEST"),
    priceHint: buildPriceHint("GUEST"),
    servicePhone: "",
    searchKeyword: "",
    banners: [],
    bannerIndex: 0,
    activities: [],
    featuredCampaignProducts: [],
    marketingCampaigns: [],
    marketingHeroCampaigns: [],
    limitedTimeCampaigns: [],
    buyGiftCampaigns: [],
    themeCampaigns: [],
    bottomClearance: 0,
    refreshing: false,
    marketingState: "HIDDEN",
    quickEntries: [],
    majorBrands: [],
    homepageShelves: [],
    categories: [],
    restockProducts: [],
    recommendProducts: [],
    primaryShelf: null,
    restShelves: [],
    hasShelves: false,
    cartCount: 0,
    cartAmountText: "预计 ¥0.00",
    // 自定义导航栏：状态栏高度 + 导航区高度（胶囊按钮避让）
    statusBarHeight: 20,
    navBarHeight: 64,
    // 顶部轮播区高度（px），默认按屏高 45% 估算，onLoad 里再按真机算
    heroHeight: 240,
    // 每张 banner 的主色，用于填充轮播图上下区域（统一色调）
    bannerColors: [],
  },

  _loaded: false,
  _productIndex: {},
  // 加载遮罩策略：网络很快时不出现；一旦出现就至少停留 1 秒，避免一闪而过
  _loadingDelayMs: 300,      // 超过这个时长还没加载完，才把吉祥物显示出来
  _minLoadingMs: 1000,       // 已经显示出来后，最短停留时长
  _loadingShownAt: 0,        // 实际显示出来的时间点（0 表示本轮没显示过）
  _loadingRevealTimer: null, // 延迟显示的定时器
  _loadingTimer: null,       // 收起遮罩的定时器

  onReady() { this.measureBottomClearance(); },
  onResize() { this.measureBottomClearance(); },

  // 采样每张 banner 的主色（离屏 canvas 缩到 24x24 取平均色），
  // 用来填充轮播图上下空白区：海报文字不动，背景跟着图统一色调。
  resolveBannerColors(banners) {
    const urls = (Array.isArray(banners) ? banners : []).map(b => b && b.imageUrl).filter(Boolean);
    if (!urls.length || typeof wx.createOffscreenCanvas !== "function") return;
    let canvas = null;
    try {
      canvas = wx.createOffscreenCanvas({ type: "2d", width: 24, height: 24 });
    } catch (error) {
      return;
    }
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = urls.map(() => "");
    urls.forEach((url, i) => {
      const img = canvas.createImage();
      if (!img) return;
      img.onload = () => {
        try {
          ctx.clearRect(0, 0, 24, 24);
          ctx.drawImage(img, 0, 0, 24, 24);
          const data = ctx.getImageData(0, 0, 24, 24).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let p = 0; p < data.length; p += 4) {
            if (data[p + 3] < 16) continue;
            r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
          }
          if (!n) return;
          colors[i] = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
          if (!this._disposed) this.setData({ bannerColors: colors.slice() });
        } catch (error) {
          // 取色失败就保持空字符串，样式里走品牌绿兜底
        }
      };
      img.src = url;
    });
  },

  measureBottomClearance() {
    if (this._disposed || this._inactive || typeof wx.createSelectorQuery !== "function") return;
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    wx.createSelectorQuery().in(this).select(".cart-float").boundingClientRect()
      .select(".qcg-tabbar").boundingClientRect().exec((rects) => {
        if (this._disposed || this._inactive) return;
        const tops = (rects || []).filter(rect => rect && Number.isFinite(rect.top)).map(rect => rect.top);
        if (tops.length && info.windowHeight > 0) {
          this.setData({ bottomClearance: Math.ceil(info.windowHeight - Math.min(...tops) + 12) });
        }
      });
  },

  tickCampaignClock() {
    clearTimeout(this._campaignClock);
    if (this._disposed || this._inactive || !this.data.limitedTimeCampaigns.length) return;
    const now = Date.now() + (this._campaignClockOffset || 0);
    const limitedTimeCampaigns = this.data.limitedTimeCampaigns.map(item => {
      const seconds = Math.max(0, Math.floor((Date.parse(item.effectiveTo) - now) / 1000));
      const days = Math.floor(seconds / 86400);
      const clock = [Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
        .map(value => String(value).padStart(2, "0")).join(" : ");
      return { ...item, ended: seconds === 0, countdownText: seconds === 0 ? "活动已结束" : `${days ? days + "天 " : ""}${clock}` };
    });
    this.setData({ limitedTimeCampaigns });
    if (limitedTimeCampaigns.some(item => !item.ended)) this._campaignClock = setTimeout(() => this.tickCampaignClock(), 1000);
  },

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    // 自定义导航栏：算出状态栏高度与导航区高度（避让右上角胶囊按钮）
    try {
      const win = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = win.statusBarHeight || 20;
      let navBarHeight = statusBarHeight + 44;
      if (typeof wx.getMenuButtonBoundingClientRect === "function") {
        const capsule = wx.getMenuButtonBoundingClientRect();
        if (capsule && capsule.height) navBarHeight = (capsule.top - statusBarHeight) * 2 + capsule.height;
      }
      // 轮播区约占屏幕高度的 45%
      const heroHeight = Math.min(520, Math.max(260, Math.round((win.windowHeight || 667) * 0.45)));
      this.setData({ statusBarHeight, navBarHeight, heroHeight });
    } catch (error) {
      // 取不到尺寸时沿用 data 里的默认值
    }
    const entrance = resolveStorefrontEntrance(query || {});
    saveStorefrontCode(entrance.storefrontCode);
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.storefrontCode = entrance.storefrontCode;
      app.globalData.sourceScene = entrance.sourceScene;
    }
    const storefront = getStorefront(entrance.storefrontCode);
    this.setData({
      storefrontCode: entrance.storefrontCode,
      storefrontName: storefront.name,
      storefront,
    });
    this.loadHome();
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    const returning = this._inactive;
    this._inactive = false;
    this.refreshCart();
    this.measureBottomClearance();
    // A return may follow login, logout or a customer/role change. Home does not
    // expose an identity key for safely reusing its customer-specific quotes.
    if (returning) return this.loadHome();
  },

  onHide() {
    this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    if (this._disposed) return;
    this._inactive = true;
    clearTimeout(this._campaignClock);
    this._homeRequestId = (this._homeRequestId || 0) + 1;
    this._loaded = false;
    this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    this.clearCustomerProducts();
    if (this._pullRefreshing) { this._pullRefreshing = false; wx.stopPullDownRefresh(); }
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    return this.loadHome({ fromPull: true });
  },

  onUnload() {
    this._disposed = true;
    clearTimeout(this._campaignClock);
    clearTimeout(this._loadingTimer);
    clearTimeout(this._loadingRevealTimer);
    this._loadingTimer = null;
    this._loadingRevealTimer = null;
    this._loadingShownAt = 0;
    this._homeRequestId = (this._homeRequestId || 0) + 1;
    this._productIndex = {};
    if (this._pullRefreshing) { this._pullRefreshing = false; wx.stopPullDownRefresh(); }
  },

  clearCustomerProducts() {
    clearTimeout(this._campaignClock);
    this._productIndex = {};
    this.setData({
      featuredCampaignProducts: [], marketingCampaigns: [], marketingHeroCampaigns: [], limitedTimeCampaigns: [], buyGiftCampaigns: [], themeCampaigns: [], marketingState: "HIDDEN",
      loading: false, errored: false, customerMode: "RESOLVING", memberTagText: "确认中",
      customerStatusText: "正在确认门店状态", homepageShelves: [], restockProducts: [], recommendProducts: [],
      primaryShelf: null, restShelves: [], hasShelves: false,
    });
    this._markLoadingStart();
  },

  // 本轮加载开始：先不显示遮罩，等 _loadingDelayMs 还没结束才显示
  _markLoadingStart() {
    clearTimeout(this._loadingRevealTimer);
    clearTimeout(this._loadingTimer);
    this._loadingTimer = null;
    this._loadingShownAt = 0;
    this._loadingRevealTimer = setTimeout(() => {
      this._loadingRevealTimer = null;
      if (this._disposed) return;
      this._loadingShownAt = Date.now();
      this.setData({ loading: true });
    }, this._loadingDelayMs || 0);
  },

  // 加载结束：
  //   · 遮罩从没显示过（网络很快）→ 保持不显示
  //   · 已经显示出来 → 至少停留到满 _minLoadingMs 再收
  finishLoading() {
    clearTimeout(this._loadingRevealTimer);
    this._loadingRevealTimer = null;
    if (!this._loadingShownAt) {
      // 快请求：全程不出现吉祥物
      if (!this._disposed && this.data.loading) this.setData({ loading: false });
      return;
    }
    const elapsed = Date.now() - this._loadingShownAt;
    const wait = Math.max(0, (this._minLoadingMs || 0) - elapsed);
    clearTimeout(this._loadingTimer);
    const hide = () => {
      this._loadingTimer = null;
      this._loadingShownAt = 0;
      if (!this._disposed) this.setData({ loading: false });
    };
    if (wait <= 0) { hide(); return; }
    this._loadingTimer = setTimeout(hide, wait);
  },

  loadHome(options) {
    if (this._disposed || this._inactive) return Promise.resolve();
    const opts = options || {};
    const requestId = this._homeRequestId = (this._homeRequestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && !this._inactive && requestId === this._homeRequestId
      && code === this.data.storefrontCode;
    if (opts.fromPull) this._pullRefreshing = true;
    this.clearCustomerProducts();

    return getHome(code)
      .then((rawResult) => {
        if (!current()) return;
        // 后端为空的字段用本地演示数据补齐（后端有真实数据时不介入）
        const result = scaffold.applyHome(rawResult);
        const status = pickText(result.customerStatus) || "GUEST";
        const canOrder = status === "APPROVED_BOUND_CUSTOMER"
          && !!(result.priceAccess && result.priceAccess.canOrder);
        const viewOnly = status === "APPROVED_BOUND_CUSTOMER" && !canOrder;
        const rawCategories = result.mallCategoryItems || result.categories || [];
        const categories = rawCategories
          .filter(isRootMallCategory)
          .map(normalizeCategory)
          .slice(0, 8);
        // 用后端原始分类（带 productCount）判断门店是否已有真实商品
        const storefrontHasProducts = scaffold.hasRealProducts(rawCategories);
        const homepageModules = buildHomepageModules(result);
        const homepageModuleOrder = buildHomepageModuleOrder(result);
        const shelves = buildShelves(result);
        const banners = buildBanners(result);
        const banner = banners[0] || {};
        const quickEntries = buildQuickEntries(result);
        const restockProducts = (Array.isArray(result.restockProducts) ? result.restockProducts : []).map(item => normalizeProduct(item, result.priceAccess && result.priceAccess.canViewPrice)).filter((p) => p.productId).slice(0, 4);
        const recommendProducts = (Array.isArray(result.recommendProducts) ? result.recommendProducts : []).map(item => normalizeProduct(item, result.priceAccess && result.priceAccess.canViewPrice)).filter((p) => p.productId).slice(0, 6);
        // 以 ProductUnit 为最小购物车行，不能用 productId 覆盖同商品的不同规格。
        const index = {};
        shelves.forEach((shelf) => shelf.products.forEach((p) => {
          if (p.lineKey) index[p.lineKey] = p;
        }));
        restockProducts.concat(recommendProducts).forEach((p) => {
          if (p.lineKey) index[p.lineKey] = p;
        });
        this._productIndex = index;
        this._loaded = true;
        // 取每张 banner 主色，作为轮播上下填充区的背景色（统一色调）
        this.resolveBannerColors(banners);

        // 改动 A：商品当家。把“常备补货”楼层（无 frequent 则取第一段）拆出，
        // 放到营销 Banner 之上，让已绑定客户开屏先看到可复购的真实商品。
        let primaryShelf = null;
        let restShelves = shelves;
        if (shelves.length) {
          const freqIndex = shelves.findIndex((s) => s.key === "frequent");
          const idx = freqIndex >= 0 ? freqIndex : 0;
          primaryShelf = shelves[idx];
          restShelves = shelves.filter((_, i) => i !== idx);
        }

        this.setData({
          errored: false,
          storefrontName: (result.mallStorefront && result.mallStorefront.name) || result.storefrontName || this.data.storefrontName,
          storefront: result.mallStorefront || this.data.storefront,
          homepageV2Enabled: result.homepageV2Enabled === true,
          homepageModules,
          homepageModuleOrder,
          announcement: pickText(result.announcement),
          customerStatus: status,
          priceAccess: result.priceAccess || {},
          customerMode: canOrder ? "BOUND" : viewOnly ? "VIEW_ONLY" : "GUEST",
          memberTagText: viewOnly ? "仅浏览" : status === "APPROVED_BOUND_CUSTOMER" ? "已绑定" : status === "GUEST" ? "游客" : buildStatusView(status).title,
          customerStatusText: viewOnly ? "已绑定客户 · 当前角色仅浏览" : customerStatusText(status),
          apiStateText: "商品已更新",
          heroTitle: publicText(banner.title, "门店日常补货"),
          heroSubtitle: publicText(banner.subtitle, pickText(result.announcement, result.orderGuide, "查看本周商品和活动")),
          heroButtonText: pickText(banner.buttonText, "立即补货"),
          restockStatText: `${restockProducts.length} 件`,
          statusView: buildStatusView(status),
          priceHint: buildPriceHint(status),
          servicePhone: pickText(result.servicePhone),
          banners,
          activities: (Array.isArray(result.weeklyActivities) ? result.weeklyActivities : []).map((item) => ({
            id: pickText(item.id, item.title),
            title: publicText(item.title, "商城活动"),
            subtitle: publicText(item.subtitle, pickText(item.description, "活动详情以商城公告为准")),
            icon: pickText(item.iconText, publicText(item.title, "活").slice(0, 1)),
            imageUrl: scaffold.demoAwareAssetUrl(item, pickText(item.imageUrl, item.posterImageUrl)),
            jumpType: pickText(item.jumpType),
            jumpValue: pickText(item.jumpValue),
          })),
          quickEntries,
          majorBrands: buildMajorBrands(result),
          homepageShelves: buildHomepageShelves(result, homepageModules, homepageModuleOrder),
          categories,
          restockProducts,
          recommendProducts,
          primaryShelf,
          restShelves,
          hasShelves: shelves.length > 0,
        });
        // 数据已在遮罩下渲染好，等满最短展示时长再收起遮罩
        this.finishLoading();
        if (status === "APPROVED_BOUND_CUSTOMER") this.loadReceivableSummary();
        this.refreshCart();
        // 后端 /api/mall/home 不返回楼层商品（productSections[*].products 为空），
        // 但门店确实有商品时，去 /api/mall/products 取真实商品填充首页楼层。
        if (!shelves.length && !restockProducts.length && !recommendProducts.length
          && storefrontHasProducts) {
          return this.loadHomeProducts(current, code).then(() => {
            if (status === "APPROVED_BOUND_CUSTOMER" && result.homepageV2Enabled === true && (homepageModules.currentCampaigns === true || homepageModules.banner === true)) {
              return this.loadMarketingCampaigns(current);
            }
          });
        }
        if (status === "APPROVED_BOUND_CUSTOMER" && result.homepageV2Enabled === true && (homepageModules.currentCampaigns === true || homepageModules.banner === true)) {
          return this.loadMarketingCampaigns(current);
        }
      })
      .catch(() => {
        if (!current()) return;
        this._loaded = false;
        this.setData({ errored: true, customerMode: "UNAVAILABLE", memberTagText: "暂不可用", customerStatusText: "门店状态暂不可用，请重试", apiStateText: "商城数据暂不可用，请稍后重试" });
        // 失败也保证吉祥物至少展示满 1 秒，避免闪一下
        this.finishLoading();
      })
      .finally(() => {
        if (current()) { this.setData({ refreshing: false }); this.measureBottomClearance(); }
        if (current() && this._pullRefreshing) { this._pullRefreshing = false; wx.stopPullDownRefresh(); }
      });
  },

  reload() {
    return this.loadHome();
  },

  // /api/mall/home 的楼层商品是空的，用 /api/mall/products 的真实商品补首页楼层。
  // 复用同一套 normalizeProduct，价格可见性仍完全由后端 priceAccess 决定。
  loadHomeProducts(current, storefrontCode) {
    return getProducts(storefrontCode, { page: 1, pageSize: 12 })
      .then((result) => {
        if (!current()) return;
        const raw = (Array.isArray(result.items) ? result.items : []).filter((item) => item && pickText(item.id, item.productId));
        if (!raw.length) return;
        const canViewPrice = !!(this.data.priceAccess && this.data.priceAccess.canViewPrice);
        const products = raw.map((item) => normalizeProduct(item, canViewPrice)).filter((p) => p.productId);
        if (!products.length) return;
        const index = {};
        products.forEach((p) => { if (p.lineKey) index[p.lineKey] = p; });
        this._productIndex = Object.assign({}, this._productIndex, index);
        const shelfSize = 6;
        const shelves = [];
        for (let i = 0; i < products.length; i += shelfSize) {
          const chunk = products.slice(i, i + shelfSize);
          if (!chunk.length) continue;
          shelves.push({
            key: `home-${shelves.length + 1}`,
            title: shelves.length === 0 ? "常备补货" : `为你推荐 ${shelves.length + 1}`,
            note: "",
            layout: shelves.length === 0 ? "scroll" : "grid",
            products: chunk,
            moreVisible: true,
          });
        }
        const primaryShelf = shelves[0] || null;
        this.setData({
          homepageShelves: shelves,
          primaryShelf,
          restShelves: shelves.slice(1),
          hasShelves: shelves.length > 0,
          restockProducts: products.slice(0, 4),
          recommendProducts: products.slice(4, 10),
          restockStatText: `${Math.min(products.length, 4)} 件`,
        });
      })
      .catch(() => { /* 首页楼层拿不到商品不影响首屏其余内容 */ });
  },

  onFeaturedProductImageError(event) {
    if (this._disposed || this._inactive) return;
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    this.setData({ featuredCampaignProducts: this.data.featuredCampaignProducts.map((item) => item.key === dataset.key && item.imageUrl === dataset.src ? { ...item, imageFailed: true } : item) });
  },

  onProductImageError(event) {
    if (this._disposed || this._inactive) return;
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    if (!dataset || !dataset.key || !dataset.src) return;
    // Ignore delayed failures from an old URL; keep product, price and cart facts intact.
    const markFailed = (product) => product.lineKey === dataset.key && product.imageUrl === dataset.src
      ? { ...product, imageFailed: true } : product;
    this.setData({
      restockProducts: this.data.restockProducts.map(markFailed),
      recommendProducts: this.data.recommendProducts.map(markFailed),
      homepageShelves: this.data.homepageShelves.map((shelf) => ({ ...shelf, products: shelf.products.map(markFailed) })),
    });
  },

  refreshCart() {
    const items = getCartItems(this.data.storefrontCode);
    const count = getCartCount(this.data.storefrontCode);
    const total = items.reduce((sum, item) => {
      if (!item.priceVisible) return sum;
      const price = Number(item.priceValue || item.displayPrice || 0);
      return sum + price * Number(item.quantity || 0);
    }, 0);
    this.setData({
      cartCount: count,
      cartAmountText: total > 0 ? `预计 ¥${formatMoney(total)}` : "价格以确认为准",
    });
  },

  // ---- interactions --------------------------------------------------------

  onSearchInput(event) {
    this.setData({ searchKeyword: event.detail.value });
  },

  inputSearch(event) {
    this.onSearchInput(event);
  },

  onSearch(event) {
    const keyword = (event.detail && event.detail.value) || this.data.searchKeyword || "";
    wx.navigateTo({
      url: `/pages/category/category?keyword=${encodeURIComponent(keyword)}&storefrontCode=${this.data.storefrontCode}`,
    });
  },

  clearSearch() {
    this.setData({ searchKeyword: "" });
  },

  search() {
    this.onSearch({ detail: { value: this.data.searchKeyword } });
  },

  onStatusAction() {
    const status = this.data.customerStatus;
    if ((status === "REJECTED" || status === "DISABLED") && this.data.servicePhone) {
      wx.makePhoneCall({ phoneNumber: this.data.servicePhone, fail() {} });
      return;
    }
    wx.navigateTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },

  onBannerSelect(event) {
    const banner = event.detail && event.detail.banner;
    if (!banner) return;
    const code = this.data.storefrontCode;
    if (banner.jumpType === "PRODUCT" && banner.jumpValue) {
      wx.navigateTo({ url: `/pages/product/detail?id=${banner.jumpValue}&storefrontCode=${code}` });
    } else if (banner.jumpType === "CAMPAIGN" && banner.jumpValue) {
      wx.navigateTo({ url: `/pages/campaigns/detail?code=${encodeURIComponent(banner.jumpValue)}&storefrontCode=${code}` });
    } else if (banner.jumpType === "CATEGORY" && banner.jumpValue) {
      wx.navigateTo({ url: `/pages/category/category?categoryId=${banner.jumpValue}&storefrontCode=${code}` });
    } else if (banner.jumpType === "BRAND" && banner.jumpValue) {
      wx.navigateTo({ url: `/pages/category/category?brand=${encodeURIComponent(banner.jumpValue)}&storefrontCode=${code}` });
    } else if (banner.jumpType === "SECTION" && banner.jumpValue) {
      wx.navigateTo({ url: `/pages/category/category?section=${banner.jumpValue}&storefrontCode=${code}` });
    } else {
      wx.showToast({ title: "活动详情暂未开放", icon: "none" });
    }
  },

  onCampaignHeroSelect(event) {
    const banner = event.detail && event.detail.banner;
    if (!banner || this._inactive || this._disposed || this.data.loading) return;
    const campaign = this.data.marketingHeroCampaigns.find(item => item.id === banner.id);
    if (!campaign) return;
    const identity = campaign.campaignId ? `&campaignId=${encodeURIComponent(campaign.campaignId)}` : "";
    wx.navigateTo({ url: `/pages/campaigns/detail?code=${encodeURIComponent(campaign.jumpValue)}${identity}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  loadMarketingCampaigns(current) {
    clearTimeout(this._campaignClock);
    this.setData({ featuredCampaignProducts: [], marketingCampaigns: [], marketingHeroCampaigns: [], limitedTimeCampaigns: [], buyGiftCampaigns: [], themeCampaigns: [], marketingState: "LOADING" });
    const storefrontCode = this.data.storefrontCode;
    return Promise.resolve().then(() => current() ? getMallCampaigns(storefrontCode) : null)
      .then((result) => {
        if (!current()) return;
        const items = result && result.campaigns && Array.isArray(result.campaigns.items) ? result.campaigns.items : [];
        const available = items.filter((item) => item && pickText(item.code))
          .sort((a, b) => (Number(a.homeSortOrder) || 0) - (Number(b.homeSortOrder) || 0) || String(a.code).localeCompare(String(b.code)))
          .map((item) => ({
          campaignId: pickText(item.campaignId), code: item.code, name: item.name, description: pickText(item.marketingSubtitle, item.description),
          stateText: item.stateText, timeText: item.timeText,
          imageUrl: resolveMallAssetUrl(pickText(item.posterImageUrl, item.homePosterUrl, item.heroImageUrl)),
          homeBannerUrl: resolveMallAssetUrl(pickText(item.homeBannerUrl)),
          showOnHome: item.showOnHome === true, showInHero: item.showInHero === true,
          presentationType: item.presentationType || "STANDARD_POSTER", effectiveTo: item.effectiveTo || null,
        }));
        const campaigns = available.filter(item => item.showOnHome);
        const marketingHeroCampaigns = available.filter((item) => item.showInHero && item.homeBannerUrl).map((item) => ({
          id: item.code, campaignId: item.campaignId, title: item.name, imageUrl: item.homeBannerUrl,
          jumpType: "CAMPAIGN", jumpValue: item.code,
        }));
        const serverNow = Date.parse(result && result.campaigns && result.campaigns.serverNow || "");
        this._campaignClockOffset = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
        this.setData({ marketingCampaigns: campaigns, marketingHeroCampaigns,
          limitedTimeCampaigns: campaigns.filter(item => item.presentationType === "LIMITED_TIME" && Number.isFinite(Date.parse(item.effectiveTo || ""))),
          buyGiftCampaigns: campaigns.filter(item => item.presentationType === "BUY_GIFT"),
          themeCampaigns: campaigns.filter(item => item.presentationType === "FEATURED_THEME"),
          marketingState: campaigns.length || marketingHeroCampaigns.length ? "READY" : "EMPTY" });
        this.tickCampaignClock();
        if (campaigns.length) return this.loadFeaturedCampaignProducts(campaigns[0].code, storefrontCode, current);
      }).catch(() => {
        if (current()) this.setData({ marketingCampaigns: [], marketingHeroCampaigns: [], limitedTimeCampaigns: [], buyGiftCampaigns: [], themeCampaigns: [], marketingState: "UNAVAILABLE" });
      });
  },

  loadFeaturedCampaignProducts(code, storefrontCode, current) {
    return Promise.resolve().then(() => current() ? getMallCampaignDetail(storefrontCode, code) : null)
      .then((result) => {
        if (!current()) return;
        const campaign = result && result.campaign;
        const products = campaign && campaign.code === code && Array.isArray(campaign.products) ? campaign.products : [];
        this.setData({ featuredCampaignProducts: products.filter((item) => item && pickText(item.productId)).slice(0, 6).map((item, index) => ({
          key: pickText(item.productUnitId, item.productId) + ":" + index,
          productId: item.productId, name: item.name, imageUrl: resolveMallAssetUrl(item.imageUrl),
          priceText: item.pricingStatus === "AVAILABLE" ? pickText(item.finalUnitPriceText) : "",
        })) });
      }).catch(() => { if (current()) this.setData({ featuredCampaignProducts: [] }); });
  },

  openFeaturedCampaignProduct(event) {
    if (this._disposed || this._inactive || this.data.loading || this.data.errored || this.data.marketingState !== "READY") return;
    const productId = event.currentTarget.dataset.id;
    if (!this.data.featuredCampaignProducts.some((item) => item.productId === productId)) return;
    wx.navigateTo({ url: `/pages/product/detail?id=${encodeURIComponent(productId)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  openMarketingCampaign(event) {
    if (this._disposed || this._inactive || this.data.loading || this.data.errored || this.data.marketingState !== "READY") return;
    const code = event.currentTarget.dataset.code;
    const campaign = this.data.marketingCampaigns.find((item) => item.code === code);
    if (!campaign) return;
    const identityQuery = campaign.campaignId ? `&campaignId=${encodeURIComponent(campaign.campaignId)}` : "";
    wx.navigateTo({ url: `/pages/campaigns/detail?code=${encodeURIComponent(code)}${identityQuery}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  onActivity(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const jumpType = pickText(dataset.jumpType);
    const jumpValue = pickText(dataset.jumpValue);
    const code = this.data.storefrontCode;
    if (jumpType === "CATEGORY" && jumpValue) {
      wx.navigateTo({ url: `/pages/category/category?categoryId=${encodeURIComponent(jumpValue)}&storefrontCode=${code}` });
      return;
    }
    if (jumpType === "SECTION" && jumpValue) {
      wx.navigateTo({ url: `/pages/category/category?section=${encodeURIComponent(jumpValue)}&storefrontCode=${code}` });
      return;
    }
    if (jumpType === "CAMPAIGN" && jumpValue) {
      wx.navigateTo({ url: `/pages/campaigns/detail?code=${encodeURIComponent(jumpValue)}&storefrontCode=${code}` });
      return;
    }
    // 没有配置跳转目标时统一进分类页，不再弹「暂未开放」，避免看起来像坏掉的入口
    wx.navigateTo({ url: `/pages/category/category?storefrontCode=${code}` });
  },

  onBannerChange(event) {
    const index = Number(event && event.detail && event.detail.current);
    if (Number.isFinite(index)) this.setData({ bannerIndex: index });
  },

  onBannerTap(event) {
    const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
    const banner = this.data.banners[Number.isFinite(index) ? index : 0];
    if (banner) this.onBannerSelect({ detail: { banner } });
  },

  onQuickTap(event) {
    if (this._disposed || this.data.loading || this.data.errored) return;
    const detail = event.detail || {};
    const entry = this.data.quickEntries.find((item) => item.key === detail.key && item.enabled === true);
    if (detail.enabled !== true || !entry) {
      wx.showToast({ title: "该功能暂未开放，请联系业务员", icon: "none" });
      return;
    }
    const code = this.data.storefrontCode;
    switch (detail.key) {
      case "membership":
        wx.navigateTo({ url: `/pages/me/me?storefrontCode=${code}` });
        break;
      case "campaigns":
        wx.navigateTo({ url: `/pages/campaigns/list?storefrontCode=${code}` });
        break;
      case "coupon":
        wx.navigateTo({ url: `/pages/coupons/coupons?storefrontCode=${code}` });
        break;
      case "category":
        wx.navigateTo({ url: `/pages/category/category?storefrontCode=${code}` });
        break;
      case "frequent":
      case "restock":
        wx.navigateTo({ url: `/pages/category/category?section=frequent&storefrontCode=${code}` });
        break;
      case "orders":
        wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${code}` });
        break;
      default:
        break;
    }
  },

  onCategorySelect(event) {
    const id = (event.detail && event.detail.id) || "";
    wx.navigateTo({ url: `/pages/category/category?categoryId=${id}&storefrontCode=${this.data.storefrontCode}` });
  },

  goBrand(event) {
    const brand = pickText(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.brand);
    if (!brand) return;
    wx.navigateTo({ url: `/pages/category/category?brand=${encodeURIComponent(brand)}&storefrontCode=${this.data.storefrontCode}` });
  },

  onShelfMore(event) {
    const key = event.currentTarget.dataset.key || "";
    wx.navigateTo({ url: `/pages/category/category?section=${key}&storefrontCode=${this.data.storefrontCode}` });
  },

  onProductOpen(event) {
    const id = event.detail && event.detail.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/product/detail?id=${id}&storefrontCode=${this.data.storefrontCode}` });
  },

  onProductAdd(event) {
    const detail = event.detail || {};
    const product = detail.lineKey ? this._productIndex[detail.lineKey] : this._productIndex[detail.id];
    if (!product) return;
    if (this.data.customerMode !== "BOUND") {
      wx.showToast({ title: this.data.customerMode === "VIEW_ONLY" ? "当前账号仅支持浏览" : "完成登录和门店资料后即可加入购物车", icon: "none" });
      return;
    }
    if (product.requiresSpecSelection || !product.productUnitId) {
      wx.navigateTo({ url: `/pages/product/detail?id=${product.productId}&storefrontCode=${this.data.storefrontCode}` });
      return;
    }
    if (!product.canOrder) {
      wx.showToast({ title: product.priceUnavailableText || "当前商品暂不可下单", icon: "none" });
      return;
    }
    const added = addCartItem(product, 1, this.data.storefrontCode);
    if (!added) {
      wx.showToast({ title: "加入失败，请重新选择规格", icon: "none" });
      return;
    }
    this.refreshCart();
    wx.showToast({ title: "已加入购物车", icon: "none" });
  },

  goCategory(event) {
    const id = event.currentTarget.dataset.id || "";
    wx.navigateTo({ url: `/pages/category/category?categoryId=${id}&storefrontCode=${this.data.storefrontCode}` });
  },

  goProduct(event) {
    const id = event.currentTarget.dataset.id || "";
    if (!id) return;
    wx.navigateTo({ url: `/pages/product/detail?id=${id}&storefrontCode=${this.data.storefrontCode}` });
  },

  addCart(event) {
    const key = event.currentTarget.dataset.key || event.currentTarget.dataset.id;
    const product = this._productIndex[key];
    if (!product) return;
    if (this.data.customerMode !== "BOUND") {
      wx.showToast({ title: this.data.customerMode === "VIEW_ONLY" ? "当前账号仅支持浏览" : "完成登录和门店资料后即可加入购物车", icon: "none" });
      return;
    }
    if (product.requiresSpecSelection || !product.productUnitId) {
      wx.navigateTo({ url: `/pages/product/detail?id=${product.productId}&storefrontCode=${this.data.storefrontCode}` });
      return;
    }
    if (!product.canOrder) {
      wx.showToast({ title: product.priceUnavailableText || "登录并绑定客户后可加入购物车", icon: "none" });
      return;
    }
    const added = addCartItem(product, 1, this.data.storefrontCode);
    if (!added) {
      wx.showToast({ title: "加入失败，请重新选择规格", icon: "none" });
      return;
    }
    this.refreshCart();
    wx.showToast({ title: "已加入购物车", icon: "none" });
  },

  goCategoryAll() {
    wx.navigateTo({ url: `/pages/category/category?storefrontCode=${this.data.storefrontCode}` });
  },

  goCart() {
    wx.redirectTo({ url: `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}` });
  },

  goOrders() {
    wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    wx.navigateTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },

  // ---------- 消息提醒入口 ----------

  // 目标页 /pages/message/index 还没在 app.json 注册，现在点会进 fail 分支。
  // 页面建好并注册后，这里不用改任何代码。
  goMessage() {
    const code = this.data.storefrontCode || "";
    const base = "/pages/message/index";
    const url = code ? `${base}?storefrontCode=${encodeURIComponent(code)}` : base;
    wx.navigateTo({
      url,
      fail: (error) => {
        // 不做静默失败：把目标地址和错误一起打出来，方便开发期定位
        console.log("[index] 消息提醒页跳转失败（未注册？）:", url, error && error.errMsg);
        wx.showToast({ title: "消息提醒页还未上线", icon: "none" });
      },
    });
  },

  goMemberAsset(event) {
    const target = (event && event.currentTarget && event.currentTarget.dataset.target) || "";
    const url = MEMBER_ASSET_ROUTES[target];
    if (!url) {
      wx.showToast({ title: "功能开发中", icon: "none" });
      return;
    }
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: "功能开发中", icon: "none" }),
    });
  },
});
