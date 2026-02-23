export function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8002';
}

export function wsBaseUrl() {
  return process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:8002/ws';
}

export async function fetchJson(pathname, init) {
  const url = `${apiBaseUrl()}${pathname}`;
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload?.details || payload?.error || message;
    } catch {
      // Keep default status error message.
    }
    throw new Error(message);
  }

  return response.json();
}
