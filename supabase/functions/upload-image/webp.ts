// Accept only static WebP without EXIF/XMP or animation produced by our canvas upload flow.
// Container and frame layout: https://developers.google.com/speed/webp/docs/riff_container
export function validateWebP(bytes: Uint8Array, maxEdge: number) {
  const invalid = () => { throw new Error('invalid_webp'); };
  if (bytes.length < 30) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) invalid();
  let width = 0, height = 0, canvasWidth = 0, canvasHeight = 0, frames = 0;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const kind = text(offset), length = view.getUint32(offset + 4, true), data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.length || length === 0) invalid();
    if (kind === 'VP8X') {
      if (offset !== 12 || length !== 10 || (bytes[data] & ~0x30) !== 0) invalid();
      if (bytes[data + 1] || bytes[data + 2] || bytes[data + 3]) invalid();
      canvasWidth = 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16);
      canvasHeight = 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16);
    } else if (kind === 'VP8 ') {
      if (length < 10 || bytes[data] & 1 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) invalid();
      width = view.getUint16(data + 6, true) & 0x3fff;
      height = view.getUint16(data + 8, true) & 0x3fff;
      frames++;
    } else if (kind === 'VP8L') {
      if (length < 5 || bytes[data] !== 0x2f) invalid();
      const dimensions = view.getUint32(data + 1, true);
      if (dimensions >>> 29) invalid();
      width = (dimensions & 0x3fff) + 1;
      height = ((dimensions >>> 14) & 0x3fff) + 1;
      frames++;
    } else if (kind === 'ICCP') {
      if (!canvasWidth || frames) invalid();
    } else if (kind === 'ALPH') {
      if (!canvasWidth || frames || length < 2) invalid();
    } else invalid();
    offset = end;
  }
  if (frames !== 1 || !width || !height || width > maxEdge || height > maxEdge) invalid();
  if (canvasWidth && (canvasWidth !== width || canvasHeight !== height)) invalid();
  return { width, height };
}
