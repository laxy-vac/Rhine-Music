#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <vector>

#define main rhineNativeMain
#define RHINE_AUDIO_OFFLINE_AUDIT 1
#include "../../native/audio-host.cpp"
#undef main

namespace {
std::atomic<bool> countAllocations{false};
std::atomic<std::size_t> allocationCount{0};
}

void* operator new(std::size_t size) {
  if (countAllocations.load(std::memory_order_relaxed))
    allocationCount.fetch_add(1, std::memory_order_relaxed);
  if (void* value = std::malloc(size ? size : 1)) return value;
  throw std::bad_alloc();
}

void* operator new[](std::size_t size) {
  if (countAllocations.load(std::memory_order_relaxed))
    allocationCount.fetch_add(1, std::memory_order_relaxed);
  if (void* value = std::malloc(size ? size : 1)) return value;
  throw std::bad_alloc();
}

void operator delete(void* value) noexcept { std::free(value); }
void operator delete(void* value, std::size_t) noexcept { std::free(value); }
void operator delete[](void* value) noexcept { std::free(value); }
void operator delete[](void* value, std::size_t) noexcept { std::free(value); }

static void auditCheck(bool condition, const char* description) {
  if (!condition) {
    std::cerr << "FAIL: " << description << '\n';
    std::exit(1);
  }
}

