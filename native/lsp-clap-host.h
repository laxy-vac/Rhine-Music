#pragma once

// Fixed, bundled LSP CLAP host. This is deliberately not a user plugin scanner.
// CLAP lifecycle, editor and state calls run on one Windows message thread;
// PCM processing stays on the existing producer, never the device callback.
#include "../vendor/audio/lsp-plugin/clap/include/clap/clap.h"
#include "json.hpp"
#include <windows.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <deque>
#include <functional>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace rhine {
class LspPluginEq;
inline thread_local bool lspAudioThread=false;
class LspMainThread {
  std::thread thread_;
  DWORD id_=0;
  HANDLE wake_=nullptr;
  std::atomic<bool> quit_{false};
  std::mutex mutex_;
  std::deque<std::function<void()>> jobs_;
  std::vector<LspPluginEq*> instances_;
  void run();
 public:
  LspMainThread() {
    wake_=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    if(!wake_)throw std::runtime_error("Cannot create LSP editor event");
    std::promise<void> ready;auto future=ready.get_future();
    thread_=std::thread([this,&ready]{id_=GetCurrentThreadId();ready.set_value();run();});future.get();
  }
  ~LspMainThread(){quit_=true;SetEvent(wake_);if(thread_.joinable())thread_.join();CloseHandle(wake_);}
  static LspMainThread& get(){static LspMainThread value;return value;}
  bool isMain()const{return GetCurrentThreadId()==id_;}
  template<class F> auto invoke(F&& fn)->decltype(fn()) {
    if(isMain())return fn();
    using R=decltype(fn());auto task=std::make_shared<std::packaged_task<R()>>(std::forward<F>(fn));auto result=task->get_future();
    {std::lock_guard<std::mutex> lock(mutex_);jobs_.emplace_back([task]{(*task)();});}SetEvent(wake_);return result.get();
  }
  void add(LspPluginEq* instance){instances_.push_back(instance);}
  void remove(LspPluginEq* instance){instances_.erase(std::remove(instances_.begin(),instances_.end(),instance),instances_.end());}
};

