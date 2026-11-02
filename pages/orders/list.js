const { formatServerDateTime, getMallMe, getOrders, getSafeMallErrorMessage } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

const { orderDateRange } = require("../../utils/order-date-filter");

const CUSTOMER_TABS = ["全部", "已提交", "已接单", "配送中", "已完成", "已取消"];

const CUSTOMER_STATUS_META = {
  WAITING_FOR_PAYMENT: { key: "已提交", text: "待付款", tone: "orange", hint: "本单金额已确认，请付款后等待商家安排发货。" },
  SUBMITTED: { key: "已提交", text: "已提交", tone: "orange", hint: "我们正在确认商品、价格和配送信息" },
  PROCESSING: { key: "已接单", text: "已接单", tone: "green", hint: "我们正在准备您的商品" },
  ACCEPTED: { key: "已接单", text: "已接单", tone: "green", hint: "我们正在准备您的商品" },
  DELIVERING: { key: "配送中", text: "配送中", tone: "green" },
  WAITING_POSTING: { key: "配送中", text: "待过账", tone: "orange", hint: "等待商家正式过账，无需您确认完成" },
  COMPLETED: { key: "已完成", text: "已完成", tone: "gray" },
  CANCELLED: { key: "已取消", text: "已取消", tone: "red" },
};

function resolveCustomerStatus(raw) {
  const code = String(raw.customerStatusCode || "").toUpperCase();
  const meta = CUSTOMER_STATUS_META[code];
  if (meta) {
    return {
      key: meta.key,
      text: typeof raw.customerStatusText === "string" && raw.customerStatusText.trim() ? raw.customerStatusText : meta.text,
      hint: typeof raw.customerStatusHint === "string" && raw.customerStatusHint.trim() ? raw.customerStatusHint : meta.hint || "订单状态已更新",
      tone: meta.tone,
    };
  }
  const value = String(raw.status || raw.customerStatus || "").toUpperCase();
  if (["DELIVERY_ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERING", "SHIPPED"].includes(value)) {
    return { key: "配送中", text: "配送中", hint: "正在配送，请保持电话畅通", tone: "green" };
  }
  if (["CANCELLED", "CLOSED", "REJECTED", "REFUNDED"].includes(value)) {
    return { key: "已取消", text: "已取消", hint: "订单已取消，如有疑问请联系我们", tone: "red" };
  }
  if (value === "COMPLETED") {
    return { key: "已完成", text: "已完成", hint: "订单已完成", tone: "gray" };
  }
  if (["ACCEPTED", "APPROVED", "CLERK_REVIEWED", "CONVERTED", "CONVERTED_TO_SALES_DRAFT", "WAITING_STOCK_CONFIRM", "WAITING_PRICE_CONFIRM", "PROCESSING"].includes(value)) {
    return { key: "已接单", text: "已接单", hint: "我们正在准备您的商品", tone: "green" };
  }
  return { key: "已提交", text: "已提交", hint: "我们正在确认商品、价格和配送信息", tone: "orange" };
}

function customerReadableOrderNo(value) {
  const text = String(value || "").trim();
  if (!text) return "订单号待返回";
  return `订单号 ${text.length <= 18 ? text : text.slice(-8)}`;
}

function moneyText(value, fallback) {
  if (fallback) return fallback;
  if (value === null || value === undefined || value === "") return "最终金额待确认";
  const n = Number(value);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : "最终金额待确认";
}

function normalizeOrder(item, index) {
  const status = resolveCustomerStatus(item);
  const rawOrderNo = item.orderNo || item.billNo || item.code || "";
  return Object.assign({}, item, {
    id: item.id || "",
    orderNo: customerReadableOrderNo(rawOrderNo),
    rawOrderNo,
    customerStatus: status.key,
    customerStatusText: status.text,
    customerStatusCode: item.customerStatusCode || "SUBMITTED",
    statusTone: status.tone,
    statusHint: status.hint,
    readableStatus: item.readableStatus || status.text,
    submittedAtText: formatServerDateTime(item.submittedAt || item.createdAt),
    amountText: moneyText(item.totalAmount, item.amountText || item.totalAmountText),
    confirmedSubtotalText: moneyText(item.confirmedSubtotal),
    pendingPriceLineCount: Number(item.pendingPriceLineCount || 0),
    hasPendingPrice: item.priceStatus === "PENDING" || item.priceStatus === "PARTIALLY_PENDING",
    goodsCount: item.goodsCount || item.itemCount || (item.items && item.items.length) || 0,
    goodsCountText: item.goodsCount || item.itemCount || (item.items && item.items.length) ? `共 ${item.goodsCount || item.itemCount || (item.items && item.items.length)} 种商品` : "商品信息确认中",
    icons: item.icons || [],
  });
}

