const FULLSCREEN_CHANNEL = 'rhine:window:fullscreen';
const FULLSCREEN_CHANGED_CHANNEL = 'rhine:window:fullscreen-changed';
const FULLSCREEN_TIMEOUT_MS = 5000;

function isDestroyed(target) {
  return !target || target.isDestroyed?.() === true;
}

function fullscreenState(target) {
  return target.isFullScreen() === true;
}

function registerWindowControls({ ipcMain, getWindow } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('ipcMain.handle is required');
  }
  if (typeof getWindow !== 'function') {
    throw new TypeError('getWindow must be a function');
  }

  let attached;

  function detach(record, reason = new Error('播放器窗口已关闭')) {
    if (!record || !record.active) return;
    record.active = false;
    record.target.removeListener('enter-full-screen', record.onFullscreenChange);
    record.target.removeListener('leave-full-screen', record.onFullscreenChange);
    record.target.removeListener('closed', record.onClosed);
    for (const waiter of [...record.waiters]) waiter.reject(reason);
    if (attached === record) attached = undefined;
  }

  function isOwnedMainFrameEvent(event, record) {
    const target = getWindow();
    if (!record.active || target !== record.target || isDestroyed(target) ||
        !target.webContents || target.webContents.isDestroyed?.() === true ||
        event.sender !== target.webContents) {
      return false;
    }
    const frame = event.senderFrame;
    if (!frame || frame !== target.webContents.mainFrame || typeof frame.url !== 'string') {
      return false;
    }
    try {
      return new URL(frame.url).origin === record.origin;
    } catch {
      return false;
    }
  }

  function notifyFullscreenChange(record) {
    if (!record.active || isDestroyed(record.target)) return;
    const state = fullscreenState(record.target);
    const contents = record.target.webContents;
    if (contents && contents.isDestroyed?.() !== true) {
      contents.send(FULLSCREEN_CHANGED_CHANNEL, state);
    }
    for (const waiter of [...record.waiters]) {
      if (waiter.expected === state) waiter.resolve(state);
    }
  }

  function waitForFullscreenChange(record, expected) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        record.waiters.delete(waiter);
      };
      const waiter = {
        expected,
        resolve(value) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        reject(error) {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        waiter.reject(new Error('等待 Electron 全屏状态更新超时'));
      }, FULLSCREEN_TIMEOUT_MS);
      record.waiters.add(waiter);

      try {
        if (!record.active || isDestroyed(record.target)) {
          waiter.reject(new Error('播放器窗口已关闭'));
          return;
        }
        record.target.setFullScreen(expected);
      } catch (error) {
        waiter.reject(error);
      }
    });
  }

  ipcMain.handle(FULLSCREEN_CHANNEL, async (event, action) => {
    const record = attached;
    if (!record || !isOwnedMainFrameEvent(event, record)) {
      throw new Error('无效的播放器窗口');
    }
    if (action !== 'get' && action !== 'toggle' && action !== 'exit') {
      throw new TypeError('无效的全屏操作');
    }

    if (action === 'get') {
      await record.queue;
      if (!isOwnedMainFrameEvent(event, record)) {
        throw new Error('无效的播放器窗口');
      }
      return fullscreenState(record.target);
    }

    const operation = record.queue.then(async () => {
      if (!isOwnedMainFrameEvent(event, record)) {
        throw new Error('无效的播放器窗口');
      }
      const current = fullscreenState(record.target);
      const expected = action === 'exit' ? false : !current;
      if (current === expected) return current;
      return waitForFullscreenChange(record, expected);
    });
    record.queue = operation.then(() => undefined, () => undefined);
    return operation;
  });

  return function attachWindow(target, url) {
    if (isDestroyed(target) || !target.webContents ||
        target.webContents.isDestroyed?.() === true ||
        typeof target.isFullScreen !== 'function' ||
        typeof target.setFullScreen !== 'function' ||
        typeof target.on !== 'function' ||
        typeof target.once !== 'function' ||
        typeof target.removeListener !== 'function') {
      throw new TypeError('target must be a live Electron BrowserWindow');
    }
    if (getWindow() !== target) {
      throw new Error('只能为当前播放器窗口注册控制');
    }

    let origin;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('不支持的播放器来源');
      }
      origin = parsed.origin;
    } catch {
      throw new TypeError('播放器 URL 必须是有效的 HTTP(S) 地址');
    }

    if (attached) detach(attached, new Error('播放器窗口已替换'));
    const record = {
      target,
      origin,
      active: true,
      queue: Promise.resolve(),
      waiters: new Set(),
      onFullscreenChange: undefined,
      onClosed: undefined,
    };
    // On Windows the event is emitted before BrowserWindow's cached state and
    // bounds are updated. Observe them on the next native event-loop turn.
    record.onFullscreenChange = () => setImmediate(() => notifyFullscreenChange(record));
    record.onClosed = () => detach(record);
    attached = record;
    target.on('enter-full-screen', record.onFullscreenChange);
    target.on('leave-full-screen', record.onFullscreenChange);
    target.once('closed', record.onClosed);
  };
}

module.exports = { registerWindowControls };
