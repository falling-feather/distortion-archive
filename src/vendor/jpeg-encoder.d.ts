import type { PixelImage, PreparedImage } from '../codec/types.ts';
export default class JPEGEncoder {
  constructor(quality?: number);
  prepare(image: PixelImage, quality?: number): PreparedImage;
  encodeCoefficients(image: PreparedImage, coefficients: Int16Array): Uint8Array;
}
