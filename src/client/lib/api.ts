import type { ApiError, ApiSuccess } from '@shared/types/domain';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        // FormData (upload) dibiarkan agar browser mengisi boundary multipart sendiri.
        ...(typeof init?.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch hanya gagal (reject) bila tidak ada koneksi / server tidak terjangkau.
    throw new ApiRequestError(
      'NETWORK_ERROR',
      navigator.onLine ? 'Tidak dapat terhubung ke server. Coba lagi sebentar.' : 'Kamu sedang offline. Periksa koneksi internet.',
      0
    );
  }

  if (res.status === 429) {
    throw new ApiRequestError('RATE_LIMITED', 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.', 429);
  }

  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;

  if (!res.ok || !json || !json.ok) {
    const errCode = json && !json.ok ? json.error.code : 'REQUEST_FAILED';
    const errMessage =
      json && !json.ok ? json.error.message : `Permintaan gagal (status ${res.status})`;
    throw new ApiRequestError(errCode, errMessage, res.status);
  }

  return json.data;
}
