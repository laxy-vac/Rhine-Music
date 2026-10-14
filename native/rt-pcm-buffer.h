#pragma once

// Preallocated single-producer/single-consumer audio transport.
// configure() and reset() are control-thread operations. The producer owns
// tryBeginWrite()/publish(); the audio consumer owns consume(). No operation
// performed by consume() allocates, blocks, or takes a lock.

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>
#include <type_traits>

namespace rhine {

constexpr std::size_t kRtPcmMaxSegmentsPerChunk=256;
constexpr std::size_t kRtPcmMaxConsumeEvents=262144;
constexpr std::size_t kRtPcmMaxDescriptorSlots=1048576;

enum RtPcmSegmentFlags : std::uint32_t {
  RtPcmSegmentTransitioning=1u<<0,
  RtPcmSegmentExactDuration=1u<<1,
  RtPcmEventSegmentEnd=1u<<31
};

struct RtPcmSegment {
  std::uint64_t descriptorId=0;
  double startPositionSeconds=0.0;
  double duration=0.0;
  // sourceRate describes the source track; timelineRate advances the cursor
  // through already-resampled output PCM frames.
  std::int32_t sourceRate=0;
  std::int32_t timelineRate=0;
  std::uint32_t offset=0;
  std::uint32_t frames=0;
  std::uint32_t flags=0;
  std::uint64_t transitionSerial=0;
};

struct RtPcmChunkInfo {
  // frames counts the complete output timeline. Producers expand explicit
  // silence into zero samples here and move later segment offsets past it.
  // Segment ranges identify music-bearing frames; gaps have no segment event.
  std::uint32_t frames=0;
  std::uint32_t flags=0;
  std::uint32_t segmentCount=0;
  RtPcmSegment segments[kRtPcmMaxSegmentsPerChunk]{};
};

enum RtPcmChunkFlags : std::uint32_t {
  RtPcmChunkEof=1u<<0,
  RtPcmChunkBuffering=1u<<1
};

struct RtPcmEvent {
  std::uint64_t descriptorId=0;
  double startPositionSeconds=0.0;
  double duration=0.0;
  std::int32_t sourceRate=0;
  std::int32_t timelineRate=0;
  std::uint32_t outputOffset=0;
  std::uint32_t frames=0;
  std::uint32_t flags=0;
  std::uint64_t transitionSerial=0;
  std::uint32_t referenceReleases=0;
};

struct RtPcmConsumeResult {
  // timelineFrames is the number of requested output frames backed by queued
  // chunks, including explicit silence. audioFrames excludes all silence.
  std::uint32_t timelineFrames=0;
  std::uint32_t audioFrames=0;
  std::uint32_t eventCount=0;
  bool eof=false;
  bool buffering=false;
  bool underflow=false;
  bool eventOverflow=false;
};

template<class Sample>
struct RtPcmWriteBlock {
  Sample* data=nullptr;
  std::size_t capacityFrames=0;
  std::uint64_t sequence=0;
  std::uint64_t generation=0;
  explicit operator bool() const noexcept {return data!=nullptr;}
};

template<class Sample>
class RtPcmBuffer {
  static_assert(std::is_same<Sample,float>::value||std::is_same<Sample,double>::value,
                "RtPcmBuffer supports float or double PCM samples");
 public:
  RtPcmBuffer()=default;
  RtPcmBuffer(const RtPcmBuffer&)=delete;
  RtPcmBuffer& operator=(const RtPcmBuffer&)=delete;

