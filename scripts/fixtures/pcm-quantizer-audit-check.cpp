#include "pcm-engine.h"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
bool countAllocations=false;
size_t allocationCount=0;

void check(bool condition,const std::string& message) {
  if(!condition)throw std::runtime_error(message);
}

std::vector<uint8_t> writeOne(rhine::PcmQuantizer& quantizer,double sample) {
  std::vector<uint8_t> bytes(quantizer.bytesPerSample());
  quantizer.writeInterleaved(bytes.data(),&sample,1,1,1.0);
  return bytes;
}

int64_t readSigned(const std::vector<uint8_t>& bytes,int containerBits) {
  uint64_t raw=0;
  for(size_t i=0;i<bytes.size();i++)raw|=static_cast<uint64_t>(bytes[i])<<(i*8);
  if(raw&(uint64_t(1)<<(containerBits-1)))return static_cast<int64_t>(raw)-(int64_t(1)<<containerBits);
  return static_cast<int64_t>(raw);
}

struct FormatCase {
  const char* name;
  rhine::PcmSampleFormat format;
  int validBits;
};

constexpr std::array<FormatCase,7> formats{{
  {"s16",rhine::PcmSampleFormat::Int16,16},
  {"s24",rhine::PcmSampleFormat::Int24,24},
  {"s32",rhine::PcmSampleFormat::Int32,32},
  {"s32v16",rhine::PcmSampleFormat::Int32Valid16,16},
  {"s32v18",rhine::PcmSampleFormat::Int32Valid18,18},
  {"s32v20",rhine::PcmSampleFormat::Int32Valid20,20},
  {"s32v24",rhine::PcmSampleFormat::Int32Valid24,24}
}};

int64_t packedCode(int64_t code,const FormatCase& item,rhine::PcmPackingAlignment alignment) {
  const int shift=rhine::PcmQuantizer::containerBits(item.format)-item.validBits;
  return code*(int64_t(1)<<(alignment==rhine::PcmPackingAlignment::LeftAligned?shift:0));
}

void testPackingLayouts() {
  for(const auto& item:formats)for(const auto alignment:{rhine::PcmPackingAlignment::LeftAligned,rhine::PcmPackingAlignment::RightAligned}) {
    rhine::PcmQuantizer quantizer;
    quantizer.configure(item.format,"none",1,0,alignment,0x5a17u);
    const int64_t scale=int64_t(1)<<(item.validBits-1);
    const std::array<std::pair<double,int64_t>,4> samples{{
      {1.0,scale-1},
      {-1.0,-scale},
      {1.0/static_cast<double>(scale),1},
      {-1.0/static_cast<double>(scale),-1}
    }};
    for(const auto& sample:samples) {
      const auto encoded=writeOne(quantizer,sample.first);
      check(readSigned(encoded,rhine::PcmQuantizer::containerBits(item.format))==packedCode(sample.second,item,alignment),
            std::string(item.name)+" packed incorrectly at a full-scale or one-LSB boundary");
    }
  }

  rhine::PcmQuantizer windowsDefault;
  windowsDefault.configure(rhine::PcmSampleFormat::Int32Valid24,"none",1,0);
  check(windowsDefault.packingAlignment()==rhine::PcmPackingAlignment::LeftAligned,"default PCM packing is not Windows left-aligned");
  check(readSigned(writeOne(windowsDefault,1.0/std::ldexp(1.0,23)),32)==0x100,
        "default 24-in-32 packing did not left-align its one-LSB code");

  rhine::PcmQuantizer asioRight;
  asioRight.configure(rhine::PcmSampleFormat::Int32Valid24,"none",1,0,rhine::PcmPackingAlignment::RightAligned,0x5a17u);
  check(readSigned(writeOne(asioRight,1.0/std::ldexp(1.0,23)),32)==1,"right-aligned 24-in-32 +1 LSB is not 01 00 00 00");
  check(readSigned(writeOne(asioRight,-1.0/std::ldexp(1.0,23)),32)==-1,"right-aligned 24-in-32 -1 LSB is not sign-extended");
  check(readSigned(writeOne(asioRight,-1.0),32)==-8388608,"right-aligned 24-in-32 negative full scale is incorrect");
}

