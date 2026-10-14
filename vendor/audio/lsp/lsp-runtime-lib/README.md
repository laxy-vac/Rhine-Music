# lsp-runtime-lib

Runtime library used by LSP Project for plugin development.

This runtime library include most necessary runtime modules.

These modules provide currently:
* Core runtime modules:
  * Functions for obtaining system information like home directory, temporary directory, etc.
  * LSPString class for working with strings.
  * Color class for working with color schemes.
* Internationalization support:
  * i18n::IDictionary interface.
  * i18n::Dictionary for root dictionary.
  * i18n::JsonDictionary for parsing JSON dictionaries. 
* Support of simple built-in expression language interpreter.
* Support of different file formats:
  * LSP configuration file format parsing and serialization.
  * JAVA ObjectStream serialized data parsing (limited support).
  * JSON data structure parsing and serialization.
  * XML data parsing (limited support, no builtin support of DTD is available).
  * Support of different bookmark formats:
    * Xbel bookmark file format (used in QT applications).
    * GTK2 and GTK3 bookmark file formats.
    * LSP JSON-serialized bookmarks.
  * Support of LSPC chunk data file format (aimed for storing audio streams).
  * Wavefront OBJ file format parsing support for loading 3D models (limited support).
  * RoomEqWizard file support.
* Basic OS-independent I/O abstraction layer support:
  * io::Path class for abstract file system path presentation and operations.
  * io::File, io::NativeFile, io::StdioFile and io::Dir classes for working with
    files and directories.
  * io::IInStream, io::InFileStream, io::InMemoryStream for input byte sequences.
  * io::IOutStream, io::OutFileStream, io::OutMemoryStream for output byte sequences.
  * io::IInSequence, io::InSequence, io::InStringSequence for input character sequences.
  * io::IOutSequence, io::OutSequence, io::OutStringSequence for output character sequences.
* OS-independend character set conversion layer support:
  * set of character conversion functions.
  * io::CharsetDecoder for streaming character set decoding.
  * io::CharsetEncoder for streaming character set encoding.
* OS-independend Inter-process communication (IPC) primitives:
  * ipc::Mutex for using mutexes.
  * ipc::IExecutor, ipc::ITask, ipc::IRunnable and ipc::NativeExecutor for task scheduling mechanism.
  * ipc::Library for loading and accessing shared objects (SO) and dynamic libraries (DLLs).
  * ipc::Process for launching nested processes.
  * ipc::Thread for launching custom threads.
* Basic multimedia (MM) processing primitives:
  * set of functions for converting audio samples from one form to another.
  * set of functions for converting pixel formats from one format to another.
  * mm::IInAudioStream, mm::InAudioFileStream for reading audio files.
  * mm::IOutAudioStream, mm::OutAudioFileStream for writing audio files.
  * mm::Bitmap for loading raster images, supported formats: XPM1, XPM2, XPM3.
* Different musical protocol support:
  * Support of MIDI message encoding and decoding.
  * Support of OSC message encoding and decoding.

## Supported platforms

The build and correct unit test execution has been confirmed for following platforms:
* FreeBSD
* GNU/Linux
* Haiku
* MacOS (ARM-based)
* Windows 32-bit
* Windows 64-bit

## Requirements

The following packages need to be installed for building:

* gcc >= 4.9 or clang >= 11.0.1
* make >= 4.0

## Building

To build the library, perform the following commands:

```bash
make config # Configure the build
make fetch # Fetch dependencies from Git repository
make
sudo make install
```

To get more build options, run:

```bash
make help
```

To uninstall library, simply issue:

```bash
make uninstall
```

To clean all binary files, run:

```bash
make clean
```

To clean the whole project tree including configuration files, run:

```bash
make prune
```

## SAST Tools

* [PVS-Studio](https://pvs-studio.com/en/pvs-studio/?utm_source=website&utm_medium=github&utm_campaign=open_source) - static analyzer for C, C++, C#, and Java code.
