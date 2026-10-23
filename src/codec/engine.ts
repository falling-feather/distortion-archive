import JPEGEncoder from '../vendor/jpeg-encoder.js';
import decode from '../vendor/jpeg-decoder.js';
import { validateRegions } from '../domain/regions.ts';
import type { EncodedResult, JpegFrame, PixelImage, PreparedImage, Region, RegionId, RegionMetric } from './types.ts';

export class BudgetTooSmallError extends Error {
  minimumBytes: number;
  constructor(minimumBytes: number) {
    super(`当前尺寸和固定量化设置至少需要 ${minimumBytes} 字节。`);
    this.name = 'BudgetTooSmallError';
    this.minimumBytes = minimumBytes;
  }
}

export interface ImageModel {
  original: PixelImage;
  prepared: PreparedImage;
  baseFrame: JpegFrame;
  regions: readonly Region[];
  minimumBytes: number;
  nonzeroAC: number;
  encoder: JPEGEncoder;
  dcOnly: Int16Array;
  minimumJpeg: Uint8Array;
  rankings: Map<string, Int32Array>;
  results: Map<string, EncodedResult>;
}

export function readJpeg(bytes: Uint8Array): JpegFrame {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
    throw new Error('JPEG 文件不完整。');
  }
  const decoded = decode(bytes, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 4, maxMemoryUsageInMB: 128 });
  if (decoded.components.length !== 3 || decoded.components.some(c => c.scaleX !== 1 || c.scaleY !== 1)) {
    throw new Error('本原型的频率检查仅接受自身输出的三分量 4:4:4 JPEG。');
  }
  const columns = Math.ceil(decoded.width / 8), rows = Math.ceil(decoded.height / 8);
  const coefficients = new Int16Array(columns * rows * 192);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < columns; bx++) {
      for (let c = 0; c < 3; c++) {
        coefficients.set(decoded.components[c].blocks[by][bx], ((by * columns + bx) * 3 + c) * 64);
      }
    }
  }
  const luma = new Uint8Array(decoded.width * decoded.height);
  for (let y = 0; y < decoded.height; y++) luma.set(decoded.components[0].lines[y].subarray(0, decoded.width), y * decoded.width);
  return {
    width: decoded.width, height: decoded.height,
    coefficients,
    tables: [Uint16Array.from(decoded.components[0].quantizationTable), Uint16Array.from(decoded.components[1].quantizationTable)],
    rgba: Uint8ClampedArray.from(decoded.data), luma,
  };
}

export function prepareImage(image: PixelImage, regions: readonly Region[]): ImageModel {
  validateRegions(regions);
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      image.width * image.height > 1024 * 1024 || image.data.length !== image.width * image.height * 4) {
    throw new Error('原图尺寸或像素数据不正确。');
  }
  const encoder = new JPEGEncoder(90);
  const prepared = encoder.prepare(image, 90);
  const baseFrame = readJpeg(prepared.bytes);
  const dcOnly = new Int16Array(prepared.coefficients.length);
  let nonzeroAC = 0;
  for (let i = 0; i < prepared.coefficients.length; i++) {
    if (i % 64 === 0) dcOnly[i] = prepared.coefficients[i];
    else if (prepared.coefficients[i] !== 0) nonzeroAC++;
  }
  const minimumJpeg = encoder.encodeCoefficients(prepared, dcOnly);
  return {
    original: { ...image, data: image.data.slice() }, prepared, baseFrame, regions:structuredClone(regions),
    minimumBytes: minimumJpeg.length, nonzeroAC, encoder, dcOnly, minimumJpeg,
    rankings: new Map(), results: new Map(),
  };
}

export function updateRegions(model:ImageModel,regions:readonly Region[]):void{
  validateRegions(regions);
  if(JSON.stringify(model.regions)===JSON.stringify(regions))return;
  model.regions=structuredClone(regions);model.rankings.clear();model.results.clear();
}

function coverage(region: Region, x: number, y: number, width: number, height: number): number {
  const r = region.bounds;
  const overlapX = Math.max(0, Math.min(x + 8, (r.x + r.width) * width, width) - Math.max(x, r.x * width));
  const overlapY = Math.max(0, Math.min(y + 8, (r.y + r.height) * height, height) - Math.max(y, r.y * height));
  return overlapX * overlapY / (Math.min(8, width - x) * Math.min(8, height - y));
}

function ranking(model: ImageModel, priority: RegionId | null): Int32Array {
  const key = priority === null ? 'uniform' : `region:${priority}`;
  const cached = model.rankings.get(key);
  if (cached) return cached;
  const region = priority === null ? undefined : model.regions.find(r => r.id === priority);
  if (priority !== null && !region) throw new Error('保护区域不存在。');
  const { width, height, coefficients, tables } = model.prepared;
  const columns = Math.ceil(width / 8);
  const entries: { index: number; score: number }[] = [];
  for (let offset = 0; offset < coefficients.length; offset += 64) {
    const block = Math.floor(offset / 192), c = Math.floor(offset / 64) % 3;
    const weight = region ? 1 + 31 * coverage(region, (block % columns) * 8, Math.floor(block / columns) * 8, width, height) : 1;
    const table = tables[c === 0 ? 0 : 1];
    for (let k = 1; k < 64; k++) {
      const q = coefficients[offset + k];
      if (q !== 0) entries.push({ index: offset + k, score: (q * table[k]) ** 2 * weight * (c === 0 ? 1 : 0.5) });
    }
  }
  entries.sort((a, b) => b.score - a.score || a.index - b.index);
  const order = Int32Array.from(entries.map(e => e.index));
  model.rankings.set(key, order);
  return order;
}

