#pragma once

#ifndef R8B_PFFFT
#define R8B_PFFFT 0
#elif R8B_PFFFT != 0
#error Rhine PCM resampling uses the bundled Ooura header-only FFT backend.
#endif

#ifndef R8B_PFFFT_DOUBLE
#define R8B_PFFFT_DOUBLE 0
#elif R8B_PFFFT_DOUBLE != 0
#error Rhine PCM resampling uses the bundled Ooura header-only FFT backend.
#endif

#include "../vendor/audio/r8brain/CDSPResampler.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <vector>

namespace rhine {

// Streaming interleaved-double wrapper around one r8brain resampler per
// channel. push() may consume only part of an input block when its bounded
// output queue is full; pull() returns whatever output frames are available.
class PcmResampler {
public:
    void configure(int inputRate, int outputRate, int channels,
                   std::size_t maxInputBlockFrames = 4096) {
        if (inputRate <= 0 || outputRate <= 0) {
            throw std::invalid_argument("PCM resampler rates must be positive");
        }
        if (channels <= 0) throw std::invalid_argument("PCM resampler channels must be positive");
        if (maxInputBlockFrames == 0 ||
            maxInputBlockFrames > static_cast<std::size_t>(std::numeric_limits<int>::max())) {
            throw std::invalid_argument("maxInputBlockFrames must fit a positive r8brain block length");
        }

        std::vector<std::unique_ptr<r8b::CDSPResampler>> nextResamplers;
        nextResamplers.reserve(static_cast<std::size_t>(channels));
        for (int channel = 0; channel < channels; ++channel) {
            nextResamplers.push_back(std::make_unique<r8b::CDSPResampler>(
                static_cast<double>(inputRate), static_cast<double>(outputRate),
                static_cast<int>(maxInputBlockFrames)));
        }

        const int maxOutput = nextResamplers.front()->getMaxOutLen(static_cast<int>(maxInputBlockFrames));
        if (maxOutput <= 0) throw std::runtime_error("r8brain reported an invalid output block capacity");
        const std::size_t outputFrames = static_cast<std::size_t>(maxOutput);
        const std::size_t channelCount = static_cast<std::size_t>(channels);
        if (outputFrames > (std::numeric_limits<std::size_t>::max() - 1) / 2) {
            throw std::length_error("PCM resampler output queue capacity overflows");
        }
        const std::size_t queueFrames = outputFrames * 2 + 1;
        if (queueFrames > std::numeric_limits<std::size_t>::max() / channelCount ||
            outputFrames > std::numeric_limits<std::size_t>::max() / channelCount) {
            throw std::length_error("PCM resampler interleaved buffer capacity overflows");
        }

        std::vector<double> nextInputScratch(maxInputBlockFrames);
        std::vector<double> nextOutputScratch(outputFrames * channelCount);
        std::vector<double> nextOutputRing(queueFrames * channelCount);

        resamplers_ = std::move(nextResamplers);
        inputScratch_ = std::move(nextInputScratch);
        outputScratch_ = std::move(nextOutputScratch);
        outputRing_ = std::move(nextOutputRing);
        inputRate_ = inputRate;
        outputRate_ = outputRate;
        channels_ = channels;
        maxInputBlockFrames_ = maxInputBlockFrames;
        maxOutputBlockFrames_ = outputFrames;
        queueCapacityFrames_ = queueFrames;
        resetState();
        configured_ = true;
    }

    void reset() {
        requireConfigured();
        for (auto& resampler : resamplers_) resampler->clear();
        resetState();
    }

