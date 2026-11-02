const { request, prepareWechatLoginWithPrivacy } = require('../../utils/request');
const diagnostics = require('../../utils/wechat-payment-diagnostics');
Page({
  data: { state: 'LOADING', order: null, busy: false, recovering: false, message: '' },
  onLoad(query) { this.token = String((query || {}).token || ''); },
  onShow() { this.visible = true; return this.refresh(); },
  onHide() { this.visible = false; this.generation = (this.generation || 0) + 1; this.setData({ state: 'LOADING', order: null }); },
  onUnload() { this.onHide(); this.token = ''; },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  call(action) { return request({ path: '/api/mall/payments/invitation', storefrontCode: 'zhenshang',
    method: action ? 'POST' : 'GET', data: { token: this.token, ...(action ? { action } : {}) } }); },
  async refresh() {
    if (!this.visible) return;
    const generation = this.generation = (this.generation || 0) + 1;
    this.setData({ state: 'LOADING', order: null, message: this.data.recovering ? this.data.message : '' });
    if (!this.token) {
      this.setData({ state: 'INVALID_ENTRY', message: '付款邀请入口不完整，请从业务员分享的正式邀请重新进入。' });
      return;
    }
    try {
      const result = await this.call();
      if (!this.visible || generation !== this.generation) return;
      this.setData({ state: result.state, order: result.state === 'PAYABLE' ? result : null,
        ...(result.state === 'PAID' ? { recovering: false, message: '' } : {}) });
    } catch (error) {
      if (this.visible && generation === this.generation) this.setData({ state: 'ERROR', order: null,
        message: error && /^PAYMENT_INVITATION_/.test(error.code || '')
          ? '邀请或订单当前不可付款，请联系业务员核实。'
          : '付款邀请暂时无法核验，请检查网络后重试。' });
    }
  },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }); },
  async login() {
    if (this.data.busy) return; this.setData({ busy: true });
    try { await prepareWechatLoginWithPrivacy('zhenshang'); await this.refresh(); }
    catch (_) { if (this.visible) this.setData({ message: '请完成微信登录后重试。' }); }
    finally { this.setData({ busy: false }); }
  },
  async recover() {
    if (this.data.busy) return; this.setData({ busy: true });
    try {
      const result = await this.call('RECOVER');
      if (this.visible) this.setData({ recovering: !['PAID', 'CLOSED', 'FAILED'].includes(result.state),
        message: result.state === 'PAID' ? '' : '尚未确认到账，请勿重复支付，可稍后再核实。' });
      await this.refresh();
    } catch (_) { if (this.visible) this.setData({ message: '结果暂未核实，请稍后重试或联系业务员，勿重复支付。' }); }
    finally { this.setData({ busy: false }); }
  },
  async pay() {
    if (!this.visible || this.data.busy || this.data.recovering || !this.data.order || !this.data.order.wechatPay) return;
    if (diagnostics.isRestricted(wx)) { this.setData({ message: '微信支付当前受平台限制，请联系业务员核实。' }); return; }
    this.setData({ busy: true, message: '' });
    const order = this.data.order;
    try {
      const consent = await new Promise(resolve => wx.showModal({ title: `确认代付 ¥${order.amount}`,
        content: `订单 ${order.orderNo}，款项归属该订单客户。`, success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (!consent || !this.visible || this.data.order !== order) return;
      this.setData({ recovering: true });
      const prepared = await this.call('PAY');
      if (prepared.clientPayment) await diagnostics.invoke(wx, prepared);
      // Native success is not a funds fact. Reconcile through the existing server/provider owner.
      const result = await this.call('RECOVER');
      if (this.visible) this.setData({ recovering: result.state !== 'PAID', message: result.state === 'PAID' ? '' : '正在核实付款，请勿重复支付。' });
      await this.refresh();
    } catch (_) { if (this.visible) this.setData({ message: '付款未确认，请核实结果后再操作。' }); }
    finally { this.setData({ busy: false }); }
  },
  onShareAppMessage() {
    const amount = this.data.state === 'PAYABLE' && this.data.order && this.data.order.amount;
    return { title: `邀请您对全渠供订单进行付款${amount ? ` · ¥${amount}` : ''}`, path: `/pages/payments/invite?token=${encodeURIComponent(this.token)}` };
  },
});
