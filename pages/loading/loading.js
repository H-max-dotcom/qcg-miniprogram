const { request } = require("../../utils/request");

// 启动时探一次首页关键接口，用它决定加载圈什么时候停。
// 只关心成/败，不消费返回数据 —— 首页进来后还会自己再取一次。
const HOME_PROBE_PATH = "/api/mall/home";
// 兜底上限：请求超过 5 秒还没落地，就强制停圈并跳首页，避免用户一直卡在启动页。
const HOME_PROBE_TIMEOUT = 5000;
// 启动页最短展示时长。接口很快返回（尤其离线时 wx.request 会立刻 fail）时，
// 不加这个下限启动页会一闪而过，反而像闪屏；600ms 大约是一帧动画能看清的下限。
const MIN_SPLASH_DURATION = 600;

// 冷启动启动页（Splash）：全屏效果图 + Logo，
// 加载圈由真实请求状态驱动，请求一落地（成功 / 失败 / 超时兜底）立刻跳首页。
Page({
  data: {
    // 加载圈的唯一数据源：true 才渲染，false 时圈消失
    isLoading: true,
  },

  onLoad() {
    this._disposed = false;
    this._redirected = false;
    this._settled = false;
    this._startedAt = Date.now();
    this._redirectTimer = null;

    // 兜底：不管请求发生什么，5 秒一到就强制收尾
    this._timeoutTimer = setTimeout(() => {
      this.settleSplash();
    }, HOME_PROBE_TIMEOUT);

    // 请求开始（isLoading 初值 true，圈在转）→ 成功或失败都走同一个收尾函数
    this.probeHome().then(
      () => this.settleSplash(),
      () => this.settleSplash(),
    );
  },

  onShow() {
    // 加载中退到后台再回来：若已收尾但还没跳（跳转被后台状态拦下过），立刻补跳
    if (this._settled && !this._redirected) this.goToHome();
  },

  onHide() {
    // 只停「跳转定时器」：后台调用 reLaunch 可能被基础库拒绝，
    // 改由 onShow 补跳，避免退后台后回来永远停在启动页。
    if (this._redirectTimer) {
      clearTimeout(this._redirectTimer);
      this._redirectTimer = null;
    }
  },

  onUnload() {
    this._disposed = true;
    this.clearSplashTimers();
  },

  // 探一次真实接口：走项目统一的 request 封装（含 baseUrl 校验、会话 cookie、15s 默认超时）
  probeHome() {
    const app = getApp();
    const storefrontCode = (app && app.globalData && app.globalData.storefrontCode) || "";
    try {
      return request({
        path: HOME_PROBE_PATH,
        storefrontCode,
        // 让 wx.request 自身的超时与页面兜底在同一时刻生效
        timeoutMs: HOME_PROBE_TIMEOUT,
      });
    } catch (error) {
      // 运行环境配置缺失时 getApiBase 会同步抛错，这里降级成「请求失败」，同样立刻收尾
      return Promise.reject(error);
    }
  },

  // 请求落地（成功 / 失败 / 兜底超时）统一入口：先停圈，再排一次跳转
  settleSplash() {
    if (this._settled || this._disposed) return;
    this._settled = true;
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    // 圈立刻停：状态一改，WXML 里那个 wx:if 马上摘掉
    if (this.data.isLoading) this.setData({ isLoading: false });
    const elapsed = Date.now() - this._startedAt;
    this._redirectTimer = setTimeout(
      () => this.goToHome(),
      Math.max(0, MIN_SPLASH_DURATION - elapsed),
    );
  },

  clearSplashTimers() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    if (this._redirectTimer) {
      clearTimeout(this._redirectTimer);
      this._redirectTimer = null;
    }
  },

  goToHome() {
    if (this._disposed || this._redirected) return;
    // 先置位防重入（定时器和 onShow 可能同时触发）
    this._redirected = true;
    const app = getApp()
    const homePath = app.globalData && app.globalData.homePath
      ? app.globalData.homePath
      : '/pages/index/index'

    // 本项目未使用原生 tabBar（底部导航是页面内自定义组件 qcg-tabbar），
    // 调用 wx.switchTab 必然报 "page is not found in tabBar" 的路由错误，
    // 因此统一走 reLaunch；仅在其失败时降级 redirectTo。
    // 与项目其他页面跳转保持一致，透传门店编码
    const storefrontCode = app.globalData && app.globalData.storefrontCode
    const url = storefrontCode
      ? `${homePath}?storefrontCode=${encodeURIComponent(storefrontCode)}`
      : homePath

    // 两条路由都失败（例如在后台被基础库拒绝）时解除防重入，
    // 交给 onShow 补跳，避免停在启动页出不去
    const allowRetry = () => {
      this._redirected = false
    }

    wx.reLaunch({
      url,
      fail: () => {
        wx.redirectTo({ url, fail: allowRetry })
      }
    })
  }
})
