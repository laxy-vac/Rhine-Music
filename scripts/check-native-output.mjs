import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { NativeOutput,outputSettings } from './native-output.mjs'
import { normalizeProcessing } from '../src/audio-processing-model.mjs'
import { dsdFixture,silentWav,taggedDsf } from './audio-fixtures.mjs'
const scriptDir=path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot=path.resolve(scriptDir,'../../.task-tmp/native-output');
const fixturePrefix='rhine-native-';
const ownedFixtures=new Set();
const settings={backend:'wasapi',device:-1,channel:0,dsdMode:'pcm',wasapiDevice:'default',wasapiMode:'shared',wasapiDsdMode:'pcm',processing:normalizeProcessing()};
const request=(session,trackId='first')=>({session,trackId,settings,volume:0,position:0});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function samePath(a,b) {
 const left=path.normalize(path.resolve(a)),right=path.normalize(path.resolve(b));
 return process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
}
async function prepareFixtureRoot() {
 await fs.mkdir(fixtureRoot,{recursive:true});
 const info=await fs.lstat(fixtureRoot);
 if(info.isSymbolicLink()||!info.isDirectory())throw new Error('原生音频测试临时根目录不是普通目录');
 const real=await fs.realpath(fixtureRoot);
 if(!samePath(real,fixtureRoot))throw new Error('原生音频测试临时根目录解析到了其他位置');
 return real;
}
async function assertNoSymlinks(directory) {
 for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
  const target=path.join(directory,entry.name),info=await fs.lstat(target);
  if(info.isSymbolicLink())throw new Error(`拒绝清理包含符号链接的合成 fixture：${target}`);
  if(info.isDirectory())await assertNoSymlinks(target);
 }
}
async function removeFixture(root,directory) {
 const absolute=path.resolve(directory),name=path.basename(absolute);
 if(!ownedFixtures.has(absolute)||!name.startsWith(fixturePrefix)||!samePath(path.dirname(absolute),root))throw new Error('拒绝清理不属于本测试的临时目录');
 const info=await fs.lstat(absolute);
 if(info.isSymbolicLink()||!info.isDirectory())throw new Error('拒绝清理已替换或非目录的合成 fixture');
 const real=await fs.realpath(absolute);
 if(!samePath(real,absolute)||!samePath(path.dirname(real),root)||!path.basename(real).startsWith(fixturePrefix))throw new Error('拒绝递归清理根目录外的合成 fixture');
 await assertNoSymlinks(real);
 await fs.rm(real,{recursive:true,force:false});
 ownedFixtures.delete(absolute);
}
async function decodeCli(executable,request,stream=true,pauseReader=0){
 const child=spawn(executable,[stream?'--decode-stream-json':'--decode-json'],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[],errors=[];
 child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));child.stdin.end(JSON.stringify(request)+'\n');
 if(pauseReader){child.stdout.pause();setTimeout(()=>child.stdout.resume(),pauseReader)}
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)}),data=Buffer.concat(chunks);
 assert.equal(code,0,Buffer.concat(errors).toString());
 if(!stream)return JSON.parse(data.toString());
 const end=data.indexOf(10),metadata=JSON.parse(data.subarray(0,end).toString());assert.equal(metadata.ready,true);const pcm=data.subarray(end+1);
 assert.equal(pcm.length,metadata.frames*8,'stream must retain its advertised exact frame count');return {metadata,pcm};
}
async function fixture(t) {
 const root=await prepareFixtureRoot(),directory=await fs.mkdtemp(path.join(root,fixturePrefix));
 ownedFixtures.add(path.resolve(directory));
 t.after(()=>removeFixture(root,directory));
 const file=path.join(directory,'合成 (静音).wav');await fs.writeFile(file,silentWav());
 return {directory,file};
}
test('native settings reject invalid routes and require an explicitly selected ASIO driver',()=>{
 const legacy={backend:'wasapi',device:-1,channel:0,dsdMode:'pcm'};
 assert.deepEqual(outputSettings(legacy),settings,'older saved settings receive the WASAPI defaults');
 assert.deepEqual(outputSettings(settings),settings);
 const exclusive={...settings,wasapiDevice:'synthetic-endpoint',wasapiMode:'exclusive'};
 assert.deepEqual(outputSettings(exclusive),exclusive);
 for(const value of [
  {...settings,backend:'browser'},
  {...settings,backend:'asio'},
  {...settings,channel:256},
  {...settings,dsdMode:'fake'},
  {...settings,wasapiDevice:''},
  {...settings,wasapiDevice:'x'.repeat(2049)},
  {...settings,wasapiDevice:'bad\0endpoint'},
  {...settings,wasapiDevice:'bad\rendpoint'},
  {...settings,wasapiDevice:'bad\nendpoint'},
  {...settings,wasapiMode:'exclusive-fallback'},
  {...settings,wasapiDsdMode:'native'},
 ])assert.throws(()=>outputSettings(value));
});

test('WASAPI device and mode reach the native open request',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),calls=[];
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 host.command=async value=>{calls.push(value);return {session:value.session,paused:true,position:value.position??0,duration:2}};
 const selected={...settings,wasapiDevice:'synthetic-endpoint',wasapiMode:'exclusive'};
 await host.start({...request(session),settings:selected});
 const opened=calls.find(value=>value.cmd==='open');
 assert.equal(opened.wasapiDevice,selected.wasapiDevice);assert.equal(opened.wasapiMode,'exclusive');
 await host.control({session,action:'stop'});
});

