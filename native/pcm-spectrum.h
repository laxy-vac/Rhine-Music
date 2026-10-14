#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <complex>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <string>

namespace rhine {

constexpr size_t kPcmSpectrumMaxBins=16385;

struct PcmSpectrumSnapshot {
  bool available=false;
  int sampleRate=0;
  std::array<double,32> bands{};
  size_t fftSize=0;
  double binHz=0.0;
  size_t binCount=0;
  std::array<double,kPcmSpectrumMaxBins> binsDb{};
  double peakDb=0.0;
  double rmsDb=0.0;
  uint64_t updatedAt=0;
  std::string reason;
};

// Single PCM render producer, single status-thread consumer. The callback only
// writes fixed-size atomic sample slots; windowing and FFT are control-thread
// work performed no more often than every 100 ms.
class PcmSpectrum {
 public:
  static constexpr size_t bandCount=32;

  void clear(uint64_t trackSerial,int sampleRate) {
    // Call only when the renderer is stopped or while its PCM render lock is
    // held. A track change discovered by push() performs the same reset on the
    // producer thread without allocating or blocking.
    generation_.fetch_add(1,std::memory_order_acq_rel);
    writerTrackSerial_=trackSerial;writerSampleRate_=sampleRate;
    trackStart_.store(writerCount_,std::memory_order_release);
    publishedTrackSerial_.store(trackSerial,std::memory_order_relaxed);
    publishedSampleRate_.store(sampleRate,std::memory_order_relaxed);
    generation_.fetch_add(1,std::memory_order_release);
  }

  void push(const double* interleaved,size_t frames,int channels,int sampleRate,uint64_t trackSerial) {
    if(!interleaved||!frames||channels<1||channels>2||sampleRate<=0)return;
    if(writerTrackSerial_!=trackSerial||writerSampleRate_!=sampleRate) {
      generation_.fetch_add(1,std::memory_order_acq_rel);
      writerTrackSerial_=trackSerial;writerSampleRate_=sampleRate;
      trackStart_.store(writerCount_,std::memory_order_release);
      publishedTrackSerial_.store(trackSerial,std::memory_order_relaxed);
      publishedSampleRate_.store(sampleRate,std::memory_order_relaxed);
      generation_.fetch_add(1,std::memory_order_release);
    }
    for(size_t frame=0;frame<frames;frame++) {
      const size_t slot=static_cast<size_t>(writerCount_)&(ringFrames-1);
      const double left=sanitize(interleaved[frame*static_cast<size_t>(channels)]);
      const double right=channels==2?sanitize(interleaved[frame*2+1]):left;
      ring_[0][slot].store(floatBits(static_cast<float>(left)),std::memory_order_relaxed);
      ring_[1][slot].store(floatBits(static_cast<float>(right)),std::memory_order_relaxed);
      ++writerCount_;
      if((writerCount_&127u)==0)publishedCount_.store(writerCount_,std::memory_order_release);
    }
    publishedCount_.store(writerCount_,std::memory_order_release);
  }

