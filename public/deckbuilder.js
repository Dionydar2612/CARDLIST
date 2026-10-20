/* Card List · Deckbuilder
   - จัดเด็คแบบเดียวกับ AvastFallTCGsim (Avatar 1 ใบ + Main Deck 59 ใบ = 60 ใบ, ชื่อซ้ำ ≤ 4, Element Deck 8 ใบ, ธาตุตาม Avatar)
   - ส่งออกเป็นข้อความรูปแบบเดียวกับปุ่ม "คัดลอกเป็นข้อความ" ของ AvastFallTCGsim → วางที่ "นำเข้าจากข้อความ" ได้ทันที
   - ลิงก์แชร์: <เว็บนี้>/#deck=<ข้อความเด็คเข้ารหัส> เปิดแล้วโหลดเด็คเข้า Deckbuilder
   ทำงานหลัง index.html โหลดข้อมูลการ์ดเสร็จ (เรียก DB.init()) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const LS_DECKS = 'cl-decks';
  const TABS = [['Unit', 'Unit'], ['Spell', 'Spell'], ['Ultimate', 'Ultimate'], ['ALL', 'ALL']];
  const KORD = { Unit: 0, Enchant: 1, Counter: 2, Equipment: 3, Domain: 4, Ultimate: 5 };
  const KINDS = ['Unit', 'Enchant', 'Counter', 'Equipment', 'Domain', 'Ultimate'];
  const tabOf = k => (k === 'Unit' ? 'Unit' : k === 'Ultimate' ? 'Ultimate' : 'Spell');
  const DEFAULT_NAME = 'เด็คใหม่', IMPORT_NAME = 'เด็คที่นำเข้า';

  let DEFS = {}, DECKS = {}, ELS = [], inited = false;
  const S = { id: null, name: DEFAULT_NAME, avatar: null, counts: {}, edeck: null, tab: 'ALL', q: '', fd: '', ft: '', fe: '', sort: 'id', fin: false };

  /* ---------------- storage (try/catch เสมอ) ---------------- */
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const loadSaved = () => { const a = lsGet(LS_DECKS); return Array.isArray(a) ? a : []; };

  /* ---------------- ข้อมูลการ์ด → รูปแบบเดียวกับเอนจินของ sim ---------------- */
  function buildDefs() {
    DEFS = {}; DECKS = window.DECKS || {};
    for (const c of window.CARDS || []) {
      const id = c.deck + '-' + c.no;
      if (c.key && c.key !== id) continue;                       // ตัวสลับภาพ (เช่น SR) ใช้ตัวหลัก
      const kind = c.type === 'Spell' ? (c.sub || 'Enchant') : c.type;
      const raw = c.cost != null ? c.cost : c.sc;
      const list = Array.isArray(c.els) && c.els.length ? c.els : [c.el || (DECKS[c.deck] || {}).el].filter(Boolean);
      const els = [...new Set(list)];
      DEFS[id] = { id, deck: c.deck, no: c.no, name: c.name, kind, cost: raw == null ? 0 : raw, noCost: raw == null, tribe: c.tribe || '', els, img: c.img || '', fx: c.fx || [] };
    }
    ELS = Object.keys(window.ELEMENTS || {});
  }
  const cmpId = (a, b) => a.deck.localeCompare(b.deck) || a.no.localeCompare(b.no);
  const allowed = (av, card) => !card.els.length || card.els.every(e => ((av && av.els) || []).includes(e));
  const defaultEdeck = av => {
    const els = av && av.els && av.els.length ? av.els : [];
    const o = {}; els.forEach((e, i) => { o[e] = Math.floor(8 / els.length) + (i < 8 % els.length ? 1 : 0); }); return o;
  };
  const edeckOf = d => (d.edeck && Object.values(d.edeck).some(n => n > 0) ? d.edeck : defaultEdeck(DEFS[d.avatar]));
  const mainCount = d => Object.values(d.counts).reduce((a, b) => a + b, 0);
  const sizeOf = d => 1 + mainCount(d);
  const nameCounts = d => { const o = {}; for (const [id, n] of Object.entries(d.counts)) { const nm = DEFS[id] ? DEFS[id].name : id; o[nm] = (o[nm] || 0) + n; } return o; };
  function validate(d) {
    const errs = [], n = sizeOf(d), av = DEFS[d.avatar];
    if (n !== 60) errs.push('เด็คต้องมี 60 ใบพอดี (รวม Avatar) ตอนนี้ ' + n + ' ใบ');
    for (const [id] of Object.entries(d.counts)) {
      const df = DEFS[id];
      if (!df) { errs.push('ไม่พบการ์ด ' + id); continue; }
      if (df.kind === 'Avatar') errs.push(df.name + ' เป็น Avatar ใส่ใน Main Deck ไม่ได้');
      else if (av && !allowed(av, df)) errs.push(df.name + ' (ธาตุ' + df.els.join('/') + ') ใส่ไม่ได้ Avatar เป็นธาตุ' + (av.els.join('/') || 'ไม่ระบุ'));
    }
    for (const [nm, c] of Object.entries(nameCounts(d))) if (c > 4) errs.push(nm + ' ใส่ได้ไม่เกิน 4 ใบ (ตอนนี้ ' + c + ')');
    if (!av || av.kind !== 'Avatar') errs.push('ต้องเลือก Avatar 1 ใบ');
    const en = Object.values(edeckOf(d)).reduce((a, b) => a + b, 0);
    if (en !== 8) errs.push('Element Deck ต้องมี 8 ใบพอดี (ตอนนี้ ' + en + ' ใบ)');
    return errs;
  }

  /* ---------------- ข้อความเด็ค (รูปแบบเดียวกับ AvastFallTCGsim) ---------------- */
  function toText(d) {
    const nm = String(d.name || DEFAULT_NAME).replace(/[\r\n]+/g, ' ').trim() || DEFAULT_NAME;
    const L = ['# ' + nm];
    if (d.avatar) L.push('Avatar ' + d.avatar);
    for (const [k, n] of Object.entries(edeckOf(d))) if (n > 0 && k) L.push('Element ' + k + ' ' + n);
    for (const id of Object.keys(d.counts).filter(i => d.counts[i] > 0).sort()) L.push(id + ' x' + d.counts[id] + '  # ' + ((DEFS[id] || {}).name || '?'));
    return L.join('\n');
  }
  function parseText(txt) {
    const out = { name: IMPORT_NAME, avatar: null, counts: {}, edeck: null, warns: [] };
    const byName = {}, byId = {};
    for (const d of Object.values(DEFS)) { byName[d.name.toLowerCase()] = d.id; byId[d.id.toLowerCase()] = d.id; }
    for (const raw of String(txt).split(/\r?\n/)) {
      let line = raw.trim(); if (!line) continue;
      if (line[0] === '#') { if (out.name === IMPORT_NAME && line.length > 1) out.name = line.replace(/^#+\s*/, '').trim() || out.name; continue; }
      line = line.replace(/\s+#.*$/, '').replace(/\s+\/\/.*$/, '').trim(); if (!line) continue;
      let m = line.match(/^avatar\s*[:：]?\s*(.+)$/i);
      if (m) { const k = m[1].trim().toLowerCase(); const id = byId[k] || byName[k]; if (id) out.avatar = id; else out.warns.push('ไม่พบ Avatar: ' + m[1]); continue; }
      m = line.match(/^element\s*[:：]?\s*(\S+)\s*[x×]?\s*(\d+)$/i);
      if (m) { out.edeck = out.edeck || {}; out.edeck[m[1]] = (out.edeck[m[1]] || 0) + +m[2]; continue; }
      m = line.match(/^(?:(\d+)\s*[x×]?\s+)?(.+?)(?:\s*[x×]\s*(\d+))?$/i);
      if (!m) { out.warns.push('อ่านไม่ออก: ' + line); continue; }
      const n = +(m[1] || m[3] || 1), k = m[2].trim().toLowerCase(), id = byId[k] || byName[k];
      if (!id) { out.warns.push('ไม่พบการ์ด: ' + m[2]); continue; }
      if (DEFS[id].kind === 'Avatar') { if (!out.avatar) out.avatar = id; continue; }
      out.counts[id] = (out.counts[id] || 0) + n;
    }
    for (const id of Object.keys(out.counts)) out.counts[id] = Math.min(4, out.counts[id]);
    if (!out.avatar) out.warns.push('ไม่ได้ระบุ Avatar');
    return out;
  }
  const b64 = s => { const u = new TextEncoder().encode(s); let b = ''; u.forEach(x => { b += String.fromCharCode(x); }); return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0))); };
  const SIM = 'https://avastfalltcgsim.onrender.com/';
  const simLink = d => SIM + '#deck=' + b64(toText(d));
  const shareLink = d => location.origin + location.pathname + '#deck=' + b64(toText(d));

  /* ---------------- helpers UI ---------------- */
  const ico = (n, s) => { const e = (window.ELEMENTS || {})[n]; return e ? `<svg width="${s}" height="${s}" viewBox="0 0 18 18" style="vertical-align:-3px"><circle cx="9" cy="9" r="8" fill="#fff" stroke="${e.c}" stroke-width="2"/><path d="${e.p}" fill="${e.c}"/></svg>` : ''; };
  const pic = d => (d.img ? `<img loading="lazy" src="${esc(d.img)}" alt="${esc(d.name)}">` : `<div class="noimg">${esc(d.name)}</div>`);
  const costTxt = d => (d.kind === 'Unit' ? 'Cost ' + d.cost : d.noCost ? '' : 'Spend ' + d.cost);
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label == null ? v : label)}</option>`;
  let toastT = 0;
  function toast(msg) {
    const t = $('dbt'); if (!t) return; t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }
  async function copy(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { } ta.remove(); return ok;
  }
  const snap = () => JSON.stringify([S.name, S.avatar, S.counts, S.edeck]);
  let base = '';
  const dirty = () => snap() !== base && !(S.id === null && !Object.keys(S.counts).length);

  /* ---------------- โครงหน้า ---------------- */
  function skeleton() {
    $('v-deck').innerHTML = `
    <div id="dlist"></div>
    <div id="dedit" hidden>
    <div class="db-topbar"><button class="chip" data-a="back">← กลับไปรายการเด็ค</button><h1>Deckbuilder</h1></div>
    <p class="db-sub">จัดเด็ค 60 ใบ (Avatar 1 + Main Deck 59) ชื่อซ้ำได้ไม่เกิน 4 ใบ และ Element Deck 8 ใบ — เสร็จแล้วกด <b>แชร์ / คัดลอกข้อความ</b> แล้วนำไปวางที่ <b>"นำเข้าจากข้อความ"</b> ใน AvastFallTCGsim</p>
    <div class="db-wrap">
      <section class="db-pool">
        <input id="dq" class="search" type="search" placeholder="ค้นหาชื่อ / รหัส / เผ่า">
        <div class="db-filters" id="dfil"></div>
        <div class="cnt" id="dcnt"></div>
        <div class="db-grid" id="dgrid"></div>
      </section>
      <aside class="db-side box" id="dside">
        <label class="db-lbl">ชื่อเด็ค<input id="dname" type="text" maxlength="40"></label>
        <div class="db-head" id="dhead"></div>
        <div class="db-tabs" id="dtabs" role="tablist"></div>
        <div class="db-el" id="del"></div>
        <div class="db-mini" id="dmini"></div>
        <div class="db-bot" id="dbot"></div>
      </aside>
    </div>
    </div>
    <div id="dov" class="db-ov" hidden></div><div id="dbt" class="db-toast" role="status"></div>`;
    $('dfil').innerHTML = '';
    $('dq').addEventListener('input', e => { S.q = e.target.value; renderPool(); });
    $('dname').addEventListener('input', e => { S.name = e.target.value; });
    $('dfil').addEventListener('change', e => { const k = e.target.dataset.k; if (!k) return; S[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; renderPool(); });
    $('v-deck').addEventListener('click', onClick);
    $('dov').addEventListener('click', e => { if (e.target.id === 'dov') closeOv(); });
    addEventListener('keydown', e => { if (e.key === 'Escape' && !$('dov').hidden) closeOv(); });
  }

  function renderFilters() {
    const decks = [...new Set(Object.values(DEFS).map(d => d.deck))].sort();
    const els = [...new Set(Object.values(DEFS).flatMap(d => d.els))];
    const sel = (k, items, all0) => `<select data-k="${k}" aria-label="${esc(all0)}"><option value="">${esc(all0)}</option>${items.map(o => Array.isArray(o) ? opt(o[0], S[k], o[1]) : opt(o, S[k])).join('')}</select>`;
    $('dfil').innerHTML = sel('fd', decks, 'ทุกเด็ค') + sel('ft', KINDS, 'ทุกประเภท') + sel('fe', els, 'ทุกธาตุ') +
      `<select data-k="sort" aria-label="เรียงลำดับ">${[['id', 'เรียงตามรหัส'], ['cost', 'Cost ต่ำ → สูง'], ['costd', 'Cost สูง → ต่ำ'], ['name', 'เรียงตามชื่อ']].map(([v, l]) => opt(v, S.sort, l)).join('')}</select>` +
      `<label class="db-chk"><input type="checkbox" data-k="fin" ${S.fin ? 'checked' : ''}> เฉพาะที่อยู่ในเด็ค</label>`;
  }

  function renderPool() {
    const av = DEFS[S.avatar], nc = nameCounts(S), q = S.q.trim().toLowerCase();
    const sorter = S.sort === 'cost' ? (x, y) => x.cost - y.cost || cmpId(x, y) : S.sort === 'costd' ? (x, y) => y.cost - x.cost || cmpId(x, y)
      : S.sort === 'name' ? (x, y) => x.name.localeCompare(y.name, 'th') || cmpId(x, y) : cmpId;
    const pool = Object.values(DEFS).filter(d => d.kind !== 'Avatar');
    const lib = pool.filter(d => (S.tab === 'ALL' || tabOf(d.kind) === S.tab) && (!S.fd || d.deck === S.fd) && (!S.ft || d.kind === S.ft) &&
      (!S.fe || d.els.includes(S.fe)) && (!S.fin || (S.counts[d.id] || 0) > 0) &&
      (!q || (d.name + ' ' + d.id + ' ' + d.tribe).toLowerCase().includes(q))).sort(sorter);
    $('dcnt').innerHTML = `แสดง <b>${lib.length}</b> จาก <b>${pool.length}</b> ใบ`;
    $('dgrid').innerHTML = lib.map(d => {
      const n = S.counts[d.id] || 0, bad = av && !allowed(av, d), full = (nc[d.name] || 0) >= 4 || bad;
      return `<div class="db-t ${n ? 'in' : ''} ${bad ? 'off' : ''}" ${bad ? `title="ธาตุ${esc(d.els.join('/'))} ใส่ไม่ได้ Avatar เป็นธาตุ${esc(av.els.join('/') || 'ไม่ระบุ')}"` : ''}>
        <button class="db-img" data-a="add" data-id="${esc(d.id)}" aria-label="เพิ่ม ${esc(d.name)}" ${full ? 'data-full="1"' : ''}>${pic(d)}${n ? `<span class="db-pill">${n}</span>` : ''}</button>
        <div class="db-nm">${esc(d.name)}</div><div class="db-mt">${d.els.map(e => ico(e, 12)).join('')} ${esc(d.id)} ${esc(costTxt(d))}</div>
        <div class="db-step"><button data-a="sub" data-id="${esc(d.id)}" ${n ? '' : 'disabled'} aria-label="ลด">−</button><b>${n}</b><button data-a="add" data-id="${esc(d.id)}" ${full ? 'disabled' : ''} aria-label="เพิ่ม">+</button></div></div>`;
    }).join('') || '<div class="empty">ไม่พบการ์ดตามตัวกรอง</div>';
  }

  function renderSide() {
    const av = DEFS[S.avatar], tot = sizeOf(S), ed = edeckOf(S), edTot = Object.values(ed).reduce((a, b) => a + b, 0), nc = nameCounts(S);
    const errs = validate(S);
    const byTab = { Unit: 0, Spell: 0, Ultimate: 0, ALL: 0 };
    for (const [id, n] of Object.entries(S.counts)) { const d = DEFS[id]; if (d) { byTab[tabOf(d.kind)] += n; byTab.ALL += n; } }
    if ($('dname') !== document.activeElement) $('dname').value = S.name;
    $('dhead').innerHTML = `<button class="db-av" data-a="avopen" aria-label="เลือก Avatar">${av ? pic(av) : '<div class="noimg">เลือก<br>Avatar</div>'}<span>เลือก Avatar</span></button>
      <div class="db-info"><b>${av ? esc(av.name) : 'ยังไม่ได้เลือก Avatar'}</b>${av ? `<div class="db-mt">${av.els.map(e => ico(e, 13)).join('')} ${esc(av.id)}</div>` : ''}
      <div class="db-tot"><b>${tot}</b>/60 ${tot === 60 ? '<span class="good">ครบ</span>' : `<span class="bad">${tot < 60 ? 'ขาด ' + (60 - tot) : 'เกิน ' + (tot - 60)}</span>`}</div>
      <div class="db-bar"><i class="${tot === 60 ? 'ok' : tot > 60 ? 'over' : ''}" style="width:${Math.min(100, tot / 60 * 100)}%"></i></div></div>`;
    $('dtabs').innerHTML = TABS.map(([k, l]) => `<button class="db-tab ${S.tab === k ? 'on' : ''}" data-a="tab" data-v="${k}" role="tab" aria-selected="${S.tab === k}">${l}<b>${byTab[k]}</b></button>`).join('');
    $('del').innerHTML = `<div class="db-elh"><span>Element Deck <b>${edTot}</b>/8 ${edTot === 8 ? '<span class="good">✓</span>' : ''}</span><button class="chip" data-a="edauto">ตามธาตุ Avatar</button></div>
      <div class="db-elg">${ELS.map(k => `<div class="db-elc">${ico(k, 16)}<span>${esc(k)}</span><button data-a="edm" data-k="${esc(k)}" data-d="-1" aria-label="ลด ${esc(k)}">−</button><b>${ed[k] || 0}</b><button data-a="edm" data-k="${esc(k)}" data-d="1" aria-label="เพิ่ม ${esc(k)}">+</button></div>`).join('')}</div>`;
    const mine = Object.keys(S.counts).filter(id => S.counts[id] > 0 && DEFS[id]).map(id => DEFS[id]).sort((x, y) => (KORD[x.kind] - KORD[y.kind]) || x.cost - y.cost || cmpId(x, y));
    $('dmini').innerHTML = mine.map(d => `<div class="db-m" title="${esc(d.name)}"><div class="db-img">${pic(d)}<span class="db-pill">${S.counts[d.id]}</span></div>
      <div class="db-step"><button data-a="sub" data-id="${esc(d.id)}" aria-label="ลด">−</button><button data-a="add" data-id="${esc(d.id)}" ${(nc[d.name] || 0) >= 4 ? 'disabled' : ''} aria-label="เพิ่ม">+</button></div></div>`).join('')
      || '<span class="db-muted">ยังไม่มีการ์ดในเด็ค คลิกการ์ดทางซ้ายเพื่อใส่ลงเด็ค</span>';
    $('dbot').innerHTML = (errs.length ? `<div class="db-warn">${errs.map(esc).join('<br>')}</div>` : '<div class="good">✓ เด็คถูกต้อง พร้อมนำไปเล่นใน AvastFallTCGsim</div>') +
      `<div class="db-acts"><button class="chip pri" data-a="share">📤 แชร์ / คัดลอกข้อความ</button><button class="chip" data-a="save">💾 บันทึกเด็ค</button><button class="chip" data-a="import">📥 นำเข้าจากข้อความ</button><button class="chip" data-a="clear">ล้างเด็ค</button></div>`;
    renderPool();
  }

  /* ---------------- modal ---------------- */
  function openOv(html) { $('dov').innerHTML = `<div class="db-dlg box" role="dialog">${html}</div>`; $('dov').hidden = false; }
  function closeOv() { $('dov').hidden = true; $('dov').innerHTML = ''; }

  let shareD = null;
  function shareModal(d) {
    d = shareD = d || S; const text = toText(d), errs = validate(d);
    openOv(`<h2>แชร์เด็ค: ${esc(d.name)}</h2>
      ${errs.length ? `<div class="db-warn">เด็คนี้ยังไม่ถูกต้องตามกติกา (นำเข้าได้ แต่ต้องแก้ก่อนเล่น):<br>${errs.map(esc).join('<br>')}</div>` : ''}
      <p class="db-muted">คัดลอกข้อความนี้ แล้วไปที่ AvastFallTCGsim → <b>เด็คของฉัน → นำเข้าจากข้อความ</b> แล้ววาง</p>
      <textarea id="dtxt" class="db-ta" readonly>${esc(text)}</textarea>
      <div class="db-acts"><button class="chip pri" data-a="copytxt">คัดลอกข้อความ</button><button class="chip" data-a="copylink">คัดลอกลิงก์แชร์</button><a class="chip pri" href="${esc(simLink(d))}" target="_blank" rel="noopener">▶ เปิดใน Playtest (นำเข้าอัตโนมัติ)</a><button class="chip" data-a="dl">ดาวน์โหลด .txt</button>
      <button class="chip" data-a="closeov">ปิด</button></div>
      <p class="db-muted">ลิงก์แชร์เปิดแล้วจะโหลดเด็คนี้ในหน้า Deckbuilder นี้ (ผู้รับกดคัดลอกข้อความต่อเพื่อนำเข้า AvastFallTCGsim)</p>`);
  }
  function importModal(text, warns) {
    openOv(`<h2>นำเข้าเด็คจากข้อความ</h2><p class="db-muted">วางข้อความเด็ค (รูปแบบเดียวกับที่ส่งออกจาก AvastFallTCGsim) หรือลิงก์แชร์ของหน้านี้</p>
      <textarea id="dimp" class="db-ta" placeholder="# เด็คของฉัน&#10;Avatar SD01-001&#10;Element ทอง 8&#10;SD01-002 x3">${esc(text || '')}</textarea>
      ${warns && warns.length ? `<div class="db-warn">${warns.map(esc).join('<br>')}</div>` : ''}
      <div class="db-acts"><button class="chip pri" data-a="doimport">นำเข้า</button><button class="chip" data-a="closeov">ปิด</button></div>`);
  }
  function avatarModal() {
    const avs = Object.values(DEFS).filter(d => d.kind === 'Avatar').sort(cmpId);
    openOv(`<h2>เลือก Avatar</h2><div class="db-avg">${avs.map(d => `<button class="db-avc ${S.avatar === d.id ? 'on' : ''}" data-a="avpick" data-id="${esc(d.id)}">${pic(d)}<b>${esc(d.name)}</b><small>${d.els.map(e => ico(e, 13)).join('')} ${esc(d.id)}</small></button>`).join('') || '<span class="db-muted">ไม่พบ Avatar</span>'}</div>
      <div class="db-acts"><button class="chip" data-a="closeov">ปิด</button></div>`);
  }

  /* ---------------- เด็ค: เพิ่ม/ลบ/บันทึก/โหลด ---------------- */
  function setDeck(d) {
    S.id = d.id || null; S.name = d.name || DEFAULT_NAME; S.avatar = d.avatar && DEFS[d.avatar] ? d.avatar : null;
    S.counts = {}; for (const [id, n] of Object.entries(d.counts || {})) if (DEFS[id] && n > 0) S.counts[id] = Math.min(4, n);
    S.edeck = d.edeck && Object.values(d.edeck).some(n => n > 0) ? Object.assign({}, d.edeck) : null;
    base = d.fresh ? '' : snap();
    S.q = ''; if ($('dq')) $('dq').value = '';
    setMode('edit'); renderSide();
  }
  function newDeck() {
    const f = Object.values(DEFS).filter(d => d.kind === 'Avatar').sort(cmpId)[0];
    setDeck({ id: null, name: DEFAULT_NAME, avatar: f && f.id, counts: {}, edeck: null, fresh: true });
  }
  function loadDeck(id) { const d = loadSaved().find(x => x.id === id); if (d) setDeck(d); }
  function setMode(m) { $('dlist').hidden = m !== 'list'; $('dedit').hidden = m !== 'edit'; S.mode = m; if (m === 'list') renderList(); }
  function backToList() {
    if (dirty() && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ออกโดยไม่บันทึก?')) return;
    S.id = null; closeOv(); setMode('list'); scrollTo(0, 0);
  }
  function renderList() {
    const saved = loadSaved().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const cards = saved.map(d => {
      const av = DEFS[d.avatar], errs = validate(d), ed = edeckOf(d), sure = confirmDel === d.id;
      const edTxt = Object.entries(ed).filter(([, n]) => n > 0).map(([k, n]) => k + ' ' + n).join(' · ') || '—';
      return `<div class="db-deck box"><div class="db-dart">${av ? pic(av) : '<div class="noimg">—</div>'}</div>
        <div class="db-dinfo"><h3>${esc(d.name)}</h3><div class="db-muted">Avatar: ${esc(av ? av.name : '—')} · ${sizeOf(d)}/60 ใบ</div><div class="db-muted">Element Deck: ${esc(edTxt)}</div>
        ${errs.length ? `<div class="bad db-ds">⚠ ${esc(errs[0])}${errs.length > 1 ? ` (และอีก ${errs.length - 1} ข้อ)` : ''}</div>` : '<div class="good db-ds">✓ เด็คถูกต้อง</div>'}
        <div class="db-acts"><button class="chip pri" data-a="edit" data-id="${esc(d.id)}">แก้ไข</button><button class="chip" data-a="lshare" data-id="${esc(d.id)}">แชร์ / คัดลอกข้อความ</button><button class="chip" data-a="dup" data-id="${esc(d.id)}">ทำสำเนา</button>
        <button class="chip ${sure ? 'danger' : ''}" data-a="del" data-id="${esc(d.id)}">${sure ? 'ยืนยันลบ' : 'ลบ'}</button></div></div></div>`;
    }).join('');
    $('dlist').innerHTML = `<h1>Deckbuilder</h1><p class="db-sub">สร้างและเก็บเด็คของคุณ (เก็บในเบราว์เซอร์นี้) แล้วกด <b>แชร์ / คัดลอกข้อความ</b> เพื่อนำไปวางที่ <b>"นำเข้าจากข้อความ"</b> ใน AvastFallTCGsim</p>
      <div class="db-lgrid">${cards}<button class="db-deck db-add" data-a="create"><span>＋</span>สร้างเด็คใหม่</button></div>
      <div class="db-acts"><button class="chip" data-a="import">📥 นำเข้าจากข้อความ / ลิงก์</button></div>`;
  }
  let confirmDel = null;
  function saveDeck() {
    const a = loadSaved(), id = S.id || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const rec = { id, name: (S.name || '').trim() || DEFAULT_NAME, avatar: S.avatar, counts: JSON.parse(JSON.stringify(S.counts)), edeck: S.edeck ? Object.assign({}, S.edeck) : null, updated: Date.now() };
    const i = a.findIndex(x => x.id === id); if (i >= 0) a[i] = rec; else a.push(rec);
    S.id = id; S.name = rec.name; base = snap();
    toast(lsSet(LS_DECKS, a) ? 'บันทึกเด็คแล้ว ✓ (เก็บในเบราว์เซอร์นี้)' : 'บันทึกลงเครื่องไม่ได้');
    renderSide();
  }
  function add(id, dlt) {
    const df = DEFS[id]; if (!df) return;
    let n = (S.counts[id] || 0) + dlt;
    if (dlt > 0) {
      const av = DEFS[S.avatar];
      if (av && !allowed(av, df)) return toast('ธาตุไม่ตรงกับ Avatar');
      if ((nameCounts(S)[df.name] || 0) >= 4) return toast('ชื่อซ้ำได้ไม่เกิน 4 ใบ');
    }
    n = Math.max(0, Math.min(4, n)); if (n) S.counts[id] = n; else delete S.counts[id];
    renderSide();
  }
  function doImport() {
    let txt = ($('dimp') || {}).value || '';
    const m = txt.match(/#deck=([A-Za-z0-9_-]+)/);
    if (m) { try { txt = unb64(m[1]); } catch (e) { return importModal(txt, ['ลิงก์ไม่ถูกต้อง']); } }
    const r = parseText(txt);
    if (!Object.keys(r.counts).length && !r.avatar) return importModal(txt, ['ไม่พบการ์ดในข้อความ', ...r.warns]);
    setDeck({ id: null, name: r.name, avatar: r.avatar, counts: r.counts, edeck: r.edeck, fresh: true });
    if (r.warns.length) importModal(txt, ['นำเข้าแล้ว แต่มีบางบรรทัดถูกข้าม:', ...r.warns]); else { closeOv(); toast('นำเข้าเด็คแล้ว ✓'); }
  }
  function download(d) {
    const blob = new Blob([toText(d) + '\n'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (d.name || 'deck').replace(/[\\/:*?"<>|]+/g, '_') + '.txt'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t) return;
    const a = t.dataset.a, id = t.dataset.id;
    switch (a) {
      case 'add': return add(id, 1);
      case 'sub': return add(id, -1);
      case 'tab': S.tab = t.dataset.v; return renderSide();
      case 'create': return newDeck();
      case 'back': return backToList();
      case 'edit': return loadDeck(id);
      case 'lshare': { const d = loadSaved().find(x => x.id === id); if (d) shareModal(d); return; }
      case 'dup': { const a = loadSaved(), d = a.find(x => x.id === id); if (!d) return; a.push(Object.assign(JSON.parse(JSON.stringify(d)), { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: d.name + ' (สำเนา)', updated: Date.now() })); lsSet(LS_DECKS, a); return renderList(); }
      case 'del': { if (confirmDel !== id) { confirmDel = id; return renderList(); } lsSet(LS_DECKS, loadSaved().filter(x => x.id !== id)); confirmDel = null; toast('ลบเด็คแล้ว'); return renderList(); }
      case 'save': return saveDeck();
      case 'clear': if (Object.keys(S.counts).length && !confirm('ล้างการ์ดทั้งหมดในเด็คนี้?')) return; S.counts = {}; return renderSide();
      case 'avopen': return avatarModal();
      case 'avpick': S.avatar = id; closeOv(); return renderSide();
      case 'edm': { const cur = Object.assign({}, edeckOf(S)); const v = Math.max(0, (cur[t.dataset.k] || 0) + +t.dataset.d); if (v) cur[t.dataset.k] = v; else delete cur[t.dataset.k]; S.edeck = cur; return renderSide(); }
      case 'edauto': S.edeck = null; return renderSide();
      case 'share': return shareModal(S);
      case 'import': return importModal('', []);
      case 'doimport': return doImport();
      case 'closeov': return closeOv();
      case 'copytxt': return toast(await copy(toText(shareD || S)) ? 'คัดลอกข้อความแล้ว ✓' : 'คัดลอกไม่ได้ เลือกข้อความแล้วกด Ctrl+C');
      case 'copylink': return toast(await copy(shareLink(shareD || S)) ? 'คัดลอกลิงก์แล้ว ✓' : 'คัดลอกไม่ได้');
      case 'dl': return download(shareD || S);
    }
  }

  /* ---------------- สลับหน้า Card List / Deckbuilder ---------------- */
  function showView(v) {
    const deck = v === 'deck';
    $('v-cards').hidden = deck; $('v-deck').hidden = !deck;
    document.querySelectorAll('.sitetabs a[data-v]').forEach(a => { const on = a.dataset.v === v; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    try { history.replaceState(null, '', deck ? '#deckbuilder' : location.pathname + location.search); } catch (e) { }
  }
  function fromHash() {
    const m = location.hash.match(/^#deck=([A-Za-z0-9_-]+)/);
    if (m) {
      try { const r = parseText(unb64(m[1])); setDeck({ id: null, name: r.name, avatar: r.avatar, counts: r.counts, edeck: r.edeck, fresh: true }); showView('deck'); toast('โหลดเด็คจากลิงก์แล้ว'); return true; } catch (e) { }
    }
    if (location.hash === '#deckbuilder') { showView('deck'); return true; }
    return false;
  }

  window.DB = {
    init() {
      if (inited) return; inited = true;
      buildDefs(); skeleton(); renderFilters();
      document.querySelectorAll('.sitetabs a[data-v]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); showView(a.dataset.v); }));
      setMode('list');
      fromHash();
      addEventListener('hashchange', fromHash);
    }
  };
})();
