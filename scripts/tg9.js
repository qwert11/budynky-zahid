// Телеграм-каналы недвижимости Хмельницкого, Житомира и Винницы: история через
// публичное превью t.me/s/<канал> (браузер не нужен), фильтр — как у западного
// набора (бюджет, готовое, не аренда/не участок/не доля, дома 65+/квартиры 50+ и 2к).
// ID новых лотов — TG_<канал>_<номер>: старый формат TG<номер> сталкивался между
// каналами (известный дефект каталога). → data/tg9-candidates.json
const fs = require('fs');
const path = require('path');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const PAGES = 8, SINCE = '2026-04-01';
const UAHRATE = 43.5, EURUSD = 1.17, LO = L.BUDGET_LO, HI = L.BUDGET_HI;

const CH = {
  domua_khmelnytskyi: ['Хмельницький', 'Хмельниччина'], vlasniki_khmelnytskyi: ['Хмельницький', 'Хмельниччина'],
  domua_zhytomyr: ['Житомир', 'Житомирщина'], vlasniki_zhytomyr: ['Житомир', 'Житомирщина'], realtyin_zhytomyr: ['Житомир', 'Житомирщина'],
  vlasniki_vinnytsia: ['Вінниця', 'Винничина'], REALTYIN_VINNYTSIA: ['Вінниця', 'Винничина'],
};
const AREAS = {
  'Хмельниччина': ['Хмельницьк', 'Хмельницк', "Кам'янець", 'Камʼянець', 'Шепетівк', 'Нетішин', 'Славут', 'Старокостянтин', 'Красилів', 'Волочиськ', 'Ізяслав', 'Дунаївц', 'Полонн', 'Деражн'],
  'Житомирщина': ['Житомир', 'Бердичів', 'Бердичев', 'Коростень', 'Звягель', 'Новоград-Волинськ', 'Малин', 'Коростишів', 'Овруч', 'Радомишль', 'Черняхів', 'Баранівк', 'Олевськ', 'Андрушівк'],
  'Винничина': ['Вінниц', 'Винниц', 'Жмеринк', 'Могилів-Подільськ', 'Хмільник', 'Гайсин', 'Козятин', 'Ладижин', 'Тульчин', 'Калинівк', 'Немирів', 'Бершадь', 'Іллінц', 'Гнівань', 'Погребищ'],
};
const OTHER = ['Київ', 'Киев', 'Одес', 'Харків', 'Харьков', 'Дніпро', 'Днепр', 'Запоріж', 'Миколаїв', 'Херсон',
  'Полтав', 'Черкас', 'Сум', 'Чернігів', 'Кропивниц', 'Луган', 'Донец', 'Кривий Ріг', 'Маріуполь',
  'Бровар', 'Ірпін', 'Буча', 'Вишгород', 'Закарпат', 'Ужгород', 'Мукачево'];

const unent = s => String(s)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/�/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

