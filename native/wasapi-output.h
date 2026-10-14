#pragma once

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <propvarutil.h>
#include <propsys.h>
#include <ksmedia.h>
#include <avrt.h>
#include "dop-packing.h"
#include "pcm-engine.h"
#include "rt-dsd-buffer.h"
#include "rt-pcm-buffer.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <condition_variable>
#include <cstring>
#include <exception>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <queue>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <unordered_map>
#include <vector>

namespace rhine {

static_assert(std::atomic<double>::is_always_lock_free,"WASAPI realtime software volume requires lock-free double atomics");

struct WasapiDevice {
  std::string id;
  std::string name;
  bool isDefault=false;
};

struct WasapiRead {
  DWORD bytes=0;
  bool eof=false;
  bool buffering=false;
  std::string error;
};

using WasapiPcmRead= PcmOutputBlock;

struct WasapiSnapshot {
  bool playing=false;
  bool paused=true;
  bool ended=false;
  bool buffering=false;
  std::string deviceId;
  std::string deviceName;
  std::string mode="shared";
  std::string sampleFormat="float";
  std::string mixSampleFormat="pcm";
  int sampleRate=0;
  int bitsPerSample=0;
  int validBitsPerSample=0;
  int mixSampleRate=0;
  int mixBitsPerSample=0;
  std::string callbackFormat="f32";
  int callbackContainerBits=32;
  int callbackValidBits=32;
  std::string callbackAlignment="not-applicable";
  std::string driverNativeFormat;
  int driverNativeContainerBits=0;
  int driverNativeValidBits=0;
  std::string driverNativeAlignment="unknown";
  std::optional<bool> backendConversion;
  int channels=0;
  int dsdRate=0;
  bool volumeLocked=false;
  double position=0;
  double bufferMs=0;
  int bufferFrames=0;
  int requestedBufferMs=0;
  std::string bufferControl="system";
  bool durationExact=false;
  std::uint64_t producerQueueFrames=0;
  std::uint64_t underflows=0;
  std::uint64_t callbackFailures=0;
  int sourceSampleRate=0;
  std::string outputFormat="f32";
  std::string dither="none";
  json processingStages=json::array();
  std::string trackId,nextTrackId,fromTrackId;
  uint64_t transitionSerial=0;
  double duration=0;
  bool transitioning=false;
  bool transitionStartPending=false;
  json sourceFormat=json::object();
  json stats=json{{"overRangeSamples",0},{"clippingSamples",0},{"peakAbs",0.0}};
  std::string error;
};

template<class T> class WasapiComPtr {
 public:
  WasapiComPtr()=default;
  ~WasapiComPtr(){if(value_)value_->Release();}
  WasapiComPtr(const WasapiComPtr&)=delete;
  WasapiComPtr& operator=(const WasapiComPtr&)=delete;
  T* get() const{return value_;}
  T** put(){if(value_){value_->Release();value_=nullptr;}return &value_;}
  T* operator->() const{return value_;}
  T* detach(){T* result=value_;value_=nullptr;return result;}
 private:
  T* value_=nullptr;
};

class WasapiOutput {
 public:
  using ReadFn=std::function<WasapiRead(void*,DWORD)>;
  using PcmReadFn=std::function<WasapiPcmRead(double*,DWORD)>;
  using SeekFn=std::function<void(double)>;
  using PositionFn=std::function<double()>;

  WasapiOutput(std::string requestedDevice,std::string mode,int sampleRate,int channels,bool allow16Bit,double gain,
               bool dop,int dsdRate,
               ReadFn read,SeekFn seek,PositionFn position,PcmReadFn pcmRead={},
               std::string outputFormat="auto",std::string dither="none",int bufferMs=0,int sourceRate=0,int exactSourceBits=0)
      :requestedDevice_(std::move(requestedDevice)),mode_(std::move(mode)),sourceRate_(sampleRate),
       channels_(channels),allow16Bit_(allow16Bit),gain_(gain),dop_(dop),dsdRate_(dsdRate),dopPacker_(channels,24),
       read_(std::move(read)),seek_(std::move(seek)),position_(std::move(position)),pcmRead_(std::move(pcmRead)),
       requestedFormat_(std::move(outputFormat)),dither_(std::move(dither)),requestedBufferMs_(bufferMs),inputRate_(sourceRate>0?sourceRate:sampleRate),exactSourceBits_(exactSourceBits) {
    if(exactSourceBits_&&(mode_!="exclusive"||dop_||gain_.load()!=1.0||inputRate_!=sourceRate_||dither_!="none"))throw std::runtime_error("PCM 比特一致性需要同采样率独占整数输出、100%数字音量及无抖动");
    if(dop_&&(mode_!="exclusive"||dsdRate_<=0||allow16Bit_||gain_.load()!=1.0))
      throw std::runtime_error("WASAPI DoP requires exclusive mode, a valid DSD rate, and locked 24-valid-bit integer output");
    if(!dop_&&!pcmRead_)throw std::runtime_error("WASAPI PCM output requires a double-precision read path");
    if(requestedBufferMs_<0||requestedBufferMs_>5000)throw std::runtime_error("Invalid WASAPI output buffer duration");
    if(requestedFormat_!="auto")PcmQuantizer::parse(requestedFormat_);
    if(dither_!="none"&&dither_!="rectangular"&&dither_!="triangular"&&dither_!="highpass")throw std::runtime_error("Invalid PCM dither mode");
    commandEvent_=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    stopEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    producerStopEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    producerReadyEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!commandEvent_||!stopEvent_||!producerStopEvent_||!producerReadyEvent_){const DWORD code=GetLastError();closeEvents();throw std::runtime_error("WASAPI命令事件创建失败 (Windows "+std::to_string(code)+")");}
    std::promise<void> ready;auto result=ready.get_future();
    struct StartContext {WasapiOutput* self;std::promise<void> ready;};
    auto context=std::make_unique<StartContext>(StartContext{this,std::move(ready)});
    worker_=CreateThread(nullptr,0,[](void* value)->DWORD {
      std::unique_ptr<StartContext> start(static_cast<StartContext*>(value));
      auto* self=start->self;auto promise=std::move(start->ready);start.reset();self->run(promise);return 0;
    },context.get(),0,nullptr);
    if(!worker_){closeEvents();throw std::runtime_error("WASAPI worker thread creation failed");}
    context.release();
    try {result.get();}
    catch(...) {shutdown();throw;}
  }

  ~WasapiOutput(){shutdown();}
  WasapiOutput(const WasapiOutput&)=delete;
  WasapiOutput& operator=(const WasapiOutput&)=delete;