    // Returns the number of interleaved input frames consumed. If fewer than
    // inputFrames are returned, retain and submit the unconsumed suffix later.
    std::size_t push(const double* interleaved, std::size_t inputFrames) {
        requireConfigured();
        if (endOfInput_) throw std::logic_error("cannot push PCM after finish()");
        checkFrameCount(inputFrames, "input");
        if (inputFrames != 0 && interleaved == nullptr) {
            throw std::invalid_argument("PCM input buffer is null for a non-empty block");
        }
        if (inputFrames > std::numeric_limits<std::uint64_t>::max() - sourceInputFrames_) {
            throw std::length_error("PCM resampler input frame counter overflows");
        }

        std::size_t consumed = 0;
        while (consumed < inputFrames) {
            const std::size_t queueFree = queueCapacityFrames_ - outputQueueFrames_;
            if (queueFree < maxOutputBlockFrames_) break;
            const std::size_t chunk = std::min(maxInputBlockFrames_, inputFrames - consumed);
            const double* block = interleaved + consumed * static_cast<std::size_t>(channels_);
            const std::size_t produced = processChunk(block, chunk, false);
            consumed += chunk;
            sourceInputFrames_ += chunk;
            processedInputFrames_ += chunk;
            rawOutputFrames_ += produced;
        }
        return consumed;
    }

    // Requests a bounded zero-padded EOF drain. pull() advances that drain as
    // queue space becomes available, then reports drained() once all valid
    // output frames have been returned.
    void finish() {
        requireConfigured();
        if (endOfInput_) return;

        const long double exactFrames = static_cast<long double>(sourceInputFrames_) *
                                        static_cast<long double>(outputRate_) /
                                        static_cast<long double>(inputRate_);
        if (!std::isfinite(static_cast<double>(exactFrames)) ||
            exactFrames > static_cast<long double>(std::numeric_limits<int>::max())) {
            throw std::length_error("PCM resampler stream is too long for the pinned r8brain frame query");
        }
        std::uint64_t targetOutputFrames = static_cast<std::uint64_t>(std::llround(exactFrames));
        if (deliveredOutputFrames_ > targetOutputFrames) {
            // The streaming API may already have handed out a fractional-ratio
            // boundary sample. Preserve monotonic output accounting.
            targetOutputFrames = deliveredOutputFrames_;
        }

        int requiredInput = 0;
        if (targetOutputFrames != 0) {
            requiredInput = resamplers_.front()->getInputRequiredForOutput(
                static_cast<int>(targetOutputFrames));
            if (requiredInput < 0) throw std::runtime_error("r8brain returned a negative EOF input requirement");
        }
        const std::uint64_t required = static_cast<std::uint64_t>(requiredInput);
        const std::uint64_t base = std::max(required, processedInputFrames_);
        if (base > std::numeric_limits<std::uint64_t>::max() - maxInputBlockFrames_) {
            throw std::length_error("PCM resampler EOF padding limit overflows");
        }
        endOfInput_ = true;
        targetOutputFrames_ = targetOutputFrames;
        const std::uint64_t keepQueued = targetOutputFrames_ - deliveredOutputFrames_;
        if (outputQueueFrames_ > keepQueued) outputQueueFrames_ = static_cast<std::size_t>(keepQueued);
        tailInputLimit_ = base + maxInputBlockFrames_;
        if (targetOutputFrames_ == deliveredOutputFrames_) tailComplete_ = true;
    }

