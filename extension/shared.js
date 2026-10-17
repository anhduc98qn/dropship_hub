// Dropship Hub — hàm dùng chung cho content script, background (importScripts) và test (Node).
// Giữ đồng bộ với web/src/lib/adlib.js và web/src/lib/text.js.
(function (root) {
  const DSH = root.DSH || (root.DSH = {});

  // "1,2K" → 1200 · "3.6K" → 3600 · "2,4 N" → 2400 · "1,2 Tr" → 1200000 · "12.345" → 12345 · "474" → 474
  DSH.parseCount = function (raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).replace(/\u00a0/g, ' ').trim();
    const m = s.match(/(\d[\d.,]*)\s*(k|m|b|n|nghìn|ngàn|tr|triệu|tỷ)?\b/i) || s.match(/(\d[\d.,]*)/);
    if (!m) return null;
    const num = m[1], unit = (m[2] || '').toLowerCase();
    const mult = { k: 1e3, n: 1e3, 'nghìn': 1e3, 'ngàn': 1e3, m: 1e6, tr: 1e6, 'triệu': 1e6, b: 1e9, 'tỷ': 1e9 }[unit] || 1;
    if (mult > 1) {
      const v = parseFloat(num.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
      return Number.isFinite(v) ? Math.round(v * mult) : null;
    }
    const v = parseInt(num.replace(/[.,]/g, ''), 10);
    return Number.isFinite(v) ? v : null;
  };

  // ID bài: quảng cáo video = ID video (/reel/ID, /videos/ID, watch?v=ID); quảng cáo ảnh = pfbid… / số
  DSH.postIdOf = function (u) {
    const s = String(u || '');
    const m = s.match(/[?&]story_fbid=([^&#]+)/) || s.match(/\/(?:videos|reel)\/(?:[^/?#]+\/)?(\d{6,})/) ||
      s.match(/\/watch\/?\?(?:[^#]*&)?v=(\d{6,})/) || s.match(/\/posts\/(pfbid\w+|\d{6,})/) ||
      s.match(/\/permalink\/(\d{6,})/) || s.match(/[?&]fbid=(\d{6,})/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const KEEP_PARAMS = ['story_fbid', 'id', 'v', 'fbid', 'set'];
  // Link bài: bỏ tham số theo dõi (__cft__, __tn__, ref…), giữ các tham số xác định bài
  DSH.cleanPostUrl = function (u) {
    try {
      const url = new URL(u, 'https://www.facebook.com');
      if (/(^|\.)facebook\.com$/.test(url.hostname)) url.hostname = 'www.facebook.com';
      const keep = new URLSearchParams();
      for (const k of KEEP_PARAMS) if (url.searchParams.has(k)) keep.set(k, url.searchParams.get(k));
      url.search = keep.toString();
      url.hash = '';
      return url.toString().replace(/\/(\?|$)/, '$1');
    } catch (e) { return String(u || '').trim(); }
  };

  // Khóa chống trùng bài: cùng một bài dù lưu bằng link /posts/, /reel/, story.php… vẫn ra cùng khóa
  DSH.postKey = function (u) {
    const id = DSH.postIdOf(u);
    if (id) return 'fb:' + id;
    try {
      const url = new URL(DSH.cleanPostUrl(u));
      return 'fb:' + url.pathname.replace(/\/+$/, '') + (url.search || '');
    } catch (e) { return 'fb:' + String(u || '').trim(); }
  };

  DSH.cleanPageUrl = function (u) {
    try {
      const url = new URL(u, 'https://www.facebook.com');
      url.hostname = 'www.facebook.com';
      const id = url.pathname.includes('profile.php') ? url.searchParams.get('id') : null;
      url.search = id ? '?id=' + id : '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch (e) { return String(u || '').trim(); }
  };

  const TRACKING = /^(utm_\w+|fbclid|gclid|ttclid|campaign_id|adset_id|ad_id|placement|site_source_name|h_ad_id|_ga|mc_\w+)$/i;
  // Link sản phẩm: giải mã l.facebook.com/l.php?u=…, bỏ tham số quảng cáo
  DSH.cleanProductUrl = function (u) {
    try {
      let url = new URL(u);
      if (/^l[m]?\.facebook\.com$/.test(url.hostname) && url.searchParams.get('u')) {
        const inner = url.searchParams.get('u');
        if (/^https?:\/\//i.test(inner)) url = new URL(inner);
      }
      for (const k of [...url.searchParams.keys()]) if (TRACKING.test(k)) url.searchParams.delete(k);
      url.hash = '';
      return url.toString();
    } catch (e) { return String(u || '').trim(); }
  };

  // Khóa chống trùng sản phẩm: tên miền (bỏ www., m.) + đường dẫn, chữ thường
  DSH.productKey = function (u) {
    try {
      const url = new URL(DSH.cleanProductUrl(u));
      return url.hostname.replace(/^(www|m)\./, '').toLowerCase() + url.pathname.replace(/\/+$/, '').toLowerCase();
    } catch (e) { return ''; }
  };

  DSH.isDomainOnly = function (u) {
    try { return new URL(u).pathname.replace(/\/+$/, '') === ''; } catch (e) { return false; }
  };

  DSH.normalizeText = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 500);

  DSH.sha256 = async function (text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // Link Ads Library tìm chính xác cụm 12 từ đầu của content — chỉ quảng cáo đang chạy, tại Mỹ
  DSH.adLibraryUrl = function (content) {
    const words = String(content || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return null;
    const phrase = words.slice(0, 12).join(' ').replace(/"/g, '');
    const p = new URLSearchParams({
      active_status: 'active', ad_type: 'all', country: 'US', media_type: 'all',
      q: `"${phrase}"`, search_type: 'keyword_exact_phrase',
    });
    return `https://www.facebook.com/ads/library/?${p.toString()}`;
  };

  // Tiêu chí đầu vào: (Share + Comment) × ratio ≥ Like. Thiếu số → null
  DSH.entryPass = function (likes, comments, shares, ratio = 3) {
    if ([likes, comments, shares].some((v) => v === null || v === undefined || Number.isNaN(v))) return null;
    return (comments + shares) * ratio >= likes;
  };

  // Facebook chèn chữ rác chống đọc: mỗi ký tự kèm U+034F ("ept…") và ký tự vô hình → bỏ
  const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
  DSH.cleanBlock = (s) => String(s || '').replace(/[\s\S]\u034f/g, '').replace(INVISIBLE, '').replace(/[ \t]+\n/g, '\n').trim();
  DSH.cleanLine = (s) => DSH.cleanBlock(s).replace(/\s+/g, ' ');
  // Dòng có nghĩa: ≥ 4 ký tự và có từ thật (bỏ mảnh "Sponsored" bị xé nhỏ)
  DSH.realLine = (s) => s.length >= 4 && /[\p{L}\p{N}]{3,}/u.test(s);

  // "S.NOTI.VN" (dòng tên miền trên thẻ quảng cáo) → "https://s.noti.vn"
  DSH.shopDomain = function (t) {
    const m = DSH.cleanLine(t).match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
    return m && !/facebook|fb\.me|instagram|messenger|whatsapp/i.test(m[1]) ? 'https://' + m[1].toLowerCase() : '';
  };

  // Trang /videos/ID không hiện số Share; mở cùng video dạng /reel/ID thì đủ Like, Comment, Share.
  // Link story.php giữ nguyên (mở lại đúng khối bài như trên bảng tin).
  DSH.readUrl = function (u) {
    const s = String(u || '');
    if (/\/story\.php/.test(s)) return s;
    const m = s.match(/\/videos\/(?:[^/?#]+\/)?(\d{6,})/) || s.match(/\/watch\/?\?(?:[^#]*&)?v=(\d{6,})/);
    return m ? `https://www.facebook.com/reel/${m[1]}` : s;
  };

  // Ngày làm việc (giờ VN, đổi ngày lúc dayStartHour) dạng YYYY-MM-DD
  DSH.workDate = function (date = new Date(), tz = 'Asia/Ho_Chi_Minh', dayStartHour = 7) {
    const shifted = new Date(date.getTime() - dayStartHour * 3600e3);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
  };

  DSH.isLocalServer = (url) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(String(url || ''));
})(typeof globalThis !== 'undefined' ? globalThis : self);
