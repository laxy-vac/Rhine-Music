import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const { NativeAudio, normalizeOutput } = await import("../src/native-audio.ts");
const audioInfoSource = await readFile(new URL("../src/audio-info.ts", import.meta.url), "utf8");
const audioInfoModule = ts.transpileModule(audioInfoSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll(
  'from "./native-audio"',
  `from "${new URL("../src/native-audio.ts", import.meta.url).href}"`,
);
const { audioChainNodes, isPlaybackBufferUnavailable, audioPrecisionMarkup, pcmConsistencyStatus } = await import(
  `data:text/javascript;base64,${Buffer.from(audioInfoModule).toString("base64")}`
);

const originalFetch = globalThis.fetch;
const track = {
  id: "offline-telemetry-track",
  title: "Mock track",
  artist: "Mock artist",
  format: "FLAC",
  codec: "FLAC",
  relativePath: "offline/mock.flac",
  sampleRate: 96_000,
  bitsPerSample: 24,
  numberOfChannels: 2,
  lossless: true,
  bitrate: 1_000_000,
};
const outputSettings = normalizeOutput({ backend: "wasapi", wasapiDevice: "default", wasapiMode: "shared" });

async function openWithMock(report) {
  globalThis.fetch = async () => ({ ok: true, json: async () => report });
  const audio = new NativeAudio(track, outputSettings);
  await audio.play();
  const snapshot = audio.outputStatus;
  audio.load();
  await Promise.resolve();
  return snapshot;
}

function mockPlayerState(output, overrides = {}) {
  return {
    currentTrack: track,
    transport: "playing",
    playing: true,
    loading: false,
    backend: "wasapi",
    volume: 0.75,
    volumeLocked: false,
    outputSettings,
    sonySettings: { dsee: false, dc: 0, vinyl: 0 },
    sonyProcessing: { state: "off", progress: 0, effectiveSettings: { dsee: false, dc: 0, vinyl: 0 } },
    nativeOutputStatus: output,
    ...overrides,
  };
}

try {
  const output = await openWithMock({
    backend: "wasapi",
    mode: "pcm",
    sampleRate: 48_000,
    sourceSampleRate: 96_000,
    channels: 2,
    volumeLocked: false,
    wasapiMode: "shared",
    deviceId: "endpoint-at-open",
    deviceName: "Endpoint at open",
    callbackFormat: "PCM_32",
    callbackContainerBits: 32,
    callbackValidBits: 24,
    callbackAlignment: "left",
    driverNativeFormat: "PCM_24",
    driverNativeContainerBits: 24,
    driverNativeValidBits: 24,
    driverNativeAlignment: "right",
    backendConversion: true,
    bufferFrames: 480,
    requestedBufferMs: 12.5,
    bufferControl: "system",
    durationExact: false,
    bitsPerSample:24,validBitsPerSample:24,sampleFormat:'pcm',dither:'triangular',bufferMs:10,
    realtime: { producerQueueFrames: 960, underflows: 0, callbackFailures: 0 },
  });

  assert.equal(output.callbackAlignment, "left");
  assert.equal(output.driverNativeValidBits, 24);
  assert.equal(output.backendConversion, true);
  assert.equal(output.bufferFrames, 480);
  assert.equal(output.realtime.underflows, 0);

  const nodes = audioChainNodes(mockPlayerState(output), {
    available: true,
    wasapiAvailable: true,
    devices: [],
    wasapiDevices: [{ id: "new-default", name: "New default", isDefault: true }],
  });
  const callback = nodes.find(node => node.id === "callback");
  const driverNative = nodes.find(node => node.id === "driver-native");
  const decoder = nodes.find(node => node.id === "decoder");
  const device = nodes.find(node => node.id === "device");
  assert.equal(callback,undefined,'callback format is diagnostic telemetry, not a listening stage');
  assert.equal(driverNative,undefined,'driver-native format does not need a duplicate listening card');
  assert.deepEqual(nodes.map(node=>node.title),['音轨','解码器','信号处理','音量控制','输出','输出设备']);
  assert.ok(nodes.every(node=>Array.isArray(node.rows)),'cards use labeled rows');
  const listenOutput=nodes.find(node=>node.id==='output');
  assert.equal(listenOutput.rows.find(row=>row.label==='输出位深').value,'24 位整数');
  assert.equal(listenOutput.rows.find(row=>row.label==='抖动').value,'三角');
  assert.equal(listenOutput.rows.find(row=>row.label==='缓冲').value,'10 ms');
  assert.doesNotMatch(nodes.map(node=>node.detail).join(' '),/回调|生产队列|精确帧|内部运算|原生格式/);
  assert.equal(device.rows.find(row=>row.label==='默认设备').value,'已变化 · 重开后更新');

  assert.equal(isPlaybackBufferUnavailable("wasapi", "shared"), true);
  assert.equal(isPlaybackBufferUnavailable("wasapi", "exclusive"), false);
  assert.equal(isPlaybackBufferUnavailable("asio", "shared"), false);
  assert.equal(isPlaybackBufferUnavailable("asio", "exclusive", "driver"), false);
  assert.equal(isPlaybackBufferUnavailable("wasapi", "exclusive", "system"), true);
  assert.equal(isPlaybackBufferUnavailable("asio", "exclusive", "application"), false);

  const invalid = await openWithMock({
    backend: "wasapi",
    mode: "pcm",
    callbackAlignment: "center",
    callbackContainerBits: 0,
    callbackValidBits: -1,
    bufferFrames: -1,
    requestedBufferMs: -5,
    realtime: { producerQueueFrames: -1, underflows: 0, callbackFailures: -1 },
  });
  assert.equal(invalid.callbackAlignment, undefined);
  assert.equal(invalid.callbackContainerBits, undefined);
  assert.equal(invalid.callbackValidBits, undefined);
  assert.equal(invalid.bufferFrames, undefined);
  assert.equal(invalid.requestedBufferMs, undefined);
  assert.equal(invalid.realtime.producerQueueFrames, undefined);
  assert.equal(invalid.realtime.underflows, 0, "reported zero counters remain visible");
  assert.equal(invalid.realtime.callbackFailures, undefined);

  const legacy = {
    backend: "wasapi",
    mode: "pcm",
    sampleRate: 48_000,
    wasapiMode: "shared",
  };
  const legacyNodes = audioChainNodes(mockPlayerState(legacy));
  assert.equal(legacyNodes.some(node => node.id === "callback" || node.id === "driver-native"), false,
    "missing callback and driver telemetry must not be inferred");

  assert.equal(pcmConsistencyStatus(), '等待校验');
  assert.equal(pcmConsistencyStatus({capabilities:{bitPerfectActive:true},bitPerfectCheckedSamples:1}), '等待校验');
  const direct={backend:'wasapi',mode:'pcm',sampleRate:96000,sourceSampleRate:96000,sampleFormat:'pcm',bitsPerSample:32,validBitsPerSample:24,decoderName:'libFLAC',decodedSampleFormat:'s32',capabilities:{bitPerfectActive:true},bitPerfectCheckedSamples:123456,bitPerfectMismatchSamples:0};
  assert.equal(pcmConsistencyStatus(direct), '一致');
  assert.equal(pcmConsistencyStatus({...direct,bitPerfectMismatchSamples:1}), '不一致');
  assert.equal(pcmConsistencyStatus({...direct,capabilities:{bitPerfectActive:false}}), '等待校验');
  const state=mockPlayerState(direct),markup=audioPrecisionMarkup(state);
  assert.match(markup,/解码直通/);assert.match(markup,/格式打包/);assert.doesNotMatch(markup,/123456|Float32|Float64|参与处理/);
  assert.equal(audioChainNodes(state).find(node=>node.id==='output').rows.find(row=>row.label==='比特一致性').value,'一致');
  assert.equal(audioChainNodes(state).find(node=>node.id==='dsp').active,false);
  assert.equal(audioChainNodes(state).find(node=>node.id==='volume').active,false);
  const stage=(id,active)=>({id,name:id,inputPrecision:'float64',computePrecision:'float64',outputPrecision:'float64',active});
  const processed=audioPrecisionMarkup(mockPlayerState({...direct,capabilities:{bitPerfectActive:false},processingStages:[stage('decode',true),stage('resample',true),stage('mix',false),stage('eq',false)]}));
  assert.match(processed,/重采样/);assert.match(processed,/未启用 · 2 项/);assert.match(processed,/64 位浮点/);
  assert.doesNotMatch(processed,/音频处理：|Float64|Track transition/);
  const unknown=audioPrecisionMarkup(mockPlayerState({...direct,capabilities:{bitPerfectActive:false},processingStages:[{...stage('decode',true),inputPrecision:'s32',computePrecision:'unknown'},{...stage('eq',true),computePrecision:'unknown'}]}));
  assert.doesNotMatch(unknown,/运算精度|内部运算|未报告/,'unknown arithmetic must not have a visible column or label');
  assert.match(processed,/运算精度/,'known arithmetic precision remains visible');
  const filters=[{...stage('eq.preamp',true),gainDb:-3},{...stage('eq.band.0',true),gainDb:4},{...stage('eq.band.1',false),gainDb:0}];
  const effected=mockPlayerState({...direct,capabilities:{bitPerfectActive:false},processingStages:[{...stage('eq',true),filters},{...stage('replaygain',true),gainDb:-6,source:'album'},{...stage('resample',true),engine:'soxr',soxrQuality:'hq'}]});
  const dsp=audioChainNodes(effected).find(node=>node.id==='dsp');
  assert.equal(dsp.value,'64 位浮点');assert.equal(dsp.rows.find(row=>row.label==='均衡器').value,'2 段 · 1 段生效');
  assert.equal(dsp.rows.find(row=>row.label==='均衡器前级').value,'-3.0 dB');
  assert.equal(dsp.rows.find(row=>row.label==='播放增益').value,'-6.0 dB · 专辑');
  assert.equal(dsp.rows.find(row=>row.label==='算法').value,'SoX · 高质量');
  const asio=await openWithMock({backend:'asio',mode:'pcm',outputFormat:'f32',bitsPerSample:32,validBitsPerSample:32,dither:'none'});
  assert.equal(asio.outputFormat,'f32');assert.equal(asio.dither,'none');
  const asioOutput=audioChainNodes(mockPlayerState(asio,{backend:'asio'})).find(node=>node.id==='output');
  assert.equal(asioOutput.rows.find(row=>row.label==='输出位深').value,'32 位浮点','ASIO float output must not be labeled integer');
  process.stdout.write("Audio telemetry offline mocks passed.\n");
} finally {
  globalThis.fetch = originalFetch;
}
