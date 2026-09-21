import encode, { init } from '@jsquash/webp/encode';
import scalarWasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';

let ready: ReturnType<typeof init> | undefined;
export async function encodeWebP(data: ImageData, quality: number, lossless: boolean) {
  ready ||= init({ locateFile: (path: string) => path.includes('_simd') ? simdWasm : scalarWasm });
  try {
    await ready;
    return new Blob([await encode(data, { quality: quality * 100, lossless: lossless ? 1 : 0 })], { type: 'image/webp' });
  } catch (error) {
    ready = undefined;
    throw error;
  }
}