  // Allocates a fixed queue sized from the device's actual buffer. The caller
  // must stop both endpoints before reconfiguring or resetting the buffer.
  void configure(std::size_t channels,std::size_t deviceBufferFrames,
                 std::size_t producerChunkFrames,std::size_t queuedDeviceBuffers=3) {
    if(!channels||!deviceBufferFrames||!producerChunkFrames||!queuedDeviceBuffers)
      throw std::invalid_argument("RtPcmBuffer requires non-zero dimensions");
    if(deviceBufferFrames>std::numeric_limits<std::uint32_t>::max()||
       producerChunkFrames>std::numeric_limits<std::uint32_t>::max())
      throw std::length_error("RtPcmBuffer dimensions exceed fixed POD frame fields");
    const std::size_t chunksPerDevice=ceilDivide(deviceBufferFrames,producerChunkFrames);
    if(chunksPerDevice>(std::numeric_limits<std::size_t>::max()-2)/queuedDeviceBuffers)
      throw std::length_error("RtPcmBuffer queue size overflow");
    const std::size_t slotCount=chunksPerDevice*queuedDeviceBuffers+2;
    if(producerChunkFrames>std::numeric_limits<std::size_t>::max()/channels||
       slotCount>std::numeric_limits<std::size_t>::max()/(producerChunkFrames*channels))
      throw std::length_error("RtPcmBuffer sample storage size overflow");
    const std::size_t maxEventsPerConsume=(chunksPerDevice+1)*kRtPcmMaxSegmentsPerChunk;
    if(maxEventsPerConsume>kRtPcmMaxConsumeEvents)
      throw std::length_error("RtPcmBuffer device block exceeds the fixed metadata-event limit");

    std::unique_ptr<Slot[]> slots(new Slot[slotCount]);
    std::unique_ptr<Sample[]> samples(new Sample[slotCount*producerChunkFrames*channels]{});
    for(std::size_t i=0;i<slotCount;i++)
      slots[i].samples=samples.get()+i*producerChunkFrames*channels;

    configured_.store(false,std::memory_order_relaxed);
    slots_=std::move(slots);
    samples_=std::move(samples);
    channels_=channels;
    deviceBufferFrames_=deviceBufferFrames;
    chunkFrames_=producerChunkFrames;
    slotCount_=slotCount;
    maxConsumeEvents_=maxEventsPerConsume;
    generation_++;
    if(!generation_)generation_=1;
    producerReservation_=false;
    producerIndex_=0;
    writeIndex_.store(0,std::memory_order_relaxed);
    readIndex_.store(0,std::memory_order_relaxed);
    publishedFrames_.store(0,std::memory_order_relaxed);
    consumedFrames_.store(0,std::memory_order_relaxed);
    consumerOffset_=0;
    consumerEof_=false;
    configured_.store(true,std::memory_order_release);
  }

  // The producer calls this until a free slot is available. It never waits.
  bool tryBeginWrite(RtPcmWriteBlock<Sample>& block) noexcept {
    block={};
    if(!configured_.load(std::memory_order_acquire)||producerReservation_)return false;
    const std::uint64_t write=writeIndex_.load(std::memory_order_relaxed);
    const std::uint64_t read=readIndex_.load(std::memory_order_acquire);
    if(write-read>=slotCount_)return false;
    producerIndex_=write;
    producerReservation_=true;
    Slot& slot=slots_[static_cast<std::size_t>(write%slotCount_)];
    block.data=slot.samples;
    block.capacityFrames=chunkFrames_;
    block.sequence=write;
    block.generation=generation_;
    return true;
  }

  // Publish only after the producer has filled data and metadata. Invalid
  // metadata is rejected without exposing a partially written slot.
  bool publish(const RtPcmWriteBlock<Sample>& block,const RtPcmChunkInfo& info) noexcept {
    if(!configured_.load(std::memory_order_acquire)||!producerReservation_||block.generation!=generation_||
       block.sequence!=producerIndex_||!block.data||info.frames>chunkFrames_||
       info.segmentCount>kRtPcmMaxSegmentsPerChunk)
      return false;
    const std::uint64_t write=writeIndex_.load(std::memory_order_relaxed);
    if(write!=producerIndex_)return false;
    std::uint32_t previousEnd=0;
    for(std::uint32_t i=0;i<info.segmentCount;i++) {
      const RtPcmSegment& segment=info.segments[i];
      if(segment.offset<previousEnd||segment.offset>info.frames||
         segment.frames>info.frames-segment.offset||segment.sourceRate<0||segment.timelineRate<0)
        return false;
      previousEnd=segment.offset+segment.frames;
    }
    Slot& slot=slots_[static_cast<std::size_t>(write%slotCount_)];
    slot.info=info;
    producerReservation_=false;
    publishedFrames_.fetch_add(info.frames,std::memory_order_relaxed);
    writeIndex_.store(write+1,std::memory_order_release);
    return true;
  }

