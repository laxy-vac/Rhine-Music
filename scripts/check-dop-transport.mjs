import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { dsdFixture, taggedDsf } from './audio-fixtures.mjs'

if(process.platform!=='win32')throw new Error('The native DoP transport check requires the Windows source-preview host.')

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const outputDirectory=path.join(project,'.tools/source-preview-native-audio')
const executable=path.join(outputDirectory,'rhine-audio-host.exe')
const runRoot=path.resolve(project,'../.task-tmp/dop-transport')
await fs.mkdir(runRoot,{recursive:true})
const runDirectory=path.join(runRoot,`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`)
await fs.mkdir(runDirectory)

const manifest=JSON.parse(await fs.readFile(path.join(outputDirectory,'assets.json'),'utf8'))
for(const name of ['native/audio-host.cpp','native/wasapi-output.h','native/dop-packing.h']) {
  const actual=createHash('sha256').update(await fs.readFile(path.join(project,name))).digest('hex')
  assert.equal(actual,manifest.sourceFiles?.[name],`Rebuild the source-preview native host after changing ${name}`)
}

class OfflineHost {
  constructor() {
    this.id=0;this.pending=new Map();this.buffer='';this.decoder=new StringDecoder('utf8');this.closed=false
    this.child=spawn(executable,[],{cwd:project,windowsHide:true,stdio:['pipe','pipe','pipe']})
    this.done=new Promise(resolve=>this.child.once('close',code=>{this.closed=true;this.fail(new Error(`Native host exited (${code})`));resolve(code)}))
    this.child.once('error',error=>this.fail(error));this.child.stderr.resume()
    this.child.stdin.on('error',error=>this.fail(error))
    this.child.stdout.on('data',data=>{
      this.buffer+=this.decoder.write(data);let split
      while((split=this.buffer.indexOf('\n'))>=0) {
        const line=this.buffer.slice(0,split);this.buffer=this.buffer.slice(split+1)
        let value;try{value=JSON.parse(line)}catch(error){this.fail(new Error(`Invalid native host JSON: ${error.message}`));this.child.kill();return}
        if(value.fatal){this.fail(new Error(value.fatal));continue}
        const pending=this.pending.get(value.id);if(!pending)continue
        this.pending.delete(value.id);clearTimeout(pending.timer);pending.resolve(value)
      }
    })
  }
  fail(error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error)}this.pending.clear()}
  async send(value) {
    if(!['inspect','pack_dop','shutdown'].includes(value.cmd))throw new Error(`Offline check refuses the ${value.cmd} command`)
    if(this.closed)throw new Error('Native host is closed')
    const id=++this.id
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.child.kill();reject(new Error(`Native host timed out: ${value.cmd}`))},15000)
      this.pending.set(id,{resolve,reject,timer})
      this.child.stdin.write(JSON.stringify({...value,id})+'\n')
    })
  }
  async checked(value){const result=await this.send(value);assert.equal(result.ok,true,result.error);return result}
  async close(){if(this.closed)return;try{await this.send({cmd:'shutdown'})}finally{this.child.stdin.end();const timer=setTimeout(()=>this.child.kill(),1500);await this.done;clearTimeout(timer)}}
}

function frameWord(data,bits,frame,channel,channels=2) {
  const offset=(frame*channels+channel)*(bits/8)
  if(bits===24)return data.readUIntLE(offset,3)
  assert.equal(data.readUInt32LE(offset)&0xff,0,'32-bit DoP container has zero low padding byte')
  return data.readUInt32LE(offset)>>>8
}

function assertPayload(packed,bits,raw,payloadFrames,{frameOffset=0,channels=2}={}) {
  for(let frame=0;frame<payloadFrames;frame++)for(let channel=0;channel<channels;channel++) {
    const word=frameWord(packed,bits,frame+frameOffset,channel,channels)
    assert.equal((word>>>16)&0xff,((frame+frameOffset)%2)?0xfa:0x05,`marker at output frame ${frame+frameOffset}, channel ${channel}`)
    assert.equal((word>>>8)&0xff,raw[frame*4+channel],`first DSD byte at frame ${frame}, channel ${channel}`)
    assert.equal(word&0xff,raw[frame*4+2+channel],`second DSD byte at frame ${frame}, channel ${channel}`)
  }
}

