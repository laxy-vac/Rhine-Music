# PCM codec SDK

Prepared by scripts/prepare-pcm-codecs.mjs. Files are staged for local dynamic loading and C header integration; no system installation or registry changes are made.

## Components

- FFmpeg n9.0.2-24-gfd5d616c29: LGPL shared Windows x64 SDK.
- libFLAC 1.5.0: Xiph BSD-3-Clause library; public headers come from the matching source release.
- libsoxr 0.1.3: built from the official LGPL-2.1-or-later source with a scalar CR64 double-precision engine and FFT4G64.

The SoXR build disables OpenMP, SIMD engines, and AVX. Headers are under include/; license texts are under licenses/. Runtime DLLs are in .tools/audio-codecs/windows-x64/. See vendor/audio/codec-components.json for source URLs, build flags, and per-file SHA-256 digests.