test('queued track adoption uses validated library paths and retains the next queued identity',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),calls=[];
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 let state={session,trackId:'first',position:0,duration:2,paused:true},releaseSecond;
 host.command=async value=>{
  calls.push(value);
  if(value.cmd==='queue'&&value.trackId==='second')return new Promise(resolve=>{releaseSecond=()=>{state={...state,trackId:'second',transitionSerial:1};resolve(state)}});
  if(value.cmd==='queue')return {...state,queueTrackId:value.trackId};
  if(value.cmd==='status')return state;
  return {...state,position:value.position??0};
 };
 await host.start(request(session));
 const second=host.queue({session,trackId:'second',file:'not-a-library-path.wav'});
 while(!releaseSecond)await sleep(1);
 await host.queue({session,trackId:'third'});releaseSecond();await second;
 assert.equal(host.active.trackId,'second');assert.equal(host.queued.trackId,'third');
 assert.equal(calls.find(value=>value.cmd==='queue').file,file);
 state={...state,trackId:'third',transitionSerial:2};await host.control({session,action:'status'});
 assert.equal(host.active.trackId,'third');assert.equal(host.queued,undefined);
 await host.control({session,action:'stop'});
});

test('effects update preserves an already prepared queue and forwards indexed ReplayGain',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),calls=[];
 const store={index:{albums:[{tracks:[{id:'first',replayGain:{trackGainDb:-6,trackPeak:.8}}]}]},trackFile:()=>({path:file,allowedRoot:directory})};
 const host=new NativeOutput({store});
 host.command=async value=>{calls.push(value);return {session,trackId:'first',queueTrackId:value.cmd==='queue'?value.trackId:value.cmd==='processing'?'second':undefined,position:0,duration:2}};
 await host.start(request(session));await host.queue({session,trackId:'second'});
 const processing=normalizeProcessing({float64:true,eq:{preamp:-3}});
 await host.control({session,action:'processing',processing});
 const updated=calls.find(value=>value.cmd==='processing');
 assert.equal(updated.processing.eq.preamp,-3);assert.equal(updated.replayGain.trackGainDb,-6);
 assert.equal(host.queueTracks.has('second'),true);assert.equal(host.active.settings.processing.float64,true);
 await host.control({session,action:'stop'});
});

test('Sony effects reconfiguration reuses the cache lease and full-track position',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),id='e'.repeat(64),calls=[];
 const job={id,trackId:'first',output:file,state:'ready',readers:0,settings:{dsee:true,dc:0,vinyl:0},result:{duration:60,positionOffset:30}};
 const sony={cacheDir:directory,jobs:new Map([[id,job]]),audio:async()=>({path:file,allowedRoot:directory}),view:()=>({state:'ready',progress:1})};
 const host=new NativeOutput({sony,store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 let position=5;
 host.command=async value=>{calls.push(value);if(value.cmd==='open')position=value.position;return {session,trackId:'first',position,duration:60,playing:value.cmd==='play'}};
 await host.start({...request(session),sonyJobId:id,sonySettings:job.settings,position:35});await host.control({session,action:'play'});
 position=8;
 const result=await host.control({session,action:'processing',processing:normalizeProcessing({eq:{preamp:-3}})});
 assert.equal(result.position,38);assert.equal(host.active.desiredPlaying,true);assert.equal(job.readers,1);
 assert.equal(calls.filter(value=>value.cmd==='open').length,2);assert.equal(calls.some(value=>value.cmd==='processing'),false);
 assert.equal(host.active.settings.processing.eq.preamp,-3);
 await host.control({session,action:'stop'});
});

test('WASAPI DoP keeps DSD routing, locks gain and rejects shared mode',async t=>{
 const {directory}=await fixture(t),file=path.join(directory,'synthetic-source.dsf');await fs.writeFile(file,Buffer.from('DSD synthetic route fixture'));
 const calls=[],host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 host.command=async value=>{calls.push(value);return {session:value.session,paused:true,mode:value.mode,position:0,duration:2}};
 const selected={...settings,wasapiMode:'exclusive',wasapiDsdMode:'dop'},session=randomUUID();
 await host.start({...request(session),settings:selected,volume:.2});
 assert.equal(calls[0].mode,'dop');assert.equal(calls[0].dsd,true);assert.equal(calls[0].wasapiMode,'exclusive');assert.equal(calls[0].volume,1);
 await host.control({session,action:'stop'});calls.length=0;
 await assert.rejects(host.start({...request(randomUUID()),settings:{...selected,wasapiMode:'shared'}}),/DoP.*独占/);
 assert.equal(calls.length,0,'Invalid DoP mode must not reach an output device');
 const id='e'.repeat(64);await assert.rejects(host.start({...request(randomUUID()),settings:selected,sonyJobId:id}),/PCM.*缓存/);
 assert.equal(calls.length,0,'Direct DSD must not use a processed PCM cache');
});

test('native status preserves WASAPI device capabilities and errors',async()=>{
 const host=new NativeOutput(),responses=[
  {devicesASIO:[{id:0,name:'Synthetic ASIO'}],wasapiAvailable:true,wasapiDevices:[{id:'synthetic-endpoint',name:'Synthetic endpoint',isDefault:true}]},
  {devicesASIO:[],wasapiAvailable:false,wasapiDevices:[],wasapiError:'Synthetic endpoint unavailable'},
 ];
 host.command=async value=>{assert.deepEqual(value,{cmd:'devices'});return responses.shift()};
 const available=await host.status();
 assert.equal(available.available,true);assert.equal(available.wasapiAvailable,true);
 assert.deepEqual(available.wasapiDevices,[{id:'synthetic-endpoint',name:'Synthetic endpoint',isDefault:true}]);
 assert.deepEqual(available.backends,['wasapi','asio']);
 const unavailable=await host.status();
 assert.equal(unavailable.wasapiAvailable,false);assert.equal(unavailable.wasapiError,'Synthetic endpoint unavailable');
 assert.deepEqual(unavailable.backends,[]);
});

