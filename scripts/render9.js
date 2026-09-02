// Сборка страницы каталога v3 из units9.json: топ-50 область×тип×источник + перенесённый
// набор «получистовая». Пишет две версии: best-houses9.html (артефакт, data URI картинок)
// и ../index.html (GitHub Pages, внешние URL картинок).
const fs = require('fs');
const path = require('path');
const { SEMI } = require('./lib9');
const D = path.join(__dirname, 'data') + path.sep;
const D2 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/2ba88487-cdb9-423e-b5e9-69abf018ad10/scratchpad/';
const D5 = 'C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/';
const rd = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const ex = f => fs.existsSync(f);

const DATE = '3 сентября 2026';
const { units, semi } = rd(D + 'units9.json');
const market = ex(D + 'market9.json') ? rd(D + 'market9.json') : { byId: {} };
const marketOld = ex(D5 + 'market-all.json') ? rd(D5 + 'market-all.json') : { byId: {} };
const mkt = id => market.byId[id] || marketOld.byId[id] || null;
const views9 = ex(D + 'views9.json') ? rd(D + 'views9.json') : {};
const family = ex(D + 'family.json') ? rd(D + 'family.json') : {};
const thumbs9 = ex(D + 'thumbs9.json') ? rd(D + 'thumbs9.json') : {};
const thumbUrls9 = ex(D + 'thumb-urls9.json') ? rd(D + 'thumb-urls9.json') : {};
const thumbsOld = ex(D2 + 'thumbs.json') ? rd(D2 + 'thumbs.json') : {};
const thumbs2Old = ex(D5 + 'thumbs2.json') ? rd(D5 + 'thumbs2.json') : {};
const thumbUrlsOld = ex(D5 + 'thumb-urls.json') ? rd(D5 + 'thumb-urls.json') : {};
const shell = fs.readFileSync(path.join(__dirname, 'tpl', 'site-shell9.html'), 'utf8');
const clusterTpl = fs.readFileSync(path.join(__dirname, 'tpl', 'clustermap9.html'), 'utf8');
const industry = ex(D + 'industry.json') ? rd(D + 'industry.json') : { cells: [] };
const addr9 = ex(D + 'addr9.json') ? rd(D + 'addr9.json') : {};
const shapes = rd(D + 'oblast-shapes9.json');
const dead0 = ex(path.join(__dirname, '..', 'dead.json')) ? rd(path.join(__dirname, '..', 'dead.json')) : { checked: '', dead: [] };

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = n => Number(n).toLocaleString('en-US').replace(/,/g, ' ');

// просмотры/день для лотов OLX — из views9 (PageViews GraphQL)
for (const u of units) {
  if (u.src !== 'olx') continue;
  const v = views9[u.id];
  if (v && v.views != null && u.days) { u.views = v.views; u.vpd = +(v.views / u.days).toFixed(1); }
}

