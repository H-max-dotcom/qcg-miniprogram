function runtimeConfigUnavailable() {
  throw Object.assign(new Error("商城运行环境配置不可用，已停止请求"), { code: "MALL_RUNTIME_CONFIG_UNAVAILABLE" });
}

const FAIL_CLOSED_RUNTIME_CONFIG = Object.freeze({
  API_BASES: Object.freeze({}),
  getApiBase: runtimeConfigUnavailable,
  assertMallRequestTarget: runtimeConfigUnavailable,
});

let runtimeConfig = FAIL_CLOSED_RUNTIME_CONFIG;
if (typeof require === "function") {
  try {
    runtimeConfig = require("../config/runtime");
  } catch {
    runtimeConfig = FAIL_CLOSED_RUNTIME_CONFIG;
  }
}
const {
  API_BASES,
  assertMallRequestTarget,
  getApiBase,
} = runtimeConfig;

function resolveMallAssetUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(?:https?:)?\/\//i.test(url) || /^data:/i.test(url)) return url;
  if (!url.startsWith("/")) return url;
  try {
    return `${getApiBase()}${url}`;
  } catch {
    return "";
  }
}

const MALL_SESSION_COOKIE_NAMES = ["mall_binding_session", "mall_customer_session"];
const MALL_SESSION_STORAGE_KEY = "qcg.mall.session.cookies.v1";
const MALL_SESSION_SAVED_AT_KEY = "qcg.mall.session.saved-at.v1";
const MALL_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function sessionStorageKey(key) {
  const base = getApiBase();
  if (typeof runtimeConfig.isMall055LocalRuntime === "function" && runtimeConfig.isMall055LocalRuntime()) return `${key}.060-local`;
  if (base.endsWith("/__mall060")) return `${key}.060`;
  if (base.endsWith("/__mall054")) return `${key}.054`;
  return base.endsWith("/044g") ? `${key}.044g` : key;
}
let mallSessionVersion = 0;
let mallCartOwners = Object.create(null);
const mallCustomerReadVersions = Object.create(null);

function mallCartStorefrontKey(value) {
  return String(value || "zhenshang").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "zhenshang";
}

// A cart owner is established only by the current server-side customer context.
// It stays in memory and becomes unavailable immediately after logout/expiry.
function getMallCartCustomerId(storefrontCode) {
  const cookie = readMallSessionCookie();
  const owner = mallCartOwners[mallCartStorefrontKey(storefrontCode)];
  return cookie && owner && owner.cookie === cookie ? owner.customerId : "";
}

function staleMallSessionError() {
  return Object.assign(new Error("登录状态已变化，请刷新后重试"), { code: "MALL_SESSION_CHANGED" });
}
const MALL_SESSION_FAILURE_CODES = {
  NEED_LOGIN: true,
  SESSION_EXPIRED: true,
  SESSION_INVALID: true,
  UNAUTHORIZED: true,
};

const SAFE_PRICE_UNAVAILABLE_MESSAGE = "当前规格暂无有效售价，请联系业务员。";
const OFF_SHELF_CART_MESSAGE = "该商品已下架，请移除后继续结算。";
const MALL_BUSINESS_TIMEZONE = "Asia/Shanghai";