  static std::vector<WasapiDevice> enumerateDevices() {
    bool ownsApartment=false;initializeApartment(ownsApartment);
    try {
      std::vector<WasapiDevice> result;
      {
      WasapiComPtr<IMMDeviceEnumerator> enumerator;
      checkHr(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,
                              __uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(enumerator.put())),"WASAPI设备枚举器创建失败");
      WasapiComPtr<IMMDevice> defaultDevice;
      const HRESULT defaultResult=enumerator->GetDefaultAudioEndpoint(eRender,eConsole,defaultDevice.put());
      const std::string defaultId=SUCCEEDED(defaultResult)?deviceId(defaultDevice.get()):std::string();
      WasapiComPtr<IMMDeviceCollection> collection;
      checkHr(enumerator->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,collection.put()),"WASAPI播放设备枚举失败");
      UINT count=0;checkHr(collection->GetCount(&count),"WASAPI播放设备数量读取失败");
      result.reserve(count);
      for(UINT i=0;i<count;i++) {
        WasapiComPtr<IMMDevice> device;checkHr(collection->Item(i,device.put()),"WASAPI播放设备读取失败");
        WasapiDevice item;item.id=deviceId(device.get());item.name=deviceName(device.get(),item.id);item.isDefault=item.id==defaultId;
        result.push_back(std::move(item));
      }
      }
      if(ownsApartment)CoUninitialize();return result;
    }catch(...){if(ownsApartment)CoUninitialize();throw;}
  }

  WasapiSnapshot snapshot() const {
    WasapiSnapshot result;
    {std::lock_guard<std::mutex> lock(snapshotMutex_);result=snapshot_;}
    CurrentCursor cursor{};const bool cursorValid=readCurrentCursor(cursor);
    const std::uint64_t descriptor=cursorValid?cursor.descriptorId:0;
    bool metadataApplied=false;
    if(descriptor&&!dop_) {
      std::lock_guard<std::mutex> lock(metadataMutex_);
      const MetadataSlot* slot=descriptorSlot(descriptor);
      if(slot&&slot->id.load(std::memory_order_acquire)==descriptor&&slot->metadata&&slot->metadata->transitionSerial==cursor.transitionSerial) {
        metadataApplied=true;
        const auto& segment=*slot->metadata;
        result.trackId=segment.trackId;result.transitionSerial=segment.transitionSerial;
        result.duration=segment.duration;result.durationExact=segment.sourceFormat.is_object()&&segment.sourceFormat.value("exactFrameCount",false);result.sourceSampleRate=segment.sourceSampleRate;
        result.sourceFormat=segment.sourceFormat;result.processingStages=segment.processingStages;
        result.position=result.durationExact?std::clamp(cursor.position,0.0,std::max(0.0,segment.duration)):std::max(0.0,cursor.position);
        result.transitioning=cursor.transitioning;
        result.transitionStartPending=cursor.transitionStartPending;
        result.fromTrackId=result.transitioning?segment.fromTrackId:std::string();
        result.nextTrackId=result.transitioning?segment.nextTrackId:std::string();
        if(!result.transitioning&&segment.transitioning&&result.processingStages.is_array())
          for(auto& stage:result.processingStages)if(stage.is_object()&&stage.value("id",std::string())=="mix") {
            stage["active"]=false;stage["reason"]="Crossfade mix has completed";break;
          }
      }
    } else if(dop_) {
      const double decoded=position_?position_():result.position;
      const std::uint64_t queued=dopSource_.queuedFrames()+hardwarePendingFrames_.load(std::memory_order_relaxed);
      result.position=std::max(0.0,decoded-static_cast<double>(queued)/std::max(1,sourceRate_));
    }
    result.buffering=renderBuffering_.load(std::memory_order_relaxed);
    if(renderEnded_.load(std::memory_order_acquire)){result.ended=true;result.playing=false;result.paused=true;result.buffering=false;}
    if(rtPauseComplete_.load(std::memory_order_acquire)){result.playing=false;result.paused=true;result.buffering=false;}
    result.producerQueueFrames=dop_?dopSource_.queuedFrames():pcmQueue_.queuedFrames();
    result.underflows=underflowCount_.load(std::memory_order_relaxed);
    result.callbackFailures=callbackFailureCount_.load(std::memory_order_relaxed);
    if(!dop_){result.stats=publishedQuantizerStats();const double gain=gain_.load(std::memory_order_acquire);if(result.processingStages.is_array())for(auto& stage:result.processingStages)if(stage.is_object()&&stage.value("id",std::string())=="volume"){stage["active"]=std::abs(gain-1.0)>1e-12;stage["reason"]=stage["active"].get<bool>()?"Applied immediately before final output conversion":"Unity gain";}}
    const int failure=rtFailureCode_.load(std::memory_order_acquire);
    if(failure) {
      result.playing=false;result.paused=true;result.buffering=false;
      if(failure==RtFailureSource) {
        std::lock_guard<std::mutex> lock(producerErrorMutex_);result.error=producerError_.empty()?"WASAPI PCM producer failed":producerError_;
      } else if(failure==RtFailureQuantizer) {
        result.error=quantizerErrorText(publishedQuantizerError_.load(std::memory_order_relaxed));
      } else if(failure==RtFailureMetadata)result.error="WASAPI PCM metadata event capacity was exceeded";
      else if(failure==RtFailureBitPerfect)result.error="PCM 比特一致性输出缓冲耗尽，已停止输出";
      else result.error="WASAPI PCM render callback failed";
    }
    {std::lock_guard<std::mutex> lock(snapshotMutex_);
      snapshot_.position=result.position;snapshot_.playing=result.playing;snapshot_.paused=result.paused;
      snapshot_.ended=result.ended;snapshot_.buffering=result.buffering;snapshot_.producerQueueFrames=result.producerQueueFrames;
      snapshot_.underflows=result.underflows;snapshot_.callbackFailures=result.callbackFailures;snapshot_.stats=result.stats;
      if(metadataApplied){snapshot_.trackId=result.trackId;snapshot_.transitionSerial=result.transitionSerial;snapshot_.duration=result.duration;snapshot_.durationExact=result.durationExact;snapshot_.sourceSampleRate=result.sourceSampleRate;snapshot_.sourceFormat=result.sourceFormat;snapshot_.processingStages=result.processingStages;snapshot_.transitioning=result.transitioning;snapshot_.transitionStartPending=result.transitionStartPending;snapshot_.fromTrackId=result.fromTrackId;snapshot_.nextTrackId=result.nextTrackId;}
      if(failure)snapshot_.error=result.error;
    }
    return result;
  }
  bool finished() const{return finished_.load();}
  void setTrackMetadata(const std::string& trackId,double duration,int sourceRate,const json& sourceFormat,
                        const json& processingStages,uint64_t transitionSerial,double position=0) {
    const bool exact=sourceFormat.is_object()&&sourceFormat.value("exactFrameCount",false);
    updateSnapshot([&](WasapiSnapshot& s){s.trackId=trackId;s.duration=duration;s.durationExact=exact;s.sourceSampleRate=sourceRate;s.sourceFormat=sourceFormat;s.processingStages=processingStages;s.transitionSerial=transitionSerial;s.position=exact?std::clamp(position,0.0,std::max(0.0,duration)):std::max(0.0,position);s.transitioning=false;s.transitionStartPending=false;s.nextTrackId.clear();s.fromTrackId.clear();});
  }

  void play(){invoke([this]{
    if(!snapshot_.error.empty())throw std::runtime_error(snapshot_.error);
    if(rtFailureCode_.load(std::memory_order_acquire)!=RtFailureNone)throw std::runtime_error(snapshot().error);
    if(started_&&!renderEnded_.load(std::memory_order_acquire))return;
    if(snapshot_.ended||renderEnded_.load(std::memory_order_acquire)) {
      stopProducers();
      if(client_){if(started_)checkHr(client_->Stop(),"WASAPI重播前暂停失败");started_=false;checkHr(client_->Reset(),"WASAPI重播前缓冲重置失败");if(dop_)dopSource_.reset();seek_(0);dopPacker_.reset();if(!dop_){pcmQuantizer_.reset();publishQuantizerStats();}clearQueue();eofSeen_=false;renderEnded_.store(false,std::memory_order_relaxed);rtFailureCode_.store(RtFailureNone,std::memory_order_relaxed);updateSnapshot([&](WasapiSnapshot& s){s.position=position_();s.ended=false;if(!dop_)s.stats=publishedQuantizerStats();});startProducers();}
      else {seek_(0);openDevice();}
    }
    if(!client_)throw std::runtime_error("WASAPI播放设备已关闭");
    pauseAfterFade_=false;fadeOutActive_=false;fadeOutTotal_=fadeOutDone_=0;rtPauseComplete_.store(false,std::memory_order_release);
    if(!dop_&&producerReadyEvent_)WaitForSingleObject(producerReadyEvent_,500);
    if(pendingFrames_==0)renderOnce(true);
    if(!snapshot_.error.empty())throw std::runtime_error(snapshot_.error);
    if(rtFailureCode_.load(std::memory_order_acquire)!=RtFailureNone)throw std::runtime_error(snapshot().error);
    if(renderEnded_.load(std::memory_order_acquire)){updateSnapshot([](WasapiSnapshot& s){s.ended=true;s.playing=false;s.paused=true;});return;}
    checkHr(client_->Start(),"WASAPI播放启动失败");started_=true;
    updateSnapshot([&](WasapiSnapshot& s){s.playing=true;s.paused=false;s.ended=false;s.buffering=false;s.error.clear();});
  });}

  void pause(int fadeMs=0){
    if(fadeMs<=0){invoke([this]{
      if(!client_||!started_)return;
      updatePosition();checkHr(client_->Stop(),"WASAPI暂停失败");started_=false;pauseAfterFade_=false;fadeOutActive_=false;
      updateSnapshot([](WasapiSnapshot& s){s.playing=false;s.paused=true;s.buffering=false;});
    });return;}
    const size_t frames=static_cast<size_t>(std::llround(static_cast<double>(fadeMs)*sourceRate_/1000.0));
    invoke([this,frames]{
      if(!client_||!started_||dop_||frames==0){if(client_&&started_){updatePosition();checkHr(client_->Stop(),"WASAPI暂停失败");started_=false;updateSnapshot([](WasapiSnapshot& s){s.playing=false;s.paused=true;s.buffering=false;});}return;}
      updatePosition();fadeOutTotal_=frames;fadeOutDone_=0;fadeOutActive_=true;pauseAfterFade_=false;
    });
    const auto state=snapshot();if(state.paused)return;
    const DWORD waitMs=static_cast<DWORD>(std::clamp(fadeMs+static_cast<int>(state.bufferMs)+3000,1000,65000));
    std::unique_lock<std::mutex> lock(snapshotMutex_);
    if(!snapshotChanged_.wait_for(lock,std::chrono::milliseconds(waitMs),[this]{return snapshot_.paused||!snapshot_.error.empty()||rtPauseComplete_.load(std::memory_order_acquire)||rtFailureCode_.load(std::memory_order_acquire)!=RtFailureNone||finished_.load();}))
      throw std::runtime_error("WASAPI transport fade timed out");
    const std::string error=snapshot_.error;lock.unlock();
    const auto stateAfterWait=snapshot();if(!stateAfterWait.error.empty())throw std::runtime_error(stateAfterWait.error);
    if(!error.empty())throw std::runtime_error(error);
  }

  void seek(double target){invoke([this,target]{
    if(!snapshot_.error.empty())throw std::runtime_error(snapshot_.error);
    const bool resume=started_;
    stopProducers();
    if(client_){if(started_){checkHr(client_->Stop(),"WASAPI定位前暂停失败");started_=false;}checkHr(client_->Reset(),"WASAPI缓冲重置失败");}
    if(dop_&&client_)dopSource_.reset();
    seek_(target);dopPacker_.reset();if(!dop_){pcmQuantizer_.reset();publishQuantizerStats();}clearQueue();eofSeen_=false;renderEnded_.store(false,std::memory_order_relaxed);rtPauseComplete_.store(false,std::memory_order_relaxed);rtFailureCode_.store(RtFailureNone,std::memory_order_relaxed);
    {std::lock_guard<std::mutex> lock(producerErrorMutex_);producerError_.clear();}
    if(!client_)openDevice();
    updateSnapshot([&](WasapiSnapshot& s){s.position=position_();s.playing=false;s.paused=true;s.ended=false;s.buffering=false;s.error.clear();if(!dop_)s.stats=pcmQuantizer_.statsJson();});
    if(client_)startProducers();
    if(resume){if(!dop_&&producerReadyEvent_)WaitForSingleObject(producerReadyEvent_,500);renderOnce(true);if(!snapshot_.error.empty())throw std::runtime_error(snapshot_.error);if(rtFailureCode_.load(std::memory_order_acquire)!=RtFailureNone)throw std::runtime_error(snapshot().error);checkHr(client_->Start(),"WASAPI定位后继续播放失败");started_=true;updateSnapshot([](WasapiSnapshot& s){s.playing=true;s.paused=false;});}
  });}

  void setFadeIn(int fadeMs){
    if(fadeMs<=0||dop_)return;
    const size_t frames=static_cast<size_t>(std::llround(static_cast<double>(fadeMs)*sourceRate_/1000.0));
    invoke([this,frames]{fadeInTotal_=frames;fadeInDone_=0;fadeInActive_=frames>0;});
  }

  void setVolume(double gain,std::function<void()> committed={},json processingStages=json::array()){
    if(dop_){if(!std::isfinite(gain)||gain!=1.0)throw std::runtime_error("WASAPI DoP digital volume is locked");return;}
    gain_.store(gain,std::memory_order_release);if(committed)committed();
    const auto updateVolume=[&](json& stages){if(stages.is_array())for(auto& stage:stages)if(stage.is_object()&&stage.value("id",std::string())=="volume"){
      stage["active"]=std::abs(gain-1.0)>1e-7;stage["reason"]=stage["active"].get<bool>()?"Applied immediately before final output conversion":"Unity gain";break;
    }};
    updateSnapshot([&](WasapiSnapshot& s){if(processingStages.is_array()&&!processingStages.empty())s.processingStages=processingStages;updateVolume(s.processingStages);});
  }

  void setTrackProcessingStages(const std::string& trackId,json processingStages){
    const json snapshotStages=processingStages;
    // Prepared audio keeps its immutable DSP descriptor until it is heard.
    // Future producer blocks carry the updated stages; never relabel old PCM.
    updateSnapshot([&](WasapiSnapshot& s){if(s.trackId==trackId)s.processingStages=snapshotStages;});
  }

  void renderCommand(std::function<void()> action){invoke([action=std::move(action)]{action();});}

 private:
