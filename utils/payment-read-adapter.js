const { request, formatServerDateTime } = require("./request");
const NOT_INTEGRATED = "PAYMENT_COUPON_NOT_INTEGRATED";
function money(value) { return typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)); }
function unavailable() { return { state: "NOT_INTEGRATED", items: [], totalCount: null, totalAmount: null }; }
/** Read-only DTO from the 014 waiting-payment owner. No order-status inference. */
async function getWaitingPayments(storefrontCode, orderId, page = 1) {
  try {
    const result = await request({ path: "/api/mall/payments/waiting", storefrontCode, data: { orderId: orderId || undefined, page, pageSize: 20 } });
    if (!result || result.state !== "WAITING_PAYMENT" || !Array.isArray(result.items) || !Number.isSafeInteger(result.totalCount) || result.totalCount < 0 || !money(result.totalAmount)
      || result.items.some(item => !item || typeof item.orderId !== "string" || !item.orderId || typeof item.orderNo !== "string" || !money(item.amount))) throw Object.assign(new Error("待付款数据尚未核实"), { code: "WAITING_PAYMENT_INVALID" });
    // Whitelist the customer presentation. Do not forward ERP customer/source IDs.
    return { state: result.state, items: result.items.map(item => ({ orderId: item.orderId, orderNo: item.orderNo, paymentTiming: item.paymentTiming, receivableId: item.paymentTiming === "PAY_BEFORE_FULFILLMENT" ? null : item.sourceId, amount: item.amount, finalizedAt: item.finalizedAt, deliveredAt: item.deliveredAt, deliveredAtText: formatServerDateTime(item.deliveredAt) })), totalCount: result.totalCount, totalAmount: result.totalAmount, page: result.page, pageSize: result.pageSize };
  } catch (error) {
    if (error && (error.status === 404 || error.statusCode === 404 || ["NOT_FOUND", "ROUTE_NOT_FOUND", "NOT_IMPLEMENTED"].includes(error.code))) return unavailable();
    throw error;
  }
}
/** Formal payment-stage quote only; eligibility is evaluated by the server. */
async function getPaymentCouponOptions(storefrontCode, receivableId) {
  const result = await request({ path: "/api/mall/payments/customer", storefrontCode, data: { receivableId } });
  if (!result || result.state !== "AVAILABLE" || !Array.isArray(result.items)) throw new Error("PAYMENT_OPTIONS_INVALID");
  const reasons = { COUPON_MARGIN_GUARD_BLOCKED: "当前订单不满足优惠使用条件", PAYMENT_ZERO_AMOUNT_UNSUPPORTED: "优惠后金额不满足当前付款要求", PAYMENT_COUPON_RESERVED: "已被另一笔付款占用", PAYMENT_COUPON_EXPIRED: "优惠券已过期", PAYMENT_COUPON_NOT_AVAILABLE: "优惠券当前不可使用", COUPON_DISABLED: "当前暂不支持优惠券", PAYMENT_COUPON_AUDIENCE_NOT_ELIGIBLE: "不符合优惠券适用客户条件", PAYMENT_COUPON_CAMPAIGN_STACK_DISABLED: "不可与本单活动叠加", PAYMENT_COUPON_CAMPAIGN_STACK_NOT_EXPLICITLY_ALLOWED: "本单活动未允许叠加此券", PAYMENT_COUPON_NO_MARKETING_ELIGIBLE_AMOUNT: "本单没有符合用券范围的商品金额", PAYMENT_COUPON_INVALID_BENEFIT: "优惠规则暂不可用", PAYMENT_COUPON_MARGIN_FLOOR_VIOLATION: "当前订单不满足优惠使用条件", PAYMENT_COUPON_THRESHOLD_NOT_MET: "实际履约金额未达到使用门槛", PAYMENT_COUPON_NOT_IN_VALID_WINDOW: "不在有效期内", PAYMENT_COUPON_CAMPAIGN_TRACEABILITY_GAP: "暂无法核实活动适用条件", PAYMENT_COUPON_TRACEABILITY_GAP: "暂无法核实实际履约信息" };
  return { state: "READY", capabilities: { prepaidBalance: result.capabilities?.prepaidBalance === true, wechatPay: result.capabilities?.wechatPay === true }, items: result.items.map(item => ({ id: item.id, name: item.name, eligible: item.eligible === true, thresholdText: money(item.thresholdAmount) ? "适用商品满 ¥" + item.thresholdAmount + " 可用" : "门槛暂未核实", validFromText: formatServerDateTime(item.validFrom), validToText: formatServerDateTime(item.validTo), discountAmount: money(item.discountAmount) ? item.discountAmount : null, reason: item.eligible ? "" : reasons[item.reason] || "暂不适用" })) };
}
async function quoteWaitingPayment(storefrontCode, input) { return request({ path: "/api/mall/payments/customer", method: "POST", storefrontCode, data: { action: "quote", receivableId: input.receivableId, customerCouponId: input.customerCouponId || null, method: input.method } }); }
async function submitWaitingPayment(storefrontCode, quoteId, idempotencyKey) { return request({ path: "/api/mall/payments/customer", method: "POST", storefrontCode, data: { action: "pay", quoteId, idempotencyKey } }); }
async function recoverWaitingPayment(storefrontCode, orderId, cancel = false) { return request({ path: "/api/mall/payments/customer", method: "POST", storefrontCode, data: { action: cancel ? "cancel" : "recover", orderId } }); }
async function getConfirmedOrderPayment(storefrontCode, orderId) {
  const result = await request({ path: "/api/mall/payments/customer", storefrontCode, data: { orderId } });
  const order = result && result.confirmedOrder;
  if (!result || result.ok !== true || !order || order.orderId !== orderId || order.paymentTiming !== "PAY_BEFORE_FULFILLMENT"
    || order.currencyCode !== "CNY" || !money(order.amount) || Number(order.amount) <= 0 || !order.amountSourceId
    || order.amountSourceVersion == null || order.orderRevision == null) throw new Error("CONFIRMED_ORDER_PAYMENT_INVALID");
  return { ...order, wechatAvailable: result.capabilities?.wechatPay === true };
}
async function prepareConfirmedOrderPay(storefrontCode, order, diagnosticMode) {
  return request({ path: "/api/mall/payments/customer", method: "POST", storefrontCode,
    data: { action: "prepare-confirmed-order-pay", orderId: order.orderId, amountSourceVersion: order.amountSourceVersion,
      idempotencyKey: `native:confirmed:${order.orderId}:${order.amountSourceVersion}`,
      ...(diagnosticMode === '044I_ONE_TIME' ? { diagnostic: diagnosticMode } : {}) } });
}
function validatePaymentQuote(result, orderId, customerCouponId, receivableId) {
  if (!result || result.state !== "QUOTED" || result.currencyCode !== "CNY" || result.orderId !== orderId || (result.customerCouponId || "") !== (customerCouponId || "")
    || typeof result.quoteId !== "string" || !result.quoteId || !money(result.finalAmount) || !money(result.discountAmount)
    || !money(result.originalAmount) || Number(result.finalAmount) <= 0
    || Math.round(Number(result.originalAmount) * 100) - Math.round(Number(result.discountAmount) * 100) !== Math.round(Number(result.finalAmount) * 100)
    || (customerCouponId ? Number(result.discountAmount) <= 0 : Number(result.discountAmount) !== 0)
    || typeof result.receivableId !== "string" || !result.receivableId || (receivableId && result.receivableId !== receivableId)
    || !money(result.prepaidBalance) || !["PREPAID_BALANCE", "WECHAT_PAY"].includes(result.method)
    || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error("PAYMENT_QUOTE_UNCONFIRMED");
  return { quoteId: result.quoteId, orderId, receivableId: result.receivableId, originalAmount: result.originalAmount, customerCouponId: customerCouponId || null, finalAmount: result.finalAmount, discountAmount: result.discountAmount, expiresAt: result.expiresAt, prepaidBalance: result.prepaidBalance, method: result.method };
}
function historyItem(item) {
  if (!item || typeof item.id !== "string" || !item.id || !money(item.amount) || !money(item.originalAmount) || !money(item.couponDiscountAmount)) throw new Error("PAYMENT_HISTORY_INVALID");
  const allocations = Array.isArray(item.allocations) ? item.allocations.map(row => {
    if (![row.grossAmount, row.discountAmount, row.netAmount, row.settledAmount].every(money)) throw new Error("PAYMENT_HISTORY_INVALID");
    return { receivableId: row.receivableId, orderNo: row.orderNo, grossAmount: row.grossAmount, discountAmount: row.discountAmount, netAmount: row.netAmount, settledAmount: row.settledAmount, status: row.status };
  }) : [];
  return { kind: item.kind === "BATCH" ? "BATCH" : "SINGLE", allocations, settledCount: allocations.filter(row => row.status === "SETTLED").length, id: item.id, merchantOrderNo: item.merchantOrderNo, amount: item.amount, originalAmount: item.originalAmount,
    couponDiscountAmount: item.couponDiscountAmount, method: item.method, methodText: item.methodText,
    status: item.status, statusText: item.statusText, paymentTimeText: formatServerDateTime(item.paymentTime),
    statusClass: item.status === "SUCCEEDED" ? "success" : ["CREATED", "PENDING", "PROCESSING"].includes(item.status) ? "pending" : "closed",
    order: item.order ? { id: item.order.id, orderNo: item.order.orderNo } : null,
    receivable: item.receivable ? { id: item.receivable.id, billNo: item.receivable.billNo } : null,
    receipt: item.receipt ? { billNo: item.receipt.billNo, status: item.receipt.status, amount: item.receipt.amount } : null };
}
async function getPaymentHistory(storefrontCode, page = 1, paymentId) {
  const result = await request({ path: "/api/mall/payments/history", storefrontCode, data: { page, pageSize: 20, paymentId: paymentId || undefined } });
  if (!result || result.ok !== true) throw new Error("PAYMENT_HISTORY_INVALID");
  if (paymentId) { const payment = historyItem(result.payment); if (payment.id !== paymentId) throw new Error("PAYMENT_HISTORY_INVALID"); return { payment }; }
  if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.page) || !Number.isSafeInteger(result.pageSize) || result.pageSize <= 0) throw new Error("PAYMENT_HISTORY_INVALID");
  return { items: result.items.map(historyItem), total: result.total, page: result.page, pageSize: result.pageSize };
}
module.exports = { getConfirmedOrderPayment, prepareConfirmedOrderPay, getWaitingPayments, getPaymentHistory, getPaymentCouponOptions, quoteWaitingPayment, validatePaymentQuote, submitWaitingPayment, recoverWaitingPayment, NOT_INTEGRATED };
