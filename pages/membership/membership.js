const { request } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");
Page({
  data: { storefrontCode: "zhenshang", loading: true, enabled: false, membership: null, error: "" },
  onLoad(query) { const entrance = resolveStorefrontEntrance(query || {}); this.setData({ storefrontCode: entrance.storefrontCode }); },
  onShow() { this._active = true; return this.refresh(); },
  onHide() { this._active = false; this._requestId = (this._requestId || 0) + 1; this.setData({ membership: null, enabled: false }); },
  onUnload() { this._active = false; this._requestId = (this._requestId || 0) + 1; },
  async refresh() {
    const id = this._requestId = (this._requestId || 0) + 1;
    this.setData({ loading: true, membership: null, enabled: false, error: "" });
    try {
      const result = await request({ path: "/api/mall/membership", storefrontCode: this.data.storefrontCode });
      if (!this._active || id !== this._requestId) return;
      const membership = result.enabled === true && result.membership ? {
        ...result.membership,
        benefits: Array.isArray(result.membership.benefits) ? result.membership.benefits : [],
      } : null;
      this.setData({ enabled: result.enabled === true, membership });
    } catch { if (this._active && id === this._requestId) this.setData({ error: "会员信息暂时无法读取，请重试" }); }
    finally { if (this._active && id === this._requestId) this.setData({ loading: false }); }
  },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: "/pages/me/me" }) }); },
});
