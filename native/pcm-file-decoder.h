#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cerrno>
#include <cmath>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <exception>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "pcm-engine.h"
#include "pcm-wave-reader.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavcodec/version_major.h>
#include <libavformat/avformat.h>
#include <libavformat/version_major.h>
#include <libavutil/error.h>
#include <libavutil/mathematics.h>
#include <libavutil/samplefmt.h>
#include <libavutil/version.h>
#include <FLAC/format.h>
#include <FLAC/stream_decoder.h>
}

namespace rhine {

// Compressed PCM files are decoded by a producer thread into a fixed SPSC
// ring. The output callback only copies already-decoded doubles from the ring.
// The owning control path must stop/quiesce its audio callback before seek() or
// destruction; retired host sources should be collected from a control thread.
class PcmFileDecoder {
 public:
  struct Info {
    int sampleRate = 0;
    int channels = 0;
    int bitsPerSample = 0;
    int validBitsPerSample = 0;
    int containerBits = 0;
    std::uint64_t totalFrames = 0;
    double duration = 0.0;
    bool exactFrameCount = false;
    std::string decoderName;
    std::string sourceSampleFormat;
    std::string decodedSampleFormat;
    std::string decodeMath;
    bool exactInteger = false;
  };

  static std::shared_ptr<PcmFileDecoder> open(
      const std::wstring& file,
      const std::wstring& dllDirectory,
      std::optional<std::uint64_t> growingBytes = std::nullopt) {
    std::unique_ptr<Backend> backend;
    if (growingBytes) {
      backend = openGrowingWave(file, *growingBytes);
    } else {
      backend = openCodecBackend(file, dllDirectory);
    }
    auto decoder = std::shared_ptr<PcmFileDecoder>(new PcmFileDecoder(std::move(backend),growingBytes.has_value()));
    decoder->startWorker();
    decoder->prime();
    return decoder;
  }

  ~PcmFileDecoder() { stopWorker(); }
  PcmFileDecoder(const PcmFileDecoder&) = delete;
  PcmFileDecoder& operator=(const PcmFileDecoder&) = delete;

  const Info& info() const noexcept { return info_; }

  // Single-consumer, non-blocking callback read. EOF is reported only once all
  // primed/produced frames have been consumed. A worker error is moved to the
  // result exactly once after the ring drains.
  PcmDecodedBlock read(double* destination, std::size_t capacityFrames) {
    PcmDecodedBlock result;
    if (!destination && capacityFrames) {
      result.error = "PCM decoder received a null output buffer";
      return result;
    }

    const std::uint64_t readAt = readIndex_.load(std::memory_order_relaxed);
    const std::uint64_t written = writeIndex_.load(std::memory_order_acquire);
    const std::uint64_t available = written >= readAt ? written - readAt : 0;
    const std::size_t frames = static_cast<std::size_t>(std::min<std::uint64_t>(
        available, static_cast<std::uint64_t>(capacityFrames)));
    if (frames) {
      const std::size_t first = std::min(frames, ringCapacityFrames_ - static_cast<std::size_t>(readAt % ringCapacityFrames_));
      const std::size_t channels = static_cast<std::size_t>(info_.channels);
      const std::size_t firstSamples = first * channels;
      std::memcpy(destination,
                  ring_.data() + static_cast<std::size_t>(readAt % ringCapacityFrames_) * channels,
                  firstSamples * sizeof(double));
      const std::size_t second = frames - first;
      if (second) {
        std::memcpy(destination + firstSamples, ring_.data(), second * channels * sizeof(double));
      }
      readIndex_.store(readAt + frames, std::memory_order_release);
      consumedFrames_.fetch_add(frames, std::memory_order_relaxed);
      producerWake_.notify_one();
    }

    result.frames = frames;
    const std::uint64_t afterRead = readAt + frames;
    const bool drained = sourceEnded_.load(std::memory_order_acquire) && afterRead == writeIndex_.load(std::memory_order_acquire);
    if (drained && workerErrorReady_.load(std::memory_order_acquire) && !workerErrorDelivered_) {
      result.error = std::move(workerError_);
      workerErrorDelivered_ = true;
    }
    result.eof = drained && !workerErrorReady_.load(std::memory_order_relaxed);
    result.buffering = !result.eof && result.error.empty() && frames < capacityFrames;
    return result;
  }

  // Seeking is a control-thread operation. The audio callback must be stopped
  // before this method is called so the worker and consumer are both quiescent.
  void seek(std::uint64_t frame) {
    if (info_.exactFrameCount && frame > info_.totalFrames)
      throw std::runtime_error("PCM seek frame is past the source duration");
    stopWorker();
    backend_->seek(frame);
    readIndex_.store(0, std::memory_order_relaxed);
    writeIndex_.store(0, std::memory_order_relaxed);
    consumedFrames_.store(frame, std::memory_order_relaxed);
    seekBaseFrame_=frame;
    sourceEnded_.store(false, std::memory_order_relaxed);
    workerErrorReady_.store(false, std::memory_order_relaxed);
    workerErrorDelivered_ = false;
    workerError_.clear();
    stopRequested_.store(false, std::memory_order_relaxed);
    startWorker();
    prime();
  }

  std::uint64_t positionFrames() const noexcept {
    return consumedFrames_.load(std::memory_order_relaxed);
  }

  bool atEnd() const noexcept {
    return sourceEnded_.load(std::memory_order_acquire) &&
        readIndex_.load(std::memory_order_acquire) == writeIndex_.load(std::memory_order_acquire);
  }

  std::optional<std::uint64_t> exactTotalFrames() const noexcept {
    if(!sourceEnded_.load(std::memory_order_acquire)||workerErrorReady_.load(std::memory_order_acquire))return std::nullopt;
    return seekBaseFrame_+writeIndex_.load(std::memory_order_acquire);
  }

 private:
  struct BackendRead {
    std::size_t frames = 0;
    bool eof = false;
    bool buffering = false;
    std::string error;
  };

  static std::wstring dllPath(const std::wstring& directory, const std::wstring& filename) {
    if (directory.empty()) return filename;
    if (directory.back() == L'\\' || directory.back() == L'/') return directory + filename;
    return directory + L"\\" + filename;
  }

  template <typename Function>
  static Function loadFunction(HMODULE module, const char* name) {
    const FARPROC address = module ? GetProcAddress(module, name) : nullptr;
    if (!address) throw std::runtime_error(std::string("Missing codec API: ") + name);
    return reinterpret_cast<Function>(address);
  }

  struct FfmpegApi {
    HMODULE avutil = nullptr;
    HMODULE avcodec = nullptr;
    HMODULE avformat = nullptr;

    decltype(&avformat_open_input) formatOpenInput = nullptr;
    decltype(&avformat_find_stream_info) formatFindStreamInfo = nullptr;
    decltype(&avformat_close_input) formatCloseInput = nullptr;
    decltype(&avformat_seek_file) formatSeekFile = nullptr;
    decltype(&avformat_flush) formatFlush = nullptr;
    decltype(&av_read_frame) readFrame = nullptr;
    decltype(&av_dict_set) dictSet = nullptr;
    decltype(&av_dict_free) dictFree = nullptr;
    decltype(&avcodec_find_decoder) codecFindDecoder = nullptr;
    decltype(&avcodec_alloc_context3) codecAllocContext = nullptr;
    decltype(&avcodec_parameters_to_context) codecParametersToContext = nullptr;
    decltype(&avcodec_open2) codecOpen = nullptr;
    decltype(&avcodec_free_context) codecFreeContext = nullptr;
    decltype(&avcodec_send_packet) codecSendPacket = nullptr;
    decltype(&avcodec_receive_frame) codecReceiveFrame = nullptr;
    decltype(&avcodec_flush_buffers) codecFlushBuffers = nullptr;
    decltype(&avcodec_descriptor_get) codecDescriptorGet = nullptr;
    decltype(&av_packet_alloc) packetAlloc = nullptr;
    decltype(&av_packet_free) packetFree = nullptr;
    decltype(&av_packet_unref) packetUnref = nullptr;
    decltype(&av_frame_alloc) frameAlloc = nullptr;
    decltype(&av_frame_free) frameFree = nullptr;
    decltype(&av_frame_unref) frameUnref = nullptr;
    decltype(&av_get_packed_sample_fmt) getPackedSampleFormat = nullptr;
    decltype(&av_sample_fmt_is_planar) sampleFormatIsPlanar = nullptr;
    decltype(&av_rescale_q) rescaleQ = nullptr;
    decltype(&av_strerror) strerror = nullptr;