/* ── плашки (как в build-site2, c поправками на новый формат) ── */
function tint(v, mid, max) {
  if (v == null) return '';
  const y = Math.min(v, mid) / mid;
  const r = Math.min(Math.max(v - mid, 0), max - mid) / (max - mid);
  const e = Math.pow(r, 0.72);
  const hue = Math.round(48 - 44 * e);
  const a = (0.55 * y + 0.45 * e).toFixed(2);
  return a === '0.00' ? '' : ` style="--kh:${hue};--ka:${a}"`;
}
const kmTint = km => tint(km, 10, 60);
function eye(vpd) {
  if (vpd == null || vpd <= 30) return '';
  const r = 1.6 + 3.6 * Math.min(1, Math.log(vpd / 30) / Math.log(10));
  return `<svg class="eye" width="20" height="14" viewBox="0 0 20 14" aria-hidden="true"><path d="M1 7 Q10 -2.5 19 7 Q10 16.5 1 7Z" fill="none" stroke="var(--muted)" stroke-width="1.4" stroke-linejoin="round"/><circle cx="10" cy="7" r="${r.toFixed(1)}" fill="var(--ink)"/></svg>`;
}
const RC = 37.7;
function ring(v, label) {
  if (v == null) return `<svg class="rg rgn" width="16" height="16" viewBox="0 0 16 16" role="img" aria-label="${label}: данных мало"><circle class="rgt" cx="8" cy="8" r="6"/></svg>`;
  const hue = Math.round(4 + 116 * (v / 100));
  const shown = Math.max(v, 7);
  const off = (RC * (1 - shown / 100)).toFixed(1);
  return `<svg class="rg" width="16" height="16" viewBox="0 0 16 16" style="--rh:${hue}" role="img" aria-label="${label}: ${v} из 100"><circle class="rgt" cx="8" cy="8" r="6"/><circle class="rgv" cx="8" cy="8" r="6" stroke-dasharray="${RC}" stroke-dashoffset="${off}"/></svg>`;
}
function marketTitle(m, kind) {
  const what = kind === 'flat' ? 'квартир' : 'домов';
  const t = [m.viaCity ? ('Рынок по ближайшему городу (' + m.loc + ') — в самом населённом пункте объявлений OLX для оценки не нашлось.') : 'Рынок вокруг этого жилья — по активным объявлениям OLX.'];
  if (m.buy == null) t.push('ПРОДАТЬ: объявлений в радиусе 10 км слишком мало для оценки.');
  else t.push('ПРОДАТЬ ' + m.buy + '/100: в радиусе 10 км продаётся ' + m.saleN10 + ' ' + what +
    (m.saleN != null ? ' (' + m.saleN + ' в самом населённом пункте)' : '') +
    ', активные объявления висят в среднем ' + m.medAge + ' дн., свежих до 30 дней ' + m.share30 + '%, больше года — ' + m.stale + '%.');
  if (!m.rentN) t.push('СДАТЬ ' + m.rent + '/100: в самом населённом пункте жильё не сдают' +
    (m.rentN15 ? ' (в радиусе 15 км — ' + m.rentN15 + ' объявлений' + (m.rentPriceNear ? ', медиана $' + m.rentPriceNear + '/мес' : '') + ', но это рынок соседнего города)' : '') + '.');
  else t.push('СДАТЬ ' + m.rent + '/100: в населённом пункте сдают ' + (m.rentH || 0) + ' домов и ' + (m.rentF || 0) + ' квартир' +
    (m.rentPrice ? ', медианная цена $' + m.rentPrice + '/мес' : '') + '; в радиусе 15 км — ' + m.rentN15 + ' объявлений.');
  t.push('Красное кольцо — рынка нет, зелёное — живой.');
  return t.join(' ');
}
function marketBadge(u) {
  const m = mkt(u.id);
  if (!m) return '';
  const nums = (m.buy == null ? '—' : m.buy) + ' · ' + m.rent;
  return `<span class="ix ixm" title="${esc(marketTitle(m, u.kind))}"><span class="rgs">${ring(m.buy, 'продать')}${ring(m.rent, 'сдать')}</span><span class="vtx"><b>${nums}</b><i>продать · сдать</i></span></span>`;
}
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const NOW = new Date();
function posted(u) {
  if (!u.created) return null;
  const d = new Date(u.created);
  if (isNaN(d)) return null;
  const days = Math.max(0, Math.round((NOW - d) / 86400000));
  const mon = Math.round(days / 30.44);
  const age = days < 60 ? days + ' дн' : (mon < 24 ? mon + ' мес' : (days / 365.25).toFixed(1).replace('.', ',') + ' года');
  return { date: d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(), days, age, iso: u.created.slice(0, 10) };
}
/* «нам подходит» и чек-листы — как раньше */
const FR = 19, FC = 2 * Math.PI * FR, FSEG = FC * 112 / 360;
const FSTART = { dad: -90, mom: 30, son: 150 };
function farc(v, key) {
  const rot = 'rotate(' + FSTART[key] + ' 24 24)';
  const track = '<circle class="fa" cx="24" cy="24" r="' + FR + '" stroke-dasharray="' + FSEG.toFixed(1) + ' ' + FC.toFixed(1) + '" transform="' + rot + '"/>';
  if (!v) return track;
  const hue = Math.round(4 + 116 * (v / 100));
  const len = (FSEG * Math.max(v, 6) / 100).toFixed(1);
  return track + '<circle class="fv" cx="24" cy="24" r="' + FR + '" style="--rh:' + hue + '" stroke-dasharray="' + len + ' ' + FC.toFixed(1) + '" transform="' + rot + '"/>';
}
function fitTitle(f) {
  if (!f.fit) return 'Разбор под нашу семью: ' + f.tag + '. Нажмите, чтобы прочитать.';
  return 'Насколько лот подходит именно нам: ' + f.fit + ' из 100 (папа — удалёнка ' + f.dad +
    ', мама — работа микробиологом ' + f.mom + ', сын — репетиторство ' + f.son +
    '). Дуги сверху по часовой: папа, мама, сын. Нажмите, чтобы прочитать разбор.';
}
function fitBadge(u) {
  const f = family[u.id];
  if (!f) return '';
  const arcs = ['dad', 'mom', 'son'].map(k => farc(f.fit ? f[k] : 0, k)).join('');
  const mid = f.fit ? String(f.fit) : '—';
  const label = f.fit ? 'нам подходит' : 'разбор';
  const sub = f.fit ? f.fit + ' из 100' : esc(f.tag);
  return '<button class="fitb" type="button" aria-expanded="false" aria-controls="fit-' + u.id + '" title="' + esc(fitTitle(f)) + '">' +
    '<svg class="fitr" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">' + arcs +
    '<text class="' + (f.fit ? 'fn' : 'fnd') + '" x="24" y="29">' + mid + '</text></svg>' +
    '<span class="fitw"><b>' + label + '</b><i>' + sub + '</i></span></button>';
}
function fitLines(body) {
  const lines = String(body).split('\n').map(x => x.trim()).filter(Boolean);
  const out = [];
  let ul = [];
  const flushUl = () => { if (ul.length) { out.push('<ul>' + ul.join('') + '</ul>'); ul = []; } };
  for (const line of lines) {
    if (line.startsWith('•')) ul.push('<li>' + esc(line.replace(/^•\s*/, '')) + '</li>');
    else { flushUl(); out.push('<p>' + esc(line) + '</p>'); }
  }
  flushUl();
  return out.join('');
}
function fitBody(u) {
  const f = family[u.id];
  if (!f) return '';
  const secs = f.sec.map(([k, title, body]) => {
    const score = f.fit && (k === 'dad' || k === 'mom' || k === 'son') ? '<span>' + f[k] + '/100</span>' : '';
    return '<div class="fsec fsec-' + k + '"><h5>' + esc(title) + score + '</h5>' + fitLines(body) + '</div>';
  }).join('');
  return '<div class="fitbody" id="fit-' + u.id + '" hidden><span class="fittag">' + esc(f.tag) + '</span>' +
    '<p class="fitsum">' + esc(f.sum) + '</p>' + secs + '</div>';
}
const CWEIGHT = { stop: 0, trade: 1, nice: 2 };
const CWNAME = { stop: 'до аванса', trade: 'торг', nice: 'посмотреть' };
function chkBadge(u) {
  const f = family[u.id];
  if (!f || !f.chk || !f.chk.length) return '';
  const n = f.chk.length;
  const stops = f.chk.filter(c => c[0] === 'stop').length;
  const title = 'Чек-лист именно этого дома: ' + n + ' пунктов' +
    (stops ? ', из них ' + stops + ' проверить до аванса' : '') +
    '. Галочки сохраняются в этом браузере отдельно по каждому дому.';
  return '<button class="chkb" type="button" aria-expanded="false" aria-controls="chk-' + u.id + '" title="' + esc(title) + '">' +
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
    '<rect x="2.5" y="2.5" width="17" height="17" rx="4" fill="none" stroke="var(--amber)" stroke-width="1.6"/>' +
    '<path d="M6.5 11.4l3.1 3.1 6-6.4" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<span class="fitw"><b>чек-лист осмотра</b><i class="chkn">0 из ' + n + '</i></span></button>';
}
function chkBody(u) {
  const f = family[u.id];
  if (!f || !f.chk || !f.chk.length) return '';
  const items = f.chk.map((c, i) => ({ w: c[0], t: c[1], i }))
    .sort((a, b) => CWEIGHT[a.w] - CWEIGHT[b.w] || a.i - b.i);
  const lis = items.map(it =>
    '<li><label class="w-' + it.w + '"><input type="checkbox" data-ci="' + it.i + '">' +
    '<span>' + esc(it.t) + ' <i style="font-style:normal;opacity:.6">· ' + CWNAME[it.w] + '</i></span></label></li>').join('');
  return '<div class="chkbody" id="chk-' + u.id + '" hidden>' +
    '<p class="chkt">Чек-лист именно этого дома</p>' +
    '<div class="chkbar"><span class="chkprog" role="img" aria-label="прогресс по этому дому"><i></i></span>' +
    '<button class="chkrst" type="button" data-crst title="Снять галочки по этому дому">Сбросить</button></div>' +
    '<ul class="chkl">' + lis + '</ul></div>';
}

