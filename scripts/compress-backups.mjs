import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import {legacyPath} from '../lib/legacy-path.mjs';
const root = legacyPath(process.argv[2]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = [];
for (const name of fs.readdirSync(root).filter(name => /^state\.json\..+\.bak$/.test(name))) {
  const source = path.resolve(root, name);
  if (path.dirname(source) !== path.resolve(root) || !fs.lstatSync(source).isFile()) {
    throw new Error(`Unexpected backup path: ${source}`);
  }
  const original = fs.readFileSync(source);
  const destination = source + '.gz';
  if (!fs.existsSync(destination)) {
    const temporary = destination + '.tmp';
    fs.writeFileSync(temporary, gzipSync(original, { level: 9 }), { flag: 'wx' });
    fs.renameSync(temporary, destination);
  }
  const compressed = fs.readFileSync(destination);
  if (!gunzipSync(compressed).equals(original)) throw new Error(`Backup verification failed: ${name}`);
  if (!fs.readFileSync(source).equals(original)) throw new Error(`Backup changed during compression: ${name}`);
  // Only remove this exact immutable backup after verifying the saved archive.
  fs.unlinkSync(source);
  report.push({ name, originalBytes: original.length, compressedBytes: compressed.length, sha256: hash(original) });
}
if (report.length) {
  const filename = `backup-compression-${Date.now()}.json`;
  fs.writeFileSync(path.join(root, filename), JSON.stringify({ verifiedAt: new Date().toISOString(), backups: report }, null, 2));
}
console.log(JSON.stringify({ count: report.length, originalBytes: report.reduce((n, x) => n + x.originalBytes, 0), compressedBytes: report.reduce((n, x) => n + x.compressedBytes, 0) }, null, 2));
