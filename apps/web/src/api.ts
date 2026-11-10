import { handleMockApi } from './mockApi';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      ...options,
    });
    // If backend returns a successful JSON response
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return data as T;
    }
    // If 404 or backend not found, fall back to mock
    if (res.status === 404 || res.status === 502 || res.status === 503) {
      return (await handleMockApi(path, options)) as T;
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  } catch (err) {
    // If network fetch fails completely (e.g. running on Vercel without a proxy or offline)
    console.warn(`[API] Fallback to mock for ${path}:`, err);
    return (await handleMockApi(path, options)) as T;
  }
}

export function speakEnglish(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\*\*/g, '');
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'en-US';
  utter.rate = 0.92;
  window.speechSynthesis.speak(utter);
}