function sessionState(status) {
  const states = {
    GUEST: { text: "请先登录微信小程序后查看订单", action: "去登录" },
    NEED_LOGIN: { text: "请先登录微信小程序后查看订单", action: "去登录" },
    LOGGED_IN_PROFILE_REQUIRED: { text: "请完善门店资料后查看订单", action: "完善资料" },
    NEED_BIND_CUSTOMER: { text: "请完善门店资料后查看订单", action: "完善资料" },
    REGISTERED_PENDING: { text: "门店资料正在确认中", action: "查看进度" },
    BINDING_PENDING_REVIEW: { text: "门店资料正在确认中", action: "查看进度" },
    REJECTED: { text: "门店资料需要补充，请联系业务员", action: "查看资料" },
    BINDING_NOT_ACTIVE: { text: "当前账号暂不可用，请联系业务员", action: "查看资料" },
    DISABLED: { text: "商城账号已停用，请联系业务员", action: "查看资料" },
    CUSTOMER_NOT_ACTIVE: { text: "当前账号暂不可下单，请联系业务员或客服", action: "查看资料" },
  };
  return states[status] || { text: "当前账号暂不可用，请重新登录或联系业务员", action: "查看资料" };
}

function filterOrders(orders, tab) {
  return orders.filter((item) => !tab || tab === "全部" || item.customerStatus === tab);
}

function orderListActive(page) {
  return !page._disposed && page._visible !== false;
}

