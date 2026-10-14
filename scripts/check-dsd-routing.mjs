import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { MusicPlayer } from '../src/music-player.ts'
import { outputDefault, normalizeOutput, directDsd } from '../src/native-audio.ts'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const source=(await fs.readFile(path.join(project,'src/audio-info.ts'),'utf8'))
 .replace('from "./native-audio"',`from ${JSON.stringify(pathToFileURL(path.join(project,'src/native-audio.ts')).href)}`)
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {audioSignalSummary,audioChainNodes}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const track={id:'synthetic-dsd',albumId:'synthetic',title:'Generated DSD',artist:'Test',format:'DSF',codec:'DSD',relativePath:'generated.dsf',sampleRate:2822400,numberOfChannels:2,bitsPerSample:1,duration:1}
const dopOutput={...outputDefault,backend:'wasapi',wasapiMode:'exclusive',wasapiDsdMode:'dop'}

test('DSD routes are separate from PCM and ASIO preferences',()=>{
 assert.equal(normalizeOutput({backend:'wasapi'}).wasapiDsdMode,'pcm')
 assert.equal(directDsd(track,dopOutput),true)
 assert.equal(directDsd(track,{...dopOutput,wasapiMode:'shared'}),true,'An invalid shared DoP target must not silently start DSP conversion')
 assert.equal(directDsd(track,{...dopOutput,wasapiDsdMode:'pcm'}),false)
 assert.equal(directDsd({...track,format:'WAV',relativePath:'generated.wav'},dopOutput),false)
 assert.equal(directDsd(track,{...dopOutput,backend:'asio',dsdMode:'dop'}),true)
 assert.equal(normalizeOutput({...dopOutput,wasapiDsdMode:'native'}).wasapiDsdMode,'pcm')
})

class FakeAudio extends EventTarget {
 constructor(src=''){super();this.src=src;this.volume=0;this.currentTime=0;this.duration=0;this.paused=true;this.ended=false;this.readyState=1;this.error=null}
 async play(){this.paused=false}
 pause(){this.paused=true}
 load(){}
 removeAttribute(name){if(name==='src')this.src=''}
}
test('MusicPlayer sends raw DoP with gain locked and no Sony PCM preparation',async()=>{
 const previous={Audio:globalThis.Audio,document:globalThis.document,fetch:globalThis.fetch},calls=[]
 globalThis.Audio=FakeAudio;globalThis.document=new EventTarget()
 globalThis.fetch=async(url,init)=>{
  assert.ok(url.startsWith('/api/native/'),'DoP must not prepare a PCM/DSP job')
  const request=JSON.parse(init.body);calls.push({url,...request})
  const state={backend:'wasapi',wasapiMode:'exclusive',mode:'dop',dsdRate:2822400,sampleRate:176400,volumeLocked:true,duration:1,position:0,playing:request.action==='play',paused:request.action!=='play'}
  return {ok:true,json:async()=>state}
 }
 const player=new MusicPlayer({outputSettings:dopOutput,sonySettings:{dsee:true,dc:2,vinyl:1},volume:.25,songFadeEnabled:true})
 try{
  player.setQueue([track]);await player.play(track.id)
  const start=calls.find(value=>value.url==='/api/native/start');assert.ok(start)
  assert.equal(start.settings.wasapiDsdMode,'dop');assert.equal(start.volume,1);assert.equal(start.sonyJobId,undefined)
  assert.equal(player.state.volumeLocked,true);assert.equal(player.state.sonyProcessing.state,'off');assert.equal(player.state.nativeOutputStatus.mode,'dop')
  player.setVolume(.1);assert.equal(player.state.volume,.25,'Locked DSD gain must preserve the saved music volume')
 }finally{player.dispose();await new Promise(resolve=>setImmediate(resolve));globalThis.Audio=previous.Audio;globalThis.document=previous.document;globalThis.fetch=previous.fetch}
})

function state(mode='dop') {
 return {currentTrack:track,transport:'paused',playing:false,loading:false,volume:.65,backend:'wasapi',outputSettings:dopOutput,sonySettings:{dsee:true,dc:1,vinyl:1},sonyProcessing:{state:'off',progress:0},nativeOutputStatus:{backend:'wasapi',wasapiMode:'exclusive',mode,dsdRate:2822400,sampleRate:176400,bitsPerSample:24,validBitsPerSample:24,sampleFormat:'pcm',volumeLocked:mode==='dop'}}
}
test('confirmed DoP display distinguishes DSD music from the PCM transport container',()=>{
 const summary=audioSignalSummary(state())
 assert.equal(summary.decoder.value,'DSD → DoP')
 assert.match(summary.output.value,/DoP.*DSD/)
 assert.match(summary.output.detail,/音乐保持 DSD/);assert.match(summary.output.detail,/176\.4 kHz/);assert.match(summary.output.detail,/2\.8224 MHz/)
 assert.doesNotMatch(summary.decoder.value,/→ PCM/)
 assert.match(summary.volume.value,/锁定/)
 const cards=audioChainNodes(state()),output=cards.find(card=>card.id==='output');
 assert.equal(cards.find(card=>card.id==='dsp').active,false);assert.equal(cards.find(card=>card.id==='volume').active,false);
 assert.equal(output.rows.find(row=>row.label==='DoP 帧率').value,'176.4 kHz');
 assert.equal(output.rows.find(row=>row.label==='传输格式').value,'24 位整数');
 assert.equal(cards.find(card=>card.id==='decoder').rows.find(row=>row.label==='解码结果').value,'DSD 位流');
})
test('display reports a confirmed PCM conversion rather than trusting a saved DoP target',()=>{
 const summary=audioSignalSummary(state('pcm'))
 assert.equal(summary.decoder.value,'DSD → PCM');assert.doesNotMatch(summary.output.value,/DoP/)
})

test('prepared PCM decode precision is displayed after Sony rather than attributed to the original source',()=>{
 const value=state('pcm')
 value.sonyProcessing={state:'active',progress:1,streaming:false,effectiveSettings:{dsee:true,dc:0,vinyl:0}}
 value.nativeOutputStatus.processingStages=[{id:'decode',name:'Decode',active:true,inputPrecision:'float32',computePrecision:'unknown',outputPrecision:'float64'}]
 const nodes=audioChainNodes(value)
 assert.deepEqual(nodes.map(node=>node.id),['source','decoder','dsp','volume','output','device'])
 assert.equal(nodes[0].rows.find(row=>row.label==='位深').value,'1 位')
 assert.equal(nodes[1].rows.find(row=>row.label==='样本格式').value,'32 位浮点')
 assert.doesNotMatch(nodes[1].detail,/64 位浮点/)
 assert.equal(nodes[2].rows.find(row=>row.label==='DSEE AI').value,'已启用')
 assert.doesNotMatch(nodes[2].detail,/内部精度|未报告/)
})

test('DSD-to-PCM preparation does not invent an active Sony effect',()=>{
 const value=state('pcm')
 value.sonyProcessing={state:'off',progress:1,streaming:true,effectiveSettings:{dsee:false,dc:0,vinyl:0}}
 value.nativeOutputStatus.processingStages=[{id:'decode',name:'Decode',active:true,inputPrecision:'float32',computePrecision:'unknown',outputPrecision:'float32'}]
 const nodes=audioChainNodes(value)
 assert.equal(nodes.find(node=>node.id==='dsp').active,false)
 assert.equal(nodes.find(node=>node.id==='decoder').rows.find(row=>row.label==='样本格式').value,'32 位浮点')
 assert.deepEqual(nodes.map(node=>node.id),['source','decoder','dsp','volume','output','device'])
})
