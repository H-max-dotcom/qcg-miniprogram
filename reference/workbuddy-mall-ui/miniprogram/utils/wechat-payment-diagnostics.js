const LATCH_KEY = 'mall.wechat.permission-restricted.v1';
const RECORD_KEY = 'mall.wechat.payment-diagnostic.v1';
let memoryRestricted = false;
function token(value) { return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null; }
function safeMessage(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[REDACTED]')
    .replace(/(?:prepay_id|openid|unionid|paySign|nonceStr|api.?v3.?key|authorization|private.?key|token)\s*[=:]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[URL]').replace(/\b\d{11,}\b/g, '[NUMBER]')
    .replace(/\b[A-Za-z0-9+/=_-]{28,}\b/g, '[VALUE]');
}
function classify(error) {
  const message = String(error && error.errMsg || '');
  if (Number(error && error.errno) === 102 || /jsapi\s+has\s+no\s+permission|access\s+denied|no\s+permission|支付功能暂时无法使用/i.test(message)) return 'PLATFORM_PERMISSION_DENIED';
  if (/banned/i.test(message)) return 'JSAPI_BANNED';
  if (/cancel/i.test(message)) return 'USER_CANCEL';
  if (/network|timeout|timed out|网络/i.test(message)) return 'NETWORK_ERROR';
  if (/param|signature|sign error|参数|签名/i.test(message)) return 'PARAMETER_ERROR';
  return 'UNKNOWN_WECHAT_ERROR';
}
function isRestricted(api) {
  try { return memoryRestricted || api.getStorageSync(LATCH_KEY) === true; } catch (_) { return true; }
}
function context(api, result) {
  let account = {}, info = {};
  try { account = api.getAccountInfoSync().miniProgram || {}; } catch (_) {}
  try { info = typeof api.getAppBaseInfo === 'function' ? api.getAppBaseInfo() : api.getSystemInfoSync(); } catch (_) {}
  return { appIdMasked: typeof account.appId === 'string' ? '***' + account.appId.slice(-4) : null,
    out_trade_no: token(result.merchantOrderNo), prepayIdPresent: !!(result.clientPayment && /^prepay_id=.+/.test(result.clientPayment.package)),
    requestedAt: new Date().toISOString(), wechatVersion: token(info.version), sdkVersion: token(info.SDKVersion), requestId: token(result.requestId) };
}
function capture(api, error, safeContext) {
  const category = classify(error);
  const restricted = category === 'PLATFORM_PERMISSION_DENIED' || category === 'JSAPI_BANNED';
  const record = { appIdMasked: /^\*{3}[A-Za-z0-9]{4}$/.test(safeContext.appIdMasked) ? safeContext.appIdMasked : null, out_trade_no: token(safeContext.out_trade_no), prepayIdPresent: safeContext.prepayIdPresent === true, requestedAt: token(safeContext.requestedAt), wechatVersion: token(safeContext.wechatVersion), sdkVersion: token(safeContext.sdkVersion), requestId: token(safeContext.requestId), errno: typeof error.errno === 'number' ? error.errno : safeMessage(error.errno),
    errCode: typeof error.errCode === 'number' ? error.errCode : safeMessage(error.errCode), errMsg: safeMessage(error.errMsg), category,
    MINIPROGRAM_PAYMENT_PERMISSION_RESTRICTED: restricted ? 'YES' : 'NO' };
  if (restricted) { memoryRestricted = true; try { api.setStorageSync(LATCH_KEY, true); } catch (_) {} }
  // Only this allowlisted record is persisted; never persist requestPayment arguments.
  try { api.setStorageSync(RECORD_KEY, record); } catch (_) {}
  console.warn('MALL_WECHAT_PAYMENT_DIAGNOSTIC', record);
  return record;
}
async function invoke(api, result) {
  if (isRestricted(api)) return { restricted: true, cancelled: false, category: 'PLATFORM_PERMISSION_DENIED' };
  const safeContext = context(api, result);
  try { await new Promise((resolve, reject) => api.requestPayment({ ...result.clientPayment, success: resolve, fail: reject })); return { restricted: false, cancelled: false }; }
  catch (error) {
    const failure = { errno: error && error.errno, errCode: error && error.errCode, errMsg: String(error && error.errMsg || '') };
    for (const value of Object.values(result.clientPayment || {})) {
      if (typeof value === 'string' && value.length > 3) failure.errMsg = failure.errMsg.split(value).join('[REDACTED]');
    }
    const packageValue = result.clientPayment && result.clientPayment.package;
    if (typeof packageValue === 'string') failure.errMsg = failure.errMsg.split(packageValue.replace(/^prepay_id=/, '')).join('[REDACTED]');
    const record = capture(api, failure, safeContext); return { restricted: record.MINIPROGRAM_PAYMENT_PERMISSION_RESTRICTED === 'YES', cancelled: record.category === 'USER_CANCEL', category: record.category }; }
}
module.exports = { classify, safeMessage, isRestricted, context, capture, invoke };
