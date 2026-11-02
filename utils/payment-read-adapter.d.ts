export type WaitingPaymentItem = {
  orderId: string; orderNo: string; amount: string; receivableId: string;
  finalizedAt: string; deliveredAt: string | null; deliveredAtText: string;
};
export type WaitingPaymentRead =
  | { state: "NOT_INTEGRATED"; items: []; totalCount: null; totalAmount: null }
  | { state: "WAITING_PAYMENT"; items: WaitingPaymentItem[]; totalCount: number; totalAmount: string; page: number; pageSize: number };
/** 024B UI seam, NOT an already deployed payment endpoint. */
export type PaymentCouponOptions =
  | { state: "NOT_INTEGRATED"; items: [] }
  | { state: "READY"; items: { id: string; name: string; eligible: boolean; reason?: string }[] };
export type PaymentCouponQuoteRequest = { receivableId: string; customerCouponId: string | null; method: "PREPAID_BALANCE" | "WECHAT_PAY" };
/** Final integration must produce this from the locked delivery settlement owner. */
export type PaymentCouponQuote = {
  state: "QUOTED"; receivableId: string; originalAmount: string; quoteId: string; orderId: string; customerCouponId: string | null;
  currencyCode: "CNY"; finalAmount: string; discountAmount: string; expiresAt: string;
  prepaidBalance: string; method: "PREPAID_BALANCE" | "WECHAT_PAY";
};
export function getWaitingPayments(storefrontCode: string, orderId?: string, page?: number): Promise<WaitingPaymentRead>;
export function getPaymentCouponOptions(storefrontCode: string, orderId: string): Promise<PaymentCouponOptions>;
export function quoteWaitingPayment(storefrontCode: string, request: PaymentCouponQuoteRequest): Promise<PaymentCouponQuote>;
export function validatePaymentQuote(result: unknown, orderId: string, customerCouponId?: string | null, receivableId?: string): Omit<PaymentCouponQuote, "state" | "currencyCode">;
export function submitWaitingPayment(storefrontCode: string, quoteId: string, idempotencyKey: string): Promise<{ state: string; clientPayment?: unknown }>;
export function recoverWaitingPayment(storefrontCode: string, orderId: string, cancel?: boolean): Promise<{ state: string }>;

export function getPaymentHistory(storefrontCode: string, page?: number, paymentId?: string): Promise<{ payment?: Record<string, unknown>; items?: Record<string, unknown>[]; total?: number; page?: number; pageSize?: number }>;
