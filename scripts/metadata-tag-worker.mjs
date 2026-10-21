import { parentPort } from 'node:worker_threads';
import { readAudioTagDocument, writeAudioTags } from './audio-tag-editor.mjs';

// TagLib's synchronous container work stays outside the service/audio event loop.
let queue = Promise.resolve();
parentPort.on('message', message => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      const value = message.operation === 'read' ? await readAudioTagDocument(message.file)
        : message.operation === 'write' ? await writeAudioTags(message.file, message.value) : (() => { throw new Error('未知的标签操作。'); })();
      // The service needs tag fields/capabilities, not a duplicate multi-MiB
      // image payload; cover previews use the existing constrained image API.
      if (message.operation === 'read') delete value.cover;
      parentPort.postMessage({ id: message.id, value });
    } catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
  });
});
