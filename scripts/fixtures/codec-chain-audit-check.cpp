#include "../../native/pcm-file-decoder.h"
#include <fstream>
#include <iostream>

static std::wstring utf16(const char* text) {
  const int length=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,nullptr,0);
  if(!length)throw std::runtime_error("Invalid audit path");std::wstring out(length,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,text,-1,out.data(),length);out.pop_back();return out;
}
int main(int argc,char** argv) {
 try {
  if(argc!=5)throw std::runtime_error("Expected codec directory, input, golden F64 and decoder name");
  std::ifstream golden(argv[3],std::ios::binary|std::ios::ate);if(!golden)throw std::runtime_error("Golden file missing");
  const auto length=golden.tellg();if(length<=0||length%16)throw std::runtime_error("Invalid golden stereo frames");
  std::vector<double> expected(static_cast<size_t>(length)/8);golden.seekg(0);golden.read(reinterpret_cast<char*>(expected.data()),length);
  auto source=rhine::PcmFileDecoder::open(utf16(argv[2]),utf16(argv[1]));const auto info=source->info();
  if(info.decoderName!=argv[4]||info.channels!=2||info.sampleRate!=48000)throw std::runtime_error("Wrong decoder routing or sample rate");
  std::vector<double> block(254);size_t offset=0;bool eof=false;const ULONGLONG deadline=GetTickCount64()+5000;
  while(!eof) {
   const auto got=source->read(block.data(),127);if(!got.error.empty())throw std::runtime_error(got.error);
   if(offset+got.frames*2>expected.size())throw std::runtime_error("Decoder emitted extra samples");
   for(size_t i=0;i<got.frames*2;i++)if(block[i]!=expected[offset+i])throw std::runtime_error("Decoded sample differs from independent golden PCM");
   offset+=got.frames*2;eof=got.eof;if(!got.frames&&!eof){if(GetTickCount64()>deadline)throw std::runtime_error("Decoder stalled");Sleep(1);}
  }
  if(offset!=expected.size()||source->exactTotalFrames()!=expected.size()/2)throw std::runtime_error("Real EOF frame count mismatch");
  for(const uint64_t target:{uint64_t(0),uint64_t(137),static_cast<uint64_t>(expected.size()/2-1)}) {
   source->seek(target);const auto got=source->read(block.data(),1);if(!got.error.empty()||got.frames!=1)throw std::runtime_error("Accurate seek did not return the requested frame");
   if(block[0]!=expected[target*2]||block[1]!=expected[target*2+1]){std::cerr<<"Seek target "<<target<<" got "<<block[0]<<","<<block[1]<<" expected "<<expected[target*2]<<","<<expected[target*2+1]<<"\n";throw std::runtime_error("Accurate seek changed a sample or frame position");}
  }
  std::cout<<"PASS "<<info.decoderName<<" "<<info.decodedSampleFormat<<" "<<expected.size()/2<<" stereo frames and seeks\n";
  if(std::string(argv[2]).find("pcm16.")!=std::string::npos){source.reset();DWORD before=0,after=0;GetProcessHandleCount(GetCurrentProcess(),&before);for(int i=0;i<8;i++){auto repeat=rhine::PcmFileDecoder::open(utf16(argv[2]),utf16(argv[1]));repeat->seek(137);}GetProcessHandleCount(GetCurrentProcess(),&after);std::cout<<info.decoderName<<" decoder lifecycle handles "<<before<<" -> "<<after<<"\n";if(after>before+2)throw std::runtime_error("Repeated decoder lifecycle leaked process handles");}
 }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
