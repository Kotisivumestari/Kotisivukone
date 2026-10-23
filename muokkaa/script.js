/* Kotisivueditori – script.js (lohkopohjainen versio)
 *
 * Sisältö:
 *   1. Apufunktiot
 *   2. Kuvat (tallennus selaimen IndexedDB-muistiin)
 *   3. Väriteemat
 *   4. Lohkotyypit (jokaisella kentät + render-funktio, joka tekee HTML:n)
 *   5. Sivupohjat ja aloituspohjat (valmiita lohkojoukkoja)
 *   6. Sivuston kokoaminen (valikko, alatunniste, tiedostonimet)
 *   7. ZIP-paketin tekeminen
 *   8. Tila ja tallennus
 *   9. Editorin käyttöliittymä (vedä ja pudota, kentät, emoji, linkit)
 */
"use strict";

/* =====================================================================
 * 1. Apufunktiot
 * ===================================================================== */

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, min, max) : def; };
const isHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s));
const hasLink = (l) => !!l && String(l).trim() !== "" && l !== "#";

// Tekee tekstistä turvallista HTML:ssä
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
const cols = (s) => lines(s).map((l) => l.split("|").map((x) => x.trim()));

const slugify = (s) =>
  String(s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function hexToRgba(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// CSS-url turvallisesti (käytetään style-attribuutin sisällä, joka esc-käsitellään)
const cssUrl = (src) => `url("${String(src).replace(/["\\\n\r]/g, (ch) => encodeURIComponent(ch))}")`;

// Pieni apu HTML-elementtien tekoon editorissa
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden") e[k] = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => { if (c != null) e.append(c); });
  return e;
}

/* =====================================================================
 * 2. Kuvat
 *
 * Kuvat tallennetaan selaimen IndexedDB-muistiin (ei localStorageen, jonka
 * raja on vain ~5 Mt). Lohkoissa kuvaan viitataan tekstillä "img:abc123".
 * ===================================================================== */

const IMAGES = {};       // id -> data-URL
let idb = null;

function idbOpen() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = indexedDB.open("kotisivueditori", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("images");
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch (e) { finish(null); }
    setTimeout(() => finish(null), 3000);
  });
}

function idbLoadAll() {
  return new Promise((resolve) => {
    if (!idb) return resolve();
    try {
      const tx = idb.transaction("images", "readonly");
      const req = tx.objectStore("images").openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (c) { IMAGES[c.key] = c.value; c.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (e) { resolve(); }
  });
}

function idbPut(id, data) {
  if (!idb) { if (!CLIENT) toast("Kuvia ei voi tallentaa pysyvästi tässä selaimessa. Lataa varmuuskopio (⋯ Projekti)."); return; }
  try {
    const tx = idb.transaction("images", "readwrite");
    tx.objectStore("images").put(data, id);
    tx.onerror = () => toast("Kuvan tallennus selaimen muistiin epäonnistui.");
  } catch (e) { toast("Kuvan tallennus selaimen muistiin epäonnistui."); }
}

function idbDelete(id) {
  if (!idb) return;
  try { idb.transaction("images", "readwrite").objectStore("images").delete(id); } catch (e) { /* ei haittaa */ }
}

const imgId = (ref) => (String(ref || "").startsWith("img:") ? String(ref).slice(4) : null);

const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };

// Kuvan viite -> osoite sivulla. ZIP-tilassa kuva kirjataan c.assets-listaan ja viitataan tiedostoon.
function imgSrc(ref, c) {
  ref = String(ref || "");
  const id = imgId(ref);
  if (!id) return /^https?:\/\//i.test(ref) ? ref : "";
  const data = IMAGES[id];
  if (!data) return "";
  if (c && c.assets) {
    const mime = (/^data:([^;,]+)/.exec(data) || [])[1];
    const name = `images/${id}.${MIME_EXT[mime] || "img"}`;
    c.assets.set(name, data);
    return name;
  }
  return data;
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (/;base64/i.test(head)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

// Lukee kuvatiedoston, pienentää isot kuvat (max 2000 px) ja palauttaa data-URL:n
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("luku epäonnistui"));
    reader.onload = () => {
      const original = reader.result;
      if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) {
        if (!/^image\//.test(file.type)) return reject(new Error("ei kuva"));
        return resolve(original);
      }
      const img = new Image();
      img.onerror = () => reject(new Error("kuvaa ei voitu avata"));
      img.onload = () => {
        const max = 2000;
        const big = Math.max(img.width, img.height) > max;
        if (!big && file.size < 700 * 1024) return resolve(original);
        const k = big ? max / Math.max(img.width, img.height) : 1;
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        const type = /png|webp/.test(file.type) ? file.type : "image/jpeg";
        const out = cv.toDataURL(type, 0.88);
        resolve(out.length < original.length ? out : original);
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}

/* =====================================================================
 * 3. Väriteemat (neutraalit valmiina)
 * ===================================================================== */

const T = (id, name, bg, surface, text, accent, accentText) =>
  ({ id, name, colors: { bg, surface, text, accent, accentText } });

const THEMES = [
  T("mono-light", "Valkoinen ja musta", "#ffffff", "#f5f5f5", "#111111", "#111111", "#ffffff"),
  T("mono-dark",  "Musta ja valkoinen", "#0a0a0a", "#171717", "#fafafa", "#ffffff", "#0a0a0a"),
  T("gray-light", "Harmaa ja valkoinen", "#f3f4f6", "#ffffff", "#1f2937", "#4b5563", "#ffffff"),
  T("gray-dark",  "Tummanharmaa",       "#1f2937", "#374151", "#f9fafb", "#e5e7eb", "#1f2937"),
  T("slate",      "Liuskekivi",         "#f1f5f9", "#ffffff", "#0f172a", "#334155", "#ffffff"),
  T("midnight",   "Keskiyö",            "#0f172a", "#1e293b", "#e2e8f0", "#94a3b8", "#0f172a"),
  T("sand",       "Hiekka",             "#faf7f2", "#ffffff", "#3b3a36", "#8a7a63", "#ffffff"),
  T("stone",      "Kivi",               "#fafaf9", "#ffffff", "#292524", "#57534e", "#ffffff"),
  T("sage",       "Salvia",             "#f4f6f3", "#ffffff", "#26302a", "#5b6f5e", "#ffffff"),
];

const COLOR_LABELS = {
  bg: "Taustaväri",
  surface: "Korttien väri",
  text: "Tekstin väri",
  accent: "Korostusväri (napit)",
  accentText: "Napin tekstin väri",
};

const themeById = (id) => THEMES.find((t) => t.id === id);

/* =====================================================================
 * 4. Lohkotyypit
 *
 * Kenttätyypit: text, textarea, link, checkbox, select, range, color, image
 * Jokaisella lohkolla on lisäksi yhteiset "Tausta ja asettelu" -asetukset
 * (STYLE_FIELDS): taustaväri, läpinäkyvyys, taustakuva tekstin takana jne.
 * ===================================================================== */

const G = (group) => ({ group });
const fText = (key, label, value = "", o = {}) => ({ key, label, type: "text", value, ...o });
const fArea = (key, label, value = "", rows = 4, o = {}) => ({ key, label, type: "textarea", rows, value, ...o });
const fLink = (key, label, value = "#", o = {}) => ({ key, label, type: "link", value, ...o });
const fSel = (key, label, options, value, o = {}) => ({ key, label, type: "select", options, value, ...o });
const fCheck = (key, label, value = false, o = {}) => ({ key, label, type: "checkbox", value, ...o });
const fRange = (key, label, min, max, value, o = {}) => ({ key, label, type: "range", min, max, value, ...o });
const fColor = (key, label, value, o = {}) => ({ key, label, type: "color", value, ...o });
const fImage = (key, label, value = "", o = {}) => ({ key, label, type: "image", value, ...o });

const ALIGN = [["left", "Vasen"], ["center", "Keskellä"], ["right", "Oikea"]];

const STYLE_FIELDS = [
  G("Asettelu"),
  fCheck("inline", "Näytä edellisen lohkon vieressä (samalla rivillä)", false, { rerender: true,
    hint: "Esim. kaksi kuvaa tai nappia vierekkäin: valitse tämä jälkimmäiselle lohkolle. Useampi peräkkäinen lohko jakaa rivin tasan." }),
  fCheck("keep", "Pidä vierekkäin myös puhelimessa", false, { showIf: (s) => !!s.inline,
    hint: "Oletuksena kapealla näytöllä lohkot menevät allekkain. Tämä pitää koko rivin lohkot vierekkäin myös puhelimessa. Sopii parhaiten kuville ja lyhyille napeille." }),
  fCheck("merge", "Yhdistä edelliseen lohkoon (yksi yhteinen osio)", false, { rerender: true,
    hint: "Lohkot muodostavat yhden osion: yhteinen tausta ja väli, ja ne liikkuvat yhdessä. Osion tausta, väli ja tekstin väri tulevat ryhmän ensimmäisestä lohkosta. Listassa voit yhdistää myös 🔗-napilla." }),
  fSel("pad", "Tila lohkon ylä- ja alapuolella", [["none", "Ei lainkaan"], ["sm", "Pieni"], ["md", "Normaali"], ["lg", "Suuri"]], "md", { showIf: (s) => !s.merge }),
  fCheck("full", "Täysi leveys (tausta ulottuu reunasta reunaan)", false, { showIf: (s) => !s.inline && !s.merge }),
  G("Tausta ja tekstin väri"),
  fSel("bgMode", "Taustaväri", [["none", "Ei taustaa"], ["surface", "Teeman korttiväri"], ["accent", "Teeman korostusväri"], ["custom", "Oma väri…"]], "none", { rerender: true, showIf: (s) => !s.merge }),
  fColor("bgColor", "Oma taustaväri", "#334155", { showIf: (s) => s.bgMode === "custom" && !s.merge }),
  fRange("bgTransp", "Taustavärin läpinäkyvyys", 0, 100, 0,
    { unit: " %", hint: "0 % = täysin peittävä, 100 % = täysin läpinäkyvä", showIf: (s) => s.bgMode !== "none" && !s.merge }),
  fImage("bgImage", "Taustakuva (kuva tekstin takana)", "", { rerender: true, showIf: (s) => !s.merge }),
  fRange("bgDim", "Taustakuvan tummennus", 0, 80, 0, { unit: " %", showIf: (s) => !!s.bgImage && !s.merge }),
  fSel("textMode", "Tekstin väri", [["auto", "Automaattinen"], ["light", "Vaalea"], ["dark", "Tumma"]], "auto", { showIf: (s) => !s.merge }),
];

const NETWORKS = {
  instagram: { label: "Instagram", base: "https://instagram.com/",
    icon: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>' },
  facebook: { label: "Facebook", base: "https://facebook.com/",
    icon: '<path fill="currentColor" stroke="none" d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/>' },
  x: { label: "X", base: "https://x.com/",
    icon: '<path d="M4 4l16 16M20 4L4 20"/>' },
  youtube: { label: "YouTube", base: "https://youtube.com/@",
    icon: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/>' },
  tiktok: { label: "TikTok", base: "https://tiktok.com/@",
    icon: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.5 2 4 5 4.3"/>' },
  linkedin: { label: "LinkedIn", base: "https://linkedin.com/in/",
    icon: '<path fill="currentColor" stroke="none" d="M4 9h4v12H4zM6 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h4v2c.8-1.4 2.2-2.3 4-2.3 3 0 4 2 4 5.3v7h-4v-6c0-1.6-.6-2.6-2-2.6S14 13.4 14 15v6h-4z"/>' },
  whatsapp: { label: "WhatsApp", base: "https://wa.me/",
    icon: '<path d="M3 21l1.6-4.8A9 9 0 1 1 8 19.5z"/><path d="M9 8.5c0 3.5 3 6.500 6.500 6.500l1-2-2-1-1 .8c-.8-.4-1.600-1.200-2-2l.8-1-1-2z" fill="currentColor" stroke="none"/>' },
};

// Käyttäjän kirjoittama some-osoite -> toimiva osoite
function socialUrl(key, raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (key === "whatsapp") { const d = v.replace(/[^\d]/g, ""); return d ? "https://wa.me/" + d : ""; }
  if (/^(www\.)?(instagram|facebook|fb|x|twitter|youtube|youtu|tiktok|linkedin|wa)\.[a-z]{2,}/i.test(v)) return "https://" + v;
  return NETWORKS[key].base + v.replace(/^@/, "");
}

function socialButtons(map, o = {}) {
  const items = Object.keys(NETWORKS).map((k) => [k, socialUrl(k, map && map[k])]).filter(([, u]) => u);
  if (!items.length) return "";
  const pill = o.style === "pill";
  const size = pick(o.size, ["sm", "md", "lg"], "md");
  const jc = { left: "flex-start", center: "center", right: "flex-end" }[pick(o.align, ["left", "center", "right"], "left")];
  return `<div class="social${pill ? " pill" : ""} s-${size}" style="justify-content:${jc}">` +
    items.map(([k, u]) =>
      `<a class="soc" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${NETWORKS[k].label}" title="${NETWORKS[k].label}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NETWORKS[k].icon}</svg>` +
      `${pill ? `<span>${NETWORKS[k].label}</span>` : ""}</a>`).join("") + `</div>`;
}

// Instagram-osoite -> upotusosoite
function instagramEmbedUrl(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  let m = /instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(v);
  if (m) return `https://www.instagram.com/${m[1].toLowerCase() === "reels" ? "reel" : m[1].toLowerCase()}/${m[2]}/embed`;
  m = /instagram\.com\/([A-Za-z0-9_.]+)/i.exec(v) || /^@?([A-Za-z0-9_.]+)$/.exec(v);
  if (m && !["p", "reel", "reels", "tv", "explore", "accounts", "stories"].includes(m[1].toLowerCase())) {
    return `https://www.instagram.com/${m[1]}/embed`;
  }
  return "";
}

// Sivuilla näkyvät kiinteät tekstit kielittäin (muu sisältö on käyttäjän omaa tekstiä)
const STR = {
  fi: {
    name: "Nimesi", yourEmail: "Sähköpostisi", message: "Viestisi", send: "Lähetä viesti",
    email: "Sähköposti", phone: "Puhelin", address: "Osoite", hours: "Aukioloajat", menu: "Avaa valikko",
    igOpen: "Avaa Instagramissa", igConsent: "Instagram-sisältö ladataan vasta, kun hyväksyt evästeet.", igAllow: "Hyväksy evästeet ja näytä",
    cookieTitle: "Evästeet", cookieAll: "Hyväksy kaikki", cookieNec: "Vain välttämättömät", cookieOpen: "Evästeasetukset",
    cookieText: "Tämä sivusto käyttää ulkopuolisia palveluita (esim. Instagram), jotka voivat asettaa evästeitä. Voit hyväksyä kaikki tai jatkaa vain välttämättömillä evästeillä.",
  },
  en: {
    name: "Your name", yourEmail: "Your email", message: "Your message", send: "Send message",
    email: "Email", phone: "Phone", address: "Address", hours: "Opening hours", menu: "Open menu",
    igOpen: "Open on Instagram", igConsent: "Instagram content is loaded only after you accept cookies.", igAllow: "Accept cookies and show",
    cookieTitle: "Cookies", cookieAll: "Accept all", cookieNec: "Necessary only", cookieOpen: "Cookie settings",
    cookieText: "This website uses third-party services (e.g. Instagram) that may set cookies. You can accept all cookies or continue with necessary cookies only.",
  },
};

const contactFormHtml = (email, s) => `
<form action="mailto:${esc(email)}" method="post" enctype="text/plain" style="display:grid;gap:1rem">
  <input class="field" type="text" name="${esc(s.name)}" placeholder="${esc(s.name)}" required>
  <input class="field" type="email" name="${esc(s.email)}" placeholder="${esc(s.yourEmail)}" required>
  <textarea class="field" name="${esc(s.message)}" rows="5" placeholder="${esc(s.message)}" required></textarea>
  <button class="btn" type="submit">${esc(s.send)}</button>
</form>`;

// Gallerian kuvalista tallennetaan JSON-tekstinä
function parseGallery(s) {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a)
      ? a.filter((x) => x && typeof x === "object").map((x) => ({ src: String(x.src || ""), alt: String(x.alt || ""), link: String(x.link || "#") }))
      : [];
  } catch (e) { return []; }
}

// Referenssilohkon kohteet (kuva ja/tai teksti) tallennetaan JSON-tekstinä
function parseRefs(s) {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a)
      ? a.filter((x) => x && typeof x === "object").slice(0, 200).map((x) => ({
        src: String(x.src || ""), title: String(x.title || "").slice(0, 120), text: String(x.text || "").slice(0, 400), link: String(x.link || "#"),
      }))
      : [];
  } catch (e) { return []; }
}

/* ---------- Linkit ja tekstin muotoilu ---------- */

// Linkin kohde -> osoite. Kohde voi olla "page:ID", sivun nimi tai osoite.
function target(c, t) {
  t = String(t || "").trim();
  if (!t) return "#";
  if (t.startsWith("page:")) return c.files[t.slice(5)] || "#";
  const q = t.toLowerCase();
  const same = (x) => x.title.trim().toLowerCase() === q;
  const pg = c.project.pages.find((x) => x.lang === c.page.lang && same(x)) || c.project.pages.find(same);
  if (pg) return c.files[pg.id];
  if (/^(javascript|data|vbscript):/i.test(t)) return "#";
  return t;
}

const fmt = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

// Teksti, jossa **lihavointi** ja [linkki](osoite) toimivat
function inline(c, s) {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let out = "", last = 0, m;
  s = String(s == null ? "" : s);
  while ((m = re.exec(s))) {
    const href = target(c, m[2]);
    const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
    out += fmt(s.slice(last, m.index)) + `<a href="${esc(href)}"${ext}>${fmt(m[1])}</a>`;
    last = re.lastIndex;
  }
  return out + fmt(s.slice(last));
}

const paras = (c, s) => lines(s).map((p) => `<p>${inline(c, p)}</p>`).join("");
const richText = (c, s) =>
  lines(s).map((l) => (l.startsWith("## ") ? `<h2>${esc(l.slice(3))}</h2>` : `<p>${inline(c, l)}</p>`)).join("");

function btn(c, text, link, o = {}) {
  if (!text) return "";
  const cls = "btn" + (o.variant === "outline" ? " outline" : "") + (o.size === "lg" ? " lg" : "");
  return `<a class="${cls}" href="${esc(c.href(link))}"${o.newTab ? ' target="_blank" rel="noopener"' : ""}>${esc(text)}</a>`;
}

const LEGAL_HINT = "Esimerkkiteksti. Tarkistuta ja muokkaa se omaan toimintaasi sopivaksi ennen julkaisua. ## alussa tekee väliotsikon.";
const TEXT_HINT = "Yksi kappale per rivi. ## tekee väliotsikon, **teksti** lihavoi. Linkin saat 🔗-napista.";

/* ---------- Lohkojen määritykset ---------- */

const BLOCK_TYPES = {
  /* ============================ PERUS ============================ */
  heading: {
    label: "Otsikko", icon: "🔤", desc: "Otsikko, iso tai pieni", sDef: { pad: "sm" },
    fields: [
      G("Sisältö"),
      fText("text", "Otsikko", "Uusi otsikko"),
      fSel("size", "Koko", [["h1", "Iso"], ["h2", "Keskikokoinen"], ["h3", "Pieni"]], "h2"),
      fSel("align", "Tasaus", ALIGN, "left"),
    ],
    render(v) {
      if (!String(v.text).trim()) return "";
      const tag = pick(v.size, ["h1", "h2", "h3"], "h2");
      return `<${tag} class="hd" style="text-align:${pick(v.align, ["left", "center", "right"], "left")}">${esc(v.text)}</${tag}>`;
    },
  },

  text: {
    label: "Teksti", icon: "📝", desc: "Tekstikappaleita, valinnainen otsikko",
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko (valinnainen)", ""),
      fArea("body", "Teksti", "Kirjoita tähän tekstiä.\n## Väliotsikko\nVoit lisätä emojeita 😀 ja **lihavointia**.", 8, { hint: TEXT_HINT }),
      fSel("align", "Tasaus", ALIGN, "left"),
      fCheck("card", "Näytä kortissa", false),
      fCheck("narrow", "Kapea lukualue", true),
    ],
    render(v, c) {
      if (!String(v.title).trim() && !lines(v.body).length) return "";
      const inner = `${v.title ? `<h2 class="hd">${esc(v.title)}</h2>` : ""}<div class="prose">${richText(c, v.body)}</div>`;
      const box = `<div${v.card ? ' class="card"' : ""} style="text-align:${pick(v.align, ["left", "center", "right"], "left")}">${inner}</div>`;
      return v.narrow ? `<div class="narrow-col">${box}</div>` : box;
    },
  },

  image: {
    label: "Kuva", icon: "🖼️", desc: "Kuva, jonka voi tehdä linkiksi",
    fields: [
      G("Kuva"),
      fImage("src", "Kuva"),
      fText("alt", "Kuvan kuvaus (ruudunlukijoille)", ""),
      fText("caption", "Kuvateksti (valinnainen)", ""),
      G("Linkki"),
      fLink("link", "Kun kuvaa klikataan, mene…", "#"),
      fCheck("newTab", "Avaa linkki uuteen välilehteen", false),
      G("Koko ja asemointi"),
      fRange("width", "Leveys", 10, 100, 100, { unit: " %" }),
      fSel("align", "Sijainti", ALIGN, "center"),
      fCheck("rounded", "Pyöristetyt kulmat", true),
    ],
    render(v, c) {
      const src = imgSrc(v.src, c);
      if (!src) return "";
      const img = `<img src="${esc(src)}" alt="${esc(v.alt)}" style="width:100%;display:block;${v.rounded ? "border-radius:1rem;" : ""}">`;
      const linked = hasLink(v.link)
        ? `<a href="${esc(c.href(v.link))}"${v.newTab ? ' target="_blank" rel="noopener"' : ""}>${img}</a>` : img;
      const margin = { left: "0 auto 0 0", center: "0 auto", right: "0 0 0 auto" }[pick(v.align, ["left", "center", "right"], "center")];
      return `<figure class="fig" style="width:${num(v.width, 10, 100, 100)}%;margin:${margin}">${linked}` +
        `${v.caption ? `<figcaption class="muted small">${esc(v.caption)}</figcaption>` : ""}</figure>`;
    },
  },

  button: {
    label: "Nappi", icon: "🔘", desc: "Nappi, joka vie sivulle tai osoitteeseen", sDef: { pad: "sm" },
    fields: [
      G("Sisältö"),
      fText("text", "Napin teksti", "Lue lisää"),
      fLink("link", "Mene…", "#"),
      fCheck("newTab", "Avaa linkki uuteen välilehteen", false),
      fSel("variant", "Tyyli", [["filled", "Täytetty"], ["outline", "Pelkkä kehys"]], "filled"),
      fSel("size", "Koko", [["md", "Normaali"], ["lg", "Iso"]], "md"),
      fSel("align", "Sijainti", ALIGN, "center"),
    ],
    render(v, c) {
      const b = btn(c, v.text, v.link, { variant: v.variant, size: v.size, newTab: v.newTab });
      return b ? `<div style="text-align:${pick(v.align, ["left", "center", "right"], "center")}">${b}</div>` : "";
    },
  },

  gallery: {
    label: "Kuvat vierekkäin", icon: "🖼️", desc: "Useita kuvia ruudukossa, jokaisen voi linkittää",
    fields: [
      G("Kuvat"),
      { key: "images", label: "Kuvat", type: "gallery", value: "[]" },
      G("Ulkoasu"),
      fSel("cols", "Kuvia rivillä", [["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]], "3"),
      fSel("fit", "Kuvien muoto", [["square", "Neliö (rajataan)"], ["wide", "Leveä 4:3 (rajataan)"], ["natural", "Alkuperäinen"]], "square"),
      fCheck("rounded", "Pyöristetyt kulmat", true),
      fCheck("newTab", "Avaa linkit uuteen välilehteen", false),
    ],
    render(v, c) {
      const items = parseGallery(v.images).map((it) => ({ ...it, src: imgSrc(it.src, c) })).filter((it) => it.src);
      if (!items.length) return "";
      const n = pick(v.cols, ["2", "3", "4", "5"], "3");
      const fit = pick(v.fit, ["square", "wide", "natural"], "square");
      const html = items.map((it) => {
        const img = `<img src="${esc(it.src)}" alt="${esc(it.alt)}" loading="lazy"${v.rounded ? ' style="border-radius:.8rem"' : ""}>`;
        return hasLink(it.link)
          ? `<a href="${esc(c.href(it.link))}"${v.newTab ? ' target="_blank" rel="noopener"' : ""}>${img}</a>` : `<div>${img}</div>`;
      }).join("");
      return `<div class="gal ${fit}" style="--n:${n}">${html}</div>`;
    },
  },

  refs: {
    label: "Liikkuvat referenssit", icon: "🎠", desc: "Kuvia tai kuva+teksti-kortteja, jotka liikkuvat jatkuvasti sivulle",
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko (valinnainen)", "Referenssit"),
      { key: "list", label: "Kuvat ja kortit (voit lisätä rajattomasti)", type: "refs", value: "[]" },
      G("Liike"),
      fRange("speed", "Nopeus", 1, 10, 4),
      fSel("dir", "Suunta", [["left", "Vasemmalle"], ["right", "Oikealle"]], "left"),
      fCheck("pause", "Pysähdy, kun hiiri on päällä", true),
      G("Ulkoasu"),
      fRange("width", "Kohteen leveys", 6, 24, 11, { unit: " rem" }),
      fSel("fit", "Kuvien muoto", [["contain", "Koko kuva näkyy (sopii logoille)"], ["square", "Neliö (rajataan)"], ["natural", "Alkuperäinen"]], "contain"),
      fCheck("card", "Näytä kohteet korteissa", false),
      fCheck("gray", "Mustavalkoiset (väri, kun osoitat)", false),
      fCheck("fade", "Häivytä reunat", true),
    ],
    render(v, c) {
      const items = parseRefs(v.list).map((it) => ({ ...it, src: imgSrc(it.src, c) })).filter((it) => it.src || it.title || it.text);
      if (!items.length) return "";
      const w = num(v.width, 6, 24, 11);
      const reps = Math.max(1, Math.ceil(6 / items.length));
      const dur = Math.max(6, Math.round((items.length * reps * (w + 1.25)) / (num(v.speed, 1, 10, 4) * 1.5)));
      const one = (it, hid) => {
        const img = it.src ? `<img src="${esc(it.src)}" alt="${hid ? "" : esc(it.title)}" loading="lazy">` : "";
        const cap = it.title || it.text
          ? `<span class="mq-cap">${it.title ? `<strong>${esc(it.title)}</strong>` : ""}${it.text ? `<span class="mq-tx">${esc(it.text)}</span>` : ""}</span>` : "";
        const cls = "mq-it" + (v.card ? " card" : "");
        return hasLink(it.link)
          ? `<a class="${cls}" href="${esc(c.href(it.link))}"${hid ? ' tabindex="-1"' : ""}>${img}${cap}</a>`
          : `<div class="${cls}">${img}${cap}</div>`;
      };
      const set = (hid) => `<div class="mq-set"${hid ? ' aria-hidden="true"' : ""}>${Array.from({ length: reps }, () => items.map((it) => one(it, hid)).join("")).join("")}</div>`;
      const cls = ["mq", pick(v.fit, ["contain", "square", "natural"], "contain"), v.fade ? "fade" : "", v.pause ? "pause" : "", v.dir === "right" ? "rev" : "", v.gray ? "gray" : ""].filter(Boolean).join(" ");
      return `${v.title ? `<h2 class="hd" style="text-align:center">${esc(v.title)}</h2>` : ""}` +
        `<div class="${cls}" style="--w:${w}rem;--dur:${dur}s"><div class="mq-track">${set(false)}${set(true)}</div></div>`;
    },
  },

  buttons: {
    label: "Napit vierekkäin", icon: "🔘", desc: "Useita nappeja samalla rivillä", sDef: { pad: "sm" },
    fields: [
      G("Napit"),
      fArea("items", "Napit", "Ensimmäinen nappi | #\nToinen nappi | #", 4,
        { hint: "Yksi nappi per rivi: Teksti | Linkki. Linkki on sivun nimi (esim. Yhteystiedot) tai osoite (https://…). # = ei linkkiä." }),
      fSel("variant", "Tyyli", [["filled", "Kaikki täytettyjä"], ["outline", "Kaikki kehyksellä"], ["mixed", "Ensimmäinen täytetty, muut kehyksellä"]], "filled"),
      fSel("size", "Koko", [["md", "Normaali"], ["lg", "Iso"]], "md"),
      fSel("align", "Sijainti", ALIGN, "center"),
    ],
    render(v, c) {
      const rows = cols(v.items).filter((r) => r[0]).map(([t, l = ""], i) => {
        const href = l && l !== "#" ? target(c, l) : "#";
        const outline = v.variant === "outline" || (v.variant === "mixed" && i > 0);
        return `<a class="btn${outline ? " outline" : ""}${v.size === "lg" ? " lg" : ""}" href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(t)}</a>`;
      }).join("");
      const jc = { left: "flex-start", center: "center", right: "flex-end" }[pick(v.align, ["left", "center", "right"], "center")];
      return rows ? `<div class="btn-row" style="justify-content:${jc}">${rows}</div>` : "";
    },
  },

  overlay: {
    label: "Kuva + teksti päälle", icon: "🌄", desc: "Teksti kuvan päällä, tekstilaatikon väri ja läpinäkyvyys säädettävissä",
    sDef: { pad: "sm" }, bleed: true,
    fields: [
      G("Kuva"),
      fImage("src", "Kuva"),
      fText("alt", "Kuvan kuvaus (ruudunlukijoille)", ""),
      fRange("height", "Korkeus", 150, 900, 420, { unit: " px" }),
      fRange("dim", "Kuvan tummennus", 0, 80, 0, { unit: " %" }),
      fLink("link", "Kuvaa klikatessa mene… (valinnainen)", "#"),
      G("Teksti kuvan päällä"),
      fText("title", "Otsikko", "Otsikko kuvan päällä"),
      fArea("text", "Teksti", "Tähän tulee lyhyt teksti.", 3),
      fText("btnText", "Napin teksti (tyhjä = ei nappia)", ""),
      fLink("btnLink", "Napin linkki", "#"),
      fSel("textColor", "Tekstin väri", [["light", "Vaalea"], ["dark", "Tumma"]], "light"),
      G("Tekstilaatikko"),
      fCheck("boxOn", "Näytä tekstin takana laatikko", true, { rerender: true }),
      fColor("boxColor", "Laatikon väri", "#000000", { showIf: (v) => v.boxOn }),
      fRange("boxTransp", "Laatikon läpinäkyvyys", 0, 100, 40,
        { unit: " %", hint: "0 % = täysin peittävä, 100 % = täysin läpinäkyvä", showIf: (v) => v.boxOn }),
      G("Tekstin paikka"),
      fSel("alignH", "Vaakasuunta", ALIGN, "center"),
      fSel("alignV", "Pystysuunta", [["top", "Ylhäällä"], ["middle", "Keskellä"], ["bottom", "Alhaalla"]], "middle"),
    ],
    render(v, c) {
      const src = imgSrc(v.src, c);
      if (!src) return "";
      const alignH = pick(v.alignH, ["left", "center", "right"], "center");
      const alignV = pick(v.alignV, ["top", "middle", "bottom"], "middle");
      const jc = { left: "flex-start", center: "center", right: "flex-end" }[alignH];
      const ai = { top: "flex-start", middle: "center", bottom: "flex-end" }[alignV];
      const boxBg = v.boxOn ? hexToRgba(v.boxColor, +(1 - num(v.boxTransp, 0, 100, 40) / 100).toFixed(2)) : "transparent";
      const tcol = v.textColor === "dark" ? "#111111" : "#ffffff";
      const content = `${v.title ? `<h2>${esc(v.title)}</h2>` : ""}${v.text ? `<p>${inline(c, v.text)}</p>` : ""}${btn(c, v.btnText, v.btnLink)}`;
      const dim = num(v.dim, 0, 80, 0);
      const style = `min-height:${num(v.height, 150, 900, 420)}px;background-image:${cssUrl(src)};justify-content:${jc};align-items:${ai};text-align:${alignH}`;
      return `<div class="ov" role="img" aria-label="${esc(v.alt || v.title)}" style="${esc(style)}">` +
        `${dim ? `<div class="ov-dim" style="opacity:${dim / 100}"></div>` : ""}` +
        `${hasLink(v.link) ? `<a class="ov-link" href="${esc(c.href(v.link))}" aria-label="${esc(v.alt || v.title || "Avaa")}"></a>` : ""}` +
        `${content ? `<div class="ov-box" style="background:${boxBg};color:${tcol}">${content}</div>` : ""}</div>`;
    },
  },

  spacer: {
    label: "Tyhjä väli", icon: "↕️", desc: "Lisää tyhjää tilaa", sDef: { pad: "none" },
    fields: [G("Väli"), fRange("height", "Korkeus", 8, 300, 40, { unit: " px" })],
    render: (v) => `<div style="height:${num(v.height, 8, 300, 40)}px" aria-hidden="true"></div>`,
  },

  divider: {
    label: "Viiva", icon: "➖", desc: "Vaakaviiva erottamaan osioita", sDef: { pad: "sm" },
    fields: [G("Viiva"), fSel("width", "Pituus", [["100", "Koko leveys"], ["50", "Puolet"], ["20", "Lyhyt"]], "100")],
    render: (v) => `<hr class="divider" style="width:${pick(v.width, ["100", "50", "20"], "100")}%">`,
  },

  /* ============================ OSIOT ============================ */
  hero: {
    label: "Hero (iso aloitusalue)", icon: "🚀", desc: "Iso otsikko, teksti ja napit", sDef: { pad: "lg" },
    fields: [
      G("Sisältö"),
      fText("title", "Pääotsikko", "Tervetuloa"),
      fArea("text", "Teksti", "Kirjoita tähän lyhyt esittely.", 3),
      fSel("align", "Tasaus", ALIGN, "center"),
      G("Napit"),
      fText("btnText", "Napin teksti (tyhjä = ei nappia)", "Lue lisää"),
      fLink("btnLink", "Napin linkki", "#"),
      fText("btn2Text", "Toisen napin teksti", ""),
      fLink("btn2Link", "Toisen napin linkki", "#"),
    ],
    render(v, c) {
      if (!v.title && !v.text && !v.btnText) return "";
      return `<div class="hero" style="text-align:${pick(v.align, ["left", "center", "right"], "center")}">
  ${v.title ? `<h1>${esc(v.title)}</h1>` : ""}
  ${v.text ? `<p class="muted">${inline(c, v.text)}</p>` : ""}
  ${btn(c, v.btnText, v.btnLink)} ${btn(c, v.btn2Text, v.btn2Link, { variant: "outline" })}
</div>`;
    },
  },

  pagehead: {
    label: "Sivun otsikko", icon: "📌", desc: "Iso otsikko ja ingressi sivun alkuun", sDef: { pad: "sm" },
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko", "Sivun otsikko"),
      fText("intro", "Ingressi (valinnainen)", ""),
    ],
    render: (v, c) => `${v.title ? `<h1 class="pagetitle">${esc(v.title)}</h1>` : ""}${v.intro ? `<p class="lead muted">${inline(c, v.intro)}</p>` : ""}`,
  },

  cards: {
    label: "Korttiruudukko", icon: "🗂️", desc: "Kortteja ruudukossa, kortin voi linkittää",
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko (valinnainen)", ""),
      fArea("items", "Kortit", "✨ Ensimmäinen | Kuvaus tähän.\n🚀 Toinen | Kuvaus tähän.\n💬 Kolmas | Kuvaus tähän.", 8,
        { hint: "Yksi kortti per rivi: Otsikko | Kuvaus | Linkki. Linkki on valinnainen: kirjoita sivun nimi (esim. Yhteystiedot) tai osoite." }),
      fSel("cols", "Sarakkeita", [["auto", "Automaattinen"], ["2", "2"], ["3", "3"], ["4", "4"]], "auto"),
    ],
    render(v, c) {
      const items = cols(v.items).map(([t, d = "", l = ""]) => {
        const inner = `<h3 class="card-title">${esc(t)}</h3>${d ? `<p class="muted">${inline(c, d)}</p>` : ""}`;
        return l ? `<a class="card card-link" href="${esc(target(c, l))}">${inner}</a>` : `<div class="card">${inner}</div>`;
      }).join("");
      if (!items && !v.title) return "";
      const k = pick(v.cols, ["auto", "2", "3", "4"], "auto");
      return `${v.title ? `<h2 class="center-title">${esc(v.title)}</h2>` : ""}<div class="grid-auto${k === "auto" ? "" : " g-" + k}">${items}</div>`;
    },
  },

  cta: {
    label: "Toimintakehotus", icon: "📣", desc: "Kehotus ja nappi, esim. 'Ota yhteyttä'", sDef: { pad: "lg", bgMode: "accent" },
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko", "Valmis aloittamaan?"),
      fText("text", "Teksti", "Ota yhteyttä niin autamme eteenpäin."),
      fText("btnText", "Napin teksti", "Ota yhteyttä"),
      fLink("btnLink", "Napin linkki", "#"),
    ],
    render(v, c) {
      if (!v.title && !v.text && !v.btnText) return "";
      return `<div class="cta">${v.title ? `<h2>${esc(v.title)}</h2>` : ""}${v.text ? `<p>${inline(c, v.text)}</p>` : ""}${btn(c, v.btnText, v.btnLink)}</div>`;
    },
  },

  stats: {
    label: "Luvut", icon: "🔢", desc: "Isot luvut selitteillä",
    fields: [G("Sisältö"), fArea("items", "Luvut", "10+ | Vuotta kokemusta\n500+ | Tyytyväistä asiakasta\n24/7 | Tuki", 5, { hint: "Yksi per rivi: Luku | Selite" })],
    render(v) {
      const items = cols(v.items).map(([n, l = ""]) =>
        `<div><div class="stat-num">${esc(n)}</div><div class="muted">${esc(l)}</div></div>`).join("");
      return items ? `<div class="grid-auto stats">${items}</div>` : "";
    },
  },

  skills: {
    label: "Taitotaulukko", icon: "📊", desc: "Taidot palkkeina prosentteina",
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko", "Taidot"),
      fArea("items", "Taidot", "HTML | 90\nCSS | 80\nJavaScript | 65\nGrafiikka | 50", 6, { hint: "Yksi per rivi: Taito | prosentti (0–100)" }),
    ],
    render(v) {
      const rows = cols(v.items).map(([name, p = "0"]) => {
        const pct = clamp(parseInt(p, 10) || 0, 0, 100);
        return `<tr><td class="nowrap">${esc(name)}</td><td style="width:100%"><div class="bar"><i style="width:${pct}%"></i></div></td><td class="muted right">${pct}%</td></tr>`;
      }).join("");
      if (!rows) return "";
      return `${v.title ? `<h2 class="center-title">${esc(v.title)}</h2>` : ""}<div class="card"><table class="skills"><tbody>${rows}</tbody></table></div>`;
    },
  },

  pricing: {
    label: "Hinnasto", icon: "💶", desc: "Hintapaketit rinnakkain",
    fields: [
      G("Paketit"),
      fArea("plans", "Paketit", "Perus | 19 €/kk | 1 käyttäjä, Perustuki, 5 Gt tilaa\nPro | 49 €/kk | 5 käyttäjää, Ensisijainen tuki, 100 Gt tilaa, Raportit\nYritys | Sovitaan | Rajaton käyttäjämäärä, Oma yhteyshenkilö, Räätälöinnit", 8,
        { hint: "Yksi per rivi: Nimi | Hinta | Ominaisuudet pilkulla erotettuna" }),
      fText("featured", "Korostettu paketti (numero)", "2", { hint: "Esim. 2 = toinen paketti. Tyhjä = ei korostusta." }),
      fText("btnText", "Pakettien napin teksti", "Valitse"),
      fLink("btnLink", "Pakettien napin linkki", "#"),
      fText("note", "Lisätieto alareunaan", "Kaikissa paketeissa 14 päivän ilmainen kokeilu."),
    ],
    render(v, c) {
      const feat = parseInt(v.featured, 10) || 0;
      const plans = cols(v.plans).map(([name, price = "", list = ""], i) => {
        const feats = list.split(",").map((s) => s.trim()).filter(Boolean).map((s) => `<li>${esc(s)}</li>`).join("");
        return `<div class="card plan${i + 1 === feat ? " plan-featured" : ""}"><h3 class="card-title">${esc(name)}</h3><div class="price">${esc(price)}</div><ul>${feats}</ul>${btn(c, v.btnText, v.btnLink)}</div>`;
      }).join("");
      if (!plans) return "";
      return `<div class="grid-auto">${plans}</div>${v.note ? `<p class="muted center" style="margin-top:2rem">${esc(v.note)}</p>` : ""}`;
    },
  },

  team: {
    label: "Tiimi", icon: "👥", desc: "Henkilökortit nimellä ja roolilla",
    fields: [
      G("Sisältö"),
      fArea("members", "Henkilöt", "Maija Meikäläinen | Toimitusjohtaja | Johtaa yritystä ja pitää huolen että suunta on oikea.\nPekka Virtanen | Kehittäjä | Rakentaa palvelumme tekniset ratkaisut.\nLiisa Korhonen | Asiakaspalvelu | Auttaa asiakkaita ongelmatilanteissa.", 8,
        { hint: "Yksi per rivi: Nimi | Rooli | Kuvaus" }),
    ],
    render(v) {
      const people = cols(v.members).map(([n, r = "", d = ""]) => {
        const ini = n.split(/\s+/).map((w) => w[0] || "").slice(0, 2).join("").toUpperCase();
        return `<div class="card"><div class="avatar">${esc(ini)}</div><h3 class="card-title">${esc(n)}</h3>${r ? `<p class="role">${esc(r)}</p>` : ""}${d ? `<p class="muted">${esc(d)}</p>` : ""}</div>`;
      }).join("");
      return people ? `<div class="grid-auto">${people}</div>` : "";
    },
  },

  faq: {
    label: "UKK", icon: "❓", desc: "Avautuvat kysymykset ja vastaukset",
    fields: [
      G("Sisältö"),
      fArea("items", "Kysymykset", "Miten pääsen alkuun? | Ota yhteyttä meihin, niin sovimme ensimmäisen tapaamisen.\nVoinko perua tilauksen? | Kyllä, voit perua tilauksen milloin tahansa ilman lisäkuluja.\nMiten voin maksaa? | Hyväksymme verkkolaskun, korttimaksun ja tilisiirron.", 10,
        { hint: "Yksi per rivi: Kysymys | Vastaus" }),
    ],
    render(v) {
      const items = cols(v.items).map(([q, a = ""]) =>
        `<details class="card faq"><summary>${esc(q)}</summary><p class="muted">${esc(a)}</p></details>`).join("");
      return items ? `<div class="narrow-col">${items}</div>` : "";
    },
  },

  contact: {
    label: "Yhteystiedot", icon: "✉️", desc: "Osoite, aukioloajat ja lomake",
    fields: [
      G("Tiedot (tyhjä kenttä = ei näy)"),
      fText("email", "Sähköposti", "info@example.com", { plain: true }),
      fText("phone", "Puhelin", "040 123 4567", { plain: true }),
      fArea("address", "Osoite", "Yritys Oy\nEsimerkkikatu 1\n00100 Helsinki", 3),
      fArea("hours", "Aukioloajat", "Ma–Pe 9–17\nLa–Su suljettu", 3),
      G("Lomake"),
      fCheck("showForm", "Näytä yhteydenottolomake", true, { rerender: true }),
      fText("formTitle", "Lomakkeen otsikko", "Lähetä viesti", { showIf: (v) => v.showForm }),
    ],
    render(v, c) {
      const s = c.str;
      const info = [];
      if (v.email) info.push(`<p><strong>${esc(s.email)}</strong><br><a href="mailto:${esc(v.email)}">${esc(v.email)}</a></p>`);
      if (v.phone) info.push(`<p><strong>${esc(s.phone)}</strong><br><a href="tel:${esc(String(v.phone).replace(/[^\d+]/g, ""))}">${esc(v.phone)}</a></p>`);
      if (lines(v.address).length) info.push(`<p><strong>${esc(s.address)}</strong><br>${lines(v.address).map(esc).join("<br>")}</p>`);
      if (lines(v.hours).length) info.push(`<p><strong>${esc(s.hours)}</strong><br>${lines(v.hours).map(esc).join("<br>")}</p>`);
      const form = v.showForm ? `<div>${v.formTitle ? `<h2 class="card-title big">${esc(v.formTitle)}</h2>` : ""}${contactFormHtml(v.email, s)}</div>` : "";
      if (!info.length && !form) return "";
      return `<div class="contact-grid">${info.length ? `<div class="card">${info.join("")}</div>` : ""}${form}</div>`;
    },
  },

  contactForm: {
    label: "Yhteydenottolomake", icon: "📨", desc: "Lomake, joka avaa sähköpostin",
    fields: [
      G("Sisältö"),
      fText("title", "Otsikko", "Lähetä viesti"),
      fText("email", "Sähköposti (lomake lähettää tähän)", "info@example.com", { plain: true }),
    ],
    render: (v, c) => `<div class="narrow-col">${v.title ? `<h2 class="center-title">${esc(v.title)}</h2>` : ""}${contactFormHtml(v.email, c.str)}</div>`,
  },

  articleSidebar: {
    label: "Artikkeli + sivupalkki", icon: "📰", desc: "Blogityylinen lukualue ja sivupalkki",
    fields: [
      G("Artikkeli"),
      fText("articleTitle", "Otsikko", "Näin aloitin koodaamisen"),
      fText("articleMeta", "Päiväys ja kirjoittaja", "20.10.2026 · Kirjoittanut Matti"),
      fArea("articleText", "Teksti", "Kaikki alkoi tavallisena iltana, kun päätin kokeilla jotain uutta. Halusin tehdä oman kotisivun, enkä tiennyt mistä aloittaa.\nEnsimmäinen oivallus oli, että koodaaminen ei ole taikuutta. Se on pieniä askelia, jotka yhdessä rakentavat jotain isompaa.\nTärkeintä on aloittaa. Pienikin projekti opettaa enemmän kuin tuntikausia teoriaa.", 10, { hint: TEXT_HINT }),
      G("Sivupalkki"),
      fCheck("sideOn", "Näytä sivupalkki", true, { rerender: true }),
      fText("sidebarTitle", "Otsikko", "Tietoa blogista", { showIf: (v) => v.sideOn }),
      fArea("sidebarText", "Teksti", "Tervetuloa lukemaan! Kirjoitan viikoittain asioista, jotka kiinnostavat minua.", 3, { showIf: (v) => v.sideOn }),
      fArea("sidebarLinks", "Linkit", "Tietoa meistä\nYhteystiedot", 4,
        { hint: "Yksi per rivi. Kirjoita jonkin sivun nimi, niin linkki vie sille sivulle.", showIf: (v) => v.sideOn }),
    ],
    render(v, c) {
      const links = lines(v.sidebarLinks).map((l) => `<li><a href="${esc(target(c, l))}">${esc(l)}</a></li>`).join("");
      const side = v.sideOn ? `<aside><div class="card">${v.sidebarTitle ? `<h3 class="card-title">${esc(v.sidebarTitle)}</h3>` : ""}<p class="muted small">${inline(c, v.sidebarText)}</p></div>${links ? `<ul class="side-links">${links}</ul>` : ""}</aside>` : "";
      return `<div class="blog-grid${v.sideOn ? "" : " no-side"}"><article class="prose">
  ${v.articleTitle ? `<h1 class="article-title">${esc(v.articleTitle)}</h1>` : ""}
  ${v.articleMeta ? `<p class="muted small">${esc(v.articleMeta)}</p>` : ""}
  <div class="article-body">${paras(c, v.articleText)}</div></article>${side}</div>`;
    },
  },

  /* ======================== SOME JA UPOTUKSET ======================== */
  social: {
    label: "Somenapit", icon: "📣", desc: "Napit Instagramiin, Facebookiin, YouTubeen ym.", sDef: { pad: "sm" },
    fields: [
      G("Somenapit"),
      fText("title", "Otsikko (valinnainen)", "Seuraa meitä"),
      fSel("source", "Linkit", [["site", "Sivuston yhteiset linkit (välilehti Sivusto)"], ["own", "Omat linkit tälle lohkolle"]], "site", { rerender: true }),
      fSel("style", "Ulkoasu", [["round", "Pyöreät kuvakkeet"], ["pill", "Kuvake ja nimi"]], "round"),
      fSel("size", "Koko", [["sm", "Pieni"], ["md", "Normaali"], ["lg", "Iso"]], "md"),
      fSel("align", "Sijainti", ALIGN, "center"),
      ...Object.keys(NETWORKS).map((k) =>
        fText(k, NETWORKS[k].label, "", { plain: true, placeholder: "Osoite tai @käyttäjänimi", showIf: (v) => v.source === "own" })),
    ],
    render(v, c) {
      const map = v.source === "own" ? v : c.project.social;
      const html = socialButtons(map, v);
      if (!html) return "";
      return `${v.title ? `<p class="center-title small-title" style="text-align:${pick(v.align, ["left", "center", "right"], "center")}">${esc(v.title)}</p>` : ""}${html}`;
    },
  },

  instagram: {
    label: "Instagram-upotus", icon: "📸", desc: "Näytä Instagram-julkaisu tai profiili sivulla",
    fields: [
      G("Instagram"),
      fText("url", "Julkaisun tai profiilin osoite", "", { plain: true, placeholder: "https://www.instagram.com/p/…  tai @käyttäjänimi",
        hint: "Liitä julkaisun (p/…, reel/…) tai profiilin osoite. Vain julkiset tilit toimivat." }),
      fRange("height", "Korkeus", 300, 1000, 640, { unit: " px" }),
      fCheck("showBtn", "Näytä 'Avaa Instagramissa' -nappi", true),
    ],
    render(v, c) {
      const src = instagramEmbedUrl(v.url);
      if (!src) return "";
      const link = src.replace(/\/embed$/, "/");
      const h = num(v.height, 300, 1000, 640);
      // Kun evästekysely on käytössä, upotus ladataan vasta kävijän hyväksynnän jälkeen
      const frame = c.consent
        ? `<div class="consent-ph"><p class="muted">${esc(c.str.igConsent)}</p><button type="button" class="btn" data-cookie="all">${esc(c.str.igAllow)}</button></div>` +
          `<iframe data-consent-src="${esc(src)}" title="Instagram" hidden scrolling="no" frameborder="0" style="height:${h}px"></iframe>`
        : `<iframe src="${esc(src)}" title="Instagram" loading="lazy" scrolling="no" frameborder="0" style="height:${h}px"></iframe>`;
      return `<div class="ig">${frame}` +
        `${v.showBtn ? `<p style="margin:1rem 0 0"><a class="btn outline" href="${esc(link)}" target="_blank" rel="noopener">${esc(c.str.igOpen)}</a></p>` : ""}</div>`;
    },
  },
};