    explicit FfmpegApi(const std::wstring& directory) {
      try {
        const std::wstring avutilName = L"avutil-" + std::to_wstring(LIBAVUTIL_VERSION_MAJOR) + L".dll";
        const std::wstring avcodecName = L"avcodec-" + std::to_wstring(LIBAVCODEC_VERSION_MAJOR) + L".dll";
        const std::wstring avformatName = L"avformat-" + std::to_wstring(LIBAVFORMAT_VERSION_MAJOR) + L".dll";
        avutil = loadLibrary(directory, avutilName);
        avcodec = loadLibrary(directory, avcodecName);
        avformat = loadLibrary(directory, avformatName);

#define RHINE_CODEC_LOAD(member, module, symbol) member = loadFunction<decltype(member)>(module, #symbol)
        RHINE_CODEC_LOAD(formatOpenInput, avformat, avformat_open_input);
        RHINE_CODEC_LOAD(formatFindStreamInfo, avformat, avformat_find_stream_info);
        RHINE_CODEC_LOAD(formatCloseInput, avformat, avformat_close_input);
        RHINE_CODEC_LOAD(formatSeekFile, avformat, avformat_seek_file);
        RHINE_CODEC_LOAD(formatFlush, avformat, avformat_flush);
        RHINE_CODEC_LOAD(readFrame, avformat, av_read_frame);
        RHINE_CODEC_LOAD(dictSet, avutil, av_dict_set);
        RHINE_CODEC_LOAD(dictFree, avutil, av_dict_free);
        RHINE_CODEC_LOAD(codecFindDecoder, avcodec, avcodec_find_decoder);
        RHINE_CODEC_LOAD(codecAllocContext, avcodec, avcodec_alloc_context3);
        RHINE_CODEC_LOAD(codecParametersToContext, avcodec, avcodec_parameters_to_context);
        RHINE_CODEC_LOAD(codecOpen, avcodec, avcodec_open2);
        RHINE_CODEC_LOAD(codecFreeContext, avcodec, avcodec_free_context);
        RHINE_CODEC_LOAD(codecSendPacket, avcodec, avcodec_send_packet);
        RHINE_CODEC_LOAD(codecReceiveFrame, avcodec, avcodec_receive_frame);
        RHINE_CODEC_LOAD(codecFlushBuffers, avcodec, avcodec_flush_buffers);
        RHINE_CODEC_LOAD(codecDescriptorGet, avcodec, avcodec_descriptor_get);
        RHINE_CODEC_LOAD(packetAlloc, avcodec, av_packet_alloc);
        RHINE_CODEC_LOAD(packetFree, avcodec, av_packet_free);
        RHINE_CODEC_LOAD(packetUnref, avcodec, av_packet_unref);
        RHINE_CODEC_LOAD(frameAlloc, avutil, av_frame_alloc);
        RHINE_CODEC_LOAD(frameFree, avutil, av_frame_free);
        RHINE_CODEC_LOAD(frameUnref, avutil, av_frame_unref);
        RHINE_CODEC_LOAD(getPackedSampleFormat, avutil, av_get_packed_sample_fmt);
        RHINE_CODEC_LOAD(sampleFormatIsPlanar, avutil, av_sample_fmt_is_planar);
        RHINE_CODEC_LOAD(rescaleQ, avutil, av_rescale_q);
        RHINE_CODEC_LOAD(strerror, avutil, av_strerror);
#undef RHINE_CODEC_LOAD
      } catch (...) {
        unload();
        throw;
      }
    }

    ~FfmpegApi() { unload(); }
    FfmpegApi(const FfmpegApi&) = delete;
    FfmpegApi& operator=(const FfmpegApi&) = delete;

    std::string errorText(int error) const {
      char buffer[AV_ERROR_MAX_STRING_SIZE]{};
      if (strerror && strerror(error, buffer, sizeof(buffer)) >= 0) return buffer;
      return "FFmpeg error " + std::to_string(error);
    }

   private:
    static HMODULE loadLibrary(const std::wstring& directory, const std::wstring& filename) {
      const std::wstring path = dllPath(directory, filename);
      const DWORD flags = directory.empty() ? LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
          : LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32;
      HMODULE module = LoadLibraryExW(path.c_str(), nullptr, flags);
      if (!module) throw std::runtime_error("FFmpeg runtime library could not be loaded: " + std::to_string(GetLastError()));
      return module;
    }

    void unload() noexcept {
      if (avformat) { FreeLibrary(avformat); avformat = nullptr; }
      if (avcodec) { FreeLibrary(avcodec); avcodec = nullptr; }
      if (avutil) { FreeLibrary(avutil); avutil = nullptr; }
    }
  };

  struct FlacApi {
    HMODULE module = nullptr;
    decltype(&FLAC__stream_decoder_new) decoderNew = nullptr;
    decltype(&FLAC__stream_decoder_delete) decoderDelete = nullptr;
    decltype(&FLAC__stream_decoder_init_stream) decoderInitStream = nullptr;
    decltype(&FLAC__stream_decoder_init_ogg_stream) decoderInitOggStream = nullptr;
    decltype(&FLAC__stream_decoder_process_until_end_of_metadata) decoderReadMetadata = nullptr;
    decltype(&FLAC__stream_decoder_process_single) decoderProcessSingle = nullptr;
    decltype(&FLAC__stream_decoder_seek_absolute) decoderSeekAbsolute = nullptr;
    decltype(&FLAC__stream_decoder_finish) decoderFinish = nullptr;
    decltype(&FLAC__stream_decoder_get_state) decoderGetState = nullptr;

    explicit FlacApi(const std::wstring& directory) {
      module = LoadLibraryExW(dllPath(directory, L"FLAC.dll").c_str(), nullptr,
          directory.empty() ? LOAD_LIBRARY_SEARCH_DEFAULT_DIRS
                            : LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
      if (!module) throw std::runtime_error("libFLAC runtime library could not be loaded: " + std::to_string(GetLastError()));
      try {
#define RHINE_FLAC_LOAD(member, symbol) member = loadFunction<decltype(member)>(module, #symbol)
        RHINE_FLAC_LOAD(decoderNew, FLAC__stream_decoder_new);
        RHINE_FLAC_LOAD(decoderDelete, FLAC__stream_decoder_delete);
        RHINE_FLAC_LOAD(decoderInitStream, FLAC__stream_decoder_init_stream);
        decoderInitOggStream = reinterpret_cast<decltype(decoderInitOggStream)>(GetProcAddress(module, "FLAC__stream_decoder_init_ogg_stream"));
        RHINE_FLAC_LOAD(decoderReadMetadata, FLAC__stream_decoder_process_until_end_of_metadata);
        RHINE_FLAC_LOAD(decoderProcessSingle, FLAC__stream_decoder_process_single);
        RHINE_FLAC_LOAD(decoderSeekAbsolute, FLAC__stream_decoder_seek_absolute);
        RHINE_FLAC_LOAD(decoderFinish, FLAC__stream_decoder_finish);
        RHINE_FLAC_LOAD(decoderGetState, FLAC__stream_decoder_get_state);
#undef RHINE_FLAC_LOAD
      } catch (...) {
        FreeLibrary(module);
        module = nullptr;
        throw;
      }
    }

    ~FlacApi() { if (module) FreeLibrary(module); }
    FlacApi(const FlacApi&) = delete;
    FlacApi& operator=(const FlacApi&) = delete;
  };

  static std::shared_ptr<FfmpegApi> sharedFfmpegApi(const std::wstring& directory) {
    // Keep this verified runtime loaded for the native process lifetime. The
    // Repeated DLL load/unload in this Windows build grew the process handle
    // count even with freed AV contexts; one process-scoped runtime is stable.
    static const std::wstring runtimeDirectory=directory;
    if(runtimeDirectory!=directory)throw std::runtime_error("Changing FFmpeg runtime directory requires a new native process");
    static const auto api=std::make_shared<FfmpegApi>(directory);
    return api;
  }

  class Backend {
   public:
    virtual ~Backend() = default;
    virtual const Info& info() const noexcept = 0;
    virtual BackendRead read(double* destination, std::size_t capacityFrames) = 0;
    virtual void seek(std::uint64_t frame) = 0;
  };

  class GrowingWaveBackend final : public Backend {
   public:
    static std::unique_ptr<GrowingWaveBackend> open(const std::wstring& file,
                                                    std::uint64_t expectedBytes) {
      WaveOpenOptions options;
      options.growing = true;
      options.expectedBytes = expectedBytes;
      std::string error;
      auto reader = WavePcmReader::tryOpen(file, options, &error);
      if (!reader) throw std::runtime_error(error.empty() ? "Sony PCM cache WAV could not be opened" : error);
      return std::unique_ptr<GrowingWaveBackend>(new GrowingWaveBackend(std::move(reader)));
    }

