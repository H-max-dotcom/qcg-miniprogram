const { request, formatServerDateTime } = require('../../utils/request');
const { resolveStorefrontEntrance } = require('../../utils/storefront');
Page({
  data: { storefrontCode: 'zhenshang', period: 'all', periods: [{id:'today',name:'今天'},{id:'yesterday',name:'昨天'},{id:'week',name:'本周'},{id:'month',name:'本月'},{id:'year',name:'今年'},{id:'custom',name:'自定义'},{id:'all',name:'全部'}], dateFrom:'',dateTo:'',draftDateFrom:'',draftDateTo:'',customEditing:false,dateError:'',state:'LOADING', items:[], selectedIds:[], totalCount:null, totalAmount:null, page:1, hasMore:false },
  onLoad(query) { this._collectionToken=query&&query.collectionToken||""; this.setData({storefrontCode:resolveStorefrontEntrance(query || {}).storefrontCode}); },
  onShow() { this._visible=true; return this.refresh(); },
  onHide() { this.clearSelectionQuote(); this._visible=false; this._version=(this._version||0)+1; this.setData({items:[],selectedIds:[],totalCount:null,totalAmount:null,state:'LOADING'}); },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { return this.refresh().finally(()=>wx.stopPullDownRefresh()); },
  clearSelectionQuote() {
    this._selectionVersion=(this._selectionVersion||0)+1;
    this.setData({selectionQuote:null,selectionQuoteState:'EMPTY'});
  },
  async refreshSelectionQuote() {
    const ids=this.data.selectedIds.slice();
    const version=this._selectionVersion=(this._selectionVersion||0)+1;
    const pageVersion=this._version;
    this.setData({selectionQuote:null,selectionQuoteState:ids.length?'LOADING':'EMPTY'});
    if(!ids.length)return;
    try {
      const quote=await request({path:'/api/mall/payments/batch',method:'POST',storefrontCode:this.data.storefrontCode,data:{action:'quote',receivableIds:ids,selectedCouponByReceivable:{},method:'PREPAID_BALANCE'}});
      if(!this._visible||pageVersion!==this._version||version!==this._selectionVersion)return;
      const validAmount=value=>typeof value==='string'&&/^\d+(\.\d{1,2})?$/.test(value);
      if(!quote||!quote.quoteId||!quote.version||!Array.isArray(quote.items)||quote.items.length!==ids.length||new Set(quote.items.map(item=>item.receivableId)).size!==ids.length||quote.items.some(item=>!ids.includes(item.receivableId))||![quote.grossAmount,quote.discountAmount,quote.netAmount].every(validAmount)||!Number.isFinite(Date.parse(quote.expiresAt))||Date.parse(quote.expiresAt)<=Date.now())throw new Error('INVALID_QUOTE');
      this.setData({selectionQuote:{grossAmount:quote.grossAmount,discountAmount:quote.discountAmount,netAmount:quote.netAmount},selectionQuoteState:'READY'});
    } catch(_) {
      if(this._visible&&pageVersion===this._version&&version===this._selectionVersion)this.setData({selectionQuote:null,selectionQuoteState:'ERROR'});
    }
  },
  async refresh() {
    this.clearSelectionQuote();
    const version=this._version=(this._version||0)+1;
    this.setData({state:'LOADING',items:[],selectedIds:[],totalCount:null,totalAmount:null,collectionMessage:"",collectionReady:false});
    try {
      if(this._collectionToken){
        try { const context=await request({path:'/api/mall/collections',storefrontCode:this.data.storefrontCode,data:{token:this._collectionToken}});
          if(!this._visible||version!==this._version)return;
          if(!context || !Array.isArray(context.receivableIds) || !context.receivableIds.length || context.receivableIds.some(id=>typeof id!=='string') || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt)<=Date.now())throw new Error('INVALID');
          this._collectionIds=context.receivableIds;
          this.setData({collectionReady:true,collectionMessage:context.selectionChanged?'本次结款范围已变化，请重新核对明细':'已核实本次结款范围，请核对后付款'});
        } catch(error) { if(error&&(error.status===401||error.code==='NEED_LOGIN'))throw error;
          this._collectionIds=null;this._collectionToken='';this.setData({collectionReady:false,collectionMessage:'此付款入口已失效或不属于当前客户，以下为您的待付款记录'});
        }
      }
      const result=await request({path:'/api/mall/receivables' ,storefrontCode:this.data.storefrontCode,data:{period:this.data.period,...(this.data.period==='custom'?{dateFrom:this.data.dateFrom,dateTo:this.data.dateTo}:{}),page:this.data.page,pageSize:20}});
      if (!this._visible || version!==this._version) return;
      if (!result || result.state!=='OPEN_RECEIVABLES' || !Array.isArray(result.items)) throw new Error('UNAVAILABLE');
      this.setData({state:'READY',items:result.items.map(item=>({...item,occurredAtText:formatServerDateTime(item.occurredAt),deliveredAtText:item.deliveredAt?formatServerDateTime(item.deliveredAt):"暂无签收时间",paymentStatusText:({CREATED:"付款处理中",PENDING:"付款处理中",SUCCEEDED:"已付款，核销待核实",FAILED:"支付失败",CANCELLED:"支付已取消",UNPAID:"待付款"})[item.paymentStatus]||"待付款",selected:false})),totalCount:result.totalCount,totalAmount:result.totalAmount,summary:result.summary,hasMore:result.page*result.pageSize<result.totalCount});
    } catch(error) { if(this._visible && version===this._version) this.setData({state:error && (error.status===401 || error.code==='NEED_LOGIN')?'LOGIN':'ERROR'}); }
  },
  changePeriod(event) {
    const period=event.currentTarget.dataset.id;
    if(!this.data.periods.some(item=>item.id===period))return;
    if(period==='custom'){this.setData({customEditing:true,draftDateFrom:this.data.dateFrom,draftDateTo:this.data.dateTo,dateError:''});return;}
    this.setData({period,page:1,dateFrom:'',dateTo:'',customEditing:false,dateError:''}); return this.refresh();
  },
  pickDate(event){const field=event.currentTarget.dataset.field;if(!['draftDateFrom','draftDateTo'].includes(field))return;this.setData({[field]:event.detail.value,dateError:''});},
  applyDates(){
    const dateFrom=this.data.draftDateFrom,dateTo=this.data.draftDateTo;
    if(!dateFrom||!dateTo||dateFrom>dateTo){this.setData({dateError:'请选择开始和结束日期，结束日期不能早于开始日期'});return;}
    this.setData({period:'custom',dateFrom,dateTo,page:1,customEditing:false,dateError:''});return this.refresh();
  },
  previous() { if(this.data.page>1) { this.setData({page:this.data.page-1}); return this.refresh(); } },
  next() { if(this.data.hasMore) { this.setData({page:this.data.page+1}); return this.refresh(); } },
  toggle(event) { const id=event.currentTarget.dataset.id; const item=this.data.items.find(row=>row.receivableId===id); if(!item || !item.eligible || this.data.state!=='READY') return; const selectedIds=this.data.selectedIds.includes(id)?this.data.selectedIds.filter(value=>value!==id):this.data.selectedIds.concat(id); this.setData({selectedIds,items:this.data.items.map(row=>({...row,selected:selectedIds.includes(row.receivableId)}))}); return this.refreshSelectionQuote(); },
  login(){wx.navigateTo({url:'/pages/me/me?storefrontCode='+encodeURIComponent(this.data.storefrontCode)});},
  confirmCollection(){if(this.data.collectionReady&&this._collectionIds&&this.data.state==='READY')wx.navigateTo({url:'/pages/payments/batch?storefrontCode='+encodeURIComponent(this.data.storefrontCode)+'&receivableIds='+encodeURIComponent(JSON.stringify(this._collectionIds))});},
  history() { wx.navigateTo({url:'/pages/payments/payment?mode=history&storefrontCode='+encodeURIComponent(this.data.storefrontCode)}); },
  confirm(event) { if(this.data.state!=='READY') return; const selection=event.currentTarget.dataset.selection; if(!selection && !this.data.selectedIds.length) return;
    if (!selection && this.data.selectedIds.length === 1) {
      const item = this.data.items.find(row => row.receivableId === this.data.selectedIds[0] && row.eligible);
      if (item && item.orderId) return wx.navigateTo({url:'/pages/payments/payment?storefrontCode='+encodeURIComponent(this.data.storefrontCode)+'&orderId='+encodeURIComponent(item.orderId)});
    }
    const query=selection?'selection='+selection:'receivableIds='+encodeURIComponent(JSON.stringify(this.data.selectedIds)); wx.navigateTo({url:'/pages/payments/batch?storefrontCode='+encodeURIComponent(this.data.storefrontCode)+'&'+query}); }
});
