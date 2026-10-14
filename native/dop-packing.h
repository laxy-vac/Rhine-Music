#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>

namespace rhine {

enum class DopAlignment { LeftAligned, RightAligned };
enum class DopError { None, Channels, Format, Capacity, Buffer, NonFinite, Modified, Range, Marker, ChannelPhase, Alternation };
inline const char* dopErrorMessage(DopError error) noexcept {
  switch(error) {
    case DopError::None:return "";case DopError::Channels:return "DoP currently supports mono/stereo";
    case DopError::Format:return "DoP requires packed 24-bit or a 32-bit valid-24 container";
    case DopError::Capacity:return "DoP input exceeds output capacity";case DopError::Buffer:return "DoP buffer is unavailable";
    case DopError::NonFinite:return "Invalid BASS DoP float sample";case DopError::Modified:return "DoP input has been numerically modified";
    case DopError::Range:return "DoP sample is outside signed 24-bit range";case DopError::Marker:return "Invalid DoP marker";
    case DopError::ChannelPhase:return "DoP channels have different marker phases";case DopError::Alternation:return "DoP source marker did not alternate";
  }return "Invalid DoP frame";
}

// Converts BASS_DSD_DOP float samples into integer DoP containers. The low
// sixteen bits are the original DSD payload; only the marker byte is framed
// again so a transport buffer can keep a continuous marker phase.
class DopPacker {
 public:
  explicit DopPacker(int channels=2,int bitsPerSample=24,DopAlignment alignment=DopAlignment::LeftAligned)
      :channels_(channels),bitsPerSample_(bitsPerSample),alignment_(alignment) {}

  void reset() {
    haveSourceMarker_=false;
    haveOutputMarker_=false;
    sourceMarker_=0;
    nextOutputMarker_=0;
  }

  void setBitsPerSample(int bits) {
    bitsPerSample_=bits;
    reset();
  }

  int channels() const {return channels_;}
  int bitsPerSample() const {return bitsPerSample_;}

  bool pack(const float* source,std::size_t sourceFrames,std::uint8_t* destination,
            std::size_t outputFrames,std::string& error) {
    DopError code{};const bool ok=pack(source,sourceFrames,destination,outputFrames,code);error=dopErrorMessage(code);return ok;
  }
  bool pack(const float* source,std::size_t sourceFrames,std::uint8_t* destination,
            std::size_t outputFrames,DopError& error) noexcept {
    error=DopError::None;
    if(channels_<1||channels_>2)return fail(error,DopError::Channels);
    if(bitsPerSample_!=24&&bitsPerSample_!=32)return fail(error,DopError::Format);
    if(sourceFrames>outputFrames)return fail(error,DopError::Capacity);
    if((sourceFrames&&!source)||(outputFrames&&!destination))return fail(error,DopError::Buffer);
    if(!outputFrames)return true;

    const std::size_t sampleBytes=static_cast<std::size_t>(bitsPerSample_/8);
    for(std::size_t frame=0;frame<sourceFrames;frame++) {
      std::uint32_t values[2]{};
      int frameMarker=-1;
      for(int channel=0;channel<channels_;channel++) {
        const float value=source[frame*static_cast<std::size_t>(channels_)+static_cast<std::size_t>(channel)];
        if(!std::isfinite(value)||value<-1.0f||value>=1.0f)return fail(error,DopError::NonFinite);
        const double scaled=static_cast<double>(value)*8388608.0;
        const long long quantized=std::llround(scaled);
        if(scaled!=static_cast<double>(quantized))return fail(error,DopError::Modified);
        if(quantized<-8388608LL||quantized>8388607LL)return fail(error,DopError::Range);
        values[channel]=static_cast<std::uint32_t>(static_cast<std::int32_t>(quantized))&0x00ffffffu;
        const int marker=static_cast<int>((values[channel]>>16)&0xffu);
        if(marker!=0x05&&marker!=0xfa)return fail(error,DopError::Marker);
        if(frameMarker<0)frameMarker=marker;
        else if(frameMarker!=marker)return fail(error,DopError::ChannelPhase);
      }
      if(haveSourceMarker_&&frameMarker==sourceMarker_)return fail(error,DopError::Alternation);
      if(!haveOutputMarker_) {
        nextOutputMarker_=static_cast<std::uint8_t>(frameMarker);
        haveOutputMarker_=true;
      }
      for(int channel=0;channel<channels_;channel++) {
        const std::uint16_t payload=static_cast<std::uint16_t>(values[channel]&0xffffu);
        writeSample(destination+(frame*static_cast<std::size_t>(channels_)+static_cast<std::size_t>(channel))*sampleBytes,
                    payload,nextOutputMarker_);
      }
      sourceMarker_=static_cast<std::uint8_t>(frameMarker);
      haveSourceMarker_=true;
      nextOutputMarker_=opposite(nextOutputMarker_);
    }
    return fillIdle(destination+sourceFrames*static_cast<std::size_t>(channels_)*sampleBytes,
                    outputFrames-sourceFrames,error);
  }

  bool fillIdle(std::uint8_t* destination,std::size_t frames,std::string& error) {
    DopError code{};const bool ok=fillIdle(destination,frames,code);error=dopErrorMessage(code);return ok;
  }
  bool fillIdle(std::uint8_t* destination,std::size_t frames,DopError& error) noexcept {
    error=DopError::None;
    if(channels_<1||channels_>2)return fail(error,DopError::Channels);
    if(bitsPerSample_!=24&&bitsPerSample_!=32)return fail(error,DopError::Format);
    if(frames&&!destination)return fail(error,DopError::Buffer);
    const std::size_t sampleBytes=static_cast<std::size_t>(bitsPerSample_/8);
    for(std::size_t frame=0;frame<frames;frame++) {
      if(!haveOutputMarker_) {
        nextOutputMarker_=0x05;
        haveOutputMarker_=true;
      }
      for(int channel=0;channel<channels_;channel++)
        writeSample(destination+(frame*static_cast<std::size_t>(channels_)+static_cast<std::size_t>(channel))*sampleBytes,
                    0x6969,nextOutputMarker_);
      nextOutputMarker_=opposite(nextOutputMarker_);
    }
    return true;
  }

 private:
  static bool fail(DopError& error,DopError code) noexcept {error=code;return false;}
  static std::uint8_t opposite(std::uint8_t marker) {return marker==0x05?0xfa:0x05;}
  void writeSample(std::uint8_t* destination,std::uint16_t payload,std::uint8_t marker) const {
    const std::uint32_t packed=(static_cast<std::uint32_t>(marker)<<16)|payload;
    if(bitsPerSample_==24) {
      destination[0]=static_cast<std::uint8_t>(packed);
      destination[1]=static_cast<std::uint8_t>(packed>>8);
      destination[2]=static_cast<std::uint8_t>(packed>>16);
    } else {
      const std::uint32_t aligned=alignment_==DopAlignment::LeftAligned?packed<<8:
        ((packed&0x800000u)?packed|0xff000000u:packed);
      destination[0]=static_cast<std::uint8_t>(aligned);
      destination[1]=static_cast<std::uint8_t>(aligned>>8);
      destination[2]=static_cast<std::uint8_t>(aligned>>16);
      destination[3]=static_cast<std::uint8_t>(aligned>>24);
    }
  }

  int channels_=2;
  int bitsPerSample_=24;
  DopAlignment alignment_=DopAlignment::LeftAligned;
  bool haveSourceMarker_=false;
  bool haveOutputMarker_=false;
  std::uint8_t sourceMarker_=0;
  std::uint8_t nextOutputMarker_=0;
};

} // namespace rhine
