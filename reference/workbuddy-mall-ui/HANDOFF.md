# 黄佳琪首次交接操作说明

## 基准与软件

源码来自 `42150e7caa64c15869c1b64bf141965ffdfe7deb`；miniprogram tree 为 `bf27fbe74ad6b2577aa9ad547a58cc706af4ef64`。179个源文件按提交原样导出，无ERP历史与未提交改动；本仓库额外加入交接文档和忽略规则。

需要微信开发者工具、CodeBuddy、选择 Git 协作时使用的 Git；项目没有固定后两者版本，请记录实际版本。基础库最低兼容目标为3.5.8，必须实际编译并记录 SDKVersion，不仅查看配置。源说明记录过 Stable 2.01.2510290 的工程解析问题与 `miniprogramRoot: "."` 约定；这属于历史记录，不代表已经在你电脑验证。

原生客户端不需要 Node/npm、PostgreSQL 或 Docker。后端由维护者提供，不能让新人拿整个 ERP 或生产配置来补缺口。

## 完整项目与首页依赖

- 首页：`pages/index/index` 的 JS/WXML/WXSS/JSON，位于 miniprogram 下。
- 组件：delivery-promise、campaign-return、mall-cart-entry、marketing-banner、marketing-quick-entry。
- 工具：utils/request.js、cart.js、storefront.js；app.js 还依赖邀请工具。
- 配置：config/runtime.js、mall055-local.js；本地055开关保持 false。
- 资源：assets/product-placeholder.png，其他商品、分类和活动图片多数来自后端。
- 保留全部23个注册页面及其他项目文件，不能只下载首页4个文件。旧页面/旧utils/api.js不作为当前首页环境配置入口。

首页依赖 `/api/mall/home`、campaigns及详情、fulfillment、receivables；身份联调还需 wechat-login、me。断网只能验证静态布局、加载和错误态，不能证明真实商品/客户首页通过。

## 环境和权限

develop 与 trial：`https://mall-acceptance.wzzhenshang.com/__mall060`；release：生产地址。只运行普通开发编译，禁止上传微信开发版、体验版、审核和发布；源代码上传GitHub不构成这些操作的授权。

维护者还须提供/确认：隔离接口当前可用性、合法request与图片域名、最小获准的测试商品和活动数据、微信开发权限，以及需要客户态时的合法隔离微信身份/客户绑定。AppID是公开标识，AppSecret只留在服务端。不得复制ERP管理员Cookie、伪造openid或注入customerId。

## 首次验收记录

1. 源提交/本仓库提交：________；工作区未修改：________。
2. 时间、DevTools、CodeBuddy、基础库及SDKVersion：________。
3. 未修改首页截图、Console错误、Network目标与失败请求：________。
4. 首页/分类/商品入口；游客、空态、图片失败、窄屏、长商品名、下拉刷新与返回首页：________。
5. 已有错误、接口/权限阻断：________。错误态记录不能标作正常首页验收。
6. 维护者确认基准可以正常预览：________。此后再确认首页视觉方案和可改文件。

首次验收不提交订单、不支付、不申请加急、不操作ERP数据。需要真实客户态必须另有合法隔离身份；暂缺就如实标为待验收。

静态交接检查：41个JSON可解析；23个注册页的JS/WXML/WXSS存在；相对require和组件入口可解析，没有外部npm require；campaign-return未带独立WXSS，实际以DevTools编译复核。未执行本次DevTools编译或真机验收。

## 分支、审核与回退

使用 `huangjiaqi/mall-home-ui` 独立分支。确认任务后仅改批准文件；提交/推送需维护者授权，通过PR审核，检查页面前后对比与相关组件回归。维护者再把审核后的最小补丁应用回ERP隔离工作区，不整分支合并整个后台。

回退前保存当前diff/未提交工作。已提交变更通过审核后的revert回退指定提交；不reset --hard或clean。保留原基准副本和截图。源码修改没有发布，不操作线上环境。

## 不交付的内容

ERP后端、数据库与备份、.env、AppSecret、支付/发布凭据、个人project.private.config.json和开发者工具Storage。源码包含支付相关页面不等于授予支付权限；正式runtime配置保留源提交内容，不运行release。
