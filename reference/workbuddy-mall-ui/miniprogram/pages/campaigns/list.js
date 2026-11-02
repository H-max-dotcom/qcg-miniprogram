const { getMallCampaigns, getSafeMallErrorMessage, resolveMallAssetUrl } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

Page({
  data: {
    storefrontCode: "zhenshang",
    viewState: "LOADING",
    loading: false,
    errorMessage: "",
    campaigns: [],
  },

  onLoad(query) {
    this._disposed = false;
    this._inactive = false;
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({ storefrontCode: entrance.storefrontCode });
  },

  onShow() {
    if (this._disposed) return Promise.resolve();
    this._inactive = false;
    return this.loadCampaigns();
  },

  onHide() {
    this._inactive = true;
    this._requestId = (this._requestId || 0) + 1;
    this.setData({ campaigns: [], loading: false, viewState: "LOADING", errorMessage: "" });
  },

  onUnload() {
    this._disposed = true;
    this._inactive = true;
    this._requestId = (this._requestId || 0) + 1;
  },

  onPullDownRefresh() {
    return this.loadCampaigns();
  },

  loadCampaigns() {
    if (this._disposed || this._inactive) return Promise.resolve();
    const requestId = this._requestId = (this._requestId || 0) + 1;
    const code = this.data.storefrontCode;
    const current = () => !this._disposed && !this._inactive && this._requestId === requestId && this.data.storefrontCode === code;
    this.setData({
      loading: true,
      campaigns: [],
      viewState: "LOADING",
      errorMessage: "",
    });
    return getMallCampaigns(code)
      .then((result) => {
        if (!current()) return;
        const campaigns = result && result.campaigns;
        const items = campaigns && Array.isArray(campaigns.items) ? campaigns.items : [];
        this.setData({
          campaigns: items.map((item) => Object.assign({}, item, { heroImageUrl: resolveMallAssetUrl(item.heroImageUrl) })),
          viewState: items.length ? "READY" : "EMPTY",
          errorMessage: "",
        });
      })
      .catch((error) => {
        if (!current()) return;
        this.setData({
          campaigns: [],
          viewState: "ERROR",
          errorMessage: getSafeMallErrorMessage(error, "活动加载失败，请检查网络后重试。"),
        });
      })
      .finally(() => {
        if (!current()) return;
        this.setData({ loading: false });
        if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      });
  },

  retry() {
    return this.loadCampaigns();
  },

  heroImageError(event) {
    if (this._disposed || this._inactive || this.data.viewState !== 'READY') return;
    const { code, src } = event.currentTarget.dataset;
    this.setData({ campaigns: this.data.campaigns.map(item =>
      item.code === code && item.heroImageUrl === src ? Object.assign({}, item, { heroFailed: true }) : item) });
  },

  openCampaign(event) {
    if (this._disposed || this._inactive || this.data.loading || this.data.viewState !== "READY") return;
    const code = String(event.currentTarget.dataset.code || "");
    if (!code || !this.data.campaigns.some((item) => item.code === code)) return;
    wx.navigateTo({
      url: `/pages/campaigns/detail?code=${encodeURIComponent(code)}&storefrontCode=${this.data.storefrontCode}`,
    });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` }),
    });
  },
});