const byId = {};
for (const u of [...units, ...semi]) byId[u.id] = u;
const SRC_LABEL = { olx: 'OLX', lun: 'ЛУН', tg: 'ТЕЛЕГРАМ', fb: 'ФЕЙСБУК' };
const KIND_LABEL = { house: 'дом', flat: 'квартира' };
function dupBadges(u) {
  if (!u.dups || !u.dups.length) return '';
  return u.dups.map(id => {
    const o = byId[id];
    if (!o) return '';
    return `<a class="dupb" href="#row-${id}" title="Похоже, тот же объект размещён и в другом источнике (${SRC_LABEL[o.src]}): цена и площадь совпадают. Клик — ко второй карточке.">⇆ ${SRC_LABEL[o.src]}</a>`;
  }).join('');
}

function idx(u) {
  const parts = [];
  const fb = fitBadge(u);
  if (fb) parts.push(fb);
  const cb = chkBadge(u);
  if (cb) parts.push(cb);
  const isSemi = u.ready === 'semi';
  if (isSemi) parts.push(`<span class="ix ixq" title="Индекс цена/качество внутри набора «получистовая»: близость к городу с двойным весом, цена за м², что уже готово к жизни, площадь, ${u.kind === 'flat' ? 'комнаты и этаж' : 'участок'}"><b>${u.quality}</b><i>цена/качество</i></span>`);
  else parts.push(`<span class="ix ixq" title="Индекс цена/качество внутри своего набора: близость к городу с двойным весом, цена за м², площадь, ${u.kind === 'flat' ? 'комнаты, этаж, ремонт' : 'участок'}"><b>${u.quality}</b><i>цена/качество</i></span>`);
  parts.push(`<span class="ix ixp" title="Цена в объявлении"><b>$${fmt(u.price)}</b><i>цена</i></span>`);
  if (isSemi) {
    // у получистовой вместо спроса и рынка — «что готово» и «к рынку области»
    const sc = SEMI[u.semi] || SEMI.unfin;
    parts.push(`<span class="ix ixw" title="${esc(sc.title)}"><b>${esc(sc.short)}</b><i>что готово</i></span>`);
    if (u.disc != null && u.medPpm) {
      const sign = u.disc > 0 ? '−' : (u.disc < 0 ? '+' : '');
      const t = u.disc > 0
        ? `Цена за м² ниже медианы по области среди жилья того же типа в готовом состоянии ($${fmt(u.medPpm)}/м²) — скидка за то, что часть работы придётся доделать самому`
        : `Цена за м² не ниже медианы готового жилья того же типа по области ($${fmt(u.medPpm)}/м²) — скидки за недоделки нет, есть повод торговаться`;
      parts.push(`<span class="ix ixs" title="${esc(t)}"><b>${sign}${Math.abs(u.disc)}%</b><i>к рынку области</i></span>`);
    }
  } else {
    if (u.vpd != null) parts.push(`<span class="ix ixv" title="Просмотров в день: ${fmt(u.views)} просмотров за ${u.days} дн. на OLX"><span class="vtx"><b>${u.vpd}</b><i>просм/день</i></span>${eye(u.vpd)}</span>`);
    const mb = marketBadge(u);
    if (mb) parts.push(mb);
  }
  if (u.km != null) parts.push(`<span class="ix ixt"${kmTint(u.km)} title="Расстояние по прямой до ближайшего города"><b>${u.km} км</b><i>до ${esc(u.city)}</i></span>`);
  if (u.ppm) parts.push(`<span class="ix" title="Цена за квадратный метр"><b>$${fmt(u.ppm)}</b><i>за м²</i></span>`);
  if (u.kind === 'flat' && u.floor) parts.push(`<span class="ix" title="Этаж и этажность дома"><b>${u.floor}${u.floors ? '/' + u.floors : ''}</b><i>этаж</i></span>`);
  const ps = posted(u);
  const WHERE = { olx: 'на OLX', lun: 'на ЛУНе', tg: 'в канале', fb: 'на Фейсбуке' };
  const WHERE_T = {
    olx: 'Размещено на OLX ' + (ps ? ps.date : '') + '. На странице объявления OLX показывает дату последнего поднятия',
    lun: 'Дата объявления на ЛУНе',
    tg: 'Дата поста в канале Телеграма — не дата размещения объекта: агрегаторы перевыкладывают один лот месяцами',
    fb: 'Дата публикации в Facebook Marketplace'
  };
  if (ps) parts.push(`<span class="ix ixd" title="${WHERE_T[u.src] || ''}, продаётся ${ps.age}"><b>${ps.date}</b><i>${WHERE[u.src] || 'на OLX'} ${ps.age}</i></span>`);
  return `<div class="ixs">${parts.join('')}</div>`;
}

