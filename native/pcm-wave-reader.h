#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace rhine {

enum class WaveSampleFormat {
    PcmInteger,
    IeeeFloat32,
    IeeeFloat64
};

enum class WaveDecodeMath {
    Pcm8UnsignedMidpoint,
    SignedIntegerNormalized,
    SignedIntegerLeftAlignedValidBits,
    IeeeFloat32Widened,
    IeeeFloat64Copied
};

struct WaveOpenOptions {
    bool growing = false;
    // Expected final physical file length, including RIFF/WAVE headers.
    // This only distinguishes buffering from final truncation; it never
    // extends the RIFF or data chunk's declared readable range.
    std::optional<std::uint64_t> expectedBytes;
};

struct WaveReadResult {
    std::size_t frames = 0;
    bool eof = false;
    bool buffering = false;
    std::string error;
};

struct WaveInfo {
    std::uint32_t sampleRate = 0;
    std::uint32_t channels = 0;
    std::uint32_t bitsPerSample = 0; // Storage/container width per channel.
    std::uint32_t validBitsPerSample = 0; // Meaningful sample bits.
    WaveSampleFormat format = WaveSampleFormat::PcmInteger;
    WaveDecodeMath decodeMath = WaveDecodeMath::SignedIntegerNormalized;
    std::uint64_t sourceFrameCount = 0;
    std::uint64_t positionFrames = 0;
    std::uint64_t dataOffsetBytes = 0;
    std::uint64_t dataBytes = 0;
    double durationSeconds = 0.0;
    bool growing = false;
};