test('reported WASAPI session fields survive frontend adoption',async t=>{
 const {directory,file}=await fixture(t),host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 const reported={backend:'wasapi',mode:'pcm',sampleRate:96000,channels:2,volumeLocked:false,deviceId:'synthetic-endpoint',deviceName:'Synthetic endpoint',wasapiMode:'exclusive',bitsPerSample:32,validBitsPerSample:24,mixSampleRate:48000,mixBitsPerSample:32,sampleFormat:'float',mixSampleFormat:'float'};
 host.command=async value=>{
  if(value.cmd==='open')return {...reported,session:value.session,position:0,duration:2,playing:false,paused:true};
  if(value.cmd==='play'||value.cmd==='status')return {...reported,session:value.session,position:.25,duration:2,playing:true,paused:false};
  if(value.cmd==='stop')return {session:value.session,stopped:true};
  throw new Error(`Unexpected simulated native command: ${value.cmd}`);
 };
 const first=randomUUID(),second=randomUUID(),session=randomUUID();
 await host.current({clientId:first,clientStartedAt:100});
 await host.start({...request(session),clientId:first,settings:{...settings,wasapiDevice:'synthetic-endpoint',wasapiMode:'exclusive'}});
 await host.control({session,clientId:first,action:'play'});
 const recovered=await host.current({clientId:second,clientStartedAt:101});
 assert.equal(recovered.session,session);assert.deepEqual(recovered.settings,{...settings,wasapiDevice:'synthetic-endpoint',wasapiMode:'exclusive'});
 for(const [key,value] of Object.entries(reported))assert.equal(recovered.state[key],value,`recovery retains ${key}`);
 assert.equal(recovered.state.playing,true);assert.equal(recovered.state.position,.25);
 await host.control({session,clientId:second,action:'stop'});
});

test('pure PCM output temporarily selects exclusive and restores saved shared mode',async t=>{
 const {directory,file}=await fixture(t),host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}}),calls=[];
 host.command=async value=>{calls.push(value);return {session:value.session,backend:'wasapi',mode:'pcm',paused:true,position:0,duration:2,wasapiMode:value.wasapiMode??'exclusive'}};
 const processing=normalizeProcessing({bitPerfect:true,eq:{enabled:true,preamp:6},tone:{enabled:true},replayGain:{mode:'gain'},resampling:{mode:'fixed',rate:192000},dither:'triangular',transition:{transportFade:true,seekFade:true}});
 const selected={...settings,processing},original=structuredClone(selected),session=randomUUID();
 await host.start({...request(session),settings:selected,volume:.25});
 const open=calls.find(value=>value.cmd==='open');assert.equal(open.wasapiMode,'exclusive');assert.equal(open.volume,1);
 assert.equal(open.processing.eq.enabled,false);assert.equal(open.processing.tone.enabled,false);assert.equal(open.processing.replayGain.mode,'off');
 assert.equal(open.processing.resampling.mode,'follow');assert.equal(open.processing.dither,'none');assert.equal(open.processing.transition.transportFade,false);assert.equal(open.processing.transition.seekFade,false);
 assert.deepEqual(selected,original);assert.equal(host.active.settings.wasapiMode,'shared','saved mode must not be rewritten');
 await host.control({session,action:'processing',processing});await host.control({session,action:'stop'});
 await host.start({...request(randomUUID()),settings:{...selected,processing:normalizeProcessing({...processing,bitPerfect:false})}});
 assert.equal(calls.filter(value=>value.cmd==='open').at(-1).wasapiMode,'shared');await host.stopCurrent();
});

test('exclusive initialization errors do not downgrade settings and a stop permits retry',async t=>{
 const {directory,file}=await fixture(t),host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}}),opens=[];
 const selected={...settings,wasapiDevice:'synthetic-endpoint',wasapiMode:'exclusive'},original={...selected};
 let unavailable=true;
 host.command=async value=>{
  if(value.cmd==='open'){
   opens.push(value);
   if(unavailable){unavailable=false;throw new Error('Synthetic exclusive endpoint conflict')}
   return {session:value.session,paused:true,position:0,duration:2,backend:'wasapi',wasapiMode:'exclusive'};
  }
  if(value.cmd==='stop')return {session:value.session,stopped:true};
  throw new Error(`Unexpected simulated native command: ${value.cmd}`);
 };
 await assert.rejects(host.start({...request(randomUUID()),settings:selected}),/Synthetic exclusive endpoint conflict/);
 assert.deepEqual(selected,original,'a native initialization error does not rewrite the selected settings');
 assert.equal(opens.length,1,'an exclusive error must not trigger a shared-mode retry');
 assert.equal(opens[0].wasapiDevice,'synthetic-endpoint');assert.equal(opens[0].wasapiMode,'exclusive');
 assert.equal(host.active,undefined);
 await host.stopCurrent();
 const session=randomUUID();
 await host.start({...request(session),settings:selected});
 assert.equal(opens.length,2);assert.deepEqual(opens.map(value=>value.wasapiMode),['exclusive','exclusive']);
 assert.deepEqual(host.active.settings,original);
 await host.control({session,action:'stop'});
 assert.equal(host.active,undefined);
 const afterStop=randomUUID();
 await host.start({...request(afterStop),settings:selected});
 assert.equal(opens.length,3);assert.equal(opens[2].wasapiMode,'exclusive');
 await host.control({session:afterStop,action:'stop'});
});

