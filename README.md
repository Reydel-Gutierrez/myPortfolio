# reydelgutierrez.com

Personal site. The home page is public. **My Live BMS**, **Home Lab**, **Projects** and
**Goals** are private: visitors need an access code that I create on the Owner page.

```
index.html                 the whole site (views: #home #bms #lab #projects #goals #admin)
CNAME                      custom domain for GitHub Pages
assets/content.js          ← edit this to change the public home page
assets/app.js              rendering, access codes, live data
assets/site.css            styles
assets/demo-content.js     sample data, loaded only when config.demo = true
resume/                    put Reydel-Gutierrez-Resume.pdf here
worker/                    Cloudflare Worker: access codes, sessions, private data, owner API
worker/seed-content.json   starting projects & goals to load into the Worker once
homelab-agent/             Python script that runs at home and pushes Proxmox + BMS status
```

## How access works

```
Visitor ── enters RG-XXXX-XXXX ──▶ /api/unlock ──▶ HttpOnly session cookie (≤ 7 days)
                                                    │
                                    /api/gated ◀────┘  BMS, lab, projects, goals

Owner (me) ── Cloudflare Access sign-in ──▶ /api/admin/*  create · list · revoke codes, edit content
```

* Private content is **never in this repo's public files**. It lives in the Worker's KV
  store and is returned only to a valid session. (This repo is public, so keep anything
  private out of `content.js` and `seed-content.json`.)
* Codes are stored as SHA-256 hashes. The plain code is shown once when you create it.
* Each code has a label (who it's for), an expiry and a max-unlock count. Revoking a code
  also ends every session opened with it.
* Wrong guesses are rate-limited to 10 per IP per 15 minutes.
* Open `#admin` (the "Owner" link in the footer) to manage codes.

## Preview locally

Set `demo: true` in `assets/content.js` and open `index.html`. The code `DEMO-2026`
unlocks the private sections with sample data, and the Owner page works in memory.
Set it back to `false` before pushing.

## Go live, step by step

### 1. Move DNS to Cloudflare (free)
1. Cloudflare → **Add a site** → `reydelgutierrez.com`, then switch the nameservers at your registrar.
2. Keep the GitHub Pages records (`CNAME www → reydel-gutierrez.github.io` and the apex A records), set to **Proxied**.
3. SSL/TLS mode: **Full**.

### 2. Email on your domain
Cloudflare → **Email → Email Routing** → forward `reydel@reydelgutierrez.com` to your inbox.

### 3. Deploy the Worker
```bash
cd worker
npm i -D wrangler
npx wrangler login
npx wrangler kv namespace create STATUS          # paste the id into wrangler.toml
npx wrangler secret put INGEST_TOKEN             # e.g. output of: openssl rand -hex 32
npx wrangler deploy
npx wrangler kv key put --binding STATUS content "$(cat seed-content.json)" --remote
```

### 4. Owner sign-in with Cloudflare Access (free)
1. Cloudflare → **Zero Trust** → choose a team name (`<team>.cloudflareaccess.com`).
2. **Settings → Authentication** → add One-time PIN (email), plus Google or GitHub if you like.
3. **Access → Applications → Add → Self-hosted**, domain `www.reydelgutierrez.com`, paths
   `api/login` and `api/admin`. Policy: **Allow** → Emails → your email only.
4. Put the app's **AUD tag** and your team domain into `wrangler.toml`, then `npx wrangler deploy`.
5. Visit `https://www.reydelgutierrez.com/#admin` → **Sign in as owner** → create your first code.

### 5. Proxmox read-only token
**Datacenter → Permissions**: add user `dashboard@pve`; add API token `site` for it
(keep Privilege Separation on); give the token the **PVEAuditor** role on `/`.

### 6. Home agent
Create a small Debian LXC (`homelab-agent`, 1 core / 512 MB):
```bash
apt install -y python3 iputils-ping
useradd -r -s /usr/sbin/nologin homelab
mkdir -p /opt/homelab-agent && cd /opt/homelab-agent
# copy agent.py, config.example.json, homelab-agent.service, homelab-agent.timer here
cp config.example.json config.json && nano config.json
cat > secrets.env <<'EOF'
PVE_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
INGEST_TOKEN=the-same-string-you-gave-wrangler
EOF
chmod 600 secrets.env && chown -R homelab:homelab /opt/homelab-agent
sudo -u homelab env $(cat secrets.env | xargs) python3 agent.py      # test once
cp homelab-agent.service homelab-agent.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now homelab-agent.timer
```
It reports every 5 minutes, which keeps Cloudflare KV inside its free daily write limit.

## Connecting Sensreys Automation (My Live BMS)
The agent reads a JSON file that Sensreys writes (path set in `config.json`):
```json
{ "living": { "temp": 74.2, "rh": 52 }, "rack": { "temp": 79.8, "rh": 41 } }
```
Zone names, setpoints, high limits and point tags are set in `config.json`. Sensreys can
also skip the agent and POST its own `{ "bms": { "zones": [...], "points": [...], "alarms": [...] } }`
to `/api/ingest` with the same bearer token.
