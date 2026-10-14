// แปลงตาราง (Excel/CSV) -> การ์ด  โดยจับคู่คอลัมน์ (mapping) ตามที่เลือก
const MAX_FX = 5;
const TYPES = ["Avatar", "Unit", "Spell", "Ultimate"];
const TYPE_ALIAS = { "อวตาร": "Avatar", "ยูนิต": "Unit", "สเปล": "Spell", "อัลติเมท": "Ultimate", "อัลติเมต": "Ultimate" };
const NUM = ["cost", "cri", "atk", "def", "sc"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s_\-().\/:]/g, "");

const FIELDS = [
  { key: "deck", label: "เด็ค/ซีรีส์ (เช่น SD01)", required: true, aliases: ["deck", "เด็ค", "ซีรีส์", "ซีรีย์", "series", "set"] },
  { key: "no", label: "เลขการ์ด (เช่น 001)", required: true, aliases: ["no", "number", "cardno", "เลข", "เลขการ์ด", "เลขที่", "หมายเลข"] },
  { key: "variant", label: "เวอร์ชันพิเศษ (เช่น SR)", aliases: ["variant", "version", "suffix", "เวอร์ชัน"] },
  { key: "name", label: "ชื่อการ์ด", required: true, aliases: ["name", "cardname", "ชื่อ", "ชื่อการ์ด"] },
  { key: "type", label: "ประเภท (Avatar/Unit/Spell/Ultimate)", required: true, aliases: ["type", "cardtype", "ประเภท", "ประเภทการ์ด"] },
  { key: "sub", label: "ประเภทย่อย (เช่น Domain)", aliases: ["sub", "subtype", "ประเภทย่อย"] },
  { key: "element", label: "ธาตุ", aliases: ["element", "ธาตุ"] },
  { key: "rarity", label: "ความหายาก", aliases: ["rarity", "rar", "ความหายาก"] },
  { key: "rotation", label: "Rotation", aliases: ["rotation", "rot", "โรเทชัน"] },
  { key: "artist", label: "นักวาด", aliases: ["artist", "art", "illustrator", "นักวาด"] },
  { key: "cost", label: "Cost", aliases: ["cost", "คอสต์"] },
  { key: "cri", label: "CRI", aliases: ["cri", "crit", "คริ"] },
  { key: "atk", label: "ATK", aliases: ["atk", "attack"] },
  { key: "def", label: "DEF", aliases: ["def", "defense", "defence"] },
  { key: "sc", label: "ค่า Element ของ Spell (sc)", aliases: ["sc", "elementvalue", "ค่าelement", "ค่าธาตุ"] },
  { key: "tribe", label: "เผ่า", aliases: ["tribe", "race", "เผ่า"] },
];
for (let i = 1; i <= MAX_FX; i++) {
  FIELDS.push({ key: `effect${i}_keyword`, label: `เอฟเฟกต์ ${i} – คีย์เวิร์ด`, aliases: [`effect${i}keyword`, `keyword${i}`, `kw${i}`, `คีย์เวิร์ด${i}`] });
  FIELDS.push({ key: `effect${i}_text`, label: `เอฟเฟกต์ ${i} – ข้อความ`, aliases: [`effect${i}text`, `effect${i}`, `เอฟเฟกต์${i}`, `เอฟเฟค${i}`, `ผล${i}`] });
}
FIELDS.push({ key: "flavor", label: "ข้อความท้ายการ์ด (Flavor)", aliases: ["flavor", "flavortext", "fl", "คำพูด", "ข้อความท้ายการ์ด"] });
const COLUMNS = FIELDS.map((f) => f.key);

const DECK_FIELDS = [
  ["id", ["id", "deck", "เด็ค", "รหัส", "รหัสเด็ค"]], ["name", ["name", "ชื่อ", "ชื่อเด็ค"]],
  ["total", ["total", "จำนวน", "จำนวนใบ", "count"]], ["rotation", ["rotation", "rot"]],
  ["element", ["element", "ธาตุ"]], ["rarity", ["rarity", "rar", "ความหายาก"]], ["artist", ["artist", "art", "นักวาด"]],
];

function autoMap(headers) {
  const map = {}, used = new Set();
  const hn = headers.map(norm);
  for (const f of FIELDS) {
    const al = f.aliases.map(norm).concat(norm(f.key));
    const i = hn.findIndex((h, idx) => !used.has(idx) && h && al.includes(h));
    map[f.key] = i; if (i >= 0) used.add(i);
  }
  return map;
}

const blank = (v) => v === "" || v === "-" || v === "—" || v === "–";

