# 开发与提交

这是开发中的品尝版，当前进度及四阶段边界见 [PROJECT-STATUS](docs/PROJECT-STATUS.md) 和 [统一架构方案](docs/UNIFIED-ARCHITECTURE.md)。第二阶段已于2026-10-15获用户验收通过；第三阶段按用户要求暂不推进，第四阶段未开始。

使用 Node.js 22.12 以上。新克隆不会包含本机忽略目录中的 `node_modules` 或 `.tools`。先审阅所需依赖、Electron和原生桌面组件，并按用户授权准备；获准后才在项目内执行 `npm ci`，不安装全局依赖。随后可运行 `npm test` 和 `npm run build:preview`。默认测试不访问个人曲库、网络服务或真实音频设备。普通启动和品尝版打包不会自动安装依赖或下载工具，详见[本地开发](docs/LOCAL-DEVELOPMENT.md)。

本仓库是唯一的本地开发与GitHub发布仓库，日常改动直接在这里提交，无需维护或同步第二份源码。main的干净基线为 `167d140`（4062个源码文件）；此前主线保留在本地历史分支 `archive/pre-github-main-2026-10-15`，旧 `local/development` 停在 `052bf9a`，原有标签也保留。这些历史引用不随发布推送。

GitHub远程由用户自行设置。在自己的GitHub账号创建空仓库后，在本项目目录执行下列命令（替换示例地址；这些命令不会由助手自动执行）：

```powershell
git remote set-url origin https://github.com/YOUR-ACCOUNT/YOUR-REPO.git
git push -u origin main
```

当前本机已有origin；新环境若没有origin，用 `git remote add origin <地址>`。只推main，不推历史分支或标签，不使用 `git push --all`、`--mirror` 或强推，也不把旧历史分支直接合并回main。旧历史中的大资源使用LFS；新main不跟踪旧依赖、构建产物或机器记录。必要大资源按[GitHub大文件说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)管理，安装包放发布附件。

`npm run export:source` 可选生成用于交付的源码ZIP；它不初始化第二个Git仓库，也不用于GitHub同步。提交源代码、锁文件、必要资源及文档，不提交依赖、构建产物、工具、个人配置或曲库缓存。功能变更同时更新当前状态；历史验收记录保留。报告问题请包含版本、主题、布局、画质、重现步骤和实际现象，避免附带凭据或私人曲库路径。
