/**
 * reydelgutierrez.com API: Cloudflare Worker
 * Route: www.reydelgutierrez.com/api/*   (same origin as the site, so no CORS)
 *
 * Bindings (wrangler.toml):
 *   KV namespace   STATUS
 *   secret         INGEST_TOKEN        long random string shared with the home agent / Sensreys
 *   var            ACCESS_TEAM_DOMAIN  e.g. "reydel.cloudflareaccess.com"
 *   var            ACCESS_AUD          Application Audience (AUD) tag of the Cloudflare Access app
 *
 * Who can see what
 *   public  : the home page (static files; nothing here)
 *   visitor : someone who entered a valid access code → session cookie → /api/gated
 *   owner   : you, signed in through Cloudflare Access → everything + /api/admin/*
 *
 * KV keys
 *   status            { bms, lab, updated }            pushed by the home agent
 *   content           { projects, goals }              edited on the Owner page
 *   code:<sha256>     { id, label, created, expires, maxUses, uses, revoked }
 *   sess:<token>      { codeKey, label, expires }      TTL'd
 *   rl:<ip>           unlock attempt counter           TTL 15 min
 */
const SESSION_COOKIE = "rg_session";
const SESSION_MAX = 7 * 24 * 3600;       // a visitor session lasts at most 7 days
const MAX_ATTEMPTS = 10;                  // unlock attempts per IP per 15 minutes

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const m = req.method;
    try {
      if (path === "/api/ingest" && m === "POST") return await ingest(req, env);
      if (path === "/api/session" && m === "GET") return await session(req, env);
      if (path === "/api/unlock" && m === "POST") return await unlock(req, env);
      if (path === "/api/logout" && m === "POST") return logout(req, env);
      if (path === "/api/gated" && m === "GET") return await gated(req, env);
      if (path === "/api/login") { await requireOwner(req, env); return Response.redirect(url.origin + "/#admin", 302); }

      if (path.startsWith("/api/admin/")) {
        await requireOwner(req, env);
        if (path === "/api/admin/codes" && m === "GET") return await listCodes(env);
        if (path === "/api/admin/codes" && m === "POST") return await createCode(req, env);
        if (path === "/api/admin/codes/revoke" && m === "POST") return await revokeCode(req, env);
        if (path === "/api/admin/content" && m === "GET") return json((await env.STATUS.get("content", "json")) || { projects: [], goals: [] });
        if (path === "/api/admin/content" && m === "PUT") return await putContent(req, env);
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? "Something went wrong on the server." : e.message }, status);
    }
  }
};