const PALETTE_CATS = [
  { label: "Perus", types: ["heading", "text", "image", "gallery", "refs", "button", "buttons", "overlay", "spacer", "divider"] },
  { label: "Osiot", types: ["hero", "pagehead", "cards", "cta", "stats", "skills", "pricing", "team", "faq", "contact", "contactForm", "articleSidebar"] },
  { label: "Some ja upotukset", types: ["social", "instagram"] },
];

const defaultsOf = (fields) => {
  const o = {};
  fields.forEach((f) => { if (f.key) o[f.key] = f.value; });
  return o;
};

// Lohkon kenttien oletusarvot kielen mukaan
const fullV = (type, v, lang) =>
  ({ ...defaultsOf(BLOCK_TYPES[type].fields), ...(lang === "en" ? BLOCK_DEFAULTS_EN[type] || {} : {}), ...v });

function makeBlock(type, v = {}, s = {}, lang = "fi") {
  const BT = BLOCK_TYPES[type];
  return {
    id: uid(), type, hidden: false,
    v: fullV(type, v, lang),
    s: Object.assign(defaultsOf(STYLE_FIELDS), BT.sDef || {}, s),
  };
}

// Englanninkieliset oletustekstit lohkoille (suomi on kenttien omat oletukset)
const BLOCK_DEFAULTS_EN = {
  heading: { text: "New heading" },
  text: { body: "Write your text here.\n## Subheading\nYou can add emojis 😀 and **bold text**." },
  button: { text: "Read more" },
  buttons: { items: "First button | #\nSecond button | #" },
  refs: { title: "References" },
  overlay: { title: "Title over the image", text: "A short text goes here." },
  hero: { title: "Welcome", text: "Write a short introduction here.", btnText: "Read more" },
  pagehead: { title: "Page title" },
  cards: { items: "✨ First | Description here.\n🚀 Second | Description here.\n💬 Third | Description here." },
  cta: { title: "Ready to get started?", text: "Get in touch and we'll help you move forward.", btnText: "Contact us" },
  stats: { items: "10+ | Years of experience\n500+ | Happy customers\n24/7 | Support" },
  skills: { title: "Skills", items: "HTML | 90\nCSS | 80\nJavaScript | 65\nGraphics | 50" },
  pricing: {
    plans: "Basic | €19/mo | 1 user, Basic support, 5 GB storage\nPro | €49/mo | 5 users, Priority support, 100 GB storage, Reports\nBusiness | Let's talk | Unlimited users, Dedicated contact, Custom features",
    btnText: "Choose", note: "All plans include a 14-day free trial.",
  },
  team: { members: "Jane Smith | CEO | Leads the company and keeps us heading in the right direction.\nPeter Brown | Developer | Builds the technical solutions behind our service.\nLisa Green | Customer support | Helps customers whenever they run into problems." },
  faq: { items: "How do I get started? | Contact us and we'll arrange a first meeting.\nCan I cancel my order? | Yes, you can cancel at any time at no extra cost.\nHow can I pay? | We accept invoices, card payments and bank transfers." },
  contact: { address: "Company Ltd\n1 Example Street\n00100 Helsinki", hours: "Mon–Fri 9–17\nSat–Sun closed", formTitle: "Send a message" },
  contactForm: { title: "Send a message" },
  articleSidebar: {
    articleTitle: "How I started coding", articleMeta: "20 Oct 2026 · Written by Matti",
    articleText: "It all started on an ordinary evening when I decided to try something new. I wanted to build my own website and had no idea where to begin.\nThe first insight was that coding is not magic. It is small steps that together build something bigger.\nThe most important thing is to start. Even a small project teaches more than hours of theory.",
    sidebarTitle: "About the blog", sidebarText: "Welcome! I write weekly about things that interest me.", sidebarLinks: "About us\nContact",
  },
  social: { title: "Follow us" },
};

// Pakottaa arvot oikeaan muotoon (muistista tai varmuuskopiosta tulleelle datalle)
function coerce(fields, src, defaults) {
  const out = {};
  fields.forEach((f) => {
    if (!f.key) return;
    let x = src && src[f.key] !== undefined ? src[f.key] : (defaults && defaults[f.key] !== undefined ? defaults[f.key] : f.value);
    if (f.type === "checkbox") x = !!x;
    else if (f.type === "range") x = num(x, f.min, f.max, f.value);
    else if (f.type === "color") x = isHex(x) ? x : f.value;
    else if (f.type === "gallery") x = JSON.stringify(parseGallery(x));
    else if (f.type === "refs") x = JSON.stringify(parseRefs(x));
    else if (f.type === "select") x = f.options.some((o) => o[0] === String(x)) ? String(x) : String((defaults && defaults[f.key]) ?? f.value);
    else x = String(x == null ? "" : x);
    out[f.key] = x;
  });
  return out;
}

function blockSummary(b) {
  for (const k of ["title", "text", "body", "articleTitle", "btnText", "caption", "alt", "items", "plans", "members", "url", "email"]) {
    const s = String(b.v[k] || "").replace(/\s+/g, " ").trim();
    if (s) return s.length > 36 ? s.slice(0, 36) + "…" : s;
  }
  if (b.type === "gallery") return `${parseGallery(b.v.images).length} kuvaa`;
  if (b.type === "refs") return `${parseRefs(b.v.list).length} kohdetta`;
  if (b.type === "image" || b.type === "overlay") return b.v.src ? "Kuva lisätty" : "Ei kuvaa vielä";
  if (b.type === "social") return "Somelinkit";
  return "";
}

/* =====================================================================
 * 5. Sivupohjat ja aloituspohjat
 *
 * Sivupohja on valmis lista lohkoja: [tyyppi, sisältö, tyyli].
 * Linkkiarvo "@contact" muuttuu linkiksi Yhteystiedot-sivulle, jos sellainen on.
 * ===================================================================== */

const LEGAL_TERMS = "## 1. Yleistä\nNäitä käyttöehtoja sovelletaan sivuston ja sen palveluiden käyttöön. Käyttämällä sivustoa hyväksyt nämä ehdot.\n## 2. Palvelun käyttö\nPalvelua saa käyttää vain lain ja hyvän tavan mukaisesti. Käyttäjä vastaa omasta toiminnastaan palvelussa.\n## 3. Immateriaalioikeudet\nSivuston sisältö, kuten tekstit, kuvat ja logot, on suojattu tekijänoikeuksilla. Sisältöä ei saa kopioida ilman lupaa.\n## 4. Vastuunrajoitus\nPyrimme pitämään palvelun toimintavarmana, mutta emme vastaa mahdollisista keskeytyksistä tai virheistä.\n## 5. Ehtojen muutokset\nVoimme päivittää näitä ehtoja. Muutokset tulevat voimaan, kun ne on julkaistu tällä sivulla.\n## 6. Yhteystiedot\nKysymykset ehdoista voi lähettää osoitteeseen info@example.com.";
const LEGAL_PRIVACY = "## 1. Rekisterinpitäjä\nYritys Oy, Esimerkkikatu 1, 00100 Helsinki, info@example.com\n## 2. Mitä tietoja keräämme\nKeräämme vain palvelun tarjoamiseksi tarpeelliset tiedot, kuten nimen ja sähköpostiosoitteen, kun otat meihin yhteyttä.\n## 3. Mihin tietoja käytetään\nTietoja käytetään yhteydenottoihin vastaamiseen ja palvelun kehittämiseen.\n## 4. Tietojen säilytys ja luovutus\nTietoja säilytetään vain niin kauan kuin se on tarpeen. Emme myy tietojasi eteenpäin.\n## 5. Oikeutesi\nVoit pyytää omien tietojesi tarkistamista, korjaamista tai poistamista ottamalla yhteyttä meihin.";

