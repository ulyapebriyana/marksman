// Shared low-level fetch helper: every external call goes through here so
// every external call gets a timeout, for free, with no exceptions.

export class UpstreamError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status ?? null;
    if (cause) this.cause = cause;
  }
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string,string> }} [opts]
 */
export async function fetchJson(url, opts = {}) {
  const { timeoutMs = 8000, headers } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) {
      throw new UpstreamError(`HTTP ${res.status} for ${url}`, { status: res.status });
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new UpstreamError(`Timed out after ${timeoutMs}ms: ${url}`, { cause: err });
    }
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(`Fetch failed for ${url}: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {object} body JSON-serializable request body
 * @param {{ timeoutMs?: number, headers?: Record<string,string> }} [opts]
 */
export async function postJson(url, body, opts = {}) {
  const { timeoutMs = 8000, headers } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new UpstreamError(`HTTP ${res.status} for ${url}`, { status: res.status });
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new UpstreamError(`Timed out after ${timeoutMs}ms: ${url}`, { cause: err });
    }
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(`Fetch failed for ${url}: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}