test('native streaming decode matches file decode and preserves the seek timeline', {skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {directory,file}=await fixture(t),host=new NativeOutput();
 const full=await decodeCli(host.executable,{file,dsd:false,position:0});
 const output=path.join(directory,'decoded.f32'),decoded=await decodeCli(host.executable,{file,dsd:false,output},false);
 assert.equal(decoded.frames,full.metadata.frames);assert.deepEqual(full.pcm,await fs.readFile(output));
 const tail=await decodeCli(host.executable,{file,dsd:false,position:.713});
 const skipped=Math.round(tail.metadata.positionOffset*full.metadata.sampleRate);
 assert.ok(Math.abs(tail.metadata.positionOffset-.713)<1/44100);
 assert.deepEqual(tail.pcm,full.pcm.subarray(skipped*8));
 assert.equal(tail.metadata.frames+skipped,full.metadata.frames);
 // A generated 0.237 s AAC container has a partial final codec frame.
 // Media Foundation may decode its padding past the declared 11,376 frames.
 const aac=path.join(directory,'codec-padding.m4a');
 await fs.writeFile(aac,Buffer.from(await fs.readFile(new URL('./fixtures/aac-padding.m4a.b64',import.meta.url),'utf8'),'base64'));
 const aacFull=await decodeCli(host.executable,{file:aac,dsd:false});
 assert.equal(aacFull.metadata.sampleRate,48000);assert.equal(aacFull.metadata.frames,11376);
 const aacOutput=path.join(directory,'aac-decoded.f32'),aacDisk=await decodeCli(host.executable,{file:aac,dsd:false,output:aacOutput},false);
 assert.equal(aacDisk.frames,11376);assert.deepEqual(aacFull.pcm,await fs.readFile(aacOutput));
 const aacTail=await decodeCli(host.executable,{file:aac,dsd:false,position:.1});
 assert.equal(aacTail.metadata.frames+Math.round(aacTail.metadata.positionOffset*48000),11376);
 for(const rate of [2822400,5644800,11289600])for(const count of [4098,8192,32768])for(const format of ['dsf','dff']){
  const generated=dsdFixture(rate,count),source=path.join(directory,`stream-${rate}-${count}.${format}`);await fs.writeFile(source,generated[format]);
  const pcm=await decodeCli(host.executable,{file:source,dsd:true});assert.equal(pcm.metadata.sampleRate,44100);
  for(let i=0;i<pcm.pcm.length;i+=4)assert.ok(Number.isFinite(pcm.pcm.readFloatLE(i)));
 }
});

test('Windows PCM pipe backpressure retains every frame without a decoder error',{skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {directory}=await fixture(t),file=path.join(directory,'backpressure.wav'),host=new NativeOutput();
 await fs.writeFile(file,silentWav(12,192000,24));
 const decoded=await decodeCli(host.executable,{file,dsd:false},true,300);
 assert.equal(decoded.metadata.sampleRate,192000);assert.equal(decoded.metadata.frames,2304000);assert.equal(decoded.pcm.length,2304000*8);assert.ok(decoded.pcm.every(byte=>byte===0));
});

test('Sony segments expose full-track positions and release obsolete producers',async t=>{
 const {directory,file}=await fixture(t),id='c'.repeat(64),job={trackId:'first',output:file,state:'ready',readers:0,result:{duration:90,positionOffset:30}},cancelled=[];
 const sony={cacheDir:directory,jobs:new Map([[id,job]]),audio:async()=>({path:file,allowedRoot:directory}),cancel:key=>cancelled.push(key)};
 const host=new NativeOutput({sony,store:{trackFile:()=>({path:file,allowedRoot:directory})}});job.id=id;
 const calls=[];host.command=async value=>{calls.push(value);return {position:value.position??0,duration:90,paused:true}};
 const session=randomUUID(),opened=await host.start({...request(session),position:30,sonyJobId:id});
 assert.equal(calls[0].position,0);assert.equal(opened.position,30);assert.equal(opened.duration,120);assert.equal(opened.sourceStart,30);
 const sought=await host.control({session,action:'seek',position:45});assert.equal(calls.at(-1).position,15);assert.equal(sought.position,45);
 await assert.rejects(host.control({session,action:'seek',position:29}),/早于/);
 job.state='processing';await host.control({session,action:'stop'});assert.equal(job.readers,0);assert.deepEqual(cancelled,[id]);
});
test('late cancellation cannot replace a newer track; stop before start is fenced',async t=>{
 const {directory,file}=await fixture(t);let release;
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})},ftp:{ensure:()=>new Promise(resolve=>release=resolve),trackFile:()=>({path:file,allowedRoot:directory})}});
 const commands=[];host.command=async value=>{commands.push(value);return {session:value.session,paused:true}};
 const old=randomUUID(),latest=randomUUID(),cancelled=randomUUID();
 const pending=host.start(request(old,'ftp-first'));await sleep(5);
 await host.start(request(latest));await host.control({session:old,action:'stop'});release();
 await assert.rejects(pending,/取消/);assert.equal(host.active.session,latest);assert.deepEqual(commands.map(x=>x.cmd),['open']);
 await host.control({session:cancelled,action:'stop'});await assert.rejects(host.start(request(cancelled)),/取消/);
 await host.stopCurrent();assert.equal(host.active,undefined);
});

