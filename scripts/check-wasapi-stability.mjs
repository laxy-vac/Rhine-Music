import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { normalizeProcessing,effectivePcmProcessing } from '../src/audio-processing-model.mjs'

// Opt-in hardware checks: generated silence, current default endpoint only.
if(!process.argv.includes('--hardware'))throw new Error('Use --hardware to authorize default-device silence checks.')
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const executable=path.join(project,'.tools/source-preview-native-audio/rhine-audio-host.exe')
const root=path.join(project,'../.task-tmp/wasapi-stability',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8))
await fs.mkdir(root,{recursive:true})
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const report={startedAt:new Date().toISOString(),defaultDevice:null,cases:[],hostExitCodes:[],scope:'Generated silence and the current default WASAPI render endpoint only'}
const hosts=new Set()
class Host {
 constructor(){
  this.id=0;this.pending=new Map();this.buffer='';this.decoder=new StringDecoder('utf8');this.closed=false
  this.child=spawn(executable,[],{cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe']});hosts.add(this)
  this.done=new Promise(resolve=>this.child.once('close',code=>{report.hostExitCodes.push(code);this.closed=true;hosts.delete(this);this.fail(new Error(`Host exited (${code})`));resolve(code)}))
  this.child.once('error',error=>this.fail(error));this.child.stderr.resume()
  this.child.stdin.on('error',error=>this.fail(error))
  this.child.stdout.on('data',data=>{
   this.buffer+=this.decoder.write(data);let split
   while((split=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,split);this.buffer=this.buffer.slice(split+1);let value
    try{value=JSON.parse(line)}catch{this.fail(new Error('Invalid host JSON'));this.child.kill();return}
    if(value.fatal){this.fail(new Error(value.fatal));continue}
    const pending=this.pending.get(value.id);if(!pending)continue;this.pending.delete(value.id);clearTimeout(pending.timer);pending.resolve(value)
   }
  })
 }
 fail(error){for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error)}this.pending.clear()}
 async send(value){
  if(this.closed)throw new Error('Host is closed')
  const id=++this.id
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.child.kill();reject(new Error(`Timeout: ${value.cmd}`))},5000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...value,id})+'\n')})
 }
 async checked(value){const result=await this.send(value);assert.equal(result.ok,true,result.error);return result}
 async close(){if(this.closed)return;try{await this.send({cmd:'shutdown'})}finally{this.child.stdin.end();const timer=setTimeout(()=>this.child.kill(),1500);await this.done;clearTimeout(timer)}}
}
function wav(seconds,rate,bits=16,channels=2,floating=false){
 const frames=Math.round(seconds*rate),size=frames*channels*(bits/8),fmtSize=floating?18:16,factSize=floating?12:0
 const result=Buffer.alloc(12+8+fmtSize+factSize+8+size);result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WAVE',8);result.write('fmt ',12);result.writeUInt32LE(fmtSize,16)
 result.writeUInt16LE(floating?3:1,20);result.writeUInt16LE(channels,22);result.writeUInt32LE(rate,24);result.writeUInt32LE(rate*channels*bits/8,28);result.writeUInt16LE(channels*bits/8,32);result.writeUInt16LE(bits,34)
 let offset=20+fmtSize;if(floating){result.write('fact',offset);result.writeUInt32LE(4,offset+4);result.writeUInt32LE(frames,offset+8);offset+=12}
 result.write('data',offset);result.writeUInt32LE(size,offset+4);return {bytes:result,dataOffset:offset+8,frames}
}
async function fixture(seconds=3,rate=48000,bits=16,channels=2,floating=false){const generated=wav(seconds,rate,bits,channels,floating),file=path.join(root,`silence-${rate}-${bits}-${channels}-${floating}-${randomUUID()}.wav`);await fs.writeFile(file,generated.bytes);return {...generated,file,seconds,rate}}
async function run(name,action){const began=Date.now();try{const details=await action();report.cases.push({name,status:'pass',elapsedMs:Date.now()-began,...(details?{details}: {})});console.log(`PASS ${name}`)}catch(error){report.cases.push({name,status:'fail',elapsedMs:Date.now()-began,error:error.stack});console.log(`FAIL ${name}: ${error.message}`)}}
async function ended(host,session,timeout=2500){const deadline=Date.now()+timeout;let state;do{state=await host.checked({cmd:'status',session});assert.equal(state.error,'');if(state.ended)return state;await sleep(35)}while(Date.now()<deadline);throw new Error(`End deadline exceeded: ${JSON.stringify(state)}`)}
const open=(host,source,session,mode='shared',device='default',extra={})=>host.checked({cmd:'open',file:source.file,dsd:false,mode:'pcm',backend:'wasapi',wasapiDevice:device,wasapiMode:mode,volume:0,position:0,session,...extra})
async function handles(host){
 const child=spawn('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${host.child.pid}).HandleCount`],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);child.stderr.resume();await new Promise(resolve=>child.once('close',resolve));const value=Number(output.trim());assert.ok(Number.isFinite(value)&&value>0);return value
}
try{
 const manifest=JSON.parse(await fs.readFile(path.join(path.dirname(executable),'assets.json'),'utf8'))
 for(const name of ['native/audio-host.cpp','native/wasapi-output.h'])assert.equal(createHash('sha256').update(await fs.readFile(path.join(project,name))).digest('hex'),manifest.sourceFiles[name],'Rebuild the source-preview native host first')
 const host=new Host(),devices=await host.checked({cmd:'devices'}),device=devices.wasapiDevices.find(value=>value.isDefault)
 assert.equal(devices.wasapiAvailable,true,devices.wasapiError);assert.ok(device,'No default WASAPI render endpoint')
 report.defaultDevice={name:device.name,id:device.id};console.log(`Default endpoint: ${device.name}`)
 const source=await fixture(),session=randomUUID()
 await run('shared lifecycle, repeated play, pause/seek/resume and tail',async()=>{
  const state=await open(host,source,session);assert.equal(state.wasapiMode,'shared');assert.equal(state.deviceId,device.id);assert.equal(state.paused,true);assert.equal(state.sampleRate,source.rate)
  await host.checked({cmd:'play',session});await host.checked({cmd:'play',session});await sleep(200)
  const first=await host.checked({cmd:'status',session});assert.ok(first.position>0&&first.position<.8);assert.equal(first.playing,true)
  const paused=await host.checked({cmd:'pause',session});await sleep(120);const still=await host.checked({cmd:'status',session});assert.ok(Math.abs(paused.position-still.position)<.01)
  const seeked=await host.checked({cmd:'seek',position:1,session});assert.ok(Math.abs(seeked.position-1)<.001);assert.equal(seeked.paused,true)
  await host.checked({cmd:'volume',volume:0,session});await host.checked({cmd:'play',session});await sleep(150);assert.ok((await host.checked({cmd:'status',session})).position>1.05)
  const began=Date.now();await host.checked({cmd:'seek',position:2.7,session});const final=await ended(host,session);assert.ok(Date.now()-began>=180,'Track ended before its remaining frames played');assert.equal(final.position,source.seconds)
  await host.checked({cmd:'play',session});await sleep(80);assert.ok((await host.checked({cmd:'status',session})).position<.5,'Replay must restart');await host.checked({cmd:'stop',session})
  return {clientRate:state.sampleRate,mixRate:state.mixSampleRate,finalPosition:final.position}
 })
 await run('shared transport fade pause/resume and seek retain a live session',async()=>{
  const processing=normalizeProcessing({transition:{transportFade:true,transportMs:100,seekFade:true,seekMs:50},reconfigureMs:0})
  await open(host,source,session,'shared','default',{processing});await host.checked({cmd:'play',session});await sleep(90)
  const paused=await host.checked({cmd:'pause',session});assert.equal(paused.paused,true)
  await host.checked({cmd:'play',session});await sleep(90);const resumed=await host.checked({cmd:'status',session});assert.equal(resumed.playing,true);assert.equal(resumed.paused,false);assert.ok(resumed.position>paused.position+.02)
  await host.checked({cmd:'seek',position:1,session});await sleep(90);const seeked=await host.checked({cmd:'status',session});assert.equal(seeked.playing,true);assert.ok(seeked.position>1.02)
  await host.checked({cmd:'stop',session});return {pausedAt:paused.position,resumedAt:resumed.position,seekedAt:seeked.position}
 })
 for(const rate of [44100,96000,192000])await run(`shared ${rate} Hz float source`,async()=>{
  const f=await fixture(.3,rate,32,2,true),s=randomUUID(),state=await open(host,f,s,'shared',device.id);assert.equal(state.deviceId,device.id);assert.equal(state.sampleRate,rate);await host.checked({cmd:'play',session:s});const final=await ended(host,s);assert.ok(Math.abs(final.position-f.seconds)<1/rate,'EOF position must be accurate within one source frame');await host.checked({cmd:'stop',session:s});return {clientRate:state.sampleRate,mixRate:state.mixSampleRate}
 })
 let exclusive=false
 await run('exclusive initialization and explicit mode',async()=>{const state=await open(host,source,session,'exclusive');assert.equal(state.wasapiMode,'exclusive');assert.equal(state.deviceId,device.id);exclusive=true;await host.checked({cmd:'play',session});await sleep(120);assert.equal((await host.checked({cmd:'status',session})).playing,true);await host.checked({cmd:'stop',session});return {bits:state.bitsPerSample,validBits:state.validBitsPerSample,format:state.sampleFormat}})
 if(exclusive){
  await run('exclusive integer BitPerfect application sample checks on generated silence',async()=>{
   const short=await fixture(.35,48000,16),s=randomUUID(),processing=effectivePcmProcessing(normalizeProcessing({bitPerfect:true}))
   const state=await open(host,short,s,'exclusive','default',{processing,volume:1});assert.equal(state.volumeLocked,true);assert.equal(state.sampleFormat,'pcm');assert.ok(state.validBitsPerSample>=16)
   await host.checked({cmd:'play',session:s});const final=await ended(host,s);assert.ok(final.bitPerfectCheckedSamples>0);assert.equal(final.bitPerfectMismatchSamples,0)
   await host.checked({cmd:'stop',session:s});return {validBits:state.validBitsPerSample,containerBits:state.bitsPerSample,checked:final.bitPerfectCheckedSamples,mismatches:final.bitPerfectMismatchSamples}
  })
  await run('exclusive pause/reset/seek clock and tail',async()=>{
   await open(host,source,session,'exclusive',device.id);await host.checked({cmd:'play',session});await sleep(120);const paused=await host.checked({cmd:'pause',session});await sleep(100);assert.ok(Math.abs(paused.position-(await host.checked({cmd:'status',session})).position)<.01)
   await host.checked({cmd:'seek',position:1.5,session});await host.checked({cmd:'play',session});await sleep(120);const resumed=await host.checked({cmd:'status',session});assert.ok(resumed.position>=1.55&&resumed.position<1.9,`Clock after seek: ${resumed.position}`)
   const began=Date.now();await host.checked({cmd:'seek',position:2.7,session});const final=await ended(host,session);assert.ok(Date.now()-began>=180);assert.equal(final.position,3);await host.checked({cmd:'stop',session})
  })
  await run('exclusive contention, stop release and process shutdown release',async()=>{
   const second=new Host(),other=randomUUID();try{
    await open(host,source,session,'exclusive');await host.checked({cmd:'play',session})
    const conflict=await second.send({cmd:'open',file:source.file,dsd:false,mode:'pcm',backend:'wasapi',wasapiMode:'exclusive',wasapiDevice:device.id,volume:0,position:0,session:other});assert.equal(conflict.ok,false,'Two hosts must not both obtain exclusive access')
    await host.checked({cmd:'stop',session});await open(second,source,other,'exclusive');await second.checked({cmd:'play',session:other});await second.close()
    await open(host,source,session,'exclusive');await host.checked({cmd:'stop',session});return {conflict:conflict.error}
   }finally{await second.close()}
  })
  await run('exclusive EOF releases device before explicit stop',async()=>{
   const short=await fixture(.25),s=randomUUID();await open(host,short,s,'exclusive');await host.checked({cmd:'play',session:s});await ended(host,s)
   const second=new Host(),other=randomUUID();try{await open(second,source,other,'exclusive');await second.checked({cmd:'stop',session:other})}finally{await second.close()}
   await host.checked({cmd:'stop',session:s})
  })
 }
 await run('invalid endpoint and mode fail without fallback, then recover',async()=>{
  for(const extra of [{wasapiDevice:'synthetic-invalid-endpoint'},{wasapiMode:'invalid'}]){const failure=await host.send({cmd:'open',file:source.file,dsd:false,mode:'pcm',backend:'wasapi',wasapiDevice:'default',wasapiMode:'shared',volume:0,position:0,session,...extra});assert.equal(failure.ok,false)}
  const valid=await open(host,source,session);assert.equal(valid.wasapiMode,'shared');await host.checked({cmd:'play',session});await host.checked({cmd:'stop',session})
 })
 const cycles=process.argv.includes('--extended')?100:30
 await run(`${cycles} shared/exclusive reopen cycles and handle release`,async()=>{
  await open(host,source,session);await host.checked({cmd:'stop',session});const before=await handles(host)
  for(let i=0;i<cycles;i++){await open(host,source,session,exclusive&&i%2?'exclusive':'shared');await host.checked({cmd:'play',session});await sleep(12);await host.checked({cmd:'pause',session});await host.checked({cmd:'seek',position:.1,session});await host.checked({cmd:'play',session});await host.checked({cmd:'stop',session})}
  await sleep(150);const after=await handles(host);assert.ok(after-before<=4,`Handle growth: ${before} -> ${after}`);return {cycles,handlesBefore:before,handlesAfter:after}
 })
 await run('growing float PCM stalls, resumes, renames and ends',async()=>{
  const full=wav(1.4,48000,32,2,true),file=path.join(root,'growing-float.wav.partial'),initial=full.dataOffset+Math.round(.25*48000)*8
  await fs.writeFile(file,full.bytes.subarray(0,initial));const s=randomUUID();await open(host,{file},s,'shared','default',{growingBytes:full.bytes.length});await host.checked({cmd:'play',session:s});await sleep(500)
  const stalled=await host.checked({cmd:'status',session:s});assert.equal(stalled.ended,false);assert.equal(stalled.buffering,true);assert.ok(stalled.position<.4)
  await fs.appendFile(file,full.bytes.subarray(initial));await fs.rename(file,path.join(root,'growing-completed.wav'));const final=await ended(host,s,2200);assert.ok(Math.abs(final.position-1.4)<.0001);await host.checked({cmd:'stop',session:s});return {stalledAt:stalled.position,finalPosition:final.position}
 })
 await run('cancel stalled source promptly and reopen',async()=>{
  const full=wav(8,48000,32,2,true),file=path.join(root,'cancel-growing.wav.partial');await fs.writeFile(file,full.bytes.subarray(0,full.dataOffset+4800*8));await open(host,{file},session,'shared','default',{growingBytes:full.bytes.length});await host.checked({cmd:'play',session});await sleep(170)
  const began=Date.now();await host.checked({cmd:'stop',session});assert.ok(Date.now()-began<1000);await open(host,source,session);await host.checked({cmd:'stop',session});return {stopMs:Date.now()-began}
 })
 if(process.argv.includes('--extended')) {
  await run('shared mono channel conversion',async()=>{const f=await fixture(.3,44100,16,1),s=randomUUID();await open(host,f,s);await host.checked({cmd:'play',session:s});const final=await ended(host,s);assert.equal(final.position,f.seconds);await host.checked({cmd:'stop',session:s})})
  if(exclusive)for(const rate of [44100,96000,176400,192000])await run(`exclusive ${rate} Hz float source`,async()=>{
   const f=await fixture(.35,rate,32,2,true),s=randomUUID(),state=await open(host,f,s,'exclusive');assert.equal(state.wasapiMode,'exclusive');assert.equal(state.sampleRate,rate);await host.checked({cmd:'play',session:s});const final=await ended(host,s);assert.ok(Math.abs(final.position-f.seconds)<1/rate);await host.checked({cmd:'stop',session:s});return {rate,bits:state.bitsPerSample,format:state.sampleFormat}
  })
  await run('continuous shared/exclusive progress and complete tail',async()=>{
   const measurements=[]
   for(const mode of exclusive?['shared','exclusive']:['shared']) {
    const f=await fixture(5),s=randomUUID();await open(host,f,s,mode);const began=Date.now();await host.checked({cmd:'play',session:s});let previous=0,largestError=0,state
    while(Date.now()-began<6500){await sleep(100);state=await host.checked({cmd:'status',session:s});assert.equal(state.error,'');assert.ok(state.position+.001>=previous,'Progress moved backwards');assert.equal(state.buffering,false);largestError=Math.max(largestError,Math.abs(state.position-Math.min(5,(Date.now()-began)/1000)));previous=state.position;if(state.ended)break}
    assert.equal(state.ended,true);assert.equal(state.position,5);assert.ok(largestError<.3,`Progress drift ${mode}: ${largestError}`);measurements.push({mode,maxProgressErrorSeconds:largestError,elapsedMs:Date.now()-began});await host.checked({cmd:'stop',session:s})
   }return measurements
  })
 }
 await host.close()
}catch(error){report.cases.push({name:'suite setup',status:'fail',error:error.stack})}
finally{for(const host of [...hosts])await host.close().catch(()=>host.child.kill());report.finishedAt=new Date().toISOString();report.passed=report.cases.filter(value=>value.status==='pass').length;report.failed=report.cases.filter(value=>value.status==='fail').length;report.remainingOwnedHosts=hosts.size;await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:path.join(root,'report.json')}));if(report.failed)process.exitCode=1}
