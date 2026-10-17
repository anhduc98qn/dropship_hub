// Test content.js trên DOM giả lập cấu trúc Facebook (10/2026) bằng jsdom
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const CGJ = String.fromCharCode(0x34f);
const junk = 'Sponsored'.split('').map((c) => c + CGJ).join('');

function load(body, { url = 'https://www.facebook.com/', state = { configured: true, loggedIn: true, config: { url: 'https://x.supabase.co' } } } = {}) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom không tính bố cục: mọi phần tử coi như rộng 700 × cao 600
  w.Element.prototype.getBoundingClientRect = () => ({ top: 100, left: 100, width: 700, height: 600, bottom: 700, right: 800, x: 100, y: 100 });
  w.Element.prototype.scrollIntoView = () => {};
  // jsdom không có innerText: mỗi đoạn chữ một dòng (gần giống trình duyệt với các khối div/span tách rời)
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    get() {
      const parts = [];
      const walk = (n) => n.childNodes.forEach((c) => {
        if (c.nodeType === 3) { const x = c.textContent.trim(); if (x) parts.push(x); } else if (c.nodeType === 1) walk(c);
      });
      walk(this);
      return parts.join('\n');
    },
  });
  w.scrollTo = () => {};
  const sent = [];
  let listener = null;
  w.chrome = {
    runtime: {
      sendMessage(msg, cb) {
        sent.push(msg);
        setTimeout(() => cb(msg.type === 'getState' ? { ok: true, data: state } : { ok: false, error: 'không có trong test' }), 0);
      },
      onMessage: { addListener: (fn) => { listener = fn; } },
      lastError: null,
    },
  };
  w.__DSH_TEST__ = {};
  w.eval(src('shared.js'));
  w.eval(src('content.js'));
  return { w, t: w.__DSH_TEST__, sent, message: (msg) => new Promise((r) => listener(msg, {}, r)) };
}

const AD_POST = `
<div role="main"><div aria-posinset="1">
  <div data-ad-rendering-role="profile_name"><h4><a href="https://www.facebook.com/sophiajane111?__cft__[0]=AZ"><span>Sophia Jane with Sakerplus</span></a></h4></div>
  <span>${junk}</span>
  <a href="https://www.facebook.com/sophiajane111/posts/pfbid0abcDEF?__cft__[0]=AZ&__tn__=%2CO">2h</a>
  <div data-ad-rendering-role="story_message"><div dir="auto">🔥 Tired of sneezing from hidden dust? This tiny gadget cleans every corner fast</div></div>
  <a href="https://l.facebook.com/l.php?u=${encodeURIComponent('https://m.sakerplus.com/funnel/ghost-light?utm_source=fb&fbclid=1')}&h=AT">
    <div data-ad-rendering-role="meta">M.SAKERPLUS.COM</div>
    <div data-ad-rendering-role="title">Cute, Spooky, and Just the Right Amount of Rude</div>
    <div data-ad-rendering-role="description">Free shipping today</div>
    <div data-ad-rendering-role="cta-button"><span>Shop now</span></div>
  </a>
  <div role="button"><span data-ad-rendering-role="like_button">2.7K</span></div>
  <div role="button"><span data-ad-rendering-role="comment_button">295</span></div>
  <div role="button"><span data-ad-rendering-role="share_button"></span></div>
  <div role="article" aria-label="Comment by Anna 3 hours ago"><a href="https://www.facebook.com/anna">Anna</a> 12 comments here 99 shares</div>
</div></div>`;

test('nhận diện bài + gắn nút Lưu mẫu, bỏ qua bình luận', async () => {
  const { w, t } = load(AD_POST);
  const posts = t.findPosts(w.document);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].querySelector(':scope > .dsh-save'), 'có nút Lưu mẫu');
});

test('đọc bài quảng cáo: page, link bài, link sản phẩm, headline, content, số', async () => {
  const { w, t } = load(AD_POST);
  const d = await t.extract(t.findPosts(w.document)[0]);
  assert.equal(d.page_name, 'Sophia Jane with Sakerplus');
  assert.equal(d.page_url, 'https://www.facebook.com/sophiajane111');
  assert.equal(d.post_url, 'https://www.facebook.com/sophiajane111/posts/pfbid0abcDEF');
  assert.equal(d.product_url, 'https://m.sakerplus.com/funnel/ghost-light');
  assert.equal(d.headline, 'Cute, Spooky, and Just the Right Amount of Rude');
  assert.equal(d.description, 'Free shipping today');
  assert.match(d.ad_content, /^🔥 Tired of sneezing/);
  // nút Share có vùng đánh dấu nhưng không kèm số = 0; số trong bình luận không được tính
  assert.deepEqual({ l: d.likes, c: d.comments, s: d.shares }, { l: 2700, c: 295, s: 0 });
});

test('không có link thật: lấy tên miền shop từ vùng meta, không bấm quảng cáo', async () => {
  const html = AD_POST.replace(/<a href="https:\/\/l\.facebook\.com[^"]*">/, '<div>').replace('</a>\n  <div role="button">', '</div>\n  <div role="button">');
  const { w, t } = load(html);
  const d = await t.extract(t.findPosts(w.document)[0]);
  assert.equal(d.product_url, 'https://m.sakerplus.com');
});

test('nút chỉ có aria-label (bài mở qua story.php): đọc số trong nút', () => {
  const { w, t } = load(`<div aria-posinset="1"><a href="https://www.facebook.com/p">P</a>
    <div role="button" aria-label="Like">6K</div><div role="button" aria-label="Leave a comment">702</div><div role="button" aria-label="Share">812</div></div>`);
  assert.deepEqual({ ...t.parseCounts(t.findPosts(w.document)[0]) }, { likes: 6000, comments: 702, shares: 812 });
});

test('giao diện chữ cũ: "474 comments · 12 shares" + All reactions', () => {
  const { w, t } = load(`<div aria-posinset="1"><a href="https://www.facebook.com/p">P</a>
    <span aria-label="All reactions: 1.2K">1.2K</span><span>474 comments</span><span>12 shares</span><div>Like</div></div>`);
  assert.deepEqual({ ...t.parseCounts(t.findPosts(w.document)[0]) }, { likes: 1200, comments: 474, shares: 12 });
});

test('đọc số mỗi ngày (story.php): đọc trong khung bài nổi, không lấy bài phía sau', async () => {
  const body = `
    <div role="main"><div aria-posinset="1"><a href="https://www.facebook.com/other/posts/999999">khác</a>
      <div role="button" aria-label="Like">99K</div></div></div>
    <div role="dialog"><div><div aria-posinset="1"><a href="https://www.facebook.com/p/posts/1">bài</a>
      <div role="button" aria-label="Like">2.7K</div><div role="button" aria-label="Leave a comment">295</div>
      <div role="button" aria-label="Share">473</div>
      <div role="article" aria-label="Comment by A">hay</div></div></div></div>`;
  const { message } = load(body, { url: 'https://www.facebook.com/story.php?story_fbid=1&id=2' });
  const res = await message({ type: 'scrapePost' });
  assert.equal(res.ok, true);
  assert.deepEqual({ ...res.counts }, { likes: 2700, comments: 295, shares: 473 });
  assert.equal(res.image, null); // chụp ảnh không có trong test → vẫn trả số
});
