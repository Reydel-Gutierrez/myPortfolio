/* Sample content for local previews only (config.demo = true). Not loaded on the live site. */
window.DEMO_CONTENT = {
  "projects": [
    {
      "id": "sensreys",
      "title": "Sensreys Automation",
      "featured": true,
      "status": "building",
      "summary": "My own building management platform (working name). It reads sensors and controllers, stores trends, raises alarms and serves the graphics. My Live BMS runs on it.",
      "tags": ["BMS", "BACnet", "Python", "Web UI"],
      "milestones": [
        { "text": "Sensor ingest and live points list", "done": false },
        { "text": "Trends and alarms", "done": false },
        { "text": "BACnet/IP device discovery", "done": false },
        { "text": "Graphics editor", "done": false }
      ],
      "link": "#bms"
    },
    {
      "id": "baseball",
      "title": "Baseball Game",
      "featured": true,
      "status": "building",
      "summary": "A baseball game I'm building from scratch.",
      "tags": ["Game dev", "In progress"],
      "milestones": [
        { "text": "Core pitching and batting loop", "done": false },
        { "text": "Fielding and base running", "done": false },
        { "text": "Playable demo on this site", "done": false }
      ]
    },
    {
      "id": "homelab",
      "title": "Home Lab",
      "status": "active",
      "summary": "Proxmox server with VMs and containers for network labs, automation and self-hosted services.",
      "tags": ["Proxmox", "Linux", "Networking"],
      "link": "#lab"
    },
    {
      "id": "ccna-trainer",
      "title": "CCNA Automation Trainer",
      "status": "active",
      "summary": "A study and practice-exam tool I built for the Cisco 200-901 exam.",
      "tags": ["Python", "APIs", "Study tool"]
    },
    {
      "id": "mg",
      "title": "MG Building Services",
      "status": "shipped",
      "summary": "Website and Google Apps Script tooling for a Miami building-services contractor.",
      "tags": ["JavaScript", "Apps Script"]
    },
    {
      "id": "site",
      "title": "reydelgutierrez.com",
      "status": "active",
      "summary": "This site: static front end, Cloudflare Worker API with visitor access codes, and a home agent that reports live status.",
      "tags": ["JavaScript", "Cloudflare", "Python"]
    },
    { "id": "covid", "title": "COVID Tracker System", "status": "archived", "summary": "Team project at FIU: building check-ins and nearby testing centers on Google Maps.", "tags": ["Node.js", "MongoDB"] },
    { "id": "bmdb", "title": "Building Maintenance Database", "status": "archived", "summary": "Work-order and asset tracking web app.", "tags": ["Node.js", "MongoDB"] },
    { "id": "boomers", "title": "I Care For Baby Boomers", "status": "archived", "summary": "Mobile app for caregivers.", "tags": ["Flutter", "Firebase"] }
  ],
  "goals": [
    { "horizon": "now", "title": "Pass CCNA Automation (200-901)", "note": "Studying with my trainer app and lab time on the home server." },
    { "horizon": "now", "title": "Get My Live BMS streaming real data on Sensreys Automation" },
    { "horizon": "year", "title": "Move into BAS programming or an applications engineering role", "note": "Sequence development, graphics and integrations." },
    { "horizon": "year", "title": "Ship a playable baseball game demo" },
    { "horizon": "year", "title": "Release a first public version of Sensreys Automation" },
    { "horizon": "long", "title": "Lead smart-building integration where OT meets IT", "note": "In-house BMS, systems integration and network automation together." }
  ]
}
;
