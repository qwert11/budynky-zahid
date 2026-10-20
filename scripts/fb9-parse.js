// Посты групп Facebook (сырьё — fb9-group.js) → кандидаты каталога в формате loadExt().
//
// Правила покупателя 20.10.2026:
//   • берём только дома и только посты С ЯВНОЙ ЦЕНОЙ в тексте: «в фейсбуке научились
//     поднимать объявы в топ» — пост без цены это реклама агентства или подъём старого
//     лота, а не предложение;
//   • цена — $20–45 тыс. (в первую очередь ради полосы $20–30 тыс.), грн и евро
//     пересчитываются по тем же курсам, что у Телеграма (tg9.js);
//   • остальное — как у всех источников: только 9 областей, дома от 65 м² (если площадь
//     указана), не доля, не недострой и не «под ремонт» (UNFIN/BAD_TEXT/SHARE из lib9.js),
//     до 10 км от города — это проверяет уже units9.js.
//
// Место — по тексту: село/город + область. Nominatim ищет «<село>, <область>», и ответ
// принимается, только если точка лежит в контуре этой области (одноимённых сёл много).
// Миниатюра скачивается сразу в img/fb/<id>.jpg: ссылки scontent подписаны и протухают
// через несколько дней, а внешний URL на Pages потом показал бы битую картинку.
//
// usage: node fb9-parse.js → data/fb9-candidates.json (+ data/fb9-geocode.json, img/fb/)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const RAW = (process.env.FB9_RAW || D + 'fb9-raw') + path.sep;
const IMG = path.join(__dirname, '..', 'img', 'fb') + path.sep;
const GEO = D + 'fb9-geocode.json';
const FF = 'D:/soft/video/ffmpeg.exe';
const UAHRATE = 43.5, EURUSD = 1.17;     // как в tg9.js
const SINCE = '2026-06-01';              // старше — скорее всего продано: FB не снимает посты сам
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// Фото проверяются глазами, как у домов OLX (вердикт в общем photo-vet.json: «no» — в
// посте нет жилья, только план или участок). fb9-pick.json — номер кадра для миниатюры,
// если первым в посте идёт пейзаж, карта или реклама с телефоном, а не дом.
const VET = fs.existsSync(D + 'photo-vet.json') ? rd(D + 'photo-vet.json') : {};
const PICK = fs.existsSync(D + 'fb9-pick.json') ? rd(D + 'fb9-pick.json') : {};

/* ── 1. посты из сырых ответов ленты ── */
function* jsonChunks(txt) {
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) continue;
    try { yield JSON.parse(s); } catch (e) {}
  }
}
const posts = {};
// Репост в группу: у поста-обёртки своя дата и ссылка в группе, а текст и фото лежат во
// вложенной истории (attached_story). Вложение даёт только текст и фото (inner), и они
// берутся, лишь если у самой обёртки своего текста нет.
function walkStory(o, p, depth, inner) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  if (Array.isArray(o)) { for (const x of o) walkStory(x, p, depth + 1, inner); return; }
  for (const k in o) {
    if (/comment|feedback|reaction|actors/i.test(k)) continue;   // комментарии — не текст лота
    const v = o[k];
    if (k === 'attached_story') { walkStory(v, p, depth + 1, true); continue; }
    const tk = inner ? 'atext' : 'text', pk = inner ? 'aphotos' : 'photos';
    if (k === 'message' && v && typeof v.text === 'string' && (!p[tk] || v.text.length > p[tk].length)) p[tk] = v.text;
    else if (!inner && k === 'creation_time' && typeof v === 'number' && !p.time) p.time = v;
    else if (!inner && (k === 'url' || k === 'wwwURL') && typeof v === 'string' && /\/(permalink|posts)\/\d+/.test(v) && !p.url) p.url = v;
    else if ((k === 'photo_image' || k === 'image' || k === 'viewer_image') && v && typeof v.uri === 'string' && /scontent|fbcdn/.test(v.uri)) {
      if (!p[pk].includes(v.uri) && (v.width || 999) >= 300) p[pk].push(v.uri);
    } else walkStory(v, p, depth + 1, inner);
  }
}
function collect(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { for (const x of o) collect(x); return; }
  if (typeof o.post_id === 'string') {
    const p = posts[o.post_id] = posts[o.post_id] || { id: o.post_id, photos: [], aphotos: [] };
    walkStory(o, p, 0, false);
  }
  for (const k in o) collect(o[k]);
}
const groups = fs.existsSync(RAW) ? fs.readdirSync(RAW) : [];
for (const g of groups) {
  for (const f of fs.readdirSync(RAW + g).filter(f => f.endsWith('.txt'))) {
    for (const j of jsonChunks(fs.readFileSync(path.join(RAW, g, f), 'utf8'))) collect(j);
  }
}
for (const p of Object.values(posts)) {
  if (!p.text && p.atext) { p.text = p.atext; p.shared = true; }
  if (!p.photos.length) p.photos = p.aphotos;
}

