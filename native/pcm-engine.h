#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <limits>
#include <optional>
#include <random>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "json.hpp"
#include "pcm-processing.h"
#include "pcm-resampler.h"
#include "pcm-soxr.h"

namespace rhine {

struct PcmDecodedBlock {
  size_t frames=0;
  bool eof=false;
  bool buffering=false;
  std::string error;
};

struct PcmTrackSegment {
  size_t frames=0;
  std::string trackId;
  uint64_t transitionSerial=0;
  double duration=0;
  double positionStart=0;
  int sourceSampleRate=0;
  json sourceFormat=json::object();
  json processingStages=json::array();
  bool transitioning=false;
  std::string fromTrackId;
  std::string nextTrackId;
};

struct PcmOutputBlock {
  size_t frames=0;
  bool eof=false;
  bool buffering=false;
  std::string error;
  std::vector<PcmTrackSegment> segments;
  size_t silenceBeforeFirstSegmentFrames=0;
  size_t silenceAfterFirstSegmentFrames=0;
};

class PcmEngine {
 public:
  using DecoderReadFn=std::function<PcmDecodedBlock(float*,size_t)>;
  using DoubleDecoderReadFn=std::function<PcmDecodedBlock(double*,size_t)>;

  void configure(const json& settings,int inputRate,int outputRate,int channels,const json& replayGain=json::object()) {
    if(inputRate<=0||outputRate<=0||channels<1||channels>2)throw std::runtime_error("Invalid PCM engine format");
    inputRate_=inputRate;outputRate_=outputRate;channels_=channels;
    bitPerfect_=settings.value("bitPerfect",false);
    if(bitPerfect_&&inputRate!=outputRate)throw std::runtime_error("Decoded PCM passthrough requires the source sample rate");
    processor_.configure(settings,inputRate,channels,replayGain);
    effectsLatencyFrames_=bitPerfect_?0:processor_.latencyFrames();
    resampling_=inputRate!=outputRate;
    const json resamplingSettings=settings.contains("resampling")&&settings["resampling"].is_object()?settings["resampling"]:json::object();
    resamplingEngine_=resamplingSettings.value("engine",std::string("r8brain"));
    if(resamplingEngine_!="r8brain"&&resamplingEngine_!="fast"&&resamplingEngine_!="soxr")throw std::runtime_error("Invalid resampling engine");
    fastResampling_=resampling_&&resamplingEngine_=="fast";
    soxrResampling_=resampling_&&resamplingEngine_=="soxr";
    if(resamplingEngine_=="soxr") {
      std::string soxrQuality="vhq";
      double soxrPassband=0.97;
      if(resamplingSettings.contains("soxrQuality")) {
        if(!resamplingSettings["soxrQuality"].is_string())throw std::runtime_error("SoXR quality must be 'hq' or 'vhq'");
        soxrQuality=resamplingSettings["soxrQuality"].get<std::string>();
      }
      if(soxrQuality!="hq"&&soxrQuality!="vhq")throw std::runtime_error("SoXR quality must be 'hq' or 'vhq'");
      if(resamplingSettings.contains("soxrPassband")) {
        if(!resamplingSettings["soxrPassband"].is_number())throw std::runtime_error("SoXR passband must be a number between 0.85 and 0.995");
        soxrPassband=resamplingSettings["soxrPassband"].get<double>();
      }
      if(!std::isfinite(soxrPassband)||soxrPassband<0.85||soxrPassband>0.995)throw std::runtime_error("SoXR passband must be between 0.85 and 0.995");
      if(soxrResampling_)soxrResampler_.configure(inputRate,outputRate,channels,soxrQuality,soxrPassband);
    } else {
      soxrResampler_.unconfigure();
    }
    if(resampling_&&!fastResampling_&&!soxrResampling_)resampler_.configure(inputRate,outputRate,channels,4096);
    reset();
    reserveFrames(4096);
  }

  void reset() {
    commitEffectsTransition();
    processor_.reset();
    effectsLatencyFrames_=bitPerfect_?0:processor_.latencyFrames();
    if(resampling_&&!fastResampling_) {
      if(soxrResampling_)soxrResampler_.reset();
      else resampler_.reset();
    }
    decodedFloat_.clear();decodedDouble_.clear();pendingInput_.clear();pendingOffset_=0;
    fastInput_.clear();effectsDecode_.clear();fastInputStart_=0;fastOutputFrames_=0;
    rawEnded_=false;effectsSkipFrames_=effectsLatencyFrames_;effectsFlushRemaining_=0;
    rawLatencyError_.clear();pendingReadError_.clear();
    decoderEnded_=false;resamplerFinished_=false;sourceFramesRead_=0;outputFramesRead_=0;
  }

