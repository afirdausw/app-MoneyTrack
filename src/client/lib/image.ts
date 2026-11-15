const MAX_DIMENSION = 1600;
const QUALITY = 0.8;

/**
 * Perkecil & kompres foto struk di browser sebelum upload (hemat kuota shared hosting).
 * Hasil WebP bila didukung, fallback JPEG. File yang sudah kecil dan lebih hemat dikembalikan apa adanya.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));

  let blob = await toBlob('image/webp');
  // Browser lama yang tidak mendukung WebP mengembalikan PNG — pakai JPEG saja.
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) return file;
  return blob.size < file.size ? blob : file;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