#ifdef RHINE_AUDIO_OFFLINE_AUDIT
  friend struct WasapiOfflineAudit;
  struct OfflineAuditTag {};
  explicit WasapiOutput(OfflineAuditTag) {}
#endif
  enum RtFailureCode {RtFailureNone=0,RtFailureSource=1,RtFailureQuantizer=2,RtFailureMetadata=3,RtFailureCallback=4,RtFailureBitPerfect=5};
  struct MetadataSlot {
    std::atomic<std::uint64_t> id{0};
    std::atomic<std::uint32_t> references{0};
    std::string key;
    std::unique_ptr<PcmTrackSegment> metadata;
  };
  struct TimelineSpan {
    RtPcmEvent event{};
    std::uint64_t startFrame=0;
    std::uint32_t consumedFrames=0;
    bool releaseDescriptor=false;
  };
  struct CurrentCursor {
    std::uint64_t descriptorId=0;
    std::uint64_t transitionSerial=0;
    double position=0.0;
    bool transitioning=false;
    bool transitionStartPending=false;
  };

  void beginCursorWrite() noexcept {currentCursorVersion_.fetch_add(1,std::memory_order_seq_cst);}
  void endCursorWrite() noexcept {currentCursorVersion_.fetch_add(1,std::memory_order_seq_cst);}
  void resetCurrentCursor() noexcept {
    beginCursorWrite();
    currentDescriptorId_.store(0,std::memory_order_seq_cst);
    currentPosition_.store(0.0,std::memory_order_seq_cst);
    currentTransitioning_.store(false,std::memory_order_seq_cst);
    currentTransitionStartPending_.store(false,std::memory_order_seq_cst);
    currentTransitionSerial_.store(0,std::memory_order_seq_cst);
    endCursorWrite();
  }
  bool readCurrentCursor(CurrentCursor& output) const noexcept {
    for(int attempt=0;attempt<4;attempt++) {
      const std::uint64_t before=currentCursorVersion_.load(std::memory_order_seq_cst);
      if(before&1u)continue;
      CurrentCursor candidate;
      candidate.descriptorId=currentDescriptorId_.load(std::memory_order_seq_cst);
      candidate.position=currentPosition_.load(std::memory_order_seq_cst);
      candidate.transitioning=currentTransitioning_.load(std::memory_order_seq_cst);
      candidate.transitionStartPending=currentTransitionStartPending_.load(std::memory_order_seq_cst);
      candidate.transitionSerial=currentTransitionSerial_.load(std::memory_order_seq_cst);
      const std::uint64_t after=currentCursorVersion_.load(std::memory_order_seq_cst);
      if(before==after){output=candidate;return true;}
    }
    return false;
  }

  template<class F> void invoke(F&& function) {
    std::unique_lock<std::mutex> serialize(commandMutex_); // Caller only; never taken by the audio worker.
    if(finished_.load(std::memory_order_acquire))throw std::runtime_error("WASAPI音频线程已结束");
    AudioCommand command;command.action=std::forward<F>(function);command.done=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!command.done)throw std::runtime_error("WASAPI command completion event creation failed");
    pendingCommand_.store(&command,std::memory_order_release);
    if(!SetEvent(commandEvent_)){TerminateProcess(GetCurrentProcess(),ERROR_INVALID_HANDLE);std::terminate();}
    const HANDLE waits[2]={command.done,worker_};const DWORD result=WaitForMultipleObjects(2,waits,FALSE,20000);
    if(result!=WAIT_OBJECT_0&&result!=WAIT_OBJECT_0+1){TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);std::terminate();}
    AudioCommand* expected=&command;pendingCommand_.compare_exchange_strong(expected,nullptr,std::memory_order_acq_rel);
    CloseHandle(command.done);
    if(!command.completed.load(std::memory_order_acquire))throw std::runtime_error("WASAPI音频线程已结束");
    if(command.failure)std::rethrow_exception(command.failure);
  }

  static void initializeApartment(bool& owns) {
    const HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    if(SUCCEEDED(hr)){owns=true;return;}
    if(hr==RPC_E_CHANGED_MODE){owns=false;return;}
    throw std::runtime_error(hrText("WASAPI COM初始化失败",hr));
  }

  static std::string hrText(const char* message,HRESULT hr) {
    char value[16]{};std::snprintf(value,sizeof(value),"0x%08lX",static_cast<unsigned long>(hr));
    return std::string(message)+" (HRESULT "+value+")";
  }
  static void checkHr(HRESULT hr,const char* message){if(FAILED(hr))throw std::runtime_error(hrText(message,hr));}
  static std::string utf8(const wchar_t* value) {
    if(!value)return {};const int size=WideCharToMultiByte(CP_UTF8,0,value,-1,nullptr,0,nullptr,nullptr);
    if(size<=1)return {};std::string result(size,'\0');WideCharToMultiByte(CP_UTF8,0,value,-1,result.data(),size,nullptr,nullptr);result.pop_back();return result;
  }
  static std::string deviceId(IMMDevice* device) {
    LPWSTR value=nullptr;checkHr(device->GetId(&value),"WASAPI设备ID读取失败");
    std::string result=utf8(value);CoTaskMemFree(value);return result;
  }
  static std::string deviceName(IMMDevice* device,const std::string& fallback) {
    WasapiComPtr<IPropertyStore> store;HRESULT hr=device->OpenPropertyStore(STGM_READ,store.put());
    if(FAILED(hr))return fallback;PROPVARIANT value;PropVariantInit(&value);
    hr=store->GetValue(PKEY_Device_FriendlyName,&value);std::string result=fallback;
    if(SUCCEEDED(hr)&&value.vt==VT_LPWSTR&&value.pwszVal)result=utf8(value.pwszVal);
    PropVariantClear(&value);return result;
  }
  static WAVEFORMATEXTENSIBLE format(int rate,int channels,int bits,int validBits,bool floating) {
    WAVEFORMATEXTENSIBLE value{};value.Format.wFormatTag=WAVE_FORMAT_EXTENSIBLE;value.Format.nChannels=static_cast<WORD>(channels);
    value.Format.nSamplesPerSec=static_cast<DWORD>(rate);value.Format.wBitsPerSample=static_cast<WORD>(bits);
    value.Format.nBlockAlign=static_cast<WORD>(channels*(bits/8));value.Format.nAvgBytesPerSec=value.Format.nSamplesPerSec*value.Format.nBlockAlign;
    value.Format.cbSize=sizeof(WAVEFORMATEXTENSIBLE)-sizeof(WAVEFORMATEX);value.Samples.wValidBitsPerSample=static_cast<WORD>(validBits);
    value.dwChannelMask=channels==1?SPEAKER_FRONT_CENTER:(SPEAKER_FRONT_LEFT|SPEAKER_FRONT_RIGHT);
    value.SubFormat=floating?KSDATAFORMAT_SUBTYPE_IEEE_FLOAT:KSDATAFORMAT_SUBTYPE_PCM;return value;
  }
  std::vector<PcmSampleFormat> pcmChoices() const {
    if(exactSourceBits_==16)return {PcmSampleFormat::Int16,PcmSampleFormat::Int32Valid16,PcmSampleFormat::Int24,PcmSampleFormat::Int32Valid24,PcmSampleFormat::Int32};
    if(exactSourceBits_==24)return {PcmSampleFormat::Int24,PcmSampleFormat::Int32Valid24,PcmSampleFormat::Int32};
    if(exactSourceBits_==32)return {PcmSampleFormat::Int32};
    if(requestedFormat_!="auto")return {PcmQuantizer::parse(requestedFormat_)};
    std::vector<PcmSampleFormat> result={PcmSampleFormat::Float32,PcmSampleFormat::Int32Valid24,PcmSampleFormat::Int24,PcmSampleFormat::Int32};
    if(allow16Bit_)result.push_back(PcmSampleFormat::Int16);
    return result;
  }
  WAVEFORMATEXTENSIBLE pcmWaveFormat(PcmSampleFormat choice) const {
    return format(sourceRate_,channels_,PcmQuantizer::containerBits(choice),PcmQuantizer::bits(choice),PcmQuantizer::floating(choice));
  }

  void run(std::promise<void>& ready) {
    bool ownsApartment=false;HANDLE mmcss=nullptr;DWORD taskIndex=0;bool readySignalled=false;
    try {
      workerThreadId_.store(GetCurrentThreadId(),std::memory_order_release);
      initializeApartment(ownsApartment);
      openDevice();
      mmcss=AvSetMmThreadCharacteristicsW(L"Audio",&taskIndex);if(mmcss)AvSetMmThreadPriority(mmcss,AVRT_PRIORITY_HIGH);
      ready.set_value();readySignalled=true;
      for(;;) {
        HANDLE handles[3]={stopEvent_,commandEvent_,audioEvent_};const DWORD count=audioEvent_?3:2;
        const DWORD wait=WaitForMultipleObjects(count,handles,FALSE,INFINITE);
        if(wait==WAIT_OBJECT_0)break;
        if(wait==WAIT_OBJECT_0+1){processCommands();continue;}
        if(audioEvent_&&wait==WAIT_OBJECT_0+2){
          if(!renderOnce())continue;
          if(rtPauseComplete_.exchange(false,std::memory_order_acq_rel)) {
            if(started_)checkHr(client_->Stop(),"WASAPI淡出暂停失败");started_=false;pauseAfterFade_=false;fadeOutActive_=false;
            updateSnapshot([](WasapiSnapshot& s){s.playing=false;s.paused=true;s.buffering=false;});
          }
          processCommands();if(pendingCommand_.load(std::memory_order_acquire))continue;
          const bool canContinue=client_&&!renderEnded_.load(std::memory_order_acquire)&&rtFailureCode_.load(std::memory_order_acquire)==RtFailureNone&&!snapshot_.ended&&snapshot_.error.empty();
          if(canContinue)continue;break;
        }
        if(wait==WAIT_FAILED){setFailure(std::string("WASAPI音频线程等待失败 (Windows ")+std::to_string(GetLastError())+")");break;}
        setFailure("WASAPI音频线程收到无效事件");break;
      }
    }catch(...) {
      if(!readySignalled){try{ready.set_exception(std::current_exception());}catch(...){}readySignalled=true;}
      else setFailure(exceptionText());
    }
    releaseAudio();
    if(mmcss)AvRevertMmThreadCharacteristics(mmcss);
    if(ownsApartment)CoUninitialize();
    finished_.store(true,std::memory_order_release);
    if(auto* abandoned=pendingCommand_.exchange(nullptr,std::memory_order_acq_rel)) {
      abandoned->failure=std::make_exception_ptr(std::runtime_error("WASAPI音频线程已结束"));
      const HANDLE done=abandoned->done;abandoned->completed.store(true,std::memory_order_release);SetEvent(done);
    }
    snapshotChanged_.notify_all();
    // The caller owns and destroys every task; the worker only executes a raw
    // mailbox pointer and acknowledges it before the caller may release it.
  }

  static std::string exceptionText() {
    try{throw;}catch(const std::exception& e){return e.what();}catch(...){return "WASAPI发生未知错误";}
  }

  void processCommands() {
    auto* command=pendingCommand_.exchange(nullptr,std::memory_order_acq_rel);if(!command)return;
    try {command->action();}
    catch(...) {command->failure=std::current_exception();if(client_&&started_){client_->Stop();started_=false;}setFailure(exceptionText());releaseAudio();SetEvent(stopEvent_);}
    const HANDLE done=command->done;command->completed.store(true,std::memory_order_release);SetEvent(done);
  }

  static std::string descriptorKey(const PcmTrackSegment& segment) {
    std::string key;
    auto append=[&](const std::string& value){key+=std::to_string(value.size());key.push_back(':');key+=value;};
    append(segment.trackId);append(segment.fromTrackId);append(segment.nextTrackId);
    key+=std::to_string(segment.transitionSerial);key.push_back('|');
    key+=segment.transitioning?'1':'0';key.push_back('|');
    key+=std::to_string(segment.sourceSampleRate);key.push_back('|');
    std::uint64_t durationBits=0;std::memcpy(&durationBits,&segment.duration,sizeof(durationBits));
    key+=std::to_string(durationBits);key.push_back('|');
    append(segment.sourceFormat.dump());append(segment.processingStages.dump());
    return key;
  }

  MetadataSlot* descriptorSlot(std::uint64_t id) noexcept {
    const std::uint32_t encoded=static_cast<std::uint32_t>(id);
    if(!encoded||encoded>descriptorCapacity_||!descriptorSlots_)return nullptr;
    return &descriptorSlots_[encoded-1];
  }
  const MetadataSlot* descriptorSlot(std::uint64_t id) const noexcept {
    const std::uint32_t encoded=static_cast<std::uint32_t>(id);
    if(!encoded||encoded>descriptorCapacity_||!descriptorSlots_)return nullptr;
    return &descriptorSlots_[encoded-1];
  }

  void rebuildDescriptorIndexLocked() {
    descriptorIdsByKey_.clear();
    for(std::size_t i=0;i<descriptorCapacity_;i++) {
      MetadataSlot& slot=descriptorSlots_[i];const std::uint64_t id=slot.id.load(std::memory_order_acquire);
      if(!id||!slot.metadata)continue;
      slot.key=descriptorKey(*slot.metadata);descriptorIdsByKey_.emplace(slot.key,id);
    }
  }

  std::uint64_t descriptorForProducer(const PcmTrackSegment& segment) {
    const std::string key=descriptorKey(segment);
    std::lock_guard<std::mutex> lock(metadataMutex_);
    const auto known=descriptorIdsByKey_.find(key);
    if(known!=descriptorIdsByKey_.end()) {
      MetadataSlot* slot=descriptorSlot(known->second);
      if(slot&&slot->id.load(std::memory_order_acquire)==known->second)return known->second;
      descriptorIdsByKey_.erase(known);
    }
    const std::uint64_t current=currentDescriptorId_.load(std::memory_order_acquire);
    for(std::size_t i=0;i<descriptorCapacity_;i++) {
      MetadataSlot& slot=descriptorSlots_[i];
      const std::uint64_t existing=slot.id.load(std::memory_order_acquire);
      if(slot.references.load(std::memory_order_acquire)!=0||(existing&&existing==current))continue;
      if(!slot.key.empty()) {
        const auto old=descriptorIdsByKey_.find(slot.key);
        if(old!=descriptorIdsByKey_.end()&&old->second==existing)descriptorIdsByKey_.erase(old);
      }
      auto metadata=std::make_unique<PcmTrackSegment>(segment);
      metadata->frames=0;metadata->positionStart=0;
      slot.metadata=std::move(metadata);slot.key=key;
      std::uint64_t generation=++nextDescriptorGeneration_;
      if(!generation)generation=++nextDescriptorGeneration_;
      const std::uint64_t id=(generation<<32)|static_cast<std::uint64_t>(i+1);
      slot.references.store(0,std::memory_order_relaxed);
      slot.id.store(id,std::memory_order_release);
      descriptorIdsByKey_.emplace(key,id);
      return id;
    }
    throw std::runtime_error("WASAPI PCM metadata descriptor table is full");
  }

  void retainDescriptor(std::uint64_t id) noexcept {
    if(!id)return;MetadataSlot* slot=descriptorSlot(id);
    if(slot&&slot->id.load(std::memory_order_acquire)==id)slot->references.fetch_add(1,std::memory_order_relaxed);
  }
  void releaseDescriptor(std::uint64_t id) noexcept {
    if(!id)return;MetadataSlot* slot=descriptorSlot(id);
    if(slot&&slot->id.load(std::memory_order_acquire)==id) {
      if(slot->references.load(std::memory_order_acquire))slot->references.fetch_sub(1,std::memory_order_acq_rel);
      else rtFailureCode_.store(RtFailureMetadata,std::memory_order_release);
    }
  }

  void changeCurrentDescriptor(const RtPcmEvent& event,std::uint32_t heardFrames) noexcept {
    const std::uint64_t previous=currentDescriptorId_.load(std::memory_order_seq_cst);
    const std::uint64_t previousSerial=currentTransitionSerial_.load(std::memory_order_seq_cst);
    const double position=event.startPositionSeconds+(event.timelineRate>0?static_cast<double>(heardFrames)/event.timelineRate:0.0);
    beginCursorWrite();
    if(previous!=event.descriptorId) {
      retainDescriptor(event.descriptorId);
      currentDescriptorId_.store(event.descriptorId,std::memory_order_seq_cst);
      releaseDescriptor(previous);
      currentTransitionStartPending_.store(event.transitionSerial>previousSerial,std::memory_order_seq_cst);
    } else currentTransitionStartPending_.store(false,std::memory_order_seq_cst);
    currentPosition_.store((event.flags&RtPcmSegmentExactDuration)?std::clamp(position,0.0,std::max(0.0,event.duration)):std::max(0.0,position),std::memory_order_seq_cst);
    currentTransitioning_.store((event.flags&RtPcmSegmentTransitioning)!=0&&heardFrames<event.frames,std::memory_order_seq_cst);
    currentTransitionSerial_.store(event.transitionSerial,std::memory_order_seq_cst);
    endCursorWrite();
  }

  void reconcileTimeline(std::uint64_t playedFrames) noexcept {
    while(timelineSpanCount_) {
      TimelineSpan& span=timelineSpans_[timelineSpanRead_];
      if(playedFrames<=span.startFrame)break;
      const std::uint64_t elapsed=std::min<std::uint64_t>(span.event.frames,
          playedFrames-span.startFrame);
      if(elapsed>span.consumedFrames) {
        const auto delta=static_cast<std::uint32_t>(elapsed-span.consumedFrames);
        pendingAudioFrames_=pendingAudioFrames_>delta?pendingAudioFrames_-delta:0;
        span.consumedFrames=static_cast<std::uint32_t>(elapsed);
        changeCurrentDescriptor(span.event,span.consumedFrames);
      }
      if(span.consumedFrames<span.event.frames)break;
      if(span.releaseDescriptor)for(std::uint32_t n=0;n<span.event.referenceReleases;n++)releaseDescriptor(span.event.descriptorId);
      timelineSpanRead_=(timelineSpanRead_+1)%timelineSpanCapacity_;--timelineSpanCount_;
    }
  }

  static std::string quantizerErrorText(int code) {
    switch(static_cast<PcmQuantizerError>(code)) {
      case PcmQuantizerError::NonFiniteSample:return "PCM output received a non-finite sample or gain";
      case PcmQuantizerError::Float32Range:return "PCM sample exceeds the float32 output range";
      case PcmQuantizerError::BitPerfectMismatch:return "PCM 本地样本一致性检查失败，已停止输出";
      case PcmQuantizerError::None:break;
    }
    return "WASAPI PCM quantizer failed";
  }
  json publishedQuantizerStats() const {
    return json{{"overRangeSamples",publishedOverRange_.load(std::memory_order_relaxed)},
                {"clippingSamples",publishedClipping_.load(std::memory_order_relaxed)},
                {"peakAbs",publishedPeakAbs_.load(std::memory_order_relaxed)},
                {"bitPerfectCheckedSamples",publishedBitPerfectChecked_.load(std::memory_order_relaxed)},
                {"bitPerfectMismatchSamples",publishedBitPerfectMismatch_.load(std::memory_order_relaxed)}};
  }
  void publishQuantizerStats() noexcept {
    const auto stats=pcmQuantizer_.stats();
    publishedOverRange_.store(stats.overRangeSamples,std::memory_order_relaxed);
    publishedClipping_.store(stats.clippingSamples,std::memory_order_relaxed);
    publishedPeakAbs_.store(stats.peakAbs,std::memory_order_relaxed);
    publishedBitPerfectChecked_.store(stats.bitPerfectCheckedSamples,std::memory_order_relaxed);
    publishedBitPerfectMismatch_.store(stats.bitPerfectMismatchSamples,std::memory_order_relaxed);
    publishedQuantizerError_.store(static_cast<int>(pcmQuantizer_.errorCode()),std::memory_order_release);
  }

  void setProducerError(const std::string& message) {
    {std::lock_guard<std::mutex> lock(producerErrorMutex_);producerError_=message;}
    callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);
    rtFailureCode_.store(RtFailureSource,std::memory_order_release);
    if(producerReadyEvent_)SetEvent(producerReadyEvent_);snapshotChanged_.notify_all();
  }

  void prepareProducerBuffers() {
    if(dop_) {
      const std::size_t frameBytes=static_cast<std::size_t>(channels_)*sizeof(float);
      dopSource_.configure(frameBytes,std::min<std::size_t>(16777216/frameBytes,std::max<std::size_t>(bufferFrames_*4,bufferFrames_+4096)),[this](std::uint8_t* destination,std::size_t capacityBytes) {
        WasapiRead read{};
        try {read=read_(destination,static_cast<DWORD>(std::min<std::size_t>(capacityBytes,MAXDWORD)));}
        catch(...) {setProducerError(exceptionText());return RtDsdBuffer::SourceRead{0,false,false,ERROR_READ_FAULT};}
        if(!read.error.empty()){setProducerError(read.error);return RtDsdBuffer::SourceRead{0,false,read.buffering,ERROR_READ_FAULT};}
        return RtDsdBuffer::SourceRead{read.bytes,read.eof,read.buffering,0};
      });
      scratchFloat_.resize(static_cast<std::size_t>(bufferFrames_)*channels_);
      return;
    }
    const std::size_t chunkFrames=std::min<std::size_t>(4096,std::max<std::size_t>(1,bufferFrames_));
    pcmQueue_.configure(static_cast<std::size_t>(channels_),bufferFrames_,chunkFrames,3);
    scratchDouble_.resize(static_cast<std::size_t>(bufferFrames_)*channels_);
    pcmEventScratch_.resize(pcmQueue_.maxConsumeEvents());
    timelineSpanCapacity_=std::max<std::size_t>(64,pcmQueue_.maxConsumeEvents()+8);
    timelineSpans_.reset(new TimelineSpan[timelineSpanCapacity_]);
    const std::size_t deviceChunks=(static_cast<std::size_t>(bufferFrames_)+chunkFrames-1)/chunkFrames;
    const std::size_t descriptorChunks=pcmQueue_.capacityChunks()+deviceChunks+1;
    if(descriptorChunks>kRtPcmMaxDescriptorSlots/kRtPcmMaxSegmentsPerChunk)
      throw std::length_error("WASAPI device and producer queues exceed the metadata descriptor limit");
    const std::size_t descriptorCapacity=std::max<std::size_t>(128,descriptorChunks*kRtPcmMaxSegmentsPerChunk);
    std::unique_ptr<MetadataSlot[]> descriptors(new MetadataSlot[descriptorCapacity]);
    {std::lock_guard<std::mutex> lock(metadataMutex_);descriptorSlots_=std::move(descriptors);descriptorCapacity_=descriptorCapacity;descriptorIdsByKey_.clear();nextDescriptorGeneration_=0;}
    resetCurrentCursor();
    timelineSpanRead_=timelineSpanWrite_=timelineSpanCount_=0;pendingAudioFrames_=0;totalSubmittedFrames_=0;
    if(!producerStopEvent_)producerStopEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!producerReadyEvent_)producerReadyEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!producerStopEvent_||!producerReadyEvent_)throw std::runtime_error("WASAPI PCM producer events could not be created");
    launchPcmProducer();
  }

  void launchPcmProducer() {
    if(!producerStopEvent_||!producerReadyEvent_)throw std::runtime_error("WASAPI PCM producer events are unavailable");
    ResetEvent(producerStopEvent_);ResetEvent(producerReadyEvent_);
    producerFinished_.store(false,std::memory_order_relaxed);
    if(pcmProducerThread_)throw std::runtime_error("WASAPI PCM producer is already running");
    pcmProducerThread_=CreateThread(nullptr,0,[](void* value)->DWORD{static_cast<WasapiOutput*>(value)->pcmProducerRun();return 0;},this,0,nullptr);
    if(!pcmProducerThread_)throw std::runtime_error("WASAPI PCM producer thread creation failed");
  }

  void pcmProducerRun() noexcept {
    producerThreadId_.store(GetCurrentThreadId(),std::memory_order_release);
    try {
      while(WaitForSingleObject(producerStopEvent_,0)!=WAIT_OBJECT_0) {
        RtPcmWriteBlock<double> write{};
        if(!pcmQueue_.tryBeginWrite(write)){WaitForSingleObject(producerStopEvent_,2);continue;}
        WasapiPcmRead block{};
        try {block=pcmRead_(write.data,static_cast<DWORD>(write.capacityFrames));}
        catch(...) {pcmQueue_.cancelWrite(write);setProducerError(exceptionText());break;}
        if(!block.error.empty()){pcmQueue_.cancelWrite(write);setProducerError(block.error);break;}
        if(block.frames>write.capacityFrames){pcmQueue_.cancelWrite(write);setProducerError("WASAPI PCM producer returned more frames than requested");break;}
        if(block.segments.size()>kRtPcmMaxSegmentsPerChunk){pcmQueue_.cancelWrite(write);setProducerError("WASAPI PCM producer returned too many metadata segments");break;}
        if(block.frames&&!block.segments.size()) {
          PcmTrackSegment fallback;
          {std::lock_guard<std::mutex> lock(snapshotMutex_);fallback.trackId=snapshot_.trackId;fallback.transitionSerial=snapshot_.transitionSerial;fallback.duration=snapshot_.duration;fallback.positionStart=snapshot_.position;fallback.sourceSampleRate=snapshot_.sourceSampleRate;fallback.sourceFormat=snapshot_.sourceFormat;fallback.processingStages=snapshot_.processingStages;}
          fallback.frames=block.frames;
          block.segments.push_back(std::move(fallback));
        }
        std::size_t segmentFrames=0;
        for(const auto& segment:block.segments) {
          if(segment.frames>block.frames-segmentFrames){segmentFrames=block.frames+1;break;}
          segmentFrames+=segment.frames;
        }
        if(segmentFrames>block.frames){pcmQueue_.cancelWrite(write);setProducerError("WASAPI PCM producer metadata exceeds its audio frame count");break;}
        if(segmentFrames<block.frames&&block.segments.size()>=kRtPcmMaxSegmentsPerChunk) {
          pcmQueue_.cancelWrite(write);setProducerError("WASAPI PCM frame timeline has no room for fallback metadata");break;
        }
        if(segmentFrames<block.frames) {
          PcmTrackSegment fallback;
          double fallbackPosition=0;
          {std::lock_guard<std::mutex> lock(snapshotMutex_);fallback.trackId=snapshot_.trackId;fallback.transitionSerial=snapshot_.transitionSerial;fallback.duration=snapshot_.duration;fallback.sourceSampleRate=snapshot_.sourceSampleRate;fallback.sourceFormat=snapshot_.sourceFormat;fallback.processingStages=snapshot_.processingStages;fallbackPosition=snapshot_.position;}
          fallback.positionStart=block.segments.empty()?fallbackPosition:block.segments.back().positionStart+static_cast<double>(block.segments.back().frames)/std::max(1,sourceRate_);
          fallback.frames=block.frames-segmentFrames;
          block.segments.push_back(std::move(fallback));
        }

        const std::size_t silenceBefore=block.silenceBeforeFirstSegmentFrames;
        const std::size_t silenceAfter=block.silenceAfterFirstSegmentFrames;
        if(silenceBefore>write.capacityFrames-block.frames||
           silenceAfter>write.capacityFrames-block.frames-silenceBefore) {
          pcmQueue_.cancelWrite(write);setProducerError("WASAPI PCM timeline silence exceeds the preallocated chunk");break;
        }
        const std::size_t expandedFrames=block.frames+silenceBefore+silenceAfter;
        std::size_t firstSegmentIndex=0;
        while(firstSegmentIndex<block.segments.size()&&!block.segments[firstSegmentIndex].frames)++firstSegmentIndex;
        const std::size_t firstSegmentFrames=firstSegmentIndex==block.segments.size()?block.frames:block.segments[firstSegmentIndex].frames;
        if(silenceBefore) {
          std::memmove(write.data+silenceBefore*channels_,write.data,block.frames*channels_*sizeof(double));
          std::fill_n(write.data,silenceBefore*channels_,0.0);
        }
        if(silenceAfter) {
          const std::size_t gapOffset=silenceBefore+firstSegmentFrames;
          const std::size_t trailing=block.frames-firstSegmentFrames;
          std::memmove(write.data+(gapOffset+silenceAfter)*channels_,write.data+gapOffset*channels_,trailing*channels_*sizeof(double));
          std::fill_n(write.data+gapOffset*channels_,silenceAfter*channels_,0.0);
        }

        RtPcmChunkInfo info{};info.frames=static_cast<std::uint32_t>(expandedFrames);
        if(block.eof)info.flags|=RtPcmChunkEof;
        if(!block.eof&&(block.buffering||expandedFrames<write.capacityFrames))info.flags|=RtPcmChunkBuffering;
        std::vector<std::uint64_t> referencedIds;
        referencedIds.reserve(block.segments.size());
        std::size_t outputOffset=silenceBefore;
        try {
          for(std::size_t i=0;i<block.segments.size();i++) {
            const auto& segment=block.segments[i];
            if(!segment.frames)continue;
            auto& target=info.segments[info.segmentCount++];
            target.descriptorId=descriptorForProducer(segment);
            target.startPositionSeconds=segment.positionStart;target.duration=segment.duration;
            target.sourceRate=segment.sourceSampleRate;target.timelineRate=sourceRate_;
            target.offset=static_cast<std::uint32_t>(outputOffset);target.frames=static_cast<std::uint32_t>(segment.frames);
            target.transitionSerial=segment.transitionSerial;
            if(segment.transitioning)target.flags|=RtPcmSegmentTransitioning;
            if(segment.sourceFormat.is_object()&&segment.sourceFormat.value("exactFrameCount",false))target.flags|=RtPcmSegmentExactDuration;
            if(target.descriptorId){retainDescriptor(target.descriptorId);referencedIds.push_back(target.descriptorId);}
            outputOffset+=segment.frames;
            if(i==firstSegmentIndex)outputOffset+=silenceAfter;
          }
        } catch(...) {
          for(const auto id:referencedIds)releaseDescriptor(id);
          pcmQueue_.cancelWrite(write);setProducerError(exceptionText());break;
        }
        if(block.frames==0&&!expandedFrames&&!block.eof) {
          for(const auto id:referencedIds)releaseDescriptor(id);
          pcmQueue_.cancelWrite(write);renderBuffering_.store(block.buffering,std::memory_order_relaxed);
          SetEvent(producerReadyEvent_);WaitForSingleObject(producerStopEvent_,2);continue;
        }
        if(!pcmQueue_.publish(write,info)) {
          for(const auto id:referencedIds)releaseDescriptor(id);
          pcmQueue_.cancelWrite(write);callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);
          rtFailureCode_.store(RtFailureMetadata,std::memory_order_release);break;
        }
        SetEvent(producerReadyEvent_);
        if(block.eof)break;
      }
    } catch(...) {setProducerError(exceptionText());}
    producerFinished_.store(true,std::memory_order_release);
  }

  void stopProducers() noexcept {
    if(dop_)dopSource_.stop();
    if(pcmProducerThread_) {
      if(producerStopEvent_)SetEvent(producerStopEvent_);
      CancelSynchronousIo(pcmProducerThread_);
      if(WaitForSingleObject(pcmProducerThread_,5000)!=WAIT_OBJECT_0) {
        std::fprintf(stderr,"WASAPI PCM producer did not stop within five seconds; terminating native host to avoid releasing live PCM state\n");
        TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);std::terminate();
      }
      CloseHandle(pcmProducerThread_);pcmProducerThread_=nullptr;
      producerThreadId_.store(0,std::memory_order_relaxed);
    }
  }

  void resetMetadataAndTimeline() noexcept {
    std::lock_guard<std::mutex> lock(metadataMutex_);
    resetCurrentCursor();
    for(std::size_t i=0;i<descriptorCapacity_;i++) {
      descriptorSlots_[i].references.store(0,std::memory_order_relaxed);
      descriptorSlots_[i].id.store(0,std::memory_order_release);
      descriptorSlots_[i].key.clear();descriptorSlots_[i].metadata.reset();
    }
    descriptorIdsByKey_.clear();
    timelineSpanRead_=timelineSpanWrite_=timelineSpanCount_=0;pendingAudioFrames_=0;
  }

  void startProducers() {
    if(dop_)dopSource_.start();
    else if(!pcmProducerThread_)launchPcmProducer();
  }

  void openDevice() {
    releaseAudio();
    WasapiComPtr<IMMDeviceEnumerator> enumerator;
    checkHr(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,
                            __uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(enumerator.put())),"WASAPI设备枚举器创建失败");
    WasapiComPtr<IMMDevice> device;
    if(requestedDevice_=="default")checkHr(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,device.put()),"WASAPI默认播放设备不可用");
    else {const std::wstring id=wide(requestedDevice_);checkHr(enumerator->GetDevice(id.c_str(),device.put()),"指定的WASAPI播放设备不可用");}
    const std::string actualId=deviceId(device.get());const std::string name=deviceName(device.get(),actualId);
    WasapiComPtr<IAudioClient> client;
    checkHr(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(client.put())),"WASAPI音频客户端创建失败");
    WAVEFORMATEX* mix=nullptr;checkHr(client->GetMixFormat(&mix),"WASAPI系统混音格式读取失败");
    const int mixRate=static_cast<int>(mix->nSamplesPerSec),mixBits=static_cast<int>(mix->wBitsPerSample);
    bool mixFloat=mix->wFormatTag==WAVE_FORMAT_IEEE_FLOAT;
    if(mix->wFormatTag==WAVE_FORMAT_EXTENSIBLE&&mix->cbSize>=sizeof(WAVEFORMATEXTENSIBLE)-sizeof(WAVEFORMATEX))mixFloat=IsEqualGUID(reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix)->SubFormat,KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)!=FALSE;
    CoTaskMemFree(mix);
    WAVEFORMATEXTENSIBLE selected{};int bits=32,validBits=32;bool floating=true;PcmSampleFormat pcmFormat=PcmSampleFormat::Float32;
    DWORD flags=AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    if(mode_=="shared") {
      flags|=AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM|AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
      bool initialized=false;HRESULT lastHr=AUDCLNT_E_UNSUPPORTED_FORMAT;
      const auto choices=pcmChoices();
      for(const auto choice:choices) {
        auto candidate=pcmWaveFormat(choice);const HRESULT hr=client->Initialize(AUDCLNT_SHAREMODE_SHARED,flags,0,0,&candidate.Format,nullptr);
        if(SUCCEEDED(hr)){selected=candidate;pcmFormat=choice;bits=PcmQuantizer::containerBits(choice);validBits=PcmQuantizer::bits(choice);floating=PcmQuantizer::floating(choice);initialized=true;break;}
        lastHr=hr;
        if(requestedFormat_!="auto"||hr!=AUDCLNT_E_UNSUPPORTED_FORMAT)break;
      }
      if(!initialized)throw std::runtime_error(hrText("WASAPI共享模式不支持请求的PCM输出格式",lastHr));
    }else {
      bool supported=false;HRESULT lastHr=AUDCLNT_E_UNSUPPORTED_FORMAT;
      std::vector<PcmSampleFormat> choices=dop_?std::vector<PcmSampleFormat>{PcmSampleFormat::Int24,PcmSampleFormat::Int32Valid24}:pcmChoices();
      for(const auto choice:choices) {
        auto candidate=dop_?format(sourceRate_,channels_,PcmQuantizer::containerBits(choice),PcmQuantizer::bits(choice),false):pcmWaveFormat(choice);
        const HRESULT hr=client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,&candidate.Format,nullptr);
        if(hr==S_OK){selected=candidate;pcmFormat=choice;bits=PcmQuantizer::containerBits(choice);validBits=PcmQuantizer::bits(choice);floating=PcmQuantizer::floating(choice);supported=true;break;}
        lastHr=hr;
        if(FAILED(hr)&&hr!=AUDCLNT_E_UNSUPPORTED_FORMAT)throw std::runtime_error(hrText("WASAPI独占格式探测失败",hr));
      }
      if(!supported)throw std::runtime_error(hrText(dop_?"WASAPI独占设备不支持DoP所需的精确载波率/声道数及24位整数容器":"WASAPI独占设备不支持请求的采样率、声道数及PCM输出格式",lastHr));
      REFERENCE_TIME defaultPeriod=0,minimumPeriod=0;
      checkHr(client->GetDevicePeriod(&defaultPeriod,&minimumPeriod),"WASAPI独占设备周期读取失败");
      const REFERENCE_TIME quantum=minimumPeriod>0?minimumPeriod:defaultPeriod;
      REFERENCE_TIME period=defaultPeriod>0?defaultPeriod:minimumPeriod;
      if(requestedBufferMs_>0&&quantum>0) {
        const REFERENCE_TIME requested=static_cast<REFERENCE_TIME>(requestedBufferMs_)*10000;
        period=((requested+quantum-1)/quantum)*quantum;
      }
      if(period<=0)throw std::runtime_error("WASAPI独占设备没有有效的事件周期");
      HRESULT initialized=client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE,flags,period,period,&selected.Format,nullptr);
      if(initialized==AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
        UINT32 alignedFrames=0;checkHr(client->GetBufferSize(&alignedFrames),"WASAPI独占对齐缓冲区大小读取失败");
        if(!alignedFrames)throw std::runtime_error("WASAPI独占设备返回了无效的对齐缓冲区大小");
        const REFERENCE_TIME alignedPeriod=static_cast<REFERENCE_TIME>((10000000LL*alignedFrames+sourceRate_-1)/sourceRate_);
        checkHr(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(client.put())),"WASAPI独占对齐后客户端重建失败");
        initialized=client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE,flags,alignedPeriod,alignedPeriod,&selected.Format,nullptr);
      }
      checkHr(initialized,"WASAPI独占模式初始化失败（设备可能被占用或格式/周期不可用）");
    }
    audioEvent_=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    if(!audioEvent_)throw std::runtime_error("WASAPI缓冲事件创建失败 (Windows "+std::to_string(GetLastError())+")");
    checkHr(client->SetEventHandle(audioEvent_),"WASAPI缓冲事件绑定失败");
    UINT32 bufferFrames=0;checkHr(client->GetBufferSize(&bufferFrames),"WASAPI缓冲区大小读取失败");
    if(!bufferFrames)throw std::runtime_error("WASAPI设备返回了空缓冲区");
    WasapiComPtr<IAudioRenderClient> render;
    checkHr(client->GetService(__uuidof(IAudioRenderClient),reinterpret_cast<void**>(render.put())),"WASAPI渲染服务创建失败");
    WasapiComPtr<IAudioClock> clock;UINT64 frequency=0;
    if(mode_=="exclusive") {
      checkHr(client->GetService(__uuidof(IAudioClock),reinterpret_cast<void**>(clock.put())),"WASAPI独占音频时钟创建失败");
      checkHr(clock->GetFrequency(&frequency),"WASAPI独占音频时钟频率读取失败");
      if(!frequency)throw std::runtime_error("WASAPI独占音频时钟频率无效");
    }
    device_=device.detach();client_=client.detach();render_=render.detach();bufferFrames_=bufferFrames;
    clock_=clock.detach();clockFrequency_=frequency;
    format_=selected;bitsPerSample_=bits;validBitsPerSample_=validBits;floating_=floating;
    if(dop_)dopPacker_.setBitsPerSample(bits);
    audioBlockBytes_=static_cast<UINT32>(channels_*(bits/8));
    if(!dop_){pcmQuantizer_.configure(pcmFormat,dither_,channels_,exactSourceBits_);publishQuantizerStats();}
    clearQueue();eofSeen_=false;started_=false;
    renderEnded_.store(false,std::memory_order_relaxed);rtFailureCode_.store(RtFailureNone,std::memory_order_relaxed);
    underflowCount_.store(0,std::memory_order_relaxed);callbackFailureCount_.store(0,std::memory_order_relaxed);renderBuffering_.store(false,std::memory_order_relaxed);
    updateSnapshot([&](WasapiSnapshot& s){s.deviceId=actualId;s.deviceName=name;s.mode=mode_;s.sampleRate=sourceRate_;s.sourceSampleRate=inputRate_;s.sampleFormat=floating_?"float":"pcm";s.bitsPerSample=bitsPerSample_;s.validBitsPerSample=floating_?0:validBitsPerSample_;s.outputFormat=dop_?"dop":PcmQuantizer::name(pcmFormat);s.callbackFormat=s.outputFormat;s.callbackContainerBits=bits;s.callbackValidBits=validBits;s.callbackAlignment=floating_?"not-applicable":"left";s.driverNativeFormat=mode_=="exclusive"?s.outputFormat:std::string();s.driverNativeContainerBits=mode_=="exclusive"?bits:0;s.driverNativeValidBits=mode_=="exclusive"?validBits:0;s.driverNativeAlignment=mode_=="exclusive"?(floating_?"not-applicable":"left"):"unknown";if(mode_=="exclusive")s.backendConversion=false;else s.backendConversion.reset();s.bufferControl=mode_=="shared"?"system":"application";s.bufferFrames=static_cast<int>(bufferFrames_);s.requestedBufferMs=requestedBufferMs_;s.durationExact=false;s.dither=dop_?"none":dither_;s.bufferMs=1000.0*bufferFrames_/std::max(1,sourceRate_);s.mixSampleRate=mixRate;s.mixSampleFormat=mixFloat?"float":"pcm";s.mixBitsPerSample=mixBits;s.channels=channels_;s.dsdRate=dop_?dsdRate_:0;s.volumeLocked=dop_;s.position=position_();s.playing=false;s.paused=true;s.ended=false;s.buffering=false;s.error.clear();s.producerQueueFrames=0;s.underflows=0;s.callbackFailures=0;s.stats=dop_?json{{"overRangeSamples",0},{"clippingSamples",0},{"peakAbs",0.0}}:pcmQuantizer_.statsJson();});
    prepareProducerBuffers();startProducers();
  }

  static std::wstring wide(const std::string& value) {
    if(value.find('\0')!=std::string::npos)throw std::runtime_error("WASAPI设备ID包含无效字符");
    const int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0);
    if(!size)throw std::runtime_error("WASAPI设备ID不是有效UTF-8");
    std::wstring result(size,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),result.data(),size);return result;
  }

  UINT32 queuedFrames() {
    if(mode_=="shared") {
      UINT32 padding=0;checkHr(client_->GetCurrentPadding(&padding),"WASAPI共享缓冲占用读取失败");return padding;
    }
    if(!totalSubmittedFrames_)return 0;
    UINT64 clockPosition=0;checkHr(clock_->GetPosition(&clockPosition,nullptr),"WASAPI独占音频时钟读取失败");
    const long double frames=static_cast<long double>(clockPosition)*sourceRate_/clockFrequency_;
    const UINT64 consumed=static_cast<UINT64>(std::clamp(frames,0.0L,static_cast<long double>(totalSubmittedFrames_)));
    return static_cast<UINT32>(totalSubmittedFrames_-consumed);
  }

  struct RenderBufferLease {
    IAudioRenderClient* client=nullptr;UINT32 frames=0;BYTE* data=nullptr;DWORD fallbackFlags=0;bool active=false;
    DopPacker* idlePacker=nullptr;
    ~RenderBufferLease(){if(active&&client){if(idlePacker&&data){DopError error{};idlePacker->fillIdle(data,frames,error);}client->ReleaseBuffer(frames,fallbackFlags);}}
    HRESULT release(DWORD flags) noexcept {if(!active||!client)return E_POINTER;active=false;return client->ReleaseBuffer(frames,flags);}
  };

  bool renderPaddingRt(UINT32& padding,std::uint64_t& played) noexcept {
    if(mode_=="shared") {
      if(FAILED(client_->GetCurrentPadding(&padding))){callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return false;}
    } else {
      if(!totalSubmittedFrames_){padding=0;played=0;return true;}
      UINT64 clockPosition=0;
      if(FAILED(clock_->GetPosition(&clockPosition,nullptr))){callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return false;}
      const long double exact=static_cast<long double>(clockPosition)*sourceRate_/clockFrequency_;
      played=static_cast<std::uint64_t>(std::clamp(exact,0.0L,static_cast<long double>(totalSubmittedFrames_)));
      padding=static_cast<UINT32>(totalSubmittedFrames_-played);
      return true;
    }
    played=totalSubmittedFrames_>padding?totalSubmittedFrames_-padding:0;
    return true;
  }

  bool appendTimelineEvents(std::uint32_t eventCount) noexcept {
    for(std::uint32_t i=0;i<eventCount;i++) {
      const RtPcmEvent& event=pcmEventScratch_[i];
      if(!event.frames)continue;
      if(timelineSpanCount_>=timelineSpanCapacity_) {
        callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureMetadata,std::memory_order_release);return false;
      }
      TimelineSpan& span=timelineSpans_[timelineSpanWrite_];
      span.event=event;span.startFrame=totalSubmittedFrames_+event.outputOffset;span.consumedFrames=0;
      span.releaseDescriptor=event.referenceReleases!=0;
      timelineSpanWrite_=(timelineSpanWrite_+1)%timelineSpanCapacity_;++timelineSpanCount_;
      pendingAudioFrames_+=event.frames;
    }
    return true;
  }

  bool renderOnce(bool prime=false) {
    if(!client_||!render_||(!started_&&!prime))return false;
    UINT32 padding=0;std::uint64_t played=0;
    if(!renderPaddingRt(padding,played))return true;
    reconcileTimeline(played);hardwarePendingFrames_.store(padding,std::memory_order_relaxed);
    if(pauseAfterFade_&&pendingAudioFrames_==0){rtPauseComplete_.store(true,std::memory_order_release);return true;}
    if(eofSeen_&&padding==0){renderEnded_.store(true,std::memory_order_release);return true;}
    if(eofSeen_)return false;
    const UINT32 frames=mode_=="exclusive"?bufferFrames_:bufferFrames_-padding;
    if(!frames)return false;
    BYTE* destination=nullptr;
    const HRESULT acquired=render_->GetBuffer(frames,&destination);
    if(FAILED(acquired)) {
      callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return true;
    }
    RenderBufferLease lease{render_,frames,destination,dop_?0u:AUDCLNT_BUFFERFLAGS_SILENT,true,dop_?&dopPacker_:nullptr};
    if(!destination){callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return true;}
    std::memset(destination,0,static_cast<std::size_t>(frames)*audioBlockBytes_);
    if(pauseAfterFade_) {
      if(dop_){DopError idleError{};dopPacker_.fillIdle(reinterpret_cast<std::uint8_t*>(destination),frames,idleError);}
      const HRESULT submitted=lease.release(dop_?0:AUDCLNT_BUFFERFLAGS_SILENT);
      if(FAILED(submitted)){callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return true;}
      totalSubmittedFrames_+=frames;
      hardwarePendingFrames_.store(std::min<std::uint64_t>(bufferFrames_,static_cast<std::uint64_t>(padding)+frames),std::memory_order_relaxed);
      return false;
    }
    if(dop_) {
      const auto source=dopSource_.consume(scratchFloat_.data(),frames);
      if(source.buffering){underflowCount_.fetch_add(1,std::memory_order_relaxed);renderBuffering_.store(true,std::memory_order_relaxed);}
      else renderBuffering_.store(false,std::memory_order_relaxed);
      if(source.error) {
        rtFailureCode_.store(RtFailureSource,std::memory_order_release);
        DopError idleError{};dopPacker_.fillIdle(reinterpret_cast<std::uint8_t*>(destination),frames,idleError);
      } else {
        if(source.eof)eofSeen_=true;
        DopError packError{};const DopPacker saved=dopPacker_;
        if(!dopPacker_.pack(scratchFloat_.data(),source.frames,reinterpret_cast<std::uint8_t*>(destination),frames,packError)) {
          dopPacker_=saved;rtFailureCode_.store(RtFailureCallback,std::memory_order_release);
          DopError idleError{};dopPacker_.fillIdle(reinterpret_cast<std::uint8_t*>(destination),frames,idleError);
        }
      }
    } else {
      const auto consumed=pcmQueue_.consume(scratchDouble_.data(),frames,pcmEventScratch_.data(),pcmEventScratch_.size());
      if(consumed.underflow)underflowCount_.fetch_add(1,std::memory_order_relaxed);
      renderBuffering_.store(consumed.buffering||consumed.underflow,std::memory_order_relaxed);
      if(consumed.eof)eofSeen_=true;
      if(consumed.eventOverflow) {
        callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureMetadata,std::memory_order_release);
      }
      if(exactSourceBits_&&consumed.timelineFrames<frames&&!consumed.eof)
        rtFailureCode_.store(RtFailureBitPerfect,std::memory_order_release);
      const double renderGain=gain_.load(std::memory_order_relaxed);
      for(std::uint32_t i=0;i<consumed.eventCount;i++) {
        const auto& event=pcmEventScratch_[i];
        applyFade(scratchDouble_.data()+static_cast<std::size_t>(event.outputOffset)*channels_,event.frames);
        pcmQuantizer_.writeInterleaved(destination+static_cast<std::size_t>(event.outputOffset)*audioBlockBytes_,
                                       scratchDouble_.data()+static_cast<std::size_t>(event.outputOffset)*channels_,
                                       event.frames,channels_,renderGain);
      }
      publishQuantizerStats();
      if(pcmQuantizer_.hasError())rtFailureCode_.store(RtFailureQuantizer,std::memory_order_release);
      if(!consumed.eventOverflow)appendTimelineEvents(consumed.eventCount);
    }
    const HRESULT submitted=lease.release(dop_?0:(rtFailureCode_.load(std::memory_order_relaxed)?AUDCLNT_BUFFERFLAGS_SILENT:0));
    if(FAILED(submitted)) {
      callbackFailureCount_.fetch_add(1,std::memory_order_relaxed);rtFailureCode_.store(RtFailureCallback,std::memory_order_release);return true;
    }
    totalSubmittedFrames_+=frames;
    pendingFrames_=totalSubmittedFrames_>played?static_cast<UINT32>(std::min<std::uint64_t>(totalSubmittedFrames_-played,bufferFrames_)):0;
    hardwarePendingFrames_.store(std::min<std::uint64_t>(bufferFrames_,static_cast<std::uint64_t>(padding)+frames),std::memory_order_relaxed);
    if(rtFailureCode_.load(std::memory_order_acquire)!=RtFailureNone)return true;
    return false;
  }

  void applyFade(double* samples,UINT32 frames) {
    if((!fadeOutActive_&&!fadeInActive_)||!samples||!frames)return;
    for(UINT32 frame=0;frame<frames;frame++) {
      double gain=1.0;
      if(fadeOutActive_)gain*=std::clamp(1.0-static_cast<double>(fadeOutDone_+frame+1)/std::max<size_t>(1,fadeOutTotal_),0.0,1.0);
      if(fadeInActive_)gain*=std::clamp(static_cast<double>(fadeInDone_+frame+1)/std::max<size_t>(1,fadeInTotal_),0.0,1.0);
      for(int channel=0;channel<channels_;channel++)samples[static_cast<size_t>(frame)*channels_+channel]*=gain;
    }
    if(fadeOutActive_) {
      fadeOutDone_+=frames;
      if(fadeOutDone_>=fadeOutTotal_){fadeOutDone_=fadeOutTotal_;pauseAfterFade_=true;}
    }
    if(fadeInActive_) {
      fadeInDone_+=frames;
      if(fadeInDone_>=fadeInTotal_)fadeInActive_=false;
    }
  }

  void reconcileQueue(UINT32 hardwarePadding) {
    const std::uint64_t played=totalSubmittedFrames_>hardwarePadding?totalSubmittedFrames_-hardwarePadding:0;
    reconcileTimeline(played);hardwarePendingFrames_.store(hardwarePadding,std::memory_order_relaxed);
  }
  void clearQueue(){
    if(pcmQueue_.configured())pcmQueue_.reset();
    resetMetadataAndTimeline();pendingFrames_=0;hardwarePendingFrames_.store(0,std::memory_order_relaxed);totalSubmittedFrames_=0;
  }
  double positionWithQueue() const {
    const double decoded=position_();
    const double queued=static_cast<double>(pcmQueue_.queuedFrames()+pendingAudioFrames_)/std::max(1,sourceRate_);
    return std::max(0.0,decoded-queued);
  }
  void updatePosition() {
    if(client_)reconcileQueue(queuedFrames());
    if(dop_) {
      const auto current=snapshot();updateSnapshot([&](WasapiSnapshot& s){s.position=current.position;});
    } else if(!currentDescriptorId_.load(std::memory_order_acquire))updateSnapshot([&](WasapiSnapshot& s){s.position=positionWithQueue();});
  }
  template<class F> void updateSnapshot(F&& update) {
    {std::lock_guard<std::mutex> lock(snapshotMutex_);update(snapshot_);}
    snapshotChanged_.notify_all();
  }
  void setFailure(const std::string& message) {
    updateSnapshot([&](WasapiSnapshot& s){s.error=message;s.playing=false;s.paused=true;s.buffering=false;});
  }
  void releaseAudio() {
    const auto saved=snapshot();(void)saved;
    stopProducers();
    if(client_&&started_)client_->Stop();started_=false;
    if(render_){render_->Release();render_=nullptr;}
    if(clock_){clock_->Release();clock_=nullptr;}
    if(client_){client_->Release();client_=nullptr;}
    if(device_){device_->Release();device_=nullptr;}
    if(audioEvent_){CloseHandle(audioEvent_);audioEvent_=nullptr;}
    bufferFrames_=0;clearQueue();scratchFloat_.clear();scratchDouble_.clear();pcmEventScratch_.clear();timelineSpans_.reset();{std::lock_guard<std::mutex> lock(metadataMutex_);descriptorSlots_.reset();descriptorCapacity_=0;descriptorIdsByKey_.clear();}timelineSpanCapacity_=0;fadeOutActive_=false;fadeInActive_=false;pauseAfterFade_=false;fadeOutTotal_=fadeOutDone_=fadeInTotal_=fadeInDone_=0;
  }
  void closeEvents(){if(commandEvent_){CloseHandle(commandEvent_);commandEvent_=nullptr;}if(stopEvent_){CloseHandle(stopEvent_);stopEvent_=nullptr;}if(producerStopEvent_){CloseHandle(producerStopEvent_);producerStopEvent_=nullptr;}if(producerReadyEvent_){CloseHandle(producerReadyEvent_);producerReadyEvent_=nullptr;}}
  void shutdown(){
    if(worker_){
      if(stopEvent_)SetEvent(stopEvent_);
      CancelSynchronousIo(worker_);
      if(WaitForSingleObject(worker_,5000)!=WAIT_OBJECT_0) {
        std::fprintf(stderr,"WASAPI worker did not stop within five seconds; terminating native host to avoid releasing live audio state\n");
        TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);std::terminate();
      }
      CloseHandle(worker_);worker_=nullptr;
    }
    closeEvents();
  }

  std::string requestedDevice_,mode_;
  int sourceRate_=0,channels_=0;bool allow16Bit_=false;std::atomic<double> gain_{1.0};bool dop_=false;int dsdRate_=0;
  DopPacker dopPacker_;
  ReadFn read_;SeekFn seek_;PositionFn position_;PcmReadFn pcmRead_;
  std::string requestedFormat_="auto",dither_="none";int requestedBufferMs_=0,inputRate_=0;
  HANDLE commandEvent_=nullptr,stopEvent_=nullptr,audioEvent_=nullptr,producerStopEvent_=nullptr,producerReadyEvent_=nullptr;
  HANDLE worker_=nullptr;std::atomic<bool> finished_{false};
  std::atomic<DWORD> workerThreadId_{0},producerThreadId_{0};
  HANDLE pcmProducerThread_=nullptr;std::atomic<bool> producerFinished_{false};
  RtPcmBuffer<double> pcmQueue_;RtDsdBuffer dopSource_;std::vector<RtPcmEvent> pcmEventScratch_;
  std::unique_ptr<MetadataSlot[]> descriptorSlots_;std::size_t descriptorCapacity_=0;std::unordered_map<std::string,std::uint64_t> descriptorIdsByKey_;std::uint64_t nextDescriptorGeneration_=0;
  mutable std::mutex metadataMutex_,producerErrorMutex_;std::string producerError_;
  std::unique_ptr<TimelineSpan[]> timelineSpans_;std::size_t timelineSpanCapacity_=0,timelineSpanRead_=0,timelineSpanWrite_=0,timelineSpanCount_=0;
  std::atomic<std::uint64_t> currentCursorVersion_{0},currentDescriptorId_{0},underflowCount_{0},callbackFailureCount_{0},hardwarePendingFrames_{0};
  std::atomic<double> currentPosition_{0.0};std::atomic<std::uint64_t> currentTransitionSerial_{0};
  std::atomic<bool> currentTransitioning_{false},currentTransitionStartPending_{false},renderBuffering_{false},renderEnded_{false},rtPauseComplete_{false};
  std::atomic<int> rtFailureCode_{RtFailureNone},publishedQuantizerError_{0};
  std::atomic<std::uint64_t> publishedOverRange_{0},publishedClipping_{0},publishedBitPerfectChecked_{0},publishedBitPerfectMismatch_{0};
  std::atomic<double> publishedPeakAbs_{0.0};
  struct AudioCommand {std::function<void()> action;std::exception_ptr failure;HANDLE done=nullptr;std::atomic<bool> completed{false};};
  std::mutex commandMutex_;mutable std::mutex snapshotMutex_;std::condition_variable snapshotChanged_;std::atomic<AudioCommand*> pendingCommand_{nullptr};
  mutable WasapiSnapshot snapshot_;
  IMMDevice* device_=nullptr;IAudioClient* client_=nullptr;IAudioRenderClient* render_=nullptr;IAudioClock* clock_=nullptr;
  UINT64 clockFrequency_=0,totalSubmittedFrames_=0;
  WAVEFORMATEXTENSIBLE format_{};UINT32 bufferFrames_=0,audioBlockBytes_=0;
  int bitsPerSample_=32,validBitsPerSample_=32;bool floating_=true,started_=false,eofSeen_=false;
  size_t fadeOutTotal_=0,fadeOutDone_=0,fadeInTotal_=0,fadeInDone_=0;bool fadeOutActive_=false,fadeInActive_=false,pauseAfterFade_=false;
  int exactSourceBits_=0;
  std::vector<float> scratchFloat_;std::vector<double> scratchDouble_;PcmQuantizer pcmQuantizer_;UINT32 pendingFrames_=0,pendingAudioFrames_=0;
};

} // namespace rhine
