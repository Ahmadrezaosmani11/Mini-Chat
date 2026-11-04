// In-house structural JPEG check (SRS 10.7). No image is decoded in the main process.
import {
  PHOTO_MAX_BYTES,
  PHOTO_MIN_DIM,
  PHOTO_MAX_DIM,
} from '../../config/constants.js';

/**
 * @param {Uint8Array} jpeg
 * @returns {{width:number, height:number}}
 * @throws {Error} 'photo' when invalid
 */
export function validateJpeg(jpeg) {
  const fail = () => {
    throw new Error('photo');
  };
  if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg.length > PHOTO_MAX_BYTES) fail();
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) fail();
  if (jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) fail();

  let pos = 2;
  let size = null;
  while (pos < jpeg.length) {
    if (jpeg[pos] !== 0xff) fail();
    while (jpeg[pos] === 0xff) pos += 1; // fill bytes
    const marker = jpeg[pos];
    pos += 1;
    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone markers
    if (pos + 2 > jpeg.length) fail();
    const length = (jpeg[pos] << 8) | jpeg[pos + 1];
    if (length < 2 || pos + length > jpeg.length) fail();
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) fail();
      const height = (jpeg[pos + 3] << 8) | jpeg[pos + 4];
      const width = (jpeg[pos + 5] << 8) | jpeg[pos + 6];
      size = { width, height };
    }
    if (marker === 0xda) {
      // Start of scan: entropy-coded data follows until EOI, which was checked above.
      if (!size) fail();
      break;
    }
    pos += length;
  }
  if (!size) fail();
  const ok = (n) => n >= PHOTO_MIN_DIM && n <= PHOTO_MAX_DIM;
  if (!ok(size.width) || !ok(size.height)) fail();
  return size;
}
