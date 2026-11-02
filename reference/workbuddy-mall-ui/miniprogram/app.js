const { resolveStorefrontEntrance, saveStorefrontCode } = require("./utils/storefront");
const { captureInviteEntrance, readInviteScene } = require("./utils/invite");
const acceptancePaymentOnce = require("./utils/acceptance-payment-once");

App({
  globalData: {
    storefrontCode: "zhenshang",
    sourceScene: "",
    customerMode: "GUEST",
    inviteScene: "",
  },

  onLaunch(options) {
    const entrance = resolveStorefrontEntrance((options && options.query) || {});
    this.globalData.storefrontCode = entrance.storefrontCode;
    this.globalData.sourceScene = entrance.sourceScene;
    this.globalData.inviteScene = captureInviteEntrance((options && options.query) || {}) || readInviteScene();
    saveStorefrontCode(entrance.storefrontCode);
    acceptancePaymentOnce.launchPreview();
  },

  onShow(options) {
    this.globalData.inviteScene = captureInviteEntrance((options && options.query) || {}) || readInviteScene();
  },
});
