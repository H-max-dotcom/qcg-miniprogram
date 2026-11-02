Component({
  properties: {
    visible: { type: Boolean, value: false },
    brandName: { type: String, value: "全渠供" },
    submitting: { type: Boolean, value: false },
    errorMessage: { type: String, value: "" },
  },
  data: {
    privacyAgreed: false,
    privacyTitle: "小程序用户隐私保护指引",
  },
  observers: {
    visible(value) {
      if (!value && this.data.privacyAgreed) {
        this.setData({ privacyAgreed: false });
      }
    },
  },
  methods: {
    onMaskClose() {
      if (this.data.submitting) return;
      this.triggerEvent("close");
    },
    onCloseTap() {
      if (this.data.submitting) return;
      this.triggerEvent("close");
    },
    stopBubble() {},
    onTogglePrivacy(event) {
      if (this.data.submitting) return;
      this.setData({ privacyAgreed: !!(event.detail && event.detail.value && event.detail.value.length) });
    },
    onOpenPrivacyGuide() {
      if (this.data.submitting) return;
      if (typeof wx.openPrivacyContract !== "function") {
        wx.showToast({ title: "当前微信版本暂不支持打开隐私指引", icon: "none" });
        this.triggerEvent("privacyblock", { reason: "API_UNSUPPORTED" });
        return;
      }
      wx.openPrivacyContract({
        success: () => {
          this.triggerEvent("privacyopened");
        },
        fail: (error) => {
          wx.showToast({ title: "暂无法打开隐私保护指引，请稍后重试", icon: "none" });
          this.triggerEvent("privacyblock", {
            reason: "OPEN_FAILED",
            message: error && (error.errMsg || error.message),
          });
        },
      });
    },
    onLoginTap() {
      if (this.data.submitting) return;
      if (!this.data.privacyAgreed) {
        wx.showToast({ title: "请先阅读并同意隐私保护指引", icon: "none" });
        return;
      }
      this.triggerEvent("login", { privacyAgreed: true });
    },
  },
});