/* ---------------- helpers ---------------- */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
const fail = (status, message) => Object.assign(new Error(message), { status });
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cookies(req) {
  const out = {};
  (req.headers.get("cookie") || "").split(/;\s*/).forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
function randomToken(bytes = 32) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
function makeCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
  return `RG-${s.slice(0, 4)}-${s.slice(4)}`;
}
function normalizeCode(code) {
  const s = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("RG") ? s.slice(2) : s;
  return body.length === 8 ? `RG-${body.slice(0, 4)}-${body.slice(4)}` : null;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function codeUsable(c) {
  if (!c || c.revoked) return false;
  if (c.expires && c.expires < Date.now()) return false;
  return true;
}

/* ---------------- who is asking ---------------- */
async function visitor(req, env) {
  const tok = cookies(req)[SESSION_COOKIE];
  if (!tok || !/^[a-f0-9]{64}$/.test(tok)) return null;
  const s = await env.STATUS.get("sess:" + tok, "json");
  if (!s || s.expires < Date.now()) return null;
  const c = await env.STATUS.get(s.codeKey, "json");
  if (!codeUsable(c)) return null;                 // revoking a code ends its sessions too
  return { role: "visitor", label: c.label, expires: s.expires };
}
async function owner(req, env) {
  try { return await requireOwner(req, env); } catch (e) { return null; }
}
async function whoami(req, env) {
  if (await owner(req, env)) return { role: "owner", label: "Owner", expires: 0 };
  return await visitor(req, env);
}

/* ---------------- visitor endpoints ---------------- */
async function session(req, env) {
  return json((await whoami(req, env)) || { role: null });
}

async function unlock(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const rlKey = "rl:" + ip;
  const tries = parseInt((await env.STATUS.get(rlKey)) || "0", 10);
  if (tries >= MAX_ATTEMPTS) throw fail(429, "Too many tries. Wait 15 minutes and try again.");

  const { code } = await req.json().catch(() => ({}));
  const norm = normalizeCode(code);
  const key = norm ? "code:" + (await sha256(norm)) : null;
  const c = key ? await env.STATUS.get(key, "json") : null;
  const bad = async (msg) => { await env.STATUS.put(rlKey, String(tries + 1), { expirationTtl: 900 }); throw fail(401, msg); };

  if (!c || c.revoked) await bad("That code isn't valid. Check it and try again.");
  if (c.expires && c.expires < Date.now()) await bad("That code has expired. Ask me for a new one.");
  if (c.maxUses && c.uses >= c.maxUses) await bad("That code has already been used the maximum number of times.");

  c.uses = (c.uses || 0) + 1;
  c.lastUsed = Date.now();
  await env.STATUS.put(key, JSON.stringify(c));

  const expires = Math.min(c.expires || Infinity, Date.now() + SESSION_MAX * 1000);
  const ttl = Math.max(60, Math.floor((expires - Date.now()) / 1000));
  const tok = randomToken();
  await env.STATUS.put("sess:" + tok, JSON.stringify({ codeKey: key, label: c.label, expires }), { expirationTtl: ttl });
  return json({ role: "visitor", label: c.label, expires }, 200, {
    "set-cookie": `${SESSION_COOKIE}=${tok}; Path=/api; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Lax`
  });
}

async function logout(req, env) {
  const tok = cookies(req)[SESSION_COOKIE];
  if (tok && /^[a-f0-9]{64}$/.test(tok)) await env.STATUS.delete("sess:" + tok);
  return json({ ok: true }, 200, { "set-cookie": `${SESSION_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
}

async function gated(req, env) {
  const who = await whoami(req, env);
  if (!who) throw fail(401, "Access code required.");
  const [status, content] = await Promise.all([env.STATUS.get("status", "json"), env.STATUS.get("content", "json")]);
  return json({ bms: status?.bms || null, lab: status?.lab || null, projects: content?.projects || [], goals: content?.goals || [] });
}

/* ---------------- home agent / Sensreys ingest ---------------- */
async function ingest(req, env) {
  const auth = req.headers.get("authorization") || "";
  if (!env.INGEST_TOKEN || !timingSafeEqual(auth, "Bearer " + env.INGEST_TOKEN)) throw fail(401, "unauthorized");
  const body = await req.json();
  const now = Date.now();
  const prev = (await env.STATUS.get("status", "json")) || {};
  const next = {
    bms: body.bms ? { ...body.bms, updated: now } : prev.bms || null,
    lab: body.lab ? { ...body.lab, updated: now } : prev.lab || null,
    updated: now
  };
  await env.STATUS.put("status", JSON.stringify(next)); // one KV write per report
  return json({ ok: true });
}

/* ---------------- owner endpoints ---------------- */
async function listCodes(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.STATUS.list({ prefix: "code:", cursor });
    for (const k of page.keys) { const v = await env.STATUS.get(k.name, "json"); if (v) out.push(v); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return json({ codes: out });
}

async function createCode(req, env) {
  const { label, days, maxUses } = await req.json().catch(() => ({}));
  const cleanLabel = String(label || "Visitor").slice(0, 60);
  const d = Math.max(0, Math.min(365, parseInt(days, 10) || 0));
  const u = Math.max(0, Math.min(1000, parseInt(maxUses, 10) || 0));
  const code = makeCode();
  const hash = await sha256(code);
  const rec = { id: hash.slice(0, 12), label: cleanLabel, created: Date.now(), expires: d ? Date.now() + d * 864e5 : 0, maxUses: u, uses: 0, revoked: false };
  await env.STATUS.put("code:" + hash, JSON.stringify(rec));
  return json({ code, id: rec.id }); // the plain code is returned once and never stored
}

async function revokeCode(req, env) {
  const { id } = await req.json().catch(() => ({}));
  if (!/^[a-f0-9]{12}$/.test(String(id))) throw fail(400, "Bad id.");
  const page = await env.STATUS.list({ prefix: "code:" + id });
  if (!page.keys.length) throw fail(404, "Code not found.");
  const key = page.keys[0].name;
  const c = await env.STATUS.get(key, "json");
  c.revoked = true;
  await env.STATUS.put(key, JSON.stringify(c));
  return json({ ok: true });
}

async function putContent(req, env) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.projects) || !Array.isArray(body.goals)) throw fail(400, 'Needs "projects" and "goals" lists.');
  const text = JSON.stringify({ projects: body.projects, goals: body.goals });
  if (text.length > 200000) throw fail(413, "Content is too large.");
  await env.STATUS.put("content", text);
  return json({ ok: true });
}

/* ---------------- Cloudflare Access (owner) ---------------- */
/* Access sets a CF_Authorization cookie for the hostname after you sign in, and adds
   the Cf-Access-Jwt-Assertion header on protected paths. We verify the signed JWT
   ourselves, so owner rights never depend on a header someone could fake. */
let jwksCache = null;
async function requireOwner(req, env) {
  const token = req.headers.get("cf-access-jwt-assertion") || cookies(req)["CF_Authorization"];
  if (!token) throw fail(401, "Owner sign-in required.");
  const [h, p, s] = token.split(".");
  if (!s) throw fail(401, "Bad token.");
  const header = JSON.parse(b64urlText(h));
  const payload = JSON.parse(b64urlText(p));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw fail(403, "Wrong audience.");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw fail(401, "Sign-in expired.");
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw fail(403, "Wrong issuer.");
  if (!jwksCache || jwksCache.at < Date.now() - 3600e3) {
    const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw fail(403, "Unknown key.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw fail(403, "Bad signature.");
  return payload;
}
function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64urlText = (s) => new TextDecoder().decode(b64urlBytes(s));