    // Writes up to outputCapacityFrames interleaved frames and returns the
    // number written. EOF tail samples are generated only as pull() needs them.
    std::size_t pull(double* interleavedOutput, std::size_t outputCapacityFrames) {
        requireConfigured();
        checkFrameCount(outputCapacityFrames, "output");
        if (outputCapacityFrames != 0 && interleavedOutput == nullptr) {
            throw std::invalid_argument("PCM output buffer is null for a non-empty block");
        }
        if (outputCapacityFrames == 0) return 0;

        std::size_t written = 0;
        while (written < outputCapacityFrames) {
            if (outputQueueFrames_ == 0 && endOfInput_ && !tailComplete_) generateTail();
            if (outputQueueFrames_ == 0) break;

            std::size_t count = std::min(outputCapacityFrames - written, outputQueueFrames_);
            if (endOfInput_) {
                const std::uint64_t targetRemaining = targetOutputFrames_ - deliveredOutputFrames_;
                count = std::min<std::size_t>(count, static_cast<std::size_t>(targetRemaining));
            }
            if (count == 0) {
                outputQueueFrames_ = 0;
                tailComplete_ = endOfInput_;
                break;
            }

            copyFromQueue(interleavedOutput + written * static_cast<std::size_t>(channels_), count);
            written += count;
            deliveredOutputFrames_ += count;
            outputReadFrame_ = (outputReadFrame_ + count) % queueCapacityFrames_;
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

    std::size_t pendingOutputFrames() const {
        return configured_ ? outputQueueFrames_ : 0;
    }

    // Minimum additional per-channel input frames needed before the requested
    // additional output count can be pulled. SIZE_MAX means the request cannot
    // be met after EOF has been declared.
    std::size_t inputRequired(std::size_t additionalOutputFrames) const {
        requireConfigured();
        if (additionalOutputFrames == 0 || additionalOutputFrames <= outputQueueFrames_) return 0;
        if (additionalOutputFrames > std::numeric_limits<std::uint64_t>::max() - deliveredOutputFrames_) {
            return std::numeric_limits<std::size_t>::max();
        }
        const std::uint64_t totalOutput = deliveredOutputFrames_ + additionalOutputFrames;
        if (endOfInput_ && totalOutput > targetOutputFrames_) return std::numeric_limits<std::size_t>::max();
        if (endOfInput_) return 0;
        if (totalOutput > static_cast<std::uint64_t>(std::numeric_limits<int>::max())) {
            return std::numeric_limits<std::size_t>::max();
        }
        const int required = resamplers_.front()->getInputRequiredForOutput(static_cast<int>(totalOutput));
        if (required <= 0 || static_cast<std::uint64_t>(required) <= processedInputFrames_) return 0;
        const std::uint64_t missing = static_cast<std::uint64_t>(required) - processedInputFrames_;
        if (missing > std::numeric_limits<std::size_t>::max()) return std::numeric_limits<std::size_t>::max();
        return static_cast<std::size_t>(missing);
    }

    int latencyFrames() const {
        requireConfigured();
        return std::max(0, resamplers_.front()->getLatency());
    }

    double latencyFraction() const {
        requireConfigured();
        return resamplers_.front()->getLatencyFrac();
    }

    int inputRate() const { return inputRate_; }
    int outputRate() const { return outputRate_; }
    int channels() const { return channels_; }
    std::uint64_t inputFramesAccepted() const { return sourceInputFrames_; }
    std::uint64_t outputFramesDelivered() const { return deliveredOutputFrames_; }
    std::uint64_t outputFrameTarget() const { return endOfInput_ ? targetOutputFrames_ : 0; }

private:
    void requireConfigured() const {
        if (!configured_) throw std::logic_error("PcmResampler must be configured first");
    }

    void checkFrameCount(std::size_t frames, const char* label) const {
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        if (channelCount != 0 && frames > std::numeric_limits<std::size_t>::max() / channelCount) {
            throw std::length_error(std::string("PCM resampler ") + label + " frame count overflows");
        }
    }

    void resetState() {
        outputReadFrame_ = 0;
        outputQueueFrames_ = 0;
        sourceInputFrames_ = 0;
        processedInputFrames_ = 0;
        rawOutputFrames_ = 0;
        deliveredOutputFrames_ = 0;
        targetOutputFrames_ = 0;
        tailInputLimit_ = 0;
        endOfInput_ = false;
        tailComplete_ = false;
    }

    std::size_t processChunk(const double* input, std::size_t frames, bool syntheticZeroes) {
        if (frames == 0 || frames > maxInputBlockFrames_) {
            throw std::logic_error("internal r8brain input block violates configured bounds");
        }
        std::size_t commonOutputFrames = 0;
        for (int channel = 0; channel < channels_; ++channel) {
            if (syntheticZeroes) {
                std::fill_n(inputScratch_.data(), frames, 0.0);
            } else {
                const std::size_t channelIndex = static_cast<std::size_t>(channel);
                const std::size_t channelCount = static_cast<std::size_t>(channels_);
                for (std::size_t frame = 0; frame < frames; ++frame) {
                    inputScratch_[frame] = input[frame * channelCount + channelIndex];
                }
            }
            double* output = nullptr;
            const int produced = resamplers_[static_cast<std::size_t>(channel)]->process(
                inputScratch_.data(), static_cast<int>(frames), output);
            if (produced < 0 || static_cast<std::size_t>(produced) > maxOutputBlockFrames_ ||
                (produced != 0 && output == nullptr)) {
                throw std::runtime_error("r8brain returned an invalid output block");
            }
            if (channel == 0) {
                commonOutputFrames = static_cast<std::size_t>(produced);
            } else if (commonOutputFrames != static_cast<std::size_t>(produced)) {
                throw std::runtime_error("per-channel r8brain output frame counts diverged");
            }
            const std::size_t channelCount = static_cast<std::size_t>(channels_);
            for (std::size_t frame = 0; frame < commonOutputFrames; ++frame) {
                outputScratch_[frame * channelCount + static_cast<std::size_t>(channel)] = output[frame];
            }
        }

        if (commonOutputFrames != 0) appendToQueue(outputScratch_.data(), commonOutputFrames);
        return commonOutputFrames;
    }

    void appendToQueue(const double* interleaved, std::size_t frames) {
        if (endOfInput_) {
            const std::uint64_t remaining = targetOutputFrames_ - deliveredOutputFrames_ - outputQueueFrames_;
            frames = std::min<std::size_t>(frames, static_cast<std::size_t>(remaining));
        }
        if (frames == 0) return;
        if (frames > queueCapacityFrames_ - outputQueueFrames_) {
            throw std::runtime_error("PCM resampler output queue capacity invariant failed");
        }
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        const std::size_t writeFrame = (outputReadFrame_ + outputQueueFrames_) % queueCapacityFrames_;
        const std::size_t firstFrames = std::min(frames, queueCapacityFrames_ - writeFrame);
        std::copy_n(interleaved, firstFrames * channelCount,
                    outputRing_.data() + writeFrame * channelCount);
        const std::size_t secondFrames = frames - firstFrames;
        if (secondFrames != 0) {
            std::copy_n(interleaved + firstFrames * channelCount, secondFrames * channelCount,
                        outputRing_.data());
        }
        outputQueueFrames_ += frames;
    }

    void copyFromQueue(double* destination, std::size_t frames) const {
        const std::size_t channelCount = static_cast<std::size_t>(channels_);
        const std::size_t firstFrames = std::min(frames, queueCapacityFrames_ - outputReadFrame_);
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
        while (outputQueueFrames_ == 0 && deliveredOutputFrames_ < targetOutputFrames_ &&
               processedInputFrames_ < tailInputLimit_) {
            const std::uint64_t left = tailInputLimit_ - processedInputFrames_;
            const std::size_t chunk = static_cast<std::size_t>(
                std::min<std::uint64_t>(left, maxInputBlockFrames_));
            if (queueCapacityFrames_ - outputQueueFrames_ < maxOutputBlockFrames_) break;
            const std::size_t produced = processChunk(nullptr, chunk, true);
            processedInputFrames_ += chunk;
            rawOutputFrames_ += produced;
        }
        if (deliveredOutputFrames_ >= targetOutputFrames_) {
            outputQueueFrames_ = 0;
            tailComplete_ = true;
        } else if (processedInputFrames_ >= tailInputLimit_) {
            if (outputQueueFrames_ == 0) {
                throw std::runtime_error("r8brain EOF padding ended before the expected output frame count");
            }
            tailComplete_ = true;
        }
    }

    std::vector<std::unique_ptr<r8b::CDSPResampler>> resamplers_;
    std::vector<double> inputScratch_;
    std::vector<double> outputScratch_;
    std::vector<double> outputRing_;
    int inputRate_ = 0;
    int outputRate_ = 0;
    int channels_ = 0;
    std::size_t maxInputBlockFrames_ = 0;
    std::size_t maxOutputBlockFrames_ = 0;
    std::size_t queueCapacityFrames_ = 0;
    std::size_t outputReadFrame_ = 0;
    std::size_t outputQueueFrames_ = 0;
    std::uint64_t sourceInputFrames_ = 0;
    std::uint64_t processedInputFrames_ = 0;
    std::uint64_t rawOutputFrames_ = 0;
    std::uint64_t deliveredOutputFrames_ = 0;
    std::uint64_t targetOutputFrames_ = 0;
    std::uint64_t tailInputLimit_ = 0;
    bool configured_ = false;
    bool endOfInput_ = false;
    bool tailComplete_ = false;
};

} // namespace rhine