// Incremental RIFF/WAVE reader for mono or multichannel PCM playback. It owns
// a Win32 handle opened with read/write/delete sharing so producers may append
// to a growing file. The class is single-consumer and must not be read from
// multiple threads at once.
class WavePcmReader {
public:
    static std::unique_ptr<WavePcmReader> tryOpen(const std::wstring& path,
                                                   WaveOpenOptions options = {},
                                                   std::string* error = nullptr) {
        clearError(error);
        if (options.expectedBytes && *options.expectedBytes < 12) {
            setError(error, "invalid WAV: expectedBytes is smaller than a RIFF/WAVE header");
            return nullptr;
        }

        HANDLE handle = CreateFileW(path.c_str(), GENERIC_READ,
                                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                    nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (handle == INVALID_HANDLE_VALUE) {
            setError(error, "I/O: CreateFileW failed with Win32 error " + std::to_string(GetLastError()));
            return nullptr;
        }

        std::unique_ptr<WavePcmReader> reader(new WavePcmReader(handle, options));
        try {
            if (!reader->parse(error)) return nullptr;
        } catch (const std::exception& exception) {
            setError(error, std::string("invalid WAV: ") + exception.what());
            return nullptr;
        }
        return reader;
    }

    // Convenience overload for callers that only need the growing-file flag.
    static std::unique_ptr<WavePcmReader> tryOpen(const std::wstring& path, bool growing,
                                                   std::string* error = nullptr) {
        WaveOpenOptions options;
        options.growing = growing;
        return tryOpen(path, options, error);
    }

    ~WavePcmReader() {
        if (handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_);
    }

    WavePcmReader(const WavePcmReader&) = delete;
    WavePcmReader& operator=(const WavePcmReader&) = delete;
    WavePcmReader(WavePcmReader&&) = delete;
    WavePcmReader& operator=(WavePcmReader&&) = delete;

    WaveReadResult read(double* interleaved, std::size_t capacityFrames) {
        WaveReadResult result;
        if (capacityFrames != 0 && interleaved == nullptr) {
            result.error = "PCM output pointer is null for a non-empty read";
            return result;
        }
        if (channels_ != 0 && capacityFrames > std::numeric_limits<std::size_t>::max() / channels_) {
            result.error = "PCM output frame capacity overflows the interleaved sample count";
            return result;
        }
        if (failed_) {
            result.error = stickyError_;
            return result;
        }
        if (positionFrames_ >= sourceFrameCount_) {
            result.eof = true;
            return result;
        }

        while (result.frames < capacityFrames && positionFrames_ < sourceFrameCount_) {
            std::uint64_t physicalBytes = 0;
            if (!fileSize(physicalBytes, result.error)) {
                failSticky(result.error);
                return result;
            }
            if (expectedBytes_ && physicalBytes > *expectedBytes_) {
                result.error = "WAV file grew beyond expectedBytes";
                failSticky(result.error);
                return result;
            }

            const std::uint64_t bytePosition = positionFrames_ * blockAlign_;
            const std::uint64_t absoluteOffset = dataOffsetBytes_ + bytePosition;
            const std::uint64_t logicalRemainingBytes = dataBytes_ - bytePosition;
            const std::uint64_t physicalRemainingBytes = physicalBytes > absoluteOffset
                ? physicalBytes - absoluteOffset : 0;
            const std::uint64_t readableBytes = std::min(logicalRemainingBytes, physicalRemainingBytes);
            const std::uint64_t readableFrames = readableBytes / blockAlign_;
            if (readableFrames == 0) {
                if (isExpectedFinalSizeReached(physicalBytes)) {
                    result.error = "WAV ended before its declared data chunk tail";
                    failSticky(result.error);
                } else if (growing_) {
                    result.buffering = true;
                } else {
                    result.error = "WAV file is truncated before its declared data chunk tail";
                    failSticky(result.error);
                }
                break;
            }

            const std::size_t framesToRead = static_cast<std::size_t>(std::min<std::uint64_t>({
                readableFrames,
                static_cast<std::uint64_t>(capacityFrames - result.frames),
                static_cast<std::uint64_t>(maxScratchFrames_)
            }));
            const std::size_t bytesToRead = framesToRead * blockAlign_;
            DWORD bytesRead = 0;
            std::string ioError;
            if (!readAt(absoluteOffset, scratch_.data(), static_cast<DWORD>(bytesToRead), bytesRead, ioError)) {
                result.error = ioError;
                failSticky(result.error);
                return result;
            }

            const std::size_t completeFrames = bytesRead / blockAlign_;
            if (completeFrames == 0) {
                if (isExpectedFinalSizeReached(physicalBytes)) {
                    result.error = "WAV ended in the middle of a sample frame";
                    failSticky(result.error);
                } else if (growing_) {
                    result.buffering = true;
                } else {
                    result.error = "WAV read ended in the middle of a sample frame";
                    failSticky(result.error);
                }
                break;
            }

            for (std::size_t frame = 0; frame < completeFrames; ++frame) {
                const std::uint8_t* source = scratch_.data() + frame * blockAlign_;
                double* destination = interleaved + result.frames * channels_;
                std::string decodeError;
                if (!decodeFrame(source, destination, decodeError)) {
                    result.error = decodeError;
                    failSticky(result.error);
                    return result;
                }
                ++result.frames;
                ++positionFrames_;
            }
        }

        if (positionFrames_ >= sourceFrameCount_) result.eof = true;
        return result;
    }

    WaveInfo info() const {
        WaveInfo result;
        result.sampleRate = sampleRate_;
        result.channels = channels_;
        result.bitsPerSample = bitsPerSample_;
        result.validBitsPerSample = validBitsPerSample_;
        result.format = format_;
        result.decodeMath = decodeMath_;
        result.sourceFrameCount = sourceFrameCount_;
        result.positionFrames = positionFrames_;
        result.dataOffsetBytes = dataOffsetBytes_;
        result.dataBytes = dataBytes_;
        result.durationSeconds = sampleRate_ == 0 ? 0.0
            : static_cast<double>(sourceFrameCount_) / static_cast<double>(sampleRate_);
        result.growing = growing_;
        return result;
    }

    bool seek(std::uint64_t frame, std::string* error = nullptr) {
        clearError(error);
        if (frame > sourceFrameCount_) {
            setError(error, "seek frame is past the declared WAV data end");
            return false;
        }
        positionFrames_ = frame;
        failed_ = false;
        stickyError_.clear();
        return true;
    }

    void reset() {
        positionFrames_ = 0;
        failed_ = false;
        stickyError_.clear();
    }

    std::uint32_t sampleRate() const { return sampleRate_; }
    std::uint32_t channels() const { return channels_; }
    std::uint32_t bitsPerSample() const { return bitsPerSample_; }
    std::uint32_t validBitsPerSample() const { return validBitsPerSample_; }
    WaveSampleFormat format() const { return format_; }
    WaveDecodeMath decodeMath() const { return decodeMath_; }
    std::uint64_t sourceFrameCount() const { return sourceFrameCount_; }
    std::uint64_t positionFrames() const { return positionFrames_; }
    double durationSeconds() const {
        return sampleRate_ == 0 ? 0.0 : static_cast<double>(sourceFrameCount_) / sampleRate_;
    }

private:
    static constexpr std::size_t kMaximumChunks = 4096;
    static constexpr std::uint32_t kMaximumFormatChunkBytes = 65536;
    static constexpr std::size_t kMaximumScratchFrames = 4096;

    WavePcmReader(HANDLE handle, const WaveOpenOptions& options)
        : handle_(handle), growing_(options.growing), expectedBytes_(options.expectedBytes) {}

    static void clearError(std::string* error) {
        if (error != nullptr) error->clear();
    }

    static void setError(std::string* error, const std::string& value) {
        if (error != nullptr) *error = value;
    }

    static std::uint16_t readU16(const std::uint8_t* bytes) {
        return static_cast<std::uint16_t>(bytes[0]) |
               (static_cast<std::uint16_t>(bytes[1]) << 8);
    }

    static std::uint32_t readU32(const std::uint8_t* bytes) {
        return static_cast<std::uint32_t>(bytes[0]) |
               (static_cast<std::uint32_t>(bytes[1]) << 8) |
               (static_cast<std::uint32_t>(bytes[2]) << 16) |
               (static_cast<std::uint32_t>(bytes[3]) << 24);
    }

    bool fileSize(std::uint64_t& size, std::string& error) const {
        LARGE_INTEGER nativeSize{};
        if (!GetFileSizeEx(handle_, &nativeSize)) {
            error = "I/O: GetFileSizeEx failed with Win32 error " + std::to_string(GetLastError());
            return false;
        }
        if (nativeSize.QuadPart < 0) {
            error = "I/O: GetFileSizeEx returned a negative file size";
            return false;
        }
        size = static_cast<std::uint64_t>(nativeSize.QuadPart);
        return true;
    }

    bool readAt(std::uint64_t offset, void* destination, DWORD bytes,
                DWORD& bytesRead, std::string& error) const {
        if (offset > static_cast<std::uint64_t>(std::numeric_limits<LONGLONG>::max())) {
            error = "I/O: WAV file offset exceeds Win32 file-pointer range";
            return false;
        }
        LARGE_INTEGER position{};
        position.QuadPart = static_cast<LONGLONG>(offset);
        if (!SetFilePointerEx(handle_, position, nullptr, FILE_BEGIN)) {
            error = "I/O: SetFilePointerEx failed with Win32 error " + std::to_string(GetLastError());
            return false;
        }
        bytesRead = 0;
        if (!ReadFile(handle_, destination, bytes, &bytesRead, nullptr)) {
            error = "I/O: ReadFile failed with Win32 error " + std::to_string(GetLastError());
            return false;
        }
        return true;
    }

    bool readExactAt(std::uint64_t offset, void* destination, DWORD bytes, std::string& error) const {
        DWORD actual = 0;
        if (!readAt(offset, destination, bytes, actual, error)) return false;
        if (actual != bytes) {
            error = "WAV header is incomplete at the current file size";
            return false;
        }
        return true;
    }

    bool parse(std::string* error) {
        std::uint64_t actualFileBytes = 0;
        std::string ioError;
        if (!fileSize(actualFileBytes, ioError)) {
            setError(error, ioError);
            return false;
        }
        if (expectedBytes_ && actualFileBytes > *expectedBytes_) {
            setError(error, "invalid WAV: physical file already exceeds expectedBytes");
            return false;
        }
        if (actualFileBytes < 12) {
            setError(error, growing_ ? "buffering: RIFF/WAVE header is not complete yet"
                                     : "invalid WAV: file is shorter than the RIFF/WAVE header");
            return false;
        }

        std::array<std::uint8_t, 12> riff{};
        if (!readExactAt(0, riff.data(), static_cast<DWORD>(riff.size()), ioError)) {
            setError(error, ioError);
            return false;
        }
        if (fourcc(riff.data(), "RF64")) {
            setError(error, "unsupported: RF64 WAV is not supported by the PCM reader");
            return false;
        }
        if (fourcc(riff.data(), "RIFX")) {
            setError(error, "unsupported: big-endian RIFX WAV is not supported");
            return false;
        }
        if (!fourcc(riff.data(), "RIFF") || !fourcc(riff.data() + 8, "WAVE")) {
            setError(error, "unsupported: input is not a little-endian RIFF/WAVE file");
            return false;
        }

        const std::uint64_t riffEnd = 8ull + readU32(riff.data() + 4);
        if (riffEnd < 12) {
            setError(error, "invalid WAV: RIFF size does not include the WAVE form type");
            return false;
        }
        if (expectedBytes_ && *expectedBytes_ < riffEnd) {
            setError(error, "invalid WAV: expectedBytes is shorter than the declared RIFF extent");
            return false;
        }
        if (!growing_ && actualFileBytes < riffEnd) {
            setError(error, "invalid WAV: physical file is shorter than the declared RIFF extent");
            return false;
        }
        if (!growing_ && expectedBytes_ && actualFileBytes < *expectedBytes_) {
            setError(error, "invalid WAV: physical file is shorter than expectedBytes");
            return false;
        }

        bool foundFormat = false;
        bool foundData = false;
        ParsedFormat parsed{};
        std::uint64_t offset = 12;
        std::size_t scanned = 0;
        while (offset <= riffEnd && riffEnd - offset >= 8 && scanned < kMaximumChunks) {
            ++scanned;
            std::array<std::uint8_t, 8> chunkHeader{};
            if (!readExactAt(offset, chunkHeader.data(), static_cast<DWORD>(chunkHeader.size()), ioError)) {
                setError(error, growing_ ? "buffering: RIFF chunk headers are not complete yet"
                                         : "invalid WAV: truncated RIFF chunk header");
                return false;
            }
            const std::uint32_t chunkBytes = readU32(chunkHeader.data() + 4);
            const std::uint64_t chunkStart = offset + 8;
            const std::uint64_t chunkEnd = chunkStart + static_cast<std::uint64_t>(chunkBytes);
            const std::uint64_t paddedEnd = chunkEnd + (chunkBytes & 1u);
            if (chunkEnd < chunkStart || paddedEnd < chunkEnd || paddedEnd > riffEnd) {
                setError(error, "invalid WAV: RIFF chunk exceeds the declared RIFF extent");
                return false;
            }

            if (fourcc(chunkHeader.data(), "fmt ")) {
                if (foundFormat) {
                    setError(error, "unsupported: multiple fmt chunks are not handled");
                    return false;
                }
                if (!parseFormat(chunkStart, chunkBytes, parsed, error)) return false;
                foundFormat = true;
            } else if (fourcc(chunkHeader.data(), "data")) {
                if (foundData) {
                    setError(error, "unsupported: multiple data chunks are not handled");
                    return false;
                }
                foundData = true;
                dataOffsetBytes_ = chunkStart;
                dataBytes_ = chunkBytes;
            }

            offset = paddedEnd;
            if (foundFormat && foundData) break;
        }
        if (scanned >= kMaximumChunks && !(foundFormat && foundData)) {
            setError(error, "invalid WAV: RIFF metadata exceeds the bounded chunk scan limit");
            return false;
        }
        if (!foundFormat || !foundData) {
            setError(error, growing_ ? "buffering: WAV fmt/data chunk headers are not complete yet"
                                     : "invalid WAV: required fmt or data chunk is missing");
            return false;
        }

        if (parsed.channels == 0 || parsed.channels > 8) {
            setError(error, "unsupported: WAV channel count must be between 1 and 8");
            return false;
        }
        if (parsed.sampleRate == 0 || parsed.sampleRate > static_cast<std::uint32_t>(std::numeric_limits<int>::max())) {
            setError(error, "invalid WAV: sample rate is outside the supported range");
            return false;
        }
        if (parsed.blockAlign == 0 || parsed.blockAlign != parsed.channels * (parsed.bitsPerSample / 8u)) {
            setError(error, "invalid WAV: blockAlign does not match channels and container width");
            return false;
        }
        const std::uint64_t expectedAverage = static_cast<std::uint64_t>(parsed.sampleRate) * parsed.blockAlign;
        if (expectedAverage > std::numeric_limits<std::uint32_t>::max() || parsed.averageBytesPerSecond != expectedAverage) {
            setError(error, "invalid WAV: average byte rate does not match sample rate and blockAlign");
            return false;
        }
        if (dataBytes_ % parsed.blockAlign != 0) {
            setError(error, "invalid WAV: data chunk ends with a partial sample frame");
            return false;
        }

        const std::uint64_t dataEnd = dataOffsetBytes_ + dataBytes_;
        if (dataEnd < dataOffsetBytes_ || dataEnd > riffEnd) {
            setError(error, "invalid WAV: data chunk exceeds the declared RIFF extent");
            return false;
        }
        if (expectedBytes_ && *expectedBytes_ < dataEnd) {
            setError(error, "invalid WAV: expectedBytes is shorter than the declared data chunk");
            return false;
        }
        if (!growing_ && actualFileBytes < dataEnd) {
            setError(error, "invalid WAV: data chunk extends past the physical file");
            return false;
        }

        sampleRate_ = parsed.sampleRate;
        channels_ = parsed.channels;
        bitsPerSample_ = parsed.bitsPerSample;
        validBitsPerSample_ = parsed.validBitsPerSample;
        blockAlign_ = parsed.blockAlign;
        format_ = parsed.format;
        decodeMath_ = parsed.decodeMath;
        sourceFrameCount_ = dataBytes_ / blockAlign_;
        maxScratchFrames_ = kMaximumScratchFrames;
        if (maxScratchFrames_ > std::numeric_limits<std::size_t>::max() / blockAlign_) {
            setError(error, "invalid WAV: bounded decode scratch size overflows");
            return false;
        }
        scratch_.resize(maxScratchFrames_ * blockAlign_);
        return true;
    }

    struct ParsedFormat {
        std::uint32_t sampleRate = 0;
        std::uint32_t averageBytesPerSecond = 0;
        std::uint16_t channels = 0;
        std::uint16_t blockAlign = 0;
        std::uint16_t bitsPerSample = 0;
        std::uint16_t validBitsPerSample = 0;
        WaveSampleFormat format = WaveSampleFormat::PcmInteger;
        WaveDecodeMath decodeMath = WaveDecodeMath::SignedIntegerNormalized;
    };

    bool parseFormat(std::uint64_t offset, std::uint32_t size, ParsedFormat& parsed,
                     std::string* error) const {
        if (size < 16) {
            setError(error, "invalid WAV: fmt chunk is shorter than WAVEFORMAT's fixed fields");
            return false;
        }
        if (size > kMaximumFormatChunkBytes) {
            setError(error, "invalid WAV: fmt chunk exceeds the bounded format scan limit");
            return false;
        }
        std::array<std::uint8_t, 40> bytes{};
        const DWORD toRead = static_cast<DWORD>(std::min<std::uint32_t>(size, static_cast<std::uint32_t>(bytes.size())));
        DWORD actual = 0;
        std::string ioError;
        if (!readAt(offset, bytes.data(), toRead, actual, ioError)) {
            setError(error, ioError);
            return false;
        }
        if (actual != toRead) {
            setError(error, growing_ ? "buffering: fmt chunk is not fully available yet"
                                     : "invalid WAV: truncated fmt chunk");
            return false;
        }

        const std::uint16_t tag = readU16(bytes.data());
        parsed.channels = readU16(bytes.data() + 2);
        parsed.sampleRate = readU32(bytes.data() + 4);
        parsed.averageBytesPerSecond = readU32(bytes.data() + 8);
        parsed.blockAlign = readU16(bytes.data() + 12);
        parsed.bitsPerSample = readU16(bytes.data() + 14);
        parsed.validBitsPerSample = parsed.bitsPerSample;

        std::uint16_t effectiveTag = tag;
        if (tag == 0xfffe) {
            if (size < 40 || readU16(bytes.data() + 16) < 22) {
                setError(error, "invalid WAV: extensible fmt chunk lacks the 22-byte extension");
                return false;
            }
            const std::uint16_t extensionBytes = readU16(bytes.data() + 16);
            if (static_cast<std::uint32_t>(extensionBytes) + 18u > size) {
                setError(error, "invalid WAV: extensible fmt size exceeds its chunk");
                return false;
            }
            parsed.validBitsPerSample = readU16(bytes.data() + 18);
            const std::uint8_t* guid = bytes.data() + 24;
            static constexpr std::array<std::uint8_t, 16> pcmGuid = {
                0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71
            };
            static constexpr std::array<std::uint8_t, 16> floatGuid = {
                0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
                0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71
            };
            if (std::equal(pcmGuid.begin(), pcmGuid.end(), guid)) {
                effectiveTag = 1;
            } else if (std::equal(floatGuid.begin(), floatGuid.end(), guid)) {
                effectiveTag = 3;
            } else {
                setError(error, "unsupported: WAVEFORMATEXTENSIBLE subformat is not PCM or IEEE float");
                return false;
            }
        } else if (size >= 18) {
            const std::uint16_t extensionBytes = readU16(bytes.data() + 16);
            if (static_cast<std::uint32_t>(extensionBytes) + 18u > size) {
                setError(error, "invalid WAV: WAVEFORMATEX extension size exceeds its fmt chunk");
                return false;
            }
        }

        if (effectiveTag == 1) {
            parsed.format = WaveSampleFormat::PcmInteger;
            if (parsed.bitsPerSample != 8 && parsed.bitsPerSample != 16 &&
                parsed.bitsPerSample != 24 && parsed.bitsPerSample != 32) {
                setError(error, "unsupported: PCM container width must be 8, 16, 24, or 32 bits");
                return false;
            }
            if (parsed.validBitsPerSample == 0 || parsed.validBitsPerSample > parsed.bitsPerSample) {
                setError(error, "invalid WAV: PCM validBitsPerSample is outside the container width");
                return false;
            }
            parsed.decodeMath = parsed.bitsPerSample == 8
                ? WaveDecodeMath::Pcm8UnsignedMidpoint
                : (parsed.validBitsPerSample < parsed.bitsPerSample
                    ? WaveDecodeMath::SignedIntegerLeftAlignedValidBits
                    : WaveDecodeMath::SignedIntegerNormalized);
        } else if (effectiveTag == 3) {
            if (parsed.bitsPerSample == 32) {
                parsed.format = WaveSampleFormat::IeeeFloat32;
                parsed.decodeMath = WaveDecodeMath::IeeeFloat32Widened;
            } else if (parsed.bitsPerSample == 64) {
                parsed.format = WaveSampleFormat::IeeeFloat64;
                parsed.decodeMath = WaveDecodeMath::IeeeFloat64Copied;
            } else {
                setError(error, "unsupported: IEEE float WAV must use 32- or 64-bit containers");
                return false;
            }
            if (parsed.validBitsPerSample != parsed.bitsPerSample) {
                setError(error, "unsupported: IEEE float validBitsPerSample must match its container width");
                return false;
            }
        } else {
            setError(error, "unsupported: compressed or unknown WAVEFORMAT tag " + std::to_string(tag));
            return false;
        }

        if (parsed.channels == 0 || parsed.bitsPerSample == 0 || parsed.bitsPerSample % 8 != 0) {
            setError(error, "invalid WAV: zero channels or non-byte-aligned container width");
            return false;
        }
        return true;
    }

    bool decodeFrame(const std::uint8_t* source, double* destination, std::string& error) const {
        const std::size_t bytesPerSample = bitsPerSample_ / 8u;
        for (std::uint32_t channel = 0; channel < channels_; ++channel) {
            const std::uint8_t* sample = source + static_cast<std::size_t>(channel) * bytesPerSample;
            double decoded = 0.0;
            if (format_ == WaveSampleFormat::PcmInteger) {
                std::int64_t integer = 0;
                if (bitsPerSample_ == 8) {
                    const std::uint32_t unsignedCode = sample[0] >> (8u - validBitsPerSample_);
                    integer = static_cast<std::int64_t>(unsignedCode) -
                              (static_cast<std::int64_t>(1) << (validBitsPerSample_ - 1u));
                } else {
                    integer = validBitsPerSample_ < bitsPerSample_
                        ? readLeftAlignedSignedInteger(sample, bitsPerSample_, validBitsPerSample_)
                        : readSignedInteger(sample, bitsPerSample_);
                }
                const double scale = std::ldexp(1.0, static_cast<int>(validBitsPerSample_ - 1u));
                decoded = static_cast<double>(integer) / scale;
            } else if (format_ == WaveSampleFormat::IeeeFloat32) {
                const std::uint32_t raw = readU32(sample);
                float value = 0.0f;
                std::memcpy(&value, &raw, sizeof(value));
                if (!std::isfinite(value)) {
                    error = "invalid WAV: non-finite IEEE float32 sample at frame " +
                            std::to_string(positionFrames_) + ", channel " + std::to_string(channel);
                    return false;
                }
                decoded = static_cast<double>(value);
            } else {
                const std::uint64_t raw = readU64(sample);
                double value = 0.0;
                std::memcpy(&value, &raw, sizeof(value));
                if (!std::isfinite(value)) {
                    error = "invalid WAV: non-finite IEEE float64 sample at frame " +
                            std::to_string(positionFrames_) + ", channel " + std::to_string(channel);
                    return false;
                }
                decoded = value;
            }
            destination[channel] = decoded;
        }
        return true;
    }

    static std::int64_t readSignedInteger(const std::uint8_t* bytes, std::uint32_t bits) {
        if (bits == 16) {
            const std::uint32_t raw = readU16(bytes);
            return raw < 0x8000u ? static_cast<std::int64_t>(raw)
                                 : static_cast<std::int64_t>(raw) - 0x10000ll;
        }
        if (bits == 24) {
            const std::uint32_t raw = static_cast<std::uint32_t>(bytes[0]) |
                                      (static_cast<std::uint32_t>(bytes[1]) << 8) |
                                      (static_cast<std::uint32_t>(bytes[2]) << 16);
            return raw < 0x800000u ? static_cast<std::int64_t>(raw)
                                   : static_cast<std::int64_t>(raw) - 0x1000000ll;
        }
        const std::uint32_t raw = readU32(bytes);
        return raw < 0x80000000u ? static_cast<std::int64_t>(raw)
                                 : static_cast<std::int64_t>(raw) - 0x100000000ll;
    }

    static std::int64_t readLeftAlignedSignedInteger(const std::uint8_t* bytes,
                                                     std::uint32_t containerBits,
                                                     std::uint32_t validBits) {
        std::uint64_t raw = 0;
        if (containerBits == 16) {
            raw = readU16(bytes);
        } else if (containerBits == 24) {
            raw = static_cast<std::uint32_t>(bytes[0]) |
                  (static_cast<std::uint32_t>(bytes[1]) << 8) |
                  (static_cast<std::uint32_t>(bytes[2]) << 16);
        } else {
            raw = readU32(bytes);
        }
        const std::uint32_t paddingBits = containerBits - validBits;
        const std::uint64_t code = raw >> paddingBits;
        const std::uint64_t signBit = std::uint64_t{1} << (validBits - 1u);
        if ((code & signBit) == 0) return static_cast<std::int64_t>(code);
        const std::uint64_t modulus = std::uint64_t{1} << validBits;
        return static_cast<std::int64_t>(code) - static_cast<std::int64_t>(modulus);
    }

    static std::uint64_t readU64(const std::uint8_t* bytes) {
        return static_cast<std::uint64_t>(readU32(bytes)) |
               (static_cast<std::uint64_t>(readU32(bytes + 4)) << 32);
    }

    static bool fourcc(const std::uint8_t* bytes, const char* expected) {
        return bytes[0] == static_cast<std::uint8_t>(expected[0]) &&
               bytes[1] == static_cast<std::uint8_t>(expected[1]) &&
               bytes[2] == static_cast<std::uint8_t>(expected[2]) &&
               bytes[3] == static_cast<std::uint8_t>(expected[3]);
    }

    bool isExpectedFinalSizeReached(std::uint64_t currentBytes) const {
        if (!growing_) return true;
        return expectedBytes_ && currentBytes >= *expectedBytes_;
    }

    void failSticky(const std::string& error) {
        failed_ = true;
        stickyError_ = error;
    }

    HANDLE handle_ = INVALID_HANDLE_VALUE;
    bool growing_ = false;
    std::optional<std::uint64_t> expectedBytes_;
    std::uint64_t dataOffsetBytes_ = 0;
    std::uint64_t dataBytes_ = 0;
    std::uint64_t sourceFrameCount_ = 0;
    std::uint64_t positionFrames_ = 0;
    std::uint32_t sampleRate_ = 0;
    std::uint32_t channels_ = 0;
    std::uint32_t bitsPerSample_ = 0;
    std::uint32_t validBitsPerSample_ = 0;
    std::uint32_t blockAlign_ = 0;
    WaveSampleFormat format_ = WaveSampleFormat::PcmInteger;
    WaveDecodeMath decodeMath_ = WaveDecodeMath::SignedIntegerNormalized;
    std::size_t maxScratchFrames_ = 0;
    std::vector<std::uint8_t> scratch_;
    bool failed_ = false;
    std::string stickyError_;
};

inline const char* waveSampleFormatName(WaveSampleFormat format) {
    switch (format) {
    case WaveSampleFormat::PcmInteger: return "pcm-integer";
    case WaveSampleFormat::IeeeFloat32: return "ieee-float32";
    case WaveSampleFormat::IeeeFloat64: return "ieee-float64";
    }
    return "unknown";
}

inline const char* waveDecodeMathName(WaveDecodeMath decodeMath) {
    switch (decodeMath) {
    case WaveDecodeMath::Pcm8UnsignedMidpoint: return "pcm8-unsigned-midpoint-normalized";
    case WaveDecodeMath::SignedIntegerNormalized: return "signed-integer-container-normalized-to-double";
    case WaveDecodeMath::SignedIntegerLeftAlignedValidBits:
        return "signed-integer-left-aligned-validbits-normalized-to-double";
    case WaveDecodeMath::IeeeFloat32Widened: return "ieee-float32-widened-to-double";
    case WaveDecodeMath::IeeeFloat64Copied: return "ieee-float64-copied-to-double";
    }
    return "unknown";
}

} // namespace rhine
