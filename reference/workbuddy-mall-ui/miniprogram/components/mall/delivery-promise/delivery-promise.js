const { request, createClientRequestId } = require("../../../utils/request");
Component({
  properties: { storefrontCode: String, orderId: String },
  data: { delivery: null, error: "", busy: false },
  observers: { "storefrontCode,orderId": function () { if(this._active) this.load(); } },
  lifetimes: { attached() { this._active=true; this._version=0; this.load(); }, detached() { this._active=false; this._version++; } },
  pageLifetimes: { show() { this._active=true; this.load(); }, hide() { this._active=false; this._version++; this.setData({delivery:null,error:""}); } },
  methods: {
    load() {
      const version=this._version=(this._version||0)+1;
      return request({path:"/api/mall/fulfillment",storefrontCode:this.data.storefrontCode,data:this.data.orderId?{orderId:this.data.orderId}:{}})
        .then(body=>{if(this._active&&version===this._version)this.setData({delivery:body.data,error:""});})
        .catch(()=>{if(this._active&&version===this._version)this.setData({delivery:null,error:""});});
    },
    apply() {
      if(this.data.busy||!this.data.orderId)return;
      wx.showModal({title:"申请加急配送",content:"业务员确认后扣减本月 1 次额度，申请提交时不扣次。",confirmText:"提交申请",success:result=>{
        if(!result.confirm||!this._active)return;
        this.setData({busy:true,error:""});
        request({path:"/api/mall/fulfillment",method:"POST",storefrontCode:this.data.storefrontCode,data:{orderId:this.data.orderId,reason:"客户申请加急配送",requestKey:createClientRequestId()}})
          .then(()=>this.load()).catch(()=>this.setData({error:"申请未完成，请刷新订单后重试"})).finally(()=>this.setData({busy:false}));
      }});
    }
  }
});
