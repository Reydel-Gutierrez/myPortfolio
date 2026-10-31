/* ==========================================================
   PUBLIC SITE CONTENT: edit this file to update the home page.
   Only public information belongs here. Projects, goals, the
   Live BMS and the Home Lab are private: they are served by
   the Worker to visitors who enter an access code, and you edit
   them from the Owner page (#admin) on the live site.
   ========================================================== */
window.SITE = {
  config: {
    // demo: true only for local previews. Accepts the code DEMO-2026 and uses sample data.
    demo: false,
    apiBase: "/api",
    email: "reydel@reydelgutierrez.com",          // Cloudflare Email Routing forwards this to your inbox
    linkedin: "https://www.linkedin.com/in/REPLACE-ME/",
    github: "https://github.com/Reydel-Gutierrez",
    resume: "resume/Reydel-Gutierrez-Resume.pdf",
    bmsPlatform: "Sensreys Automation"             // working name of your BMS platform
  },

  person: {
    name: "Reydel Gutierrez",
    location: "Miami, FL",
    headline: "Automation & Systems Integration",
    lede:
      "Computer Science graduate from Florida International University with six years of experience across building automation, production IT and networking. I integrate and support automated systems end to end, from field controllers and the networks that connect them to the software and data platforms above them."
  },

  stats: [
    { value: "6 yrs", label: "Building systems & IT" },
    { value: "B.S.", label: "Computer Science, FIU" },
    { value: "CCNA", label: "+ CCNA Automation" },
    { value: "Any BMS", label: "Vendor-neutral fundamentals" }
  ],

  pitch: [
    {
      title: "Any BMS, same fundamentals",
      body: "Hands-on with Metasys today, built on vendor-neutral skills: BACnet/IP and MS/TP, sequences of operation, commissioning and checkout. Niagara, Siemens, Honeywell, Distech or ALC, the controller still speaks BACnet and the sequence still has to work."
    },
    {
      title: "I speak network",
      body: "VLANs, routing, ACLs and OT segmentation. When a controller drops offline I can tell whether it's the trunk, the switch port or the IP plan, and I can talk to the IT team in their terms."
    },
    {
      title: "I write the code",
      body: "Python against REST APIs, SQL, JavaScript. I'm building my own BMS platform, Sensreys Automation, and the live dashboards on this site run on it."
    },
    {
      title: "Production-minded",
      body: "I've supported systems that can't go down: a casino floor and a passenger rail station. I plan changes, document them and leave sites cleaner than I found them."
    }
  ],

  skills: [
    { group: "Building Automation", items: ["BACnet/IP & MS/TP", "Sequences of operation", "Commissioning & checkout", "Point-to-point testing", "Controller programming", "Alarm & trend setup"] },
    { group: "Platforms", items: ["Metasys (field experience)", "Sensreys Automation (my own)", "Vendor-neutral BACnet tools", "Fire & life-safety interfaces"] },
    { group: "Networking", items: ["Switching & VLANs", "Routing & ACLs", "Subnetting & IP plans", "OT network segmentation", "Network diagnostics"] },
    { group: "Programming", items: ["Python", "REST APIs", "SQL", "JavaScript", "Git"] },
    { group: "Systems & Cloud", items: ["Proxmox virtualization", "Linux & Windows", "Azure fundamentals", "Production support"] }
  ],

  experience: [
    {
      role: "Controls Systems Technician II",
      org: "Johnson Controls",
      when: "Current",
      points: [
        "Commission, troubleshoot and maintain building automation systems on commercial sites",
        "Diagnose BACnet/IP and MS/TP networks; run point-to-point checkout and sequence validation",
        "Program and modify controller logic"
      ]
    },
    {
      role: "Database & Gaming Technology Administration",
      org: "Magic City Casino",
      when: "Previous",
      points: ["Supported production database and gaming systems in a 24/7 environment"]
    },
    {
      role: "Building Engineer",
      org: "Brightline",
      when: "Previous",
      points: ["Maintained building systems at MiamiCentral station: BAS, fire and life-safety, and mechanical"]
    }
  ],

  certifications: [
    { name: "CCNA", issuer: "Cisco" },
    { name: "CCNA Automation", issuer: "Cisco" },
    { name: "CCST Networking", issuer: "Cisco" },
    { name: "Azure Fundamentals (AZ-900)", issuer: "Microsoft" },
    { name: "DDC Controls", issuer: "ASHRAE" },
    { name: "Project Management", issuer: "Google" },
    { name: "EPA 608", issuer: "EPA" }
  ],
  education: { degree: "B.S. Computer Science", school: "Florida International University" },

  // Teasers shown to everyone; the real content needs an access code.
  privateSections: [
    { id: "bms", title: "My Live BMS", body: "My home running on Sensreys Automation: floor plan, trends, alarms and a live points list." },
    { id: "lab", title: "Home Lab", body: "My Proxmox server and network: every VM, container and device, live." },
    { id: "projects", title: "Projects", body: "What I'm building now, including Sensreys Automation and a baseball game." },
    { id: "goals", title: "Goals", body: "Where I'm headed: now, this year and long term." }
  ]
};
