interface Component {
  lines: Uint8Array[];
  blocks: Int32Array[][];
  blocksPerLine: number;
  blocksPerColumn: number;
  quantizationTable: Int32Array;
  scaleX: number;
  scaleY: number;
}
export default function decode(bytes: Uint8Array, options?: {
  useTArray?: boolean;
  tolerantDecoding?: boolean;
  maxResolutionInMP?: number;
  maxMemoryUsageInMB?: number;
}): { width: number; height: number; data: Uint8Array; components: Component[] };
