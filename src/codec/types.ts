export type RegionId = string;
export interface Region {
  id: RegionId;
  name: string;
  description: string;
  bounds: { x: number; y: number; width: number; height: number };
}
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface PreparedImage {
  width: number;
  height: number;
  quality: number;
  coefficients: Int16Array;
  tables: Uint16Array[];
  bytes: Uint8Array;
}
export interface JpegFrame {
  width: number;
  height: number;
  coefficients: Int16Array;
  tables: Uint16Array[];
  rgba: Uint8ClampedArray;
  luma: Uint8Array;
}
export interface RegionMetric {
  id: RegionId;
  mse: number;
  pixels: number;
}
export interface EncodedResult {
  budget: number;
  priority: RegionId | null;
  bytes: Uint8Array;
  frame: JpegFrame;
  regions: RegionMetric[];
  mse: number;
  retainedAC: number;
  candidateCount: number;
  elapsedMs: number;
}
export interface Comparison {
  uniform: EncodedResult;
  current: EncodedResult;
}
