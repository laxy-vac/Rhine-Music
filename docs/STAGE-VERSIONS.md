# 阶段版本与顺序测试

更新：2026-10-15。当前唯一活动源码仓库仍是本目录对应的Git仓库 `main`。Stage3独立App和源码ZIP是用户明确要求的冻结交付快照，不是第二份活动仓库，也不代表用户已经验收第三阶段。

## 已保存的第三阶段版本

本地标签 `checkpoint/unified-stage3-complete-2026-10-15` 指向提交 `c7987ee51989ebb89f72bf9fc721b5da487f4bc4`。独立交付目录为：

```text
<工作区>/packaging/stage-versions/Stage3-c7987ee/
  App\Rhine Music Preview.exe
  Rhine-Music-Stage3-c7987ee-source.zip
  测试第三阶段.cmd
  版本说明.txt
```

App运行载荷为 `0.3.1-stage3`，逐文件manifest与校验值已核对；源码ZIP携带相同Git提交SHA。窗口标题仍显示原品尝版名称，应以此文件夹和`测试第三阶段.cmd`识别阶段。它是独立App目录，无需安装；原朋友品尝版安装器和源码ZIP保持原快照。

## 先测第三阶段，再测第四阶段

1. 完整退出当前播放器或源码预览，避免两个版本同时运行。
2. 双击Stage3目录中的 `测试第三阶段.cmd`。按App内冻结的`resources/app/docs/UNIFIED-ARCHITECTURE.md`第三阶段验收点检查两主题日夜货架/阵列/网格、切主题与开合后的选择/详情、过滤恢复、ROW和ALBUM NO.编号、地面/尺寸及主动性能检测流程。
3. 如果Stage3发现明显问题，先停止第四阶段的用户测试并记录现象；没有问题时，完整退出Stage3 App，再双击相邻`Stage4-complete/测试第四阶段.cmd`。按[第四阶段验收点](UNIFIED-ARCHITECTURE.md#第四阶段验收点)复测目录显示/分组/排序、Grid、主题外壳、选择/详情及盒体行为。
4. 两阶段实现与必要自动验证已完成，用户人工验收都尚待进行。第四阶段独立目录为工作区外层`packaging/stage-versions/Stage4-complete`，载荷版本`0.3.1-stage4`；窗口显示实际载荷版本。对应源码ZIP、提交SHA和校验记录见该目录，冻结标签为`checkpoint/unified-stage4-complete-2026-10-15`。

自动化和合成图形检查不代替实际播放器、音频设备或用户硬件帧率测试。不要为了阶段验收启动个人播放、扫描未指定的曲库、安装软件或准备缺失依赖。

## 两版的数据边界

Stage3 App按可执行文件所在目录保存数据：首次运行时在`App/data`创建配置、索引、会话、日志和缓存，并在`App/presets`创建主题与EQ预设；当前保存包未创建这两个目录，首次启动前为空。未复制个人曲库、偏好或预设，启动后不会自动扫描音乐目录；用户可在设置中自行选择目录并主动扫描。

Stage4独立App同样使用自己的`App/data`和`App/presets`，首次为空库；两版不自动复制、迁移、覆盖或清除彼此的数据。Stage3测试按第2步完成并完全退出后，再运行第3步。

原仓库`启动源码验证.cmd`和`npm run desktop`现运行第四阶段源码，仍使用原工作区的源码验证profile（`music-data-source-preview/desktop`与`music-data`）；它不是冻结的Stage3，也不是上述两个独立App的配置。建议顺序比较时使用两份独立App入口。