  void reserveFrames(size_t frames) {
    if(channels_<=0)throw std::logic_error("PCM engine must be configured before reserving buffers");
    const size_t channels=static_cast<size_t>(channels_);
    if(frames>std::numeric_limits<size_t>::max()/channels)throw std::length_error("PCM reserve frame count overflows");
    decodedFloat_.reserve(frames*channels);decodedDouble_.reserve(frames*channels);
    const size_t reserveFrames=std::max<size_t>(frames,8192);
    if(reserveFrames>std::numeric_limits<size_t>::max()/channels)throw std::length_error("PCM reserve frame count overflows");
    pendingInput_.reserve(reserveFrames*channels);
    fastInput_.reserve(reserveFrames*channels);
    effectsDecode_.reserve(reserveFrames*channels);
    effectsOld_.reserve(reserveFrames*channels);effectsNew_.reserve(reserveFrames*channels);
  }

  // Prepare a replacement processor without disturbing decoder/SRC position.
  // fadeFrames==0 performs an immediate control-thread swap; otherwise both
  // processors run on the same source frames for a short output crossfade.
  void updateEffects(const json& settings,const json& replayGain,size_t fadeFrames=0) {
    if(inputRate_<=0||channels_<=0)throw std::logic_error("PCM engine must be configured before updating effects");
    PcmProcessor candidate;candidate.configure(settings,inputRate_,channels_,replayGain);
    updateEffects(std::move(candidate),fadeFrames);
  }

  void updateEffects(PcmProcessor&& candidate,size_t fadeFrames=0) {
    if(inputRate_<=0||channels_<=0)throw std::logic_error("PCM engine must be configured before updating effects");
    if(!candidate.configured()||candidate.sampleRate()!=inputRate_||candidate.channels()!=channels_)
      throw std::runtime_error("PCM effects candidate does not match the active source format");
    const size_t activeLatency=processor_.latencyFrames();
    const size_t candidateLatency=candidate.latencyFrames();
    if(activeLatency!=candidateLatency||activeLatency!=0||candidateLatency!=0)
      throw std::runtime_error("PCM effects with nonzero DSP latency require reopening the active stream");
    if(effectsCrossfadeActive_)throw std::runtime_error("A PCM effects transition is already active");
    if(effectsRetiredPending_)throw std::runtime_error("Collect the retired PCM processor before another update");
    if(fadeFrames==0) {
      pendingProcessor_=std::move(processor_);processor_=std::move(candidate);effectsRetiredPending_=true;
      return;
    }
    pendingProcessor_=std::move(candidate);effectsCrossfadeTotal_=fadeFrames;effectsCrossfadeDone_=0;effectsCrossfadeActive_=true;
  }

  // Called by the control thread while holding the host's PCM render mutex.
  void collectRetiredEffects() {
    if(effectsRetiredPending_&&!effectsCrossfadeActive_) {
      pendingProcessor_=PcmProcessor{};effectsRetiredPending_=false;
    }
  }

  bool effectsTransitionActive() const{return effectsCrossfadeActive_;}
  LspPluginEq* lspPlugin() const{return processor_.lspPlugin();}
  void commitEffectsTransition() {
    if(!effectsCrossfadeActive_)return;
    std::swap(processor_,pendingProcessor_);effectsCrossfadeActive_=false;effectsRetiredPending_=true;
    effectsCrossfadeTotal_=0;effectsCrossfadeDone_=0;
  }

  std::size_t inheritFilterState(const PcmEngine& previous) {
    if(effectsLatencyFrames_||previous.effectsLatencyFrames_||effectsCrossfadeActive_||previous.effectsCrossfadeActive_||inputRate_!=previous.inputRate_||
       outputRate_!=previous.outputRate_||channels_!=previous.channels_||sourceFramesRead_.load()!=0||
       outputFramesRead_.load()!=0||decoderEnded_)return 0;
    return processor_.inheritFilterState(previous.processor_);
  }

  PcmOutputBlock pull(double* destination,size_t capacityFrames,const DecoderReadFn& read) {
    if((!destination&&capacityFrames)||!read)throw std::runtime_error("Invalid PCM read request");
    const DoubleDecoderReadFn widened=[&](double* output,size_t frameCapacity) {
      decodedFloat_.resize(frameCapacity*static_cast<size_t>(channels_));
      const auto decoded=read(decodedFloat_.data(),frameCapacity);
      if(decoded.frames>frameCapacity)throw std::runtime_error("PCM decoder returned too many frames");
      for(size_t i=0;i<decoded.frames*static_cast<size_t>(channels_);i++)output[i]=static_cast<double>(decodedFloat_[i]);
      return decoded;
    };
    return pullDouble(destination,capacityFrames,widened);
  }

  PcmOutputBlock pullDouble(double* destination,size_t capacityFrames,const DoubleDecoderReadFn& read) {
    if((!destination&&capacityFrames)||!read)throw std::runtime_error("Invalid double PCM read request");
    if(bitPerfect_||effectsLatencyFrames_==0)return pullPipeline(destination,capacityFrames,read,false);
    const DoubleDecoderReadFn compensatedRead=[&](double* output,size_t frameCapacity) {
      return pullLatencyCompensated(output,frameCapacity,read);
    };
    return pullPipeline(destination,capacityFrames,compensatedRead,true);
  }

