# 音频资源来源

播放器配乐分为 atmosphere、motif、pulse 三个循环声部。合成脚本为 scripts/render-audio.mjs，相关节拍、种子和输出信息保存在 score.json；脚本可接受现有 FFmpeg 可执行文件路径。三个 Ogg 文件与 observatory-preview.mp3 不使用原片录音，具体署名和许可依根目录 NOTICE.md 与 LICENSE。

## 逐字输入短音

typing-preview.wav 与 src/typing-samples.ts 含三段各 38 ms 的短音，截取自《明日方舟》特别映像「莱茵生命：访问」约 6.864–6.986 秒。typing-source.json 保留源标识、采样率、时间段和处理参数；scripts/extract-typing-audio.mjs 是生成入口，需要本机持有的原始参考视频与 FFmpeg。完整原片不属于本仓库素材。短音及其衍生片段的权利归原作者，不纳入项目代码的 MIT 授权，来源记录也不构成再分发许可。
