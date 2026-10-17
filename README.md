# Rhine Music

Windows 音乐播放器，基于 RhineLabUI，提供 Future / Rhine 与 Punk / Audio Archive 两套主题、本地及在线专辑架、歌词、均衡器和原生音频输出。

音乐适配与维护：Copyright (c) 2026 RonaldDeng。上游：Copyright (c) 2026 LBEILC。

## 当前基线

日常开发使用本仓库的 `main`。两主题共用状态、目录、播放及三维渲染；本轮界面、歌词、控件和启动修复已由用户确认完成。下一步集中处理性能与新的统一入场。

- [当前状态](docs/PROJECT-STATUS.md)：已完成能力与源码地图。
- [优化基线](docs/OPTIMIZATION-BASELINE.md)：本轮交付、真实待办、测量与回归要求。
- [本地开发](docs/LOCAL-DEVELOPMENT.md)：构建、启动、工具及数据位置。
- [文档索引](docs/README.md)：当前产品与技术规范。

`package.json` 的版本仍为 `0.3.1-preview.1`；此前品尝版安装器是独立交付快照，不代表当前源码。安装、数据和卸载规则见[品尝版说明](docs/PREVIEW-RELEASE.md)。

## 源码运行

在已有依赖与桌面工具的项目环境中执行：

```powershell
node scripts/build-source-preview.mjs --interface-only
.\启动源码验证.cmd
```

界面输出到 `.tools/source-preview-interface`。修改宿主、预加载层、服务或原生组件后，按[本地开发](docs/LOCAL-DEVELOPMENT.md)构建并完整退出、重新启动。普通入口不会自动安装依赖、下载组件或扫描音乐库。

新克隆不含 `node_modules/`、`.tools/` 或个人数据；环境准备须先获用户授权，见[贡献说明](CONTRIBUTING.md)。

## 仓库结构

| 目录 | 职责 |
| --- | --- |
| `src/` | 界面、公共状态、目录、三维场景、主题与交互 |
| `desktop/` | Electron 宿主、预加载层、窗口与隔离检查 |
| `scripts/` | 本地服务、构建、导出与验证 |
| `native/`、`vendor/` | 原生音频代码、第三方组件及许可 |
| `public/`、`art/`、`content/` | 运行资源、模型、建模与内容资料 |
| `windows/`、`.github/` | Windows 包装与仓库工作流 |
| `docs/` | 当前规范、操作和优化基线 |

本机依赖、工具、构建、日志和个人配置留在忽略目录，不进入源码交付。旧实现和修复报告从 Git 按需追溯，不再作为当前入口。

## 许可

有权授权的应用代码、建模脚本和技术文档沿用 [MIT License](LICENSE)，保留上游与适配者署名。模型、字体、原作视觉、音频、Sony 及其他依赖按各自权利处理，详见 [NOTICE](NOTICE.md)；[上游原说明](README.original.md)保留原始语境。