 private:
  PcmOutputBlock pullPipeline(double* destination,size_t capacityFrames,const DoubleDecoderReadFn& read,bool effectsAlreadyApplied) {
    if((!destination&&capacityFrames)||!read)throw std::runtime_error("Invalid double PCM pipeline request");
    PcmOutputBlock result;
    if(!capacityFrames) {
      if(decoderEnded_) {
        if(!resampling_)result.eof=true;
        else if(fastResampling_) {
          const uint64_t target=static_cast<uint64_t>(std::llround(static_cast<long double>(sourceFramesRead_.load(std::memory_order_relaxed))*outputRate_/inputRate_));
          result.eof=fastOutputFrames_>=target;
        } else if(soxrResampling_)result.eof=soxrResampler_.drained();
        else result.eof=resampler_.drained();
      }
      return result;
    }
    const size_t sampleCapacity=capacityFrames*static_cast<size_t>(channels_);
    if(bitPerfect_) {
      // Read directly into the transport block: no effects, SRC or mixing.
      const auto decoded=read(destination,capacityFrames);
      if(decoded.frames>capacityFrames)throw std::runtime_error("PCM decoder returned too many frames");
      result.frames=decoded.frames;result.eof=decoded.eof;result.buffering=decoded.buffering&&!decoded.eof;result.error=decoded.error;
      sourceFramesRead_+=decoded.frames;outputFramesRead_+=decoded.frames;decoderEnded_=decoded.eof;return result;
    }
    if(!resampling_) {
      decodedDouble_.resize(sampleCapacity);
      const auto decoded=read(decodedDouble_.data(),capacityFrames);
      if(decoded.frames>capacityFrames)throw std::runtime_error("PCM decoder returned too many frames");
      result.frames=decoded.frames;result.eof=decoded.eof;result.buffering=decoded.buffering&&!decoded.eof;
      if(result.frames) {
        if(!effectsAlreadyApplied)processEffects(decodedDouble_.data(),result.frames);
        std::copy_n(decodedDouble_.data(),result.frames*static_cast<size_t>(channels_),destination);
        sourceFramesRead_+=result.frames;outputFramesRead_+=result.frames;
      }
      decoderEnded_=decoded.eof;
      result.error=decoded.error;
      return result;
    }
    if(fastResampling_)return pullFast(destination,capacityFrames,read,effectsAlreadyApplied);
    if(soxrResampling_)return pullStreamingResampler(soxrResampler_,destination,capacityFrames,read,effectsAlreadyApplied);
    return pullStreamingResampler(resampler_,destination,capacityFrames,read,effectsAlreadyApplied);
  }

 public:
  json stages() const{return effectsCrossfadeActive_?pendingProcessor_.stages():processor_.stages();}
  int inputRate() const{return inputRate_;}
  int outputRate() const{return outputRate_;}
  int channels() const{return channels_;}
  bool resampling() const{return resampling_;}
  size_t pendingOutputFrames() const{return !resampling_||fastResampling_?0:(soxrResampling_?soxrResampler_.pendingOutputFrames():resampler_.pendingOutputFrames());}
  size_t latencyFrames() const {
    const size_t srcLatency=!resampling_||fastResampling_?0:static_cast<size_t>(soxrResampling_?soxrResampler_.latencyFrames():resampler_.latencyFrames());
    const size_t dspLatency=inputRate_>0&&outputRate_>0
      ?static_cast<size_t>(std::llround(static_cast<long double>(effectsLatencyFrames_)*outputRate_/inputRate_)):0;
    return dspLatency+srcLatency;
  }
  double bufferedSeconds() const {
    if(!resampling_||outputRate_<=0||inputRate_<=0)return 0;
    const double buffered=static_cast<double>(sourceFramesRead_.load(std::memory_order_relaxed))/inputRate_-static_cast<double>(outputFramesRead_.load(std::memory_order_relaxed))/outputRate_;
    return std::max(0.0,buffered);
  }
  uint64_t sourceFramesRead() const{return sourceFramesRead_.load(std::memory_order_relaxed);}
  uint64_t outputFramesRead() const{return outputFramesRead_.load(std::memory_order_relaxed);}