const PAGE_TYPES = {
  "home-landing": {
    title: "Etusivu", icon: "🚀", label: "Etusivu: Yritys / palvelu", desc: "Hero, ominaisuuslaatikot ja toimintakehotus",
    blocks: [
      ["hero", { title: "Tee arjesta sujuvampaa", text: "Helppo ja nopea palvelu, joka säästää aikaasi joka päivä. Kokeile ilmaiseksi jo tänään.", btnText: "Aloita ilmaiseksi", btnLink: "@contact" }, { bgMode: "surface", full: true }],
      ["cards", { title: "Miksi valita meidät?", items: "⚡ Nopea | Palvelu on käytössä muutamassa minuutissa.\n🔒 Turvallinen | Tietosi ovat suojassa koko ajan.\n💬 Tukea tarjolla | Autamme sinua aina kun tarvitset." }],
      ["cta", { title: "Valmis kokeilemaan?", text: "Liity tuhansien tyytyväisten käyttäjien joukkoon.", btnText: "Aloita ilmaiseksi", btnLink: "@contact" }],
    ],
  },
  "home-portfolio": {
    title: "Etusivu", icon: "🎨", label: "Etusivu: Portfolio", desc: "Esittely, taitotaulukko ja yhteydenottolomake",
    blocks: [
      ["hero", { title: "Hei, minä olen Matti 👋", text: "Teen kauniita ja nopeita verkkosivuja. Etsin aina uusia projekteja ja mielenkiintoisia haasteita.", btnText: "Ota yhteyttä", btnLink: "@contact" }],
      ["text", { title: "Minusta", body: "Olen innostunut tekijä, joka rakastaa oppimista. Vapaa-ajalla koodaan pieniä projekteja, pelaan ja ulkoilen.", card: true, narrow: false }],
      ["skills", { title: "Taidot" }],
      ["contactForm", { title: "Lähetä viesti", email: "matti@example.com" }],
    ],
  },
  "home-blog": {
    title: "Etusivu", icon: "📰", label: "Etusivu: Blogi", desc: "Lukualue, sivupalkki ja artikkelikortit",
    blocks: [
      ["articleSidebar", {}],
      ["cards", { title: "Lisää luettavaa", items: "Viikon parhaat reseptit | Kolme helppoa ruokaa kiireisille arki-iltoihin.\nNäin järjestän työpöydän | Pieniä muutoksia, jotka tekevät työskentelystä mukavampaa.\nKirjavinkit syksyyn | Viisi kirjaa, jotka kannattaa lukea sadepäivänä." }],
    ],
  },
  about: {
    title: "Tietoa meistä", icon: "ℹ️", label: "Tietoa meistä", desc: "Esittely, luvut ja arvot",
    blocks: [
      ["pagehead", { title: "Tietoa meistä", intro: "Autamme asiakkaitamme onnistumaan joka päivä." }],
      ["text", { body: "Yrityksemme perustettiin vuonna 2015 yksinkertaisella ajatuksella: palvelun pitää olla helppoa ja rehellistä.\nTänä päivänä palvelemme satoja asiakkaita ympäri Suomen. Tiimimme koostuu kokeneista ammattilaisista, jotka välittävät työstään." }],
      ["stats", {}],
      ["cards", { title: "Arvomme", items: "Rehellisyys | Sanomme asiat suoraan ja pidämme lupauksemme.\nLaatu | Teemme työn kunnolla alusta loppuun.\nAsiakaslähtöisyys | Sinun tarpeesi ohjaavat kaikkea tekemistämme." }],
    ],
  },
  services: {
    title: "Palvelut", icon: "🛠️", label: "Palvelut", desc: "Palvelut korteissa ja tarjouspyyntönappi",
    blocks: [
      ["pagehead", { title: "Palvelumme", intro: "Tarjoamme kattavat palvelut kaikkiin tarpeisiisi." }],
      ["cards", { items: "Konsultointi | Autamme löytämään juuri sinulle sopivan ratkaisun.\nToteutus | Rakennamme ratkaisun sovitussa aikataulussa.\nKoulutus | Opetamme tiimisi käyttämään uusia työkaluja.\nKäyttötuki | Autamme aina kun tarvitset apua." }],
      ["button", { text: "Pyydä tarjous", link: "@contact" }],
    ],
  },
  pricing: {
    title: "Hinnasto", icon: "💶", label: "Hinnasto", desc: "Hintapaketit rinnakkain",
    blocks: [
      ["pagehead", { title: "Hinnasto", intro: "Valitse sinulle sopiva paketti. Hinnat sisältävät arvonlisäveron." }],
      ["pricing", { btnLink: "@contact" }],
    ],
  },
  team: {
    title: "Tiimi", icon: "👥", label: "Tiimi", desc: "Henkilökortit nimellä ja roolilla",
    blocks: [
      ["pagehead", { title: "Tiimimme", intro: "Tutustu ihmisiin työmme takana." }],
      ["team", {}],
    ],
  },
  faq: {
    title: "UKK", icon: "❓", label: "UKK", desc: "Usein kysytyt kysymykset",
    blocks: [
      ["pagehead", { title: "Usein kysytyt kysymykset", intro: "Vastauksia yleisimpiin kysymyksiin." }],
      ["faq", {}],
    ],
  },
  contact: {
    title: "Yhteystiedot", icon: "✉️", label: "Yhteystiedot", desc: "Osoite, aukioloajat ja yhteydenottolomake",
    blocks: [
      ["pagehead", { title: "Ota yhteyttä", intro: "Vastaamme viesteihin yleensä seuraavana arkipäivänä." }],
      ["contact", {}],
    ],
  },
  terms: {
    title: "Käyttöehdot", icon: "📜", label: "Käyttöehdot", desc: "Esimerkkiteksti, tarkistuta ennen julkaisua", hideNav: true, footer: true,
    blocks: [
      ["pagehead", { title: "Käyttöehdot", intro: "Päivitetty: 1.1.2026" }],
      ["text", { body: LEGAL_TERMS }],
    ],
  },
  privacy: {
    title: "Tietosuoja", icon: "🔒", label: "Tietosuojaseloste", desc: "Esimerkkiteksti, tarkistuta ennen julkaisua", hideNav: true, footer: true,
    blocks: [
      ["pagehead", { title: "Tietosuojaseloste", intro: "Päivitetty: 1.1.2026" }],
      ["text", { body: LEGAL_PRIVACY }],
    ],
  },
  text: {
    title: "Uusi sivu", icon: "📝", label: "Tekstisivu", desc: "Otsikko, teksti ja nappi",
    blocks: [
      ["pagehead", { title: "Tervetuloa" }],
      ["text", { body: "Kirjoita tähän sivusi sisältö.\n## Väliotsikko\nVoit lisätä niin monta kappaletta kuin haluat." }],
      ["button", { text: "Ota yhteyttä", link: "@contact" }],
    ],
  },
  blank: {
    title: "Uusi sivu", icon: "⬜", label: "Tyhjä sivu", desc: "Rakenna itse vetämällä lohkoja",
    blocks: [],
  },
};

const STARTERS = {
  company: {
    label: "Yritys / palvelu", theme: "mono-light",
    desc: "Etusivu, palvelut, hinnasto, tietoa, UKK, yhteystiedot, käyttöehdot ja tietosuoja",
    pages: ["home-landing", "services", "pricing", "about", "faq", "contact", "terms", "privacy"],
  },
  portfolio: {
    label: "Portfolio", theme: "mono-dark",
    desc: "Esittely, taitotaulukko, tietoa ja yhteystiedot",
    pages: ["home-portfolio", "about", "contact"],
  },
  blog: {
    label: "Blogi", theme: "sand",
    desc: "Artikkeli ja sivupalkki, tietoa, yhteystiedot ja tietosuoja",
    pages: ["home-blog", "about", "contact", "privacy"],
  },
  empty: {
    label: "Tyhjä sivusto", theme: "gray-light",
    desc: "Yksi tyhjä sivu – vedä lohkot itse",
    pages: ["blank"],
  },
};

/* ---------- Kielet ---------- */

const LANG_NAME = { fi: "suomi", en: "englanti" };

// Sivujen oletusnimet suomeksi <-> englanniksi
const TITLE_EN = {
  "Etusivu": "Home", "Palvelut": "Services", "Hinnasto": "Pricing", "Tietoa meistä": "About us", "UKK": "FAQ",
  "Yhteystiedot": "Contact", "Käyttöehdot": "Terms of use", "Tietosuoja": "Privacy", "Tiimi": "Team", "Uusi sivu": "New page",
};
const TITLE_FI = Object.fromEntries(Object.entries(TITLE_EN).map(([a, b]) => [b, a]));
const titleIn = (fiTitle, lang) => (lang === "en" ? TITLE_EN[fiTitle] || fiTitle : fiTitle);

const LEGAL_TERMS_EN = "## 1. General\nThese terms of use apply to the use of this website and its services. By using the website you accept these terms.\n## 2. Use of the service\nThe service may only be used in accordance with the law and good practice. Users are responsible for their own actions in the service.\n## 3. Intellectual property\nThe website content, such as texts, images and logos, is protected by copyright. The content may not be copied without permission.\n## 4. Limitation of liability\nWe aim to keep the service reliable but are not responsible for possible interruptions or errors.\n## 5. Changes to the terms\nWe may update these terms. Changes take effect when they are published on this page.\n## 6. Contact\nQuestions about the terms can be sent to info@example.com.";
const LEGAL_PRIVACY_EN = "## 1. Controller\nCompany Ltd, 1 Example Street, 00100 Helsinki, info@example.com\n## 2. What data we collect\nWe only collect the data needed to provide the service, such as your name and email address when you contact us.\n## 3. How the data is used\nThe data is used to reply to enquiries and to improve the service.\n## 4. Retention and disclosure\nData is kept only as long as necessary. We do not sell your data to third parties.\n## 5. Your rights\nYou can ask to see, correct or delete your data by contacting us.";

// Englanninkieliset muutokset sivupohjiin: lista samassa järjestyksessä kuin PAGE_TYPES[tyyppi].blocks
const PRESETS_EN = {
  "home-landing": [
    { title: "Make everyday life smoother", text: "An easy and fast service that saves you time every day. Try it for free today.", btnText: "Start for free" },
    { title: "Why choose us?", items: "⚡ Fast | The service is ready to use in minutes.\n🔒 Secure | Your data stays protected at all times.\n💬 Support available | We help you whenever you need it." },
    { title: "Ready to try?", text: "Join thousands of happy users.", btnText: "Start for free" },
  ],
  "home-portfolio": [
    { title: "Hi, I'm Matti 👋", text: "I build beautiful and fast websites. I'm always looking for new projects and interesting challenges.", btnText: "Get in touch" },
    { title: "About me", body: "I'm an enthusiastic maker who loves learning. In my free time I code small projects, play games and spend time outdoors." },
    { title: "Skills", items: "HTML | 90\nCSS | 80\nJavaScript | 65\nGraphics | 50" },
    { title: "Send a message" },
  ],
  "home-blog": [
    {},
    { title: "More to read", items: "Best recipes of the week | Three easy dishes for busy weeknights.\nHow I organise my desk | Small changes that make working more pleasant.\nBook tips for autumn | Five books worth reading on a rainy day." },
  ],
  about: [
    { title: "About us", intro: "We help our customers succeed every day." },
    { body: "Our company was founded in 2015 with a simple idea: service should be easy and honest.\nToday we serve hundreds of customers across Finland. Our team consists of experienced professionals who care about their work." },
    {},
    { title: "Our values", items: "Honesty | We say things straight and keep our promises.\nQuality | We do the job properly from start to finish.\nCustomer focus | Your needs guide everything we do." },
  ],
  services: [
    { title: "Our services", intro: "We offer comprehensive services for all your needs." },
    { items: "Consulting | We help you find the solution that fits you.\nImplementation | We build the solution on the agreed schedule.\nTraining | We teach your team to use the new tools.\nSupport | We help whenever you need a hand." },
    { text: "Request a quote" },
  ],
  pricing: [{ title: "Pricing", intro: "Choose the plan that suits you. Prices include VAT." }, {}],
  team: [{ title: "Our team", intro: "Meet the people behind our work." }, {}],
  faq: [{ title: "Frequently asked questions", intro: "Answers to the most common questions." }, {}],
  contact: [{ title: "Get in touch", intro: "We usually reply to messages on the next business day." }, {}],
  terms: [{ title: "Terms of use", intro: "Updated: 1 Jan 2026" }, { body: LEGAL_TERMS_EN }],
  privacy: [{ title: "Privacy policy", intro: "Updated: 1 Jan 2026" }, { body: LEGAL_PRIVACY_EN }],
  text: [
    { title: "Welcome" },
    { body: "Write your page content here.\n## Subheading\nYou can add as many paragraphs as you like." },
    { text: "Contact us" },
  ],
};

// Sivupohjan lohkot halutulla kielellä: [tyyppi, sisältö, tyyli]
function presetBlocks(type, lang) {
  const PT = PAGE_TYPES[type] || PAGE_TYPES.blank;
  const en = lang === "en" ? PRESETS_EN[type] || [] : [];
  return PT.blocks.map(([t, v, s], i) => [t, { ...v, ...(en[i] || {}) }, s]);
}

// Muuttaa sivun kielen: kääntää vain ne tekstit, jotka ovat vielä esimerkkitekstejä (omat tekstit jäävät ennalleen)
function translatePage(pg, from, to) {
  pg.title = to === "en" ? TITLE_EN[pg.title] || pg.title : TITLE_FI[pg.title] || pg.title;
  const sp = presetBlocks(pg.type, from), dp = presetBlocks(pg.type, to);
  const seen = {};
  pg.blocks.forEach((b) => {
    const k = (seen[b.type] = (seen[b.type] || 0) + 1);
    const nth = (list) => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i][0] === b.type && ++n === k) return i; return -1; };
    const si = nth(sp), di = nth(dp);
    const pairs = [];
    if (si >= 0 && di >= 0) pairs.push([fullV(b.type, sp[si][1], from), fullV(b.type, dp[di][1], to)]);
    pairs.push([fullV(b.type, {}, from), fullV(b.type, {}, to)]);
    BLOCK_TYPES[b.type].fields.forEach((f) => {
      if (!f.key || (f.type !== "text" && f.type !== "textarea")) return;
      for (const [sv, dv] of pairs) {
        if (b.v[f.key] === sv[f.key]) { b.v[f.key] = dv[f.key]; break; }
      }
    });
  });
}

const remapPageRefs = (str, idMap) =>
  String(str).replace(/(^|[^a-z0-9])page:([a-z0-9]+)/g, (m, pre, id) => (idMap[id] ? pre + "page:" + idMap[id] : m));

const homeOf = (p, lang) => p.pages.find((x) => x.lang === lang);

/* =====================================================================
 * 6. Sivuston kokoaminen
 * ===================================================================== */

// Tiedostonimet: pääkielen etusivu on index.html, toisen kielen etusivu esim. en.html,
// toisen kielen muut sivut esim. en-about-us.html
function fileMap(p) {
  const used = new Set();
  const m = {};
  p.pages.forEach((pg) => {
    const home = homeOf(p, pg.lang) === pg;
    const prefix = pg.lang === p.lang ? "" : pg.lang + "-";
    let base = home ? (pg.lang === p.lang ? "index" : pg.lang) : prefix + (slugify(pg.title) || "sivu");
    if (!home && base === "index") base = "sivu";
    let n = base, k = 2;
    while (used.has(n)) n = base + "-" + k++;
    used.add(n);
    m[pg.id] = n + ".html";
  });
  return m;
}

// Evästekysely: automaattisesti silloin, kun sivulla on ulkopuolista sisältöä (Instagram-upotus)
function needsConsent(p) {
  if (normalizeCode(p.code).gate && hasCode(p)) return true;
  return p.pages.some((pg) => pg.blocks.some((b) => !b.hidden && b.type === "instagram" && instagramEmbedUrl(b.v.url)));
}
const cookieActive = (p) => p.cookieMode === "on" || (p.cookieMode === "auto" && needsConsent(p));

// ---- Google Fonts -------------------------------------------------------
// [nimi, tyyppi, painot]. Painot on valittu niin, että Googlen osoite toimii.
const FONTS = [
  ["Inter", "sans-serif", "400;600;800"], ["Roboto", "sans-serif", "400;500;700"],
  ["Open Sans", "sans-serif", "400;600;700;800"], ["Montserrat", "sans-serif", "400;600;700;800"],
  ["Poppins", "sans-serif", "400;600;700;800"], ["Lato", "sans-serif", "400;700;900"],
  ["Nunito", "sans-serif", "400;600;700;800"], ["Raleway", "sans-serif", "400;600;700;800"],
  ["Work Sans", "sans-serif", "400;600;700;800"], ["DM Sans", "sans-serif", "400;500;700"],
  ["Source Sans 3", "sans-serif", "400;600;700"],
  ["Playfair Display", "serif", "400;600;700;800"], ["Merriweather", "serif", "400;700;900"],
  ["Lora", "serif", "400;600;700"], ["Roboto Slab", "serif", "400;600;700"],
  ["Libre Baskerville", "serif", "400;700"], ["Cormorant Garamond", "serif", "400;600;700"],
  ["Oswald", "sans-serif", "400;600;700"], ["Bebas Neue", "sans-serif", "400"],
  ["Pacifico", "cursive", "400"], ["Lobster", "cursive", "400"],
  ["Dancing Script", "cursive", "400;600;700"], ["Caveat", "cursive", "400;600;700"],
  ["Space Mono", "monospace", "400;700"],
];
const FONT_KINDS = { "sans-serif": "ei serif", serif: "serif", cursive: "koriste", monospace: "kiinteä leveys" };
const FONT_ROLES = [
  ["body", "Leipäteksti", "Kaikki tavallinen teksti"],
  ["head", "Otsikot", "Otsikot ja hero-otsikko"],
  ["nav", "Logo ja valikko", "Sivun nimi ja yläpalkin linkit"],
  ["btn", "Napit", "Napit ja painikkeet"],
];
const FONT_PAIRS = [
  ["", "– valitse valmis yhdistelmä –", null],
  ["clean", "Siisti: Inter + Inter", { body: "Inter", head: "Inter", nav: "Inter", btn: "Inter" }],
  ["classic", "Klassinen: Playfair + Lato", { body: "Lato", head: "Playfair Display", nav: "Lato", btn: "Lato" }],
  ["modern", "Moderni: Montserrat + Open Sans", { body: "Open Sans", head: "Montserrat", nav: "Montserrat", btn: "Montserrat" }],
  ["bold", "Painokas: Oswald + Roboto", { body: "Roboto", head: "Oswald", nav: "Oswald", btn: "Oswald" }],
  ["friendly", "Ystävällinen: Poppins + Nunito", { body: "Nunito", head: "Poppins", nav: "Poppins", btn: "Poppins" }],
  ["system", "Palauta järjestelmäfontit", { body: "", head: "", nav: "", btn: "" }],
];
const fontOk = (n) => (FONTS.some((f) => f[0] === n) ? n : "");
const fontStack = (n) => {
  const f = FONTS.find((x) => x[0] === n);
  return f ? `"${f[0]}",${f[1]}` : "inherit";
};
// Palauttaa <link>-rivit vain niille fonteille, joita sivusto oikeasti käyttää
function fontLinks(p) {
  const used = [...new Set(FONT_ROLES.map((r) => (p.fonts || {})[r[0]]).filter(Boolean))];
  const fams = used.map((n) => FONTS.find((f) => f[0] === n)).filter(Boolean)
    .map((f) => "family=" + f[0].replace(/ /g, "+") + ":wght@" + f[2]);
  if (!fams.length) return "";
  return `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap">\n`;
}
const fontVars = (p) => {
  const f = p.fonts || {};
  const sys = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const body = f.body ? fontStack(f.body) + "," + sys : sys;
  const v = (k) => (f[k] ? fontStack(f[k]) + "," + body : "var(--f-body)");
  return `--f-body:${body};--f-head:${v("head")};--f-nav:${v("nav")};--f-btn:${v("btn")}`;
};

const SITE_CSS = `
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--f-body);line-height:1.6;min-height:100vh;display:flex;flex-direction:column}
main{flex:1;display:block}
a{color:inherit}
img{max-width:100%}
h1,h2,h3{line-height:1.2;font-family:var(--f-head)}
.wrap{max-width:68rem;margin:0 auto;padding:0 1.5rem}
.muted{color:var(--muted)}
.small{font-size:.9rem}
.center{text-align:center}
.nowrap{white-space:nowrap}
.right{text-align:right}

/* Yläpalkki */
.site-header{border-bottom:1px solid var(--line);background:var(--bg);position:sticky;top:0;z-index:20}
.site-header .wrap{padding-top:.85rem;padding-bottom:.85rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem}
.brand{font-family:var(--f-nav);display:flex;align-items:center;gap:.7rem;font-weight:800;font-size:1.25rem;text-decoration:none}
.logo{display:block;width:auto;max-width:14rem;object-fit:contain}
.nav{font-family:var(--f-nav);display:flex;flex-wrap:wrap;gap:1.4rem;font-size:.95rem}
.nav a{text-decoration:none;opacity:.72;padding-bottom:2px;border-bottom:2px solid transparent}
.nav a:hover{opacity:1}
.nav a.active{opacity:1;border-bottom-color:var(--accent)}
.nav-toggle{display:none;flex-direction:column;justify-content:center;gap:5px;width:2.7rem;height:2.7rem;padding:0 .65rem;background:none;border:1px solid var(--line);border-radius:.6rem;cursor:pointer}
.nav-toggle span{display:block;height:2px;border-radius:2px;background:var(--text);transition:transform .2s,opacity .2s}
.site-header.open .nav-toggle span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.site-header.open .nav-toggle span:nth-child(2){opacity:0}
.site-header.open .nav-toggle span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
@media(max-width:720px){
  .nav-toggle{display:flex}
  .nav{display:none;width:100%;flex-direction:column;gap:0}
  .site-header.open .nav{display:flex}
  .nav a{padding:.85rem 0;border-bottom:1px solid var(--line);opacity:1}
  .nav a.active{border-bottom-color:var(--accent)}
}

/* Lohkot */
.blk{position:relative;width:min(68rem,calc(100% - 2rem));margin:0 auto;overflow:hidden}
.blk.full{width:100%}
.blk.has-bg:not(.full){border-radius:1rem;margin-top:.75rem;margin-bottom:.75rem}
.blk-img,.blk-layer{position:absolute;inset:0;pointer-events:none}
.blk-img{background-size:cover;background-position:center}
.blk-inner{position:relative;z-index:1;max-width:68rem;margin:0 auto;padding:var(--py) 1.5rem}
.pad-none{--py:0}.pad-sm{--py:1rem}.pad-md{--py:2.25rem}.pad-lg{--py:4.5rem}
.blk.full.edge .blk-inner{max-width:none;padding-left:0;padding-right:0}
.blk.full.edge .ov{border-radius:0}
.ph{border:2px dashed var(--line);border-radius:1rem;padding:1.8rem;text-align:center;color:var(--muted)}

.card{background:var(--surface);color:var(--text);--muted:var(--muted-base);--line:var(--line-base);border:1px solid var(--line);border-radius:1rem;padding:1.5rem}
.card-title{font-size:1.2rem;font-weight:700;margin:0 0 .5rem}
.card-title.big{font-size:1.6rem;margin-bottom:1rem}
.card p{margin:0}
a.card-link{display:block;text-decoration:none}
a.card-link:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.hd{font-weight:800;margin:0}
h1.hd{font-size:clamp(2rem,5vw,3rem)}h2.hd{font-size:clamp(1.5rem,3.5vw,2.1rem)}h3.hd{font-size:1.3rem}
.pagetitle{font-size:clamp(2rem,5vw,3rem);font-weight:800;margin:0}
.lead{font-size:1.15rem;margin:.75rem 0 0;max-width:42rem}
.center-title{font-size:1.9rem;font-weight:800;text-align:center;margin:0 0 2rem}
.center-title.small-title{font-size:1.05rem;margin-bottom:1rem}
.narrow-col{max-width:46rem;margin:0 auto}
.divider{border:0;border-top:1px solid var(--line);margin:0 auto}
.grid-auto{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
.g-2{grid-template-columns:repeat(2,1fr)}.g-3{grid-template-columns:repeat(3,1fr)}.g-4{grid-template-columns:repeat(4,1fr)}
@media(max-width:760px){.g-2,.g-3,.g-4{grid-template-columns:1fr}}

.btn{display:inline-block;background:var(--accent);color:var(--accentText);padding:.8rem 1.6rem;border-radius:.6rem;font-weight:600;text-decoration:none;border:2px solid var(--accent);cursor:pointer;font-size:1rem;font-family:var(--f-btn);margin:.2rem}
.btn:hover{opacity:.88}
.btn.lg{padding:1rem 2.2rem;font-size:1.15rem}
.btn.outline{background:transparent;color:inherit;border-color:currentColor}
.on-accent .btn{background:var(--accentText);color:var(--accent);border-color:var(--accentText)}
.on-accent .btn.outline{background:transparent;color:inherit;border-color:currentColor}

.hero{max-width:52rem;margin:0 auto}
.hero h1{font-size:clamp(2.2rem,6vw,3.8rem);font-weight:800;margin:0 0 1.2rem}
.hero p{font-size:1.2rem;margin:0 0 2rem}
.cta{text-align:center;max-width:40rem;margin:0 auto}
.cta h2{font-size:2rem;margin:0 0 .6rem}
.cta p{margin:0 0 1.8rem;opacity:.92}
.prose p{margin:0 0 1.1rem;line-height:1.85;font-size:1.05rem}
.prose p:last-child{margin-bottom:0}
.prose h2{font-size:1.4rem;font-weight:700;margin:2rem 0 .6rem}
.prose h2:first-child{margin-top:0}
.field{width:100%;padding:.75rem 1rem;border-radius:.6rem;border:1px solid var(--line-base);background:var(--surface);color:var(--text);font:inherit}
.fig{margin:0}.fig figcaption{margin-top:.5rem;text-align:center}
.bar{height:.5rem;border-radius:9999px;background:var(--line-base)}
.bar i{display:block;height:100%;border-radius:9999px;background:var(--accent)}
.skills{width:100%;border-collapse:collapse}
.skills td{padding:.8rem .6rem;border-top:1px solid var(--line-base)}
.skills tr:first-child td{border-top:0}
.blog-grid{display:grid;gap:3rem;grid-template-columns:1fr}
.contact-grid{display:grid;gap:2rem;grid-template-columns:1fr}
@media(min-width:800px){.blog-grid:not(.no-side){grid-template-columns:1fr 16rem}.contact-grid{grid-template-columns:1fr 1fr}}
.article-title{font-size:clamp(2rem,5vw,2.8rem);font-weight:800;margin:0 0 .5rem}
.article-body{margin-top:1.5rem}
.side-links{list-style:none;padding:0;margin:1.25rem .25rem;display:grid;gap:.6rem}
.stats{text-align:center}
.stat-num{font-size:2.6rem;font-weight:800}
.plan{display:flex;flex-direction:column}
.plan-featured{border:2px solid var(--accent)}
.price{font-size:2rem;font-weight:800;margin:.25rem 0 1rem}
.plan ul{list-style:none;padding:0;margin:0 0 1.5rem;flex:1}
.plan li{padding:.45rem 0;border-top:1px solid var(--line)}
.plan li::before{content:"✓  "}
.plan .btn{text-align:center}
.avatar{width:4rem;height:4rem;border-radius:50%;background:var(--accent);color:var(--accentText);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.2rem;margin-bottom:1rem}
.role{font-weight:600;margin:0 0 .6rem!important}
.faq{padding:1rem 1.25rem;margin-bottom:.75rem}
.faq summary{cursor:pointer;font-weight:600}
.faq p{margin:.75rem 0 0!important}
.contact-grid .card p{margin:0 0 1.2rem}
.contact-grid .card p:last-child{margin:0}

/* Kuva + teksti päälle */
.ov{position:relative;display:flex;border-radius:1rem;overflow:hidden;background-size:cover;background-position:center;padding:2rem}
.ov-dim{position:absolute;inset:0;background:#000;pointer-events:none}
.ov-link{position:absolute;inset:0;z-index:1}
.ov-box{position:relative;z-index:2;max-width:34rem;padding:1.5rem 1.8rem;border-radius:.9rem}
.ov-box h2{margin:0 0 .5rem;font-size:clamp(1.5rem,4vw,2.4rem)}
.ov-box p{margin:0 0 1rem}
.ov-box p:last-child,.ov-box h2:last-child{margin-bottom:0}
@media(max-width:600px){.ov{padding:1rem}.ov-box{padding:1.1rem 1.2rem}}

/* Somenapit ja Instagram */
.social{display:flex;flex-wrap:wrap;gap:.6rem}
.soc{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;width:2.9rem;height:2.9rem;border-radius:50%;background:var(--accent);color:var(--accentText);text-decoration:none;font-size:.95rem;font-weight:600}
.soc svg{width:55%;height:55%;flex:none}
.soc:hover{opacity:.85;transform:translateY(-2px)}
.s-sm .soc{width:2.2rem;height:2.2rem}.s-lg .soc{width:3.6rem;height:3.6rem}
.social.pill .soc{width:auto;height:auto;border-radius:9999px;padding:.55rem 1.1rem}
.social.pill .soc svg{width:1.2rem;height:1.2rem}
.on-accent .soc{background:var(--accentText);color:var(--accent)}
.ig{text-align:center}
.ig iframe{width:100%;max-width:540px;border:0;border-radius:.75rem;background:#fff}

/* Vierekkäin: rivi, galleria, nappirivi */
.blk-row{width:min(68rem,calc(100% - 2rem));margin:0 auto;display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center}
.blk-row>.blk{flex:1 1 12rem;width:auto;min-width:0}
.blk-row>.blk:not(.has-bg) .blk-inner{padding-left:0;padding-right:0}
.gal{display:grid;gap:1rem;grid-template-columns:repeat(var(--n,3),1fr)}
.gal img{width:100%;display:block}
.gal a,.gal div{display:block;min-width:0}
.gal.square img{aspect-ratio:1;object-fit:cover}
.gal.wide img{aspect-ratio:4/3;object-fit:cover}
@media(max-width:640px){.gal{grid-template-columns:repeat(2,1fr)}}
/* Yhdistetty osio */
.blk-part+.blk-part,.blk-part+.blk-row-in,.blk-row-in+.blk-part,.blk-row-in+.blk-row-in{margin-top:1.25rem}
.blk-row-in{display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center}
.blk-row-in>.blk-part{flex:1 1 12rem;min-width:0}
.blk-row.keep,.blk-row-in.keep{flex-wrap:nowrap;gap:.75rem}
.blk-row.keep>.blk,.blk-row-in.keep>.blk-part{flex:1 1 0}
.blk-row.keep .btn,.blk-row-in.keep .btn{padding-left:.7rem;padding-right:.7rem;max-width:100%}
/* Liikkuvat referenssit */
.mq{overflow:hidden}
.mq.fade{-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
.mq-track{display:flex;width:max-content;animation:mq-run var(--dur,30s) linear infinite}
.mq.rev .mq-track{animation-direction:reverse}
.mq.pause:hover .mq-track,.mq-track:focus-within{animation-play-state:paused}
.mq-set{display:flex;flex:none;gap:1.25rem;padding-right:1.25rem;align-items:center}
.mq-it{flex:none;display:block;width:var(--w,11rem);color:inherit;text-decoration:none}
.mq-it.card{background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:.8rem}
.mq-it img{display:block;width:100%;border-radius:.6rem}
.mq.contain img{aspect-ratio:3/2;object-fit:contain}
.mq.square img{aspect-ratio:1;object-fit:cover}
.mq.gray img{filter:grayscale(1);opacity:.8;transition:filter .2s,opacity .2s}
.mq.gray .mq-it:hover img{filter:none;opacity:1}
.mq-cap{display:block;margin-top:.6rem;text-align:center}
.mq-cap strong{display:block}
.mq-tx{display:block;font-size:.88rem;color:var(--muted);margin-top:.15rem}
@keyframes mq-run{to{transform:translateX(-50%)}}
@media(prefers-reduced-motion:reduce){.mq{overflow-x:auto}.mq-track{animation:none}.mq-set+.mq-set{display:none}}
.btn-row{display:flex;flex-wrap:wrap;gap:.6rem}
.btn-row .btn{margin:0}

/* Evästekysely */
[hidden]{display:none!important}
.cookie{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:50;max-width:46rem;margin:0 auto;background:var(--surface);color:var(--text);border:1px solid var(--line-base);border-radius:1rem;padding:1.1rem 1.3rem;box-shadow:0 10px 40px rgba(0,0,0,.28);display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between}
.cookie p{margin:0;flex:1 1 20rem;font-size:.92rem;line-height:1.5}
.cookie .btn{padding:.55rem 1.1rem;font-size:.92rem;margin:.15rem}
.consent-ph{border:2px dashed var(--line);border-radius:1rem;padding:1.6rem;text-align:center}
.consent-ph p{margin:0 0 1rem}
.linklike{background:none;border:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0}
.lang{font-weight:700;letter-spacing:.04em;border:1px solid var(--line);border-radius:.4rem;padding:.1rem .5rem!important;border-bottom-width:1px!important}

/* Alatunniste */
.site-footer{border-top:1px solid var(--line);margin-top:4rem;padding:2rem 0;font-size:.9rem;color:var(--muted)}
.site-footer .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem}
.site-footer nav{display:flex;gap:1.2rem;flex-wrap:wrap}
`;

