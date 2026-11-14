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
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;

  if (!res.ok || !json || !json.ok) {
    const errCode = json && !json.ok ? json.error.code : 'REQUEST_FAILED';
    const errMessage =
      json && !json.ok ? json.error.message : `Permintaan gagal (status ${res.status})`;
    throw new ApiRequestError(errCode, errMessage, res.status);
  }

  return json.data;
}