 private:
  PcmDecodedBlock pullLatencyCompensated(double* destination,size_t capacityFrames,const DoubleDecoderReadFn& read) {
    PcmDecodedBlock result;
    if(!capacityFrames)return result;
    const size_t channels=static_cast<size_t>(channels_);
    size_t produced=0;bool sawBuffering=false;
    auto emitProcessed=[&](size_t frames) {
      const size_t skipped=std::min(effectsSkipFrames_,frames);
      effectsSkipFrames_-=skipped;
      const size_t available=frames-skipped;
      const size_t copied=std::min(available,capacityFrames-produced);
      if(copied)std::copy_n(effectsDecode_.data()+skipped*channels,copied*channels,destination+produced*channels);
      produced+=copied;
    };
    while(produced<capacityFrames) {
      if(!rawEnded_) {
        const size_t needed=capacityFrames-produced;
        const size_t requestLimit=4096;
        const size_t skipForRequest=std::min(effectsSkipFrames_,requestLimit);
        const size_t requestFrames=skipForRequest+std::min(needed,requestLimit-skipForRequest);
        effectsDecode_.resize(requestFrames*channels);
        const auto decoded=read(effectsDecode_.data(),requestFrames);
        if(decoded.frames>requestFrames)throw std::runtime_error("PCM decoder returned too many frames");
        if(decoded.frames)processEffects(effectsDecode_.data(),decoded.frames);
        emitProcessed(decoded.frames);
        if(decoded.eof||!decoded.error.empty()) {
          rawEnded_=true;effectsFlushRemaining_=effectsLatencyFrames_;
          if(!decoded.error.empty())rawLatencyError_=decoded.error;
        }
        if(decoded.buffering&&!decoded.eof)sawBuffering=true;
        if(!decoded.frames) {
          if(rawEnded_)continue;
          result.frames=produced;result.buffering=sawBuffering||decoded.buffering;return result;
        }
        if(decoded.buffering&&!decoded.eof&&!rawEnded_) {
          result.frames=produced;result.buffering=true;return result;
        }
        continue;
      }

      if(!effectsFlushRemaining_)break;
      const size_t needed=capacityFrames-produced;
      const size_t requestLimit=std::min<size_t>(4096,effectsFlushRemaining_);
      const size_t skipForRequest=std::min(effectsSkipFrames_,requestLimit);
      const size_t requestFrames=skipForRequest+std::min(needed,requestLimit-skipForRequest);
      effectsDecode_.resize(requestFrames*channels);
      std::fill_n(effectsDecode_.data(),requestFrames*channels,0.0);
      processEffects(effectsDecode_.data(),requestFrames);
      emitProcessed(requestFrames);
      effectsFlushRemaining_-=requestFrames;
    }
    result.frames=produced;
    result.eof=rawEnded_&&!effectsFlushRemaining_&&!effectsSkipFrames_;
    result.buffering=produced<capacityFrames&&!result.eof&&sawBuffering;
    if(result.eof&&!rawLatencyError_.empty()) {result.error=std::move(rawLatencyError_);rawLatencyError_.clear();}
    return result;
  }

  template <typename Resampler>
  PcmOutputBlock pullStreamingResampler(Resampler& resampler,double* destination,size_t capacityFrames,const DoubleDecoderReadFn& read,bool effectsAlreadyApplied) {
    PcmOutputBlock result;size_t produced=0;bool sawBuffering=false;
    while(produced<capacityFrames) {
      const size_t available=resampler.pull(destination+produced*channels_,capacityFrames-produced);
      if(available) {
        produced+=available;outputFramesRead_+=available;
        continue;
      }
      if(pendingOffset_<pendingFrames_) {
        const size_t pushed=resampler.push(pendingInput_.data()+pendingOffset_*channels_,pendingFrames_-pendingOffset_);
        if(pushed>pendingFrames_-pendingOffset_)throw std::runtime_error("PCM resampler consumed too many frames");
        pendingOffset_+=pushed;
        if(pendingOffset_==pendingFrames_){pendingInput_.clear();pendingFrames_=0;pendingOffset_=0;}
        if(pushed)continue;
        throw std::runtime_error("PCM resampler cannot accept input while no output is available");
      }
      if(decoderEnded_) {
        if(!resamplerFinished_){resampler.finish();resamplerFinished_=true;continue;}
        break;
      }
      const size_t required=resampler.inputRequired(capacityFrames-produced);
      const size_t requestFrames=std::min<size_t>(4096,std::max<size_t>(required,256));
      decodedDouble_.resize(requestFrames*static_cast<size_t>(channels_));
      const auto decoded=read(decodedDouble_.data(),requestFrames);
      if(decoded.frames>requestFrames)throw std::runtime_error("PCM decoder returned too many frames");
      if(decoded.frames) {
        pendingFrames_=decoded.frames;pendingOffset_=0;sourceFramesRead_+=decoded.frames;
        pendingInput_.assign(decodedDouble_.begin(),decodedDouble_.begin()+decoded.frames*static_cast<size_t>(channels_));
        if(!effectsAlreadyApplied)processEffects(pendingInput_.data(),decoded.frames);
      }
      if(decoded.eof)decoderEnded_=true;
      if(!decoded.error.empty()) {decoderEnded_=true;pendingReadError_=decoded.error;}
      if(decoded.buffering&&!decoded.eof)sawBuffering=true;
      if(!decoded.frames) {
        if(decoded.eof||!pendingReadError_.empty())continue;
        result.buffering=sawBuffering||decoded.buffering;break;
      }
    }
    result.frames=produced;
    result.eof=decoderEnded_&&resamplerFinished_&&resampler.drained();
    result.buffering=produced<capacityFrames&&!result.eof&&(sawBuffering||decoderEnded_==false);
    if(result.eof&&!pendingReadError_.empty()) {result.error=std::move(pendingReadError_);pendingReadError_.clear();}
    return result;
  }