/* ── 2. разбор текста ── */
const W = "[а-яіїєґʼ'’-]*";
const OBL_RE = [
  ['vol', new RegExp(`волинськ${W}\\s+обл|волинь|волині`, 'i')],
  ['rov', new RegExp(`рівненськ${W}\\s+обл|рівненщин`, 'i')],
  ['lv', new RegExp(`львівськ${W}\\s+обл|львівщин`, 'i')],
  ['ter', new RegExp(`тернопільськ${W}\\s+обл|тернопільщин`, 'i')],
  ['if', new RegExp(`івано[\\s-]франківськ${W}\\s+обл|прикарпатт`, 'i')],
  ['chv', new RegExp(`чернівецьк${W}\\s+обл|буковин`, 'i')],
  ['khm', new RegExp(`хмельницьк${W}\\s+обл|хмельниччин`, 'i')],
  ['zht', new RegExp(`житомирськ${W}\\s+обл|житомирщин`, 'i')],
  ['vin', new RegExp(`вінницьк${W}\\s+обл|вінниччин`, 'i')],
];
const ZONE = { vol: 'Волынь', rov: 'Ровенщина', lv: 'Львовщина', ter: 'Тернопольщина', if: 'Прикарпатье',
  chv: 'Буковина', khm: 'Хмельниччина', zht: 'Житомирщина', vin: 'Винничина' };
const REGION_UA = { vol: 'Волинська', rov: 'Рівненська', lv: 'Львівська', ter: 'Тернопільська', if: 'Івано-Франківська',
  chv: 'Чернівецька', khm: 'Хмельницька', zht: 'Житомирська', vin: 'Вінницька' };
// чужая область в том же посте — значит, это сводка «продаю в нескольких местах», место не определить
const OTHER_OBL = new RegExp(`(київськ|черкаськ|одеськ|полтавськ|кіровоградськ|миколаївськ|чернігівськ|сумськ|харківськ|дніпропетровськ|закарпатськ|запорізьк|херсонськ)${W}\\s+обл`, 'i');

const HOUSE = /будин|будиноч|\bдім\b|\bхат[аиу]\b|котедж|садиб|господарк|обійст/i;
const SALE = /прода/i;
const WANT = /шука(ю|ємо|є)|куплю|купимо|викупимо|придбаю|придбаємо/i;
const RENT = /оренд|здам\b|здається|зніму|винайм|на добу|подобово/i;
const SOLD = /продано|неактуальн|зарезервован/i;
const LAND = /^\s*(продам|продається|продаж)\s+(земельн\S*\s+)?ділянк|ділянк\S*\s+під\s+(забудов|будівництв)/i;
const FLAT = /квартир/i;

