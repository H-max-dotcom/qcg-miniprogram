const runtime = require('../config/runtime');
const transport = require('./request');
const diagnostics = require('./wechat-payment-diagnostics');
const ORDER_ID = 'cmunp5wa10001rusoqzcy9y8i';
const TRADE_NO = 'WOPd26d9c3378b775932a3d5be543f9';
const ATTEMPT_KEY = 'mall.044i.once.' + TRADE_NO;
function enabled(orderId) {
  try { return orderId === ORDER_ID && runtime.getApiBase() === 'https://mall044a.wzzhenshang.com/044g'
    && wx.getAccountInfoSync().miniProgram.envVersion === 'develop'; } catch (_) { return false; }
}
function attempted(api) { try { return api.getStorageSync(ATTEMPT_KEY) === true; } catch (_) { return true; } }
function launchPreview() {
  if (enabled(ORDER_ID)) setTimeout(() => wx.reLaunch({ url: '/pages/payments/payment?orderId=' + ORDER_ID + '&storefrontCode=zhenshang' }), 0);
}
async function initialize(page) {
  if (!enabled(page.data.orderId) || page._paymentActive) return;
  page._oneTimeDiagnostic = true;
  await transport.prepareWechatLoginWithPrivacy('zhenshang');
  await page.refresh();
  if (attempted(wx)) page.setData({ wechatAvailable: false, recoveryNeeded: false, quoteError: '本次支付已尝试，已停止再次付款。' });
}
async function run(page, api, order, prepare, recover) {
  if (!enabled(order.orderId) || attempted(api) || page._paymentActive || diagnostics.isRestricted(api)) return;
  if (order.amount !== '0.01') throw new Error('DIAGNOSTIC_AMOUNT_MISMATCH');
  page.setData({ confirming: true });
  let consent = false;
  try { consent = await new Promise(resolve => api.showModal({ title: '确认支付 ¥0.01', content: '本次仅尝试一次。支付失败后请停止，保留诊断结果。', confirmText: '确认支付', success: r => resolve(r.confirm === true), fail: () => resolve(false) })); }
  finally { page.setData({ confirming: false }); }
  if (!consent || attempted(api) || page._visible === false) return;
  page._paymentActive = true; page.setData({ paying: true });
  try {
    const result = await prepare(page.data.storefrontCode, order, '044I_ONE_TIME');
    if (!result || result.ok !== true || result.orderId !== ORDER_ID || result.merchantOrderNo !== TRADE_NO || !result.clientPayment) throw new Error('DIAGNOSTIC_PREPAY_MISMATCH');
    // Fail closed before requestPayment. Persistent storage failure prevents the call.
    api.setStorageSync(ATTEMPT_KEY, true);
    const outcome = await diagnostics.invoke(api, result);
    const failed = Boolean(outcome.category);
    const record = failed ? api.getStorageSync('mall.wechat.payment-diagnostic.v1') : { ...diagnostics.context(api, result), errno: null, errCode: null, errMsg: 'requestPayment:ok', category: 'CLIENT_SUCCESS', MINIPROGRAM_PAYMENT_PERMISSION_RESTRICTED: 'NO' };
    api.setStorageSync('mall.wechat.payment-diagnostic.v1', record);
    try { await transport.request({ path: '/api/mall/payments/diagnostic-result', method: 'POST', storefrontCode: 'zhenshang', data: { result: failed ? 'FAIL' : 'SUCCESS', record } }); }
    catch (_) { page.setData({ quoteError: '诊断结果已保存在本机，请保留并联系商家。' }); }
    if (failed) {
      page.setData({ paymentRestricted: outcome.restricted === true, recoveryNeeded: false, quoteError: '支付未成功，诊断结果已记录。请停止，不要再次付款。' });
      return;
    }
    const final = await recover(page.data.storefrontCode, ORDER_ID, false);
    page.setData({ recoveryNeeded: false, quoteError: final.state === 'SUCCEEDED' ? '服务端已确认付款，请等待验收结果。' : '客户端已返回成功，服务端结果待核验。请勿再次付款。' });
  } catch (_) { page.setData({ recoveryNeeded: false, quoteError: '本次诊断已停止，请联系商家核验，勿重复付款。' }); }
  finally { page._paymentActive = false; page.setData({ paying: false, wechatAvailable: false }); }
}
module.exports = { enabled, attempted, initialize, launchPreview, run };