    const Info& info() const noexcept override { return info_; }
    BackendRead read(double* destination, std::size_t capacityFrames) override {
      const WaveReadResult block = reader_->read(destination, capacityFrames);
      return {block.frames, block.eof, block.buffering, block.error};
    }
    void seek(std::uint64_t frame) override {
      std::string error;
      if (!reader_->seek(frame, &error))
        throw std::runtime_error(error.empty() ? "Sony PCM cache WAV seek failed" : error);
    }

   private:
    explicit GrowingWaveBackend(std::unique_ptr<WavePcmReader> reader) : reader_(std::move(reader)) {
      const WaveInfo source = reader_->info();
      info_.sampleRate = static_cast<int>(source.sampleRate);
      info_.channels = static_cast<int>(source.channels);
      info_.bitsPerSample = static_cast<int>(source.bitsPerSample);
      info_.validBitsPerSample = static_cast<int>(source.validBitsPerSample);
      info_.containerBits = static_cast<int>(source.bitsPerSample);
      info_.totalFrames = source.sourceFrameCount;
      info_.duration = source.durationSeconds;
      info_.exactFrameCount = true;
      info_.decoderName = "PCM cache";
      info_.sourceSampleFormat = source.format == WaveSampleFormat::PcmInteger ? "pcm" :
          source.format == WaveSampleFormat::IeeeFloat32 ? "float32" : "float64";
      info_.decodedSampleFormat = "float64";
      switch (source.decodeMath) {
        case WaveDecodeMath::Pcm8UnsignedMidpoint: info_.decodeMath = "pcm8-unsigned-midpoint"; break;
        case WaveDecodeMath::SignedIntegerNormalized: info_.decodeMath = "signed-integer-normalized-to-double"; break;
        case WaveDecodeMath::SignedIntegerLeftAlignedValidBits: info_.decodeMath = "signed-integer-left-aligned-valid-bits"; break;
        case WaveDecodeMath::IeeeFloat32Widened: info_.decodeMath = "ieee-float32-widened-to-double"; break;
        case WaveDecodeMath::IeeeFloat64Copied: info_.decodeMath = "ieee-float64-copied"; break;
      }
      info_.exactInteger = source.format == WaveSampleFormat::PcmInteger &&
          ((source.validBitsPerSample == 16 && source.bitsPerSample == 16) ||
           (source.validBitsPerSample == 24 && (source.bitsPerSample == 24 || source.bitsPerSample == 32)) ||
           (source.validBitsPerSample == 32 && source.bitsPerSample == 32));
      if (info_.sampleRate <= 0 || info_.channels < 1 || info_.channels > 2 || !info_.totalFrames)
        throw std::runtime_error("Sony PCM cache WAV has an unsupported stream format");
    }

    std::unique_ptr<WavePcmReader> reader_;
    Info info_;
  };

  class FfmpegBackend final : public Backend {
   public:
    FfmpegBackend(const std::wstring& file, const std::wstring& dllDirectory)
        : apiOwner_(sharedFfmpegApi(dllDirectory)),api_(*apiOwner_),file_(file) {
      try {
        open(file);
      } catch (...) {
        close();
        throw;
      }
    }

    ~FfmpegBackend() override { close(); }

    const Info& info() const noexcept override { return info_; }
    bool isFlac() const noexcept { return parameters_ && parameters_->codec_id == AV_CODEC_ID_FLAC; }
    void initializeDecoder() {
      if (decoderReady_) return;
      const AVCodec* decoder = api_.codecFindDecoder(parameters_->codec_id);
      if (!decoder) throw std::runtime_error("FFmpeg has no decoder for the audio codec");
      codec_ = api_.codecAllocContext(nullptr);
      if (!codec_) throw std::runtime_error("FFmpeg decoder context allocation failed");
      int status = api_.codecParametersToContext(codec_, parameters_);
      if (status < 0) throw std::runtime_error("FFmpeg could not configure the audio decoder: " + api_.errorText(status));
      codec_->pkt_timebase = stream_->time_base;
      status = api_.codecOpen(codec_, decoder, nullptr);
      if (status < 0) throw std::runtime_error("FFmpeg could not initialize the audio decoder: " + api_.errorText(status));
      packet_ = api_.packetAlloc();
      frame_ = api_.frameAlloc();
      if (!packet_ || !frame_) throw std::runtime_error("FFmpeg packet/frame allocation failed");
      decoderReady_ = true;
      prepareFirstFrame();
    }
    BackendRead read(double* destination, std::size_t capacityFrames) override {
      BackendRead result;
      while (result.frames < capacityFrames) {
        if (!framePending_) {
          const int status = nextFrame();
          if (status == AVERROR_EOF) { result.eof = true; break; }
          if (status < 0) { result.error = api_.errorText(status); break; }
          if (!prepareCurrentFrame(result.error)) break;
          if (!result.error.empty()) break;
        }

        const std::size_t frameSamples = static_cast<std::size_t>(frame_->nb_samples);
        if (frameOffset_ >= frameSamples) {
          api_.frameUnref(frame_);
          framePending_ = false;
          frameOffset_ = 0;
          continue;
        }
        const std::size_t count = std::min(capacityFrames - result.frames, frameSamples - frameOffset_);
        for (std::size_t sample = 0; sample < count; ++sample) {
          for (int channel = 0; channel < info_.channels; ++channel) {
            destination[(result.frames + sample) * static_cast<std::size_t>(info_.channels) + channel] =
                sampleValue(frame_, frameOffset_ + sample, channel);
          }
        }
        frameOffset_ += count;
        result.frames += count;
      }
      return result;
    }

    void seek(std::uint64_t frame) override {
      if (frame > static_cast<std::uint64_t>(std::numeric_limits<std::int64_t>::max()))
        throw std::runtime_error("PCM seek frame exceeds the decoder timestamp range");
      const AVRational sourceTimeBase{1, info_.sampleRate};
      const auto* descriptor=api_.codecDescriptorGet(parameters_->codec_id);
      const uint64_t preroll=descriptor&&!(descriptor->props&AV_CODEC_PROP_LOSSLESS)?
          static_cast<uint64_t>(std::max(info_.sampleRate,codec_->seek_preroll)):0;
      if(frame==0||frame<preroll) {
        // Beginning-of-stream AAC/Opus packets may have negative PTS and carry
        // initial skip metadata. A seek to zero can omit them; reopen to retain
        // the exact decoder initialization and crop on real decoded PTS.
        const Info previous=info_;close();info_={};streamIndex_=-1;
        packetPending_=framePending_=demuxEnded_=flushSent_=decoderEnded_=decoderReady_=false;
        frameOffset_=0;decodedFormat_=AV_SAMPLE_FMT_NONE;seekTargetFrame_=frame;seekPending_=frame!=0;
        open(file_);initializeDecoder();
        if(info_.sampleRate!=previous.sampleRate||info_.channels!=previous.channels||info_.decodedSampleFormat!=previous.decodedSampleFormat)
          throw std::runtime_error("Audio format changed while reopening for seek");
        return;
      }
      const uint64_t demuxTarget=frame>preroll?frame-preroll:0;
      const std::int64_t relative = api_.rescaleQ(static_cast<std::int64_t>(demuxTarget), sourceTimeBase, stream_->time_base);
      const std::int64_t origin = stream_->start_time == AV_NOPTS_VALUE ? 0 : stream_->start_time;
      if ((relative > 0 && origin > std::numeric_limits<std::int64_t>::max() - relative) ||
          (relative < 0 && origin < std::numeric_limits<std::int64_t>::min() - relative))
        throw std::runtime_error("PCM seek timestamp overflows");
      const std::int64_t timestamp = origin + relative;
      const int status = api_.formatSeekFile(format_, streamIndex_, std::numeric_limits<std::int64_t>::min(),
                                             timestamp, timestamp, AVSEEK_FLAG_BACKWARD);
      if (status < 0) throw std::runtime_error("FFmpeg seek failed: " + api_.errorText(status));
      // avformat_seek_file already flushes demux state and establishes the
      // new timestamps. Flushing again resets WAV packet PTS to zero, causing
      // the accurate-seek crop below to skip the requested offset twice.
      api_.codecFlushBuffers(codec_);
      api_.packetUnref(packet_);
      api_.frameUnref(frame_);
      packetPending_ = false;
      framePending_ = false;
      demuxEnded_ = false;
      flushSent_ = false;
      decoderEnded_ = false;
      frameOffset_ = 0;
      seekTargetFrame_ = frame;
      seekPending_ = true;
    }

