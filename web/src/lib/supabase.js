import { createClient } from '@supabase/supabase-js';

const cfg = window.DROPSHIP_CONFIG || {};
export const configured = !!cfg.supabaseUrl && !/YOUR-PROJECT/.test(cfg.supabaseUrl) && !!cfg.supabaseAnonKey;
export const supabase = configured ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

// Gọi Supabase, lỗi thì ném Error với câu báo dễ đọc
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || String(error));
  return data;
}
export const rpc = (name, args) => q(supabase.rpc(name, args));

// Link xem ảnh chụp (bucket riêng tư → link ký có hạn 1 giờ), có bộ nhớ đệm
const signed = new Map();
export async function screenshotUrl(path) {
  if (!path) return null;
  const hit = signed.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from('screenshots').createSignedUrl(path, 3600);
  if (error) return null;
  signed.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60e3 });
  return data.signedUrl;
}
