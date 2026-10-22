# 档案演示数据

content/archives.json 是原 RhineLabUI 档案展示页使用的虚构档案数据，由 src/data.ts 读取；它与用户的音乐库、索引和专辑资料无关。每条记录保留来源链接，编辑时应区分对公开设定的转述与原文，并继续填写有效来源。

数据由 scripts/archive-content.mjs 校验和格式化，scripts/export-records.mjs 将记录导出到 public/archives/。从仓库根目录运行 node scripts/export-records.mjs 可重新生成下载文本；npm run build 也会在构建前执行这一步。提交数据更改时，应一并提交更新后的导出文件。

当前页面布局依赖五个分类、五列和四十条记录，每类八条；id 使用 X-001 至 X-040。字段定义直接见 content/archives.json 与 scripts/archive-content.mjs。正文按纯文本显示，JSON 字符串按 JSON 规则转义，不写 HTML 或 Markdown。
