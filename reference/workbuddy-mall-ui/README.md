# 全渠供商城小程序：首页源码交接

本仓库用于黄佳琪在自己电脑使用 CodeBuddy 修改商城首页，并在微信开发者工具预览。

这是从 ERP 确定提交提取的完整微信原生小程序，使用 JavaScript、WXML、WXSS、JSON；不含 ERP 后台、数据库、环境密钥或原仓库 Git 历史。源码基准不代表线上版本，也不代表已通过 Native 验收。

## 下载和首次运行

```powershell
git clone https://github.com/zrq8870-rgb/qcg-mall-home-ui.git
cd qcg-mall-home-ui
git switch -c huangjiaqi/mall-home-ui
```

私有仓库须先获得本人 GitHub 账号访问权限。也可以在 GitHub 的 Code → Download ZIP 下载，解压后再导入，但后续协作建议使用 Git。

1. CodeBuddy 打开仓库根目录，先读取 AGENTS.md 与 HANDOFF.md。
2. 微信开发者工具导入仓库中的 **miniprogram** 目录，不要导入仓库根目录。
3. 核对 AppID `wx9cb4a72f6ae06f6a`、基础库 `3.5.8`、首页 `pages/index/index`。使用自己的微信，开发权限由维护者安排。
4. 保持合法域名、TLS、HTTPS 证书校验开启。只用普通开发编译；没有获准的隔离接口和身份时，只记录真实错误，不连接生产补跑。
5. **先不改任何源码**，保存基准截图、Console、Network和工具版本。未修改首页正常预览后，才开始首页优化。

小程序没有 npm 安装或框架打包步骤；直接由微信开发者工具编译。不要安装整个 ERP 的依赖。

首页入口：`miniprogram/pages/index/index.{js,wxml,wxss,json}`。完整依赖、接口、验收与回退见 HANDOFF.md。

旧 miniprogram 内说明保留源提交原文，其作者机器绝对路径不适用于接收电脑；以本仓库相对路径和 HANDOFF.md 为导入依据。

## 当前限制

开发模式指向隔离验收接口，当前可用性与测试身份须维护者确认；正式版仍映射生产。本仓库上传是源码协作，不是小程序上传、审核或发布。不得使用生产数据、真实订单或资金验证。

源提交与逐文件校验：SOURCE_BASELINE.md、SOURCE_SHA256.txt。
