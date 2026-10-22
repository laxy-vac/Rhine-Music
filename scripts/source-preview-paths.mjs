import path from 'node:path';

// Both desktop preview and the standalone development server share one index.
export function sourcePreviewPaths(project) {
  const root = path.resolve(project);
  const workspace = path.basename(path.dirname(root)).toLowerCase() === 'source'
    ? path.resolve(root, '../..') : path.dirname(root);
  const preview = path.join(workspace, 'music-data-source-preview');
  return { workspace, preview, home: path.join(preview, 'desktop'), dataDir: path.join(preview, 'music-data') };
}
