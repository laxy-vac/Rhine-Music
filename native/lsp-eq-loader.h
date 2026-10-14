#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
#include "json.hpp"

namespace rhine {

// Narrow replaceable ABI: the upstream LGPL DSP implementation stays in its
// own library. Loading/configuration are control-thread work, never callbacks.
class LspEq {
  struct Api {
    using Version=uint32_t(*)();
    using Create=void*(*)(const char*,uint32_t,uint32_t,char*,uint32_t);
    using Destroy=void(*)(void*);
    using Reset=void(*)(void*);
    using Process=int(*)(void*,double*,uint32_t);
    using Latency=uint32_t(*)(void*);
    using Response=int(*)(void*,int32_t,uint32_t,const float*,float*,uint32_t);
    Create create=nullptr;Destroy destroy=nullptr;Reset reset=nullptr;
    Process process=nullptr;Latency latency=nullptr;Response response=nullptr;
    Api() {
#ifdef _WIN32
      std::vector<wchar_t> path(32768);
      const DWORD length=GetModuleFileNameW(nullptr,path.data(),static_cast<DWORD>(path.size()));
      if(!length||length>=path.size())throw std::runtime_error("Cannot locate the native audio executable for LSP");
      std::wstring file(path.data(),length);
      const auto slash=file.find_last_of(L"\\/");
      if(slash==std::wstring::npos)throw std::runtime_error("Invalid native audio executable path for LSP");
      file.resize(slash+1);file+=L"rhine-lsp-eq.dll";
      const HMODULE library=LoadLibraryExW(file.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
      if(!library)throw std::runtime_error("LSP EQ library is unavailable (Windows error "+std::to_string(GetLastError())+")");
      // Keep loaded for process lifetime; all processors may outlive static
      // initializers. Windows releases the module when the audio host exits.
      auto symbol=[&](const char* name){const auto result=GetProcAddress(library,name);if(!result)throw std::runtime_error(std::string("LSP EQ ABI is missing ")+name);return result;};
      const auto version=reinterpret_cast<Version>(symbol("rhine_lsp_eq_version"));
      if(version()!=1)throw std::runtime_error("Unsupported LSP EQ bridge version");
      create=reinterpret_cast<Create>(symbol("rhine_lsp_eq_create"));
      destroy=reinterpret_cast<Destroy>(symbol("rhine_lsp_eq_destroy"));
      reset=reinterpret_cast<Reset>(symbol("rhine_lsp_eq_reset"));
      process=reinterpret_cast<Process>(symbol("rhine_lsp_eq_process"));
      latency=reinterpret_cast<Latency>(symbol("rhine_lsp_eq_latency"));
      response=reinterpret_cast<Response>(symbol("rhine_lsp_eq_response"));
#else
      throw std::runtime_error("LSP EQ requires the Windows native audio host");
#endif
    }
  };
  static const Api& api(){static const Api value;return value;}
  void* instance_=nullptr;
  size_t latency_=0;
 public:
  LspEq(const nlohmann::json& settings,int rate,int channels) {
    if(rate<8000||rate>768000||channels<1||channels>2)throw std::runtime_error("Invalid LSP EQ sample format");
    const std::string text=settings.dump();char error[2048]={};
    instance_=api().create(text.c_str(),static_cast<uint32_t>(rate),static_cast<uint32_t>(channels),error,sizeof(error));
    if(!instance_)throw std::runtime_error(std::string("LSP EQ: ")+(error[0]?error:"configuration failed"));
    latency_=api().latency(instance_);
  }
  LspEq(const LspEq&)=delete;LspEq& operator=(const LspEq&)=delete;
  ~LspEq(){if(instance_)api().destroy(instance_);}
  void reset(){api().reset(instance_);}
  size_t latencyFrames() const{return latency_;}
  void process(double* samples,size_t frames,int channels) {
    while(frames) {
      const size_t count=std::min<size_t>(frames,4096);
      if(api().process(instance_,samples,static_cast<uint32_t>(count))!=0)throw std::runtime_error("LSP EQ processing failed");
      samples+=count*static_cast<size_t>(channels);frames-=count;
    }
  }
  std::vector<float> response(int band,unsigned channel,const std::vector<float>& frequencies) {
    std::vector<float> db(frequencies.size());
    if(api().response(instance_,band,channel,frequencies.data(),db.data(),static_cast<uint32_t>(db.size()))!=0)
      throw std::runtime_error("LSP EQ response calculation failed");
    return db;
  }
};
} // namespace rhine
