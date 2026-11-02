const subscriptions = require("../../utils/subscriptions");
const {
  getMallMe,
  getSafeMallErrorMessage,
  isMallSessionExpiredError,
  prepareWechatLoginWithPrivacy,
  registerMallProfile,
} = require("../../utils/request");
const {
  captureInviteEntrance,
  inviteConfirmUrl,
  readInviteScene,
} = require("../../utils/invite");
const {
  validateNewCustomerProfile,
} = require("../../utils/customer-profile");

function resolveStatusView(status, binding) {
  const rejectionReason = (binding && (binding.statusReason || binding.rejectionReason)) || "";
  const map = {
    GUEST: {
      title: "请先登录",
      desc: "登录后可完善门店资料并查看商品价格。",
      canSubmitProfile: false,
      showLogin: true,
      showHome: false,
    },
    LOGGED_IN_PROFILE_REQUIRED: {
      title: "完善门店资料",
      desc: "请填写店名、联系人和收货地址。",
      canSubmitProfile: true,
      showLogin: false,
      showHome: false,
    },
    REGISTERED_PENDING: {
      title: "资料确认中",
      desc: "工作人员正在处理，请耐心等待。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
    BINDING_PENDING_REVIEW: {
      title: "资料确认中",
      desc: "工作人员正在处理，请耐心等待。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
    APPROVED_BOUND_CUSTOMER: {
      title: "资料确认完成",
      desc: "可以返回商城查看价格并下单。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
    REJECTED: {
      title: "需补充资料",
      desc: rejectionReason || "请按提示补充资料后重新提交。",
      canSubmitProfile: true,
      showLogin: false,
      showHome: false,
    },
    BINDING_NOT_ACTIVE: {
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
    DISABLED: {
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
    CUSTOMER_NOT_ACTIVE: {
      title: "当前账号暂不可下单，请联系业务员或客服。",
      desc: "如需恢复下单能力，请联系业务员或客服。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    },
  };
  if (status === "DISABLED" && binding && binding.accountStatus === "REBIND_REQUIRED") {
    return {
      title: "账号已解绑，需重新扫码",
      desc: rejectionReason || "请联系业务员获取新的商城码并重新绑定门店。",
      canSubmitProfile: false,
      showLogin: false,
      showHome: true,
    };
  }
  if (status === "DISABLED") {
    return Object.assign({}, map.DISABLED, {
      desc: rejectionReason || map.DISABLED.desc,
    });
  }
  if (status === "UNBOUND") return map.LOGGED_IN_PROFILE_REQUIRED;
  return map[status] || map.GUEST;
}

function normalizeDialPhone(value) {
  const phone = String(value || "").trim();
  if (!/^[0-9+][0-9 -]{5,19}$/.test(phone)) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 20 ? phone : "";
}

Page({
  data: {
    storefrontCode: "",
    customerStatus: "GUEST",
    title: "请先登录",
    desc: "登录后可完善门店资料并查看商品价格。",
    rejectionReason: "",
    canSubmitProfile: false,
    showLogin: true,
    showHome: false,
    shopName: "",
    ownerName: "",
    ownerPhone: "",
    ownerContacting: false,
    showOwnerFallback: false,
    form: {
      shopName: "",
      contactName: "",
      phone: "",
      address: "",
      sourceScene: "",
    },
    formReady: false,
    formValidationMessage: "请填写完整资料和门店 / 收货地址",
    submitting: false,
    loginSubmitting: false,
  },

  onLoad(query) {
    const storefrontCode = query.storefrontCode || getApp().globalData.storefrontCode || "zhenshang";
    const inviteScene = captureInviteEntrance(query || {}) || readInviteScene();
    this.setData({ storefrontCode });
    if (inviteScene) {
      wx.redirectTo({ url: inviteConfirmUrl(storefrontCode, inviteScene) });
      return;
    }
    this.loadStatus();
  },

  applyView(status, binding, result) {
    const view = resolveStatusView(status, binding || {});
    const owner = (binding && binding.ownerSalesperson)
      || (result && result.ownerSalesperson)
      || null;
    const ownerName = owner && owner.name ? String(owner.name).trim() : "";
    const ownerPhone = ownerName && owner && owner.active === true
      ? normalizeDialPhone(owner.phone)
      : "";
    const nextForm = binding ? Object.assign({}, this.data.form, {
      shopName: binding.shopName || this.data.form.shopName,
      contactName: binding.contactName || this.data.form.contactName,
      phone: binding.phone || this.data.form.phone,
      address: binding.address || this.data.form.address,
    }) : this.data.form;
    const validation = validateNewCustomerProfile(nextForm);
    this.setData({
      customerStatus: status || "GUEST",
      title: view.title,
      desc: view.desc,
      rejectionReason: (binding && (binding.statusReason || binding.rejectionReason)) || "",
      canSubmitProfile: view.canSubmitProfile,
      showLogin: view.showLogin,
      showHome: view.showHome,
      shopName: (binding && binding.shopName) || "",
      ownerName,
      ownerPhone,
      showOwnerFallback: status !== "GUEST" && !ownerPhone,
      form: nextForm,
      formReady: validation.ok,
      formValidationMessage: validation.message,
    });
    return view;
  },

  loadStatus() {
    const inviteScene = readInviteScene();
    if (inviteScene) {
      wx.redirectTo({ url: inviteConfirmUrl(this.data.storefrontCode, inviteScene) });
      return;
    }
    getMallMe(this.data.storefrontCode, "AUTH_STATUS")
      .then((result) => {
        const status = result.customerStatus || "GUEST";
        const view = this.applyView(status, result.binding || null, result);
        if (status === "APPROVED_BOUND_CUSTOMER") subscriptions.prepare(this);
        if (status === "GUEST") {
          // 未登录不停留展示完整内部说明，回到我的页走底部授权层。
          wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}&openAuth=1` });
          return;
        }
        return view;
      })
      .catch((error) => {
        if (isMallSessionExpiredError(error)) {
          wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}&openAuth=1` });
          return;
        }
        wx.showToast({ title: getSafeMallErrorMessage(error, "账号状态读取失败，请稍后重试"), icon: "none" });
      });
  },

  prepareLogin() {
    if (this.data.loginSubmitting) return;
    this.setData({ loginSubmitting: true });
    prepareWechatLoginWithPrivacy(this.data.storefrontCode, readInviteScene())
      .then(() => this.loadStatus())
      .catch((error) => wx.showToast({ title: getSafeMallErrorMessage(error, "微信登录失败，请稍后重试"), icon: "none" }))
      .finally(() => this.setData({ loginSubmitting: false }));
  },

  inputProfile(event) {
    const key = event.currentTarget.dataset.key;
    const form = Object.assign({}, this.data.form, { [key]: event.detail.value });
    const validation = validateNewCustomerProfile(form);
    this.setData({
      form,
      formReady: validation.ok,
      formValidationMessage: validation.message,
    });
  },

  submitProfile() {
    const validation = validateNewCustomerProfile(this.data.form);
    if (!validation.ok) {
      wx.showToast({ title: validation.message, icon: "none" });
      return;
    }
    const form = validation.profile;
    this.setData({ submitting: true });
    registerMallProfile(this.data.storefrontCode, {
      shopName: form.shopName,
      contactName: form.contactName,
      phone: form.phone,
      address: form.address,
      sourceScene: form.sourceScene || "WECHAT_MINIPROGRAM_PROFILE",
    }, readInviteScene())
      .then(() => {
        wx.showToast({ title: "资料已提交，正在确认", icon: "success" });
        this.loadStatus();
      })
      .catch((error) => wx.showToast({ title: getSafeMallErrorMessage(error, "资料提交失败，请稍后重试"), icon: "none" }))
      .finally(() => this.setData({ submitting: false }));
  },

  contactOwner() {
    if (this.data.ownerContacting) return;
    const phone = normalizeDialPhone(this.data.ownerPhone);
    if (!phone) {
      wx.showToast({ title: "请联系公司客服或等待业务员处理", icon: "none" });
      return;
    }

    this.setData({ ownerContacting: true });
    try {
      wx.makePhoneCall({
        phoneNumber: phone,
        fail: () => {
          wx.showToast({ title: "拨号未完成，请稍后重试或联系公司客服", icon: "none" });
        },
        complete: () => {
          this.setData({ ownerContacting: false });
        },
      });
    } catch {
      this.setData({ ownerContacting: false });
      wx.showToast({ title: "拨号未完成，请稍后重试或联系公司客服", icon: "none" });
    }
  },

  subscribeOrderReminders() { subscriptions.requestFromTap(this); },

  goHome() {
    wx.redirectTo({ url: `/pages/index/index?storefrontCode=${this.data.storefrontCode}` });
  },

  goMe() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` });
  },
});