const favBtn = id => `<button class="fav" data-fav="${id}" aria-pressed="false" title="В избранное" aria-label="В избранное">★</button>`;

function thumbFor(u, mode) {
  if (mode === 'data') return thumbs9[u.id] || thumbs2Old[u.id] || thumbsOld[u.id] || '';
  const url = thumbUrls9[u.id] || thumbUrlsOld[u.id];
  if (url) return url;
  const p = u.photoUrl || (u.photos || [])[0];
  if (!p) return '';
  if (/olxcdn/.test(p)) return String(p).replace(/;s=\d+x\d+/, ';s=200x150').replace('{width}x{height}', '200x150');
  return p;
}

function rowFor(u, mode) {
  const metaParts = [`<b>$${fmt(u.price)}</b>`, esc(u.loc), u.area ? u.area + ' м²' : '',
    u.kind === 'house' ? (u.land ? u.land + ' сот' : '') : (u.rooms ? u.rooms + ' комн' : ''),
    u.kind === 'flat' && u.floor ? u.floor + (u.floors ? '/' + u.floors : '') + ' эт' : '',
    esc(u.city || u.region || '')].filter(Boolean);
  const meta = metaParts.join(' · ');
  const SRC_HINT = {
    lun: 'Объявление найдено на lun.ua',
    olx: 'Объявление с OLX.ua',
    tg: 'Пост в публичном канале Telegram' + (u.chan ? ' @' + u.chan : '') + (u.locExact ? '' : ' · село в посте не указано, точка стоит на городе'),
    fb: 'Объявление в Facebook Marketplace'
  };
  const semiB = u.ready === 'semi' ? `<span class="semib" title="${esc((SEMI[u.semi] || SEMI.unfin).title)}">${(SEMI[u.semi] || SEMI.unfin).badge}</span>` : '';
  const badges = `<span class="srcb srcb-${u.src}" title="${SRC_HINT[u.src] || ''}">${SRC_LABEL[u.src]}</span><span class="kindb" title="Тип жилья">${KIND_LABEL[u.kind]}</span>${semiB}${dupBadges(u)}`;
  const m = mkt(u.id);
  const d = [
    `data-id="${u.id}"`, `data-rank="${u.rankIn}"`, `data-q="${u.quality}"`, `data-price="${u.price}"`,
    `data-src="${u.src}"`, `data-kind="${u.kind}"`,
    u.obl ? `data-obl="${u.obl}"` : '',
    u.ready === 'semi' ? `data-ready="semi" data-semi="${u.semi}"` + (u.disc != null ? ` data-disc="${u.disc}"` : '') : '',
    family[u.id] && family[u.id].fit ? `data-fit="${family[u.id].fit}"` : '',
    u.ppm ? `data-ppm="${u.ppm}"` : '', u.area ? `data-area="${u.area}"` : '', u.land ? `data-land="${u.land}"` : '',
    u.rooms ? `data-rooms="${u.rooms}"` : '',
    u.vpd != null ? `data-vpd="${u.vpd}"` : '', u.views != null ? `data-views="${u.views}"` : '',
    u.km != null ? `data-km="${u.km}"` : '',
    m ? `data-mbuy="${m.buy == null ? '' : m.buy}" data-mrent="${m.rent}"` : '',
    u.days != null ? `data-days="${u.days}"` + (u.created ? ` data-created="${u.created.slice(0, 10)}"` : '') : ''
  ].filter(Boolean).join(' ');
  const img = thumbFor(u, mode);
  return `<div class="row" id="row-${u.id}" ${d}><a class="ph" href="${esc(u.link)}" target="_blank" rel="noopener">${img ? `<img src="${img}" alt="" loading="lazy">` : '<span class="nophoto"></span>'}</a><div class="b"><div class="t"><span class="tx"><span class="rnk">${u.rankIn}</span><a href="${esc(u.link)}" target="_blank" rel="noopener">${esc(u.title)}</a>${badges}</span>${favBtn(u.id)}</div><div class="m">${meta}</div>${idx(u)}${fitBody(u)}${chkBody(u)}</div></div>`;
}

