const { resolveStorefrontEntrance } = require("../../utils/storefront");

Page({
  data: {
    storefrontCode: "zhenshang",
    points: "-",
    records: [],
    exchanges: [],
  },

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({ storefrontCode: entrance.storefrontCode });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },

  exchange() {
    wx.showToast({ title: "积分功能暂未开放", icon: "none" });
  },
});
