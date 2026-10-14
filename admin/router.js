// หลังบ้าน /admin  (ต้องตั้งตัวแปร ADMIN_PASSWORD ไม่งั้นจะปิดการใช้งาน)
const path = require("path"), crypto = require("crypto");
const express = require("express"), multer = require("multer"), rateLimit = require("express-rate-limit");
const store = require("../lib/store"), imp = require("../lib/importer"), xl = require("../lib/xlsx");

const PASS = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.ADMIN_SECRET || crypto.createHash("sha256").update("cardapi:" + PASS).digest("hex");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const sign = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("hex");
const mkToken = () => { const exp = Date.now() + 12 * 3600e3; return `${exp}.${sign(String(exp))}`; };
const okToken = (t) => {
  if (!t) return false; const [exp, sig] = t.split(".");
  if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((s) => s.trim()).filter(Boolean)
  .map((s) => { const i = s.indexOf("="); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
const S = store.state;

const router = express.Router();
router.use((_req, res, next) => { res.set({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" }); next(); });
router.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const api = express.Router();
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 101 } });

api.get("/me", (req, res) => res.json({ enabled: !!PASS, authed: !!PASS && okToken(cookies(req).adm) }));
api.post("/login", rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: "ลองผิดบ่อยเกินไป รอ 15 นาที" } }), (req, res) => {
  if (!PASS) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD บนเซิร์ฟเวอร์" });
  if (!crypto.timingSafeEqual(sha(req.body?.password ?? ""), sha(PASS))) return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  res.cookie("adm", mkToken(), { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/admin", maxAge: 12 * 3600e3 });
  res.json({ ok: true });
});
api.post("/logout", (_req, res) => { res.clearCookie("adm", { path: "/admin" }); res.json({ ok: true }); });

// ---- ต้องล็อกอินตั้งแต่ตรงนี้ ----
api.use((req, res, next) => {
  if (!PASS || !okToken(cookies(req).adm)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "GET" && req.get("x-admin") !== "1") return res.status(403).json({ error: "bad_request" });
  next();
});

api.get("/cards", (_req, res) => res.json({ data: S.cards, decks: S.decks }));
// เพิ่ม/แก้ไขการ์ดทีละใบจากฟอร์ม โดยไม่ต้องใช้ Excel
api.post("/cards", up.single("image"), (req, res) => {
  try {
    const b = req.body || {};
    const deck = String(b.deck || "").trim();
    const noRaw = String(b.no || "").trim();
    const variant = String(b.variant || "").trim();
    const name = String(b.name || "").trim();
    const typeRaw = String(b.type || "").trim();
    const types = ["Avatar", "Unit", "Spell", "Ultimate"];
    const typeAlias = { "อวตาร": "Avatar", "ยูนิต": "Unit", "สเปล": "Spell", "อัลติเมท": "Ultimate", "อัลติเมต": "Ultimate" };
    const type = types.find((x) => x.toLowerCase() === typeRaw.toLowerCase()) || typeAlias[typeRaw];
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(deck)) return res.status(400).json({ error: "เด็ค/ซีรีส์ใช้ได้เฉพาะ A–Z, 0–9, - และ _ (ไม่เกิน 40 ตัว)" });
    if (!/^\d{1,4}$/.test(noRaw)) return res.status(400).json({ error: "เลขการ์ดต้องเป็นตัวเลข 1–4 หลัก เช่น 001" });
    if (variant && !/^[A-Za-z0-9]+$/.test(variant)) return res.status(400).json({ error: "เวอร์ชันพิเศษใช้ได้เฉพาะ A–Z และ 0–9 เช่น SR" });
    if (!name) return res.status(400).json({ error: "กรุณากรอกชื่อการ์ด" });
    if (!type) return res.status(400).json({ error: "กรุณาเลือกประเภทการ์ด" });
    const no = noRaw.padStart(3, "0"), id = `${deck}-${no}${variant}`;
    const old = S.raw.find((c) => c.id.toLowerCase() === id.toLowerCase());
    if (old) return res.status(409).json({ error: `รหัส ${id} มีอยู่แล้ว หากต้องการแก้ไข ให้ใช้ Excel นำเข้าทับหรือแก้ข้อมูลผ่านวิธีที่รองรับ` });
    const card = { id, deck, no, name, type };
    for (const k of ["sub", "element", "rarity", "rotation", "artist", "tribe", "flavor"]) {
      const v = String(b[k] || "").trim(); if (v) card[k] = v;
    }
    for (const k of ["cost", "cri", "atk", "def", "sc"]) {
      const v = String(b[k] ?? "").trim();
      if (v !== "") { if (!Number.isFinite(Number(v))) return res.status(400).json({ error: `${k.toUpperCase()} ต้องเป็นตัวเลข` }); card[k] = Number(v); }
    }
    card.effects = [];
    for (let i = 1; i <= 5; i++) {
      const keyword = String(b[`effect${i}_keyword`] || "").trim();
      const text = String(b[`effect${i}_text`] || "").trim();
      if (text) card.effects.push({ keyword, text });
      else if (keyword) return res.status(400).json({ error: `เอฟเฟกต์ ${i}: ใส่ข้อความเอฟเฟกต์ด้วย หรือเอาคีย์เวิร์ดออก` });
    }
    let image = null;
    if (req.file) {
      if (req.file.size > 5 * 1024 * 1024) return res.status(400).json({ error: "รูปต้องมีขนาดไม่เกิน 5MB" });
      const ext = magic(req.file.buffer);
      if (!ext) return res.status(400).json({ error: "ไฟล์รูปไม่ถูกต้อง รองรับ JPG, PNG และ WEBP" });
      image = { ext, buffer: req.file.buffer };
    }
    const merged = imp.mergeCards(S.raw, [card], false);
    const decks = S.decks.some((d) => d.id.toLowerCase() === deck.toLowerCase())
      ? undefined
      : [...S.decks, { id: deck, name: deck }].sort((a, b) => a.id.localeCompare(b.id));
    store.save({ cards: merged.result, decks }, `manual add ${id}`);
    if (image) store.saveImage(id, image.ext, image.buffer);
    res.json({ ok: true, card: S.byId.get(id.toLowerCase()), imageSaved: !!image });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

api.delete("/cards/:id", (req, res) => {
  const id = req.params.id.toLowerCase();
  if (!S.raw.some((c) => c.id.toLowerCase() === id)) return res.status(404).json({ error: "ไม่พบการ์ด" });
  store.save({ cards: S.raw.filter((c) => c.id.toLowerCase() !== id) }, `delete ${req.params.id}`);
  res.json({ ok: true });
});

api.put("/decks/:id", (req, res) => {
  const b = req.body || {}, id = req.params.id;
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) return res.status(400).json({ error: "id เด็คใช้ได้เฉพาะ A-Z 0-9 _ -" });
  const d = { id, name: String(b.name || id).slice(0, 100) };
  if (b.total !== "" && b.total != null) { if (isNaN(Number(b.total))) return res.status(400).json({ error: "total ต้องเป็นตัวเลข" }); d.total = Number(b.total); }
  for (const k of ["rotation", "element", "rarity", "artist"]) if (b[k]) d[k] = String(b[k]).slice(0, 100);
  store.save({ decks: [...S.decks.filter((x) => x.id !== id), d].sort((a, b) => a.id.localeCompare(b.id)) }, `deck ${id}`);
  res.json({ ok: true });
});
api.delete("/decks/:id", (req, res) => {
  if (S.raw.some((c) => c.deck === req.params.id)) return res.status(409).json({ error: "ยังมีการ์ดในเด็คนี้ ลบการ์ดก่อน" });
  store.save({ decks: S.decks.filter((x) => x.id !== req.params.id) }, `delete deck ${req.params.id}`);
  res.json({ ok: true });
});

// ---- Excel ----
api.get("/template.xlsx", async (_req, res) => {
  const buf = await xl.build({ cards: [], decks: S.decks });
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="cards-template.xlsx"' }).send(buf);
});
api.get("/export.xlsx", async (_req, res) => {
  const buf = await xl.build({ cards: S.raw, decks: S.decks });
  res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="cards-current.xlsx"' }).send(buf);
});

// ขั้นที่ 1: อ่านไฟล์ -> ส่งหัวคอลัมน์ + ข้อเสนอการจับคู่
api.post("/import/inspect", up.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "ยังไม่ได้เลือกไฟล์" });
    const book = await xl.readBook(req.file.buffer, req.file.originalname);
    if (!book.sheets.length) return res.status(400).json({ error: "ไฟล์ว่างเปล่า" });
    const sheets = book.sheets.map((s) => ({ name: s.name, headers: s.headers, rowCount: s.rows.length, sample: s.rows.slice(0, 3), mapping: imp.autoMap(s.headers) }));
    const def = sheets.find((s) => s.name.toLowerCase() === "cards") || sheets.find((s) => !["decks", "วิธีใช้"].includes(s.name.toLowerCase())) || sheets[0];
    res.json({ fields: imp.FIELDS.map(({ key, label, required }) => ({ key, label, required: !!required })), sheets, defaultSheet: def.name });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ขั้นที่ 2: dry=1 ตรวจอย่างเดียว / dry=0 บันทึกจริง
api.post("/import/run", up.fields([{ name: "file", maxCount: 1 }, { name: "images", maxCount: 100 }]), async (req, res) => {
  try {
    const excelFile = req.files?.file?.[0];
    const imageFiles = req.files?.images || [];
    if (!excelFile) return res.status(400).json({ error: "ยังไม่ได้เลือกไฟล์ Excel/CSV" });
    const dry = req.body.dry !== "0", replace = req.body.mode === "replace";
    const mapping = JSON.parse(req.body.mapping || "{}");
    const book = await xl.readBook(excelFile.buffer, excelFile.originalname);
    const sheet = book.sheets.find((s) => s.name === req.body.sheet) || book.sheets[0];
    if (!sheet) return res.status(400).json({ error: "ไม่พบชีทที่เลือก" });

    const errors = [], warns = [];
    const imageChecks = [], imageById = new Map();
    for (const f of imageFiles) {
      const name = Buffer.from(f.originalname, "latin1").toString("utf8");
      const mt = name.match(/^([A-Za-z0-9][A-Za-z0-9_-]{0,40})\.(jpe?g|png|webp)$/i);
      if (!mt) { errors.push(`รูป "${name}": ชื่อไฟล์ต้องตรงกับ id การ์ด เช่น SD04-001.jpg`); continue; }
      if (f.size > 5 * 1024 * 1024) { errors.push(`รูป "${name}": ไฟล์ใหญ่เกิน 5MB`); continue; }
      const ext = magic(f.buffer);
      if (!ext) { errors.push(`รูป "${name}": เนื้อหาไฟล์ไม่ใช่รูป JPG/PNG/WEBP ที่รองรับ`); continue; }
      const id = mt[1], key = id.toLowerCase();
      if (imageById.has(key)) { errors.push(`มีรูปซ้ำสำหรับ id ${id}`); continue; }
      imageById.set(key, { id, ext, buffer: f.buffer, name });
      imageChecks.push({ file: name, id, ext });
    }
    let decks = S.decks;
    const dsheet = book.sheets.find((s) => s !== sheet && ["decks", "deck", "เด็ค"].includes(s.name.toLowerCase()));
    let deckInfo = null;
    if (dsheet) {
      const pd = imp.parseDecks(dsheet); errors.push(...pd.errors);
      decks = imp.mergeDecks(S.decks, pd.decks, replace);
      deckInfo = { fromSheet: dsheet.name, count: pd.decks.length };
    }
    const incomingIds = new Set(imageById.keys());
    const r = imp.rowsToCards(sheet, mapping, { decks: Object.fromEntries(decks.map((d) => [d.id, d])), elements: S.elements, hasImage: (id) => store.hasImage(id) || incomingIds.has(String(id).toLowerCase()) });
    errors.push(...r.errors); warns.push(...r.warns);
    const importedIds = new Set(r.cards.map((c) => c.id.toLowerCase()));
    const knownIds = new Set([...S.raw.map((c) => c.id.toLowerCase()), ...importedIds]);
    const matchedImages = imageChecks.filter((im) => knownIds.has(im.id.toLowerCase()));
    const unmatchedImages = imageChecks.filter((im) => !knownIds.has(im.id.toLowerCase()));
    if (unmatchedImages.length) warns.push(...unmatchedImages.map((im) => `รูป ${im.file}: ไม่พบ id นี้ในข้อมูลการ์ดที่จะนำเข้าหรือในระบบ รูปนี้จะไม่ถูกบันทึก`));
    if (errors.length) return res.json({ ok: false, errors, warns, images: { total: imageFiles.length, matched: matchedImages, unmatched: unmatchedImages } });

    const m = imp.mergeCards(S.raw, r.cards, replace);
    if (!dry) {
      store.save({ cards: m.result, decks: dsheet ? decks : undefined }, `import ${excelFile.originalname}${replace ? " (replace)" : ""}`);
      for (const im of matchedImages) store.saveImage(im.id, im.ext, im.buffer);
    }
    res.json({ ok: true, dry, stats: { added: m.added, updated: m.updated, same: m.same, removed: m.removed, total: m.result.length },
      images: { total: imageFiles.length, matched: matchedImages.map(({ file, id, ext }) => ({ file, id, ext })), unmatched: unmatchedImages },
      deckInfo, warns: warns.slice(0, 200), changes: m.changes.filter((c) => c.status !== "same").slice(0, 300) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- รูป ----
const magic = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg"
  : b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? "png"
  : b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" ? "webp" : null);
api.post("/images", up.array("files", 100), (req, res) => {
  const out = (req.files || []).map((f) => {
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    const mt = name.match(/^([A-Za-z0-9][A-Za-z0-9_-]{0,40})\.(jpe?g|png|webp)$/i);
    if (!mt) return { file: name, ok: false, error: "ชื่อไฟล์ต้องเป็น <id>.jpg เช่น SD04-001.jpg" };
    if (f.size > 5 * 1024 * 1024) return { file: name, ok: false, error: "ไฟล์ใหญ่เกิน 5MB" };
    const ext = magic(f.buffer); if (!ext) return { file: name, ok: false, error: "ไม่ใช่ไฟล์รูป jpg/png/webp" };
    store.saveImage(mt[1], ext, f.buffer);
    return { file: name, ok: true, id: mt[1], saved: `${mt[1]}.${ext}`, hasCard: S.byId.has(mt[1].toLowerCase()) };
  });
  res.json({ results: out });
});

// ---- สำรอง/กู้คืน ----
api.get("/backups", (_req, res) => res.json({ data: store.listBackups() }));
api.post("/backups/restore", (req, res) => {
  try { store.restore(String(req.body?.name || "")); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: "กู้คืนไม่สำเร็จ" }); }
});

api.use((err, _req, res, _next) => res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "ไฟล์ใหญ่เกิน 10MB" : err.message }));
router.use("/api", api);
module.exports = router;
