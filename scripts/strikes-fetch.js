// Полная история публичного превью t.me/s/vanek_nikolaev («Николаевский Ванёк»):
// канал ведёт хронику воздушных тревог, пусков ракет и курсов БпЛА с 17.04.2022.
// Превью отдаёт по 20 сообщений на страницу (?before=<id>), id почти сплошные,
// поэтому историю берём «сеткой» before=N (шаг 20) параллельно и потом добираем дыры.
// Кэш страниц — data/strikes-raw/<N>.html (в .gitignore). Итог: data/strikes-posts.json
const fs = require('fs');
const path = require('path');
const CH = process.env.TG_CH || 'vanek_nikolaev';
const RAW = path.join(__dirname, 'data', 'strikes-raw');
const OUT = path.join(__dirname, 'data', 'strikes-posts.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CONC = +(process.env.CONC || 10);

const unent = s => String(s)
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

function parsePage(html) {
  const out = [];
  for (const c of html.split('<div class="tgme_widget_message ').slice(1)) {
    const post = (c.match(/data-post="[^/"]+\/(\d+)"/) || [])[1];
    const date = (c.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
    // ВАЖНО: превью цитаты лежит в том же классе (js-message_reply_text) и стоит
    // ПЕРЕД телом поста, поэтому «первый подходящий div» — это цитата, а не текст.
    // Берём только js-message_text: иначе вместо поста достаётся обрезанная цитата
    // предыдущего поста, и одно и то же событие считается дважды.
    const body = (c.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
    if (post) out.push({ id: +post, date, text: unent(body).replace(/\n{3,}/g, '\n\n').trim() });
  }
  return out;
}

async function grab(n) {
  const f = path.join(RAW, n + '.html');
  if (fs.existsSync(f) && fs.statSync(f).size > 2000) return fs.readFileSync(f, 'utf8');
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`https://t.me/s/${CH}?before=${n}`, { headers: { 'user-agent': UA, 'accept-language': 'uk,ru;q=0.9' } });
      if (r.status === 429 || r.status >= 500) { await sleep(4000 * (t + 1)); continue; }
      if (!r.ok) return null;
      const h = await r.text();
      fs.writeFileSync(f, h);
      return h;
    } catch { await sleep(2500 * (t + 1)); }
  }
  return null;
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  // верхняя граница: последний id из свежей выдачи
  const top = await (async () => {
    const r = await fetch(`https://t.me/s/${CH}`, { headers: { 'user-agent': UA } });
    const ids = [...(await r.text()).matchAll(/data-post="[^/"]+\/(\d+)"/g)].map(m => +m[1]);
    return Math.max(...ids);
  })();
  console.log('последний пост', top);

  const posts = new Map();
  const targets = [];
  for (let n = top + 20; n > 0; n -= 20) targets.push(n);

  let done = 0, empty = 0;
  const worker = async (list) => {
    for (const n of list) {
      const h = await grab(n);
      if (h) { const ps = parsePage(h); if (!ps.length) empty++; for (const p of ps) posts.set(p.id, p); }
      if (++done % 200 === 0) console.log(`${done}/${targets.length} страниц, постов ${posts.size}`);
    }
  };
  const lanes = Array.from({ length: CONC }, () => []);
  targets.forEach((n, i) => lanes[i % CONC].push(n));
  await Promise.all(lanes.map(worker));
  console.log('страниц пусто:', empty);

  // добор дыр: подряд отсутствующие id длиной 3+ (одиночные — удалённые посты)
  for (let pass = 0; pass < 3; pass++) {
    const have = [...posts.keys()].sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < have.length; i++) {
      if (have[i] - have[i - 1] > 3) for (let n = have[i]; n > have[i - 1]; n -= 20) gaps.push(n);
    }
    const fresh = gaps.filter(n => !fs.existsSync(path.join(RAW, n + '.html')));
    if (!fresh.length) { console.log('дыр нет, проход', pass); break; }
    console.log(`проход ${pass}: добираю ${fresh.length} страниц`);
    const gl = Array.from({ length: CONC }, () => []);
    fresh.forEach((n, i) => gl[i % CONC].push(n));
    await Promise.all(gl.map(async l => { for (const n of l) { const h = await grab(n); if (h) for (const p of parsePage(h)) posts.set(p.id, p); } }));
  }

  const arr = [...posts.values()].sort((a, b) => a.id - b.id);
  const dated = arr.filter(p => p.date);
  fs.writeFileSync(OUT, JSON.stringify({
    channel: CH, fetched: new Date().toISOString().slice(0, 10),
    top, count: arr.length,
    from: dated[0] && dated[0].date, to: dated[dated.length - 1] && dated[dated.length - 1].date,
    posts: arr,
  }));
  console.log(`постов ${arr.length} из ${top} id (${dated[0] && dated[0].date.slice(0,10)} → ${dated[dated.length-1] && dated[dated.length-1].date.slice(0,10)}) →`, OUT);
})();
