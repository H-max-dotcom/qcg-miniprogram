const KEY = "qcg.mall.campaign-return.v1";
Component({
  properties: { customerStatus: String, storefrontCode: String },
  observers: {
    "customerStatus, storefrontCode": function (status, storefront) {
      if (status !== "APPROVED_BOUND_CUSTOMER" || !storefront || this._navigating) return;
      let pending;
      try { pending = wx.getStorageSync(KEY); } catch { return; }
      if (!pending || typeof pending !== "object") return;
      if (!Number.isFinite(pending.savedAt) || Date.now() - pending.savedAt > 30 * 60 * 1000 || pending.savedAt > Date.now()) {
        try { wx.removeStorageSync(KEY); } catch {}
        return;
      }
      if (pending.storefrontCode !== storefront) return;
      const token = typeof pending.shareToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(pending.shareToken) ? pending.shareToken : "";
      const code = typeof pending.code === "string" && pending.code.length <= 80 ? pending.code.trim() : "";
      const campaignId = typeof pending.campaignId === "string" && pending.campaignId.length <= 160 ? pending.campaignId.trim() : "";
      if (!token && !code && !campaignId) { try { wx.removeStorageSync(KEY); } catch {} return; }
      // A fixed native path, never an arbitrary URL. This only restores navigation;
      // the destination's existing service rechecks membership, audience and price.
      const idQuery = campaignId ? `campaignId=${encodeURIComponent(campaignId)}&` : "";
      const url = token ? `/pages/campaigns/detail?${idQuery}shareToken=${encodeURIComponent(token)}`
        : `/pages/campaigns/detail?${idQuery}code=${encodeURIComponent(code)}&storefrontCode=${encodeURIComponent(storefront)}`;
      this._navigating = true;
      try { wx.removeStorageSync(KEY); } catch { this._navigating = false; return; }
      wx.redirectTo({ url, fail: () => { this._navigating = false; try { wx.setStorageSync(KEY, pending); } catch {} } });
    },
  },
});
