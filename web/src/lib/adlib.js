// Link Ads Library — giống DSH.adLibraryUrl trong extension/shared.js:
// tìm chính xác cụm 12 từ đầu của content, chỉ quảng cáo đang chạy (active), quốc gia US.
export function adLibraryUrl(content) {
  const words = String(content || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return null;
  const phrase = words.slice(0, 12).join(' ').replace(/"/g, '');
  const p = new URLSearchParams({
    active_status: 'active', ad_type: 'all', country: 'US', media_type: 'all',
    q: `"${phrase}"`, search_type: 'keyword_exact_phrase',
  });
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

// Link dùng để mở: link đã lưu (luôn ép về đang chạy + US), hoặc tự tạo từ content
export function adLibraryFor(p) {
  if (p?.ad_library_url) {
    try {
      const u = new URL(p.ad_library_url);
      if (/facebook\.com$/.test(u.hostname) && u.pathname.startsWith('/ads/library')) {
        u.searchParams.set('active_status', 'active');
        u.searchParams.set('country', 'US');
      }
      return u.toString();
    } catch (e) { /* link nhập tay không hợp lệ: tạo lại từ content */ }
  }
  return adLibraryUrl(p?.ad_content);
}
