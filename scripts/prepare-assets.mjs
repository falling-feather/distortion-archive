import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const upstreamLicense = await readFile(new URL('src/vendor/LICENSE.jpeg-js', root), 'utf8');
const encoder = await readFile(new URL('src/vendor/jpeg-encoder.js', root), 'utf8');
const encoderNotice = encoder.slice(0, encoder.indexOf('*/') + 2);
await writeFile(new URL('public/assets/third-party-licenses.txt', root), [
  '失真档案 · 第三方资源说明',
  'JPEG codec: jpeg-js 0.4.4, https://github.com/jpeg-js/jpeg-js/tree/v0.4.4',
  'Local changes: ESM exports; reusable quantized blocks; coefficient-only encoder; decoder block/table inspection.',
  'Both the repository license and the encoder-specific notice are reproduced below.',
  upstreamLicense, encoderNotice,
  'Demo photograph: generated with the built-in ImageGen tool. It is not an actual historical document.',
  'Source prompt and normalization details: /assets/source-info.json',
].join('\n\n') + '\n', 'utf8');
