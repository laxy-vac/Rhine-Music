import { renderInterfaceSound, type Sound } from './audio';
import { nativeFrontendIdentity } from './native-audio';

type Configuration = {
  design: 'rhine' | 'archive'; enabled: boolean; musicBusy: boolean;
  output: { backend: 'browser' | 'wasapi' | 'asio'; device: number; channel: number; wasapiDevice: string };
};
async function post(route: string, payload: unknown) {
  const response = await fetch(`/api/interface-audio/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Interface audio: ${response.status}`);
  return result;
}

/** Mirrors the single music output preference; never falls back to a default device. */
export class InterfaceAudioClient {
  private identity = nativeFrontendIdentity();
  private revision = 0;
  private sequence = 0;
  private generation = 0;
  private key = '';
  private configuration?: Configuration;
  private ready: Promise<unknown> = Promise.resolve();
  constructor(private onError: (error: Error) => void) {}
  configure(configuration: Configuration) {
    const key = JSON.stringify(configuration);
    if (key === this.key) return;
    this.key = key;
    this.configuration = configuration;
    this.revision++;
    this.generation++;
    this.sequence = 0;
    const revision = this.revision;
    this.ready = post('configure', { ...this.identity, revision, ...configuration });
    void this.ready.catch(error => { if (revision === this.revision) this.onError(error as Error) });
  }
  async play(sound: Sound, pan: number, volume: number) {
    const config = this.configuration;
    if (!config?.enabled || config.design !== 'rhine' || config.musicBusy || config.output.backend === 'browser') return;
    const generation = this.generation, revision = this.revision, sequence = ++this.sequence;
    try {
      const [rendered] = await Promise.all([renderInterfaceSound(sound, pan), this.ready]);
      if (generation !== this.generation) return;
      let binary = '';
      for (let offset = 0; offset < rendered.wav.length; offset += 8192) binary += String.fromCharCode(...rendered.wav.subarray(offset,offset+8192));
      await post('play', { ...this.identity, revision, sequence, sound, volume, wav: btoa(binary) });
    } catch (error) { if (generation === this.generation) this.onError(error as Error) }
  }
  stop() {
    this.generation++;
    if (!this.revision) return;
    const payload = { ...this.identity, revision: this.revision, sequence: ++this.sequence };
    void post('stop', payload).catch(error => this.onError(error as Error));
  }
}