const SAFE_MALL_ERROR_MESSAGES = {
  MALL_PRICE_UNAVAILABLE: SAFE_PRICE_UNAVAILABLE_MESSAGE,
  INVALID_PRODUCT: "当前商品或规格暂不可销售，请重新选择商品",
  INVALID_QUANTITY: "商品数量未达到起订量，请调整数量后重试",
  INSUFFICIENT_STOCK: "当前商品库存不足，请调整数量或重新选择商品",
  NEED_LOGIN: "请先登录微信小程序",
  NEED_BIND_CUSTOMER: "请先完成登录和门店资料",
  BINDING_PENDING_REVIEW: "门店资料正在确认中",
  BINDING_NOT_ACTIVE: "当前账号暂不可用，请联系业务员",
  CUSTOMER_NOT_ACTIVE: "当前门店暂不可下单，请联系业务员",
  ORDER_NOT_FOUND: "订单不存在或当前账号无权操作",
  ORDER_NOT_CANCELLABLE: "订单已进入商家处理流程，当前不能取消",
  MALL_ORDER_CANCEL_FAILED: "订单取消失败，请刷新后重试",
  INVALID_CLIENT_REQUEST_ID: "订单提交准备失败，请重新打开结算页",
  MISSING_CLIENT_REQUEST_ID: "订单提交准备失败，请重新打开结算页",
  SESSION_COOKIE_MISSING: "登录会话建立失败，请重新登录",
  SESSION_STORAGE_FAILED: "登录状态保存失败，请重新登录",
  SESSION_EXPIRED: "登录状态已失效，请重新登录",
  MALL_SESSION_CHANGED: "登录状态已变化，请刷新后重试",
  IDEMPOTENCY_CONFLICT: "下单内容已变化，请返回购物车确认后重试",
  ADDRESS_NOT_FOUND: "收货地址不存在或暂不可用",
  ADDRESS_NOT_EDITABLE: "当前地址不能直接修改，请按页面提示重新申请",
  DEFAULT_ADDRESS_CONFLICT: "地址状态刚刚发生变化，请刷新后重试",
  FAIL_PRODUCTION_TARGET_DETECTED: "商城暂时无法连接，请稍后重试",
  MALL_ISOLATED_API_MISSING: "商城暂时无法连接，请稍后重试",
  MALL_DEVELOPMENT_API_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_ACCEPTANCE_API_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_TRIAL_API_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_TRIAL_TARGET_MISMATCH: "商城暂时无法连接，请稍后重试",
  MALL_PRODUCTION_API_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_RELEASE_TARGET_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_RUNTIME_CONFIG_UNAVAILABLE: "商城暂时无法连接，请稍后重试",
  MALL_RUNTIME_ENV_MISSING: "商城暂时无法连接，请稍后重试",
  MALL_RUNTIME_ENV_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_REQUEST_TARGET_INVALID: "商城暂时无法连接，请稍后重试",
  MALL_REQUEST_TARGET_MISMATCH: "商城暂时无法连接，请稍后重试",
  CUSTOMER_EXPERIENCE_DISABLED: "当前功能尚未开放",
  ACCOUNT_DATA_UNAVAILABLE: "账户数据暂不可用，请稍后重试",
  CAMPAIGN_DATA_UNAVAILABLE: "活动数据暂不可用，请稍后重试",
  CAMPAIGN_NOT_FOUND: "活动不存在或当前不可查看",
  CAMPAIGN_BUDGET_EXHAUSTED: "活动优惠额度不足，请减少数量或选择其他商品",
  CAMPAIGN_CUSTOMER_LIMIT_EXCEEDED: "已超出您可购买的活动数量，请减少数量后重试",
  CAMPAIGN_CAPACITY_UNAVAILABLE: "活动额度暂不可用，请刷新后重试或联系业务员",
  CAMPAIGN_ENDED: "活动已结束，不能继续享受本期活动价格",
  CAMPAIGN_PAUSED: "活动暂不可参与，请查看其他活动",
  CAMPAIGN_UPCOMING: "活动尚未开始，请稍后再来",
  PRODUCT_UNAVAILABLE: "商品已下架或暂不可购买",
  PRODUCT_NOT_FOUND: "分享内容已失效，请返回商城查看其他商品",
  SHARE_INVALID: "分享内容已失效，请返回商城查看最新商品或活动",
  MALL_SHARE_EXPIRED: "分享内容已失效，请返回商城查看最新商品或活动",
  MALL_SHARE_ACCESS_DENIED: "当前账号暂不可查看此分享，请返回商城",
  COUPON_DISABLED: "优惠券当前未开放",
  COUPON_INVALID: "所选优惠券不可用于本单，请重新选择",
  COUPON_MARGIN_GUARD_BLOCKED: "该优惠券与当前商品价格不兼容，请重新选择",
  COUPON_DEPENDENCY_DISABLED: "优惠券结算暂不可用",
  ORDER_TIME_COUPON_DISABLED: "优惠券请在交付完成后付款时选择，下单时不使用",
};

