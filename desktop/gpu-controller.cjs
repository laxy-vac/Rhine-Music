'use strict';

const fs = require('node:fs');
const {
  enumerateAdaptersSync, enumerateAdapters, normalizeGpuPreference,
  resolveGpuPreference, applyGpuPreference, adapterToPreference,
} = require('./gpu-selection.cjs');

// GPU selection is process-local and must precede app readiness. The normal
// preference store remains the only persistent authority for this setting.
function configureStartupGpu(app, preferenceFile) {
  let preference = 'auto', warning;
  try {
    if (fs.statSync(preferenceFile).size > 2 * 1024 * 1024) throw new Error('Preferences exceed limit');
    preference = normalizeGpuPreference(JSON.parse(fs.readFileSync(preferenceFile, 'utf8')).gpuPreference);
  } catch (error) {
    if (error.code !== 'ENOENT') warning = '显卡偏好读取失败，本次使用自动选择。';
  }
  let selection = { requested: preference, applied: 'auto', reason: null };
  const recoveryAuto = process.argv.includes('--gpu-auto');
  if (recoveryAuto) warning = '本次启动使用自动选卡；可在 GRAPHICS 中选择自动以恢复默认。';
  if (preference !== 'auto' && !recoveryAuto) {
    try {
      if (process.platform !== 'win32') throw new Error('Windows only');
      selection = resolveGpuPreference(preference, enumerateAdaptersSync());
    } catch {
      warning = '显卡列表读取失败，本次使用自动选择。';
    }
  }
  return { ...applyGpuPreference(app, selection), warning };
}

function registerGpuControls({ app, ipcMain, getWindow, getPreference, savePreference, waitForPreference = async () => {}, startup }) {
  let enumeration;
  const readAdapters = () => {
    if (!enumeration) enumeration = enumerateAdapters().finally(() => { enumeration = null; });
    return enumeration;
  };
  const owned = event => {
    const target = getWindow();
    if (!target || target.isDestroyed() || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame) return false;
    try {
      const origin = new URL(event.senderFrame.url).origin;
      return origin !== 'null' && origin === new URL(target.webContents.getURL()).origin;
    } catch { return false; }
  };
  const safePreference = value => { try { return normalizeGpuPreference(value); } catch { return 'auto'; } };
  const report = async adapters => {
    const supported = process.platform === 'win32';
    let activeName = null, warning = startup.warning || startup.reason || undefined;
    let timer;
    try {
      const info = await Promise.race([
        app.getGPUInfo('complete'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GPU info timeout')), 4500); timer.unref?.(); }),
      ]);
      const active = info.gpuDevice?.filter(device => device.active === true) ?? [];
      const device = active.length === 1 ? active[0] : null;
      activeName = device?.deviceString || info.auxAttributes?.glRenderer || null;
      if (startup.applied !== 'auto' && device) {
        const matching = adapters.filter(adapter => adapter.vendorId === device.vendorId && adapter.deviceId === device.deviceId);
        if (matching.length === 1 && matching[0].id !== startup.applied.id) warning = '驱动报告的当前显卡与启动选择不一致；该实验性选择未得到确认。';
        else if (matching.length !== 1) warning = '驱动未报告足以区分当前显卡的身份；该实验性选择尚未确认。';
      }
    } catch {
      warning ||= '当前使用的显卡暂时无法读取。';
    } finally { clearTimeout(timer); }
    // A new theme may mount while an old widget is still saving. Snapshot only
    // after the write/rollback finishes, and after all asynchronous GPU reads.
    await waitForPreference();
    const preference = safePreference(getPreference());
    const resolution = resolveGpuPreference(preference, adapters);
    const selectedId = preference === 'auto' ? 'auto' : resolution.applied === 'auto' ? 'unavailable' : resolution.applied.id;
    const choices = adapters.map((adapter, index) => ({
      id: adapter.id,
      name: adapters.filter(other => other.name === adapter.name).length > 1 ? `${adapter.name} · ${index + 1}` : adapter.name,
    }));
    const samePreference = preference === 'auto'
      ? startup.requested === 'auto'
      : startup.requested !== 'auto' && resolution.applied !== 'auto' && startup.applied !== 'auto' && resolution.applied.id === startup.applied.id;
    return { supported, adapters: choices, selectedId, activeName, restartRequired: !samePreference, warning };
  };
  ipcMain.handle('rhine:gpu:info', async event => {
    if (!owned(event)) throw new Error('Invalid player window');
    if (process.platform !== 'win32') return report([]);
    try { return await report(await readAdapters()); }
    catch (error) {
      await waitForPreference();
      return { supported: true, adapters: [], selectedId: safePreference(getPreference()) === 'auto' ? 'auto' : 'unavailable', activeName: null, restartRequired: false, error: `无法读取可用显卡：${error.message}` };
    }
  });
  ipcMain.handle('rhine:gpu:select', async (event, id) => {
    if (!owned(event) || process.platform !== 'win32') throw new Error('Invalid player window');
    if (typeof id !== 'string' || id.length > 160) throw new Error('Invalid GPU selection');
    const adapters = await readAdapters().catch(error => { if (id === 'auto') return []; throw error; });
    if (!owned(event)) throw new Error('Player window closed');
    const adapter = adapters.find(item => item.id === id);
    if (id !== 'auto' && !adapter) throw new Error('所选显卡已不可用，请刷新列表。');
    await savePreference(id === 'auto' ? 'auto' : adapterToPreference(adapter));
    return report(adapters);
  });
}

module.exports = { configureStartupGpu, registerGpuControls };
