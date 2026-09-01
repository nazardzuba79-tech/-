/**
 * Downscales a picked image file to a square data URL, entirely in the
 * browser, before it is ever uploaded.
 *
 * This is what makes a profile photo a small field instead of a large one:
 * a phone camera shot is several megabytes, while the same picture at
 * 256x256 JPEG is tens of kilobytes — small enough to live in a database
 * column (see User.avatarUrl) and to fit inside the avatar endpoint's own
 * body limit. The server still caps and sniffs whatever arrives, so this
 * is a convenience, never the security boundary.
 *
 * Crops to the centre square first so the result matches the round avatar
 * frame it renders in — scaling a portrait photo to a square without
 * cropping would squash the face.
 */

const OUTPUT_SIZE = 256;
const JPEG_QUALITY = 0.85;

export async function resizeImageToDataUrl(file: File): Promise<string> {
  const bitmap = await loadImage(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  // JPEG, not PNG: a photo as PNG is several times larger for no visible
  // gain, and transparency is meaningless inside a round frame anyway.
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}
