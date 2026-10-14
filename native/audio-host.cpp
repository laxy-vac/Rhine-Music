// Windows PCM/DSD host with WASAPI/ASIO output and the bundled LSP editor.
// Sony processing stays in its existing bridge; device callbacks consume
// prepared buffers, while decoding and PCM DSP run on producer threads.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <iostream>
#include <limits>
#include <memory>
#include <mutex>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>
#include <unordered_map>
#include "json.hpp"
#define BASSDEF(f) (WINAPI *f)
#define BASSASIODEF(f) (WINAPI *f)
#define BASSDSDDEF(f) (WINAPI *f)
#include "bass.h"
#include "bassasio.h"
#include "bassdsd.h"
#include "dop-packing.h"
#include "pcm-wave-reader.h"
#include "pcm-spectrum.h"
#include "wasapi-output.h"
#include "pcm-file-decoder.h"
#include "rt-pcm-buffer.h"
#include "rt-dsd-buffer.h"
#include "asio-buffer-config.h"
using json=nlohmann::json;
using Clock=std::chrono::steady_clock;
struct AsioPcmRenderer {
 std::vector<double> interleaved;
 rhine::RtPcmBuffer<double> ready;
 std::vector<rhine::RtPcmEvent> events;
 rhine::PcmQuantizer quantizer;
 std::atomic_flag callbackBusy=ATOMIC_FLAG_INIT;
 HANDLE producer=nullptr,producerStop=nullptr,producerReady=nullptr;
 size_t capacityFrames=0;
 int sampleRate=0;
 bool bitPerfect=false;
 std::atomic<int> fault{0};
 std::atomic<bool> producerFailed{false},producerEof{false};
 std::atomic<uint64_t> underflows{0},producedFrames{0},consumedFrames{0};
 std::atomic<size_t> actualBufferFrames{0};
 std::atomic<double> consumedPosition{0.0};
 DWORD firstChannel=0;
 int channels=0;
 size_t bytesPerSample=0;
 std::atomic<double> gain{1.0};
 size_t blockFrames=0;
 unsigned int deliveredMask=0;
 std::atomic<bool> failed{false},eof{false};
 std::atomic<size_t> fadeOutTotal{0},fadeOutDone{0},fadeInTotal{0},fadeInDone{0};
 std::atomic<bool> fadeOutComplete{false};
 std::atomic<uint64_t> overRangeSamples{0},clippingSamples{0};
 std::atomic<uint64_t> bitPerfectCheckedSamples{0},bitPerfectMismatchSamples{0};
 std::atomic<double> peakAbs{0.0};
 rhine::PcmQuantizerStats quantizerStatsSeen{};
 std::array<char,256> errorText{};
};
struct AsioDsdRenderer {
 rhine::RtDsdBuffer ready;
 rhine::DopPacker packer;
 std::vector<float> dopScratch;
 size_t capacityFrames=0,channels=0,sampleBytes=1;
 bool dop=false;
 rhine::DopAlignment alignment=rhine::DopAlignment::LeftAligned;
 std::atomic<bool> eof{false};
 std::atomic<int> fault{0};
 std::atomic<size_t> actualBufferFrames{0};
 std::atomic_flag busy=ATOMIC_FLAG_INIT;
 AsioDsdRenderer(int channelsValue,int bits,rhine::DopAlignment alignment,bool isDop)
   :packer(channelsValue,bits,alignment),channels(channelsValue),sampleBytes(isDop?bits/8:1),dop(isDop),alignment(alignment){}
};
struct QueuedPcmTrack {
 HSTREAM stream=0;
 std::unique_ptr<rhine::PcmEngine> engine;
 std::unique_ptr<rhine::WavePcmReader> waveReader;
 rhine::WaveInfo waveInfo{};
 std::string trackId,file;
 json sourceFormat=json::object(),replayGain=json::object(),processing=json::object(),processorStages=json::array();
 int sourceRate=0,sourceBits=0,channels=0,outputRate=0;
 int sourceValidBits=0,sourceContainerBits=0;
 bool directWave=false;
 double duration=0;
 uint64_t transitionSerial=0;
};
struct RetiredPcmSource {
 HSTREAM stream=0;
 std::unique_ptr<rhine::PcmEngine> engine;
 std::unique_ptr<rhine::WavePcmReader> waveReader;
 std::unique_ptr<QueuedPcmTrack> queuedTrack;
};
static std::array<RetiredPcmSource,8> retiredPcmSources{};
static size_t retiredPcmSourceCount=0;
static HSTREAM stream=0;
static bool asio=false,paused=true,ended=false;
static std::string mode="pcm",session,error,backend="asio";
static std::unique_ptr<rhine::WasapiOutput> wasapiOutput;
static rhine::WasapiSnapshot wasapiSnapshot;
static std::string wasapiDevice="default",wasapiMode="shared";
static double wasapiGain=1.0;static bool wasapiAllow16=false;
static DWORD outputChannel=0;
static double outputRate=0;static int dsdRate=0;
static int sourceRate=0,sourceBits=0,outputBits=0,pcmChannels=0,requestedBufferMs=0,requestedReconfigureMs=0;
static int sourceValidBits=0,sourceContainerBits=0;
static bool directWavePcm=false;
static std::string decoderOutputPrecision="float32";
static std::unique_ptr<rhine::WavePcmReader> waveReader;
static rhine::WaveInfo waveInfo{};
static double masterGain=1.0;
static std::string effectiveOutputFormat="auto",ditherMode="none",currentTrackId;
static uint64_t transitionSerial=0;
static uint64_t activeTrackSerial=0;
static json processingSettings=json::object(),replayGainMetadata=json::object(),sourceFormatMetadata=json::object();
static json processorStageSnapshot=json::array();
static std::unique_ptr<rhine::PcmEngine> pcmEngine;
static std::atomic<bool> lspTransportPaused{true};
static std::unique_ptr<rhine::LspPluginEq> lspIdleEditor;
static std::string lspIdleState;
static rhine::PcmSpectrum pcmSpectrum;
static rhine::PcmQuantizer asioQuantizer;
static std::unique_ptr<AsioPcmRenderer> asioPcmRenderer;
static std::unique_ptr<AsioDsdRenderer> asioDsdRenderer;
static DWORD asioStartFrames=0;
static int asioNativeCode=0,asioNativeBits=0,asioNativeContainerBits=0;
static std::string asioNativeFormat,asioNativeAlignment;
static void stopAsioPcmProducer(AsioPcmRenderer* renderer) noexcept;
static void startAsioPcmProducer(AsioPcmRenderer* renderer);
static void requireAsioStopped();
static std::atomic<bool> asioPcmEnded{false};
static std::atomic<bool> asioPcmBuffering{false};
static json openRequest=json::object();
static json processingStages();
static json queuedTrackStages(bool mixing,const std::string& fromTrackId);
static std::mutex pcmRenderMutex;
static std::unique_ptr<QueuedPcmTrack> queuedPcmTrack;
static std::string queueError;
static double currentDuration=0,currentStartPosition=0;
static bool transitionPending=false,transitionFadeActive=false,manualTransitionRequested=false;
static size_t transitionFadeFrames=0,transitionFadeDone=0;
static std::string transitionRequestedBy="";
static std::string transitionFromTrackId;
static size_t gapFramesRemaining=0;
static bool gapActive=false;
static double pausedPosition=0;
static std::atomic<int> driverEvent{0};
static std::atomic<bool> dsdReadFailed{false};
static Clock::time_point endSince{};
static std::wstring directory;
struct GrowingFile {
 HANDLE handle=INVALID_HANDLE_VALUE;QWORD length=0,position=0;
 std::atomic<bool> cancelled{false},failed{false};std::mutex mutex;
};
static std::unique_ptr<GrowingFile> growing;
// Present DSF as a seekable DSDIFF byte view. BASSDSD 2.4.2 drops the final
// complete DSF block when sampleCount/8 is a multiple of 4096. This view keeps
// every source bit, changes only container framing / specified bit order, and
// avoids rewriting or copying the song. Its two-channel cache is only 8192 bytes.
struct DsfView {
 HANDLE handle=INVALID_HANDLE_VALUE;QWORD position=0,dataOffset=0,bytesPerChannel=0,outputBytesPerChannel=0,length=0,cachedBlock=static_cast<QWORD>(-1);
 DWORD channels=0,rate=0;unsigned tailBits=0;bool lsb=false,dff=false;std::vector<unsigned char> header,cache;std::mutex mutex;
 ~DsfView(){if(handle!=INVALID_HANDLE_VALUE)CloseHandle(handle);}
};
static std::unordered_map<HSTREAM,std::unique_ptr<DsfView>> dsfViews;
static QWORD little64(const unsigned char* value){QWORD n=0;for(int i=7;i>=0;i--)n=(n<<8)|value[i];return n;}
static DWORD little32(const unsigned char* value){return static_cast<DWORD>(little64(std::array<unsigned char,8>{value[0],value[1],value[2],value[3],0,0,0,0}.data()));}
static bool readAt(HANDLE handle,QWORD offset,void* destination,DWORD count) {
 LARGE_INTEGER where{};where.QuadPart=offset;DWORD received=0;
 return SetFilePointerEx(handle,where,nullptr,FILE_BEGIN)&&ReadFile(handle,destination,count,&received,nullptr)&&received==count;
}
static void appendBig(std::vector<unsigned char>& result,QWORD value,int bytes){for(int i=bytes-1;i>=0;i--)result.push_back(static_cast<unsigned char>(value>>(i*8)));}
static std::vector<unsigned char> dffChunk(const char* id,const std::vector<unsigned char>& data) {
 std::vector<unsigned char> result(id,id+4);appendBig(result,data.size(),8);result.insert(result.end(),data.begin(),data.end());if(data.size()%2)result.push_back(0);return result;
}
static QWORD big64(const unsigned char* value){QWORD result=0;for(int i=0;i<8;i++)result=(result<<8)|value[i];return result;}
static void finishDsdView(DsfView& view,bool padDoP,const std::vector<unsigned char>& suppliedChannels={}) {
 view.outputBytesPerChannel=view.bytesPerChannel+(padDoP&&view.bytesPerChannel%2?1:0);
 std::vector<unsigned char> frequency;appendBig(frequency,view.rate,4);
 std::vector<unsigned char> channels=suppliedChannels;
 if(channels.empty()){appendBig(channels,view.channels,2);const std::string names=view.channels==2?"SLFTSRGT":"C   ";channels.insert(channels.end(),names.begin(),names.end());}
 const std::string compression="DSD ";std::vector<unsigned char> cmpr(compression.begin(),compression.end());cmpr.push_back(14);const std::string label="not compressed";cmpr.insert(cmpr.end(),label.begin(),label.end());
 std::vector<unsigned char> properties={'S','N','D',' '};for(const auto& chunk:{dffChunk("FS  ",frequency),dffChunk("CHNL",channels),dffChunk("CMPR",cmpr)})properties.insert(properties.end(),chunk.begin(),chunk.end());
 const auto version=dffChunk("FVER",{1,5,0,0}),prop=dffChunk("PROP",properties);const QWORD bytes=view.outputBytesPerChannel*view.channels;
 const QWORD formBytes=4+version.size()+prop.size()+12+bytes+(bytes%2);
 view.header={'F','R','M','8'};appendBig(view.header,formBytes,8);view.header.insert(view.header.end(),{'D','S','D',' '});view.header.insert(view.header.end(),version.begin(),version.end());view.header.insert(view.header.end(),prop.begin(),prop.end());view.header.insert(view.header.end(),{'D','S','D',' '});appendBig(view.header,bytes,8);
 view.length=view.header.size()+bytes+(bytes%2);view.cache.resize(4096*view.channels);
}
static std::unique_ptr<DsfView> dffDoPView(std::unique_ptr<DsfView> view) {
 std::array<unsigned char,16> form{};LARGE_INTEGER fileSize{};
 if(!readAt(view->handle,0,form.data(),16)||std::memcmp(form.data()+12,"DSD ",4)!=0||!GetFileSizeEx(view->handle,&fileSize))return nullptr;
 const QWORD declared=big64(form.data()+4),available=static_cast<QWORD>(fileSize.QuadPart);
 if(declared<4||available<12||declared>available-12)throw std::runtime_error("Truncated DFF form");
 const QWORD end=declared+12;QWORD dataBytes=0;bool uncompressed=false;std::vector<unsigned char> channels;
 for(QWORD position=16;position+12<=end;) {
   std::array<unsigned char,12> head{};if(!readAt(view->handle,position,head.data(),12))throw std::runtime_error("DFF chunk read failed");
   const QWORD size=big64(head.data()+4),body=position+12;if(size>end-body)throw std::runtime_error("Truncated DFF chunk");
   if(std::memcmp(head.data(),"DSD ",4)==0){if(dataBytes)throw std::runtime_error("Multiple DFF audio chunks are unsupported");view->dataOffset=body;dataBytes=size;}
   if(std::memcmp(head.data(),"PROP",4)==0) {
     std::array<unsigned char,4> type{};if(size<4||!readAt(view->handle,body,type.data(),4)||std::memcmp(type.data(),"SND ",4)!=0)throw std::runtime_error("Invalid DFF sound properties");
     for(QWORD item=body+4;item+12<=body+size;) {
       if(!readAt(view->handle,item,head.data(),12))throw std::runtime_error("DFF property read failed");const QWORD n=big64(head.data()+4),content=item+12;if(n>body+size-content)throw std::runtime_error("Truncated DFF property");
       std::array<unsigned char,16> value{};
       if(std::memcmp(head.data(),"FS  ",4)==0){if(n!=4||!readAt(view->handle,content,value.data(),4))throw std::runtime_error("Invalid DFF frequency");view->rate=(DWORD(value[0])<<24)|(DWORD(value[1])<<16)|(DWORD(value[2])<<8)|value[3];}
       if(std::memcmp(head.data(),"CHNL",4)==0){if(n<6||n>10||!readAt(view->handle,content,value.data(),static_cast<DWORD>(n)))throw std::runtime_error("Unsupported DFF channels");view->channels=(DWORD(value[0])<<8)|value[1];if(view->channels<1||view->channels>2||n!=2+4*view->channels)throw std::runtime_error("Unsupported DFF channel layout");channels.assign(value.begin(),value.begin()+n);}
       if(std::memcmp(head.data(),"CMPR",4)==0){if(n<4||!readAt(view->handle,content,value.data(),4))throw std::runtime_error("Invalid DFF compression");uncompressed=std::memcmp(value.data(),"DSD ",4)==0;}
       if(n>body+size-content-(n%2))throw std::runtime_error("Invalid DFF property alignment");item=content+n+(n%2);
     }
   }
   if(size>end-body-(size%2))throw std::runtime_error("Invalid DFF chunk alignment");position=body+size+(size%2);
 }
 if(!view->rate||!view->channels||!uncompressed||!dataBytes||dataBytes%view->channels)throw std::runtime_error("DoP requires uncompressed mono/stereo DFF");
 view->bytesPerChannel=dataBytes/view->channels;
 if(view->bytesPerChannel%2==0)return nullptr; // The library handles ordinary DFF directly.
 view->dff=true;finishDsdView(*view,true,channels);return view;
}
static std::unique_ptr<DsfView> dsfView(const std::wstring& file,bool padDoP=false) {
 auto view=std::make_unique<DsfView>();view->handle=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
 if(view->handle==INVALID_HANDLE_VALUE)throw std::runtime_error("DSD file could not be opened");
 std::array<unsigned char,80> head{};
 if(!readAt(view->handle,0,head.data(),4))throw std::runtime_error("Incomplete DSD header");
 if(std::string(reinterpret_cast<char*>(head.data()),4)!="DSD "){if(padDoP&&std::memcmp(head.data(),"FRM8",4)==0)return dffDoPView(std::move(view));return nullptr;}
 if(!readAt(view->handle,0,head.data(),80)||little64(head.data()+4)!=28||std::string(reinterpret_cast<char*>(head.data()+28),4)!="fmt ")throw std::runtime_error("Invalid DSF header");
 const QWORD fmtBytes=little64(head.data()+32),samples=little64(head.data()+64);
 view->channels=little32(head.data()+52);view->rate=little32(head.data()+56);const DWORD bits=little32(head.data()+60);
 if(fmtBytes<52||fmtBytes>1048576||little32(head.data()+40)!=1||little32(head.data()+44)!=0||view->channels<1||view->channels>2||!view->rate||(bits!=1&&bits!=8)||little32(head.data()+72)!=4096||!samples||samples>static_cast<QWORD>(-1)-7)throw std::runtime_error("Unsupported DSF layout; mono/stereo uncompressed 4096-byte blocks required");
 std::array<unsigned char,12> data{};if(!readAt(view->handle,28+fmtBytes,data.data(),12)||std::string(reinterpret_cast<char*>(data.data()),4)!="data")throw std::runtime_error("Missing DSF data chunk");
 view->dataOffset=40+fmtBytes;view->bytesPerChannel=(samples+7)/8;view->tailBits=static_cast<unsigned>(samples%8);view->lsb=bits==1;LARGE_INTEGER size{};
 const QWORD blocks=(view->bytesPerChannel+4095)/4096,declared=little64(data.data()+4);
 if(!GetFileSizeEx(view->handle,&size)||view->bytesPerChannel>static_cast<QWORD>(size.QuadPart)||blocks>static_cast<QWORD>(size.QuadPart)/(4096*view->channels)||declared<12||declared-12<blocks*4096*view->channels||view->dataOffset>static_cast<QWORD>(size.QuadPart)||blocks*4096*view->channels>static_cast<QWORD>(size.QuadPart)-view->dataOffset)throw std::runtime_error("Truncated DSF audio blocks");
 finishDsdView(*view,padDoP);return view;
}
static void CALLBACK dsfClose(void* user){auto& view=*static_cast<DsfView*>(user);std::lock_guard<std::mutex> lock(view.mutex);if(view.handle!=INVALID_HANDLE_VALUE){CloseHandle(view.handle);view.handle=INVALID_HANDLE_VALUE;}}
static QWORD CALLBACK dsfLength(void* user){return static_cast<DsfView*>(user)->length;}
static BOOL CALLBACK dsfSeek(QWORD offset,void* user){auto& view=*static_cast<DsfView*>(user);std::lock_guard<std::mutex> lock(view.mutex);if(offset>view.length)return FALSE;view.position=offset;return TRUE;}
static DWORD CALLBACK dsfRead(void* destination,DWORD count,void* user) {
 auto& view=*static_cast<DsfView*>(user);std::lock_guard<std::mutex> lock(view.mutex);DWORD written=0;auto buffer=static_cast<unsigned char*>(destination);
 while(written<count&&view.position<view.length) {
  if(view.position<view.header.size())buffer[written]=view.header[view.position];
  else {
   const QWORD index=view.position-view.header.size(),byte=index/view.channels;
   if(byte>=view.bytesPerChannel)buffer[written]=byte<view.outputBytesPerChannel?0x69:0;
   else {
    const QWORD block=view.dff?index/view.cache.size():byte/4096;
    if(block!=view.cachedBlock){const QWORD offset=view.dff?block*view.cache.size():block*4096*view.channels;const DWORD count=view.dff?static_cast<DWORD>(std::min<QWORD>(view.cache.size(),view.bytesPerChannel*view.channels-offset)):static_cast<DWORD>(view.cache.size());if(!readAt(view.handle,view.dataOffset+offset,view.cache.data(),count))return static_cast<DWORD>(-1);view.cachedBlock=block;}
    unsigned char value=view.cache[view.dff?index%view.cache.size():(index%view.channels)*4096+byte%4096];
    if(view.lsb){value=(value>>4)|(value<<4);value=((value&0xcc)>>2)|((value&0x33)<<2);value=((value&0xaa)>>1)|((value&0x55)<<1);}
    if(view.tailBits&&byte+1==view.bytesPerChannel){const unsigned mask=0xffu<<(8-view.tailBits);value=static_cast<unsigned char>((value&mask)|(0x69u&~mask));}
    buffer[written]=value;
   }
  }
  written++;view.position++;
 }
 return written?written:static_cast<DWORD>(-1);
}
// PCM handles belong to our decoder registry; BASS handles are reserved for DSD.
static std::mutex pcmSourcesMutex;
static std::unordered_map<HSTREAM,std::shared_ptr<rhine::PcmFileDecoder>> pcmSources;
static HSTREAM nextPcmSource=0x80000000u;
static std::wstring codecDirectory;
static std::shared_ptr<rhine::PcmFileDecoder> findPcmSource(HSTREAM handle) {
 std::lock_guard<std::mutex> lock(pcmSourcesMutex);const auto found=pcmSources.find(handle);
 return found==pcmSources.end()?nullptr:found->second;
}
static HSTREAM registerPcmSource(std::shared_ptr<rhine::PcmFileDecoder> source) {
 std::lock_guard<std::mutex> lock(pcmSourcesMutex);
 HSTREAM handle;do{handle=nextPcmSource++;if(!nextPcmSource)nextPcmSource=0x80000000u;}while(!handle||pcmSources.count(handle));
 pcmSources.emplace(handle,std::move(source));return handle;
}
static BOOL sourceGetInfo(HSTREAM handle,BASS_CHANNELINFO* info) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelGetInfo(handle,info);
 const auto& value=decoder->info();*info={};info->freq=value.sampleRate;info->chans=value.channels;info->flags=BASS_SAMPLE_FLOAT|BASS_STREAM_DECODE;
 info->ctype=BASS_CTYPE_STREAM;info->origres=value.bitsPerSample|(value.sourceSampleFormat.rfind("float",0)==0?BASS_ORIGRES_FLOAT:0);return TRUE;
}
static QWORD sourceGetLength(HSTREAM handle,DWORD mode) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelGetLength(handle,mode);
 if(mode!=BASS_POS_BYTE)throw std::runtime_error("Unsupported PCM length unit");return decoder->exactTotalFrames().value_or(decoder->info().totalFrames)*decoder->info().channels*sizeof(float);
}
static QWORD sourceGetPosition(HSTREAM handle,DWORD mode) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelGetPosition(handle,mode);
 if(mode!=BASS_POS_BYTE)throw std::runtime_error("Unsupported PCM position unit");return decoder->positionFrames()*decoder->info().channels*sizeof(float);
}
static double sourceBytes2Seconds(HSTREAM handle,QWORD bytes) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelBytes2Seconds(handle,bytes);
 return static_cast<double>(bytes)/(decoder->info().sampleRate*decoder->info().channels*sizeof(float));
}
static QWORD sourceSeconds2Bytes(HSTREAM handle,double seconds) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelSeconds2Bytes(handle,seconds);
 return static_cast<QWORD>(std::llround(seconds*decoder->info().sampleRate))*decoder->info().channels*sizeof(float);
}
static BOOL sourceSetPosition(HSTREAM handle,QWORD bytes,DWORD mode) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelSetPosition(handle,bytes,mode);
 if(mode!=BASS_POS_BYTE)throw std::runtime_error("Unsupported PCM seek unit");decoder->seek(bytes/(decoder->info().channels*sizeof(float)));return TRUE;
}
static DWORD sourceIsActive(HSTREAM handle) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelIsActive(handle);
 return decoder->atEnd()?BASS_ACTIVE_STOPPED:BASS_ACTIVE_PLAYING;
}
static DWORD sourceGetData(HSTREAM handle,void* output,DWORD bytes) {
 const auto decoder=findPcmSource(handle);if(!decoder)return BASS_ChannelGetData(handle,output,bytes);
 // Legacy Sony pipe intentionally consumes Float32; music playback uses read(double*).
 const size_t channels=decoder->info().channels,frames=bytes/(channels*sizeof(float));std::vector<double> samples(frames*channels);
 const auto block=decoder->read(samples.data(),frames);if(!block.error.empty())throw std::runtime_error(block.error);
 for(size_t i=0;i<block.frames*channels;i++)static_cast<float*>(output)[i]=static_cast<float>(samples[i]);
 return static_cast<DWORD>(block.frames*channels*sizeof(float));
}
static void decoderFormat(HSTREAM handle,json& format,int& rate,int& bits,int& valid,int& container,std::string& precision) {
 const auto decoder=findPcmSource(handle);if(!decoder)return;
 const auto& info=decoder->info();rate=info.sampleRate;bits=info.bitsPerSample;valid=info.validBitsPerSample;container=info.containerBits;precision="float64";
 format["decoderName"]=info.decoderName;format["decodedSampleFormat"]=info.decodedSampleFormat;format["decoderOutputPrecision"]="float64";
 format["sampleRate"]=rate;format["bitsPerSample"]=bits;format["validBitsPerSample"]=valid;format["sampleFormat"]=info.sourceSampleFormat;
 format["decodeMath"]=info.decodeMath;format["exactDecodedInteger"]=info.exactInteger;format["exactFrameCount"]=info.exactFrameCount;
}
static void freeStream(HSTREAM handle){
 std::shared_ptr<rhine::PcmFileDecoder> retired;
 {std::lock_guard<std::mutex> lock(pcmSourcesMutex);const auto found=pcmSources.find(handle);if(found!=pcmSources.end()){retired=std::move(found->second);pcmSources.erase(found);}}
 if(!retired)BASS_StreamFree(handle);dsfViews.erase(handle);
}
static void deferPcmSourceReleaseLocked(RetiredPcmSource&& source) {
 if(!source.stream&&!source.engine&&!source.waveReader&&!source.queuedTrack)return;
 if(retiredPcmSourceCount>=retiredPcmSources.size())throw std::runtime_error("Deferred PCM source release queue is full");
 retiredPcmSources[retiredPcmSourceCount++]=std::move(source);
}
static void collectRetiredPcmSources() {
 std::array<RetiredPcmSource,8> pending{};size_t count=0;
 {
   std::lock_guard<std::mutex> lock(pcmRenderMutex);count=retiredPcmSourceCount;
   for(size_t i=0;i<count;i++)pending[i]=std::move(retiredPcmSources[i]);
   retiredPcmSourceCount=0;
 }
 for(size_t i=0;i<count;i++) {
   if(pending[i].stream)freeStream(pending[i].stream);
   if(pending[i].queuedTrack)pending[i].queuedTrack->stream=0;
   pending[i].engine.reset();pending[i].waveReader.reset();pending[i].queuedTrack.reset();
 }
}
static void CALLBACK growingClose(void* user) {
 auto& file=*static_cast<GrowingFile*>(user);std::lock_guard<std::mutex> lock(file.mutex);
 if(file.handle!=INVALID_HANDLE_VALUE){CloseHandle(file.handle);file.handle=INVALID_HANDLE_VALUE;}
}
static QWORD CALLBACK growingLength(void* user){return static_cast<GrowingFile*>(user)->length;}
static BOOL CALLBACK growingSeek(QWORD offset,void* user) {
 auto& file=*static_cast<GrowingFile*>(user);std::lock_guard<std::mutex> lock(file.mutex);
 if(offset>file.length||file.cancelled)return FALSE;file.position=offset;return TRUE;
}
static DWORD CALLBACK growingRead(void* buffer,DWORD count,void* user) {
 auto& file=*static_cast<GrowingFile*>(user);std::lock_guard<std::mutex> lock(file.mutex);
 // NOBUFFER: zero means temporarily unavailable, -1 means actual EOF.
 // Never wait inside this callback: metadata probes and the audio thread must finish.
 if(file.cancelled||file.position>=file.length)return static_cast<DWORD>(-1);
 LARGE_INTEGER size{};if(file.handle==INVALID_HANDLE_VALUE||!GetFileSizeEx(file.handle,&size)){file.failed=true;return static_cast<DWORD>(-1);}
 if(static_cast<QWORD>(size.QuadPart)<=file.position)return 0;
 const DWORD available=static_cast<DWORD>(std::min<QWORD>(count,std::min<QWORD>(size.QuadPart-file.position,file.length-file.position)));
 LARGE_INTEGER offset{};offset.QuadPart=file.position;DWORD read=0;
 if(!SetFilePointerEx(file.handle,offset,nullptr,FILE_BEGIN)||!ReadFile(file.handle,buffer,available,&read,nullptr)||!read){file.failed=true;return static_cast<DWORD>(-1);}
 file.position+=read;return read;
}

