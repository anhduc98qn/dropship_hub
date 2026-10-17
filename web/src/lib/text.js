// Giống DSH.normalizeText / DSH.sha256 / DSH.productKey trong extension/shared.js (dùng để chống trùng)
export const normalizeText = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 500);

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function productKey(u) {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^(www|m)\./, '').toLowerCase() + url.pathname.replace(/\/+$/, '').toLowerCase();
  } catch (e) { return ''; }
}