function measure(original: PixelImage, frame: JpegFrame, regions: readonly Region[]): { mse: number; regions: RegionMetric[] } {
  const { width, height, data } = original;
  let total = 0;
  const errors = new Float64Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    errors[p] = ((data[i] - frame.rgba[i]) ** 2 + (data[i + 1] - frame.rgba[i + 1]) ** 2 + (data[i + 2] - frame.rgba[i + 2]) ** 2) / 3;
    total += errors[p];
  }
  return {
    mse: total / errors.length,
    regions: regions.map(region => {
      const b = region.bounds;
      const x0 = Math.max(0, Math.floor(b.x * width)), y0 = Math.max(0, Math.floor(b.y * height));
      const x1 = Math.min(width, Math.ceil((b.x + b.width) * width)), y1 = Math.min(height, Math.ceil((b.y + b.height) * height));
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += errors[y * width + x]; count++; }
      return { id: region.id, mse: count ? sum / count : 0, pixels: count };
    }),
  };
}

export function restoreResult(model:ImageModel,bytes:Uint8Array,budget:number,priority:RegionId|null):EncodedResult{
  if(bytes.length>budget)throw new Error('档案文件超过记录的预算，不能作为有效结果恢复。');
  const expected=encodeAtBudget(model,budget,priority);
  if(bytes.length!==expected.bytes.length||bytes.some((byte,index)=>byte!==expected.bytes[index]))throw new Error('档案的图像、区域或编码设置与实际 JPEG 不一致；原档案未修改。');
  const frame=readJpeg(bytes);
  return {...expected,bytes:bytes.slice(),frame,...measure(model.original,frame,model.regions)};
}

export function encodeAtBudget(model: ImageModel, budget: number, priority: RegionId | null): EncodedResult {
  if (!Number.isFinite(budget) || budget < model.minimumBytes) throw new BudgetTooSmallError(model.minimumBytes);
  budget = Math.floor(budget);
  const cacheKey = `${budget}:${priority === null ? 'uniform' : `region:${priority}`}`;
  const cached = model.results.get(cacheKey);
  if (cached) return cached;
  const start = performance.now();
  const order = ranking(model, priority);
  let bestBytes = model.minimumJpeg;
  let bestKeep = 0;
  let candidateCount = 1;
  const measured = new Set<number>([0]);
  function attempt(keep: number): number {
    if (measured.has(keep)) return keep === bestKeep ? bestBytes.length : Infinity;
    measured.add(keep);
    const coefficients = model.dcOnly.slice();
    for (let j = 0; j < keep; j++) coefficients[order[j]] = model.prepared.coefficients[order[j]];
    const bytes = model.encoder.encodeCoefficients(model.prepared, coefficients);
    candidateCount++;
    if (bytes.length <= budget && keep > bestKeep) { bestKeep = keep; bestBytes = bytes; }
    return bytes.length;
  }
  if (model.prepared.bytes.length <= budget) {
    bestBytes = model.prepared.bytes;
    bestKeep = order.length;
  } else if (budget > model.minimumBytes) {
    let lo = 0, hi = order.length;
    // Bisection proposes candidates only; every accepted result is measured.
    // Entropy size need not be monotone, and this is not a global optimizer.
    while (hi - lo > 1) {
      const middle = Math.floor((lo + hi) / 2);
      if (attempt(middle) <= budget) lo = middle;
      else hi = middle;
    }
    const near = bestKeep;
    for (let step = 1; step <= 6; step++) if (near + step < order.length) attempt(near + step);
  }
  const frame = readJpeg(bestBytes);
  const result: EncodedResult = {
    budget, priority, bytes: bestBytes, frame,
    ...measure(model.original, frame, model.regions),
    retainedAC: bestKeep, candidateCount, elapsedMs: performance.now() - start,
  };
  model.results.set(cacheKey, result);
  if (model.results.size > 8) model.results.delete(model.results.keys().next().value!);
  return result;
}

export const DCT_BASIS = Array.from({ length: 64 }, (_, k) => {
  const u = k % 8, v = Math.floor(k / 8);
  const scale = (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1) / 4;
  return Float64Array.from({ length: 64 }, (_, p) => scale * Math.cos((2 * (p % 8) + 1) * u * Math.PI / 16) * Math.cos((2 * Math.floor(p / 8) + 1) * v * Math.PI / 16));
});

export function reconstructLuma(coefficients: Int16Array, table: Uint16Array): Uint8ClampedArray {
  const pixels = new Float64Array(64).fill(128);
  for (let k = 0; k < 64; k++) for (let p = 0; p < 64; p++) pixels[p] += coefficients[k] * table[k] * DCT_BASIS[k][p];
  return Uint8ClampedArray.from(pixels, p => Math.round(p));
}
