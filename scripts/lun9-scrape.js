// ЛУН по трём новым городам (Хмельницкий, Житомир, Винница): выдача → нормализация →
// страницы объявлений (фото и точные параметры). Всё через реальный браузер (br, CDP),
// с паузами. robots.txt ЛУНа закрывает URL с параметрами — сбор в браузере по просьбе
// покупателя, как и прежние сборы каталога.
// → data/lun9-raw.json, data/lun9-clean.json, data/lun9-details.json
const fs = require('fs');
const path = require('path');
const { connect } = require('C:/Users/xetr11/AppData/Local/Temp/claude/c--Users-xetr11-Documents-New-folder/5e19b764-3f94-4fb8-8c59-b1d354783282/scratchpad/cdp.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = path.join(__dirname, 'data') + path.sep;
const RAW = D + 'lun9-raw.json', CLEAN = D + 'lun9-clean.json', DET = D + 'lun9-details.json';
const PRICE = 'price_min=29000&price_max=41000&currency=USD';
const CITIES = [['khmelnytskyi', 'Хмельницький'], ['zhytomyr', 'Житомир'], ['vinnytsia', 'Вінниця']];
const KINDS = [['houses', 'house'], ['flats', 'flat']];

const EXTRACT = `(() => {
  const items = [...document.querySelectorAll('[class*="RealtiesLayout_resultsItem"], [class*="__resultsItem"]')];
  const out = [];
  for (const e of items) {
    if (e.querySelector('a[href*="/new/"]')) continue;
    const btn = e.querySelector('[data-event-label="goto_ad_page"], [data-event-options]');
    const opts = btn ? (btn.getAttribute('data-event-options') || '') : '';
    const pid = (opts.match(/page_id:(\\d+)/) || [])[1] || null;
    const site = (opts.match(/site:([^|]+)/) || [])[1] || null;
    if (!pid) continue;
    const txt = (e.innerText || '').replace(/\\u00a0/g, ' ');
    const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
    const cityA = e.querySelector('[data-event-label="city_click"]');
    const districtA = e.querySelector('[data-event-label="region_district_click"]');
    const imgs = [...e.querySelectorAll('img')].map(i => i.getAttribute('src') || i.getAttribute('data-src')).filter(Boolean);
    out.push({ pid, site,
      priceTxt: lines.find(l => /^\\$/.test(l)) || '', ppmTxt: lines.find(l => /\\$\\/м²/.test(l)) || '',
      loc: cityA ? cityA.textContent.trim() : null,
      district: districtA ? districtA.textContent.trim() : null,
      lines: lines.slice(0, 12), photos: [...new Set(imgs)].slice(0, 3),
      noCommission: /без комісії/i.test(txt) });
  }
  return JSON.stringify({ items: out,
    pages: [...document.querySelectorAll('[class*="agination"] a, [class*="agination"] button')].map(x => (x.innerText || '').trim()).filter(t => /^\\d+$/.test(t)).map(Number) });
})()`;

const parsePrice = t => { const m = String(t).replace(/\s/g, '').match(/\$([\d.,]+)(тис|млн)?/i); if (!m) return null; let v = parseFloat(m[1].replace(',', '.')); if (/тис/i.test(m[2] || '')) v *= 1e3; if (/млн/i.test(m[2] || '')) v *= 1e6; return Math.round(v); };
const parsePpm = t => { const m = String(t).replace(/\s/g, '').match(/([\d.,]+)\$\/м²/); return m ? Math.round(parseFloat(m[1].replace(',', '.'))) : null; };

const DETAIL = String.raw`(() => {
  const lines = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const after = lines.slice(lines.findIndex(l => /^\$\s?[\d\s]+$/.test(l)));
  const grab = re => { for (const l of after) { const m = l.match(re); if (m) return m[1]; } return null; };
  const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src') || i.getAttribute('data-src') || '').filter(s => /market-images\.lunstatic\.net/.test(s));
  const txt = document.body.innerText;
  return JSON.stringify({
    title: document.title,
    area: grab(/^([\d.,]+)\s*м²$/), rooms: grab(/^(\d)\s*к[іi]мнат/),
    floor: grab(/^(\d{1,2})\s*поверх$/), floors: grab(/поверх[іi]в?\s*(?:у\s*будинку)?\D{0,4}(\d{1,2})/i),
    land: grab(/^([\d.,]+)\s*сот/) || (txt.match(/([\d.,]+)\s*сот/) || [])[1] || null,
    locality: after[2] && after[2].length < 40 ? after[2] : null,
    walls: (txt.match(/Ст[іi]ни[^\n]{0,3}\n([^\n]{2,25})/) || [])[1] || null,
    heating: (txt.match(/Опалення[^\n]{0,3}\n([^\n]{2,30})/) || [])[1] || null,
    year: (txt.match(/Р[іi]к побудови[^\n]{0,3}\n?\s*(\d{4})/) || [])[1] || null,
    photos: [...new Set(imgs)].slice(0, 4),
    gone: /оголошення (знято|неактивне)|вже продано|не актуальне/i.test(txt),
    desc: (txt.match(/Опис[^\n]{0,3}\n([\s\S]{40,600})/) || [])[1] || null });
})()`;

(async () => {
  fs.mkdirSync(D, { recursive: true });
  const store = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, 'utf8')) : { items: {}, done: {} };
  const b = await connect();

  /* 1. выдача */
  for (const [slug, cityName] of CITIES) {
    for (const [p, kind] of KINDS) {
      const key = slug + '|' + p;
      if (store.done[key]) { console.log('уже собрано:', key); continue; }
      let page = 1, maxPage = 1, seen = -1;
      while (page <= maxPage && page <= 12) {
        const url = `https://lun.ua/sale/${slug}/${p}?${PRICE}` + (page > 1 ? `&page=${page}` : '');
        await b.goto(url, 3200);
        await b.eval('scrollTo(0, document.body.scrollHeight/2)');
        await sleep(900);
        let data;
        try { data = JSON.parse(await b.eval(EXTRACT)); } catch { data = null; }
        if (!data) { console.log(`  ${key} стр.${page}: не прочитано`); break; }
        if (page === 1 && data.pages && data.pages.length) maxPage = Math.max(...data.pages);
        let fresh = 0;
        for (const it of data.items) {
          const price = parsePrice(it.priceTxt), ppm = parsePpm(it.ppmTxt);
          const id = 'LUN' + it.pid;
          if (!store.items[id]) fresh++;
          store.items[id] = { id, pid: it.pid, src: 'lun', srcSite: it.site, kind,
            link: 'https://lun.ua/realty/' + it.pid, price, ppm,
            area: price && ppm ? Math.round(price / ppm) : null,
            loc: it.loc, district: it.district, cityGroup: cityName,
            title: (it.lines.find(l => l.length > 25 && !/^\$/.test(l)) || it.lines[it.lines.length - 1] || '').slice(0, 120),
            desc: it.lines.filter(l => l.length > 25).join(' ').slice(0, 700),
            photos: it.photos, noCommission: it.noCommission };
        }
        console.log(`  ${key} стр.${page}/${maxPage}: карточек ${data.items.length}, новых ${fresh}`);
        if (!data.items.length || (seen === data.items.length && fresh === 0)) break;
        seen = data.items.length; page++;
        fs.writeFileSync(RAW, JSON.stringify(store));
        await sleep(1400);
      }
      store.done[key] = true;
      fs.writeFileSync(RAW, JSON.stringify(store));
    }
  }

  /* 2. нормализация (как lun-normalize.js) */
  const areaFromText = t => { const m = String(t || '').match(/(?:загальн[а-яіїєґ]*\s*площ[а-яіїєґ]*|площею|площа\s*будинку|загальна)\D{0,12}(\d{2,3}(?:[.,]\d)?)/i); return m ? parseFloat(m[1].replace(',', '.')) : null; };
  const roomsOf = t => {
    for (const [re, n] of [[/(одно|1[\s-]?)к[іi]мнатн/i, 1], [/(дво|2[\s-]?)к[іi]мнатн/i, 2], [/(три|3[\s-]?)к[іi]мнатн/i, 3], [/(чотири|4[\s-]?)к[іi]мнатн/i, 4], [/(п.ять|5[\s-]?)к[іi]мнатн/i, 5]]) if (re.test(t)) return n;
    const m = String(t).match(/(?<![\d.,])([1-6])\s*(?:-|\s)?\s*к[іi]мнат/i);
    return m ? +m[1] : null;
  };
  const clean = Object.values(store.items).map(x => {
    const fromPpm = x.price && x.ppm ? Math.round(x.price / x.ppm) : null;
    const fromText = areaFromText(x.desc + ' ' + x.title);
    let area = fromPpm;
    if (fromText && fromPpm && Math.abs(fromText - fromPpm) / fromPpm < 0.15) area = fromText;
    else if (fromText && !fromPpm) area = fromText;
    const landM = String(x.desc + ' ' + x.title).match(/(\d{1,3}(?:[.,]\d)?)\s*сот/i);
    return { ...x, area, rooms: roomsOf(x.desc + ' ' + x.title),
      landSot: landM ? parseFloat(landM[1].replace(',', '.')) : null,
      unfinished: /недобудован|незаверш|під чистов|коробка|без даху|стадії будівництва|на етапі буд/i.test(x.desc + ' ' + x.title) };
  });
  fs.writeFileSync(CLEAN, JSON.stringify(clean));
  console.log('нормализовано:', clean.length);

  /* 3. страницы объявлений — фото и точные параметры */
  const cache = fs.existsSync(DET) ? JSON.parse(fs.readFileSync(DET, 'utf8')) : {};
  const targets = clean.filter(x => !x.unfinished && x.price >= 29000 && x.price <= 41000 &&
    (x.kind === 'house' ? (x.area || 0) >= 55 : (x.area || 0) >= 45));
  const todo = targets.filter(x => !cache[x.id]);
  console.log('страниц объявлений к загрузке:', todo.length, 'из', targets.length);
  let n = 0;
  for (const u of todo) {
    n++;
    try {
      await b.goto(u.link, 1200);
      await b.waitFor(String.raw`/\$\s?[\d\s]{4,}/.test(document.body.innerText) && document.querySelectorAll('img').length > 3`, 14000, 500);
      await b.eval('scrollBy(0, 600)');
      await sleep(700);
      let parsed = JSON.parse(await b.eval(DETAIL));
      if (!parsed.area && !parsed.photos.length) { await sleep(2500); parsed = JSON.parse(await b.eval(DETAIL)); }
      cache[u.id] = parsed;
    } catch (e) { cache[u.id] = { error: String(e.message).slice(0, 80) }; }
    if (n % 5 === 0 || n === todo.length) {
      fs.writeFileSync(DET, JSON.stringify(cache));
      console.log(`  [${n}/${todo.length}] ${u.id}`);
    }
    await sleep(600);
  }
  fs.writeFileSync(DET, JSON.stringify(cache));
  b.close();
  const det = Object.values(cache);
  console.log('детали готовы:', det.length, '| с фото:', det.filter(x => (x.photos || []).length).length, '| снятых:', det.filter(x => x.gone).length);
})();
