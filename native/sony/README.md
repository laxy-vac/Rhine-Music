# Sony ARM 指令的 x86-64 C++ 转写

Windows 播放通过 vendor/sony-walkman-x86/sony-dsp-x86.dll 执行 Sony 三项 PCM 音效。转写源位于 native/sony/：instructions.json 保存原指令元数据，generated/page_*.cpp 保存生成的 C++ 页面，dispatch.cpp 连接已编译代码，arm-state.hpp 与 lift-host.cpp 处理原 ABI、寄存器状态和调用边界。

## 来源与运行边界

九个 Sony 原版运行文件位于 vendor/sony-walkman/，其固定 SHA-256 见 scripts/sony-walkman/assets.json。来源为 Sony DMP-Z1 官方 1.02 音频库，DSEE AI 使用 DSX 3.0.7；模型、配置、系数和预设保持原版。固件用于来源提取，不运行刷写程序，也不包含完整固件。

生成的 C++ 是按原 ARM 指令行为转写的派生实现，不是 Sony 原始源代码，也不代表恢复整台 Walkman 的解码、路由、放大器或 DAC。Windows 音频处理通过 x86-64 DLL；嵌入式 Python 负责桥接编排。原始 Sony 文件、模型、参数、转写代码及标志不改授本项目 MIT；公开再分发授权须另行确认。详见根目录 NOTICE.md。

## 构建与再生成

使用已经准备好的 Windows x64 C++ 编译器。从仓库根目录运行：

```powershell
npm run build:sony
```

编译器可通过 RHINE_CXX 指定；未设置时脚本使用项目内已准备的 Zig 路径。构建验证原指令来源，生成 vendor/sony-walkman-x86/sony-dsp-x86.dll 与 assets.json。桌面打包会检查指令图、源文件和 DLL 清单；转写源变化后，先重新生成 DLL 和清单再打包。

需要重建转写页面时，lift.py 只使用 Python 标准库：

```powershell
python -B scripts/sony-walkman/lift.py --trace native/sony/instructions.json
npm run build:sony
```

原生运行文件及 Unicorn/Python 绑定的上游许可、源码归档和固定运行时下载来源见 NOTICE.md、vendor/sony-walkman/ 与 vendor/licenses/unicorn/。不得把这些第三方内容一并标成 MIT。