function sourceHexForFrames(markers,channels=2) {
  const result=Buffer.alloc(markers.length*channels*4)
  let offset=0
  for(const frameMarkers of markers)for(let channel=0;channel<channels;channel++) {
    const marker=Array.isArray(frameMarkers)?frameMarkers[channel]:frameMarkers
    const word=((marker&0xff)<<16)|0x6969
    const signed=word&0x800000?word-0x1000000:word
    result.writeFloatLE(signed/8388608,offset);offset+=4
  }
  return result.toString('hex')
}

const host=new OfflineHost()
let filesWritten=0,inspections=0
try {
  for(const rate of [2822400,5644800,11289600]) {
    const fixture=dsdFixture(rate,8192)
    const sourceFiles={}
    for(const format of ['dsf','dff']) {
      const file=path.join(runDirectory,`synthetic-${rate}.${format}`)
      await fs.writeFile(file,fixture[format]);filesWritten++;sourceFiles[format]=file
    }
    let canonical=null
    for(const format of ['dsf','dff']) {
      const raw=await host.checked({cmd:'inspect',file:sourceFiles[format],dsd:true,mode:'native',maxBytes:262144})
      inspections++
      assert.equal(raw.dsdRate,rate);assert.equal(raw.channels,2)
      const rawPayload=Buffer.from(raw.dataHex,'hex')
      assert.deepEqual(rawPayload,fixture.raw,`${format} native inspection matches the synthetic source payload`)
      for(const bits of [24,32]) {
        const result=await host.checked({cmd:'inspect',file:sourceFiles[format],dsd:true,mode:'dop',maxBytes:262144,packDopBits:bits})
        inspections++
        const packed=Buffer.from(result.packedHex,'hex')
        assert.equal(result.dsdRate,rate,`${format} DSD${rate/44100} raw DSD rate`)
        assert.equal(result.sampleRate,rate/16,`${format} DoP carrier rate`)
        assert.equal(result.sampleFormat,'pcm');assert.equal(result.validBitsPerSample,24);assert.equal(result.bitsPerSample,bits)
        assert.equal(result.payloadFrames,fixture.raw.length/4);assert.equal(result.paddingFrames,0);assert.equal(packed.length,result.packedBytes)
        assertPayload(packed,bits,rawPayload,rawPayload.length/4)
        if(format==='dsf'&&bits===24)canonical=result
        else if(format==='dff'&&bits===24)assert.equal(result.dataHex,canonical.dataHex,'DSF and DFF expose identical source DoP samples')
      }
    }

    for(const version of [3,4]) {
      const tagged=taggedDsf(fixture.dsf,{version})
      const file=path.join(runDirectory,`synthetic-${rate}-id3v2.${version}.dsf`)
      await fs.writeFile(file,tagged);filesWritten++
      const raw=await host.checked({cmd:'inspect',file,dsd:true,mode:'native',maxBytes:262144})
      inspections++
      assert.deepEqual(Buffer.from(raw.dataHex,'hex'),fixture.raw,`DSF ID3v2.${version} preserves raw DSD bytes`)
      for(const bits of [24,32]) {
        const result=await host.checked({cmd:'inspect',file,dsd:true,mode:'dop',maxBytes:262144,packDopBits:bits})
        inspections++
        assert.equal(result.dataHex,canonical.dataHex,`DSF ID3v2.${version} does not change decoded DoP samples`)
        assertPayload(Buffer.from(result.packedHex,'hex'),bits,Buffer.from(raw.dataHex,'hex'),fixture.raw.length/4)
      }
    }

    for(const bits of [24,32]) {
      const padded=await host.checked({cmd:'inspect',file:sourceFiles.dsf,dsd:true,mode:'dop',maxBytes:262144,packDopBits:bits,paddingFrames:5})
      inspections++
      const packed=Buffer.from(padded.packedHex,'hex'),dataFrames=fixture.raw.length/4
      assert.equal(padded.frameCount,dataFrames+5);assert.equal(padded.paddingFrames,5)
      assertPayload(packed,bits,fixture.raw,dataFrames)
      for(let frame=dataFrames;frame<dataFrames+5;frame++)for(let channel=0;channel<2;channel++) {
        const word=frameWord(packed,bits,frame,channel)
        assert.equal((word>>>16)&0xff,frame%2?0xfa:0x05,`idle marker continues at frame ${frame}`)
        assert.equal(word&0xffff,0x6969,'EOF padding uses DSD idle payload')
      }
    }

    const phaseFrames=3,phaseSourceHex=canonical.dataHex.slice(0,phaseFrames*2*4*2)
    const phase=await host.checked({cmd:'pack_dop',sourceHex:phaseSourceHex,channels:2,maxBytes:256,packDopBits:32,leadingIdleFrames:1,chunkFrames:1})
    const phaseBytes=Buffer.from(phase.packedHex,'hex')
    assert.equal(phase.frameCount,phaseFrames+1)
    for(let channel=0;channel<2;channel++)assert.equal((frameWord(phaseBytes,32,0,channel)>>>16)&0xff,0x05)
    assert.equal(frameWord(phaseBytes,32,0,0)&0xffff,0x6969)
    assertPayload(phaseBytes,32,fixture.raw.subarray(0,phaseFrames*4),phaseFrames,{frameOffset:1})
  }

  for(const count of [4098,32768]) {
    const fixture=dsdFixture(2822400,count)
    for(const format of ['dsf','dff']) {
      const file=path.join(runDirectory,`synthetic-edge-${count}.${format}`);await fs.writeFile(file,fixture[format]);filesWritten++
      for(const bits of [24,32]) {
        const result=await host.checked({cmd:'inspect',file,dsd:true,mode:'dop',maxBytes:262144,packDopBits:bits,paddingFrames:3});inspections++
        const packed=Buffer.from(result.packedHex,'hex'),frames=fixture.raw.length/4
        assert.equal(result.payloadFrames,frames);assertPayload(packed,bits,fixture.raw,frames)
        for(let frame=frames;frame<frames+3;frame++)for(let channel=0;channel<2;channel++){const word=frameWord(packed,bits,frame,channel);assert.equal(word&0xffff,0x6969);assert.equal(word>>>16,frame%2?0xfa:0x05)}
      }
    }
  }

  const badMarker=await host.send({cmd:'pack_dop',sourceHex:sourceHexForFrames([0x04]),channels:2,maxBytes:64,packDopBits:24})
  assert.equal(badMarker.ok,false);assert.match(badMarker.error,/marker/i)
  const splitChannels=await host.send({cmd:'pack_dop',sourceHex:sourceHexForFrames([[0x05,0xfa]]),channels:2,maxBytes:64,packDopBits:24})
  assert.equal(splitChannels.ok,false);assert.match(splitChannels.error,/channels/i)
  const repeated=await host.send({cmd:'pack_dop',sourceHex:sourceHexForFrames([0x05,0x05]),channels:2,maxBytes:64,packDopBits:24,chunkFrames:1})
  assert.equal(repeated.ok,false);assert.match(repeated.error,/alternate/i)
  const modified=Buffer.from(sourceHexForFrames([0x05]),'hex');modified.writeFloatLE(modified.readFloatLE(0)+2**-28,0)
  const modifiedResult=await host.send({cmd:'pack_dop',sourceHex:modified.toString('hex'),channels:2,maxBytes:64,packDopBits:24})
  assert.equal(modifiedResult.ok,false);assert.match(modifiedResult.error,/modified/i,'Numerical processing must not silently alter a DoP payload')

  console.log(`PASS offline DoP transport: ${inspections} DSF/DFF and tagged-fixture inspections, 24/32-bit containers, idle padding, phase continuity, and malformed-marker rejection.`)
  console.log(`Synthetic fixtures: ${filesWritten} files in ${runDirectory}`)
} finally {
  await host.close()
}
