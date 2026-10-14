const ExcelJS = require("exceljs");
const { parseCSV } = require("./csv");
const { COLUMNS, MAX_FX, TYPES } = require("./importer");

const toSheet = (name, rows, lines) => ({
  name, headers: rows[0].map((h, i) => h || `(คอลัมน์ ${i + 1})`), rows: rows.slice(1), lines: lines.slice(1),
});

async function readBook(buf, filename) {
  if (/\.csv$/i.test(filename)) {
    const all = parseCSV(buf.toString("utf8")).map((r, i) => ({ r: r.map((c) => c.trim()), n: i + 1 })).filter((x) => x.r.some(Boolean));
    if (!all.length) return { sheets: [] };
    return { sheets: [toSheet("csv", all.map((x) => x.r), all.map((x) => x.n))] };
  }
  if (!/\.xlsx$/i.test(filename)) throw new Error("รองรับเฉพาะไฟล์ .xlsx หรือ .csv (ถ้าเป็น .xls ให้ Save As เป็น .xlsx ก่อน)");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [], lines = [], cols = ws.actualColumnCount || ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const a = []; for (let c = 1; c <= cols; c++) a.push(String(row.getCell(c).text ?? "").trim());
      if (a.some(Boolean)) { rows.push(a); lines.push(n); }
    });
    if (rows.length) sheets.push(toSheet(ws.name, rows, lines));
  });
  return { sheets };
}

function cardRow(c, deck = {}) {
  const r = { ...c };
  const base = `${c.deck}-${c.no}`;
  r.variant = c.id.startsWith(base) ? c.id.slice(base.length) : "";
  for (const k of ["element", "rarity", "rotation", "artist"]) if (r[k] === deck[k]) r[k] = ""; // เท่าค่าเริ่มต้นเด็ค -> เว้นว่าง
  (c.effects || []).slice(0, MAX_FX).forEach((e, i) => { r[`effect${i + 1}_keyword`] = e.keyword; r[`effect${i + 1}_text`] = e.text; });
  return r;
}

async function build({ cards = [], decks = [] }) {
  const wb = new ExcelJS.Workbook();
  const head = (ws) => { const r = ws.getRow(1); r.font = { bold: true }; r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE08A" } }; ws.views = [{ state: "frozen", ySplit: 1 }]; };

  const ws = wb.addWorksheet("cards");
  ws.columns = COLUMNS.map((k) => ({ header: k, key: k, width: k.endsWith("_text") || k === "flavor" ? 44 : k === "name" ? 26 : 12 }));
  head(ws);
  const dm = Object.fromEntries(decks.map((d) => [d.id, d]));
  for (const c of cards) {
    const row = ws.addRow(COLUMNS.map((k) => cardRow(c, dm[c.deck])[k] ?? ""));
    for (const k of ["no", "variant"]) row.getCell(COLUMNS.indexOf(k) + 1).numFmt = "@"; // กัน Excel ตัดเลข 001 เป็น 1
  }
  const tcol = COLUMNS.indexOf("type") + 1;
  for (let r = 2; r <= 1000; r++) ws.getCell(r, tcol).dataValidation = { type: "list", allowBlank: true, formulae: [`"${TYPES.join(",")}"`] };
  ws.getColumn(COLUMNS.indexOf("no") + 1).numFmt = "@";

  const wd = wb.addWorksheet("decks");
  wd.columns = ["id", "name", "total", "rotation", "element", "rarity", "artist"].map((k) => ({ header: k, key: k, width: k === "name" ? 30 : 14 }));
  head(wd); decks.forEach((d) => wd.addRow(d));

  const wi = wb.addWorksheet("วิธีใช้");
  wi.getColumn(1).width = 110;
  [
    "ชีท cards = การ์ดทั้งหมด (1 แถว = 1 ใบ)  ·  ชีท decks = ข้อมูลเด็ค/ซีรีส์ (ไม่ใส่ก็ได้ ถ้าเด็คมีอยู่แล้วในระบบ)",
    "คอลัมน์ที่จำเป็น: deck, no, name, type   ·   type = Avatar / Unit / Spell / Ultimate",
    "element, rarity, rotation, artist: เว้นว่างได้ ระบบจะใช้ค่าเริ่มต้นของเด็ค",
    "การ์ดเวอร์ชันพิเศษ: ใส่ SR ในคอลัมน์ variant (id จะเป็น เช่น SD03-009SR)",
    "ชื่อคอลัมน์ไม่ต้องตรงเป๊ะ — ที่หน้า /admin จะมีขั้นตอนจับคู่คอลัมน์ให้เลือกเอง",
    "รูปการ์ดอัปโหลดแยกที่แท็บ \"รูปภาพ\" โดยตั้งชื่อไฟล์ตาม id เช่น SD04-001.jpg",
  ].forEach((t) => wi.addRow([t]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
module.exports = { readBook, build };