  PcmOutputBlock pullFast(double* destination,size_t capacityFrames,const DoubleDecoderReadFn& read,bool effectsAlreadyApplied) {
    PcmOutputBlock result;size_t produced=0;bool sawBuffering=false;
    const size_t channels=static_cast<size_t>(channels_);
    while(produced<capacityFrames) {
      const long double sourcePosition=static_cast<long double>(fastOutputFrames_)*inputRate_/outputRate_;
      const uint64_t first=static_cast<uint64_t>(std::floor(sourcePosition));
      const uint64_t sourceCount=sourceFramesRead_.load(std::memory_order_relaxed);
      const bool canInterpolate=first+1<sourceCount;
      const uint64_t totalOutput=decoderEnded_?static_cast<uint64_t>(std::llround(static_cast<long double>(sourceCount)*outputRate_/inputRate_)):std::numeric_limits<uint64_t>::max();
      if((!decoderEnded_&&canInterpolate)||(decoderEnded_&&fastOutputFrames_<totalOutput)) {
        const uint64_t last=sourceCount?sourceCount-1:0;
        const uint64_t lower=std::min(first,last),upper=std::min(first+1,last);
        if(lower<fastInputStart_||upper<fastInputStart_)throw std::runtime_error("Fast resampler lost required input frames");
        const double fraction=(upper==lower)?0.0:static_cast<double>(sourcePosition-first);
        const size_t lowerOffset=static_cast<size_t>(lower-fastInputStart_)*channels,upperOffset=static_cast<size_t>(upper-fastInputStart_)*channels;
        for(size_t channel=0;channel<channels;channel++) {
          const double a=fastInput_[lowerOffset+channel],b=fastInput_[upperOffset+channel];
          destination[produced*channels+channel]=a+(b-a)*fraction;
        }
        ++produced;++fastOutputFrames_;outputFramesRead_++;
        const long double nextPosition=static_cast<long double>(fastOutputFrames_)*inputRate_/outputRate_;
        const uint64_t keepFrom=nextPosition>1?static_cast<uint64_t>(std::floor(nextPosition))-1:0;
        if(keepFrom>fastInputStart_&&keepFrom-fastInputStart_>=2048) {
          const size_t drop=static_cast<size_t>(std::min<uint64_t>(keepFrom-fastInputStart_,fastInput_.size()/channels));
          fastInput_.erase(fastInput_.begin(),fastInput_.begin()+drop*channels);fastInputStart_+=drop;
        }
        continue;
      }
      if(decoderEnded_)break;
      const uint64_t required=first+2>sourceFramesRead_.load(std::memory_order_relaxed)?first+2-sourceFramesRead_.load(std::memory_order_relaxed):256;
      const size_t requestFrames=static_cast<size_t>(std::min<uint64_t>(4096,std::max<uint64_t>(required,256)));
      decodedDouble_.resize(requestFrames*channels);
      const auto decoded=read(decodedDouble_.data(),requestFrames);
      if(decoded.frames>requestFrames)throw std::runtime_error("PCM decoder returned too many frames");
      if(decoded.frames) {
        const size_t oldSize=fastInput_.size();fastInput_.resize(oldSize+decoded.frames*channels);
        std::copy_n(decodedDouble_.data(),decoded.frames*channels,fastInput_.data()+oldSize);
        if(!effectsAlreadyApplied)processEffects(fastInput_.data()+oldSize,decoded.frames);
        sourceFramesRead_+=decoded.frames;
      }
      if(decoded.eof)decoderEnded_=true;
      if(!decoded.error.empty()) {decoderEnded_=true;pendingReadError_=decoded.error;}
      if(decoded.buffering&&!decoded.eof)sawBuffering=true;
      if(!decoded.frames&&!decoded.eof) {
        if(!pendingReadError_.empty())continue;
        result.buffering=sawBuffering||decoded.buffering;break;
      }
    }
    result.frames=produced;
    result.eof=decoderEnded_&&fastOutputFrames_>=static_cast<uint64_t>(std::llround(static_cast<long double>(sourceFramesRead_.load(std::memory_order_relaxed))*outputRate_/inputRate_));
    result.buffering=produced<capacityFrames&&!result.eof&&(sawBuffering||!decoderEnded_);
    if(result.eof&&!pendingReadError_.empty()) {result.error=std::move(pendingReadError_);pendingReadError_.clear();}
    return result;
  }