function rowsToCards(sheet, mapping, ctx) {
  const errors = [], warns = [], seen = new Set(), cards = [];
  for (const f of FIELDS) if (f.required && !(mapping[f.key] >= 0)) errors.push(`ยังไม่ได้เลือกคอลัมน์สำหรับ "${f.label}"`);
  if (errors.length) return { cards, errors, warns };

  sheet.rows.forEach((row, idx) => {
    const line = sheet.lines[idx];
    const g = (k) => { const i = mapping[k]; return i >= 0 && i != null ? String(row[i] ?? "").trim() : ""; };
    const tag = `แถว ${line} (${g("deck")}-${g("no")} ${g("name")})`;
    const bad = (m) => errors.push(`${tag}: ${m}`);
    const deckId = g("deck"), d = ctx.decks[deckId];
    if (!d) return bad(`ไม่พบเด็ค "${deckId}" (เพิ่มในแท็บ "เด็ค" หรือชีท decks ก่อน)`);
    const name = g("name"); if (!name) return bad("ไม่มีชื่อการ์ด");
    const t = g("type"), type = TYPES.find((x) => x.toLowerCase() === t.toLowerCase()) || TYPE_ALIAS[t];
    if (!type) return bad(`ประเภท "${t}" ต้องเป็น ${TYPES.join("/")}`);
    const noRaw = g("no").replace(/\.0+$/, "");
    if (!/^\d+$/.test(noRaw)) return bad(`เลขการ์ด "${g("no")}" ต้องเป็นตัวเลข`);
    const no = noRaw.padStart(3, "0");
    const variant = g("variant").replace(/\s/g, "");
    if (variant && !/^[A-Za-z0-9]+$/.test(variant)) return bad(`เวอร์ชัน "${variant}" ใช้ได้เฉพาะ A-Z, 0-9`);
    const id = `${deckId}-${no}${variant}`;
    if (seen.has(id)) return bad(`id ซ้ำในไฟล์: ${id}`);
    seen.add(id);

    const c = { id, deck: deckId, no, name, type };
    if (g("sub")) c.sub = g("sub");
    for (const k of ["element", "rarity", "rotation", "artist"]) {
      let v = g(k) || d[k]; if (k === "element" && v) v = v.replace(/^ธาตุ/, "");
      if (v) c[k] = v;
    }
    if (c.element && !ctx.elements[c.element]) warns.push(`${id}: ธาตุ "${c.element}" ยังไม่มีในระบบ (ไอคอนจะไม่แสดง)`);
    for (const k of NUM) {
      const v = g(k); if (blank(v)) continue;
      if (isNaN(Number(v))) return bad(`${k} "${v}" ไม่ใช่ตัวเลข`);
      c[k] = Number(v);
    }
    if (g("tribe")) c.tribe = g("tribe");
    c.effects = [];
    for (let i = 1; i <= MAX_FX; i++) {
      const kw = g(`effect${i}_keyword`), tx = g(`effect${i}_text`);
      if (tx) c.effects.push({ keyword: kw, text: tx });
      else if (kw) warns.push(`${id}: เอฟเฟกต์ ${i} มีคีย์เวิร์ดแต่ไม่มีข้อความ (ข้าม)`);
    }
    if (g("flavor")) c.flavor = g("flavor");
    if (!ctx.hasImage(id)) warns.push(`${id}: ยังไม่มีรูป (อัปโหลดได้ในแท็บ "รูปภาพ")`);
    cards.push(c);
  });
  return { cards, errors, warns };
}

function parseDecks(sheet) {
  const hn = sheet.headers.map(norm), errors = [], decks = [], col = {};
  for (const [k, al] of DECK_FIELDS) col[k] = hn.findIndex((h) => al.map(norm).includes(h));
  if (col.id < 0) return { decks, errors: ['ชีท decks ต้องมีคอลัมน์ "id"'] };
  sheet.rows.forEach((row, idx) => {
    const g = (k) => (col[k] >= 0 ? String(row[col[k]] ?? "").trim() : "");
    const id = g("id"); if (!id) return;
    const d = { id };
    for (const k of ["name", "rotation", "element", "rarity", "artist"]) if (g(k)) d[k] = g(k);
    if (g("total")) { const n = Number(g("total")); if (isNaN(n)) { errors.push(`ชีท decks แถว ${sheet.lines[idx]}: total "${g("total")}" ไม่ใช่ตัวเลข`); return; } d.total = n; }
    decks.push(d);
  });
  return { decks, errors };
}

const strip = (c) => { const { image, imageUrl, ...r } = c; return r; };
function mergeCards(existing, incoming, replace) {
  const m = new Map((replace ? [] : existing).map((c) => [c.id, strip(c)]));
  const changes = []; let added = 0, updated = 0, same = 0;
  for (const c of incoming) {
    const old = m.get(c.id);
    const st = !old ? "new" : JSON.stringify(old) === JSON.stringify(c) ? "same" : "updated";
    st === "new" ? added++ : st === "updated" ? updated++ : same++;
    changes.push({ id: c.id, name: c.name, status: st });
    m.set(c.id, c);
  }
  const keep = new Set(incoming.map((c) => c.id));
  const removed = replace ? existing.filter((c) => !keep.has(c.id)).length : 0;
  return { result: [...m.values()].sort((a, b) => a.id.localeCompare(b.id)), added, updated, same, removed, changes };
}

function mergeDecks(existing, incoming, replace) {
  const m = new Map((replace && incoming.length ? [] : existing).map((d) => [d.id, d]));
  for (const d of incoming) m.set(d.id, { ...(m.get(d.id) || {}), ...d });
  return [...m.values()].map((d) => ({ name: d.id, ...d }));
}

module.exports = { FIELDS, COLUMNS, MAX_FX, TYPES, norm, autoMap, rowsToCards, parseDecks, mergeCards, mergeDecks, strip };
