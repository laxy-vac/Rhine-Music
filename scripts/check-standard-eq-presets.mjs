import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { createStandardEqPresetStore, registerStandardEqPresetIpc } = require('../desktop/standard-eq-presets.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const format = await import(pathToFileURL(path.join(root, 'src', 'standard-eq-preset-format.mjs')).href);
const toolsRoot = path.join(root, '.tools');
await fs.mkdir(toolsRoot, { recursive: true });
const runRoot = await fs.mkdtemp(path.join(toolsRoot, 'standard-eq-presets-check-'));

function makeDialog() {
  const openResults = [];
  const saveResults = [];
  const calls = [];
  return {
    openResults,
    saveResults,
    calls,
    async showOpenDialog(_window, options) {
      calls.push({ type: 'open', options });
      return openResults.shift() ?? { canceled: true, filePaths: [] };
    },
    async showSaveDialog(_window, options) {
      calls.push({ type: 'save', options });
      return saveResults.shift() ?? { canceled: true, filePath: '' };
    },
  };
}

function createHarness({ home, audioPresetFile, dialog, openedDirectories }) {
  const shell = { async openPath(directory) { openedDirectories.push(directory); return ''; } };
  return createStandardEqPresetStore({ home, audioPresetFile, projectRoot: root, dialog, shell });
}

function request(action, fields = {}) {
  return { action, language: 'en', ...fields };
}

function messageContains(result, fragment) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.error, new RegExp(fragment, 'i'));
}

