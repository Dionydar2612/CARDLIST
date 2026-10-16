// Card Battle – Card Browser + Public API
const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const store = require("./lib/store");
store.init();
const S = store.state; // ข้อมูลล่าสุดเสมอ (แก้ผ่าน /admin แล้วมีผลทันที)

const PORT = process.env.PORT || 3000;
const costOf = (c) => c.cost ?? c.sc ?? 0;
const kwOf = (c) => (c.effects || []).map((e) => e.keyword.split(" ")[0]).filter(Boolean);

const app = express();
app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "20kb" }));

// ---------- รูป + หน้าเว็บ ----------
app.use("/images", express.static(store.imgDir, { maxAge: "1d", setHeaders: (r) => r.setHeader("Access-Control-Allow-Origin", "*") }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "7d", index: "index.html" }));

// ---------- API ----------
const api = express.Router();
api.use(cors()); // เปิดให้เว็บอื่นเรียกได้ (Access-Control-Allow-Origin: *)
api.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: "too_many_requests" } }));
api.use((req, res, next) => { res.set("Cache-Control", "public, max-age=60"); next(); });

const withImageUrl = (req) => (c) => (c.image ? { ...c, imageUrl: `${req.protocol}://${req.get("host")}${c.image}` } : c);

api.get("/health", (_req, res) => res.json({ ok: true, cards: S.cards.length }));

// GET /api/cards?deck=SD01&type=Unit&element=ทอง&rarity=C&rotation=A&keyword=AUTO
//               &q=ธอร์&costMin=0&costMax=3&sort=cost&order=asc&page=1&limit=50
api.get("/cards", (req, res) => {
  const q = req.query;
  const list = (v) => (v ? String(v).split(",").map((s) => s.trim().toLowerCase()) : null);
  const f = { deck: list(q.deck), type: list(q.type), element: list(q.element),
              rarity: list(q.rarity), rotation: list(q.rotation), tribe: list(q.tribe) };
  const kw = list(q.keyword);
  const text = q.q ? String(q.q).toLowerCase() : "";
  const cmin = q.costMin !== undefined ? Number(q.costMin) : -Infinity;
  const cmax = q.costMax !== undefined ? Number(q.costMax) : Infinity;

  let out = S.cards.filter((c) => {
    for (const [k, vals] of Object.entries(f)) {
      if (!vals) continue;
      const v = String(c[k] ?? "").toLowerCase();
      if (k === "element") { // Avatar หลายธาตุ: ตรงกับธาตุใดก็ได้ใน elements[]
        const vs = [v, ...((c.elements || []).map((x) => String(x).toLowerCase()))];
        if (!vs.some((x) => vals.includes(x))) return false;
        continue;
      }
      if (k === "tribe" ? !vals.some((x) => v.includes(x)) : !vals.includes(v)) return false;
    }
    if (kw && !kwOf(c).some((k) => kw.includes(k.toLowerCase()))) return false;
    const cost = costOf(c);
    if (cost < cmin || cost > cmax) return false;
    if (text) {
      const hay = [c.id, c.name, c.tribe, c.flavor, ...(c.effects || []).map((e) => e.text)]
        .join(" ").toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });

  const sortKey = ["id", "name", "type", "cost", "atk", "def"].includes(q.sort) ? q.sort : "id";
  const dir = q.order === "desc" ? -1 : 1;
  const val = (c) => (sortKey === "cost" ? costOf(c) : c[sortKey] ?? "");
  out.sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "th")) * dir;
  });

  const limit = Math.min(Math.max(parseInt(q.limit) || 100, 1), 500);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const total = out.length;
  out = out.slice((page - 1) * limit, page * limit).map(withImageUrl(req));
  res.json({ total, page, limit, pages: Math.ceil(total / limit), data: out });
});

// GET /api/cards/SD01-001
api.get("/cards/:id", (req, res) => {
  const c = S.byId.get(req.params.id.toLowerCase());
  if (!c) return res.status(404).json({ error: "card_not_found" });
  res.json({ data: withImageUrl(req)(c) });
});

// POST /api/cards/batch  { "ids": ["SD01-001","SD01-002"] }  -> ใช้โหลดเด็คที่ผู้ใช้จัดไว้
api.post("/cards/batch", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : null;
  if (!ids) return res.status(400).json({ error: "ids_required" });
  const found = [], missing = [];
  for (const id of ids) {
    const c = S.byId.get(String(id).toLowerCase());
    c ? found.push(withImageUrl(req)(c)) : missing.push(id);
  }
  res.json({ data: found, missing });
});

api.get("/decks", (_req, res) =>
  res.json({ data: S.decks.map((d) => ({ ...d, count: S.cards.filter((c) => c.deck === d.id).length })) }));

api.get("/decks/:id", (req, res) => {
  const d = S.decks.find((x) => x.id.toLowerCase() === req.params.id.toLowerCase());
  if (!d) return res.status(404).json({ error: "deck_not_found" });
  res.json({ data: { ...d, cards: S.cards.filter((c) => c.deck === d.id).map(withImageUrl(req)) } });
});

api.get("/elements", (_req, res) => res.json({ data: S.elements }));

// ค่าที่ใช้ทำ dropdown ตัวกรอง
api.get("/filters", (_req, res) => {
  const u = (a) => [...new Set(a.filter(Boolean))];
  res.json({ data: {
    deck: u(S.cards.map((c) => c.deck)), type: u(S.cards.map((c) => c.type)),
    element: u(S.cards.map((c) => c.element)), rarity: u(S.cards.map((c) => c.rarity)),
    rotation: u(S.cards.map((c) => c.rotation)), keyword: u(S.cards.flatMap(kwOf)).filter((k) => k !== "COST"),
    costMax: Math.max(0, ...S.cards.map(costOf)),
  } });
});

api.get("/docs", (_req, res) => res.sendFile(path.join(__dirname, "public", "docs.html")));
api.use((_req, res) => res.status(404).json({ error: "not_found" }));

app.use("/api", api);
app.use("/admin", require("./admin/router"));
app.listen(PORT, () => console.log(`Card API running on http://localhost:${PORT}`));