  PcmSpectrumSnapshot snapshot(bool active,int sampleRate,const std::string& inactiveReason={}) {
    PcmSpectrumSnapshot result;result.sampleRate=sampleRate;
    const uint64_t generation=generation_.load(std::memory_order_acquire);
    if(generation&1u){result.reason="waiting for a PCM track boundary";return result;}
    const int publishedRate=publishedSampleRate_.load(std::memory_order_relaxed);
    const uint64_t trackSerial=publishedTrackSerial_.load(std::memory_order_relaxed);
    const uint64_t start=trackStart_.load(std::memory_order_acquire);
    if(generation!=cachedGeneration_) {
      cachedGeneration_=generation;cachedAvailable_=false;cachedBands_.fill(0.0);cachedBinCount_=0;
      cachedFftSize_=0;cachedBinHz_=0.0;cachedPeakDb_=0.0;cachedRmsDb_=0.0;cachedUpdatedAt_=0;
      lastFftAt_=std::chrono::steady_clock::time_point{};
    }
    if(!active) {result.reason=inactiveReason.empty()?"PCM spectrum is inactive":inactiveReason;return result;}
    if(sampleRate<=0) {result.reason="PCM output sample rate is unavailable";return result;}
    if(publishedRate!=sampleRate) {
      result.reason="waiting for PCM samples at the current output rate";return result;
    }
    const size_t window=windowFrames(sampleRate);
    const uint64_t published=publishedCount_.load(std::memory_order_acquire);
    if(published<start||published-start<window) {
      result.reason="waiting for the current track's PCM analysis window";return result;
    }
    const auto now=std::chrono::steady_clock::now();
    if(cachedAvailable_&&lastFftAt_!=std::chrono::steady_clock::time_point{}&&
       now-lastFftAt_<std::chrono::milliseconds(100)) {
      copyCached(result,sampleRate);
      result.reason="post-DSP/SRC/mix, pre-volume tap";return result;
    }

    calculate(published-window,window,sampleRate);
    const uint64_t generationAfter=generation_.load(std::memory_order_acquire);
    const int rateAfter=publishedSampleRate_.load(std::memory_order_relaxed);
    const uint64_t trackAfter=publishedTrackSerial_.load(std::memory_order_relaxed);
    const uint64_t startAfter=trackStart_.load(std::memory_order_acquire);
    const uint64_t writeAfter=publishedCount_.load(std::memory_order_acquire);
    const bool changed=(generationAfter!=generation)||(generationAfter&1u)||rateAfter!=publishedRate||trackAfter!=trackSerial||startAfter!=start;
    const bool overwritten=writeAfter<published||writeAfter-(published-window)+publishChunkFrames>ringFrames;
    if(changed||overwritten) {
      cachedAvailable_=false;cachedBands_.fill(0.0);cachedBinCount_=0;
      result.reason=changed?"PCM track changed during analysis; waiting for a fresh window":"PCM analysis window was overwritten; waiting for fresh samples";
      return result;
    }
    cachedAvailable_=true;lastFftAt_=now;
    cachedUpdatedAt_=static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count());
    copyCached(result,sampleRate);
    result.reason="post-DSP/SRC/mix, pre-volume tap";
    return result;
  }

 private:
  static constexpr size_t ringFrames=65536;
  static constexpr size_t maxWindowFrames=32768;
  static constexpr uint64_t publishChunkFrames=128;
  static constexpr double floorDb=-240.0;

  static uint32_t floatBits(float value) {
    uint32_t bits=0;std::memcpy(&bits,&value,sizeof(bits));return bits;
  }
  static float bitsFloat(uint32_t bits) {
    float value=0;std::memcpy(&value,&bits,sizeof(value));return value;
  }
  static double sanitize(double value) {
    if(!std::isfinite(value))return 0.0;
    return std::clamp(value,-16.0,16.0);
  }
  static size_t windowFrames(int sampleRate) {
    const size_t target=static_cast<size_t>(std::max(0.0,static_cast<double>(sampleRate)*0.17));
    size_t result=4096;
    while(result<target&&result<maxWindowFrames)result<<=1;
    return result;
  }

  static double amplitudeDb(double amplitude) {
    return std::clamp(20.0*std::log10(std::max(amplitude,1.0e-12)),floorDb,24.0824);
  }

  void copyCached(PcmSpectrumSnapshot& result,int sampleRate) const {
    result.available=true;result.sampleRate=sampleRate;result.bands=cachedBands_;
    result.fftSize=cachedFftSize_;result.binHz=cachedBinHz_;result.binCount=cachedBinCount_;
    std::copy_n(cachedBinsDb_.begin(),cachedBinCount_,result.binsDb.begin());
    result.peakDb=cachedPeakDb_;result.rmsDb=cachedRmsDb_;result.updatedAt=cachedUpdatedAt_;
  }