   private:
    static std::string utf8Path(const std::wstring& file) {
      if (file.find(L'\0') != std::wstring::npos) throw std::runtime_error("Invalid audio path");
      const int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, file.data(),
          static_cast<int>(file.size()), nullptr, 0, nullptr, nullptr);
      if (!bytes) throw std::runtime_error("Audio path cannot be represented as UTF-8");
      std::string result(static_cast<std::size_t>(bytes), '\0');
      if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, file.data(), static_cast<int>(file.size()),
                               result.data(), bytes, nullptr, nullptr))
        throw std::runtime_error("Audio path conversion failed");
      return result;
    }

    void open(const std::wstring& file) {
      const std::string path = utf8Path(file);
      AVDictionary* options = nullptr;
      api_.dictSet(&options, "protocol_whitelist", "file", 0);
      api_.dictSet(&options, "format_whitelist", "wav,w64,mp3,ogg,mov,mp4,m4a,3gp,3g2,mj2,aac,aiff,ape,wv,asf,matroska,webm,tta,tak,flac", 0);
      int status = api_.formatOpenInput(&format_, path.c_str(), nullptr, &options);
      api_.dictFree(&options);
      if (status < 0) throw std::runtime_error("FFmpeg could not open the audio file: " + api_.errorText(status));
      status = api_.formatFindStreamInfo(format_, nullptr);
      if (status < 0) throw std::runtime_error("FFmpeg could not read audio stream information: " + api_.errorText(status));

      streamIndex_ = -1;
      for (unsigned int index = 0; index < format_->nb_streams; ++index) {
        AVStream* candidate = format_->streams[index];
        if (candidate && candidate->codecpar && candidate->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
          streamIndex_ = static_cast<int>(index);
          stream_ = candidate;
          break;
        }
      }
      if (!stream_ || streamIndex_ < 0) throw std::runtime_error("Audio file has no decodable audio stream");
      parameters_ = stream_->codecpar;
      if (!parameters_) throw std::runtime_error("FFmpeg audio stream metadata is unavailable");
      info_.sampleRate = parameters_->sample_rate;
      info_.channels = parameters_->ch_layout.nb_channels;
      info_.bitsPerSample = parameters_->bits_per_raw_sample > 0 ? parameters_->bits_per_raw_sample
          : parameters_->bits_per_coded_sample;
      info_.validBitsPerSample = parameters_->bits_per_raw_sample > 0 ? parameters_->bits_per_raw_sample
          : parameters_->bits_per_coded_sample;
      info_.containerBits = parameters_->bits_per_coded_sample > 0 ? parameters_->bits_per_coded_sample
          : info_.bitsPerSample;
      info_.decoderName = "FFmpeg";
      const AVCodecDescriptor* descriptor = api_.codecDescriptorGet(parameters_->codec_id);
      const bool lossless = descriptor && (descriptor->props & AV_CODEC_PROP_LOSSLESS) != 0;
      const bool pcmCodec = descriptor && descriptor->name && std::strncmp(descriptor->name, "pcm_", 4) == 0;
      const std::string declaredFormat = sampleFormatName(static_cast<AVSampleFormat>(parameters_->format));
      if (pcmCodec) {
        info_.sourceSampleFormat = declaredFormat == "float32" || declaredFormat == "float64"
            ? declaredFormat : declaredFormat.empty() ? std::string() : "pcm";
      } else if (lossless && info_.bitsPerSample > 0) {
        info_.sourceSampleFormat = "pcm";
      }
      if (stream_->duration != AV_NOPTS_VALUE && stream_->duration >= 0 && stream_->time_base.den > 0) {
        info_.duration = static_cast<double>(stream_->duration) * stream_->time_base.num / stream_->time_base.den;
      } else if (format_->duration != AV_NOPTS_VALUE && format_->duration >= 0) {
        info_.duration = static_cast<double>(format_->duration) / AV_TIME_BASE;
      }
      if (info_.sampleRate > 0 && std::isfinite(info_.duration) && info_.duration > 0.0) {
        const long double frameEstimate = static_cast<long double>(info_.duration) * info_.sampleRate;
        if (frameEstimate <= static_cast<long double>(std::numeric_limits<std::uint64_t>::max()))
          info_.totalFrames = static_cast<std::uint64_t>(std::llround(frameEstimate));
      }
      if (pcmCodec && stream_->duration != AV_NOPTS_VALUE && stream_->duration >= 0 && info_.sampleRate > 0) {
        const AVRational sourceTimeBase{1, info_.sampleRate};
        const std::int64_t frames = api_.rescaleQ(stream_->duration, stream_->time_base, sourceTimeBase);
        const std::int64_t roundTrip = api_.rescaleQ(frames, sourceTimeBase, stream_->time_base);
        if (frames >= 0 && roundTrip == stream_->duration) {
          info_.totalFrames = static_cast<std::uint64_t>(frames);
          info_.duration = static_cast<double>(frames) / info_.sampleRate;
          info_.exactFrameCount = true;
        }
      }
      info_.exactInteger = lossless && (info_.bitsPerSample == 16 || info_.bitsPerSample == 24 || info_.bitsPerSample == 32);
      if (info_.sampleRate && (info_.sampleRate < 8000 || info_.sampleRate > 768000))
        throw std::runtime_error("FFmpeg source rate is outside the supported range");
      if (info_.channels && (info_.channels < 1 || info_.channels > 2))
        throw std::runtime_error("FFmpeg source channel count is outside the supported range");
    }

    static std::string sampleFormatName(AVSampleFormat format) {
      switch (format) {
        case AV_SAMPLE_FMT_U8: case AV_SAMPLE_FMT_U8P: return "u8";
        case AV_SAMPLE_FMT_S16: case AV_SAMPLE_FMT_S16P: return "s16";
        case AV_SAMPLE_FMT_S32: case AV_SAMPLE_FMT_S32P: return "s32";
        case AV_SAMPLE_FMT_S64: case AV_SAMPLE_FMT_S64P: return "s64";
        case AV_SAMPLE_FMT_FLT: case AV_SAMPLE_FMT_FLTP: return "float32";
        case AV_SAMPLE_FMT_DBL: case AV_SAMPLE_FMT_DBLP: return "float64";
        default: return {};
      }
    }

    int nextFrame() {
      if (decoderEnded_) return AVERROR_EOF;
      for (;;) {
        int status = api_.codecReceiveFrame(codec_, frame_);
        if (status == 0) { framePending_ = true; return 0; }
        if (status == AVERROR_EOF) { decoderEnded_ = true; return AVERROR_EOF; }
        if (status != AVERROR(EAGAIN)) return status;

        if (packetPending_) {
          status = api_.codecSendPacket(codec_, packet_);
          if (status == 0) {
            api_.packetUnref(packet_);
            packetPending_ = false;
            continue;
          }
          if (status == AVERROR(EAGAIN)) continue;
          return status;
        }

        if (demuxEnded_) {
          if (flushSent_) { decoderEnded_ = true; return AVERROR_EOF; }
          status = api_.codecSendPacket(codec_, nullptr);
          if (status == 0 || status == AVERROR_EOF) { flushSent_ = true; continue; }
          if (status == AVERROR(EAGAIN)) continue;
          return status;
        }

        status = api_.readFrame(format_, packet_);
        if (status == AVERROR_EOF) { demuxEnded_ = true; continue; }
        if (status < 0) return status;
        if (packet_->stream_index != streamIndex_) {
          api_.packetUnref(packet_);
          continue;
        }
        packetPending_ = true;
      }
    }

    bool prepareFirstFrame() {
      const int status = nextFrame();
      if (status == AVERROR_EOF) throw std::runtime_error("Audio stream contains no decoded samples");
      if (status < 0) throw std::runtime_error("FFmpeg could not decode the first audio frame: " + api_.errorText(status));
      std::string error;
      if (!prepareCurrentFrame(error)) throw std::runtime_error(error.empty() ? "Invalid first decoded audio frame" : error);
      return true;
    }