  void processEffects(double* samples,size_t frames) {
    if(!effectsCrossfadeActive_) {processor_.process(samples,frames);return;}
    const size_t channels=static_cast<size_t>(channels_);
    if(frames>effectsOld_.capacity()/channels||frames>effectsNew_.capacity()/channels)
      throw std::runtime_error("PCM effects block exceeds its preallocated scratch buffer");
    const size_t sampleCount=frames*channels;
    effectsOld_.resize(sampleCount);effectsNew_.resize(sampleCount);
    std::copy_n(samples,sampleCount,effectsOld_.data());std::copy_n(samples,sampleCount,effectsNew_.data());
    processor_.process(effectsOld_.data(),frames);pendingProcessor_.process(effectsNew_.data(),frames);
    const size_t blendFrames=std::min(frames,effectsCrossfadeTotal_-effectsCrossfadeDone_);
    for(size_t frame=0;frame<blendFrames;frame++) {
      const double amount=static_cast<double>(effectsCrossfadeDone_+frame+1)/static_cast<double>(effectsCrossfadeTotal_);
      for(size_t channel=0;channel<channels;channel++) {
        const size_t index=frame*channels+channel;const double oldValue=effectsOld_[index],newValue=effectsNew_[index];
        samples[index]=oldValue+(newValue-oldValue)*amount;
      }
    }
    if(blendFrames<frames)std::copy(effectsNew_.begin()+blendFrames*channels,effectsNew_.end(),samples+blendFrames*channels);
    effectsCrossfadeDone_+=blendFrames;
    if(effectsCrossfadeDone_>=effectsCrossfadeTotal_) {
      std::swap(processor_,pendingProcessor_);effectsCrossfadeActive_=false;effectsRetiredPending_=true;
      effectsCrossfadeTotal_=0;effectsCrossfadeDone_=0;
    }
  }

  PcmProcessor processor_;
  PcmProcessor pendingProcessor_;
  PcmResampler resampler_;
  PcmSoxrResampler soxrResampler_;
  int inputRate_=0,outputRate_=0,channels_=0;
  std::string resamplingEngine_="r8brain";
  bool bitPerfect_=false,resampling_=false,fastResampling_=false,soxrResampling_=false,decoderEnded_=false,resamplerFinished_=false;
  size_t pendingFrames_=0,pendingOffset_=0;
  std::atomic<uint64_t> sourceFramesRead_{0},outputFramesRead_{0};
  uint64_t fastInputStart_=0,fastOutputFrames_=0;
  size_t effectsLatencyFrames_=0,effectsSkipFrames_=0,effectsFlushRemaining_=0;
  bool rawEnded_=false;
  std::vector<float> decodedFloat_;
  std::vector<double> decodedDouble_;
  std::vector<double> pendingInput_;
  std::vector<double> fastInput_;
  std::vector<double> effectsDecode_;
  std::vector<double> effectsOld_,effectsNew_;
  std::string rawLatencyError_,pendingReadError_;
  size_t effectsCrossfadeTotal_=0,effectsCrossfadeDone_=0;
  bool effectsCrossfadeActive_=false,effectsRetiredPending_=false;
};

enum class PcmSampleFormat { Float32, Int16, Int24, Int32, Int32Valid16, Int32Valid18, Int32Valid20, Int32Valid24 };
enum class PcmPackingAlignment { LeftAligned, RightAligned };

struct PcmQuantizerStats {
  uint64_t overRangeSamples=0;
  uint64_t clippingSamples=0;
  double peakAbs=0.0;
  uint64_t bitPerfectCheckedSamples=0,bitPerfectMismatchSamples=0;
  json toJson() const{return {{"overRangeSamples",overRangeSamples},{"clippingSamples",clippingSamples},{"peakAbs",peakAbs},{"bitPerfectCheckedSamples",bitPerfectCheckedSamples},{"bitPerfectMismatchSamples",bitPerfectMismatchSamples}};}
};

enum class PcmQuantizerError { None, NonFiniteSample, Float32Range, BitPerfectMismatch };

struct PcmDitherState {
  static constexpr uint32_t defaultSeed=0x9e3779b9u;
  uint32_t seed=defaultSeed;
  uint32_t random=defaultSeed;
  std::vector<double> previous;
  void selectSeed(uint32_t value) {
    seed=value?value:defaultSeed;
    reset();
  }
  void reset() {
    random=seed;
    std::fill(previous.begin(),previous.end(),0.0);
  }
  double uniform() {
    random^=random<<13;random^=random>>17;random^=random<<5;
    return static_cast<double>(random)/4294967296.0;
  }
};

class PcmQuantizer {
 public:
  void configure(PcmSampleFormat format,std::string dither,int channels,int exactSourceBits=0,
                 PcmPackingAlignment packingAlignment=PcmPackingAlignment::LeftAligned,
                 std::optional<uint32_t> deterministicDitherSeed=std::nullopt) {
    if(channels<1||channels>2)throw std::runtime_error("Invalid PCM quantizer channel count");
    if(dither!="none"&&dither!="rectangular"&&dither!="triangular"&&dither!="highpass")throw std::runtime_error("Invalid dither mode");
    if(packingAlignment!=PcmPackingAlignment::LeftAligned&&packingAlignment!=PcmPackingAlignment::RightAligned)throw std::runtime_error("Invalid PCM packing alignment");
    if(exactSourceBits&&(exactSourceBits!=16&&exactSourceBits!=24&&exactSourceBits!=32))throw std::runtime_error("Unsupported exact integer PCM source width");
    if(exactSourceBits&&(floating(format)||bits(format)<exactSourceBits||dither!="none"))throw std::runtime_error("Exact integer PCM requires a lossless integer output format without dither");
    uint32_t seed=deterministicDitherSeed?*deterministicDitherSeed:generateDitherSeed();
    if(!deterministicDitherSeed) {
      if(!seed)seed=PcmDitherState::defaultSeed;
      if(seed==state_.seed) {
        seed^=0xa511e9b3u;
        if(!seed||seed==state_.seed)seed=state_.seed==std::numeric_limits<uint32_t>::max()?1:state_.seed+1;
      }
    }
    format_=format;exactSourceBits_=exactSourceBits;packingAlignment_=packingAlignment;dither_=std::move(dither);
    state_.previous.assign(static_cast<size_t>(channels),0.0);state_.selectSeed(seed);reset();
  }
  void reset(){state_.reset();errorCode_=PcmQuantizerError::None;stats_={};}

