import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { NativeOutput } from './native-output.mjs';
import { nativeSourceManifest } from './native-source-manifest.mjs';
import { normalizeProcessing, calcEqResponse } from '../src/audio-processing-model.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reviewRoot=path.join(project,'.tools/audio-core-review');
await fs.mkdir(reviewRoot,{recursive:true});
assert.equal((await fs.lstat(reviewRoot)).isSymbolicLink(),false);
const runDirectory=await fs.mkdtemp(path.join(reviewRoot,'run-'));
const report={ok:false,hardware:false,checks:[],runDirectory};
const nativeDir=path.join(project,'.tools/source-preview-native-audio');
const manifest=JSON.parse(await fs.readFile(path.join(nativeDir,'assets.json'),'utf8'));
assert.deepEqual(manifest.sourceFiles,(await nativeSourceManifest(project)).sourceFiles,'Rebuild the native source-preview host first.');
const host=new NativeOutput({executable:path.join(nativeDir,'rhine-audio-host.exe')});
const command=host.command.bind(host);
host.command=value=>{assert.ok(['render','render_queue','inspect','pack_dop','shutdown'].includes(value.cmd),'Offline checks may not open audio devices.');return command(value)};

async function run(executable,args,env={}){
 await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd:project,windowsHide:true,stdio:'inherit',env:{...process.env,...env}});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`Command failed (${code}): ${path.basename(executable)}`)));
 });
}
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`)}
function wav(data,{bits=16,float=false,validBits=bits,rate=48000,channels=2}={}){
 const extensible=validBits!==bits,fmt=Buffer.alloc(extensible?40:16);
 fmt.writeUInt16LE(extensible?0xfffe:float?3:1,0);fmt.writeUInt16LE(channels,2);fmt.writeUInt32LE(rate,4);
 const align=channels*bits/8;fmt.writeUInt32LE(rate*align,8);fmt.writeUInt16LE(align,12);fmt.writeUInt16LE(bits,14);
 if(extensible){fmt.writeUInt16LE(22,16);fmt.writeUInt16LE(validBits,18);fmt.writeUInt32LE(channels===2?3:4,20);Buffer.from([float?3:1,0,0,0,0,0,0x10,0,0x80,0,0,0xaa,0,0x38,0x9b,0x71]).copy(fmt,24)}
 const bytes=Buffer.alloc(12+8+fmt.length+8+data.length+(data.length%2));
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(fmt.length,16);fmt.copy(bytes,20);
 const offset=20+fmt.length;bytes.write('data',offset);bytes.writeUInt32LE(data.length,offset+4);data.copy(bytes,offset+8);return bytes;
}
async function source(name,data,options){const file=path.join(runDirectory,name+'.wav');await fs.writeFile(file,wav(data,options),{flag:'wx'});return file}
const neutral=()=>normalizeProcessing({float64:true,transition:{transportFade:false,seekFade:false},reconfigureMs:0});
async function render(file,processing=neutral(),extra={}){return host.command({cmd:'render',file,processing,maxFrames:8192,volume:1,...extra})}
async function constantFloat64(name,frames,value){const data=Buffer.alloc(frames*2*8);for(let frame=0;frame<frames;frame++)for(let channel=0;channel<2;channel++)data.writeDoubleLE(value,(frame*2+channel)*8);return source(name,data,{bits:64,float:true,rate:48000,channels:2})}
async function renderQueue(file,nextFile,processing,blockFrames,extra={}){return host.command({cmd:'render_queue',file,nextFile,trackId:'queue-a',nextTrackId:'queue-b',processing,maxFrames:8192,blockFrames,...extra})}
function renderQueueSamples(result){const bytes=Buffer.from(result.dataF64Hex,'hex');assert.equal(bytes.length,result.frames*result.channels*8);const samples=new Array(bytes.length/8);for(let i=0;i<samples.length;i++)samples[i]=bytes.readDoubleLE(i*8);return samples}
function assertTrackPositions(segments,trackId,frames,rate){const selected=segments.filter(segment=>segment.trackId===trackId);let position=0;for(const segment of selected){assert.ok(Math.abs(segment.positionStart-position)<1e-12,`${trackId} position discontinuity: ${segment.positionStart} vs ${position}`);position+=segment.frames/rate;}assert.ok(Math.abs(position-frames/rate)<1e-12,`${trackId} timeline length ${position} vs ${frames/rate}`)}

try{
 await check('JavaScript schema, import and session regressions',async()=>{
  await run(process.execPath,['--test','scripts/check-processing-model.mjs','scripts/check-native-output.mjs','scripts/check-native-audio-adapter.mjs','scripts/check-dsd-routing.mjs','scripts/check-music-player.mjs'],{RHINE_NATIVE_TEST_MODE:'mock-only'});
 });
 await check('native DSP and WAV adapter fixtures',async()=>{
  const compiler=path.join(project,'.tools/walkman/compiler/zig-x86_64-windows-0.15.2/zig.exe');
  for(const fixture of ['pcm-processing-check','pcm-wave-reader-check']){
   const output=path.join(runDirectory,fixture+'.exe');
   await run(compiler,['c++','-target','x86_64-windows-gnu','-std=c++17','-O2','-fno-fast-math','-static','-I',path.join(project,'vendor/audio/windows-x64/include'),path.join(project,`scripts/fixtures/${fixture}.cpp`),path.join(project,'vendor/audio/iir1/iir/Biquad.cpp'),path.join(project,'vendor/audio/iir1/iir/RBJ.cpp'),'-o',output],{ZIG_LOCAL_CACHE_DIR:path.join(project,'.tools/zig-cache/audio-core/local'),ZIG_GLOBAL_CACHE_DIR:path.join(project,'.tools/zig-cache/audio-core/global')});
   await run(output,[]);
  }
 });
 for(const [bits,validBits,format] of [[16,16,'s16'],[24,24,'s24'],[32,32,'s32'],[32,24,'s32v24']]){
  await check(`integer WAV ${validBits}-in-${bits} bit-identical native round trip`,async()=>{
   const maximum=2**(validBits-1)-1,minimum=-(2**(validBits-1));
   const values=[maximum,minimum,1,-1,0,2,-2,123,-123,Math.min(maximum,16777217)],data=Buffer.alloc(values.length*bits/8);
   values.forEach((value,index)=>data.writeIntLE(value*2**(bits-validBits),index*bits/8,bits/8));
   const file=await source(`integer-${validBits}-in-${bits}`,data,{bits,validBits});
   const processing=neutral();processing.bitPerfect=true;processing.outputFormat=format;
   const result=await render(file,processing);assert.equal(result.eof,true);assert.equal(result.frames,5);assert.equal(result.decoderOutputPrecision,'float64');
   assert.deepEqual(Buffer.from(result.dataHex,'hex'),data);
  });
 }
 const frames=8192,samples=Buffer.alloc(frames*16);
 for(let frame=0;frame<frames;frame++)for(let channel=0;channel<2;channel++)samples.writeDoubleLE(.1*Math.sin(2*Math.PI*1500*frame/48000),(frame*2+channel)*8);
 const signal=await source('float64-response',samples,{bits:64,float:true});
 for(const [type,frequency,q,gain] of [[0,1000,.7,0],[1,1000,.7,0],[2,1500,1.2,6],[3,1500,1,6],[4,500,1.2,4],[5,4000,1.2,-5]]){
  await check(`native filter ${type} matches the displayed frequency response`,async()=>{
   const processing=neutral();processing.eq={...processing.eq,enabled:true,mode:'parametric',bands:[{type,channels:1,frequency,q,gain,color:'#889999',enabled:true}]};
   const result=await render(signal,processing),output=Buffer.from(result.dataHex,'hex');
   let inputPower=0,leftPower=0,rightPower=0;
   for(let frame=4096;frame<8192;frame++){const x=samples.readDoubleLE(frame*16);inputPower+=x*x;const left=output.readFloatLE(frame*8),right=output.readFloatLE(frame*8+4);leftPower+=left*left;rightPower+=right*right}
   const expected=calcEqResponse(processing,1500,48000,0),actual=10*Math.log10(leftPower/inputPower);
   assert.ok(Math.abs(expected-actual)<1e-5,`${expected} vs ${actual}`);assert.ok(Math.abs(rightPower/inputPower-1)<1e-6,'left-only filter modified the right channel');
  });
 }
 for(const bandwidth of [.5,1,2])await check(`graphic automatic bandwidth ${bandwidth} matches native response`,async()=>{
  const processing=neutral();processing.eq.enabled=true;processing.eq.bandwidth=bandwidth;processing.eq.bands[5].gain=6;
  const output=Buffer.from((await render(signal,processing)).dataHex,'hex');let inputPower=0,outputPower=0;
  for(let frame=4096;frame<8192;frame++){const x=samples.readDoubleLE(frame*16),y=output.readFloatLE(frame*8);inputPower+=x*x;outputPower+=y*y}
  assert.ok(Math.abs(calcEqResponse(processing,1500,48000)-10*Math.log10(outputPower/inputPower))<1e-5);
 });
 await check('Float32 output retains floating-point headroom without an implicit limiter',async()=>{
  const data=Buffer.alloc(16);data.writeDoubleLE(1.5,0);data.writeDoubleLE(-1.5,8);
  const result=await render(await source('headroom',data,{bits:64,float:true}));
  const bytes=Buffer.from(result.dataHex,'hex');assert.equal(bytes.readFloatLE(0),1.5);assert.equal(bytes.readFloatLE(4),-1.5);
  assert.equal(result.overRangeSamples,2);assert.equal(result.clippingSamples,0);assert.equal(result.peakAbs,1.5);
  const integer=neutral();integer.outputFormat='s16';
  const saturated=await render(path.join(runDirectory,'headroom.wav'),integer);
  assert.equal(saturated.overRangeSamples,2);assert.equal(saturated.clippingSamples,2);assert.equal(saturated.peakAbs,1.5);
 });
 await check('non-finite sources and Float32 overflow fail explicitly',async()=>{
  for(const [name,value] of [['not-finite',NaN],['f32-overflow',1e300]]){
   const data=Buffer.alloc(16);data.writeDoubleLE(value,0);data.writeDoubleLE(0,8);
   await assert.rejects(render(await source(name,data,{bits:64,float:true})),/non-finite|float32 output range/i);
  }
 });
 for(const engine of ['r8brain','fast','soxr'])await check(`${engine} resampling drains the exact output frame count`,async()=>{
  const file=await source(`src-${engine}`,Buffer.alloc(512*4),{rate:44100});const processing=neutral();processing.resampling={...processing.resampling,mode:'fixed',rate:48000,engine};
  const result=await render(file,processing);assert.equal(result.frames,Math.round(512*48000/44100));assert.equal(result.eof,true);assert.equal(result.outputSampleRate,48000);
 });
 for(const engine of ['r8brain','fast','soxr'])for(const [inputRate,rate] of [[44100,705600],[48000,768000]])await check(`${engine} supports ${rate/1000} kHz output offline`,async()=>{
  const file=await source(`src-${engine}-${rate}`,Buffer.alloc(128*4),{rate:inputRate});const base=neutral();
  const processing=normalizeProcessing({...base,resampling:{...base.resampling,mode:'fixed',rate,engine}});
  const result=await render(file,processing);assert.equal(result.frames,2048);assert.equal(result.eof,true);assert.equal(result.outputSampleRate,rate);
 });
 await check('neutral saved effects do not reject low-rate PCM while active invalid filters do',async()=>{
  const file=await source('low-rate',Buffer.alloc(128*4),{rate:8000});const processing=neutral();
  assert.equal((await render(file,processing)).frames,128);
  processing.eq.enabled=true;processing.eq.bands[9].gain=6;
  await assert.rejects(render(file,processing),/Nyquist|sample rate/i);
 });
 const gapA=await constantFloat64('queue-gapless-a',137,.125),gapB=await constantFloat64('queue-gapless-b',89,-.25);
 let gaplessReference;
 for(const blockFrames of [64,257])await check(`production PCM queue gapless is sample-exact with ${blockFrames}-frame reads`,async()=>{
  const processing=neutral();processing.transition.automatic='gapless';processing.transition.gapMs=0;
  const result=await renderQueue(gapA,gapB,processing,blockFrames),samples=renderQueueSamples(result);
  assert.equal(result.eof,true);assert.equal(result.truncated,false);assert.equal(result.frames,226);assert.equal(result.audioFrames,226);assert.equal(result.silenceFrames,0);
  assert.deepEqual(samples.slice(0,137*2),Array(137*2).fill(.125));assert.deepEqual(samples.slice(137*2),Array(89*2).fill(-.25));
  const firstB=result.segments.find(segment=>segment.trackId==='queue-b');assert.equal(firstB.offsetFrames,137);assert.equal(firstB.transitionSerial,1);
  assertTrackPositions(result.segments,'queue-a',137,48000);assertTrackPositions(result.segments,'queue-b',89,48000);
  if(gaplessReference)assert.deepEqual(samples,gaplessReference);else gaplessReference=samples;
 });
 const crossA=await constantFloat64('queue-crossfade-a',512,.8),crossB=await constantFloat64('queue-crossfade-b',384,-.4);
 let crossfadeReference;
 for(const blockFrames of [64,257])await check(`production PCM queue crossfade preserves overlap and identity with ${blockFrames}-frame reads`,async()=>{
  const processing=neutral();processing.transition.automatic='crossfade';processing.transition.crossfadeMs=3;
  const result=await renderQueue(crossA,crossB,processing,blockFrames),samples=renderQueueSamples(result);
  assert.equal(result.eof,true);assert.equal(result.frames,512+384-144);assert.equal(result.silenceFrames,0);
  const fades=result.segments.filter(segment=>segment.trackId==='queue-b'&&segment.transitioning);
  assert.equal(fades.reduce((sum,segment)=>sum+segment.frames,0),144);assert.equal(fades[0].offsetFrames,368);assert.equal(fades[0].positionStart,0);
  assert.ok(samples[368*2]<.8&&samples[368*2]>-.4);assert.equal(samples[(512-1)*2],-.4);assert.equal(samples[512*2],-.4);
  assertTrackPositions(result.segments,'queue-a',512-144,48000);assertTrackPositions(result.segments,'queue-b',384,48000);
  if(crossfadeReference)assert.deepEqual(samples,crossfadeReference);else crossfadeReference=samples;
 });
 const shortB=await constantFloat64('queue-crossfade-short-b',64,-.5);
 for(const blockFrames of [64,257])await check(`production PCM queue clamps crossfade to a shorter next track with ${blockFrames}-frame reads`,async()=>{
  const processing=neutral();processing.transition.automatic='crossfade';processing.transition.crossfadeMs=10;
  const result=await renderQueue(crossA,shortB,processing,blockFrames),samples=renderQueueSamples(result);
  assert.equal(result.eof,true);assert.equal(result.frames,512);assert.equal(result.silenceFrames,0);
  const fades=result.segments.filter(segment=>segment.trackId==='queue-b'&&segment.transitioning);
  assert.equal(fades.reduce((sum,segment)=>sum+segment.frames,0),64);assert.equal(fades[0].offsetFrames,448);
  assert.equal(samples[(512-1)*2],-.5);assertTrackPositions(result.segments,'queue-b',64,48000);
 });
 for(const blockFrames of [64,257])await check(`production manual queue crossfade clamps to next-track length with ${blockFrames}-frame reads`,async()=>{
  const processing=neutral();processing.transition.automatic='none';processing.transition.manual='crossfade';processing.transition.crossfadeMs=10;
  const result=await renderQueue(crossA,shortB,processing,blockFrames,{manualAdvance:true}),samples=renderQueueSamples(result);
  assert.equal(result.eof,true);assert.equal(result.frames,64);
  const fades=result.segments.filter(segment=>segment.trackId==='queue-b'&&segment.transitioning);
  assert.equal(fades.reduce((sum,segment)=>sum+segment.frames,0),64);assert.equal(fades[0].offsetFrames,0);
  assert.equal(samples[(64-1)*2],-.5);assertTrackPositions(result.segments,'queue-b',64,48000);
 });
 const gapSilenceA=await constantFloat64('queue-gap-silence-a',80,.25),gapSilenceB=await constantFloat64('queue-gap-silence-b',48,.5);
 for(const blockFrames of [64,257])await check(`production PCM queue preserves configured silence and segments with ${blockFrames}-frame reads`,async()=>{
  const processing=neutral();processing.transition.automatic='gapless';processing.transition.gapMs=3;
  const result=await renderQueue(gapSilenceA,gapSilenceB,processing,blockFrames),samples=renderQueueSamples(result);
  assert.equal(result.eof,true);assert.equal(result.audioFrames,128);assert.equal(result.silenceFrames,144);assert.equal(result.frames,272);
  assert.ok(samples.slice(0,80*2).every(value=>value===.25));assert.ok(samples.slice(80*2,224*2).every(value=>value===0));assert.ok(samples.slice(224*2).every(value=>value===.5));
  assert.equal(result.segments.find(segment=>segment.trackId==='queue-b').offsetFrames,224);
  assertTrackPositions(result.segments,'queue-a',80,48000);assertTrackPositions(result.segments,'queue-b',48,48000);
 });
 await check('DoP payload framing remains valid without opening any device',async()=>{await run(process.execPath,['scripts/check-dop-transport.mjs'])});
 report.ok=true;
}finally{
 host.close();
 await fs.writeFile(path.join(runDirectory,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Audio core report: ${path.join(runDirectory,'report.json')}`);
}
