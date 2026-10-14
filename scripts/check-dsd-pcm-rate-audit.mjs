import assert from 'node:assert/strict'
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {dsdPcmRateFromSourceRate,sonyCacheId,sonyPlaybackPlan} from './sony-walkman.mjs'
import {dsdFixture} from './audio-fixtures.mjs'
import {NativeOutput} from './native-output.mjs'
import {nativeSourceManifest} from './native-source-manifest.mjs'

const scriptsDir=path.dirname(fileURLToPath(import.meta.url))
const fixture=JSON.parse(await fs.readFile(path.join(scriptsDir,'fixtures/dsd-pcm-rate-audit.json'),'utf8'))
const settings={dsee:true,dc:2,vinyl:1}

for(const item of fixture.families){
  const familyRate=dsdPcmRateFromSourceRate(item.sourceSampleRate)
  assert.equal(familyRate,item.nativeMetadata.sampleRate,`${item.label}: source tag family`)
  const plan=sonyPlaybackPlan(settings,{sampleRate:familyRate,numberOfChannels:item.nativeMetadata.sourceChannels})
  assert.equal(plan.sourceSampleRate,familyRate,`${item.label}: Sony plan rate`)
  assert.equal(plan.effectiveSettings.dsee,true,`${item.label}: DSEE is supported for stereo`)
  const legacyId=createHash('sha256').update(JSON.stringify(['mock-source:4096:1','mock-revision',settings,'rate-policy-v1','dsd-pcm-44100'])).digest('hex')
  const currentId=sonyCacheId({signature:'mock-source:4096:1',revision:'mock-revision',settings,dsdPcmRate:familyRate})
  assert.notEqual(currentId,legacyId,`${item.label}: old mislabeled cache identity is not reused`)
}

assert.throws(()=>dsdPcmRateFromSourceRate(3000000),/不支持的 DSD 源采样率/)
const monoPlan=sonyPlaybackPlan(settings,{sampleRate:48000,numberOfChannels:1})
assert.deepEqual(monoPlan.effectiveSettings,settings,'Mono is explicitly normalized to a stereo pipe before Sony processing')
assert.deepEqual(monoPlan.bypassed,[])
const dseeOffPlan=sonyPlaybackPlan({...settings,dsee:false},{sampleRate:48000,numberOfChannels:2})
assert.equal(dseeOffPlan.effectiveSettings.dsee,false)