test('a refreshed frontend adopts playing and paused Sony output without reopening or losing the full timeline',async t=>{
 const {directory,file}=await fixture(t),id='d'.repeat(64),fx={dsee:true,dc:2,vinyl:1},commands=[];
 const job={id,trackId:'first',output:file,state:'ready',readers:0,settings:fx,result:{duration:90,positionOffset:30}};
 const sony={cacheDir:directory,jobs:new Map([[id,job]]),audio:async()=>({path:file,allowedRoot:directory}),view:()=>({state:'ready',progress:1,sampleRate:176400,positionOffset:30,duration:90,workers:3})};
 const host=new NativeOutput({sony});host.child={};let playing=false;
 host.command=async value=>{commands.push(value);if(value.cmd==='play')playing=true;if(value.cmd==='pause')playing=false;return {position:12.5,duration:90,playing,paused:!playing,sampleRate:176400}};
 const first=randomUUID(),second=randomUUID(),third=randomUUID(),session=randomUUID();
 assert.deepEqual(await host.current({clientId:first,clientStartedAt:100}),{session:null});
 await host.start({...request(session),clientId:first,sonyJobId:id,sonySettings:fx,position:30,volume:.1,targetVolume:.65});
 await host.control({session,clientId:first,action:'play'});
 await host.control({session,clientId:first,action:'volume',volume:.3,targetVolume:.65});
 const recovered=await host.current({clientId:second,clientStartedAt:101});
 assert.equal(recovered.session,session);assert.equal(recovered.state.playing,true);assert.equal(recovered.state.position,42.5);assert.equal(recovered.state.duration,120);assert.equal(recovered.state.sourceStart,30);
 assert.equal(recovered.volume,.65,'a reload during a fade restores the preferred gain');assert.deepEqual(recovered.sonySettings,fx);assert.deepEqual(recovered.sonyProcessing.effectiveSettings,fx);assert.equal(job.readers,1);
 assert.deepEqual(await host.control({session,clientId:first,action:'stop'}),{stale:true});
 await assert.rejects(host.start({...request(randomUUID()),clientId:first}),/前端已经刷新/);
 assert.deepEqual(await host.current({clientId:first,clientStartedAt:100}),{session:null,stale:true});assert.equal(host.frontendOwner,second);
 await host.control({session,clientId:second,action:'pause'});
 const paused=await host.current({clientId:third,clientStartedAt:102});assert.equal(paused.state.playing,false);assert.equal(paused.state.paused,true);assert.equal(paused.state.position,42.5);
 assert.equal(commands.filter(c=>c.cmd==='open').length,1);assert.equal(commands.filter(c=>c.cmd==='stop').length,1,'pause releases the native device');
 await host.control({session,clientId:third,action:'stop'});assert.equal(host.active,undefined);assert.equal(job.readers,0);assert.equal(commands.filter(c=>c.cmd==='stop').length,1,'stopping a released music session must not stop another native session');
});

test('frontend adoption cancels an old pending open and stops an invalid driver session',async t=>{
 const {directory,file}=await fixture(t),first=randomUUID(),second=randomUUID(),session=randomUUID(),commands=[];
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});let release;
 host.command=async value=>{commands.push(value.cmd);if(value.cmd==='open')await new Promise(resolve=>release=resolve);return {session:value.session,paused:true}};
 await host.current({clientId:first,clientStartedAt:200});
 const opening=host.start({...request(session),clientId:first});while(!release)await sleep(1);
 const rejected=assert.rejects(opening,/取消/),adopting=host.current({clientId:second,clientStartedAt:201});release();
 await rejected;assert.deepEqual(await adopting,{session:null});assert.deepEqual(commands,['open','stop']);assert.equal(host.active,undefined);
 host.command=async value=>{commands.push(value.cmd);return {session:value.session,stale:value.cmd==='status'}};
 await host.start({...request(randomUUID()),clientId:second});assert.deepEqual(await host.current({clientId:second,clientStartedAt:201}),{session:null});assert.equal(host.active,undefined);
});
test('serialized native opens retain only the active Sony cache lease',async t=>{
 const {directory,file}=await fixture(t),job={trackId:'first',readers:0},id='a'.repeat(64);
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})},ftp:{trackFile:()=>null},sony:{jobs:new Map([[id,job]]),audio:async()=>({path:file,allowedRoot:directory})}});
 let release;const calls=[];
 host.command=async value=>{calls.push(value);if(value.cmd==='open'&&calls.length===1)await new Promise(resolve=>release=resolve);return {session:value.session,paused:true}};
 const first=randomUUID(),second=randomUUID();
 const opening=host.start({...request(first),sonyJobId:id});while(!release)await sleep(1);
 const next=host.start({...request(second),sonyJobId:id});await sleep(5);release();
 await assert.rejects(opening,/取消/);await next;
 assert.deepEqual(calls.map(x=>x.cmd),['open','stop','open']);assert.equal(job.readers,1);
 await host.control({session:first,action:'stop'});assert.equal(job.readers,1);assert.equal(host.active.session,second);
 await host.stopCurrent();assert.equal(job.readers,0);
});
test('actual native decoder preserves DSF/DFF raw DSD and DoP payloads', {skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {directory}=await fixture(t),host=new NativeOutput();t.after(()=>host.close());
 const status=await host.status();assert.equal(status.available,true,status.error);
 for(const rate of [2822400,5644800,11289600]) for(const count of [4098,8192,32768]) {
  const generated=dsdFixture(rate,count);
  for(const format of ['dsf','dff']) {
   const file=path.join(directory,`位序 (${rate}).${format}`);await fs.writeFile(file,generated[format]);
   const raw=await host.command({cmd:'inspect',file,dsd:true,mode:'native',maxBytes:262144});
   assert.equal(raw.dsdRate,rate);assert.equal(raw.channels,2);assert.equal(raw.bytes,generated.raw.length);
   assert.deepEqual(Buffer.from(raw.dataHex,'hex'),generated.raw,`${format} ${rate} raw MSB bytes`);
   const dop=await host.command({cmd:'inspect',file,dsd:true,mode:'dop',maxBytes:262144});
   const data=Buffer.from(dop.dataHex,'hex');assert.equal(dop.sampleRate,rate/16);assert.equal(data.length,generated.raw.length*2);
   for(let frame=0;frame<generated.raw.length/4;frame++)for(let channel=0;channel<2;channel++) {
    const value=Math.round(data.readFloatLE((frame*2+channel)*4)*8388608)&0xffffff;
    assert.equal(value>>>16,frame%2?0xfa:0x05,`${format} DoP marker at ${frame}/${channel}`);
    // DoP v1.1: the oldest DSD bit is slot t0 (bit 15), so the older byte is bits 8..15.
    assert.equal((value>>>8)&255,generated.raw[frame*4+channel],`${format} first payload byte`);
    assert.equal(value&255,generated.raw[frame*4+2+channel],`${format} second payload byte`);
   }
   const pcm=await host.command({cmd:'inspect',file,dsd:true,mode:'pcm',maxBytes:262144});assert.equal(pcm.sampleRate,44100);
   const floats=Buffer.from(pcm.dataHex,'hex');assert.ok(floats.length>0);
   for(let i=0;i<floats.length;i+=4)assert.ok(Number.isFinite(floats.readFloatLE(i)));
  }
 }
});
test('seeking into unfinished Sony output buffers and a newer pause prevents automatic resume',async t=>{
 const {directory,file}=await fixture(t);const output=file.slice(0,-4);await fs.rename(file,output+'.partial');
 const job={trackId:'first',output,state:'processing',readers:0,settings:{dsee:true,dc:0,vinyl:0},producedBytes:44100*8+56,stream:{duration:10,sampleRate:44100,totalBytes:44100*80+56}},id='b'.repeat(64);
 const host=new NativeOutput({store:{trackFile:()=>null},ftp:{trackFile:()=>null},sony:{cacheDir:directory,jobs:new Map([[id,job]]),growingAudio:async()=>job,view:()=>({state:job.state,progress:job.producedBytes/job.stream.totalBytes})}});host.child={};
 let playing=false;const commands=[];host.command=async value=>{commands.push(value.cmd);if(value.cmd==='play')playing=true;if(value.cmd==='pause')playing=false;return {paused:!playing,playing,duration:10,position:value.position??0}};
 const session=randomUUID();await host.start({...request(session),sonyJobId:id});await host.control({session,action:'play'});
 const seek=host.control({session,action:'seek',position:7});await sleep(10);const bufferedWhileSeeking=host.active.seeking,pausedBeforeResume=playing;
 await host.control({session,action:'pause'});job.producedBytes=job.stream.totalBytes;
 const result=await seek;assert.ok(result.stale===true||result.deviceReleased===true,'a pending seek is cancelled or served from released state');assert.equal(playing,false);assert.equal(commands.filter(cmd=>cmd==='play').length,1);
 assert.equal(bufferedWhileSeeking,true);assert.equal(pausedBeforeResume,false);
 await host.stopCurrent();assert.equal(job.readers,0);
});

