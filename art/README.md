# 当前模型与复现入口

更新：2026-10-14。正常播放不需要安装Blender；运行时模型在public/assets，原PNG在src/assets/style。权限/构建见 [本地开发](../docs/LOCAL-DEVELOPMENT.md)，精度/差异见 [状态](../docs/PROJECT-STATUS.md)。

## 三结构

| 结构 | 当前正式来源 | 说明 |
| --- | --- | --- |
| minimal | music-cd.blend / build_music_cd.py → public/assets/music-cd.glb | Future「简单粗糙」选项 |
| rhine | public/assets/archive-cassette.glb → src/rhine-case-model.ts / rhine-shell-geometry.ts | Future「精细」；原外壳适配盒内专辑，33,256三角形/13材质网格/10部件，另加纸卡与封面 |
| punk | build_punk_reference_case.py / punk-reference-case.blend → public/assets/punk-reference-case.glb | Future「Punk拓展」及Punk主题唯一结构；源PNG多视角重建，98,080三角形/15部件 |

同一母模用材质/部件变换区分外观，不为十颜色复制模型。精细盒体直接载入cassette后只选取外壳与装饰，保留其比例，不与assembly组合。archive-assembly保留为原上游拆解资产，不作为更多的可选盒体。

已核对RhineLabUI提交 `12cc5e4013acb9408f753ff71de6b8492299b7c8`：本地cassette的Git blob ID为 `a52bce6ddc49c8ead438f0a07def814e50e6f885`，与上游相同；原文件仍86,154三角形/17网格，未修改。运行时移除Subsurface_Optics、Optical_Film/Edge、Amber_Optical_Inlay；Internal_Ceramic仅剔除112三角的后片，保留3384三角的标签小字/底标；Optical_Edges仅剔除6个内环岛，保留3488三角的外周边/底标。两种混用材质分别映射到字标与饰条高光。low/medium继续省略细字/蚀刻与部分标记。

Rhine原生x宽/y高/z前：纸卡在左，rect x[-2.00,.52]、y[.70,3.22]、正面z=.14，厚.012；清晰窗每边外扩.02，为x[-2.02,.54]、y[.68,3.24]，避开左压边刻纹。Printed_Label/Carbon_Ink整网格与Internal_Ceramic的16个上部字形岛一起x+2.78；标签板新范围x[.925,1.915]，墨层最大约1.969，底部字/徽记留原位，右侧形成独立信息区。材质、索引和字形不变，label布局元数据同步右移。盖板z[.174,.206]，卡在其后。应用统一等比缩放；外围材质保留，窗内使用中性清晰玻璃和真实盖板厚度，透光覆盖与alpha偏好仍有效。闭合盖板用FrontSide，防止其背面进入Three透射缓存，使磨砂切换波及标签。几何复核入口为scripts/check-rhine-shell-geometry.mjs，真实GLB合成图为.tools/case-system-check/rhine-inset-album-*。

Rhine右侧动态标签与格式徽标由src/archive-label.ts / rhine-album-info.ts运行时绘制，另加两个平面，不修改原GLB或上述壳体三角形统计。编号沿用上游Canvas版式，标签覆盖原固定001；徽标位于标签下方，独立判断全专辑DSD/Hi-Res，同时满足则并排，单项居中，使用不受环境灯光影响的自身效果。徽标平面总宽1.28/高0.60，单标区域0.60、双标间隔0.08，单位为Rhine源坐标；布局统一等比缩放，单标与双标中的每标同尺寸。阵列共用图集，选中标签独立，退场副本复制标签贴图并保留对应格式，避免切换与销毁影响当前盒体。

动态标签纸面必须depthWrite=true，防止后绘透射壳体覆盖前方纸面的INFO、标记及上下边线；无需移动源几何或改Canvas版式。检查保留原Canvas、带壳近景depthWrite开/关与无壳近景，见.tools/case-system-check/rhine-album-label-*。

## Punk依据与坐标

原始三维源/PBR未取得；用户接受按多视角重建并明确差异。源依据是src/assets/style/case下各皮肤hero-clear、inspect序列及case.json。正式脚本内置必要数据，不依赖忽略目录的审查JSON才能导出。

Blender X水平、Z竖直、Y深度且负向在前。保持整面玻璃、盒内专辑、凹入右内板和前置铭牌；上下横梁包短侧柱。Three由CaseLayout统一等比归一化，不再次拉宽/压薄或重复缩放。

小徽记：源细线描8段Bezier，“/”支在前；optics透明软管、accent内部圆芯、emblem间断白包覆。底冠隐藏轴/开口是估算，两道接缝及底冠仍有可见差异。不能将描线误差或渲染色样称为100%网格/原PBR恢复。信号页大环是另一套资产，不随此脚本重建。

脚本材质保持可被应用层独立调节；实际十套外观由src/case-settings.ts定义。小管的薄壁透光近似和纸卡间接遮挡在应用shader中，不能用Blender原生材质截图代替实际应用渲染验收。

Punk右侧实体铭牌保留原GLB几何，运行时另加完整RHINE LAB/INFO/NO/标记纸面，使用与Rhine相同的archive-label.ts绘制。原铭牌源尺寸.54×.32，统一nativeCaseLayout缩放后的.51686×.30629与GLB实测一致，不能把两者差值当成需要二次缩放的误差。新画面覆盖正面96%，字体等比居中，不拉伸；标签板变换/显隐及cover拆解同步，使用无灯光材质并写入深度。主场景模型缓存的铭牌叠加在ArchiveCaseRenderer完成，源GLB/PNG和内容哈希不变。

两个主题的Punk盒体仅增加完整动态铭牌，不添加Hi-Res/DSD徽标；用户已取消环上方与刻度旁的放置方案，格式徽标仅保留在Future精细款。Punk主题不再展示旧CASE SKIN列表和原图预览，使用同一自制可调Punk模型：ARRAY生成缓存帧，FUTURE视图实时三维绘制并沿用Future机位，均保留Punk材质/配色及右侧信息区。源GLB/PNG不改。

## 导出与缓存版本

只有模型任务获准后才运行建模。复用已有Blender3.6.23，后台factory-startup会话，不保存用户偏好，不因本说明安装/升级工具。

Punk导出生成GLB后自动更新src/punk-case-asset.ts，版本值为GLB SHA-256前12位；case-model引用该URL。当前 `v=f48266d5fa51`，GLB 2,069,864字节。源码清单包含GLB并核对版本，随后仍需必要界面构建和重启。

极简盒已有music-cd-asset.ts同类机制。不要清用户缓存或手动替换模型却保留旧版本地址。

## 输出与审查

正式脚本/Blend/GLB/版本模块提交；.blend1、截图、日志、QA辅助脚本/profile放忽略的.tools/punk-reference-case或case-system-check。当前源图对照在sol-emblem-audit，缓存回归在cache-refresh-check；这些产物不随Git交接。

保留的其它建模脚本/场景是来源或独立结构，不借整理批量删除。将来如有发布任务，再按匹配Blender格式核查文件浏览器元数据；旧Blender5专用二进制清理脚本不能直接套在当前3.6文件。

## 来源与许可

保留LBEILC上游归属及Audio Archive来源。模型/原作视觉/PNG的许可不因建模脚本采用MIT而统一改变，见 [NOTICE](../NOTICE.md)、[主题来源](../docs/FOOBAR-STYLE-SOURCES.md)。
