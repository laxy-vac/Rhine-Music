import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { replaceMetadataFile } from './metadata-file-replace.mjs';

const allowedAdsErrors = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM']);

test('metadata file replacement commits only staged bytes and preserves failure input', async t => {
  const testParent = path.resolve('.tools/metadata-editor-20261022/file-replace-tests');
  await fs.mkdir(testParent, { recursive: true });
  const testRoot = await fs.mkdtemp(path.join(testParent, 'test-'));
  try {
    const target = path.join(testRoot, '音楽 & [test].wav');
    const stage = path.join(testRoot, 'staged & value.tmp');
    const original = Buffer.from('original synthetic audio payload');
    const staged = Buffer.from('edited synthetic audio payload');
    await fs.writeFile(target, original);
    await fs.writeFile(stage, staged);

    const originalStat = process.platform === 'win32' ? await fs.stat(target, { bigint: true }) : undefined;
    let expectedAds;
    if (process.platform === 'win32') {
      expectedAds = Buffer.from('preserve-this-synthetic-alternate-stream');
      try { await fs.writeFile(`${target}:rhine_metadata_replace_check`, expectedAds); }
      catch (error) {
        if (!allowedAdsErrors.has(error.code)) throw error;
        expectedAds = undefined;
        t.diagnostic(`Alternate data stream check skipped on this filesystem (${error.code}).`);
      }
    }

    await replaceMetadataFile(stage, target);
    assert.deepEqual(await fs.readFile(target), staged);
    await assert.rejects(fs.lstat(stage), { code: 'ENOENT' });
    assert.deepEqual((await fs.readdir(testRoot)).filter(name => name.startsWith('.rhine-metadata-')), []);

    if (process.platform === 'win32') {
      const replacedStat = await fs.stat(target, { bigint: true });
      assert.equal(replacedStat.birthtimeNs, originalStat.birthtimeNs, 'File.Replace should preserve target creation time');
      if (expectedAds) {
        assert.deepEqual(await fs.readFile(`${target}:rhine_metadata_replace_check`), expectedAds,
          'File.Replace should preserve the target alternate data stream');
        t.diagnostic('Windows creation time and alternate data stream were verified.');
      } else {
        t.diagnostic('Windows creation time was verified; alternate data streams are unavailable here.');
      }
    }

    const afterSuccess = Buffer.from('still-preserved target after a rejected replacement');
    await fs.writeFile(target, afterSuccess);
    await assert.rejects(replaceMetadataFile(path.join(testRoot, 'missing-stage.tmp'), target), /stage does not exist/);
    assert.deepEqual(await fs.readFile(target), afterSuccess);
    assert.deepEqual((await fs.readdir(testRoot)).filter(name => name.startsWith('.rhine-metadata-')), []);

    const otherDirectory = path.join(testRoot, 'other');
    await fs.mkdir(otherDirectory);
    const otherStage = path.join(otherDirectory, 'stage.tmp');
    await fs.writeFile(otherStage, Buffer.from('wrong-directory stage'));
    await assert.rejects(replaceMetadataFile(otherStage, target), /same directory/);
    assert.deepEqual(await fs.readFile(target), afterSuccess);
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});
