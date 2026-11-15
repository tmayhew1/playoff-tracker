// ESPN asked straight from the browser, for the nights its API (and the
// NBA's) 403s the server's datacenter IP: the Live tab's slate and its box
// scores fall back to this. No custom headers, so the request stays a simple
// CORS one (ESPN's site API allows any origin).
export async function browserJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}