    bool prepareCurrentFrame(std::string& error) {
      if (!frame_ || frame_->nb_samples <= 0) { error = "FFmpeg returned an empty audio frame"; return false; }
      const int channels = frame_->ch_layout.nb_channels > 0
          ? frame_->ch_layout.nb_channels : codec_->ch_layout.nb_channels;
      const int sampleRate = frame_->sample_rate > 0 ? frame_->sample_rate : codec_->sample_rate;
      if (!info_.sampleRate) info_.sampleRate = sampleRate;
      if (!info_.channels) info_.channels = channels;
      const AVSampleFormat actualFormat = static_cast<AVSampleFormat>(frame_->format);
      const AVSampleFormat packedFormat = api_.getPackedSampleFormat(actualFormat);
      if (sampleRate != info_.sampleRate || channels != info_.channels) {
        error = "FFmpeg audio stream changed sample rate or channel count";
        return false;
      }
      if (sampleBytes(packedFormat) == 0) {
        error = "FFmpeg returned an unsupported decoded sample format";
        return false;
      }
      if (decodedFormat_ == AV_SAMPLE_FMT_NONE) {
        decodedFormat_ = packedFormat;
        info_.decodedSampleFormat = sampleFormatName(packedFormat);
        info_.exactInteger = info_.exactInteger &&
            (packedFormat == AV_SAMPLE_FMT_S16 || packedFormat == AV_SAMPLE_FMT_S32);
        if (packedFormat == AV_SAMPLE_FMT_U8)
          info_.decodeMath = "pcm8-unsigned-midpoint-normalized-to-double";
        else if (packedFormat == AV_SAMPLE_FMT_S16 || packedFormat == AV_SAMPLE_FMT_S32 || packedFormat == AV_SAMPLE_FMT_S64)
          info_.decodeMath = "signed-integer-normalized-to-double";
        else if (packedFormat == AV_SAMPLE_FMT_FLT)
          info_.decodeMath = "ieee-float32-widened-to-double";
        else if (packedFormat == AV_SAMPLE_FMT_DBL)
          info_.decodeMath = "ieee-float64-copied";
        else {
          error = "FFmpeg returned an unsupported decoded sample format";
          return false;
        }
        if (info_.sampleRate > 0 && info_.duration > 0.0 && !info_.totalFrames) {
          const long double frames = static_cast<long double>(info_.duration) * info_.sampleRate;
          if (frames <= static_cast<long double>(std::numeric_limits<std::uint64_t>::max()))
            info_.totalFrames = static_cast<std::uint64_t>(std::llround(frames));
        }
      } else if (decodedFormat_ != packedFormat) {
        error = "FFmpeg audio stream changed decoded sample format";
        return false;
      }

      if (seekPending_) {
        std::int64_t timestamp = frame_->best_effort_timestamp;
        if (timestamp == AV_NOPTS_VALUE) timestamp = frame_->pts;
        if (timestamp == AV_NOPTS_VALUE) {
          error = "FFmpeg cannot perform an accurate seek because the decoded frame has no PTS";
          return false;
        }
        const std::int64_t origin = stream_->start_time == AV_NOPTS_VALUE ? 0 : stream_->start_time;
        if ((origin > 0 && timestamp < std::numeric_limits<std::int64_t>::min() + origin) ||
            (origin < 0 && timestamp > std::numeric_limits<std::int64_t>::max() + origin)) {
          error = "FFmpeg seek PTS overflows the source timestamp range";
          return false;
        }
        const AVRational sourceTimeBase{1, info_.sampleRate};
        const std::int64_t frameStart = api_.rescaleQ(timestamp - origin, stream_->time_base, sourceTimeBase);
        if (frameStart > std::numeric_limits<std::int64_t>::max() - frame_->nb_samples) {
          error = "FFmpeg decoded frame end overflows the source timestamp range";
          return false;
        }
        const std::int64_t frameEnd = frameStart + frame_->nb_samples;
        if (frameStart > static_cast<std::int64_t>(seekTargetFrame_)) {
          error = "FFmpeg seek landed after the requested source frame";
          return false;
        }
        if (frameEnd <= static_cast<std::int64_t>(seekTargetFrame_)) {
          api_.frameUnref(frame_);
          framePending_ = false;
          return true;
        }
        frameOffset_ = static_cast<std::size_t>(static_cast<std::int64_t>(seekTargetFrame_) - frameStart);
        seekPending_ = false;
      }
      return true;
    }

    static std::size_t sampleBytes(AVSampleFormat format) {
      switch (format) {
        case AV_SAMPLE_FMT_U8: return sizeof(std::uint8_t);
        case AV_SAMPLE_FMT_S16: return sizeof(std::int16_t);
        case AV_SAMPLE_FMT_S32: return sizeof(std::int32_t);
        case AV_SAMPLE_FMT_S64: return sizeof(std::int64_t);
        case AV_SAMPLE_FMT_FLT: return sizeof(float);
        case AV_SAMPLE_FMT_DBL: return sizeof(double);
        default: return 0;
      }
    }

    double sampleValue(const AVFrame* frame, std::size_t frameIndex, int channel) const {
      const AVSampleFormat actual = static_cast<AVSampleFormat>(frame->format);
      const bool planar = api_.sampleFormatIsPlanar(actual) != 0;
      const std::size_t channels = static_cast<std::size_t>(info_.channels);
      const std::size_t sampleIndex = planar ? frameIndex : frameIndex * channels + static_cast<std::size_t>(channel);
      const int plane = planar ? channel : 0;
      const std::uint8_t* input = frame->extended_data[plane] + sampleIndex * sampleBytes(decodedFormat_);
      switch (decodedFormat_) {
        case AV_SAMPLE_FMT_U8: {
          std::uint8_t value = 0; std::memcpy(&value, input, sizeof(value));
          return (static_cast<int>(value) - 128) / 128.0;
        }
        case AV_SAMPLE_FMT_S16: {
          std::int16_t value = 0; std::memcpy(&value, input, sizeof(value));
          return std::ldexp(static_cast<double>(value), -15);
        }
        case AV_SAMPLE_FMT_S32: {
          std::int32_t value = 0; std::memcpy(&value, input, sizeof(value));
          return std::ldexp(static_cast<double>(value), -31);
        }
        case AV_SAMPLE_FMT_S64: {
          std::int64_t value = 0; std::memcpy(&value, input, sizeof(value));
          return std::ldexp(static_cast<double>(value), -63);
        }
        case AV_SAMPLE_FMT_FLT: {
          float value = 0.0f; std::memcpy(&value, input, sizeof(value));
          return static_cast<double>(value);
        }
        case AV_SAMPLE_FMT_DBL: {
          double value = 0.0; std::memcpy(&value, input, sizeof(value));
          return value;
        }
        default: return 0.0;
      }
    }

    void close() noexcept {
      if (frame_) { api_.frameFree(&frame_); }
      if (packet_) { api_.packetFree(&packet_); }
      if (codec_) { api_.codecFreeContext(&codec_); }
      if (format_) { api_.formatCloseInput(&format_); }
      stream_ = nullptr;
      parameters_ = nullptr;
    }