  void calculate(uint64_t firstFrame,size_t frames,int sampleRate) {
    cachedBands_.fill(0.0);cachedBinsDb_.fill(floorDb);cachedBinCount_=0;
    cachedFftSize_=frames;cachedBinHz_=static_cast<double>(sampleRate)/static_cast<double>(frames);
    cachedPeakDb_=floorDb;cachedRmsDb_=floorDb;
    const double nyquist=static_cast<double>(sampleRate)*0.5;
    const double maximumHz=std::min(20000.0,nyquist);
    if(maximumHz<=20.0||frames<2)return;
    // For the symmetric Hann used below, sum(window) is exactly (N - 1) / 2.
    const double windowSum=static_cast<double>(frames-1)*0.5;
    const double binHz=cachedBinHz_;
    const size_t nyquistBin=frames/2;
    size_t lastBin=maximumHz>=nyquist?nyquistBin:
      std::min(nyquistBin,static_cast<size_t>(std::floor(maximumHz/binHz)));
    cachedBinCount_=std::min(kPcmSpectrumMaxBins,lastBin+1);
    const size_t binCount=cachedBinCount_;
    const double range=maximumHz/20.0;
    double peakAmplitude=0.0,rmsAmplitude=0.0;
    for(size_t channel=0;channel<2;channel++) {
      double channelPeak=0.0,channelSquares=0.0;
      for(size_t i=0;i<frames;i++) {
        const size_t slot=static_cast<size_t>(firstFrame+i)&(ringFrames-1);
        const double sample=bitsFloat(ring_[channel][slot].load(std::memory_order_relaxed));
        channelPeak=std::max(channelPeak,std::abs(sample));channelSquares+=sample*sample;
        const double hann=0.5-0.5*std::cos(2.0*pi()*static_cast<double>(i)/static_cast<double>(frames-1));
        fft_[i]=std::complex<double>(sample*hann,0.0);
      }
      peakAmplitude=std::max(peakAmplitude,channelPeak);
      rmsAmplitude=std::max(rmsAmplitude,std::sqrt(channelSquares/static_cast<double>(frames)));
      fft(frames);
      for(size_t bin=0;bin<binCount;bin++) {
        const bool edgeBin=bin==0||bin==nyquistBin;
        const double magnitude=std::abs(fft_[bin])*(edgeBin?1.0:2.0)/windowSum;
        cachedBinsDb_[bin]=std::max(cachedBinsDb_[bin],amplitudeDb(magnitude));
      }
    }
    cachedPeakDb_=amplitudeDb(peakAmplitude);cachedRmsDb_=amplitudeDb(rmsAmplitude);
    for(size_t band=0;band<bandCount;band++) {
        const double lowHz=20.0*std::pow(range,static_cast<double>(band)/bandCount);
        const double highHz=20.0*std::pow(range,static_cast<double>(band+1)/bandCount);
        size_t firstBin=static_cast<size_t>(std::floor(lowHz/binHz));
        size_t lastBandBin=static_cast<size_t>(std::ceil(highHz/binHz));
        firstBin=std::clamp<size_t>(firstBin,1,binCount-1);
        lastBandBin=std::clamp<size_t>(lastBandBin,firstBin,binCount-1);
        double magnitude=0.0;
        for(size_t bin=firstBin;bin<=lastBandBin;bin++)
          magnitude=std::max(magnitude,std::pow(10.0,cachedBinsDb_[bin]/20.0));
        const double db=amplitudeDb(magnitude);
        const double level=std::clamp((db+72.0)/72.0,0.0,1.0);
        cachedBands_[band]=level;
    }
  }

  void fft(size_t count) {
    for(size_t i=1,j=0;i<count;i++) {
      size_t bit=count>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j)std::swap(fft_[i],fft_[j]);
    }
    for(size_t length=2;length<=count;length<<=1) {
      const double angle=-2.0*pi()/static_cast<double>(length);
      const std::complex<double> step(std::cos(angle),std::sin(angle));
      for(size_t base=0;base<count;base+=length) {
        std::complex<double> factor(1.0,0.0);const size_t half=length/2;
        for(size_t offset=0;offset<half;offset++) {
          const auto even=fft_[base+offset],odd=fft_[base+offset+half]*factor;
          fft_[base+offset]=even+odd;fft_[base+offset+half]=even-odd;factor*=step;
        }
      }
    }
  }
  static double pi(){return 3.141592653589793238462643383279502884;}

  std::array<std::array<std::atomic<uint32_t>,ringFrames>,2> ring_{};
  std::array<std::complex<double>,maxWindowFrames> fft_{};
  uint64_t writerCount_=0,writerTrackSerial_=std::numeric_limits<uint64_t>::max();
  int writerSampleRate_=0;
  std::atomic<uint64_t> publishedCount_{0},trackStart_{0},publishedTrackSerial_{0},generation_{0};
  std::atomic<int> publishedSampleRate_{0};
  uint64_t cachedGeneration_=std::numeric_limits<uint64_t>::max(),cachedUpdatedAt_=0;
  bool cachedAvailable_=false;
  std::array<double,bandCount> cachedBands_{};
  std::array<double,kPcmSpectrumMaxBins> cachedBinsDb_{};
  size_t cachedFftSize_=0,cachedBinCount_=0;
  double cachedBinHz_=0.0,cachedPeakDb_=0.0,cachedRmsDb_=0.0;
  std::chrono::steady_clock::time_point lastFftAt_{};
};

} // namespace rhine
