// Test các hàm dùng chung của extension: node --test extension/tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared.js';

const D = globalThis.DSH;
const CGJ = String.fromCharCode(0x34f); // ký tự Facebook chèn vào chữ "Sponsored" bị xé nhỏ
const ZW = String.fromCharCode(0x200b);

test('parseCount: các kiểu số Facebook hiển thị', () => {
  const cases = { '474': 474, '1,2K': 1200, '3.6K': 3600, '2,4 N': 2400, '1,2 Tr': 1200000, '12.345': 12345, '6K': 6000,
    '22.4K': 22400, '1.5M': 1500000, '2 triệu': 2000000, ' 47 ': 47, 'abc': null, '': null };
  for (const [s, v] of Object.entries(cases)) assert.equal(D.parseCount(s), v, s);
  assert.equal(D.parseCount(null), null);
});

test('postIdOf / postKey: cùng một bài dù link khác dạng', () => {
  assert.equal(D.postIdOf('https://www.facebook.com/reel/1665648554944497'), '1665648554944497');
  assert.equal(D.postIdOf('https://www.facebook.com/novacare/videos/1665648554944497/?__cft__=x'), '1665648554944497');
  assert.equal(D.postIdOf('https://www.facebook.com/watch/?v=894988643682882'), '894988643682882');
  assert.equal(D.postIdOf('https://www.facebook.com/madgicxdotcom/posts/pfbid02bM5ZEsy?__tn__=R'), 'pfbid02bM5ZEsy');
  assert.equal(D.postIdOf('https://www.facebook.com/story.php?story_fbid=1840713290425364&id=61582458613113'), '1840713290425364');
  assert.equal(D.postKey('https://www.facebook.com/reel/1665648554944497'),
    D.postKey('https://www.facebook.com/story.php?story_fbid=1665648554944497&id=61587211415921'));
});

test('cleanPostUrl: bỏ tham số theo dõi, giữ tham số xác định bài', () => {
  assert.equal(D.cleanPostUrl('https://m.facebook.com/page/posts/123456789?__cft__[0]=AZ&__tn__=%2CO'), 'https://www.facebook.com/page/posts/123456789');
  assert.equal(D.cleanPostUrl('https://www.facebook.com/story.php?story_fbid=1&id=2&ref=noti'), 'https://www.facebook.com/story.php?story_fbid=1&id=2');
});

test('cleanProductUrl / productKey: giải mã l.facebook.com, bỏ utm', () => {
  const enc = 'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://www.cedrow.com/products/cdf?utm_source=fb&fbclid=1&variant=2') + '&h=AT';
  assert.equal(D.cleanProductUrl(enc), 'https://www.cedrow.com/products/cdf?variant=2');
  assert.equal(D.productKey(enc), 'cedrow.com/products/cdf');
  assert.equal(D.productKey('https://m.sakerplus.com/funnel/abc/'), 'sakerplus.com/funnel/abc');
});

test('cleanPageUrl: giữ id của profile.php', () => {
  assert.equal(D.cleanPageUrl('https://www.facebook.com/profile.php?id=61587211415921&__tn__=x'), 'https://www.facebook.com/profile.php?id=61587211415921');
  assert.equal(D.cleanPageUrl('https://www.facebook.com/madgicxdotcom/?ref=a'), 'https://www.facebook.com/madgicxdotcom');
});

test('adLibraryUrl: 12 từ đầu, bỏ emoji, chỉ active, US', () => {
  const u = new URL(D.adLibraryUrl('🔥 Tired of sneezing from hidden dust? This tiny gadget cleans every corner of your home fast 💨'));
  assert.equal(u.searchParams.get('active_status'), 'active');
  assert.equal(u.searchParams.get('country'), 'US');
  assert.equal(u.searchParams.get('search_type'), 'keyword_exact_phrase');
  assert.equal(u.searchParams.get('q'), '"Tired of sneezing from hidden dust? This tiny gadget cleans every corner"');
  assert.equal(D.adLibraryUrl('  '), null);
});

test('entryPass: (Share + Comment) × 3 ≥ Like', () => {
  assert.equal(D.entryPass(2700, 295, 473), false);
  assert.equal(D.entryPass(900, 150, 150), true);
  assert.equal(D.entryPass(900, null, 150), null);
  assert.equal(D.entryPass(100, 20, 20, 2), false);
});

test('cleanLine / realLine: bỏ chữ rác "Sponsored" xé nhỏ và ký tự vô hình', () => {
  const junk = ['e', 'p', 't', 'd', 'n', 'o', 's'].map((c) => c + CGJ).join('');
  assert.equal(D.cleanLine(junk + 'Cute, Spooky' + ZW + ', and Just Rude'), 'Cute, Spooky, and Just Rude');
  assert.equal(D.realLine('dÍ'), false);
  assert.equal(D.realLine('Shop now'), true);
});

test('shopDomain: dòng tên miền trên thẻ quảng cáo', () => {
  assert.equal(D.shopDomain('S.NOTI.VN'), 'https://s.noti.vn');
  assert.equal(D.shopDomain('EMMAFY.COM'), 'https://emmafy.com');
  assert.equal(D.shopDomain('facebook.com'), '');
  assert.equal(D.isDomainOnly('https://emmafy.com/'), true);
  assert.equal(D.isDomainOnly('https://emmafy.com/p/1'), false);
});

test('readUrl: /videos/ID mở dạng /reel/ID; story.php giữ nguyên', () => {
  assert.equal(D.readUrl('https://www.facebook.com/x/videos/123456789/'), 'https://www.facebook.com/reel/123456789');
  assert.equal(D.readUrl('https://www.facebook.com/watch/?v=123456789'), 'https://www.facebook.com/reel/123456789');
  const s = 'https://www.facebook.com/story.php?story_fbid=1&id=2';
  assert.equal(D.readUrl(s), s);
});

test('workDate: đổi ngày lúc 7:00 giờ Việt Nam', () => {
  assert.equal(D.workDate(new Date('2026-10-13T23:59:00Z')), '2026-10-13'); // 6:59 sáng 14/10 VN
  assert.equal(D.workDate(new Date('2026-10-14T00:00:00Z')), '2026-10-14'); // 7:00 sáng 14/10 VN
});

test('sha256 + normalizeText: cùng nội dung khác dấu câu ra cùng mã', async () => {
  assert.equal(await D.sha256(D.normalizeText('Hello,  WORLD!')), await D.sha256(D.normalizeText('hello world')));
});

test('isLocalServer', () => {
  assert.equal(D.isLocalServer('http://localhost:8787'), true);
  assert.equal(D.isLocalServer('http://example.com'), false);
  assert.equal(D.isLocalServer('https://abc.supabase.co'), false);
});
