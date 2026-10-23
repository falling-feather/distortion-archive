import type { Comparison, JpegFrame, PixelImage, Region, RegionId } from './types.ts';

export type WorkerRequest =
  | { type: 'init'; image: PixelImage; regions: Region[] }
  | { type: 'encode'; id: number; budget: number; priority: RegionId | null; regions:Region[]; restore?:Uint8Array };

export type WorkerResponse =
  | { type: 'ready'; frame: JpegFrame; minimumBytes: number; baseBytes: number; nonzeroAC: number }
  | { type: 'progress'; id: number; label: string }
  | { type: 'result'; id: number; comparison: Comparison }
  | { type: 'error'; id?: number; message: string; minimumBytes?: number };
