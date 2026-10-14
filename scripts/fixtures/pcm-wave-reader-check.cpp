#include "../../native/pcm-wave-reader.h"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

static void appendU16(std::vector<std::uint8_t>& out, std::uint16_t value) {
    out.push_back(static_cast<std::uint8_t>(value));
    out.push_back(static_cast<std::uint8_t>(value >> 8));
}

static void appendU32(std::vector<std::uint8_t>& out, std::uint32_t value) {
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(value >> (8 * i)));
}

static void appendU64(std::vector<std::uint8_t>& out, std::uint64_t value) {
    for (int i = 0; i < 8; ++i) out.push_back(static_cast<std::uint8_t>(value >> (8 * i)));
}

static void appendFourcc(std::vector<std::uint8_t>& out, const char* text) {
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<std::uint8_t>(text[i]));
}

static std::vector<std::uint8_t> chunk(const char* id, const std::vector<std::uint8_t>& payload) {
    std::vector<std::uint8_t> out;
    appendFourcc(out, id);
    appendU32(out, static_cast<std::uint32_t>(payload.size()));
    out.insert(out.end(), payload.begin(), payload.end());
    if ((payload.size() & 1u) != 0) out.push_back(0);
    return out;
}

static std::vector<std::uint8_t> makeRiff(const std::vector<std::uint8_t>& fmt,
                                          const std::vector<std::uint8_t>& data) {
    std::vector<std::uint8_t> body;
    appendFourcc(body, "WAVE");
    auto fmtChunk = chunk("fmt ", fmt);
    auto dataChunk = chunk("data", data);
    body.insert(body.end(), fmtChunk.begin(), fmtChunk.end());
    body.insert(body.end(), dataChunk.begin(), dataChunk.end());

    std::vector<std::uint8_t> out;
    appendFourcc(out, "RIFF");
    appendU32(out, static_cast<std::uint32_t>(body.size()));
    out.insert(out.end(), body.begin(), body.end());
    return out;
}

static std::vector<std::uint8_t> pcmFormat(std::uint16_t tag, std::uint16_t channels,
                                            std::uint32_t rate, std::uint16_t bits,
                                            std::uint16_t blockAlign) {
    std::vector<std::uint8_t> fmt;
    appendU16(fmt, tag);
    appendU16(fmt, channels);
    appendU32(fmt, rate);
    appendU32(fmt, rate * blockAlign);
    appendU16(fmt, blockAlign);
    appendU16(fmt, bits);
    return fmt;
}

static std::vector<std::uint8_t> extensible24In32Format() {
    std::vector<std::uint8_t> fmt;
    appendU16(fmt, 0xfffe);
    appendU16(fmt, 1);
    appendU32(fmt, 48000);
    appendU32(fmt, 48000 * 4);
    appendU16(fmt, 4);
    appendU16(fmt, 32);
    appendU16(fmt, 22); // cbSize
    appendU16(fmt, 24); // valid bits; samples are left-aligned in 32 bits
    appendU32(fmt, 0x00000004); // front center
    const std::uint8_t pcmGuid[16] = {
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
        0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71
    };
    fmt.insert(fmt.end(), std::begin(pcmGuid), std::end(pcmGuid));
    return fmt;
}

static fs::path writeFixture(const fs::path& directory, const std::string& name,
                             const std::vector<std::uint8_t>& bytes) {
    fs::path path = directory / name;
    require(!fs::exists(path), "refusing to overwrite a pre-existing WAV fixture");
    std::ofstream file(path, std::ios::binary | std::ios::out);
    require(file.good(), "could not create WAV fixture");
    file.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    file.close();
    require(file.good(), "could not finish writing WAV fixture");
    return path;
}

