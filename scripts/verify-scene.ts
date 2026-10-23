import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareImage, encodeAtBudget } from '../src/codec/engine.ts';
import { SCENE } from '../src/scene.ts';

const root = resolve(import.meta.dirname, '..');
const image = { width: SCENE.width, height: SCENE.height, data: new Uint8ClampedArray(readFileSync(resolve(root, 'tmp/scene-rgba.bin'))) };
const model = prepareImage(image, SCENE.regions);
console.log(JSON.stringify({ baselineBytes: model.prepared.bytes.length, floorBytes: model.minimumBytes, nonzeroAC: model.nonzeroAC }));
const output = resolve(root, 'tmp/codec-verification');
mkdirSync(output, { recursive: true });
const summaries = [];
for (const budget of [24,32,48].map(k => k * 1024)) {
  for (const priority of [null, 'letter', 'key', 'fabric'] as const) {
    const result = encodeAtBudget(model, budget, priority);
    const name = `${budget / 1024}-${priority ?? 'uniform'}`;
    writeFileSync(resolve(output, `${name}.jpg`), result.bytes);
    if (budget === 32 * 1024) writeFileSync(resolve(output, `${name}.rgba`), result.frame.rgba);
    const summary = { name, budget, bytes: result.bytes.length, ms: Math.round(result.elapsedMs), regions: result.regions.map(r => ({ id: r.id, mse: +r.mse.toFixed(2) })) };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }
}
writeFileSync(resolve(output, 'measurements.json'), JSON.stringify(summaries, null, 2) + '\n');
