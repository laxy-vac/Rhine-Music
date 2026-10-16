# 隐藏启动无法显示窗口的修复

用户报告提交`06e1ff8`后CMD显示正常启动日志，主窗口始终未出现。上一轮验证只覆盖简单隐藏页面和显示gate mock，未覆盖完整Electron三维入口，结论不充分。

## 已复现事实

- 界面manifest为ready且与当前源码一致，启动器已进入Electron；真实IPC的sender/mainFrame与origin校验通过。
- 完整生产前端在Chrome隔离合成服务中能就绪，但这不能证明隐藏Electron窗口的调度正常。
- Electron44.6.0完整生产前端、真实preload和gate、默认隐藏窗口节流下：页面75ms完成加载，scene约964ms载入、约4.14秒archiveReady，但30秒没有frontend-ready，窗口保持隐藏，没有JS或进程错误。
- 同一链路仅关闭该窗口backgroundThrottling后，4,061ms发出ready并释放gate。没有改GPU或安全参数。

对照报告位于`.tools/startup-recovery-2026-10-17/full-1792181760828-54328/full-report.json`与`full-1792181806908-24932/full-report.json`。证据支持隐藏节流阻碍完整启动就绪链路；没有单独钩取具体被暂停的回调，不把推测写成已验证的函数级原因。

## 修改

`createHiddenStartupGate`在attach/main-frame重载开始时对该窗口调用`setBackgroundThrottling(false)`；收到合法就绪消息后先show，再恢复`true`。首次后台加载完成再显示的产品要求保留，未恢复旧intro/加载画面，未改变系统或全局配置。

同时移除上一轮额外加入的“重载时hide已有窗口”：真实Electron窗口一旦被显式hide，实测即使关闭节流，重载仍可能停在`document.visibilityState=hidden`而无第二次ready；交换调用顺序没有改善。当前已有窗口重载保持可见，收到新的ready后恢复普通节流，不重复show。测试launcher也与产品保持`windowsHide:false`，避免测试进程的启动隐藏标志阻止首次真实显示。

`desktop/check-hidden-startup.mjs`补充首次加载、重载的节流关闭与显示后的恢复顺序断言。完整Electron回归使用合成曲库、偏好和mock设备/网络适配器，所有资料写入任务专用目录，不读取个人数据。

## 验证

gate mock与桌面主入口/回归脚本语法检查通过。`node desktop/check-startup-entry.cjs`的完整Electron44.6.0回归通过，21项native断言均为true：首次ready前隐藏，3.851秒收到ready后实际可见；重载保持可见并完成第二次ready（本轮累计5.591秒处），全程仅一次native show、无hide，加载期节流false、每次就绪后true。

最终报告：`.tools/startup-recovery-2026-10-17/desktop-entry-1792182658745-52240/startup-report.json`及同目录`electron-report.json`。真实生产bundle、preload和gate参与；空合成曲库、内存偏好、mock native/Sony/FTP/online适配器隔离。外站请求、扫描和音频操作为0，安全参数保留。主Agent复核真实visible、两次ready与节流恢复断言；没有将此结果扩展为个人曲库/设备验收。

host代码在下一次完整启动生效，前端bundle未改，原ready manifest仍匹配，无需为此重建音频或安装组件。现有卡住的Electron进程不会热更新；准备结束已识别的旧进程时确认它已经退出，未终止其他进程。不自动启动个人播放器或进行设备验收。

检查结束后核对绝对路径与reparse point，移除11个任务专用浏览器/Electron资料目录；对照、最终报告与合成配置保留，清理范围记录在同任务目录`profile-cleanup.json`。
