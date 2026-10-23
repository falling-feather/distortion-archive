import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImage, encodeAtBudget, readJpeg, reconstructLuma, BudgetTooSmallError } from '../src/codec/engine.ts';
import type { PixelImage, Region } from '../src/codec/types.ts';

const regions: Region[] = [
  { id: 'letter', name: '字迹', description: '', bounds: { x: 0, y: 0, width: 0.5, height: 1 } },
  { id: 'fabric', name: '纹理', description: '', bounds: { x: 0.5, y: 0, width: 0.5, height: 1 } },
];

function fixture(width = 96, height = 64): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const value = ((x % 7 < 2 && y % 13 < 10) || (y % 9 === 0)) ? 35 : 210;
      data.set([value, value, value, 255], p);
    }
  }
  return { width, height, data };
}

test('JPEG independently re-parses the exact edited coefficients and quantization tables', () => {
  const model = prepareImage(fixture(), regions);
  const budget = Math.floor((model.minimumBytes + model.prepared.bytes.length) / 2);
  const result = encodeAtBudget(model, budget, 'letter');
  assert.ok(result.bytes.length <= budget);
  assert.equal(result.bytes[0], 0xff);
  assert.equal(result.bytes[1], 0xd8);
  assert.equal(result.bytes.at(-1), 0xd9);
  const decoded = readJpeg(result.bytes);
  assert.equal(decoded.width, 96);
  assert.equal(decoded.height, 64);
  assert.deepEqual(decoded.coefficients, result.frame.coefficients);
  assert.deepEqual(decoded.tables, model.prepared.tables);
  assert.ok(result.retainedAC < model.nonzeroAC);
});

test('under a shared budget the protected region improves at a measured cost elsewhere', () => {
  const model = prepareImage(fixture(), regions);
  const budget = Math.floor(model.minimumBytes + (model.prepared.bytes.length - model.minimumBytes) * 0.48);
  const uniform = encodeAtBudget(model, budget, null);
  const priority = encodeAtBudget(model, budget, 'letter');
  assert.ok(uniform.bytes.length <= budget && priority.bytes.length <= budget);
  assert.ok(priority.regions[0].mse < uniform.regions[0].mse);
  assert.ok(priority.regions[1].mse > uniform.regions[1].mse);
  assert.ok(Math.abs(priority.bytes.length - uniform.bytes.length) / budget < 0.04);
});

test('undoing a choice is deterministic and never mutates the original or master coefficients', () => {
  const pixels = fixture();
  const original = pixels.data.slice();
  const model = prepareImage(pixels, regions);
  const master = model.prepared.coefficients.slice();
  const budget = Math.floor((model.minimumBytes + model.prepared.bytes.length) / 2);
  const first = encodeAtBudget(model, budget, 'letter');
  encodeAtBudget(model, budget, 'fabric');
  const restored = encodeAtBudget(model, budget, 'letter');
  assert.deepEqual(restored.bytes, first.bytes);
  assert.deepEqual(model.prepared.coefficients, master);
  assert.deepEqual(pixels.data, original);
});

test('an impossible budget reports its measured floor rather than changing dimensions', () => {
  const model = prepareImage(fixture(), regions);
  assert.throws(() => encodeAtBudget(model, model.minimumBytes - 1, null), (error) => {
    assert.ok(error instanceof BudgetTooSmallError);
    assert.equal(error.minimumBytes, model.minimumBytes);
    return true;
  });
  const result = encodeAtBudget(model, model.minimumBytes, null);
  assert.equal(result.retainedAC, 0);
  assert.equal(result.bytes.length, model.minimumBytes);
});

test('non-multiple-of-eight edges retain exact image dimensions and valid pixels', () => {
  const model = prepareImage(fixture(19, 13), regions);
  const result = encodeAtBudget(model, model.prepared.bytes.length, null);
  assert.equal(result.frame.width, 19);
  assert.equal(result.frame.height, 13);
  assert.equal(result.frame.rgba.length, 19 * 13 * 4);
  assert.equal(result.frame.coefficients.length, 3 * 2 * 3 * 64);
  assert.deepEqual(result.bytes, model.prepared.bytes);
});

test('a DC-only block is constant and the displayed inverse transform matches decoded luminance', () => {
  const coefficients = new Int16Array(64);
  const table = new Uint16Array(64).fill(1);
  coefficients[0] = 80;
  assert.deepEqual([...reconstructLuma(coefficients, table)], new Array(64).fill(138));
  const model = prepareImage(fixture(), regions);
  const result = encodeAtBudget(model, Math.floor((model.minimumBytes + model.prepared.bytes.length) / 2), 'letter');
  const block = result.frame.coefficients.subarray(0, 64);
  const pixels = reconstructLuma(block, result.frame.tables[0]);
  for (let i = 0; i < 64; i++) {
    const x = i % 8, y = Math.floor(i / 8);
    assert.ok(Math.abs(pixels[i] - result.frame.luma[y * result.frame.width + x]) <= 2);
  }
});

test('truncated or unrelated data is rejected instead of producing a pretend preview', () => {
  assert.throws(() => readJpeg(new Uint8Array([0xff, 0xd8, 0xff])));
  assert.throws(() => prepareImage({ width: 10, height: 10, data: new Uint8ClampedArray(8) }, regions));
});
