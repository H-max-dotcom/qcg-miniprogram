# CodeBuddy / Codex / 其他编码助手协作规则

先读 README.md、HANDOFF.md、SOURCE_BASELINE.md，再检查 git status。保留既有未提交工作，不 reset --hard、不 clean、不整分支覆盖、不重构整个工程。

## 当前任务

先在未修改源码上完成微信开发者工具基准预览。未经确认首页优化的具体方案和可改文件清单，不开始页面修改。

- 这是微信原生项目，使用 Page/Component + setData；不转换为 React、Taro 或 uni-app，不生成替代 HTML 来声称 Native 验收。
- 后续默认只改已批准的首页 WXML/WXSS；JS/JSON、共享组件和资源如需改动，先明确任务范围。共享组件需回归其引用页面。
- 不修改 utils/request.js、config、身份/价格/库存/订单/支付/权限逻辑；不向客户端写入 AppSecret、令牌、Cookie 或真实客户资料。
- 保留加载、游客、错误、空态、价格不可见状态和 ProductUnit 规格语义；不伪造数据或身份使验收通过。
- 仅访问获准的隔离环境，合法域名/TLS/证书校验保持开启。遇生产请求停止联网核对；不得通过关闭校验绕过问题。
- 首轮禁止提交订单、申请加急、支付、ERP 写入；不能因为源码包含相应页面就操作它们。
- 不自行 commit、push、merge、改仓库权限或部署；每类操作须有维护者/用户明确授权。不要用 git add . 或 git add -A。
- 不上传开发者工具私有配置、Storage、日志中的凭据或真实业务截图。新增文件先检查敏感内容。
- 页面验收须保留真实 DevTools 截图、Console/Network。静态检查、HTML、构建通过均不能替代原生预览或真机验收。

独立分支开发，提交后通过 PR 由维护者审核。仓库 main 是交接基准，不直接在 main 修改。未发布不需要操作线上回滚。