struct MockRenderClient final:IAudioRenderClient {
  std::array<BYTE,512> bytes{};int acquired=0,released=0;DWORD lastFlags=0;bool failAcquire=false,failRelease=false;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID,void**)override{return E_NOINTERFACE;}
  ULONG STDMETHODCALLTYPE AddRef()override{return 1;}ULONG STDMETHODCALLTYPE Release()override{return 1;}
  HRESULT STDMETHODCALLTYPE GetBuffer(UINT32,BYTE** output)override{if(failAcquire)return E_FAIL;*output=bytes.data();acquired++;return S_OK;}
  HRESULT STDMETHODCALLTYPE ReleaseBuffer(UINT32,DWORD flags)override{released++;lastFlags=flags;return failRelease?E_FAIL:S_OK;}
};
struct MockAudioClient final:IAudioClient {
  UINT32 padding=0;bool failPadding=false;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID,void**)override{return E_NOINTERFACE;}
  ULONG STDMETHODCALLTYPE AddRef()override{return 1;}ULONG STDMETHODCALLTYPE Release()override{return 1;}
  HRESULT STDMETHODCALLTYPE Initialize(AUDCLNT_SHAREMODE,DWORD,REFERENCE_TIME,REFERENCE_TIME,const WAVEFORMATEX*,LPCGUID)override{return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE GetBufferSize(UINT32* value)override{*value=4;return S_OK;}
  HRESULT STDMETHODCALLTYPE GetStreamLatency(REFERENCE_TIME* value)override{*value=0;return S_OK;}
  HRESULT STDMETHODCALLTYPE GetCurrentPadding(UINT32* value)override{if(failPadding)return E_FAIL;*value=padding;return S_OK;}
  HRESULT STDMETHODCALLTYPE IsFormatSupported(AUDCLNT_SHAREMODE,const WAVEFORMATEX*,WAVEFORMATEX**)override{return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE GetMixFormat(WAVEFORMATEX**)override{return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE GetDevicePeriod(REFERENCE_TIME*,REFERENCE_TIME*)override{return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE Start()override{return S_OK;}HRESULT STDMETHODCALLTYPE Stop()override{return S_OK;}HRESULT STDMETHODCALLTYPE Reset()override{return S_OK;}
  HRESULT STDMETHODCALLTYPE SetEventHandle(HANDLE)override{return S_OK;}HRESULT STDMETHODCALLTYPE GetService(REFIID,void**)override{return E_NOTIMPL;}
};
namespace rhine {
struct WasapiOfflineAudit {
  static void mailbox() {
    WasapiOutput value(WasapiOutput::OfflineAuditTag{});int executed=0;
    WasapiOutput::AudioCommand command;command.action=[&]{executed++;};command.done=CreateEventW(nullptr,TRUE,FALSE,nullptr);auditCheck(command.done!=nullptr,"Mock command event creation failed");value.pendingCommand_.store(&command);
    allocationCount=0;countAllocations=true;value.processCommands();countAllocations=false;
    auditCheck(executed==1&&command.completed.load()&&WaitForSingleObject(command.done,0)==WAIT_OBJECT_0,"WASAPI fixed mailbox did not execute and acknowledge the caller-owned command");
    auditCheck(allocationCount==0&&value.pendingCommand_.load()==nullptr,"WASAPI mailbox allocated or retained a caller stack pointer");CloseHandle(command.done);
  }
  static void descriptors() {
    WasapiOutput value(WasapiOutput::OfflineAuditTag{});value.sourceRate_=48000;value.channels_=2;
    value.descriptorCapacity_=4;value.descriptorSlots_=std::make_unique<WasapiOutput::MetadataSlot[]>(4);
    PcmTrackSegment segment;segment.trackId="initial-descriptor";segment.duration=1;segment.sourceSampleRate=48000;segment.transitionSerial=1;segment.sourceFormat={{"exactFrameCount",true}};segment.processingStages=json::array({{{"id","eq"},{"gain",3}}});
    const auto original=value.descriptorForProducer(segment);auditCheck(original!=0,"An empty metadata table rejected its first descriptor");
    value.retainDescriptor(original);RtPcmEvent event{};event.descriptorId=original;event.frames=128;event.timelineRate=48000;event.duration=1;event.transitionSerial=1;event.flags=RtPcmSegmentExactDuration;
    value.changeCurrentDescriptor(event,64);value.releaseDescriptor(original);
    const json future=json::array({{{"id","eq"},{"gain",9}}});value.setTrackProcessingStages(segment.trackId,future);
    auditCheck(value.snapshot().processingStages[0]["gain"]==3,"A parameter update relabeled already prepared PCM");
    segment.processingStages=future;const auto next=value.descriptorForProducer(segment);auditCheck(next!=original,"Different processed audio reused an active descriptor");
    value.retainDescriptor(next);event.descriptorId=next;value.changeCurrentDescriptor(event,96);value.releaseDescriptor(next);
    auditCheck(value.snapshot().processingStages[0]["gain"]==9,"A future DSP descriptor failed to become current");value.releaseAudio();
  }
  static void lease() {
    MockRenderClient client;auto* output=client.bytes.data();
    try{WasapiOutput::RenderBufferLease value{&client,4,output,AUDCLNT_BUFFERFLAGS_SILENT,true};throw 1;}catch(int){}
    auditCheck(client.released==1&&client.lastFlags==AUDCLNT_BUFFERFLAGS_SILENT,"WASAPI exception lease did not release PCM once as silent");
    {WasapiOutput::RenderBufferLease value{&client,4,output,0,true};auditCheck(value.release(0)==S_OK,"WASAPI normal release failed");}
    auditCheck(client.released==2,"WASAPI lease released a committed buffer twice");
    DopPacker packer(2,24);std::fill(client.bytes.begin(),client.bytes.end(),0);
    try{WasapiOutput::RenderBufferLease value{&client,4,output,0,true,&packer};throw 2;}catch(int){}
    auditCheck(client.released==3&&client.lastFlags==0,"WASAPI DoP exception lease release mismatch");
    for(size_t f=0;f<4;f++)for(size_t c=0;c<2;c++){const size_t i=(f*2+c)*3;auditCheck(output[i]==0x69&&output[i+1]==0x69&&output[i+2]==(f%2?0xfa:0x05),"WASAPI DoP exception fallback was not valid idle");}
  }
  static void render() {
    MockAudioClient client;MockRenderClient render;
    WasapiOutput value(WasapiOutput::OfflineAuditTag{});
    value.mode_="shared";value.sourceRate_=48000;value.channels_=2;value.bufferFrames_=4;value.audioBlockBytes_=8;value.client_=&client;value.render_=&render;value.started_=true;
    value.position_=[]{return 0.;};value.pcmRead_=[](double*,DWORD)->PcmOutputBlock{throw std::runtime_error("Render called the DSP producer");};
    value.pcmQueue_.configure(2,4,4);value.scratchDouble_.resize(8);value.pcmEventScratch_.resize(value.pcmQueue_.maxConsumeEvents());
    value.timelineSpanCapacity_=16;value.timelineSpans_=std::make_unique<WasapiOutput::TimelineSpan[]>(16);value.pcmQuantizer_.configure(PcmSampleFormat::Float32,"none",2);
    RtPcmWriteBlock<double> block;value.pcmQueue_.tryBeginWrite(block);for(size_t i=0;i<8;i++)block.data[i]=i*.03125;
    RtPcmChunkInfo info{};info.frames=4;info.flags=RtPcmChunkEof;info.segmentCount=1;info.segments[0].frames=4;info.segments[0].timelineRate=48000;
    auditCheck(value.pcmQueue_.publish(block,info),"WASAPI fixture publish failed");
    allocationCount=0;countAllocations=true;const bool ended=value.renderOnce(true);countAllocations=false;
    auditCheck(!ended&&allocationCount==0,"WASAPI render allocated or failed on valid prepared PCM");
    auditCheck(render.acquired==1&&render.released==1,"WASAPI render GetBuffer/ReleaseBuffer balance wrong");
    for(size_t i=0;i<8;i++){float sample;std::memcpy(&sample,render.bytes.data()+i*4,4);auditCheck(sample==static_cast<float>(i*.03125),"WASAPI prepared PCM changed");}
    render.failAcquire=true;value.eofSeen_=false;
    auditCheck(value.renderOnce(true)&&render.released==1,"WASAPI acquire failure released an unacquired buffer");
    value.releaseAudio();
  }
};
}

static DWORD callPcm(const AsioPcmRenderer& unused, BOOL input, DWORD channel,
                     void* output, DWORD bytes, void* context) {
  (void)unused;
  allocationCount.store(0, std::memory_order_relaxed);
  countAllocations.store(true, std::memory_order_release);
  const DWORD result = asioPcmOutput(input, channel, output, bytes, context);
  countAllocations.store(false, std::memory_order_release);
  auditCheck(allocationCount.load(std::memory_order_relaxed) == 0,
        "ASIO PCM callback allocated heap memory");
  return result;
}

static DWORD callDsd(BOOL input, DWORD channel, void* output, DWORD bytes,
                     void* context) {
  allocationCount.store(0, std::memory_order_relaxed);
  countAllocations.store(true, std::memory_order_release);
  const DWORD result = dsdOutput(input, channel, output, bytes, context);
  countAllocations.store(false, std::memory_order_release);
  auditCheck(allocationCount.load(std::memory_order_relaxed) == 0,
        "ASIO DSD callback allocated heap memory");
  return result;
}

static std::size_t callDsdIdle(const AsioDsdRenderer& renderer, void* output,
                               DWORD bytes) {
  allocationCount.store(0, std::memory_order_relaxed);
  countAllocations.store(true, std::memory_order_release);
  asioDsdIdle(renderer, output, bytes);
  countAllocations.store(false, std::memory_order_release);
  const std::size_t result = allocationCount.load(std::memory_order_relaxed);
  auditCheck(result == 0, "ASIO idle callback allocated heap memory");
  return result;
}

static void configurePcm(AsioPcmRenderer& renderer, std::size_t capacityFrames,
                         rhine::PcmSampleFormat format, bool bitPerfect,
                         int exactSourceBits = 0) {
  renderer.firstChannel = 10;
  renderer.channels = 2;
  renderer.bytesPerSample = static_cast<std::size_t>(rhine::PcmQuantizer::containerBits(format) / 8);
  renderer.capacityFrames = capacityFrames;
  renderer.sampleRate = 48000;
  renderer.bitPerfect = bitPerfect;
  renderer.interleaved.resize(capacityFrames * static_cast<std::size_t>(renderer.channels));
  renderer.ready.configure(static_cast<std::size_t>(renderer.channels), capacityFrames,
                           capacityFrames, 3);
  renderer.events.resize(renderer.ready.maxConsumeEvents());
  renderer.quantizer.configure(format, "none", renderer.channels, exactSourceBits,
                               rhine::PcmPackingAlignment::RightAligned, uint32_t{0x13579bdf});
}

static void publishPcm(AsioPcmRenderer& renderer, const double* samples,
                       std::uint32_t frames, std::uint32_t flags) {
  rhine::RtPcmWriteBlock<double> block;
  auditCheck(renderer.ready.tryBeginWrite(block), "PCM ring did not reserve a producer block");
  auditCheck(frames <= block.capacityFrames, "PCM fixture exceeded ring block capacity");
  std::copy_n(samples, static_cast<std::size_t>(frames) * renderer.channels, block.data);
  rhine::RtPcmChunkInfo info{};
  info.frames = frames;
  info.flags = flags;
  if (frames) {
    info.segmentCount = 1;
    auto& segment = info.segments[0];
    segment.descriptorId = 17;
    segment.startPositionSeconds = 0.25;
    segment.duration = static_cast<double>(frames) / renderer.sampleRate;
    segment.sourceRate = renderer.sampleRate;
    segment.timelineRate = renderer.sampleRate;
    segment.offset = 0;
    segment.frames = frames;
  }
  auditCheck(renderer.ready.publish(block, info), "PCM ring rejected the synthetic producer block");
}

static void testBufferFrames() {
  auditCheck(rhine::asioBufferFrames(48000.0, 0, 64, 1024, 256, 0) == 0,
        "zero request must preserve driver default");
  auditCheck(rhine::asioBufferFrames(48000.0, 1, 128, 512, 256, 1) == 128,
        "minimum frame clamp must be in frames");
  auditCheck(rhine::asioBufferFrames(48000.0, 5000, 128, 1024, 256, 0) == 1024,
        "maximum frame clamp must be in frames");
  auditCheck(rhine::asioBufferFrames(48000.0, 5, 64, 384, 128, -1) == 256,
        "power-of-two granularity must round to the next legal frame count");
  auditCheck(rhine::asioBufferFrames(48000.0, 9, 64, 384, 128, -1) == 256,
        "power-of-two granularity must not exceed the driver maximum");
  auditCheck(rhine::asioBufferFrames(48000.0, 2, 64, 512, 256, 64) == 128,
        "fixed frame granularity must round to a legal step");
  bool rejected = false;
  try { (void)rhine::asioBufferFrames(48000.0, 10, 0, 1024, 256, 0); }
  catch (...) { rejected = true; }
  auditCheck(rejected, "invalid driver buffer limits must be rejected");
}

static void testPcmRingAndCallback() {
  AsioPcmRenderer renderer;
  configurePcm(renderer, 4, rhine::PcmSampleFormat::Int32Valid16, true, 16);

  rhine::RtPcmWriteBlock<double> cancelled{};
  auditCheck(renderer.ready.tryBeginWrite(cancelled), "PCM ring did not reserve the cancel fixture");
  std::fill_n(cancelled.data, 8, 0.875);
  renderer.ready.cancelWrite(cancelled);
  renderer.ready.cancelWrite(cancelled);
  auditCheck(renderer.ready.queuedChunks() == 0, "repeated producer cancellation published data");

  const double samples[] = {0.5, -0.5, -0.25, 0.25};
  publishPcm(renderer, samples, 2, rhine::RtPcmChunkEof);
  auditCheck(renderer.ready.queuedChunks() == 1, "synthetic PCM chunk was not queued");

  std::array<std::uint8_t, 8> left{};
  std::array<std::uint8_t, 8> right{};
  auditCheck(callPcm(renderer, FALSE, 10, left.data(), static_cast<DWORD>(left.size()), &renderer) == left.size(),
        "PCM callback did not return the left-channel byte count");
  auditCheck(callPcm(renderer, FALSE, 11, right.data(), static_cast<DWORD>(right.size()), &renderer) == right.size(),
        "PCM callback did not return the right-channel byte count");

  const std::array<std::uint8_t, 8> expectedLeft = {0x00, 0x40, 0x00, 0x00, 0x00, 0xe0, 0xff, 0xff};
  const std::array<std::uint8_t, 8> expectedRight = {0x00, 0xc0, 0xff, 0xff, 0x00, 0x20, 0x00, 0x00};
  auditCheck(left == expectedLeft, "ASIO bit-perfect PCM was not packed right-aligned");
  auditCheck(right == expectedRight, "ASIO bit-perfect right channel was not packed right-aligned");
  auditCheck(renderer.eof.load() && asioPcmEnded.load(), "PCM EOF did not reach the ASIO renderer");
  auditCheck(renderer.underflows.load() == 0, "complete EOF block was reported as an underflow");
  const auto stats = renderer.quantizer.stats();
  auditCheck(stats.bitPerfectCheckedSamples == 4 && stats.bitPerfectMismatchSamples == 0,
        "ASIO bit-perfect comparison did not preserve all source samples");
  auditCheck(renderer.ready.queuedChunks() == 0, "PCM EOF block was not drained from the ring");
}

static void testPcmUnderflowAndFaults() {
  AsioPcmRenderer underflow;
  configurePcm(underflow, 2, rhine::PcmSampleFormat::Float32, false);
  std::array<std::uint8_t, 8> silent{};
  silent.fill(0xa5);
  callPcm(underflow, FALSE, 10, silent.data(), static_cast<DWORD>(silent.size()), &underflow);
  auditCheck(underflow.underflows.load() == 1, "empty PCM ring did not report one underflow");
  auditCheck(!underflow.failed.load(), "ordinary PCM underflow became a renderer fault");
  auditCheck(std::all_of(silent.begin(), silent.end(), [](std::uint8_t value) { return value == 0; }),
        "PCM underflow did not output digital silence");

  AsioPcmRenderer bitPerfectUnderflow;
  configurePcm(bitPerfectUnderflow, 2, rhine::PcmSampleFormat::Int32Valid16, true, 16);
  std::array<std::uint8_t, 8> stopped{};
  stopped.fill(0xa5);
  callPcm(bitPerfectUnderflow, FALSE, 10, stopped.data(), static_cast<DWORD>(stopped.size()), &bitPerfectUnderflow);
  auditCheck(bitPerfectUnderflow.failed.load() && bitPerfectUnderflow.fault.load() == 5,
        "bit-perfect underflow did not stop with the expected fault");
  auditCheck(std::all_of(stopped.begin(), stopped.end(), [](std::uint8_t value) { return value == 0; }),
        "bit-perfect underflow did not clear its callback output");

  AsioPcmRenderer invalidLength;
  configurePcm(invalidLength, 2, rhine::PcmSampleFormat::Int32, false);
  std::array<std::uint8_t, 7> malformed{};
  malformed.fill(0xa5);
  callPcm(invalidLength, FALSE, 10, malformed.data(), static_cast<DWORD>(malformed.size()), &invalidLength);
  auditCheck(invalidLength.failed.load(), "misaligned callback byte length did not fault");
  auditCheck(std::all_of(malformed.begin(), malformed.end(), [](std::uint8_t value) { return value == 0; }),
        "malformed PCM callback output was not cleared");

  AsioPcmRenderer duplicate;
  configurePcm(duplicate, 2, rhine::PcmSampleFormat::Float32, false);
  std::array<std::uint8_t, 4> oneChannel{};
  callPcm(duplicate, FALSE, 10, oneChannel.data(), static_cast<DWORD>(oneChannel.size()), &duplicate);
  oneChannel.fill(0xa5);
  callPcm(duplicate, FALSE, 10, oneChannel.data(), static_cast<DWORD>(oneChannel.size()), &duplicate);
  auditCheck(duplicate.failed.load() && duplicate.fault.load() == 3,
        "duplicate channel callback did not report the channel-pair fault");
  auditCheck(std::all_of(oneChannel.begin(), oneChannel.end(), [](std::uint8_t value) { return value == 0; }),
        "duplicate channel callback did not output silence");
}

static float dopFloat(std::uint32_t raw24) {
  const std::int32_t signedValue = static_cast<std::int32_t>(
      (raw24 & 0x00800000u) ? (raw24 | 0xff000000u) : raw24);
  return static_cast<float>(static_cast<double>(signedValue) / 8388608.0);
}

static std::uint32_t expectedDopContainer(std::uint32_t raw24, int bits,
                                         rhine::DopAlignment alignment) {
  if (bits == 24) return raw24;
  if (alignment == rhine::DopAlignment::LeftAligned) return raw24 << 8;
  return (raw24 & 0x00800000u) ? raw24 | 0xff000000u : raw24;
}

static std::uint32_t readLittle(const std::uint8_t* bytes, int count) {
  std::uint32_t value = 0;
  for (int i = 0; i < count; ++i) value |= static_cast<std::uint32_t>(bytes[i]) << (i * 8);
  return value;
}

static void configureSyntheticDop(AsioDsdRenderer& renderer, int bits,
                                  rhine::DopAlignment alignment,
                                  const std::vector<float>& source) {
  renderer.capacityFrames = 4;
  renderer.dopScratch.resize(renderer.capacityFrames * renderer.channels);
  const auto* sourceBytes = reinterpret_cast<const std::uint8_t*>(source.data());
  const std::size_t totalBytes = source.size() * sizeof(float);
  auto offset = std::make_shared<std::size_t>(0);
  renderer.ready.configure(renderer.channels * sizeof(float), renderer.capacityFrames,
      [sourceBytes, totalBytes, offset](std::uint8_t* destination, std::size_t capacity) {
        const std::size_t remaining = totalBytes - *offset;
        const std::size_t bytes = std::min(remaining, capacity);
        if (bytes) std::memcpy(destination, sourceBytes + *offset, bytes);
        *offset += bytes;
        return rhine::RtDsdBuffer::SourceRead{bytes, *offset == totalBytes, false, 0};
      });
  renderer.ready.start();
  (void)bits;
  (void)alignment;
}

static void testDopOutput(int bits, rhine::DopAlignment alignment) {
  AsioDsdRenderer renderer(2, bits, alignment, true);
  const std::vector<float> source = {
      dopFloat(0x051234u), dopFloat(0x056789u),
      dopFloat(0xfaabcdu), dopFloat(0xfa01efu),
  };
  configureSyntheticDop(renderer, bits, alignment, source);
  const int sampleBytes = bits / 8;
  const int frameBytes = 2 * sampleBytes;
  const int outputFrames = 3;
  std::array<std::uint8_t, 24> output{};
  const DWORD bytes = static_cast<DWORD>(frameBytes * outputFrames);
  auditCheck(callDsd(FALSE, 0, output.data(), bytes, &renderer) == bytes,
        "DoP callback did not return the requested byte count");
  renderer.ready.stop();
  auditCheck(renderer.eof.load() && renderer.fault.load() == 0,
        "synthetic DoP EOF did not complete cleanly");
  auditCheck(renderer.actualBufferFrames.load() == static_cast<std::size_t>(outputFrames),
        "DoP callback frame telemetry did not match its output");

  const std::uint32_t raw[] = {0x051234u, 0x056789u, 0xfaabcdu, 0xfa01efu,
                               0x056969u, 0x056969u};
  const std::uint8_t markers[] = {0x05, 0x05, 0xfa, 0xfa, 0x05, 0x05};
  for (int frame = 0; frame < outputFrames; ++frame) {
    for (int channel = 0; channel < 2; ++channel) {
      const std::size_t index = static_cast<std::size_t>(frame * 2 + channel);
      const auto* sample = output.data() + index * sampleBytes;
      const std::uint32_t packed = readLittle(sample, sampleBytes);
      auditCheck(packed == expectedDopContainer(raw[index], bits, alignment),
            "DoP payload or container alignment changed");
      const std::uint32_t low24 = bits == 24 ? packed : alignment == rhine::DopAlignment::LeftAligned
          ? (packed >> 8) & 0x00ffffffu : packed & 0x00ffffffu;
      auditCheck(low24 == raw[index], "DoP low-24 protocol word did not survive container restoration");
      auditCheck(((low24 >> 16) & 0xffu) == markers[index],
            "DoP marker did not alternate across the transport frames");
    }
  }
  if (bits == 32 && alignment == rhine::DopAlignment::LeftAligned) {
    auditCheck(readLittle(output.data(), 4) == 0x05123400u,
          "Windows left-aligned 32-bit DoP container was not independently restored");
  }
  if (bits == 32 && alignment == rhine::DopAlignment::RightAligned) {
    auditCheck(readLittle(output.data(), 4) == 0x00051234u,
          "right-aligned 32-bit DoP container was not independently restored");
  }
}

static void testDopIdle() {
  for (const int bits : {24, 32}) {
    for (const auto alignment : {rhine::DopAlignment::LeftAligned,
                                 rhine::DopAlignment::RightAligned}) {
      AsioDsdRenderer renderer(2, bits, alignment, true);
      const int sampleBytes = bits / 8;
      const int frameBytes = 2 * sampleBytes;
      std::array<std::uint8_t, 24> output{};
      callDsdIdle(renderer, output.data(), static_cast<DWORD>(frameBytes * 2));
      for (int frame = 0; frame < 2; ++frame) {
        const std::uint32_t expected = expectedDopContainer(frame ? 0xfa6969u : 0x056969u,
                                                           bits, alignment);
        for (int channel = 0; channel < 2; ++channel) {
          const auto* sample = output.data() + static_cast<std::size_t>((frame * 2 + channel) * sampleBytes);
          auditCheck(readLittle(sample, sampleBytes) == expected,
                "DoP idle payload or marker was not preserved");
        }
      }
    }
  }
  AsioDsdRenderer rawIdle(2, 8, rhine::DopAlignment::LeftAligned, false);
  std::array<std::uint8_t, 6> raw{};
  callDsdIdle(rawIdle, raw.data(), static_cast<DWORD>(raw.size()));
  auditCheck(std::all_of(raw.begin(), raw.end(), [](std::uint8_t value) { return value == 0x69; }),
        "raw DSD idle did not use the 0x69 byte pattern");
}

static void testRawDsdIdentityAndTail() {
  AsioDsdRenderer renderer(2, 8, rhine::DopAlignment::LeftAligned, false);
  renderer.capacityFrames = 4;
  const std::array<std::uint8_t, 4> source = {0x96, 0x3c, 0xa5, 0x5a};
  auto offset = std::make_shared<std::size_t>(0);
  renderer.ready.configure(2, renderer.capacityFrames,
      [offset, &source](std::uint8_t* destination, std::size_t capacity) {
        const std::size_t bytes = std::min(source.size() - *offset, capacity);
        if (bytes) std::memcpy(destination, source.data() + *offset, bytes);
        *offset += bytes;
        return rhine::RtDsdBuffer::SourceRead{bytes, *offset == source.size(), false, 0};
      });
  renderer.ready.start();
  std::array<std::uint8_t, 8> output{};
  auditCheck(callDsd(FALSE, 0, output.data(), static_cast<DWORD>(output.size()), &renderer) == output.size(),
        "raw DSD callback did not return the requested byte count");
  renderer.ready.stop();
  auditCheck(renderer.eof.load() && renderer.fault.load() == 0,
        "raw DSD EOF did not complete cleanly");
  auditCheck(std::equal(source.begin(), source.end(), output.begin()),
        "raw DSD callback changed the source payload bytes");
  auditCheck(std::all_of(output.begin() + source.size(), output.end(),
                    [](std::uint8_t value) { return value == 0x69; }),
        "raw DSD EOF tail did not use the 0x69 idle bytes");
}

static void testRepeatedProducerCancellation() {
  AsioDsdRenderer renderer(2, 24, rhine::DopAlignment::LeftAligned, true);
  renderer.ready.configure(2 * sizeof(float), 4,
      [](std::uint8_t*, std::size_t) {
        return rhine::RtDsdBuffer::SourceRead{0, false, true, 0};
      });
  for (int attempt = 0; attempt < 3; ++attempt) {
    renderer.ready.start();
    Sleep(4);
    renderer.ready.stop();
    renderer.ready.reset();
  }
  auditCheck(renderer.ready.queuedFrames() == 0,
        "repeated synthetic producer cancellation left queued data");
}

static void testDsfViewValidTail() {
  for(const size_t bytesPerChannel:{size_t(4096),size_t(8192),size_t(4099)})for(const bool lsb:{true,false}) {
    const unsigned tailDrop=bytesPerChannel==8192?0:bytesPerChannel==4096?3:7;
    const size_t blocks=(bytesPerChannel+4095)/4096,physical=blocks*8192;
    std::vector<uint8_t> file(92+physical,0);
    auto le=[&](size_t offset,uint64_t value,size_t bytes){for(size_t i=0;i<bytes;i++)file[offset+i]=static_cast<uint8_t>(value>>(8*i));};
    std::memcpy(file.data(),"DSD ",4);le(4,28,8);le(12,file.size(),8);
    std::memcpy(file.data()+28,"fmt ",4);le(32,52,8);le(40,1,4);le(48,2,4);le(52,2,4);le(56,2822400,4);le(60,lsb?1:8,4);le(64,bytesPerChannel*8-tailDrop,8);le(72,4096,4);
    std::memcpy(file.data()+80,"data",4);le(84,physical+12,8);
    for(size_t i=0;i<bytesPerChannel;i++)for(size_t c=0;c<2;c++)file[92+(i/4096)*8192+c*4096+i%4096]=static_cast<uint8_t>(i*33+c*55);
    const std::wstring filename=L".tools\\audit-tests\\synthetic-dsf-tail-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64())+L"-"+std::to_wstring(bytesPerChannel)+L"-"+std::to_wstring(lsb)+L".dsf";
    HANDLE handle=CreateFileW(filename.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_TEMPORARY,nullptr);auditCheck(handle!=INVALID_HANDLE_VALUE,"Could not create synthetic DSF fixture");
    DWORD written=0;auditCheck(WriteFile(handle,file.data(),static_cast<DWORD>(file.size()),&written,nullptr)&&written==file.size(),"Synthetic DSF write incomplete");CloseHandle(handle);
    auto view=dsfView(filename);auditCheck(view&&view->bytesPerChannel==bytesPerChannel,"DSF view logical byte count wrong");
    std::vector<uint8_t> actual(bytesPerChannel*2);auditCheck(dsfSeek(view->header.size(),view.get()),"Synthetic DSF seek failed");
    auditCheck(dsfRead(actual.data(),static_cast<DWORD>(actual.size()),view.get())==actual.size(),"DSF block boundary dropped valid bytes");
    for(size_t i=0;i<bytesPerChannel;i++)for(size_t c=0;c<2;c++) {
      uint8_t expected=static_cast<uint8_t>(i*33+c*55);
      if(lsb){uint8_t reverse=0;for(unsigned bit=0;bit<8;bit++)if(expected&(1u<<bit))reverse|=static_cast<uint8_t>(1u<<(7-bit));expected=reverse;}
      if(i+1==bytesPerChannel&&tailDrop){const uint8_t mask=static_cast<uint8_t>(0xffu<<tailDrop);expected=static_cast<uint8_t>((expected&mask)|(0x69&~mask));}
      auditCheck(actual[i*2+c]==expected,"DSF view changed a valid bit or used invalid tail padding");
    }
    view.reset();auditCheck(DeleteFileW(filename.c_str())!=FALSE,"Synthetic DSF cleanup failed");
  }
}

static void testBlockingProducerIoCancellation() {
  HANDLE input=nullptr,output=nullptr;auditCheck(CreatePipe(&input,&output,nullptr,0)!=FALSE,"Could not create an isolated blocking pipe");
  rhine::RtDsdBuffer source;source.configure(2,8,[input](uint8_t* bytes,size_t capacity){DWORD read=0;const BOOL ok=ReadFile(input,bytes,static_cast<DWORD>(capacity),&read,nullptr);return rhine::RtDsdBuffer::SourceRead{read,false,false,ok?0:static_cast<int>(GetLastError())};});
  source.start();const ULONGLONG began=GetTickCount64();source.stop();
  auditCheck(GetTickCount64()-began<2000,"CancelSynchronousIo did not release blocked producer promptly");
  CloseHandle(input);CloseHandle(output);
}

static void testFailedAsioSeekDoesNotResume() {
  const auto oldPosition=BASS_ChannelSetPosition;const auto oldError=BASS_ErrorGetCode;const auto oldBytes=BASS_ChannelSeconds2Bytes;
  BASS_ChannelSeconds2Bytes=[](DWORD,double)->QWORD{return 999;};
  BASS_ChannelSetPosition=[](DWORD,QWORD,DWORD)->BOOL{return FALSE;};BASS_ErrorGetCode=[]()->int{return BASS_ERROR_POSITION;};
  stream=123;session="offline-seek-failure";backend="asio";mode="pcm";asio=false;paused=false;error.clear();
  bool failed=false;try{command(json{{"cmd","seek"},{"session",session},{"position",999999.0}});}catch(const std::exception&){failed=true;}
  auditCheck(failed&&paused&&!error.empty(),"Failed ASIO seek did not fail the session closed");
  failed=false;try{command(json{{"cmd","play"},{"session",session}});}catch(const std::exception&){failed=true;}
  auditCheck(failed,"ASIO restarted a session whose producer was stopped by a failed seek");
  stream=0;session.clear();error.clear();BASS_ChannelSetPosition=oldPosition;BASS_ErrorGetCode=oldError;BASS_ChannelSeconds2Bytes=oldBytes;
}

static void testEstimatedDurationDoesNotShortenManualFade() {
  stream=0;backend="wasapi";mode="pcm";outputRate=48000;currentDuration=0.001;currentStartPosition=0;
  sourceFormatMetadata=json{{"exactFrameCount",false}};
  processingSettings=json{{"transition",{{"manual","crossfade"},{"crossfadeMs",10}}}};
  queuedPcmTrack=std::make_unique<QueuedPcmTrack>();queuedPcmTrack->duration=0.001;queuedPcmTrack->sourceRate=48000;
  transitionPending=false;transitionFadeActive=false;requestManualAdvance();
  auditCheck(transitionFadeFrames==480,"Estimated track durations shortened a manual fade");
  transitionFadeActive=false;queuedPcmTrack->sourceFormat["exactFrameCount"]=true;
  requestManualAdvance();auditCheck(transitionFadeFrames==48,"Known short next track did not constrain a manual fade");
  queuedPcmTrack.reset();manualTransitionRequested=false;transitionFadeActive=false;transitionFadeFrames=0;transitionRequestedBy.clear();
}

static void testDirectPcmReadsTransportBlock() {
  rhine::PcmEngine engine;engine.configure(json{{"bitPerfect",true}},48000,48000,2);
  double output[6]{};const double samples[6]={-1.0,0.0,std::ldexp(1.0,-31),-std::ldexp(1.0,-31),0.5,1.0-std::ldexp(1.0,-31)};
  const auto block=engine.pullDouble(output,3,[&](double* destination,size_t capacity){auditCheck(destination==output&&capacity==3,"Direct PCM entered an intermediate DSP block");std::copy_n(samples,6,destination);return rhine::PcmDecodedBlock{3,true,false,{}};});
  auditCheck(block.frames==3&&block.eof&&std::memcmp(output,samples,sizeof(samples))==0,"Direct PCM modified decoded samples or EOF");
  auditCheck(engine.sourceFramesRead()==3&&engine.outputFramesRead()==3,"Direct PCM did not maintain frame counters");
  bool failed=false;try{engine.configure(json{{"bitPerfect",true}},44100,48000,2);}catch(const std::exception&){failed=true;}
  auditCheck(failed,"Direct PCM accepted a resampling configuration");
}

int main() {
  BASS_ChannelGetData = nullptr;
  BASS_ASIO_ChannelEnable = nullptr;
  auditCheck(BASS_ChannelGetData == nullptr && BASS_ASIO_ChannelEnable == nullptr,
        "fixture unexpectedly bound a BASS read or ASIO device API");

  testBufferFrames();
  testPcmRingAndCallback();
  testPcmUnderflowAndFaults();
  testDopOutput(24, rhine::DopAlignment::LeftAligned);
  testDopOutput(32, rhine::DopAlignment::LeftAligned);
  testDopOutput(32, rhine::DopAlignment::RightAligned);
  testDopIdle();
  testRawDsdIdentityAndTail();
  testRepeatedProducerCancellation();
  testDsfViewValidTail();
  testBlockingProducerIoCancellation();
  rhine::WasapiOfflineAudit::lease();
  rhine::WasapiOfflineAudit::mailbox();
  rhine::WasapiOfflineAudit::descriptors();
  rhine::WasapiOfflineAudit::render();
  testFailedAsioSeekDoesNotResume();
  testEstimatedDurationDoesNotShortenManualFade();
  testDirectPcmReadsTransportBlock();
  std::cout << "Audio host offline audit fixture passed.\n";
  return 0;
}
