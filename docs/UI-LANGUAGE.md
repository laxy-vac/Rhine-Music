# 界面语言

界面支持简体中文（<code>zh-CN</code>）和 English（<code>en</code>）。设置 → 常规中选择语言并应用后重新载入界面；当前设置分类会恢复。桌面 preload 在应用模块初始化前从偏好恢复语言，避免重载时短暂显示错误语言。

语言偏好保存在桌面 <code>preferences.json</code> 的 <code>language</code> 字段，并同步到渲染器 <code>rhine-ui-language</code> 本地存储。无有效值时使用简体中文。

## 翻译规则

应用自带文字通过 [i18n.ts](../src/i18n.ts) 的 <code>trUi()</code> 或 <code>ui</code> 模板处理。中文原文是查找键；英文译文分别维护在 [i18n-main-en.ts](../src/i18n-main-en.ts)、[i18n-panels-en.ts](../src/i18n-panels-en.ts) 和 [i18n-lsp-en.ts](../src/i18n-lsp-en.ts)。<code>ui</code> 只翻译插值前的应用文案；没有对应译文时保留原文。新增界面文字应补同一词表，不对 DOM 或曲库做自动翻译。

按钮、设置、说明、错误、确认、单位和无障碍名称随界面语言显示。中文界面保留 RHINE LAB、MUSIC ARCHIVE、页面眉题、SYSTEM NOTICE、3D/2D/CLASSIC/SPECTRUM 等共用 Punk 词表；两主题使用相同英文产品词。

中文模式的保留英文由[music-interface-labels.ts](../src/music-interface-labels.ts)共用，包含 GRAPHICS、SHUFFLE ALL、ORDER 和播放顺序名称；不按主题各自维护不同词表。Future 入场的 SKIP INTRO 保留英文，欢迎文案和 ID 是受 ASCII 字母及空格边界保护的用户文本，默认 Internal DataBase / Kristen Wright，不做翻译。

曲名、专辑、歌手、流派、歌词、翻译歌词、制作人员、资料正文、路径、设备/驱动名、用户输入、预设名和自定义服务器名保持原文。未知后端或第三方诊断保留原文；未知状态值、配置键、设备 ID、处理参数及 JSON 数据不翻译。内置网易云与 QQ 来源只在英文界面显示对应英文品牌名，不修改缓存或来源记录。

Windows 已知问题窗口及音乐/歌词目录选择器会收到当前语言参数。语言只改变应用文案，不更改曲库内容、缓存、设备标识或协议值。

## 实现入口

- 词表加载、静态文字和模板翻译：[i18n.ts](../src/i18n.ts)
- 桌面启动前恢复语言与本机接口：[preload.cjs](../desktop/preload.cjs)
- 应用设置与重新载入：[music-app.ts](../src/music-app.ts)
- 主题排版和共用英文词见 [THEME-PAGE](THEME-PAGE.md)
