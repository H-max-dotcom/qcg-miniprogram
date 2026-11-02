const { claimIssuedMallCoupon, claimMallCoupon, createClientRequestId, formatServerDateTime, getMallCoupons, getMallMe, getSafeMallErrorMessage } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

function selectedKey(code) { return `qcg.mall.selected-coupon.v1:${code || "zhenshang"}`; }
function intentKey(code, customerId, templateId) { return `qcg.mall.coupon-claim.v1:${code}:${customerId}:${templateId}`; }
const TYPE_TEXT = { NEW_PRODUCT_TRIAL: "新品体验", DORMANT_SKU: "精选商品", REPURCHASE: "常购优惠", THRESHOLD: "满额优惠", CUSTOMER_RECALL: "专属优惠", BRAND: "品牌优惠", SPECIFIED_SKU: "指定商品" };
const STATUS_TEXT = { ISSUED: "待领取", CLAIMED: "可选用", RESERVED: "订单占用中", USED: "已使用", EXPIRED: "已过期", VOIDED: "已失效" };
const CLAIM_ERROR_TEXT = {
  "Coupon 已领完": "该优惠券已领完",
  "已达到每客户领取上限": "当前客户已达到该券的领取上限",
  "当前客户不在 Coupon 适用范围": "该优惠券暂不适用于当前客户",
  "Coupon 当前不可领取": "该优惠券当前不可领取，请刷新查看",
};
const CLAIM_PUBLIC_ERRORS = new Set([
  ...Object.keys(CLAIM_ERROR_TEXT).map((key) => CLAIM_ERROR_TEXT[key]),
  "领取请求未能确认，请刷新查看已领取的优惠券",
  "请选择一张优惠券领取",
  "领取请求无效，请重新进入优惠券页面",
]);

function claimErrorText(error) {
  if (!error || error.code !== "COUPON_REQUEST_FAILED") return "";
  if (Object.prototype.hasOwnProperty.call(CLAIM_ERROR_TEXT, error.message)) return CLAIM_ERROR_TEXT[error.message];
  return CLAIM_PUBLIC_ERRORS.has(error.message) ? error.message : "";
}

function customerIdFrom(result) {
  return result && result.customerStatus === "APPROVED_BOUND_CUSTOMER" && result.customer && result.customer.id ? String(result.customer.id) : "";
}

function templateText(template) {
  if (!template || template.thresholdAmount === null || template.benefitValue === null || !["FIXED_REDUCTION", "PERCENT_DISCOUNT"].includes(template.benefitType)) return "优惠详情暂不可用";
  const threshold = Number(template.thresholdAmount);
  const benefit = Number(template.benefitValue);
  if (!Number.isFinite(threshold) || !Number.isFinite(benefit)) return "优惠详情暂不可用";
  const condition = threshold > 0 ? `满 ¥${threshold.toFixed(2)}` : "无起用门槛";
  return template.benefitType === "FIXED_REDUCTION"
    ? `${condition}，减 ¥${benefit.toFixed(2)}`
    : `${condition}，减免 ${benefit}%`;
}

function displayExpired(item) {
  const end = item.template && item.template.validTo ? Date.parse(item.template.validTo) : NaN;
  return ["CLAIMED", "ISSUED"].includes(item.status) && Number.isFinite(end) && end < Date.now();
}

function presentTemplate(template) {
  return Object.assign({}, template, {
    benefitText: templateText(template), typeText: TYPE_TEXT[template.type] || "优惠券",
    validToText: template.validTo ? formatServerDateTime(template.validTo) : "-",
  });
}

