// Dropship Hub — chạy trên facebook.com
//  • Gắn nút "Lưu mẫu" vào mỗi bài trên bảng tin → đọc nội dung, số Like/Comment/Share, chụp ảnh, mở hộp lưu.
//  • Nhận lệnh "scrapePost" từ background khi đọc số mỗi ngày → đọc số + chụp ảnh của bài đang mở.
// Cấu trúc Facebook (10/2026) ghi trong CLAUDE.md.
(() => {
  if (window.__dshLoaded) return;
  window.__dshLoaded = true;
  const D = globalThis.DSH;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Lệnh chụp màn hình của Chrome đôi khi không trả lời (vd tab đang bị gỡ lỗi) → không được treo mãi
  const TIMEOUT = { capStart: 10000, capProbe: 10000, capSeg: 10000, capEnd: 10000 };
  const send = (type, payload = {}) =>
    new Promise((resolve, reject) => {
      const ms = TIMEOUT[type];
      const timer = ms && setTimeout(() => reject(new Error(`Chrome không phản hồi lệnh chụp màn hình (quá ${ms / 1000} giây)`)), ms);
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error('Extension không phản hồi'));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    });

  // ================================================================ nhận diện bài
  const POST_SEL = 'div[aria-posinset], div[data-pagelet^="FeedUnit"], div[role="article"]';
  const isCommentArticle = (el) => /comment|bình luận|reply|phản hồi/i.test(el.getAttribute('aria-label') || '');

  // Bảng tin 10/2026 có lúc bỏ hết aria-posinset / FeedUnit / role="article" (chỉ còn khung giữ chỗ):
  // khi đó bài = tổ tiên cao nhất của nút Like mà chưa chứa nút Like của bài khác.
  const LIKE_SEL = '[data-ad-rendering-role="like_button"], [role="button"][aria-label]';
  const STOP_SEL = 'body, [role="main"], [role="feed"], [role="dialog"], [role="complementary"], [role="banner"]';
  // Nút Like thật = [role="button"] aria-label="Like" bọc vùng like_button → gộp về 1 mốc mỗi nút
  const likeAnchors = (scope) => [...new Set([...scope.querySelectorAll(LIKE_SEL)].filter((e) =>
    (e.matches('[data-ad-rendering-role]') || /^(like|thích)$/i.test((e.getAttribute('aria-label') || '').trim())) &&
    !(e.closest('div[role="article"]') && isCommentArticle(e.closest('div[role="article"]'))))
    .map((e) => e.closest('[role="button"]') || e))];
  function postsByLike(scope) {
    const anchors = likeAnchors(scope);
    const roots = new Set();
    anchors.forEach((a) => {
      let cur = a;
      while (cur.parentElement && !cur.parentElement.matches(STOP_SEL) && cur.parentElement !== scope &&
        !anchors.some((o) => o !== a && cur.parentElement.contains(o))) cur = cur.parentElement;
      if (cur !== a && !cur.matches(STOP_SEL)) roots.add(cur);
    });
    return [...roots];
  }

  const usable = (el) => el.getBoundingClientRect().height >= 150 && !!el.querySelector('a[href]'); // bỏ khung rỗng giữ chỗ
  function findPosts(scope = document) {
    const out = [];
    scope.querySelectorAll(POST_SEL).forEach((el) => {
      if (el.matches('div[role="article"]') && isCommentArticle(el)) return;
      const parent = el.parentElement?.closest(POST_SEL);
      if (parent && !(parent.matches('div[role="article"]') && isCommentArticle(parent))) return; // bài lồng trong bài
      if (usable(el)) out.push(el);
    });
    postsByLike(scope).forEach((el) => {
      if (!usable(el) || out.some((p) => p === el || p.contains(el))) return;
      for (let i = out.length - 1; i >= 0; i--) if (el.contains(out[i])) out.splice(i, 1);
      out.push(el);
    });
    return out;
  }

  // ================================================================ đọc thông tin bài
  const POST_PATTERNS = [/\/posts\//, /\/permalink\//, /story_fbid=/, /permalink\.php/, /\/videos\//, /\/watch\/?\?v=/, /\/reel\//, /\/photo\/?\?fbid=/, /\/photos\//];
  const CTA = /^(shop now|mua ngay|learn more|tìm hiểu thêm|order now|đặt hàng ngay|đặt hàng|sign up|đăng ký|send message|gửi tin nhắn|get offer|nhận ưu đãi|buy now|book now|đặt ngay|download|tải xuống|contact us|liên hệ|apply now|subscribe|watch more|get quote|install now|use app|listen now|see more|see details|xem chi tiết|xem thêm|sponsored|được tài trợ)$/i;
  const DOMAIN_LINE = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
  const role = (scope, r) => scope.querySelector(`[data-ad-rendering-role="${r}"]`);
  const links = (post) => [...post.querySelectorAll('a[href]')].filter((a) => !a.closest('.dsh-save'));
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  async function expand(post) {
    let clicked = false;
    post.querySelectorAll('div[role="button"], span[role="button"]').forEach((b) => {
      if (/^(see more|xem thêm|… xem thêm|\.\.\. see more)$/i.test((b.innerText || '').trim()) && !b.closest('div[role="article"][aria-label]')) {
        b.click();
        clicked = true;
      }
    });
    if (clicked) await sleep(300);
  }

  // Facebook chỉ gắn link thật (thời gian đăng, link sản phẩm) khi đang rê chuột và gỡ ra khi rời chuột.
  // → giả lập rê chuột, đọc link xong mới gọi release().
  async function revealLinks(post) {
    const top = post.getBoundingClientRect().top;
    const targets = [...post.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().top - top < 160);
    const fire = (a, evs) => evs.forEach((ev) => a.dispatchEvent(new MouseEvent(ev, { bubbles: true, view: window })));
    targets.forEach((a) => fire(a, ['pointerover', 'mouseover', 'mouseenter', 'focusin']));
    await sleep(targets.length ? 450 : 0);
    return async () => {
      targets.forEach((a) => fire(a, ['pointerout', 'mouseout', 'mouseleave', 'focusout']));
      if (document.querySelector('[role="menu"]')) dismissPopups({ escape: true }); // chỉ đóng menu đang mở
    };
  }

  function findPostUrl(post) {
    const fb = links(post).filter((a) => /facebook\.com/.test(a.href) && !/comment_id=/.test(a.href));
    for (const pat of POST_PATTERNS) {
      const a = fb.find((x) => pat.test(x.href));
      if (a) return D.cleanPostUrl(a.href);
    }
    if (POST_PATTERNS.some((p) => p.test(location.href))) return D.cleanPostUrl(location.href);
    return '';
  }

  function findPage(post) {
    const marked = role(post, 'profile_name');
    const cands = [
      ...(marked ? marked.querySelectorAll('a[href]') : []),
      ...post.querySelectorAll('h2 a, h3 a, h4 a, strong a, a strong, a span[dir="auto"]'),
    ];
    for (const el of cands) {
      const a = el.closest('a') || el;
      const name = D.cleanLine((a.innerText || '').split('\n')[0]);
      if (!D.realLine(name) || name.length > 100 || !/facebook\.com/.test(a.href || '')) continue;
      if (POST_PATTERNS.some((p) => p.test(a.href)) || /\/groups\/|\/hashtag\/|\/ads\//.test(a.href)) continue;
      return { name, url: D.cleanPageUrl(a.href) };
    }
    return { name: marked ? D.cleanLine(marked.innerText.split('\n')[0]) : '', url: '' };
  }

  // Link ra web bán hàng (đã giải mã l.facebook.com nếu có), khối lớn nhất trước
  function findExternal(post) {
    return links(post)
      .map((a) => ({ a, url: D.cleanProductUrl(a.href) }))
      .filter((x) => {
        try {
          return !/(^|\.)(facebook|fb|instagram|fbcdn|messenger|whatsapp)\.(com|net|me)$|^wa\.me$/.test(new URL(x.url).hostname);
        } catch (e) { return false; }
      })
      .sort((x, y) => area(y.a) - area(x.a));
  }

  function findContent(post) {
    const el = role(post, 'story_message') || post.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    if (el) return D.cleanBlock(el.innerText);
    let best = '';
    post.querySelectorAll('div[dir="auto"]').forEach((d) => {
      if (d.closest('a')) return;
      const art = d.closest('div[role="article"]');
      if (art && art !== post && isCommentArticle(art)) return;
      const t = D.cleanBlock(d.innerText);
      if (t.length > best.length && t.length < 6000) best = t;
    });
    return best;
  }

  function findHeadline(post, ext, pageName) {
    const title = role(post, 'title'), desc = role(post, 'description');
    if (title) return { headline: D.cleanLine(title.innerText), description: desc ? D.cleanLine(desc.innerText) : '' };
    for (const { a } of ext) {
      const lines = (a.innerText || '').split('\n').map(D.cleanLine)
        .filter((s) => D.realLine(s) && !DOMAIN_LINE.test(s) && !CTA.test(s) && s !== pageName && s.length < 300);
      if (lines.length) return { headline: lines[0] || '', description: lines[1] || '' };
    }
    return { headline: '', description: '' };
  }

  function textWithoutComments(post) {
    let t = post.innerText || '';
    post.querySelectorAll('div[role="article"]').forEach((c) => {
      if (c !== post && isCommentArticle(c) && c.innerText) t = t.replace(c.innerText, '\n');
    });
    return t;
  }

  // ---- Số Like / Comment / Share
  // Giao diện 2026: số nằm trong chính nút (👍 3.6K · 💬 474 · ↗ 449). Quảng cáo có
  // data-ad-rendering-role="like_button|comment_button|share_button"; trang reel/story.php chỉ có aria-label.
  const BTN_ROLE = { likes: 'like_button', comments: 'comment_button', shares: 'share_button' };
  const BTN_LABEL = {
    likes: /^(like|thích)$/i,
    comments: /^(comment|leave a comment|bình luận|viết bình luận)$/i,
    shares: /^(share|chia sẻ)$/i,
  };
  const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight; };
  const insideComment = (e) => { const a = e.closest('div[role="article"]'); return !!a && isCommentArticle(a); };
  function actionButton(scope, k, onlyInView = false) {
    const byRole = role(scope, BTN_ROLE[k])?.closest('[role="button"]');
    if (byRole) return { b: byRole, role: true };
    const b = [...scope.querySelectorAll('[role="button"][aria-label]')].find((x) =>
      BTN_LABEL[k].test((x.getAttribute('aria-label') || '').trim()) && !insideComment(x) &&
      (onlyInView ? inView(x) : x.getBoundingClientRect().width > 0));
    return b ? { b, role: false } : null;
  }
  function buttonCounts(scope, onlyInView = false) {
    const out = {};
    for (const k of Object.keys(BTN_ROLE)) {
      const f = actionButton(scope, k, onlyInView);
      const t = D.cleanLine(f?.b.innerText || '');
      // nút quảng cáo không kèm số = 0; nút chỉ ghi chữ (giao diện cũ) = chưa biết
      out[k] = /^\d/.test(t) ? D.parseCount(t) : f && f.role && t === '' ? 0 : null;
    }
    return out;
  }
  const NUM = '(\\d[\\d.,]*\\s?(?:K|M|B|N|Tr|triệu|nghìn|ngàn)?)';
  const lastMatch = (text, re) => { let m, last = null; while ((m = re.exec(text))) last = m; return last; };
  function parseCounts(post, onlyInView = false) {
    const btn = buttonCounts(post, onlyInView);
    if (btn.likes !== null && btn.comments !== null && btn.shares !== null) return btn;
    // Dự phòng: đọc theo chữ ("474 comments", "All reactions: 3.6K")
    const text = textWithoutComments(post);
    let likes = null, comments = null, shares = null;
    const cm = lastMatch(text, new RegExp(NUM + '\\s*(?:comments?|bình luận)', 'gi'));
    if (cm) comments = D.parseCount(cm[1]);
    const sh = lastMatch(text, new RegExp(NUM + '\\s*(?:shares?|lượt chia sẻ|chia sẻ)', 'gi'));
    if (sh) shares = D.parseCount(sh[1]);
    for (const el of post.querySelectorAll('[aria-label]')) {
      if (insideComment(el)) continue;
      const m = (el.getAttribute('aria-label') || '').match(new RegExp('(?:All reactions|Tất cả cảm xúc|Like|Thích)\\s*:\\s*' + NUM, 'i'));
      if (m) { likes = D.parseCount(m[1]); break; }
    }
    if (likes === null) {
      const o = text.match(new RegExp('(?:and|và)\\s+' + NUM + '\\s+(?:others|người khác)', 'i'));
      if (o) likes = D.parseCount(o[1]) + 1;
    }
    likes = btn.likes ?? likes; comments = btn.comments ?? comments; shares = btn.shares ?? shares;
    // Facebook ẩn chỉ số bằng 0: đã thấy thanh tương tác thì chỉ số còn thiếu = 0
    const footer = likes !== null || comments !== null || shares !== null || /(^|\n)\s*(Like|Thích)\s*(\n|$)/.test(text);
    if (footer) { likes ??= 0; comments ??= 0; shares ??= 0; }
    return { likes, comments, shares };
  }

  async function extract(post) {
    await expand(post);
    const release = await revealLinks(post);
    const page = findPage(post);
    const ext = findExternal(post);
    const post_url = findPostUrl(post);
    await release();
    const { headline, description } = findHeadline(post, ext, page.name);
    // Link ra ngoài bị mã hóa và chỉ hiện khi rê chuột. KHÔNG bấm để giải mã (= click quảng cáo thật):
    // không có link thật thì lấy tên miền shop trên thẻ quảng cáo (vùng "meta").
    let product_url = ext[0]?.url || '';
    const meta = role(post, 'meta');
    if ((!product_url || D.isDomainOnly(product_url)) && meta) product_url = product_url || D.shopDomain(meta.innerText);
    return {
      page_name: page.name, page_url: page.url, post_url, product_url,
      ad_content: findContent(post), headline, description,
      ...parseCounts(post),
    };
  }

  // ================================================================ popup / lớp nổi
  // Trong khung bài (hộp thoại) KHÔNG được nhấn Esc: Esc đóng khung, Facebook lùi trang 1 bước.
  const postDialogOpen = () => !!document.querySelector('div[role="dialog"] div[role="article"], div[role="dialog"] [data-ad-rendering-role]');
  function dismissPopups({ escape = !postDialogOpen() } = {}) {
    if (escape) {
      const esc = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true };
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', esc));
      document.dispatchEvent(new KeyboardEvent('keydown', esc));
    }
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 2, clientY: window.innerHeight - 2 }));
  }

  // Lớp nổi đè lên vùng chụp (khung giới thiệu page, tooltip, chat, thanh thông báo…) → tạm ẩn khi chụp
  function overlaysOn(target, scroller) {
    const r = target.getBoundingClientRect();
    const found = new Set();
    const xs = [0.1, 0.5, 0.9].map((f) => r.left + r.width * f);
    const ys = [0.15, 0.5, 0.85].map((f) => Math.min(window.innerHeight - 2, Math.max(2, r.top + r.height * f)));
    for (const x of xs) for (const y of ys) {
      const top = document.elementFromPoint(x, y);
      if (!top || target.contains(top) || top.contains(target)) continue;
      let el = top;
      while (el.parentElement && !el.parentElement.contains(target)) el = el.parentElement;
      if (el !== document.body && el !== document.documentElement && !(scroller && el.contains(scroller))) found.add(el);
    }
    return [...found];
  }

  // ================================================================ chụp ảnh
  // Chiều cao vùng chụp thật (có thể nhỏ hơn innerHeight khi phóng to/thu nhỏ trang).
  // Đo bằng 1 lần chụp thử rồi ghi nhớ theo kích thước cửa sổ.
  let probeCache = null;
  async function visibleHeight() {
    const key = `${window.innerWidth}x${window.innerHeight}x${window.devicePixelRatio}`;
    if (probeCache?.key === key) return probeCache.h;
    const probe = await send('capProbe', { viewportWidth: window.innerWidth });
    const h = Math.min(window.innerHeight, probe || window.innerHeight);
    probeCache = { key, h };
    return h;
  }

  function hideOwnUi() {
    const hidden = [...document.querySelectorAll('.dsh-save, #dsh-modal-host, [role="tooltip"]')];
    hidden.forEach((el) => (el.style.visibility = 'hidden'));
    return hidden;
  }

  // Chụp phần tử `target`, ghép nhiều khung nếu dài. scroller: vùng cuộn riêng (khung bài dạng hộp thoại);
  // không có thì cuộn cả trang. startAt / endAt: chỉ chụp đoạn này (px tính từ đầu target).
  async function capture(target, { scroller = null, startAt = 0, endAt = null, maxH = 3600 } = {}) {
    const hide = hideOwnUi();
    const hideOverlays = () => overlaysOn(target, scroller).forEach((el) => {
      if (!hide.includes(el)) { hide.push(el); el.style.visibility = 'hidden'; }
    });
    dismissPopups();
    await sleep(150);
    try {
      const HEADER = 64;
      const r0 = target.getBoundingClientRect();
      const end = Math.min(endAt ?? r0.height, r0.height, startAt + maxH);
      const height = Math.max(1, end - startAt);
      const docTop = r0.top + window.scrollY;
      const id = Math.random().toString(36).slice(2);
      const viewH = await visibleHeight();
      await send('capStart', { id, width: r0.width, height });
      const bounds = () => {
        if (!scroller) return { top: HEADER, bottom: viewH };
        const s = scroller.getBoundingClientRect();
        return { top: Math.max(s.top, 0), bottom: Math.min(s.bottom, viewH) };
      };
      let covered = startAt;
      for (let guard = 0; covered < end - 2 && guard < 12; guard++) {
        if (scroller) scroller.scrollTop += target.getBoundingClientRect().top + covered - bounds().top;
        else window.scrollTo({ top: docTop - HEADER + covered, behavior: 'instant' });
        await sleep(250); // chờ trang vẽ lại (background tự giãn các lần chụp ≥ 0,5 giây theo giới hạn của Chrome)
        hideOverlays();
        const r = target.getBoundingClientRect(), b = bounds();
        const visTop = Math.max(r.top, b.top);
        const visBottom = Math.min(r.bottom, b.bottom, r.top + end);
        const from = Math.max(visTop - r.top, covered);
        const to = visBottom - r.top;
        if (to <= from) break;
        await send('capSeg', { id, left: r.left, top: r.top + from, width: r.width, from: from - startAt, to: to - startAt, viewportWidth: window.innerWidth });
        covered = to;
      }
      return await send('capEnd', { id });
    } finally {
      hide.forEach((el) => (el.style.visibility = ''));
    }
  }

  // Chụp nguyên màn hình (dự phòng cho trang reel)
  async function captureViewport() {
    const hide = hideOwnUi();
    dismissPopups();
    await sleep(200);
    try {
      const id = Math.random().toString(36).slice(2);
      const viewH = await visibleHeight();
      await send('capStart', { id, width: window.innerWidth, height: viewH, maxWidth: 1400 });
      await send('capSeg', { id, left: 0, top: 0, width: window.innerWidth, from: 0, to: viewH, viewportWidth: window.innerWidth });
      return await send('capEnd', { id });
    } finally {
      hide.forEach((el) => (el.style.visibility = ''));
    }
  }

  function captureError(e) {
    const m = String(e?.message || e);
    if (/activeTab|permission|<all_urls>/i.test(m)) {
      return 'Chrome chưa cho extension chụp màn hình. Vào chrome://extensions → Dropship Hub → Chi tiết → "Quyền truy cập trang web" → chọn "Trên tất cả trang web", rồi tải lại trang Facebook.';
    }
    return 'Không chụp được ảnh: ' + m;
  }

  // ---- Khung bài (hộp thoại ~700px, có vùng cuộn riêng)
  const isPostDialog = (d) => { const r = d.getBoundingClientRect(); return r.width > 400 && r.width < window.innerWidth - 40 && r.height > 200; };
  // Facebook có thể tạo kèm một khung rỗng cùng cỡ: chọn khung đã có nút Like/Comment.
  // strict: chỉ nhận khung có nút (đọc số mỗi ngày — tránh ghi 0/0/0 từ khung rỗng)
  async function waitPostDialog(ms = 6000, strict = false) {
    let loose = null;
    for (let t = 0; t < ms; t += 300) {
      const ds = [...document.querySelectorAll('div[role="dialog"]')].filter(isPostDialog)
        .filter((x) => x.querySelector('div[role="article"], [data-ad-rendering-role]'));
      const d = ds.find((x) => actionButton(x, 'likes') || actionButton(x, 'comments'));
      if (d) { await sleep(400); return d; }
      loose = loose || ds[0] || null;
      await sleep(300);
    }
    return strict ? null : loose;
  }
  function scrollerOf(el) {
    return [...el.querySelectorAll('div')].filter((d) => {
      const s = getComputedStyle(d);
      return /(auto|scroll)/.test(s.overflowY) && d.scrollHeight > d.clientHeight + 20;
    }).sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
  }
  // Khối nội dung trong vùng cuộn (rộng gần bằng vùng cuộn, cao nhất)
  function contentOf(scroller) {
    const w = scroller.getBoundingClientRect().width;
    let best = null, bestH = 0;
    for (const d of scroller.querySelectorAll(':scope > div, :scope > div > div, :scope > div > div > div')) {
      const r = d.getBoundingClientRect();
      if (r.width >= w * 0.9 && r.height > bestH + 1) { best = d; bestH = r.height; }
    }
    return bestH > 200 ? best : null;
  }
  // Ảnh chỉ cần từ khối link sản phẩm (tên miền · headline · nút Shop now) trở xuống.
  // Không có khối link: bắt đầu từ hàng nút Like/Comment/Share; không có nữa thì từ đầu bài.
  function linkBlockStart(target) {
    const t0 = target.getBoundingClientRect().top;
    const els = ['meta', 'title', 'description'].map((r) => role(target, r))
      .concat(target.querySelector('[data-ad-rendering-role^="cta"]')).filter(Boolean);
    const titleCard = role(target, 'title')?.closest('a');
    if (titleCard) els.push(titleCard);
    const tops = els.map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top);
    if (tops.length) return Math.max(0, Math.min(...tops) - t0 - 10);
    const like = actionButton(target, 'likes')?.b.getBoundingClientRect();
    if (!like || !like.height) return 0;
    // Bài mở qua story.php có thể thiếu vùng đánh dấu: khối link = link ra ngoài nằm sát trên hàng nút Like
    const linkCard = [...target.querySelectorAll('a[href]')].filter((a) => {
      let h = '';
      try { h = new URL(a.href).hostname; } catch (e) { /* bỏ qua */ }
      const r = a.getBoundingClientRect();
      return r.height > 20 && r.bottom <= like.top + 4 && (/^l\.facebook\.com$/.test(h) || (h && !/facebook\.com$|fbcdn\.net$/.test(h)));
    }).sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    const top = linkCard ? linkCard.getBoundingClientRect().top : like.top;
    return Math.max(0, top - t0 - 10);
  }
  const topComments = (scope) => [...scope.querySelectorAll('div[role="article"]')]
    .filter((a) => /^(comment by|bình luận của)/i.test(a.getAttribute('aria-label') || ''));
  // Đáy của bình luận gốc thứ n (ảnh chỉ lấy vài bình luận mới nhất)
  function commentsEnd(target, n = 4) {
    const top = topComments(target);
    if (!top.length) return null;
    return top[Math.min(n, top.length) - 1].getBoundingClientRect().bottom - target.getBoundingClientRect().top + 12;
  }
  function closeDialog(dlg) {
    if (!dlg.isConnected) return;
    const x = [...dlg.querySelectorAll('[role="button"][aria-label]')].find((b) => /^(close|đóng)$/i.test(b.getAttribute('aria-label')));
    if (x) x.click(); else dismissPopups({ escape: true });
  }

  // Chuyển bộ lọc bình luận sang "Newest / Mới nhất", chờ danh sách thật sự đổi thứ tự
  async function sortNewest(scope) {
    const btn = [...scope.querySelectorAll('div[role="button"], span[role="button"]')]
      .find((b) => /^(most relevant|phù hợp nhất|all comments|tất cả bình luận|top comments)$/i.test((b.innerText || '').trim()));
    if (!btn) return false;
    const firstKey = () => topComments(scope).map((a) => a.getAttribute('aria-label')).at(0) || '';
    const before = firstKey();
    btn.click();
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      const item = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
        .find((m) => /^(newest|mới nhất)/i.test((m.innerText || '').trim()));
      if (item) {
        item.click();
        for (let t = 0; t < 1500 && firstKey() === before; t += 150) await sleep(150);
        return true;
      }
    }
    if (document.querySelector('[role="menu"]')) dismissPopups({ escape: true });
    return false;
  }

  // Chờ bình luận tải xong: số bình luận > 0 và đứng yên qua 2 lần kiểm tra.
  // KHÔNG dựa vào [data-visualcompletion="loading-state"]: luôn có sẵn trong khung bài (trình phát video…).
  async function waitComments(scope, ms = 6000) {
    let prev = -1;
    for (let t = 0; t < ms; t += 350) {
      const n = [...scope.querySelectorAll('div[role="article"]')].filter((a) => (a.innerText || '').trim().length > 0).length;
      if (n > 0 && n === prev) return true;
      if (n === 0 && t >= 2500) return false; // bài chưa có bình luận
      prev = n;
      await sleep(350);
    }
    return prev > 0;
  }

  // Bài trên bảng tin: bấm nút Comment để mở khung bài → Newest → chụp từ khối link tới 4 bình luận → đóng khung đúng 1 lần.
  // Trả về { image, error, url } — url là link trên thanh địa chỉ khi khung bài mở (dự phòng khi không đọc được link bài).
  async function captureWithComments(post, { open = true } = {}) {
    const shoot = async (fn) => { try { return { image: await fn() }; } catch (e) { return { image: null, error: captureError(e) }; } };
    let dlg = post.closest('div[role="dialog"]');
    const opened = !dlg;
    if (!dlg && open) {
      const cb = actionButton(post, 'comments');
      if (cb) { cb.b.click(); dlg = await waitPostDialog(); }
    }
    if (dlg) {
      const url = location.href;
      try {
        await waitComments(dlg);
        if (await sortNewest(dlg).catch(() => false)) await waitComments(dlg);
        const scroller = scrollerOf(dlg);
        const target = (scroller && contentOf(scroller)) || scroller?.firstElementChild || dlg;
        return { ...(await shoot(() => capture(target, { scroller, startAt: linkBlockStart(target), endAt: commentsEnd(target) }))), url };
      } finally {
        if (opened) { closeDialog(dlg); await sleep(400); }
      }
    }
    if (await sortNewest(post).catch(() => false)) await waitComments(post);
    return { ...(await shoot(() => capture(post, { startAt: linkBlockStart(post), endAt: commentsEnd(post) }))), url: null };
  }

  // Trang reel (link cũ /reel/…, /videos/…): mở khung bình luận, Newest, chụp cột số ghép cạnh khung bình luận
  const reelPanel = () => [...document.querySelectorAll('div[role="complementary"]')].find((d) => d.getBoundingClientRect().width > 200);
  async function captureReel() {
    let panel = reelPanel();
    if (!panel) {
      actionButton(document, 'comments', true)?.b.click();
      for (let i = 0; i < 12 && !panel; i++) { await sleep(300); panel = reelPanel(); }
    }
    if (!panel) return captureViewport();
    await waitComments(panel);
    if (await sortNewest(panel).catch(() => false)) await waitComments(panel);
    return captureReelCounts(panel);
  }
  async function captureReelCounts(panel) {
    const btns = ['likes', 'comments', 'shares'].map((k) => actionButton(document, k, true)?.b).filter(Boolean);
    if (!btns.length) return captureViewport();
    const hide = hideOwnUi();
    dismissPopups();
    await sleep(200);
    try {
      const viewH = await visibleHeight();
      const rs = btns.map((b) => b.getBoundingClientRect());
      const pr = panel.getBoundingClientRect();
      const top = Math.max(pr.top, 56), bottom = Math.min(pr.bottom, viewH);
      const colL = Math.max(0, Math.min(...rs.map((r) => r.left)) - 16);
      const colW = Math.max(...rs.map((r) => r.right)) + 16 - colL;
      const h = bottom - top;
      const id = Math.random().toString(36).slice(2);
      await send('capStart', { id, width: colW + pr.width, height: h, maxWidth: 900 });
      // 1 lần chụp, vẽ 2 vùng: cột số bên trái, khung bình luận bên phải
      await send('capSeg', {
        id, viewportWidth: window.innerWidth, regions: [
          { left: colL, top, width: colW, from: 0, to: h, destX: 0 },
          { left: pr.left, top, width: pr.width, from: 0, to: h, destX: colW },
        ],
      });
      return await send('capEnd', { id });
    } finally {
      hide.forEach((el) => (el.style.visibility = ''));
    }
  }

  // ================================================================ link story.php
  // https://www.facebook.com/story.php?story_fbid=<ID bài>&id=<ID page dạng số> mở lại đúng khối bài như trên
  // bảng tin (khối link sản phẩm + hàng số + bình luận) — dùng để đọc số và chụp ảnh mỗi ngày.
  // Page có 2 loại ID: ID chủ bài viết (cần cho story.php) và ID hồ sơ page (giao diện mới). Page tạo mới chỉ có 1 ID.
  // → thử ứng viên theo từng đợt (rẻ trước, đắt sau), giữ link mở ra đúng bài (<title> khác "Facebook").

  // Tải trang nhưng chỉ đọc tới khi gặp `stop` rồi ngắt — nhanh hơn tải cả ~1MB
  async function fetchUntil(url, stop, maxBytes = 400000) {
    const res = await fetch(url, { credentials: 'include' });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    try {
      while (text.length < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (stop && text.includes(stop)) break;
      }
    } finally { reader.cancel().catch(() => {}); }
    return text;
  }
  async function storyOpens(url) {
    try {
      const html = await fetchUntil(url, '</title>');
      const title = ((html.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || '').trim();
      return !!title && !/^(\(\d+\)\s*)?facebook$/i.test(title);
    } catch (e) { return false; }
  }
  const idsIn = async (url, res) => {
    try {
      const html = await (await fetch(url, { credentials: 'include' })).text();
      return res.flatMap((re) => [...html.matchAll(re)].map((m) => m[1]));
    } catch (e) { return []; }
  };
  async function storyUrl(urls, pageUrl, post) {
    const postId = urls.map(D.postIdOf).find(Boolean);
    if (!postId) return null;
    // "actorID"/"userID" trong HTML có thể là chính tài khoản đang xem (cookie c_user) → luôn loại ra
    const viewer = (document.cookie.match(/(?:^|;\s*)c_user=(\d+)/) || [])[1];
    const tried = new Set();
    const tryIds = async (ids) => {
      const fresh = [...new Set(ids)].filter((id) => id && id !== viewer && !tried.has(id)).slice(0, 4);
      fresh.forEach((id) => tried.add(id));
      const cands = fresh.map((id) => `https://www.facebook.com/story.php?story_fbid=${encodeURIComponent(postId)}&id=${id}`);
      const ok = await Promise.all(cands.map(storyOpens)); // thử song song
      return cands[ok.indexOf(true)] || null;
    };
    const s = String(pageUrl || '');
    const idInPostLink = /facebook\.com\/(\d{6,})\/(?:posts|videos|photos|permalink)\//;
    const stages = [
      // 1. ID số trong link bài / link khác trong bài + profile.php?id=
      async () => [
        ...urls.map((u) => (String(u || '').match(idInPostLink) || [])[1]),
        ...[...(post?.querySelectorAll('a[href]') || [])].map((a) => (a.href.match(idInPostLink) || [])[1]),
        (s.match(/[?&]id=(\d{6,})/) || s.match(/facebook\.com\/(\d{6,})(?:[/?#]|$)/) || [])[1],
      ],
      // 2. Trang bài viết (link dùng tên rút gọn): "actorID" = ID chủ bài
      async () => (await Promise.all(urls.filter((u) => /facebook\.com\/.+\/(posts|videos|permalink)\//.test(String(u || '')))
        .map((u) => idsIn(u, [/"actorID":"(\d{6,})"/g])))).flat(),
      // 3. Trang page: pageID / delegate_page_id / userID
      async () => /^https:\/\/www\.facebook\.com\/[^/?#]+$/.test(s)
        ? idsIn(s, [/"pageID":"(\d{6,})"/g, /"delegate_page_id":"(\d{6,})"/g, /"userID":"(\d{6,})"/g]) : [],
    ];
    for (const stage of stages) {
      const hit = await tryIds(await stage());
      if (hit) return hit;
    }
    return null; // không có link story.php mở đúng bài → giữ link bài gốc
  }

  // ================================================================ chẩn đoán (chỉ với máy chủ test trên máy)
  function timer() {
    const t0 = performance.now(), marks = {};
    let last = t0;
    return {
      mark(k) { const now = performance.now(); marks[k] = Math.round(now - last); last = now; },
      done() { return { ...marks, tong: Math.round(performance.now() - t0) }; },
    };
  }
  // Bản rút gọn cấu trúc bài: giữ thẻ, role, aria-*, data-*, href, chữ; bỏ svg/ảnh/class/style
  function domSnapshot(root, maxLen = 300000) {
    let out = '';
    const walk = (el, depth) => {
      if (out.length > maxLen || depth > 60) return;
      if (/^(svg|img|video|style|script|path|image)$/i.test(el.tagName)) return;
      const attrs = [...el.attributes].filter((a) => /^(role|aria-|data-|href|dir)/.test(a.name))
        .map((a) => ` ${a.name}="${a.value.slice(0, 200).replace(/"/g, '&quot;')}"`).join('');
      out += `<${el.tagName.toLowerCase()}${attrs}>`;
      for (const n of el.childNodes) {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out += t.slice(0, 500).replace(/</g, '&lt;'); }
        else if (n.nodeType === 1) walk(n, depth + 1);
      }
      out += `</${el.tagName.toLowerCase()}>`;
    };
    if (root) walk(root, 0);
    return out;
  }
  let testServerCache = null;
  async function isTestServer() {
    if (testServerCache === null) {
      try { testServerCache = D.isLocalServer((await send('getState')).config?.url); } catch (e) { testServerCache = false; }
    }
    return testServerCache;
  }
  const debugDump = async (payload) => { if (await isTestServer()) send('debugDump', payload).catch(() => {}); };

  // ================================================================ nút "Lưu mẫu" trên mỗi bài
  // Đặt nút ngay bên trái cụm nút góc phải đầu bài (⋯, ×) để không che nút nào của bài
  function placeSave(post, b) {
    const pr = post.getBoundingClientRect();
    if (!pr.width) return;
    let left = Infinity;
    post.querySelectorAll('[role="button"], [aria-haspopup]').forEach((e) => {
      if (e === b || b.contains(e)) return;
      const r = e.getBoundingClientRect();
      if (r.width && r.width <= 60 && r.top < pr.top + 70 && r.bottom > pr.top && r.left > pr.left + pr.width / 2) left = Math.min(left, r.left);
    });
    const right = left === Infinity ? 56 : Math.max(8, Math.round(pr.right - left + 8));
    if (b.style.right !== right + 'px') b.style.right = right + 'px';
  }
  function inject() {
    findPosts().forEach((post) => {
      const old = post.querySelector(':scope > .dsh-save');
      if (old) return placeSave(post, old);
      if (getComputedStyle(post).position === 'static') post.style.position = 'relative';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dsh-save';
      b.textContent = 'Lưu mẫu';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSave(post, b);
      });
      post.appendChild(b);
      placeSave(post, b);
    });
  }
  let injectTimer = null;
  new MutationObserver(() => {
    if (injectTimer) return;
    injectTimer = setTimeout(() => { injectTimer = null; inject(); }, 600);
  }).observe(document.body, { childList: true, subtree: true });
  inject();

  async function onSave(post, btn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Đang đọc bài…';
    try {
      const state = await send('getState');
      if (!state.configured || !state.loggedIn) {
        alert('Dropship Hub: bấm biểu tượng extension trên thanh Chrome để kết nối và đăng nhập trước.');
        return;
      }
      const tm = timer();
      const data = await extract(post);
      tm.mark('doc-bai');
      debugDump({ html: domSnapshot(post), text: post.innerText, data, url: location.href, kind: 'luu-mau' });
      // Tìm link story.php SONG SONG với lúc chụp ảnh (chỉ tải trang, không đụng vào màn hình)
      const storyEarly = D.postIdOf(data.post_url) ? storyUrl([data.post_url], data.page_url, post).catch(() => null) : null;
      btn.textContent = 'Đang chụp ảnh…';
      let image = null;
      try {
        const shot = await captureWithComments(post);
        tm.mark('chup-anh');
        image = shot.image;
        if (shot.error) data.captureError = shot.error;
        if (!data.post_url && shot.url && POST_PATTERNS.some((p) => p.test(shot.url))) data.post_url = D.cleanPostUrl(shot.url);
        btn.textContent = 'Đang lấy link bài…';
        const story = (storyEarly && await storyEarly) || await storyUrl([data.post_url, shot.url], data.page_url, post);
        tm.mark('link-story');
        if (story) data.post_url = story;
      } catch (e) { data.captureError = captureError(e); }
      openModal(data, image, state.settings || {});
      debugDump({ html: '', text: '', data: tm.done(), url: location.href, kind: 'thoi-gian' });
    } catch (e) {
      alert('Dropship Hub: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ================================================================ hộp xác nhận trước khi lưu
  const MODAL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif; }
    .back { position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,23,33,.55); display: grid; place-items: center; padding: 20px; }
    .box { width: min(980px, 100%); max-height: 92vh; background: #fff; color: #1B2735; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; font-size: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
    header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #D5DCE3; border-top: 4px solid #F2B33D; }
    h2 { margin: 0; font-size: 17px; }
    .x { border: 0; background: none; font-size: 24px; cursor: pointer; color: #4D5B6B; line-height: 1; }
    .body { overflow: auto; padding: 16px 20px; }
    .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 20px; }
    .left img { width: 100%; border: 1px solid #D5DCE3; border-radius: 8px; display: block; }
    .muted { color: #6B7785; }
    .right { display: flex; flex-direction: column; gap: 10px; }
    label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; font-size: 12.5px; color: #34404D; }
    input, textarea { font: inherit; font-weight: 400; font-size: 14px; padding: 8px 10px; border: 1px solid #C3CCD6; border-radius: 6px; color: #1B2735; background: #fff; width: 100%; }
    input:focus, textarea:focus { outline: 2px solid #2D6CDF; outline-offset: -1px; border-color: transparent; }
    textarea { resize: vertical; }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .req { color: #C2410C; font-weight: 500; font-size: 11px; }
    small.warn, .warn { color: #B45309; font-weight: 400; }
    .entry { margin: 0; padding: 8px 10px; border-radius: 6px; background: #F1F4F7; font-size: 13px; }
    .entry.ok { background: #E7F6EC; color: #166534; }
    .entry.bad { background: #FEF3E2; color: #9A3412; }
    .dup { padding: 8px 10px; border-radius: 6px; background: #FEF3E2; color: #9A3412; font-size: 13px; display: flex; flex-direction: column; gap: 2px; }
    .dup.hard { background: #FDE8E8; color: #9B1C1C; }
    .dup[hidden] { display: none; }
    footer { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 12px 20px; border-top: 1px solid #D5DCE3; }
    .msg { margin-right: auto; font-size: 13px; }
    .msg.err { color: #B91C1C; }
    button.primary, button.ghost { font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 6px; cursor: pointer; }
    button.primary { background: #1B2735; color: #fff; border: 0; }
    button.primary:disabled { opacity: .6; cursor: wait; }
    button.ghost { background: #fff; color: #1B2735; border: 1px solid #C3CCD6; }
    .done { padding: 40px; text-align: center; }
    .done h2 { margin-bottom: 8px; }
    @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
  `;

  function openModal(data, image, settings) {
    document.getElementById('dsh-modal-host')?.remove();
    const host = document.createElement('div');
    host.id = 'dsh-modal-host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const ratio = Number(settings.entry_ratio || 3);
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const imgPart = image
      ? `<img src="${image}" alt="Ảnh chụp bài">`
      : `<p class="muted">${esc(data.captureError || 'Không chụp được ảnh.')}</p>`;
    root.innerHTML = `
      <style>${MODAL_CSS}</style>
      <div class="back">
        <form class="box" novalidate>
          <header><h2>Lưu mẫu vào Dropship Hub</h2><button type="button" class="x" data-close aria-label="Đóng">×</button></header>
          <div class="body">
            <div class="cols">
              <div class="left">${imgPart}</div>
              <div class="right">
                <div class="dup" hidden></div>
                <label>Link bài viết <b class="req">bắt buộc</b>
                  <input name="post_url" value="${esc(data.post_url)}" placeholder="Dán link bài vào đây">
                  ${data.post_url ? '' : '<small class="warn">Chưa lấy được link. Bấm vào thời gian đăng bài (hoặc nút ⋯ › Sao chép liên kết) rồi dán vào đây.</small>'}
                </label>
                <div class="g2">
                  <label>Tên page<input name="page_name" value="${esc(data.page_name)}"></label>
                  <label>Link page<input name="page_url" value="${esc(data.page_url)}"></label>
                </div>
                <label>Link sản phẩm<input name="product_url" value="${esc(data.product_url)}"></label>
                <div class="g3">
                  <label>Like<input name="likes" type="number" min="0" value="${data.likes ?? ''}"></label>
                  <label>Comment<input name="comments" type="number" min="0" value="${data.comments ?? ''}"></label>
                  <label>Share<input name="shares" type="number" min="0" value="${data.shares ?? ''}"></label>
                </div>
                <p class="entry"></p>
                <label>Headline<input name="headline" value="${esc(data.headline)}"></label>
                <label>Description<input name="description" value="${esc(data.description)}"></label>
                <label>Content<textarea name="ad_content" rows="6">${esc(data.ad_content)}</textarea></label>
                <label>Link Ads Library<input name="ad_library_url" value=""></label>
                <label>Ghi chú<input name="note" placeholder="Không bắt buộc"></label>
              </div>
            </div>
          </div>
          <footer>
            <span class="msg"></span>
            <button type="button" class="ghost" data-close>Hủy</button>
            <button type="submit" class="primary">Lưu mẫu</button>
          </footer>
        </form>
      </div>`;

    const form = root.querySelector('form');
    const $ = (n) => form.elements[n];
    const msg = root.querySelector('.msg');
    const close = () => host.remove();
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    root.querySelector('.back').addEventListener('mousedown', (e) => e.target.classList.contains('back') && close());
    // phím trong hộp không lọt ra Facebook (vd phím tắt J/K/L)
    ['keydown', 'keyup', 'keypress'].forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));

    let adlibTouched = false;
    const updAdlib = () => { if (!adlibTouched) $('ad_library_url').value = D.adLibraryUrl($('ad_content').value) || ''; };
    $('ad_library_url').addEventListener('input', () => (adlibTouched = true));
    $('ad_content').addEventListener('input', updAdlib);
    updAdlib();

    const num = (n) => ($(n).value === '' ? null : parseInt($(n).value, 10));
    const updEntry = () => {
      const p = D.entryPass(num('likes'), num('comments'), num('shares'), ratio);
      const el = root.querySelector('.entry');
      el.className = 'entry ' + (p === null ? '' : p ? 'ok' : 'bad');
      el.textContent = p === null
        ? 'Nhập đủ 3 chỉ số để kiểm tra tiêu chí đầu vào.'
        : p ? `Đạt đầu vào: (Share + Comment) × ${ratio} ≥ Like.`
          : `Chưa đạt đầu vào: (Share + Comment) × ${ratio} < Like.${settings.entry_required ? ' Hệ thống đang bắt buộc đạt nên sẽ không lưu được.' : ' Vẫn có thể lưu để theo dõi.'}`;
    };
    ['likes', 'comments', 'shares'].forEach((n) => $(n).addEventListener('input', updEntry));
    updEntry();

    const contentHash = async () => ($('ad_content').value.trim() ? D.sha256(D.normalizeText($('ad_content').value)) : '');
    const dupBox = root.querySelector('.dup');
    let dupTimer;
    const checkDup = async () => {
      const post_url = $('post_url').value.trim();
      if (!post_url) return;
      const product_key = $('product_url').value.trim() ? D.productKey($('product_url').value.trim()) : null;
      try {
        const rows = await send('checkDuplicate', { post_key: D.postKey(post_url), content_hash: (await contentHash()) || null, product_key });
        if (!rows.length) { dupBox.hidden = true; return; }
        const kind = { post: 'Bài này đã được lưu', content: 'Trùng nội dung quảng cáo', product: 'Trùng link sản phẩm' };
        dupBox.hidden = false;
        dupBox.className = 'dup' + (rows.some((r) => r.match_type === 'post') ? ' hard' : '');
        dupBox.innerHTML = rows.slice(0, 3).map((r) =>
          `<div><b>${kind[r.match_type]}</b> bởi ${esc(r.owner_name)}${r.code ? ` (${esc(r.code)})` : ''}, trang ${esc(r.page_name || '')}</div>`).join('');
      } catch (e) { /* bỏ qua */ }
    };
    ['post_url', 'product_url', 'ad_content'].forEach((n) =>
      $(n).addEventListener('input', () => { clearTimeout(dupTimer); dupTimer = setTimeout(checkDup, 600); }));
    checkDup();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const post_url = D.cleanPostUrl($('post_url').value.trim());
      if (!/facebook\.com/.test(post_url)) {
        msg.className = 'msg err';
        msg.textContent = 'Cần link bài viết Facebook để theo dõi chỉ số mỗi ngày.';
        $('post_url').focus();
        return;
      }
      const product_url = $('product_url').value.trim() ? D.cleanProductUrl($('product_url').value.trim()) : '';
      const submitBtn = form.querySelector('.primary');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Đang lưu…';
      msg.className = 'msg';
      msg.textContent = '';
      try {
        const fields = {
          post_url,
          post_key: D.postKey(post_url),
          page_name: $('page_name').value.trim(),
          page_url: $('page_url').value.trim(),
          product_url,
          product_key: product_url ? D.productKey(product_url) : '',
          ad_content: $('ad_content').value.trim(),
          headline: $('headline').value.trim(),
          description: $('description').value.trim(),
          ad_library_url: $('ad_library_url').value.trim(),
          content_hash: await contentHash(),
          note: $('note').value.trim(),
          likes: num('likes'), comments: num('comments'), shares: num('shares'),
          source: 'dom',
        };
        const res = await send('saveProduct', { fields, image });
        root.querySelector('.box').innerHTML = `
          <div class="done">
            <h2>Đã lưu mẫu</h2>
            <p>Mẫu đang ở cột Following. Ba ngày tới, extension tự đọc số mỗi ngày khi bạn mở Chrome.</p>
            ${res?.warn ? `<p class="warn">${esc(res.warn)}</p>` : ''}
            <button type="button" class="primary" data-close>Đóng</button>
          </div>`;
        root.querySelector('[data-close]').addEventListener('click', close);
        setTimeout(close, 4000);
      } catch (err) {
        msg.className = 'msg err';
        msg.textContent = err.message.replace(/^TRÙNG:\s*/, '');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Lưu mẫu';
      }
    });
  }

  // ================================================================ đọc số mỗi ngày (lệnh từ background)
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'scrapePost') return false;
    scrapePost().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  async function scrapePost() {
    const main = () => document.querySelector('div[role="main"]');
    // Cửa sổ bị che/thu nhỏ → Chrome coi là ẩn, Facebook ngừng vẽ nội dung → nhờ background đưa cửa sổ lên trước
    if (document.visibilityState !== 'visible') {
      await send('focusMe').catch(() => {});
      for (let t = 0; t < 5000 && document.visibilityState !== 'visible'; t += 250) await sleep(250);
    }

    // Trang reel (link cũ): số nằm trên các nút của reel đang hiển thị
    if (/\/reel\//.test(location.pathname)) {
      let counts = { likes: null, comments: null, shares: null };
      for (let i = 0; i < 30; i++) {
        counts = buttonCounts(document, true);
        if (counts.likes !== null || counts.comments !== null) break;
        await sleep(400);
      }
      if (counts.likes === null && counts.comments === null && counts.shares === null) {
        return { ok: false, error: 'Không đọc được số trên trang reel (có thể video đã bị xóa)' };
      }
      debugDump({ html: domSnapshot(main() || document.body), text: main()?.innerText?.slice(0, 20000), data: counts, url: location.href, kind: 'doc-so' });
      let image = null;
      try { image = await captureReel(); } catch (e) { /* vẫn ghi số */ }
      return { ok: true, counts, image };
    }

    // story.php / link bài: thường mở thành khung bài nổi. Phải đọc trong đúng khung đó.
    let post = null;
    const dlg = await waitPostDialog(10000, true);
    if (dlg) {
      // Chờ số hiện trên nút (khung vẽ dần); bài = khối chứa nút Like
      const btnOf = () => actionButton(dlg, 'likes') || actionButton(dlg, 'comments');
      for (let t = 0; t < 8000 && !/\d/.test(btnOf()?.b.innerText || ''); t += 300) await sleep(300);
      const b = btnOf()?.b;
      post = (b && (b.closest('div[aria-posinset]') || findPosts(dlg).find((p) => p.contains(b)))) || dlg;
    } else if (!/\/story\.php/.test(location.pathname)) {
      // Trang bài viết riêng: bài phải chứa đúng ID bài — bài bị xóa thì Facebook hiện bảng tin (bài KHÁC)
      const want = D.postIdOf(location.href);
      const mine = (p) => !want || [...p.querySelectorAll('a[href]')].some((a) => a.href.includes(want));
      for (let i = 0; i < 10 && !post; i++) {
        post = findPosts(main() || document).find(mine) || null;
        if (!post) await sleep(500);
      }
    }
    if (!post) {
      const gone = /content isn't available|nội dung này hiện không (khả dụng|có sẵn)|không xem được nội dung này/i.test(main()?.innerText || '');
      return {
        ok: false, error: gone
          ? 'Bài không còn xem được (đã bị xóa, bị ẩn hoặc hết chạy quảng cáo) — kiểm tra lại trên web'
          : 'Không mở được bài (có thể đã bị xóa, bị ẩn hoặc link sai)',
      };
    }
    await sleep(200);
    const counts = parseCounts(post);
    debugDump({ html: domSnapshot(post), text: post.innerText?.slice(0, 20000), data: counts, url: location.href, kind: 'doc-so' });
    if (counts.likes === null && counts.comments === null && counts.shares === null) {
      return {
        ok: false, error: document.visibilityState !== 'visible'
          ? 'Cửa sổ đọc số bị che hoặc thu nhỏ nên Facebook không hiện nội dung — để cửa sổ đó nổi lên trên cho tới khi xong'
          : 'Khung bài chưa hiện số Like/Comment/Share',
      };
    }
    let image = null;
    try { image = (await captureWithComments(post, { open: false })).image; } catch (e) { /* vẫn ghi số */ }
    return { ok: true, counts, image };
  }

  // Cho bộ test tự động (extension/tests) gọi thẳng các hàm đọc bài
  if (window.__DSH_TEST__) Object.assign(window.__DSH_TEST__, { findPosts, placeSave, extract, parseCounts, buttonCounts, linkBlockStart, storyUrl, scrapePost });
})();
