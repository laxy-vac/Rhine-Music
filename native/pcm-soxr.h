#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <Windows.h>

#include "../vendor/audio/codec-sdk/include/soxr.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace rhine {

// Bounded streaming adapter for the public libsoxr API. All vectors and the
// stream itself are prepared by configure(); push(), pull() and finish() reuse
// that storage and can run on the PCM render path without allocating buffers.
class PcmSoxrResampler {
public:
    PcmSoxrResampler() = default;
    PcmSoxrResampler(const PcmSoxrResampler&) = delete;
    PcmSoxrResampler& operator=(const PcmSoxrResampler&) = delete;

    ~PcmSoxrResampler() { unconfigure(); }

    void configure(int inputRate, int outputRate, int channels,
                   const std::string& quality = "vhq", double passband = 0.97) {
        if (inputRate <= 0 || outputRate <= 0) {
            throw std::invalid_argument("SoXR PCM resampler rates must be positive");
        }
        if (channels <= 0) throw std::invalid_argument("SoXR PCM resampler channels must be positive");
        if (quality != "hq" && quality != "vhq") {
            throw std::invalid_argument("SoXR quality must be 'hq' or 'vhq'");
        }
        if (!std::isfinite(passband) || passband < 0.85 || passband > 0.995) {
            throw std::invalid_argument("SoXR passband must be between 0.85 and 0.995");
        }

        const std::size_t channelCount = static_cast<std::size_t>(channels);
        if (channelCount > std::numeric_limits<std::size_t>::max() / kOutputQueueCapacityFrames ||
            channelCount > std::numeric_limits<std::size_t>::max() / kOutputBlockFrames) {
            throw std::length_error("SoXR PCM interleaved buffer capacity overflows");
        }

        std::vector<double> nextOutputScratch(kOutputBlockFrames * channelCount);
        std::vector<double> nextOutputRing(kOutputQueueCapacityFrames * channelCount);
        ensureLibrary();

        soxr_io_spec_t io = api_.ioSpec(SOXR_FLOAT64_I, SOXR_FLOAT64_I);
        soxr_quality_spec_t qualitySpec = api_.qualitySpec(
            quality == "hq" ? SOXR_HQ : SOXR_VHQ, SOXR_DOUBLE_PRECISION);
        qualitySpec.passband_end = passband;
        soxr_runtime_spec_t runtime = api_.runtimeSpec(1);
        soxr_error_t error = nullptr;
        soxr_t nextStream = api_.create(static_cast<double>(inputRate), static_cast<double>(outputRate),
                                        static_cast<unsigned>(channels), &error, &io,
                                        &qualitySpec, &runtime);
        if (!nextStream || error) {
            if (nextStream) api_.destroy(nextStream);
            throw std::runtime_error(std::string("Cannot create SoXR resampler: ") +
                                     (error ? error : "unknown error"));
        }

        releaseStream();
        stream_ = nextStream;
        outputScratch_ = std::move(nextOutputScratch);
        outputRing_ = std::move(nextOutputRing);
        inputRate_ = inputRate;
        outputRate_ = outputRate;
        channels_ = channels;
        configured_ = true;
        resetState();
    }

    // Control-thread cleanup when the active engine changes away from SoXR.
    void unconfigure() noexcept {
        releaseStream();
        std::vector<double>().swap(outputScratch_);
        std::vector<double>().swap(outputRing_);
        configured_ = false;
        inputRate_ = outputRate_ = channels_ = 0;
        resetState();
        if (api_.library) FreeLibrary(api_.library);
        api_ = {};
    }

    void reset() {
        requireConfigured();
        if (const char* error = api_.clear(stream_)) {
            throw std::runtime_error(std::string("Cannot reset SoXR resampler: ") + error);
        }
        resetState();
    }