  void cancelWrite(const RtPcmWriteBlock<Sample>& block) noexcept {
    if(producerReservation_&&block.generation==generation_&&block.sequence==producerIndex_)
      producerReservation_=false;
  }

  // Copies up to frames from ready chunks and writes zeros for explicit
  // silence and any underflow tail. The caller supplies fixed event storage.
  // This is the audio-thread API: bounded memcpy/fill/atomic operations only.
  RtPcmConsumeResult consume(Sample* destination,std::size_t frames,
                            RtPcmEvent* events,std::size_t eventCapacity) noexcept {
    RtPcmConsumeResult result{};
    if(!destination||!frames||frames>std::numeric_limits<std::uint32_t>::max()) {
      result.underflow=frames!=0;
      result.buffering=result.underflow;
      return result;
    }
    std::fill_n(destination,frames*channels_,Sample{});
    std::size_t outputOffset=0;
    while(outputOffset<frames) {
      const std::uint64_t read=readIndex_.load(std::memory_order_relaxed);
      const std::uint64_t write=writeIndex_.load(std::memory_order_acquire);
      if(read==write) {
        if(consumerEof_)result.eof=true;
        else {result.underflow=true;result.buffering=true;}
        break;
      }
      Slot& slot=slots_[static_cast<std::size_t>(read%slotCount_)];
      const RtPcmChunkInfo& info=slot.info;
      const std::size_t total=info.frames;
      if(consumerOffset_>=total) {
        finishChunk(read,info,result);
        continue;
      }
      if(total==0) {
        finishChunk(read,info,result);
        continue;
      }
      const std::size_t take=std::min(frames-outputOffset,total-consumerOffset_);
      result.buffering=result.buffering||((info.flags&RtPcmChunkBuffering)!=0);
      result.timelineFrames+=static_cast<std::uint32_t>(take);
      const std::size_t readStart=consumerOffset_;
      const std::size_t readEnd=consumerOffset_+take;
      const std::size_t overlapStart=readStart;
      const std::size_t overlapEnd=readEnd;
      if(overlapStart<overlapEnd) {
        const std::size_t timelineCount=overlapEnd-overlapStart;
        const std::size_t destinationFrame=outputOffset;
        std::copy_n(slot.samples+overlapStart*channels_,timelineCount*channels_,
                    destination+destinationFrame*channels_);
        for(std::uint32_t i=0;i<info.segmentCount;i++) {
          const RtPcmSegment& segment=info.segments[i];
          const std::size_t segmentStart=segment.offset;
          const std::size_t segmentEnd=segmentStart+segment.frames;
          const std::size_t eventStart=std::max(overlapStart,segmentStart);
          const std::size_t eventEnd=std::min(overlapEnd,segmentEnd);
          if(eventStart>=eventEnd)continue;
          RtPcmEvent event{};
          event.descriptorId=segment.descriptorId;
          event.startPositionSeconds=segment.startPositionSeconds;
          if(segment.timelineRate>0)
            event.startPositionSeconds+=static_cast<double>(eventStart-segmentStart)/segment.timelineRate;
          event.duration=segment.duration;
          event.sourceRate=segment.sourceRate;
          event.timelineRate=segment.timelineRate;
          event.outputOffset=static_cast<std::uint32_t>(outputOffset+(eventStart-readStart));
          event.frames=static_cast<std::uint32_t>(eventEnd-eventStart);
          event.flags=segment.flags;
          if(eventEnd==segmentEnd){event.flags|=RtPcmEventSegmentEnd;event.referenceReleases=segment.descriptorId?1u:0u;}
          event.transitionSerial=segment.transitionSerial;
          result.audioFrames+=event.frames;
          if(events&&result.eventCount) {
            RtPcmEvent& previous=events[result.eventCount-1];
            const std::uint32_t comparableFlags=~static_cast<std::uint32_t>(RtPcmEventSegmentEnd);
            const double expectedPosition=previous.startPositionSeconds+
              (previous.timelineRate>0?static_cast<double>(previous.frames)/previous.timelineRate:0.0);
            if(previous.descriptorId==event.descriptorId&&previous.duration==event.duration&&
               previous.sourceRate==event.sourceRate&&previous.timelineRate==event.timelineRate&&
               previous.transitionSerial==event.transitionSerial&&
               (previous.flags&comparableFlags)==(event.flags&comparableFlags)&&
               previous.outputOffset+previous.frames==event.outputOffset&&
               std::abs(expectedPosition-event.startPositionSeconds)<=1e-9) {
              previous.frames+=event.frames;
              previous.flags|=event.flags&RtPcmEventSegmentEnd;
              previous.referenceReleases+=event.referenceReleases;
              continue;
            }
          }
          if(!events||result.eventCount>=eventCapacity) {
            result.eventOverflow=true;
            continue;
          }
          events[result.eventCount++]=event;
        }
      }
      consumerOffset_+=take;
      outputOffset+=take;
      consumedFrames_.fetch_add(take,std::memory_order_relaxed);
      if(consumerOffset_>=total)finishChunk(read,info,result);
    }
    if(outputOffset<frames&&!result.eof) {
      result.underflow=true;
      result.buffering=true;
    }
    return result;
  }