test('pause releases native music output and resume restores cached position in the same session',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),calls=[];let nativeState,preparations=0;
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});host.child={};host.beforeMusicOutput=async()=>{preparations++};
 host.command=async value=>{
  calls.push(value);
  if(value.cmd==='open')return nativeState={session,trackId:'first',position:value.position,duration:20,playing:false,paused:true};
  if(value.cmd==='play')return nativeState={...nativeState,playing:true,paused:false};
  if(value.cmd==='pause')return nativeState={...nativeState,position:7.25,playing:false,paused:true};
  if(value.cmd==='stop'){nativeState=undefined;return {session,stopped:true};}
  if(value.cmd==='status')return nativeState;
  if(value.cmd==='seek')return nativeState={...nativeState,position:value.position,playing:false,paused:true};
  if(value.cmd==='queue')return {...nativeState,queueTrackId:value.trackId};
  return nativeState;
 };
 await host.start({...request(session),clientId:'music-client'});assert.equal(host.interfaceIdle(),false);
 await host.control({session,clientId:'music-client',action:'play'});
 const paused=await host.control({session,clientId:'music-client',action:'pause'});
 assert.equal(paused.position,7.25);assert.equal(paused.deviceReleased,true);assert.equal(host.active.released,true);assert.equal(host.interfaceIdle(),true);
 const callCount=calls.length;const cached=await host.control({session,clientId:'music-client',action:'status'});
 assert.equal(cached.position,7.25);assert.equal(calls.length,callCount,'released status comes from cache without querying the shared host');
 const sought=await host.control({session,clientId:'music-client',action:'seek',position:11});
 assert.equal(sought.position,11);assert.equal(host.active.position,11);assert.equal(calls.some(value=>value.cmd==='seek'),false,'released seek only updates the cached timeline');
 const queue=await host.queue({session,clientId:'music-client',trackId:'second'});
 assert.equal(queue.queueCleared,true);assert.equal(queue.queueReady,false);assert.equal(host.queued,undefined);
 await host.control({session,clientId:'music-client',action:'play'});
 const reopen=calls.filter(value=>value.cmd==='open').at(-1);
 assert.equal(reopen.session,session);assert.equal(reopen.position,11);assert.equal(host.active.session,session);assert.equal(host.active.released,false);
 assert.equal(preparations,2,'every music open drains/cancels a short interface session first');assert.equal(host.interfaceIdle(),false);
 await host.control({session,clientId:'music-client',action:'stop'});
 assert.equal(calls.filter(value=>value.cmd==='stop').length,2);assert.equal(host.active,undefined);assert.equal(host.interfaceIdle(),true);
});