function getSafeMallErrorMessage(error, fallback) {
  const code = typeof error === "string" ? error : String((error && error.code) || "");
  const message = typeof error === "object" && error ? String(error.message || "") : "";
  if (code === "CAMPAIGN_UPCOMING") {
    const match = /^活动尚未开始，开始时间：(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/.exec(message);
    if (match && Number.isFinite(new Date(match[1]).getTime())) return `活动尚未开始，开始时间：${formatServerDateTime(match[1])}`;
  }
  if (code === "INVALID_PRODUCT" && message === OFF_SHELF_CART_MESSAGE) return OFF_SHELF_CART_MESSAGE;
  if (code === "COUPON_INVALID" && [
    "该优惠券不在有效期内", "该优惠券不适用于当前客户",
    "该优惠券不能与本单活动同时使用", "本单适用商品金额未达到优惠券使用门槛",
    "本单没有适用该优惠券的商品", "该优惠券暂不可用于本单，请重新选择",
  ].includes(message)) return message;
  if (SAFE_MALL_ERROR_MESSAGES[code]) return SAFE_MALL_ERROR_MESSAGES[code];
  return fallback || "请求失败，请稍后重试";
}

function formatServerDateTime(value) {
  // Server DTO timestamps are date strings, never unitless epoch numbers.
  // Reject missing/numeric values instead of coercing null/seconds into 1970.
  if (typeof value !== "string" || !value.trim() || /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: MALL_BUSINESS_TIMEZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  } catch {
    const businessTime = new Date(parsed.getTime() + (8 * 60 * 60 * 1000));
    const pad = (part) => String(part).padStart(2, "0");
    return `${businessTime.getUTCFullYear()}/${businessTime.getUTCMonth() + 1}/${businessTime.getUTCDate()} ${pad(businessTime.getUTCHours())}:${pad(businessTime.getUTCMinutes())}`;
  }
}

function createClientRequestId(prefix) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix || "mall"}-${Date.now()}-${random}`;
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const productId = String(item.productId || "").trim();
      const productUnitId = String(item.productUnitId || "").trim();
      if (!productId || !productUnitId) return null;
      return {
        productId,
        productUnitId,
        quantity: String(item.quantity == null ? 1 : item.quantity),
        lineRemark: item.lineRemark || item.remark || "",
        quoteToken: typeof item.quoteToken === "string" ? item.quoteToken : undefined,
      };
    })
    .filter(Boolean);
}

function assertOrderItemsHaveProductUnit(items) {
  const normalized = normalizeOrderItems(items);
  return Array.isArray(items)
    && items.length > 0
    && normalized.length === items.length
    && normalized.every((item) => item.productId && item.productUnitId);
}

function appendQuery(path, query) {
  const pairs = [];
  Object.keys(query || {}).forEach((key) => {
    const value = query[key];
    if (value !== undefined && value !== null && value !== "") {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  });
  if (!pairs.length) return path;
  return `${path}${path.indexOf("?") >= 0 ? "&" : "?"}${pairs.join("&")}`;
}

function isOfficialMallApiUrl(url) {
  const value = String(url || "");
  let mallRoot = "";
  try {
    mallRoot = `${getApiBase()}/api/mall`;
  } catch {
    return false;
  }
  return value === mallRoot || value.indexOf(`${mallRoot}/`) === 0;
}

function isOfficialMallCookieName(name) {
  return MALL_SESSION_COOKIE_NAMES.indexOf(String(name || "")) >= 0;
}

function isSafeCookieValue(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4096
    && !/[\s;,\u0000-\u001f\u007f]/.test(value);
}

function appendCookieSources(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => appendCookieSources(item, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  const name = String(value.name || "").trim();
  const cookieValue = typeof value.value === "string" ? value.value : "";
  if (isOfficialMallCookieName(name) && isSafeCookieValue(cookieValue)) {
    output.push(`${name}=${cookieValue}`);
  }
}

function collectResponseCookieSources(response) {
  const sources = [];
  const headers = response && response.header && typeof response.header === "object"
    ? response.header
    : {};
  Object.keys(headers).forEach((name) => {
    if (String(name).toLowerCase() === "set-cookie") {
      appendCookieSources(headers[name], sources);
    }
  });
  appendCookieSources(response && response.cookies, sources);
  return sources;
}

function extractOfficialMallCookies(values) {
  const pairs = {};
  const sources = [];
  appendCookieSources(values, sources);
  sources.forEach((source) => {
    MALL_SESSION_COOKIE_NAMES.forEach((name) => {
      const pattern = new RegExp(`(?:^|[,\\s])${name}=([^;,\\s]+)`, "g");
      let match = pattern.exec(source);
      while (match) {
        if (isSafeCookieValue(match[1])) pairs[name] = match[1];
        match = pattern.exec(source);
      }
    });
  });
  return MALL_SESSION_COOKIE_NAMES
    .filter((name) => pairs[name])
    .map((name) => `${name}=${pairs[name]}`)
    .join("; ");
}

function clearMallSession() {
  mallSessionVersion += 1;
  mallCartOwners = Object.create(null);
  if (typeof wx === "undefined" || typeof wx.removeStorageSync !== "function") return;
  try {
    wx.removeStorageSync(sessionStorageKey(MALL_SESSION_STORAGE_KEY));
    wx.removeStorageSync(sessionStorageKey(MALL_SESSION_SAVED_AT_KEY));
  } catch {
    // Session cleanup is fail-closed and never logs cookie material.
  }
}

function saveMallSessionCookie(cookieHeader) {
  if (
    !cookieHeader
    || typeof wx === "undefined"
    || typeof wx.setStorageSync !== "function"
  ) return false;
  try {
    wx.setStorageSync(sessionStorageKey(MALL_SESSION_STORAGE_KEY), cookieHeader);
    wx.setStorageSync(sessionStorageKey(MALL_SESSION_SAVED_AT_KEY), Date.now());
    return true;
  } catch {
    clearMallSession();
    return false;
  }
}

function readMallSessionCookie() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return "";
  try {
    const stored = wx.getStorageSync(sessionStorageKey(MALL_SESSION_STORAGE_KEY));
    const savedAt = Number(wx.getStorageSync(sessionStorageKey(MALL_SESSION_SAVED_AT_KEY)));
    if (!stored && !savedAt) return "";
    const now = Date.now();
    if (
      typeof stored !== "string"
      || !stored
      || !Number.isFinite(savedAt)
      || savedAt <= 0
      || savedAt > now + 5 * 60 * 1000
      || now - savedAt >= MALL_SESSION_MAX_AGE_MS
    ) {
      clearMallSession();
      return "";
    }
    const sanitized = extractOfficialMallCookies(stored);
    if (!sanitized) {
      clearMallSession();
      return "";
    }
    if (sanitized !== stored) wx.setStorageSync(sessionStorageKey(MALL_SESSION_STORAGE_KEY), sanitized);
    return sanitized;
  } catch {
    clearMallSession();
    return "";
  }
}

function captureMallSessionFromResponse(response) {
  const cookieHeader = extractOfficialMallCookies(collectResponseCookieSources(response));
  if (!cookieHeader) return { ok: false, code: "SESSION_COOKIE_MISSING" };
  if (!saveMallSessionCookie(cookieHeader)) {
    return { ok: false, code: "SESSION_STORAGE_FAILED" };
  }
  return { ok: true };
}

function getMallSessionCookieHeader(url) {
  return isOfficialMallApiUrl(url) ? readMallSessionCookie() : "";
}

function isMallSessionExpiredError(error) {
  const code = String((error && error.code) || "");
  return !!MALL_SESSION_FAILURE_CODES[code];
}

function shouldClearMallSession(response) {
  // An active VIEWER keeps the same session after an action is denied.
  if (response && response.statusCode === 403 && response.data && response.data.code === "CAPABILITY_DENIED") return false;
  if (response && (response.statusCode === 401 || response.statusCode === 403)) return true;
  const code = String((response && response.data && response.data.code) || "");
  return !!MALL_SESSION_FAILURE_CODES[code];
}

function request(options) {
  const method = options.method || "GET";
  const data = options.includeStorefrontContext === false
    ? Object.assign({}, options.data || {})
    : Object.assign({}, options.data || {}, {
      storefrontCode: options.storefrontCode,
      mallCode: options.storefrontCode,
    });
  if (method === "GET" && options.cacheBust !== false) data._mallCanonicalTs = Date.now();
  const path = method === "GET" ? appendQuery(options.path, data) : options.path;
  const url = `${getApiBase()}${path}`;
  assertMallRequestTarget(url);
  const header = {
    "Content-Type": "application/json",
    "X-QCG-Customer-Mode": "REAL_CUSTOMER",
  };
  if (method === "GET") {
    header["Cache-Control"] = "no-cache, no-store, max-age=0";
    header.Pragma = "no-cache";
  }
  const sessionCookie = getMallSessionCookieHeader(url);
  const sessionVersion = mallSessionVersion;
  if (sessionCookie) header.Cookie = sessionCookie;

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      timeout: Number(options.timeoutMs || 15000),
      data: method === "GET" ? {} : data,
      header,
      success(res) {
        if (sessionCookie !== getMallSessionCookieHeader(url) || sessionVersion !== mallSessionVersion) {
          reject(staleMallSessionError());
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok !== false) {
          if (options.captureMallSession === true) {
            const capture = captureMallSessionFromResponse(res);
            if (!capture.ok) {
              clearMallSession();
              const captureError = new Error(SAFE_MALL_ERROR_MESSAGES[capture.code]);
              captureError.code = capture.code;
              reject(captureError);
              return;
            }
          }
          resolve(res.data);
          return;
        }
        if (shouldClearMallSession(res)) clearMallSession();
        const err = new Error((res.data && (res.data.error || res.data.message)) || "请求失败");
        err.code = res.data && res.data.code;
        err.data = res.data || {};
        err.statusCode = res.statusCode;
        ["minimumOrderAmount", "eligibleSubtotal", "remainingAmount", "ownerName", "ownerPhone"].forEach((key) => {
          if (res.data && Object.prototype.hasOwnProperty.call(res.data, key)) err[key] = res.data[key];
        });
        reject(err);
      },
      fail(error) {
        const err = new Error(error.errMsg || "网络异常");
        err.code = /timeout/i.test(String(error.errMsg || "")) ? "NETWORK_TIMEOUT" : "NETWORK_ERROR";
        err.isNetworkError = true;
        reject(err);
      },
    });
  });
}

function getHome(storefrontCode) {
  return Promise.all([
    getMallMe(storefrontCode, "HOME_CART_CONTEXT"),
    request({ path: "/api/mall/home", storefrontCode }),
  ]).then((results) => results[1]);
}

function getCategories(storefrontCode) {
  return request({ path: "/api/mall/categories", storefrontCode });
}

function getProducts(storefrontCode, filters) {
  return request({
    path: "/api/mall/products",
    storefrontCode,
    data: filters || {},
  });
}

function getProductDetail(id, storefrontCode) {
  return request({ path: `/api/mall/products/${id}`, storefrontCode });
}

function getOrders(storefrontCode, pagination) {
  const query = pagination || {};
  return request({ path: "/api/mall/orders", storefrontCode, data: { page: query.page, pageSize: query.pageSize, keyword: query.keyword, customerStatus: query.customerStatus, status: query.status, dateFrom: query.dateFrom, dateTo: query.dateTo } });
}

function getOrderByClientRequestId(storefrontCode, clientRequestId) {
  return request({
    path: "/api/mall/orders",
    storefrontCode,
    data: { clientRequestId },
  });
}

function reconcileWechatReceipt(id, storefrontCode) {
  return request({ path: `/api/mall/orders/${encodeURIComponent(id)}/wechat-receipt`, method: "POST", storefrontCode });
}

function getOrderDetail(id, storefrontCode, wechatReference) {
  if (wechatReference) return request({ path: "/api/mall/orders/wechat-payment", storefrontCode, data: wechatReference });
  return request({ path: `/api/mall/orders/${id}`, storefrontCode });
}

function cancelOrder(id, storefrontCode, refundDisposition) {
  return request({
    path: `/api/mall/orders/${id}/cancel`,
    data: { refundDisposition },
    method: "POST",
    storefrontCode,
  });
}

function quoteMallCart(storefrontCode, items, customerCouponId) {
  if (!assertOrderItemsHaveProductUnit(items)) {
    return Promise.reject(Object.assign(new Error("请重新选择规格后再结算"), { code: "INVALID_PRODUCT" }));
  }
  return request({
    path: "/api/mall/cart/quote",
    method: "POST",
    storefrontCode,
    data: { items: normalizeOrderItems(items), customerCouponId: customerCouponId || undefined },
  });
}

function submitMallOrder(storefrontCode, payload) {
  if (!assertOrderItemsHaveProductUnit(payload && payload.items)) {
    return Promise.reject(Object.assign(new Error("请重新选择规格后再提交订单"), { code: "INVALID_PRODUCT" }));
  }
  return request({
    path: "/api/mall/orders",
    method: "POST",
    storefrontCode,
    data: {
      clientRequestId: payload.clientRequestId,
      addressId: payload.addressId,
      sourceScene: payload.sourceScene || "WECHAT_MINIPROGRAM",
      items: normalizeOrderItems(payload.items),
      remark: payload.remark || "",
      customerCouponId: payload.customerCouponId || undefined,
      campaignShareToken: payload.campaignShareToken || undefined,
      shareTokens: [...new Set((payload.items || []).flatMap(item => item.shareTokens || (item.shareToken ? [item.shareToken] : [])))],
    },
  });
}

function submitOrder(storefrontCode, payload) {
  const clientRequestId = payload.clientRequestId || createClientRequestId("wx");
  return submitMallOrder(storefrontCode, Object.assign({}, payload, {
    clientRequestId,
    items: normalizeOrderItems(payload.items),
  }));
}

function prepareWechatLogin(storefrontCode, inviteScene) {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        request({
          path: "/api/mall/wechat-login",
          method: "POST",
          storefrontCode,
          data: { wxLoginCode: result.code, inviteScene: inviteScene || undefined },
          captureMallSession: true,
        })
          .then(resolve)
          .catch(reject);
      },
      fail(error) {
        reject(new Error(error.errMsg || "微信登录准备失败"));
      },
    });
  });
}

function prepareWechatLoginWithPrivacy(storefrontCode, inviteScene) {
  return new Promise((resolve, reject) => {
    const runLogin = () => {
      prepareWechatLogin(storefrontCode, inviteScene).then(resolve).catch(reject);
    };
    if (typeof wx.requirePrivacyAuthorize !== "function") {
      runLogin();
      return;
    }
    wx.requirePrivacyAuthorize({
      success: runLogin,
      fail: () => reject(Object.assign(new Error("请先同意小程序用户隐私保护指引"), { code: "PRIVACY_NOT_AGREED" })),
    });
  });
}

function getMallMe(storefrontCode, sourceScene) {
  const key = mallCartStorefrontKey(storefrontCode);
  const version = mallCustomerReadVersions[key] = (mallCustomerReadVersions[key] || 0) + 1;
  const cookie = readMallSessionCookie();
  const sessionVersion = mallSessionVersion;
  delete mallCartOwners[key];
  return request({
    path: "/api/mall/me",
    storefrontCode,
    data: { sourceScene },
  }).then((result) => {
    if (version !== mallCustomerReadVersions[key]
      || cookie !== readMallSessionCookie() || sessionVersion !== mallSessionVersion) return result;
    const customerId = result.customerStatus === "APPROVED_BOUND_CUSTOMER"
      && result.priceAccess && result.priceAccess.canViewPrice
      && result.customer && String(result.customer.id || "").trim();
    if (cookie && customerId) mallCartOwners[key] = { cookie, customerId };
    return result;
  });
}

function getMallAccount(storefrontCode) {
  return request({ path: "/api/mall/account", storefrontCode });
}

function getMallFinance(storefrontCode) {
  return request({ path: "/api/mall/finance", storefrontCode });
}

function createWechatPrepaidPayment(storefrontCode, amount, idempotencyKey) {
  return request({
    path: "/api/mall/payments/wechat/intents",
    method: "POST",
    storefrontCode,
    data: { amount, idempotencyKey },
  });
}

function getMallCampaigns(storefrontCode) {
  return request({ path: "/api/mall/campaigns", storefrontCode });
}

function getMallCampaignDetail(storefrontCode, campaignCode) {
  return request({
    path: `/api/mall/campaigns/${encodeURIComponent(String(campaignCode || ""))}`,
    storefrontCode,
  });
}

function getMallCampaignShare(shareToken, clientEventId) {
  return request({ path: `/api/mall/campaign-shares/${encodeURIComponent(String(shareToken || ""))}`, includeStorefrontContext: false, data: clientEventId ? { clientEventId } : {} });
}

function recordMallCampaignShareEvent(shareToken, payload) {
  return request({ path: `/api/mall/campaign-shares/${encodeURIComponent(String(shareToken || ""))}`, method: "POST", includeStorefrontContext: false, data: payload || {} });
}

function getMallCoupons(storefrontCode) {
  return request({ path: "/api/mall/coupons", storefrontCode });
}

function claimMallCoupon(storefrontCode, templateId, idempotencyKey) {
  return request({ path: "/api/mall/coupons", method: "POST", storefrontCode, data: { templateId, idempotencyKey } });
}

function claimIssuedMallCoupon(storefrontCode, customerCouponId, idempotencyKey) {
  return request({ path: "/api/mall/coupons", method: "POST", storefrontCode, data: { customerCouponId, idempotencyKey } });
}

function registerMallProfile(storefrontCode, profile, inviteScene) {
  return request({
    path: "/api/mall/register",
    method: "POST",
    storefrontCode,
    data: Object.assign({}, profile, {
      mallCode: storefrontCode,
      storefrontCode,
      inviteScene: inviteScene || undefined,
    }),
  });
}

function getMallInvitationByScene(storefrontCode, inviteScene) {
  return request({
    path: `/api/mall/invitations/${encodeURIComponent(inviteScene)}`,
    storefrontCode,
  });
}

function confirmMallInvitationByScene(storefrontCode, inviteScene) {
  return request({
    path: `/api/mall/invitations/${encodeURIComponent(inviteScene)}`,
    method: "POST",
    storefrontCode,
    data: { action: "CONFIRM_EXISTING_CUSTOMER" },
    includeStorefrontContext: false,
    captureMallSession: true,
  });
}

function getAddresses(storefrontCode) {
  return request({ path: "/api/mall/addresses", storefrontCode });
}

function getAddress(id, storefrontCode) {
  return request({ path: `/api/mall/addresses/${id}`, storefrontCode });
}

function createAddress(storefrontCode, address) {
  return request({ path: "/api/mall/addresses", method: "POST", storefrontCode, data: address });
}

function updateAddress(id, storefrontCode, address) {
  return request({ path: `/api/mall/addresses/${id}`, method: "PATCH", storefrontCode, data: address });
}

function deleteAddress(id, storefrontCode) {
  return request({ path: `/api/mall/addresses/${id}`, method: "DELETE", storefrontCode });
}

function setDefaultAddress(id, storefrontCode) {
  return request({ path: `/api/mall/addresses/${id}/default`, method: "POST", storefrontCode });
}

function logoutMallSession() {
  clearMallSession();
  return { ok: true };
}

module.exports = {
  API_BASES,
  MALL_SESSION_COOKIE_NAMES,
  get MALL_SESSION_STORAGE_KEY() { return sessionStorageKey(MALL_SESSION_STORAGE_KEY); },
  get MALL_SESSION_SAVED_AT_KEY() { return sessionStorageKey(MALL_SESSION_SAVED_AT_KEY); },
  MALL_SESSION_MAX_AGE_MS,
  getApiBase,
  resolveMallAssetUrl,
  SAFE_PRICE_UNAVAILABLE_MESSAGE,
  OFF_SHELF_CART_MESSAGE,
  MALL_BUSINESS_TIMEZONE,
  getSafeMallErrorMessage,
  formatServerDateTime,
  createClientRequestId,
  request,
  isOfficialMallApiUrl,
  extractOfficialMallCookies,
  captureMallSessionFromResponse,
  getMallSessionCookieHeader,
  clearMallSession,
  logoutMallSession,
  isMallSessionExpiredError,
  getHome,
  getCategories,
  getProducts,
  getProductDetail,
  getOrders,
  getOrderByClientRequestId,
  getOrderDetail,
  reconcileWechatReceipt,
  cancelOrder,
  quoteMallCart,
  submitOrder,
  submitMallOrder,
  prepareWechatLogin,
  prepareWechatLoginWithPrivacy,
  getMallMe,
  getMallCartCustomerId,
  getMallAccount,
  getMallFinance,
  createWechatPrepaidPayment,
  getMallCampaigns,
  getMallCampaignDetail,
  getMallCampaignShare,
  recordMallCampaignShareEvent,
  getMallCoupons,
  claimMallCoupon,
  claimIssuedMallCoupon,
  registerMallProfile,
  getMallInvitationByScene,
  confirmMallInvitationByScene,
  getAddresses,
  getAddress,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  normalizeOrderItems,
  assertOrderItemsHaveProductUnit,
};

// Public Campaign identity is navigation data, never an authentication credential.
function getMallCampaignDirectEntry(storefrontCode, campaignId) {
  return request({ path: "/api/mall/campaigns", storefrontCode, data: { campaignId: String(campaignId || "") } });
}
module.exports.getMallCampaignDirectEntry = getMallCampaignDirectEntry;

function createMallShare(storefrontCode, payload) {
  return request({ path: "/api/mall/shares", method: "POST", storefrontCode, data: Object.assign({}, payload, { storefrontCode }) });
}
function getMallShare(storefrontCode, token) {
  return request({ path: `/api/mall/shares/${encodeURIComponent(token)}`, storefrontCode, cacheBust: false, data: { storefrontCode } });
}
function recordMallShareEvent(storefrontCode, token, payload) {
  return request({ path: `/api/mall/shares/${encodeURIComponent(token)}`, method: "POST", storefrontCode, data: Object.assign({}, payload, { storefrontCode }) });
}
module.exports.createMallShare = createMallShare;
module.exports.getMallShare = getMallShare;
module.exports.recordMallShareEvent = recordMallShareEvent;