  // Only call after producer and consumer have stopped or been joined.
  void reset() noexcept {
    if(!configured_.load(std::memory_order_acquire))return;
    producerReservation_=false;
    producerIndex_=0;
    writeIndex_.store(0,std::memory_order_relaxed);
    readIndex_.store(0,std::memory_order_relaxed);
    publishedFrames_.store(0,std::memory_order_relaxed);
    consumedFrames_.store(0,std::memory_order_relaxed);
    consumerOffset_=0;
    consumerEof_=false;
    generation_++;
    if(!generation_)generation_=1;
  }

  bool configured() const noexcept{return configured_.load(std::memory_order_acquire);}
  std::size_t channels() const noexcept{return channels_;}
  std::size_t deviceBufferFrames() const noexcept{return deviceBufferFrames_;}
  std::size_t producerChunkFrames() const noexcept{return chunkFrames_;}
  std::size_t capacityChunks() const noexcept{return slotCount_;}
  std::size_t maxConsumeEvents() const noexcept{return maxConsumeEvents_;}
  std::size_t queuedChunks() const noexcept {
    if(!configured_.load(std::memory_order_acquire))return 0;
    const std::uint64_t write=writeIndex_.load(std::memory_order_acquire);
    const std::uint64_t read=readIndex_.load(std::memory_order_acquire);
    return static_cast<std::size_t>(write-read);
  }
  std::uint64_t queuedFrames() const noexcept {
    const std::uint64_t written=publishedFrames_.load(std::memory_order_acquire);
    const std::uint64_t consumed=consumedFrames_.load(std::memory_order_acquire);
    return written>=consumed?written-consumed:0;
  }

 private:
  struct Slot {
    Sample* samples=nullptr;
    RtPcmChunkInfo info{};
  };

  static std::size_t ceilDivide(std::size_t value,std::size_t divisor) noexcept {
    return value/divisor+(value%divisor?1:0);
  }

  void finishChunk(std::uint64_t read,const RtPcmChunkInfo& info,
                   RtPcmConsumeResult& result) noexcept {
    result.buffering=result.buffering||((info.flags&RtPcmChunkBuffering)!=0);
    if(info.flags&RtPcmChunkEof)consumerEof_=true;
    if(consumerEof_)result.eof=true;
    consumerOffset_=0;
    readIndex_.store(read+1,std::memory_order_release);
  }

  std::unique_ptr<Slot[]> slots_;
  std::unique_ptr<Sample[]> samples_;
  std::atomic<std::uint64_t> writeIndex_{0};
  std::atomic<std::uint64_t> readIndex_{0};
  std::atomic<std::uint64_t> publishedFrames_{0};
  std::atomic<std::uint64_t> consumedFrames_{0};
  std::size_t channels_=0,deviceBufferFrames_=0,chunkFrames_=0,slotCount_=0,maxConsumeEvents_=0;
  std::size_t consumerOffset_=0;
  std::uint64_t producerIndex_=0,generation_=0;
  std::atomic<bool> configured_{false};bool producerReservation_=false,consumerEof_=false;
};

static_assert(std::atomic<std::uint64_t>::is_always_lock_free,
              "RtPcmBuffer requires lock-free 64-bit queue counters");

} // namespace rhine
