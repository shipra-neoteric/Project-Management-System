const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const TOKEN_KEY = 'pms_token';
/** Render's free tier can take ~60 s to wake up, so allow plenty of time. */
const TIMEOUT_MS = 75_000;
/** After this long, tell the UI the server is probably waking up. */
const SLOW_MS = 5_000;

export const SLOW_EVENT = 'pms:slow-request';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) */
  }
}

let slowCount = 0;
function trackSlow(delta: 1 | -1) {
  slowCount = Math.max(0, slowCount + delta);
  window.dispatchEvent(new CustomEvent(SLOW_EVENT, { detail: slowCount > 0 }));
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api<T>(path: string, options: { method?: Method; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let slow = false;
  const slowTimer = setTimeout(() => {
    slow = true;
    trackSlow(1);
  }, SLOW_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      aborted ? 'The server took too long to respond. Please try again.' : 'Cannot reach the server. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowTimer);
    if (slow) trackSlow(-1);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error ?? {};
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      setToken(null);
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login?expired=1';
    }
    throw new ApiError(res.status, error.code ?? 'ERROR', error.message ?? `Request failed (${res.status})`, error.details);
  }
  return data as T;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
