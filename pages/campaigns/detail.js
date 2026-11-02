const {
  createMallShare,
  getMallShare,
  recordMallShareEvent,
  getMallCampaignDetail,
  getMallCampaignDirectEntry,
  getMallCampaignShare,
  recordMallCampaignShareEvent,
  createClientRequestId,
  getSafeMallErrorMessage,
  resolveMallAssetUrl,
} = require("../../utils/request");
const { addCartItem, getCartCount } = require("../../utils/cart");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

function productImageCandidates(item) {
  return [item.imageUrl, item.categoryImageUrl, item.brandImageUrl]
    .map(value => resolveMallAssetUrl(value))
    .filter((value, index, values) => value && !/product-placeholder\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(value) && values.indexOf(value) === index);
}

Page({
  data: {
    storefrontCode: "zhenshang",
    campaignCode: "",
    campaignId: "",
    shareToken: "",
    viewState: "LOADING",
    loading: false,
    errorMessage: "",
    campaign: null,
    heroFailed: false,
    cartCount: 0,
    needsLogin: false,
    invalidContent: false,
    sharePanelOpen: false,
    canShare: false,
    sharing: false,
    shareReady: false,
    shareError: "",
  },

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    this.updateShareMenu();
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({
      storefrontCode: entrance.storefrontCode,
      campaignCode: String((query && query.code) || ""),
      campaignId: String((query && query.campaignId) || ""),
      shareToken: String((query && query.shareToken) || ""),
    });
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    this._inactive = false;
    this.setData({ cartCount: getCartCount(this.data.storefrontCode) });
    return this.loadCampaign();
  },

  onHide() {
    this._inactive = true;
    this.clearSharePreparation();
    this.updateShareMenu();
    this._requestId = (this._requestId || 0) + 1;
    this.setData({ campaign: null, loading: false, viewState: "LOADING", errorMessage: "" });
  },

  onUnload() {
    this._disposed = true;
    this._inactive = true;
    this.clearSharePreparation();
    this.updateShareMenu();
    this._requestId = (this._requestId || 0) + 1;
  },

  onPullDownRefresh() {
    return this.loadCampaign();
  },

  loadCampaign() {
    if (this._disposed || this._inactive) return Promise.resolve();
    this.clearSharePreparation();
    const requestId = this._requestId = (this._requestId || 0) + 1;
    const code = this.data.campaignCode;
    const campaignId = this.data.campaignId;
    const token = this.data.shareToken;
    const storefrontCode = this.data.storefrontCode;
    if (!token && !code && campaignId) this._publicDirectEntry = true;
    const current = () => !this._disposed && !this._inactive && this._requestId === requestId
      && this.data.shareToken === token && this.data.storefrontCode === storefrontCode && (token || this.data.campaignCode === code);
    if (!code && !token && !campaignId) {
      this.setData({ campaign: null, loading: false, viewState: "ERROR", invalidContent: true, errorMessage: "活动入口不完整，请从活动中心重新进入" });
      if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      return Promise.resolve();
    }
    this.setData({ canShare: false, sharePanelOpen: false, viewState: "LOADING" });
    this.updateShareMenu();
    this.setData({
      loading: true,
      needsLogin: false,
      invalidContent: false,
      campaign: null,
      viewState: "LOADING",
      errorMessage: "",
    });
    // The share GET owns a customer-scoped default OPEN key. Revalidation must
    // not mint a second attribution event for the same customer/share.
    const loader = token
      ? getMallShare(storefrontCode, token).then(result => { if (result.sourceType !== "CAMPAIGN") throw new Error("分享类型无效"); return Object.assign({}, result, { legacyShare: false }); }).catch(error => { if (!["SHARE_NOT_FOUND", "INVALID_SHARE_TOKEN", "SHARE_TOKEN_INVALID"].includes(error && error.code) && Number(error && error.statusCode) !== 404) throw error; return getMallCampaignShare(token).then(result => { return Object.assign({}, result, { legacyShare: true }); }); })
      : this._publicDirectEntry ? getMallCampaignDirectEntry(storefrontCode, campaignId) : getMallCampaignDetail(storefrontCode, code);
    return loader
      .then((result) => {
        if (!current()) return;
        this._legacyShare = !!(result && result.legacyShare);
        const campaign = result && result.campaign;
        if (!campaign || (!token && (code ? campaign.code !== code : campaign.campaignId !== campaignId))) {
          this.setData({ viewState: "ERROR", errorMessage: "活动数据暂不可用", campaign: null });
          return;
        }
        const products = Array.isArray(campaign.products)
          ? campaign.products.map((item, index, items) => {
              const imageCandidates = productImageCandidates(item);
              return Object.assign({}, item, {
                imageCandidates,
                imageCandidateIndex: 0,
                imageUrl: imageCandidates[0] || "",
                isWideCard: items.length % 2 === 1 && index === items.length - 1,
              });
            })
          : [];
        this.setData({
          campaign: Object.assign({}, campaign, { products, eligibilityText: campaign.eligibilityStatus === "ELIGIBLE" ? "您可参与本活动" : campaign.eligibilityText, customerRules: (campaign.rules || []).map(rule => String(rule).replace("优惠以服务端实时报价为准", "最终价格以下单结算页为准")), detailHeroUrl: resolveMallAssetUrl(campaign.detailHeroUrl || campaign.homeBannerUrl || campaign.homePosterUrl || campaign.posterImageUrl || campaign.shareCoverUrl), shareCoverUrl: resolveMallAssetUrl(campaign.shareCoverUrl) }),
          heroFailed: false,
          campaignId: (result.share && result.share.campaignId) || campaign.campaignId || this.data.campaignId,
          campaignCode: campaign.code || this.data.campaignCode,
          viewState: "READY",
          errorMessage: "",
        });
        this.updateShareMenu();
        if (this.data.shareToken && this._legacyShare) {
          try { wx.setStorageSync(`qcg.mall.campaign-share.v1:${this.data.storefrontCode}`, this.data.shareToken); } catch {}
        }
      })
      .catch((error) => {
        if (!current()) return;
        this.setData({
          invalidContent: Boolean(error && ["SHARE_INVALID", "CAMPAIGN_NOT_FOUND", "CAMPAIGN_PAUSED", "MALL_SHARE_EXPIRED", "MALL_SHARE_ACCESS_DENIED", "SHARE_NOT_FOUND"].indexOf(error.code) >= 0),
          needsLogin: Boolean(error && ["NEED_LOGIN", "NEED_BIND_CUSTOMER", "SESSION_EXPIRED", "SESSION_INVALID", "UNAUTHORIZED"].indexOf(error.code) >= 0),
          campaign: null,
          viewState: error && error.code === "CAMPAIGN_ENDED" ? "ENDED" : error && error.code === "CAMPAIGN_UPCOMING" ? "UPCOMING" : "ERROR",
          errorMessage: getSafeMallErrorMessage(error, "活动详情加载失败，请检查网络后重试。"),
        });
      })
      .finally(() => {
        if (!current()) return;
        this.setData({ loading: false });
        if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      });
  },

  heroImageError() { this.setData({ heroFailed: true }); },

  productImageError(event) {
    const unitId = String(event.currentTarget.dataset.unitId || "");
    if (!this.data.campaign) return;
    this.setData({ campaign: Object.assign({}, this.data.campaign, { products: this.data.campaign.products.map(item => item.productUnitId === unitId ? Object.assign({}, item, {
      imageCandidateIndex: (item.imageCandidateIndex || 0) + 1,
      imageUrl: (item.imageCandidates || [])[(item.imageCandidateIndex || 0) + 1] || "",
      imageFailed: !(item.imageCandidates || [])[(item.imageCandidateIndex || 0) + 1],
    }) : item) }) });
  },

  retry() {
    return this.loadCampaign();
  },

  addProduct(event) {
    if (this._disposed || this._inactive || this.data.loading || this.data.viewState !== "READY") return;
    const productUnitId = String(event.currentTarget.dataset.unitId || "");
    const product = this.data.campaign && this.data.campaign.products.find(
      (item) => item.productUnitId === productUnitId,
    );
    if (!product || this.data.campaign.state !== "ACTIVE" || !product.canAddToCart || product.pricingStatus !== "AVAILABLE") {
      wx.showToast({ title: "当前商品价格暂不可用", icon: "none" });
      return;
    }
    const added = addCartItem({
      id: product.productId,
      productUnitId: product.productUnitId,
      name: product.name,
      spec: product.spec,
      unitName: product.unitName,
      minOrderQty: product.minOrderQty,
      allowDecimalQuantity: product.allowDecimalQuantity,
      quantityScale: product.quantityScale,
      displayPrice: product.finalUnitPriceText,
      priceValue: product.finalUnitPrice,
      priceVisible: true,
      canOrder: true,
      canAddToCart: true,
      lineRemark: `活动：${this.data.campaign.name}`,
      shareToken: this._legacyShare ? "" : this.data.shareToken,
    }, product.orderQuantity, this.data.storefrontCode);
    if (!added) {
      wx.showToast({ title: "加入购物车失败，请稍后重试", icon: "none" });
      return;
    }
    this.setData({ cartCount: getCartCount(this.data.storefrontCode) });
    if (this.data.shareToken) this.recordShareEvent({ event: "ADD_CART", clientEventId: createClientRequestId("campaign-cart"), productId: product.productId, productUnitId: product.productUnitId }).catch(() => {});
    wx.showToast({ title: "已加入购物车", icon: "success" });
  },

  goCart() {
    wx.navigateTo({ url: `/pages/cart/cart?storefrontCode=${this.data.storefrontCode}` });
  },

  shopCampaign() {
    if (this.data.viewState !== "READY") return;
    wx.pageScrollTo({ selector: "#campaign-products", duration: 250 });
  },

  continueAfterLogin() {
    if (this._disposed || this._inactive || !this.data.needsLogin) return;
    try {
      wx.setStorageSync("qcg.mall.campaign-return.v1", { campaignId: this.data.campaignId, code: this.data.campaignCode, shareToken: this.data.shareToken, storefrontCode: this.data.storefrontCode, savedAt: Date.now() });
    } catch { wx.showToast({ title: "无法保存活动入口，请稍后重试", icon: "none" }); return; }
    wx.navigateTo({ url: `/pages/me/me?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}&openAuth=1` });
  },

  viewProduct(event) {
    if (this._disposed || this._inactive || this.data.viewState !== "READY") return;
    const productId = String(event.currentTarget.dataset.productId || "");
    const product = this.data.campaign && this.data.campaign.products.find((item) => item.productId === productId);
    if (!product) return;
    wx.navigateTo({ url: `/pages/product/detail?id=${encodeURIComponent(productId)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
    if (this.data.shareToken) this.recordShareEvent({ event: "PRODUCT_VIEW", clientEventId: createClientRequestId("campaign-view"), productId: product.productId, productUnitId: product.productUnitId }).catch(() => {});
  },

  goHome() {
    wx.reLaunch({ url: `/pages/index/index?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  goActivities() {
    wx.redirectTo({ url: `/pages/campaigns/list?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: `/pages/campaigns/list?storefrontCode=${this.data.storefrontCode}` }),
    });
  },

  isCampaignShareReady() {
    const campaign = this.data.campaign;
    return !this._disposed && !this._inactive && this.data.viewState === "READY"
      && !!campaign && campaign.directShareEnabled === true
      && (!campaign.eligibilityStatus || campaign.eligibilityStatus === "ELIGIBLE")
      && (!campaign.state || ["ACTIVE", "UPCOMING"].indexOf(campaign.state) >= 0)
      && !!(campaign.campaignId || this.data.campaignId);
  },

  updateShareMenu() {
    const canShare = this.isCampaignShareReady();
    this.setData({ canShare, ...(canShare ? {} : { sharePanelOpen: false }) });
    const method = canShare && this.hasPreparedShare() ? "showShareMenu" : "hideShareMenu";
    if (typeof wx[method] === "function") wx[method]({ menus: ["shareAppMessage", "shareTimeline"] });
  },


  clearSharePreparation() {
    this._shareRequestId = (this._shareRequestId || 0) + 1;
    this._preparedShares = null;
    this.setData({ shareReady: false, sharing: false, sharePanelOpen: false, shareError: "" });
    if (typeof wx.hideShareMenu === "function") wx.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },
  openSharePanel() {
    if (!this.isCampaignShareReady() || this.data.sharing) return Promise.resolve();
    this.setData({ sharePanelOpen: true, sharing: true, shareReady: false, shareError: "" });
    const requestId = this._shareRequestId = (this._shareRequestId || 0) + 1;
    const payload = { sourceType: "CAMPAIGN", campaignId: this.data.campaign.campaignId || this.data.campaignId, ...(this.data.shareToken && !this._legacyShare ? { parentToken: this.data.shareToken } : {}) };
    return Promise.all(["MINI_PROGRAM_CARD", "WECHAT"].map(channel => createMallShare(this.data.storefrontCode, Object.assign({}, payload, { channel }))))
      .then(results => {
        if (this._shareRequestId !== requestId || !this.isCampaignShareReady()) return;
        const friend = results[0] && results[0].share;
        const timeline = results[1] && results[1].share;
        if (!friend || !friend.friend || !timeline || !timeline.timeline || !friend.token || !timeline.token) throw new Error("分享数据暂不可用");
        this._preparedShares = { friend, timeline };
        this.setData({ shareReady: true, sharing: false });
        if (typeof wx.showShareMenu === "function") wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
      }).catch(() => {
        if (this._shareRequestId !== requestId || !this.isCampaignShareReady()) return;
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
    return !!(this.isCampaignShareReady() && this.data.shareReady && shares && Date.parse(shares.friend.expiresAt) > Date.now() && Date.parse(shares.timeline.expiresAt) > Date.now());
  },
  onShareAppMessage() {
    if (!this.hasPreparedShare()) return { title: "全渠供商城", path: `/pages/index/index?storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` };
    return this._preparedShares.friend.friend;
  },
  onShareTimeline() {
    if (!this.hasPreparedShare()) return { title: "全渠供商城", query: "", imageUrl: "" };
    return this._preparedShares.timeline.timeline;
  },
  recordShareEvent(payload) {
    return this._legacyShare ? recordMallCampaignShareEvent(this.data.shareToken, payload) : recordMallShareEvent(this.data.storefrontCode, this.data.shareToken, payload);
  },
});