test('play arriving during pause waits for native release before reopening',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),calls=[];let nativeState,unblockStop,signalStop,stopTimer,pausing,resuming;
 const stopGate=new Promise(resolve=>unblockStop=resolve),stopStarted=new Promise(resolve=>signalStop=resolve);
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});host.child={};
 host.command=async value=>{
  calls.push(value.cmd);
  if(value.cmd==='open')return nativeState={session,trackId:'first',position:value.position,duration:20,playing:false,paused:true};
  if(value.cmd==='play')return nativeState={...nativeState,playing:true,paused:false};
  if(value.cmd==='pause')return nativeState={...nativeState,position:6.5,playing:false,paused:true};
  if(value.cmd==='stop'){signalStop();await stopGate;nativeState=undefined;return {session,stopped:true};}
  return nativeState;
 };
 try {
  await host.start({...request(session),clientId:'race-client'});await host.control({session,clientId:'race-client',action:'play'});
  pausing=host.control({session,clientId:'race-client',action:'pause'});
  await Promise.race([stopStarted,new Promise((_,reject)=>{stopTimer=setTimeout(()=>reject(new Error('pause did not reach native stop')),1000)})]);
  resuming=host.control({session,clientId:'race-client',action:'play'});await sleep(5);
  assert.equal(calls.filter(cmd=>cmd==='open').length,1,'resume cannot open while native stop is pending');
  unblockStop();await pausing;await resuming;
  assert.deepEqual(calls.filter(cmd=>['pause','stop','open','play'].includes(cmd)),['open','play','pause','stop','open','play']);
  assert.equal(host.active.session,session);assert.equal(host.active.released,false);
 } finally {
  clearTimeout(stopTimer);unblockStop();
  await Promise.allSettled([pausing,resuming].filter(Boolean));
 }
 await host.control({session,clientId:'race-client',action:'stop'});
});

test('a newer track waits for pause release and prevents the old session from reopening',async t=>{
 const {directory,file}=await fixture(t),first=randomUUID(),next=randomUUID(),calls=[];let unblockStop,signalStop,timer;
 const stopGate=new Promise(resolve=>unblockStop=resolve),stopStarted=new Promise(resolve=>signalStop=resolve);
 const host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});host.child={};
 host.command=async value=>{
  calls.push(value);
  if(value.cmd==='open')return {session:value.session,trackId:value.trackId,position:value.position,duration:20,playing:false,paused:true};
  if(value.cmd==='pause')return {session:value.session,trackId:'first',position:5,duration:20,playing:false,paused:true};
  if(value.cmd==='stop'&&value.session===first){signalStop();await stopGate;return {session:first,stopped:true};}
  if(value.cmd==='play')return {session:value.session,trackId:value.session===first?'first':'second',position:5,duration:20,playing:true,paused:false};
  return {session:value.session,position:0,duration:20,playing:false,paused:true};
 };
 const pausing=host.start({...request(first,'first'),clientId:'switch-client'}).then(()=>host.control({session:first,clientId:'switch-client',action:'play'})).then(()=>host.control({session:first,clientId:'switch-client',action:'pause'}));
 let switched;
 try {
  await Promise.race([stopStarted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('pause did not reach native stop')),1000)})]);
  switched=host.start({...request(next,'second'),clientId:'switch-client'});unblockStop();
  await pausing;await switched;
  assert.equal(host.active.session,next);assert.equal(host.active.trackId,'second');
  assert.equal(calls.filter(value=>value.cmd==='open'&&value.session===first).length,1,'the old session is never reopened');
  assert.equal(calls.at(-1).cmd,'open');assert.equal(calls.at(-1).session,next);
 } finally {clearTimeout(timer);unblockStop();await Promise.allSettled([pausing,switched].filter(Boolean));}
 await host.control({session:next,clientId:'switch-client',action:'stop'});
});

test('natural end releases output and preserves the exact Sony full-track offset for replay',async t=>{
 const {directory,file}=await fixture(t),id='f'.repeat(64),session=randomUUID(),clientId=randomUUID(),calls=[];
 const job={id,trackId:'first',output:file,state:'ready',readers:0,settings:{dsee:true,dc:0,vinyl:0},result:{duration:60,positionOffset:30}};
 const sony={cacheDir:directory,jobs:new Map([[id,job]]),audio:async()=>({path:file,allowedRoot:directory}),view:()=>({state:'ready',progress:1,positionOffset:30,duration:60})};
 const host=new NativeOutput({sony});host.child={};let ended=false;
 host.command=async value=>{
  calls.push(value);
  if(value.cmd==='open')return {session,trackId:'first',position:value.position,duration:60,playing:false,paused:true};
  if(value.cmd==='play')return {session,trackId:'first',position:ended?0:12.5,duration:60,playing:true,paused:false};
  if(value.cmd==='status')return {session,trackId:'first',position:60,duration:60,playing:false,paused:true,ended:true};
  if(value.cmd==='stop')return {session,stopped:true};
  return {session,trackId:'first',position:0,duration:60,paused:true};
 };
 await host.current({clientId,clientStartedAt:100});
 await host.start({...request(session),clientId,sonyJobId:id,sonySettings:job.settings,position:30});
 await host.control({session,clientId,action:'play'});ended=true;
 const terminal=await host.current({clientId,clientStartedAt:100});
 assert.equal(terminal.state.ended,true);assert.equal(terminal.state.position,90,'the 30-second Sony source offset is applied exactly once');
 assert.equal(terminal.state.deviceReleased,true);assert.equal(host.active.released,true);assert.equal(calls.filter(value=>value.cmd==='stop').length,1);
 const beforeStatus=calls.length;const cached=await host.control({session,clientId,action:'status'});
 assert.equal(cached.position,90);assert.equal(calls.length,beforeStatus,'terminal polling never queries the UI session');
 await host.control({session,clientId,action:'play'});
 const reopened=calls.filter(value=>value.cmd==='open').at(-1);
 assert.equal(reopened.position,0,'replay reopens at the Sony segment start, not before its source offset');
 assert.equal(host.active.released,false);assert.equal(host.active.session,session);
 await host.control({session,clientId,action:'stop'});
});

test('device refresh drains UI output and blocks new cues until enumeration finishes',async()=>{
 const host=new NativeOutput(),calls=[];let release;
 const draining=new Promise(resolve=>{release=resolve});
 host.beforeMusicOutput=async()=>{calls.push('cancel');assert.equal(host.interfaceIdle(),false);await draining;calls.push('drained')};
 host.stopCurrent=async()=>{calls.push('music-stop')};
 host.status=async()=>{calls.push('devices');assert.equal(host.interfaceIdle(),false);return {available:true}};
 const refreshing=host.refresh();
 assert.deepEqual(calls,['cancel']);assert.equal(host.interfaceIdle(),false);
 release();assert.deepEqual(await refreshing,{available:true});
 assert.deepEqual(calls,['cancel','drained','music-stop','devices']);assert.equal(host.interfaceIdle(),true);
});

