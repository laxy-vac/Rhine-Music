# 美术源文件与运行资源

播放器运行时使用已经导出的模型和图像；日常启动不需要 Blender。源工程和生成脚本集中在 art/，运行资源位于 public/assets/ 与 src/assets/style/。

| 源文件/脚本 | 导出位置 | 用途 |
| --- | --- | --- |
| art/build_archive.py、art/rhine-archive.blend | public/assets/archive-cassette.glb | Rhine 盒体外壳与光学结构 |
| art/build_assembly.py、art/archive-assembly.blend | public/assets/archive-assembly.glb | 盒体拆解演示结构 |
| art/build_music_cd.py、art/music-cd.blend | public/assets/music-cd.glb；src/music-cd-asset.ts | 简约 CD 盒 |
| art/build_punk_reference_case.py、art/punk-reference-case.blend | public/assets/punk-reference-case.glb；src/punk-case-asset.ts | 根据主题参考图重建的 Punk 盒体 |
| art/build_style_player_rail.py、art/style-player-rail.blend | src/assets/style/camera-player/rail/ | 低视角播放器货架 |
| art/build_audio_tech_logos.py | public/audio-tech/*.svg | 从 art/ 中的标志源图描摹透明 SVG；需要已有 Pillow 环境 |

Blender 工程使用 Blender Python。普通 Blender 任务可从仓库根目录用已准备的 Blender 后台运行，例如：

```powershell
blender --background --python art/build_archive.py
blender --background --python art/build_assembly.py
blender --background --python art/build_music_cd.py
blender --background --python art/build_punk_reference_case.py
blender --factory-startup --background --python-exit-code 1 --python art/build_style_player_rail.py
```

最后一个脚本要求 Blender 3.6 系列。运行生成器会更新相应导出资源；模型更新还需保留脚本生成的版本模块，以便应用缓存识别资源变化。生成器不会随播放器启动自动运行，也不应为此说明安装 Blender 或 Python 依赖。

src/assets/style/case、rail、floor 与相关主题图像来自 RhinE 1.4.0 Audio Archive 资源包；配色 token 使用 [RhinE 仓库的固定提交](https://github.com/ericzhang12111-cell/RhinE/blob/cead785dc40b02ee1cb0ae2c2d9a4a3034a186d0/theme/tokens/tokens.json)。Audio Archive MIT 原文在 public/licenses/audio-archive-style-mit.txt，Geist Mono 单独使用 SIL Open Font License。没有复制 foobar2000 组件。具体来源与第三方权利见根目录 NOTICE.md 和对应许可证。

Punk GLB 是按已有主题参考图重建的项目模型，不是原作者发布的原始三维网格；无法从二维图像恢复的内侧、截面和材质数值属于估计。art/DSDlogo.svg、DSEE_LOGO.avif、Hi-Res_Audio_(logo).svg、S-MASTER.webp、vinyl.png 等原始标志和图像保留各自权利，不因建模脚本的 MIT 许可自动改授 MIT。
