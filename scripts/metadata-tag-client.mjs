import { Worker } from 'node:worker_threads';

let worker, nextId = 0;
const pending = new Map();
function currentWorker() {
  if (worker) return worker;
  const instance = new Worker(new URL('./metadata-tag-worker.mjs', import.meta.url), { execArgv: [] });
  worker = instance;
  const fail = error => {
    if (worker !== instance) return;
    worker = undefined;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  instance.on('message', message => {
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error));
    else task.resolve(message.value);
    if (!pending.size) instance.unref();
  });
  instance.once('error', fail);
  instance.once('exit', code => fail(new Error(`标签后台工作进程已退出 (${code})，原文件不会被未经验证的结果覆盖。`)));
  instance.unref();
  return instance;
}
function call(operation, file, value) {
  return new Promise((resolve, reject) => {
    const instance = currentWorker(), id = ++nextId;
    pending.set(id, { resolve, reject });
    instance.ref();
    try { instance.postMessage({ id, operation, file, value }); }
    catch (error) { pending.delete(id); if (!pending.size) instance.unref(); reject(error); }
  });
}
export const readAudioTagDocument = file => call('read', file);
export const writeAudioTags = (file, value) => call('write', file, value);