    std::shared_ptr<FfmpegApi> apiOwner_;
    FfmpegApi& api_;
    std::wstring file_;
    AVFormatContext* format_ = nullptr;
    AVStream* stream_ = nullptr;
    AVCodecParameters* parameters_ = nullptr;
    AVCodecContext* codec_ = nullptr;
    AVPacket* packet_ = nullptr;
    AVFrame* frame_ = nullptr;
    int streamIndex_ = -1;
    bool packetPending_ = false;
    bool framePending_ = false;
    bool demuxEnded_ = false;
    bool flushSent_ = false;
    bool decoderEnded_ = false;
    bool decoderReady_ = false;
    bool seekPending_ = false;
    std::uint64_t seekTargetFrame_ = 0;
    std::size_t frameOffset_ = 0;
    AVSampleFormat decodedFormat_ = AV_SAMPLE_FMT_NONE;
    Info info_;
  };

  class FlacBackend final : public Backend {
   public:
    static std::unique_ptr<FlacBackend> open(const std::wstring& file,
                                             const std::wstring& dllDirectory,
                                             bool oggContainer,
                                             std::uint64_t byteStartOffset = 0) {
      return std::unique_ptr<FlacBackend>(new FlacBackend(file, dllDirectory, oggContainer, byteStartOffset));
    }

    ~FlacBackend() override { close(); }
    const Info& info() const noexcept override { return info_; }

    BackendRead read(double* destination, std::size_t capacityFrames) override {
      BackendRead result;
      std::size_t attempts = 0;
      while (result.frames < capacityFrames) {
        if (stagingOffset_ < stagingFrames_) {
          const std::size_t count = std::min(capacityFrames - result.frames, stagingFrames_ - stagingOffset_);
          std::copy_n(staging_.data() + stagingOffset_ * static_cast<std::size_t>(info_.channels),
                      count * static_cast<std::size_t>(info_.channels),
                      destination + result.frames * static_cast<std::size_t>(info_.channels));
          stagingOffset_ += count;
          result.frames += count;
          continue;
        }
        stagingFrames_ = stagingOffset_ = 0;
        if (eof_) { result.eof = true; break; }
        if (++attempts > 2048) { result.error = "libFLAC produced no samples while decoding"; break; }
        if (!api_->decoderProcessSingle(decoder_)) {
          result.error = callbackError_.empty() ? "libFLAC failed while decoding a frame" : callbackError_;
          break;
        }
        if (!callbackError_.empty()) { result.error = callbackError_; break; }
        const auto state = api_->decoderGetState(decoder_);
        if (state == FLAC__STREAM_DECODER_END_OF_STREAM) {
          eof_ = true;
          result.eof = true;
          break;
        }
        if (state == FLAC__STREAM_DECODER_ABORTED) {
          result.error = "libFLAC aborted while decoding";
          break;
        }
      }
      return result;
    }

    void seek(std::uint64_t frame) override {
      if (info_.exactFrameCount && frame > info_.totalFrames)
        throw std::runtime_error("FLAC seek frame is past STREAMINFO total_samples");
      stagingFrames_ = stagingOffset_ = 0;
      callbackError_.clear();
      eof_ = false;
      seekTargetFrame_ = frame;
      seekTargetPending_ = true;
      if (!api_->decoderSeekAbsolute(decoder_, frame))
        throw std::runtime_error(callbackError_.empty() ? "libFLAC exact sample seek failed" : callbackError_);
      if (!callbackError_.empty()) throw std::runtime_error(callbackError_);
    }

   private:
    FlacBackend(const std::wstring& file, const std::wstring& dllDirectory, bool oggContainer,
                std::uint64_t byteStartOffset)
        : api_(std::make_unique<FlacApi>(dllDirectory)), oggContainer_(oggContainer), byteStartOffset_(byteStartOffset) {
      try {
        handle_ = CreateFileW(file.c_str(), GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL, nullptr);
        if (handle_ == INVALID_HANDLE_VALUE) throw std::runtime_error("FLAC source could not be opened");
        LARGE_INTEGER size{};
        if (!GetFileSizeEx(handle_, &size) || size.QuadPart <= 0)
          throw std::runtime_error("FLAC source length is unavailable");
        physicalFileBytes_ = static_cast<std::uint64_t>(size.QuadPart);
        if (byteStartOffset_ > physicalFileBytes_) throw std::runtime_error("FLAC stream offset is past end of file");
        fileBytes_ = physicalFileBytes_ - byteStartOffset_;
        LARGE_INTEGER start{}; start.QuadPart = static_cast<LONGLONG>(byteStartOffset_);
        if (!SetFilePointerEx(handle_, start, nullptr, FILE_BEGIN))
          throw std::runtime_error("FLAC stream start seek failed (Windows " + std::to_string(GetLastError()) + ")");
        decoder_ = api_->decoderNew();
        if (!decoder_) throw std::runtime_error("libFLAC decoder allocation failed");
        FLAC__StreamDecoderInitStatus initStatus;
        if (oggContainer_) {
          if (!api_->decoderInitOggStream)
            throw std::runtime_error("libFLAC runtime was built without Ogg FLAC support");
          initStatus = api_->decoderInitOggStream(decoder_, readCallback, seekCallback, tellCallback,
              lengthCallback, eofCallback, writeCallback, metadataCallback, errorCallback, this);
        } else {
          initStatus = api_->decoderInitStream(decoder_, readCallback, seekCallback, tellCallback,
              lengthCallback, eofCallback, writeCallback, metadataCallback, errorCallback, this);
        }
        if (initStatus != FLAC__STREAM_DECODER_INIT_STATUS_OK)
          throw std::runtime_error("libFLAC stream initialization failed (status " + std::to_string(static_cast<int>(initStatus)) + ")");
        initialized_ = true;
        if (!api_->decoderReadMetadata(decoder_))
          throw std::runtime_error(callbackError_.empty() ? "libFLAC STREAMINFO metadata could not be read" : callbackError_);
        if (!metadataReady_) throw std::runtime_error("FLAC STREAMINFO metadata is missing");
        if (info_.sampleRate < 8000 || info_.sampleRate > 768000 || info_.channels < 1 || info_.channels > 2)
          throw std::runtime_error("FLAC source format is outside the supported rate/channel range");
        const std::size_t declaredMaxBlock = streamInfo_.max_blocksize ? streamInfo_.max_blocksize : 65536;
        const std::size_t maxBlock = std::clamp<std::size_t>(declaredMaxBlock, 4096, 65536);
        staging_.resize(maxBlock * static_cast<std::size_t>(info_.channels));
      } catch (...) {
        close();
        throw;
      }
    }

    static FLAC__StreamDecoderReadStatus readCallback(const FLAC__StreamDecoder*, FLAC__byte buffer[],
                                                       std::size_t* bytes, void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || !bytes || (!buffer && *bytes)) return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
      if (!*bytes) return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
      const DWORD requested = static_cast<DWORD>(std::min<std::size_t>(*bytes, std::numeric_limits<DWORD>::max()));
      DWORD received = 0;
      if (self->handle_ == INVALID_HANDLE_VALUE || !ReadFile(self->handle_, buffer, requested, &received, nullptr)) {
        self->callbackError_ = "FLAC source read failed (Windows " + std::to_string(GetLastError()) + ")";
        *bytes = 0;
        return FLAC__STREAM_DECODER_READ_STATUS_ABORT;
      }
      *bytes = received;
      return received ? FLAC__STREAM_DECODER_READ_STATUS_CONTINUE : FLAC__STREAM_DECODER_READ_STATUS_END_OF_STREAM;
    }

    static FLAC__StreamDecoderSeekStatus seekCallback(const FLAC__StreamDecoder*, FLAC__uint64 offset,
                                                       void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || self->handle_ == INVALID_HANDLE_VALUE || offset > self->fileBytes_ ||
          self->byteStartOffset_ > static_cast<std::uint64_t>(std::numeric_limits<LONGLONG>::max()) ||
          offset > static_cast<FLAC__uint64>(std::numeric_limits<LONGLONG>::max() - static_cast<LONGLONG>(self->byteStartOffset_)))
        return FLAC__STREAM_DECODER_SEEK_STATUS_ERROR;
      LARGE_INTEGER target{}; target.QuadPart = static_cast<LONGLONG>(self->byteStartOffset_ + offset);
      if (!SetFilePointerEx(self->handle_, target, nullptr, FILE_BEGIN)) {
        self->callbackError_ = "FLAC source seek failed (Windows " + std::to_string(GetLastError()) + ")";
        return FLAC__STREAM_DECODER_SEEK_STATUS_ERROR;
      }
      return FLAC__STREAM_DECODER_SEEK_STATUS_OK;
    }

    static FLAC__StreamDecoderTellStatus tellCallback(const FLAC__StreamDecoder*, FLAC__uint64* offset,
                                                       void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || !offset || self->handle_ == INVALID_HANDLE_VALUE)
        return FLAC__STREAM_DECODER_TELL_STATUS_ERROR;
      LARGE_INTEGER zero{}, position{};
      if (!SetFilePointerEx(self->handle_, zero, &position, FILE_CURRENT)) {
        self->callbackError_ = "FLAC source position query failed (Windows " + std::to_string(GetLastError()) + ")";
        return FLAC__STREAM_DECODER_TELL_STATUS_ERROR;
      }
      if (position.QuadPart < 0 || static_cast<std::uint64_t>(position.QuadPart) < self->byteStartOffset_)
        return FLAC__STREAM_DECODER_TELL_STATUS_ERROR;
      *offset = static_cast<FLAC__uint64>(static_cast<std::uint64_t>(position.QuadPart) - self->byteStartOffset_);
      return FLAC__STREAM_DECODER_TELL_STATUS_OK;
    }

    static FLAC__StreamDecoderLengthStatus lengthCallback(const FLAC__StreamDecoder*, FLAC__uint64* length,
                                                           void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || !length) return FLAC__STREAM_DECODER_LENGTH_STATUS_ERROR;
      *length = self->fileBytes_;
      return FLAC__STREAM_DECODER_LENGTH_STATUS_OK;
    }

    static FLAC__bool eofCallback(const FLAC__StreamDecoder*, void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || self->handle_ == INVALID_HANDLE_VALUE) return true;
      LARGE_INTEGER zero{}, position{};
      if (!SetFilePointerEx(self->handle_, zero, &position, FILE_CURRENT)) return true;
      return position.QuadPart < 0 || static_cast<std::uint64_t>(position.QuadPart) >= self->physicalFileBytes_;
    }

    static FLAC__StreamDecoderWriteStatus writeCallback(const FLAC__StreamDecoder*, const FLAC__Frame* frame,
                                                         const FLAC__int32* const samples[], void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || !frame || !samples) return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
      const auto& header = frame->header;
      if (header.channels != static_cast<unsigned>(self->info_.channels) ||
          header.sample_rate != static_cast<unsigned>(self->info_.sampleRate) ||
          header.bits_per_sample != static_cast<unsigned>(self->info_.bitsPerSample)) {
        self->callbackError_ = "FLAC stream changed its sample rate, channel count, or integer width";
        return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
      }
      std::uint64_t frameStart = 0;
      if (header.number_type == FLAC__FRAME_NUMBER_TYPE_SAMPLE_NUMBER) {
        frameStart = header.number.sample_number;
      } else {
        const std::uint64_t block = self->streamInfo_.max_blocksize;
        const std::uint64_t index = header.number.frame_number;
        if (!block || index > std::numeric_limits<std::uint64_t>::max() / block) {
          self->callbackError_ = "FLAC frame position is unavailable for accurate seek";
          return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
        }
        frameStart = index * block;
      }

      std::size_t skip = 0;
      if (self->seekTargetPending_) {
        if (frameStart > self->seekTargetFrame_) {
          self->callbackError_ = "libFLAC seek landed after the requested source frame";
          return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
        }
        if (frameStart > std::numeric_limits<std::uint64_t>::max() - header.blocksize) {
          self->callbackError_ = "FLAC decoded frame end overflows the source frame range";
          return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
        }
        const std::uint64_t frameEnd = frameStart + header.blocksize;
        if (frameEnd <= self->seekTargetFrame_) return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
        skip = static_cast<std::size_t>(self->seekTargetFrame_ - frameStart);
        self->seekTargetPending_ = false;
      }

      const std::size_t frames = header.blocksize - skip;
      const std::size_t channels = static_cast<std::size_t>(self->info_.channels);
      if (frames > self->staging_.size() / channels) {
        self->callbackError_ = "FLAC frame exceeds the preallocated decoder block";
        return FLAC__STREAM_DECODER_WRITE_STATUS_ABORT;
      }
      const double scale = std::ldexp(1.0, 1 - self->info_.bitsPerSample);
      for (std::size_t frameIndex = 0; frameIndex < frames; ++frameIndex) {
        for (std::size_t channel = 0; channel < channels; ++channel) {
          self->staging_[frameIndex * channels + channel] =
              static_cast<double>(samples[channel][skip + frameIndex]) * scale;
        }
      }
      self->stagingFrames_ = frames;
      self->stagingOffset_ = 0;
      return FLAC__STREAM_DECODER_WRITE_STATUS_CONTINUE;
    }

    static void metadataCallback(const FLAC__StreamDecoder*, const FLAC__StreamMetadata* metadata,
                                 void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (!self || !metadata || metadata->type != FLAC__METADATA_TYPE_STREAMINFO) return;
      self->streamInfo_ = metadata->data.stream_info;
      self->info_.sampleRate = static_cast<int>(self->streamInfo_.sample_rate);
      self->info_.channels = static_cast<int>(self->streamInfo_.channels);
      self->info_.bitsPerSample = static_cast<int>(self->streamInfo_.bits_per_sample);
      self->info_.validBitsPerSample = self->info_.bitsPerSample;
      self->info_.containerBits = self->info_.bitsPerSample;
      self->info_.totalFrames = self->streamInfo_.total_samples;
      self->info_.exactFrameCount = self->streamInfo_.total_samples != 0;
      self->info_.duration = self->info_.sampleRate > 0 && self->info_.exactFrameCount
          ? static_cast<double>(self->info_.totalFrames) / self->info_.sampleRate : 0.0;
      self->info_.decoderName = "libFLAC";
      self->info_.sourceSampleFormat = "pcm";
      self->info_.decodedSampleFormat = "s32";
      self->info_.decodeMath = "flac-signed-integer-normalized-to-double";
      self->info_.exactInteger = self->info_.bitsPerSample == 16 || self->info_.bitsPerSample == 24 ||
          self->info_.bitsPerSample == 32;
      self->metadataReady_ = true;
    }

    static void errorCallback(const FLAC__StreamDecoder*, FLAC__StreamDecoderErrorStatus status,
                              void* clientData) {
      auto* self = static_cast<FlacBackend*>(clientData);
      if (self && self->callbackError_.empty())
        self->callbackError_ = "libFLAC reported a corrupt or undecodable frame (status " +
            std::to_string(static_cast<int>(status)) + ")";
    }

    void close() noexcept {
      if (decoder_) {
        if (initialized_ && api_) api_->decoderFinish(decoder_);
        if (api_) api_->decoderDelete(decoder_);
        decoder_ = nullptr;
      }
      initialized_ = false;
      if (handle_ != INVALID_HANDLE_VALUE) {
        CloseHandle(handle_);
        handle_ = INVALID_HANDLE_VALUE;
      }
    }

    std::unique_ptr<FlacApi> api_;
    FLAC__StreamDecoder* decoder_ = nullptr;
    HANDLE handle_ = INVALID_HANDLE_VALUE;
    std::uint64_t fileBytes_ = 0;
    std::uint64_t physicalFileBytes_ = 0;
    std::uint64_t byteStartOffset_ = 0;
    bool initialized_ = false;
    bool oggContainer_ = false;
    bool metadataReady_ = false;
    bool seekTargetPending_ = false;
    bool eof_ = false;
    std::uint64_t seekTargetFrame_ = 0;
    FLAC__StreamMetadata_StreamInfo streamInfo_{};
    std::vector<double> staging_;
    std::size_t stagingFrames_ = 0;
    std::size_t stagingOffset_ = 0;
    std::string callbackError_;
    Info info_;
  };

  static std::unique_ptr<Backend> openGrowingWave(const std::wstring& file,
                                                   std::uint64_t expectedBytes) {
    if (expectedBytes < 56 || expectedBytes > 2000000056ULL)
      throw std::runtime_error("Invalid Sony PCM cache WAV length");
    return GrowingWaveBackend::open(file, expectedBytes);
  }

  static bool readFileAt(HANDLE handle, std::uint64_t offset, void* destination, DWORD count) {
    if (offset > static_cast<std::uint64_t>(std::numeric_limits<LONGLONG>::max())) return false;
    LARGE_INTEGER position{}; position.QuadPart = static_cast<LONGLONG>(offset);
    DWORD received = 0;
    return SetFilePointerEx(handle, position, nullptr, FILE_BEGIN) &&
        ReadFile(handle, destination, count, &received, nullptr) && received == count;
  }

  static std::optional<std::uint64_t> nativeFlacOffset(const std::wstring& file) {
    HANDLE handle = CreateFileW(file.c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return std::nullopt;
    struct CloseHandleOnExit { HANDLE value; ~CloseHandleOnExit() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); } } close{handle};
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(handle, &size) || size.QuadPart < 4) return std::nullopt;
    std::array<std::uint8_t, 10> header{};
    if (!readFileAt(handle, 0, header.data(), 4)) return std::nullopt;
    if (std::memcmp(header.data(), "fLaC", 4) == 0) return 0;
    if (size.QuadPart < static_cast<LONGLONG>(header.size()) ||
        !readFileAt(handle, 0, header.data(), static_cast<DWORD>(header.size())) ||
        std::memcmp(header.data(), "ID3", 3) != 0)
      return std::nullopt;
    for (std::size_t index = 6; index < 10; ++index) if (header[index] & 0x80) return std::nullopt;
    const std::uint64_t tagBytes = (static_cast<std::uint64_t>(header[6]) << 21) |
        (static_cast<std::uint64_t>(header[7]) << 14) |
        (static_cast<std::uint64_t>(header[8]) << 7) | header[9];
    const std::uint64_t offsets[] = {10 + tagBytes, 20 + tagBytes};
    std::array<std::uint8_t, 4> marker{};
    for (std::size_t index = 0; index < ((header[5] & 0x10) ? 2u : 1u); ++index) {
      const std::uint64_t offset = offsets[index];
      if (offset <= static_cast<std::uint64_t>(size.QuadPart) &&
          static_cast<std::uint64_t>(size.QuadPart) - offset >= marker.size() &&
          readFileAt(handle, offset, marker.data(), static_cast<DWORD>(marker.size())) &&
          std::memcmp(marker.data(), "fLaC", 4) == 0) return offset;
    }
    return std::nullopt;
  }

  static bool oggFlacMapping(const std::wstring& file) {
    HANDLE handle = CreateFileW(file.c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return false;
    struct CloseHandleOnExit { HANDLE value; ~CloseHandleOnExit() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); } } close{handle};
    std::array<std::uint8_t, 27> page{};
    if (!readFileAt(handle, 0, page.data(), static_cast<DWORD>(page.size())) ||
        std::memcmp(page.data(), "OggS", 4) != 0 || page[4] != 0)
      return false;
    const std::size_t segments = page[26];
    std::array<std::uint8_t, 255> lacing{};
    if (!segments || !readFileAt(handle, page.size(), lacing.data(), static_cast<DWORD>(segments))) return false;
    std::size_t packetBytes = 0;
    bool packetComplete = false;
    for (std::size_t index = 0; index < segments; ++index) {
      packetBytes += lacing[index];
      if (lacing[index] < 255) { packetComplete = true; break; }
    }
    if (!packetComplete || packetBytes < 7 || packetBytes > 65536) return false;
    std::array<std::uint8_t, 7> packet{};
    if (!readFileAt(handle, page.size() + segments, packet.data(), static_cast<DWORD>(packet.size()))) return false;
    return packet[0] == 0x7f && std::memcmp(packet.data() + 1, "FLAC", 4) == 0 &&
        packet[5] == 1 && packet[6] == 0;
  }

  // Native and Ogg FLAC markers route straight to libFLAC. FFmpeg is the
  // generic decoder and may only probe other containers to reject wrapped FLAC.
  static std::unique_ptr<Backend> openCodecBackend(const std::wstring& file,
                                                    const std::wstring& dllDirectory);

  explicit PcmFileDecoder(std::unique_ptr<Backend> backend,bool growingInput)
      : backend_(std::move(backend)), info_(backend_->info()),growingInput_(growingInput) {
    if (!backend_) throw std::runtime_error("PCM file decoder backend is unavailable");
    if (info_.sampleRate < 8000 || info_.sampleRate > 768000 || info_.channels < 1 || info_.channels > 2)
      throw std::runtime_error("PCM decoder supports 8–768 kHz mono/stereo sources");
    if (!info_.totalFrames && info_.duration > 0.0)
      info_.totalFrames = static_cast<std::uint64_t>(std::llround(info_.duration * info_.sampleRate));
    if (info_.exactFrameCount && info_.totalFrames && info_.sampleRate > 0)
      info_.duration = static_cast<double>(info_.totalFrames) / info_.sampleRate;

    // The device buffer setting permits two seconds. Keep enough prefetched
    // source frames to satisfy that callback even at the highest source rate.
    const std::uint64_t prefetchFrames = static_cast<std::uint64_t>(info_.sampleRate) * 3;
    ringCapacityFrames_ = static_cast<std::size_t>(std::clamp<std::uint64_t>(prefetchFrames, 65536, 2304000));
    ring_.resize(ringCapacityFrames_ * static_cast<std::size_t>(info_.channels));
    decodeScratch_.resize(kDecodeChunkFrames * static_cast<std::size_t>(info_.channels));
  }

  void prime() {
    if(growingInput_)return;
    const ULONGLONG deadline=GetTickCount64()+2000;
    while(writeIndex_.load(std::memory_order_acquire)<ringCapacityFrames_&&!sourceEnded_.load(std::memory_order_acquire)&&GetTickCount64()<deadline)
      if(WaitForSingleObject(worker_,1)==WAIT_OBJECT_0)break;
    if(workerErrorReady_.load(std::memory_order_acquire))throw std::runtime_error(workerError_);
  }

  void startWorker() {
    stopRequested_.store(false, std::memory_order_release);
    worker_=CreateThread(nullptr,0,[](void* value)->DWORD{static_cast<PcmFileDecoder*>(value)->workerMain();return 0;},this,0,nullptr);
    if(!worker_) {
      stopRequested_.store(true, std::memory_order_release);
      throw std::runtime_error("Cannot create PCM decoder worker");
    }
  }

  void stopWorker() noexcept {
    stopRequested_.store(true, std::memory_order_release);
    producerWake_.notify_all();
    if(worker_){CancelSynchronousIo(worker_);if(WaitForSingleObject(worker_,5000)!=WAIT_OBJECT_0){TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);std::terminate();}CloseHandle(worker_);worker_=nullptr;}
  }

  void workerMain() noexcept {
    auto lastProgress = std::chrono::steady_clock::now();
    try {
      while (!stopRequested_.load(std::memory_order_acquire) && !sourceEnded_.load(std::memory_order_acquire)) {
        const std::uint64_t read = readIndex_.load(std::memory_order_acquire);
        const std::uint64_t written = writeIndex_.load(std::memory_order_relaxed);
        const std::uint64_t occupied = written >= read ? written - read : ringCapacityFrames_;
        if (occupied >= ringCapacityFrames_) {
          std::unique_lock<std::mutex> lock(producerMutex_);
          producerWake_.wait_for(lock, std::chrono::milliseconds(20), [this] {
            const auto r = readIndex_.load(std::memory_order_acquire);
            const auto w = writeIndex_.load(std::memory_order_relaxed);
            return stopRequested_.load(std::memory_order_acquire) || w - r < ringCapacityFrames_;
          });
          continue;
        }

        const std::size_t request = static_cast<std::size_t>(std::min<std::uint64_t>(
            kDecodeChunkFrames, ringCapacityFrames_ - occupied));
        BackendRead block = backend_->read(decodeScratch_.data(), request);
        if (block.frames > request) throw std::runtime_error("PCM decoder returned too many frames");
        if (!block.error.empty()) {
          workerError_ = std::move(block.error);
          workerErrorReady_.store(true, std::memory_order_release);
          sourceEnded_.store(true, std::memory_order_release);
          return;
        }
        if (block.frames) {
          publishFrames(decodeScratch_.data(), block.frames);
          lastProgress = std::chrono::steady_clock::now();
        }
        if (block.eof) {
          sourceEnded_.store(true, std::memory_order_release);
          return;
        }
        if (block.buffering || !block.frames) {
          if (std::chrono::steady_clock::now() - lastProgress > std::chrono::seconds(5) && !block.buffering)
            throw std::runtime_error("PCM decoder stalled without EOF");
          std::unique_lock<std::mutex> lock(producerMutex_);
          producerWake_.wait_for(lock, std::chrono::milliseconds(block.buffering ? 20 : 2), [this] {
            return stopRequested_.load(std::memory_order_acquire);
          });
        }
      }
    } catch (const std::exception& error) {
      workerError_ = error.what();
      workerErrorReady_.store(true, std::memory_order_release);
      sourceEnded_.store(true, std::memory_order_release);
    } catch (...) {
      workerError_ = "Unknown PCM decoder worker failure";
      workerErrorReady_.store(true, std::memory_order_release);
      sourceEnded_.store(true, std::memory_order_release);
    }
  }

  void publishFrames(const double* source, std::size_t frames) noexcept {
    const std::uint64_t written = writeIndex_.load(std::memory_order_relaxed);
    const std::size_t offset = static_cast<std::size_t>(written % ringCapacityFrames_);
    const std::size_t channels = static_cast<std::size_t>(info_.channels);
    const std::size_t first = std::min(frames, ringCapacityFrames_ - offset);
    std::memcpy(ring_.data() + offset * channels, source, first * channels * sizeof(double));
    if (frames > first)
      std::memcpy(ring_.data(), source + first * channels, (frames - first) * channels * sizeof(double));
    writeIndex_.store(written + frames, std::memory_order_release);
  }

  static constexpr std::size_t kDecodeChunkFrames = 4096;
  std::unique_ptr<Backend> backend_;
  Info info_;
  bool growingInput_=false;
  std::size_t ringCapacityFrames_ = 0;
  std::vector<double> ring_;
  std::vector<double> decodeScratch_;
  std::atomic<std::uint64_t> readIndex_{0}, writeIndex_{0}, consumedFrames_{0};
  std::atomic<bool> sourceEnded_{false}, stopRequested_{false}, workerErrorReady_{false};
  std::string workerError_;
  bool workerErrorDelivered_ = false; // Audio callback is the single consumer.
  HANDLE worker_=nullptr;
  std::uint64_t seekBaseFrame_=0;
  std::mutex producerMutex_;
  std::condition_variable producerWake_;
};

inline std::unique_ptr<PcmFileDecoder::Backend> PcmFileDecoder::openCodecBackend(
    const std::wstring& file, const std::wstring& dllDirectory) {
  if (const auto markerOffset = nativeFlacOffset(file))
    return FlacBackend::open(file, dllDirectory, false, *markerOffset);
  if (oggFlacMapping(file)) return FlacBackend::open(file, dllDirectory, true);

  auto ffmpeg = std::make_unique<FfmpegBackend>(file, dllDirectory);
  if (ffmpeg->isFlac())
    throw std::runtime_error("FLAC in this container cannot be passed directly to libFLAC");
  ffmpeg->initializeDecoder();
  return ffmpeg;
}

} // namespace rhine
