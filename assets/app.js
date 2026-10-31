/* reydelgutierrez.com: public home page + private sections unlocked by visitor access codes. */
(function () {
  "use strict";
  const S = window.SITE;
  const C = S.config;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LOCK = (s = 13) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  const fmtDate = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? (m / 60).toFixed(1).replace(".0", "") + " h ago" : Math.round(m / 1440) + " d ago"; };

  const PRIVATE = ["bms", "lab", "projects", "goals"];
  const VIEWS = ["home", "bms", "lab", "projects", "goals", "admin"];
  const state = { access: null, gated: null, zone: "rack", projFilter: "all", view: "home" };

  /* =====================================================================
     API (real Worker, or an in-memory stand-in when config.demo is true)
     ===================================================================== */
  async function call(method, path, body) {
    const r = await fetch(C.apiBase + path, {
      method, credentials: "same-origin", cache: "no-store",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : null;
    if (!r.ok || !data) { const e = new Error((data && data.error) || "Couldn't reach the server. Try again in a minute."); e.status = r.status; throw e; }
    return data;
  }
  const realApi = {
    session: () => call("GET", "/session"),
    unlock: (code) => call("POST", "/unlock", { code }),
    logout: () => call("POST", "/logout", {}),
    gated: () => call("GET", "/gated"),
    listCodes: () => call("GET", "/admin/codes"),
    createCode: (o) => call("POST", "/admin/codes", o),
    revokeCode: (id) => call("POST", "/admin/codes/revoke", { id }),
    getContent: () => call("GET", "/admin/content"),
    putContent: (c) => call("PUT", "/admin/content", c)
  };

  const demoApi = (() => {
    const mem = { codes: [{ id: "demo0001", label: "Preview code", code: "DEMO-2026", created: Date.now() - 864e5, expires: Date.now() + 30 * 864e5, maxUses: 0, uses: 3, revoked: false }], content: null };
    const ss = { get() { try { return JSON.parse(sessionStorage.getItem("rg-demo-session")); } catch (e) { return null; } }, set(v) { try { v ? sessionStorage.setItem("rg-demo-session", JSON.stringify(v)) : sessionStorage.removeItem("rg-demo-session"); } catch (e) {} } };
    let session = ss.get();
    const wait = (v) => new Promise((res) => setTimeout(() => res(v), 250));
    const fail = (m) => Promise.reject(new Error(m));
    return {
      session: () => wait(session || { role: null }),
      unlock(code) {
        const c = mem.codes.find((x) => x.code === normalize(code));
        if (!c || c.revoked) return wait(null).then(() => fail("That code isn't valid. Check it and try again."));
        if (c.expires && c.expires < Date.now()) return fail("That code has expired.");
        c.uses++;
        session = { role: "visitor", label: c.label, expires: Math.min(c.expires || Infinity, Date.now() + 7 * 864e5) };
        ss.set(session);
        return wait(session);
      },
      logout() { session = null; ss.set(null); return wait({ ok: true }); },
      gated() {
        if (!session) return fail("Access code required.");
        return wait({ bms: demoBMS(), lab: demoLab(), ...(mem.content || window.DEMO_CONTENT || { projects: [], goals: [] }) });
      },
      listCodes: () => wait({ codes: mem.codes.map(({ code, ...r }) => r) }),
      createCode({ label, days, maxUses }) {
        const code = makeCode();
        const rec = { id: Math.random().toString(16).slice(2, 10), label: label || "Visitor", code, created: Date.now(), expires: days ? Date.now() + days * 864e5 : 0, maxUses: maxUses || 0, uses: 0, revoked: false };
        mem.codes.unshift(rec);
        return wait({ code, id: rec.id });
      },
      revokeCode(id) { const c = mem.codes.find((x) => x.id === id); if (c) c.revoked = true; return wait({ ok: true }); },
      getContent: () => wait(mem.content || window.DEMO_CONTENT),
      putContent(c) { mem.content = c; return wait({ ok: true }); }
    };
  })();
  const api = C.demo ? demoApi : realApi;

  function normalize(code) {
    const s = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (s === "DEMO2026") return "DEMO-2026";
    const body = s.startsWith("RG") ? s.slice(2) : s;
    return body.length === 8 ? `RG-${body.slice(0, 4)}-${body.slice(4)}` : s;
  }
  function makeCode() {
    const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
    const b = crypto.getRandomValues(new Uint8Array(8));
    const s = Array.from(b, (x) => A[x % A.length]).join("");
    return `RG-${s.slice(0, 4)}-${s.slice(4)}`;
  }

  /* =====================================================================
     ROUTER + ACCESS STATE
     ===================================================================== */
  const hasAccess = () => !!(state.access && state.access.role);
  const isOwner = () => C.demo || (state.access && state.access.role === "owner");

  function route() {
    const name = (location.hash || "#home").slice(1);
    const v = VIEWS.includes(name) ? name : "home";
    state.view = v;
    const locked = PRIVATE.includes(v) && !hasAccess();
    $$(".view").forEach((n) => n.classList.remove("active"));
    $(locked ? "#view-locked" : "#view-" + v).classList.add("active");
    if (locked) {
      const sec = S.privateSections.find((p) => p.id === v);
      $("#locked-title").textContent = sec.title + " is private";
      $("#locked-body").textContent = sec.body + " Enter the access code I sent you to open it.";
    }
    $$(".nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = { home: "Reydel Gutierrez", bms: "My Live BMS", lab: "Home Lab", projects: "Projects", goals: "Goals", admin: "Owner" }[v] + (v === "home" ? "" : " · Reydel Gutierrez");
    if (v === "bms" && state.gated) renderTrend();
    if (v === "admin") renderAdmin();
    window.scrollTo(0, 0);
  }

  function renderAccessUI() {
    const on = hasAccess();
    $$(".nav a[data-private]").forEach((a) => {
      a.classList.toggle("is-locked", !on);
      if (!on) a.setAttribute("title", "Private: access code required"); else a.removeAttribute("title");
    });
    const b = $("#access-btn");
    if (on) {
      const owner = state.access.role === "owner";
      b.querySelector(".txt").textContent = owner ? "Owner · Lock" : "Unlocked · Lock";
      b.title = owner ? "Signed in as owner" : `Access for ${state.access.label || "visitor"}${state.access.expires ? " until " + fmtDate(state.access.expires) : ""}. Click to lock again.`;
      b.style.borderColor = "var(--accent)";
    } else {
      b.querySelector(".txt").textContent = "Access code";
      b.title = "Enter an access code to open the private sections";
      b.style.borderColor = "";
    }
    renderTeasers();
  }

  async function loadAccess() {
    try { state.access = await api.session(); if (!state.access.role) state.access = null; }
    catch (e) { state.access = null; }
    renderAccessUI();
    if (hasAccess()) await refreshGated(); else state.gated = null;
    route();
  }

  async function refreshGated() {
    try {
      state.gated = await api.gated();
      renderBMS(); renderLab();
      if (!refreshGated.didStatic) { renderProjects(); renderGoals(); refreshGated.didStatic = true; }
    } catch (e) {
      if (e.status === 401 || e.status === 403) { state.access = null; state.gated = null; renderAccessUI(); route(); }
    }
  }

  /* ---------- unlock modal ---------- */
  const modal = $("#unlock");
  let lastFocus = null;
  function openUnlock() {
    lastFocus = document.activeElement;
    modal.hidden = false;
    $("#unlock-msg").textContent = ""; $("#unlock-msg").className = "form-msg";
    setTimeout(() => $("#code-input").focus(), 30);
  }
  function closeUnlock() { modal.hidden = true; if (lastFocus) lastFocus.focus(); }
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.matches("[data-close]")) closeUnlock(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeUnlock(); });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-open-unlock]");
    if (t) { e.preventDefault(); openUnlock(); }
    const a = e.target.closest(".nav a.is-locked");
    if (a) { /* let the hash change show the locked page, and offer the dialog */ setTimeout(openUnlock, 0); }
  });
  $("#unlock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#unlock-msg");
    const code = $("#code-input").value.trim();
    if (!code) { msg.textContent = "Type or paste your code first."; msg.className = "form-msg err"; return; }
    msg.textContent = "Checking…"; msg.className = "form-msg";
    try {
      state.access = await api.unlock(code);
      msg.textContent = "Unlocked."; msg.className = "form-msg ok";
      $("#code-input").value = "";
      renderAccessUI();
      await refreshGated();
      setTimeout(() => { closeUnlock(); if (state.view === "home") location.hash = "#bms"; else route(); }, 400);
    } catch (err) {
      msg.textContent = err.status === 429 ? "Too many tries. Wait 15 minutes and try again." : err.message;
      msg.className = "form-msg err";
    }
  });
  $("#access-btn").addEventListener("click", async () => {
    if (!hasAccess()) return openUnlock();
    try { await api.logout(); } catch (e) {}
    state.access = null; state.gated = null; refreshGated.didStatic = false;
    renderAccessUI(); route();
  });

  /* =====================================================================
     HOME (public)
     ===================================================================== */
  function renderHome() {
    const P = S.person;
    $("#h-name").textContent = P.name + " · " + P.location;
    $("#h-headline").textContent = P.headline;
    $("#h-lede").textContent = P.lede;
    $("#h-resume").href = C.resume;
    fetch(C.resume, { method: "HEAD" }).then((r) => { if (!r.ok) $("#h-resume").hidden = true; }).catch(() => { $("#h-resume").hidden = true; });
    $("#h-contact").href = "mailto:" + C.email;
    $("#h-contact").title = C.email;
    $("#locked-mail").href = "mailto:" + C.email + "?subject=Access%20code%20request";
    $("#stats").innerHTML = S.stats.map((s) => `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join("");
    $("#pitch").innerHTML = S.pitch.map((p, i) => `
      <div class="panel pitch-card"><span class="n">0${i + 1}</span><div><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div></div>`).join("");
    $("#skill-grid").innerHTML = S.skills.map((g) => `
      <div class="panel skill-col"><h3>${esc(g.group)}</h3><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`).join("");
    $("#timeline").innerHTML = S.experience.map((j) => `
      <div class="job"><div class="when">${esc(j.when)}</div>
      <div><h3>${esc(j.role)}</h3><div class="org">${esc(j.org)}</div>
      <ul>${j.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>`).join("");
    const E = S.education;
    $("#certs").innerHTML =
      `<div class="panel cert"><div class="cert-badge">FIU</div><div><b>${esc(E.degree)}</b><small>${esc(E.school)}</small></div></div>` +
      S.certifications.map((c) => `<div class="panel cert"><div class="cert-badge">${esc(c.issuer.slice(0, 4).toUpperCase())}</div><div><b>${esc(c.name)}</b><small>${esc(c.issuer)}</small></div></div>`).join("");
    $("#year").textContent = new Date().getFullYear();
    $("#foot-links").innerHTML = `<a href="${esc(C.linkedin)}">LinkedIn</a> · <a href="${esc(C.github)}">GitHub</a> · <a href="mailto:${esc(C.email)}">${esc(C.email)}</a> · <a href="#admin" class="muted">Owner</a>`;
    $("#bms-sub").textContent = `Real sensors, trends and alarms, running on ${C.bmsPlatform}, the building management platform I'm building.`;
    $("#bms-brand").textContent = C.bmsPlatform;
    renderStack();
    renderTeasers();
  }

  function renderTeasers() {
    const on = hasAccess();
    $("#private-teasers").innerHTML = S.privateSections.map((p) => `
      <a class="panel teaser ${on ? "unlocked" : ""}" href="#${p.id}">
        <h3>${on ? "" : LOCK(14)}${esc(p.title)}</h3><p>${esc(p.body)}</p>
        <span class="open">${on ? "Open →" : "Access code required"}</span></a>`).join("");
  }

  const LAYERS = [
    { k: "Cloud & analytics", p: "REST APIs · Azure · dashboards", d: "Where building data turns into reports and dashboards. I write Python against REST APIs and hold Azure Fundamentals." },
    { k: "IT network", p: "VLANs · routing · ACLs · firewalls", d: "Switching, VLANs, routing and ACLs (CCNA). Keeping OT traffic segmented and reachable only by the right systems." },
    { k: "BMS supervisor", p: "Any vendor · BACnet/IP", d: "The supervisory server and BACnet/IP network: graphics, trends, alarms and schedules. Metasys in the field, my own Sensreys Automation at home, and the same ideas on any other platform." },
    { k: "Field controllers", p: "BACnet MS/TP · logic", d: "Controllers on MS/TP trunks running sequences of operation that I program, validate and troubleshoot." },
    { k: "Equipment & sensors", p: "AHU · VAV · temp · RH · CO₂", d: "Air handlers, VAV boxes and sensors. Commissioning and point-to-point checkout start here." }
  ];
  function renderStack() {
    const svg = $("#stack");
    const h = 62, gap = 12, x = 10, w = 420;
    LAYERS.forEach((L, i) => {
      const y = 10 + i * (h + gap);
      const g = svgEl("g", { class: "layer", tabindex: "0", role: "button", "aria-label": L.k });
      g.appendChild(svgEl("rect", { class: "band", x, y, width: w, height: h, rx: 9 }));
      const t1 = svgEl("text", { class: "lbl", x: x + 18, y: y + 27 }); t1.textContent = L.k;
      const t2 = svgEl("text", { x: x + 18, y: y + 47 }); t2.textContent = L.p;
      const idx = svgEl("text", { x: x + w - 18, y: y + 27, "text-anchor": "end" }); idx.textContent = "L" + (LAYERS.length - i);
      g.append(t1, t2, idx);
      const show = () => { $$(".layer", svg).forEach((n) => n.classList.remove("on")); g.classList.add("on"); $("#layer-info").innerHTML = `<b>${esc(L.k)}.</b> ${esc(L.d)}`; };
      g.addEventListener("mouseenter", show); g.addEventListener("focus", show); g.addEventListener("click", show);
      svg.appendChild(g);
    });
    const bx = 470, top = 10, bot = 10 + LAYERS.length * (h + gap) - gap;
    svg.appendChild(svgEl("line", { x1: bx, y1: top + 8, x2: bx, y2: bot - 8, stroke: "var(--line)", "stroke-width": 2 }));
    LAYERS.forEach((L, i) => {
      const y = 10 + i * (h + gap) + h / 2;
      svg.appendChild(svgEl("line", { x1: x + w, y1: y, x2: bx, y2: y, stroke: "var(--line)", "stroke-width": 2 }));
      svg.appendChild(svgEl("circle", { cx: bx, cy: y, r: 5, fill: "var(--panel-2)", stroke: "var(--accent)", "stroke-width": 2 }));
    });
    const mid = (top + bot) / 2;
    const lbl = svgEl("text", { x: bx + 14, y: mid, fill: "var(--muted)", "font-size": 11, "font-family": "var(--font-mono)", transform: `rotate(90 ${bx + 14} ${mid})`, "text-anchor": "middle" });
    lbl.textContent = "OT ⇄ IT"; svg.appendChild(lbl);
    if (!reduceMotion) {
      [[0, "packet", bot - 8, top + 8, "3.2s"], [1.4, "packet amber", top + 8, bot - 8, "4s"], [2.4, "packet", bot - 8, top + 8, "3.6s"]].forEach(([delay, cls, from, to, dur]) => {
        const c = svgEl("circle", { class: cls, cx: bx, cy: from, r: 3.5 });
        c.appendChild(svgEl("animate", { attributeName: "cy", from, to, dur, begin: delay + "s", repeatCount: "indefinite" }));
        svg.appendChild(c);
      });
    }
    $("#layer-info").innerHTML = "<b>Hover a layer.</b> Most people work in one of these. I work across all five.";
  }

  /* =====================================================================
     DEMO DATA GENERATORS (used only when config.demo is true)
     ===================================================================== */
  const ZONES = [
    { id: "living", name: "Living Room", base: 74.2, amp: 1.6, ph: 0.0, sp: 74, rh: 52 },
    { id: "kitchen", name: "Kitchen", base: 75.4, amp: 2.0, ph: 0.6, sp: 74, rh: 55 },
    { id: "office", name: "Office", base: 73.1, amp: 1.2, ph: 0.3, sp: 72, rh: 49 },
    { id: "bedroom", name: "Bedroom", base: 71.8, amp: 1.0, ph: 2.4, sp: 71, rh: 51 },
    { id: "rack", name: "Rack Closet", base: 79.3, amp: 1.4, ph: 0.9, sp: 78, rh: 41 },
    { id: "hall", name: "Hallway", base: 74.6, amp: 1.1, ph: 0.4, sp: 74, rh: 53 },
    { id: "outdoor", name: "Outdoor", base: 81, amp: 5.5, ph: -0.6, sp: null, rh: 72 }
  ];
  const noise = (seed) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };
  function tempAt(z, t) {
    const day = (t / 3.6e6) % 24;
    return z.base + z.amp * Math.sin(((day - 9) / 24) * 2 * Math.PI + z.ph) + (noise(Math.floor(t / 9e5) + z.base) - 0.5) * 0.5;
  }
  function demoBMS() {
    const now = Date.now();
    const zones = ZONES.map((z) => ({
      id: z.id, name: z.name, sp: z.sp, temp: tempAt(z, now),
      rh: z.rh + (noise(Math.floor(now / 6e5) + z.rh) - 0.5) * 3,
      trend: Array.from({ length: 97 }, (_, i) => { const t = now - (96 - i) * 9e5; return [t, +tempAt(z, t).toFixed(2)]; })
    }));
    const rack = zones.find((z) => z.id === "rack");
    const alarms = [];
    if (rack.temp > 80) alarms.push({ sev: "warn", active: true, text: "Rack Closet temp above 80°F", time: now - 22 * 6e4 });
    alarms.push({ sev: "ok", active: false, text: "Office sensor communication restored", time: now - 3.2 * 3.6e6 });
    alarms.push({ sev: "ok", active: false, text: "Kitchen humidity returned to normal", time: now - 9.5 * 3.6e6 });
    const points = []; let ai = 1, av = 1;
    zones.forEach((z) => {
      const tag = z.id === "outdoor" ? "OA" : z.id.toUpperCase().slice(0, 3) + "-ZN";
      points.push({ obj: "AI-" + ai++, name: `${tag}-T`, desc: z.name + " temperature", value: z.temp.toFixed(1), units: "°F", flags: { a: z.id === "rack" && z.temp > 80 } });
      points.push({ obj: "AI-" + ai++, name: `${tag}-RH`, desc: z.name + " humidity", value: z.rh.toFixed(0), units: "%RH", flags: {} });
      if (z.sp != null) points.push({ obj: "AV-" + av++, name: `${tag}-SP`, desc: z.name + " setpoint", value: z.sp.toFixed(1), units: "°F", flags: { o: z.id === "office" } });
    });
    points.push({ obj: "BI-1", name: "RCK-FAN-S", desc: "Rack exhaust fan status", value: "On", units: "", flags: {} });
    return { updated: now, zones, alarms, points };
  }
  function demoLab() {
    const now = Date.now();
    const j = (s, a) => Math.max(1, Math.min(99, s + (noise(Math.floor(now / 5e3) + a) - 0.5) * 8));
    const guests = [
      { vmid: 100, name: "net-lab (CML)", type: "qemu", status: "running", cpu: j(34, 1), mem: [12, 16] },
      { vmid: 101, name: "ubuntu-dev", type: "qemu", status: "running", cpu: j(6, 2), mem: [3.1, 8] },
      { vmid: 102, name: "win-server-2022", type: "qemu", status: "stopped", cpu: 0, mem: [0, 8] },
      { vmid: 200, name: "sensreys-core", type: "lxc", status: "running", cpu: j(4, 3), mem: [0.9, 2] },
      { vmid: 201, name: "docker-host", type: "lxc", status: "running", cpu: j(11, 4), mem: [2.6, 6] },
      { vmid: 202, name: "dns-filter", type: "lxc", status: "running", cpu: j(2, 5), mem: [0.3, 1] },
      { vmid: 203, name: "homelab-agent", type: "lxc", status: "running", cpu: j(1, 6), mem: [0.2, 0.5] }
    ];
    const run = guests.filter((g) => g.status === "running");
    return {
      updated: now,
      nodes: [{ name: "pve", status: "online", uptime_days: 37, cpu: run.reduce((s, g) => s + g.cpu, 0) / 4, mem: [run.reduce((s, g) => s + g.mem[0], 0) + 2.2, 64], disks: [{ name: "local-lvm", used: 612, total: 1800 }, { name: "backups", used: 1240, total: 4000 }] }],
      guests,
      network: [
        { name: "Router / firewall", ip: "10.0.0.1", status: "up", ms: 0.6 },
        { name: "Core switch", ip: "10.0.0.2", status: "up", ms: 0.9 },
        { name: "Wi-Fi access point", ip: "10.0.0.3", status: "up", ms: 2.1 },
        { name: "Sensreys sensor gateway", ip: "10.0.20.10", status: "up", ms: 3.4 },
        { name: "Internet (1.1.1.1)", ip: "1.1.1.1", status: "up", ms: 11.8 }
      ]
    };
  }

  /* =====================================================================
     MY LIVE BMS
     ===================================================================== */
  const zoneById = (b, id) => b.zones.find((z) => z.id === id);
  const RAMP = [[47, 127, 184], [57, 194, 178], [240, 180, 76], [239, 107, 90]];
  function tempColor(t, a = 0.3) {
    const f = Math.max(0, Math.min(1, (t - 66) / 16)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(f)), r = f - i;
    const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * r));
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  const ROOMS = { living: [20, 20, 300, 200], kitchen: [320, 20, 140, 130], office: [460, 20, 120, 130], bedroom: [320, 150, 260, 190], rack: [20, 220, 120, 120], hall: [140, 220, 180, 120] };

  function renderBMS() {
    const b = state.gated && state.gated.bms;
    if (!b || !b.zones) { $("#bms-kpis").innerHTML = `<div class="panel muted">Waiting for the first report from ${esc(C.bmsPlatform)}.</div>`; return; }
    const st = $("#bms-status");
    const stale = Date.now() - b.updated > 15 * 6e4;
    st.className = C.demo ? "chip warn" : stale ? "chip warn" : "chip ok live";
    st.innerHTML = `<span class="dot"></span>${C.demo ? "Sample data" : stale ? "Last seen " + ago(b.updated) : "Live"}`;
    const indoor = b.zones.filter((z) => z.id !== "outdoor");
    const out = zoneById(b, "outdoor");
    const act = b.alarms.filter((a) => a.active);
    $("#bms-kpis").innerHTML = [
      [out ? out.temp.toFixed(1) + "°F" : "--", "Outdoor air"],
      [indoor.length ? (indoor.reduce((s, z) => s + z.temp, 0) / indoor.length).toFixed(1) + "°F" : "--", "Average indoor"],
      [indoor.length ? (indoor.reduce((s, z) => s + z.rh, 0) / indoor.length).toFixed(0) + "%" : "--", "Average humidity"],
      [String(act.length), "Active alarms"]
    ].map(([v, l], i) => `<div class="panel kpi"><span class="v" style="${i === 3 && act.length ? "color:var(--warn)" : ""}">${v}</span><span class="l">${l}</span></div>`).join("");

    const fp = $("#floorplan"); fp.innerHTML = "";
    indoor.forEach((z) => {
      const R = ROOMS[z.id]; if (!R) return;
      const [x, y, w, h] = R;
      const g = svgEl("g", { class: "zone" + (z.id === state.zone ? " sel" : ""), tabindex: "0", role: "button", "aria-label": `${z.name}, ${z.temp.toFixed(1)} degrees` });
      const r = svgEl("rect", { x: x + 3, y: y + 3, width: w - 6, height: h - 6, rx: 6 }); r.style.fill = tempColor(z.temp, 0.28);
      const n = svgEl("text", { class: "n", x: x + 14, y: y + 26 }); n.textContent = z.name;
      const t = svgEl("text", { class: "t", x: x + 14, y: y + h - 34 }); t.textContent = z.temp.toFixed(1) + "°";
      const s = svgEl("text", { x: x + 14, y: y + h - 15 }); s.textContent = `${z.rh.toFixed(0)}% RH${z.sp != null ? " · SP " + z.sp + "°" : ""}`;
      g.append(r, n, t, s);
      const pick = () => { state.zone = z.id; renderBMS(); };
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      fp.appendChild(g);
    });
    $("#bms-updated").textContent = "Updated " + new Date(b.updated).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

    $("#alarm-count").className = "chip " + (act.length ? "warn" : "ok");
    $("#alarm-count").innerHTML = `<span class="dot"></span>${act.length} active`;
    const sevColor = { crit: "var(--crit)", warn: "var(--warn)", ok: "var(--off)" };
    $("#alarms").innerHTML = b.alarms.length ? b.alarms.map((a) => `
      <div class="alarm"><span class="stripe" style="background:${a.active ? sevColor[a.sev] : "var(--off)"}"></span>
      <div>${esc(a.text)}<small>${a.active ? "Active" : "Cleared"} · ${ago(a.time)}</small></div>
      <span class="chip ${a.active ? a.sev : "off"}">${a.active ? "ALARM" : "NORMAL"}</span></div>`).join("") : '<p class="muted">No alarms.</p>';

    const flag = (on, ch, cls = "") => `<span class="flag ${on ? "on " + cls : ""}" title="${{ A: "In alarm", F: "Fault", O: "Overridden", S: "Out of service" }[ch]}">${ch}</span>`;
    $("#points").innerHTML = `<thead><tr><th>Object</th><th>Name</th><th>Description</th><th class="num">Present value</th><th>Flags</th></tr></thead><tbody>` +
      b.points.map((p) => `<tr><td class="obj">${esc(p.obj)}</td><td class="mono">${esc(p.name)}</td><td class="muted">${esc(p.desc)}</td>
        <td class="num"><b>${esc(p.value)}</b> <span class="muted">${esc(p.units)}</span></td>
        <td><span class="flags">${flag(p.flags.a, "A")}${flag(p.flags.f, "F")}${flag(p.flags.o, "O", "ovr")}${flag(p.flags.s, "S")}</span></td></tr>`).join("") + "</tbody>";
    if (state.view === "bms") renderTrend();
  }

  function renderTrend() {
    const b = state.gated && state.gated.bms; if (!b || !b.zones) return;
    const z = zoneById(b, state.zone) || b.zones[0];
    const svg = $("#trend");
    const W = Math.max(280, Math.round(svg.getBoundingClientRect().width) || 400), H = 190;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    $("#trend-title").textContent = z.name + " temperature";
    const pts = z.trend || [];
    if (pts.length < 2) return;
    const vals = pts.map((p) => p[1]).concat(z.sp != null ? [z.sp] : []);
    let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 4) { const m = (hi + lo) / 2; lo = Math.floor(m - 2); hi = Math.ceil(m + 2); }
    const L = 34, R = 10, T = 10, B = 24;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const grid = svgEl("g", { class: "grid" });
    const step = Math.max(1, Math.round((hi - lo) / 4));
    for (let v = lo; v <= hi; v += step) {
      grid.appendChild(svgEl("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v) }));
      const tx = svgEl("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end" }); tx.textContent = v + "°"; grid.appendChild(tx);
    }
    [0, 0.5, 1].forEach((f) => {
      const t = t0 + f * (t1 - t0);
      const tx = svgEl("text", { x: X(t), y: H - 6, "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle" });
      tx.textContent = f === 1 ? "now" : new Date(t).toLocaleTimeString([], { hour: "numeric" });
      grid.appendChild(tx);
    });
    svg.appendChild(grid);
    const defs = svgEl("defs"); const lg = svgEl("linearGradient", { id: "tg", x1: 0, x2: 0, y1: 0, y2: 1 });
    lg.append(svgEl("stop", { offset: "0", "stop-color": "var(--accent)", "stop-opacity": ".35" }), svgEl("stop", { offset: "1", "stop-color": "var(--accent)", "stop-opacity": "0" }));
    defs.appendChild(lg); svg.appendChild(defs);
    const line = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    svg.appendChild(svgEl("path", { d: line + ` L${X(t1)} ${H - B} L${X(t0)} ${H - B} Z`, fill: "url(#tg)" }));
    if (z.sp != null) {
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: Y(z.sp), y2: Y(z.sp), stroke: "var(--amber)", "stroke-dasharray": "4 4", "stroke-width": 1.2 }));
      const s = svgEl("text", { x: W - R, y: Y(z.sp) - 5, "text-anchor": "end", fill: "var(--amber)" }); s.textContent = "SP " + z.sp + "°"; svg.appendChild(s);
    }
    svg.appendChild(svgEl("path", { d: line, fill: "none", stroke: "var(--accent)", "stroke-width": 2, "stroke-linejoin": "round" }));
    const last = pts[pts.length - 1];
    svg.appendChild(svgEl("circle", { cx: X(last[0]), cy: Y(last[1]), r: 4, fill: "var(--accent)", stroke: "var(--panel)", "stroke-width": 2 }));
  }

  /* =====================================================================
     HOME LAB
     ===================================================================== */
  function meter(label, used, total, unit) {
    const pct = total ? (used / total) * 100 : 0;
    const cls = pct > 90 ? "crit" : pct > 75 ? "warn" : "";
    return `<div class="meter"><div class="top"><span>${esc(label)}</span><span class="num muted">${unit === "%" ? pct.toFixed(0) + "%" : `${used.toFixed(unit === "GiB" ? 1 : 0)} / ${total} ${unit}`}</span></div>
      <div class="bar"><div class="fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div></div>`;
  }
  function renderLab() {
    const L = state.gated && state.gated.lab;
    if (!L || !L.nodes) { $("#lab-body").innerHTML = '<div class="panel muted">Waiting for the first report from the home agent.</div>'; return; }
    const healthy = L.nodes.every((n) => n.status === "online") && L.network.every((d) => d.status === "up");
    const st = $("#lab-status");
    st.className = "chip " + (healthy ? "ok live" : "warn");
    st.innerHTML = `<span class="dot"></span>${C.demo ? "Sample data" : healthy ? "All systems normal" : "Needs attention"}`;
    const running = L.guests.filter((g) => g.status === "running").length;
    $("#lab-kpis").innerHTML = [
      [L.nodes.filter((n) => n.status === "online").length, "Proxmox nodes online"],
      [`${running} / ${L.guests.length}`, "VMs & containers running"],
      [`${L.network.filter((d) => d.status === "up").length} / ${L.network.length}`, "Network devices up"],
      [Math.max(...L.nodes.map((n) => n.uptime_days)) + " d", "Uptime"]
    ].map(([v, l]) => `<div class="panel kpi"><span class="v">${v}</span><span class="l">${l}</span></div>`).join("");
    const nodes = L.nodes.map((n) => `
      <div class="panel">
        <div class="node-head"><div><h3 class="mono">${esc(n.name)}</h3><span class="muted" style="font-size:.85rem">Proxmox VE node · up ${n.uptime_days} days</span></div>
        <span class="chip ${n.status === "online" ? "ok" : "crit"}"><span class="dot"></span>${esc(n.status)}</span></div>
        <div class="grid" style="gap:14px">${meter("CPU", n.cpu, 100, "%")}${meter("Memory", n.mem[0], n.mem[1], "GiB")}${n.disks.map((d) => meter("Storage · " + d.name, d.used, d.total, "GB")).join("")}</div>
      </div>`).join("");
    const net = `
      <div class="panel">
        <div class="node-head"><h3>Network devices</h3><span class="muted" style="font-size:.85rem">ICMP from the home agent</span></div>
        <div class="table-wrap"><table><thead><tr><th>Device</th><th>Address</th><th>Status</th><th class="num">Latency</th></tr></thead>
        <tbody>${L.network.map((d) => `<tr><td>${esc(d.name)}</td><td class="obj">${esc(d.ip)}</td>
          <td><span class="chip ${d.status === "up" ? "ok" : "crit"}"><span class="dot"></span>${esc(d.status)}</span></td>
          <td class="num">${d.ms != null ? d.ms.toFixed(1) + " ms" : "--"}</td></tr>`).join("")}</tbody></table></div>
      </div>`;
    const guests = `
      <div class="panel">
        <div class="node-head"><h3>Virtual machines &amp; containers</h3><span class="muted" style="font-size:.85rem">Updated ${ago(L.updated)}</span></div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Status</th><th>CPU</th><th class="num">Memory</th></tr></thead>
        <tbody>${L.guests.map((g) => `<tr><td class="obj">${g.vmid}</td><td class="mono">${esc(g.name)}</td>
          <td class="muted">${g.type === "lxc" ? "Container" : "VM"}</td>
          <td><span class="chip ${g.status === "running" ? "ok" : "off"}"><span class="dot"></span>${esc(g.status)}</span></td>
          <td class="num"><span class="mini-bar"><span style="width:${g.cpu.toFixed(0)}%"></span></span>${g.cpu.toFixed(0)}%</td>
          <td class="num">${g.mem[0].toFixed(1)} / ${g.mem[1]} GiB</td></tr>`).join("")}</tbody></table></div>
      </div>`;
    $("#lab-body").innerHTML = `<div class="grid g2" style="margin-bottom:16px">${nodes}${net}</div>${guests}`;
  }

  /* =====================================================================
     PROJECTS
     ===================================================================== */
  const STATUS = { active: ["ok", "Active"], building: ["accent", "Building"], paused: ["warn", "Paused"], shipped: ["ok", "Shipped"], archived: ["off", "Archived"] };
  let rafs = [];
  function renderProjects() {
    rafs.forEach(cancelAnimationFrame); rafs = [];
    const all = (state.gated && state.gated.projects) || [];
    const f = state.projFilter;
    const feats = f === "archived" ? [] : all.filter((p) => p.featured);
    $("#proj-feature").innerHTML = feats.map((p) => {
      const [cls, lbl] = STATUS[p.status] || STATUS.active;
      return `<div class="panel feature">
        <div class="art"><canvas data-art="${p.id === "baseball" ? "diamond" : "network"}" aria-hidden="true"></canvas></div>
        <div class="body">
          <div style="display:flex;gap:8px;flex-wrap:wrap"><span class="chip ${cls}"><span class="dot"></span>${lbl}</span><span class="chip">Featured</span></div>
          <h2>${esc(p.title)}</h2>
          <p class="muted">${esc(p.summary)}</p>
          ${p.milestones ? `<ul class="milestones">${p.milestones.map((m) => `<li><span class="check ${m.done ? "done" : ""}">${m.done ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#06231a" stroke-width="4"><path d="M5 12l5 5L20 7"/></svg>' : ""}</span>${esc(m.text)}</li>`).join("")}</ul>` : ""}
          <div class="tags">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
          ${p.link ? `<a href="${esc(p.link)}" style="font-weight:600">Open →</a>` : ""}
        </div></div>`;
    }).join("");
    $$("#proj-feature canvas").forEach((cv) => (cv.dataset.art === "diamond" ? drawDiamond : drawNetwork)(cv));
    const rest = all.filter((p) => !p.featured).filter((p) => f === "all" || (f === "archived" ? p.status === "archived" : p.status !== "archived"));
    $("#proj-grid").innerHTML = rest.map((p) => {
      const [cls, lbl] = STATUS[p.status] || STATUS.active;
      return `<div class="panel project ${p.status === "archived" ? "archived" : ""}">
        <div class="top"><h3>${esc(p.title)}</h3><span class="chip ${cls}"><span class="dot"></span>${lbl}</span></div>
        <p>${esc(p.summary)}</p>
        <div class="tags">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        ${p.link ? `<a href="${esc(p.link)}" style="font-size:.9rem;font-weight:600">Open →</a>` : ""}
      </div>`;
    }).join("");
  }
  $$("#proj-filters button").forEach((b) => b.addEventListener("click", () => {
    state.projFilter = b.dataset.f;
    $$("#proj-filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderProjects();
  }));

  function canvasLoop(cv, draw) {
    const ctx = cv.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const start = performance.now();
    let id;
    const frame = (now) => {
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      draw(ctx, r.width, r.height, reduceMotion ? 2.6 : (now - start) / 1000, col);
      if (!reduceMotion) { id = requestAnimationFrame(frame); rafs.push(id); }
    };
    id = requestAnimationFrame(frame); rafs.push(id);
  }
  function drawDiamond(cv) {
    canvasLoop(cv, (ctx, W, H, time, col) => {
      const cx = W / 2, hy = H * 0.88, s = Math.min(W, H * 1.1) * 0.3;
      const home = [cx, hy], first = [cx + s, hy - s], second = [cx, hy - 2 * s], third = [cx - s, hy - s];
      ctx.strokeStyle = col("--line"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, hy, s * 2.35, Math.PI * 1.25, Math.PI * 1.75); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...home); ctx.lineTo(cx + s * 1.66, hy - s * 1.66); ctx.moveTo(...home); ctx.lineTo(cx - s * 1.66, hy - s * 1.66); ctx.stroke();
      ctx.fillStyle = "rgba(57,194,178,.08)"; ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(...home); ctx.lineTo(...first); ctx.lineTo(...second); ctx.lineTo(...third); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col("--ink");
      [first, second, third].forEach(([x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore(); });
      ctx.beginPath(); ctx.moveTo(cx - 6, hy); ctx.lineTo(cx + 6, hy); ctx.lineTo(cx + 6, hy + 5); ctx.lineTo(cx, hy + 10); ctx.lineTo(cx - 6, hy + 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col("--panel"); ctx.strokeStyle = col("--muted"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, hy - s, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const T = time % 4;
      let bx, by, z = 0;
      if (T < 1) { bx = cx; by = hy - s + T * s; }
      else { const k = Math.min(1, (T - 1) / 2.2), tx = cx + s * 1.1, ty = hy - s * 2.25; bx = cx + (tx - cx) * k; by = hy + (ty - hy) * k; z = Math.sin(k * Math.PI) * s * 0.45; }
      if (T >= 1) { ctx.strokeStyle = "rgba(240,180,76,.5)"; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(cx, hy); ctx.quadraticCurveTo((cx + bx) / 2, (hy + by) / 2 - s * 0.7, bx, by - z); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(bx, by, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col("--amber"); ctx.beginPath(); ctx.arc(bx, by - z, 5, 0, Math.PI * 2); ctx.fill();
    });
  }
  // Sensreys: a supervisor talking to controllers on a trunk, with traffic pulses.
  function drawNetwork(cv) {
    canvasLoop(cv, (ctx, W, H, time, col) => {
      const sx = W / 2, sy = H * 0.22, trunkY = H * 0.55, n = 5;
      const xs = Array.from({ length: n }, (_, i) => W * 0.14 + (i * W * 0.72) / (n - 1));
      ctx.strokeStyle = col("--line"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy + 18); ctx.lineTo(sx, trunkY); ctx.moveTo(xs[0], trunkY); ctx.lineTo(xs[n - 1], trunkY); ctx.stroke();
      xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, trunkY); ctx.lineTo(x, trunkY + 30); ctx.stroke(); });
      // supervisor
      ctx.fillStyle = col("--panel"); ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(sx - 52, sy - 18, 104, 36, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col("--ink"); ctx.font = "600 12px IBM Plex Mono, monospace"; ctx.textAlign = "center"; ctx.fillText("SENSREYS", sx, sy + 4);
      // controllers
      xs.forEach((x, i) => {
        const on = Math.sin(time * 3 + i * 1.7) > -0.2;
        ctx.fillStyle = col("--panel-2"); ctx.strokeStyle = col("--line");
        ctx.beginPath(); ctx.roundRect(x - 18, trunkY + 30, 36, 26, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = on ? col("--ok") : col("--off"); ctx.beginPath(); ctx.arc(x - 8, trunkY + 43, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col("--muted"); ctx.font = "10px IBM Plex Mono, monospace"; ctx.fillText(String(i + 1), x + 6, trunkY + 47);
      });
      // packets
      for (let k = 0; k < 3; k++) {
        const ph = ((time * 0.45 + k / 3) % 1), target = xs[(Math.floor(time * 0.45 + k / 3) * 2 + k) % n];
        let px, py;
        if (ph < 0.4) { px = sx; py = sy + 18 + (trunkY - sy - 18) * (ph / 0.4); }
        else if (ph < 0.8) { px = sx + (target - sx) * ((ph - 0.4) / 0.4); py = trunkY; }
        else { px = target; py = trunkY + 30 * ((ph - 0.8) / 0.2); }
        ctx.fillStyle = k === 1 ? col("--amber") : col("--accent"); ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = col("--muted"); ctx.font = "11px IBM Plex Mono, monospace"; ctx.fillText("BACnet trunk", W / 2, trunkY + 80);
    });
  }

  /* =====================================================================
     GOALS
     ===================================================================== */
  function renderGoals() {
    const goals = (state.gated && state.gated.goals) || [];
    const H = [["now", "Now", "next few months"], ["year", "This year", "12 months"], ["long", "Long term", "3–5 years"]];
    $("#horizons").innerHTML = H.map(([k, label, span]) => `
      <div class="horizon"><h3>${label}<span>${span}</span></h3>
      ${goals.filter((g) => g.horizon === k).map((g) => `<div class="goal"><h4>${esc(g.title)}</h4>${g.note ? `<p>${esc(g.note)}</p>` : ""}</div>`).join("") || '<p class="muted">Nothing here yet.</p>'}
      </div>`).join("");
  }

  /* =====================================================================
     OWNER PAGE: generate and revoke visitor codes, edit private content
     ===================================================================== */
  async function renderAdmin() {
    const body = $("#admin-body");
    let owner = isOwner();
    if (!owner) { try { await api.listCodes(); owner = true; } catch (e) { owner = false; } } // Access cookie may only reach /api/admin
    if (!owner) {
      body.innerHTML = `<div class="panel locked">${LOCK(30)}<h2 style="margin-top:12px">Owner sign-in</h2>
        <p>This page is only for me. Sign in with my owner account to manage visitor codes.</p>
        <a class="btn primary" href="${esc(C.apiBase)}/login">Sign in as owner</a></div>`;
      return;
    }
    body.innerHTML = `
      <div class="panel" style="margin-bottom:16px">
        <h3 style="margin-bottom:14px">Create a code</h3>
        <form id="code-form" class="form-row">
          <label class="field" for="c-label">Who is it for?<input id="c-label" placeholder="e.g. Jane at Acme Controls" maxlength="60" required></label>
          <label class="field" for="c-days">Expires<select id="c-days"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="0">Never</option></select></label>
          <label class="field" for="c-uses">Max unlocks<select id="c-uses"><option value="1">1</option><option value="3" selected>3</option><option value="10">10</option><option value="0">Unlimited</option></select></label>
          <button class="btn primary" type="submit">Generate</button>
        </form>
        <div id="new-code"></div>
      </div>
      <div class="panel" style="margin-bottom:16px">
        <div class="node-head"><h3>Codes</h3><span class="muted" style="font-size:.85rem">Codes are stored hashed. Copy a new code when it's shown; it can't be displayed again.</span></div>
        <div class="table-wrap"><table id="codes-table"></table></div>
      </div>
      <div class="panel">
        <div class="node-head"><h3>Projects &amp; goals</h3><span class="muted" style="font-size:.85rem">Private content shown to visitors with a code. JSON.</span></div>
        <label class="field" for="content-json"><span class="sr-only">Projects and goals JSON</span><textarea id="content-json" spellcheck="false"></textarea></label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><button class="btn primary" id="save-content" type="button">Save content</button><span class="form-msg" id="content-msg" style="margin:0"></span></div>
      </div>`;
    $("#code-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#new-code");
      try {
        const r = await api.createCode({ label: $("#c-label").value.trim(), days: +$("#c-days").value, maxUses: +$("#c-uses").value });
        const link = location.origin + location.pathname + "#home";
        out.innerHTML = `<div class="new-code"><span class="mono" id="nc">${esc(r.code)}</span>
          <button class="btn sm" type="button" id="copy-code">Copy code</button>
          <button class="btn sm" type="button" id="copy-msg">Copy message</button>
          <span class="form-msg" id="copy-status" style="margin:0"></span></div>`;
        const copy = async (text) => { try { await navigator.clipboard.writeText(text); $("#copy-status").textContent = "Copied"; $("#copy-status").className = "form-msg ok"; } catch (err) { $("#copy-status").textContent = "Select the code and copy it manually."; } };
        $("#copy-code").addEventListener("click", () => copy(r.code));
        $("#copy-msg").addEventListener("click", () => copy(`Here's access to my live BMS, home lab and projects: ${link}\nClick "Access code" and enter: ${r.code}`));
        $("#c-label").value = "";
        loadCodes();
      } catch (err) { out.innerHTML = `<p class="form-msg err">${esc(err.message)}</p>`; }
    });
    $("#save-content").addEventListener("click", async () => {
      const m = $("#content-msg");
      let parsed;
      try { parsed = JSON.parse($("#content-json").value); } catch (err) { m.textContent = "That isn't valid JSON: " + err.message; m.className = "form-msg err"; return; }
      if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.goals)) { m.textContent = 'Needs "projects" and "goals" lists.'; m.className = "form-msg err"; return; }
      try { await api.putContent(parsed); m.textContent = "Saved."; m.className = "form-msg ok"; refreshGated.didStatic = false; if (hasAccess()) refreshGated(); }
      catch (err) { m.textContent = err.message; m.className = "form-msg err"; }
    });
    loadCodes();
    try { $("#content-json").value = JSON.stringify(await api.getContent(), null, 2); } catch (e) { $("#content-json").value = '{ "projects": [], "goals": [] }'; }
  }
  async function loadCodes() {
    const t = $("#codes-table"); if (!t) return;
    try {
      const { codes } = await api.listCodes();
      const now = Date.now();
      t.innerHTML = `<thead><tr><th>For</th><th>Created</th><th>Expires</th><th class="num">Unlocks</th><th>Status</th><th></th></tr></thead><tbody>` +
        (codes.length ? codes.sort((a, b) => b.created - a.created).map((c) => {
          const status = c.revoked ? ["off", "Revoked"] : c.expires && c.expires < now ? ["off", "Expired"] : c.maxUses && c.uses >= c.maxUses ? ["warn", "Used up"] : ["ok", "Active"];
          return `<tr><td>${esc(c.label)}</td><td class="muted">${fmtDate(c.created)}</td><td class="muted">${c.expires ? fmtDate(c.expires) : "Never"}</td>
            <td class="num">${c.uses}${c.maxUses ? " / " + c.maxUses : ""}</td>
            <td><span class="chip ${status[0]}"><span class="dot"></span>${status[1]}</span></td>
            <td style="text-align:right">${status[1] === "Active" ? `<button class="btn sm danger" type="button" data-revoke="${esc(c.id)}">Revoke</button>` : ""}</td></tr>`;
        }).join("") : '<tr><td colspan="6" class="muted">No codes yet.</td></tr>') + "</tbody>";
      $$("[data-revoke]", t).forEach((b) => b.addEventListener("click", async () => { b.disabled = true; await api.revokeCode(b.dataset.revoke); loadCodes(); }));
    } catch (e) { t.innerHTML = `<tbody><tr><td class="form-msg err">${esc(e.message)}</td></tr></tbody>`; }
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  function boot() {
    $("#preview-bar").hidden = !C.demo;
    renderHome();
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", () => { if (state.view === "bms") renderTrend(); });
    route();
    loadAccess();
    setInterval(() => { if (hasAccess()) refreshGated(); }, C.demo ? 5000 : 60000);
  }
  if (C.demo && !window.DEMO_CONTENT) {
    const s = document.createElement("script");
    s.src = "assets/demo-content.js"; s.onload = boot; s.onerror = boot;
    document.head.appendChild(s);
  } else boot();
})();