function rowsFor(mode) {
  // получистовая идёт после готового: на странице это отдельный список со своей шапкой
  return [...units, ...semi].map(u => rowFor(u, mode)).join('\n');
}

/* ── точки карты ── */
const pts = [];
let noGeo = 0;
for (const u of [...units, ...semi]) {
  if (!u.lat || !u.lon) { noGeo++; continue; }
  const p = {
    r: u.rankIn, i: u.id, lat: +(+u.lat).toFixed(4), lon: +(+u.lon).toFixed(4), p: u.price,
    n: u.loc, t: String(u.title || '').slice(0, 40), u: u.link, q: u.quality,
    s: u.src, k: u.kind, a: u.area || null,
  };
  if (u.obl) p.o = u.obl;
  if (u.ready === 'semi') p.g = 'semi';
  // откуда взята точка: h — адрес с номером дома, s — улица, p — село названо в тексте
  if (u.geoSrc === 'house') p.w = 'h';
  else if (u.geoSrc === 'street') p.w = 's';
  else if (u.geoSrc === 'place') p.w = 'p';
  const a = addr9[u.id];
  if (a && a.src === 'street') p.ad = 'вул. ' + a.street + (a.house ? ' ' + a.house : '');
  pts.push(p);
}

const N = units.length + semi.length;
const acc = { h: 0, s: 0, p: 0 };
for (const p of pts) if (p.w) acc[p.w]++;
const exact = acc.h + acc.s;
const GEOACC = exact
  ? `Точность метки разная: у ${exact} объявлений адрес указан в тексте (${acc.h} с номером дома, ${acc.s} до улицы) — метка стоит по нему; ` +
    `у остальных известен только населённый пункт, и точка стоит в его центре. Проверяйте адрес у продавца.`
  : 'Позиции — по селу из объявления, точного адреса в объявлениях нет: точка стоит в центре населённого пункта.';