async function main() {
  const home = path.join(runRoot, 'home');
  const eqDirectory = path.join(runRoot, 'presets', 'eq');
  const audioPresetFile = path.join(eqDirectory, 'audio-processing-presets.json');
  const sourceDirectory = path.join(runRoot, 'chosen-source');
  const externalDirectory = path.join(runRoot, 'outside');
  await Promise.all([
    fs.mkdir(home, { recursive: true }),
    fs.mkdir(eqDirectory, { recursive: true }),
    fs.mkdir(sourceDirectory, { recursive: true }),
    fs.mkdir(externalDirectory, { recursive: true }),
  ]);

  const dialog = makeDialog();
  const openedDirectories = [];
  const store = createHarness({ home, audioPresetFile, dialog, openedDirectories });
  const powerampText = JSON.stringify({ name: 'Internal label', parametric: true, preamp: 0, bands: [] }, null, 2);
  const powerampBytes = Buffer.from(powerampText, 'utf8');
  const sourcePath = path.join(sourceDirectory, 'Starter.json');
  await fs.writeFile(sourcePath, powerampBytes);

  const initial = await store.invoke(request('list'));
  assert.equal(initial.ok, true);
  assert.equal(initial.directory, path.join(eqDirectory, 'standard'));
  assert.deepEqual(initial.presets, []);

  const freshStorageRoot = path.join(runRoot, 'fresh-machine');
  const freshStore = createHarness({
    home: path.join(freshStorageRoot, 'home'),
    audioPresetFile: path.join(freshStorageRoot, 'not-created', 'presets', 'eq', 'audio-processing-presets.json'),
    dialog: makeDialog(),
    openedDirectories,
  });
  const freshList = await freshStore.invoke(request('list'));
  assert.equal(freshList.ok, true);
  assert.equal((await fs.stat(freshList.directory)).isDirectory(), true);

  dialog.openResults.push({ canceled: false, filePaths: [sourcePath] });
  const imported = await store.invoke(request('import'));
  assert.equal(imported.ok, true);
  assert.equal(imported.selected.fileName, 'Starter.json');
  assert.equal(imported.selected.name, 'Starter');
  assert.equal(imported.selected.format, 'poweramp');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Starter.json')), powerampBytes);
  const publicRead = await store.invoke(request('read', { fileName: imported.selected.fileName }));
  assert.equal(publicRead.ok, true);
  assert.deepEqual(Object.keys(publicRead.selected).sort(), ['fileName', 'format', 'name', 'revision', 'sourceText']);
  assert.equal(Object.hasOwn(publicRead.selected, 'bytes'), false);

  dialog.openResults.push({ canceled: false, filePaths: [sourcePath] });
  const duplicateImport = await store.invoke(request('import'));
  assert.equal(duplicateImport.ok, true);
  assert.equal(duplicateImport.selected.fileName, 'Starter (2).json');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Starter (2).json')), powerampBytes);

  const extensionlessPath = path.join(sourceDirectory, 'LegacyPreset');
  const unknownExtensionPath = path.join(sourceDirectory, 'VendorDump.bin');
  await fs.writeFile(extensionlessPath, powerampBytes);
  await fs.writeFile(unknownExtensionPath, powerampBytes);
  dialog.openResults.push({ canceled: false, filePaths: [extensionlessPath] });
  const importedExtensionless = await store.invoke(request('import'));
  assert.equal(importedExtensionless.ok, true);
  assert.equal(importedExtensionless.selected.fileName, 'LegacyPreset.json');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'LegacyPreset.json')), powerampBytes);
  dialog.openResults.push({ canceled: false, filePaths: [unknownExtensionPath] });
  const importedUnknownExtension = await store.invoke(request('import'));
  assert.equal(importedUnknownExtension.ok, true);
  assert.equal(importedUnknownExtension.selected.fileName, 'VendorDump.json');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'VendorDump.json')), powerampBytes);
  assert.ok(dialog.calls.filter(call => call.type === 'open').at(-1).options.filters.some(filter => filter.extensions.includes('*')));

  const parsedPoweramp = format.parseStandardEqPresetFile(powerampText, 'Starter.json');
  const localText = format.serializeStandardEqPresetFile({ eq: parsedPoweramp.eq, tone: parsedPoweramp.tone });
  assert.equal(JSON.parse(localText).format, 'rhine-standard-eq-preset');
  assert.equal(Object.hasOwn(JSON.parse(localText), 'bands'), false);

  const localSourcePath = path.join(sourceDirectory, 'Personal.rhine-eq');
  const localSourceBytes = Buffer.from(localText, 'utf8');
  await fs.writeFile(localSourcePath, localSourceBytes);
  const mislabeledLocalPath = path.join(sourceDirectory, 'Mislabeled.json');
  const unknownLocalPath = path.join(sourceDirectory, 'PersonalDump.dat');
  await fs.writeFile(mislabeledLocalPath, localSourceBytes);
  await fs.writeFile(unknownLocalPath, localSourceBytes);
  dialog.openResults.push({ canceled: false, filePaths: [mislabeledLocalPath] });
  const mislabeledLocal = await store.invoke(request('import'));
  messageContains(mislabeledLocal, 'format does not match');
  await assert.rejects(fs.access(path.join(initial.directory, 'Mislabeled.json')));
  dialog.openResults.push({ canceled: false, filePaths: [unknownLocalPath] });
  const importedUnknownLocal = await store.invoke(request('import'));
  assert.equal(importedUnknownLocal.ok, true);
  assert.equal(importedUnknownLocal.selected.fileName, 'PersonalDump.rhine-eq');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'PersonalDump.rhine-eq')), localSourceBytes);
  dialog.openResults.push({ canceled: false, filePaths: [localSourcePath] });
  const importedLocal = await store.invoke(request('import'));
  assert.equal(importedLocal.ok, true);
  assert.equal(importedLocal.selected.name, 'Personal');
  assert.equal(importedLocal.selected.format, 'rhine-standard');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Personal.rhine-eq')), localSourceBytes);

  const savedPoweramp = await store.invoke(request('save', {
    fileName: imported.selected.fileName,
    revision: imported.selected.revision,
    content: localText,
  }));
  assert.equal(savedPoweramp.ok, true);
  assert.equal(savedPoweramp.selected.fileName, 'Starter.rhine-eq');
  assert.equal(savedPoweramp.selected.format, 'rhine-standard');
  assert.match(savedPoweramp.message, /original was kept/i);
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Starter.json')), powerampBytes);
  const parsedLocal = format.parseStandardEqPresetFile(savedPoweramp.selected.sourceText, savedPoweramp.selected.fileName);
  assert.equal(parsedLocal.format, 'rhine-standard');

  const editedLocalText = format.serializeStandardEqPresetFile({
    eq: { ...parsedLocal.eq, preamp: parsedLocal.eq.preamp - 1 },
    tone: parsedLocal.tone,
  });
  const overwriteSaved = await store.invoke(request('save', {
    fileName: savedPoweramp.selected.fileName,
    revision: savedPoweramp.selected.revision,
    content: editedLocalText,
  }));
  assert.equal(overwriteSaved.ok, true);
  assert.notEqual(overwriteSaved.selected.revision, savedPoweramp.selected.revision);
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Starter.rhine-eq')), Buffer.from(editedLocalText, 'utf8'));

  const saveDialogsBeforeCopy = dialog.calls.filter(call => call.type === 'save').length;
  const copy = await store.invoke(request('save-copy', { name: 'Starter', content: localText }));
  assert.equal(copy.ok, true);
  assert.equal(copy.selected.fileName, 'Starter (2).rhine-eq');
  assert.equal(copy.selected.format, 'rhine-standard');
  assert.equal(dialog.calls.filter(call => call.type === 'save').length, saveDialogsBeforeCopy);

  const renamedPoweramp = await store.invoke(request('rename', {
    fileName: 'Starter (2).json', revision: duplicateImport.selected.revision, name: 'Poweramp archive copy',
  }));
  assert.equal(renamedPoweramp.ok, true, JSON.stringify(renamedPoweramp));
  assert.equal(renamedPoweramp.selected.fileName, 'Poweramp archive copy.json');
  assert.equal(renamedPoweramp.selected.format, 'poweramp');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, renamedPoweramp.selected.fileName)), powerampBytes);
  let caseRenameChecked = false;
  if (process.platform === 'win32') {
    const caseRenamed = await store.invoke(request('rename', {
      fileName: renamedPoweramp.selected.fileName,
      revision: renamedPoweramp.selected.revision,
      name: 'poweramp archive copy',
    }));
    assert.equal(caseRenamed.ok, true, JSON.stringify(caseRenamed));
    assert.equal(caseRenamed.selected.fileName, 'poweramp archive copy.json');
    assert.deepEqual(await fs.readFile(path.join(initial.directory, caseRenamed.selected.fileName)), powerampBytes);
    const caseNames = (await fs.readdir(initial.directory)).filter(name => name.toLowerCase() === 'poweramp archive copy.json');
    assert.equal(caseNames.length, 1);
    assert.equal(caseNames[0], 'poweramp archive copy.json');
    caseRenameChecked = true;
  }

  const renamedLocal = await store.invoke(request('rename', {
    fileName: copy.selected.fileName, revision: copy.selected.revision, name: 'Renamed Rhine preset',
  }));
  assert.equal(renamedLocal.ok, true);
  assert.equal(renamedLocal.selected.fileName, 'Renamed Rhine preset.rhine-eq');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, renamedLocal.selected.fileName)), Buffer.from(localText, 'utf8'));

  const collision = await store.invoke(request('rename', {
    fileName: renamedLocal.selected.fileName, revision: renamedLocal.selected.revision, name: 'Starter',
  }));
  messageContains(collision, 'already exists');
  const traversal = await store.invoke(request('read', { fileName: '..\\outside.json' }));
  messageContains(traversal, 'file name is invalid');
  const reserved = await store.invoke(request('rename', {
    fileName: renamedLocal.selected.fileName, revision: renamedLocal.selected.revision, name: 'CON',
  }));
  messageContains(reserved, 'name is invalid');

  const staleExternal = Buffer.from(localText.replace('"preamp": 0', '"preamp": 1'), 'utf8');
  await fs.writeFile(path.join(initial.directory, 'Starter.rhine-eq'), staleExternal);
  const staleSave = await store.invoke(request('save', {
    fileName: savedPoweramp.selected.fileName,
    revision: savedPoweramp.selected.revision,
    content: localText,
  }));
  messageContains(staleSave, 'revision does not match');
  assert.deepEqual(await fs.readFile(path.join(initial.directory, 'Starter.rhine-eq')), staleExternal);

  const badFile = path.join(initial.directory, 'Broken.json');
  await fs.writeFile(badFile, '{broken');
  const nestedDirectory = path.join(initial.directory, 'nested');
  await fs.mkdir(nestedDirectory);
  await fs.writeFile(path.join(nestedDirectory, 'Hidden.json'), powerampBytes);
  const listing = await store.invoke(request('list'));
  assert.equal(listing.ok, true);
  assert.ok(listing.presets.some(preset => preset.fileName === 'Starter.json' && preset.format === 'poweramp'));
  assert.ok(listing.presets.some(preset => preset.fileName === 'Starter.rhine-eq' && preset.format === 'rhine-standard'));
  assert.equal(listing.presets.some(preset => preset.fileName === 'Hidden.json'), false);
  assert.ok(listing.issues.some(issue => issue.startsWith('Broken.json:')));

  let symlinkChecked = false;
  const symlinkPath = path.join(initial.directory, 'Linked.json');
  try {
    await fs.symlink(sourcePath, symlinkPath, 'file');
    symlinkChecked = true;
    const linkedRead = await store.invoke(request('read', { fileName: 'Linked.json' }));
    messageContains(linkedRead, 'symbolic link');
    const linkedListing = await store.invoke(request('list'));
    assert.ok(linkedListing.issues.some(issue => issue.startsWith('Linked.json:')));
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
  } finally {
    if (symlinkChecked) await fs.unlink(symlinkPath);
  }

  dialog.saveResults.push({ canceled: false, filePath: path.join(externalDirectory, 'Edited.json') });
  const savedOutside = await store.invoke(request('save-as', { name: 'Edited', content: localText }));
  assert.equal(savedOutside.ok, true);
  assert.equal(savedOutside.savedOutside, true);
  assert.equal(savedOutside.selected, undefined);
  assert.ok(savedOutside.filePath.endsWith('Edited.json.rhine-eq'));
  assert.equal(format.parseStandardEqPresetFile(await fs.readFile(savedOutside.filePath, 'utf8'), path.basename(savedOutside.filePath)).format, 'rhine-standard');
  const saveDialogCall = dialog.calls.filter(call => call.type === 'save').at(-1);
  assert.ok(saveDialogCall.options.properties.includes('showOverwriteConfirmation'));
  assert.deepEqual(saveDialogCall.options.filters[0].extensions, ['rhine-eq']);

  const correctedTarget = path.join(externalDirectory, 'WrongExtension.json.rhine-eq');
  const protectedBytes = Buffer.from('preserve existing file');
  await fs.writeFile(correctedTarget, protectedBytes);
  dialog.saveResults.push({ canceled: false, filePath: path.join(externalDirectory, 'WrongExtension.json') });
  const refusedCorrectedOverwrite = await store.invoke(request('save-as', { name: 'WrongExtension', content: localText }));
  messageContains(refusedCorrectedOverwrite, 'corrected \.rhine-eq target already exists');
  assert.deepEqual(await fs.readFile(correctedTarget), protectedBytes);

  const replacementText = format.serializeStandardEqPresetFile({
    eq: { ...parsedPoweramp.eq, preamp: parsedPoweramp.eq.preamp - 0.5 },
    tone: parsedPoweramp.tone,
  });
  dialog.saveResults.push({ canceled: false, filePath: savedOutside.filePath });
  const overwrittenOutside = await store.invoke(request('save-as', { name: 'Edited', content: replacementText }));
  assert.equal(overwrittenOutside.ok, true);
  assert.equal(overwrittenOutside.savedOutside, true);
  assert.equal(overwrittenOutside.selected, undefined);
  assert.deepEqual(await fs.readFile(savedOutside.filePath), Buffer.from(replacementText, 'utf8'));

  dialog.saveResults.push({ canceled: false, filePath: path.join(initial.directory, 'Inside.rhine-eq') });
  const savedInside = await store.invoke(request('save-as', { name: 'Inside', content: localText }));
  assert.equal(savedInside.ok, true);
  assert.equal(savedInside.savedOutside, undefined);
  assert.equal(savedInside.selected.fileName, 'Inside.rhine-eq');
  assert.ok(savedInside.presets.some(preset => preset.fileName === 'Inside.rhine-eq'));

  dialog.saveResults.push({ canceled: true, filePath: '' });
  const cancelledSave = await store.invoke(request('save-as', { name: 'Cancelled', content: localText }));
  assert.equal(cancelledSave.ok, true);
  assert.equal(cancelledSave.cancelled, true);
  dialog.openResults.push({ canceled: true, filePaths: [] });
  const cancelledImport = await store.invoke(request('import'));
  assert.equal(cancelledImport.ok, true);
  assert.equal(cancelledImport.cancelled, true);

  const chosenDirectory = path.join(runRoot, 'user-selected');
  await fs.mkdir(chosenDirectory);
  dialog.openResults.push({ canceled: false, filePaths: [chosenDirectory] });
  const chosen = await store.invoke(request('choose-directory'));
  assert.equal(chosen.ok, true);
  assert.equal(chosen.directory, chosenDirectory);
  await fs.rm(chosenDirectory, { recursive: true });
  const recoveryDirectory = path.join(runRoot, 'recovered-library');
  await fs.mkdir(recoveryDirectory);
  dialog.openResults.push({ canceled: false, filePaths: [recoveryDirectory] });
  const recovered = await store.invoke(request('choose-directory'));
  assert.equal(recovered.ok, true);
  assert.equal(recovered.directory, recoveryDirectory);
  const recoveryDialog = dialog.calls.filter(call => call.type === 'open').at(-1);
  assert.equal(recoveryDialog.options.defaultPath, runRoot);
  assert.equal((await fs.stat(recoveryDialog.options.defaultPath)).isDirectory(), true);
  dialog.openResults.push({ canceled: true, filePaths: [] });
  const cancelledDirectory = await store.invoke(request('choose-directory'));
  assert.equal(cancelledDirectory.ok, true);
  assert.equal(cancelledDirectory.cancelled, true);
  const configPath = path.join(home, 'standard-eq-library.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['directory', 'schemaVersion']);
  assert.equal(config.directory, recoveryDirectory);

  const reopenedStore = createHarness({ home, audioPresetFile, dialog, openedDirectories });
  const persisted = await reopenedStore.invoke(request('list'));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.directory, recoveryDirectory);
  const opened = await reopenedStore.invoke(request('open-directory'));
  assert.equal(opened.ok, true);
  assert.deepEqual(openedDirectories, [recoveryDirectory]);

  const invalidPathCapability = await store.invoke(request('read', { fileName: 'Starter.json', path: sourcePath }));
  messageContains(invalidPathCapability, 'invalid standard EQ preset request');

  let ipcHandler;
  const ipcMain = { handle(channel, handler) { assert.equal(channel, 'rhine:standard-eq-presets'); ipcHandler = handler; } };
  let authorized = false;
  registerStandardEqPresetIpc({ ipcMain, store: reopenedStore, ownedEvent: () => authorized });
  const foreignResponse = await ipcHandler({ sender: {} }, request('list'));
  assert.equal(foreignResponse.ok, false);
  authorized = true;
  const ownedResponse = await ipcHandler({ sender: {} }, request('list'));
  assert.equal(ownedResponse.ok, true);

  return { ok: true, symlinkChecked, caseRenameChecked };
}

try {
  const report = await main();
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  const resolvedTools = path.resolve(toolsRoot);
  const resolvedRun = path.resolve(runRoot);
  if (path.dirname(resolvedRun) !== resolvedTools || !path.basename(resolvedRun).startsWith('standard-eq-presets-check-')) {
    throw new Error('Refusing to remove a path outside the dedicated ignored test directory');
  }
  await fs.rm(resolvedRun, { recursive: true, force: true });
}
