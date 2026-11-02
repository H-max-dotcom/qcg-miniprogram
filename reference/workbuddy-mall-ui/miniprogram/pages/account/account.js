const { createWechatPrepaidPayment, formatServerDateTime, getMallAccount, getSafeMallErrorMessage } = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

const PAYMENT_STATUS_TEXT = { CREATED: "待支付", PENDING: "确认中", SUCCEEDED: "支付成功", FAILED: "未完成", CLOSED: "已关闭" };
function historyAmount(value) {
  if (value === undefined || value === null || value === "") return "-";
  const amount = Number(value);
  return Number.isFinite(amount) ? `¥${amount.toFixed(2)}` : "-";
}
function hasReadableBalances(account) {
  return account.balances && ["availableBalanceText", "bookBalanceText", "reservedBalanceText", "cumulativeDepositedText", "cumulativeConsumedText"]
    .every((key) => typeof account.balances[key] === "string" && account.balances[key].trim());
}

Page({
  data: {
    storefrontCode: "zhenshang",
    viewState: "LOADING",
    loading: false,
    errorMessage: "",
    account: null,
    onlineDepositEnabled: false,
    depositAmount: "",
    depositPreset: "100",
    paymentPending: false,
    onlineDepositHistory: [],
  },

  _loadedOnce: false,

  onLoad(query) {
    this._disposed = false;
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({ storefrontCode: entrance.storefrontCode });
    this.loadAccount(false);
  },

  onShow() {
    if ((!this._loadedOnce || this._needsRefresh) && !this.data.loading) {
      this._needsRefresh = false;
      return this.loadAccount(true);
    }
    return this._accountRequest || Promise.resolve();
  },

  onHide() {
    this._requestId = (this._requestId || 0) + 1;
    this._needsRefresh = true;
    this.setData({ account: null, onlineDepositEnabled: false, onlineDepositHistory: [], loading: false, viewState: "LOADING" });
    if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
  },

  onUnload() {
    this._disposed = true;
    this._requestId = (this._requestId || 0) + 1;
    if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
  },

  onPullDownRefresh() {
    return this.loadAccount(true);
  },

  loadAccount(preserveStableState) {
    if (this._disposed) return Promise.resolve();
    if (this.data.loading) return this._accountRequest || Promise.resolve();
    if (!preserveStableState) this._loadedOnce = false;
    const requestId = this._requestId = (this._requestId || 0) + 1;
    const current = () => !this._disposed && requestId === this._requestId;
    // Form inputs remain stable. Account facts and the payment entry require a
    // successful current read, including after returning from another page.
    this.setData({
      loading: true,
      viewState: "LOADING",
      errorMessage: "",
      account: null,
      onlineDepositEnabled: false,
      onlineDepositHistory: [],
    });
    this._accountRequest = getMallAccount(this.data.storefrontCode)
      .then((result) => {
        if (!current()) return;
        const account = result && result.account;
        const history = Array.isArray(result && result.onlineDepositHistory) ? result.onlineDepositHistory.map((item) => ({
          id: item.id,
          merchantOrderNo: item.merchantOrderNo,
          amountText: historyAmount(item.amount),
          status: item.status,
          statusText: PAYMENT_STATUS_TEXT[item.status] || "状态待确认",
          createdAtText: item.createdAt ? formatServerDateTime(item.createdAt) : "-",
        })) : [];
        this._loadedOnce = true;
        if (!account) {
          this.setData({ viewState: "ERROR", errorMessage: "账户数据暂不可用", account: null, onlineDepositEnabled: false, onlineDepositHistory: [] });
          return;
        }
        const state = account.state;
        const readable = state === "ACCOUNT_EXISTS" && hasReadableBalances(account);
        const notOpened = state === "ACCOUNT_NOT_OPENED";
        if (state === "ACCOUNT_EXISTS" && !readable) {
          this.setData({ account: null, viewState: "UNAVAILABLE", errorMessage: "账户数据暂不完整，请重新读取" });
          return;
        }
        this.setData({
          account,
          viewState: readable
            ? "READY"
            : state === "ACCOUNT_NOT_OPENED"
              ? "EMPTY"
              : "UNAVAILABLE",
          errorMessage: "",
          onlineDepositEnabled: Boolean((readable || notOpened) && result && result.features && result.features.onlineDepositEnabled),
          onlineDepositHistory: history,
        });
      })
      .catch((error) => {
        if (!current()) return;
        this._loadedOnce = true;
        this.setData({
          viewState: "ERROR",
          account: null,
          onlineDepositEnabled: false,
          onlineDepositHistory: [],
          errorMessage: getSafeMallErrorMessage(error, "账户数据加载失败，请检查网络后重试。"),
        });
      })
      .finally(() => {
        if (!current()) return;
        this.setData({ loading: false });
        if (typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      });
    return this._accountRequest;
  },

  retry() {
    return this.loadAccount(true);
  },

  selectDepositPreset(event) {
    this.setData({ depositPreset: String(event.currentTarget.dataset.amount || ""), depositAmount: "" });
  },

  onDepositAmountInput(event) {
    this.setData({ depositAmount: String(event.detail.value || ""), depositPreset: "" });
  },

  startOnlineDeposit() {
    if (!this.data.onlineDepositEnabled || this.data.paymentPending) return;
    const amount = Number(this.data.depositAmount || this.data.depositPreset);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 50000) {
      wx.showToast({ title: "请输入 0.01 至 50000 元", icon: "none" });
      return;
    }
    const idempotencyKey = `mall-online-deposit:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    this.setData({ paymentPending: true });
    createWechatPrepaidPayment(this.data.storefrontCode, amount.toFixed(2), idempotencyKey)
      .then((result) => new Promise((resolve, reject) => {
        const payment = result && result.clientPayment;
        if (!payment) return reject(new Error("支付参数缺失"));
        wx.requestPayment(Object.assign({}, payment, { success: resolve, fail: reject }));
      }))
      .then(() => {
        wx.showToast({ title: "支付结果确认中", icon: "none" });
        return this.loadAccount(true);
      })
      .catch((error) => wx.showToast({ title: getSafeMallErrorMessage(error, "支付未完成"), icon: "none" }))
      .finally(() => this.setData({ paymentPending: false }));
  },

  openPayment(event) {
    const paymentId = event.currentTarget.dataset.paymentId;
    if (!paymentId) return;
    wx.navigateTo({ url: `/pages/payments/payment?mode=history&paymentId=${encodeURIComponent(paymentId)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  openOrder(event) {
    const orderId = event.currentTarget.dataset.orderId;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/orders/detail?id=${encodeURIComponent(orderId)}&storefrontCode=${encodeURIComponent(this.data.storefrontCode)}` });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: `/pages/me/me?storefrontCode=${this.data.storefrontCode}` }),
    });
  },
});