    // Returns the number of interleaved input frames actually accepted by
    // SoXR. A caller must retain and retry any suffix that was not consumed.
    std::size_t push(const double* interleaved, std::size_t inputFrames) {
        requireConfigured();
        if (endOfInput_) throw std::logic_error("cannot push PCM after SoXR finish()");
        checkFrameCount(inputFrames, "input");
        if (inputFrames != 0 && !interleaved) {
            throw std::invalid_argument("SoXR PCM input buffer is null for a non-empty block");
        }
        if (inputFrames > std::numeric_limits<std::uint64_t>::max() - sourceInputFrames_) {
            throw std::length_error("SoXR PCM input frame counter overflows");
        }

        std::size_t consumed = 0;
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        while (consumed < inputFrames) {
            const std::size_t queueFree = kOutputQueueCapacityFrames - outputQueueFrames_;
            const std::size_t outputCapacity = std::min(queueFree, kOutputBlockFrames);
            if (outputCapacity == 0) break;

            const std::size_t inputCount = std::min(kMaxInputBlockFrames, inputFrames - consumed);
            std::size_t inputDone = 0;
            std::size_t outputDone = 0;
            const char* error = api_.process(
                stream_, interleaved + consumed * channelCount, inputCount, &inputDone,
                outputScratch_.data(), outputCapacity, &outputDone);
            if (error) throw std::runtime_error(std::string("SoXR resampling failed: ") + error);
            if (inputDone > inputCount || outputDone > outputCapacity) {
                throw std::runtime_error("SoXR returned an invalid consumed or produced frame count");
            }
            appendToQueue(outputScratch_.data(), outputDone);
            consumed += inputDone;
            sourceInputFrames_ += inputDone;
            if (inputDone == 0 && outputDone == 0) break;
        }
        return consumed;
    }

    // Declares EOF. pull() will continue flushing SoXR until its tail is
    // exhausted or the exact rounded rate-converted frame target is reached.
    void finish() {
        requireConfigured();
        if (endOfInput_) return;
        targetOutputFrames_ = convertedFrameCount(sourceInputFrames_);
        if (deliveredOutputFrames_ > targetOutputFrames_) {
            throw std::runtime_error("SoXR produced more frames than the final PCM output target");
        }
        endOfInput_ = true;
        const std::uint64_t remaining = targetOutputFrames_ - deliveredOutputFrames_;
        if (outputQueueFrames_ > remaining) outputQueueFrames_ = static_cast<std::size_t>(remaining);
        tailComplete_ = remaining == 0 || outputQueueFrames_ >= remaining;
    }

    // Writes at most outputCapacityFrames interleaved frames. Before EOF,
    // output is gated by the frame count supported by accepted input so that
    // a fractional-ratio boundary sample cannot escape before the final size
    // is known.
    std::size_t pull(double* interleavedOutput, std::size_t outputCapacityFrames) {
        requireConfigured();
        checkFrameCount(outputCapacityFrames, "output");
        if (outputCapacityFrames != 0 && !interleavedOutput) {
            throw std::invalid_argument("SoXR PCM output buffer is null for a non-empty block");
        }
        if (outputCapacityFrames == 0) return 0;

        std::size_t written = 0;
        while (written < outputCapacityFrames) {
            const std::uint64_t outputLimit = endOfInput_
                ? targetOutputFrames_ : convertedFrameCount(sourceInputFrames_);
            if (deliveredOutputFrames_ >= outputLimit) {
                if (endOfInput_) {
                    outputQueueFrames_ = 0;
                    tailComplete_ = true;
                }
                break;
            }

            if (outputQueueFrames_ == 0) {
                if (!endOfInput_ || tailComplete_) break;
                generateTail();
                if (outputQueueFrames_ == 0) {
                    if (deliveredOutputFrames_ < targetOutputFrames_) {
                        throw std::runtime_error("SoXR EOF drain ended before the expected PCM frame count");
                    }
                    tailComplete_ = true;
                    break;
                }
            }

            const std::uint64_t targetRemaining = outputLimit - deliveredOutputFrames_;
            const std::size_t count = std::min({
                outputCapacityFrames - written,
                outputQueueFrames_,
                targetRemaining > std::numeric_limits<std::size_t>::max()
                    ? std::numeric_limits<std::size_t>::max()
                    : static_cast<std::size_t>(targetRemaining)});
            if (count == 0) break;

            copyFromQueue(interleavedOutput + written * static_cast<std::size_t>(channels_), count);
            written += count;
            deliveredOutputFrames_ += count;
            outputReadFrame_ = (outputReadFrame_ + count) % kOutputQueueCapacityFrames;
            outputQueueFrames_ -= count;
            if (endOfInput_ && deliveredOutputFrames_ >= targetOutputFrames_) {
                outputQueueFrames_ = 0;
                tailComplete_ = true;
            }
        }
        return written;
    }

