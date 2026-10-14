// เก็บ/โหลดข้อมูล + รูป  (ตั้ง DATA_DIR ให้ชี้ไปที่ดิสก์ถาวรของโฮสต์ ข้อมูลที่แก้ผ่าน /admin จะไม่หายตอน deploy ใหม่)
const fs = require("fs"), path = require("path");
const { strip } = require("./importer");
const root = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;
const dataDir = DATA_DIR ? path.join(DATA_DIR, "data") : path.join(root, "data");
const imgDir = DATA_DIR ? path.join(DATA_DIR, "images") : path.join(root, "public", "images");
const bakDir = path.join(DATA_DIR || root, "backups");
const IMG_EXT = ["jpg", "png", "webp"];
const state = { cards: [], decks: [], elements: {}, byId: new Map(), raw: [] };

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
const writeJSON = (f, obj) => {
  const p = path.join(dataDir, f), t = p + ".tmp";
  fs.writeFileSync(t, JSON.stringify(obj, null, 1) + "\n"); fs.renameSync(t, p);
};

function init() {
  for (const d of [dataDir, imgDir, bakDir]) fs.mkdirSync(d, { recursive: true });
  if (DATA_DIR && !fs.existsSync(path.join(dataDir, "cards.json"))) { // seed ครั้งแรกจากข้อมูลที่มากับโค้ด
    for (const f of ["cards.json", "decks.json", "elements.json"]) fs.copyFileSync(path.join(root, "data", f), path.join(dataDir, f));
    const seed = path.join(root, "public", "images");
    if (fs.existsSync(seed)) for (const f of fs.readdirSync(seed)) fs.copyFileSync(path.join(seed, f), path.join(imgDir, f));
    console.log("seeded DATA_DIR:", DATA_DIR);
  }
  load();
}

function imageMap() {
  const m = new Map();
  for (const f of fs.readdirSync(imgDir)) {
    const mt = f.match(/^(.+)\.(jpg|jpeg|png|webp)$/i); if (!mt) continue;
    m.set(mt[1].toLowerCase(), `/images/${f}?v=${Math.floor(fs.statSync(path.join(imgDir, f)).mtimeMs / 1000)}`);
  }
  return m;
}

function rebuild() {
  const im = imageMap();
  state.cards = state.raw.map((c) => { const o = strip(c), img = im.get(c.id.toLowerCase()); if (img) o.image = img; return o; });
  state.byId = new Map(state.cards.map((c) => [c.id.toLowerCase(), c]));
  state.imgs = im;
}
function load() {
  state.raw = readJSON("cards.json").map(strip);
  state.decks = readJSON("decks.json");
  state.elements = readJSON("elements.json");
  rebuild();
}
const hasImage = (id) => state.imgs.has(id.toLowerCase());

function backup(note) {
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(path.join(bakDir, name), JSON.stringify({ at: new Date().toISOString(), note, cards: state.raw, decks: state.decks }));
  const all = fs.readdirSync(bakDir).filter((f) => /^backup-.*\.json$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - 30)).forEach((f) => fs.unlinkSync(path.join(bakDir, f)));
}
function save({ cards, decks }, note) {
  backup(note);
  if (cards) { state.raw = cards.map(strip); writeJSON("cards.json", state.raw); }
  if (decks) { state.decks = decks; writeJSON("decks.json", decks); }
  rebuild();
}
function listBackups() {
  return fs.readdirSync(bakDir).filter((f) => /^backup-.*\.json$/.test(f)).sort().reverse().map((name) => {
    try { const j = JSON.parse(fs.readFileSync(path.join(bakDir, name), "utf8")); return { name, at: j.at, note: j.note, cards: j.cards.length, decks: j.decks.length }; }
    catch { return { name, broken: true }; }
  });
}
function restore(name) {
  if (!/^backup-[\w.-]+\.json$/.test(name)) throw new Error("bad_name");
  const j = JSON.parse(fs.readFileSync(path.join(bakDir, name), "utf8"));
  save({ cards: j.cards, decks: j.decks }, `restore ${name}`);
}
function saveImage(id, ext, buf) {
  for (const e of [...IMG_EXT, "jpeg"]) { const p = path.join(imgDir, `${id}.${e}`); if (e !== ext && fs.existsSync(p)) fs.unlinkSync(p); }
  fs.writeFileSync(path.join(imgDir, `${id}.${ext}`), buf);
  rebuild();
}
module.exports = { state, init, load, save, hasImage, listBackups, restore, saveImage, imgDir, dataDir, DATA_DIR };
