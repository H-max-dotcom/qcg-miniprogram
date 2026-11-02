const {
  deleteAddress,
  getAddresses,
  getMallMe,
  getSafeMallErrorMessage,
  setDefaultAddress,
} = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

function maskName(value) {
  const text = String(value || "").trim();
  if (!text) return "客户联系人";
  return text.length === 1 ? `${text}*` : `${text.slice(0, 1)}${"*".repeat(Math.min(2, text.length - 1))}`;
}

function maskPhone(value) {
  const text = String(value || "").trim();
  if (text.length < 7) return text ? `${text.slice(0, 2)}***` : "电话已保护";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function publicAddress(address) {
  const statusText = ({ PENDING: "确认中", APPROVED: "可使用", REJECTED: "需修改", DISABLED: "已停用" })[String(address.status || "").toUpperCase()] || "待确认";
  return Object.assign({}, address, {
    recipientNameMasked: maskName(address.recipientName),
    phoneMasked: maskPhone(address.phone),
    statusClass: String(address.status || "").toLowerCase(),
    statusText,
  });
}

function businessMessage(error) {
  const messages = {
    NEED_LOGIN: "请先登录",
    NEED_BIND_CUSTOMER: "请先完成登录和门店资料",
    CUSTOMER_NOT_ACTIVE: "当前账号暂不可下单，请联系业务员或客服",
    ADDRESS_NOT_FOUND: "该地址已被删除，请刷新后重试",
    DEFAULT_ADDRESS_CONFLICT: "默认地址刚刚发生变化，请刷新后重试",
    ADDRESS_NOT_EDITABLE: "当前地址不能直接修改，请联系业务员",
    IDEMPOTENCY_CONFLICT: "地址申请内容已变化，请重新打开申请页",
  };
  return messages[error.code] || getSafeMallErrorMessage(error, "收货地址处理失败");
}

Page({
  data: {
    storefrontCode: "zhenshang",
    mode: "manage",
    addresses: [],
    loading: false,
    error: "",
    canAddressApply: false,
  },

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    this.setData({
      storefrontCode: entrance.storefrontCode,
      mode: query && query.mode === "select" ? "select" : "manage",
    });
  },

  onShow() {
    this.setData({ addresses: [], loading: true, error: "", canAddressApply: false });
    getMallMe(this.data.storefrontCode, "ADDRESS_LIST_CAPABILITY")
      .then((profile) => {
        const capabilities = profile && profile.member && profile.member.effectiveMallCapabilities;
        const isBoundCustomer = profile && profile.customerStatus === "APPROVED_BOUND_CUSTOMER";
        this.setData({ canAddressApply: isBoundCustomer && Array.isArray(capabilities) && capabilities.indexOf("MALL_ADDRESS_APPLY") >= 0 });
        if (!isBoundCustomer) {
          this.setData({ loading: false, error: "请先完成登录和门店资料" });
          return null;
        }
        return this.loadAddresses();
      })
      .catch(() => this.setData({ addresses: [], loading: false, error: "请先完成登录和门店资料", canAddressApply: false }));
  },

  loadAddresses() {
    this.setData({ loading: true, error: "" });
    return getAddresses(this.data.storefrontCode)
      .then((result) => {
        this.setData({ addresses: (result.addresses || []).map(publicAddress), loading: false, error: "" });
      })
      .catch((error) => {
        this.setData({ loading: false, error: businessMessage(error) });
      });
  },

  choose(event) {
    if (this.data.mode !== "select") return;
    const address = this.data.addresses[Number(event.currentTarget.dataset.index)];
    if (!address) return;
    if (!address.canCheckout || address.status !== "APPROVED") {
      wx.showToast({ title: address.status === "PENDING" ? "该地址仍在确认中" : "该地址当前不能用于下单", icon: "none" });
      return;
    }
    const channel = this.getOpenerEventChannel();
    channel.emit("addressSelected", address);
    wx.navigateBack({ delta: 1 });
  },

  add() {
    if (!this.data.canAddressApply) return wx.showToast({ title: "当前账号仅可查看地址", icon: "none" });
    wx.navigateTo({ url: `/pages/address/edit?storefrontCode=${this.data.storefrontCode}` });
  },

  edit(event) {
    if (!this.data.canAddressApply) return;
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/address/edit?id=${encodeURIComponent(id)}&storefrontCode=${this.data.storefrontCode}` });
  },

  reapply(event) {
    if (!this.data.canAddressApply) return;
    const applicationId = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/address/edit?applicationId=${encodeURIComponent(applicationId)}&storefrontCode=${this.data.storefrontCode}` });
  },

  makeDefault(event) {
    if (!this.data.canAddressApply) return;
    const id = event.currentTarget.dataset.id;
    setDefaultAddress(id, this.data.storefrontCode)
      .then(() => {
        wx.showToast({ title: "已设为默认地址", icon: "success" });
        return this.loadAddresses();
      })
      .catch((error) => wx.showToast({ title: businessMessage(error), icon: "none" }));
  },

  remove(event) {
    if (!this.data.canAddressApply) return;
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "停用收货地址",
      content: "停用后不能用于新订单。确认停用吗？",
      confirmColor: "#c83f3f",
      success: (result) => {
        if (!result.confirm) return;
        deleteAddress(id, this.data.storefrontCode)
          .then(() => {
            wx.showToast({ title: "地址已停用", icon: "success" });
            return this.loadAddresses();
          })
          .catch((error) => wx.showToast({ title: businessMessage(error), icon: "none" }));
      },
    });
  },
});