    bool drained() const {
        return configured_ && endOfInput_ && tailComplete_ && outputQueueFrames_ == 0;
    }

    std::size_t pendingOutputFrames() const { return queuedFrames(); }
    std::size_t queuedFrames() const { return configured_ ? outputQueueFrames_ : 0; }

    // Estimate the additional input needed for the requested output. SoXR has
    // no exact input-requirement query; the live output delay is included.
    std::size_t inputRequired(std::size_t additionalOutputFrames) const {
        requireConfigured();
        if (additionalOutputFrames == 0) return 0;
        if (endOfInput_) {
            const std::uint64_t available = targetOutputFrames_ - deliveredOutputFrames_;
            if (additionalOutputFrames > available) return std::numeric_limits<std::size_t>::max();
            return 0;
        }

        const std::uint64_t outputLimit = convertedFrameCount(sourceInputFrames_);
        const std::uint64_t safeQueued = outputLimit > deliveredOutputFrames_
            ? std::min<std::uint64_t>(outputQueueFrames_, outputLimit - deliveredOutputFrames_)
            : 0;
        if (additionalOutputFrames <= safeQueued) return 0;
        const std::size_t missingOutput = additionalOutputFrames - static_cast<std::size_t>(safeQueued);
        const double currentDelay = delay();
        const long double neededOutput = static_cast<long double>(missingOutput) + currentDelay;
        const long double sourceNeeded = std::ceil(
            neededOutput * static_cast<long double>(inputRate_) / static_cast<long double>(outputRate_));
        if (!std::isfinite(static_cast<double>(sourceNeeded)) ||
            sourceNeeded > static_cast<long double>(std::numeric_limits<std::size_t>::max())) {
            return std::numeric_limits<std::size_t>::max();
        }
        const std::size_t estimate = static_cast<std::size_t>(sourceNeeded);
        return estimate > std::numeric_limits<std::uint64_t>::max() - sourceInputFrames_
            ? std::numeric_limits<std::size_t>::max()
            : estimate;
    }

    double delay() const {
        requireConfigured();
        const double value = api_.delay(stream_);
        if (!std::isfinite(value)) return 0.0;
        return std::max(0.0, value);
    }

    int latencyFrames() const {
        const double value = delay();
        if (value >= static_cast<double>(std::numeric_limits<int>::max())) {
            return std::numeric_limits<int>::max();
        }
        return static_cast<int>(std::ceil(value));
    }

    int inputRate() const { return inputRate_; }
    int outputRate() const { return outputRate_; }
    int channels() const { return channels_; }
    std::uint64_t inputFramesAccepted() const { return sourceInputFrames_; }
    std::uint64_t outputFramesDelivered() const { return deliveredOutputFrames_; }
    std::uint64_t outputFrameTarget() const { return endOfInput_ ? targetOutputFrames_ : 0; }

private:
    static constexpr std::size_t kMaxInputBlockFrames = 4096;
    static constexpr std::size_t kOutputBlockFrames = 4096;
    static constexpr std::size_t kOutputQueueCapacityFrames = 2 * kOutputBlockFrames + 1;

