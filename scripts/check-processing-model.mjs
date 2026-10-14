import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProcessing, importPowerampPreset, calcEqResponse, calcEqResponseSamples, calcEqBandResponseSamples, processingBandQ, serializeRhineProcessingBackup, importRhineProcessingBackup } from '../src/audio-processing-model.mjs';
import { normalizeReplayGainTags } from './replaygain-tags.mjs';
const tone = [{type:0,channels:0,frequency:90,q:.8,gain:7.528071880340576,color:0},{type:1,channels:0,frequency:10000,q:.6,gain:11.223862648010254,color:0}];
const graphic = [31,62,124,249,498,996,1995,3993,7993,16000].map(frequency=>({type:2,channels:0,frequency,q:0,gain:frequency===996?5.999999523162842:0,color:0}));
test('output sample rates support 705.6 and 768 kHz and retain the upper limit',()=>{
 for(const rate of [705600,768000]){
  const value=normalizeProcessing({resampling:{mode:'fixed',rate}},{clamp:false});
  assert.equal(value.resampling.rate,rate);assert.ok(value.resampling.allowedRates.includes(rate));
  const restored=importRhineProcessingBackup(serializeRhineProcessingBackup(value));assert.equal(restored.settings.resampling.rate,rate);
 }
 assert.throws(()=>normalizeProcessing({resampling:{mode:'fixed',rate:768001}},{clamp:false}));
});
test('Poweramp graphic import separates tone and retains the exact exported control points',()=>{
 const value=importPowerampPreset(JSON.stringify({name:'图形样例',preamp:-2,parametric:false,bands:[...tone,...graphic]}));
 assert.equal(value.eq.bands.length,10);assert.equal(value.eq.bands[5].frequency,996);assert.equal(value.eq.bands[5].gain,5.999999523162842);
 assert.equal(value.tone.bass.gain,tone[0].gain);assert.equal('enabled' in value.tone,false);
 assert.equal(value.eq.mode,'graphic');assert.equal(value.eq.preamp,-2);
});
test('Poweramp parametric import keeps ordinary low/high pass and all channel choices after the tone prefix',()=>{
 const bands=[0,1,2,3,4,5].map((type,index)=>({type,channels:index%3,frequency:100*(index+1),q:1.00141179561615,gain:0,color:-7829368}));
 const value=importPowerampPreset(JSON.stringify({name:'参数样例',preamp:0,parametric:true,bands:[...tone,...bands]}));
 assert.deepEqual(value.eq.bands.map(band=>band.type),[0,1,2,3,4,5]);assert.deepEqual(value.eq.bands.map(band=>band.channels),[0,1,2,0,1,2]);
 assert.equal(value.eq.bands[0].q,bands[0].q);
});
test('invalid imported types, non-finite values and active parametric zero Q do not silently apply',()=>{
 for(const changes of [{type:99},{q:0},{frequency:0},{gain:'6'}]){
  const band={type:3,channels:0,frequency:1000,q:1,gain:0,color:0,...changes};
  assert.throws(()=>importPowerampPreset(JSON.stringify({name:'错误样例',preamp:0,parametric:true,bands:[...tone,band]})));
 }
 assert.throws(()=>normalizeProcessing({bufferMs:Infinity},{clamp:false}));
 assert.throws(()=>normalizeProcessing({eq:{bandwidth:4}},{clamp:false}));
});
test('graphic band disabling does not change adjacent filters automatic bandwidth',()=>{
 const value=normalizeProcessing();value.eq.enabled=true;
 const before=processingBandQ(value,5,48000);value.eq.bands[4].enabled=false;
 assert.equal(processingBandQ(value,5,48000),before);
 value.eq.bandwidth=2;assert.ok(processingBandQ(value,5,48000)<before);
});

