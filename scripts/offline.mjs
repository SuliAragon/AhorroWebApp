import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildOfflineApp() {
  return {
    name: 'ahorro-offline',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const root = fileURLToPath(dir);
        const files = await readdir(dir, { recursive: true, withFileTypes: true });
        const assets = files.flatMap((file) => {
          if (!file.isFile()) return [];
          const parts = relative(root, join(file.parentPath, file.name)).split(sep);
          if (parts.join('/') === 'index.html') return ['./'];
          if (!['_astro', 'icons', 'manifest.webmanifest'].includes(parts[0])) return [];
          return [parts.map(encodeURIComponent).join('/')];
        }).sort();

        const template = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
        const hash = createHash('sha256').update(template);
        for (const asset of assets) {
          hash.update(asset);
          hash.update(await readFile(new URL(asset === './' ? 'index.html' : asset, dir)));
        }
        const version = hash.digest('hex').slice(0, 16);
        const worker = template.replace('__VERSION__', JSON.stringify(version)).replace('__ASSETS__', JSON.stringify(assets));
        await writeFile(new URL('sw.js', dir), worker);
      },
    },
  };
}
