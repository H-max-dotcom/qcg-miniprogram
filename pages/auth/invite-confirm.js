const {
  confirmMallInvitationByScene,
  getMallInvitationByScene,
  getMallMe,
  getSafeMallErrorMessage,
  isMallSessionExpiredError,
  prepareWechatLoginWithPrivacy,
} = require("../../utils/request");
const {
  captureInviteEntrance,
  clearInviteScene,
  normalizeInviteScene,
  readInviteScene,
} = require("../../utils/invite");

const TERMINAL_ERROR_STATES = {
  INVITE_EXPIRED: "EXPIRED",
  INVITE_REVOKED: "REVOKED",
  INVITE_USED: "USED",
  INVITE_REJECTED: "USED",
  INVITE_BOUND_OTHER_CUSTOMER: "BOUND_OTHER_CUSTOMER",
  IDENTITY_CONFLICT: "BOUND_OTHER_CUSTOMER",
  INVITE_UNAVAILABLE: "CUSTOMER_INACTIVE",
  INVITE_NOT_FOUND: "UNAUTHORIZED",
  INVITE_SCENE_INVALID: "UNAUTHORIZED",
};

const STATE_VIEW = {
  VALID: {
    title: "确认这是您的门店",
    desc: "请核对门店信息，确认后即可继续采购。",
  },
  PENDING: {
    title: "请再次确认门店",
    desc: "请核对门店信息，确认后即可继续采购。",
  },
  BOUND_SAME_CUSTOMER: {
    title: "门店已经绑定",
    desc: "当前微信身份已经绑定该门店，可返回商城继续采购。",
  },
  BOUND_OTHER_CUSTOMER: {
    title: "当前微信已绑定其他门店",
    desc: "如需更换门店，请联系业务员处理。",
  },
  EXPIRED: {
    title: "邀请已过期",
    desc: "请联系业务员重新获取商城码。",
  },
  REVOKED: {
    title: "邀请已撤销",
    desc: "当前商城码已失效，请联系业务员获取新的商城码。",
  },
  USED: {
    title: "邀请已使用",
    desc: "该邀请不能再次提交，请联系业务员核对当前状态。",
  },
  CUSTOMER_INACTIVE: {
    title: "门店当前不可绑定",
    desc: "当前门店暂不可使用，请联系业务员处理。",
  },
  UNAUTHORIZED: {
    title: "商城码无效",
    desc: "请重新扫描业务员提供的商城码。",
  },
  RETRYABLE_ERROR: {
    title: "页面暂时无法打开",
    desc: "请检查网络后重试。",
  },
};

function terminalState(state) {
  return [
    "BOUND_SAME_CUSTOMER",
    "BOUND_OTHER_CUSTOMER",
    "EXPIRED",
    "REVOKED",
    "USED",
    "CUSTOMER_INACTIVE",
    "UNAUTHORIZED",
  ].indexOf(state) >= 0;
}