const NAV_SCRIPT = `<script>(function(){var b=document.querySelector('.nav-toggle'),h=document.querySelector('.site-header');if(!b||!h)return;b.addEventListener('click',function(){var o=h.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false');});})();<\/script>`;

// Skripti, joka lisätään vain esikatseluun: valinta, linkit, vedä ja pudota
const PREVIEW_SCRIPT = (o) => `<style>
[data-bid]{cursor:pointer}
[data-bid]:hover:not(.sel){outline:2px dashed #7dd3fc;outline-offset:-2px}
[data-bid].sel{outline:3px solid #0ea5e9;outline-offset:-3px}
[data-bid].drop-before{box-shadow:0 -6px 0 0 #0ea5e9}
main.drop-end::after{content:"";display:block;height:6px;background:#0ea5e9}
main:empty{min-height:12rem}
.site-header:hover,.site-footer:hover{outline:2px dashed #7dd3fc;outline-offset:-2px;cursor:pointer}
[data-bid] :is(h1,h2,h3,h4,p,figcaption):hover{cursor:text}
.kk-editing{outline:2px solid #f59e0b!important;outline-offset:3px;cursor:text!important;min-width:1ch}
</style><script>
(function(){
  var Y=${Number(o.scrollY) || 0}, SEL=${JSON.stringify(o.selected || "")}, FOCUS=${o.focus ? "true" : "false"};
  function q(id){return id?document.querySelector('[data-bid="'+id+'"]'):null}
  function sel(id,scroll){
    [].forEach.call(document.querySelectorAll('[data-bid].sel'),function(x){x.classList.remove('sel')});
    var e=q(id); if(e){e.classList.add('sel'); if(scroll)e.scrollIntoView({block:'center',behavior:'smooth'});}
  }
  function start(){ sel(SEL,false); var e=q(SEL); if(FOCUS&&e){e.scrollIntoView({block:'center'});} else {scrollTo(0,Y);} }
  addEventListener('load',function(){start();setTimeout(start,200);setTimeout(start,600);});
  addEventListener('scroll',function(){parent.postMessage({kotisivuScroll:scrollY},'*');});
  addEventListener('message',function(e){var d=e.data||{}; if(d.kotisivuSelect!==undefined) sel(d.kotisivuSelect,true);});

  document.addEventListener('click',function(e){
    var t=e.target; if(!t||!t.closest) return;
    if(editEl){ if(editEl.contains(t)) e.preventDefault(); return; }
    if(t.closest('.nav-toggle')) return;
    var ar=t.closest('.brand')?'brand':(t.closest('.site-header')&&!t.closest('.nav a'))?'header':(t.closest('.site-footer')&&!t.closest('a,button'))?'footer':'';
    if(ar&&!(e.ctrlKey||e.metaKey)){ e.preventDefault(); parent.postMessage({kotisivuArea:ar},'*'); return; }
    var a=t.closest('a'), b=t.closest('[data-bid]');
    if(a){
      var h=a.getAttribute('href')||'';
      if(h.charAt(0)==='#'&&h.length>1) return;
      e.preventDefault();
      if(!b || e.ctrlKey || e.metaKey){ if(h&&h!=='#') parent.postMessage({kotisivuGo:h},'*'); return; }
    }
    if(b){ e.preventDefault(); sel(b.getAttribute('data-bid'),false); parent.postMessage({kotisivuBlock:b.getAttribute('data-bid')},'*'); }
  });
  document.addEventListener('submit',function(e){e.preventDefault();alert('Lomaketta ei lähetetä esikatselussa.');});

  /* Suora tekstin muokkaus: kaksoisklikkaa tekstiä */
  var editEl=null, editOrig='', cancelled=false;
  var INL={STRONG:1,EM:1,B:1,I:1,SMALL:1,MARK:1,CODE:1,U:1};
  function norm(s){return (s||'').replace(/\\s+/g,' ').replace(/^ | $/g,'');}
  function unitOf(t){
    var e=t; while(e&&e.nodeType===1&&INL[e.tagName]&&e.parentNode) e=e.parentNode;
    if(!e||e.nodeType!==1||e===document.body||e===document.documentElement) return null;
    if(e.querySelector('h1,h2,h3,h4,p,div,li,ul,figure,form,img,svg,iframe')) return null;
    return e;
  }
  function areaOf(e){ if(e.closest('.brand')) return 'brand'; if(e.closest('.site-footer')&&!e.closest('a,button')) return 'footer'; return ''; }
  document.addEventListener('dblclick',function(ev){
    if(editEl||!ev.target||!ev.target.closest) return;
    var u=unitOf(ev.target); if(!u) return;
    var text=norm(u.textContent); if(!text) return;
    var b=u.closest('[data-bid]'), area=b?'':areaOf(u);
    if(!b&&!area) return;
    var root=b||(area==='brand'?document.querySelector('.brand'):document.querySelector('.site-footer'))||document;
    var same=[].filter.call(root.querySelectorAll('h1,h2,h3,h4,p,li,a,span,figcaption,td,th,label,div'),function(x){return unitOf(x)===x&&norm(x.textContent)===text;});
    var nth=Math.max(0,same.indexOf(u));
    editEl=u; ev.preventDefault();
    parent.postMessage({kotisivuEditReq:{bid:b?b.getAttribute('data-bid'):'',area:area,text:text,nth:nth}},'*');
  });
  function kd(ev){ ev.stopPropagation(); if(ev.key==='Enter'){ev.preventDefault(); if(editEl) editEl.blur();} else if(ev.key==='Escape'){ev.preventDefault(); cancelled=true; if(editEl) editEl.blur();} }
  function done(){
    var x=editEl; editEl=null; if(!x) return;
    var txt=x.textContent; x.removeEventListener('keydown',kd); x.removeAttribute('contenteditable'); x.classList.remove('kk-editing');
    parent.postMessage({kotisivuEditDone:{text:txt,cancel:cancelled||txt===editOrig}},'*'); cancelled=false;
  }
  function begin(raw){
    editOrig=raw; editEl.classList.add('kk-editing'); editEl.textContent=raw;
    editEl.setAttribute('contenteditable','plaintext-only'); if(editEl.contentEditable!=='plaintext-only') editEl.setAttribute('contenteditable','true');
    editEl.addEventListener('keydown',kd); editEl.addEventListener('blur',done,{once:true});
    editEl.focus(); var r=document.createRange(); r.selectNodeContents(editEl); var sl=getSelection(); sl.removeAllRanges(); sl.addRange(r);
  }
  addEventListener('message',function(e){var d=e.data||{}; if(d.kotisivuEditStart!==undefined){ if(d.kotisivuEditStart&&editEl) begin(d.kotisivuEditStart.raw); else editEl=null; }});

  /* Vedä ja pudota lohko suoraan sivulle */
  function clearDrop(){[].forEach.call(document.querySelectorAll('.drop-before,.drop-end'),function(x){x.classList.remove('drop-before','drop-end')});}
  function beforeId(y){
    var bl=[].slice.call(document.querySelectorAll('[data-bid]')).filter(function(x){return !x.querySelector('[data-bid]')});
    for(var i=0;i<bl.length;i++){var r=bl[i].getBoundingClientRect(); if(y<r.top+r.height/2) return bl[i].getAttribute('data-bid');}
    return '';
  }
  document.addEventListener('dragover',function(e){
    e.preventDefault(); clearDrop();
    var id=beforeId(e.clientY), b=q(id);
    if(b) b.classList.add('drop-before'); else {var m=document.querySelector('main'); if(m) m.classList.add('drop-end');}
  });
  document.addEventListener('dragleave',function(e){ if(!e.relatedTarget) clearDrop(); });
  document.addEventListener('drop',function(e){
    e.preventDefault(); var id=beforeId(e.clientY); clearDrop();
    parent.postMessage({kotisivuDrop:id},'*');
  });
})();
<\/script>`;

// Kokoaa yhden lohkon HTML:ksi taustoineen
function blockInner(b, c) {
  const BT = BLOCK_TYPES[b.type];
  let inner;
  try { inner = BT.render(b.v, c); } catch (e) { inner = `<div class="ph">⚠️ Lohkon näyttämisessä tapahtui virhe</div>`; }
  if (!inner) {
    if (!c.preview) return "";
    inner = `<div class="ph">${BT.icon} ${esc(BT.label)} – täytä tiedot vasemmalta</div>`;
  }
  return inner;
}

// Yhdistetty osio: ryhmän ensimmäisen lohkon tausta ja väli, sisällä kaikki ryhmän lohkot
function renderSect(sec, c) {
  if (sec.length === 1) return renderBlock(sec[0], c);
  const part = (b) => {
    const h = blockInner(b, c);
    return h ? `<div class="blk-part"${c.preview ? ` data-bid="${esc(b.id)}"` : ""}>${h}</div>` : "";
  };
  const rows = [];
  sec.forEach((b) => {
    const h = part(b);
    if (!h) return;
    if (b.s.inline && rows.length) { rows[rows.length - 1].push(h); if (b.s.keep) rows[rows.length - 1].keep = true; } else rows.push([h]);
  });
  return renderBlock(sec[0], c, rows.map((r) => (r.length === 1 ? r[0] : `<div class="blk-row-in${r.keep ? " keep" : ""}">${r.join("")}</div>`)).join(""));
}

function renderBlock(b, c, merged) {
  const BT = BLOCK_TYPES[b.type];
  const s = b.s;
  const inner = merged !== undefined ? merged : blockInner(b, c);
  if (!inner) return "";

  const accent = s.bgMode === "accent";
  const tint = s.bgMode === "none" ? "" :
    s.bgMode === "surface" ? "var(--surface)" : accent ? "var(--accent)" : s.bgColor;
  const bgImg = imgSrc(s.bgImage, c);

  let style = "";
  if (s.textMode === "light") style = "color:#fff;--muted:rgba(255,255,255,.78);--line:rgba(255,255,255,.3);";
  else if (s.textMode === "dark") style = "color:#111;--muted:rgba(0,0,0,.65);--line:rgba(0,0,0,.18);";
  else if (accent && !bgImg) style = "color:var(--accentText);--muted:color-mix(in srgb,var(--accentText) 78%,transparent);--line:color-mix(in srgb,var(--accentText) 30%,transparent);";

  const full = s.full && !c.inRow;
  const cls = ["blk", full ? "full" : "", full && BT.bleed && merged === undefined ? "edge" : "", tint || bgImg ? "has-bg" : "", accent ? "on-accent" : "", "pad-" + pick(s.pad, ["none", "sm", "md", "lg"], "md")]
    .filter(Boolean).join(" ");

  let layers = "";
  if (bgImg) layers += `<div class="blk-img" style="${esc("background-image:" + cssUrl(bgImg))}"></div>`;
  if (bgImg && s.bgDim > 0) layers += `<div class="blk-layer" style="background:#000;opacity:${num(s.bgDim, 0, 80, 0) / 100}"></div>`;
  if (tint) layers += `<div class="blk-layer" style="background:${esc(tint)};opacity:${+(1 - num(s.bgTransp, 0, 100, 0) / 100).toFixed(2)}"></div>`;

  return `<div class="${cls}"${style ? ` style="${esc(style)}"` : ""}${c.preview ? ` data-bid="${esc(b.id)}"` : ""}>${layers}<div class="blk-inner">${inner}</div></div>`;
}

const COOKIE_SCRIPT = `<script>(function(){
var K='kotisivu-cookie-consent',b=document.getElementById('cookie-banner');if(!b)return;
function get(){try{return localStorage.getItem(K)}catch(e){return null}}
function put(v){try{localStorage.setItem(K,v)}catch(e){}}
function load(){[].forEach.call(document.querySelectorAll('template[id^="kk-consent-"]'),function(t){var g=t.id==='kk-consent-head'?document.head:document.body,f=t.content.cloneNode(true);[].forEach.call(f.querySelectorAll('script'),function(o){var n=document.createElement('script');[].forEach.call(o.attributes,function(a){n.setAttribute(a.name,a.value)});n.text=o.textContent;o.parentNode.replaceChild(n,o);});g.appendChild(f);t.remove();});[].forEach.call(document.querySelectorAll('[data-consent-src]'),function(f){f.src=f.getAttribute('data-consent-src');f.removeAttribute('data-consent-src');f.hidden=false;var p=f.parentNode.querySelector('.consent-ph');if(p)p.hidden=true;});}
if(get()==='all')load();
if(!get())b.hidden=false;
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-cookie]');if(!t)return;var a=t.getAttribute('data-cookie');
if(a==='open'){b.hidden=false;return;}
put(a);b.hidden=true;if(a==='all')load();});
})();<\/script>`;

/* ---------- SEO ja OpenAI ---------- */
const AI_KEY = "kotisivu-openai";
const AI_PROVIDERS = {
  gemini: { label: "Google Gemini (ilmainen)", model: "gemini-3.5-flash-lite" },
  openai: { label: "OpenAI (maksullinen)", model: "gpt-5.4-mini" },
};
// Avaimet tallennetaan vain tämän selaimen muistiin. Ne EIVÄT mene projektiin, varmuuskopioon eikä ladattuun sivustoon.
function loadAi() {
  const all = { provider: "gemini", gemini: { key: "", model: AI_PROVIDERS.gemini.model }, openai: { key: "", model: AI_PROVIDERS.openai.model } };
  try {
    const o = JSON.parse(localStorage.getItem(AI_KEY) || "{}");
    if (o.provider === "gemini" || o.provider === "openai") {
      all.provider = o.provider;
      ["gemini", "openai"].forEach((k) => {
        if (o[k]) all[k] = { key: String(o[k].key || ""), model: String(o[k].model || AI_PROVIDERS[k].model) };
      });
    } else if (o.key) { // vanha tallennustapa: pelkkä OpenAI-avain
      all.provider = "openai";
      all.openai = { key: String(o.key), model: String(o.model || AI_PROVIDERS.openai.model) };
    }
  } catch (e) { /* tyhjä */ }
  return { provider: all.provider, key: all[all.provider].key, model: all[all.provider].model, all };
}
function saveAi(all) {
  try { localStorage.setItem(AI_KEY, JSON.stringify(all)); } catch (e) { toast("Avainta ei voitu tallentaa selaimen muistiin."); }
}
function cleanUrl(u) {
  u = String(u || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : "";
}
function seoOf(pg) {
  if (!pg.seo || typeof pg.seo !== "object") pg.seo = { title: "", desc: "", keywords: "", noindex: false };
  return pg.seo;
}
function pageUrl(p, pg, files) {
  const base = cleanUrl(p.siteUrl);
  if (!base) return "";
  const f = files[pg.id];
  return base + "/" + (f === "index.html" ? "" : f);
}

// <title>, kuvaus, avainsanat, canonical, Open Graph ja WebSite-tietue
function seoHead(p, pg, files, defTitle, assets) {
  const s = seoOf(pg);
  const title = String(s.title || "").trim() || defTitle;
  const desc = String(s.desc || "").trim();
  const kw = String(s.keywords || "").trim();
  const url = pageUrl(p, pg, files);
  let h = `<title>${esc(title)}</title>\n`;
  if (desc) h += `<meta name="description" content="${esc(desc)}">\n`;
  if (kw) h += `<meta name="keywords" content="${esc(kw)}">\n`;
  if (s.noindex) h += `<meta name="robots" content="noindex, nofollow">\n`;
  if (url) h += `<link rel="canonical" href="${esc(url)}">\n`;
  h += `<meta property="og:type" content="website">\n<meta property="og:site_name" content="${esc(p.siteName)}">\n<meta property="og:title" content="${esc(title)}">\n`;
  if (desc) h += `<meta property="og:description" content="${esc(desc)}">\n`;
  if (url) h += `<meta property="og:url" content="${esc(url)}">\n`;
  const fav = imgSrc(p.favicon, { assets });
  if (fav) h += `<link rel="icon" href="${esc(fav)}">\n`;
  let og = imgSrc(p.ogImage, { assets });
  if (og && !/^https?:/i.test(og) && !/^data:/i.test(og) && cleanUrl(p.siteUrl)) og = cleanUrl(p.siteUrl) + "/" + og;
  if (og && /^https?:/i.test(og)) h += `<meta property="og:image" content="${esc(og)}">\n`;
  h += `<meta property="og:locale" content="${pg.lang === "en" ? "en_US" : "fi_FI"}">\n<meta name="twitter:card" content="${og && /^https?:/i.test(og) ? "summary_large_image" : "summary"}">\n`;
  if (url && homeOf(p, pg.lang) === pg) {
    const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: p.siteName, url: cleanUrl(p.siteUrl) + "/", inLanguage: pg.lang }).replace(/</g, "\\u003c");
    h += `<script type="application/ld+json">${ld}<\/script>\n`;
  }
  return h;
}

// Sivun tekstit tekoälylle (ei kuvia, ei linkkejä)
function pageText(p, pg) {
  const parts = [];
  pg.blocks.filter((b) => !b.hidden).forEach((b) => {
    Object.values(b.v).forEach((v) => {
      if (typeof v !== "string") return;
      const t = v.replace(/\*\*/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
      if (t.length < 2 || /^(img:|https?:|page:|data:|#|@)/.test(t)) return;
      if (/^(left|center|right|light|dark|sm|md|lg|xl|none|auto|full)$/i.test(t)) return;
      parts.push(t);
    });
  });
  return parts.join("\n").slice(0, 6000);
}

const AI_TIPS = {}; // sivun id -> tekoälyn parannusvinkit (vain tämä istunto)

// Lähettää kysymyksen valitulle palvelulle ja palauttaa vastauksen tekstinä
async function aiRequest(cfg, sys, user) {
  const fail = async (r) => {
    let d = null;
    try { d = await r.json(); } catch (e) { /* ei JSONia */ }
    const msg = (d && d.error && d.error.message) || "HTTP " + r.status;
    const e = new Error(msg);
    e.status = (r.status === 400 && /api key/i.test(msg)) ? 401 : r.status;
    throw e;
  };
  if (cfg.provider === "gemini") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(cfg.model) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    });
    if (!r.ok) await fail(r);
    const d = await r.json();
    const parts = (((d.candidates || [])[0] || {}).content || {}).parts || [];
    return parts.map((x) => x.text || "").join("");
  }
  const call = (withFormat) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      ...(withFormat ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    }),
  });
  let r = await call(true);
  if (r.status === 400) r = await call(false); // malli ei tue JSON-tilaa
  if (!r.ok) await fail(r);
  const d = await r.json();
  return String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "");
}

