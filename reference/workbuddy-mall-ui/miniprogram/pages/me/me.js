const {
  getAddresses,
  getMallMe,
  getMallCoupons,
  getMallFinance,
  getSafeMallErrorMessage,
  logoutMallSession,
  prepareWechatLoginWithPrivacy,
} = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
const {
  captureInviteEntrance,
  clearInviteScene,
  navigateToPendingInvite,
  readInviteScene,
} = require("../../utils/invite");

const AUTH_SHEET_CLOSED = "CLOSED";
const AUTH_SHEET_OPEN_IDLE = "OPEN_IDLE";
const AUTH_SHEET_LOGIN_PENDING = "LOGIN_PENDING";
const AUTH_SHEET_LOGIN_ERROR = "LOGIN_ERROR";
const AUTH_SHEET_STATES = {
  [AUTH_SHEET_CLOSED]: true,
  [AUTH_SHEET_OPEN_IDLE]: true,
  [AUTH_SHEET_LOGIN_PENDING]: true,
  [AUTH_SHEET_LOGIN_ERROR]: true,
};

function maskName(value) {
  const text = String(value || "").trim();
  return text ? `${text.slice(0, 1)}${"*".repeat(Math.min(2, Math.max(1, text.length - 1)))}` : "-";
}

function maskPhone(value) {
  const text = String(value || "").trim();
  if (text.length < 7) return text ? `${text.slice(0, 2)}***` : "-";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function maskAddress(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.length <= 8 ? `${text.slice(0, 3)}***` : `${text.slice(0, 6)}***${text.slice(-3)}`;
}

function resolveCustomerView(status, binding) {
  const rejectionReason = (binding && (binding.statusReason || binding.rejectionReason)) || "";
  const map = {
    GUEST: {
      customerStatus: "GUEST",
      mode: "GUEST",
      tag: "未登录",
      title: "点击登录",
      desc: "登录后可查看商品价格、常购商品并快速下单。",
      panelTitle: "",
      panelDesc: "",
      primaryAction: "login",
      primaryText: "微信登录",
    },
    LOGGED_IN_PROFILE_REQUIRED: {
      customerStatus: "LOGGED_IN_PROFILE_REQUIRED",
      mode: "PROFILE",
      tag: "待完善",
      title: "完善门店资料",
      desc: "补充门店信息后，工作人员将尽快为您开通下单能力。",
      panelTitle: "完善门店资料",
      panelDesc: "请填写店名、联系人和收货地址。",
      primaryAction: "profile",
      primaryText: "开始完善资料",
    },
    REGISTERED_PENDING: {
      customerStatus: "REGISTERED_PENDING",
      mode: "PENDING",
      tag: "确认中",
      title: "资料确认中",
      desc: "工作人员正在处理，请耐心等待。",
      panelTitle: "资料确认中",
      panelDesc: "确认完成后即可查看价格并下单。",
      primaryAction: "",
      primaryText: "",
    },
    BINDING_PENDING_REVIEW: {
      customerStatus: "BINDING_PENDING_REVIEW",
      mode: "PENDING",
      tag: "确认中",
      title: "资料确认中",
      desc: "工作人员正在处理，请耐心等待。",
      panelTitle: "资料确认中",
      panelDesc: "确认完成后即可查看价格并下单。",
      primaryAction: "",
      primaryText: "",
    },
    APPROVED_BOUND_CUSTOMER: {
      customerStatus: "APPROVED_BOUND_CUSTOMER",
      mode: "BOUND",
      tag: "",
      title: (binding && binding.customer && binding.customer.name) || (binding && binding.shopName) || "客户账户",
      desc: "",
      panelTitle: "",
      panelDesc: "",
      primaryAction: "home",
      primaryText: "去商城首页",
    },
    REJECTED: {
      customerStatus: "REJECTED",
      mode: "REJECTED",
      tag: "需补充",
      title: "需补充资料",
      desc: rejectionReason || "请按提示补充资料后重新提交。",
      panelTitle: "需补充资料",
      panelDesc: rejectionReason || "请补充门店资料后再次提交。",
      primaryAction: "profile",
      primaryText: "补充资料",
    },
    BINDING_NOT_ACTIVE: {
      customerStatus: "BINDING_NOT_ACTIVE",
      mode: "BLOCKED",
      tag: "暂不可用",
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      panelTitle: "当前账号暂不可下单",
      panelDesc: "请联系业务员或客服协助处理。",
      primaryAction: "service",
      primaryText: "联系客服",
    },
    DISABLED: {
      customerStatus: "DISABLED",
      mode: "BLOCKED",
      tag: "暂不可用",
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      panelTitle: "当前账号暂不可下单",
      panelDesc: "请联系业务员或客服协助处理。",
      primaryAction: "service",
      primaryText: "联系客服",
    },
    CUSTOMER_NOT_ACTIVE: {
      customerStatus: "CUSTOMER_NOT_ACTIVE",
      mode: "BLOCKED",
      tag: "暂不可用",
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      panelTitle: "当前账号暂不可下单",
      panelDesc: "请联系业务员或客服协助处理。",
      primaryAction: "service",
      primaryText: "联系客服",
    },
  };
  if (status === "DISABLED" && binding && binding.accountStatus === "REBIND_REQUIRED") {
    return {
      customerStatus: "DISABLED",
      mode: "REBIND_REQUIRED",
      tag: "需重新绑定",
      title: (binding.customer && binding.customer.name) || binding.shopName || "账号已解绑",
      desc: rejectionReason || "请联系业务员获取新的商城码并重新绑定门店。",
      panelTitle: "账号已解绑",
      panelDesc: rejectionReason || "旧二维码和旧会话均已失效，请联系业务员重新绑定。",
      primaryAction: "service",
      primaryText: "联系客服",
    };
  }
  if (status === "DISABLED") {
    return Object.assign({}, map.DISABLED, {
      title: (binding && binding.customer && binding.customer.name) || map.DISABLED.title,
      desc: rejectionReason || map.DISABLED.desc,
      panelDesc: rejectionReason || map.DISABLED.panelDesc,
    });
  }
  if (status === "UNBOUND") return map.LOGGED_IN_PROFILE_REQUIRED;
  return map[status] || map.GUEST;
}

function resolvePostLoginProfile(loginResult, profileResult) {
  const loginStatus = String((loginResult && (loginResult.customerStatus || loginResult.code)) || "");
  const profileStatus = String((profileResult && profileResult.customerStatus) || "");
  const recoverableAuthenticatedStatus = [
    "LOGGED_IN_PROFILE_REQUIRED",
    "UNBOUND",
    "REGISTERED_PENDING",
    "BINDING_PENDING_REVIEW",
    "REJECTED",
  ].indexOf(loginStatus) >= 0;
  return profileStatus === "GUEST" && recoverableAuthenticatedStatus
    ? loginResult
    : profileResult;
}

function presentMembership(result) {
  if (!result || result.customerStatus !== "APPROVED_BOUND_CUSTOMER") return null;
  const member = result.member;
  if (!member || member.memberStatus !== "ACTIVE" || !["CUSTOMER_ADMIN", "ORDER_APPROVER", "BUYER", "VIEWER"].includes(member.memberRole)
    || !Array.isArray(member.effectiveMallCapabilities) || !member.effectiveMallCapabilities.includes("MALL_VIEW")
    || (result.featureFlags && result.featureFlags.membership === false)) return null;
  const commercial = result.commercialMembership;
  if (!commercial || commercial.enabled !== true || !commercial.membership) return null;
  const membership = commercial.membership;
  if (!membership.tier || typeof membership.tier.name !== "string" || !membership.tier.name.trim()) return null;
  return { roleText: membership.tier.name, message: membership.tier.description,
    benefits: Array.isArray(membership.benefits) ? membership.benefits.filter(item => item && typeof item.name === "string" && typeof item.description === "string") : [] };
}

Page({
  async loadReceivableSummary() {
    if (this._disposed || this._accountVisible === false || this.data.accountLoading || this.data.accountError || !this.data.canViewMall || this.data.customerStatus !== "APPROVED_BOUND_CUSTOMER") return;
    const identityVersion=this._accountVersion;
    const code=this.data.storefrontCode;
    const version=this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    try {
      const result=await require('../../utils/request').request({path:'/api/mall/receivables',storefrontCode:this.data.storefrontCode,data:{pageSize:1}});
      if (version===this._receivableVersion && identityVersion===this._accountVersion && code===this.data.storefrontCode && this._accountVisible && !this._disposed && result.state==='OPEN_RECEIVABLES') this.setData({receivableSummary:result.summary});
    } catch (_) { /* An unavailable read does not become a zero balance. */ }
  },
  goReceivableCenter() { wx.navigateTo({url:'/pages/receivables/center?storefrontCode='+encodeURIComponent(this.data.storefrontCode)}); },
  data: {
    storefrontCode: "zhenshang",
    customerStatus: "GUEST",
    customerMode: "GUEST",
    accountTagText: "未登录",
    profileName: "点击登录",
    profileDesc: "登录后可查看商品价格、常购商品并快速下单。",
    panelTitle: "",
    panelDesc: "",
    primaryAction: "login",
    primaryText: "微信登录",
    showStatusPanel: false,
    ownerName: "",
    ownerPhone: "",
    customerName: "",
    accountLoading: false,
    accountError: "",
    membershipInfo: null,
    membershipExpanded: false,
    customerTypeText: "",
    canViewMall: false,
    couponState: "HIDDEN",
    couponMessage: "",
    couponCanClaim: false,
    financeAllowed: false,
    finance: null,
    financeLoading: false,
    financeError: "",
    orderEntries: [
      { tab: "已提交", icon: "order", name: "已提交" },
      { tab: "已接单", icon: "check", name: "已接单" },
      { tab: "配送中", icon: "truck", name: "配送中" },
      { tab: "已完成", icon: "done", name: "已完成" },
    ],
    contactNameMasked: "",
    contactPhoneMasked: "",
    defaultAddressMasked: "",
    showAccountInfo: false,
    rejectionReason: "",
    authSheetVisible: false,
    authSubmitting: false,
    authSheetState: AUTH_SHEET_CLOSED,
    loginError: "",
    customerExperienceVisible: false,
    accountExperienceEnabled: false,
    campaignExperienceEnabled: false,
    accountExperience: null,
    campaignExperience: null,
    campaignCountText: "",
    services: [
      { key: "orders", icon: "单", name: "我的订单" },
      { key: "profile", icon: "资", name: "门店资料" },
      { key: "address", icon: "址", name: "收货地址" },
      { key: "service", icon: "客", name: "联系业务员" },
    ],
  },

  setAuthSheetState(state, errorMessage, afterRender) {
    if (!AUTH_SHEET_STATES[state]) return;
    this.setData({
      authSheetState: state,
      accountLoading: false,
      authSheetVisible: state !== AUTH_SHEET_CLOSED,
      authSubmitting: state === AUTH_SHEET_LOGIN_PENDING,
      loginError: state === AUTH_SHEET_LOGIN_ERROR ? String(errorMessage || "微信登录失败，请稍后重试") : "",
    }, typeof afterRender === "function" ? afterRender : undefined);
  },

  onLoad(query) {
    this._disposed = false;
    this._accountVisible = true;
    const safeQuery = query || {};
    const entrance = resolveStorefrontEntrance(safeQuery);
    captureInviteEntrance(safeQuery);
    this.setData({ storefrontCode: entrance.storefrontCode });
    if (navigateToPendingInvite(entrance.storefrontCode)) return;
    if (String(safeQuery.openAuth || "") === "1") {
      this.openAuthSheet();
    }
  },

  onShow() {
    this._accountVisible = true;
    if (navigateToPendingInvite(this.data.storefrontCode)) return;
    if (this.data.authSheetState !== AUTH_SHEET_CLOSED) return;
    return this.loadAccountStatus();
  },

  onPullDownRefresh() {
    return this.loadAccountStatus().finally(() => wx.stopPullDownRefresh());
  },

  onHide() {
    this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    this._accountVisible = false;
    this._accountVersion = (this._accountVersion || 0) + 1;
    this.clearAccountData();
    this._authLoginInFlight = false;
    if (this.data.authSheetState !== AUTH_SHEET_CLOSED) {
      this.setAuthSheetState(AUTH_SHEET_CLOSED);
    }
  },

  onUnload() {
    this._disposed = true;
    this._accountVisible = false;
    this._accountVersion = (this._accountVersion || 0) + 1;
    this._authLoginInFlight = false;
  },

  applyCustomerView(status, binding, extras) {
    const view = resolveCustomerView(status, binding || {});
    const canOrder = status === "APPROVED_BOUND_CUSTOMER" && !!(extras && extras.canOrder);
    const viewOnly = status === "APPROVED_BOUND_CUSTOMER" && !canOrder;
    this.setData({
      customerStatus: view.customerStatus,
      customerMode: viewOnly ? "VIEW_ONLY" : view.mode,
      accountTagText: viewOnly ? "仅浏览" : view.tag,
      profileName: view.title,
      profileDesc: viewOnly ? "可以查看商品价格，当前账号仅支持浏览。" : view.desc,
      panelTitle: view.panelTitle,
      panelDesc: view.panelDesc,
      primaryAction: view.primaryAction,
      primaryText: view.primaryText,
      showStatusPanel: !viewOnly && view.mode !== "GUEST" && view.mode !== "BOUND",
      rejectionReason: (binding && (binding.statusReason || binding.rejectionReason)) || "",
      ownerName: (extras && extras.ownerName) || "",
      ownerPhone: (extras && extras.ownerPhone) || "",
    });
    return view;
  },

  applyCustomerExperience(status, experience) {
    const bound = status === "APPROVED_BOUND_CUSTOMER";
    const features = (experience && experience.features) || {};
    const accountEnabled = bound && features.accountEnabled === true;
    const campaignEnabled = bound && features.campaignEnabled === true;
    const campaigns = campaignEnabled && experience && experience.campaigns
      ? experience.campaigns
      : null;
    const campaignItems = campaigns && Array.isArray(campaigns.items) ? campaigns.items : [];
    this.setData({
      customerExperienceVisible: accountEnabled || campaignEnabled,
      accountExperienceEnabled: accountEnabled,
      campaignExperienceEnabled: campaignEnabled,
      accountExperience: accountEnabled && experience ? experience.account : null,
      campaignExperience: campaigns,
      campaignCountText: campaigns && campaigns.unavailable
        ? "活动暂不可用"
        : campaignItems.length > 0
          ? `${campaignItems.length} 个可见活动`
          : "暂无进行中的活动",
    });
  },

  clearAccountData() {
    this.setData({ financeAllowed: false, finance: null, financeLoading: false, financeError: "" });
    this.applyCustomerView("GUEST", null, {});
    this.applyCustomerExperience("GUEST", null);
    this.setData({ showAccountInfo: false, membershipInfo: null, membershipExpanded: false, customerTypeText: "", canViewMall: false, couponState: "HIDDEN", couponMessage: "", couponCanClaim: false, customerName: "", contactNameMasked: "", contactPhoneMasked: "", defaultAddressMasked: "", accountLoading: false, accountError: "" });
  },

  loadAccountStatus() {
    if (this._disposed || this._accountVisible === false) return Promise.resolve();
    const version = this._accountVersion = (this._accountVersion || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._accountVisible !== false && this._accountVersion === version && this.data.storefrontCode === code;
    this._receivableVersion=(this._receivableVersion||0)+1;
    this.setData({receivableSummary:null});
    this.clearAccountData();
    this.setData({ accountLoading: true });
    return getMallMe(code, "ME_PAGE")
      .then((result) => {
        if (!current()) return null;
        const binding = result.binding || {};
        const owner = binding.ownerSalesperson || null;
        const orderContact = result.orderContact || null;
        const canOrder = result.customerStatus === "APPROVED_BOUND_CUSTOMER"
          && !!(result.priceAccess && result.priceAccess.canOrder);
        this.applyCustomerView(result.customerStatus || "GUEST", binding, {
          canOrder,
          ownerName: orderContact ? orderContact.ownerName : (owner ? owner.name : ""),
          ownerPhone: orderContact && orderContact.ownerPhone ? orderContact.ownerPhone : "",
        });
        this.applyCustomerExperience(result.customerStatus || "GUEST", result.customerExperience || null);
        const member = result.member;
        const canViewMall = result.customerStatus === "APPROVED_BOUND_CUSTOMER"
          && !!(member && member.memberStatus === "ACTIVE" && Array.isArray(member.effectiveMallCapabilities) && member.effectiveMallCapabilities.includes("MALL_VIEW"));
        this.setData({ membershipInfo: presentMembership(result), accountLoading: false, canViewMall,
          customerTypeText: ({ RETAIL: "零售客户", WHOLESALE: "批发客户" })[result.customer && result.customer.customerType] || "",
        });
        if (canViewMall) { this.loadReceivableSummary(); this.loadCouponSummary(); }
        this.setData({ financeAllowed: canViewMall && member.memberRole === "CUSTOMER_ADMIN" });
        if (this.data.financeAllowed) this.loadFinanceSummary();
        const safeCustomer = result.customer || binding.customer || null;
        if (safeCustomer) {
          const customerName = safeCustomer.name || binding.shopName || "客户账户";
          this.setData({
            showAccountInfo: true,
            customerName,
            profileName: result.customerStatus === "APPROVED_BOUND_CUSTOMER" ? customerName : this.data.profileName,
            profileDesc: result.customerStatus === "APPROVED_BOUND_CUSTOMER" ? "" : this.data.profileDesc,
            contactNameMasked: maskName(safeCustomer.contactName),
            contactPhoneMasked: maskPhone(safeCustomer.phone),
            defaultAddressMasked: maskAddress(safeCustomer.address),
          });
        } else {
          this.setData({ showAccountInfo: false });
        }
        if (result.customerStatus !== "APPROVED_BOUND_CUSTOMER" || !result.customer) return null;
        return getAddresses(code)
          .then((addressesResult) => {
          if (!current()) return null;
          const addresses = addressesResult.addresses || [];
          const defaultAddress = addresses.find((item) => item.isDefault) || addresses[0] || null;
          this.setData({
            defaultAddressMasked: maskAddress(defaultAddress ? defaultAddress.fullAddress : result.customer.address),
          });
          return null;
          })
          .catch(() => null);
      })
      .catch((error) => {
        if (!current()) return;
        this.clearAccountData();
        this.setData({ accountError: getSafeMallErrorMessage(error, "账户信息读取失败，请重试") });
      });
  },

  loadFinanceSummary() {
    if (this._disposed || this._accountVisible === false || !this.data.financeAllowed) return Promise.resolve();
    const version = this._accountVersion;
    const requestId = this._financeRequestId = (this._financeRequestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._accountVisible !== false && version === this._accountVersion
      && requestId === this._financeRequestId && code === this.data.storefrontCode && this.data.financeAllowed;
    this.setData({ finance: null, financeLoading: true, financeError: "" });
    return Promise.resolve().then(() => getMallFinance(code)).then((result) => {
      if (!current()) return;
      const finance = result && result.finance;
      if (!finance || !finance.receivable || !finance.credit || !finance.balance || !finance.receipts) throw new Error("INCOMPLETE_FINANCE_READ");
      this.setData({ finance, financeLoading: false });
    }).catch((error) => {
      if (!current()) return;
      const denied = error && (error.code === "FINANCE_ACCESS_DENIED" || error.code === "NEED_LOGIN");
      this.setData({ finance: null, financeLoading: false, financeAllowed: !denied,
        financeError: denied ? "" : "账户账务读取失败，请重试" });
    });
  },

  loadCouponSummary() {
    if (this._disposed || this._accountVisible === false || !this.data.canViewMall || this.data.accountLoading || this.data.accountError) return Promise.resolve();
    const version = this._accountVersion;
    const requestId = this._couponRequestId = (this._couponRequestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._accountVisible !== false && version === this._accountVersion
      && requestId === this._couponRequestId && code === this.data.storefrontCode && this.data.canViewMall;
    this.setData({ couponState: "LOADING", couponMessage: "正在读取优惠券…", couponCanClaim: false });
    return Promise.resolve().then(() => getMallCoupons(code)).then((result) => {
      if (!current()) return;
      if (result && (result.featureEnabled === false || result.enabled === false)) { this.setData({ couponState: "HIDDEN", couponMessage: "", couponCanClaim: false }); return; }
      if (!result || !Array.isArray(result.available) || !Array.isArray(result.mine)) throw new Error("COUPON_READ_INCOMPLETE");
      // Lists are not authoritative usable/quota/expiring counters. Never infer
      // eligibility or an expiry window in the account presentation.
      this.setData({ couponState: "READY", couponCanClaim: result.canClaim === true,
        couponMessage: result.mine.length === 0 && result.available.length === 0 ? "当前暂无优惠券" : "查看已领取优惠券与当前优惠",
      });
    }).catch((error) => {
      if (!current()) return;
      const off = error && error.code === "COUPON_DISABLED";
      this.setData({ couponState: off ? "HIDDEN" : "ERROR", couponCanClaim: false,
        couponMessage: off ? "" : getSafeMallErrorMessage(error, "优惠券读取失败，请重试"),
      });
    });
  },

  toggleMembership() {
    if (this._disposed || this._accountVisible === false || !this.data.membershipInfo || this.data.accountLoading || this.data.accountError) return;
    this.setData({ membershipExpanded: !this.data.membershipExpanded });
  },

  openOrderStatus(event) {
    if (!this.data.canViewMall || this._disposed || this._accountVisible === false || this.data.accountLoading || this.data.accountError) return;
    const tab = event.currentTarget.dataset.tab;
    if (!this.data.orderEntries.some((entry) => entry.tab === tab)) return;
    wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&tab=${encodeURIComponent(tab)}` });
  },

  openAuthSheet() {
    if (this._disposed || this._accountVisible === false || this.data.authSheetState !== AUTH_SHEET_CLOSED) return;
    this._accountVersion = (this._accountVersion || 0) + 1;
    this.setAuthSheetState(AUTH_SHEET_OPEN_IDLE);
  },

  closeAuthSheet() {
    if (this.data.authSheetState === AUTH_SHEET_CLOSED || this.data.authSheetState === AUTH_SHEET_LOGIN_PENDING) return;
    this.setAuthSheetState(AUTH_SHEET_CLOSED);
  },

  onPrivacyOpened() {
    if (this.data.authSheetState === AUTH_SHEET_LOGIN_ERROR) {
      this.setAuthSheetState(AUTH_SHEET_OPEN_IDLE);
    }
  },

  onPrivacyBlock(event) {
    if (this.data.authSheetState === AUTH_SHEET_CLOSED || this.data.authSheetState === AUTH_SHEET_LOGIN_PENDING) return;
    const reason = event && event.detail && event.detail.reason;
    const message = reason === "API_UNSUPPORTED"
      ? "当前微信版本暂不支持打开隐私指引，请升级微信后重试"
      : "暂无法打开隐私保护指引，请稍后重试";
    this.setAuthSheetState(AUTH_SHEET_LOGIN_ERROR, message);
  },

  onAuthLogin(event) {
    if (
      this.data.authSheetState === AUTH_SHEET_CLOSED
      || this.data.authSheetState === AUTH_SHEET_LOGIN_PENDING
      || this._authLoginInFlight
    ) return;
    if (!(event && event.detail && event.detail.privacyAgreed === true)) {
      this.setAuthSheetState(AUTH_SHEET_LOGIN_ERROR, "请先阅读并同意隐私保护指引");
      return;
    }

    this._authLoginInFlight = true;
    const version = this._accountVersion = (this._accountVersion || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._accountVisible !== false && this._accountVersion === version && this.data.storefrontCode === code;
    this.setAuthSheetState(AUTH_SHEET_LOGIN_PENDING, "", () => {
      if (!current()) return;
      const inviteScene = readInviteScene();
      prepareWechatLoginWithPrivacy(code, inviteScene)
        .then((loginResult) => current() ? getMallMe(code, "ME_PAGE_AFTER_LOGIN")
          .then((profileResult) => resolvePostLoginProfile(loginResult, profileResult)) : null)
        .then((result) => {
          if (!current()) return;
          this._authLoginInFlight = false;
          const binding = result.binding || {};
          const view = this.applyCustomerView(result.customerStatus || "GUEST", binding, {
            canOrder: result.customerStatus === "APPROVED_BOUND_CUSTOMER"
              && !!(result.priceAccess && result.priceAccess.canOrder),
          });
          this.setAuthSheetState(AUTH_SHEET_CLOSED);
          if (inviteScene && navigateToPendingInvite(this.data.storefrontCode)) return;
          if (view.mode === "BOUND") {
            wx.showToast({ title: "登录成功", icon: "success" });
            wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
            return;
          }
          if (view.primaryAction === "profile") {
            wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
            return;
          }
          wx.showToast({ title: view.title, icon: "none" });
        })
        .catch((error) => {
          if (!current()) return;
          this._authLoginInFlight = false;
          const message = getSafeMallErrorMessage(error, "微信登录失败，请稍后重试");
          this.setAuthSheetState(AUTH_SHEET_LOGIN_ERROR, message);
          wx.showToast({
            title: message,
            icon: "none",
          });
        });
    });
  },

  onPrimaryAction() {
    const action = this.data.primaryAction;
    if (action === "login") return this.openAuthSheet();
    if (action === "profile") {
      return wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
    }
    if (action === "home") return this.goHome();
    if (action === "service") return this.goService({ currentTarget: { dataset: { key: "service" } } });
  },

  goService(event) {
    if (this._disposed || this._accountVisible === false || this.data.accountLoading || this.data.accountError) return;
    const key = event.currentTarget.dataset.key;
    if (key === "waiting-payment" && this.data.canViewMall) return this.goReceivableCenter();
    if (key === "payment-records" || key === "prepaid-records") {
      if (!this.data.canViewMall) return;
      return wx.navigateTo({ url: key === "prepaid-records"
        ? `/pages/payments/batch-history?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&tab=PREPAID`
        : `/pages/payments/payment?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&mode=history` });
    }
    if (key === "membership") {
      if (!this.data.canViewMall || !this.data.membershipInfo) return;
      return wx.navigateTo({ url: `/pages/membership/membership?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
    }
    if (key === "finance") {
      if (!this.data.financeAllowed || !this.data.finance) return;
      return wx.navigateTo({ url: `/pages/account/finance?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
    }
    if (key === "coupons" || key === "coupon-center") {
      if (!this.data.canViewMall || this.data.couponState !== "READY") return;
      return wx.navigateTo({ url: `/pages/coupons/coupons?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&tab=${key === "coupons" ? "MINE" : "AVAILABLE"}` });
    }
    if (key === "orders") return this.goOrders();
    if (key === "profile") {
      if (this.data.customerStatus === "GUEST") return this.openAuthSheet();
      return wx.navigateTo({ url: `/pages/auth/status?storefrontCode=${this.data.storefrontCode}` });
    }
    if (key === "address") {
      if (this.data.customerStatus === "GUEST") return this.openAuthSheet();
      return wx.navigateTo({ url: `/pages/address/list?storefrontCode=${this.data.storefrontCode}` });
    }
    if (key === "account") {
      if (!this.data.accountExperienceEnabled) return;
      if (this.data.customerStatus !== "APPROVED_BOUND_CUSTOMER") return this.openAuthSheet();
      return wx.navigateTo({ url: `/pages/account/account?storefrontCode=${this.data.storefrontCode}` });
    }
    if (key === "campaigns") {
      if (!this.data.campaignExperienceEnabled) return;
      if (this.data.customerStatus !== "APPROVED_BOUND_CUSTOMER") return this.openAuthSheet();
      return wx.navigateTo({ url: `/pages/campaigns/list?storefrontCode=${this.data.storefrontCode}` });
    }
    if (key === "service" && this.data.ownerPhone) return wx.makePhoneCall({ phoneNumber: this.data.ownerPhone });
    if (key === "service") return wx.showToast({ title: "当前暂无联系电话，请联系公司客服", icon: "none" });
    wx.showToast({ title: "该功能当前不可用", icon: "none" });
  },

  goOrders() {
    if (this._disposed || this._accountVisible === false || this.data.accountLoading || this.data.accountError) return;
    if (this.data.customerStatus === "GUEST") return this.openAuthSheet();
    wx.navigateTo({ url: `/pages/orders/list?storefrontCode=${this.data.storefrontCode}` });
  },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goCategory() {
    wx.navigateTo({ url: `/pages/category/category?storefrontCode=${this.data.storefrontCode}` });
  },

  goCart() {
    wx.navigateTo({ url: `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}` });
  },

  logout() {
    this.setData({ financeAllowed: false, finance: null, financeLoading: false, financeError: "" });
    this._accountVersion = (this._accountVersion || 0) + 1;
    this._authLoginInFlight = false;
    logoutMallSession();
    clearInviteScene();
    this.setAuthSheetState(AUTH_SHEET_CLOSED);
    this.applyCustomerView("GUEST", null, {});
    this.setData({
      showAccountInfo: false,
      customerName: "",
      contactNameMasked: "",
      contactPhoneMasked: "",
      defaultAddressMasked: "",
    });
    this.applyCustomerExperience("GUEST", null);
    this.setData({ membershipInfo: null, membershipExpanded: false, canViewMall: false, customerTypeText: "", couponState: "HIDDEN", couponMessage: "", couponCanClaim: false, accountLoading: false, accountError: "" });
    wx.showToast({ title: "已退出登录", icon: "success" });
  },
});