  static int bits(PcmSampleFormat format) {
    switch(format){case PcmSampleFormat::Int16:return 16;case PcmSampleFormat::Int24:case PcmSampleFormat::Int32Valid24:return 24;case PcmSampleFormat::Int32Valid20:return 20;case PcmSampleFormat::Int32Valid18:return 18;case PcmSampleFormat::Int32Valid16:return 16;case PcmSampleFormat::Int32:return 32;case PcmSampleFormat::Float32:return 32;}
    return 32;
  }
  static int containerBits(PcmSampleFormat format) {return format==PcmSampleFormat::Int24?24:format==PcmSampleFormat::Int16?16:32;}
  static bool floating(PcmSampleFormat format){return format==PcmSampleFormat::Float32;}
  static PcmSampleFormat parse(const std::string& value) {
    if(value=="f32"||value=="auto")return PcmSampleFormat::Float32;
    if(value=="s16")return PcmSampleFormat::Int16;
    if(value=="s24")return PcmSampleFormat::Int24;
    if(value=="s32")return PcmSampleFormat::Int32;
    if(value=="s32v24")return PcmSampleFormat::Int32Valid24;
    if(value=="s32v16")return PcmSampleFormat::Int32Valid16;
    if(value=="s32v18")return PcmSampleFormat::Int32Valid18;
    if(value=="s32v20")return PcmSampleFormat::Int32Valid20;
    throw std::runtime_error("Invalid PCM output format");
  }
  static std::string name(PcmSampleFormat format) {
    switch(format){case PcmSampleFormat::Float32:return "f32";case PcmSampleFormat::Int16:return "s16";case PcmSampleFormat::Int24:return "s24";case PcmSampleFormat::Int32:return "s32";case PcmSampleFormat::Int32Valid16:return "s32v16";case PcmSampleFormat::Int32Valid18:return "s32v18";case PcmSampleFormat::Int32Valid20:return "s32v20";case PcmSampleFormat::Int32Valid24:return "s32v24";}
    return "unknown";
  }

  size_t bytesPerSample() const{return static_cast<size_t>(containerBits(format_)/8);}
  PcmSampleFormat format() const{return format_;}
  PcmPackingAlignment packingAlignment() const{return packingAlignment_;}
  const std::string& dither() const{return dither_;}
  bool hasError() const noexcept{return errorCode_!=PcmQuantizerError::None;}
  PcmQuantizerError errorCode() const noexcept{return errorCode_;}
  std::string takeError(){
    std::string result;
    switch(errorCode_) {
      case PcmQuantizerError::None:break;
      case PcmQuantizerError::NonFiniteSample:result="PCM output received a non-finite sample or gain";break;
      case PcmQuantizerError::Float32Range:result="PCM sample exceeds the float32 output range";break;
      case PcmQuantizerError::BitPerfectMismatch:result="PCM 本地样本一致性检查失败，已停止输出";break;
    }
    errorCode_=PcmQuantizerError::None;
    return result;
  }
  PcmQuantizerStats stats() const{return stats_;}
  json statsJson() const{return stats_.toJson();}

  void writeInterleaved(void* destination,const double* source,size_t frames,int channels,double gain) {
    if(channels<1||channels>2)throw std::runtime_error("Invalid PCM output channel count");
    auto* bytes=static_cast<uint8_t*>(destination);
    for(size_t frame=0;frame<frames;frame++)for(int channel=0;channel<channels;channel++) {
      const size_t sample=frame*static_cast<size_t>(channels)+channel;
      writeOne(bytes+sample*bytesPerSample(),source[sample],channel,gain);
    }
  }

  void writeChannel(void* destination,const double* source,size_t frames,int channel,double gain) {
    if(channel<0||channel>=static_cast<int>(state_.previous.size()))throw std::runtime_error("Invalid PCM output channel index");
    auto* bytes=static_cast<uint8_t*>(destination);const size_t stride=bytesPerSample();
    for(size_t frame=0;frame<frames;frame++)writeOne(bytes+frame*stride,source[frame*static_cast<size_t>(state_.previous.size())+channel],channel,gain);
  }

 private:
  static uint32_t generateDitherSeed() {
    std::random_device entropy;
    const uint64_t first=static_cast<uint64_t>(entropy());
    const uint64_t second=static_cast<uint64_t>(entropy());
    return static_cast<uint32_t>(first^(second<<1)^(first>>32)^(second>>32));
  }