static std::wstring wide(const std::string& value) {
 if(value.find('\0')!=std::string::npos)throw std::runtime_error("Invalid path");
 const int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),nullptr,0);
 if(!size)throw std::runtime_error("Invalid UTF-8");
 std::wstring result(size,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,value.data(),static_cast<int>(value.size()),result.data(),size);return result;
}
static std::string utf8(const wchar_t* value) {
 if(!value)return "";int n=WideCharToMultiByte(CP_UTF8,0,value,-1,nullptr,0,nullptr,nullptr);
 std::string result(n,'\0');WideCharToMultiByte(CP_UTF8,0,value,-1,result.data(),n,nullptr,nullptr);result.pop_back();return result;
}
static HMODULE library(const wchar_t* name) {
 const auto file=directory+L"\\"+name;
 HMODULE dll=LoadLibraryExW(file.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
 if(!dll)throw std::runtime_error("Missing native audio library");return dll;
}
#define LOAD(dll,name) name=reinterpret_cast<decltype(name)>(GetProcAddress(dll,#name)); if(!name)throw std::runtime_error("Missing API: " #name)
static void initialize() {
 wchar_t file[32768];DWORD n=GetModuleFileNameW(nullptr,file,32768);if(!n||n>=32768)throw std::runtime_error("Executable path unavailable");
 directory=std::wstring(file,n);directory.resize(directory.find_last_of(L"\\/"));
 SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32|LOAD_LIBRARY_SEARCH_USER_DIRS);
 const auto bass=library(L"bass.dll"),asiodll=library(L"bassasio.dll"),dsd=library(L"bassdsd.dll");
 LOAD(bass,BASS_Init);LOAD(bass,BASS_Free);LOAD(bass,BASS_GetVersion);LOAD(bass,BASS_ErrorGetCode);LOAD(bass,BASS_SetConfig);
 LOAD(bass,BASS_PluginLoad);LOAD(bass,BASS_StreamCreateFile);LOAD(bass,BASS_StreamCreateFileUser);LOAD(bass,BASS_StreamFree);LOAD(bass,BASS_ChannelGetInfo);
 LOAD(bass,BASS_ChannelGetLength);LOAD(bass,BASS_ChannelGetPosition);LOAD(bass,BASS_ChannelSetPosition);LOAD(bass,BASS_ChannelBytes2Seconds);LOAD(bass,BASS_ChannelSeconds2Bytes);
 LOAD(bass,BASS_ChannelGetData);LOAD(bass,BASS_ChannelIsActive);LOAD(bass,BASS_ChannelGetAttribute);LOAD(bass,BASS_ChannelSetAttribute);
 LOAD(bass,BASS_GetDevice);LOAD(bass,BASS_SetDevice);LOAD(bass,BASS_ChannelPlay);LOAD(bass,BASS_ChannelPause);LOAD(bass,BASS_ChannelStop);
 LOAD(asiodll,BASS_ASIO_GetVersion);LOAD(asiodll,BASS_ASIO_SetUnicode);LOAD(asiodll,BASS_ASIO_GetDeviceInfo);LOAD(asiodll,BASS_ASIO_Init);LOAD(asiodll,BASS_ASIO_Free);
 LOAD(asiodll,BASS_ASIO_ErrorGetCode);LOAD(asiodll,BASS_ASIO_GetInfo);LOAD(asiodll,BASS_ASIO_CheckRate);LOAD(asiodll,BASS_ASIO_SetRate);LOAD(asiodll,BASS_ASIO_GetRate);
 LOAD(asiodll,BASS_ASIO_SetDSD);LOAD(asiodll,BASS_ASIO_ChannelGetInfo);LOAD(asiodll,BASS_ASIO_ChannelEnableBASS);LOAD(asiodll,BASS_ASIO_ChannelSetRate);LOAD(asiodll,BASS_ASIO_ChannelSetVolume);
 LOAD(asiodll,BASS_ASIO_Start);LOAD(asiodll,BASS_ASIO_Stop);LOAD(asiodll,BASS_ASIO_IsStarted);LOAD(asiodll,BASS_ASIO_GetLatency);LOAD(asiodll,BASS_ASIO_SetNotify);
 LOAD(asiodll,BASS_ASIO_ChannelEnable);LOAD(asiodll,BASS_ASIO_ChannelJoin);LOAD(asiodll,BASS_ASIO_ChannelSetFormat);
 LOAD(dsd,BASS_DSD_StreamCreateFile);LOAD(dsd,BASS_DSD_StreamCreateFileUser);
 if(HIWORD(BASS_GetVersion())!=0x204)throw std::runtime_error("Unexpected BASS version");
 if(!BASS_Init(0,44100,0,nullptr,nullptr))throw std::runtime_error("Decoder initialization failed");
 BASS_SetConfig(BASS_CONFIG_DSD_GAIN,0);BASS_ASIO_SetUnicode(TRUE);
 codecDirectory=directory;
 // PCM codecs are libFLAC / FFmpeg. BASS remains only for DSD and ASIO APIs.
}
static void stop() {
 lspTransportPaused=false;
 if(growing)growing->cancelled=true;
 wasapiOutput.reset();collectRetiredPcmSources();wasapiSnapshot={};wasapiDevice="default";wasapiMode="shared";wasapiGain=1.0f;wasapiAllow16=false;dsdRate=0;
 if(asio){requireAsioStopped();stopAsioPcmProducer(asioPcmRenderer.get());if(asioDsdRenderer)asioDsdRenderer->ready.stop();if(!BASS_ASIO_Free()){TerminateProcess(GetCurrentProcess(),ERROR_DEVICE_NOT_AVAILABLE);std::terminate();}asio=false;}
 stopAsioPcmProducer(asioPcmRenderer.get());asioDsdRenderer.reset();asioStartFrames=0;asioNativeCode=0;asioNativeBits=0;asioNativeContainerBits=0;asioNativeFormat.clear();asioNativeAlignment.clear();
 pcmSpectrum.clear(transitionSerial,0);
 asioPcmRenderer.reset();pcmEngine.reset();waveReader.reset();waveInfo={};directWavePcm=false;asioPcmEnded=false;
 asioPcmBuffering=false;
 if(stream){freeStream(stream);stream=0;}
 if(queuedPcmTrack&&queuedPcmTrack->stream){freeStream(queuedPcmTrack->stream);queuedPcmTrack->stream=0;}
 if(growing){growingClose(growing.get());growing.reset();}
 paused=true;ended=false;pausedPosition=0;session.clear();mode="pcm";driverEvent=0;dsdReadFailed=false;endSince={};error.clear();
 sourceRate=0;sourceBits=0;sourceValidBits=0;sourceContainerBits=0;decoderOutputPrecision="float32";outputBits=0;pcmChannels=0;requestedBufferMs=0;requestedReconfigureMs=0;outputRate=0;masterGain=1.0;effectiveOutputFormat="auto";ditherMode="none";currentTrackId.clear();processingSettings=json::object();replayGainMetadata=json::object();sourceFormatMetadata=json::object();processorStageSnapshot=json::array();openRequest=json::object();
 currentDuration=0;currentStartPosition=0;queuedPcmTrack.reset();queueError.clear();transitionPending=false;transitionFadeActive=false;manualTransitionRequested=false;transitionFadeFrames=0;transitionFadeDone=0;transitionRequestedBy.clear();transitionFromTrackId.clear();gapFramesRemaining=0;gapActive=false;activeTrackSerial=transitionSerial;
}
static void check(bool ok,const char* message,bool driver=false) {
 if(!ok)throw std::runtime_error(std::string(message)+" ("+std::to_string(driver?BASS_ASIO_ErrorGetCode():BASS_ErrorGetCode())+")");
}
static bool sameRateFamily(int first,int second) {
 const bool first44=first%11025==0,second44=second%11025==0;
 const bool first48=first%8000==0,second48=second%8000==0;
 return (first44&&second44)||(first48&&second48)||(!first44&&!first48&&!second44&&!second48);
}
static int selectOutputRate(const json& settings,int inputRate) {
 const json resampling=settings.value("resampling",json::object());
 const std::string mode=resampling.value("mode",std::string("follow"));
 if(mode=="follow")return inputRate;
 if(mode!="auto"&&mode!="fixed")throw std::runtime_error("Invalid resampling mode");
 std::vector<int> allowed;
 if(resampling.contains("allowedRates")) {
   if(!resampling["allowedRates"].is_array())throw std::runtime_error("resampling.allowedRates must be an array");
   for(const auto& value:resampling["allowedRates"]) {
     if(!value.is_number_integer())throw std::runtime_error("resampling.allowedRates must contain integer rates");
     const int rate=value.get<int>();if(rate<8000||rate>768000)throw std::runtime_error("resampling.allowedRates contains an invalid rate");
     if(std::find(allowed.begin(),allowed.end(),rate)==allowed.end())allowed.push_back(rate);
   }
 }
 if(mode=="fixed") {
   if(!resampling.contains("rate")||!resampling["rate"].is_number_integer())throw std::runtime_error("Fixed resampling requires an integer rate");
   const int rate=resampling["rate"].get<int>();if(rate<8000||rate>768000)throw std::runtime_error("Fixed resampling rate is outside the supported range");
   if(!allowed.empty()&&std::find(allowed.begin(),allowed.end(),rate)==allowed.end())throw std::runtime_error("Fixed resampling rate is not in allowedRates");
   return rate;
 }
 if(allowed.empty())return inputRate;
 const bool family=resampling.value("family",false);
 int selected=0;long long best=std::numeric_limits<long long>::max();
 for(const int rate:allowed) {
   if(family&&!sameRateFamily(inputRate,rate))continue;
   const long long distance=std::llabs(static_cast<long long>(rate)-inputRate);
   if(distance<best){best=distance;selected=rate;}
 }
 if(!selected)throw std::runtime_error("No allowed output rate matches the source rate family");
 return selected;
}
static void configureProcessing(const json& settings,const json& replayGain,int inRate,int outRate,int channels) {
 if(!settings.is_object())throw std::runtime_error("processing must be an object");
 processingSettings=settings;replayGainMetadata=replayGain.is_object()?replayGain:json::object();
 sourceRate=inRate;pcmChannels=channels;outputRate=outRate;
 const int bits=sourceBits;
 effectiveOutputFormat=settings.value("outputFormat",std::string("auto"));
 if(effectiveOutputFormat!="auto"&&effectiveOutputFormat!="s16"&&effectiveOutputFormat!="s24"&&effectiveOutputFormat!="s32"&&effectiveOutputFormat!="s32v24"&&effectiveOutputFormat!="f32")throw std::runtime_error("Invalid PCM output format");
 if(settings.value("bitPerfect",false)&&effectiveOutputFormat=="auto") {
   if(directWavePcm) {
     if(sourceValidBits==16&&sourceContainerBits==16)effectiveOutputFormat="s16";
     else if(sourceValidBits==24&&sourceContainerBits==24)effectiveOutputFormat="s24";
     else if(sourceValidBits==24&&sourceContainerBits==32)effectiveOutputFormat="s32v24";
     else if(sourceValidBits==32&&sourceContainerBits==32)effectiveOutputFormat="s32";
   } else if(sourceValidBits==16)effectiveOutputFormat="s16";
   else if(sourceValidBits==24)effectiveOutputFormat="s24";
   else if(sourceValidBits==32)effectiveOutputFormat="s32";
 }
 ditherMode=settings.value("dither",std::string("none"));
 if(ditherMode!="none"&&ditherMode!="rectangular"&&ditherMode!="triangular"&&ditherMode!="highpass")throw std::runtime_error("Invalid dither mode");
 requestedBufferMs=settings.value("bufferMs",0);
 if(requestedBufferMs<0||requestedBufferMs>5000)throw std::runtime_error("bufferMs must be between 0 and 5000");
 requestedReconfigureMs=settings.value("reconfigureMs",0);
 if(requestedReconfigureMs<0||requestedReconfigureMs>60000)throw std::runtime_error("reconfigureMs must be between 0 and 60000");
 const json transition=settings.value("transition",json::object());
 const std::string automatic=transition.value("automatic",std::string("gapless")),manual=transition.value("manual",std::string("none"));
 if(automatic!="gapless"&&automatic!="crossfade"&&automatic!="none")throw std::runtime_error("Invalid automatic track transition mode");
 if(manual!="none"&&manual!="short"&&manual!="crossfade")throw std::runtime_error("Invalid manual track transition mode");
 for(const char* key:{"crossfadeMs","manualMs","transportMs","seekMs","preloadMs","gapMs"}) {
   const int value=transition.value(key,0);if(value<0||value>60000)throw std::runtime_error(std::string("transition.")+key+" must be between 0 and 60000");
 }
 for(const char* key:{"transportFade","seekFade"})if(transition.contains(key)&&!transition[key].is_boolean())throw std::runtime_error(std::string("transition.")+key+" must be boolean");
 masterGain=1.0;
 pcmEngine=std::make_unique<rhine::PcmEngine>();pcmEngine->configure(settings,inRate,outRate,channels,replayGainMetadata);
 const double desiredFrames=outRate*static_cast<double>(requestedBufferMs>0?requestedBufferMs:100)/1000.0+4096.0;
 pcmEngine->reserveFrames(static_cast<size_t>(std::clamp(desiredFrames,8192.0,131072.0)));
 processorStageSnapshot=pcmEngine->stages();
}
static rhine::PcmDecodedBlock readPcmFloat(HSTREAM handle,int channels,float* output,size_t frameCapacity,GrowingFile* growingFile) {
 rhine::PcmDecodedBlock result;
 if(!handle){result.error="PCM解码流已关闭";return result;}
 if(growingFile&&growingFile->failed){result.error="Sony渐增PCM缓存读取失败";return result;}
 if(growingFile&&growingFile->cancelled){result.error="Sony渐增PCM读取已取消";return result;}
 if(frameCapacity>std::numeric_limits<DWORD>::max()/(std::max(1,channels)*sizeof(float))){result.error="PCM读入块超出解码器容量";return result;}
 const DWORD requested=static_cast<DWORD>(frameCapacity*static_cast<size_t>(channels)*sizeof(float));
 const DWORD bytes=sourceGetData(handle,output,requested);
 if(growingFile&&growingFile->failed){result.error="Sony渐增PCM缓存读取失败";return result;}
 if(growingFile&&growingFile->cancelled){result.error="Sony渐增PCM读取已取消";return result;}
 if(bytes==static_cast<DWORD>(-1)) {
   const int code=BASS_ErrorGetCode();
   if(code==BASS_ERROR_ENDED) {
     if(growingFile){std::lock_guard<std::mutex> lock(growingFile->mutex);result.buffering=growingFile->position<growingFile->length;result.eof=!result.buffering;}
     else result.eof=true;
   } else result.error="PCM解码失败 (BASS错误 "+std::to_string(code)+")";
   return result;
 }
 if(bytes>requested||bytes%(channels*sizeof(float))!=0){result.error="PCM解码器返回了不完整的帧";return result;}
 result.frames=bytes/static_cast<DWORD>(channels*sizeof(float));result.buffering=result.frames<frameCapacity;
 if(result.frames<frameCapacity) {
   if(growingFile) {
     {std::lock_guard<std::mutex> lock(growingFile->mutex);result.buffering=growingFile->position<growingFile->length;}
     result.eof=!result.buffering&&sourceIsActive(handle)==BASS_ACTIVE_STOPPED;
   } else if(sourceIsActive(handle)==BASS_ACTIVE_STOPPED){result.eof=true;result.buffering=false;}
 }
 return result;
}
static rhine::PcmDecodedBlock readWaveDouble(rhine::WavePcmReader* reader,double* output,size_t frameCapacity) {
 rhine::PcmDecodedBlock result;if(!reader){result.error="WAV PCM reader is not available";return result;}
 const auto read=reader->read(output,frameCapacity);result.frames=read.frames;result.eof=read.eof;result.buffering=read.buffering;result.error=read.error;return result;
}
static rhine::PcmOutputBlock pullPcmHandle(rhine::PcmEngine& engine,HSTREAM handle,int channels,GrowingFile* growingFile,
                                            rhine::WavePcmReader* reader,double* output,size_t capacityFrames) {
 if(const auto source=findPcmSource(handle))return engine.pullDouble(output,capacityFrames,[&](double* decoded,size_t frames){return source->read(decoded,frames);});
 if(reader)return engine.pullDouble(output,capacityFrames,[&](double* decoded,size_t frames){return readWaveDouble(reader,decoded,frames);});
 return engine.pull(output,capacityFrames,[&](float* decoded,size_t frames){return readPcmFloat(handle,channels,decoded,frames,growingFile);});
}
static double pcmTimelinePositionLocked() {
 double decoded=0;
 if(directWavePcm&&waveReader)decoded=static_cast<double>(waveReader->info().positionFrames)/std::max(1,sourceRate);
 else {
   if(!stream)return currentStartPosition;
   const QWORD bytes=sourceGetPosition(stream,BASS_POS_BYTE);
   if(bytes==static_cast<QWORD>(-1))return currentStartPosition;
   decoded=sourceBytes2Seconds(stream,bytes);
 }
 const double buffered=pcmEngine?pcmEngine->bufferedSeconds():0.0;
 const double value=std::max(currentStartPosition,std::isfinite(decoded)?decoded-buffered:currentStartPosition);
 return sourceFormatMetadata.value("exactFrameCount",false)?std::min(value,std::max(currentStartPosition,currentDuration)):value;
}
static double queuedTimelinePositionLocked() {
 if(!queuedPcmTrack)return 0;
 double decoded=0;
 if(queuedPcmTrack->directWave&&queuedPcmTrack->waveReader)decoded=static_cast<double>(queuedPcmTrack->waveReader->info().positionFrames)/std::max(1,queuedPcmTrack->sourceRate);
 else {
   if(!queuedPcmTrack->stream)return 0;
   const QWORD bytes=sourceGetPosition(queuedPcmTrack->stream,BASS_POS_BYTE);
   if(bytes==static_cast<QWORD>(-1))return 0;
   decoded=sourceBytes2Seconds(queuedPcmTrack->stream,bytes);
 }
 const double buffered=queuedPcmTrack->engine?queuedPcmTrack->engine->bufferedSeconds():0.0;
 return std::max(0.0,std::isfinite(decoded)?decoded-buffered:0.0);
}
static size_t durationFrames(double seconds,double sampleRate) {
 if(!std::isfinite(seconds)||!std::isfinite(sampleRate)||seconds<=0.0||sampleRate<=0.0)return 0;
 const long double frames=static_cast<long double>(seconds)*static_cast<long double>(sampleRate);
 if(!std::isfinite(frames)||frames>=static_cast<long double>(std::numeric_limits<long long>::max()))return std::numeric_limits<size_t>::max();
 return static_cast<size_t>(std::max<long long>(0,std::llround(frames)));
}
static rhine::PcmTrackSegment pcmSegment(size_t frames,const std::string& id,uint64_t serial,double duration,double position,
                                          int trackRate,const json& trackFormat,const json& stages,bool transition=false,
                                          const std::string& from={},const std::string& next={}) {
 rhine::PcmTrackSegment segment;segment.frames=frames;segment.trackId=id;segment.transitionSerial=serial;segment.duration=duration;
 segment.positionStart=position;segment.sourceSampleRate=trackRate;segment.sourceFormat=trackFormat;segment.processingStages=stages;
 segment.transitioning=transition;segment.fromTrackId=from;segment.nextTrackId=next;return segment;
}
static void activateQueuedTrackLocked(bool inheritFilterState=false) {
 if(!queuedPcmTrack)throw std::runtime_error("No PCM queue entry is prepared");
 if(inheritFilterState&&pcmEngine&&queuedPcmTrack->engine&&!transitionFadeActive)
   queuedPcmTrack->engine->inheritFilterState(*pcmEngine);
 const uint64_t nextSerial=queuedPcmTrack->transitionSerial;const std::string nextFile=queuedPcmTrack->file;
 if(retiredPcmSourceCount>=retiredPcmSources.size())throw std::runtime_error("Deferred PCM source release queue is full");
 RetiredPcmSource retired;retired.stream=stream;retired.engine=std::move(pcmEngine);retired.waveReader=std::move(waveReader);
 deferPcmSourceReleaseLocked(std::move(retired));
 transitionFromTrackId=currentTrackId;
 stream=queuedPcmTrack->stream;queuedPcmTrack->stream=0;pcmEngine=std::move(queuedPcmTrack->engine);waveReader=std::move(queuedPcmTrack->waveReader);waveInfo=queuedPcmTrack->waveInfo;directWavePcm=queuedPcmTrack->directWave;
 currentTrackId=queuedPcmTrack->trackId;sourceFormatMetadata=queuedPcmTrack->sourceFormat;replayGainMetadata=queuedPcmTrack->replayGain;
 if(directWavePcm&&!waveInfo.growing&&waveInfo.sourceFrameCount)sourceFormatMetadata["exactFrameCount"]=true;
 processorStageSnapshot=queuedPcmTrack->processorStages;sourceRate=queuedPcmTrack->sourceRate;sourceBits=queuedPcmTrack->sourceBits;
 sourceValidBits=queuedPcmTrack->sourceValidBits;sourceContainerBits=queuedPcmTrack->sourceContainerBits;decoderOutputPrecision=sourceFormatMetadata.value("decoderOutputPrecision",directWavePcm?std::string("float64"):std::string("float32"));
 pcmChannels=queuedPcmTrack->channels;outputRate=queuedPcmTrack->outputRate;currentDuration=queuedPcmTrack->duration;currentStartPosition=0;
 activeTrackSerial=nextSerial;transitionPending=true;pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));
 if(openRequest.is_object()) {openRequest["file"]=nextFile;openRequest["trackId"]=currentTrackId;openRequest["replayGain"]=replayGainMetadata;openRequest["sourceFormat"]=sourceFormatMetadata;openRequest["processing"]=processingSettings;openRequest["position"]=0.0;}
 queuedPcmTrack.reset();
}
static void clearQueuedPcmLocked() {
 if(queuedPcmTrack){if(retiredPcmSourceCount>=retiredPcmSources.size())throw std::runtime_error("Deferred PCM source release queue is full");RetiredPcmSource retired;retired.stream=queuedPcmTrack->stream;retired.queuedTrack=std::move(queuedPcmTrack);retired.queuedTrack->stream=0;deferPcmSourceReleaseLocked(std::move(retired));}
 queueError.clear();manualTransitionRequested=false;transitionFadeActive=false;transitionFadeFrames=0;transitionFadeDone=0;transitionRequestedBy.clear();gapFramesRemaining=0;gapActive=false;
}
static bool refreshQueuedExactDurationLocked() {
 if(!queuedPcmTrack)return false;
 auto& next=*queuedPcmTrack;
 if(next.directWave&&!next.waveInfo.growing&&next.waveInfo.sourceFrameCount) {
   next.duration=static_cast<double>(next.waveInfo.sourceFrameCount)/std::max(1,next.sourceRate);
   next.sourceFormat["exactFrameCount"]=true;
 } else if(const auto decoder=findPcmSource(next.stream))if(const auto total=decoder->exactTotalFrames()) {
   next.duration=static_cast<double>(*total)/std::max(1,next.sourceRate);next.sourceFormat["exactFrameCount"]=true;
 }
 return next.sourceFormat.value("exactFrameCount",false);
}
static rhine::PcmOutputBlock readPcm(double* destination,size_t capacityFrames) {
 std::lock_guard<std::mutex> lock(pcmRenderMutex);
 if(!pcmEngine)return {0,false,false,"PCM processing engine is not configured"};
 if(directWavePcm&&!waveInfo.growing&&waveInfo.sourceFrameCount)sourceFormatMetadata["exactFrameCount"]=true;
 if(const auto decoder=findPcmSource(stream))if(const auto total=decoder->exactTotalFrames()){
   currentDuration=static_cast<double>(*total)/std::max(1,sourceRate);sourceFormatMetadata["exactFrameCount"]=true;
 }
 const std::string automatic=processingSettings.value("transition",json::object()).value("automatic",std::string("gapless"));
 const json transition=processingSettings.value("transition",json::object());
 auto currentRead=[&](double* output,size_t frames){return pullPcmHandle(*pcmEngine,stream,pcmChannels,growing.get(),waveReader.get(),output,frames);};
 auto queuedRead=[&](double* output,size_t frames){return pullPcmHandle(*queuedPcmTrack->engine,queuedPcmTrack->stream,queuedPcmTrack->channels,nullptr,queuedPcmTrack->waveReader.get(),output,frames);};
 auto addCurrentSegment=[&](rhine::PcmOutputBlock& block,size_t frames,double start) {
   if(frames)block.segments.push_back(pcmSegment(frames,currentTrackId,activeTrackSerial,currentDuration,start,sourceRate,sourceFormatMetadata,processingStages()));
 };
 if(manualTransitionRequested&&queuedPcmTrack&&transitionFadeFrames==0) {
   manualTransitionRequested=false;transitionPending=true;activateQueuedTrackLocked(true);
   const double start=pcmTimelinePositionLocked();auto block=currentRead(destination,capacityFrames);if(!block.error.empty())return block;
   addCurrentSegment(block,block.frames,start);return block;
 }

 const double blockStart=pcmTimelinePositionLocked();
 const int configuredCrossfadeMs=transition.value("crossfadeMs",0);
 const size_t configuredCrossfadeFrames=configuredCrossfadeMs>0?static_cast<size_t>(std::llround(static_cast<double>(configuredCrossfadeMs)*outputRate/1000.0)):0;
 if(queuedPcmTrack&&!transitionFadeActive&&automatic=="crossfade"&&configuredCrossfadeFrames>0&&sourceFormatMetadata.value("exactFrameCount",false)) {
   const double fadeStart=std::max(0.0,currentDuration-static_cast<double>(configuredCrossfadeFrames)/std::max(1.0,outputRate));
   const double blockEnd=blockStart+static_cast<double>(capacityFrames)/std::max(1.0,outputRate);
   if(blockEnd>=fadeStart) {
     const size_t remaining=currentDuration>0?durationFrames(std::max(0.0,currentDuration-blockStart),outputRate):configuredCrossfadeFrames;
     const size_t queuedFrames=refreshQueuedExactDurationLocked()?durationFrames(queuedPcmTrack->duration,outputRate):configuredCrossfadeFrames;
     transitionFadeFrames=std::min({configuredCrossfadeFrames,remaining,queuedFrames});transitionFadeActive=transitionFadeFrames>0;transitionFadeDone=0;transitionRequestedBy="automatic";
   }
 }
 if(transitionFadeActive&&queuedPcmTrack) {
   manualTransitionRequested=false;
   size_t prefixFrames=0;
   if(transitionRequestedBy=="automatic") {
     const double fadeStart=std::max(0.0,currentDuration-static_cast<double>(transitionFadeFrames)/std::max(1.0,outputRate));
     if(fadeStart>blockStart)prefixFrames=static_cast<size_t>(std::ceil((fadeStart-blockStart)*outputRate));
     prefixFrames=std::min(prefixFrames,capacityFrames);
   }
   rhine::PcmOutputBlock result;
   if(prefixFrames) {
     result=currentRead(destination,prefixFrames);if(!result.error.empty())return result;
     addCurrentSegment(result,result.frames,blockStart);
     if(result.frames<prefixFrames&&!result.eof){result.buffering=true;return result;}
   }
   const size_t available=capacityFrames-result.frames;
   const size_t fadeFrames=std::min(transitionFadeFrames-transitionFadeDone,available);
   if(fadeFrames==0) {
     if(transitionFadeDone>=transitionFadeFrames) {transitionFadeActive=false;transitionFadeDone=0;transitionFadeFrames=0;transitionRequestedBy.clear();}
     return result;
   }
   static std::vector<double> oldFade,nextFade;
   const size_t samples=fadeFrames*static_cast<size_t>(pcmChannels);oldFade.resize(samples);nextFade.resize(samples);
   const double oldStart=pcmTimelinePositionLocked(),nextStart=queuedTimelinePositionLocked();
   const auto oldBlock=currentRead(oldFade.data(),fadeFrames);if(!oldBlock.error.empty())return oldBlock;
   if(oldBlock.frames==0&&oldBlock.eof) {
     transitionFadeActive=false;transitionFadeDone=0;transitionFadeFrames=0;transitionRequestedBy.clear();transitionPending=true;
     activateQueuedTrackLocked(true);
     const size_t remaining=capacityFrames-result.frames;
     if(remaining){const double postStart=pcmTimelinePositionLocked();auto post=currentRead(destination+result.frames*static_cast<size_t>(pcmChannels),remaining);if(!post.error.empty())return post;
       if(post.frames)result.segments.push_back(pcmSegment(post.frames,currentTrackId,activeTrackSerial,currentDuration,postStart,sourceRate,sourceFormatMetadata,processingStages()));
       result.frames+=post.frames;result.eof=post.eof;result.buffering=post.buffering;}
     return result;
   }
   if(oldBlock.frames==0){result.buffering=true;return result;}
   size_t availableOld=std::min(fadeFrames,oldBlock.frames);
   if(oldBlock.eof&&availableOld<fadeFrames)transitionFadeFrames=transitionFadeDone+availableOld;
   const auto nextBlock=queuedRead(nextFade.data(),availableOld);if(!nextBlock.error.empty())return nextBlock;
   size_t blendFrames=std::min(availableOld,nextBlock.frames);
   if(nextBlock.eof&&blendFrames<availableOld)transitionFadeFrames=transitionFadeDone+blendFrames;
   if(blendFrames==0&&nextBlock.eof) {
     std::copy_n(oldFade.data(),availableOld*static_cast<size_t>(pcmChannels),destination+result.frames*static_cast<size_t>(pcmChannels));
     addCurrentSegment(result,availableOld,oldStart);result.frames+=availableOld;result.buffering=oldBlock.buffering;result.eof=oldBlock.eof;
     clearQueuedPcmLocked();queueError="Queued track ended before the configured crossfade could begin";return result;
   }
   for(size_t frame=0;frame<blendFrames;frame++) {
     const double progress=static_cast<double>(transitionFadeDone+frame+1)/std::max<size_t>(1,transitionFadeFrames);
     const double oldGain=std::clamp(1.0-progress,0.0,1.0),nextGain=std::clamp(progress,0.0,1.0);
     for(int channel=0;channel<pcmChannels;channel++) {
       const size_t index=frame*static_cast<size_t>(pcmChannels)+channel;
       destination[(result.frames+frame)*static_cast<size_t>(pcmChannels)+channel]=oldFade[index]*oldGain+nextFade[index]*nextGain;
     }
   }
   const size_t oldTailFrames=availableOld-blendFrames;
   if(oldTailFrames)std::copy_n(oldFade.data()+blendFrames*static_cast<size_t>(pcmChannels),oldTailFrames*static_cast<size_t>(pcmChannels),destination+(result.frames+blendFrames)*static_cast<size_t>(pcmChannels));
   const std::string fromTrack=currentTrackId,nextTrack=queuedPcmTrack->trackId;const uint64_t nextSerial=queuedPcmTrack->transitionSerial;
   const double nextDuration=queuedPcmTrack->duration;const int nextRate=queuedPcmTrack->sourceRate;const json nextFormat=queuedPcmTrack->sourceFormat;
   const json nextStages=queuedTrackStages(true,fromTrack);
   if(blendFrames)result.segments.push_back(pcmSegment(blendFrames,nextTrack,nextSerial,nextDuration,nextStart,nextRate,nextFormat,nextStages,true,fromTrack,nextTrack));
   if(oldTailFrames)result.segments.push_back(pcmSegment(oldTailFrames,fromTrack,activeTrackSerial,currentDuration,oldStart+static_cast<double>(blendFrames)/std::max(1.0,outputRate),sourceRate,sourceFormatMetadata,processingStages(),true,fromTrack,nextTrack));
   result.frames+=availableOld;result.buffering=oldBlock.buffering||nextBlock.buffering;result.eof=false;if(blendFrames)transitionPending=true;
   const size_t newDone=transitionFadeDone+blendFrames;const bool finished=newDone>=transitionFadeFrames;
   transitionFadeDone=newDone;
   if(finished) {
     activateQueuedTrackLocked();transitionFadeActive=false;transitionFadeDone=0;transitionFadeFrames=0;transitionRequestedBy.clear();
     const size_t remaining=capacityFrames-result.frames;
     if(remaining) {
       const double postStart=pcmTimelinePositionLocked();auto post=currentRead(destination+result.frames*static_cast<size_t>(pcmChannels),remaining);
       if(!post.error.empty())return post;
       if(post.frames)result.segments.push_back(pcmSegment(post.frames,currentTrackId,activeTrackSerial,currentDuration,postStart,sourceRate,sourceFormatMetadata,processingStages()));
       result.frames+=post.frames;result.eof=post.eof;result.buffering=result.buffering||post.buffering;
     }
   }
   return result;
 }

 if(queuedPcmTrack&&manualTransitionRequested&&transitionFadeFrames>0) {
   transitionFadeActive=true;transitionFadeDone=0;transitionRequestedBy="manual";
 }
 auto block=currentRead(destination,capacityFrames);if(!block.error.empty())return block;
 const size_t oldFrames=block.frames;addCurrentSegment(block,oldFrames,blockStart);
 const bool immediateManual=queuedPcmTrack&&manualTransitionRequested&&transitionFadeFrames==0;
 const bool gapless=automatic=="gapless"||immediateManual||(automatic=="crossfade"&&(configuredCrossfadeFrames==0||transitionRequestedBy=="automatic"&&transitionFadeFrames==0));
 if(block.eof&&queuedPcmTrack&&gapless) {
   size_t remaining=capacityFrames-oldFrames;
   const int gapMs=automatic=="gapless"?transition.value("gapMs",0):0;
   if(gapMs>0) {
     if(!gapActive){gapActive=true;gapFramesRemaining=static_cast<size_t>(std::llround(static_cast<double>(gapMs)*outputRate/1000.0));}
     const size_t silence=std::min(gapFramesRemaining,remaining);gapFramesRemaining-=silence;remaining-=silence;
     if(oldFrames)block.silenceAfterFirstSegmentFrames=silence;else block.silenceBeforeFirstSegmentFrames=silence;
     block.eof=false;block.buffering=false;
     if(gapFramesRemaining>0||remaining==0)return block;
     gapActive=false;gapFramesRemaining=0;
   }
   manualTransitionRequested=false;transitionPending=true;activateQueuedTrackLocked(true);
   const double nextStart=pcmTimelinePositionLocked();
   if(remaining) {
     auto next=currentRead(destination+oldFrames*static_cast<size_t>(pcmChannels),remaining);if(!next.error.empty())return next;
     if(next.frames)block.segments.push_back(pcmSegment(next.frames,currentTrackId,activeTrackSerial,currentDuration,nextStart,sourceRate,sourceFormatMetadata,processingStages()));
     block.frames=oldFrames+next.frames;block.eof=next.eof;block.buffering=next.buffering;
   } else block.eof=false;
 }
 return block;
}
static void tapPcmSpectrum(const double* samples,const rhine::PcmOutputBlock& block,int channels,int sampleRate,uint64_t fallbackSerial) {
 if(!samples||block.frames==0||!block.error.empty()||channels<1||channels>2||sampleRate<=0)return;
 if(block.segments.empty()){pcmSpectrum.push(samples,block.frames,channels,sampleRate,fallbackSerial);return;}
 size_t offsetFrames=0,coveredFrames=0;const rhine::PcmTrackSegment* latest=nullptr;size_t latestOffset=0;
 for(const auto& segment:block.segments) {
   latest=&segment;latestOffset=offsetFrames;offsetFrames+=segment.frames;coveredFrames+=segment.frames;
 }
 if(!latest||coveredFrames!=block.frames||latest->frames==0)return;
 pcmSpectrum.push(samples+latestOffset*static_cast<size_t>(channels),latest->frames,channels,sampleRate,latest->transitionSerial);
}
static json pcmSpectrumStatus(bool active,int sampleRate,const std::string& inactiveReason={}) {
 const auto snapshot=pcmSpectrum.snapshot(active,sampleRate,inactiveReason);
 json bands=json::array();for(const double value:snapshot.bands)bands.push_back(value);
 json result={{"available",snapshot.available},{"bands",std::move(bands)},{"sampleRate",snapshot.sampleRate},{"stage","pre-volume"}};
 if(snapshot.available) {
   json binsDb=json::array();binsDb.get_ref<json::array_t&>().reserve(snapshot.binCount);
   for(size_t index=0;index<snapshot.binCount&&index<rhine::kPcmSpectrumMaxBins;index++) {
     const double value=snapshot.binsDb[index];
     binsDb.push_back(std::isfinite(value)?value:-240.0);
   }
   result["fftSize"]=snapshot.fftSize;
   result["binHz"]=std::isfinite(snapshot.binHz)&&snapshot.binHz>0.0?snapshot.binHz:0.0;
   result["binsDb"]=std::move(binsDb);
   result["peakDb"]=std::isfinite(snapshot.peakDb)?snapshot.peakDb:-240.0;
   result["rmsDb"]=std::isfinite(snapshot.rmsDb)?snapshot.rmsDb:-240.0;
 }
 if(snapshot.updatedAt)result["updatedAt"]=snapshot.updatedAt;
 if(!snapshot.reason.empty())result["reason"]=snapshot.reason;
 return result;
}
static bool produceAsioPcm(AsioPcmRenderer* renderer) noexcept {
 if(renderer->producerEof.load(std::memory_order_acquire))return false;
 rhine::RtPcmWriteBlock<double> target;
 if(!renderer->ready.tryBeginWrite(target))return false;
 try {
   const auto block=readPcm(target.data,target.capacityFrames);
   if(!block.error.empty())throw std::runtime_error(block.error);
   tapPcmSpectrum(target.data,block,renderer->channels,renderer->sampleRate,activeTrackSerial);
   const size_t before=block.silenceBeforeFirstSegmentFrames,after=block.silenceAfterFirstSegmentFrames;
   const size_t total=before+block.frames+after;
   if(total>target.capacityFrames||block.segments.size()>rhine::kRtPcmMaxSegmentsPerChunk)throw std::runtime_error("ASIO prepared block exceeds its fixed capacity");
   if(!total&&!block.eof){renderer->ready.cancelWrite(target);return false;}
   const size_t first=block.segments.empty()?block.frames:block.segments.front().frames;
   if(after){std::memmove(target.data+(first+after)*renderer->channels,target.data+first*renderer->channels,(block.frames-first)*renderer->channels*sizeof(double));std::fill_n(target.data+first*renderer->channels,after*renderer->channels,0.0);}
   if(before){std::memmove(target.data+before*renderer->channels,target.data,(block.frames+after)*renderer->channels*sizeof(double));std::fill_n(target.data,before*renderer->channels,0.0);}
   rhine::RtPcmChunkInfo info{};info.frames=static_cast<uint32_t>(total);
   info.flags=(block.eof?rhine::RtPcmChunkEof:0)|(block.buffering?rhine::RtPcmChunkBuffering:0);
   size_t offset=before;
   for(size_t i=0;i<block.segments.size();i++) {
     const auto& s=block.segments[i];auto& d=info.segments[info.segmentCount++];
     d.descriptorId=s.transitionSerial+1;d.transitionSerial=s.transitionSerial;d.startPositionSeconds=s.positionStart;d.duration=s.duration;
     d.sourceRate=s.sourceSampleRate;d.timelineRate=renderer->sampleRate;d.offset=static_cast<uint32_t>(offset);d.frames=static_cast<uint32_t>(s.frames);d.flags=s.transitioning?rhine::RtPcmSegmentTransitioning:0;
     offset+=s.frames;if(i==0)offset+=after;
   }
   if(block.frames&&info.segmentCount==0){auto& s=info.segments[info.segmentCount++];s.descriptorId=1;s.frames=static_cast<uint32_t>(block.frames);s.offset=static_cast<uint32_t>(before);s.timelineRate=renderer->sampleRate;s.sourceRate=sourceRate;s.startPositionSeconds=currentStartPosition+static_cast<double>(renderer->producedFrames.load())/renderer->sampleRate;s.duration=currentDuration;}
   if(!renderer->ready.publish(target,info))throw std::runtime_error("Invalid ASIO prepared block metadata");
   renderer->producedFrames.fetch_add(total,std::memory_order_relaxed);
   if(block.eof)renderer->producerEof.store(true,std::memory_order_release);
   return !block.eof;
 }catch(const std::exception& e){renderer->ready.cancelWrite(target);std::strncpy(renderer->errorText.data(),e.what(),renderer->errorText.size()-1);renderer->producerFailed.store(true,std::memory_order_release);return false;}
 catch(...){renderer->ready.cancelWrite(target);renderer->producerFailed.store(true,std::memory_order_release);return false;}
}
static DWORD WINAPI asioPcmProducer(void* value) noexcept {
 auto* renderer=static_cast<AsioPcmRenderer*>(value);
 while(WaitForSingleObject(renderer->producerStop,0)!=WAIT_OBJECT_0&&!renderer->producerFailed.load(std::memory_order_acquire)) {
   if(!produceAsioPcm(renderer)){SetEvent(renderer->producerReady);WaitForSingleObject(renderer->producerStop,2);}
   else if(renderer->ready.queuedFrames()>=renderer->capacityFrames)SetEvent(renderer->producerReady);
 }
 return 0;
}
static void stopAsioPcmProducer(AsioPcmRenderer* renderer) noexcept {
 if(!renderer)return;
 if(renderer->producer){SetEvent(renderer->producerStop);CancelSynchronousIo(renderer->producer);if(WaitForSingleObject(renderer->producer,5000)!=WAIT_OBJECT_0){TerminateProcess(GetCurrentProcess(),ERROR_TIMEOUT);std::terminate();}CloseHandle(renderer->producer);renderer->producer=nullptr;}
 if(renderer->producerStop){CloseHandle(renderer->producerStop);renderer->producerStop=nullptr;}
 if(renderer->producerReady){CloseHandle(renderer->producerReady);renderer->producerReady=nullptr;}
}
static void startAsioPcmProducer(AsioPcmRenderer* renderer) {
 if(!renderer||renderer->producer)return;
 renderer->producerStop=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!renderer->producerStop)throw std::runtime_error("ASIO producer event creation failed");
 renderer->producerReady=CreateEventW(nullptr,TRUE,FALSE,nullptr);if(!renderer->producerReady)throw std::runtime_error("ASIO producer ready event creation failed");
 renderer->producer=CreateThread(nullptr,0,asioPcmProducer,renderer,0,nullptr);if(!renderer->producer)throw std::runtime_error("ASIO producer thread creation failed");
 WaitForSingleObject(renderer->producerReady,500);
 if(renderer->producerFailed.load(std::memory_order_acquire))throw std::runtime_error(renderer->errorText[0]?renderer->errorText.data():"ASIO PCM preparation failed");
}
static void requireAsioStopped() {
 if(!asio)return;
 if(BASS_ASIO_IsStarted()&&!BASS_ASIO_Stop()){TerminateProcess(GetCurrentProcess(),ERROR_DEVICE_NOT_AVAILABLE);std::terminate();}
 if(BASS_ASIO_IsStarted()){TerminateProcess(GetCurrentProcess(),ERROR_DEVICE_NOT_AVAILABLE);std::terminate();}
}
static DWORD CALLBACK asioPcmOutput(BOOL input,DWORD channel,void* buffer,DWORD length,void* user) {
 auto* renderer=static_cast<AsioPcmRenderer*>(user);
 if(!renderer||input||!buffer)return 0;
 if(renderer->callbackBusy.test_and_set(std::memory_order_acquire)){std::memset(buffer,0,length);renderer->fault=2;renderer->failed=true;return length;}
 struct CallbackExit{AsioPcmRenderer* value;~CallbackExit(){value->callbackBusy.clear(std::memory_order_release);}} callbackExit{renderer};
 try {
 if(renderer->failed.load(std::memory_order_acquire)){std::memset(buffer,0,length);return length;}
 const size_t frames=length/renderer->bytesPerSample;const size_t channelIndex=channel-renderer->firstChannel;
 if(channel<renderer->firstChannel||channelIndex>=static_cast<size_t>(renderer->channels)||length%renderer->bytesPerSample){std::memset(buffer,0,length);renderer->failed=true;return length;}
 const unsigned int bit=1u<<channelIndex;const unsigned int all=(1u<<renderer->channels)-1u;
 if(renderer->deliveredMask&bit) {
   renderer->fault=3;renderer->failed.store(true,std::memory_order_release);
   renderer->deliveredMask=0;std::memset(buffer,0,length);return length;
 }
 if(renderer->deliveredMask==0) {
   if(frames>renderer->capacityFrames){renderer->fault=4;renderer->failed=true;std::memset(buffer,0,length);return length;}
   renderer->actualBufferFrames.store(frames,std::memory_order_relaxed);renderer->blockFrames=frames;
   const auto result=renderer->ready.consume(renderer->interleaved.data(),frames,renderer->events.data(),renderer->events.size());
   if(result.underflow)renderer->underflows.fetch_add(1,std::memory_order_relaxed);
   if((renderer->bitPerfect&&result.underflow)||result.eventOverflow||renderer->producerFailed.load(std::memory_order_acquire)){renderer->fault=5;renderer->failed=true;std::fill_n(renderer->interleaved.data(),frames*renderer->channels,0.0);}
   renderer->consumedFrames.fetch_add(result.timelineFrames,std::memory_order_relaxed);
   for(size_t i=0;i<result.eventCount;i++){const auto& event=renderer->events[i];renderer->consumedPosition.store(event.startPositionSeconds+static_cast<double>(event.frames)/renderer->sampleRate,std::memory_order_relaxed);}
   asioPcmBuffering.store(result.buffering&&!result.eof,std::memory_order_relaxed);
   if(result.eof){renderer->eof=true;asioPcmEnded=true;}
   const size_t fadeOutTotal=renderer->fadeOutTotal.load(std::memory_order_relaxed),fadeOutDone=renderer->fadeOutDone.load(std::memory_order_relaxed);
   const size_t fadeInTotal=renderer->fadeInTotal.load(std::memory_order_relaxed),fadeInDone=renderer->fadeInDone.load(std::memory_order_relaxed);
   if(fadeOutTotal||fadeInTotal) {
     for(size_t frame=0;frame<frames;frame++) {
       double gain=1.0;
       if(fadeOutTotal)gain*=std::clamp(1.0-static_cast<double>(fadeOutDone+frame+1)/std::max<size_t>(1,fadeOutTotal),0.0,1.0);
       if(fadeInTotal)gain*=std::clamp(static_cast<double>(fadeInDone+frame+1)/std::max<size_t>(1,fadeInTotal),0.0,1.0);
       for(int channel=0;channel<renderer->channels;channel++)renderer->interleaved[frame*static_cast<size_t>(renderer->channels)+channel]*=gain;
     }
     if(fadeOutTotal) {
       const size_t done=std::min(fadeOutTotal,fadeOutDone+frames);renderer->fadeOutDone.store(done,std::memory_order_relaxed);
       if(done>=fadeOutTotal)renderer->fadeOutComplete.store(true,std::memory_order_release);
     }
     if(fadeInTotal) {
       const size_t done=std::min(fadeInTotal,fadeInDone+frames);renderer->fadeInDone.store(done,std::memory_order_relaxed);
       if(done>=fadeInTotal){renderer->fadeInTotal.store(0,std::memory_order_relaxed);renderer->fadeInDone.store(0,std::memory_order_relaxed);}
     }
   }
 }
 if(renderer->blockFrames!=frames){std::memset(buffer,0,length);renderer->failed=true;return length;}
 renderer->quantizer.writeChannel(buffer,renderer->interleaved.data(),frames,static_cast<int>(channelIndex),renderer->gain.load(std::memory_order_relaxed));
 const auto quantizerStats=renderer->quantizer.stats();
 if(quantizerStats.overRangeSamples>renderer->quantizerStatsSeen.overRangeSamples)
   renderer->overRangeSamples.fetch_add(quantizerStats.overRangeSamples-renderer->quantizerStatsSeen.overRangeSamples,std::memory_order_relaxed);
 if(quantizerStats.clippingSamples>renderer->quantizerStatsSeen.clippingSamples)
   renderer->clippingSamples.fetch_add(quantizerStats.clippingSamples-renderer->quantizerStatsSeen.clippingSamples,std::memory_order_relaxed);
 renderer->bitPerfectCheckedSamples.store(quantizerStats.bitPerfectCheckedSamples,std::memory_order_relaxed);
 renderer->bitPerfectMismatchSamples.store(quantizerStats.bitPerfectMismatchSamples,std::memory_order_relaxed);
 renderer->peakAbs.store(std::max(renderer->peakAbs.load(std::memory_order_relaxed),quantizerStats.peakAbs),std::memory_order_relaxed);
 renderer->quantizerStatsSeen=quantizerStats;
 if(renderer->quantizer.hasError()){renderer->fault=6;renderer->failed.store(true,std::memory_order_release);std::memset(buffer,0,length);}
 renderer->deliveredMask|=bit;if(renderer->deliveredMask==all)renderer->deliveredMask=0;
 return length;
 }catch(...){renderer->fault=7;renderer->failed.store(true,std::memory_order_release);std::memset(buffer,0,length);return length;}
}
static void setAsioFadeIn(int fadeMs) {
 if(!asioPcmRenderer||fadeMs<=0)return;
 const size_t frames=static_cast<size_t>(std::llround(static_cast<double>(fadeMs)*outputRate/1000.0));
 asioPcmRenderer->fadeOutTotal=0;asioPcmRenderer->fadeOutDone=0;asioPcmRenderer->fadeOutComplete=false;
 asioPcmRenderer->fadeInDone=0;asioPcmRenderer->fadeInTotal=frames;
}
static void fadeAsioOut(int fadeMs) {
 if(!asioPcmRenderer||fadeMs<=0||!BASS_ASIO_IsStarted())return;
 const size_t frames=static_cast<size_t>(std::llround(static_cast<double>(fadeMs)*outputRate/1000.0));
 asioPcmRenderer->fadeOutDone=0;asioPcmRenderer->fadeOutComplete=false;asioPcmRenderer->fadeOutTotal=frames;
 const ULONGLONG deadline=GetTickCount64()+static_cast<ULONGLONG>(fadeMs)*3+5000;
 while(!asioPcmRenderer->fadeOutComplete.load(std::memory_order_acquire)) {
   if(asioPcmRenderer->failed.load(std::memory_order_acquire))throw std::runtime_error("ASIO PCM fade could not complete because the render callback failed");
   if(GetTickCount64()>deadline)throw std::runtime_error("ASIO PCM fade timed out");
   Sleep(1);
 }
 const double latencyMs=1000.0*BASS_ASIO_GetLatency(FALSE)/std::max(1.0,outputRate);
 if(latencyMs>0)Sleep(static_cast<DWORD>(std::clamp(std::ceil(latencyMs),1.0,2000.0)));
 asioPcmRenderer->fadeOutTotal=0;asioPcmRenderer->fadeOutDone=0;asioPcmRenderer->fadeOutComplete=false;
}
static void resetAsioPcmStats() {
 if(!asioPcmRenderer)return;
 if(BASS_ASIO_IsStarted())throw std::runtime_error("Stop ASIO before resetting quantizer state");
 asioPcmRenderer->quantizer.reset();asioPcmRenderer->quantizerStatsSeen={};
 asioPcmRenderer->overRangeSamples=0;asioPcmRenderer->clippingSamples=0;asioPcmRenderer->peakAbs=0.0;
}
static rhine::PcmSampleFormat asioPcmFormat(DWORD code) {
 switch(code) {
   case BASS_ASIO_FORMAT_16BIT:return rhine::PcmSampleFormat::Int16;
   case BASS_ASIO_FORMAT_24BIT:return rhine::PcmSampleFormat::Int24;
   case BASS_ASIO_FORMAT_32BIT:return rhine::PcmSampleFormat::Int32;
   case BASS_ASIO_FORMAT_FLOAT:return rhine::PcmSampleFormat::Float32;
   case BASS_ASIO_FORMAT_32BIT16:return rhine::PcmSampleFormat::Int32Valid16;
   case BASS_ASIO_FORMAT_32BIT18:return rhine::PcmSampleFormat::Int32Valid18;
   case BASS_ASIO_FORMAT_32BIT20:return rhine::PcmSampleFormat::Int32Valid20;
   case BASS_ASIO_FORMAT_32BIT24:return rhine::PcmSampleFormat::Int32Valid24;
   default:throw std::runtime_error("ASIO device reports an unsupported PCM format");
 }
}
static DWORD asioPcmCode(rhine::PcmSampleFormat format) {
 switch(format) {
   case rhine::PcmSampleFormat::Int16:return BASS_ASIO_FORMAT_16BIT;
   case rhine::PcmSampleFormat::Int24:return BASS_ASIO_FORMAT_24BIT;
   case rhine::PcmSampleFormat::Int32:return BASS_ASIO_FORMAT_32BIT;
   case rhine::PcmSampleFormat::Float32:return BASS_ASIO_FORMAT_FLOAT;
   case rhine::PcmSampleFormat::Int32Valid16:return BASS_ASIO_FORMAT_32BIT16;
   case rhine::PcmSampleFormat::Int32Valid18:return BASS_ASIO_FORMAT_32BIT18;
   case rhine::PcmSampleFormat::Int32Valid20:return BASS_ASIO_FORMAT_32BIT20;
   case rhine::PcmSampleFormat::Int32Valid24:return BASS_ASIO_FORMAT_32BIT24;
 }
 return BASS_ASIO_FORMAT_FLOAT;
}
static void validateBitPerfect(const json& settings,const std::string& outputBackend,const std::string& wasapiOutputMode,
                               int inRate,int outRate,int channels,int inputBits,const std::string& outputFormat,double gain,
                               const json& replayGain,const json& stages,bool directWave,bool integerWave,int validBits,int containerBits,const std::string& candidateDither) {
 if(!settings.value("bitPerfect",false))return;
 (void)inputBits;
 if(!directWave||!integerWave)throw std::runtime_error("PCM 比特一致性需要可精确保留的 16/24/32 位整数解码路径；当前音源或解码格式不满足条件");
 if(outputBackend=="wasapi"&&wasapiOutputMode!="exclusive")throw std::runtime_error("PCM 比特一致性需要 WASAPI 独占输出，请先开启独占模式");
 if(inRate!=outRate||std::abs(gain-1.0)>1e-12||candidateDither!="none")throw std::runtime_error("Bit-perfect PCM forbids resampling, digital volume, and dither");
 const json transition=settings.value("transition",json::object());
 if((transition.value("automatic",std::string("gapless"))=="crossfade"&&transition.value("crossfadeMs",0)>0)||
    ((transition.value("manual",std::string("none"))=="short"&&transition.value("manualMs",250)>0)||
     (transition.value("manual",std::string("none"))=="crossfade"&&transition.value("crossfadeMs",0)>0))||
    (transition.value("transportFade",false)&&transition.value("transportMs",0)>0)||
    (transition.value("seekFade",false)&&transition.value("seekMs",0)>0))
   throw std::runtime_error("Bit-perfect PCM forbids fades and crossfade mixing");
 if((validBits!=16&&validBits!=24&&validBits!=32)||containerBits<validBits||containerBits>32)
   throw std::runtime_error("PCM 比特一致性不支持此源文件有效位与存储位布局");
 const auto destination=rhine::PcmQuantizer::parse(outputFormat);
 if(outputFormat=="auto"||rhine::PcmQuantizer::floating(destination)||rhine::PcmQuantizer::bits(destination)<validBits)
   throw std::runtime_error("PCM 比特一致性需要有效位不低于音源的整数输出；允许以零填充扩展存储位");
 json analysisSettings=settings;analysisSettings["bitPerfect"]=false;
 rhine::PcmProcessor analysis;analysis.configure(analysisSettings,inRate,channels,replayGain);
 const json evaluatedStages=analysis.stages();
 if(evaluatedStages.is_array())for(const auto& stage:evaluatedStages)if(stage.is_object()&&stage.value("active",false))throw std::runtime_error("Bit-perfect PCM forbids active DSP stages");
 (void)stages;
}
static bool exactIntegerPcmSource() {
 if(directWavePcm)return waveInfo.format==rhine::WaveSampleFormat::PcmInteger&&
   ((sourceValidBits==16&&sourceContainerBits==16)||(sourceValidBits==24&&(sourceContainerBits==24||sourceContainerBits==32))||(sourceValidBits==32&&sourceContainerBits==32));
 return sourceFormatMetadata.value("exactDecodedInteger",false)&&(sourceValidBits==16||sourceValidBits==24||sourceValidBits==32)&&sourceContainerBits>=sourceValidBits&&sourceContainerBits<=32;
}
static void validateProcessingCandidate(const json& settings,const json& replayGain,int inputRate,int channels,double gain) {
 if(!settings.is_object())throw std::runtime_error("processing must be an object");
 const int outputSampleRate=selectOutputRate(settings,inputRate);
 std::string outputFormat=settings.value("outputFormat",std::string("auto"));
 if(outputFormat!="auto"&&outputFormat!="s16"&&outputFormat!="s24"&&outputFormat!="s32"&&outputFormat!="s32v24"&&outputFormat!="f32")throw std::runtime_error("Invalid PCM output format");
 const std::string dither=settings.value("dither",std::string("none"));
 if(dither!="none"&&dither!="rectangular"&&dither!="triangular"&&dither!="highpass")throw std::runtime_error("Invalid dither mode");
 const int bufferMs=settings.value("bufferMs",0),reconfigureMs=settings.value("reconfigureMs",0);
 if(bufferMs<0||bufferMs>5000)throw std::runtime_error("bufferMs must be between 0 and 5000");
 if(reconfigureMs<0||reconfigureMs>60000)throw std::runtime_error("reconfigureMs must be between 0 and 60000");
 const json transition=settings.value("transition",json::object());
 const std::string automatic=transition.value("automatic",std::string("gapless")),manual=transition.value("manual",std::string("none"));
 if(automatic!="gapless"&&automatic!="crossfade"&&automatic!="none")throw std::runtime_error("Invalid automatic track transition mode");
 if(manual!="none"&&manual!="short"&&manual!="crossfade")throw std::runtime_error("Invalid manual track transition mode");
 for(const char* key:{"crossfadeMs","manualMs","transportMs","seekMs","preloadMs","gapMs"}) {
   const int value=transition.value(key,0);if(value<0||value>60000)throw std::runtime_error(std::string("transition.")+key+" must be between 0 and 60000");
 }
 for(const char* key:{"transportFade","seekFade"})if(transition.contains(key)&&!transition[key].is_boolean())throw std::runtime_error(std::string("transition.")+key+" must be boolean");
 rhine::PcmEngine candidate;candidate.configure(settings,inputRate,outputSampleRate,channels,replayGain);
 if(settings.value("bitPerfect",false)) {
   if(outputFormat=="auto") {
     if(directWavePcm&&sourceValidBits==16&&sourceContainerBits==16)outputFormat="s16";
     else if(directWavePcm&&sourceValidBits==24&&sourceContainerBits==24)outputFormat="s24";
     else if(directWavePcm&&sourceValidBits==24&&sourceContainerBits==32)outputFormat="s32v24";
     else if(directWavePcm&&sourceValidBits==32&&sourceContainerBits==32)outputFormat="s32";
     else if(exactIntegerPcmSource())outputFormat=sourceValidBits==16?"s16":sourceValidBits==24?"s24":"s32";
   }
   validateBitPerfect(settings,backend,wasapiMode,inputRate,outputSampleRate,channels,sourceBits,outputFormat,gain,replayGain,candidate.stages(),exactIntegerPcmSource(),exactIntegerPcmSource(),sourceValidBits,sourceContainerBits,dither);
 }
}
static bool effectsOnlyProcessingChange(const json& previous,const json& next) {
 if(!previous.is_object()||!next.is_object())return false;
 // Latency-bearing filters must be rebuilt at the current decoded position so
 // the engine can pre-roll, remove their leading delay and drain their tail.
 // They cannot join the existing zero-latency 10 ms effects crossfade.
 const auto delayedLsp=[](const json& settings) {
   if(settings.value("bitPerfect",false))return false;
   const auto eq=settings.value("eq",json::object());
   return eq.is_object()&&eq.value("enabled",false)&&eq.value("engine",std::string("standard"))=="lsp";
 };
 if(delayedLsp(previous)||delayedLsp(next)) {
   for(const char* key:{"eq","tone","replayGain"})
     if(previous.value(key,json::object())!=next.value(key,json::object()))return false;
 }
 json before=previous,after=next;
 for(const char* key:{"eq","tone","replayGain","float64","transition","reconfigureMs"}){before.erase(key);after.erase(key);}
 return before==after;
}
static json dspSettingsOnly(const json& settings) {
 json result=json::object();
 for(const char* key:{"eq","tone","replayGain"})if(settings.is_object()&&settings.contains(key))result[key]=settings[key];
 return result;
}
static HSTREAM openFile(const json& request,const std::string& requested,bool systemOutput=false) {
 const std::wstring file=wide(request.at("file").get<std::string>());
 if(requested=="pcm"&&!request.value("dsd",false)) {
   if(systemOutput)throw std::runtime_error("PCM playback requires the native output core");
   const std::optional<uint64_t> expected=request.contains("growingBytes")?std::optional<uint64_t>(request.at("growingBytes").get<uint64_t>()):std::nullopt;
   return registerPcmSource(rhine::PcmFileDecoder::open(file,codecDirectory,expected));
 }
 DWORD flags=BASS_UNICODE|(request.value("dsd",false)?0:BASS_ASYNCFILE)|(systemOutput?0:BASS_STREAM_DECODE);
 if(requested=="native")flags|=BASS_DSD_RAW;
 else {flags|=BASS_SAMPLE_FLOAT;if(requested=="dop")flags|=BASS_DSD_DOP;}
 if(request.value("accurate",false)&&!request.value("dsd",false))flags|=BASS_STREAM_PRESCAN;
 HSTREAM result;
 if(request.contains("growingBytes")) {
   if(requested!="pcm"||request.value("dsd",false)||growing)throw std::runtime_error("Invalid progressive PCM input");
   auto state=std::make_unique<GrowingFile>();state->length=request.at("growingBytes").get<QWORD>();
   if(state->length<56||state->length>2000000056ULL)throw std::runtime_error("Invalid progressive PCM length");
   state->handle=CreateFileW(file.c_str(),GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
   if(state->handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Sony progressive PCM is not available");
   growing=std::move(state);const BASS_FILEPROCS callbacks={growingClose,growingLength,growingRead,growingSeek};
   result=BASS_StreamCreateFileUser(STREAMFILE_NOBUFFER,flags&~BASS_UNICODE,&callbacks,growing.get());
 }else if(request.value("dsd",false)) {
   auto view=dsfView(file,requested=="dop");
   if(view){const BASS_FILEPROCS callbacks={dsfClose,dsfLength,dsfRead,dsfSeek};result=BASS_DSD_StreamCreateFileUser(STREAMFILE_NOBUFFER,flags&~BASS_UNICODE,&callbacks,view.get(),44100);if(result)dsfViews.emplace(result,std::move(view));}
   else result=BASS_DSD_StreamCreateFile(BASS_FILE_NAME,file.c_str(),0,0,flags,44100);
 }
 else {
   if(requested!="pcm")throw std::runtime_error("DSD output requires a DSD file");
   result=BASS_StreamCreateFile(BASS_FILE_NAME,file.c_str(),0,0,flags);
 }
 check(result!=0,"File cannot be decoded; uncompressed DSF/DFF required for DSD direct output");return result;
}
static json devices() {
 json list=json::array();BASS_ASIO_DEVICEINFO info{};
 for(DWORD i=0;i<256 && BASS_ASIO_GetDeviceInfo(i,&info);i++)
   list.push_back({{"id",i},{"name",utf8(reinterpret_cast<const wchar_t*>(info.name))}});
 json result={{"available",true},{"devices",list},{"bassVersion",BASS_GetVersion()},{"asioVersion",BASS_ASIO_GetVersion()},{"wasapiAvailable",false},{"wasapiDevices",json::array()}};
 try {
   for(const auto& device:rhine::WasapiOutput::enumerateDevices())result["wasapiDevices"].push_back({{"id",device.id},{"name",device.name},{"isDefault",device.isDefault}});
   result["wasapiAvailable"]=true;
 }catch(const std::exception& e){result["wasapiError"]=e.what();}
 return result;
}
static void CALLBACK notify(DWORD event,void*){driverEvent.store(static_cast<int>(event));}
static void asioDsdIdle(const AsioDsdRenderer& renderer,void* buffer,DWORD length) noexcept {
 if(!renderer.dop){std::memset(buffer,0x69,length);return;}
 rhine::DopPacker idle(static_cast<int>(renderer.channels),static_cast<int>(renderer.sampleBytes*8),renderer.alignment);rhine::DopError error{};
 const size_t frameBytes=renderer.channels*renderer.sampleBytes;idle.fillIdle(static_cast<uint8_t*>(buffer),length/frameBytes,error);
 if(length%frameBytes)std::memset(static_cast<uint8_t*>(buffer)+(length/frameBytes)*frameBytes,0,length%frameBytes);
}
static DWORD CALLBACK dsdOutput(BOOL,DWORD,void* buffer,DWORD length,void* user) {
 auto* renderer=static_cast<AsioDsdRenderer*>(user);if(!renderer||!buffer)return 0;
 if(renderer->busy.test_and_set(std::memory_order_acquire)){asioDsdIdle(*renderer,buffer,length);renderer->fault=1;return length;}
 struct Exit{AsioDsdRenderer* renderer;~Exit(){renderer->busy.clear(std::memory_order_release);}} exit{renderer};
 try {
   const size_t frameBytes=renderer->channels*renderer->sampleBytes,frames=length/frameBytes;
   if(length%frameBytes||frames>renderer->capacityFrames){asioDsdIdle(*renderer,buffer,length);renderer->fault=2;return length;}
   renderer->actualBufferFrames=frames;
   if(renderer->dop) {
     const auto result=renderer->ready.consume(renderer->dopScratch.data(),frames);
     const auto saved=renderer->packer;rhine::DopError packingError{};
     if(result.error||!renderer->packer.pack(renderer->dopScratch.data(),result.frames,static_cast<uint8_t*>(buffer),frames,packingError)) {
       renderer->packer=saved;renderer->packer.fillIdle(static_cast<uint8_t*>(buffer),frames,packingError);renderer->fault=3;
     }
     if(result.eof)renderer->eof=true;
   } else {
     const auto result=renderer->ready.consume(buffer,frames);
     if(result.frames<frames)std::memset(static_cast<uint8_t*>(buffer)+result.frames*frameBytes,0x69,length-result.frames*frameBytes);
     if(result.error)renderer->fault=3;if(result.eof)renderer->eof=true;
   }
   return length;
 }catch(...){asioDsdIdle(*renderer,buffer,length);renderer->fault=4;return length;}
}
static void createWasapiOutput(const BASS_CHANNELINFO& info) {
 rhine::WasapiOutput::ReadFn read=[](void* destination,DWORD capacity) {
   rhine::WasapiRead result{};
   if(!stream){result.error=mode=="dop"?"WASAPI DoP解码流已关闭":"WASAPI PCM解码流已关闭";return result;}
   if(growing&&growing->failed){result.error="Sony渐增PCM缓存读取失败";return result;}
   if(growing&&growing->cancelled){result.error="Sony渐增PCM读取已取消";return result;}
   const DWORD bytes=sourceGetData(stream,destination,capacity);
   if(growing&&growing->failed){result.error="Sony渐增PCM缓存读取失败";return result;}
   if(growing&&growing->cancelled){result.error="Sony渐增PCM读取已取消";return result;}
   if(bytes==static_cast<DWORD>(-1)) {
     const int code=BASS_ErrorGetCode();
     if(code==BASS_ERROR_ENDED) {
       if(growing){std::lock_guard<std::mutex> lock(growing->mutex);result.buffering=growing->position<growing->length;result.eof=!result.buffering;}
       else result.eof=true;
     }
     else result.error=std::string(mode=="dop"?"WASAPI DoP解码失败 (BASS错误 ":"WASAPI PCM解码失败 (BASS错误 ")+std::to_string(code)+")";
     return result;
   }
   if(bytes>capacity){result.error=mode=="dop"?"WASAPI DoP解码器返回了超出请求长度的数据":"WASAPI PCM解码器返回了超出请求长度的数据";return result;}
   result.bytes=bytes;result.buffering=bytes<capacity;return result;
 };
 rhine::WasapiOutput::SeekFn seek=[](double target) {
   std::lock_guard<std::mutex> lock(pcmRenderMutex);
   if(!stream)throw std::runtime_error("WASAPI PCM解码流已关闭");
   check(sourceSetPosition(stream,sourceSeconds2Bytes(stream,target),BASS_POS_BYTE),"Seek failed");
   if(mode=="pcm"&&pcmEngine){
     if(directWavePcm&&waveReader){std::string seekError;if(!waveReader->seek(static_cast<uint64_t>(std::llround(target*sourceRate)),&seekError))throw std::runtime_error(seekError.empty()?"WAV seek failed":seekError);}
     pcmEngine->reset();currentStartPosition=target;clearQueuedPcmLocked();if(transitionPending){transitionSerial=activeTrackSerial;transitionPending=false;}
   }
 };
 rhine::WasapiOutput::PositionFn position=[] {
   std::lock_guard<std::mutex> lock(pcmRenderMutex);
   if(!stream)return pausedPosition;
   if(mode=="pcm")return pcmTimelinePositionLocked();
   const QWORD bytes=sourceGetPosition(stream,BASS_POS_BYTE);
   if(bytes==static_cast<QWORD>(-1))return pausedPosition;
   const double seconds=sourceBytes2Seconds(stream,bytes);
   const double buffered=mode=="pcm"&&pcmEngine?pcmEngine->bufferedSeconds():0.0;
   return std::isfinite(seconds)?std::max(0.0,seconds-buffered):pausedPosition;
 };
 rhine::WasapiOutput::PcmReadFn pcmRead=[](double* destination,DWORD capacityFrames){
   auto block=readPcm(destination,capacityFrames);tapPcmSpectrum(destination,block,pcmChannels,static_cast<int>(outputRate),activeTrackSerial);return block;
 };
 wasapiOutput=std::make_unique<rhine::WasapiOutput>(wasapiDevice,wasapiMode,static_cast<int>(outputRate),static_cast<int>(info.chans),wasapiAllow16,wasapiGain,mode=="dop",dsdRate,std::move(read),std::move(seek),std::move(position),std::move(pcmRead),effectiveOutputFormat,ditherMode,requestedBufferMs,sourceRate,processingSettings.value("bitPerfect",false)?sourceValidBits:0);
 wasapiSnapshot=wasapiOutput->snapshot();
 if(mode=="pcm"&&processingSettings.value("bitPerfect",false))validateBitPerfect(processingSettings,backend,wasapiMode,sourceRate,wasapiSnapshot.sampleRate,pcmChannels,sourceBits,wasapiSnapshot.outputFormat,masterGain,replayGainMetadata,pcmEngine->stages(),exactIntegerPcmSource(),exactIntegerPcmSource(),sourceValidBits,sourceContainerBits,ditherMode);
 if(mode=="pcm"&&pcmEngine)pcmEngine->reserveFrames(static_cast<size_t>(std::max(0.0,wasapiSnapshot.bufferMs*outputRate/1000.0))+256);
 const QWORD bytes=sourceGetLength(stream,BASS_POS_BYTE);const double duration=bytes==static_cast<QWORD>(-1)?0.0:sourceBytes2Seconds(stream,bytes);
 wasapiOutput->setTrackMetadata(currentTrackId,std::isfinite(duration)?duration:0.0,sourceRate,sourceFormatMetadata,mode=="pcm"?processingStages():json::array(),activeTrackSerial,pausedPosition);
 wasapiSnapshot=wasapiOutput->snapshot();
}
static void collectWasapiOutput() {
 if(!wasapiOutput)return;
 wasapiSnapshot=wasapiOutput->snapshot();
 if(!wasapiOutput->finished())return;
 if(wasapiSnapshot.ended){ended=true;paused=true;pausedPosition=wasapiSnapshot.position;}
 if(!wasapiSnapshot.error.empty()){error=wasapiSnapshot.error;paused=true;}
 wasapiOutput.reset();
}
static std::string sourcePrecisionLabel() {
 if(sourceFormatMetadata.contains("sampleFormat")&&sourceFormatMetadata["sampleFormat"].is_string()) {
   const auto format=sourceFormatMetadata["sampleFormat"].get<std::string>();if(format=="float32"||format=="float64")return format;
 }
 if(directWavePcm&&sourceValidBits>0&&sourceValidBits<sourceContainerBits)return "s"+std::to_string(sourceContainerBits)+"v"+std::to_string(sourceValidBits);
 if(sourceFormatMetadata.contains("bitsPerSample")&&sourceFormatMetadata["bitsPerSample"].is_number_integer())return "s"+std::to_string(sourceFormatMetadata["bitsPerSample"].get<int>());
 return "unknown";
}
static json processingStages() {
 json result=json::array();
 const std::string sourcePrecision=sourcePrecisionLabel();
 const std::string decodeReason=sourceFormatMetadata.value("decoderName",directWavePcm?std::string("WAV PCM"):std::string("BASSDSD"))+": "+sourceFormatMetadata.value("decodeMath",std::string("decoder PCM output"));
 result.push_back({{"id","decode"},{"name","PCM decode"},{"inputPrecision",sourceFormatMetadata.value("decodedSampleFormat",sourcePrecision)},{"computePrecision","unknown"},{"outputPrecision",decoderOutputPrecision},{"active",true},{"reason",decodeReason}});
 result.push_back({{"id","float64"},{"name","Float64 core"},{"inputPrecision",decoderOutputPrecision},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",decoderOutputPrecision!="float64"},{"reason",decoderOutputPrecision=="float64"?"Decoder already supplies double-precision samples":"PCM is promoted to double before processing"}});
 json replay=json{{"id","replaygain"},{"name","ReplayGain"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",false},{"reason","Disabled"}};
 json tone=json{{"id","tone"},{"name","Tone controls"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",false},{"reason","Disabled"},{"filters",json::array()}};
 json eq=json{{"id","eq"},{"name","Equalizer"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",false},{"reason","Disabled"},{"filters",json::array()}};
 tone["sampleRate"]=sourceRate;eq["sampleRate"]=sourceRate;
 if(processorStageSnapshot.is_array())for(const auto& stage:processorStageSnapshot)if(stage.is_object()) {
   const std::string id=stage.value("id",std::string());
   if(id=="replaygain")replay=stage;
   else if(id.rfind("tone.",0)==0){tone["filters"].push_back(stage);tone["active"]=tone["active"].get<bool>()||stage.value("active",false);}
   else if(id=="eq.lsp") {
     eq["filters"]=stage.value("filters",json::array());eq["active"]=stage.value("active",false);
     eq["engine"]="lsp";eq["computePrecision"]="float32";eq["latencyFrames"]=stage.value("latencyFrames",size_t(0));
   }
   else if(id.rfind("eq.",0)==0){eq["filters"].push_back(stage);eq["active"]=eq["active"].get<bool>()||stage.value("active",false);}
 }
 if(tone["active"].get<bool>())tone["reason"]="Tone filters are active";
 if(eq["active"].get<bool>())eq["reason"]="Equalizer filters are active";
 result.push_back(replay);result.push_back(tone);result.push_back(eq);
 const bool resampleActive=sourceRate>0&&outputRate>0&&std::abs(outputRate-sourceRate)>.1;
 const std::string engine=processingSettings.value("resampling",json::object()).value("engine",std::string("r8brain"));
 result.push_back({{"id","resample"},{"name","Sample rate conversion"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",resampleActive},{"reason",resampleActive?(engine=="fast"?"Linear interpolation resampling":engine=="soxr"?"SoXrSRC":"r8brain SRC"):"Source and output rates match"},{"engine",engine}});
 if(engine=="soxr"){const auto settings=processingSettings.value("resampling",json::object());result.back()["soxrQuality"]=settings.value("soxrQuality",std::string("vhq"));result.back()["soxrPassband"]=settings.value("soxrPassband",0.97);}
 result.push_back({{"id","mix"},{"name","Track transition mix"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",false},{"reason","No transition mix is active"}});
 result.push_back({{"id","volume"},{"name","Software volume"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision","float64"},{"active",mode=="pcm"&&std::abs(masterGain-1.0)>1e-12},{"reason",mode!="pcm"?"Digital volume is locked for DSD output":"Applied immediately before final output conversion"}});
 std::string actualFormat=effectiveOutputFormat;
 if(backend=="wasapi"&&!wasapiSnapshot.outputFormat.empty())actualFormat=wasapiSnapshot.outputFormat;
 const bool floating=actualFormat=="f32"||actualFormat=="auto";
 result.push_back({{"id","quantize"},{"name","Output format"},{"inputPrecision","float64"},{"computePrecision","float64"},{"outputPrecision",actualFormat},{"active",true},{"reason",floating?"Final conversion to the selected floating-point format":"Final integer quantization"}});
 const bool ditherActive=mode=="pcm"&&ditherMode!="none"&&!floating;
 if(ditherActive)result.back()["dither"]=ditherMode;
 return result;
}
static json queuedTrackStages(bool mixing,const std::string& fromTrackId) {
 if(!queuedPcmTrack)return processingStages();
 const auto savedTrack=currentTrackId;const auto savedSourceRate=sourceRate;const auto savedSourceBits=sourceBits;
 const auto savedFormat=sourceFormatMetadata;const auto savedReplay=replayGainMetadata;const auto savedStages=processorStageSnapshot;
 const auto savedValidBits=sourceValidBits,savedContainerBits=sourceContainerBits;const auto savedDirectWave=directWavePcm;const auto savedWaveInfo=waveInfo;const auto savedDecoder=decoderOutputPrecision;
 currentTrackId=queuedPcmTrack->trackId;sourceRate=queuedPcmTrack->sourceRate;sourceBits=queuedPcmTrack->sourceBits;
 sourceFormatMetadata=queuedPcmTrack->sourceFormat;replayGainMetadata=queuedPcmTrack->replayGain;processorStageSnapshot=queuedPcmTrack->processorStages;
 sourceValidBits=queuedPcmTrack->sourceValidBits;sourceContainerBits=queuedPcmTrack->sourceContainerBits;directWavePcm=queuedPcmTrack->directWave;waveInfo=queuedPcmTrack->waveInfo;decoderOutputPrecision=directWavePcm?"float64":"float32";
 json result=processingStages();
 currentTrackId=savedTrack;sourceRate=savedSourceRate;sourceBits=savedSourceBits;sourceFormatMetadata=savedFormat;replayGainMetadata=savedReplay;processorStageSnapshot=savedStages;
 sourceValidBits=savedValidBits;sourceContainerBits=savedContainerBits;directWavePcm=savedDirectWave;waveInfo=savedWaveInfo;decoderOutputPrecision=savedDecoder;
 if(mixing)for(auto& stage:result)if(stage.is_object()&&stage.value("id",std::string())=="mix") {
   stage["active"]=true;stage["reason"]="Crossfade mix is active";stage["fromTrackId"]=fromTrackId;stage["nextTrackId"]=queuedPcmTrack->trackId;break;
 }
 return result;
}
static json playbackCapabilities() {
 const bool editingLsp=pcmEngine&&pcmEngine->lspPlugin()&&pcmEngine->lspPlugin()->editorOpen();
 const bool pcmAvailable=stream&&backend=="wasapi"&&mode=="pcm"&&!growing&&!openRequest.contains("growingBytes")&&!processingSettings.value("bitPerfect",false)&&!editingLsp;
 const bool processingAvailable=stream&&mode=="pcm";
 const bool bitPerfectSource=stream&&mode=="pcm"&&!growing&&exactIntegerPcmSource()&&
   (backend=="asio"||(backend=="wasapi"&&wasapiMode=="exclusive"));
 bool processingActive=false;
 if(mode=="pcm")for(const auto& stage:processingStages())if(stage.is_object()) {
   const auto id=stage.value("id",std::string());if(id=="replaygain"||id=="tone"||id=="eq"||id=="resample"||id=="mix"||id=="volume")processingActive=processingActive||stage.value("active",false);
 }
 const std::string actualFormat=backend=="wasapi"&&!wasapiSnapshot.outputFormat.empty()?wasapiSnapshot.outputFormat:effectiveOutputFormat;
 if(mode=="pcm"&&ditherMode!="none"&&actualFormat!="f32"&&actualFormat!="auto")processingActive=true;
 return {{"gapless",pcmAvailable},{"crossfade",pcmAvailable&&currentDuration>0},{"manualAdvance",pcmAvailable},{"queue",pcmAvailable},{"bitPerfect",bitPerfectSource},
   {"processing",processingAvailable},{"processingActive",processingActive},{"bitPerfectActive",bitPerfectSource&&processingSettings.value("bitPerfect",false)&&error.empty()&&wasapiSnapshot.error.empty()&&(!asioPcmRenderer||!asioPcmRenderer->failed.load(std::memory_order_acquire))}};
}
static json capabilities(const json& request) {
 if(stream||asio)throw std::runtime_error("Stop playback before querying ASIO capabilities");
 const int device=request.at("device").get<int>();if(device<0||device>255)throw std::runtime_error("Invalid ASIO device");
 check(BASS_ASIO_Init(device,BASS_ASIO_THREAD),"ASIO driver unavailable",true);
 try {
   BASS_ASIO_INFO info{};check(BASS_ASIO_GetInfo(&info),"ASIO information unavailable",true);
   json pcm=json::array(),dsd=json::array(),channels=json::array();
   BASS_ASIO_SetDSD(FALSE);
   for(double rate:{44100.,48000.,88200.,96000.,176400.,192000.,352800.,384000.,705600.,768000.})if(BASS_ASIO_CheckRate(rate))pcm.push_back(rate);
   for(DWORD i=0;i<std::min<DWORD>(info.outputs,32);i++){BASS_ASIO_CHANNELINFO channel{};check(BASS_ASIO_ChannelGetInfo(FALSE,i,&channel),"ASIO channel information unavailable",true);channels.push_back({{"id",i},{"format",channel.format}});}
   const bool nativeDsd=BASS_ASIO_SetDSD(TRUE)!=FALSE;
   if(nativeDsd)for(double rate:{2822400.,5644800.,11289600.,22579200.})if(BASS_ASIO_CheckRate(rate))dsd.push_back(rate);
   BASS_ASIO_SetDSD(FALSE);BASS_ASIO_Free();
   return {{"device",device},{"outputs",info.outputs},{"pcmRates",pcm},{"nativeDsd",nativeDsd},{"dsdRates",dsd},{"channels",channels}};
 }catch(...){BASS_ASIO_SetDSD(FALSE);BASS_ASIO_Free();throw;}
}
static json status() {
 struct PreviewTransportStatus{~PreviewTransportStatus(){lspTransportPaused.store(paused||ended,std::memory_order_release);}} previewTransportStatus;
 if(backend=="wasapi")collectWasapiOutput();
 collectRetiredPcmSources();
 {std::lock_guard<std::mutex> lock(pcmRenderMutex);if(pcmEngine)pcmEngine->collectRetiredEffects();if(queuedPcmTrack&&queuedPcmTrack->engine)queuedPcmTrack->engine->collectRetiredEffects();}
 std::unique_lock<std::mutex> renderLock(pcmRenderMutex);
 if(!stream){json result={{"session",session},{"playing",false},{"paused",true},{"ended",ended},{"position",0},{"duration",0},{"trackId",currentTrackId},{"transitionSerial",transitionSerial},{"capabilities",playbackCapabilities()},{"processingStages",json::array()}};
   result["spectrum"]=pcmSpectrumStatus(false,0,mode=="pcm"?"stopped":"raw DSD/DoP has no PCM spectrum");return result;}
 BASS_CHANNELINFO info{};check(sourceGetInfo(stream,&info),"Stream information unavailable");
 const QWORD length=sourceGetLength(stream,BASS_POS_BYTE);const double streamDuration=length==static_cast<QWORD>(-1)?currentDuration:sourceBytes2Seconds(stream,length);
 const double duration=mode=="pcm"?currentDuration:streamDuration;
 if(backend=="wasapi") {
   if(wasapiSnapshot.transitionSerial>transitionSerial)transitionSerial=wasapiSnapshot.transitionSerial;
   if(transitionPending&&wasapiSnapshot.transitionSerial==activeTrackSerial&&wasapiSnapshot.trackId==currentTrackId&&!wasapiSnapshot.transitioning){transitionPending=false;transitionFromTrackId.clear();}
   if(!wasapiSnapshot.error.empty())error=wasapiSnapshot.error;
   const double displayDuration=wasapiSnapshot.duration>0?wasapiSnapshot.duration:duration;
   const double position=ended?displayDuration:wasapiSnapshot.durationExact?std::clamp(wasapiSnapshot.position,0.0,displayDuration):std::max(0.0,wasapiSnapshot.position);
   const json displayedSource=wasapiSnapshot.sourceFormat.is_object()&&!wasapiSnapshot.sourceFormat.empty()?wasapiSnapshot.sourceFormat:sourceFormatMetadata;
   json result={{"session",session},{"playing",wasapiSnapshot.playing&&!ended},{"paused",wasapiSnapshot.paused||ended},{"ended",ended||wasapiSnapshot.ended},{"buffering",wasapiSnapshot.buffering},{"position",position},{"duration",displayDuration},{"mode",mode},{"backend","wasapi"},{"sampleRate",wasapiSnapshot.sampleRate?wasapiSnapshot.sampleRate:outputRate},{"sourceSampleRate",wasapiSnapshot.sourceSampleRate?wasapiSnapshot.sourceSampleRate:sourceRate?sourceRate:static_cast<int>(info.freq)},{"decoderOutputPrecision",displayedSource.value("decoderOutputPrecision",std::string("unknown"))},{"channels",wasapiSnapshot.channels?wasapiSnapshot.channels:info.chans},{"volumeLocked",mode=="dop"||wasapiSnapshot.volumeLocked||processingSettings.value("bitPerfect",false)},{"deviceId",wasapiSnapshot.deviceId},{"deviceName",wasapiSnapshot.deviceName},{"wasapiMode",wasapiSnapshot.mode},{"sampleFormat",wasapiSnapshot.sampleFormat},{"outputFormat",wasapiSnapshot.outputFormat},{"dither",wasapiSnapshot.dither},{"bufferMs",wasapiSnapshot.bufferMs},{"bitsPerSample",wasapiSnapshot.bitsPerSample},{"mixSampleRate",wasapiSnapshot.mixSampleRate},{"mixSampleFormat",wasapiSnapshot.mixSampleFormat},{"mixBitsPerSample",wasapiSnapshot.mixBitsPerSample},{"sourceFormat",displayedSource},{"processingStages",mode=="pcm"?(wasapiSnapshot.processingStages.is_array()&&!wasapiSnapshot.processingStages.empty()?wasapiSnapshot.processingStages:processingStages()):json::array()},{"trackId",wasapiSnapshot.trackId.empty()?currentTrackId:wasapiSnapshot.trackId},{"transitionSerial",wasapiSnapshot.transitionSerial},{"transitioning",wasapiSnapshot.transitioning},{"transitionStartPending",wasapiSnapshot.transitionStartPending||transitionPending},{"fromTrackId",wasapiSnapshot.fromTrackId},{"nextTrackId",wasapiSnapshot.nextTrackId},{"queuedTrackId",queuedPcmTrack?queuedPcmTrack->trackId:std::string()},{"queueReady",queuedPcmTrack!=nullptr},{"capabilities",playbackCapabilities()},{"error",error}};
   if(transitionPending){if(result["fromTrackId"].get<std::string>().empty())result["fromTrackId"]=transitionFromTrackId;if(result["nextTrackId"].get<std::string>().empty())result["nextTrackId"]=currentTrackId;}
   result["queueError"]=queueError;
   result["durationExact"]=wasapiSnapshot.durationExact;
   result["callbackFormat"]=wasapiSnapshot.callbackFormat;result["callbackContainerBits"]=wasapiSnapshot.callbackContainerBits;result["callbackValidBits"]=wasapiSnapshot.callbackValidBits;result["callbackAlignment"]=wasapiSnapshot.callbackAlignment;
   if(!wasapiSnapshot.driverNativeFormat.empty()){result["driverNativeFormat"]=wasapiSnapshot.driverNativeFormat;result["driverNativeContainerBits"]=wasapiSnapshot.driverNativeContainerBits;result["driverNativeValidBits"]=wasapiSnapshot.driverNativeValidBits;result["driverNativeAlignment"]=wasapiSnapshot.driverNativeAlignment;}
   if(wasapiSnapshot.backendConversion.has_value())result["backendConversion"]=*wasapiSnapshot.backendConversion;
   result["bufferFrames"]=wasapiSnapshot.bufferFrames;result["requestedBufferMs"]=wasapiSnapshot.requestedBufferMs;result["bufferControl"]=wasapiSnapshot.bufferControl;
   result["realtime"]={{"producerQueueFrames",wasapiSnapshot.producerQueueFrames},{"underflows",wasapiSnapshot.underflows},{"callbackFailures",wasapiSnapshot.callbackFailures}};
   const json featureState=playbackCapabilities();result["processing"]=featureState.value("processing",false);result["processingActive"]=featureState.value("processingActive",false);result["bitPerfectActive"]=featureState.value("bitPerfectActive",false);
   result["dspSampleRate"]=wasapiSnapshot.sourceSampleRate?wasapiSnapshot.sourceSampleRate:sourceRate;
   result["decoderName"]=displayedSource.value("decoderName",std::string("BASSDSD"));
   result["decodedSampleFormat"]=displayedSource.value("decodedSampleFormat",std::string());
   result["reconfigureMs"]=requestedReconfigureMs;
   result["stats"]=wasapiSnapshot.stats;
   if(processingSettings.value("bitPerfect",false)) {
     result["bitPerfectCheckedSamples"]=wasapiSnapshot.stats.value("bitPerfectCheckedSamples",uint64_t(0));
     result["bitPerfectMismatchSamples"]=wasapiSnapshot.stats.value("bitPerfectMismatchSamples",uint64_t(0));
   }
   result["overRangeSamples"]=wasapiSnapshot.stats.value("overRangeSamples",uint64_t(0));
   result["clippingSamples"]=wasapiSnapshot.stats.value("clippingSamples",uint64_t(0));
   result["peakAbs"]=wasapiSnapshot.stats.value("peakAbs",0.0);
   if(wasapiSnapshot.validBitsPerSample>0)result["validBitsPerSample"]=wasapiSnapshot.validBitsPerSample;
   if(mode=="dop")result["dsdRate"]=wasapiSnapshot.dsdRate?wasapiSnapshot.dsdRate:dsdRate;
   const int spectrumRate=mode=="pcm"?(wasapiSnapshot.sampleRate?wasapiSnapshot.sampleRate:static_cast<int>(outputRate)):0;
   const bool spectrumActive=mode=="pcm"&&wasapiSnapshot.playing&&!wasapiSnapshot.paused&&!ended&&!wasapiSnapshot.buffering;
   const std::string spectrumReason=mode!="pcm"?"raw DSD/DoP data is not PCM spectrum":ended||wasapiSnapshot.ended?"stopped":wasapiSnapshot.paused?"paused":wasapiSnapshot.buffering?"buffering":"";
   if(renderLock.owns_lock())renderLock.unlock();
   result["spectrum"]=pcmSpectrumStatus(spectrumActive,spectrumRate,spectrumReason);
   return result;
 }
 const auto bytes=sourceGetPosition(stream,BASS_POS_BYTE);
 double decodedPosition=0;
 if(mode=="pcm"&&asioPcmRenderer)decodedPosition=asioPcmRenderer->consumedPosition.load(std::memory_order_relaxed);
 else if(directWavePcm)decodedPosition=pcmTimelinePositionLocked();
 else {decodedPosition=sourceBytes2Seconds(stream,bytes);if(asioDsdRenderer)decodedPosition=std::max(0.0,decodedPosition-static_cast<double>(asioDsdRenderer->ready.queuedFrames())/std::max(1.0,mode=="native"?outputRate/8:outputRate));}
 const bool durationExact=mode!="pcm"||sourceFormatMetadata.value("exactFrameCount",false);
 const double position=ended?duration:paused?pausedPosition:durationExact?std::clamp(decodedPosition,0.0,duration):std::max(0.0,decodedPosition);
 if(driverEvent.exchange(0)) {error="ASIO device changed or requested reset; select the device again";requireAsioStopped();pausedPosition=position;paused=true;}
 if(asioPcmRenderer&&asioPcmRenderer->failed.load(std::memory_order_acquire)) {
   error=asioPcmRenderer->producerFailed.load(std::memory_order_acquire)&&asioPcmRenderer->errorText[0]?std::string(asioPcmRenderer->errorText.data()):"ASIO PCM transport or quantization failed ("+std::to_string(asioPcmRenderer->fault.load())+")";
   if(asio){requireAsioStopped();paused=true;pausedPosition=position;}
 }
 if(asioDsdRenderer&&asioDsdRenderer->fault.load(std::memory_order_acquire)){error="ASIO DSD/DoP transport failed ("+std::to_string(asioDsdRenderer->fault.load())+")";requireAsioStopped();paused=true;pausedPosition=position;}
 if(growing&&growing->failed)error="Sony progressive PCM cache could not be read";
 if(dsdReadFailed)error="Native DSD source could not be read";
 const bool decoderEnded=mode=="pcm"?asioPcmEnded.load():asioDsdRenderer?asioDsdRenderer->eof.load(std::memory_order_acquire):sourceIsActive(stream)==BASS_ACTIVE_STOPPED;
 if(!paused&&!ended&&decoderEnded) {
   const auto now=Clock::now();if(endSince==Clock::time_point{})endSince=now;
   const double dataRate=mode=="native"?outputRate/8:outputRate;
   const double waitMs=asio?std::clamp(50+2000*BASS_ASIO_GetLatency(FALSE)/std::max(1.0,dataRate),50.0,1500.0):0;
   if(std::chrono::duration<double,std::milli>(now-endSince).count()>=waitMs){ended=true;paused=true;if(asio)requireAsioStopped();}
 }
 double reportedPosition=position;
 if(mode=="pcm"&&pcmEngine&&!paused)reportedPosition=std::max(0.0,reportedPosition-static_cast<double>(asio?BASS_ASIO_GetLatency(FALSE):0)/std::max(1.0,outputRate));
 json result={{"session",session},{"playing",!paused&&!ended},{"paused",paused},{"ended",ended},{"buffering",!paused&&(mode=="pcm"?asioPcmBuffering.load():sourceIsActive(stream)==BASS_ACTIVE_STALLED)},{"position",ended?duration:reportedPosition},{"duration",duration},{"mode",mode},{"backend",backend},{"sampleRate",outputRate},{"sourceSampleRate",sourceRate?sourceRate:static_cast<int>(info.freq)},{"decoderOutputPrecision",decoderOutputPrecision},{"channels",info.chans},{"volumeLocked",mode!="pcm"||processingSettings.value("bitPerfect",false)},{"outputFormat",effectiveOutputFormat},{"dither",ditherMode},{"bufferMs",asio?1000.0*BASS_ASIO_GetLatency(FALSE)/std::max(1.0,outputRate):0},{"sourceFormat",sourceFormatMetadata},{"processingStages",mode=="pcm"?processingStages():json::array()},{"trackId",currentTrackId},{"transitionSerial",transitionSerial},{"capabilities",playbackCapabilities()},{"error",error}};
 const json featureState=playbackCapabilities();result["processing"]=featureState.value("processing",false);result["processingActive"]=featureState.value("processingActive",false);result["bitPerfectActive"]=featureState.value("bitPerfectActive",false);
 result["dspSampleRate"]=sourceRate;
 result["decoderName"]=sourceFormatMetadata.value("decoderName",std::string("BASSDSD"));
 result["decodedSampleFormat"]=sourceFormatMetadata.value("decodedSampleFormat",std::string());
 result["reconfigureMs"]=requestedReconfigureMs;
 const json stats=asioPcmRenderer?json{{"overRangeSamples",asioPcmRenderer->overRangeSamples.load(std::memory_order_relaxed)},{"clippingSamples",asioPcmRenderer->clippingSamples.load(std::memory_order_relaxed)},{"peakAbs",asioPcmRenderer->peakAbs.load(std::memory_order_relaxed)}}:json{{"overRangeSamples",0},{"clippingSamples",0},{"peakAbs",0.0}};
 result["stats"]=stats;result["overRangeSamples"]=stats["overRangeSamples"];result["clippingSamples"]=stats["clippingSamples"];result["peakAbs"]=stats["peakAbs"];
 if(processingSettings.value("bitPerfect",false)&&asioPcmRenderer) {
   result["bitPerfectCheckedSamples"]=asioPcmRenderer->bitPerfectCheckedSamples.load(std::memory_order_relaxed);
   result["bitPerfectMismatchSamples"]=asioPcmRenderer->bitPerfectMismatchSamples.load(std::memory_order_relaxed);
 }
 result["durationExact"]=durationExact;
 result["callbackFormat"]=mode=="pcm"?effectiveOutputFormat:mode=="dop"?"dop":"dsd-msb";
 result["callbackContainerBits"]=mode=="pcm"?asioNativeContainerBits:mode=="dop"?asioNativeContainerBits:8;
 result["callbackValidBits"]=mode=="pcm"?asioNativeBits:mode=="dop"?24:1;
 result["callbackAlignment"]=mode=="native"?"dsd":asioNativeAlignment;
 result["driverNativeFormat"]=asioNativeFormat;result["driverNativeContainerBits"]=asioNativeContainerBits;result["driverNativeValidBits"]=asioNativeBits;result["driverNativeAlignment"]=asioNativeAlignment;
 result["backendConversion"]=mode=="native"&&asioNativeCode!=BASS_ASIO_FORMAT_DSD_MSB;
 const size_t actualFrames=asioPcmRenderer?asioPcmRenderer->actualBufferFrames.load():asioDsdRenderer?asioDsdRenderer->actualBufferFrames.load():0;
 result["bufferFrames"]=actualFrames?actualFrames:asioStartFrames;result["requestedBufferMs"]=requestedBufferMs;result["bufferControl"]=asioStartFrames?"application":"driver";
 result["realtime"]={{"producerQueueFrames",asioPcmRenderer?asioPcmRenderer->ready.queuedFrames():asioDsdRenderer?asioDsdRenderer->ready.queuedFrames():0},{"underflows",asioPcmRenderer?asioPcmRenderer->underflows.load():asioDsdRenderer?asioDsdRenderer->ready.underflows():0},{"callbackFailures",asioPcmRenderer?(asioPcmRenderer->failed.load()?1:0):asioDsdRenderer?(asioDsdRenderer->fault.load()?1:0):0}};
 if(asioNativeContainerBits>0){result["bitsPerSample"]=asioNativeContainerBits;result["validBitsPerSample"]=asioNativeBits;}
 if(mode!="pcm")result["dsdRate"]=dsdRate;
 const bool spectrumActive=mode=="pcm"&&!paused&&!ended&&!asioPcmBuffering.load(std::memory_order_relaxed);
 const std::string spectrumReason=mode!="pcm"?"raw DSD/DoP data is not PCM spectrum":ended?"stopped":paused?"paused":asioPcmBuffering.load(std::memory_order_relaxed)?"buffering":"";
 result["spectrum"]=pcmSpectrumStatus(spectrumActive,mode=="pcm"?static_cast<int>(outputRate):0,spectrumReason);
 return result;
}
static json open(json request) {
 bool restoreEditor=false;
 const auto requestedProcessing=request.value("processing",json::object());
 const auto requestedEq=requestedProcessing.value("eq",json::object());
 if(request.value("mode",std::string("pcm"))=="pcm"&&requestedEq.value("engine",std::string())=="lsp") {
   std::lock_guard<std::mutex> lock(pcmRenderMutex);
   auto* previous=pcmEngine?pcmEngine->lspPlugin():nullptr;
   const auto requestedState=requestedEq.value("lsp",json::object()).value("pluginState",std::string());
   if(previous) {
     const auto known=processingSettings.value("eq",json::object()).value("lsp",json::object()).value("pluginState",std::string());
     restoreEditor=previous->editorOpen();
     if(requestedState==known)request["processing"]["eq"]["lsp"]["pluginState"]=previous->editor("state").at("pluginState");
   } else if(lspIdleEditor&&lspIdleEditor->editorOpen()) {
     restoreEditor=true;
     if(requestedState==lspIdleState)request["processing"]["eq"]["lsp"]["pluginState"]=lspIdleEditor->editor("state").at("pluginState");
     lspIdleEditor->editor("close");
   }
 }
 const auto restoreLspEditor=[&]{
   if(!restoreEditor)return;
   if(pcmEngine&&pcmEngine->lspPlugin())pcmEngine->lspPlugin()->editor("open");
   else {
     const auto settings=request.value("processing",json::object()).value("eq",json::object()).value("lsp",json::object());
     lspIdleEditor=std::make_unique<rhine::LspPluginEq>(settings,48000,2,false);
     lspIdleState=settings.value("pluginState",std::string());lspIdleEditor->editor("open");
   }
 };
 stop();mode=request.value("mode",std::string("pcm"));
 backend=request.value("backend",std::string("asio"));if(backend!="asio"&&backend!="wasapi")throw std::runtime_error("Invalid native output backend");
 if(mode!="pcm"&&mode!="native"&&mode!="dop")throw std::runtime_error("Invalid output mode");
 try {
   if(backend=="wasapi") {
     wasapiDevice=request.value("wasapiDevice",std::string("default"));wasapiMode=request.value("wasapiMode",std::string("shared"));
     if(wasapiDevice.empty()||wasapiDevice.size()>2048||wasapiDevice.find('\0')!=std::string::npos||wasapiDevice.find_first_of("\r\n")!=std::string::npos)throw std::runtime_error("Invalid WASAPI device ID");
     if(wasapiMode!="shared"&&wasapiMode!="exclusive")throw std::runtime_error("Invalid WASAPI output mode");
     if(mode=="native")throw std::runtime_error("WASAPI does not support native DSD output");
     if(mode=="dop"&&(!request.value("dsd",false)||wasapiMode!="exclusive"||request.contains("growingBytes")))
       throw std::runtime_error("WASAPI DoP requires a DSD source, exclusive mode, and a complete local source file");
   }else check(BASS_SetDevice(0),"Decoder device unavailable");
   json decoderRequest=request;
   if(mode=="pcm"&&!request.contains("growingBytes")&&!request.value("dsd",false))decoderRequest["accurate"]=true;
   stream=openFile(decoderRequest,mode);
   BASS_CHANNELINFO info{};check(sourceGetInfo(stream,&info),"Stream information unavailable");
   if(info.chans<1||info.chans>2)throw std::runtime_error("Native output currently supports mono/stereo");
   waveReader.reset();waveInfo={};directWavePcm=false;decoderOutputPrecision="float32";
   if(mode=="pcm"&&!request.contains("growingBytes")&&!findPcmSource(stream)) {
     std::string waveError;waveReader=rhine::WavePcmReader::tryOpen(wide(request.at("file").get<std::string>()),{},&waveError);
     if(waveReader){waveInfo=waveReader->info();directWavePcm=true;decoderOutputPrecision="float64";}
     else if(waveError.rfind("invalid WAV:",0)==0||waveError.rfind("I/O:",0)==0)throw std::runtime_error(waveError);
   }
   sourceFormatMetadata=request.value("sourceFormat",json::object());if(!sourceFormatMetadata.is_object())sourceFormatMetadata=json::object();
   sourceFormatMetadata["exactDecodedInteger"]=false;
   sourceRate=directWavePcm?static_cast<int>(waveInfo.sampleRate):static_cast<int>(info.freq);sourceBits=directWavePcm?static_cast<int>(waveInfo.bitsPerSample):static_cast<int>(info.origres&0xffff);
   sourceContainerBits=directWavePcm?static_cast<int>(waveInfo.bitsPerSample):sourceBits;
   sourceValidBits=directWavePcm?static_cast<int>(waveInfo.validBitsPerSample):sourceBits;
   if(directWavePcm&&waveInfo.channels!=static_cast<uint32_t>(info.chans))throw std::runtime_error("WAV and native decoder channel counts differ");
   if(sourceFormatMetadata.contains("bitsPerSample")&&sourceFormatMetadata["bitsPerSample"].is_number_integer())sourceBits=sourceFormatMetadata["bitsPerSample"].get<int>();
   if(!sourceFormatMetadata.contains("sampleRate"))sourceFormatMetadata["sampleRate"]=sourceRate;
   if(!sourceFormatMetadata.contains("bitsPerSample")&&sourceBits>0)sourceFormatMetadata["bitsPerSample"]=sourceBits;
   if(!sourceFormatMetadata.contains("sampleFormat")&&(info.origres&BASS_ORIGRES_FLOAT))sourceFormatMetadata["sampleFormat"]="float32";
   if(directWavePcm) {
     sourceFormatMetadata["sampleRate"]=sourceRate;sourceFormatMetadata["bitsPerSample"]=waveInfo.bitsPerSample;sourceFormatMetadata["validBitsPerSample"]=waveInfo.validBitsPerSample;
     sourceFormatMetadata["decodeMath"]=waveInfo.decodeMath==rhine::WaveDecodeMath::Pcm8UnsignedMidpoint?"pcm8-unsigned-midpoint":
       waveInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerNormalized?"signed-integer-normalized":
       waveInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerLeftAlignedValidBits?"signed-integer-left-aligned-valid-bits":
       waveInfo.decodeMath==rhine::WaveDecodeMath::IeeeFloat32Widened?"ieee-float32-widened":"ieee-float64-copied";
     sourceFormatMetadata["sampleFormat"]=waveInfo.format==rhine::WaveSampleFormat::PcmInteger?"pcm":waveInfo.format==rhine::WaveSampleFormat::IeeeFloat32?"float32":"float64";
   }
   if(request.contains("growingBytes")) {
     sourceBits=sourceContainerBits=sourceValidBits=32;decoderOutputPrecision="float32";
     sourceFormatMetadata["sampleRate"]=info.freq;sourceFormatMetadata["bitsPerSample"]=32;sourceFormatMetadata["validBitsPerSample"]=32;
     sourceFormatMetadata["sampleFormat"]="float32";sourceFormatMetadata["decodeMath"]="sony-prepared-float32";
   }
   decoderFormat(stream,sourceFormatMetadata,sourceRate,sourceBits,sourceValidBits,sourceContainerBits,decoderOutputPrecision);
   sourceFormatMetadata["decoderOutputPrecision"]=decoderOutputPrecision;
   currentTrackId=request.value("trackId",std::string());
   const double position=request.value("position",0.0);if(!std::isfinite(position)||position<0)throw std::runtime_error("Invalid seek position");
   if(position>0)check(sourceSetPosition(stream,sourceSeconds2Bytes(stream,position),BASS_POS_BYTE),"Seek failed");
   if(directWavePcm&&position>0){std::string seekError;if(!waveReader->seek(static_cast<uint64_t>(std::llround(position*sourceRate)),&seekError))throw std::runtime_error(seekError.empty()?"WAV seek failed":seekError);}
   {const QWORD length=sourceGetLength(stream,BASS_POS_BYTE);const double value=directWavePcm?waveInfo.durationSeconds:(length==static_cast<QWORD>(-1)?0.0:sourceBytes2Seconds(stream,length));currentDuration=std::isfinite(value)?value:0.0;currentStartPosition=position;activeTrackSerial=transitionSerial;}
   if(mode=="pcm") {
     processingSettings=request.value("processing",json::object());replayGainMetadata=request.value("replayGain",json::object());
     const int targetRate=selectOutputRate(processingSettings,sourceRate);
     configureProcessing(processingSettings,replayGainMetadata,sourceRate,targetRate,static_cast<int>(info.chans));
     masterGain=request.value("volume",1.0);
     if(!std::isfinite(masterGain)||masterGain<0||masterGain>1)throw std::runtime_error("Invalid volume");
     asioPcmEnded=false;
   } else {
     processingSettings=json::object();replayGainMetadata=request.value("replayGain",json::object());pcmEngine.reset();
     masterGain=1.0;outputRate=info.freq;effectiveOutputFormat="auto";ditherMode="none";requestedBufferMs=0;
   }
   if(backend=="wasapi") {
     const DWORD originalBits=info.origres&0xffff;wasapiAllow16=!request.contains("growingBytes")&&!(info.origres&BASS_ORIGRES_FLOAT)&&originalBits>0&&originalBits<=16;
     if(mode=="dop") {
       float rawRate=0;check(BASS_ChannelGetAttribute(stream,BASS_ATTRIB_DSD_RATE,&rawRate),"DSD rate unavailable");
       if(!std::isfinite(rawRate)||rawRate<=0||rawRate>100000000||std::abs(rawRate/16.0-info.freq)>.1)throw std::runtime_error("DoP source carrier rate is unavailable or inconsistent");
       dsdRate=static_cast<int>(std::llround(rawRate));wasapiGain=1.0f;wasapiAllow16=false;
     }else {
       wasapiGain=masterGain;
       dsdRate=0;
       validateBitPerfect(processingSettings,backend,wasapiMode,sourceRate,static_cast<int>(outputRate),pcmChannels,sourceBits,effectiveOutputFormat,masterGain,replayGainMetadata,pcmEngine->stages(),exactIntegerPcmSource(),exactIntegerPcmSource(),sourceValidBits,sourceContainerBits,ditherMode);
     }
     if(requestedReconfigureMs>0)Sleep(static_cast<DWORD>(requestedReconfigureMs));
     session=request.at("session").get<std::string>();pausedPosition=position;paused=true;ended=false;error.clear();createWasapiOutput(info);openRequest=request;restoreLspEditor();return status();
   }
   const int device=request.at("device").get<int>();outputChannel=request.value("channel",0u);
   if(device<0||device>255||outputChannel>255)throw std::runtime_error("Invalid ASIO device/channel");
   if(requestedReconfigureMs>0)Sleep(static_cast<DWORD>(requestedReconfigureMs));
   check(BASS_ASIO_Init(device,BASS_ASIO_THREAD),"ASIO driver unavailable",true);asio=true;
   BASS_ASIO_INFO driver{};check(BASS_ASIO_GetInfo(&driver),"ASIO information unavailable",true);
   if(outputChannel+info.chans>driver.outputs)throw std::runtime_error("ASIO output channel pair unavailable");
   if(mode=="native") {
     check(BASS_ASIO_SetDSD(TRUE),"Device/driver does not support native DSD",true);
     float rate=0;check(BASS_ChannelGetAttribute(stream,BASS_ATTRIB_DSD_RATE,&rate),"DSD rate unavailable");outputRate=rate;
   } else {BASS_ASIO_SetDSD(FALSE);outputRate=mode=="pcm"?selectOutputRate(processingSettings,static_cast<int>(info.freq)):info.freq;}
   check(BASS_ASIO_CheckRate(outputRate),"Device does not support the exact output rate",true);
   check(BASS_ASIO_SetRate(outputRate),"Device could not set the exact output rate",true);
   if(std::abs(BASS_ASIO_GetRate()-outputRate)>.1)throw std::runtime_error("Device changed the requested rate; resampling is disabled");
   check(BASS_ASIO_GetInfo(&driver),"ASIO buffer limits unavailable",true);
   asioStartFrames=rhine::asioBufferFrames(outputRate,mode=="pcm"?requestedBufferMs:0,driver.bufmin,driver.bufmax,driver.bufpref,driver.bufgran);
   BASS_ASIO_CHANNELINFO nativeChannel{};check(BASS_ASIO_ChannelGetInfo(FALSE,outputChannel,&nativeChannel),"ASIO native output format unavailable",true);
   asioNativeCode=static_cast<int>(nativeChannel.format);
   for(DWORD i=1;i<info.chans;i++){BASS_ASIO_CHANNELINFO next{};check(BASS_ASIO_ChannelGetInfo(FALSE,outputChannel+i,&next),"ASIO output format unavailable",true);if(next.format!=nativeChannel.format)throw std::runtime_error("Selected ASIO channels have different native formats");}
   const size_t asioBufferCapacity=asioStartFrames?asioStartFrames:driver.bufpref;
   if(!asioBufferCapacity||asioBufferCapacity>1048576)throw std::runtime_error("ASIO buffer exceeds the supported preallocated capacity");
   if(mode=="native"||mode=="dop") {
     if(mode=="dop"&&nativeChannel.format!=BASS_ASIO_FORMAT_24BIT&&nativeChannel.format!=BASS_ASIO_FORMAT_32BIT&&nativeChannel.format!=BASS_ASIO_FORMAT_32BIT24)
       throw std::runtime_error("ASIO DoP requires a transparent 24-bit or 32-bit integer driver format; floating-point native output is not used for DoP");
     const int container=mode=="native"?8:nativeChannel.format==BASS_ASIO_FORMAT_24BIT?24:32;
     const auto alignment=nativeChannel.format==BASS_ASIO_FORMAT_32BIT24?rhine::DopAlignment::RightAligned:rhine::DopAlignment::LeftAligned;
     asioDsdRenderer=std::make_unique<AsioDsdRenderer>(static_cast<int>(info.chans),container,alignment,mode=="dop");
     asioDsdRenderer->capacityFrames=asioBufferCapacity;asioDsdRenderer->dopScratch.resize(mode=="dop"?asioBufferCapacity*info.chans:0);
     const double transportRate=mode=="native"?outputRate/8:outputRate;
     const size_t sourceFrameBytes=info.chans*(mode=="dop"?sizeof(float):1);
     const size_t queueFrames=std::min<size_t>(16777216/sourceFrameBytes,std::max<size_t>(asioBufferCapacity*3,static_cast<size_t>(transportRate*.15)));
     const HSTREAM dsdSource=stream;
     asioDsdRenderer->ready.configure(info.chans*(mode=="dop"?sizeof(float):1),queueFrames,[dsdSource](uint8_t* target,size_t capacity){
       rhine::RtDsdBuffer::SourceRead value;const DWORD bytes=BASS_ChannelGetData(dsdSource,target,static_cast<DWORD>(capacity));
       if(bytes==static_cast<DWORD>(-1)){const int code=BASS_ErrorGetCode();if(code==BASS_ERROR_ENDED)value.eof=true;else value.error=code?code:ERROR_READ_FAULT;}
       else{value.bytes=bytes;value.eof=BASS_ChannelIsActive(dsdSource)==BASS_ACTIVE_STOPPED;value.buffering=bytes<capacity&&!value.eof;}return value;
     });
     asioDsdRenderer->ready.start();
     check(BASS_ASIO_ChannelEnable(FALSE,outputChannel,dsdOutput,asioDsdRenderer.get()),"DSD channel setup failed",true);
     for(DWORD i=1;i<info.chans;i++)check(BASS_ASIO_ChannelJoin(FALSE,outputChannel+i,outputChannel),"Native DSD stereo setup failed",true);
     check(BASS_ASIO_ChannelSetFormat(FALSE,outputChannel,mode=="native"?BASS_ASIO_FORMAT_DSD_MSB:nativeChannel.format),"DSD transport format unavailable",true);
     if(mode=="dop")check(BASS_ASIO_ChannelSetRate(FALSE,outputChannel,outputRate),"DoP carrier sample rate setup failed",true);
     float actualDsdRate=0;check(BASS_ChannelGetAttribute(stream,BASS_ATTRIB_DSD_RATE,&actualDsdRate),"DSD source rate unavailable");dsdRate=static_cast<int>(std::llround(actualDsdRate));
     asioNativeFormat=mode=="native"?"dsd":nativeChannel.format==BASS_ASIO_FORMAT_24BIT?"s24":nativeChannel.format==BASS_ASIO_FORMAT_32BIT24?"s32v24":"s32";
     asioNativeBits=mode=="native"?1:nativeChannel.format==BASS_ASIO_FORMAT_32BIT?32:24;asioNativeContainerBits=container;
     asioNativeAlignment=mode=="native"?"dsd":container==24?"packed":alignment==rhine::DopAlignment::RightAligned?"right":"left";
   }else {
     BASS_ASIO_CHANNELINFO channelInfo{};check(BASS_ASIO_ChannelGetInfo(FALSE,outputChannel,&channelInfo),"ASIO output format unavailable",true);
     rhine::PcmSampleFormat selectedFormat;
     if(processingSettings.value("bitPerfect",false)||effectiveOutputFormat=="auto") {
       selectedFormat=asioPcmFormat(channelInfo.format);
       for(DWORD i=1;i<info.chans;i++) {
         BASS_ASIO_CHANNELINFO next{};check(BASS_ASIO_ChannelGetInfo(FALSE,outputChannel+i,&next),"ASIO output format unavailable",true);
         if(next.format!=channelInfo.format)throw std::runtime_error("Selected ASIO channel pair has different native formats");
       }
     } else {selectedFormat=rhine::PcmQuantizer::parse(effectiveOutputFormat);if(asioPcmCode(selectedFormat)!=nativeChannel.format)throw std::runtime_error("The requested ASIO PCM format differs from the driver-native format; select Auto or the native format to avoid an additional conversion");}
     asioNativeFormat=rhine::PcmQuantizer::name(asioPcmFormat(nativeChannel.format));asioNativeBits=rhine::PcmQuantizer::bits(selectedFormat);asioNativeContainerBits=rhine::PcmQuantizer::containerBits(selectedFormat);
     asioNativeAlignment=selectedFormat==rhine::PcmSampleFormat::Float32?"float":selectedFormat==rhine::PcmSampleFormat::Int24?"packed":asioNativeBits<asioNativeContainerBits?"right":"left";
     outputBits=rhine::PcmQuantizer::bits(selectedFormat);effectiveOutputFormat=rhine::PcmQuantizer::name(selectedFormat);
     asioPcmRenderer=std::make_unique<AsioPcmRenderer>();asioPcmRenderer->firstChannel=outputChannel;asioPcmRenderer->channels=static_cast<int>(info.chans);
     asioPcmRenderer->bytesPerSample=static_cast<size_t>(rhine::PcmQuantizer::containerBits(selectedFormat)/8);asioPcmRenderer->gain=masterGain;
     validateBitPerfect(processingSettings,backend,wasapiMode,sourceRate,static_cast<int>(outputRate),pcmChannels,sourceBits,effectiveOutputFormat,masterGain,replayGainMetadata,pcmEngine->stages(),exactIntegerPcmSource(),exactIntegerPcmSource(),sourceValidBits,sourceContainerBits,ditherMode);
     asioPcmRenderer->capacityFrames=asioBufferCapacity;asioPcmRenderer->sampleRate=static_cast<int>(outputRate);asioPcmRenderer->bitPerfect=processingSettings.value("bitPerfect",false);
     asioPcmRenderer->interleaved.resize(asioBufferCapacity*info.chans);asioPcmRenderer->ready.configure(info.chans,asioBufferCapacity,std::min<size_t>(4096,asioBufferCapacity),3);asioPcmRenderer->events.resize(asioPcmRenderer->ready.maxConsumeEvents());
     asioPcmRenderer->quantizer.configure(selectedFormat,ditherMode,static_cast<int>(info.chans),processingSettings.value("bitPerfect",false)?sourceValidBits:0,rhine::PcmPackingAlignment::RightAligned);
     asioPcmRenderer->consumedPosition=position;startAsioPcmProducer(asioPcmRenderer.get());
     for(DWORD i=0;i<info.chans;i++) {
       check(BASS_ASIO_ChannelEnable(FALSE,outputChannel+i,asioPcmOutput,asioPcmRenderer.get()),"ASIO PCM callback setup failed",true);
       check(BASS_ASIO_ChannelSetFormat(FALSE,outputChannel+i,asioPcmCode(selectedFormat)),"ASIO output format is unsupported",true);
     }
     asioPcmEnded=false;
   }
   check(BASS_ASIO_ChannelSetVolume(FALSE,-1,1.0f),"ASIO output volume setup failed",true);
   BASS_ASIO_SetNotify(notify,nullptr);driverEvent=0;
   session=request.at("session").get<std::string>();pausedPosition=position;paused=true;ended=false;error.clear();openRequest=request;restoreLspEditor();return status();
 }catch(...){stop();throw;}
}
static json queuePcmTrack(const json& request) {
 {std::lock_guard<std::mutex> lock(pcmRenderMutex);if(pcmEngine&&pcmEngine->lspPlugin()&&pcmEngine->lspPlugin()->editorOpen())throw std::runtime_error("Close the LSP editor before preloading another track");}
 if(processingSettings.value("bitPerfect",false))throw std::runtime_error("PCM 比特一致性使用逐曲原样输出，不预加载或混合其他曲目");
 if(mode!="pcm"||backend!="wasapi")throw std::runtime_error("PCM queue is available only for WASAPI PCM playback");
 if(growing||request.contains("growingBytes")||request.value("dsd",false))throw std::runtime_error("DSD and progressive PCM tracks cannot be queued");
 if(wasapiOutput&&wasapiOutput->finished())throw std::runtime_error("The output session has ended; open the next track directly");
 const json nextProcessing=request.value("processing",processingSettings);
 if(!nextProcessing.is_object()||nextProcessing!=processingSettings)throw std::runtime_error("Queued track processing must match the active output configuration");
 double activeDuration=0;
 {std::lock_guard<std::mutex> lock(pcmRenderMutex);if(queuedPcmTrack||transitionPending||transitionFadeActive)throw std::runtime_error("A queued track or transition is already pending");activeDuration=currentDuration;}
 const json queueTransition=nextProcessing.value("transition",json::object());
 const std::string automaticMode=queueTransition.value("automatic",std::string("gapless")),manualMode=queueTransition.value("manual",std::string("none"));
 const int configuredCrossfadeMs=queueTransition.value("crossfadeMs",0),configuredManualMs=queueTransition.value("manualMs",250);
 const bool needsAutomaticFade=automaticMode=="crossfade"&&configuredCrossfadeMs>0;
 const bool needsManualFade=(manualMode=="short"&&configuredManualMs>0)||((manualMode=="crossfade")&&configuredCrossfadeMs>0);
 if((needsAutomaticFade||needsManualFade)&&(!std::isfinite(activeDuration)||activeDuration<=0.0))
   throw std::runtime_error("Crossfade queue requires a known current-track duration; use serial advance instead");
 HSTREAM nextStream=0;
 try {
   json nextRequest={{"file",request.at("file")},{"dsd",false},{"accurate",true}};
   nextStream=openFile(nextRequest,"pcm");
   BASS_CHANNELINFO info{};check(sourceGetInfo(nextStream,&info),"Queued PCM stream information unavailable");
   std::unique_ptr<rhine::WavePcmReader> nextWave;rhine::WaveInfo nextWaveInfo{};std::string waveError;
   if(!findPcmSource(nextStream))nextWave=rhine::WavePcmReader::tryOpen(wide(request.at("file").get<std::string>()),{},&waveError);
   if(!nextWave&&(waveError.rfind("invalid WAV:",0)==0||waveError.rfind("I/O:",0)==0))throw std::runtime_error(waveError);
   if(nextWave)nextWaveInfo=nextWave->info();
   const int nextRate=nextWave?static_cast<int>(nextWaveInfo.sampleRate):static_cast<int>(info.freq);
   const int nextChannels=nextWave?static_cast<int>(nextWaveInfo.channels):static_cast<int>(info.chans);
   if(nextChannels!=pcmChannels)throw std::runtime_error("Queued PCM channel count must match the active track");
   const int targetRate=selectOutputRate(nextProcessing,nextRate);
   if(targetRate!=static_cast<int>(outputRate))throw std::runtime_error("Queued PCM output rate differs from the active track; gapless transition is unavailable");
   const QWORD length=sourceGetLength(nextStream,BASS_POS_BYTE);
   const double duration=nextWave?nextWaveInfo.durationSeconds:(length==static_cast<QWORD>(-1)?0.0:sourceBytes2Seconds(nextStream,length));
   if(!std::isfinite(duration)||duration<=0)throw std::runtime_error("Queued PCM duration is invalid");
   auto prepared=std::make_unique<QueuedPcmTrack>();prepared->stream=nextStream;prepared->file=request.at("file").get<std::string>();
   prepared->waveReader=std::move(nextWave);prepared->waveInfo=nextWaveInfo;prepared->directWave=prepared->waveReader!=nullptr;
   prepared->trackId=request.at("trackId").get<std::string>();if(prepared->trackId.empty()||prepared->trackId.size()>256)throw std::runtime_error("Invalid queued track ID");
   prepared->sourceFormat=request.value("sourceFormat",json::object());if(!prepared->sourceFormat.is_object())prepared->sourceFormat=json::object();
   prepared->sourceFormat["exactDecodedInteger"]=false;
   prepared->sourceRate=nextRate;prepared->sourceBits=prepared->directWave?static_cast<int>(nextWaveInfo.bitsPerSample):static_cast<int>(info.origres&0xffff);
   prepared->sourceValidBits=prepared->directWave?static_cast<int>(nextWaveInfo.validBitsPerSample):prepared->sourceBits;prepared->sourceContainerBits=prepared->directWave?static_cast<int>(nextWaveInfo.bitsPerSample):prepared->sourceBits;
   prepared->channels=nextChannels;prepared->outputRate=targetRate;prepared->duration=duration;
   if(prepared->sourceFormat.contains("bitsPerSample")&&prepared->sourceFormat["bitsPerSample"].is_number_integer())prepared->sourceBits=prepared->sourceFormat["bitsPerSample"].get<int>();
   if(!prepared->sourceFormat.contains("sampleRate"))prepared->sourceFormat["sampleRate"]=prepared->sourceRate;
   if(!prepared->sourceFormat.contains("bitsPerSample")&&prepared->sourceBits>0)prepared->sourceFormat["bitsPerSample"]=prepared->sourceBits;
   if(prepared->directWave){
     prepared->sourceFormat["bitsPerSample"]=nextWaveInfo.bitsPerSample;prepared->sourceFormat["validBitsPerSample"]=nextWaveInfo.validBitsPerSample;
     prepared->sourceFormat["decodeMath"]=nextWaveInfo.decodeMath==rhine::WaveDecodeMath::Pcm8UnsignedMidpoint?"pcm8-unsigned-midpoint":
       nextWaveInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerNormalized?"signed-integer-normalized":
       nextWaveInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerLeftAlignedValidBits?"signed-integer-left-aligned-valid-bits":
       nextWaveInfo.decodeMath==rhine::WaveDecodeMath::IeeeFloat32Widened?"ieee-float32-widened":"ieee-float64-copied";
     prepared->sourceFormat["sampleFormat"]=nextWaveInfo.format==rhine::WaveSampleFormat::PcmInteger?"pcm":nextWaveInfo.format==rhine::WaveSampleFormat::IeeeFloat32?"float32":"float64";
   }
   if(nextProcessing.value("bitPerfect",false)) {
     if(!prepared->directWave||nextWaveInfo.format!=rhine::WaveSampleFormat::PcmInteger)throw std::runtime_error("Bit-perfect queue requires an integer PCM WAV source");
     std::string expected;
     if(nextWaveInfo.validBitsPerSample==16&&nextWaveInfo.bitsPerSample==16)expected="s16";
     else if(nextWaveInfo.validBitsPerSample==24&&nextWaveInfo.bitsPerSample==24)expected="s24";
     else if(nextWaveInfo.validBitsPerSample==24&&nextWaveInfo.bitsPerSample==32)expected="s32v24";
     else if(nextWaveInfo.validBitsPerSample==32&&nextWaveInfo.bitsPerSample==32)expected="s32";
     if(expected.empty()||effectiveOutputFormat!=expected)throw std::runtime_error("Bit-perfect queued WAV must match the active integer output format");
   }
   prepared->sourceFormat["decoderOutputPrecision"]=prepared->directWave?"float64":"float32";
   std::string nextPrecision=prepared->directWave?"float64":"float32";
   decoderFormat(nextStream,prepared->sourceFormat,prepared->sourceRate,prepared->sourceBits,prepared->sourceValidBits,prepared->sourceContainerBits,nextPrecision);
   prepared->replayGain=request.value("replayGain",json::object());if(!prepared->replayGain.is_object())prepared->replayGain=json::object();
   prepared->processing=nextProcessing;prepared->engine=std::make_unique<rhine::PcmEngine>();prepared->engine->configure(nextProcessing,prepared->sourceRate,targetRate,prepared->channels,prepared->replayGain);prepared->engine->reserveFrames(65536);
   prepared->processorStages=prepared->engine->stages();
   const std::string preparedTrackId=prepared->trackId;const double preparedDuration=prepared->duration;const int preparedOutputRate=prepared->outputRate;
   {
     std::lock_guard<std::mutex> lock(pcmRenderMutex);
     if(queuedPcmTrack||transitionPending||transitionFadeActive)throw std::runtime_error("A queued track or transition is already pending");
     if(!stream||ended)throw std::runtime_error("The active output session cannot accept a queue entry");
     prepared->transitionSerial=activeTrackSerial+1;queuedPcmTrack=std::move(prepared);queueError.clear();nextStream=0;
   }
   return {{"queued",true},{"trackId",preparedTrackId},{"duration",preparedDuration},{"outputRate",preparedOutputRate}};
 }catch(...) {if(nextStream)freeStream(nextStream);throw;}
}
static void requestManualAdvance() {
 if(mode!="pcm"||backend!="wasapi")throw std::runtime_error("Manual advance is available only for WASAPI PCM playback");
 const json transition=processingSettings.value("transition",json::object());
 const std::string manual=transition.value("manual",std::string("none"));
 if(manual=="none")throw std::runtime_error("Manual transition is disabled in the current settings");
 std::lock_guard<std::mutex> lock(pcmRenderMutex);
 if(!queuedPcmTrack)throw std::runtime_error("No next track is queued");
 if(transitionPending||transitionFadeActive)throw std::runtime_error("A track transition is already in progress");
 const int fadeMs=manual=="short"?transition.value("manualMs",250):transition.value("crossfadeMs",0);
 if(fadeMs<0||fadeMs>60000)throw std::runtime_error("Manual transition duration is invalid");
 manualTransitionRequested=true;transitionRequestedBy="manual";
 transitionFadeFrames=durationFrames(static_cast<double>(fadeMs)/1000.0,outputRate);
 if(sourceFormatMetadata.value("exactFrameCount",false)&&currentDuration>0)transitionFadeFrames=std::min(transitionFadeFrames,durationFrames(std::max(0.0,currentDuration-pcmTimelinePositionLocked()),outputRate));
 if(refreshQueuedExactDurationLocked())transitionFadeFrames=std::min(transitionFadeFrames,durationFrames(queuedPcmTrack->duration,outputRate));
 transitionFadeDone=0;
 transitionFadeActive=transitionFadeFrames>0;
}
static void clearPcmQueue() {
 std::lock_guard<std::mutex> lock(pcmRenderMutex);
 if(transitionPending||transitionFadeActive)throw std::runtime_error("The queued track has entered the transition buffer and cannot be cleared");
 clearQueuedPcmLocked();
}
static std::string bytesHex(const unsigned char* data,size_t count) {
 std::string hex;hex.reserve(count*2);const char* digits="0123456789abcdef";
 for(size_t i=0;i<count;i++){hex+=digits[data[i]>>4];hex+=digits[data[i]&15];}
 return hex;
}
static int requestedDopBits(const json& request) {
 if(!request.contains("packDopBits")||!request["packDopBits"].is_number_integer())throw std::runtime_error("packDopBits must be 24 or 32");
 const int bits=request["packDopBits"].get<int>();if(bits!=24&&bits!=32)throw std::runtime_error("packDopBits must be 24 or 32");return bits;
}
static DWORD requestedPaddingFrames(const json& request,const char* key="paddingFrames") {
 if(!request.contains(key))return 0;
 if(!request[key].is_number_unsigned()&&!request[key].is_number_integer())throw std::runtime_error(std::string(key)+" must be an integer");
 const auto count=request[key].get<int64_t>();if(count<0||count>4096)throw std::runtime_error(std::string(key)+" exceeds the 4096-frame bound");return static_cast<DWORD>(count);
}
static json packedDop(const float* source,DWORD sourceBytes,int channels,int bits,DWORD paddingFrames,
                      DWORD leadingIdleFrames,int sampleRate,int rawDsdRate,DWORD chunkFrames=0) {
 if(channels<1||channels>2||sourceBytes%(channels*sizeof(float))!=0)throw std::runtime_error("DoP source is not a complete mono/stereo float frame sequence");
 const DWORD sourceFrames=sourceBytes/static_cast<DWORD>(channels*sizeof(float));
 const size_t sampleBytes=static_cast<size_t>(bits/8),frameBytes=static_cast<size_t>(channels)*sampleBytes;
 const size_t outputFrames=static_cast<size_t>(leadingIdleFrames)+sourceFrames+paddingFrames;
 std::vector<unsigned char> packed(outputFrames*frameBytes);
 rhine::DopPacker packer(channels,bits);std::string packError;
 if(!packer.fillIdle(packed.data(),leadingIdleFrames,packError))throw std::runtime_error(packError);
 auto* destination=packed.empty()?nullptr:packed.data()+static_cast<size_t>(leadingIdleFrames)*frameBytes;
 if(!sourceFrames) {
   if(!packer.pack(source,0,destination,paddingFrames,packError))throw std::runtime_error(packError);
 }else {
   DWORD offset=0;const DWORD chunkLimit=chunkFrames?chunkFrames:sourceFrames;
   while(offset<sourceFrames) {
     const DWORD count=std::min(chunkLimit,sourceFrames-offset);const bool last=offset+count==sourceFrames;
     auto* chunkDestination=destination+static_cast<size_t>(offset)*frameBytes;
     if(!packer.pack(source+static_cast<size_t>(offset)*channels,count,chunkDestination,
                     static_cast<size_t>(count)+(last?paddingFrames:0),packError))throw std::runtime_error(packError);
     offset+=count;
   }
 }
 return {{"packedHex",bytesHex(packed.data(),packed.size())},{"packedBytes",packed.size()},
         {"payloadFrames",sourceFrames},{"leadingIdleFrames",leadingIdleFrames},{"paddingFrames",paddingFrames},
         {"frameCount",outputFrames},{"packDopBits",bits},{"bitsPerSample",bits},{"channels",channels},{"chunkFrames",chunkFrames},
         {"sampleRate",sampleRate},{"dsdRate",rawDsdRate},{"sampleFormat","pcm"},{"validBitsPerSample",24}};
}
static json inspect(const json& request) {
 if(stream)throw std::runtime_error("Stop output before inspection");
 const auto requested=request.value("mode",std::string("pcm"));
 const bool packRequested=request.contains("packDopBits");
 if((packRequested||request.contains("paddingFrames"))&&(requested!="dop"||!request.value("dsd",false)))
   throw std::runtime_error("DoP packing inspection requires a closed DSD DoP decode stream");
 if(request.contains("paddingFrames")&&!packRequested)throw std::runtime_error("paddingFrames requires packDopBits");
 const int packBits=packRequested?requestedDopBits(request):0;
 const DWORD paddingFrames=packRequested?requestedPaddingFrames(request):0;
 HSTREAM handle=openFile(request,requested);
 try {
   BASS_CHANNELINFO info{};check(sourceGetInfo(handle,&info),"Stream information unavailable");
   const double duration=sourceBytes2Seconds(handle,sourceGetLength(handle,BASS_POS_BYTE));
   const auto maximum=request.value("maxBytes",65536u);if(maximum>262144)throw std::runtime_error("Inspection exceeds limit");
   std::vector<unsigned char> buffer(maximum);DWORD n=0;auto waiting=Clock::now();
   while(n<maximum) {
     const DWORD size=sourceGetData(handle,buffer.data()+n,maximum-n);
     if(size==static_cast<DWORD>(-1)){if(BASS_ErrorGetCode()==BASS_ERROR_ENDED)break;throw std::runtime_error("Decode inspection failed");}
     if(!size){if(sourceIsActive(handle)==BASS_ACTIVE_STOPPED)break;if(Clock::now()-waiting>std::chrono::seconds(5))throw std::runtime_error("Decode inspection stalled");Sleep(1);continue;}
     n+=size;waiting=Clock::now();
   }
   const std::string hex=bytesHex(buffer.data(),n);
   float dsdRate=0;if(request.value("dsd",false))BASS_ChannelGetAttribute(handle,BASS_ATTRIB_DSD_RATE,&dsdRate);
   json result={{"dataHex",hex},{"bytes",n},{"sampleRate",info.freq},{"channels",info.chans},{"duration",duration},{"dsdRate",dsdRate}};
   if(packRequested) {
     if(!std::isfinite(dsdRate)||dsdRate<=0||dsdRate>100000000||std::abs(dsdRate/16.0-info.freq)>.1)throw std::runtime_error("DoP source carrier rate is unavailable or inconsistent");
     if(n%sizeof(float))throw std::runtime_error("DoP inspection returned a partial float sample");
     std::vector<float> source(n/sizeof(float));if(n)std::memcpy(source.data(),buffer.data(),n);
     const auto packed=packedDop(source.data(),n,static_cast<int>(info.chans),packBits,paddingFrames,0,static_cast<int>(info.freq),static_cast<int>(std::llround(dsdRate)));
     result.update(packed);
   }
   freeStream(handle);return result;
 }catch(...){freeStream(handle);throw;}
}
static json renderPcmFile(const json& request) {
 if(stream||asio||wasapiOutput)throw std::runtime_error("Stop output before offline PCM rendering");
 std::string waveError;auto reader=rhine::WavePcmReader::tryOpen(wide(request.at("file").get<std::string>()),{},&waveError);
 if(!reader)throw std::runtime_error(waveError.empty()?"Offline rendering requires an uncompressed PCM WAV source":waveError);
 const auto info=reader->info();if(info.channels<1||info.channels>2)throw std::runtime_error("Offline PCM renderer supports mono/stereo WAV only");
 const json settings=request.value("processing",json::object());if(!settings.is_object())throw std::runtime_error("processing must be an object");
 const int inputRate=static_cast<int>(info.sampleRate),targetRate=selectOutputRate(settings,inputRate);
 const json replayGain=request.value("replayGain",json::object());
 rhine::PcmEngine engine;engine.configure(settings,inputRate,targetRate,static_cast<int>(info.channels),replayGain);
 std::string outputFormat=settings.value("outputFormat",std::string("auto"));
 if(outputFormat=="auto"&&settings.value("bitPerfect",false)) {
   if(info.validBitsPerSample==16&&info.bitsPerSample==16)outputFormat="s16";
   else if(info.validBitsPerSample==24&&info.bitsPerSample==24)outputFormat="s24";
   else if(info.validBitsPerSample==24&&info.bitsPerSample==32)outputFormat="s32v24";
   else if(info.validBitsPerSample==32&&info.bitsPerSample==32)outputFormat="s32";
 }
 if(outputFormat=="auto")outputFormat="f32";
 const std::string requestedDither=settings.value("dither",std::string("none"));
 const double gain=request.value("volume",1.0);if(!std::isfinite(gain)||gain<0||gain>1)throw std::runtime_error("Invalid volume");
 const std::string oldDither=ditherMode;ditherMode=requestedDither;
 try {validateBitPerfect(settings,"asio","exclusive",inputRate,targetRate,static_cast<int>(info.channels),static_cast<int>(info.validBitsPerSample),outputFormat,gain,replayGain,engine.stages(),true,info.format==rhine::WaveSampleFormat::PcmInteger,static_cast<int>(info.validBitsPerSample),static_cast<int>(info.bitsPerSample),requestedDither);}
 catch(...) {ditherMode=oldDither;throw;}
 ditherMode=oldDither;
 const auto format=rhine::PcmQuantizer::parse(outputFormat);rhine::PcmQuantizer quantizer;quantizer.configure(format,requestedDither,static_cast<int>(info.channels));
 const size_t maxFrames=request.value("maxFrames",2048u);if(!maxFrames||maxFrames>8192)throw std::runtime_error("maxFrames must be in [1, 8192]");
 const size_t blockFrames=std::min<size_t>(maxFrames,2048);std::vector<double> samples(blockFrames*info.channels);
 std::vector<uint8_t> encoded(maxFrames*info.channels*quantizer.bytesPerSample());
 size_t framesWritten=0;bool eof=false,buffering=false;
 while(framesWritten<maxFrames) {
   const size_t capacity=std::min(blockFrames,maxFrames-framesWritten);
   const auto block=engine.pullDouble(samples.data(),capacity,[&](double* output,size_t frames){
     const auto read=reader->read(output,frames);rhine::PcmDecodedBlock result;result.frames=read.frames;result.eof=read.eof;result.buffering=read.buffering;result.error=read.error;return result;
   });
   if(!block.error.empty())throw std::runtime_error(block.error);
   if(block.frames){quantizer.writeInterleaved(encoded.data()+framesWritten*info.channels*quantizer.bytesPerSample(),samples.data(),block.frames,static_cast<int>(info.channels),gain);framesWritten+=block.frames;}
   const std::string quantizerError=quantizer.takeError();if(!quantizerError.empty())throw std::runtime_error(quantizerError);
   if(block.eof){eof=true;break;}
   if(block.buffering&&!block.frames){buffering=true;break;}
   if(!block.frames)throw std::runtime_error("Offline PCM renderer stalled without EOF");
 }
 const size_t bytesWritten=framesWritten*info.channels*quantizer.bytesPerSample();
 const auto stats=quantizer.stats();
 return {{"frames",framesWritten},{"sourceFrames",info.sourceFrameCount},{"sampleRate",inputRate},{"outputSampleRate",targetRate},{"channels",info.channels},
   {"sourceFormat",{{"bitsPerSample",info.bitsPerSample},{"validBitsPerSample",info.validBitsPerSample},{"decodeMath",static_cast<int>(info.decodeMath)},{"sampleFormat",info.format==rhine::WaveSampleFormat::PcmInteger?"pcm":info.format==rhine::WaveSampleFormat::IeeeFloat32?"float32":"float64"}}},
   {"decoderOutputPrecision","float64"},{"outputFormat",rhine::PcmQuantizer::name(format)},{"dither",requestedDither},{"eof",eof},{"buffering",buffering},{"truncated",!eof&&!buffering},
   {"processingStages",engine.stages()},{"stats",stats.toJson()},{"overRangeSamples",stats.overRangeSamples},{"clippingSamples",stats.clippingSamples},{"peakAbs",stats.peakAbs},{"dataHex",bytesHex(encoded.data(),bytesWritten)}};
}
static json renderPcmQueue(const json& request) {
 if(stream||asio||wasapiOutput||!session.empty()||queuedPcmTrack||retiredPcmSourceCount)
   throw std::runtime_error("Offline queue rendering requires a fresh host with no active output session");
 const json settings=request.value("processing",json::object());if(!settings.is_object())throw std::runtime_error("processing must be an object");
 if(settings.value("bitPerfect",false))throw std::runtime_error("Offline queue rendering stops before device quantization and does not validate bit-perfect output");
 const size_t maxFrames=request.value("maxFrames",8192u),blockFrames=request.value("blockFrames",256u);
 if(!maxFrames||maxFrames>8192)throw std::runtime_error("render_queue maxFrames must be in [1, 8192]");
 if(!blockFrames||blockFrames>2048)throw std::runtime_error("render_queue blockFrames must be in [1, 2048]");
 std::unique_ptr<rhine::WavePcmReader> currentReader,nextReader;
 std::string currentWaveError,nextWaveError;
 try {
   currentReader=rhine::WavePcmReader::tryOpen(wide(request.at("file").get<std::string>()),{},&currentWaveError);
   if(!currentReader)throw std::runtime_error(currentWaveError.empty()?"render_queue requires complete uncompressed WAV input":currentWaveError);
   nextReader=rhine::WavePcmReader::tryOpen(wide(request.at("nextFile").get<std::string>()),{},&nextWaveError);
   if(!nextReader)throw std::runtime_error(nextWaveError.empty()?"render_queue requires complete uncompressed WAV queue input":nextWaveError);
   const auto currentInfo=currentReader->info(),nextInfo=nextReader->info();
   if(currentInfo.growing||nextInfo.growing||!currentInfo.sourceFrameCount||!nextInfo.sourceFrameCount)
     throw std::runtime_error("render_queue accepts only complete WAV files with known frame counts");
   if(currentInfo.channels<1||currentInfo.channels>2||nextInfo.channels!=currentInfo.channels)
     throw std::runtime_error("render_queue requires matching mono/stereo channel layouts");
   if(currentInfo.sourceFrameCount+nextInfo.sourceFrameCount>8192)
     throw std::runtime_error("render_queue synthetic source pair exceeds the 8192-frame input limit");
   const int currentRate=static_cast<int>(currentInfo.sampleRate),nextRate=static_cast<int>(nextInfo.sampleRate);
   const int targetRate=selectOutputRate(settings,currentRate);
   if(selectOutputRate(settings,nextRate)!=targetRate)
     throw std::runtime_error("render_queue sources must resolve to the same output rate");
   const int channels=static_cast<int>(currentInfo.channels);
   const std::string currentId=request.value("trackId",std::string("offline-current"));
   const std::string nextId=request.value("nextTrackId",std::string("offline-next"));
   if(currentId.empty()||nextId.empty()||currentId.size()>256||nextId.size()>256||currentId==nextId)
     throw std::runtime_error("render_queue track IDs must be distinct non-empty strings of at most 256 characters");

   mode="pcm";backend="wasapi";wasapiMode="shared";stream=0;paused=true;ended=false;error.clear();
   directWavePcm=true;decoderOutputPrecision="float64";waveInfo=currentInfo;waveReader=std::move(currentReader);
   sourceRate=currentRate;sourceBits=static_cast<int>(currentInfo.bitsPerSample);sourceContainerBits=sourceBits;
   sourceValidBits=static_cast<int>(currentInfo.validBitsPerSample);pcmChannels=channels;
   sourceFormatMetadata=request.value("sourceFormat",json::object());if(!sourceFormatMetadata.is_object())sourceFormatMetadata=json::object();
   sourceFormatMetadata["sampleRate"]=currentRate;sourceFormatMetadata["bitsPerSample"]=currentInfo.bitsPerSample;
   sourceFormatMetadata["validBitsPerSample"]=currentInfo.validBitsPerSample;
   sourceFormatMetadata["sampleFormat"]=currentInfo.format==rhine::WaveSampleFormat::PcmInteger?"pcm":currentInfo.format==rhine::WaveSampleFormat::IeeeFloat32?"float32":"float64";
   sourceFormatMetadata["decodeMath"]=currentInfo.decodeMath==rhine::WaveDecodeMath::Pcm8UnsignedMidpoint?"pcm8-unsigned-midpoint":
     currentInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerNormalized?"signed-integer-normalized":
     currentInfo.decodeMath==rhine::WaveDecodeMath::SignedIntegerLeftAlignedValidBits?"signed-integer-left-aligned-valid-bits":
     currentInfo.decodeMath==rhine::WaveDecodeMath::IeeeFloat32Widened?"ieee-float32-widened":"ieee-float64-copied";
   sourceFormatMetadata["decoderOutputPrecision"]="float64";currentTrackId=currentId;replayGainMetadata=request.value("replayGain",json::object());
   if(!replayGainMetadata.is_object())replayGainMetadata=json::object();
   currentDuration=currentInfo.durationSeconds;currentStartPosition=0;transitionFromTrackId.clear();
   transitionPending=false;transitionFadeActive=false;manualTransitionRequested=false;transitionFadeFrames=0;transitionFadeDone=0;transitionRequestedBy.clear();
   gapFramesRemaining=0;gapActive=false;activeTrackSerial=transitionSerial;
   configureProcessing(settings,replayGainMetadata,currentRate,targetRate,channels);
   masterGain=request.value("volume",1.0);
   if(!std::isfinite(masterGain)||masterGain<0||masterGain>1)throw std::runtime_error("Invalid volume");
   validateProcessingCandidate(settings,replayGainMetadata,currentRate,channels,masterGain);
   openRequest={{"file",request.at("file")},{"trackId",currentId},{"sourceFormat",sourceFormatMetadata},{"processing",settings},{"replayGain",replayGainMetadata}};

   auto prepared=std::make_unique<QueuedPcmTrack>();prepared->stream=0;prepared->file=request.at("nextFile").get<std::string>();
   prepared->waveReader=std::move(nextReader);prepared->waveInfo=nextInfo;prepared->directWave=true;prepared->trackId=nextId;
   prepared->sourceRate=nextRate;prepared->sourceBits=static_cast<int>(nextInfo.bitsPerSample);prepared->sourceValidBits=static_cast<int>(nextInfo.validBitsPerSample);
   prepared->sourceContainerBits=prepared->sourceBits;prepared->channels=channels;prepared->outputRate=targetRate;prepared->duration=nextInfo.durationSeconds;
   prepared->sourceFormat={{"sampleRate",nextRate},{"bitsPerSample",nextInfo.bitsPerSample},{"validBitsPerSample",nextInfo.validBitsPerSample},
     {"sampleFormat",nextInfo.format==rhine::WaveSampleFormat::PcmInteger?"pcm":nextInfo.format==rhine::WaveSampleFormat::IeeeFloat32?"float32":"float64"},
     {"decoderOutputPrecision","float64"}};
   prepared->replayGain=request.value("nextReplayGain",json::object());if(!prepared->replayGain.is_object())prepared->replayGain=json::object();
   prepared->processing=settings;prepared->engine=std::make_unique<rhine::PcmEngine>();
   prepared->engine->configure(settings,nextRate,targetRate,channels,prepared->replayGain);prepared->engine->reserveFrames(4096);
   prepared->processorStages=prepared->engine->stages();prepared->transitionSerial=activeTrackSerial+1;queuedPcmTrack=std::move(prepared);
   if(request.value("manualAdvance",false))requestManualAdvance();

   const size_t renderedSampleLimit=maxFrames*static_cast<size_t>(channels);
   std::vector<double> scratch(blockFrames*static_cast<size_t>(channels)),rendered;rendered.reserve(renderedSampleLimit);
   json segments=json::array();size_t audioFrames=0,silenceFrames=0,iterations=0;bool eof=false;
   const auto appendSilence=[&](size_t frames){rendered.insert(rendered.end(),frames*static_cast<size_t>(channels),0.0);silenceFrames+=frames;};
   while(rendered.size()/static_cast<size_t>(channels)<maxFrames&&!eof) {
     if(++iterations>maxFrames+64)throw std::runtime_error("render_queue exceeded its bounded read iteration count");
     const size_t remaining=maxFrames-rendered.size()/static_cast<size_t>(channels);
     const size_t capacity=std::min(blockFrames,remaining);auto block=readPcm(scratch.data(),capacity);
     if(!block.error.empty())throw std::runtime_error(block.error);
     const size_t silence=block.silenceBeforeFirstSegmentFrames+block.silenceAfterFirstSegmentFrames;
     if(block.frames+silence>capacity)throw std::runtime_error("render_queue block exceeded its frame capacity");
     size_t segmentFrames=0,inputOffset=0;
     for(const auto& segment:block.segments)segmentFrames+=segment.frames;
     if(segmentFrames!=block.frames)throw std::runtime_error("render_queue production timeline segments do not cover the returned PCM frames");
     appendSilence(block.silenceBeforeFirstSegmentFrames);
     for(size_t i=0;i<block.segments.size();i++) {
       const auto& segment=block.segments[i];
       json entry={{"offsetFrames",rendered.size()/static_cast<size_t>(channels)},{"frames",segment.frames},{"trackId",segment.trackId},
         {"transitionSerial",segment.transitionSerial},{"duration",segment.duration},{"positionStart",segment.positionStart},
         {"transitioning",segment.transitioning}};
       if(segment.transitioning){entry["fromTrackId"]=segment.fromTrackId;entry["nextTrackId"]=segment.nextTrackId;}
       segments.push_back(std::move(entry));
       const size_t sampleCount=segment.frames*static_cast<size_t>(channels);
       rendered.insert(rendered.end(),scratch.begin()+inputOffset,scratch.begin()+inputOffset+sampleCount);inputOffset+=sampleCount;
       if(i==0)appendSilence(block.silenceAfterFirstSegmentFrames);
     }
     if(block.segments.empty()&&block.silenceAfterFirstSegmentFrames)appendSilence(block.silenceAfterFirstSegmentFrames);
     audioFrames+=block.frames;eof=block.eof;
     if(!block.frames&&!silence&&!eof)throw std::runtime_error("render_queue production read loop stalled without EOF");
   }
   const size_t renderedFrames=rendered.size()/static_cast<size_t>(channels);
   std::vector<uint8_t> encoded(rendered.size()*sizeof(double));if(!rendered.empty())std::memcpy(encoded.data(),rendered.data(),encoded.size());
   json result={{"frames",renderedFrames},{"audioFrames",audioFrames},{"silenceFrames",silenceFrames},{"sampleRate",targetRate},{"sourceSampleRates",{currentRate,nextRate}},
     {"channels",channels},{"eof",eof},{"truncated",!eof},{"segments",segments},{"dataF64Hex",bytesHex(encoded.data(),encoded.size())},
     {"processingStages",processingStages()},{"preQuantizer",true}};
   stop();return result;
 }catch(...) {stop();throw;}
}
static json packDopCommand(const json& request) {
 if(stream)throw std::runtime_error("Stop output before DoP packing inspection");
 const int bits=requestedDopBits(request);
 const int channels=request.value("channels",2);if(channels<1||channels>2)throw std::runtime_error("DoP pack test supports mono/stereo only");
 const DWORD paddingFrames=requestedPaddingFrames(request);
 const DWORD leadingIdleFrames=requestedPaddingFrames(request,"leadingIdleFrames");
 const DWORD chunkFrames=requestedPaddingFrames(request,"chunkFrames");
 const DWORD maximum=request.value("maxBytes",262144u);if(maximum>262144)throw std::runtime_error("DoP pack input exceeds limit");
 const std::string sourceHex=request.value("sourceHex",std::string());
 if(sourceHex.size()%2||sourceHex.size()/2>maximum)throw std::runtime_error("DoP pack sourceHex exceeds maxBytes or has an odd length");
 const size_t sourceBytes=sourceHex.size()/2;
 if(sourceBytes%(static_cast<size_t>(channels)*sizeof(float)))throw std::runtime_error("DoP pack sourceHex is not a complete float frame sequence");
 std::vector<unsigned char> raw(sourceBytes);auto hexNibble=[](char ch)->int {
   if(ch>='0'&&ch<='9')return ch-'0';if(ch>='a'&&ch<='f')return ch-'a'+10;if(ch>='A'&&ch<='F')return ch-'A'+10;return -1;
 };
 for(size_t i=0;i<sourceBytes;i++){const int high=hexNibble(sourceHex[i*2]),low=hexNibble(sourceHex[i*2+1]);if(high<0||low<0)throw std::runtime_error("DoP pack sourceHex is not hexadecimal");raw[i]=static_cast<unsigned char>((high<<4)|low);}
 std::vector<float> source(sourceBytes/sizeof(float));if(sourceBytes)std::memcpy(source.data(),raw.data(),sourceBytes);
 return packedDop(source.data(),static_cast<DWORD>(sourceBytes),channels,bits,paddingFrames,leadingIdleFrames,0,0);
}
static json previewLspEq(const json& request) {
 const int rate=request.value("sampleRate",48000);
 if(rate<8000||rate>768000)throw std::runtime_error("LSP preview sample rate must be between 8 and 768 kHz");
 if(!request.contains("eq")||!request["eq"].is_object())throw std::runtime_error("LSP preview requires EQ settings");
 const auto& eq=request["eq"];
 if(eq.value("engine",std::string())!="lsp"||!eq.contains("lsp")||!eq["lsp"].is_object())throw std::runtime_error("LSP preview requires the advanced EQ engine");
 if(!request.contains("frequencies")||!request["frequencies"].is_array()||request["frequencies"].empty()||request["frequencies"].size()>512)
   throw std::runtime_error("LSP preview requires 1 to 512 frequencies");
 std::vector<float> frequencies;frequencies.reserve(request["frequencies"].size());
 for(const auto& point:request["frequencies"]) {
   if(!point.is_number())throw std::runtime_error("LSP preview frequencies must be numbers");
   const double value=point.get<double>();
   if(!std::isfinite(value)||value<=0||value>static_cast<double>(rate)/2)throw std::runtime_error("LSP preview frequency is outside the analysis range");
   frequencies.push_back(static_cast<float>(value));
 }
 const auto& settings=eq["lsp"];const auto bands=settings.value("bands",json::array());
 if(!bands.is_array()||bands.size()>32)throw std::runtime_error("LSP preview supports at most 32 bands");
 rhine::LspEq processor(settings,rate,2);
 const auto curve=[&](int band,unsigned channel) {
   const auto data=processor.response(band,channel,frequencies);json output=json::array();
   for(const auto db:data) {
     if(!std::isfinite(db))throw std::runtime_error("LSP returned a non-finite frequency response");
     output.push_back(db);
   }
   return output;
 };
 json individual=json::array();
 for(size_t i=0;i<bands.size();i++)individual.push_back({{"index",i},{"channels",bands[i].value("channels",0)},
   {"responses",json::array({curve(static_cast<int>(i),0),curve(static_cast<int>(i),1)})}});
 const auto latency=processor.latencyFrames();
 return {{"engine","lsp"},{"algorithm",settings.value("algorithm",std::string("iir"))},
   {"routing",settings.value("routing",std::string("stereo"))},{"sampleRate",rate},{"computePrecision","float32"},
   {"latencyFrames",latency},{"latencyMs",static_cast<double>(latency)*1000.0/rate},
   {"frequencies",frequencies},{"total",json::array({curve(-1,0),curve(-1,1)})},{"bands",std::move(individual)}};
}
static json command(const json& value);
static json lspEditorCommand(const json& request) {
 const std::string action=request.value("action",std::string("state"));
 if(action!="open"&&action!="state"&&action!="close")throw std::runtime_error("Invalid LSP editor action");
 if(request.contains("session")&&request.value("session",std::string())!=session)throw std::runtime_error("Stale LSP editor session");
 const json eq=request.value("eq",json::object());
 if(!eq.is_object()||eq.value("engine",std::string())!="lsp"||!eq.contains("lsp")||!eq["lsp"].is_object())throw std::runtime_error("LSP editor requires advanced EQ settings");
 json result;bool restart=false;json reopen,fallback;
 {
   std::lock_guard<std::mutex> lock(pcmRenderMutex);
   auto* plugin=mode=="pcm"&&pcmEngine?pcmEngine->lspPlugin():nullptr;
   if(plugin) {
     if(request.value("session",std::string())!=session)throw std::runtime_error("Stale LSP editor session");
     lspTransportPaused.store(paused||ended,std::memory_order_release);plugin->setPausedPreviewGate(&pcmRenderMutex,&lspTransportPaused);
     if(action=="open"&&(transitionPending||transitionFadeActive))throw std::runtime_error("Wait for the current track transition before opening the LSP editor");
     if(lspIdleEditor&&lspIdleEditor->editorOpen())lspIdleEditor->editor("close");
     result=plugin->editor(action);result["active"]=true;result["session"]=session;
     std::string state=result.at("pluginState").get<std::string>();
     fallback=openRequest;
     const bool changed=processingSettings["eq"]["lsp"].value("pluginState",std::string())!=state;
     if((paused||ended)&&(changed||action=="open"||plugin->processingRequested())) {
       // Refresh the official response mesh on this same instance while the
       // transport is paused. Reopen at the audible cursor before resuming,
       // so zero preview history and pre-rendered old samples cannot leak.
       plugin->refreshPausedPreview();
       result=plugin->editor("state");result["active"]=true;result["session"]=session;
       state=result.at("pluginState").get<std::string>();
     }
     processingSettings["eq"]["lsp"]["pluginState"]=state;openRequest["processing"]=processingSettings;
     // A preloaded track owns a separate processor. Discard the owned queue
     // after a live edit so it cannot later replace this EQ with stale state.
     if((changed||action=="open")&&queuedPcmTrack){clearQueuedPcmLocked();result["queueCleared"]=true;}
     restart=plugin->needsRestart();if(restart)reopen=openRequest;
   } else {
     const std::string requestedState=eq["lsp"].value("pluginState",std::string());
     if(!lspIdleEditor||(action=="open"&&!lspIdleEditor->editorOpen()&&requestedState!=lspIdleState)) {
       lspIdleEditor=std::make_unique<rhine::LspPluginEq>(eq["lsp"],48000,2,false);lspIdleState=requestedState;
     }
     result=lspIdleEditor->editor(action);lspIdleState=result.at("pluginState").get<std::string>();result["active"]=false;
   }
 }
 if(restart) {
   const json before=status();const bool resume=before.value("playing",false),show=result.value("editorOpen",false);
   reopen["position"]=before.value("position",0.0);fallback["position"]=reopen["position"];
   try {open(reopen);if(resume)command(json{{"cmd","play"},{"session",session}});}
   catch(const std::exception& failure) {
     const std::string message=failure.what();
     try{open(fallback);if(resume)command(json{{"cmd","play"},{"session",session}});}
     catch(const std::exception& restore){throw std::runtime_error(message+"; LSP playback restoration failed: "+restore.what());}
     throw std::runtime_error(message);
   }
   std::lock_guard<std::mutex> lock(pcmRenderMutex);
   if(pcmEngine&&pcmEngine->lspPlugin())result=pcmEngine->lspPlugin()->editor(show?"open":"state");
   result["active"]=true;result["session"]=session;
 }
 return result;
}
static json command(const json& value) {
 const auto cmd=value.at("cmd").get<std::string>();
 if(cmd=="devices")return devices();
 if(cmd=="capabilities")return capabilities(value);
 if(cmd=="inspect")return inspect(value);
 if(cmd=="eq_preview")throw std::runtime_error("LSP frequency response is available in its native panel");
 if(cmd=="eq_editor")return lspEditorCommand(value);
 if(cmd=="render")return renderPcmFile(value);
 if(cmd=="render_queue")return renderPcmQueue(value);
 if(cmd=="pack_dop")return packDopCommand(value);
 if(cmd=="open")return open(value);
 if(cmd=="shutdown"){stop();return {{"shutdown",true}};}
 if(!stream||value.value("session",std::string())!=session)throw std::runtime_error("Stale audio session");
 if(cmd=="status") {
   bool restartLsp=false;
   {std::lock_guard<std::mutex> lock(pcmRenderMutex);restartLsp=pcmEngine&&pcmEngine->lspPlugin()&&pcmEngine->lspPlugin()->needsRestart();}
   if(restartLsp)lspEditorCommand(json{{"action","state"},{"eq",processingSettings.at("eq")},{"session",session}});
   return status();
 }
 if(cmd=="stop"){
   if(backend=="wasapi"&&mode=="pcm"&&wasapiOutput&&processingSettings.value("transition",json::object()).value("transportFade",false)&&!paused)
     wasapiOutput->pause(processingSettings.value("transition",json::object()).value("transportMs",250));
   if(backend=="asio"&&mode=="pcm"&&asioPcmRenderer&&processingSettings.value("transition",json::object()).value("transportFade",false)&&!paused)
     fadeAsioOut(processingSettings.value("transition",json::object()).value("transportMs",250));
   stop();return status();
 }
 if(cmd=="queue")return queuePcmTrack(value);
 if(cmd=="clearQueue"){clearPcmQueue();return status();}
 if(cmd=="advance") {
   collectWasapiOutput();
   if(backend=="wasapi"&&mode=="pcm"&&ended) {
     const auto previous=wasapiSnapshot;
     {std::lock_guard<std::mutex> lock(pcmRenderMutex);if(!queuedPcmTrack)throw std::runtime_error("No next track is queued");}
     if(wasapiOutput){if(!wasapiOutput->finished())wasapiOutput->pause();wasapiOutput.reset();}
     {std::lock_guard<std::mutex> lock(pcmRenderMutex);activateQueuedTrackLocked();}
     BASS_CHANNELINFO info{};check(sourceGetInfo(stream,&info),"Stream information unavailable");
     paused=true;ended=false;createWasapiOutput(info);
     if(wasapiOutput)wasapiOutput->setTrackMetadata(previous.trackId,previous.duration,previous.sourceSampleRate,previous.sourceFormat,previous.processingStages,previous.transitionSerial,previous.duration);
     wasapiOutput->play();wasapiSnapshot=wasapiOutput->snapshot();paused=wasapiSnapshot.paused;ended=wasapiSnapshot.ended;
     return status();
   }
   requestManualAdvance();return status();
 }
 if(cmd=="processing") {
   if(mode!="pcm")throw std::runtime_error("PCM processing settings are available only for PCM playback");
   if(openRequest.contains("growingBytes"))throw std::runtime_error("Processing cannot be reconfigured while Sony progressive PCM is open");
   const json before=status();const bool resume=before.value("playing",false);json updated,previous,previousQueue=json::object();
   const json nextSettings=value.at("processing");const json nextReplayRequest=value.contains("replayGain")?value["replayGain"]:json::object();
   const json replayForCandidate=value.contains("replayGain")?nextReplayRequest:replayGainMetadata;
   // Native-panel edits already affect this processor. The renderer mirrors
   // the saved state; mirroring must not recreate the plugin or close its UI.
   if(nextSettings==processingSettings&&replayForCandidate==replayGainMetadata)return before;
   bool hotUpdate=false;json currentStages=json::array(),queuedStages=json::array();std::string currentStageTrackId,queuedStageTrackId;
   {
     std::lock_guard<std::mutex> lock(pcmRenderMutex);
     if(transitionPending||transitionFadeActive)throw std::runtime_error("Wait for the queued track transition before changing processing settings");
     updated=openRequest;previous=openRequest;
     validateProcessingCandidate(nextSettings,replayForCandidate,sourceRate,pcmChannels,masterGain);
     hotUpdate=effectsOnlyProcessingChange(processingSettings,nextSettings);
     if(hotUpdate) {
       if(pcmEngine&&pcmEngine->effectsTransitionActive()) {
         if(resume)throw std::runtime_error("Wait for the current PCM effects transition before changing processing settings");
         pcmEngine->commitEffectsTransition();pcmEngine->collectRetiredEffects();
       }
       const bool effectsChanged=dspSettingsOnly(processingSettings)!=dspSettingsOnly(nextSettings)||replayForCandidate!=replayGainMetadata;
       if(effectsChanged) {
         rhine::PcmProcessor currentCandidate;currentCandidate.configure(nextSettings,sourceRate,pcmChannels,replayForCandidate);
         rhine::PcmProcessor queuedCandidate;std::string queuedCandidateError;
         if(queuedPcmTrack&&queuedPcmTrack->engine) {
           try {queuedCandidate.configure(nextSettings,queuedPcmTrack->sourceRate,queuedPcmTrack->channels,queuedPcmTrack->replayGain);}
           catch(const std::exception& candidateError){queuedCandidateError=candidateError.what();}
         }
         const size_t fadeFrames=resume?static_cast<size_t>(std::max<long long>(1,std::llround(static_cast<double>(sourceRate)*0.010))):0;
         pcmEngine->collectRetiredEffects();pcmEngine->updateEffects(std::move(currentCandidate),fadeFrames);
         processorStageSnapshot=pcmEngine->stages();
         if(queuedPcmTrack&&queuedPcmTrack->engine) {
           if(!queuedCandidateError.empty()) {
             const std::string failedTrack=queuedPcmTrack->trackId;clearQueuedPcmLocked();
             queueError="Queued track "+failedTrack+" was cleared because the updated DSP is invalid for its source rate: "+queuedCandidateError;
           } else {
             queuedPcmTrack->engine->collectRetiredEffects();queuedPcmTrack->engine->updateEffects(std::move(queuedCandidate),0);
             queuedPcmTrack->processing=nextSettings;queuedPcmTrack->processorStages=queuedPcmTrack->engine->stages();
           }
         }
       } else if(queuedPcmTrack)queuedPcmTrack->processing=nextSettings;
       processingSettings=nextSettings;replayGainMetadata=replayForCandidate;
       requestedReconfigureMs=nextSettings.value("reconfigureMs",0);
       openRequest["processing"]=nextSettings;openRequest["replayGain"]=replayForCandidate;
       currentStages=processingStages();currentStageTrackId=currentTrackId;
       if(queuedPcmTrack){queuedStages=queuedTrackStages(false,{});queuedStageTrackId=queuedPcmTrack->trackId;}
     } else if(queuedPcmTrack) {
       previousQueue={{"file",queuedPcmTrack->file},{"trackId",queuedPcmTrack->trackId},{"sourceFormat",queuedPcmTrack->sourceFormat},{"replayGain",queuedPcmTrack->replayGain},{"processing",queuedPcmTrack->processing}};
       clearQueuedPcmLocked();
     }
   }
   if(hotUpdate) {
     if(wasapiOutput){wasapiOutput->setTrackProcessingStages(currentStageTrackId,currentStages);if(!queuedStageTrackId.empty())wasapiOutput->setTrackProcessingStages(queuedStageTrackId,queuedStages);}
     return status();
   }
   updated["processing"]=nextSettings;if(value.contains("replayGain"))updated["replayGain"]=nextReplayRequest;
   updated["position"]=before.value("position",0.0);previous["position"]=updated["position"];
   try {open(updated);}
   catch(const std::exception& original) {
     const std::string message=original.what();
     try {open(previous);if(!previousQueue.empty())queuePcmTrack(previousQueue);if(resume)command(json{{"cmd","play"},{"session",session}});}
     catch(const std::exception& restore){throw std::runtime_error(message+"; previous playback restoration also failed: "+restore.what());}
     throw std::runtime_error(message);
   }
   if(!previousQueue.empty()){previousQueue["processing"]=updated["processing"];try{queuePcmTrack(previousQueue);}catch(...) {}}
   if(resume)command(json{{"cmd","play"},{"session",session}});
   return status();
 }
 if(cmd=="play") {
   lspTransportPaused=false;
   if(mode=="pcm"&&(paused||ended)) {
     const json before=status();json updated;bool refresh=false;
     {
       std::lock_guard<std::mutex> lock(pcmRenderMutex);
       auto* plugin=pcmEngine?pcmEngine->lspPlugin():nullptr;
       if(plugin) {
         std::string state=processingSettings["eq"]["lsp"].value("pluginState",std::string());
         if(plugin->editorOpen())state=plugin->editor("state").at("pluginState").get<std::string>();
         refresh=plugin->pausedPreviewDirty()||state!=processingSettings["eq"]["lsp"].value("pluginState",std::string());
         if(refresh){updated=openRequest;updated["processing"]["eq"]["lsp"]["pluginState"]=state;updated["position"]=before.value("ended",false)?0.0:before.value("position",0.0);}
       }
     }
     if(refresh)open(updated);
   }
   if(backend=="wasapi") {
     collectWasapiOutput();if(!error.empty())throw std::runtime_error(error);
     // EOF is observable before the event worker has completed COM teardown.
     // Join that finished playback session before opening its replay replacement.
     if(wasapiOutput&&wasapiSnapshot.ended){wasapiOutput.reset();ended=true;paused=true;}
     if(!wasapiOutput) {
       if(ended){check(sourceSetPosition(stream,0,BASS_POS_BYTE),"Seek to start failed");if(mode=="pcm"&&pcmEngine){pcmEngine->reset();pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));}currentStartPosition=0;pausedPosition=0;ended=false;}
       BASS_CHANNELINFO info{};check(sourceGetInfo(stream,&info),"Stream information unavailable");createWasapiOutput(info);
     }
     const json transition=processingSettings.value("transition",json::object());
     if(mode=="pcm"&&transition.value("transportFade",false))wasapiOutput->setFadeIn(transition.value("transportMs",250));
     wasapiOutput->play();wasapiSnapshot=wasapiOutput->snapshot();paused=wasapiSnapshot.paused;ended=wasapiSnapshot.ended;
   }else {
     if(!error.empty())throw std::runtime_error(error);
     if(asio&&ended) {
       requireAsioStopped();stopAsioPcmProducer(asioPcmRenderer.get());if(asioDsdRenderer)asioDsdRenderer->ready.stop();
       check(sourceSetPosition(stream,0,BASS_POS_BYTE),"Seek to start failed");
       if(directWavePcm&&waveReader)waveReader->reset();if(pcmEngine)pcmEngine->reset();pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));currentStartPosition=0;
       if(asioPcmRenderer){asioPcmRenderer->deliveredMask=0;asioPcmRenderer->failed=false;asioPcmRenderer->eof=false;asioPcmRenderer->errorText={};}
       resetAsioPcmStats();
       if(asioPcmRenderer){asioPcmRenderer->ready.reset();asioPcmRenderer->producerEof=false;asioPcmRenderer->producerFailed=false;asioPcmRenderer->fault=0;asioPcmRenderer->producedFrames=0;asioPcmRenderer->consumedFrames=0;asioPcmRenderer->consumedPosition=0;startAsioPcmProducer(asioPcmRenderer.get());}
       if(asioDsdRenderer){asioDsdRenderer->ready.reset();asioDsdRenderer->packer.reset();asioDsdRenderer->eof=false;asioDsdRenderer->fault=0;asioDsdRenderer->ready.start();}
       asioPcmEnded=false;asioPcmBuffering=false;pausedPosition=0;
     }
     if(asio&&mode=="pcm"&&processingSettings.value("transition",json::object()).value("transportFade",false))setAsioFadeIn(processingSettings.value("transition",json::object()).value("transportMs",250));
     if(asio){if(!BASS_ASIO_IsStarted())check(BASS_ASIO_Start(mode=="pcm"?asioStartFrames:0,1),"ASIO playback failed",true);}
     else check(BASS_ChannelPlay(stream,FALSE),"System playback failed");
     paused=false;ended=false;endSince={};
   }
 }
 else if(cmd=="pause") {
   if(backend=="wasapi") {
     collectWasapiOutput();if(wasapiOutput){const json transition=processingSettings.value("transition",json::object());const int fadeMs=mode=="pcm"&&transition.value("transportFade",false)?transition.value("transportMs",250):0;wasapiOutput->pause(fadeMs);wasapiSnapshot=wasapiOutput->snapshot();pausedPosition=wasapiSnapshot.position;paused=wasapiSnapshot.paused;ended=wasapiSnapshot.ended;{std::lock_guard<std::mutex> lock(pcmRenderMutex);if(!transitionPending&&!transitionFadeActive)clearQueuedPcmLocked();}}else paused=true;
     if(mode=="pcm")pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));
   }else {
     const bool wasPlaying=!paused;
     if(asio) {
       const bool faded=wasPlaying&&mode=="pcm"&&processingSettings.value("transition",json::object()).value("transportFade",false);
       if(faded)fadeAsioOut(processingSettings.value("transition",json::object()).value("transportMs",250));
       requireAsioStopped();
       if(wasPlaying) {
         double decoded=asioPcmRenderer?asioPcmRenderer->consumedPosition.load(std::memory_order_relaxed):sourceBytes2Seconds(stream,sourceGetPosition(stream,BASS_POS_BYTE));
         if(asioDsdRenderer)decoded=std::max(0.0,decoded-static_cast<double>(asioDsdRenderer->ready.queuedFrames())/std::max(1.0,mode=="native"?outputRate/8:outputRate));
         if(mode=="pcm"&&pcmEngine) {
           if(directWavePcm){std::lock_guard<std::mutex> lock(pcmRenderMutex);decoded=pcmTimelinePositionLocked();}
           else if(!asioPcmRenderer)decoded=std::max(0.0,decoded-pcmEngine->bufferedSeconds());
         }
         if(mode=="pcm"&&!faded)decoded=std::max(0.0,decoded-static_cast<double>(BASS_ASIO_GetLatency(FALSE))/std::max(1.0,outputRate));
         pausedPosition=decoded;
       }
     }else {if(wasPlaying)pausedPosition=sourceBytes2Seconds(stream,sourceGetPosition(stream,BASS_POS_BYTE));if(wasPlaying)check(BASS_ChannelPause(stream),"System pause failed");}
     paused=true;if(mode=="pcm")pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));
   }
 }
 else if(cmd=="seek") {
   const double target=value.at("position").get<double>();if(!std::isfinite(target)||target<0)throw std::runtime_error("Invalid seek position");
   if(backend=="wasapi") {
     collectWasapiOutput();if(!error.empty())throw std::runtime_error(error);
     const bool resume=wasapiSnapshot.playing&&!wasapiSnapshot.ended;
     const json transition=processingSettings.value("transition",json::object());const int fadeMs=mode=="pcm"&&transition.value("seekFade",false)?transition.value("seekMs",250):0;
     if(wasapiOutput&&resume&&fadeMs>0)wasapiOutput->pause(fadeMs);
     if(wasapiOutput)wasapiSnapshot=wasapiOutput->snapshot();
     {
       std::lock_guard<std::mutex> lock(pcmRenderMutex);
       if(wasapiOutput&&queuedPcmTrack&&wasapiSnapshot.trackId==queuedPcmTrack->trackId) {
         activateQueuedTrackLocked();transitionFadeActive=false;transitionFadeFrames=0;transitionFadeDone=0;manualTransitionRequested=false;transitionRequestedBy.clear();
       }
     }
     if(wasapiOutput)wasapiOutput->seek(target);
     else {check(sourceSetPosition(stream,sourceSeconds2Bytes(stream,target),BASS_POS_BYTE),"Seek failed");BASS_CHANNELINFO info{};check(sourceGetInfo(stream,&info),"Stream information unavailable");createWasapiOutput(info);std::lock_guard<std::mutex> lock(pcmRenderMutex);clearQueuedPcmLocked();}
     {std::lock_guard<std::mutex> lock(pcmRenderMutex);if(transitionPending){transitionSerial=activeTrackSerial;transitionPending=false;}transitionFadeActive=false;transitionFadeFrames=0;transitionFadeDone=0;transitionFromTrackId.clear();}
     if(mode=="pcm")pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));
     if(wasapiOutput)wasapiOutput->setTrackMetadata(currentTrackId,currentDuration,sourceRate,sourceFormatMetadata,mode=="pcm"?processingStages():json::array(),activeTrackSerial,target);
     if(wasapiOutput&&resume){if(fadeMs>0)wasapiOutput->setFadeIn(fadeMs);wasapiOutput->play();}
     wasapiSnapshot=wasapiOutput->snapshot();pausedPosition=wasapiSnapshot.position;paused=wasapiSnapshot.paused;ended=wasapiSnapshot.ended;
   }else {
     const bool resume=!paused;
     if(asio&&resume&&mode=="pcm"&&processingSettings.value("transition",json::object()).value("seekFade",false))fadeAsioOut(processingSettings.value("transition",json::object()).value("seekMs",250));
     if(asio){requireAsioStopped();paused=true;stopAsioPcmProducer(asioPcmRenderer.get());if(asioDsdRenderer)asioDsdRenderer->ready.stop();}
     try {
     check(sourceSetPosition(stream,sourceSeconds2Bytes(stream,target),BASS_POS_BYTE),"Seek failed");
     if(mode=="pcm"&&pcmEngine){if(directWavePcm&&waveReader){std::string seekError;if(!waveReader->seek(static_cast<uint64_t>(std::llround(target*sourceRate)),&seekError))throw std::runtime_error(seekError.empty()?"WAV seek failed":seekError);}pcmEngine->reset();currentStartPosition=target;pcmSpectrum.clear(activeTrackSerial,static_cast<int>(outputRate));}
     if(asioPcmRenderer){asioPcmRenderer->deliveredMask=0;asioPcmRenderer->failed=false;asioPcmRenderer->eof=false;asioPcmRenderer->errorText={};}resetAsioPcmStats();asioPcmEnded=false;pausedPosition=target;ended=false;endSince={};
     if(asioPcmRenderer){asioPcmRenderer->ready.reset();asioPcmRenderer->producerEof=false;asioPcmRenderer->producerFailed=false;asioPcmRenderer->fault=0;asioPcmRenderer->producedFrames=0;asioPcmRenderer->consumedFrames=0;asioPcmRenderer->consumedPosition=target;startAsioPcmProducer(asioPcmRenderer.get());}
     if(asioDsdRenderer){asioDsdRenderer->ready.reset();asioDsdRenderer->packer.reset();asioDsdRenderer->eof=false;asioDsdRenderer->fault=0;asioDsdRenderer->ready.start();}
     if(resume&&asio){const json transition=processingSettings.value("transition",json::object());if(mode=="pcm"&&transition.value("seekFade",false))setAsioFadeIn(transition.value("seekMs",250));check(BASS_ASIO_Start(mode=="pcm"?asioStartFrames:0,1),"ASIO resume after seek failed",true);paused=false;}
     }catch(const std::exception& failure){requireAsioStopped();stopAsioPcmProducer(asioPcmRenderer.get());if(asioDsdRenderer)asioDsdRenderer->ready.stop();paused=true;error=std::string("定位失败，请重新打开歌曲：")+failure.what();throw std::runtime_error(error);}
   }
 }
 else if(cmd=="volume") {
   if(mode!="pcm")throw std::runtime_error("DSD/DoP digital volume is locked; use the DAC volume");
   if(processingSettings.value("bitPerfect",false))throw std::runtime_error("Digital volume is locked while bit-perfect PCM is active");
   const double gain=value.at("volume").get<double>();if(!std::isfinite(gain)||gain<0||gain>1)throw std::runtime_error("Invalid volume");
   if(backend=="wasapi"){
     collectWasapiOutput();wasapiGain=gain;
     if(wasapiOutput){const json stages=wasapiOutput->snapshot().processingStages;wasapiOutput->setVolume(gain,[gain]{std::lock_guard<std::mutex> lock(pcmRenderMutex);masterGain=gain;},stages);}
     else {std::lock_guard<std::mutex> lock(pcmRenderMutex);masterGain=gain;}
   }
   else if(asio&&mode=="pcm") {
     const bool resume=!paused&&BASS_ASIO_IsStarted();if(resume){check(BASS_ASIO_Stop(),"ASIO volume update pause failed",true);paused=true;}
     {std::lock_guard<std::mutex> lock(pcmRenderMutex);masterGain=gain;if(asioPcmRenderer)asioPcmRenderer->gain=gain;}
     if(resume){check(BASS_ASIO_Start(asioStartFrames,1),"ASIO volume update resume failed",true);paused=false;}
   } else if(asio)check(BASS_ASIO_ChannelSetVolume(FALSE,-1,static_cast<float>(gain)),"ASIO volume failed",true);else check(BASS_ChannelSetAttribute(stream,BASS_ATTRIB_VOL,static_cast<float>(gain)),"System volume failed");
   {std::lock_guard<std::mutex> lock(pcmRenderMutex);masterGain=gain;if(openRequest.is_object())openRequest["volume"]=gain;}
 }else throw std::runtime_error("Unknown command");
 return status();
}
static json decodeFile(const json& request,bool pipe=false) {
 auto accurateRequest=request;accurateRequest["accurate"]=true;
 const HSTREAM input=openFile(accurateRequest,"pcm");HANDLE output=INVALID_HANDLE_VALUE;
 try {
   BASS_CHANNELINFO info{};check(sourceGetInfo(input,&info),"Stream information unavailable");
   const auto sourceBytes=sourceGetLength(input,BASS_POS_BYTE);
   const double duration=sourceBytes2Seconds(input,sourceBytes);
   if(info.chans<1||info.chans>2||!std::isfinite(duration)||duration<=0||duration>3600)throw std::runtime_error("Only mono/stereo tracks of at most one hour are supported");
   const double requestedPosition=request.value("position",0.0);
   if(!std::isfinite(requestedPosition)||requestedPosition<0||requestedPosition>duration+.01)throw std::runtime_error("Invalid decoder start position");
   if(requestedPosition>0)check(sourceSetPosition(input,sourceSeconds2Bytes(input,std::min(requestedPosition,std::max(0.0,duration-1.0/info.freq))),BASS_POS_BYTE),"Decoder seek failed");
   const auto sourcePosition=sourceGetPosition(input,BASS_POS_BYTE);
   const auto pcmSource=findPcmSource(input);
   const bool exactFrameCount=!pcmSource||pcmSource->info().exactFrameCount||pcmSource->exactTotalFrames().has_value();
   if(sourceBytes==static_cast<QWORD>(-1)||sourcePosition==static_cast<QWORD>(-1)||(exactFrameCount&&sourcePosition>=sourceBytes)||(exactFrameCount&&(sourceBytes-sourcePosition)%(info.chans*4)))throw std::runtime_error("Source PCM frame count is not available");
   const auto expectedFrames=(sourceBytes>sourcePosition?sourceBytes-sourcePosition:0)/(info.chans*4);
   const double positionOffset=sourceBytes2Seconds(input,sourcePosition);
   if(pipe) {
     output=GetStdHandle(STD_OUTPUT_HANDLE);
     if(output==INVALID_HANDLE_VALUE||!output)throw std::runtime_error("Decoder pipe is not available");
     std::cout<<json({{"ready",true},{"sampleRate",info.freq},{"channels",2},{"sourceChannels",info.chans},{"frames",expectedFrames},{"duration",duration-positionOffset},{"positionOffset",positionOffset},{"exactFrameCount",exactFrameCount},{"decoderName",pcmSource?pcmSource->info().decoderName:std::string("BASSDSD")}}).dump()<<std::endl;
   } else {
     const auto destination=wide(request.at("output").get<std::string>());
     output=CreateFileW(destination.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
     if(output==INVALID_HANDLE_VALUE)throw std::runtime_error("Decoder output must not already exist");
   }
   std::vector<float> data(32768),stereo(65536);uint64_t bytes=0;auto waiting=Clock::now();
   while(true) {
     if(exactFrameCount&&bytes/8==expectedFrames)break;
     const DWORD size=sourceGetData(input,data.data(),static_cast<DWORD>(data.size()*4));
     if(size==static_cast<DWORD>(-1)){if(BASS_ErrorGetCode()==BASS_ERROR_ENDED)break;throw std::runtime_error("Source decoding failed");}
     if(!size){if(sourceIsActive(input)==BASS_ACTIVE_STOPPED)break;if(Clock::now()-waiting>std::chrono::seconds(5))throw std::runtime_error("Source decoding stalled");Sleep(1);continue;}
     waiting=Clock::now();if(size%(info.chans*4))throw std::runtime_error("Incomplete decoded frame");
     // Only exact lengths may truncate decoded data; compressed duration
     // estimates must run through the decoder's actual end of stream.
     const DWORD frames=static_cast<DWORD>(exactFrameCount?std::min<uint64_t>(size/(info.chans*4),expectedFrames-bytes/8):size/(info.chans*4));
     const void* content=data.data();DWORD count=frames*info.chans*4;
     if(info.chans==1){for(DWORD i=0;i<frames;i++){stereo[i*2]=data[i];stereo[i*2+1]=data[i];}content=stereo.data();count=frames*8;}
     bytes+=count;if(bytes>2000000000)throw std::runtime_error("Decoded PCM exceeded 2 GB");
     DWORD offset=0;auto outputWaiting=Clock::now();
     while(offset<count){
       DWORD written=0;
       if(!WriteFile(output,static_cast<const char*>(content)+offset,std::min<DWORD>(count-offset,32768),&written,nullptr))throw std::runtime_error("Decoder output write failed (Windows "+std::to_string(GetLastError())+")");
       // Inherited Windows byte pipes can be nonblocking. Successful zero-byte
       // writes mean backpressure, not decode failure; preserve every PCM byte.
       if(!written){if(!pipe||Clock::now()-outputWaiting>std::chrono::seconds(5))throw std::runtime_error("Decoder output did not accept data");Sleep(1);continue;}
       offset+=written;outputWaiting=Clock::now();
     }
   }
   if(exactFrameCount&&bytes/8!=expectedFrames)throw std::runtime_error("Source decoded frame count changed");
   if(!pipe)CloseHandle(output);output=INVALID_HANDLE_VALUE;freeStream(input);
   return {{"ready",true},{"sampleRate",info.freq},{"channels",2},{"frames",bytes/8},{"duration",static_cast<double>(bytes/8)/info.freq},{"positionOffset",positionOffset}};
 }catch(...){if(output!=INVALID_HANDLE_VALUE&&!pipe)CloseHandle(output);freeStream(input);throw;}
}
int main(int argc,char** argv) {
 try {initialize();}catch(const std::exception& e){std::cout<<json({{"fatal",e.what()}}).dump()<<std::endl;return 1;}
 std::string line;
 if(argc==2&&(std::string(argv[1])=="--file-info-json"||std::string(argv[1])=="--decode-json"||std::string(argv[1])=="--decode-stream-json")) {
   try {
     if(!std::getline(std::cin,line)||line.size()>65536)throw std::runtime_error("Invalid decoder request");
     auto request=json::parse(line);json result;
     if(std::string(argv[1])=="--decode-stream-json"){request["accurate"]=true;decodeFile(request,true);BASS_Free();return 0;}
     if(std::string(argv[1])=="--decode-json")result=decodeFile(request);
     else {request["mode"]="pcm";request["maxBytes"]=0;result=inspect(request);}
     std::cout<<result.dump()<<std::endl;BASS_Free();return 0;
   }catch(const std::exception& e){(std::string(argv[1])=="--decode-stream-json"?std::cerr:std::cout)<<json({{"error",e.what()}}).dump()<<std::endl;BASS_Free();return 1;}
 }
 while(std::getline(std::cin,line)) {
   json request;json response;
   try {if(line.size()>1048576)throw std::runtime_error("Command exceeds limit");request=json::parse(line);response=command(request);response["ok"]=true;}
   catch(const std::exception& e){response={{"ok",false},{"error",e.what()}};}
   response["id"]=request.is_object()&&request.contains("id")&&request["id"].is_number_integer()?request["id"]:json(0);std::cout<<response.dump()<<std::endl;
   if(response.value("shutdown",false))break;
 }
 stop();lspIdleEditor.reset();BASS_Free();return 0;
}