Page({
  data: { storefrontCode: "zhenshang", featureEnabled: true, checkoutMode: false, legacyCheckoutEntry: false, eligibilityLoading: false, activeTab: "AVAILABLE", mineStatus: "CLAIMED", mineStatusCounts: {}, available: [], mine: [], availableCount: 0, mineCount: 0, canClaim: false, loading: true, error: "", selectedCouponId: "", claimingTemplateId: "", claimingCouponId: "", claimError: "", claimErrorTemplateId: "", claimErrorCouponId: "" },
  onLoad(query) { this._disposed = false; this._visible = true; const entrance = resolveStorefrontEntrance(query || {}); const legacyCheckoutEntry = !!(query && query.mode === "checkout"); this.setData({ storefrontCode: entrance.storefrontCode, checkoutMode: false, legacyCheckoutEntry, activeTab: legacyCheckoutEntry || query && query.tab === "MINE" ? "MINE" : "AVAILABLE" }); },
  onShow() { this._visible = true; return this.refresh(); },
  invalidatePage() {
    this._visible = false;
    this._pageGeneration = (this._pageGeneration || 0) + 1;
    this._requestId = (this._requestId || 0) + 1;
    this._customerId = "";
    this._checkoutContext = null;
    // Unsent preparation can be abandoned. A sent request settles once before
    // re-entry reads; its durable key remains the retry owner if uncertain.
    if (this._claimContext && !this._claimContext.sent) { this._claimContext = null; this._claimPromise = null; }
  },
  onHide() {
    this.invalidatePage();
    this.setData({ loading: true, eligibilityLoading: false, canClaim: false, error: "", available: [], mine: [], availableCount: 0, mineCount: 0, selectedCouponId: "", claimingTemplateId: "", claimingCouponId: "", claimError: "", claimErrorTemplateId: "", claimErrorCouponId: "" });
  },
  onUnload() { this._disposed = true; this.invalidatePage(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  readSelected() { this.clearSelection(); },
  async refresh() {
    if (this._disposed || this._visible === false) return;
    if (this._claimContext && this._claimContext.generation === (this._pageGeneration || 0)) return this._claimPromise;
    const requestId = this._requestId = (this._requestId || 0) + 1;
    this._checkoutContext = null;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && this._visible !== false && this._requestId === requestId && this.data.storefrontCode === code;
    this.setData({ loading: true, eligibilityLoading: false, canClaim: false, error: "", available: [], mine: [], availableCount: 0, mineCount: 0, selectedCouponId: "", claimingTemplateId: "", claimingCouponId: "", claimError: "", claimErrorTemplateId: "", claimErrorCouponId: "" });
    try {
      if (this._claimContext) await this._claimPromise;
      if (!current()) return;
      const me = await getMallMe(code);
      if (!current()) return;
      this._customerId = customerIdFrom(me);
      if (!this._customerId) {
        this.clearSelection();
        throw { code: "NEED_LOGIN" };
      }
      const result = await getMallCoupons(code);
      if (!current()) return;
      const featureEnabled = result.featureEnabled !== false;
      const available = featureEnabled ? (result.available || []).map(presentTemplate) : [];
      const mine = (result.mine || []).map((item) => Object.assign({}, item, {
        benefitText: templateText(item.template), name: item.template ? item.template.name : "优惠券",
        displayExpired: displayExpired(item),
        walletGroup: displayExpired(item) || item.status === "EXPIRED" || item.status === "VOIDED" ? "INVALID" : item.status === "CLAIMED" || item.status === "USED" ? item.status : "OTHER",
        statusText: displayExpired(item) ? "已过期" : STATUS_TEXT[item.status] || "状态待确认",
        validToText: item.template && item.template.validTo ? formatServerDateTime(item.template.validTo) : "-",
      }));
      const mineStatusCounts = { CLAIMED: 0, USED: 0, INVALID: 0, OTHER: 0 };
      mine.forEach((item) => { mineStatusCounts[item.walletGroup] += 1; });
      this.setData({ featureEnabled, activeTab: featureEnabled ? this.data.activeTab : "MINE", mineStatusCounts, available, mine, availableCount: available.length, mineCount: mine.length, canClaim: featureEnabled && result.canClaim === true, loading: false });
      // Payment-stage selection is owned by the waiting-payment adapter; never quote the cart here.
      if (!current()) return;
      this.clearSelection();
    } catch (error) {
      if (current()) {
        this._customerId = "";
        this.setData({ loading: false, claimError: "", claimErrorTemplateId: "", error: getSafeMallErrorMessage(error, "优惠券读取失败，请重试") });
      }
    }
  },
  setTab(event) { if (!this._disposed && this._visible !== false) this.setData({ activeTab: !this.data.featureEnabled || event.currentTarget.dataset.tab === "MINE" ? "MINE" : "AVAILABLE" }); },
  setMineStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (!this._disposed && this._visible !== false && ["CLAIMED", "USED", "INVALID", "OTHER"].includes(status)) this.setData({ mineStatus: status });
  },
  claim(event) {
    const templateId = String(event.currentTarget.dataset.id || "");
    const couponId = String(event.currentTarget.dataset.couponId || "");
    const candidate = couponId
      ? this.data.mine.some((item) => item.id === couponId && item.status === "ISSUED" && !displayExpired(item) && item.template && item.template.id === templateId)
      : this.data.available.some((item) => item.id === templateId);
    if (this._disposed || this._visible === false || this.data.loading || this.data.error || !this.data.canClaim || !this._customerId || !candidate) return Promise.resolve();
    if (this._claimContext) return this._claimPromise;
    const customerId = this._customerId;
    const code = this.data.storefrontCode;
    const context = { generation: this._pageGeneration || 0, sent: false };
    this._claimContext = context;
    const current = () => !this._disposed && this._visible !== false && (this._pageGeneration || 0) === context.generation && this.data.storefrontCode === code && this._customerId === customerId;
    const release = () => { if (this._claimContext === context) { this._claimContext = null; this._claimPromise = null; } };
    this.setData({ claimingTemplateId: templateId, claimingCouponId: couponId, claimError: "", claimErrorTemplateId: "", claimErrorCouponId: "" });
    this._claimPromise = (async () => {
      try {
        const me = await getMallMe(code);
        if (!current()) return;
        if (customerIdFrom(me) !== customerId) {
          release();
          this.setData({ claimingTemplateId: "", claimingCouponId: "" });
          return this.refresh();
        }
        if (!me.member || !Array.isArray(me.member.effectiveMallCapabilities) || !me.member.effectiveMallCapabilities.includes("MALL_ORDER_CREATE")) throw { code: "CAPABILITY_DENIED" };
        const key = intentKey(code, customerId, couponId ? `issued:${couponId}` : templateId);
        let idempotencyKey;
        try {
          const stored = wx.getStorageSync(key);
          idempotencyKey = typeof stored === "string" && stored.length > 0 && stored.length <= 200 ? stored : createClientRequestId("coupon");
          // Persist before sending so a lost response can be replayed after re-entry.
          wx.setStorageSync(key, idempotencyKey);
        } catch { throw { code: "CLAIM_INTENT_STORAGE_FAILED" }; }
        context.sent = true;
        const result = couponId
          ? await claimIssuedMallCoupon(code, couponId, idempotencyKey)
          : await claimMallCoupon(code, templateId, idempotencyKey);
        if (!result || !result.coupon || !result.coupon.id || result.coupon.templateId !== templateId || (couponId && result.coupon.id !== couponId)) throw { code: "CLAIM_RESULT_UNCONFIRMED" };
        try { if (wx.getStorageSync(key) === idempotencyKey) wx.removeStorageSync(key); } catch { /* A retained key safely replays the confirmed claim. */ }
        if (!current()) return;
        release();
        this.setData({ claimingTemplateId: "", claimingCouponId: "", claimError: "", claimErrorTemplateId: "", claimErrorCouponId: "" });
        wx.showToast({ title: "领取成功", icon: "success" });
        return this.refresh();
      } catch (error) {
        const publicClaimError = claimErrorText(error);
        if (current() && error && error.code === "CAPABILITY_DENIED") this.setData({ canClaim: false });
        if (current()) this.setData({
          claimErrorTemplateId: templateId,
          claimErrorCouponId: couponId,
          claimError: error && error.code === "CAPABILITY_DENIED" ? "当前成员仅可查看优惠券，领取需要下单权限"
            : error && error.code === "CLAIM_INTENT_STORAGE_FAILED" ? "无法保存领取请求，请检查存储后重试"
            : publicClaimError || getSafeMallErrorMessage(error, "领取结果暂未确认，请重试领取"),
        });
      } finally {
        if (this._claimContext === context) {
          release();
          if (current()) this.setData({ claimingTemplateId: "", claimingCouponId: "" });
        }
      }
    })();
    return this._claimPromise;
  },
  retryClaim() { return this.claim({ currentTarget: { dataset: { id: this.data.claimErrorTemplateId, couponId: this.data.claimErrorCouponId } } }); },
  select() {
    if (!this._disposed && this._visible !== false) wx.showToast({ title: "请在待付款订单中选券", icon: "none" });
  },
  clearSelection() { if (this._disposed || this._visible === false) return; try { wx.removeStorageSync(selectedKey(this.data.storefrontCode)); } catch {} this.setData({ selectedCouponId: "" }); },
  goBack() {
    if (this._disposed || this._visible === false) return;
    const code = this.data.storefrontCode;
    const generation = this._pageGeneration || 0;
    wx.navigateBack({ delta: 1, fail: () => {
      if (!this._disposed && this._visible !== false && (this._pageGeneration || 0) === generation && this.data.storefrontCode === code) wx.reLaunch({ url: `/pages/me/me?storefrontCode=${encodeURIComponent(code)}` });
    } });
  },
});