const python=process.env.SONY_WALKMAN_PYTHON??(process.platform==='win32'?'python':'python3')
const pythonAudit=String.raw`
import json, os, struct, sys
sys.path.insert(0, sys.argv[1])
import runner
data=json.load(sys.stdin)
results=[]
for item in data['families']:
    meta=item['nativeMetadata']
    source_rate=item['sourceSampleRate']
    # Requested 44.1 kHz cannot overwrite the actual native 48 kHz pipe rate.
    native_rate=runner.select_processing_input_rate(source_rate,meta['sampleRate'],True,item['requestedRate'])
    assert native_rate==meta['sampleRate'], (item['label'],native_rate,meta['sampleRate'])
    # Without a native decoder, FFmpeg's -ar target performs the actual SRC.
    ffmpeg_rate=runner.select_processing_input_rate(source_rate,None,True,native_rate)
    cmd=runner.ffmpeg_decoder_command('ffmpeg','mock-input.dsf',ffmpeg_rate)
    assert cmd[cmd.index('-ar')+1]==str(ffmpeg_rate)
    layout=runner.pcm_pipe_layout(meta['sourceChannels'])
    assert layout['channels']==meta['channels']==2 and layout['frameBytes']==8
    for dsee in (False,True):
        timing=runner.sony_output_timing(native_rate,dsee,item['inputFrames'])
        assert timing['duration']==item['inputFrames']/native_rate
        assert timing['frames']/timing['sampleRate']==timing['duration']
        wav=runner.header(timing['sampleRate'],timing['frames']*layout['frameBytes'])
        assert len(wav)==56
        assert struct.unpack_from('<I',wav,24)[0]==timing['sampleRate']
        assert struct.unpack_from('<I',wav,44)[0]==timing['frames']
        assert struct.unpack_from('<I',wav,52)[0]==timing['frames']*layout['frameBytes']
        results.append({'family':item['label'],'dsee':dsee,'inputSampleRate':timing['inputSampleRate'],
                        'sampleRate':timing['sampleRate'],'frames':timing['frames'],'duration':timing['duration']})
for case in data['channelCases']:
    layout=runner.pcm_pipe_layout(case['sourceChannels'])
    assert layout['channels']==case['pipeChannels']==2
    assert len(case['frames'])==3 and all(len(frame)==2 for frame in case['frames'])
    if case['sourceChannels']==1:
        assert all(frame[0]==frame[1] for frame in case['frames'])
print(json.dumps({'results':results,'channelCases':len(data['channelCases'])}))
`
const pythonResult=spawnSync(python,['-c',pythonAudit,path.join(scriptsDir,'sony-walkman')],{
  input:JSON.stringify(fixture),encoding:'utf8',windowsHide:true,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}
})
if(pythonResult.error)throw pythonResult.error
assert.equal(pythonResult.status,0,pythonResult.stderr||pythonResult.stdout)
const pythonSummary=JSON.parse(pythonResult.stdout)
assert.equal(pythonSummary.results.length,fixture.families.length*2)
assert.equal(pythonSummary.channelCases,fixture.channelCases.length)
console.log(`DSD→PCM rate audit passed: ${pythonSummary.results.length} rate/DSEE combinations, ${pythonSummary.channelCases} channel layouts.`)
if(process.argv.includes('--native')) {
  const project=path.resolve(scriptsDir,'..'),nativeDir=path.join(project,'.tools/source-preview-native-audio'),executable=path.join(nativeDir,'rhine-audio-host.exe')
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(nativeDir,'assets.json'),'utf8')).sourceFiles,(await nativeSourceManifest(project)).sourceFiles,'Rebuild the current native source before the actual DSD audit')
  const artifacts=await fs.mkdtemp(path.join(project,'.tools/audit-tests/dsd-native-'))
  const host=new NativeOutput({executable}),checked=host.command.bind(host)
  host.command=value=>{assert.ok(['inspect','shutdown'].includes(value.cmd),'DSD audit must not open audio devices');return checked(value)}
  try {
    for(const rate of [2822400,3072000])for(const format of ['dsf','dff']) {
      const source=dsdFixture(rate,8192),file=path.join(artifacts,`rate-${rate}.${format}`);await fs.writeFile(file,source[format])
      const output=spawnSync(executable,['--decode-stream-json'],{input:JSON.stringify({file,dsd:true,position:0})+'\n',windowsHide:true,timeout:10000,maxBuffer:4*1024*1024})
      if(output.error)throw output.error;assert.equal(output.status,0,output.stderr.toString())
      const end=output.stdout.indexOf(10),metadata=JSON.parse(output.stdout.subarray(0,end).toString()),pcm=output.stdout.subarray(end+1)
      assert.equal(metadata.ready,true);assert.equal(metadata.sampleRate,dsdPcmRateFromSourceRate(rate));assert.equal(pcm.length,metadata.frames*8)
      for(let i=0;i<pcm.length;i+=4)assert.ok(Number.isFinite(pcm.readFloatLE(i)))
      console.log(`PASS actual BASSDSD ${format} ${rate} → ${metadata.sampleRate}, ${metadata.frames} stereo PCM frames`)
    }
    for(const count of [4095,4099])for(const format of ['dsf','dff']) {
      const source=dsdFixture(2822400,count),file=path.join(artifacts,`tail-${count}.${format}`);await fs.writeFile(file,source[format])
      const dop=await host.command({cmd:'inspect',file,dsd:true,mode:'dop',maxBytes:262144}),data=Buffer.from(dop.dataHex,'hex'),payload=Buffer.alloc(data.length/2)
      for(let f=0;f<data.length/8;f++)for(let c=0;c<2;c++){const word=Math.round(data.readFloatLE((f*2+c)*4)*8388608)&0xffffff;payload[f*4+c]=(word>>>8)&255;payload[f*4+c+2]=word&255}
      assert.ok(payload.length>=source.raw.length,`${format} DoP dropped a final valid DSD byte`);assert.deepEqual(payload.subarray(0,source.raw.length),source.raw)
      console.log(`PASS actual ${format} odd-byte DoP tail ${count}`)
    }
  } finally {await host.close();console.log(`DSD native offline artifacts: ${path.relative(project,artifacts)}`)}
}
