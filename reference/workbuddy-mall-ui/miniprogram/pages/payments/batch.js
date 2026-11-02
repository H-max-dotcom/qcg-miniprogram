const { request } = require('../../utils/request');
const { getPaymentCouponOptions } = require('../../utils/payment-read-adapter');
const { resolveStorefrontEntrance } = require('../../utils/storefront');
Page({
 data:{storefrontCode:'zhenshang',state:'LOADING',quote:null,items:[],selectedCouponByReceivable:{},coupons:[],couponReceivableId:'',paying:false,error:'',insufficient:false,invalidEntry:false},
 onLoad(query) {
  this.setData({storefrontCode:resolveStorefrontEntrance(query||{}).storefrontCode});
  try { this._selection=query.selection==='today'||query.selection==='all'?query.selection:null; this._ids=this._selection?null:JSON.parse(decodeURIComponent(query.receivableIds||'[]')); if(!this._selection&&(!Array.isArray(this._ids)||!this._ids.length||this._ids.some(id=>typeof id!=='string'))) throw new Error(); }
  catch(_){this._invalid=true;this.setData({state:'ERROR',invalidEntry:true,error:'结款范围无效，请返回重新选择'});}
 },
 onShow(){this._visible=true;if(!this._invalid&&!this._paymentActive)return this.refresh();},
 onHide(){this._visible=false;this._version=(this._version||0)+1;this.setData({coupons:[],couponReceivableId:''});},
 onUnload(){this.onHide();},
 goBack(){wx.navigateBack({fail:()=>wx.reLaunch({url:'/pages/receivables/center'})});},
 async refresh(){
  if(this._paymentActive||this._invalid)return;const version=this._version=(this._version||0)+1;
  this.setData({state:'LOADING',quote:null,items:[],error:'',coupons:[],couponReceivableId:''});
  try{const quote=await request({path:'/api/mall/payments/batch',method:'POST',storefrontCode:this.data.storefrontCode,data:{action:'quote',...(this._selection?{selection:this._selection}:{receivableIds:this._ids}),selectedCouponByReceivable:this.data.selectedCouponByReceivable,method:'PREPAID_BALANCE'}});
   if(!this._visible||version!==this._version)return;
   const validAmount=value=>typeof value==='string'&&/^\d+(\.\d{1,2})?$/.test(value);
   if(!quote||!quote.quoteId||!quote.version||!Array.isArray(quote.items)||!quote.items.length||![quote.grossAmount,quote.discountAmount,quote.netAmount,quote.prepaidBalance].every(validAmount)||!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=Date.now())throw new Error('报价信息暂不可用');
   this.setData({state:'READY',quote,items:quote.items,insufficient:Number(quote.prepaidBalance)<Number(quote.netAmount)});
  }catch(error){if(this._visible&&version===this._version)this.setData({state:'ERROR',error:'结款信息已变化或暂不可用，请返回核对后重试'});}
 },
 async openCoupons(event){if(this.data.paying||this.data.state!=='READY')return;const id=event.currentTarget.dataset.id;if(!this.data.items.some(item=>item.receivableId===id))return;const version=this._version;this.setData({couponReceivableId:id,coupons:[],couponLoading:true,couponError:''});try{const result=await getPaymentCouponOptions(this.data.storefrontCode,id);if(this._visible&&version===this._version&&this.data.couponReceivableId===id)this.setData({coupons:result.items,couponLoading:false});}catch(_){if(this._visible&&version===this._version)this.setData({couponLoading:false,couponError:'优惠券暂不可用，请稍后重试'});}},
 chooseCoupon(event){if(this.data.paying||this.data.couponLoading)return;const id=event.currentTarget.dataset.id||'',receivableId=this.data.couponReceivableId;if(!receivableId||id&&!this.data.coupons.some(item=>item.id===id&&item.eligible))return;const choices={...this.data.selectedCouponByReceivable,[receivableId]:id||null};this.setData({selectedCouponByReceivable:choices,couponReceivableId:'',coupons:[]});return this.refresh();},
 closeCoupons(){this.setData({couponReceivableId:'',coupons:[]});},
 confirmPayment(){
  const quote=this.data.quote;if(this.data.state!=='READY'||this.data.paying||this._paymentActive||this.data.insufficient||!quote||!quote.capabilities||quote.capabilities.prepaidBalance!==true)return;
  if(Date.parse(quote.expiresAt)<=Date.now()){this.setData({state:'STALE',error:'报价已过期，请重新核对结款金额'});return;}
  wx.showModal({title:'确认结款',content:'共 '+quote.items.length+' 笔，将从预付款账户扣除 ¥'+quote.netAmount,confirmText:'确认付款',success:result=>{if(result.confirm&&this._visible&&this.data.quote===quote)return this.payQuote(quote);}});
 },
 async payQuote(quote){
  if(this._paymentActive)return;this._paymentActive=true;this.setData({paying:true,error:''});
  try{const result=await request({path:'/api/mall/payments/batch',method:'POST',storefrontCode:this.data.storefrontCode,data:{action:'pay',quoteId:quote.quoteId,version:quote.version,idempotencyKey:'batch:'+quote.quoteId}});
   if(result.state!=='SUCCEEDED'||!result.paymentId){this.setData({error:'付款结果尚待确认，请保留当前页面重试查询'});return;}
   this.setData({state:'SUCCEEDED'});if(this._visible)wx.redirectTo({url:'/pages/payments/batch-history?storefrontCode='+encodeURIComponent(this.data.storefrontCode)+'&paymentId='+encodeURIComponent(result.paymentId)});
  }catch(error){const stale=['QUOTE_STALE','BATCH_QUOTE_STALE','BATCH_QUOTE_EXPIRED'].includes(error&&error.code);this.setData({state:stale?'STALE':'READY',error:stale?'部分待付款状态已变化，请重新确认金额。':'付款结果暂未确认，请重试；同一笔请求不会重复扣款'});}
  finally{this._paymentActive=false;this.setData({paying:false});}
 }
});