test('failed native stop does not claim the output is released',async t=>{
 const {directory,file}=await fixture(t),session=randomUUID(),host=new NativeOutput({store:{trackFile:()=>({path:file,allowedRoot:directory})}});
 host.child={};host.command=async value=>{if(value.cmd==='stop')throw new Error('synthetic native stop failure');return {session,position:3,duration:20,playing:false,paused:true};};
 await host.start(request(session));await host.control({session,action:'play'});
 await assert.rejects(host.control({session,action:'pause'}),/synthetic native stop failure/);
 assert.equal(host.active.released,false);assert.equal(host.active.releasing,false);assert.equal(host.interfaceIdle(),false);
});

test('trailing DSF ID3v2.3/v2.4 do not change native DSD or DoP payloads', {skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {directory}=await fixture(t),host=new NativeOutput();t.after(()=>host.close());const generated=dsdFixture();
 const plain=path.join(directory,'without-tags.dsf');await fs.writeFile(plain,generated.dsf);
 const expectedDop=await host.command({cmd:'inspect',file:plain,dsd:true,mode:'dop',maxBytes:262144});
 for(const version of [3,4]) {
  const file=path.join(directory,`中文 ID3v2.${version}.dsf`),bytes=taggedDsf(generated.dsf,{version});await fs.writeFile(file,bytes);
  const raw=await host.command({cmd:'inspect',file,dsd:true,mode:'native',maxBytes:262144});assert.equal(raw.bytes,generated.raw.length);
  assert.deepEqual(Buffer.from(raw.dataHex,'hex'),generated.raw);
  const dop=await host.command({cmd:'inspect',file,dsd:true,mode:'dop',maxBytes:262144});assert.equal(dop.dataHex,expectedDop.dataHex);
  assert.deepEqual(await fs.readFile(file),bytes,'Native playback must leave the ID3 tag and source file intact');
 }
});
test('actual silent WASAPI playback supports pause, seek, end and missing-ASIO errors', {skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {file}=await fixture(t),host=new NativeOutput();t.after(()=>host.close());const session=randomUUID();
 const devices=await host.command({cmd:'devices'});
 const opened=await host.command({cmd:'open',file,dsd:false,mode:'pcm',backend:'wasapi',volume:0,position:0,session});assert.equal(opened.paused,true);
 await host.command({cmd:'play',session});let playing;const startedDeadline=Date.now()+1500;
 do{await sleep(50);playing=await host.command({cmd:'status',session})}while(playing.position<=0&&Date.now()<startedDeadline);
 assert.ok(playing.position>0,'the physical system output must advance after its startup latency');assert.equal(playing.playing,true);
 const paused=await host.command({cmd:'pause',session});await sleep(100);const still=await host.command({cmd:'status',session});assert.ok(Math.abs(paused.position-still.position)<.03);
 await host.command({cmd:'seek',position:1.8,session});const seeked=await host.command({cmd:'status',session});assert.ok(Math.abs(seeked.position-1.8)<.01);
 await host.command({cmd:'play',session});await sleep(700);const ended=await host.command({cmd:'status',session});assert.equal(ended.ended,true);
 await host.command({cmd:'stop',session});
 if(!devices.devices.length)await assert.rejects(host.command({cmd:'open',file,dsd:false,mode:'pcm',backend:'asio',device:0,channel:0,volume:0,position:0,session}),/ASIO driver unavailable/);
});
test('native asynchronous PCM playback starts before file completion and cancels a waiting read', {skip:process.platform!=='win32'||process.env.RHINE_NATIVE_TEST_MODE==='mock-only'},async t=>{
 const {directory}=await fixture(t),host=new NativeOutput();t.after(()=>host.close());const session=randomUUID(),wav=silentWav(4),file=path.join(directory,'增长.wav.partial');
 const writer=await fs.open(file,'w');t.after(()=>writer.close());const initial=44+44100*4;
 await writer.write(wav.subarray(0,initial),0,initial,0);
 let completed=false;const completion=sleep(1500).then(async()=>{await writer.write(wav.subarray(initial),0,wav.length-initial,initial);completed=true});
 const began=Date.now();const open=await host.command({cmd:'open',file,growingBytes:wav.length,dsd:false,mode:'pcm',backend:'wasapi',volume:0,position:0,session});
 assert.equal(completed,false,'must open before the remaining PCM is produced');assert.ok(Date.now()-began<900);assert.equal(open.duration,4);
 await host.command({cmd:'play',session});await sleep(200);assert.equal((await host.command({cmd:'status',session})).playing,true);
 await fs.rename(file,path.join(directory,'增长.wav'));
 await completion;await host.command({cmd:'seek',position:3.6,session});await sleep(700);assert.equal((await host.command({cmd:'status',session})).ended,true);
 await host.command({cmd:'stop',session});
 const incomplete=path.join(directory,'取消.wav.partial'),long=silentWav(20);await fs.writeFile(incomplete,long.subarray(0,initial));
 await host.command({cmd:'open',file:incomplete,growingBytes:long.length,dsd:false,mode:'pcm',backend:'wasapi',volume:0,position:0,session});await host.command({cmd:'play',session});
 const stopping=Date.now();await host.command({cmd:'stop',session});assert.ok(Date.now()-stopping<1000,'waiting file thread must exit promptly');
 assert.equal((await host.command({cmd:'devices'})).ok,true,'native process remains usable after cancellation');
});
