import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectLocalModuleGraph,
  inspectPreviewPayloadInputs,
  productionPackageEntries,
} from './stage-preview-payload.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function checkSyntheticGraph() {
  const tempParent = path.join(projectRoot, '.tools', 'preview-release');
  await fs.mkdir(tempParent, { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(tempParent, '.check-'));
  try {
    const files = {
      'scripts/entry.mjs': "import { value } from './server.mjs';\n" +
        "import metadata from './metadata.json' with { type: 'json' };\n" +
        "await import('./late.mjs');\nexport { value, metadata };\n",
      'scripts/server.mjs': "export { value } from '../src/module.mjs';\n",
      'scripts/late.mjs': 'export default 1;\n',
      'scripts/metadata.json': '{"kind":"fixture"}\n',
      'src/module.mjs': 'export const value = 1;\n',
    };
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(tempRoot, ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
    const graph = await collectLocalModuleGraph(tempRoot, ['scripts/entry.mjs']);
    assert.deepEqual(graph.files, [
      'scripts/entry.mjs',
      'scripts/late.mjs',
      'scripts/metadata.json',
      'scripts/server.mjs',
      'src/module.mjs',
    ]);
    assert.deepEqual(graph.packages, []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function checkProductionLockSelection() {
  const lockfile = {
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/runtime-pkg': { version: '1.0.0' },
      'node_modules/dev-pkg': { version: '1.0.0', dev: true },
      'node_modules/win-pkg': {
        version: '1.0.0',
        optional: true,
        os: ['win32'],
        cpu: ['x64'],
      },
      'node_modules/linux-pkg': {
        version: '1.0.0',
        optional: true,
        os: ['linux'],
        cpu: ['x64'],
      },
    },
  };
  const selected = productionPackageEntries(lockfile, 'win32', 'x64').map((entry) => entry.path);
  assert.deepEqual(selected, ['node_modules/runtime-pkg', 'node_modules/win-pkg']);
}

await checkSyntheticGraph();
checkProductionLockSelection();
const inputs = await inspectPreviewPayloadInputs({ projectRoot });
process.stdout.write(JSON.stringify({
  staticInputs: 'ready',
  interfaceSourceFiles: Object.keys(inputs.interfaceBuild.sourceFiles).length,
  serverGraphFiles: inputs.graph.files.length,
  productionPackages: inputs.production.entries.length,
  nativeRuntimeFiles: Object.keys(inputs.native.manifest.files).length,
  warnings: inputs.warnings,
}, null, 2) + '\n');