function parsePage(html) {
  const posts = [];
  for (const c of html.split('<div class="tgme_widget_message ').slice(1)) {
    const post = (c.match(/data-post="([^"]+)"/) || [])[1] || null;
    const tm = (c.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
    const body = (c.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    const photos = [...c.matchAll(/background-image:url\('([^']+)'\)/g)].map(m => m[1]).filter(u => /cdn-telegram|telesco\.pe/.test(u));
    if (post) posts.push({ post, date: tm, text: unent(body).trim().slice(0, 1800), photos: photos.slice(0, 4) });
  }
  return posts;
}

const num = s => +String(s).replace(/[^\d]/g, '');
function prices(t) {
  const out = [];
  for (const m of t.matchAll(/\$\s?([\d][\d\s'`.,]{2,12})/g)) out.push({ cur: 'USD', v: num(m[1]) });
  for (const m of t.matchAll(/([\d][\d\s'`.,]{2,12})\s?(?:\$|USD|дол|у\.?\s?е\.?)/gi)) out.push({ cur: 'USD', v: num(m[1]) });
  for (const m of t.matchAll(/([\d][\d\s'`.,]{5,15})\s?(?:грн|₴|UAH)/gi)) out.push({ cur: 'UAH', v: num(String(m[1]).split(/[.,]/)[0]) });
  for (const m of t.matchAll(/€\s?([\d][\d\s'`.,]{2,12})/g)) out.push({ cur: 'EUR', v: num(m[1]) });
  return out.map(p => ({ ...p, usd: p.cur === 'UAH' ? Math.round(p.v / UAHRATE) : p.cur === 'EUR' ? Math.round(p.v * EURUSD) : p.v }))
    .filter(p => p.usd >= 5000 && p.usd <= 400000);
}
const HOUSE = /будин|дім\b|дом\b|хата|хату|хати|котедж|садиба|господарк|господарств/i;
const FLATW = /квартир/i;
const SOLD = /продано|продан|знято|неактуальн|✅\s*продано|завершено|зарезервован|здійснено продаж/i;
const LAND = /ділянк[аи]\s+\d+\s*сот[^\n]{0,40}(під будівництво|під забудову)|^\s*продається ділянка|продаж ділянки|прода(м|ю|ж)\s+(земельн\w+\s+)?ділянк|земельна ділянка\s+\d+\s*сот[^\n]{0,20}під/i;
const SMALL = /(^|[^\d])1\s*-?\s*к[іi]м|однок[іi]мнатн|1-кімнатн|студі[яю]/i;
const SHARE = /частк[аиуіо]\s*(частина\s*)?(квартири|будинку|житлового|нерухомост)|част(ину|ина|ини)\s+(будинку|квартири|житлового|приватного)|(1\/2|1\/3|1\/4|½)\s*(частин|частк|будинку|квартири)|пів\s?будинку|півбудинк|половин[ауи]\s+(будинку|част|квартири)/i;
const RAWF = /недобуд|незаверш|не закінчен\w*\s+будівництв|під чистов|коробк|фундамент|на етапі буд|стадії буд|під знесенн|аварійн|потребує капітальн|без даху/i;
const RENT = /оренд|здам|здається|зніму|винайм|за міс|\/міс|на добу|подобово/i;
const hasAny = (t, list) => list.find(w => t.includes(w)) || null;

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = {};
  for (const ch of Object.keys(CH)) {
    store[ch] = [];
    let before = null;
    for (let p = 0; p < PAGES; p++) {
      const url = 'https://t.me/s/' + ch + (before ? '?before=' + before : '');
      let html = null;
      for (let t = 0; t < 3 && html == null; t++) {
        try { const r = await fetch(url, { headers: { 'user-agent': UA } }); if (r.ok) html = await r.text(); else await sleep(1500); } catch { await sleep(1500); }
      }
      if (!html) break;
      const posts = parsePage(html);
      if (!posts.length) break;
      store[ch].push(...posts);
      const ids = posts.map(x => +x.post.split('/')[1]).filter(Boolean);
      before = Math.min(...ids);
      if (before <= 1) break;
      await sleep(700);
    }
    console.log(ch, '— постов:', store[ch].length);
  }

  const rows = [];
  for (const [ch, list] of Object.entries(store)) {
    const ch2 = CH[ch];
    for (const p of list) {
      const t = p.text || '';
      const date = (p.date || '').slice(0, 10);
      if (t.length < 40 || date < SINCE) continue;
      if (RENT.test(t) || SOLD.test(t) || LAND.test(t) || SHARE.test(t)) continue;
      if (SMALL.test(t.split('\n')[0])) continue;
      const isHouse = HOUSE.test(t), isFlat = FLATW.test(t);
      if (!isHouse && !isFlat) continue;
      const SELLFLAT = /прода(є|е)ться\s+квартир|продаж\s+квартир|продам\s+квартир|продаю\s+квартир/i;
      const kind = (isFlat && (SELLFLAT.test(t) || !isHouse || t.search(FLATW) < t.search(HOUSE))) ? 'flat' : 'house';
      const pr = prices(t).filter(x => x.usd >= LO && x.usd <= HI);
      if (!pr.length) continue;
      if (hasAny(t, OTHER)) continue;
      let zone = null;
      for (const [name, words] of Object.entries(AREAS)) if (hasAny(t, words)) { zone = name; break; }
      zone = zone || ch2[1];
      const LOCRE = [
        /Локац[іi]я\s*(?:с\.|м\.|смт\.?|село)?\s*([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,20})/,
        /(?:^|[\s,(])с(?:ело|\.)\s*([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,20})/,
        /(?:у|в)\s+сел[іi]\s+([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,20})/i,
        /смт\.?\s*([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,20})/,
        /(?:^|[\s,(])м(?:істо|\.)\s*([А-ЯІЇЄҐ][а-яіїєґ'’\-]{2,20})/,
      ];
      let locText = null;
      for (const re of LOCRE) { const m = t.match(re); if (m) { locText = m[1]; break; } }
      const area = (t.match(/([\d]{2,4}(?:[.,]\d)?)\s*(?:м2|м²|кв\.?\s?м|квад)/i) || [])[1] || null;
      const areaNum = area ? +String(area).replace(',', '.') : null;
      const roomsNum = +(t.match(/(\d)\s*-?\s*к[іi]мнат/i) || [])[1] || null;
      if (kind === 'house' && areaNum && areaNum < 65) continue;
      if (kind === 'flat' && areaNum && areaNum < 50) continue;
      if (kind === 'flat' && roomsNum && roomsNum < 2) continue;
      if (RAWF.test(t)) continue;
      const land = (t.match(/([\d]{1,3}(?:[.,]\d)?)\s*сот/i) || [])[1] || null;
      rows.push({
        src: 'tg', ch, id: 'TG_' + ch + '_' + p.post.replace(/[^0-9]/g, ''), url: 'https://t.me/' + p.post, date,
        kind, price: pr[0].usd, cur: pr[0].cur, rawPrice: pr[0].v,
        area: areaNum, land: land ? +String(land).replace(',', '.') : null, rooms: roomsNum,
        loc: locText || ch2[0], locExact: !!locText, zone,
        photoList: (p.photos || []).slice(0, 3),
        title: t.split('\n')[0].replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '').trim().slice(0, 90),
        text: t.replace(/\s+/g, ' ').slice(0, 700),
      });
    }
  }
  const key = r => (r.title.toLowerCase().replace(/[^a-zа-яіїєґ0-9]/gi, '').slice(0, 40)) + '|' + (r.area || '') + '|' + (r.loc || '');
  const best = new Map();
  for (const r of rows.sort((a, b) => b.date.localeCompare(a.date))) if (!best.has(key(r))) best.set(key(r), r);
  const good = [...best.values()];
  fs.writeFileSync(D + 'tg9-candidates.json', JSON.stringify(good, null, 1));
  const by = {}; good.forEach(r => { by[r.zone + '/' + r.kind] = (by[r.zone + '/' + r.kind] || 0) + 1; });
  console.log('в бюджете:', rows.length, '| после дедупа:', good.length, '|', JSON.stringify(by));
})();
