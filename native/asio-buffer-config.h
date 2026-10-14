#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace rhine {
// Pure control-side policy. BASS_ASIO_Start expects frames, never milliseconds.
inline uint32_t asioBufferFrames(double rate,int requestedMs,uint32_t minimum,
                                 uint32_t maximum,uint32_t preferred,int granularity) {
  if(!std::isfinite(rate)||rate<=0||requestedMs<0||requestedMs>5000||!minimum||maximum<minimum||preferred<minimum||preferred>maximum)
    throw std::runtime_error("ASIO driver returned invalid buffer limits");
  if(!requestedMs)return 0;
  const double desired=std::ceil(rate*requestedMs/1000.0);
  uint64_t frames=static_cast<uint64_t>(std::clamp(desired,static_cast<double>(minimum),static_cast<double>(maximum)));
  if(granularity==-1) {
    uint64_t power=1;while(power<frames&&power<=maximum)power*=2;
    if(power>maximum){power=1;while(power*2<=maximum)power*=2;}
    if(power<minimum)throw std::runtime_error("ASIO driver has no legal power-of-two buffer");
    frames=power;
  } else if(granularity>1) {
    const uint64_t step=static_cast<uint32_t>(granularity);
    frames=minimum+((frames-minimum+step-1)/step)*step;
    if(frames>maximum)frames=minimum+((maximum-minimum)/step)*step;
  } else if(granularity< -1)throw std::runtime_error("ASIO driver returned an invalid buffer granularity");
  return static_cast<uint32_t>(frames);
}
} // namespace rhine