    using IoSpecFn = decltype(&::soxr_io_spec);
    using QualitySpecFn = decltype(&::soxr_quality_spec);
    using RuntimeSpecFn = decltype(&::soxr_runtime_spec);
    using CreateFn = decltype(&::soxr_create);
    using ProcessFn = decltype(&::soxr_process);
    using ClearFn = decltype(&::soxr_clear);
    using DestroyFn = decltype(&::soxr_delete);
    using DelayFn = decltype(&::soxr_delay);

    struct Api {
        HMODULE library = nullptr;
        IoSpecFn ioSpec = nullptr;
        QualitySpecFn qualitySpec = nullptr;
        RuntimeSpecFn runtimeSpec = nullptr;
        CreateFn create = nullptr;
        ProcessFn process = nullptr;
        ClearFn clear = nullptr;
        DestroyFn destroy = nullptr;
        DelayFn delay = nullptr;
    };

    template <typename Function>
    static Function loadSymbol(HMODULE library, const char* name) {
        const auto symbol = GetProcAddress(library, name);
        if (!symbol) throw std::runtime_error(std::string("soxr.dll is missing required export: ") + name);
        return reinterpret_cast<Function>(symbol);
    }

    static std::wstring executableDirectory() {
        std::vector<wchar_t> path(512);
        for (;;) {
            if (path.size() > static_cast<std::size_t>(std::numeric_limits<DWORD>::max())) {
                throw std::length_error("Executable path is too long to load soxr.dll");
            }
            const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
            if (length == 0) throw std::runtime_error("Cannot locate the executable for loading soxr.dll");
            if (length < path.size() - 1) {
                const std::wstring fullPath(path.data(), length);
                const std::size_t separator = fullPath.find_last_of(L"\\/");
                if (separator == std::wstring::npos) {
                    throw std::runtime_error("Cannot determine the executable directory for soxr.dll");
                }
                return fullPath.substr(0, separator + 1);
            }
            if (path.size() > 32768 / 2) throw std::length_error("Executable path is too long to load soxr.dll");
            path.resize(path.size() * 2);
        }
    }