void testBitPerfectPayloads() {
  struct ExactCase { FormatCase output; int sourceBits; };
  const std::array<ExactCase,7> exactCases{{
    {{"s16",rhine::PcmSampleFormat::Int16,16},16},
    {{"s24",rhine::PcmSampleFormat::Int24,24},24},
    {{"s32",rhine::PcmSampleFormat::Int32,32},32},
    {{"s32v16",rhine::PcmSampleFormat::Int32Valid16,16},16},
    {{"s32v18",rhine::PcmSampleFormat::Int32Valid18,18},16},
    {{"s32v20",rhine::PcmSampleFormat::Int32Valid20,20},16},
    {{"s32v24",rhine::PcmSampleFormat::Int32Valid24,24},24}
  }};
  for(const auto& item:exactCases)for(const auto alignment:{rhine::PcmPackingAlignment::LeftAligned,rhine::PcmPackingAlignment::RightAligned}) {
    rhine::PcmQuantizer quantizer;
    quantizer.configure(item.output.format,"none",1,item.sourceBits,alignment,0x26ab91u);
    const int64_t limit=int64_t(1)<<(item.sourceBits-1);
    const std::array<int64_t,5> codes{{-limit,-1,0,1,limit-1}};
    std::vector<uint8_t> encoded(codes.size()*quantizer.bytesPerSample());
    std::array<double,5> samples{};
    for(size_t i=0;i<codes.size();i++)samples[i]=static_cast<double>(codes[i])/static_cast<double>(limit);
    quantizer.writeInterleaved(encoded.data(),samples.data(),samples.size(),1,1.0);
    check(!quantizer.hasError(),std::string(item.output.name)+" valid backend payload was rejected by BitPerfect verification");
    const auto stats=quantizer.stats();
    check(stats.bitPerfectCheckedSamples==codes.size()&&stats.bitPerfectMismatchSamples==0,
          std::string(item.output.name)+" BitPerfect payload counters are incorrect");
    for(size_t i=0;i<codes.size();i++) {
      std::vector<uint8_t> sampleBytes(encoded.begin()+static_cast<std::ptrdiff_t>(i*quantizer.bytesPerSample()),
                                       encoded.begin()+static_cast<std::ptrdiff_t>((i+1)*quantizer.bytesPerSample()));
      const int64_t submitted=readSigned(sampleBytes,rhine::PcmQuantizer::containerBits(item.output.format));
      const int validScaleShift=item.output.validBits-item.sourceBits;
      const int packingShift=alignment==rhine::PcmPackingAlignment::LeftAligned?
        rhine::PcmQuantizer::containerBits(item.output.format)-item.output.validBits:0;
      const int64_t expected=codes[i]*(int64_t(1)<<validScaleShift)*(int64_t(1)<<packingShift);
      check(submitted==expected,std::string(item.output.name)+" BitPerfect payload does not match its selected backend layout");
    }
  }

  bool rejectedDither=false;
  try {
    rhine::PcmQuantizer direct;
    direct.configure(rhine::PcmSampleFormat::Int32Valid24,"triangular",1,24,
                     rhine::PcmPackingAlignment::RightAligned,0x26ab91u);
  } catch(const std::runtime_error&) {rejectedDither=true;}
  check(rejectedDither,"Direct/BitPerfect integer output accepted dither");
}

void testSaturationStatistics() {
  rhine::PcmQuantizer integer;
  integer.configure(rhine::PcmSampleFormat::Int16,"none",1,0,rhine::PcmPackingAlignment::LeftAligned,0x101u);
  const std::array<double,4> boundaries{{1.0,-1.0,1.25,-1.25}};
  std::array<uint8_t,8> bytes{};
  integer.writeInterleaved(bytes.data(),boundaries.data(),boundaries.size(),1,1.0);
  const auto integerStats=integer.stats();
  check(integerStats.clippingSamples==3,"integer clipping count must include +1 and out-of-range values, but exclude exact -1");
  check(integerStats.overRangeSamples==2,"over-range count must exclude exact positive and negative full scale");
  check(integerStats.peakAbs==1.25,"peakAbs must retain the pre-quantization sample peak");

  rhine::PcmQuantizer floating;
  floating.configure(rhine::PcmSampleFormat::Float32,"triangular",1,0,rhine::PcmPackingAlignment::LeftAligned,0x101u);
  std::array<uint8_t,16> floatBytes{};
  floating.writeInterleaved(floatBytes.data(),boundaries.data(),boundaries.size(),1,1.0);
  check(floating.stats().clippingSamples==0,"Float32 full scale must not count as integer clipping");
  check(floating.stats().overRangeSamples==2,"Float32 over-range sample count changed unexpectedly");
}

