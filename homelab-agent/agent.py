#!/usr/bin/env python3
"""
Home agent for reydelgutierrez.com

Runs inside your home network (e.g. the homelab-agent LXC on Proxmox), every 5 minutes:
  1. reads Proxmox status with a READ-ONLY API token
  2. pings your network devices
  3. reads BMS data: from Sensreys Automation (a JSON file it writes), or Home Assistant
  4. pushes everything to the Worker at /api/ingest

Nothing on your network is exposed to the internet: this script only makes OUTBOUND requests.
Standard library only (Python 3.9+). Config: config.json next to this file (see config.example.json).
"""
import json, os, re, ssl, subprocess, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CFG = json.loads((HERE / "config.json").read_text())
HISTORY = HERE / "history.json"          # local 24 h trend buffer
TREND_STEP = 15 * 60                     # one trend sample per 15 min
TREND_KEEP = 24 * 3600


def http_json(url, headers=None, data=None, verify=True, timeout=10):
    ctx = None
    if url.startswith("https") and not verify:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE   # Proxmox's self-signed cert on your LAN only
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return json.loads(r.read().decode())


# ---------- Proxmox ----------
def proxmox():
    p = CFG["proxmox"]
    token = os.environ.get("PVE_TOKEN_SECRET", p.get("token_secret", ""))
    hdr = {"Authorization": f"PVEAPIToken={p['token_id']}={token}"}
    base = p["url"].rstrip("/") + "/api2/json"
    get = lambda path: http_json(base + path, hdr, verify=p.get("verify_tls", False))["data"]
    gib = lambda b: round((b or 0) / 2**30, 1)
    gb = lambda b: round((b or 0) / 1e9)

    nodes, guests = [], []
    for n in get("/nodes"):
        name = n["node"]
        online = n.get("status") == "online"
        disks = []
        if online:
            for s in get(f"/nodes/{name}/storage"):
                if s.get("active") and s.get("total"):
                    disks.append({"name": s["storage"], "used": gb(s.get("used")), "total": gb(s.get("total"))})
            for kind in ("qemu", "lxc"):
                for g in get(f"/nodes/{name}/{kind}"):
                    if g.get("template"):
                        continue
                    guests.append({
                        "vmid": int(g["vmid"]), "name": g.get("name", str(g["vmid"])), "type": kind,
                        "status": g.get("status", "unknown"),
                        "cpu": round((g.get("cpu") or 0) * 100, 1),
                        "mem": [gib(g.get("mem")), round((g.get("maxmem") or 0) / 2**30)],
                    })
        nodes.append({
            "name": name, "status": "online" if online else "offline",
            "uptime_days": int((n.get("uptime") or 0) // 86400),
            "cpu": round((n.get("cpu") or 0) * 100, 1),
            "mem": [gib(n.get("mem")), round((n.get("maxmem") or 0) / 2**30)],
            "disks": disks,
        })
    guests.sort(key=lambda g: g["vmid"])
    return nodes, guests


# ---------- network ----------
def ping(ip):
    try:
        out = subprocess.run(["ping", "-c", "1", "-W", "2", ip], capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"time[=<]([\d.]+)", out)
        return ("up", float(m.group(1))) if m else ("down", None)
    except Exception:
        return ("down", None)


def network():
    out = []
    for d in CFG.get("network", []):
        status, ms = ping(d["ip"])
        out.append({"name": d["name"], "ip": d["ip"] if d.get("show_ip", True) else "hidden", "status": status, "ms": ms})
    return out


# ---------- BMS sensors ----------
def read_sensors():
    """Returns {zone_id: {"temp": °F, "rh": %}}. Pick a source in config.json."""
    b = CFG["bms"]
    if b["source"] == "home_assistant":
        ha = b["home_assistant"]
        hdr = {"Authorization": "Bearer " + os.environ.get("HA_TOKEN", ha.get("token", ""))}
        out = {}
        for z in b["zones"]:
            vals = {}
            for key in ("temp", "rh"):
                ent = z.get(key + "_entity")
                if ent:
                    st = http_json(f"{ha['url'].rstrip('/')}/api/states/{ent}", hdr)
                    try:
                        vals[key] = float(st["state"])
                    except (ValueError, KeyError):
                        pass
            out[z["id"]] = vals
        return out
    # "file": any other script (BAC0 for BACnet, an ESP32 over MQTT, etc.) writes this JSON
    return json.loads(Path(b["file"]).read_text())


def bms():
    b = CFG["bms"]
    readings = read_sensors()
    hist = json.loads(HISTORY.read_text()) if HISTORY.exists() else {}
    now_ms = int(time.time() * 1000)
    zones, points, alarms = [], [], []
    ai = av = 1
    for z in b["zones"]:
        r = readings.get(z["id"], {})
        temp, rh = r.get("temp"), r.get("rh")
        if temp is None:
            alarms.append({"sev": "warn", "active": True, "text": f"{z['name']} sensor offline", "time": now_ms})
            continue
        trend = hist.get(z["id"], [])
        if not trend or now_ms - trend[-1][0] >= TREND_STEP * 1000:
            trend.append([now_ms, round(temp, 2)])
        trend = [p for p in trend if now_ms - p[0] <= TREND_KEEP * 1000]
        hist[z["id"]] = trend
        zones.append({"id": z["id"], "name": z["name"], "temp": temp, "rh": rh if rh is not None else 0,
                      "sp": z.get("setpoint"), "trend": trend + [[now_ms, round(temp, 2)]]})
        hi = z.get("high_limit")
        in_alarm = hi is not None and temp > hi
        if in_alarm:
            alarms.append({"sev": "warn", "active": True, "text": f"{z['name']} temp above {hi}°F", "time": now_ms})
        tag = z.get("tag", z["id"][:3].upper())
        points.append({"obj": f"AI-{ai}", "name": f"{tag}-T", "desc": f"{z['name']} temperature", "value": f"{temp:.1f}", "units": "°F", "flags": {"a": in_alarm}}); ai += 1
        if rh is not None:
            points.append({"obj": f"AI-{ai}", "name": f"{tag}-RH", "desc": f"{z['name']} humidity", "value": f"{rh:.0f}", "units": "%RH", "flags": {}}); ai += 1
        if z.get("setpoint") is not None:
            points.append({"obj": f"AV-{av}", "name": f"{tag}-SP", "desc": f"{z['name']} setpoint", "value": f"{z['setpoint']:.1f}", "units": "°F", "flags": {}}); av += 1
    HISTORY.write_text(json.dumps(hist))
    return {"zones": zones, "points": points, "alarms": alarms}


def main():
    payload = {}
    try:
        nodes, guests = proxmox()
        payload["lab"] = {"nodes": nodes, "guests": guests, "network": network()}
    except Exception as e:
        print("proxmox/network error:", e, file=sys.stderr)
    try:
        payload["bms"] = bms()
    except Exception as e:
        print("bms error:", e, file=sys.stderr)
    if not payload:
        sys.exit(1)
    token = os.environ.get("INGEST_TOKEN", CFG.get("ingest_token", ""))
    res = http_json(CFG["ingest_url"], {"Authorization": "Bearer " + token}, payload)
    print("pushed", list(payload), res)


if __name__ == "__main__":
    main()
