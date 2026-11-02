const MIN_COMPLETE_ADDRESS_CHARS = 4;

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function meaningfulAddressLength(value) {
  return cleanText(value).normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "").length;
}

function normalizeNewCustomerProfile(form) {
  const input = form || {};
  return {
    shopName: cleanText(input.shopName),
    contactName: cleanText(input.contactName),
    phone: cleanText(input.phone),
    address: cleanText(input.address),
    sourceScene: cleanText(input.sourceScene),
  };
}

function validateNewCustomerProfile(form) {
  const profile = normalizeNewCustomerProfile(form);
  if (!profile.shopName) return { ok: false, message: "请填写客户 / 门店名称", profile };
  if (!profile.contactName) return { ok: false, message: "请填写联系人", profile };
  const phoneDigits = profile.phone.replace(/\D+/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 20) {
    return { ok: false, message: "请填写有效联系电话", profile };
  }
  if (meaningfulAddressLength(profile.address) < MIN_COMPLETE_ADDRESS_CHARS) {
    return {
      ok: false,
      message: "请填写完整门店或收货地址，至少包含区域、道路、门牌或位置说明",
      profile,
    };
  }
  return { ok: true, message: "", profile };
}

module.exports = {
  MIN_COMPLETE_ADDRESS_CHARS,
  meaningfulAddressLength,
  normalizeNewCustomerProfile,
  validateNewCustomerProfile,
};
