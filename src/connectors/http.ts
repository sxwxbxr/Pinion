export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryAfterSec?: number,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
  }
  /** 429 und 5xx lohnen einen Retry, 4xx (Auth, Validierung, Policy) nicht. */
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export async function http(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const ra = res.headers.get("retry-after");
    throw new HttpError(res.status, await res.text(), ra && !Number.isNaN(Number(ra)) ? Number(ra) : undefined);
  }
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function httpJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  return (await http(url, init)).json() as Promise<T>;
}

/** Form-Body; undefined/null-Werte werden weggelassen. Content-Type setzt fetch automatisch. */
export function form(obj: Record<string, string | null | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null) p.set(k, v);
  return p;
}

export const basicAuth = (id: string, secret: string) =>
  "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