    void ensureLibrary() {
        if (api_.library) return;
        const std::wstring path = executableDirectory() + L"soxr.dll";
        HMODULE library = LoadLibraryExW(path.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
        if (!library) throw std::runtime_error("Cannot load soxr.dll from the executable directory");
        try {
            Api next;
            next.library = library;
            next.ioSpec = loadSymbol<IoSpecFn>(library, "soxr_io_spec");
            next.qualitySpec = loadSymbol<QualitySpecFn>(library, "soxr_quality_spec");
            next.runtimeSpec = loadSymbol<RuntimeSpecFn>(library, "soxr_runtime_spec");
            next.create = loadSymbol<CreateFn>(library, "soxr_create");
            next.process = loadSymbol<ProcessFn>(library, "soxr_process");
            next.clear = loadSymbol<ClearFn>(library, "soxr_clear");
            next.destroy = loadSymbol<DestroyFn>(library, "soxr_delete");
            next.delay = loadSymbol<DelayFn>(library, "soxr_delay");
            api_ = next;
        } catch (...) {
            FreeLibrary(library);
            throw;
        }
    }

    void requireConfigured() const {
        if (!configured_ || !stream_) throw std::logic_error("PcmSoxrResampler must be configured first");
    }

    void checkFrameCount(std::size_t frames, const char* label) const {
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        if (channelCount != 0 && frames > std::numeric_limits<std::size_t>::max() / channelCount) {
            throw std::length_error(std::string("SoXR PCM ") + label + " frame count overflows");
        }
    }

    std::uint64_t convertedFrameCount(std::uint64_t inputFrames) const {
        const long double exact = static_cast<long double>(inputFrames) *
                                  static_cast<long double>(outputRate_) /
                                  static_cast<long double>(inputRate_);
        if (!std::isfinite(static_cast<double>(exact)) ||
            exact > static_cast<long double>(std::numeric_limits<std::int64_t>::max()) - 0.5L) {
            throw std::length_error("SoXR PCM stream is too long for the output frame counter");
        }
        return static_cast<std::uint64_t>(std::floor(exact + 0.5L));
    }

    void resetState() {
        outputReadFrame_ = 0;
        outputQueueFrames_ = 0;
        sourceInputFrames_ = 0;
        deliveredOutputFrames_ = 0;
        targetOutputFrames_ = 0;
        endOfInput_ = false;
        tailComplete_ = false;
    }

    void appendToQueue(const double* interleaved, std::size_t frames) {
        if (frames == 0) return;
        if (frames > kOutputQueueCapacityFrames - outputQueueFrames_) {
            throw std::runtime_error("SoXR PCM output queue capacity invariant failed");
        }
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        const std::size_t writeFrame = (outputReadFrame_ + outputQueueFrames_) % kOutputQueueCapacityFrames;
        const std::size_t firstFrames = std::min(frames, kOutputQueueCapacityFrames - writeFrame);
        std::copy_n(interleaved, firstFrames * channelCount,
                    outputRing_.data() + writeFrame * channelCount);
        const std::size_t secondFrames = frames - firstFrames;
        if (secondFrames != 0) {
            std::copy_n(interleaved + firstFrames * channelCount, secondFrames * channelCount,
                        outputRing_.data());
        }
        outputQueueFrames_ += frames;
        if (endOfInput_ && outputQueueFrames_ >= targetOutputFrames_ - deliveredOutputFrames_) {
            tailComplete_ = true;
            outputQueueFrames_ = static_cast<std::size_t>(targetOutputFrames_ - deliveredOutputFrames_);
        }
    }

    void copyFromQueue(double* destination, std::size_t frames) const {
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        const std::size_t firstFrames = std::min(frames, kOutputQueueCapacityFrames - outputReadFrame_);
        std::copy_n(outputRing_.data() + outputReadFrame_ * channelCount,
                    firstFrames * channelCount, destination);
        const std::size_t secondFrames = frames - firstFrames;
        if (secondFrames != 0) {
            std::copy_n(outputRing_.data(), secondFrames * channelCount,
                        destination + firstFrames * channelCount);
        }
    }

    void generateTail() {
        if (tailComplete_ || !endOfInput_ || outputQueueFrames_ != 0) return;
        const std::size_t outputCapacity = std::min(
            kOutputQueueCapacityFrames - outputQueueFrames_, kOutputBlockFrames);
        std::size_t inputDone = 0;
        std::size_t outputDone = 0;
        const char* error = api_.process(stream_, nullptr, 0, &inputDone,
                                         outputScratch_.data(), outputCapacity, &outputDone);
        if (error) throw std::runtime_error(std::string("SoXR EOF drain failed: ") + error);
        if (inputDone != 0 || outputDone > outputCapacity) {
            throw std::runtime_error("SoXR returned an invalid EOF drain frame count");
        }
        if (outputDone == 0) {
            tailComplete_ = true;
            return;
        }
        appendToQueue(outputScratch_.data(), outputDone);
        if (!tailComplete_ && outputQueueFrames_ >= targetOutputFrames_ - deliveredOutputFrames_) {
            tailComplete_ = true;
            outputQueueFrames_ = static_cast<std::size_t>(targetOutputFrames_ - deliveredOutputFrames_);
        }
    }

    void releaseStream() noexcept {
        if (stream_ && api_.destroy) api_.destroy(stream_);
        stream_ = nullptr;
        configured_ = false;
    }

    Api api_;
    soxr_t stream_ = nullptr;
    std::vector<double> outputScratch_;
    std::vector<double> outputRing_;
    int inputRate_ = 0;
    int outputRate_ = 0;
    int channels_ = 0;
    std::size_t outputReadFrame_ = 0;
    std::size_t outputQueueFrames_ = 0;
    std::uint64_t sourceInputFrames_ = 0;
    std::uint64_t deliveredOutputFrames_ = 0;
    std::uint64_t targetOutputFrames_ = 0;
    bool configured_ = false;
    bool endOfInput_ = false;
    bool tailComplete_ = false;
};

} // namespace rhine