async function aiSeoFor(p, pg) {
  const cfg = loadAi();
  if (!cfg.key) { const e = new Error("NOKEY"); e.code = "NOKEY"; throw e; }
  const content = pageText(p, pg);
  if (content.length < 10) { const e = new Error("Sivulla ei ole vielä tekstiä, josta tekoäly voisi tehdä kuvauksen."); e.code = "EMPTY"; throw e; }
  const langName = pg.lang === "en" ? "English" : "Finnish";
  const isHome = homeOf(p, pg.lang) === pg;
  const sys = `You are an SEO specialist. Write search-engine metadata for ONE web page. Reply with JSON only, shaped exactly like {"title": string, "description": string, "keywords": string, "tips": string[]}. Rules: write in ${langName}; title at most 60 characters${isHome ? ", this is the home page so lead with the main offering and the brand name" : ", end with ' | ' and the site name when it fits"}; description 120-155 characters, natural and inviting, includes the main keyword; keywords are 5-8 comma-separated search phrases; tips are at most 3 short, concrete suggestions for improving the page text for search engines; use only facts that appear in the page content, never invent prices, claims, addresses or phone numbers; no emojis and no quotation marks in title and description.`;
  const user = JSON.stringify({
    siteName: p.siteName, pageTitle: pg.title, pageType: pg.type,
    otherPages: p.pages.filter((x) => x.lang === pg.lang && x !== pg).map((x) => x.title),
    content,
  });
  const raw = await aiRequest(cfg, sys, user);
  let o = {};
  try { o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch (e) { o = {}; }
  const kw = Array.isArray(o.keywords) ? o.keywords.join(", ") : String(o.keywords || "");
  const out = { title: String(o.title || "").trim().slice(0, 70), desc: String(o.description || "").trim().slice(0, 170), keywords: kw.trim().slice(0, 200),
    tips: (Array.isArray(o.tips) ? o.tips : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 3) };
  if (!out.title && !out.desc) throw new Error("Tekoäly ei palauttanut käyttökelpoista vastausta. Yritä uudelleen.");
  AI_TIPS[pg.id] = out.tips;
  return out;
}

function aiFail(e) {
  if (e && e.code === "NOKEY") {
    toast("Lisää ensin tekoälyn avain: Sivusto-välilehti → Tekoäly.", "Avaa asetukset", () => { S.tab = "site"; renderTabs(); renderPanel(); });
  } else if (e && e.status === 401) {
    toast("Palvelu ei hyväksynyt avainta (401). Tarkista avain Sivusto-välilehdellä.");
  } else if (e && e.status === 429) {
    toast("Palvelu kieltäytyi (429): liikaa pyyntöjä tai käyttöraja täynnä. Odota hetki ja yritä uudelleen.");
  } else if (e && e.status === 403) {
    toast("Palvelu esti pyynnön (403). Avaimella ei ole oikeutta tähän malliin tai alueelta.");
  } else if (e && e.status === 404) {
    toast("Mallia ei löytynyt (404). Vaihda mallin nimi Sivusto-välilehdellä.");
  } else if (e instanceof TypeError) {
    toast("Yhteys tekoälypalveluun ei onnistunut. Tarkista verkkoyhteys.");
  } else {
    toast("Tekoäly: " + ((e && e.message) || "tuntematon virhe"));
  }
}

let seoView = "desktop";
function seoChecks(p, pg) {
  const s = seoOf(pg);
  const t = String(s.title || "").trim(), d = String(s.desc || "").trim();
  const words = pageText(p, pg).split(/\s+/).filter(Boolean).length;
  return [
    [t.length >= 30 && t.length <= 60, t ? `Otsikon pituus ${t.length} merkkiä (sopiva 30–60)` : "Otsikko puuttuu (käytetään sivun nimeä)"],
    [d.length >= 70 && d.length <= 155, d ? `Kuvauksen pituus ${d.length} merkkiä (sopiva 70–155)` : "Kuvaus puuttuu – hakukone valitsee tekstin itse"],
    [!t || !d || t.toLowerCase() !== d.toLowerCase(), "Otsikko ja kuvaus ovat eri tekstit"],
    [words >= 100, `Sivulla on ${words} sanaa tekstiä (hyvä on yli 100)`],
    [!!cleanUrl(p.siteUrl), "Sivuston osoite on annettu (Sivusto-välilehti)"],
  ];
}

function seoSection(p, pg) {
  const s = seoOf(pg);
  const out = [];
  const prev = el("div", { id: "seoPrev", style: "border:1px solid #cbd5e1;border-radius:.5rem;background:#fff;padding:.6rem .8rem;margin-bottom:.5rem;font-family:Arial,sans-serif" });
  const counts = el("span", { class: "field-hint", id: "seoCounts" });
  const checks = el("ul", { id: "seoChecks", style: "list-style:none;margin:.25rem 0 .75rem;padding:0;font-size:.8rem" });
  const view = el("div", { class: "row-buttons", style: "margin-bottom:.5rem" });
  const show = () => {
    const f = fileMap(p);
    const mobile = seoView === "mobile";
    const u = pageUrl(p, pg, f) || "https://omasivu.fi/" + (f[pg.id] === "index.html" ? "" : f[pg.id]);
    const t = String(s.title || "").trim() || (homeOf(p, pg.lang) === pg ? p.siteName : `${pg.title} – ${p.siteName}`);
    const d = String(s.desc || "").trim();
    prev.innerHTML = "";
    prev.style.maxWidth = mobile ? "22rem" : "none";
    const clamp = (n) => `display:-webkit-box;-webkit-line-clamp:${n};-webkit-box-orient:vertical;overflow:hidden`;
    prev.append(
      el("div", { style: "font-size:.75rem;color:#166534;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: mobile ? p.siteName + " · " + u.replace(/^https?:\/\//, "") : u }),
      el("div", { style: "font-size:1.05rem;color:#1a0dab;line-height:1.3;" + (mobile ? clamp(2) : "white-space:nowrap;overflow:hidden;text-overflow:ellipsis"), text: mobile ? t.slice(0, 70) : t.slice(0, 60) + (t.length > 60 ? "…" : "") }),
      el("div", { style: "font-size:.8rem;color:#4d5156;" + clamp(mobile ? 3 : 2), text: d.slice(0, 160) || "(Ei kuvausta – hakukone valitsee tekstin itse.)" }));
    counts.textContent = `Otsikko ${String(s.title || "").length}/60 merkkiä · Kuvaus ${String(s.desc || "").length}/155 merkkiä`;
    checks.innerHTML = "";
    seoChecks(p, pg).forEach(([ok, txt]) => checks.append(el("li", { style: "padding:.1rem 0;color:" + (ok ? "#166534" : "#92400e"), text: (ok ? "✅ " : "⚠️ ") + txt })));
    view.innerHTML = "";
    [["desktop", "🖥️ Tietokone"], ["mobile", "📱 Puhelin"]].forEach(([k, l]) =>
      view.append(el("button", { type: "button", class: "btn-plain", style: seoView === k ? "font-weight:700;border-color:#0ea5e9" : "", text: l, onclick: () => { seoView = k; show(); } })));
  };
  const upd = () => { save(); schedulePreview(); show(); };
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .5rem", text: "Näin sivu voi näkyä Googlen hakutuloksissa:" }), view, prev);
  out.push(fieldBlock({ label: "SEO-otsikko", type: "text", plain: true, hint: "Tyhjänä käytetään sivun nimeä ja sivuston nimeä." }, () => s.title, (v) => { s.title = v; upd(); }));
  out.push(fieldBlock({ label: "SEO-kuvaus", type: "textarea", plain: true, rows: 3 }, () => s.desc, (v) => { s.desc = v; upd(); }));
  out.push(fieldBlock({ label: "Avainsanat (pilkulla erotettuna)", type: "text", plain: true }, () => s.keywords, (v) => { s.keywords = v; upd(); }));
  out.push(counts, checks);
  out.push(fieldBlock({ label: "Piilota tämä sivu hakukoneilta (noindex)", type: "checkbox" }, () => !!s.noindex, (v) => { s.noindex = v; upd(); }));
  const btn = el("button", { type: "button", class: "btn-primary", id: "btnSeoAi", text: "✨ Analysoi sivu ja luo SEO tekoälyllä" });
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "⏳ Tekoäly analysoi sivua…";
    try {
      const r = await aiSeoFor(p, pg);
      Object.assign(s, { title: r.title, desc: r.desc, keywords: r.keywords });
      save(); schedulePreview(); renderPanel(true);
      toast("SEO-tekstit luotu. Tarkista ne ja muokkaa tarvittaessa.");
    } catch (e) {
      aiFail(e);
      btn.disabled = false; btn.textContent = "✨ Analysoi sivu ja luo SEO tekoälyllä";
    }
  });
  out.push(btn);
  const tips = AI_TIPS[pg.id] || [];
  if (tips.length) out.push(el("div", { id: "aiTips", class: "field-hint", style: "margin-top:.5rem" }, el("strong", { text: "💡 Tekoälyn vinkit sivun parantamiseen:" }), el("ul", { style: "margin:.25rem 0 0 1.1rem;list-style:disc" }, ...tips.map((x) => el("li", { text: x })))));
  out.push(el("p", { class: "field-hint", text: "Sivun tekstit lähetetään valitulle tekoälypalvelulle vain, kun painat nappia. Tekoäly voi erehtyä, joten lue tulos aina läpi. Voit myös kirjoittaa kaiken itse." }));
  show();
  return out;
}

async function aiSeoAll() {
  const p = cur();
  const todo = p.pages.filter((pg) => { const s = seoOf(pg); return !String(s.title).trim() && !String(s.desc).trim() && !s.noindex; });
  if (!todo.length) { toast("Kaikilla sivuilla on jo SEO-tekstit. Voit luoda ne uudelleen sivu kerrallaan Sivu-välilehdellä."); return; }
  if (!confirm(`Luodaan SEO-tekstit ${todo.length} sivulle, joilla sellaista ei vielä ole. Sivujen tekstit lähetetään tekoälypalvelulle. Jatketaanko?`)) return;
  let done = 0;
  for (const pg of todo) {
    toast(`Tekoäly työskentelee… ${done + 1}/${todo.length}`);
    try {
      const r = await aiSeoFor(p, pg);
      Object.assign(seoOf(pg), { title: r.title, desc: r.desc, keywords: r.keywords });
      done++; save();
    } catch (e) {
      if (e && e.code === "EMPTY") continue;
      aiFail(e); renderPanel(true); schedulePreview(); return;
    }
  }
  schedulePreview(); renderPanel(true);
  toast(`SEO-tekstit luotu ${done} sivulle. Tarkista ne Sivu-välilehdeltä.`);
}

function seoSitePanel(p, part) {
  const out = [];
  out.push(fieldBlock({ label: "Sivuston osoite (valinnainen)", type: "text", plain: true, placeholder: "https://www.omasivu.fi",
    hint: "Kun osoite on annettu, sivuille lisätään canonical-linkki ja Open Graph -tiedot, ja ZIP-pakettiin tulee sitemap.xml ja robots.txt." },
  () => p.siteUrl || "", (v) => { p.siteUrl = v.trim(); save(); schedulePreview(); }));
  out.push(el("button", { type: "button", class: "btn-primary", id: "btnSeoAll", text: "✨ Analysoi kaikki sivut ja luo SEO tekoälyllä", onclick: aiSeoAll }));
  out.push(el("p", { class: "field-hint", text: "Täyttää vain sivut, joilla ei vielä ole SEO-tekstejä. Yksittäisen sivun SEO löytyy Sivu-välilehdeltä." }));

  out.push(fieldBlock({ label: "Jakokuva (näkyy, kun sivu jaetaan somessa)", type: "image", hint: "Iso kuva, esim. 1200 × 630 px. Toimii vain, kun sivuston osoite on annettu ja sivusto on julkaistu (ZIP-lataus)." }, () => p.ogImage || "", (v) => { p.ogImage = v; save(); schedulePreview(); }));
  const cut = out.length;
  const cfg = loadAi();
  const provSel = el("select", { class: "field-input", id: "aiProvider" });
  Object.entries(AI_PROVIDERS).forEach(([k, v]) => provSel.append(el("option", { value: k, text: v.label })));
  provSel.value = cfg.provider;
  provSel.addEventListener("change", () => { const c = loadAi(); c.all.provider = provSel.value; saveAi(c.all); renderPanel(true); });
  const isG = cfg.provider === "gemini";
  const status = el("p", { class: "field-hint", id: "aiStatus", text: cfg.key ? "✅ Avain on tallennettu tähän selaimeen." : "Avainta ei ole vielä lisätty." });
  const keyIn = el("input", { class: "field-input", type: "password", id: "aiKey", autocomplete: "off", placeholder: isG ? "AIza…" : "sk-…" });
  keyIn.value = cfg.key;
  keyIn.addEventListener("change", () => {
    const c = loadAi(); c.all[c.provider].key = keyIn.value.trim(); saveAi(c.all);
    status.textContent = keyIn.value.trim() ? "✅ Avain on tallennettu tähän selaimeen." : "Avainta ei ole vielä lisätty.";
  });
  const modelIn = el("input", { class: "field-input", type: "text", id: "aiModel" });
  modelIn.value = cfg.model;
  modelIn.addEventListener("change", () => { const c = loadAi(); c.all[c.provider].model = modelIn.value.trim() || AI_PROVIDERS[c.provider].model; saveAi(c.all); modelIn.value = c.all[c.provider].model; });
  out.push(
    el("div", { class: "field-block" }, el("label", { class: "field-label", for: "aiProvider", text: "Tekoälypalvelu" }), provSel,
      el("span", { class: "field-hint", text: isG
        ? "Suositus: ilmainen, ei luottokorttia. Hanki avain: aistudio.google.com/apikey (kirjaudu Google-tilillä ja paina \"Create API key\"). Huom: Googlen ilmaisessa käytössä lähetettyjä tekstejä voidaan käyttää Googlen tuotteiden parantamiseen. Älä lähetä salaista sisältöä."
        : "Maksullinen: tarvitsee OpenAI-tilin ja krediittiä (platform.openai.com). Aseta tilille kulutusraja." })),
    el("div", { class: "field-block" }, el("label", { class: "field-label", for: "aiKey", text: isG ? "Gemini API -avain" : "OpenAI API -avain" }), keyIn),
    el("div", { class: "field-block" }, el("label", { class: "field-label", for: "aiModel", text: "Malli" }), modelIn,
      el("span", { class: "field-hint", text: `Oletus ${AI_PROVIDERS[cfg.provider].model}. Jos palvelu ilmoittaa, ettei mallia löydy tai se on poistunut, kirjoita tähän palvelun nykyinen malli.` })),
    status,
    el("button", { type: "button", class: "btn-plain", id: "btnAiClear", text: "Poista avain tästä selaimesta", onclick: () => { const c = loadAi(); c.all[c.provider].key = ""; saveAi(c.all); renderPanel(true); toast("Avain poistettu."); } }),
    el("p", { class: "field-hint", text: "Avain tallennetaan vain tämän selaimen muistiin. Se ei tallennu projektiin, varmuuskopioon eikä ladattuun sivustoon. Älä käytä avainta jaetulla koneella. Sivun tekstit lähetetään palvelulle vain, kun painat tekoälynappia." }));
  return part === "ai" ? out.slice(cut) : out.slice(0, cut);
}

/* ---------- Yleinen ulkoasu ja lisäkoodit ---------- */
const LAYOUT_DEFAULT = { width: "normal", text: "normal", radius: "soft" };
function normalizeLayout(l) {
  l = l && typeof l === "object" ? l : {};
  return {
    width: pick(l.width, ["narrow", "normal", "wide", "full"], "normal"),
    text: pick(l.text, ["small", "normal", "large"], "normal"),
    radius: pick(l.radius, ["sharp", "soft", "round"], "soft"),
  };
}
function layoutCss(p) {
  const l = normalizeLayout(p.layout);
  let c = "";
  const w = { narrow: "56rem", wide: "80rem", full: "none" }[l.width];
  if (w) c += `.wrap{max-width:${w}}\n`;
  if (l.text !== "normal") c += `html{font-size:${l.text === "small" ? "93.75" : "112.5"}%}\n`;
  if (l.radius !== "soft") {
    const r = l.radius === "sharp" ? ["0", "0", "0"] : ["999px", "1.6rem", "1.4rem"];
    c += `.btn,.field,.nav-toggle{border-radius:${r[0]}}.card,.ov,.ph,.consent-ph,.cookie,.blk.has-bg:not(.full){border-radius:${r[1]}}.ov-box{border-radius:${r[2]}}\n`;
  }
  return c;
}
const CODE_DEFAULT = { head: "", body: "", css: "", gate: false, preview: false };
function normalizeCode(c) {
  c = c && typeof c === "object" ? c : {};
  const t = (v) => String(v || "").slice(0, 30000);
  return { head: t(c.head), body: t(c.body), css: t(c.css), gate: !!c.gate, preview: !!c.preview };
}
const imgRef = (v) => { v = String(v || ""); return imgId(v) || /^https?:\/\//i.test(v) ? v : ""; };
function normalizePublish(x) {
  x = x && typeof x === "object" ? x : {};
  const repo = String(x.repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "").slice(0, 140);
  const domain = String(x.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 253);
  return { repo: /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : "", domain: /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? domain : "", client: !!x.client };
}
const hasCode = (p) => { const c = normalizeCode(p.code); return !!(c.head.trim() || c.body.trim()); };

/* ---------- Yläpalkin ulkoasu ---------- */
const HEADER_DEFAULT = { bg: "bg", color: "#ffffff", opacity: 100, blur: 0, text: "auto", sticky: true, float: false, pad: 14,
  line: true, shadow: false, align: "split", navStyle: "underline", navSize: 15, gap: 22, upper: false, full: false };
const HEADER_PRESETS = [
  ["", "– valitse valmis tyyli –", null],
  ["default", "Oletus", { ...HEADER_DEFAULT }],
  ["glass", "Lasi: puoliläpinäkyvä ja sumea", { ...HEADER_DEFAULT, opacity: 70, blur: 12 }],
  ["float", "Kelluva läpinäkyvä (kuvan päällä, vaalea teksti)", { ...HEADER_DEFAULT, bg: "none", opacity: 0, float: true, line: false, text: "light", pad: 20 }],
  ["dark", "Tumma palkki", { ...HEADER_DEFAULT, bg: "custom", color: "#111111", text: "light" }],
  ["accent", "Korostevärinen palkki", { ...HEADER_DEFAULT, bg: "accent", text: "auto", line: false }],
  ["center", "Keskitetty logo, valikko alla", { ...HEADER_DEFAULT, align: "center", navStyle: "plain" }],
];
function normalizeHeader(h) {
  h = h && typeof h === "object" ? h : {};
  const D = HEADER_DEFAULT;
  return {
    bg: pick(h.bg, ["bg", "surface", "accent", "custom", "none"], D.bg),
    color: /^#[0-9a-f]{6}$/i.test(h.color || "") ? h.color : D.color,
    opacity: num(h.opacity, 0, 100, D.opacity), blur: num(h.blur, 0, 30, D.blur),
    text: pick(h.text, ["auto", "light", "dark"], D.text),
    sticky: h.sticky !== false, float: !!h.float, pad: num(h.pad, 0, 48, D.pad),
    line: h.line !== false, shadow: !!h.shadow,
    align: pick(h.align, ["split", "center", "left"], D.align),
    navStyle: pick(h.navStyle, ["underline", "pill", "plain"], D.navStyle),
    navSize: num(h.navSize, 11, 24, D.navSize), gap: num(h.gap, 4, 60, D.gap),
    upper: !!h.upper, full: !!h.full,
  };
}
function headerCss(p) {
  const h = normalizeHeader(p.header);
  const src = { bg: "var(--bg)", surface: "var(--surface)", accent: "var(--accent)", custom: h.color, none: "transparent" }[h.bg];
  const op = h.bg === "none" ? 0 : h.opacity;
  const txt = h.text === "light" ? "#ffffff" : h.text === "dark" ? "#111111" : h.bg === "accent" ? "var(--accentText)" : "var(--text)";
  const solid = h.bg === "none" ? "var(--bg)" : src;
  let c = `.site-header{--hbg:color-mix(in srgb,${src} ${op}%,transparent);--hsolid:${solid};--htext:${txt};background:var(--hbg);color:var(--htext);`
    + `position:${h.float ? "fixed;left:0;right:0" : h.sticky ? "sticky" : "relative"};top:0;`
    + (h.blur ? `backdrop-filter:blur(${h.blur}px);-webkit-backdrop-filter:blur(${h.blur}px);` : "")
    + `border-bottom:${h.line ? "1px solid color-mix(in srgb," + txt + " 18%,transparent)" : "0"};box-shadow:${h.shadow ? "0 2px 14px rgba(0,0,0,.18)" : "none"}}\n`;
  c += `.site-header .wrap{padding-top:${h.pad}px;padding-bottom:${h.pad}px${h.full ? ";max-width:none" : ""}}\n`;
  c += `.nav-toggle span{background:var(--htext)}.nav-toggle{border-color:color-mix(in srgb,var(--htext) 30%,transparent)}\n`;
  c += `.nav{font-size:${h.navSize}px;gap:${h.gap}px${h.upper ? ";text-transform:uppercase;letter-spacing:.05em" : ""}}\n`;
  c += `.brand{${h.upper ? "text-transform:uppercase;letter-spacing:.05em;" : ""}}\n`;
  if (h.navStyle === "plain") c += `.nav a.active{border-bottom-color:transparent;font-weight:700}\n.nav a{border-bottom-color:transparent}\n`;
  c += `@media(min-width:721px){\n`;
  if (h.navStyle === "pill") c += `.nav{gap:${Math.max(4, h.gap - 14)}px}.nav a{padding:.35rem .9rem;border-radius:999px;border-bottom:0}.nav a.active{background:color-mix(in srgb,currentColor 16%,transparent)}\n`;
  if (h.align === "center") c += `.site-header .wrap{flex-direction:column;justify-content:center;text-align:center;gap:.5rem}.nav{justify-content:center}\n`;
  if (h.align === "left") c += `.site-header .wrap{justify-content:flex-start;gap:2.5rem}\n`;
  c += `}\n@media(max-width:720px){.site-header.open{background:var(--hsolid)}${h.bg === "none" && h.text === "light" ? ".site-header.open{background:#111}" : ""}}\n`;
  return c;
}

// Kokoaa yhden sivun täydeksi HTML-tiedostoksi
function renderDocument(p, pg, opts = {}) {
  const files = fileMap(p);
  const lang = pg.lang;
  const str = STR[lang] || STR.fi;
  const consent = cookieActive(p);
  const c = { project: p, page: pg, files, str, consent, preview: !!opts.preview, assets: opts.assets };
  c.href = (t) => target(c, t);

  // Lohkot riveiksi: "vierekkäin"-asetuksella merkityt lohkot liittyvät edelliseen riviin
  // Rivi = vierekkäin olevat osiot; osio = yksi lohko tai "yhdistä edelliseen" -lohkot yhdessä
  const groups = [];
  let hideRest = false;
  pg.blocks.forEach((b) => {
    if (!b.s.merge) hideRest = !!b.hidden;
    if (b.hidden || hideRest) return;
    if (b.s.merge && groups.length) { const g = groups[groups.length - 1]; g[g.length - 1].push(b); }
    else if (b.s.inline && groups.length) groups[groups.length - 1].push([b]);
    else groups.push([[b]]);
  });
  const body = groups.map((g) => g.length === 1
    ? renderSect(g[0], c)
    : `<div class="blk-row${g.some((sec) => sec[0].s.inline && sec[0].s.keep) ? " keep" : ""}">${g.map((sec) => renderSect(sec, { ...c, inRow: true })).join("")}</div>`).join("\n");

  const col = p.colors;
  const home = files[homeOf(p, lang).id];

  // Logo / nimi
  const logo = imgSrc(p.logo, c);
  let brand = "";
  if (logo && p.brandMode !== "name") brand += `<img class="logo" src="${esc(logo)}" alt="${esc(p.siteName)}" style="height:${num(p.logoHeight, 16, 160, 40)}px">`;
  if (!logo || p.brandMode !== "logo") brand += `<span>${esc(p.siteName)}</span>`;

  const navPages = p.pages.filter((x) => x.lang === lang && x.showInNav);
  const other = lang === p.lang ? (p.lang === "fi" ? "en" : "fi") : p.lang;
  const otherHome = homeOf(p, other);
  const langLink = otherHome ? `<a class="lang" href="${esc(files[otherHome.id])}" hreflang="${other}" lang="${other}">${other.toUpperCase()}</a>` : "";
  const nav = navPages.map((x) =>
    `<a href="${esc(files[x.id])}"${x.id === pg.id ? ' class="active"' : ""}>${esc(x.title)}</a>`).join("") + langLink;
  const foot = p.pages.filter((x) => x.lang === lang && PAGE_TYPES[x.type] && PAGE_TYPES[x.type].footer).map((x) =>
    `<a href="${esc(files[x.id])}">${esc(x.title)}</a>`).join("") +
    (consent ? `<button type="button" class="linklike" data-cookie="open">${esc(str.cookieOpen)}</button>` : "");
  const footSocial = p.socialFooter ? socialButtons(p.social, { size: "sm" }) : "";
  const footerText = lang === p.lang ? p.footerText : p.footerText2;
  const title = homeOf(p, lang) === pg ? p.siteName : `${pg.title} – ${p.siteName}`;
  const privacy = p.pages.find((x) => x.type === "privacy" && x.lang === lang);
  // Lisäkoodit: omat CSS-säännöt, Head- ja Footer-koodi (esikatselussa vain jos käyttäjä sallii)
  const code = normalizeCode(p.code);
  const runCode = !opts.preview || code.preview;
  const wrapCode = (id, txt) => (!txt.trim() ? "" : code.gate ? `<template id="kk-consent-${id}">${txt.replace(/<\/template/gi, "<\\/template")}</template>\n` : txt + "\n");
  const customCss = code.css.trim() ? `<style id="kk-custom-css">${code.css.replace(/<\/style/gi, "<\\/style")}</style>\n` : "";
  const headCode = runCode ? wrapCode("head", code.head) : "";
  const bodyCode = runCode ? wrapCode("body", code.body) : "";
  const banner = consent
    ? `<div id="cookie-banner" class="cookie" role="dialog" aria-label="${esc(str.cookieTitle)}" hidden><p>${esc(str.cookieText)}${privacy ? ` <a href="${esc(files[privacy.id])}">${esc(privacy.title)}</a>` : ""}</p>` +
      `<div><button type="button" class="btn" data-cookie="all">${esc(str.cookieAll)}</button><button type="button" class="btn outline" data-cookie="necessary">${esc(str.cookieNec)}</button></div></div>${COOKIE_SCRIPT}`
    : "";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(p, pg, files, title, opts.assets)}<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"><\/script>
${fontLinks(p)}<style>
:root{${fontVars(p)};--bg:${col.bg};--surface:${col.surface};--text:${col.text};--accent:${col.accent};--accentText:${col.accentText};
--line-base:color-mix(in srgb,var(--text) 15%,transparent);--muted-base:color-mix(in srgb,var(--text) 68%,transparent);
--line:var(--line-base);--muted:var(--muted-base)}
${SITE_CSS}
${layoutCss(p)}${headerCss(p)}</style>
${customCss}${headCode}
</head>
<body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="${esc(home)}">${brand}</a>
  ${nav ? `<button class="nav-toggle" type="button" aria-label="${esc(str.menu)}" aria-expanded="false"><span></span><span></span><span></span></button>
  <nav class="nav">${nav}</nav>` : ""}
</div></header>
<main>
${body}
</main>
${p.showFooter ? `<footer class="site-footer"><div class="wrap">
  <span>${esc(footerText)}</span>${footSocial}<nav>${foot}</nav>
</div></footer>` : ""}
${banner}
${bodyCode}${NAV_SCRIPT}
${opts.preview ? PREVIEW_SCRIPT(opts) : ""}
</body>
</html>`;
}

/* =====================================================================
 * 7. ZIP-paketti (ilman kirjastoja)
 * ===================================================================== */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, text } tai { name, data: Uint8Array }] -> Uint8Array (.zip)
function makeZip(files) {
  const enc = new TextEncoder();
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;

  files.forEach((f) => {
    const name = enc.encode(f.name);
    const data = f.data || enc.encode(f.text);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);          // UTF-8 -tiedostonimet
    lh.setUint16(8, 0, true);               // ei pakkausta
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + data.length;
  });

  const centralSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let pos = 0;
  all.forEach((a) => { out.set(a, pos); pos += a.length; });
  return out;
}

/* =====================================================================
 * 8. Tila ja tallennus
 * ===================================================================== */

const STORAGE_KEY = "kotisivueditori-v3";
// Asiakasversio: sama editori karsittuna. Käynnistyy, kun sivulla on window.KK_CLIENT (muokkaa/index.html).
const CLIENT = !!window.KK_CLIENT;
const CLIENT_TYPES = ["text", "textarea", "image", "gallery", "refs"];
let clientDirty = false;
let S = { projects: [], projectId: null, pageId: null, blockId: null, tab: "blocks", paletteOpen: true, cat: { site: null, page: null } };
let previewScroll = 0;
let dragPayload = null;

const cur = () => S.projects.find((p) => p.id === S.projectId);
const curPage = () => cur().pages.find((x) => x.id === S.pageId);

function save() {
  if (CLIENT) { markDirty(true); return; }
  try {
    const { blockId, cat, ...rest } = S;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch (e) {
    toast("Tallennus selaimen muistiin ei onnistu. Lataa varmuuskopio (⋯ Projekti).");
  }
}

function makePage(type, lang = "fi") {
  const PT = PAGE_TYPES[type] || PAGE_TYPES.blank;
  return {
    id: uid(), type: PAGE_TYPES[type] ? type : "blank", lang, title: titleIn(PT.title, lang), showInNav: !PT.hideNav,
    seo: { title: "", desc: "", keywords: "", noindex: false },
    blocks: presetBlocks(type, lang).map(([t, v, s]) => makeBlock(t, v, s, lang)),
  };
}

// Muuttaa oletuslinkit ("@contact") oikeiksi sivulinkeiksi (saman kielen sivulle)
function resolveLinks(p, pg) {
  pg.blocks.forEach((b) => {
    Object.keys(b.v).forEach((k) => {
      const v = b.v[k];
      if (typeof v === "string" && /^@[a-z-]+$/.test(v)) {
        const t = p.pages.find((x) => x.type === v.slice(1) && x.lang === pg.lang);
        b.v[k] = t ? "page:" + t.id : "#";
      }
    });
  });
}

const footerDefault = (name, lang) =>
  lang === "en" ? `© ${new Date().getFullYear()} ${name}. All rights reserved.` : `© ${new Date().getFullYear()} ${name}. Kaikki oikeudet pidätetään.`;

function createProject(name, starterId, themeId, lang = "fi") {
  const theme = themeById(themeId) || THEMES[0];
  const other = lang === "fi" ? "en" : "fi";
  const p = {
    id: uid(), name, siteName: name, lang,
    logo: "", brandMode: "logo", logoHeight: 40,
    showFooter: true, footerText: footerDefault(name, lang), footerText2: footerDefault(name, other), socialFooter: true,
    cookieMode: "auto",
    fonts: { body: "", head: "", nav: "", btn: "" },
    siteUrl: "",
    layout: { ...LAYOUT_DEFAULT }, code: { ...CODE_DEFAULT }, favicon: "", ogImage: "", publish: { repo: "", domain: "" },
    header: { ...HEADER_DEFAULT },
    social: Object.fromEntries(Object.keys(NETWORKS).map((k) => [k, ""])),
    themeId: theme.id, colors: { ...theme.colors }, pages: [],
  };
  (STARTERS[starterId] || STARTERS.empty).pages.forEach((t) => p.pages.push(makePage(t, lang)));
  p.pages[0].title = titleIn("Etusivu", lang);
  p.pages.forEach((pg) => resolveLinks(p, pg));
  return p;
}

// Tarkistaa ja siistii projektin (muistista tai varmuuskopiosta tullut data)
function normalizeProject(raw, newIds) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages)) return null;
  const idMap = {};
  const mainLang = pick(raw.lang, ["fi", "en"], "fi");
  const pages = raw.pages.filter((x) => x && typeof x === "object").map((x) => {
    const id = newIds ? uid() : String(x.id || uid());
    idMap[x.id] = id;
    const blocks = (Array.isArray(x.blocks) ? x.blocks : []).filter((b) => b && BLOCK_TYPES[b.type]).map((b) => {
      const BT = BLOCK_TYPES[b.type];
      return {
        id: newIds ? uid() : String(b.id || uid()), type: b.type, hidden: !!b.hidden,
        v: coerce(BT.fields, b.v), s: coerce(STYLE_FIELDS, b.s, BT.sDef),
      };
    });
    return {
      id, type: PAGE_TYPES[x.type] ? x.type : "blank", lang: pick(x.lang, ["fi", "en"], mainLang),
      title: String(x.title || "Sivu"), showInNav: x.showInNav !== false, blocks,
      seo: {
        title: String((x.seo || {}).title || "").slice(0, 120), desc: String((x.seo || {}).desc || "").slice(0, 300),
        keywords: String((x.seo || {}).keywords || "").slice(0, 300), noindex: !!(x.seo || {}).noindex,
      },
    };
  });
  if (!pages.length) return null;
  // Pääkielen sivujen pitää olla ensin, jotta ensimmäinen sivu on aina pääkielen etusivu
  pages.sort((a, b) => (a.lang === mainLang ? 0 : 1) - (b.lang === mainLang ? 0 : 1));
  if (pages[0].lang !== mainLang) pages.forEach((pg) => { pg.lang = mainLang; });
  if (newIds) {
    const re = /(^|[^a-z0-9])page:([a-z0-9]+)/g;
    pages.forEach((pg) => pg.blocks.forEach((b) => {
      Object.keys(b.v).forEach((k) => {
        if (typeof b.v[k] === "string") b.v[k] = b.v[k].replace(re, (m, pre, id) => (idMap[id] ? pre + "page:" + idMap[id] : pre + "#"));
      });
    }));
  }
  const base = themeById(raw.themeId) || THEMES[0];
  const colors = { ...base.colors };
  Object.keys(colors).forEach((k) => { if (raw.colors && isHex(raw.colors[k])) colors[k] = raw.colors[k]; });
  const social = {};
  Object.keys(NETWORKS).forEach((k) => { social[k] = String((raw.social && raw.social[k]) || ""); });
  const logo = String(raw.logo || "");
  return {
    id: newIds ? uid() : String(raw.id || uid()),
    name: String(raw.name || "Nimetön projekti"),
    lang: mainLang,
    cookieMode: pick(raw.cookieMode, ["auto", "on", "off"], "auto"),
    fonts: Object.fromEntries(["body", "head", "nav", "btn"].map((k) => [k, fontOk((raw.fonts || {})[k])])),
    siteUrl: String(raw.siteUrl || "").slice(0, 200),
    header: normalizeHeader(raw.header),
    layout: normalizeLayout(raw.layout), code: normalizeCode(raw.code), favicon: imgRef(raw.favicon), ogImage: imgRef(raw.ogImage), publish: normalizePublish(raw.publish),
    footerText2: String(raw.footerText2 == null ? footerDefault(String(raw.siteName || raw.name || ""), mainLang === "fi" ? "en" : "fi") : raw.footerText2),
    siteName: String(raw.siteName || raw.name || "Oma sivusto"),
    logo: imgId(logo) || /^https?:\/\//i.test(logo) ? logo : "",
    brandMode: pick(raw.brandMode, ["logo", "both", "name"], "logo"),
    logoHeight: num(raw.logoHeight, 16, 160, 40),
    showFooter: raw.showFooter !== false,
    footerText: String(raw.footerText == null ? "" : raw.footerText),
    socialFooter: raw.socialFooter !== false,
    social,
    themeId: themeById(raw.themeId) || raw.themeId === "custom" ? raw.themeId : base.id,
    colors, pages,
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (s && Array.isArray(s.projects)) {
      S.projects = s.projects.map((p) => normalizeProject(p, false)).filter(Boolean);
      S.projectId = s.projectId;
      S.pageId = s.pageId;
      S.tab = ["blocks", "page", "site"].includes(s.tab) ? s.tab : "blocks";
      S.paletteOpen = s.paletteOpen !== false;
    }
  } catch (e) { /* ei haittaa, aloitetaan alusta */ }

  if (!S.projects.length) {
    const p = createProject("Oma yrityssivusto", "company", "mono-light");
    S.projects.push(p);
    S.projectId = p.id;
  }
  if (!cur()) S.projectId = S.projects[0].id;
  if (!cur().pages.some((x) => x.id === S.pageId)) S.pageId = cur().pages[0].id;
}

// Poistaa muistista kuvat, joita mikään projekti ei enää käytä
function gcImages() {
  const used = new Set((JSON.stringify(S.projects).match(/img:[a-z0-9]+/g) || []).map((x) => x.slice(4)));
  Object.keys(IMAGES).forEach((id) => {
    if (!used.has(id)) { delete IMAGES[id]; idbDelete(id); }
  });
}

/* =====================================================================
 * 9. Editorin käyttöliittymä
 * ===================================================================== */

let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $("toast");
  t.textContent = msg;
  if (actionLabel) {
    t.append(el("button", { type: "button", text: actionLabel, onclick: () => { t.hidden = true; action(); } }));
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, actionLabel ? 8000 : 3500);
}

/* ---------- Esikatselu ---------- */
let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => updatePreview(), 250);
}
function updatePreview(focus) {
  clearTimeout(previewTimer);
  $("preview").srcdoc = renderDocument(cur(), curPage(), {
    preview: true, scrollY: previewScroll,
    selected: S.tab === "blocks" ? S.blockId : null, focus: !!focus,
  });
}
function sendSelect(id) {
  try { $("preview").contentWindow.postMessage({ kotisivuSelect: id || "" }, "*"); } catch (e) { /* ei haittaa */ }
}

window.addEventListener("message", (e) => {
  if (e.source !== $("preview").contentWindow) return;
  const d = e.data || {};
  if (typeof d.kotisivuScroll === "number") previewScroll = d.kotisivuScroll;
  if (typeof d.kotisivuBlock === "string") selectBlock(d.kotisivuBlock, true);
  if (!CLIENT && typeof d.kotisivuArea === "string" && AREA_CAT[d.kotisivuArea]) openCat("site", AREA_CAT[d.kotisivuArea]);
  if (d.kotisivuEditReq && typeof d.kotisivuEditReq === "object") handleEditReq(d.kotisivuEditReq);
  if (d.kotisivuEditDone && typeof d.kotisivuEditDone === "object") finishEdit(d.kotisivuEditDone);
  if (typeof d.kotisivuDrop === "string" && dragPayload) {
    const pg = curPage();
    const i = d.kotisivuDrop ? pg.blocks.findIndex((b) => b.id === d.kotisivuDrop) : -1;
    handleDrop(dragPayload, i < 0 ? pg.blocks.length : i);
  }
  if (typeof d.kotisivuGo === "string") {
    const p = cur();
    const files = fileMap(p);
    const name = d.kotisivuGo.replace(/^\.\//, "").split("#")[0];
    const pg = p.pages.find((x) => files[x.id] === name);
    if (pg) selectPage(pg.id);
    else if (/^https?:\/\//i.test(d.kotisivuGo)) window.open(d.kotisivuGo, "_blank", "noopener");
  }
});

/* ---------- Ylä- ja sivupalkit ---------- */
function renderProjectBar() {
  const sel = $("projectSelect");
  sel.innerHTML = "";
  S.projects.forEach((p) => sel.append(el("option", { value: p.id, text: p.name })));
  sel.value = S.projectId;
}

// Sivun nimi valintalistoissa; kielen tunnus näkyy vain jos sivustolla on kaksi kieltä
function pageLabel(p, pg) {
  const multi = new Set(p.pages.map((x) => x.lang)).size > 1;
  return "Sivu: " + (multi ? `[${pg.lang.toUpperCase()}] ` : "") + pg.title;
}

function renderChips() {
  const box = $("pageChips");
  const p = cur();
  const multi = new Set(p.pages.map((x) => x.lang)).size > 1;
  box.innerHTML = "";
  p.pages.forEach((pg) => {
    box.append(el("button", {
      type: "button",
      class: "chip" + (pg.id === S.pageId ? " active" : ""),
      text: (homeOf(p, pg.lang) === pg ? "🏠 " : "") + (multi ? `${pg.lang.toUpperCase()} · ` : "") + pg.title,
      onclick: () => selectPage(pg.id),
    }));
  });
}

function renderTabs() {
  document.querySelectorAll("#sideTabs .side-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === S.tab);
  });
}

function renderPanel(keep) {
  const panel = $("panel");
  const top = keep ? panel.scrollTop : 0;
  panel.innerHTML = "";
  closePop();
  const parts = S.tab === "blocks" ? blocksTab() : S.tab === "page" ? pagePanel() : sitePanel();
  panel.append(...parts);
  panel.scrollTop = top;
}

function renderAll() {
  renderProjectBar();
  renderChips();
  renderTabs();
  renderPanel();
  updatePreview();
}

/* ---------- Ponnahdusikkunat: emoji ja linkki ---------- */
const EMOJI = {
  "Hymiöt": "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😎 🤩 🥳 😏 🤔 😮 😢 😭 😡 🤗 🙌 👍 👏 🙏 💪 👋 ✌️ 🤝 👀",
  "Merkit": "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 ✨ ⭐ 🌟 🔥 💯 ✅ ❌ ⚡ 🎉 🎁 🏆 🥇 💡 📌 ✔️ ➡️ ⬇️ ☎️ ✉️ ⚠️ ❓ ❗ ♻️ 🔔",
  "Luonto": "🌞 🌙 🌈 ☁️ 🌧️ ❄️ 🌸 🌼 🌻 🌿 🍀 🌳 🌲 🌊 🏔️ 🌍 🐶 🐱 🐻 🦊 🐦 🐝 🦋 🐟",
  "Ruoka": "☕ 🍵 🍕 🍔 🍟 🌮 🍣 🍜 🥗 🍎 🍓 🍌 🍰 🧁 🍪 🍫 🍦 🍷 🍺 🥂",
  "Työ": "💼 📈 📊 📅 📝 📚 💻 📱 🖥️ 📷 🎨 🎵 🎮 🔧 🛠️ 🔒 🔑 🚀 🏠 🏢 🚗 ✈️ 💶 🛒",
};

let popOwner = null;
const popEl = () => $("pop");

function closePop() {
  popEl().hidden = true;
  popOwner = null;
}

function placePop(anchor) {
  const p = popEl();
  p.hidden = false;
  const r = anchor.getBoundingClientRect();
  p.style.left = clamp(r.left, 8, Math.max(8, window.innerWidth - p.offsetWidth - 8)) + "px";
  let top = r.bottom + 6;
  if (top + p.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - p.offsetHeight - 6);
  p.style.top = top + "px";
}

document.addEventListener("pointerdown", (e) => {
  if (popEl().hidden) return;
  if (popEl().contains(e.target) || (popOwner && popOwner.contains(e.target))) return;
  closePop();
}, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

function insertAt(input, text) {
  const s = input.selectionStart == null ? input.value.length : input.selectionStart;
  const e = input.selectionEnd == null ? s : input.selectionEnd;
  input.setRangeText(text, s, e, "end");
  input.focus();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function openEmojiPop(btn, input) {
  if (popOwner === btn && !popEl().hidden) return closePop();
  const p = popEl();
  p.innerHTML = "";
  const cats = Object.keys(EMOJI);
  let current = cats[0];
  const tabs = el("div", { class: "pop-tabs" });
  const grid = el("div", { class: "emoji-grid" });
  const draw = () => {
    tabs.innerHTML = "";
    cats.forEach((c) => tabs.append(el("button", { type: "button", class: "pop-tab" + (c === current ? " active" : ""), text: c, onclick: () => { current = c; draw(); } })));
    grid.innerHTML = "";
    EMOJI[current].split(" ").forEach((em) => grid.append(el("button", { type: "button", class: "emoji-btn", text: em, onclick: () => insertAt(input, em) })));
  };
  draw();
  p.append(tabs, grid);
  popOwner = btn;
  placePop(btn);
}

function openLinkPop(btn, input) {
  if (popOwner === btn && !popEl().hidden) return closePop();
  const start = input.selectionStart == null ? input.value.length : input.selectionStart;
  const end = input.selectionEnd == null ? start : input.selectionEnd;
  const selected = input.value.slice(start, end);
  const proj = cur();

  const p = popEl();
  p.innerHTML = "";
  const label = el("input", { type: "text", class: "field-input", placeholder: "Linkin teksti" });
  label.value = selected;
  const sel = el("select", { class: "field-input" });
  proj.pages.forEach((x) => sel.append(el("option", { value: "page:" + x.id, text: pageLabel(proj, x) })));
  sel.append(el("option", { value: "custom", text: "Oma osoite…" }));
  const url = el("input", { type: "text", class: "field-input", placeholder: "https://…", style: "margin-top:.4rem", hidden: true });
  sel.addEventListener("change", () => { url.hidden = sel.value !== "custom"; if (!url.hidden) { url.value = url.value || "https://"; url.focus(); } });
  const add = () => {
    const text = label.value.trim() || "linkki";
    const to = sel.value === "custom" ? url.value.trim() : sel.value;
    if (!to) return;
    input.focus();
    input.setSelectionRange(start, end);
    insertAt(input, `[${text}](${to})`);
    closePop();
  };
  p.append(
    el("div", { class: "field-block" }, el("label", { class: "field-label", text: "Linkin teksti" }), label),
    el("div", { class: "field-block" }, el("label", { class: "field-label", text: "Mihin linkki vie?" }), sel, url),
    el("div", { class: "row-buttons" },
      el("button", { type: "button", class: "btn-primary", text: "Lisää linkki", onclick: add }),
      el("button", { type: "button", class: "btn-plain", text: "Peruuta", onclick: closePop })));
  popOwner = btn;
  placePop(btn);
  label.focus();
}

/* ---------- Kenttien rakentaminen ---------- */
function toolBtn(label, title, fn) {
  return el("button", { type: "button", class: "tool", title, "aria-label": title, text: label, onclick: fn });
}

function fieldBlock(def, get, set) {
  const block = el("div", { class: "field-block" });
  const hint = def.hint ? el("span", { class: "field-hint", text: def.hint }) : null;

  if (def.type === "checkbox") {
    const input = el("input", { type: "checkbox", checked: !!get() });
    input.addEventListener("change", () => set(input.checked));
    block.append(el("label", { class: "check-row" }, input, def.label));
    if (hint) block.append(hint);
    return block;
  }

  if (def.type === "text" || def.type === "textarea") {
    const input = def.type === "textarea"
      ? el("textarea", { class: "field-input", rows: def.rows || 4 })
      : el("input", { type: "text", class: "field-input" });
    if (def.placeholder) input.placeholder = def.placeholder;
    input.value = get();
    input.addEventListener("input", () => set(input.value));
    const tools = el("span", { class: "tools" });
    if (!def.plain) tools.append(toolBtn("😀", "Lisää emoji", (e) => openEmojiPop(e.currentTarget, input)));
    if (def.type === "textarea" && !def.plain) {
      tools.append(toolBtn("🔗", "Lisää linkki tekstiin", (e) => openLinkPop(e.currentTarget, input)));
      tools.append(toolBtn("B", "Lihavoi valittu teksti", () => {
        const s = input.selectionStart, e2 = input.selectionEnd;
        const t = input.value.slice(s, e2) || "teksti";
        input.setRangeText(`**${t}**`, s, e2, "end");
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }));
    }
    block.append(el("div", { class: "label-row" }, el("label", { class: "field-label", text: def.label }), tools), input);
  } else {
    block.append(el("label", { class: "field-label", text: def.label }));
    if (def.type === "link") block.append(...linkControl(get, set));
    else if (def.type === "image") block.append(imageControl(get, set));
    else if (def.type === "gallery") block.append(galleryControl(get, set));
    else if (def.type === "refs") block.append(refsControl(get, set));
    else if (def.type === "select") {
      const sel = el("select", { class: "field-input" });
      def.options.forEach(([val, lab]) => sel.append(el("option", { value: val, text: lab })));
      sel.value = get();
      sel.addEventListener("change", () => set(sel.value));
      block.append(sel);
    } else if (def.type === "range") {
      const unit = def.unit || "";
      const val = el("span", { class: "range-val", text: get() + unit });
      const input = el("input", { type: "range", min: def.min, max: def.max, step: 1 });
      input.value = get();
      input.addEventListener("input", () => { val.textContent = input.value + unit; set(Number(input.value)); });
      block.append(el("div", { class: "range-row" }, input, val));
    } else if (def.type === "color") {
      const input = el("input", { type: "color", class: "field-input color" });
      input.value = get();
      input.addEventListener("input", () => set(input.value));
      block.append(input);
    }
  }
  if (hint) block.append(hint);
  return block;
}

// Linkki: valitaan sivu listasta tai kirjoitetaan oma osoite
function linkControl(get, set) {
  const p = cur();
  const val = String(get() || "#");
  const pageVal = val.startsWith("page:") && p.pages.some((x) => "page:" + x.id === val);
  const none = !pageVal && (val === "#" || val === "");

  const sel = el("select", { class: "field-input" });
  sel.append(el("option", { value: "#", text: "(ei linkkiä)" }));
  p.pages.forEach((x) => sel.append(el("option", { value: "page:" + x.id, text: pageLabel(p, x) })));
  sel.append(el("option", { value: "custom", text: "Oma osoite…" }));
  sel.value = pageVal ? val : none ? "#" : "custom";

  const custom = el("input", { type: "text", class: "field-input", placeholder: "https://… tai mailto:… tai tel:…", style: "margin-top:.4rem", hidden: sel.value !== "custom" });
  custom.value = sel.value === "custom" ? val : "";

  sel.addEventListener("change", () => {
    if (sel.value === "custom") {
      custom.hidden = false;
      custom.value = custom.value || "https://";
      set(custom.value);
      custom.focus();
    } else {
      custom.hidden = true;
      set(sel.value);
    }
  });
  custom.addEventListener("input", () => set(custom.value.trim()));
  return [sel, custom];
}

// Kuva: lataa tiedosto tai liitä osoite
function imageControl(get, set) {
  const wrap = el("div", { class: "img-ctl" });
  const val = String(get() || "");
  const src = imgSrc(val, null);
  if (src) wrap.append(el("img", { class: "img-thumb", src, alt: "" }));

  const file = el("input", { type: "file", accept: "image/*", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    try {
      const data = await processImage(f);
      const id = uid();
      IMAGES[id] = data;
      idbPut(id, data);
      set("img:" + id);
      renderPanel(true);
    } catch (e) {
      toast("Kuvan lataus epäonnistui. Kokeile toista kuvaa.");
    }
  });

  wrap.append(file, el("div", { class: "row-buttons" },
    el("button", { type: "button", class: "btn-plain", text: val ? "Vaihda kuva…" : "📁 Valitse kuva…", onclick: () => file.click() }),
    val ? el("button", { type: "button", class: "btn-danger", text: "Poista kuva", onclick: () => { set(""); renderPanel(true); } }) : null));

  const url = el("input", { type: "text", class: "field-input", placeholder: "tai liitä kuvan verkko-osoite (https://…)", style: "margin-top:.5rem" });
  url.value = /^https?:/i.test(val) ? val : "";
  url.addEventListener("input", () => set(url.value.trim()));
  url.addEventListener("change", () => renderPanel(true));
  wrap.append(url);
  return wrap;
}

// Galleria: lista kuvista, joilla jokaisella oma kuvaus ja linkki
function galleryControl(get, set) {
  let items = parseGallery(get());
  const wrap = el("div", { class: "gal-ctl" });
  const commit = () => set(JSON.stringify(items));

  const file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    const list = [...file.files];
    file.value = "";
    let failed = 0;
    for (const f of list) {
      try {
        const data = await processImage(f);
        const id = uid();
        IMAGES[id] = data;
        idbPut(id, data);
        items.push({ src: "img:" + id, alt: "", link: "#" });
      } catch (e) { failed++; }
    }
    if (failed) toast(`${failed} kuvaa ei voitu ladata.`);
    commit();
    draw();
  });

  const draw = () => {
    wrap.innerHTML = "";
    items.forEach((it, i) => {
      const alt = el("input", { type: "text", class: "field-input", placeholder: "Kuvan kuvaus (valinnainen)" });
      alt.value = it.alt;
      alt.addEventListener("input", () => { it.alt = alt.value; commit(); });
      const linkParts = linkControl(() => it.link, (v) => { it.link = v; commit(); });
      wrap.append(el("div", { class: "gal-row" },
        el("img", { class: "gal-thumb", src: imgSrc(it.src, null), alt: "" }),
        el("div", { class: "gal-fields" }, alt, el("div", { style: "margin-top:.4rem" }, ...linkParts)),
        el("div", { class: "gal-act" },
          iconBtn("↑", "Siirrä ylös", () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; commit(); draw(); }, i === 0),
          iconBtn("↓", "Siirrä alas", () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; commit(); draw(); }, i === items.length - 1),
          iconBtn("🗑", "Poista kuva", () => { items.splice(i, 1); commit(); draw(); }))));
    });
    wrap.append(file, el("button", { type: "button", class: "btn-plain", text: "＋ Lisää kuvia…", onclick: () => file.click() }));
  };
  draw();
  return wrap;
}

// Referenssien kohteet: kuva ja/tai otsikko ja teksti, linkki valinnainen
function refsControl(get, set) {
  let items = parseRefs(get());
  const wrap = el("div", { class: "gal-ctl" });
  const commit = () => set(JSON.stringify(items));
  const readImg = async (f) => {
    const data = await processImage(f);
    const id = uid();
    IMAGES[id] = data;
    idbPut(id, data);
    return "img:" + id;
  };
  const file = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
  file.addEventListener("change", async () => {
    const list = [...file.files];
    file.value = "";
    let failed = 0;
    for (const f of list) {
      try { items.push({ src: await readImg(f), title: "", text: "", link: "#" }); } catch (e) { failed++; }
    }
    if (failed) toast(`${failed} kuvaa ei voitu ladata.`);
    commit();
    draw();
  });

  const draw = () => {
    wrap.innerHTML = "";
    wrap.append(el("p", { class: "field-hint", style: "margin:0 0 .5rem", text: `${items.length} kohdetta. Klikkaa pientä kuvaa vaihtaaksesi sen.` }));
    items.forEach((it, i) => {
      const one = el("input", { type: "file", accept: "image/*", hidden: true });
      one.addEventListener("change", async () => {
        const f = one.files[0];
        one.value = "";
        if (!f) return;
        try { it.src = await readImg(f); commit(); draw(); } catch (e) { toast("Kuvaa ei voitu ladata."); }
      });
      const thumb = it.src
        ? el("img", { class: "gal-thumb", src: imgSrc(it.src, null), alt: "" })
        : el("div", { class: "gal-thumb", style: "display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-weight:700", text: "Aa" });
      thumb.style.cursor = "pointer";
      thumb.title = it.src ? "Vaihda kuva" : "Lisää kuva";
      thumb.addEventListener("click", () => one.click());
      const title = el("input", { type: "text", class: "field-input", placeholder: "Otsikko (valinnainen)" });
      title.value = it.title;
      title.addEventListener("input", () => { it.title = title.value; commit(); });
      const text = el("textarea", { class: "field-input", rows: 2, placeholder: "Teksti (valinnainen)", style: "margin-top:.4rem" });
      text.value = it.text;
      text.addEventListener("input", () => { it.text = text.value; commit(); });
      const linkParts = linkControl(() => it.link, (v) => { it.link = v; commit(); });
      wrap.append(el("div", { class: "gal-row" }, thumb, one,
        el("div", { class: "gal-fields" }, title, text, el("div", { style: "margin-top:.4rem" }, ...linkParts)),
        el("div", { class: "gal-act" },
          iconBtn("↑", "Siirrä ylös", () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; commit(); draw(); }, i === 0),
          iconBtn("↓", "Siirrä alas", () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; commit(); draw(); }, i === items.length - 1),
          iconBtn("🗑", "Poista kohde", () => { items.splice(i, 1); commit(); draw(); }))));
    });
    wrap.append(file,
      el("button", { type: "button", class: "btn-plain", "data-add": "img", text: "＋ Lisää kuvia…", onclick: () => file.click() }),
      el("button", { type: "button", class: "btn-plain", "data-add": "txt", style: "margin-left:.4rem", text: "＋ Lisää tekstikortti", onclick: () => { items.push({ src: "", title: "Otsikko", text: "Teksti", link: "#" }); commit(); draw(); } }));
  };
  draw();
  return wrap;
}

/* ---------- Lohkot-välilehti ---------- */
function iconBtn(label, title, fn, disabled) {
  return el("button", {
    type: "button", class: "ibtn", title, "aria-label": title, text: label, disabled: !!disabled,
    onclick: (e) => { e.stopPropagation(); fn(); },
  });
}

function blocksTab() {
  const pg = curPage();
  const b = pg.blocks.find((x) => x.id === S.blockId);
  if (!b) S.blockId = null;
  return b ? blockEditor(pg, b) : CLIENT ? blockList(pg) : [paletteEl(), ...blockList(pg)];
}

function paletteEl() {
  const d = el("details", { class: "pal", open: S.paletteOpen !== false });
  d.addEventListener("toggle", () => { S.paletteOpen = d.open; });
  d.append(el("summary", { text: "＋ Lisää lohko – vedä sivulle tai klikkaa" }));
  PALETTE_CATS.forEach((cat) => {
    d.append(el("h3", { class: "field-group", text: cat.label }));
    const grid = el("div", { class: "palette" });
    cat.types.forEach((t) => {
      const BT = BLOCK_TYPES[t];
      const tile = el("div", { class: "tile", draggable: "true", role: "button", tabindex: "0", title: BT.desc, "data-type": t },
        el("span", { class: "ti", text: BT.icon }), BT.label);
      tile.addEventListener("dragstart", (e) => {
        dragPayload = "new:" + t;
        e.dataTransfer.setData("text/plain", dragPayload);
        e.dataTransfer.effectAllowed = "copy";
      });
      tile.addEventListener("dragend", () => { dragPayload = null; clearDropMarks(); });
      tile.addEventListener("click", () => insertBlock(t));
      tile.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); insertBlock(t); } });
      grid.append(tile);
    });
    d.append(grid);
  });
  return d;
}

function clearDropMarks() {
  document.querySelectorAll("#panel .drop-before, #panel .drop-end").forEach((x) => x.classList.remove("drop-before", "drop-end"));
}

function blockList(pg) {
  const wrap = el("div", {});
  wrap.append(el("div", { class: "list-title" }, el("span", { text: `Sivun lohkot (${pg.blocks.length})` }), el("small", { text: CLIENT ? "valitse muokattava" : "vedä järjestääksesi" })));

  const list = el("div", { class: "blist", id: "blist" });
  if (!pg.blocks.length) list.append(el("div", { class: "blist-empty", text: "Sivu on tyhjä. Vedä lohko tähän tai klikkaa lohkoa yllä olevasta paletista." }));
  pg.blocks.forEach((b, i) => { if (!(CLIENT && b.hidden)) list.append(blockItem(pg, b, i)); });

  const dropIndex = (y) => {
    const items = [...list.querySelectorAll(".bitem")].filter((x) => !x.classList.contains("dragging"));
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (y < r.top + r.height / 2) return { idx: pg.blocks.findIndex((b) => b.id === it.dataset.id), item: it };
    }
    return { idx: pg.blocks.length, item: null };
  };
  list.addEventListener("dragover", (e) => {
    if (!dragPayload) return;
    e.preventDefault();
    clearDropMarks();
    const { item } = dropIndex(e.clientY);
    (item || list).classList.add(item ? "drop-before" : "drop-end");
  });
  list.addEventListener("dragleave", (e) => { if (!list.contains(e.relatedTarget)) clearDropMarks(); });
  list.addEventListener("drop", (e) => {
    if (!dragPayload) return;
    e.preventDefault();
    const { idx } = dropIndex(e.clientY);
    clearDropMarks();
    handleDrop(dragPayload, idx);
  });

  wrap.append(list, el("p", { class: "tip", text: CLIENT ? "💡 Klikkaa tekstiä tai kuvaa esikatselussa muokataksesi sitä, tai valitse lohko listasta. Tekstin voi muokata myös kaksoisklikkaamalla sitä (Enter tallentaa, Esc peruu). Kun olet valmis, paina Tallenna ja julkaise." : "💡 Klikkaa lohkoa esikatselussa muokataksesi sitä. Kaksoisklikkaa tekstiä muokataksesi sitä suoraan (Enter tallentaa, Esc peruu). Ctrl + klikkaus seuraa linkkiä. 👁 piilottaa lohkon, 🗑 poistaa sen." }));
  return [wrap];
}

// Osio = lohko + sitä seuraavat "yhdistä edelliseen" -lohkot
const unitLen = (arr, i) => { let n = 1; if (!arr[i].s.merge) while (i + n < arr.length && arr[i + n].s.merge) n++; return n; };
const unitPrev = (arr, i) => { if (arr[i].s.merge) return i - 1; let k = i - 1; while (k > 0 && arr[k].s.merge) k--; return Math.max(k, 0); };
const unitNext = (arr, i) => { if (arr[i].s.merge) return i + 2; const j = i + unitLen(arr, i); return j >= arr.length ? arr.length : j + unitLen(arr, j); };

function toggleMerge(id) {
  if (CLIENT) return;
  const pg = curPage();
  const i = pg.blocks.findIndex((x) => x.id === id);
  if (i < 1) return;
  pg.blocks[i].s.merge = !pg.blocks[i].s.merge;
  save();
  renderPanel(true);
  updatePreview();
}

function blockItem(pg, b, i) {
  const BT = BLOCK_TYPES[b.type];
  const item = el("div", { class: "bitem" + (b.hidden ? " off" : ""), draggable: "true", "data-id": b.id, tabindex: "0" },
    el("span", { class: "grip", text: "⠿" }),
    el("span", { class: "bicon", text: BT.icon }),
    el("span", { class: "btext" }, el("strong", { text: (b.s.merge && i > 0 ? "🔗 " : "") + (b.s.inline ? "↔ " : "") + BT.label }),
      el("small", { text: b.hidden ? "Piilotettu" : blockSummary(b) })),
    el("span", { class: "bact" },
      iconBtn(b.s.merge && i > 0 ? "⛓" : "🔗", b.s.merge && i > 0 ? "Irrota edellisestä lohkosta" : "Yhdistä edelliseen lohkoon", () => toggleMerge(b.id), i === 0),
      iconBtn("↑", "Siirrä ylös", () => moveBlockTo(b.id, unitPrev(pg.blocks, i)), i === 0),
      iconBtn("↓", "Siirrä alas", () => moveBlockTo(b.id, unitNext(pg.blocks, i)), i + unitLen(pg.blocks, i) >= pg.blocks.length),
      iconBtn(b.hidden ? "🙈" : "👁", b.hidden ? "Näytä lohko" : "Piilota lohko", () => toggleBlock(b.id)),
      iconBtn("🗑", "Poista lohko", () => deleteBlock(b.id))));
  if (b.s.merge && i > 0) item.style.cssText = "margin-left:1.2rem;border-left:3px solid #38bdf8";
  if (CLIENT) { item.draggable = false; [".bact", ".grip"].forEach((q) => { const x = item.querySelector(q); if (x) x.remove(); }); }
  item.addEventListener("click", () => selectBlock(b.id, false));
  item.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === item) selectBlock(b.id, false); });
  item.addEventListener("dragstart", (e) => {
    dragPayload = "move:" + b.id;
    e.dataTransfer.setData("text/plain", dragPayload);
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => item.classList.add("dragging"), 0);
  });
  item.addEventListener("dragend", () => { dragPayload = null; item.classList.remove("dragging"); clearDropMarks(); });
  return item;
}

function blockEditor(pg, b) {
  const BT = BLOCK_TYPES[b.type];
  const out = [el("div", { class: "editor-head" },
    el("button", { type: "button", class: "btn-plain", text: "← Lohkot", onclick: () => selectBlock(null) }),
    el("strong", { text: `${BT.icon} ${BT.label}` }),
    ...(CLIENT ? [] : [
      iconBtn(b.hidden ? "🙈" : "👁", b.hidden ? "Näytä lohko" : "Piilota lohko", () => toggleBlock(b.id)),
      iconBtn("⧉", "Kopioi lohko", () => duplicateBlock(b.id)),
      iconBtn("🗑", "Poista lohko", () => deleteBlock(b.id))]))];
  if (b.hidden) out.push(el("p", { class: "field-hint", style: "margin:-.5rem 0 1rem", text: "Tämä lohko on piilotettu, eikä se näy sivulla." }));

  const addFields = (fields, obj) => fields.forEach((f) => {
    if (f.group) { out.push(el("h2", { class: "field-group", text: f.group })); return; }
    if (f.showIf && !f.showIf(obj)) return;
    out.push(fieldBlock(f, () => obj[f.key], (val) => {
      obj[f.key] = val;
      save();
      schedulePreview();
      if (f.rerender) renderPanel(true);
    }));
  });
  if (CLIENT) {
    // Asiakas näkee vain tekstit ja kuvat
    let grp = null;
    const keep = [];
    BT.fields.forEach((f) => {
      if (f.group) { grp = f; return; }
      if (CLIENT_TYPES.includes(f.type)) { if (grp) { keep.push(grp); grp = null; } keep.push(f); }
    });
    addFields(keep, b.v);
    if (!keep.length) out.push(el("p", { class: "field-hint", text: "Tässä lohkossa ei ole muokattavia tekstejä tai kuvia." }));
  } else {
    addFields(BT.fields, b.v);
    addFields(STYLE_FIELDS, b.s);
  }
  return out;
}

/* ---------- Sivu-välilehti ---------- */
function pagePanel() {
  const p = cur(), pg = curPage();
  const same = p.pages.filter((x) => x.lang === pg.lang);
  const idx = same.indexOf(pg);
  const isHome = idx === 0;
  const fileSpan = el("span", { class: "field-hint" });
  const showFile = () => { fileSpan.textContent = "Tiedoston nimi: " + fileMap(p)[pg.id]; };
  showFile();

  const secs = {};
  let out = [];
  const sec = (id) => (out = secs[id] = []);
  sec("menu");
  const titleBlock = fieldBlock({ label: "Sivun nimi (näkyy valikossa)", type: "text" }, () => pg.title,
    (v) => { pg.title = v; showFile(); save(); renderChips(); schedulePreview(); });
  titleBlock.append(fileSpan);
  out.push(titleBlock);
  out.push(fieldBlock({ label: "Näytä sivu yläpalkin valikossa", type: "checkbox" }, () => pg.showInNav,
    (v) => { pg.showInNav = v; save(); schedulePreview(); }));

  sec("seo");
  out.push(...seoSection(p, pg));

  sec("order");
  if (isHome) out.push(el("p", { class: "field-hint", text: `Tämä on ${pg.lang === p.lang ? "etusivu" : "kieliversion etusivu"} (${fileMap(p)[pg.id]}). Se pysyy aina ensimmäisenä eikä sitä voi poistaa.` }));
  out.push(el("div", { class: "row-buttons" },
    el("button", { type: "button", class: "btn-plain", disabled: idx <= 1, text: "← Siirrä vasemmalle", onclick: () => movePage(-1) }),
    el("button", { type: "button", class: "btn-plain", disabled: isHome || idx >= same.length - 1, text: "Siirrä oikealle →", onclick: () => movePage(1) })));

  out.push(el("h2", { class: "field-group", text: "Poista" }));
  out.push(el("button", { type: "button", class: "btn-danger", disabled: isHome, text: "🗑️ Poista tämä sivu", onclick: deletePage }));
  return catPanel("page", PAGE_CATS, secs);
}

/* ---------- Sivusto-välilehti ---------- */
function sitePanel() {
  const p = cur();
  const secs = {};
  let out = [];
  const sec = (id) => (out = secs[id] = []);
  const add = (def, get, set) => out.push(fieldBlock(def, get, set));
  const upd = () => { save(); schedulePreview(); };

  sec("fonts");
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .75rem",
    text: "Valitse fontti jokaiselle tekstityypille. Fontit ladataan Googlen palvelimelta, kun sivu avataan, joten sivun avaajan pitää olla verkossa. Mukaan otetaan vain käyttämäsi fontit." }));
  const pairSel = fieldBlock({ label: "Valmis fonttiyhdistelmä", type: "select", options: FONT_PAIRS.map((x) => [x[0], x[1]]) },
    () => "", (v) => {
      const pr = FONT_PAIRS.find((x) => x[0] === v);
      if (pr && pr[2]) { p.fonts = { ...pr[2] }; upd(); renderPanel(true); }
    });
  out.push(pairSel);
  FONT_ROLES.forEach(([key, label, hint]) => {
    add({ label, type: "select", hint, options: [["", "Järjestelmäfontti (oletus)"],
      ...FONTS.map((f) => [f[0], `${f[0]} – ${FONT_KINDS[f[1]]}`])] },
    () => (p.fonts || {})[key] || "", (v) => { p.fonts = { ...(p.fonts || {}), [key]: fontOk(v) }; upd(); });
  });

  sec("brand");
  add({ label: "Sivuston nimi", type: "text" }, () => p.siteName, (v) => { p.siteName = v; upd(); });
  add({ label: "Logo (korvaa nimen yläpalkissa)", type: "image", hint: "Läpinäkyvä PNG toimii parhaiten." }, () => p.logo, (v) => { p.logo = v; upd(); });
  add({ label: "Yläpalkissa näytetään", type: "select", options: [["logo", "Vain logo (nimi, jos logoa ei ole)"], ["both", "Logo ja nimi"], ["name", "Vain nimi"]] },
    () => p.brandMode, (v) => { p.brandMode = v; upd(); });
  add({ label: "Logon korkeus", type: "range", min: 16, max: 160, unit: " px" }, () => p.logoHeight, (v) => { p.logoHeight = v; upd(); });

  sec("header");
  const hd = () => (p.header = normalizeHeader(p.header));
  const hset = (k, v, redraw) => { hd()[k] = v; save(); schedulePreview(); if (redraw) renderPanel(true); };
  out.push(fieldBlock({ label: "Valmis yläpalkin tyyli", type: "select", options: HEADER_PRESETS.map((x) => [x[0], x[1]]) },
    () => "", (v) => { const pr = HEADER_PRESETS.find((x) => x[0] === v); if (pr && pr[2]) { p.header = { ...pr[2] }; save(); schedulePreview(); renderPanel(true); } }));
  add({ label: "Yläpalkin tausta", type: "select", options: [["bg", "Sivun taustaväri"], ["surface", "Pinnan väri (hieman erottuva)"], ["accent", "Korostusväri"], ["custom", "Oma väri"], ["none", "Ei taustaa (läpinäkyvä)"]] },
    () => hd().bg, (v) => hset("bg", v, true));
  if (hd().bg === "custom") add({ label: "Yläpalkin oma väri", type: "color" }, () => hd().color, (v) => hset("color", v));
  if (hd().bg !== "none") add({ label: "Taustan läpinäkyvyys", type: "range", min: 0, max: 100, unit: " % peittävä", hint: "100 = täysin peittävä, 0 = täysin läpinäkyvä." }, () => hd().opacity, (v) => hset("opacity", v));
  add({ label: "Taustan sumennus (lasiefekti)", type: "range", min: 0, max: 30, unit: " px", hint: "Sumentaa palkin takana näkyvää sisältöä. Toimii, kun palkki on osittain läpinäkyvä." }, () => hd().blur, (v) => hset("blur", v));
  add({ label: "Tekstin väri", type: "select", options: [["auto", "Automaattinen (teeman mukaan)"], ["light", "Vaalea"], ["dark", "Tumma"]] }, () => hd().text, (v) => hset("text", v));
  add({ label: "Yläpalkin korkeus", type: "range", min: 0, max: 48, unit: " px" , hint: "Ylä- ja alatyhjä tila."}, () => hd().pad, (v) => hset("pad", v));
  add({ label: "Asettelu", type: "select", options: [["split", "Logo vasemmalla, valikko oikealla"], ["left", "Logo ja valikko vasemmalla"], ["center", "Logo keskellä, valikko sen alla"]] }, () => hd().align, (v) => hset("align", v));
  add({ label: "Valikon linkkien tyyli", type: "select", options: [["underline", "Alleviivaus valitulla sivulla"], ["pill", "Pyöreä tausta valitulla sivulla"], ["plain", "Pelkkä lihavointi valitulla sivulla"]] }, () => hd().navStyle, (v) => hset("navStyle", v));
  add({ label: "Valikon tekstin koko", type: "range", min: 11, max: 24, unit: " px" }, () => hd().navSize, (v) => hset("navSize", v));
  add({ label: "Valikon linkkien väli", type: "range", min: 4, max: 60, unit: " px" }, () => hd().gap, (v) => hset("gap", v));
  add({ label: "Isot kirjaimet (logo ja valikko)", type: "checkbox" }, () => hd().upper, (v) => hset("upper", v));
  add({ label: "Viiva yläpalkin alla", type: "checkbox" }, () => hd().line, (v) => hset("line", v));
  add({ label: "Varjo yläpalkin alla", type: "checkbox" }, () => hd().shadow, (v) => hset("shadow", v));
  add({ label: "Pysy ruudun yläreunassa vierittäessä", type: "checkbox" }, () => hd().sticky, (v) => hset("sticky", v));
  add({ label: "Kelluva: sisältö alkaa yläpalkin alta", type: "checkbox", hint: "Hyvä yhdistelmä läpinäkyvälle palkille ja iso kuva sivun alussa. Tarkista, ettei palkki peitä ensimmäistä tekstiä." }, () => hd().float, (v) => hset("float", v));
  add({ label: "Koko ruudun leveys (ei keskitettyä reunaa)", type: "checkbox" }, () => hd().full, (v) => hset("full", v));

  const other = p.lang === "fi" ? "en" : "fi";
  const hasOther = p.pages.some((x) => x.lang === other);

  sec("lang");
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .75rem",
    text: `Sivuston pääkieli: ${LANG_NAME[p.lang]}.` + (hasOther
      ? ` ${LANG_NAME[other][0].toUpperCase() + LANG_NAME[other].slice(1)}-versio on lisätty, ja yläpalkissa on kielenvaihto (${other.toUpperCase()}). Sivut näkyvät sivuvälilehdissä kielen tunnuksella.`
      : " Voit kopioida kaikki sivut toiselle kielelle. Valmiit esimerkkitekstit käännetään, omat tekstisi sinun pitää kääntää itse.") }));
  out.push(hasOther
    ? el("button", { type: "button", class: "btn-danger", id: "btnRemoveLang", text: `🗑️ Poista ${LANG_NAME[other]}-versio`, onclick: removeLanguage })
    : el("button", { type: "button", class: "btn-plain", id: "btnAddLang", text: `🌐 Lisää ${other === "en" ? "englanninkielinen" : "suomenkielinen"} versio`, onclick: addLanguage }));

  sec("footer");
  add({ label: "Näytä alatunniste", type: "checkbox" }, () => p.showFooter, (v) => { p.showFooter = v; upd(); });
  add({ label: hasOther ? `Alatunnisteen teksti (${p.lang.toUpperCase()})` : "Alatunnisteen teksti", type: "text" }, () => p.footerText, (v) => { p.footerText = v; upd(); });
  if (hasOther) add({ label: `Alatunnisteen teksti (${other.toUpperCase()})`, type: "text" }, () => p.footerText2, (v) => { p.footerText2 = v; upd(); });
  add({ label: "Näytä somenapit alatunnisteessa", type: "checkbox" }, () => p.socialFooter, (v) => { p.socialFooter = v; upd(); });

  sec("cookie");
  const cookieNow = el("p", { class: "field-hint", id: "cookieNow", style: "margin:.25rem 0 .75rem" });
  const showCookie = () => {
    cookieNow.textContent = cookieActive(p)
      ? "✅ Evästekysely näkyy tällä hetkellä sivuilla (myös esikatselussa)."
      : (p.cookieMode === "off" ? "Evästekysely on pois päältä." : "Evästekyselyä ei tarvita juuri nyt: sivuilla ei ole ulkopuolista sisältöä.");
  };
  showCookie();
  add({ label: "Evästekysely", type: "select", options: [
    ["auto", "Automaattinen (näkyy, kun sivulla on ulkopuolista sisältöä, esim. Instagram-upotus)"],
    ["on", "Aina näkyvissä"],
    ["off", "Ei koskaan"]] }, () => p.cookieMode, (v) => { p.cookieMode = v; showCookie(); upd(); });
  out.push(cookieNow);
  out.push(el("p", { class: "field-hint", text: "Tavalliset somenapit ovat pelkkiä linkkejä eivätkä aseta evästeitä, joten ne eivät käynnistä kyselyä. Instagram-upotus lataa Instagramin sisältöä: se ladataan vasta kun kävijä hyväksyy evästeet. Teksti on yleinen malli – jos käytät esim. analytiikkaa, tarkista tarpeesi." }));

  sec("seo");
  out.push(...seoSitePanel(p, "seo"));
  sec("ai");
  out.push(...seoSitePanel(p, "ai"));

  sec("social");
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .75rem", text: "Kirjoita osoite tai @käyttäjänimi. Tyhjä = nappia ei näytetä. Samat linkit toimivat alatunnisteessa ja Somenapit-lohkoissa." }));
  Object.keys(NETWORKS).forEach((k) => {
    add({ label: NETWORKS[k].label, type: "text", plain: true, placeholder: "Osoite tai @käyttäjänimi" }, () => p.social[k], (v) => { p.social[k] = v; upd(); });
  });

  sec("theme");
  const grid = el("div", { class: "theme-grid" });
  const colorInputs = {};
  THEMES.forEach((t) => {
    const b = el("button", {
      type: "button", class: "theme-btn" + (p.themeId === t.id ? " active" : ""), title: t.name, "data-theme": t.id,
      onclick: () => {
        p.themeId = t.id;
        p.colors = { ...t.colors };
        save();
        grid.querySelectorAll(".theme-btn").forEach((x) => x.classList.toggle("active", x === b));
        Object.keys(colorInputs).forEach((k) => { colorInputs[k].value = p.colors[k]; });
        updatePreview();
      },
    },
    el("div", { class: "theme-swatch", style: `background:${t.colors.bg}` },
      el("i", { style: `background:${t.colors.text}` }),
      el("b", { style: `background:${t.colors.accent}` })),
    t.name);
    grid.append(b);
  });
  out.push(grid);

  out.push(el("h2", { class: "field-group", text: "Omat värit" }));
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .75rem", text: "Muuta yksittäisiä värejä. Pohjana on valittu teema." }));
  const cg = el("div", { class: "color-grid" });
  Object.keys(COLOR_LABELS).forEach((k) => {
    const block = fieldBlock({ label: COLOR_LABELS[k], type: "color" }, () => p.colors[k], (v) => {
      p.colors[k] = v;
      p.themeId = "custom";
      save();
      grid.querySelectorAll(".theme-btn").forEach((x) => x.classList.remove("active"));
      schedulePreview();
    });
    colorInputs[k] = block.querySelector("input");
    cg.append(block);
  });
  out.push(cg);

  sec("general");
  out.push(...generalFields(p));
  sec("code");
  out.push(...codeFields(p));
  sec("publish");
  out.push(...publishFields(p));
  return catPanel("site", SITE_CATS, secs);
}

// Yleinen ulkoasu: leveys, tekstikoko, pyöristys, välilehden kuvake
function generalFields(p) {
  const out = [];
  const L = () => (p.layout = normalizeLayout(p.layout));
  const set = (k, v) => { L()[k] = v; save(); schedulePreview(); };
  out.push(fieldBlock({ label: "Sisällön leveys", type: "select", options: [["narrow", "Kapea"], ["normal", "Normaali"], ["wide", "Leveä"], ["full", "Koko ruudun leveys"]] }, () => L().width, (v) => set("width", v)));
  out.push(fieldBlock({ label: "Tekstin koko (koko sivusto)", type: "select", options: [["small", "Pieni"], ["normal", "Normaali"], ["large", "Suuri"]] }, () => L().text, (v) => set("text", v)));
  out.push(fieldBlock({ label: "Kulmien pyöristys (napit, kortit, laatikot)", type: "select", options: [["sharp", "Teräväkulmainen"], ["soft", "Pehmeä (oletus)"], ["round", "Hyvin pyöreä"]] }, () => L().radius, (v) => set("radius", v)));
  out.push(fieldBlock({ label: "Välilehden kuvake (favicon)", type: "image", hint: "Pieni neliön muotoinen kuva, esim. 64 × 64 px. Näkyy selaimen välilehdessä." }, () => p.favicon || "", (v) => { p.favicon = v; save(); schedulePreview(); }));
  return out;
}

// Julkaisu: GitHub Pages
function publishFields(p) {
  const out = [];
  const P = () => (p.publish = Object.assign({ repo: "", domain: "" }, p.publish));
  const note = (t) => el("p", { class: "field-hint", style: "margin:0 0 .6rem", text: t });
  out.push(note("Julkaise sivusto yhdellä napilla ilmaiseen GitHub Pages -palveluun. Palvelu on ilmainen, pitää sivun verkossa ja tukee omaa verkkotunnusta (domain) HTTPS-suojauksella."));
  out.push(el("details", { style: "margin:0 0 .9rem" },
    el("summary", { style: "cursor:pointer;font-weight:600", text: "Ensimmäinen kerta: näin pääset alkuun" }),
    el("ol", { class: "field-hint", style: "margin:.5rem 0 0;padding-left:1.2rem;line-height:1.5" },
      el("li", { text: "Tee ilmainen tili osoitteessa github.com." }),
      el("li", { text: "Luo uusi repositorio (+ → New repository). Nimeksi esim. kotisivu, valitse Public. Älä lisää README-tiedostoa." }),
      el("li", { text: "Luo token: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Valitse Only select repositories ja juuri tämä repositorio. Permissions: Contents = Read and write, Pages = Read and write." }),
      el("li", { text: "Kopioi token alla olevaan kenttään ja kirjoita repositorion nimi muodossa käyttäjä/kotisivu." }),
      el("li", { text: "Paina Julkaise nyt. Sivu on yleensä netissä minuutin tai kahden kuluttua." }))));
  out.push(fieldBlock({ label: "Repositorio (käyttäjä/nimi)", type: "text", plain: true, placeholder: "matti/kotisivu",
    hint: "Esim. matti/kotisivu. Ilmaisessa GitHubissa repositorion pitää olla julkinen." }, () => P().repo, (v) => { P().repo = v; save(); }));
  const tok = el("input", { class: "field-input", type: "password", id: "ghToken", autocomplete: "off", placeholder: "github_pat_…" });
  tok.value = loadGh();
  tok.addEventListener("input", () => saveGh(tok.value.trim()));
  out.push(el("div", { class: "field-block" },
    el("label", { class: "field-label", text: "GitHub-token" }), tok,
    el("span", { class: "field-hint", text: "Tallennetaan vain tämän selaimen muistiin. Se ei mene projektiin, varmuuskopioon eikä ladattuun sivustoon. Älä jaa sitä kenellekään." })));
  out.push(fieldBlock({ label: "Oma verkkotunnus (valinnainen)", type: "text", plain: true, placeholder: "www.omasivu.fi",
    hint: "Jätä tyhjäksi, niin sivu julkaistaan GitHubin osoitteeseen. Jos täytät tämän, sivuston osoitteeksi (SEO-asetus) tulee sama, ellei se ole jo asetettu." }, () => P().domain, (v) => { P().domain = v; save(); }));
  out.push(el("details", { style: "margin:0 0 .9rem" },
    el("summary", { style: "cursor:pointer;font-weight:600", text: "Oman verkkotunnuksen yhdistäminen" }),
    el("div", { class: "field-hint", style: "margin:.5rem 0 0;line-height:1.5" },
      el("p", { style: "margin:0 0 .4rem", text: "Tee tämä verkkotunnuksen ostopaikan (esim. Namecheap, Cloudflare, Domainkeskus) DNS-asetuksissa:" }),
      el("p", { style: "margin:0 0 .4rem", text: "• www.omasivu.fi: lisää CNAME-tietue, jonka arvo on käyttäjä.github.io (oma GitHub-käyttäjänimesi pienillä kirjaimilla)." }),
      el("p", { style: "margin:0 0 .4rem", text: "• omasivu.fi (ilman www): lisää neljä A-tietuetta arvoilla 185.199.108.153, 185.199.109.153, 185.199.110.153 ja 185.199.111.153." }),
      el("p", { style: "margin:0", text: "DNS-muutos voi kestää tunnin tai useamman. Tarkista tiedot tarvittaessa GitHubin ohjeesta (docs.github.com, Pages, custom domain). HTTPS-suojaus tulee GitHubilta automaattisesti, kun yhteys on valmis." }))));

  out.push(fieldBlock({ label: "Lisää asiakkaan muokkausversio (osoitteeseen /muokkaa/)", type: "checkbox",
    hint: "Asiakas voi muokata vain tekstejä ja kuvia ja tallentaa muutokset suoraan sivustolle. Tarvitset terminaalissa ajetun paivita_asiakas.py:n. Ohje alla." }, () => !!P().client, (v) => { P().client = v; save(); }));
  out.push(el("details", { style: "margin:0 0 .9rem" },
    el("summary", { style: "cursor:pointer;font-weight:600", text: "Näin annat asiakkaalle muokkausoikeuden" }),
    el("ol", { class: "field-hint", style: "margin:.5rem 0 0;padding-left:1.2rem;line-height:1.5" },
      el("li", { text: "Laita yllä oleva valinta päälle ja paina Julkaise nyt. Asiakkaan muokkausosoite on sivuston osoite + /muokkaa/." }),
      el("li", { text: "Luo asiakkaalle oma token (GitHub → Settings → Developer settings → Fine-grained tokens). Valitse Only select repositories ja tämä repositorio. Oikeus: Contents = Read and write. Muita oikeuksia ei tarvita. Aseta sille vanhenemispäivä." }),
      el("li", { text: "Anna asiakkaalle muokkausosoite ja token. Hän liittää tokenin ensimmäisellä tallennuskerralla." }),
      el("li", { text: "Jos haluat poistaa asiakkaan oikeudet, poista token GitHubista." }),
      el("li", { text: "Kun muokkaat sivustoa itse ja julkaiset uudelleen, asiakkaan muokkausversio päivittyy samalla." }))));
  const cfg2 = () => normalizePublish(p.publish);
  const status = el("div", { id: "pubStatus", class: "field-hint", style: "margin-top:.7rem;white-space:pre-wrap" });
  const btn = el("button", { type: "button", id: "btnPublish", class: "btn-plain", style: "font-weight:700", text: "🚀 Julkaise nyt" });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.replaceChildren("");
    try {
      const r = await publishSite((t) => { status.textContent = t; });
      const kids = [`✅ Julkaistu (${r.files} tiedostoa). Osoite: `, el("a", { href: r.url, target: "_blank", rel: "noopener", text: r.url })];
      if (r.warn) kids.push("\n⚠️ " + r.warn);
      if (r.privateRepo) kids.push("\n⚠️ Repositorio on yksityinen. Ilmainen GitHub Pages vaatii julkisen repositorion.");
      if (cfg2().client) kids.push("\n✏️ Asiakkaan muokkausosoite: ", el("a", { href: r.url + "muokkaa/", target: "_blank", rel: "noopener", text: r.url + "muokkaa/" }));
      kids.push("\nSivu voi näkyä vasta minuutin tai kahden päästä.");
      status.replaceChildren(...kids);
    } catch (e) {
      status.textContent = "❌ " + (e && e.message ? e.message : "Julkaisu epäonnistui.");
    } finally { btn.disabled = false; }
  });
  out.push(btn, status);
  out.push(note("Julkaisu korvaa repositorion sisällön tällä sivustolla. Käytä repositoriota vain tähän sivustoon. GitHub Pages sopii esittely-, portfolio- ja yrityssivuille. Verkkokauppaa tai maksuja sillä ei saa pyörittää."));
  out.push(el("button", { type: "button", class: "btn-plain", style: "margin-top:.4rem", text: "Poista token tästä selaimesta", onclick: () => { saveGh(""); tok.value = ""; toast("Token poistettu tämän selaimen muistista."); } }));
  return out;
}

// Lisäkoodit: Head, Footer ja oma CSS
function codeFields(p) {
  const out = [];
  const C = () => (p.code = normalizeCode(p.code));
  const set = (k, v) => { C()[k] = v; save(); schedulePreview(); };
  out.push(el("p", { class: "field-hint", style: "margin:0 0 .75rem",
    text: "Tänne voit liittää koodia, jonka saat esim. Google Analyticsista, Facebook Pixelistä tai chat-palvelusta. Liitä vain koodia, jonka lähteen tunnet: väärä koodi voi rikkoa sivun tai lähettää kävijöiden tietoja ulkopuolisille." }));
  out.push(fieldBlock({ label: "Head-koodi (ladataan sivun alussa)", type: "textarea", plain: true, rows: 6, placeholder: "<script>…</script>", hint: "Lisätään jokaisen sivun <head>-osaan. Sopii esim. analytiikkaan ja vahvistustunnisteisiin (meta)." }, () => C().head, (v) => set("head", v)));
  out.push(fieldBlock({ label: "Footer-koodi (ladataan sivun lopussa)", type: "textarea", plain: true, rows: 6, placeholder: "<script>…</script>", hint: "Lisätään jokaisen sivun loppuun, ennen </body>. Sopii esim. chat-ikkunoihin." }, () => C().body, (v) => set("body", v)));
  out.push(fieldBlock({ label: "Oma CSS (ulkoasun hienosäätö)", type: "textarea", plain: true, rows: 6, placeholder: ".btn { letter-spacing: .05em; }", hint: "Toimii myös esikatselussa heti." }, () => C().css, (v) => set("css", v)));
  out.push(fieldBlock({ label: "Lataa Head- ja Footer-koodi vasta, kun kävijä hyväksyy evästeet", type: "checkbox", hint: "Suositus seurantakoodeille. Tällöin evästekysely näytetään automaattisesti. Teksti on yleinen malli, ei lakineuvo." }, () => C().gate, (v) => { set("gate", v); }));
  out.push(fieldBlock({ label: "Suorita Head- ja Footer-koodi myös esikatselussa", type: "checkbox", hint: "Oletuksena pois, jotta seurantakoodit eivät laske omia käyntejäsi. Ladattuun sivuun koodi tulee aina." }, () => C().preview, (v) => set("preview", v)));
  return out;
}

/* ---------- Luokkavalikko (Sivu- ja Sivusto-välilehti) ---------- */
const SITE_CATS = [
  ["brand", "🏷️", "Nimi ja logo", (p) => p.siteName],
  ["theme", "🎨", "Värit ja teema", (p) => { const t = themeById(p.themeId); return t ? t.name : "Omat värit"; }],
  ["fonts", "🔤", "Fontit", (p) => ((p.fonts || {}).head || (p.fonts || {}).body) ? [(p.fonts || {}).head, (p.fonts || {}).body].filter(Boolean).join(" + ") : "Järjestelmäfontit"],
  ["header", "🧭", "Yläpalkki", () => "Tausta, läpinäkyvyys, asettelu"],
  ["footer", "🦶", "Alatunniste", (p) => (p.showFooter ? "Näkyy" : "Piilotettu")],
  ["social", "📣", "Somenapit", (p) => { const n = Object.values(p.social || {}).filter(Boolean).length; return n ? n + " linkkiä" : "Ei vielä linkkejä"; }],
  ["lang", "🌐", "Kielet", (p) => (p.pages.some((x) => x.lang !== p.lang) ? "Suomi + englanti" : LANG_NAME[p.lang])],
  ["general", "📐", "Yleinen ulkoasu", () => "Leveys, tekstikoko, pyöristys, kuvake"],
  ["cookie", "🍪", "Evästekysely", (p) => (cookieActive(p) ? "Käytössä" : "Ei tarvita juuri nyt")],
  ["seo", "🔍", "Haku ja SEO (koko sivusto)", (p) => p.siteUrl || "Osoite, jakokuva, sitemap"],
  ["ai", "✨", "Tekoäly", () => "Avain ja palvelu"],
  ["publish", "🚀", "Julkaisu verkkoon", (p) => normalizePublish(p.publish).repo || "GitHub Pages, oma domain"],
  ["code", "🧩", "Lisäkoodit (Head / Footer)", (p) => (hasCode(p) || normalizeCode(p.code).css.trim() ? "Koodia lisätty" : "Analytiikka, oma CSS")],
];
const PAGE_CATS = [
  ["menu", "📄", "Sivun nimi ja valikko", (p, pg) => pg.title],
  ["seo", "🔍", "Tämän sivun SEO", (p, pg) => (seoOf(pg).title || seoOf(pg).desc ? "Täytetty" : "Ei vielä täytetty")],
  ["order", "↔️", "Järjestys ja poisto", () => "Siirrä tai poista sivu"],
];
const AREA_CAT = { brand: "brand", header: "header", footer: "footer" };

function openCat(kind, id) {
  if (CLIENT) return;
  S.tab = kind;
  S.cat[kind] = id;
  S.blockId = null;
  renderTabs();
  renderPanel();
  sendSelect("");
}

function catPanel(kind, cats, secs) {
  const p = cur(), pg = curPage();
  const id = S.cat[kind];
  const c = cats.find((x) => x[0] === id);
  if (c && secs[id]) {
    return [el("div", { class: "editor-head" },
      el("button", { type: "button", class: "btn-plain", "data-back": kind, text: kind === "site" ? "← Sivusto" : "← Sivu", onclick: () => { S.cat[kind] = null; renderPanel(); } }),
      el("strong", { text: `${c[1]} ${c[2]}` })), ...secs[id]];
  }
  S.cat[kind] = null;
  const intro = kind === "site"
    ? "Koko sivustoa koskevat asetukset. Valitse alue, jota haluat muokata. Voit myös klikata yläpalkkia, logoa tai alatunnistetta esikatselussa."
    : "Tämän sivun asetukset. Sivun sisältö (tekstit, kuvat, napit) muokataan Lohkot-välilehdellä tai kaksoisklikkaamalla tekstiä esikatselussa.";
  const out = [el("p", { class: "field-hint", style: "margin:0 0 .75rem", text: intro })];
  cats.forEach(([cid, icon, label, sum]) => {
    out.push(el("button", {
      type: "button", "data-cat": cid,
      style: "display:flex;align-items:center;gap:.7rem;width:100%;text-align:left;padding:.65rem .8rem;margin:0 0 .4rem;border:1px solid #e2e8f0;border-radius:.6rem;background:#fff;cursor:pointer",
      onclick: () => { S.cat[kind] = cid; renderPanel(); },
    },
    el("span", { style: "font-size:1.3rem", text: icon }),
    el("span", { style: "flex:1;min-width:0" },
      el("strong", { style: "display:block;font-size:.9rem", text: label }),
      el("small", { style: "color:#64748b;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", text: String(sum(p, pg) || "") })),
    el("span", { style: "color:#94a3b8", text: "›" })));
  });
  return out;
}

/* ---------- Suora tekstin muokkaus esikatselussa ---------- */
let pendingEdit = null;
const plainText = (t) => String(t || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1").replace(/\s+/g, " ").trim();
function setLine(b, key, i, fn) {
  const L = String(b.v[key]).split("\n");
  L[i] = fn(L[i]);
  b.v[key] = L.join("\n");
}
function editUnits(p, pg, area, bid) {
  const U = [];
  const add = (display, raw, apply) => U.push({ display: plainText(display), raw, apply });
  if (area === "brand") add(p.siteName, p.siteName, (t) => { p.siteName = t || p.siteName; });
  else if (area === "footer") {
    const key = pg.lang === p.lang ? "footerText" : "footerText2";
    add(p[key], p[key], (t) => { p[key] = t; });
  } else {
    const b = pg.blocks.find((x) => x.id === bid);
    if (b) BLOCK_TYPES[b.type].fields.forEach((f) => {
      if (f.group || (f.type !== "text" && f.type !== "textarea") || typeof b.v[f.key] !== "string") return;
      const val = b.v[f.key];
      if (f.type === "text") { add(val, val, (t) => { b.v[f.key] = t; }); return; }
      val.split("\n").forEach((line, i) => {
        const raw = line.trim();
        if (!raw) return;
        add(raw.startsWith("## ") ? raw.slice(3) : raw, raw, (t) => setLine(b, f.key, i, () => t));
        if (raw.includes("|")) raw.split("|").forEach((cell, j) => add(cell, cell.trim(), (t) => setLine(b, f.key, i, (l) => {
          const cells = l.split("|").map((x) => x.trim());
          cells[j] = t.replace(/\|/g, "/");
          return cells.join(" | ");
        })));
      });
    });
  }
  return U;
}
function handleEditReq(d) {
  const want = plainText(d.text);
  const hits = editUnits(cur(), curPage(), String(d.area || ""), String(d.bid || "")).filter((u) => u.display === want);
  const u = hits[Math.min(Number(d.nth) || 0, hits.length - 1)];
  const win = $("preview").contentWindow;
  if (!u) {
    toast("Tätä tekstiä ei voi muokata suoraan. Valitse lohko ja muokkaa tekstiä vasemmalta.");
    try { win.postMessage({ kotisivuEditStart: null }, "*"); } catch (e) { /* ei haittaa */ }
    return;
  }
  pendingEdit = u;
  try { win.postMessage({ kotisivuEditStart: { raw: u.raw } }, "*"); } catch (e) { pendingEdit = null; }
}
function finishEdit(d) {
  const u = pendingEdit;
  pendingEdit = null;
  if (u && !d.cancel) {
    u.apply(String(d.text || "").replace(/\s*\n\s*/g, " ").trim());
    save();
    renderChips();
    renderPanel(true);
  }
  updatePreview();
}

/* ---------- Toiminnot: lohkot ---------- */
function selectBlock(id, fromPreview) {
  S.blockId = id || null;
  if (id) S.tab = "blocks";
  renderTabs();
  renderPanel();
  sendSelect(id);
}

function insertBlock(type, idx) {
  if (CLIENT) return;
  const pg = curPage();
  const b = makeBlock(type, {}, {}, pg.lang);
  resolveLinksBlock(cur(), b, pg.lang);
  if (idx == null || idx > pg.blocks.length || idx < 0) idx = pg.blocks.length;
  pg.blocks.splice(idx, 0, b);
  S.blockId = b.id;
  S.tab = "blocks";
  save();
  renderTabs();
  renderPanel();
  updatePreview(true);
}

function resolveLinksBlock(p, b, lang) {
  resolveLinks(p, { blocks: [b], lang });
}

function handleDrop(payload, idx) {
  if (CLIENT) return;
  dragPayload = null;
  if (!payload) return;
  if (payload.startsWith("new:")) {
    const t = payload.slice(4);
    if (BLOCK_TYPES[t]) insertBlock(t, idx);
  } else if (payload.startsWith("move:")) {
    moveBlockTo(payload.slice(5), idx);
  }
}

function moveBlockTo(id, idx) {
  if (CLIENT) return;
  const arr = curPage().blocks;
  const from = arr.findIndex((b) => b.id === id);
  if (from < 0) return;
  const n = unitLen(arr, from);
  idx = clamp(idx, 0, arr.length);
  if (idx > from && idx < from + n) return;
  const moved = arr.splice(from, n);
  if (from < idx) idx -= n;
  arr.splice(idx, 0, ...moved);
  save();
  renderPanel(true);
  updatePreview();
}

function toggleBlock(id) {
  if (CLIENT) return;
  const b = curPage().blocks.find((x) => x.id === id);
  if (!b) return;
  b.hidden = !b.hidden;
  save();
  renderPanel(true);
  updatePreview();
}

function duplicateBlock(id) {
  if (CLIENT) return;
  const pg = curPage();
  const i = pg.blocks.findIndex((x) => x.id === id);
  if (i < 0) return;
  const n = unitLen(pg.blocks, i);
  const copies = JSON.parse(JSON.stringify(pg.blocks.slice(i, i + n))).map((x) => ({ ...x, id: uid() }));
  pg.blocks.splice(i + n, 0, ...copies);
  S.blockId = copies[0].id;
  save();
  renderPanel();
  updatePreview(true);
}

function deleteBlock(id) {
  if (CLIENT) return;
  const pg = curPage();
  const i = pg.blocks.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [b] = pg.blocks.splice(i, 1);
  if (S.blockId === id) S.blockId = null;
  const nx = pg.blocks[i];
  const fixed = !b.s.merge && nx && nx.s.merge ? nx : null;  // osion seuraava lohko jää osion ensimmäiseksi
  if (fixed) fixed.s.merge = false;
  save();
  renderPanel(true);
  updatePreview();
  toast("Lohko poistettu.", "Kumoa", () => {
    pg.blocks.splice(Math.min(i, pg.blocks.length), 0, b);
    if (fixed) fixed.s.merge = true;
    save();
    if (curPage() === pg) { renderPanel(true); updatePreview(); }
  });
}

/* ---------- Toiminnot: sivut ja projektit ---------- */
function selectPage(id) {
  S.pageId = id;
  S.blockId = null;
  previewScroll = 0;
  save();
  renderChips();
  renderPanel();
  updatePreview();
}

function selectProject(id) {
  S.projectId = id;
  S.pageId = cur().pages[0].id;
  S.blockId = null;
  previewScroll = 0;
  save();
  renderAll();
}

function setTab(tab) {
  if (CLIENT && tab !== "blocks") return;
  if (tab === S.tab && S.cat && S.cat[tab]) S.cat[tab] = null; // saman välilehden painaminen palaa valikkoon
  S.tab = tab;
  if (tab !== "blocks") S.blockId = null;
  save();
  renderTabs();
  renderPanel();
  updatePreview();
}

function addPage(type, lang) {
  if (CLIENT) return;
  const p = cur();
  const pg = makePage(type, lang || curPage().lang);
  p.pages.push(pg);
  resolveLinks(p, pg);
  S.pageId = pg.id;
  S.blockId = null;
  S.tab = "blocks";
  previewScroll = 0;
  save();
  renderAll();
  toast(`Sivu "${pg.title}" lisätty. Se näkyy valikossa ja linkkilistoissa.`);
}

function deletePage() {
  if (CLIENT) return;
  const p = cur(), pg = curPage();
  if (homeOf(p, pg.lang) === pg) return;
  if (!confirm(`Poistetaanko sivu "${pg.title}"?`)) return;
  p.pages = p.pages.filter((x) => x.id !== pg.id);
  S.pageId = p.pages[0].id;
  S.blockId = null;
  previewScroll = 0;
  save();
  renderAll();
}

// Siirtää sivua saman kielen sivujen joukossa (kielen etusivu pysyy ensimmäisenä)
function movePage(dir) {
  const p = cur(), pg = curPage();
  const same = p.pages.filter((x) => x.lang === pg.lang);
  const i = same.indexOf(pg), j = i + dir;
  if (i < 1 || j < 1 || j >= same.length) return;
  const a = p.pages.indexOf(same[i]), b = p.pages.indexOf(same[j]);
  [p.pages[a], p.pages[b]] = [p.pages[b], p.pages[a]];
  save();
  renderChips();
  renderPanel();
  updatePreview();
}

// Kopioi kaikki pääkielen sivut toiselle kielelle ja kääntää valmiit esimerkkitekstit
function addLanguage() {
  const p = cur();
  const from = p.lang, to = from === "fi" ? "en" : "fi";
  if (p.pages.some((x) => x.lang === to)) return;
  const idMap = {};
  const clones = p.pages.filter((x) => x.lang === from).map((pg) => {
    const c = JSON.parse(JSON.stringify(pg));
    c.id = uid();
    idMap[pg.id] = c.id;
    c.lang = to;
    c.seo = { title: "", desc: "", keywords: "", noindex: !!(pg.seo && pg.seo.noindex) };
    c.blocks.forEach((b) => { b.id = uid(); });
    return c;
  });
  clones.forEach((pg) => {
    pg.blocks.forEach((b) => {
      Object.keys(b.v).forEach((k) => { if (typeof b.v[k] === "string") b.v[k] = remapPageRefs(b.v[k], idMap); });
    });
    translatePage(pg, from, to);
  });
  p.pages.push(...clones);
  save();
  renderAll();
  toast(`${to === "en" ? "Englanninkielinen" : "Suomenkielinen"} versio lisätty. Käännä omat tekstisi sivuvälilehdistä (${to.toUpperCase()}).`);
}

function removeLanguage() {
  const p = cur();
  const other = p.lang === "fi" ? "en" : "fi";
  if (!confirm(`Poistetaanko koko ${LANG_NAME[other]}-versio ja sen sivut? Tätä ei voi perua.`)) return;
  p.pages = p.pages.filter((x) => x.lang === p.lang);
  if (!p.pages.some((x) => x.id === S.pageId)) S.pageId = p.pages[0].id;
  S.blockId = null;
  save();
  renderAll();
}

function newProject(name, starter, theme, lang) {
  const p = createProject(name.trim() || "Uusi sivusto", starter, theme, lang || "fi");
  S.projects.push(p);
  S.projectId = p.id;
  S.pageId = p.pages[0].id;
  S.blockId = null;
  S.tab = "blocks";
  previewScroll = 0;
  save();
  renderAll();
  toast(`Projekti "${p.name}" luotu ja tallennettu selaimen muistiin.`);
}

function renameProject() {
  const p = cur();
  const name = prompt("Projektin uusi nimi:", p.name);
  if (!name || !name.trim()) return;
  p.name = name.trim();
  save();
  renderProjectBar();
}

function duplicateProject() {
  const copy = normalizeProject(cur(), true);
  copy.name = cur().name + " (kopio)";
  S.projects.push(copy);
  S.projectId = copy.id;
  S.pageId = copy.pages[0].id;
  S.blockId = null;
  save();
  renderAll();
  toast("Projekti kopioitu.");
}

function deleteProject() {
  const p = cur();
  if (!confirm(`Poistetaanko projekti "${p.name}" ja kaikki sen sivut? Tätä ei voi perua.`)) return;
  S.projects = S.projects.filter((x) => x.id !== p.id);
  if (!S.projects.length) S.projects.push(createProject("Oma yrityssivusto", "company", "mono-light"));
  S.projectId = S.projects[0].id;
  S.pageId = S.projects[0].pages[0].id;
  S.blockId = null;
  previewScroll = 0;
  save();
  renderAll();
}

/* ---------- Lataukset ---------- */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Julkaisu: GitHub Pages ---------- */
const GH_KEY = "kotisivu-github";
// Token tallennetaan vain tämän selaimen muistiin. Se EI mene projektiin, varmuuskopioon eikä ladattuun sivustoon.
const ghKey = () => (CLIENT ? GH_KEY + ":" + normalizePublish(cur().publish).repo : GH_KEY);
const loadGh = () => { try { return localStorage.getItem(ghKey()) || ""; } catch (e) { return ""; } };
const saveGh = (t) => { try { if (t) localStorage.setItem(ghKey(), t); else localStorage.removeItem(ghKey()); } catch (e) { toast("Tokenia ei voitu tallentaa selaimen muistiin."); } };

function ghError(status, data) {
  const msg = data && data.message ? ` (${data.message})` : "";
  if (CLIENT && status === 401) return "Muokkausavain ei kelpaa tai on vanhentunut. Paina 🔑 ja liitä uusi avain (saat sen sivuston tekijältä).";
  if (CLIENT && (status === 403 || status === 404)) return "Avaimella ei ole lupaa tallentaa tälle sivustolle, tai GitHub rajoitti pyyntöjä hetkeksi. Odota hetki ja yritä uudelleen. Jos virhe toistuu, pyydä uusi avain sivuston tekijältä." + msg;
  if (status === 401) return "GitHub ei hyväksynyt tokenia. Tarkista, että se on kopioitu kokonaan eikä ole vanhentunut.";
  if (status === 403) return "Tokenilla ei ole riittäviä oikeuksia, tai GitHub rajoitti pyyntöjä hetkeksi. Tarkista, että Contents ja Pages ovat asetuksella Read and write." + msg;
  if (status === 404) return "Repositoriota ei löydy tai tokenilla ei ole pääsyä siihen. Tarkista nimi (käyttäjä/sivusto) ja että token on myönnetty juuri tälle repositoriolle." + msg;
  if (status === 409) return "GitHub ilmoitti ristiriidasta" + (msg || ".") + " Kokeile uudelleen.";
  if (status === 422) return "GitHub hylkäsi pyynnön" + (msg || ".");
  return `GitHub vastasi virheellä ${status}.${msg}`;
}

async function publishSite(setStatus) {
  const p = cur();
  const cfg = normalizePublish(p.publish);
  const token = loadGh();
  if (!cfg.repo) throw new Error("Kirjoita ensin repositorio muodossa käyttäjä/sivusto.");
  if (!token) throw new Error("Liitä ensin GitHub-token.");
  const api = async (method, path, body, okCodes = []) => {
    let r;
    try {
      r = await fetch("https://api.github.com" + path, {
        method, cache: "no-store",
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw new Error("Yhteyttä GitHubiin ei saatu. Tarkista verkkoyhteys."); }
    let data = null;
    try { data = await r.json(); } catch (e) { /* tyhjä vastaus */ }
    if (!r.ok && !okCodes.includes(r.status)) { const err = new Error(ghError(r.status, data)); err.status = r.status; throw err; }
    return { status: r.status, data };
  };
  const repo = cfg.repo;

  if (cfg.domain && !cleanUrl(p.siteUrl)) { p.siteUrl = "https://" + cfg.domain; save(); }
  const list = buildSiteFiles(p);
  if (!CLIENT) {
    list.push({ name: ".nojekyll", text: "\n" });
    if (cfg.domain) list.push({ name: "CNAME", text: cfg.domain + "\n" });
  }
  if (!CLIENT && cfg.client) {
    // Asiakkaan muokkausversio: sama editori karsittuna osoitteeseen /muokkaa/
    const pkg = window.KK_PKG;
    if (!pkg || !pkg["script.js"] || !pkg["index.html"]) throw new Error("Asiakasversion tiedostoja ei löytynyt. Aja terminaalissa: python3 paivita_asiakas.py ja lataa editori uudelleen (Ctrl+Shift+R).");
    const idx = pkg["index.html"]
      .replace(/\s*<script src="asiakas-paketti\.js"><\/script>/, "")
      .replace('<script src="script.js"></script>', '<script>window.KK_CLIENT = 1;</script>\n  <script src="script.js"></script>')
      .replace(/<title>[^<]*<\/title>/, '<title>Sivuston muokkaus</title>\n  <meta name="robots" content="noindex">');
    list.push({ name: "muokkaa/index.html", text: idx }, { name: "muokkaa/style.css", text: pkg["style.css"] }, { name: "muokkaa/script.js", text: pkg["script.js"] });
  }
  if (CLIENT || cfg.client) list.push({ name: "muokkaa/projekti.json", text: projectJson(p) });

  setStatus("Tarkistetaan repositoriota…");
  const info = (await api("GET", `/repos/${repo}`)).data;
  if (info.permissions && info.permissions.push === false) throw new Error("Tokenilla ei ole kirjoitusoikeutta tähän repositorioon (Contents: Read and write).");
  const branch = info.default_branch || "main";
  let ref = await api("GET", `/repos/${repo}/git/ref/heads/${branch}`, null, [404, 409]);
  if (ref.status !== 200) { // tyhjä repositorio: luodaan ensimmäinen tiedosto, jotta haara syntyy
    setStatus("Alustetaan tyhjää repositoriota…");
    await api("PUT", `/repos/${repo}/contents/.nojekyll`, { message: "Alustus", content: "Cg==" });
    ref = await api("GET", `/repos/${repo}/git/ref/heads/${branch}`);
  }
  const parent = ref.data.object.sha;

  const enc = new TextEncoder();
  const toB64 = (bytes) => { let t = ""; for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(t); };
  const bytesOf = (f) => f.data || enc.encode(f.text);
  const gitSha = async (bytes) => {
    const head = enc.encode(`blob ${bytes.length}\0`);
    const all = new Uint8Array(head.length + bytes.length);
    all.set(head);
    all.set(bytes, head.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", all))].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  let baseTree = null;
  let todo = list;
  if (CLIENT) {
    // Asiakas päivittää vain muuttuneet tiedostot, muu (editori, verkkotunnus) jää ennalleen
    setStatus("Verrataan muutoksia…");
    baseTree = (await api("GET", `/repos/${repo}/git/commits/${parent}`)).data.tree.sha;
    const tr = (await api("GET", `/repos/${repo}/git/trees/${baseTree}?recursive=1`)).data;
    const have = new Map((tr.tree || []).filter((t) => t.type === "blob").map((t) => [t.path, t.sha]));
    todo = [];
    for (const f of list) { if ((await gitSha(bytesOf(f))) !== have.get(f.name)) todo.push(f); }
    if (!todo.length) return { url: new URL("../", location.href).href, warn: "", files: 0, unchanged: true, privateRepo: false };
  }
  const shas = new Array(todo.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = next++;
      const r = await api("POST", `/repos/${repo}/git/blobs`, { content: toB64(bytesOf(todo[i])), encoding: "base64" });
      shas[i] = r.data.sha;
      setStatus(`Lähetetään tiedostoja ${++done}/${todo.length}…`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);

  setStatus("Tallennetaan versiota…");
  const tree = await api("POST", `/repos/${repo}/git/trees`, { ...(baseTree ? { base_tree: baseTree } : {}), tree: todo.map((f, i) => ({ path: f.name, mode: "100644", type: "blob", sha: shas[i] })) });
  const commit = await api("POST", `/repos/${repo}/git/commits`, { message: "Päivitys " + new Date().toLocaleString("fi-FI"), tree: tree.data.sha, parents: [parent] });
  await api("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.data.sha });

  // GitHub Pages päälle ja oma verkkotunnus
  let warn = "";
  let url = "";
  if (CLIENT) url = new URL("../", location.href).href;
  else try {
    setStatus("Otetaan GitHub Pages käyttöön…");
    const src = { branch, path: "/" };
    let pg = await api("GET", `/repos/${repo}/pages`, null, [404]);
    if (pg.status === 404) {
      await api("POST", `/repos/${repo}/pages`, { source: src }, [409]);
      pg = await api("GET", `/repos/${repo}/pages`, null, [404]);
    }
    if (cfg.domain && (!pg.data || pg.data.cname !== cfg.domain)) await api("PUT", `/repos/${repo}/pages`, { cname: cfg.domain, source: src });
    if (cfg.domain) { try { await api("PUT", `/repos/${repo}/pages`, { https_enforced: true, source: src }); } catch (e) { /* onnistuu vasta, kun verkkotunnus on yhdistetty */ } }
    url = pg.data && pg.data.html_url ? pg.data.html_url : "";
  } catch (e) {
    warn = "Sivut on lähetetty, mutta GitHub Pagesin automaattinen käyttöönotto ei onnistunut (" + e.message + ") Ota se käyttöön GitHubissa: Settings → Pages → Branch: " + branch + " / (root).";
  }
  const [owner, name] = repo.split("/");
  if (!url) url = name.toLowerCase() === owner.toLowerCase() + ".github.io" ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${name}/`;
  if (cfg.domain) url = "https://" + cfg.domain + "/";
  return { url, warn, files: todo.length, privateRepo: !!info.private };
}

// Projektin tiedot ja kuvat yhtenä JSON-tekstinä (varmuuskopio ja asiakasversion lähtötiedot)
function projectJson(p) {
  const images = {};
  (JSON.stringify(p).match(/img:[a-z0-9]+/g) || []).forEach((r) => { const id = r.slice(4); if (IMAGES[id]) images[id] = IMAGES[id]; });
  return JSON.stringify({ kotisivueditori: 3, project: p, images });
}

function downloadPage() {
  const p = cur(), pg = curPage();
  saveBlob(new Blob([renderDocument(p, pg, {})], { type: "text/html;charset=utf-8" }), fileMap(p)[pg.id]);
}

function buildSiteFiles(p) {
  const files = fileMap(p);
  const assets = new Map();
  const list = p.pages.map((pg) => ({ name: files[pg.id], text: renderDocument(p, pg, { assets }) }));
  assets.forEach((dataUrl, name) => list.push({ name, data: dataUrlToBytes(dataUrl) }));
  const base = cleanUrl(p.siteUrl);
  if (base) {
    const urls = p.pages.filter((pg) => !seoOf(pg).noindex).map((pg) => base + "/" + (files[pg.id] === "index.html" ? "" : files[pg.id]));
    list.push({ name: "sitemap.xml", text: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n` });
    list.push({ name: "robots.txt", text: `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n` });
  }
  return list;
}

function downloadZip() {
  const p = cur();
  const list = buildSiteFiles(p);
  saveBlob(new Blob([makeZip(list)], { type: "application/zip" }), (slugify(p.name) || "sivusto") + ".zip");
  toast("ZIP ladattu. Pura se Tiedostot-sovelluksessa (oikea klikkaus → Pura kaikki) ja avaa index.html.");
}

function exportJson() {
  const p = cur();
  const images = {};
  (JSON.stringify(p).match(/img:[a-z0-9]+/g) || []).forEach((r) => { const id = r.slice(4); if (IMAGES[id]) images[id] = IMAGES[id]; });
  const data = JSON.stringify({ kotisivueditori: 3, project: p, images }, null, 1);
  saveBlob(new Blob([data], { type: "application/json" }), (slugify(p.name) || "projekti") + ".json");
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const p = normalizeProject(data.project || data, true);
      if (!p) throw new Error("virheellinen tiedosto");
      Object.entries(data.images || {}).forEach(([id, url]) => {
        if (/^[a-z0-9]+$/.test(id) && typeof url === "string" && /^data:image\//.test(url)) { IMAGES[id] = url; idbPut(id, url); }
      });
      S.projects.push(p);
      S.projectId = p.id;
      S.pageId = p.pages[0].id;
      S.blockId = null;
      save();
      renderAll();
      toast(`Projekti "${p.name}" avattu.`);
    } catch (e) {
      toast("Tiedostoa ei voitu avata. Valitse editorilla tallennettu .json-varmuuskopio.");
    }
  };
  reader.readAsText(file);
}

/* ---------- Ikkunat ---------- */
function openNewProjectDialog() {
  const list = $("starterList");
  list.innerHTML = "";
  Object.entries(STARTERS).forEach(([id, s], i) => {
    const radio = el("input", { type: "radio", name: "starter", value: id, checked: i === 0 });
    radio.addEventListener("change", () => { $("newTheme").value = s.theme; });
    list.append(el("label", { class: "choice" }, el("strong", {}, radio, s.label), el("span", { text: s.desc })));
  });
  const sel = $("newTheme");
  sel.innerHTML = "";
  THEMES.forEach((t) => sel.append(el("option", { value: t.id, text: t.name })));
  sel.value = STARTERS.company.theme;
  $("newName").value = "Uusi sivusto";
  $("dlgNew").showModal();
  $("newName").select();
}

function openAddPageDialog() {
  const p = cur();
  const langs = [...new Set(p.pages.map((x) => x.lang))];
  let lang = curPage().lang;

  const langBox = $("pageLangBox");
  langBox.innerHTML = "";
  if (langs.length > 1) {
    langBox.append(el("span", { class: "field-label", text: "Sivun kieli:" }));
    langs.forEach((l) => {
      const radio = el("input", { type: "radio", name: "pageLang", value: l, checked: l === lang });
      radio.addEventListener("change", () => { lang = l; });
      langBox.append(el("label", { class: "check-row", style: "display:inline-flex;margin-right:1rem" }, radio, l.toUpperCase()));
    });
  }

  const box = $("pageTypeList");
  box.innerHTML = "";
  Object.entries(PAGE_TYPES).forEach(([id, t]) => {
    box.append(el("button", {
      type: "button", class: "choice", "data-type": id,
      onclick: () => { $("dlgPage").close(); addPage(id, lang); },
    }, el("strong", { text: `${t.icon} ${t.label}` }), el("span", { text: t.desc })));
  });
  $("dlgPage").showModal();
}

/* ---------- Asiakasversio ---------- */
async function loadClient() {
  let data;
  try {
    const r = await fetch("projekti.json?" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("http " + r.status);
    data = await r.json();
  } catch (e) {
    document.body.innerHTML = '<p style="font:16px sans-serif;padding:2rem;max-width:36rem">Sivuston tietoja ei löytynyt. Pyydä sivuston tekijää julkaisemaan sivusto uudelleen, tai yritä hetken päästä uudelleen.</p>';
    throw e;
  }
  const p = normalizeProject(data.project || data, false);
  if (!p) throw new Error("projekti.json on virheellinen");
  Object.entries(data.images || {}).forEach(([id, url]) => {
    if (/^[a-z0-9]+$/.test(id) && typeof url === "string" && /^data:image\//.test(url)) IMAGES[id] = url;
  });
  S.projects = [p];
  S.projectId = p.id;
  S.pageId = p.pages[0].id;
  S.tab = "blocks";
}

function markDirty(v) {
  clientDirty = v;
  const b = $("btnSave");
  if (b) b.textContent = v ? "💾 Tallenna ja julkaise ●" : "💾 Tallenna ja julkaise";
}

function askToken() {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "dlg" });
    const inp = el("input", { type: "password", class: "field-input", autocomplete: "off", placeholder: "github_pat_…", id: "kkTokenIn" });
    inp.value = loadGh();
    const ok = el("button", { type: "button", class: "btn-primary", id: "kkTokenOk", text: "Tallenna avain" });
    const cancel = el("button", { type: "button", class: "btn-plain", text: "Peruuta" });
    dlg.append(
      el("h2", { class: "text-xl font-bold mb-2", text: "Muokkausavain" }),
      el("p", { class: "field-hint", style: "margin:0 0 .6rem", text: "Tallentaminen vaatii muokkausavaimen, jonka sait sivuston tekijältä. Liitä se tähän. Avain tallennetaan vain tämän selaimen muistiin, eikä sitä tarvitse syöttää uudelleen." }),
      inp, el("div", { class: "flex justify-end gap-2 mt-4" }, cancel, ok));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    ok.addEventListener("click", () => { const t = inp.value.trim(); if (!t) { inp.focus(); return; } saveGh(t); done(true); });
    cancel.addEventListener("click", () => done(false));
    dlg.addEventListener("cancel", () => { dlg.remove(); resolve(false); });
    document.body.append(dlg);
    dlg.showModal();
    inp.focus();
  });
}

function showStatus(text, link) {
  let b = $("kkStatus");
  if (!b) {
    b = el("div", { id: "kkStatus", style: "position:fixed;right:1rem;bottom:1rem;max-width:24rem;background:#0f172a;color:#fff;padding:.8rem 1rem;border-radius:.7rem;box-shadow:0 8px 30px rgba(0,0,0,.3);z-index:50;font-size:.9rem;line-height:1.4" });
    document.body.append(b);
  }
  b.hidden = false;
  b.replaceChildren(text,
    ...(link ? [" ", el("a", { href: link, target: "_blank", rel: "noopener", style: "color:#7dd3fc;text-decoration:underline", text: "Avaa sivusto" })] : []),
    el("button", { type: "button", title: "Sulje", style: "margin-left:.7rem;color:#cbd5e1", text: "✕", onclick: () => { b.hidden = true; } }));
}

async function clientSave() {
  const btn = $("btnSave");
  if (!loadGh() && !(await askToken())) return;
  btn.disabled = true;
  try {
    const r = await publishSite((t) => showStatus(t));
    markDirty(false);
    showStatus(r.unchanged ? "Ei tallennettavia muutoksia." : "✅ Tallennettu! Muutokset näkyvät sivustolla minuutin tai kahden kuluttua.", r.url);
  } catch (e) {
    if (e && e.status === 401) saveGh("");
    showStatus("❌ " + (e && e.message ? e.message : "Tallennus epäonnistui."));
  } finally { btn.disabled = false; }
}

function setupClient() {
  document.body.classList.add("kk-client");
  const st = document.createElement("style");
  st.textContent = ".kk-client #projectSelect,.kk-client #btnNewProject,.kk-client #projectMenu,.kk-client #btnDownloadPage,.kk-client #btnDownloadZip,.kk-client #btnAddPage,.kk-client #sideTabs{display:none!important}";
  document.head.append(st);
  document.title = "Sivuston muokkaus";
  const h1 = document.querySelector("header h1");
  if (h1) h1.textContent = "✏️ Sivuston muokkaus";
  $("btnDownloadZip").parentNode.append(
    el("a", { class: "btn-small", href: "../", target: "_blank", rel: "noopener", text: "Näytä sivusto ↗" }),
    el("button", { type: "button", id: "btnKey", class: "btn-small", title: "Vaihda muokkausavain", text: "🔑", onclick: askToken }),
    el("button", { type: "button", id: "btnSave", class: "btn-green", text: "💾 Tallenna ja julkaise", onclick: clientSave }));
  addEventListener("beforeunload", (e) => { if (clientDirty) { e.preventDefault(); e.returnValue = ""; } });
}

/* ---------- Käynnistys ---------- */
async function init() {
  if (CLIENT) { await loadClient(); setupClient(); }
  else {
    idb = await idbOpen();
    await idbLoadAll();
    load();
    gcImages();
  }

  $("projectSelect").addEventListener("change", (e) => selectProject(e.target.value));
  $("btnNewProject").addEventListener("click", openNewProjectDialog);
  $("newCancel").addEventListener("click", () => $("dlgNew").close());
  $("formNew").addEventListener("submit", (e) => {
    e.preventDefault();
    const starter = document.querySelector('input[name="starter"]:checked');
    $("dlgNew").close();
    newProject($("newName").value, starter ? starter.value : "company", $("newTheme").value, $("newLang").value);
  });

  $("btnAddPage").addEventListener("click", openAddPageDialog);
  $("pageCancel").addEventListener("click", () => $("dlgPage").close());

  document.querySelectorAll("#sideTabs .side-tab").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });

  const menu = (id, fn) => $(id).addEventListener("click", () => { $("projectMenu").open = false; fn(); });
  menu("btnRename", renameProject);
  menu("btnDuplicate", duplicateProject);
  menu("btnExportJson", exportJson);
  menu("btnImportJson", () => $("importFile").click());
  menu("btnDeleteProject", deleteProject);
  $("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = "";
  });

  $("btnDownloadPage").addEventListener("click", downloadPage);
  $("btnDownloadZip").addEventListener("click", downloadZip);
  $("btnDesktop").addEventListener("click", () => { $("preview").style.width = "100%"; });
  $("btnTablet").addEventListener("click", () => { $("preview").style.width = "768px"; });
  $("btnMobile").addEventListener("click", () => { $("preview").style.width = "390px"; });

  save();
  if (CLIENT) markDirty(false);
  renderAll();
  document.body.dataset.ready = "1";
}

init();