Page({
  data: {
    storefrontCode: "zhenshang",
    inviteScene: "",
    loading: true,
    submitting: false,
    loginSubmitting: false,
    state: "VALID",
    title: "正在读取商城码",
    desc: "请稍候…",
    invite: null,
    loggedIn: false,
    errorMessage: "",
  },

  onLoad(query) {
    const input = query || {};
    const inviteScene = captureInviteEntrance(input)
      || normalizeInviteScene(input.inviteScene)
      || readInviteScene();
    const storefrontCode = input.storefrontCode || getApp().globalData.storefrontCode || "zhenshang";
    this.setData({ inviteScene, storefrontCode });
    this.loadInvite();
  },

  onShow() {
    if (this._loadedOnce && !this.data.submitting && !this.data.loginSubmitting) {
      this.loadInvite({ silent: true });
    }
  },

  onPullDownRefresh() {
    this.loadInvite({ fromPull: true });
  },

  applyState(state, invite, errorMessage) {
    const view = STATE_VIEW[state] || STATE_VIEW.UNAUTHORIZED;
    if (terminalState(state)) clearInviteScene();
    this.setData({
      state,
      title: view.title,
      desc: view.desc,
      invite: invite || this.data.invite,
      errorMessage: errorMessage || "",
    });
  },

  loadInvite(options) {
    const opts = options || {};
    const scene = this.data.inviteScene || readInviteScene();
    if (!scene) {
      this.applyState("UNAUTHORIZED", null, "没有可用的商城码");
      this.setData({ loading: false });
      if (opts.fromPull) wx.stopPullDownRefresh();
      return;
    }
    if (!opts.silent) this.setData({ loading: true, errorMessage: "" });
    getMallInvitationByScene(this.data.storefrontCode, scene)
      .then((result) => {
        const state = result.state
          || (result.code === "INVITE_PENDING" ? "PENDING" : "VALID");
        this.applyState(state, result.invite || null, "");
        if (state !== "VALID" && state !== "PENDING") return null;
        return getMallMe(this.data.storefrontCode, "INVITE_CONFIRM")
          .then((profile) => {
            this.setData({ loggedIn: profile.customerStatus !== "GUEST" });
          })
          .catch((error) => {
            if (isMallSessionExpiredError(error)) {
              this.setData({ loggedIn: false });
              return;
            }
            throw error;
          });
      })
      .catch((error) => {
        const state = TERMINAL_ERROR_STATES[String(error.code || "")] || "";
        if (state) {
          this.applyState(state, null, error.message || "");
          return;
        }
        if (isMallSessionExpiredError(error)) {
          this.setData({ loggedIn: false });
          return;
        }
        this.applyState(
          "RETRYABLE_ERROR",
          null,
          getSafeMallErrorMessage(error, "邀请读取失败，请检查网络后重试"),
        );
      })
      .finally(() => {
        this._loadedOnce = true;
        this.setData({ loading: false });
        if (opts.fromPull) wx.stopPullDownRefresh();
      });
  },

  login() {
    if (this.data.loginSubmitting) return;
    this.setData({ loginSubmitting: true, errorMessage: "" });
    prepareWechatLoginWithPrivacy(this.data.storefrontCode, this.data.inviteScene)
      .then(() => {
        this.setData({ loggedIn: true });
        return this.loadInvite({ silent: true });
      })
      .catch((error) => {
        this.setData({
          errorMessage: getSafeMallErrorMessage(error, "微信登录失败，请稍后重试"),
        });
      })
      .finally(() => this.setData({ loginSubmitting: false }));
  },

  retry() {
    this.loadInvite();
  },

  confirm() {
    if (this.data.submitting || ["VALID", "PENDING"].indexOf(this.data.state) < 0) return;
    if (!this.data.loggedIn) {
      this.login();
      return;
    }
    this.setData({ submitting: true, errorMessage: "" });
    confirmMallInvitationByScene(this.data.storefrontCode, this.data.inviteScene)
      .then((result) => {
        if (result.status !== "BOUND") {
          throw Object.assign(new Error("门店绑定未完成，请刷新后重试"), { code: "DIRECT_BIND_NOT_COMPLETED" });
        }
        clearInviteScene();
        this.applyState("BOUND_SAME_CUSTOMER", this.data.invite, "");
        wx.showToast({
          title: "门店已绑定",
          icon: "success",
        });
      })
      .catch((error) => {
        if (isMallSessionExpiredError(error)) {
          this.setData({ loggedIn: false, errorMessage: "登录状态已失效，请重新登录后继续原邀请" });
          return;
        }
        const state = TERMINAL_ERROR_STATES[String(error.code || "")] || "";
        if (state) {
          this.applyState(state, null, error.message || "");
          return;
        }
        this.setData({
          errorMessage: getSafeMallErrorMessage(error, "绑定申请提交失败，请稍后重试"),
        });
      })
      .finally(() => this.setData({ submitting: false }));
  },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  onShareAppMessage() {
    return {
      title: "全渠供门店绑定",
      path: `/pages/auth/invite-confirm?inviteScene=${encodeURIComponent(this.data.inviteScene)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}`,
    };
  },
});