// Цена. Число с множителем «тис/к» и валютой после него («22 тис дол», «25000у.о»,
// «15000$», «22000 Євро») или валютой перед ним («$25 000»). Без валюты принимаем
// только «Ціна 25 тис.» — подпись «ціна» плюс множитель, это доллары.
const NUM = "(\\d{1,3}(?:[\\s.,'`]\\d{3})+|\\d+(?:[.,]\\d+)?)";
const MULT = '(\\s?(?:тисяч[аі]?|тис\\.?|т\\.|k|к)(?![а-яіїєґa-z]))?';
const CUR = '\\s?(\\$+|usd|дол(?:ар(?:ів|а|и)?)?\\.?|у\\.\\s?о\\.?|у\\.?о\\.?|уо|€|eur|євро|евро|є(?![а-яіїєґ])|грн\\.?|гривень|₴)';
const RE_AFTER = new RegExp(NUM + MULT + CUR, 'gi');
const RE_BEFORE = new RegExp('(\\$|€|usd)\\s?' + NUM + MULT, 'gi');
const RE_LABEL = new RegExp('(?:ціна|вартість|ц\\.)\\s*[:\\-–]?\\s*' + NUM + '\\s?(тисяч[аі]?|тис\\.?)(?!\\s?(?:грн|гривень|€|євро|евро))', 'gi');
const numOf = s => /^\d{1,3}([\s.,'`]\d{3})+$/.test(s) ? +s.replace(/[\s.,'`]/g, '') : parseFloat(s.replace(',', '.'));
const curOf = c => /^(\$|usd|дол|у\.?\s?о|уо)/i.test(c) ? 'USD' : /^(€|eur|євро|евро|є)/i.test(c) ? 'EUR' : 'UAH';
const toUsd = (v, cur) => cur === 'UAH' ? Math.round(v / UAHRATE) : cur === 'EUR' ? Math.round(v * EURUSD) : Math.round(v);
function priceOf(t) {
  const found = [];
  const push = (idx, v, mult, cur) => {
    let x = numOf(v);
    if (!(x > 0)) return;
    if (mult && mult.trim()) x *= 1000;
    const usd = toUsd(x, cur);
    if (usd >= 3000 && usd <= 400000) found.push({ idx, usd, cur, raw: x });
  };
  for (const m of t.matchAll(RE_AFTER)) push(m.index, m[1], m[2], curOf(m[3]));
  for (const m of t.matchAll(RE_BEFORE)) push(m.index, m[2], m[3], curOf(m[1]));
  for (const m of t.matchAll(RE_LABEL)) push(m.index, m[1], m[2], 'USD');
  if (!found.length) return null;
  found.sort((a, b) => a.idx - b.idx);
  // цена под подписью «ціна/вартість/за» важнее первой попавшейся суммы
  const labeled = found.find(f => /(ціна|вартість|ц\.|\bза)\s*[:\-–]?\s*$/i.test(t.slice(Math.max(0, f.idx - 14), f.idx)) ||
    /(ціна|вартість)/i.test(t.slice(Math.max(0, f.idx - 14), f.idx)));
  return labeled || found[0];
}

// Название — одно слово; второе берётся только у составных («Нова Ушиця», «Великий
// Кучурів»), иначе за селом цеплялось «Житомирської» или «Івано-».
const PLACE = "([А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24}(?:-[А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24})?)(?: ([А-ЯІЇЄҐ][а-яіїєґʼ'’]{2,24}))?";
const COMPOUND = /^(Нов|Стар|Велик|Мал|Верхн|Нижн|Горішн|Долішн|Червон|Зелен|Біл|Чорн|Сух|Мокр|Висок|Глибок|Добр|Золот|Кам)[а-яіїє]{0,4}$/;
const LOC_RE = [
  new RegExp('(?:^|[\\s,(.])(?:с\\.|с-ще|село|селі|селище|селищі|смт\\.?)\\s*' + PLACE),
  new RegExp('(?:^|[\\s,(.])(?:м\\.|місто|місті)\\s*' + PLACE),
];
function locOf(t) {
  for (const re of LOC_RE) {
    const m = t.match(re);
    if (m) return ((m[2] && COMPOUND.test(m[1])) ? m[1] + ' ' + m[2] : m[1]).replace(/[’']/g, 'ʼ');
  }
  return null;
}
// падеж: «в селі Жукові» → «Жуків», «у Теофилівці» → «Теофилівка»
function locForms(s) {
  const v = [s];
  for (const [re, to] of [[/ові$/, 'ів'], [/еві$/, 'ів'], [/ці$/, 'ка'], [/ні$/, 'на'], [/рі$/, 'ра'], [/і$/, 'а'], [/і$/, 'и'], [/ому$/, 'е']])
    if (re.test(s)) v.push(s.replace(re, to));
  return [...new Set(v)];
}
const areaOf = t => { const m = t.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:м2|м²|кв\.?\s?м|квадрат)/i); return m ? +m[1].replace(',', '.') : null; };
function landOf(t) {
  let m = t.match(/(\d{1,3}(?:[.,]\d+)?)\s*сот/i); if (m) return +m[1].replace(',', '.');
  m = t.match(/(\d(?:[.,]\d+)?)\s*га\b/i); if (m) return Math.round(+m[1].replace(',', '.') * 100);
  return null;
}
const ROOMW = { одно: 1, дво: 2, двох: 2, три: 3, трьох: 3, чотири: 4, чотирьох: 4, пяти: 5, 'п’яти': 5, "п'яти": 5 };
function roomsOf(t) {
  const m = t.match(/(\d)\s*-?\s*(?:х\s*)?кімнат/i); if (m) return +m[1];
  const w = t.match(/(одно|двох|дво|трьох|три|чотирьох|чотири|п['’]?яти)кімнатн/i);
  return w ? ROOMW[w[1].toLowerCase().replace('’', "'")] || null : null;
}
// «Недострой / под ремонт» — но не про хозпостройку: в длинном посте «Є льох (потребує
// ремонту)» выбрасывал дом со свежим ремонтом (пример покупателя, Гвіздівці, 20.10.2026).
// Совпадение не считается, если в 40 символах перед ним названа постройка во дворе.
const OUTBUILD = /(льох|погріб|погреб|пивниц|сарай|хлів|стодол|гараж|літн\S*\s+кухн|баня|лазн|альтанк|флігел|паркан|огорож|криниц|колодяз)[^.!?\n]{0,40}$/i;
function badText(t) {
  for (const re of [L.UNFIN, L.BAD_TEXT]) {
    for (const m of t.matchAll(new RegExp(re.source, 'gi'))) {
      if (!OUTBUILD.test(t.slice(Math.max(0, m.index - 40), m.index))) return true;
    }
  }
  return false;
}
// заголовок — первая содержательная строка: не телефон и не подпись «ваш рієлтор»
const PHONE = /\d{3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2}/;
function titleOf(t) {
  const lines = t.split(/\n|(?<=[.!?])\s/).map(s => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s+/g, ' ').trim());
  const good = lines.find(s => (s.match(/[а-яіїєґ]/gi) || []).length >= 15 && !PHONE.test(s) && !/рієлтор|ріелтор|агенці/i.test(s));
  return (good || lines.find(Boolean) || '').slice(0, 90);
}

/* ── 3. геокод с проверкой контура области ── */
const shapes = rd(D + 'oblast-shapes9.json');
const geo = fs.existsSync(GEO) ? rd(GEO) : {};
async function geocode(loc, obl) {
  const key = loc + '|' + obl;
  if (geo[key] !== undefined) return geo[key];
  let hit = null;
  for (const form of locForms(loc)) {
    const q = `${form}, ${REGION_UA[obl]} область, Україна`;
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ua&q=' + encodeURIComponent(q);
    let js = null;
    for (let t = 0; t < 4 && js == null; t++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'house-catalog-builder/1.0 (personal build)' } });
        if (r.status === 429 || r.status >= 500) { await sleep(20000 * (t + 1)); continue; }
        js = r.ok ? await r.json() : [];
      } catch { await sleep(10000); }
    }
    await sleep(1500);
    if (js == null) return null;   // сеть/429 — не кэшируем, следующий прогон повторит
    hit = js.find(h => /village|town|city|hamlet|municipality|suburb|administrative/.test(h.type || h.addresstype || '') &&
      L.oblastOf(+h.lat, +h.lon, shapes) === obl);
    if (hit) break;
  }
  geo[key] = hit ? { lat: +(+hit.lat).toFixed(5), lon: +(+hit.lon).toFixed(5) } : null;
  fs.writeFileSync(GEO, JSON.stringify(geo, null, 1));
  return geo[key];
}

/* ── 4. миниатюра в репозиторий ── */
async function thumb(id, urls) {
  const out = IMG + id + '.jpg';
  if (fs.existsSync(out)) return true;
  for (const u of urls.slice(0, 3)) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) continue;
      const tmp = IMG + id + '.src';
      fs.writeFileSync(tmp, buf);
      execFileSync(FF, ['-y', '-i', tmp, '-vf', 'scale=200:150:force_original_aspect_ratio=increase,crop=200:150', '-q:v', '5', out], { stdio: 'ignore' });
      fs.unlinkSync(tmp);
      return true;
    } catch (e) {}
  }
  return false;
}

(async () => {
  fs.mkdirSync(IMG, { recursive: true });
  const all = Object.values(posts).filter(p => p.text);
  const why = {};
  const no = r => { why[r] = (why[r] || 0) + 1; return null; };
  const rows = [];
  for (const p of all) {
    const t = L.deLatin(p.text);
    const date = p.time ? new Date(p.time * 1000).toISOString().slice(0, 10) : null;
    // без даты — это исходник репоста: его текст уже взят постом-обёрткой в группе
    if (!date) { no('исходник репоста'); continue; }
    if (date < SINCE) { no('старше ' + SINCE); continue; }
    if (!SALE.test(t) || !HOUSE.test(t)) { no('не продажа дома'); continue; }
    if (WANT.test(t)) { no('ищу/куплю'); continue; }
    if (RENT.test(t) || SOLD.test(t)) { no('аренда/продано'); continue; }
    if (LAND.test(t)) { no('участок'); continue; }
    if (FLAT.test(t) && t.search(FLAT) < t.search(HOUSE)) { no('квартира'); continue; }
    const pr = priceOf(t);
    if (!pr) { no('без цены'); continue; }
    if (!L.inBudgetKind(pr.usd, 'house')) { no('цена вне $20–45 тыс.'); continue; }
    const obls = OBL_RE.filter(([, re]) => re.test(t)).map(([o]) => o);
    if (obls.length !== 1 || OTHER_OBL.test(t)) { no(obls.length ? 'несколько областей' : 'не наши области'); continue; }
    const obl = obls[0];
    const area = areaOf(t);
    if (area != null && area < 65) { no('меньше 65 м²'); continue; }
    if (L.SHARE.test(t.slice(0, 400))) { no('доля'); continue; }
    if (badText(t)) { no('недострой/под ремонт'); continue; }
    const loc = locOf(t);
    if (!loc) { no('нет села в тексте'); continue; }
    if (!p.photos.length) { no('без фото'); continue; }   // проверить дом нечем
    rows.push({ p, t, date, pr, obl, loc, area });
  }
  // один и тот же пост продавец публикует по нескольку раз, бывает с новой ценой
  // (Єрчики: $26 000 в сентябре, $22 000 в октябре) — оставляем самый свежий
  const key = r => r.loc + '|' + (r.area || '') + '|' + titleOf(r.t).toLowerCase().replace(/[^а-яіїєґ]/g, '').slice(0, 40);
  const best = new Map();
  for (const r of rows.sort((a, b) => b.date.localeCompare(a.date))) if (!best.has(key(r))) best.set(key(r), r);
  if (process.env.FB9_DRY) {   // проверка разбора без сети: что прошло и почему отсеяно
    for (const r of best.values()) console.log(`${r.date} ${r.obl} $${r.pr.usd} (${r.pr.raw} ${r.pr.cur}) ${r.loc} ${r.area || '?'}м² | ${titleOf(r.t)}`);
    console.log('отсев:', JSON.stringify(why), '| прошло', best.size);
    return;
  }
  const out = [];
  for (const r of best.values()) {
    const g = await geocode(r.loc, r.obl);
    if (!g) { no('село не нашлось в области'); continue; }
    const id = 'FB' + r.p.id;
    if (VET[id] === 'no') { no('на фото не жильё'); continue; }
    const pick = PICK[id];
    const hasThumb = await thumb(id, pick != null ? [r.p.photos[pick], ...r.p.photos].filter(Boolean) : r.p.photos);
    out.push({
      id, kind: 'house', title: titleOf(r.t), url: r.p.url || `https://www.facebook.com/groups/${groups[0]}/permalink/${r.p.id}/`,
      price: r.pr.usd, cur: r.pr.cur, rawPrice: r.pr.raw,
      area: r.area, land: landOf(r.t), rooms: roomsOf(r.t),
      loc: r.loc, zone: ZONE[r.obl], lat: g.lat, lon: g.lon, locExact: true,
      date: r.date,
      // первой — локальная миниатюра (ссылки scontent протухают), дальше оригиналы для фотопроверки
      photoList: [...(hasThumb ? ['img/fb/' + id + '.jpg'] : []), ...r.p.photos.slice(0, 4)],
      text: r.t.replace(/\s+/g, ' ').slice(0, 900),
    });
  }
  fs.writeFileSync(D + 'fb9-candidates.json', JSON.stringify(out, null, 1));
  // миниатюры выбывших (перепост схлопнулся, пост отсеян) в репозитории не держим
  const keep = new Set(out.map(r => r.id + '.jpg'));
  for (const f of fs.readdirSync(IMG)) if (!keep.has(f)) fs.unlinkSync(IMG + f);
  console.log('постов', all.length, '| дублей-перепостов схлопнуто', rows.length - best.size, '| кандидатов', out.length);
  console.log('отсев:', JSON.stringify(why));
  const by = {}; out.forEach(r => { by[r.zone] = (by[r.zone] || 0) + 1; });
  console.log('по областям:', JSON.stringify(by));
})();
