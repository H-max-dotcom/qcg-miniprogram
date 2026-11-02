const {
  createAddress,
  createClientRequestId,
  getAddress,
  getSafeMallErrorMessage,
  updateAddress,
} = require("../../utils/request");
const { resolveStorefrontEntrance } = require("../../utils/storefront");

const EMPTY_FORM = {
  recipientName: "",
  phone: "",
  province: "",
  city: "",
  district: "",
  detailAddress: "",
  remark: "",
  isDefault: false,
};

function businessMessage(error) {
  const messages = {
    NEED_LOGIN: "请先登录",
    NEED_BIND_CUSTOMER: "请先完成登录和门店资料",
    CUSTOMER_NOT_ACTIVE: "当前账号暂不可下单，请联系业务员或客服",
    INVALID_ADDRESS_INPUT: "地址信息不完整或格式不正确，请检查后重试",
    ADDRESS_NOT_FOUND: "该地址或申请不存在，请返回地址列表",
    ADDRESS_NOT_EDITABLE: "当前地址不能直接修改，请返回地址列表",
    DEFAULT_ADDRESS_CONFLICT: "地址状态刚刚发生变化，请刷新后重试",
    IDEMPOTENCY_CONFLICT: "本次申请内容已变化，请重新打开申请页",
  };
  return messages[error.code] || getSafeMallErrorMessage(error, "收货地址申请提交失败");
}

Page({
  data: {
    storefrontCode: "zhenshang",
    addressId: "",
    applicationId: "",
    isEdit: false,
    isReapply: false,
    loading: false,
    saving: false,
    error: "",
    clientRequestId: "",
    form: Object.assign({}, EMPTY_FORM),
  },

  onLoad(query) {
    const entrance = resolveStorefrontEntrance(query || {});
    const addressId = query && query.id ? String(query.id) : "";
    const applicationId = query && query.applicationId ? String(query.applicationId) : "";
    this.setData({
      storefrontCode: entrance.storefrontCode,
      addressId,
      applicationId,
      isEdit: !!addressId,
      isReapply: !!applicationId,
      clientRequestId: createClientRequestId("address"),
    });
    if (addressId || applicationId) this.loadAddress(addressId || applicationId);
  },

  loadAddress(recordId) {
    this.setData({ loading: true, error: "" });
    getAddress(recordId, this.data.storefrontCode)
      .then((result) => {
        const address = result.address || {};
        this.setData({
          loading: false,
          form: {
            recipientName: address.recipientName || "",
            phone: address.phone || "",
            province: address.province || "",
            city: address.city || "",
            district: address.district || "",
            detailAddress: address.detailAddress || address.fullAddress || "",
            remark: address.remark || "",
            isDefault: !!address.isDefault,
          },
        });
      })
      .catch((error) => this.setData({ loading: false, error: businessMessage(error) }));
  },

  input(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  toggleDefault(event) {
    this.setData({ "form.isDefault": !!event.detail.value });
  },

  submit() {
    if (this.data.saving) return;
    const form = this.data.form;
    const required = ["recipientName", "phone", "province", "city", "district", "detailAddress"];
    if (required.some((key) => !String(form[key] || "").trim())) {
      wx.showToast({ title: "请完整填写收货人、电话、区域和详细地址", icon: "none" });
      return;
    }
    this.setData({ saving: true, error: "" });
    const payload = Object.assign({}, form, { clientRequestId: this.data.clientRequestId });
    const operation = this.data.isEdit
      ? updateAddress(this.data.addressId, this.data.storefrontCode, payload)
      : createAddress(this.data.storefrontCode, payload);
    operation
      .then((result) => {
        const duplicate = !!(result.application && result.application.idempotentHit);
        wx.showModal({
          title: duplicate ? "申请已存在" : "申请已提交",
          content: "地址已提交，确认完成后可用于下单。",
          showCancel: false,
          confirmText: "返回地址列表",
          success: () => wx.navigateBack({ delta: 1 }),
        });
      })
      .catch((error) => {
        const message = businessMessage(error);
        this.setData({ error: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => this.setData({ saving: false }));
  },
});
