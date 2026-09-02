// Разбор адреса из заголовка и описания объявления: улица, номер дома, населённый пункт.
// Нужен, чтобы метка на карте стояла по адресу из текста, а не в центре села.
// Важно: \b в JS считает словом только латиницу и цифры, поэтому границы слова
// для кириллицы задаём вручную через NW.

const NW = '(?![А-Яа-яІіЇїЄєҐґA-Za-zʼ0-9])';
// предложения про офис/агентство/контакты — адрес там чужой
const NOISE = /(офіс|офис|агенц|агентств|ріелт|риелт|риэлт|звертайт|обращайт|дзвон[іи]|телефон|viber|вайбер|консультац|компані|відділенн|нотаріус|наш\w* адрес)/i;
// ориентир («15 км від міста Рівне»), а не адрес объекта
const REF = /(від|до|біля|поруч|поблизу|неподалік|близько|км|хвилин|відстан|їхати|доїхати|виїзд|напрямку|траса|дорога|автобус|маршрутк)/i;

const CAP = '[А-ЯІЇЄҐ]';
const LOW = "[а-яіїєґʼ'’a-z]";
const WORD = CAP + LOW + '{2,22}';
// «г.» намеренно не берём: в украинских текстах это чаще инициал («ім. Т. Г. Шевченка»), чем город
const PFX_NP = '(?:[Сс]\\.|[Сс]-ще|[Сс]мт\\.?|[Мм]\\.|[Сс]ел[іоа]|[Сс]елищ[іеa]?|[Сс]елища|[Мм]істечк\\w*|[Мм]іст[іоа]|[Мм]іста|[Пп]гт|[Дд]ер\\.|[Пп]ос\\.)';
const PFX_ST = '(?:[Вв]ул\\.|[Вв]улиц[іія]|[Уу]л\\.|[Уу]лиц[аеы]|[Пп]росп\\.|[Пп]роспект|[Пп]ров\\.|[Пп]ровул\\w*|[Бб]ульв\\w*|[Бб]-р|[Нн]аб\\.)';
const RE_NP = new RegExp('(?:^|[\\s,.:;(«"])(' + PFX_NP + ')\\s*(' + WORD + '(?:[\\s\\-]' + WORD + ')?)', 'g');
const RE_STREET = new RegExp('(?:^|[\\s,.:;(«"])' + PFX_ST + '\\s*([А-ЯІЇЄҐ][^,.;:!?\\n()]{1,32}?)(?=\\s*(?:,|\\.|;|:|\\)|$|\\n|буд|б\\.|\\d))', 'g');
const RE_HOUSE = new RegExp('(?:буд\\.?|будинок|б\\.|№)\\s*(\\d{1,3}[А-Яа-яA-Za-z]?)' + NW);
const RAION_TAIL = /(ськ|цьк|ск)(ого|ому|ий|а|е)$/i;
const STOP = new Set(['Продам', 'Продаж', 'Продається', 'Терміново', 'Ціна', 'Будинок', 'Квартира',
  'Дом', 'Тел', 'Наш', 'Нашого', 'Продаю', 'Пропоную', 'Знаходиться', 'Розташований', 'Всі', 'Дуже']);
// хвосты, прилипающие к названию улицы
const ST_TAIL = new RegExp('\\s+(?:в|у|на|за|під|м|с|смт|буд|будинок|біля|поряд|поруч|напроти|навпроти|' +
  'район|мікрорайон|поблизу|центр\\w*|вокзал\\w*|місто|міста|загальн\\w*|площ\\w*|квартира|кв|поверх|' +
  'цетр\\w*|Чернівці|Львів|Луцьк|Рівне|Тернопіль|Івано\\S*)' + NW + '.*$', 'i');
// текст объявления приходит с html-обрывками и разделителями строк U+2028/2029
const stripHtml = s => (s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/[\u2028\u2029]/g, '\n').replace(/[ \t]+/g, ' ');

const ABBR = /(?:^|[\s(])(?:[сСмМгГдДтТ]|смт|вул|ул|обл|кв|буд|пров|просп|ім|им|р|с-ще|пгт|тел|прим|пл)\.$/i;
function sentences(text) {
  const parts = (text || '').split(/([\n;•·])|(?<=[.!?])\s+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (/^[\n;•·]$/.test(p)) { out.push(''); continue; }
    const last = out[out.length - 1];
    if (last && ABBR.test(last)) out[out.length - 1] = last + ' ' + p;
    else out.push(p);
  }
  return out.map(s => s.trim()).filter(Boolean);
}
const norm = s => s.replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').replace(/^[\/\-.,\s]+|[\/\-.,\s]+$/g, '').trim();

// у ЛУН в описание попадает хвост вёрстки страницы («Ще 4-кімнатні будинки поруч», названия
// скверов и районов) — адреса оттуда чужие
const TAIL_JUNK = /(Поскаржитися на оголошення|Ще \d+[^\n]{0,40}поруч|Схожі оголошення|Показати телефон)/;
function parseAddr(raw) {
  const cut = String(raw || '').search(TAIL_JUNK);
  const text = stripHtml(cut > 40 ? String(raw).slice(0, cut) : raw);
  const out = { np: [], street: [] };
  for (const s of sentences(text)) {
    for (const m of s.matchAll(RE_NP)) {
      let name = norm(m[2]);
      const parts = name.split(' ');
      if (parts.length === 2 && RAION_TAIL.test(parts[1])) name = parts[0];
      if (STOP.has(name) || name.length < 3) continue;
      const seg = s.slice(0, m.index);
      const before = seg.slice(Math.max(seg.lastIndexOf(String.fromCharCode(44)) + 1, seg.length - 40));
      out.np.push({ name, kind: m[1].toLowerCase().replace(/\.$/, ''), noisy: NOISE.test(s.slice(0, m.index)), ref: REF.test(before) });
    }
    for (const m of s.matchAll(RE_STREET)) {
      const name = norm(m[1]).replace(ST_TAIL, '').trim();
      if (name.length < 3 || /^\d+$/.test(name)) continue;
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
      const h = (after.match(/^[\s,]*(\d{1,3}[А-Яа-яA-Za-z]?)(?![\d])/) || [])[1] || (s.match(RE_HOUSE) || [])[1] || null;
      out.street.push({ name, house: h, noisy: NOISE.test(s.slice(0, m.index)) });
    }
  }
  const uniq = a => [...new Map(a.map(x => [x.name.toLowerCase(), x])).values()];
  out.np = uniq(out.np); out.street = uniq(out.street);
  return out;
}

// Итоговая подсказка для одного лота: улица объекта и н.п., если он назван в тексте.
function addrHint(u) {
  const a = parseAddr([u.title, u.desc].filter(Boolean).join('\n'));
  const st = a.street.filter(x => !x.noisy)[0] || null;
  const np = a.np.filter(x => !x.noisy && !x.ref);
  const village = np.filter(x => /^(с|село|села|селі|селищ|селища|с-ще|смт|пгт)/.test(x.kind));
  const place = village[0] || np[0] || null;
  return {
    street: st ? st.name : null,
    house: st ? st.house : null,
    place: place ? place.name : null,
    placeKind: place ? place.kind : null,
    places: np.map(x => x.name),
  };
}

module.exports = { parseAddr, addrHint, sentences, stripHtml };