static void appendFile(const fs::path& path, const std::uint8_t* bytes, std::size_t count) {
    HANDLE handle = CreateFileW(path.c_str(), FILE_APPEND_DATA,
                                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                                nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    require(handle != INVALID_HANDLE_VALUE, "could not open growing WAV for append");
    DWORD written = 0;
    const BOOL ok = WriteFile(handle, bytes, static_cast<DWORD>(count), &written, nullptr);
    const DWORD error = GetLastError();
    CloseHandle(handle);
    require(ok && written == count, ("could not append growing WAV, Win32=" + std::to_string(error)).c_str());
}

static std::vector<std::uint8_t> makeTruncatedDataWave(std::size_t declaredDataBytes,
                                                        const std::vector<std::uint8_t>& availableData,
                                                        std::uint64_t& expectedFileBytes) {
    const auto fmt = pcmFormat(1, 1, 48000, 16, 2);
    const auto fmtChunk = chunk("fmt ", fmt);
    const std::uint64_t declaredRiffSize = 4 + fmtChunk.size() + 8 + declaredDataBytes + (declaredDataBytes & 1u);
    expectedFileBytes = declaredRiffSize + 8;
    std::vector<std::uint8_t> out;
    appendFourcc(out, "RIFF");
    appendU32(out, static_cast<std::uint32_t>(declaredRiffSize));
    appendFourcc(out, "WAVE");
    out.insert(out.end(), fmtChunk.begin(), fmtChunk.end());
    appendFourcc(out, "data");
    appendU32(out, static_cast<std::uint32_t>(declaredDataBytes));
    out.insert(out.end(), availableData.begin(), availableData.end());
    return out;
}

static std::unique_ptr<rhine::WavePcmReader> openReader(const fs::path& path,
                                                        const rhine::WaveOpenOptions& options = {},
                                                        std::string* error = nullptr) {
    return rhine::WavePcmReader::tryOpen(path.wstring(), options, error);
}

int main() {
    const fs::path parent = fs::path(".tools") / "native-pcm-smoke";
    fs::create_directories(parent);
    const std::string leaf = "wave-reader-check-" + std::to_string(GetCurrentProcessId()) +
                             "-" + std::to_string(GetTickCount64());
    const fs::path fixtures = parent / leaf;
    require(fs::create_directory(fixtures), "could not create unique WAV fixture directory");
    struct Cleanup {
        fs::path path;
        ~Cleanup() { std::error_code ignored; fs::remove_all(path, ignored); }
    } cleanup{fixtures};

    // 32-bit PCM must preserve integer bits which a float32 intermediary loses.
    std::vector<std::uint8_t> pcm32;
    appendU32(pcm32, 16777217u);
    appendU32(pcm32, static_cast<std::uint32_t>(-16777217));
    const fs::path pcm32Path = writeFixture(fixtures, "pcm32.wav",
        makeRiff(pcmFormat(1, 1, 48000, 32, 4), pcm32));
    std::string error;
    auto pcm32Reader = openReader(pcm32Path, {}, &error);
    require(pcm32Reader != nullptr, error.c_str());
    double pcm32Output[2]{};
    auto read = pcm32Reader->read(pcm32Output, 2);
    require(read.frames == 2 && read.eof && read.error.empty(), "32-bit PCM read/EOF failed");
    require(pcm32Output[0] == 16777217.0 / 2147483648.0 &&
            pcm32Output[1] == -16777217.0 / 2147483648.0,
            "32-bit PCM low bits were not preserved in double");
    require(pcm32Reader->info().bitsPerSample == 32 && pcm32Reader->info().validBitsPerSample == 32 &&
            pcm32Reader->info().decodeMath == rhine::WaveDecodeMath::SignedIntegerNormalized,
            "32-bit PCM info does not describe its decode path");

    // PCM8 is unsigned around its midpoint; PCM16 also exercises chunk seeks.
    const std::vector<std::uint8_t> pcm8 = {0, 128, 255};
    auto pcm8Reader = openReader(writeFixture(fixtures, "pcm8.wav",
        makeRiff(pcmFormat(1, 1, 48000, 8, 1), pcm8)), {}, &error);
    require(pcm8Reader != nullptr, error.c_str());
    double pcm8Output[3]{};
    read = pcm8Reader->read(pcm8Output, 3);
    require(read.frames == 3 && read.eof && pcm8Output[0] == -1.0 && pcm8Output[1] == 0.0 &&
            pcm8Output[2] == 127.0 / 128.0, "PCM8 unsigned midpoint mapping is wrong");

    std::vector<std::uint8_t> pcm24 = {0x56, 0x34, 0x12, 0xaa, 0xcb, 0xed};
    auto pcm24Reader = openReader(writeFixture(fixtures, "pcm24.wav",
        makeRiff(pcmFormat(1, 1, 48000, 24, 3), pcm24)), {}, &error);
    require(pcm24Reader != nullptr, error.c_str());
    double pcm24Output[2]{};
    read = pcm24Reader->read(pcm24Output, 2);
    require(read.frames == 2 && read.eof && pcm24Output[0] == 0x123456 / 8388608.0 &&
            pcm24Output[1] == -0x123456 / 8388608.0, "packed PCM24 sign extension/normalization is wrong");

    std::vector<std::uint8_t> pcm16;
    constexpr std::uint32_t boundaryFrames = 6000;
    for (std::uint32_t frame = 0; frame < boundaryFrames; ++frame) {
        appendU16(pcm16, static_cast<std::uint16_t>(static_cast<std::int16_t>(frame)));
        appendU16(pcm16, static_cast<std::uint16_t>(static_cast<std::int16_t>(-static_cast<int>(frame))));
    }
    auto pcm16Reader = openReader(writeFixture(fixtures, "pcm16-stereo.wav",
        makeRiff(pcmFormat(1, 2, 48000, 16, 4), pcm16)), {}, &error);
    require(pcm16Reader != nullptr, error.c_str());
    std::vector<double> pcm16Output(4096 * 2);
    read = pcm16Reader->read(pcm16Output.data(), 4096);
    require(read.frames == 4096 && !read.eof, "first bounded PCM16 block size is wrong");
    read = pcm16Reader->read(pcm16Output.data(), 4096);
    require(read.frames == boundaryFrames - 4096 && read.eof, "PCM16 chunk boundary or EOF is wrong");
    require(pcm16Reader->seek(4095, &error), error.c_str());
    double seekOutput[4]{};
    read = pcm16Reader->read(seekOutput, 2);
    require(read.frames == 2 && seekOutput[0] == 4095.0 / 32768.0 &&
            seekOutput[1] == -4095.0 / 32768.0 &&
            seekOutput[2] == 4096.0 / 32768.0 && seekOutput[3] == -4096.0 / 32768.0,
            "seek around the bounded read boundary returned the wrong frames");
    pcm16Reader->reset();
    require(pcm16Reader->positionFrames() == 0, "reset did not return to frame zero");

    // Extensible 24-valid-bits in a 32-bit, left-aligned container.
    std::vector<std::uint8_t> ext24;
    appendU32(ext24, 0x12345600u);
    appendU32(ext24, 0xedcbaa7fu); // unused low padding bits are discarded
    auto extReader = openReader(writeFixture(fixtures, "extensible-24-in-32.wav",
        makeRiff(extensible24In32Format(), ext24)), {}, &error);
    require(extReader != nullptr, error.c_str());
    double extOutput[2]{};
    read = extReader->read(extOutput, 2);
    require(read.frames == 2 && read.eof && extOutput[0] == 0x123456 / 8388608.0 &&
            extOutput[1] == -0x123456 / 8388608.0, "extensible 24-in-32 normalization is wrong");
    require(extReader->info().bitsPerSample == 32 && extReader->info().validBitsPerSample == 24 &&
            extReader->info().decodeMath == rhine::WaveDecodeMath::SignedIntegerLeftAlignedValidBits,
            "extensible PCM bit-depth info is wrong");

    // Float64 must retain a representable sub-float32 increment exactly.
    const double precise = 1.0 + std::ldexp(1.0, -40);
    std::uint64_t preciseBits = 0;
    std::memcpy(&preciseBits, &precise, sizeof(preciseBits));
    std::vector<std::uint8_t> float64Data;
    appendU64(float64Data, preciseBits);
    const double negative = -0.25;
    std::uint64_t negativeBits = 0;
    std::memcpy(&negativeBits, &negative, sizeof(negativeBits));
    appendU64(float64Data, negativeBits);
    auto float64Reader = openReader(writeFixture(fixtures, "float64.wav",
        makeRiff(pcmFormat(3, 1, 48000, 64, 8), float64Data)), {}, &error);
    require(float64Reader != nullptr, error.c_str());
    double float64Output[2]{};
    read = float64Reader->read(float64Output, 2);
    require(read.frames == 2 && read.eof && float64Output[0] == precise && float64Output[1] == negative,
            "IEEE float64 samples were not copied with their double precision");
    require(float64Reader->info().decodeMath == rhine::WaveDecodeMath::IeeeFloat64Copied,
            "IEEE float64 decode path was misreported");

    // Non-finite IEEE values are explicit decoder errors.
    std::vector<std::uint8_t> nonfiniteData;
    appendU32(nonfiniteData, 0x7fc00000u); // quiet NaN
    auto nonfiniteReader = openReader(writeFixture(fixtures, "float32-nan.wav",
        makeRiff(pcmFormat(3, 1, 48000, 32, 4), nonfiniteData)), {}, &error);
    require(nonfiniteReader != nullptr, error.c_str());
    double nonfiniteOutput[1]{};
    read = nonfiniteReader->read(nonfiniteOutput, 1);
    require(read.frames == 0 && !read.eof && read.error.find("non-finite IEEE float32") != std::string::npos,
            "non-finite float32 sample was not reported");

    // An ordinary truncated file is rejected; the growing equivalent buffers,
    // then continues to the strict declared data tail after bytes are appended.
    std::vector<std::uint8_t> firstTwoFrames;
    appendU16(firstTwoFrames, 1000);
    appendU16(firstTwoFrames, 2000);
    std::uint64_t expectedFileBytes = 0;
    const fs::path growingPath = writeFixture(fixtures, "growing.wav",
        makeTruncatedDataWave(8, firstTwoFrames, expectedFileBytes));
    auto truncatedReader = openReader(growingPath, {}, &error);
    require(truncatedReader == nullptr && error.find("shorter than the declared RIFF extent") != std::string::npos,
            "ordinary truncated WAV was not rejected at open");
    rhine::WaveOpenOptions growingOptions;
    growingOptions.growing = true;
    growingOptions.expectedBytes = expectedFileBytes;
    auto growingReader = openReader(growingPath, growingOptions, &error);
    require(growingReader != nullptr, error.c_str());
    double growingOutput[4]{};
    read = growingReader->read(growingOutput, 4);
    require(read.frames == 2 && read.buffering && !read.eof && read.error.empty(),
            "growing WAV with a temporarily missing tail did not report buffering");
    std::vector<std::uint8_t> finalTwoFrames;
    appendU16(finalTwoFrames, 3000);
    appendU16(finalTwoFrames, 4000);
    appendFile(growingPath, finalTwoFrames.data(), finalTwoFrames.size());
    read = growingReader->read(growingOutput, 2);
    require(read.frames == 2 && read.eof && growingOutput[0] == 3000.0 / 32768.0 &&
            growingOutput[1] == 4000.0 / 32768.0,
            "growing WAV did not resume and end at its declared data tail");

    // Compressed and RF64 variants are clearly unsupported, for host fallback.
    std::vector<std::uint8_t> zeroData(2, 0);
    auto compressed = openReader(writeFixture(fixtures, "compressed.wav",
        makeRiff(pcmFormat(2, 1, 48000, 16, 2), zeroData)), {}, &error);
    require(compressed == nullptr && error.find("unsupported:") == 0,
            "compressed WAV did not return an explicit unsupported result");
    std::vector<std::uint8_t> rf64;
    appendFourcc(rf64, "RF64");
    appendU32(rf64, 4);
    appendFourcc(rf64, "WAVE");
    auto rf64Reader = openReader(writeFixture(fixtures, "rf64.wav", rf64), {}, &error);
    require(rf64Reader == nullptr && error.find("unsupported:") == 0,
            "RF64 did not return an explicit unsupported result");

    std::cout << "PCM WAV reader checks passed\n";
    return 0;
}
