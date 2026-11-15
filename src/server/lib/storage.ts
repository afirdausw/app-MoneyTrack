import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '@server/config/env';
import { generateRandomToken } from '@server/lib/security';

export const RECEIPT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ReceiptMime = keyof typeof RECEIPT_TYPES;

function uploadRoot(): string {
  return path.resolve(process.cwd(), env.UPLOAD_DIR);
}

/** Deteksi jenis gambar dari magic bytes — header `Content-Type` dari browser tidak dipercaya. */
export function sniffImageType(bytes: Uint8Array): ReceiptMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Simpan file struk ke `UPLOAD_DIR/<workspaceId>/<acak>.<ext>`; mengembalikan path relatif untuk DB. */
export async function saveReceiptFile(workspaceId: number, mime: ReceiptMime, bytes: Uint8Array): Promise<string> {
  const relative = path.posix.join(String(workspaceId), `${generateRandomToken(16)}.${RECEIPT_TYPES[mime]}`);
  const absolute = resolveStoragePath(relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes, { flag: 'wx' });
  return relative;
}

/** Path absolut yang dijamin berada di dalam UPLOAD_DIR (menolak path traversal). */
export function resolveStoragePath(relative: string): string {
  const root = uploadRoot();
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('Path penyimpanan di luar UPLOAD_DIR');
  }
  return absolute;
}

export async function readStoredFile(relative: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(relative));
}

/** Hapus file (abaikan bila sudah tidak ada). Dipanggil setelah DB commit. */
export async function deleteStoredFiles(relativePaths: string[]): Promise<void> {
  await Promise.all(
    relativePaths.map((relative) =>
      fs.rm(resolveStoragePath(relative), { force: true }).catch((err: unknown) => {
        console.error('[storage] gagal menghapus file:', relative, err);
      })
    )
  );
}