Page({
  data: {
    storefrontCode: "zhenshang",
    allOrders: [],
    orders: [],
    activeTab: CUSTOMER_TABS[0],
    paymentFilter: "", paymentFilters: [{ value: "", label: "全部付款" }, { value: "WAITING_PAYMENT", label: "待付款" }, { value: "PAID", label: "已付款" }],
    datePresets: ["今天", "昨天", "本周", "本月", "今年"],
    datePanelOpen: false, dateMode: "指定某一天",
    datePreset: "全部", dateFrom: "", dateTo: "", draftDateFrom: "", draftDateTo: "",
    keyword: "",
    appliedKeyword: "",
    loading: false,
    tabs: CUSTOMER_TABS.slice(0, 5), moreTabs: CUSTOMER_TABS.slice(5), moreFiltersOpen: false,
    loadErrorText: "",
    sessionActionText: "",
    page: 1,
    pageSize: 20,
    total: 0,
    loadedOrderCount: 0,
    hasNextPage: false,
    failedOrderPage: 0,
  },
  toggleMoreFilters() { this.setData({ moreFiltersOpen: !this.data.moreFiltersOpen }); },

  onLoad(query) {
    this._disposed = false;
    this._visible = true;
    this._orderNavigation = null;
    const entrance = resolveStorefrontEntrance(query || {});
    let requestedTab = "";
    try { requestedTab = decodeURIComponent(query && query.tab || ""); } catch (_) { /* Invalid links use the default filter. */ }
    this.setData({ storefrontCode: entrance.storefrontCode, activeTab: CUSTOMER_TABS.includes(requestedTab) ? requestedTab : CUSTOMER_TABS[0] });
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    this._visible = true;
    return this.loadOrders();
  },

  onHide() {
    this._visible = false;
    this._orderNavigation = null;
    this._orderRequestId = (this._orderRequestId || 0) + 1;
    this._orderCustomerId = "";
    this.stopOrderPullRefresh();
    this.setData({ allOrders: [], orders: [], loadedOrderCount: 0, page: 1, total: 0, hasNextPage: false,
      keyword: "", appliedKeyword: "", loading: false, loadErrorText: "", sessionActionText: "", failedOrderPage: 0,
    });
  },

  onUnload() {
    this._disposed = true;
    this._visible = false;
    this._orderNavigation = null;
    this._orderRequestId = (this._orderRequestId || 0) + 1;
    this._orderCustomerId = "";
    this.stopOrderPullRefresh();
  },

  stopOrderPullRefresh() {
    this._pullRefreshId = (this._pullRefreshId || 0) + 1;
    if (!this._pullRefreshing) return;
    this._pullRefreshing = false;
    if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
  },

  onPullDownRefresh() {
    if (!orderListActive(this)) return Promise.resolve();
    const refreshId = this._pullRefreshId = (this._pullRefreshId || 0) + 1;
    this._pullRefreshing = true;
    return this.loadOrders().finally(() => {
      if (refreshId === this._pullRefreshId) this.stopOrderPullRefresh();
    });
  },

  loadOrders(reset) {
    if (!orderListActive(this) || (reset === false && (this.data.loading || !this.data.hasNextPage))) return Promise.resolve();
    let append = reset === false;
    let nextPage = append ? this.data.page + 1 : 1;
    const keyword = this.data.appliedKeyword;
    const paymentFilter = this.data.paymentFilter;
    const dateRange = append || ["指定某一天", "自定义"].includes(this.data.datePreset)
      ? { dateFrom: this.data.dateFrom, dateTo: this.data.dateTo } : orderDateRange(this.data.datePreset);
    const customerStatus = Object.keys(CUSTOMER_STATUS_META).filter((code) => code !== "WAITING_FOR_PAYMENT" && CUSTOMER_STATUS_META[code].key === this.data.activeTab).join(",");
    this.setData(dateRange);
    const requestId = this._orderRequestId = (this._orderRequestId || 0) + 1;
    this.setData({ loading: true, loadErrorText: "", sessionActionText: "", failedOrderPage: 0,
      ...(append ? {} : { allOrders: [], orders: [], loadedOrderCount: 0, page: 1, total: 0, hasNextPage: false }),
    });
    return getMallMe(this.data.storefrontCode, "ORDER_LIST_PAGE")
      .then((session) => {
        if (requestId !== this._orderRequestId) return null;
        const customerId = String(session.customer && session.customer.id || "");
        if (session.customerStatus !== "APPROVED_BOUND_CUSTOMER" || !customerId) {
          const state = sessionState(session.customerStatus);
          this._orderCustomerId = "";
          this.setData({ allOrders: [], orders: [], loadedOrderCount: 0, page: 1, total: 0, hasNextPage: false, loadErrorText: state.text, sessionActionText: state.action });
          return null;
        }
        if (append && customerId !== this._orderCustomerId) {
          append = false;
          nextPage = 1;
          this.setData({ allOrders: [], orders: [], loadedOrderCount: 0, page: 1, total: 0, hasNextPage: false });
        }
        this._orderCustomerId = customerId;
        return getOrders(this.data.storefrontCode, { page: nextPage, pageSize: this.data.pageSize, keyword, customerStatus, status: paymentFilter || customerStatus, ...dateRange });
      })
      .then((result) => {
        if (!result || requestId !== this._orderRequestId) return;
        const nextOrders = (result.items || result.orders || []).map(normalizeOrder).filter((item) => item.id);
        const seen = new Set();
        const allOrders = (append ? this.data.allOrders.concat(nextOrders) : nextOrders)
          .filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
        const total = Number(result.total);
        this.setData({ allOrders, loadErrorText: "", sessionActionText: "", failedOrderPage: 0,
          page: Number(result.page || nextPage), total: Number.isFinite(total) ? total : allOrders.length,
          hasNextPage: nextOrders.length > 0 && Boolean(result.hasNextPage),
        });
        this.applyFilter();
      })
      .catch((error) => {
        if (requestId !== this._orderRequestId) return;
        const state = sessionState(error.code);
        const isSessionError = ["NEED_LOGIN", "SESSION_EXPIRED", "SESSION_INVALID", "UNAUTHORIZED", "NEED_BIND_CUSTOMER", "BINDING_PENDING_REVIEW", "BINDING_NOT_ACTIVE", "CUSTOMER_NOT_ACTIVE"].includes(error.code);
        this.setData({
          ...(append && !isSessionError ? {} : { allOrders: [], orders: [], loadedOrderCount: 0, page: 1, total: 0, hasNextPage: false }),
          failedOrderPage: isSessionError ? 0 : nextPage,
          loadErrorText: isSessionError ? state.text : getSafeMallErrorMessage(error, "订单加载失败，请刷新或联系业务员"),
          sessionActionText: isSessionError ? state.action : "",
        });
        this.applyFilter();
      })
      .finally(() => { if (requestId === this._orderRequestId) this.setData({ loading: false }); });
  },

  loadMore() {
    return this.loadOrders(false);
  },

  retryOrders() {
    if (!orderListActive(this) || this.data.loading) return Promise.resolve();
    return this.loadOrders(this.data.failedOrderPage <= 1);
  },

  goSessionAction() {
    if (!orderListActive(this)) return;
    wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
  },

  setTab(event) {
    if (!orderListActive(this)) return Promise.resolve();
    const tab = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.tab;
    if (!CUSTOMER_TABS.includes(tab) || tab === this.data.activeTab) return Promise.resolve();
    this.setData({ activeTab: tab });
    return this.loadOrders();
  },

  setPaymentFilter(event) {
    if (!orderListActive(this)) return;
    const paymentFilter = event.currentTarget.dataset.value;
    if (!["", "WAITING_PAYMENT", "PAID"].includes(paymentFilter)) return;
    this.setData({ paymentFilter });
    return this.loadOrders();
  },
  setDatePreset(event) {
    if (!orderListActive(this)) return;
    const datePreset = event.currentTarget.dataset.preset;
    if (![...this.data.datePresets, "全部", "指定某一天", "自定义"].includes(datePreset)) return;
    if (["指定某一天", "自定义"].includes(datePreset)) { this.setData({ datePanelOpen: true, dateMode: datePreset }); return; }
    this.setData({ datePreset });
    if (["指定某一天", "自定义"].includes(datePreset)) return;
    this.setData(orderDateRange(datePreset));
    return this.loadOrders();
  },
  openDatePanel() { this.setData({ datePanelOpen: true, draftDateFrom: this.data.dateFrom, draftDateTo: this.data.dateTo }); },
  closeDatePanel() { this.setData({ datePanelOpen: false }); },
  keepDatePanel() {},
  setDateMode(event) { this.setData({ dateMode: event.currentTarget.dataset.mode }); },
  clearDateFilter() { this.setData({ datePreset: "全部", dateFrom: "", dateTo: "", datePanelOpen: false }); return this.loadOrders(); },
  pickDate(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== "draftDateFrom" && field !== "draftDateTo") return;
    this.setData({ [field]: event.detail.value });
  },
  applyDates() {
    const dateFrom = this.data.draftDateFrom;
    const dateTo = this.data.dateMode === "指定某一天" ? dateFrom : this.data.draftDateTo;
    if (!dateFrom || !dateTo || dateFrom > dateTo) return wx.showToast({ title: "请选择有效日期范围", icon: "none" });
    this.setData({ dateFrom, dateTo, datePreset: this.data.dateMode, datePanelOpen: false });
    return this.loadOrders();
  },

  inputKeyword(event) {
    if (!orderListActive(this)) return;
    this.setData({ keyword: String(event.detail.value || "").slice(0, 100) });
  },

  search() {
    if (!orderListActive(this)) return Promise.resolve();
    const keyword = String(this.data.keyword || "").trim().slice(0, 100);
    this.setData({ keyword, appliedKeyword: keyword });
    return this.loadOrders();
  },

  applyFilter() {
    if (!orderListActive(this)) return;
    this.setData({ orders: filterOrders(this.data.allOrders, this.data.activeTab), loadedOrderCount: this.data.allOrders.length });
  },

  goDetail(event) {
    this.openOrderDetail(event, false);
  },

  reorder(event) {
    this.openOrderDetail(event, true);
  },

  openOrderDetail(event, repeatPurchase) {
    if (!orderListActive(this) || this.data.loading || this._orderNavigation) return;
    const id = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    if (typeof id !== "string" || !id || !this.data.orders.some((order) => order.id === id)) return;
    const navigation = { requestId: this._orderRequestId };
    this._orderNavigation = navigation;
    wx.navigateTo({
      url: `/pages/orders/detail?id=${encodeURIComponent(id)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}${repeatPurchase ? "&reorder=1" : ""}`,
      fail: () => {
        if (this._orderNavigation !== navigation) return;
        this._orderNavigation = null;
        if (orderListActive(this) && navigation.requestId === this._orderRequestId) {
          wx.showToast({ title: "订单详情打开失败，请重试", icon: "none" });
        }
      },
    });
  },

  contact() {
    if (!orderListActive(this)) return;
    wx.showToast({ title: "微信客服当前不可用，请联系业务员", icon: "none" });
  },

  goHome() {
    if (!orderListActive(this)) return;
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goCategory() {
    if (!orderListActive(this)) return;
    wx.navigateTo({ url: `/pages/category/category?storefrontCode=${this.data.storefrontCode}` });
  },

  goCart() {
    if (!orderListActive(this)) return;
    wx.navigateTo({ url: `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    if (!orderListActive(this)) return;
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const previous = pages[pages.length - 2];
    const openAccount = () => wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
    if (previous && previous.route === "pages/me/me" && previous.data.storefrontCode === this.data.storefrontCode) {
      return wx.navigateBack({ delta: 1, fail: openAccount });
    }
    openAccount();
  },
});