const GEOLEDE = `<b>Метка на карте — это не адрес дома.</b> Точный адрес продавцы указывают редко: ` +
  `у <b>${acc.h + acc.s}</b> объявлений улица (а у ${acc.h} и номер дома) нашлась в заголовке или описании — ` +
  `их метки стоят по этому адресу; ещё у <b>${acc.p}</b> в тексте назван другой населённый пункт, чем в поле объявления, ` +
  `и метка перенесена туда. У остальных <b>${N - acc.h - acc.s - acc.p}</b> известен только населённый пункт: ` +
  `точка стоит в его центре, и все лоты одного села лежат в одной точке — кластер на карте означает «в одном селе», ` +
  `а не «дома рядом». Перед выездом адрес уточняйте у продавца.`;
const GEOFOOT = `Метка на карте показывает адрес из объявления только там, где продавец его назвал ` +
  `(таких ${acc.h + acc.s} из ${N}); иначе это центр населённого пункта, а не место дома.`;
const IND = industry.cells.map(c => [c.lat, c.lon, c.km2]);
const cluster = clusterTpl
  .replace('{{PTS}}', () => JSON.stringify(pts).replace(/<\//g, '<\\/'))
  .replace('{{INDUSTRY}}', () => JSON.stringify(IND))
  .replace('{{CITYSHAPES}}', () => JSON.stringify(rd(D2 + 'city-shapes.json').filter(c => c.name !== 'Ужгород')))
  .replace('{{OBLASTS}}', () => JSON.stringify(shapes.map(o => ({ name: o.name, path: o.path, lx: o.lx, ly: o.ly }))))
  .replace('{{GEOACC}}', () => GEOACC)
  .replace(/\{\{N\}\}/g, String(N));

const SITE = 'https://qwert11.github.io/budynky-zahid/';
const ARTIFACT = 'https://claude.ai/code/artifact/d9bb1462-3a1a-4453-8915-b6cef4c42580';
const XLINK = {
  artifact: `<p class="xlink"><span>Та же подборка:</span><a href="${SITE}" target="_blank" rel="noopener">↗ открыть на сайте</a><span>публичная ссылка — открывается с телефона и пересылается кому угодно.</span></p>`,
  site: `<p class="xlink"><span>Та же подборка:</span><a href="${ARTIFACT}" target="_blank" rel="noopener">↗ открыть в артефакте</a><span>рабочая версия, в которой подборку правит Claude.</span></p>`,
};

function build(mode) {
  return shell
    .replace('{{MAP}}', () => cluster)
    .replace('{{ROWS}}', () => rowsFor(mode))
    .replace('{{DEAD0}}', () => JSON.stringify(dead0))
    .replace('{{GEOLEDE}}', () => GEOLEDE)
    .replace('{{GEOFOOT}}', () => GEOFOOT)
    .replace('{{XLINK}}', () => XLINK[mode === 'data' ? 'artifact' : 'site'])
    .replace(/\{\{DATE\}\}/g, DATE)
    .replace(/\{\{N\}\}/g, String(N));
}

const htmlData = build('data');
fs.writeFileSync(path.join(__dirname, 'best-houses9.html'), htmlData);

const htmlUrl = build('url');
const cut = htmlUrl.indexOf('<main>');
const FAVICON = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%8F%A1%3C/text%3E%3C/svg%3E">\n';
const site = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' + FAVICON +
  htmlUrl.slice(0, cut).replace(/<meta name="viewport"[^>]*>\n?/, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n') +
  '</head>\n<body>\n' + htmlUrl.slice(cut) + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(__dirname, '..', 'index.html'), site);

console.log('артефакт:', (htmlData.length / 1048576).toFixed(2), 'МБ | страница Pages:', (site.length / 1048576).toFixed(2), 'МБ');
console.log('лотов:', N, '(готовых', units.length, '+ получистовых', semi.length + ') | точек:', pts.length, '| без координат:', noGeo);
console.log('ячеек промышленности:', IND.length, '| с рыночными кольцами:', [...units].filter(u => mkt(u.id)).length);
console.log('с просм/день:', units.filter(u => u.vpd != null).length, '| без миниатюры (артефакт):', [...units, ...semi].filter(u => !thumbFor(u, 'data')).length);
console.log('двойники:', [...units, ...semi].filter(u => u.dups && u.dups.length).length);