  double ditherLsb(int channel) {
    if(format_==PcmSampleFormat::Float32||dither_=="none")return 0.0;
    const double scale=std::ldexp(1.0,bits(format_)-1);
    if(dither_=="rectangular")return (state_.uniform()-0.5)/scale;
    const double triangular=(state_.uniform()-state_.uniform())/scale;
    if(dither_=="highpass") {
      const double value=triangular-state_.previous[static_cast<size_t>(channel)];
      state_.previous[static_cast<size_t>(channel)]=triangular;return value;
    }
    return triangular;
  }

  void writeOne(uint8_t* destination,double sample,int channel,double gain) {
    double value=exactSourceBits_?sample:sample*gain;bool saturatedBeforeQuantization=false;
    if(!std::isfinite(sample)||!std::isfinite(gain)||!std::isfinite(value)) {
      if(errorCode_==PcmQuantizerError::None)errorCode_=PcmQuantizerError::NonFiniteSample;value=0.0;
    } else {
      const double magnitude=std::abs(value);stats_.peakAbs=std::max(stats_.peakAbs,magnitude);
      if(magnitude>1.0) {
        stats_.overRangeSamples++;
        if(format_!=PcmSampleFormat::Float32&&value< -1.0){stats_.clippingSamples++;saturatedBeforeQuantization=true;}
      }
    }
    if(format_==PcmSampleFormat::Float32) {
      const double maximum=static_cast<double>(std::numeric_limits<float>::max());
      if(std::abs(value)>maximum){if(errorCode_==PcmQuantizerError::None)errorCode_=PcmQuantizerError::Float32Range;value=0.0;}
      const float result=static_cast<float>(value);std::memcpy(destination,&result,sizeof(result));return;
    }
    value=std::clamp(value,-1.0,1.0);
    const int valid=bits(format_);const int shift=containerBits(format_)-valid;
    const int64_t negative=-(int64_t(1)<<(valid-1)),positive=(int64_t(1)<<(valid-1))-1;
    const double scale=std::ldexp(1.0,valid-1);
    int64_t quantized=static_cast<int64_t>(std::llround(value*scale+ditherLsb(channel)*scale));
    if((quantized<negative||quantized>positive)&&!saturatedBeforeQuantization)stats_.clippingSamples++;
    quantized=std::clamp(quantized,negative,positive);
    const int packingShift=packingAlignment_==PcmPackingAlignment::LeftAligned?shift:0;
    const int64_t packed=quantized*(int64_t(1)<<packingShift);
    if(format_==PcmSampleFormat::Int16) {
      const int16_t result=static_cast<int16_t>(packed);std::memcpy(destination,&result,sizeof(result));
    } else if(format_==PcmSampleFormat::Int24) {
      const uint32_t result=static_cast<uint32_t>(static_cast<int32_t>(packed));
      destination[0]=static_cast<uint8_t>(result);destination[1]=static_cast<uint8_t>(result>>8);destination[2]=static_cast<uint8_t>(result>>16);
    } else {
      const int32_t result=static_cast<int32_t>(packed);std::memcpy(destination,&result,sizeof(result));
    }
    if(exactSourceBits_) {
      int64_t submitted=0;
      if(bytesPerSample()==2){int16_t stored=0;std::memcpy(&stored,destination,2);submitted=stored;}
      else if(bytesPerSample()==3){uint32_t stored=destination[0]|(uint32_t(destination[1])<<8)|(uint32_t(destination[2])<<16);submitted=(stored&0x800000)?static_cast<int64_t>(stored)-0x1000000:stored;}
      else {int32_t stored=0;std::memcpy(&stored,destination,4);submitted=stored;}
      const double originalInteger=std::ldexp(sample,exactSourceBits_-1);
      const double limit=std::ldexp(1.0,exactSourceBits_-1);
      const bool sourceOnIntegerGrid=std::isfinite(originalInteger)&&originalInteger==std::trunc(originalInteger)&&originalInteger>=-limit&&originalInteger<=limit-1;
      int64_t expectedPacked=0;
      if(sourceOnIntegerGrid) {
        expectedPacked=static_cast<int64_t>(originalInteger)*(int64_t(1)<<(valid-exactSourceBits_));
        if(packingAlignment_==PcmPackingAlignment::LeftAligned)expectedPacked*=int64_t(1)<<shift;
      }
      stats_.bitPerfectCheckedSamples++;
      if(gain!=1.0||!sourceOnIntegerGrid||submitted!=expectedPacked) {
        stats_.bitPerfectMismatchSamples++;
        if(errorCode_==PcmQuantizerError::None)errorCode_=PcmQuantizerError::BitPerfectMismatch;
      }
    }
  }

  PcmSampleFormat format_=PcmSampleFormat::Float32;
  int exactSourceBits_=0;
  PcmPackingAlignment packingAlignment_=PcmPackingAlignment::LeftAligned;
  std::string dither_="none";
  PcmQuantizerError errorCode_=PcmQuantizerError::None;
  PcmQuantizerStats stats_;
  PcmDitherState state_;
};

} // namespace rhine
