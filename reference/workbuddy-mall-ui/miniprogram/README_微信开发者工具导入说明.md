# MALL_104 微信原生商城开发与验收

## 正式工程

仅打开 `D:\ERP\worktrees\MALL_104_NATIVE_CUSTOMER_MALL\miniprogram`。

`project.config.json` 的 `miniprogramRoot` 为 `.`，表示当前目录；MALL_104 在 Stable 2.01.2510290 中发现 `./` 会触发工程解析及编译器 undefined path 错误。工程名称为 `MALL-104-CUSTOMER-NATIVE`。AppID 仅作为公开客户端标识；不得写入 AppSecret。

## 运行环境

以 `config/runtime.js` 为唯一环境映射：开发版和体验版访问 `https://mall-acceptance.wzzhenshang.com/__mall060`；正式版映射生产地址。本轮只运行开发版，禁止上传、审核、发布和真钱。不可将旧说明中的生产地址当作开发地址，不得启用本地身份或业务数据模拟以替代验收。

## 编译与证据

1. CLI：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`。
2. 执行 `open --project <上述正式工程目录>`，确认目录及项目名称。
3. 工具菜单 → 编译（Ctrl+B）；保留 Console 和 Network 的实际结果。
4. Owner 于 2026-10-05 将最低兼容目标确定为 3.5.8；3.5.5 仅为历史配置。必须实际用 3.5.8 编译并核对 DevTools Console / SDKVersion，同时保留已有 3.17.3 运行证据。不能仅依据配置文件宣称有效版本，不能以 3.17.3 单独替代最低兼容门禁。
5. 保持合法域名、TLS 与 HTTPS 证书校验开启。
6. 原生路由验收可使用微信官方 `miniprogram-automator` 连接同一正式工程，截图仍属于 DevTools 模拟器证据，不属于真机证据。

## 身份与业务边界

正常 `wx.login` → 服务端微信登录 → OpenID/Customer Binding → Tenant/Storefront/Membership/Customer 核验。禁止伪造 Cookie、注入 Customer ID、使用 ADMIN 冒充客户。历史 APPROVED binding 不证明当前微信登录可用。

Allowed / Denied / Guest 必须分别使用获准 NONPROD 身份或正式退出登录流程验收 Published Homepage Scope。服务失败截图只证明错误态，不能证明 Scope 通过。

首页 C14–C17 保持 FUTURE_HIDDEN；已存在的预付款底层能力保持。ERP 订单完成归属 FORMAL_ERP_POSTING；微信交易收货确认只是结算适配。Native 页面调整不修改 PaymentIntent、Receipt、Allocation、Ledger、Refund Hold 或微信支付核心。

Native UI checkpoint 不等于 Final Native Device Candidate。最终仍需正式上游 Consumer、合法客户身份、体验版与物理设备证据。
