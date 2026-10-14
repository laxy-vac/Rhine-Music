#pragma once
#include <windows.h>
#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <exception>
#include <functional>
#include <stdexcept>
#include <vector>

namespace rhine {

// A byte-preserving transport. Only its producer may call the DSD decoder or
// file APIs. The device callback has one consumer and only copies whole frames.
class RtDsdBuffer {
 public:
  struct SourceRead { size_t bytes=0; bool eof=false,buffering=false; int error=0; };
  struct ReadResult { size_t frames=0; bool eof=false,buffering=false; int error=0; };
  using ReadFn=std::function<SourceRead(std::uint8_t*,size_t)>;
  RtDsdBuffer()=default;
  ~RtDsdBuffer(){stop();if(stopEvent_)CloseHandle(stopEvent_);if(readyEvent_)CloseHandle(readyEvent_);}
  RtDsdBuffer(const RtDsdBuffer&)=delete;
  RtDsdBuffer& operator=(const RtDsdBuffer&)=delete;

  void configure(size_t frameBytes,size_t capacityFrames,ReadFn read) {
    stop();
    if(!frameBytes||frameBytes>16||!capacityFrames||capacityFrames>16777216/frameBytes||!read)
      throw std::runtime_error("Invalid DSD transport capacity");
    frameBytes_=frameBytes;capacity_=capacityFrames;read_=std::move(read);
    ring_.resize(capacity_*frameBytes_);scratch_.resize(std::min<size_t>(4096,capacity_)*frameBytes_);
    if(!stopEvent_)stopEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!readyEvent_)readyEvent_=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    if(!stopEvent_||!readyEvent_)throw std::runtime_error("Cannot create DSD producer events");
    reset();
  }
  // Requires a stopped device callback and producer.
  void reset() {
    if(thread_)throw std::runtime_error("Cannot reset a running DSD producer");
    readIndex_=0;writeIndex_=0;ended_=false;failure_=0;underflows_=0;ResetEvent(stopEvent_);ResetEvent(readyEvent_);
  }
  void start() {
    if(thread_)return;
    if(!read_||!capacity_)throw std::runtime_error("DSD transport is not configured");
    ResetEvent(stopEvent_);
    ResetEvent(readyEvent_);
    thread_=CreateThread(nullptr,0,threadEntry,this,0,nullptr);
    if(!thread_)throw std::runtime_error("Cannot create DSD producer thread");
    // Prefetch happens on the cancellable worker. The controller only waits
    // for a bounded initial fill; later short reads produce valid DSD idle.
    WaitForSingleObject(readyEvent_,500);
  }
  void stop() noexcept {
    if(!thread_)return;
    SetEvent(stopEvent_);CancelSynchronousIo(thread_);
    if(WaitForSingleObject(thread_,5000)!=WAIT_OBJECT_0) {
      // Never free a decoder/ring that a stuck worker could still access.
      // The owning native host is isolated; the Node controller reports exit.
      TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);
      std::terminate();
    }
    CloseHandle(thread_);thread_=nullptr;
  }
  ReadResult consume(void* destination,size_t frames) noexcept {
    ReadResult out;
    if((frames&&!destination)||!capacity_){out.error=ERROR_INVALID_PARAMETER;return out;}
    const auto r=readIndex_.load(std::memory_order_relaxed),w=writeIndex_.load(std::memory_order_acquire);
    const size_t n=static_cast<size_t>(std::min<uint64_t>(frames,w-r));
    const size_t offset=static_cast<size_t>(r%capacity_),first=std::min(n,capacity_-offset);
    if(first)std::memcpy(destination,ring_.data()+offset*frameBytes_,first*frameBytes_);
    if(n>first)std::memcpy(static_cast<uint8_t*>(destination)+first*frameBytes_,ring_.data(),(n-first)*frameBytes_);
    readIndex_.store(r+n,std::memory_order_release);out.frames=n;
    const bool drained=ended_.load(std::memory_order_acquire)&&r+n==writeIndex_.load(std::memory_order_acquire);
    out.error=drained?failure_.load(std::memory_order_relaxed):0;out.eof=drained&&!out.error;
    out.buffering=n<frames&&!out.eof&&!out.error;
    if(out.buffering)underflows_.fetch_add(1,std::memory_order_relaxed);
    return out;
  }
  uint64_t consumedFrames() const noexcept{return readIndex_.load(std::memory_order_acquire);}
  uint64_t queuedFrames() const noexcept{const auto r=readIndex_.load(std::memory_order_acquire),w=writeIndex_.load(std::memory_order_acquire);return w>=r?w-r:0;}
  uint64_t underflows() const noexcept{return underflows_.load(std::memory_order_relaxed);}
  bool drained() const noexcept{return ended_.load(std::memory_order_acquire)&&queuedFrames()==0;}

 private:
  static DWORD WINAPI threadEntry(void* p) noexcept {static_cast<RtDsdBuffer*>(p)->run();return 0;}
  bool produce() noexcept {
    try {
      const auto w=writeIndex_.load(std::memory_order_relaxed),r=readIndex_.load(std::memory_order_acquire);
      const size_t free=capacity_-static_cast<size_t>(w-r);
      if(!free)return false;
      const size_t bytes=std::min(free*frameBytes_,scratch_.size());const auto result=read_(scratch_.data(),bytes);
      if(result.error||result.bytes>bytes||result.bytes%frameBytes_) {
        failure_.store(result.error?result.error:ERROR_INVALID_DATA,std::memory_order_relaxed);ended_.store(true,std::memory_order_release);return false;
      }
      const size_t frames=result.bytes/frameBytes_,offset=static_cast<size_t>(w%capacity_),first=std::min(frames,capacity_-offset);
      if(first)std::memcpy(ring_.data()+offset*frameBytes_,scratch_.data(),first*frameBytes_);
      if(frames>first)std::memcpy(ring_.data(),scratch_.data()+first*frameBytes_,(frames-first)*frameBytes_);
      writeIndex_.store(w+frames,std::memory_order_release);
      if(result.eof)ended_.store(true,std::memory_order_release);
      return frames&&!result.buffering;
    } catch(...) {failure_.store(ERROR_READ_FAULT,std::memory_order_relaxed);ended_.store(true,std::memory_order_release);return false;}
  }
  void run() noexcept {
    while(WaitForSingleObject(stopEvent_,0)!=WAIT_OBJECT_0&&!ended_.load(std::memory_order_acquire)) {
      if(!produce()){SetEvent(readyEvent_);WaitForSingleObject(stopEvent_,2);}
      else if(queuedFrames()>=capacity_)SetEvent(readyEvent_);
    }
    SetEvent(readyEvent_);
  }
  size_t frameBytes_=0,capacity_=0;
  std::vector<uint8_t> ring_,scratch_;
  ReadFn read_;
  std::atomic<uint64_t> readIndex_{0},writeIndex_{0},underflows_{0};
  std::atomic<bool> ended_{false};
  std::atomic<int> failure_{0};
  HANDLE stopEvent_=nullptr,readyEvent_=nullptr,thread_=nullptr;
};
static_assert(std::atomic<uint64_t>::is_always_lock_free,"DSD transport requires lock-free 64-bit indices");
} // namespace rhine