std::vector<int64_t> quantizeSequence(rhine::PcmQuantizer& quantizer,const std::vector<double>& samples) {
  std::vector<uint8_t> bytes(samples.size()*quantizer.bytesPerSample());
  quantizer.writeInterleaved(bytes.data(),samples.data(),samples.size(),1,1.0);
  std::vector<int64_t> result;
  result.reserve(samples.size());
  for(size_t i=0;i<samples.size();i++) {
    std::vector<uint8_t> one(bytes.begin()+static_cast<std::ptrdiff_t>(i*quantizer.bytesPerSample()),
                             bytes.begin()+static_cast<std::ptrdiff_t>((i+1)*quantizer.bytesPerSample()));
    result.push_back(readSigned(one,16));
  }
  return result;
}

void testDitherBehavior() {
  constexpr uint32_t seed=0x13572468u;
  constexpr int64_t scale=int64_t(1)<<15;
  std::vector<double> samples;
  for(int i=0;i<256;i++)samples.push_back((static_cast<double>(i%13-6)+0.375)/static_cast<double>(scale));

  rhine::PcmDitherState expectedState;
  expectedState.selectSeed(seed);
  std::vector<int64_t> expected;
  for(double sample:samples) {
    const double tpdf=expectedState.uniform()-expectedState.uniform();
    expected.push_back(static_cast<int64_t>(std::llround(sample*static_cast<double>(scale)+tpdf)));
  }

  rhine::PcmQuantizer first,second;
  first.configure(rhine::PcmSampleFormat::Int16,"triangular",1,0,rhine::PcmPackingAlignment::LeftAligned,seed);
  second.configure(rhine::PcmSampleFormat::Int16,"triangular",1,0,rhine::PcmPackingAlignment::LeftAligned,seed);
  const auto firstRun=quantizeSequence(first,samples);
  check(firstRun==expected,"TPDF was not applied exactly once per sample with the configured seed");
  check(quantizeSequence(second,samples)==expected,"explicit deterministic dither seed is not reproducible");
  first.reset();
  check(quantizeSequence(first,samples)==expected,"reset did not preserve and restart from the configured dither seed");

  rhine::PcmQuantizer floatingNoDither,floatingWithDither;
  floatingNoDither.configure(rhine::PcmSampleFormat::Float32,"none",1,0,rhine::PcmPackingAlignment::LeftAligned,seed);
  floatingWithDither.configure(rhine::PcmSampleFormat::Float32,"triangular",1,0,rhine::PcmPackingAlignment::LeftAligned,seed);
  const auto plain=writeOne(floatingNoDither,0.1234567890123);
  const auto dithered=writeOne(floatingWithDither,0.1234567890123);
  check(plain==dithered,"Float32 output received integer dither");

  rhine::PcmQuantizer generated;
  generated.configure(rhine::PcmSampleFormat::Int16,"triangular",1);
  const auto generatedFirst=quantizeSequence(generated,samples);
  generated.reset();
  check(quantizeSequence(generated,samples)==generatedFirst,"generated seed changed during reset");
  generated.configure(rhine::PcmSampleFormat::Int16,"triangular",1);
  check(quantizeSequence(generated,samples)!=generatedFirst,"a new configure reused the previous generated dither sequence");
}

void testRealtimeErrorState() {
  rhine::PcmQuantizer quantizer;
  quantizer.configure(rhine::PcmSampleFormat::Int16,"none",1,0,rhine::PcmPackingAlignment::LeftAligned,0x88u);
  const double invalid=std::numeric_limits<double>::quiet_NaN();
  std::array<uint8_t,2> output{};
  allocationCount=0;countAllocations=true;
  quantizer.writeInterleaved(output.data(),&invalid,1,1,1.0);
  countAllocations=false;
  check(allocationCount==0,"quantizer failure state allocated on the render path");
  check(quantizer.hasError()&&quantizer.errorCode()==rhine::PcmQuantizerError::NonFiniteSample,
        "quantizer did not publish its fixed error code");
  check(quantizer.takeError()=="PCM output received a non-finite sample or gain"&&!quantizer.hasError(),
        "takeError compatibility conversion did not return and clear the error");
}
}

void* operator new(std::size_t size) {
  if(countAllocations)allocationCount++;
  if(void* memory=std::malloc(size?size:1))return memory;
  throw std::bad_alloc();
}
void operator delete(void* memory) noexcept {std::free(memory);}
void operator delete(void* memory,std::size_t) noexcept {std::free(memory);}

int main() {
  try {
    testPackingLayouts();
    testBitPerfectPayloads();
    testSaturationStatistics();
    testDitherBehavior();
    testRealtimeErrorState();
    std::cout<<"PCM quantizer audit checks passed (packing, BitPerfect payloads, saturation, dither, allocation-free errors).\n";
    return 0;
  } catch(const std::exception& error) {
    std::cerr<<"PCM quantizer audit check failed: "<<error.what()<<'\n';
    return 1;
  }
}