class LspPluginEq {
  friend class LspMainThread;
  static constexpr size_t stateLimit=512*1024;
  static constexpr uint32_t blockLimit=4096;
  static constexpr UINT resizeMessage=WM_APP+41,showMessage=WM_APP+42,hideMessage=WM_APP+43;
  const clap_plugin_t* plugin_=nullptr;
  const clap_plugin_gui_t* gui_=nullptr;
  const clap_plugin_state_t* state_=nullptr;
  const clap_plugin_params_t* params_=nullptr;
  const clap_plugin_latency_t* latencyExt_=nullptr;
  const clap_plugin_timer_support_t* timerExt_=nullptr;
  clap_host_t host_{};
  HWND window_=nullptr;
  bool guiCreated_=false,guiAttached_=false,activated_=false,started_=false;
  bool previewOnly_=false;
  std::thread previewThread_;
  std::atomic<bool> previewStop_{false},previewFault_{false};
  std::atomic<bool> editorOpen_{false},callback_{false},flush_{false},restart_{false};
  bool pausedPreviewDirty_=false;
  std::mutex* previewGate_=nullptr;
  const std::atomic<bool>* transportPaused_=nullptr;
  inline static std::atomic<uint64_t> instanceRevision_{1};
  std::atomic<uint64_t> revision_{instanceRevision_.fetch_add(uint64_t(1)<<32,std::memory_order_relaxed)};
  std::atomic<uint32_t> latency_{0};
  int rate_=48000,channels_=2;
  int64_t steadyTime_=0;
  std::array<std::array<float,blockLimit>,2> input_{},output_{};
  struct Timer{uint32_t period;ULONGLONG due;};
  std::map<clap_id,Timer> timers_;clap_id nextTimer_=1;
  static LspPluginEq& self(const clap_host_t* h){return *static_cast<LspPluginEq*>(h->host_data);}
  static uint32_t CLAP_ABI inputSize(const clap_input_events_t*){return 0;}
  static const clap_event_header_t* CLAP_ABI inputEvent(const clap_input_events_t*,uint32_t){return nullptr;}
  static bool CLAP_ABI outputEvent(const clap_output_events_t* list,const clap_event_header_t* event){
    if(!event||event->size<sizeof(clap_event_header_t))return false;
    if(event->space_id==CLAP_CORE_EVENT_SPACE_ID&&(event->type==CLAP_EVENT_PARAM_VALUE||event->type==CLAP_EVENT_PARAM_MOD))
      static_cast<LspPluginEq*>(list->ctx)->revision_.fetch_add(1,std::memory_order_relaxed);
    return true;
  }
  clap_input_events_t inEvents_{this,inputSize,inputEvent};
  clap_output_events_t outEvents_{this,outputEvent};
  static const void* CLAP_ABI extension(const clap_host_t*,const char* id) {
    static const clap_host_thread_check_t threadCheck{
      [](const clap_host_t*)->bool{return LspMainThread::get().isMain();},
      [](const clap_host_t*)->bool{return lspAudioThread;}};
    static const clap_host_params_t params{
      [](const clap_host_t* h,clap_param_rescan_flags){self(h).revision_.fetch_add(1,std::memory_order_relaxed);},
      [](const clap_host_t*,clap_id,clap_param_clear_flags){},
      [](const clap_host_t* h){self(h).flush_=true;}};
    static const clap_host_state_t state{[](const clap_host_t* h){self(h).revision_.fetch_add(1,std::memory_order_relaxed);}};
    static const clap_host_latency_t latency{[](const clap_host_t* h){self(h).restart_=true;}};
    static const clap_host_tail_t tail{[](const clap_host_t*){}};
    static const clap_host_log_t log{[](const clap_host_t*,clap_log_severity,const char*){}};
    static const clap_host_gui_t gui{
      [](const clap_host_t*){},
      [](const clap_host_t* h,uint32_t w,uint32_t height)->bool{auto& s=self(h);return s.window_&&w>=64&&height>=64&&w<=8192&&height<=8192&&PostMessageW(s.window_,resizeMessage,w,height);},
      [](const clap_host_t* h)->bool{auto& s=self(h);return s.window_&&PostMessageW(s.window_,showMessage,0,0);},
      [](const clap_host_t* h)->bool{auto& s=self(h);return s.window_&&PostMessageW(s.window_,hideMessage,0,0);},
      [](const clap_host_t* h,bool destroyed){auto& s=self(h);if(s.window_)PostMessageW(s.window_,hideMessage,destroyed?1:0,0);}};
    static const clap_host_timer_support_t timers{
      [](const clap_host_t* h,uint32_t period,clap_id* id)->bool{auto& s=self(h);if(!id||s.timers_.size()>=64)return false;*id=s.nextTimer_++;period=std::max<uint32_t>(period,10);s.timers_[*id]={period,GetTickCount64()+period};return true;},
      [](const clap_host_t* h,clap_id id)->bool{return self(h).timers_.erase(id)!=0;}};
    if(!std::strcmp(id,CLAP_EXT_THREAD_CHECK))return &threadCheck;
    if(!std::strcmp(id,CLAP_EXT_PARAMS))return &params;
    if(!std::strcmp(id,CLAP_EXT_STATE))return &state;
    if(!std::strcmp(id,CLAP_EXT_LATENCY))return &latency;
    if(!std::strcmp(id,CLAP_EXT_TAIL))return &tail;
    if(!std::strcmp(id,CLAP_EXT_LOG))return &log;
    if(!std::strcmp(id,CLAP_EXT_GUI))return &gui;
    if(!std::strcmp(id,CLAP_EXT_TIMER_SUPPORT))return &timers;
    return nullptr;
  }
  struct Module {
    HMODULE handle=nullptr;const clap_plugin_entry_t* entry=nullptr;const clap_plugin_factory_t* factory=nullptr;
    std::string pluginId;
    Module(){
      wchar_t executable[32768];DWORD size=GetModuleFileNameW(nullptr,executable,32768);
      if(!size||size>=32768)throw std::runtime_error("Cannot locate bundled LSP plugin");
      std::wstring file(executable,size);const auto slash=file.find_last_of(L"\\/");if(slash==std::wstring::npos)throw std::runtime_error("Invalid bundled LSP plugin directory");file.resize(slash+1);file+=L"lsp-para-equalizer.clap";
      handle=LoadLibraryExW(file.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
      if(!handle)throw std::runtime_error("LSP native plugin is unavailable (Windows "+std::to_string(GetLastError())+")");
      entry=reinterpret_cast<const clap_plugin_entry_t*>(GetProcAddress(handle,"clap_entry"));
      if(!entry||!clap_version_is_compatible(entry->clap_version))throw std::runtime_error("Invalid bundled LSP CLAP entry");
      const int bytes=WideCharToMultiByte(CP_UTF8,0,file.c_str(),-1,nullptr,0,nullptr,nullptr);if(bytes<=0)throw std::runtime_error("Cannot encode bundled LSP plugin path");std::string utf8(bytes,'\0');if(WideCharToMultiByte(CP_UTF8,0,file.c_str(),-1,utf8.data(),bytes,nullptr,nullptr)!=bytes)throw std::runtime_error("Cannot encode bundled LSP plugin path");
      if(!entry->init(utf8.c_str()))throw std::runtime_error("LSP CLAP initialization failed");
      factory=static_cast<const clap_plugin_factory_t*>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
      if(!factory)throw std::runtime_error("LSP CLAP factory unavailable");
      // Only the pinned x32 stereo PEQ is accepted, even if the library exposes
      // other upstream plugins. Never accept a path or identifier from the UI.
      for(uint32_t i=0;i<factory->get_plugin_count(factory);++i){const auto* d=factory->get_plugin_descriptor(factory,i);
        if(d&&d->id&&std::string(d->id)=="in.lsp-plug.para_equalizer_x32_stereo"){pluginId=d->id;break;}}
      if(pluginId.empty())throw std::runtime_error("Bundled LSP x32 stereo PEQ not found");
    }
    ~Module(){
      // main() stops producers and destroys all processors before static
      // teardown. The GUI dispatcher was created before this module and is
      // still alive, so entry deinit and library detach share its main thread.
      LspMainThread::get().invoke([&]{entry->deinit();FreeLibrary(handle);});
    }
  };
  static Module& module(){static Module value;return value;}
  static std::string encode(const std::vector<uint8_t>& bytes){
    static const char table[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";std::string out;out.reserve((bytes.size()+2)/3*4);
    for(size_t i=0;i<bytes.size();i+=3){uint32_t n=uint32_t(bytes[i])<<16;if(i+1<bytes.size())n|=uint32_t(bytes[i+1])<<8;if(i+2<bytes.size())n|=bytes[i+2];out+=table[(n>>18)&63];out+=table[(n>>12)&63];out+=i+1<bytes.size()?table[(n>>6)&63]:'=';out+=i+2<bytes.size()?table[n&63]:'=';}return out;
  }
  static std::vector<uint8_t> decode(const std::string& text){
    if(text.size()>((stateLimit+2)/3)*4||text.size()%4)throw std::runtime_error("Invalid LSP plugin state size");
    std::vector<uint8_t> bytes;bytes.reserve(text.size()/4*3);
    auto digit=[](char c)->int{if(c>='A'&&c<='Z')return c-'A';if(c>='a'&&c<='z')return c-'a'+26;if(c>='0'&&c<='9')return c-'0'+52;if(c=='+')return 62;if(c=='/')return 63;return -1;};
    for(size_t i=0;i<text.size();i+=4){int a=digit(text[i]),b=digit(text[i+1]),c=text[i+2]=='='?0:digit(text[i+2]),d=text[i+3]=='='?0:digit(text[i+3]);
      if(a<0||b<0||c<0||d<0||(text[i+2]=='='&&text[i+3]!='=')||((text[i+2]=='='||text[i+3]=='=')&&i+4!=text.size()))throw std::runtime_error("Invalid LSP plugin state encoding");
      uint32_t n=(a<<18)|(b<<12)|(c<<6)|d;bytes.push_back(n>>16);if(text[i+2]!='=')bytes.push_back(n>>8);if(text[i+3]!='=')bytes.push_back(n);}
    if(bytes.size()>stateLimit||encode(bytes)!=text)throw std::runtime_error("Invalid LSP plugin state encoding");return bytes;
  }
  void load(const std::string& encoded){
    if(encoded.empty())return;auto bytes=decode(encoded);struct Reader{const std::vector<uint8_t>* bytes;size_t offset=0;} reader{&bytes};
    clap_istream_t stream{&reader,[](const clap_istream_t* s,void* data,uint64_t size)->int64_t{auto& r=*static_cast<Reader*>(s->ctx);size=std::min<uint64_t>(size,r.bytes->size()-r.offset);std::memcpy(data,r.bytes->data()+r.offset,size);r.offset+=size;return size;}};
    if(!state_->load(plugin_,&stream))throw std::runtime_error("LSP plugin state could not be restored");
  }
  std::string save(){
    std::vector<uint8_t> bytes;bytes.reserve(32768);
    clap_ostream_t stream{&bytes,[](const clap_ostream_t* s,const void* data,uint64_t size)->int64_t{auto& b=*static_cast<std::vector<uint8_t>*>(s->ctx);if(size>stateLimit-b.size())return -1;const auto* p=static_cast<const uint8_t*>(data);b.insert(b.end(),p,p+size);return size;}};
    if(!state_->save(plugin_,&stream))throw std::runtime_error("LSP plugin state could not be saved");return encode(bytes);
  }
  static LRESULT CALLBACK windowProc(HWND window,UINT message,WPARAM w,LPARAM l){
    auto* s=reinterpret_cast<LspPluginEq*>(GetWindowLongPtrW(window,GWLP_USERDATA));
    if(message==WM_NCCREATE){s=static_cast<LspPluginEq*>(reinterpret_cast<CREATESTRUCTW*>(l)->lpCreateParams);SetWindowLongPtrW(window,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(s));}
    if(s&&message==WM_CLOSE){s->hide();return 0;}
    if(s&&message==resizeMessage){s->resize(static_cast<uint32_t>(w),static_cast<uint32_t>(l));return 0;}
    if(s&&message==showMessage){try{s->show();}catch(...){s->editorOpen_=false;}return 0;}
    if(s&&message==hideMessage){if(w){s->guiCreated_=false;s->guiAttached_=false;s->editorOpen_=false;ShowWindow(window,SW_HIDE);}else s->hide();return 0;}
    if(s&&message==WM_SIZE&&s->guiAttached_&&w!=SIZE_MINIMIZED&&s->gui_->can_resize(s->plugin_)){s->gui_->set_size(s->plugin_,LOWORD(l),HIWORD(l));return 0;}
    return DefWindowProcW(window,message,w,l);
  }
  bool resize(uint32_t width,uint32_t height){
    if(!window_||width<64||height<64||width>8192||height>8192)return false;
    RECT r{0,0,static_cast<LONG>(width),static_cast<LONG>(height)};AdjustWindowRectEx(&r,static_cast<DWORD>(GetWindowLongPtrW(window_,GWL_STYLE)),FALSE,0);
    return SetWindowPos(window_,nullptr,0,0,r.right-r.left,r.bottom-r.top,SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE)!=0;
  }
  void show(){
    if(window_&&!guiCreated_){DestroyWindow(window_);window_=nullptr;}
    if(window_){if(!gui_->show(plugin_))throw std::runtime_error("Cannot show LSP native editor");ShowWindow(window_,SW_RESTORE);SetForegroundWindow(window_);editorOpen_=true;return;}
    if(!gui_->is_api_supported(plugin_,CLAP_WINDOW_API_WIN32,false)||!gui_->create(plugin_,CLAP_WINDOW_API_WIN32,false))throw std::runtime_error("LSP native Win32 editor is unavailable");
    guiCreated_=true;
    WNDCLASSW cls{};cls.lpfnWndProc=windowProc;cls.hInstance=GetModuleHandleW(nullptr);cls.lpszClassName=L"RhineLspOriginalEditor";cls.hCursor=LoadCursorW(nullptr,MAKEINTRESOURCEW(32512));RegisterClassW(&cls);
    DWORD style=WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX;if(gui_->can_resize(plugin_))style|=WS_THICKFRAME|WS_MAXIMIZEBOX;
    window_=CreateWindowExW(0,cls.lpszClassName,L"LSP Parametric Equalizer · Rhine Music",style,CW_USEDEFAULT,CW_USEDEFAULT,960,720,nullptr,nullptr,cls.hInstance,this);
    if(!window_)throw std::runtime_error("Cannot create LSP editor window");
    clap_window_t parent{};parent.api=CLAP_WINDOW_API_WIN32;parent.win32=window_;
    if(!gui_->set_parent(plugin_,&parent))throw std::runtime_error("Cannot attach LSP native editor");
    guiAttached_=true;
    uint32_t width=0,height=0;if(gui_->get_size(plugin_,&width,&height))resize(width,height);
    if(!gui_->show(plugin_))throw std::runtime_error("Cannot show LSP native editor");
    ShowWindow(window_,SW_SHOW);SetForegroundWindow(window_);editorOpen_=true;
  }
  void hide(){if(guiCreated_)gui_->hide(plugin_);if(window_)ShowWindow(window_,SW_HIDE);editorOpen_=false;}
  void primeProcessor(){
    std::exception_ptr failure;
    std::thread prepare([&]{
      try{std::array<double,128> silence{};process(silence.data(),64,channels_);}catch(...){failure=std::current_exception();}
      if(started_){lspAudioThread=true;plugin_->stop_processing(plugin_);lspAudioThread=false;started_=false;}
    });prepare.join();if(failure)std::rethrow_exception(failure);
    latency_=latencyExt_?latencyExt_->get(plugin_):0;restart_=false;
  }
  void startPreview(){
    previewStop_=false;
    previewThread_=std::thread([this]{
      std::array<double,1024> silence{};
      while(!previewStop_.load(std::memory_order_acquire)){
        if(editorOpen()&&!restart_.load(std::memory_order_acquire)&&!previewFault_.load()){
          try{silence.fill(0);process(silence.data(),512,2);}catch(...){previewFault_=true;}
        }
        Sleep(10);
      }
      if(started_){lspAudioThread=true;plugin_->stop_processing(plugin_);lspAudioThread=false;started_=false;}
    });
  }
  void stopPreview(){previewStop_=true;if(previewThread_.joinable())previewThread_.join();}
  void tick(){
    if(previewOnly_&&!editorOpen()&&previewThread_.joinable())stopPreview();
    if(callback_.exchange(false,std::memory_order_acq_rel))plugin_->on_main_thread(plugin_);
    if(previewFault_.load()&&processingRequested())previewFault_=false;
    if(!previewOnly_&&editorOpen()&&previewGate_&&transportPaused_&&transportPaused_->load(std::memory_order_acquire)&&processingRequested()) {
      // Never block the GUI waiting for the producer/control thread (which may
      // itself be awaiting a GUI call). Both paths serialize this instance.
      std::unique_lock<std::mutex> access(*previewGate_,std::try_to_lock);
      if(access.owns_lock())try{refreshPausedPreview();}catch(...){previewFault_=true;}
    }
    if(previewOnly_&&restart_.load(std::memory_order_acquire)&&!previewFault_.load()) {
      stopPreview();
      try {
        plugin_->deactivate(plugin_);activated_=false;
        if(!plugin_->activate(plugin_,rate_,1,blockLimit))throw std::runtime_error("LSP preview reactivation failed");
        activated_=true;primeProcessor();if(editorOpen())startPreview();
      }catch(...){previewFault_=true;}
    }
    if(!activated_&&flush_.exchange(false,std::memory_order_acq_rel)&&params_)params_->flush(plugin_,&inEvents_,&outEvents_);
    if(timerExt_){const auto now=GetTickCount64();std::vector<clap_id> due;for(auto& [id,t]:timers_)if(t.due<=now){t.due=now+t.period;due.push_back(id);}for(auto id:due)if(timers_.count(id))timerExt_->on_timer(plugin_,id);}
  }
  void release(){
    guiAttached_=false;
    if(guiCreated_){gui_->hide(plugin_);gui_->destroy(plugin_);guiCreated_=false;}if(window_){DestroyWindow(window_);window_=nullptr;}
    if(plugin_){if(activated_)plugin_->deactivate(plugin_);activated_=false;plugin_->destroy(plugin_);plugin_=nullptr;}
  }
 public:
  LspPluginEq(const nlohmann::json& settings,int rate,int channels,bool musicInstance=true):previewOnly_(!musicInstance),rate_(rate),channels_(channels){
    if(rate<8000||rate>768000||channels<1||channels>2)throw std::runtime_error("Invalid LSP plugin audio format");
    if(rate>384000)throw std::runtime_error("LSP PEQ supports input rates up to 384 kHz; select the basic EQ or disable EQ for this source. Output resampling up to 768 kHz remains available.");
    host_.clap_version=CLAP_VERSION;host_.host_data=this;host_.name="Rhine Music";host_.vendor="Rhine";host_.url="";host_.version="1.0";host_.get_extension=extension;
    host_.request_restart=[](const clap_host_t* h){self(h).restart_=true;};host_.request_process=[](const clap_host_t* h){self(h).flush_=true;};host_.request_callback=[](const clap_host_t* h){self(h).callback_=true;};
    LspMainThread::get().invoke([&]{try{
      auto& m=module();plugin_=m.factory->create_plugin(m.factory,&host_,m.pluginId.c_str());
      if(!plugin_||!plugin_->init(plugin_))throw std::runtime_error("LSP PEQ initialization failed");
      gui_=static_cast<const clap_plugin_gui_t*>(plugin_->get_extension(plugin_,CLAP_EXT_GUI));state_=static_cast<const clap_plugin_state_t*>(plugin_->get_extension(plugin_,CLAP_EXT_STATE));
      params_=static_cast<const clap_plugin_params_t*>(plugin_->get_extension(plugin_,CLAP_EXT_PARAMS));latencyExt_=static_cast<const clap_plugin_latency_t*>(plugin_->get_extension(plugin_,CLAP_EXT_LATENCY));timerExt_=static_cast<const clap_plugin_timer_support_t*>(plugin_->get_extension(plugin_,CLAP_EXT_TIMER_SUPPORT));
      if(!gui_||!state_)throw std::runtime_error("LSP PEQ requires its native GUI and state extensions");
      const auto* ports=static_cast<const clap_plugin_audio_ports_t*>(plugin_->get_extension(plugin_,CLAP_EXT_AUDIO_PORTS));clap_audio_port_info_t in{},out{};
      if(!ports||ports->count(plugin_,true)!=1||ports->count(plugin_,false)!=1||!ports->get(plugin_,0,true,&in)||!ports->get(plugin_,0,false,&out)||in.channel_count!=2||out.channel_count!=2)
        throw std::runtime_error("LSP PEQ must expose one stereo input and output");
      load(settings.value("pluginState",std::string()));
      if(!plugin_->activate(plugin_,rate_,1,blockLimit))throw std::runtime_error("LSP PEQ activation failed");activated_=true;
      // Upstream applies restored controls in its first process call. Prime
      // with zero history before querying latency, without opening a device.
      primeProcessor();
      LspMainThread::get().add(this);
    }catch(...){release();throw;}});
  }
  LspPluginEq(const LspPluginEq&)=delete;LspPluginEq& operator=(const LspPluginEq&)=delete;
  ~LspPluginEq(){
    LspMainThread::get().invoke([&]{previewGate_=nullptr;transportPaused_=nullptr;if(previewOnly_)stopPreview();LspMainThread::get().remove(this);});
    if(!previewOnly_&&started_){lspAudioThread=true;plugin_->stop_processing(plugin_);lspAudioThread=false;started_=false;}
    LspMainThread::get().invoke([&]{release();});
  }
  void reset(){if(!activated_)return;lspAudioThread=true;plugin_->reset(plugin_);lspAudioThread=false;steadyTime_=0;}
  size_t latencyFrames()const{return latency_.load(std::memory_order_acquire);}
  bool needsRestart()const{return restart_.load(std::memory_order_acquire);}
  bool hasProcessed()const{return started_;}
  bool pausedPreviewDirty()const{return pausedPreviewDirty_;}
  bool processingRequested()const{return flush_.load(std::memory_order_acquire);}
  void setPausedPreviewGate(std::mutex* gate,const std::atomic<bool>* paused){LspMainThread::get().invoke([&]{previewGate_=gate;transportPaused_=paused;});}
  void refreshPausedPreview(){
    if(previewOnly_)return;
    pausedPreviewDirty_=true;std::array<double,128> silence{};process(silence.data(),64,channels_);
  }
  bool editorOpen()const{return editorOpen_.load(std::memory_order_acquire);}
  nlohmann::json editor(const std::string& action){return LspMainThread::get().invoke([&]{
    if(action=="open") {
      try{show();}catch(...){guiAttached_=false;if(guiCreated_){gui_->destroy(plugin_);guiCreated_=false;}if(window_){DestroyWindow(window_);window_=nullptr;}editorOpen_=false;throw;}
    }else if(action=="close")hide();else if(action!="state")throw std::runtime_error("Invalid LSP editor action");
    tick();if(previewOnly_)stopPreview();
    try {
      nlohmann::json result{{"editorOpen",editorOpen()},{"pluginState",save()},{"revision",revision_.load()},{"latencyFrames",latencyFrames()},{"restartRequired",needsRestart()}};
      if(previewOnly_&&editorOpen())startPreview();return result;
    }catch(...){if(previewOnly_&&editorOpen()&&!previewFault_.load())startPreview();throw;}
  });}
  void process(double* data,size_t frames,int channels){
    if(!activated_||channels!=channels_)throw std::runtime_error("LSP PEQ audio format mismatch");
    struct AudioScope{AudioScope(){lspAudioThread=true;}~AudioScope(){lspAudioThread=false;}} scope;
    if(!started_){if(!plugin_->start_processing(plugin_))throw std::runtime_error("LSP PEQ processing could not start");started_=true;}
    while(frames){const uint32_t count=static_cast<uint32_t>(std::min<size_t>(frames,blockLimit));
      for(uint32_t i=0;i<count;++i){input_[0][i]=static_cast<float>(data[i*channels]);input_[1][i]=static_cast<float>(data[i*channels+(channels==2?1:0)]);}
      float* in[2]={input_[0].data(),input_[1].data()};float* out[2]={output_[0].data(),output_[1].data()};
      clap_audio_buffer_t input{in,nullptr,2,0,0},output{out,nullptr,2,0,0};
      clap_process_t process{};process.steady_time=steadyTime_;process.frames_count=count;process.audio_inputs=&input;process.audio_outputs=&output;process.audio_inputs_count=1;process.audio_outputs_count=1;process.in_events=&inEvents_;process.out_events=&outEvents_;
      flush_.exchange(false,std::memory_order_acq_rel);
      if(plugin_->process(plugin_,&process)==CLAP_PROCESS_ERROR)throw std::runtime_error("LSP PEQ processing failed");
      const bool latencyChanged=restart_.load(std::memory_order_acquire);
      for(uint32_t i=0;i<count;++i)for(int channel=0;channel<channels;++channel){const float value=output_[channel][i];if(!std::isfinite(value))throw std::runtime_error("LSP PEQ returned a non-finite sample");data[i*channels+channel]=latencyChanged?0.0:value;}
      steadyTime_+=count;data+=count*channels;frames-=count;
    }
  }
};

inline void LspMainThread::run(){
  MSG message;PeekMessageW(&message,nullptr,0,0,PM_NOREMOVE);CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
  while(!quit_.load()){
    MsgWaitForMultipleObjects(1,&wake_,FALSE,16,QS_ALLINPUT);
    std::deque<std::function<void()>> jobs;{std::lock_guard<std::mutex> lock(mutex_);jobs.swap(jobs_);}for(auto& job:jobs)job();
    while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){TranslateMessage(&message);DispatchMessageW(&message);}
    for(auto* instance:instances_)instance->tick();
  }
  CoUninitialize();
}
} // namespace rhine