test('individual band previews sum to the total response without losing graphic neighbor bandwidth or stereo selection',()=>{
 const frequencies=[31,100,500,1500,6000,16000];
 const graphicValue=normalizeProcessing({eq:{enabled:true,preamp:-2,bandwidth:1.6}});
 graphicValue.eq.bands[3].gain=5;graphicValue.eq.bands[5].gain=-4;graphicValue.eq.bands[8].gain=3;
 const parametric=normalizeProcessing({eq:{enabled:true,mode:'parametric',preamp:1,bands:[
  {type:3,frequency:1500,q:1.2,gain:9,channels:0},
  {type:4,frequency:100,q:.8,gain:-3,channels:1},
  {type:5,frequency:8000,q:.6,gain:4,channels:2},
 ]}});
 for(const value of [graphicValue,parametric])for(const channel of [0,1]){
  const total=calcEqResponseSamples(value,frequencies,48000,channel);
  const parts=value.eq.bands.map((_,index)=>calcEqBandResponseSamples(value,index,frequencies,48000,channel));
  frequencies.forEach((_,index)=>assert.ok(Math.abs(total[index]-value.eq.preamp-parts.reduce((sum,part)=>sum+part[index],0))<1e-9));
 }
 assert.deepEqual(calcEqBandResponseSamples(parametric,1,frequencies,48000,1),frequencies.map(()=>0));
 parametric.eq.bands[0].enabled=false;
 assert.deepEqual(calcEqBandResponseSamples(parametric,0,frequencies,48000,0),frequencies.map(()=>0));
});
test('0 dB low-pass and band-pass remain filters while a zero-gain peaking filter is neutral',()=>{
 for(const type of [0,2]){
  const value=normalizeProcessing({eq:{enabled:true,mode:'parametric',bands:[{type,frequency:1000,q:1,gain:0}]}});
  assert.ok(calcEqResponse(value,12000,48000)<-15);
 }
 const flat=normalizeProcessing({eq:{enabled:true,mode:'parametric',bands:[{type:3,frequency:1000,q:1,gain:0}]}});
 assert.ok(Math.abs(calcEqResponse(flat,1000,48000))<1e-9);
});
test('shelf Q and extreme supported gains yield finite responses, including separate tone controls',()=>{
 for(const type of [4,5])for(const q of [.1,1,36])for(const gain of [-36,0,36]){
  const value=normalizeProcessing({eq:{enabled:true,mode:'parametric',bands:[{type,frequency:2000,q,gain}]}});
  for(const frequency of [20,2000,20000])assert.ok(Number.isFinite(calcEqResponse(value,frequency,48000)));
 }
 const value=normalizeProcessing({tone:{enabled:true,bass:{gain:24,q:18},treble:{gain:-24,q:18}}});
 for(const frequency of [20,1000,20000])assert.ok(Number.isFinite(calcEqResponse(value,frequency,48000)));
 value.tone.enabled=false;assert.equal(calcEqResponse(value,1000,48000),0);
});
test('working settings survive a JSON round trip without sharing mutable defaults',()=>{
 const value=normalizeProcessing({float64:true,tone:{enabled:true,bass:{gain:5}},eq:{bandwidth:1.4}});
 const restored=normalizeProcessing(JSON.parse(JSON.stringify(value)));assert.deepEqual(restored,value);
 restored.eq.bands[0].gain=10;assert.equal(normalizeProcessing().eq.bands[0].gain,0);assert.equal(value.eq.bands[0].gain,0);
});
test('Rhine backups restore processing and both EQ modes without accepting an unknown schema',()=>{
 const value=normalizeProcessing({float64:true,tone:{enabled:true,bass:{gain:7.528}},outputFormat:'s24',eq:{name:'我的预设'}});
 const parametric=normalizeProcessing({eq:{mode:'parametric',bands:[{type:3,frequency:1500,q:1.5,gain:6}]}}).eq;
 const text=serializeRhineProcessingBackup(value,{graphic:value.eq,parametric});
 const parsed=importRhineProcessingBackup(text);
 assert.deepEqual(normalizeProcessing({...parsed.settings,tone:parsed.tone}),value);
 assert.deepEqual(parsed.eqModes.parametric,parametric);assert.equal(parsed.eqModes.graphic.bands.length,10);
 const invalid=JSON.parse(text);invalid.schemaVersion=99;
 assert.throws(()=>importRhineProcessingBackup(JSON.stringify(invalid)),/版本/);
 invalid.schemaVersion=1;invalid.settings.eq.bands[0].gain=999;
 assert.throws(()=>importRhineProcessingBackup(JSON.stringify(invalid)));
});
test('ReplayGain tags use dB gains and matching linear peaks, rejecting malformed values',()=>{
 const tags=normalizeReplayGainTags({replaygain_track_gain:{ratio:.5},replaygain_album_gain:'-3.25 dB',replaygain_track_peak:{ratio:.9}});
 assert.ok(Math.abs(tags.trackGainDb+6.020599913279624)<1e-10);assert.equal(tags.albumGainDb,-3.25);assert.equal(tags.trackPeak,.9);
 assert.equal(normalizeReplayGainTags({replaygain_track_gain:NaN,replaygain_track_peak:'0 dB'}),undefined);
});
