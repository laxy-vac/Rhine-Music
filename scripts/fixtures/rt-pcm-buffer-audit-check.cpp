#include "rt-pcm-buffer.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <thread>

namespace {

void require(bool condition,const char* message) {
  if(!condition) {
    std::fprintf(stderr,"FAIL %s\n",message);
    std::exit(1);
  }
}

template<class Sample>
void publish(rhine::RtPcmBuffer<Sample>& buffer,const Sample* values,std::size_t frames,
             const rhine::RtPcmChunkInfo& info) {
  rhine::RtPcmWriteBlock<Sample> block;
  require(buffer.tryBeginWrite(block),"producer obtains a preallocated slot");
  require(frames<=block.capacityFrames,"producer chunk fits fixed capacity");
  for(std::size_t i=0;i<frames*buffer.channels();i++)block.data[i]=values[i];
  require(buffer.publish(block,info),"producer publishes fixed POD metadata");
}

} // namespace

int main() {
  using namespace rhine;
  RtPcmBuffer<double> buffer;
  buffer.configure(1,8,6,2);
  require(buffer.capacityChunks()==6,"capacity is derived from device buffer and queue depth");
  require(buffer.maxConsumeEvents()==3*kRtPcmMaxSegmentsPerChunk,"event scratch bound includes multi-chunk device blocks");

  // Producer expanded old-track audio, a two-frame gap and new-track audio
  // into one fixed chunk. Metadata offsets skip the silent gap.
  const double firstSamples[]={0,1,2,0,0,3};
  RtPcmChunkInfo first{};
  first.frames=6;first.segmentCount=2;
  first.segments[0]={11,0.5,10.0,44100,48000,1,2,RtPcmSegmentTransitioning,7};
  first.segments[1]={12,2.0,4.0,96000,48000,5,1,0,8};
  publish(buffer,firstSamples,6,first);

  const double tailSamples[]={4,5};
  RtPcmChunkInfo tail{};
  tail.frames=2;tail.flags=RtPcmChunkEof;tail.segmentCount=1;
  tail.segments[0]={13,4.0,10.0,96000,48000,0,2,0,9};
  publish(buffer,tailSamples,2,tail);

  double output[7]{};RtPcmEvent events[8]{};
  const auto firstRead=buffer.consume(output,7,events,8);
  require(firstRead.timelineFrames==7&&firstRead.audioFrames==4,"consumer spans smaller chunks and expanded gap timeline");
  require(!firstRead.underflow&&!firstRead.eof,"partial EOF chunk remains queued");
  const double expected[]={0,1,2,0,0,3,4};
  for(std::size_t i=0;i<7;i++)require(output[i]==expected[i],"consumer copies expanded audio and silent gap unchanged");
  require(firstRead.eventCount==3,"consumer reports segment events across chunks");
  require(events[0].descriptorId==11&&events[0].outputOffset==1&&events[0].frames==2,
          "first event retains descriptor and output timeline offset");
  require((events[0].flags&RtPcmEventSegmentEnd)!=0,"segment completion is signaled for hardware timeline release");
  require(events[0].sourceRate==44100&&events[0].timelineRate==48000,
          "source metadata keeps source rate while cursor uses the output timeline rate");
  require(events[1].descriptorId==12&&events[1].outputOffset==5&&events[1].frames==1,
          "new-track event starts after the expanded silence gap");
  require(events[2].descriptorId==13&&events[2].outputOffset==6&&events[2].frames==1,
          "consumer maps the next producer chunk into the output timeline");
  require(std::abs(events[2].startPositionSeconds-4.0)<1e-12,"event carries its music cursor");

  double finalOutput[3]{};RtPcmEvent finalEvents[4]{};
  const auto finalRead=buffer.consume(finalOutput,3,finalEvents,4);
  require(finalRead.timelineFrames==1&&finalRead.audioFrames==1&&finalRead.eof,
          "EOF is delivered only after the partial tail drains");
  require(!finalRead.underflow&&finalOutput[0]==5&&finalOutput[1]==0&&finalOutput[2]==0,
          "EOF tail is preserved and remaining destination is silent");
  require(finalRead.eventCount==1&&finalEvents[0].descriptorId==13&&
          (finalEvents[0].flags&RtPcmEventSegmentEnd)!=0,
          "final segment event survives the short EOF tail");

  buffer.reset();
  double emptyOutput[3]={9,9,9};
  const auto emptyRead=buffer.consume(emptyOutput,3,nullptr,0);
  require(emptyRead.underflow&&emptyRead.buffering&&!emptyRead.eof,"empty live queue is reported as underflow");
  require(emptyOutput[0]==0&&emptyOutput[1]==0&&emptyOutput[2]==0,"underflow output is zero-filled");

  buffer.reset();
  RtPcmWriteBlock<double> invalidBlock;
  require(buffer.tryBeginWrite(invalidBlock),"reset reopens the producer queue");
  RtPcmChunkInfo invalid{};invalid.frames=1;invalid.segmentCount=257;
  require(!buffer.publish(invalidBlock,invalid),"segment counts beyond the fixed bound are rejected");
  buffer.cancelWrite(invalidBlock);

  const double fullSamples[]={8,8,8,8};
  RtPcmChunkInfo full{};full.frames=4;
  for(std::size_t i=0;i<buffer.capacityChunks();i++)publish(buffer,fullSamples,4,full);
  RtPcmWriteBlock<double> fullBlock;
  require(!buffer.tryBeginWrite(fullBlock),"producer never waits when the SPSC queue is full");
  double drain[8]{};
  const auto drained=buffer.consume(drain,8,nullptr,0);
  require(drained.timelineFrames==8&&!drained.underflow,"consumer drains across queued producer chunks");
  require(buffer.tryBeginWrite(fullBlock),"producer can reuse slots after consumer release");
  buffer.cancelWrite(fullBlock);

  buffer.reset();
  const double contiguousA[]={1,1},contiguousB[]={1,1};
  RtPcmChunkInfo contiguousInfoA{};contiguousInfoA.frames=2;contiguousInfoA.segmentCount=1;
  contiguousInfoA.segments[0]={21,1.0,10.0,44100,48000,0,2,0,10};
  RtPcmChunkInfo contiguousInfoB{};contiguousInfoB.frames=2;contiguousInfoB.segmentCount=1;
  contiguousInfoB.segments[0]={21,1.0+2.0/48000.0,10.0,44100,48000,0,2,0,10};
  publish(buffer,contiguousA,2,contiguousInfoA);publish(buffer,contiguousB,2,contiguousInfoB);
  double contiguousOutput[4]{};RtPcmEvent contiguousEvents[4]{};
  const auto contiguousRead=buffer.consume(contiguousOutput,4,contiguousEvents,4);
  require(contiguousRead.eventCount==1&&contiguousEvents[0].frames==4&&
          contiguousEvents[0].referenceReleases==2,
          "adjacent chunks with one descriptor coalesce while retaining both hardware-release references");

  RtPcmBuffer<float> floatBuffer;
  floatBuffer.configure(2,4,2,2);
  const float stereo[]={0.25f,-0.25f,0.5f,-0.5f};
  RtPcmChunkInfo stereoInfo{};stereoInfo.frames=2;
  publish(floatBuffer,stereo,2,stereoInfo);
  float stereoOutput[4]{};
  const auto stereoRead=floatBuffer.consume(stereoOutput,2,nullptr,0);
  require(stereoRead.timelineFrames==2&&stereoOutput[0]==0.25f&&stereoOutput[1]==-0.25f&&
          stereoOutput[2]==0.5f&&stereoOutput[3]==-0.5f,"float SPSC preserves typed stereo samples");

  RtPcmBuffer<double> concurrent;
  concurrent.configure(1,64,64,2);
  constexpr std::size_t chunkCount=400,chunkFrames=64,totalFrames=chunkCount*chunkFrames;
  std::thread producer([&]{
    std::size_t next=0;
    while(next<chunkCount) {
      RtPcmWriteBlock<double> block;
      if(!concurrent.tryBeginWrite(block)){std::this_thread::yield();continue;}
      for(std::size_t i=0;i<chunkFrames;i++)block.data[i]=static_cast<double>(next*chunkFrames+i);
      RtPcmChunkInfo info{};info.frames=static_cast<std::uint32_t>(chunkFrames);
      if(next+1==chunkCount)info.flags=RtPcmChunkEof;
      if(!concurrent.publish(block,info)){concurrent.cancelWrite(block);std::abort();}
      ++next;
    }
  });
  std::size_t received=0;double concurrentOutput[73]{};
  while(received<totalFrames) {
    const std::size_t request=std::min<std::size_t>(73,totalFrames-received);
    const auto read=concurrent.consume(concurrentOutput,request,nullptr,0);
    for(std::size_t i=0;i<read.timelineFrames;i++)
      require(concurrentOutput[i]==static_cast<double>(received+i),"concurrent SPSC preserves sample order without locks");
    received+=read.timelineFrames;
    if(!read.timelineFrames)std::this_thread::yield();
  }
  producer.join();
  double eofOutput=1.0;const auto concurrentEof=concurrent.consume(&eofOutput,1,nullptr,0);
  require(concurrentEof.eof&&eofOutput==0.0,"concurrent producer EOF survives ring wraparound");

  std::puts("PASS RtPcmBuffer fixed-capacity SPSC, partial chunks, silence, EOF, underflow and float PCM");
  return 0;
}
