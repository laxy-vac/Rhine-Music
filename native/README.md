# Windows 原生音频

native/audio-host.cpp 与 native/ 下的头文件实现 Windows 音频主机，提供 WASAPI 与 ASIO 输出、PCM/DSD/DoP 路由及处理链。解码和输出组件来自 vendor/audio/；原生运行文件的来源、哈希及许可见各组件清单和根目录 NOTICE.md。

从仓库根目录运行 npm run build:native，可用已准备好的 Windows x64 编译器、PCM codec SDK 与 LSP 源码构建主机及其运行库。常规构建使用现有 RHINE_CXX，或项目内已准备的 Zig 工具；构建脚本不会自动下载或安装工具。生成文件及来源清单位于 vendor/audio/windows-x64/，修改原生源码后应重新生成对应二进制和清单再打包。

Sony 音效桥接的 ARM 指令转写、x86 DLL 生成方式及权利限制见 native/sony/README.md。Sony 原始文件、模型、参数和派生转写不属于项目 MIT 授权；音频源码与第三方组件的实际许可以 NOTICE.md 和随包许可原文为准。

完整桌面构建、已准备组件位置和源码运行入口见 docs/DEVELOPMENT.md。
