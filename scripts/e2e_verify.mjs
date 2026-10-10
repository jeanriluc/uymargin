// Prueba en navegador de la verificación de sitios (ronda 14) en la pestaña «Por foto».
// No corre dentro de `npm test` (necesita la app levantada y Chrome). Uso:
//   AUTH_DISABLED=true VITE_AUTH_DISABLED=true PORT=3917 npx tsx server/local.ts
//   node scripts/e2e_verify.mjs [carpeta-para-capturas]     (APP_URL y CHROME_PATH son opcionales)
// /api/visual-search, /api/web-sellers, /api/verify-sites y /api/identify-product se simulan acá: no se llama
// a Apify ni a Gemini, y no se abre ninguna página de terceros.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3917/";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.argv[2] || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let total = 0;
function assert(condition, message) {
  total++;
  if (condition) passed++;
  console.log(`${condition ? "✅ [PASS]" : "❌ [FAIL]"} ${message}`);
}

// --- Archivos de prueba (en una carpeta temporal, se borran al final) ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};
/** PNG liso de w × h, armado a mano para no depender de ninguna librería. */
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uymargin-foto-"));
const file = (name, data) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
};
const PHOTO = file("termo.png", png(1600, 1200, [30, 110, 70]));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e)));
// Los 4xx/5xx simulados dejan un «Failed to load resource» del navegador: es lo esperado, no un error de la app.
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text());
});

const verifyCalls = [];
const visualCalls = [];
const webCalls = [];
const outside = [];
let verifyMode = "ok";
let verifyDelayMs = 0;
let withTokens = true;
const tokenFor = (url) => `tok${Buffer.from(url).toString("base64url")}.firma`;
const urlOf = (token) => Buffer.from(String(token).slice(3).split(".")[0], "base64url").toString("utf8");
const match = (url, title, group, extra = {}) => ({ site: new URL(url).hostname.replace(/^www\./, ""), source: "", url, title, group, uruguay: null, price: null, thumbnail: null, ...(withTokens && group !== "others" && group !== "foreign" ? { verifyToken: tokenFor(url) } : {}), ...extra });
const matches = () => [
  match("https://articulo.mercadolibre.com.uy/MLU-1-termo-_JM", "Termo en Mercado Libre", "ml_uy", { uruguay: "confirmado" }),
  match("https://activa.com.uy/termo", "Termo en una tienda activa", "uy_stores", { uruguay: "confirmado" }),
  match("https://agotada.com.uy/termo", "Termo agotado", "uy_stores", { uruguay: "confirmado" }),
  match("https://caida.com.uy/termo", "Termo de una página que ya no existe", "uy_stores", { uruguay: "confirmado" }),
  match("https://protegida.com.uy/termo", "Termo en un sitio con protección", "uy_stores", { uruguay: "confirmado" }),
  match("https://casadelmate.com/termo", "Termo en Casa del Mate", "unconfirmed"),
  match("https://probable.com/termo", "Termo de acero importado", "unconfirmed"),
  match("https://outdoorgear.com/bottle", "Steel bottle", "unconfirmed"),
  match("https://rota.com/termo", "Termo de un .com caído", "unconfirmed"),
  match("https://www.amazon.com/dp/B01", "Termo en Amazon", "foreign"),
  match("https://www.instagram.com/p/abc/", "Termo en Instagram", "others"),
];
const VERDICTS = {
  "https://articulo.mercadolibre.com.uy/MLU-1-termo-_JM": { live: "unknown", outOfStock: false, uruguay: null, signals: [] },
  "https://activa.com.uy/termo": { live: "alive", outOfStock: false, uruguay: "confirmed", signals: ["teléfono +598"] },
  "https://agotada.com.uy/termo": { live: "alive", outOfStock: true, uruguay: "none", signals: [] },
  "https://caida.com.uy/termo": { live: "dead", outOfStock: false, uruguay: null, signals: [] },
  "https://protegida.com.uy/termo": { live: "unknown", outOfStock: false, uruguay: "confirmed", signals: ["RUT"] },
  // Lo que el servidor no debería mandar nunca como indicio; la pantalla igual lo tiene que frenar.
  "https://casadelmate.com/termo": { live: "alive", outOfStock: false, uruguay: "confirmed", signals: ["dirección en Montevideo", "teléfono +598", '<img src=x onerror="document.title=\'HACKEADO\'">', "<b>negrita</b>"] },
  "https://probable.com/termo": { live: "alive", outOfStock: false, uruguay: "probable", signals: ["envíos a todo el país"] },
  "https://outdoorgear.com/bottle": { live: "alive", outOfStock: false, uruguay: "none", signals: [] },
  "https://rota.com/termo": { live: "dead", outOfStock: false, uruguay: null, signals: [] },
  "https://ferreteria.com.uy/producto": { live: "alive", outOfStock: false, uruguay: "confirmed", signals: ["RUT"] },
  "https://sinpista.com/producto": { live: "alive", outOfStock: false, uruguay: "confirmed", signals: ["dirección en Salto"] },
  "https://muerta.com/producto": { live: "dead", outOfStock: false, uruguay: null, signals: [] },
};
const seller = (site, extra = {}) => ({ site, url: `https://${site}/producto`, title: `Producto en ${site}`, why: "Descripción de Google.", uruguay: "confirmado", international: false, kind: "store", ...(withTokens && extra.kind !== "other" && site !== "amazon.com" ? { verifyToken: tokenFor(`https://${site}/producto`) } : {}), ...extra });
await page.setRequestInterception(true);
page.on("request", async (req) => {
  const url = new URL(req.url());
  const json = (body, status = 200) => req.respond({ status, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
  // Ninguna de las tiendas de la prueba existe: si el navegador intentara abrir una, queda anotado y se corta.
  if (!["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    outside.push(req.url());
    return req.abort().catch(() => {});
  }
  if (url.pathname === "/api/exchange-rate") return json({ ok: true, rate: 40.5, referenceDate: "2026-10-08", fetchedAt: new Date().toISOString(), stale: false });
  if (url.pathname === "/api/visual-search") {
    visualCalls.push(1);
    return json({ ok: true, results: matches(), suggestedName: "Termo de acero", recognizedAs: "Termo de acero", mlCount: 1, uruguayCount: 5, cached: false });
  }
  if (url.pathname === "/api/web-sellers") {
    let body = null;
    try { body = JSON.parse(req.postData() || "null"); } catch { /* queda en null */ }
    webCalls.push(body);
    return json({ ok: true, query: body?.query ?? "", results: [seller("ferreteria.com.uy"), seller("sinpista.com", { uruguay: "no_confirmado" }), seller("muerta.com", { uruguay: "no_confirmado" }), seller("amazon.com", { uruguay: "no_confirmado", international: true }), seller("youtube.com", { kind: "other", uruguay: "no_confirmado" })], searchQueries: [], cached: false });
  }
  if (url.pathname === "/api/verify-sites") {
    let body = null;
    try { body = JSON.parse(req.postData() || "null"); } catch { /* queda en null */ }
    verifyCalls.push({ method: req.method(), type: req.headers()["content-type"], body, raw: req.postData() || "" });
    if (verifyDelayMs) await sleep(verifyDelayMs);
    if (verifyMode === "down") return json({ ok: false, code: "ERROR", message: "x", error: "x" }, 500);
    if (verifyMode === "notConfigured") return json({ ok: false, code: "VERIFY_NOT_CONFIGURED", message: "La verificación de sitios no está configurada en el servidor.", error: "x" }, 503);
    if (verifyMode === "rate") return json({ ok: false, code: "RATE_LIMITED", message: "Llegaste al límite de 6 usos por minuto.", error: "x" }, 429);
    if (verifyMode === "garbage") return json({ ok: true, results: "muchos" });
    return json({ ok: true, results: (body?.tokens ?? []).map((t) => VERDICTS[urlOf(t)] ?? { live: "unknown", outOfStock: false, uruguay: null, signals: [] }) });
  }
  return req.continue();
});

await page.goto(APP_URL, { waitUntil: "networkidle2" });
await sleep(1000);
const click = (re, scope = "#mercado") =>
  page.evaluate((sel, src) => {
    const b = [...document.querySelectorAll(`${sel} button`)].find((x) => new RegExp(src, "i").test(x.textContent) && x.offsetParent !== null && !x.disabled);
    b?.click();
    return !!b;
  }, scope, re);
const visible = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((n) => n.offsetParent !== null), sel);
const textOf = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null).map((n) => n.innerText.replace(/\s+/g, " ").trim()).join(" | "), sel);
const overflow = () =>
  page.evaluate(() => {
    const m = document.querySelector("#mercado");
    const limit = Math.min(m.getBoundingClientRect().right, innerWidth) + 1;
    return [...m.querySelectorAll("*:not(.visually-hidden)")].filter((n) => n.offsetParent !== null && !n.closest(".overflow-x-auto") && n.getBoundingClientRect().right > limit).map((n) => `${n.tagName}.${String(n.className).slice(0, 30)}`).slice(0, 3);
  });
const shot = async (name, width) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: await page.$eval("#mercado", (el, w) => { const b = el.getBoundingClientRect(); return { x: w === 390 ? 0 : b.left, y: b.top + scrollY, width: w === 390 ? 390 : b.width, height: Math.min(b.height, 2400) }; }, width) });
};
const FOTO = "#mercado #photo-panel-foto";
const WEB = "#mercado #photo-panel-web";
const rows = (panel, attr) =>
  page.$$eval(`${panel} [${attr}]`, (els, a) =>
    els.map((el) => ({
      site: el.getAttribute(a),
      group: el.closest("[data-unavailable]") ? "no-disponibles" : el.closest("[data-hidden-foreign]") ? "ocultos" : (el.closest("[data-visual-group]")?.getAttribute("data-visual-group") ?? (el.closest("details") ? "plegado" : "principal")),
      shown: el.checkVisibility(),
      status: el.querySelector("[data-site-status]")?.getAttribute("data-site-status") ?? null,
      statusText: el.querySelector("[data-site-status]")?.textContent.trim() ?? null,
      signals: el.querySelector("[data-site-signals]")?.textContent.trim() ?? null,
      uruguay: (el.querySelector("[data-visual-uruguay], [data-web-uruguay]")?.textContent ?? "").trim() || null,
    })), attr);
const visualRows = () => rows(FOTO, "data-visual-match");
const note = (panel) => page.$eval(`${panel} [data-verify-note]`, (el) => `${el.getAttribute("data-verify-note")}|${el.querySelector("span").textContent.trim()}|${el.querySelector("[data-verify-again]") ? "con-boton" : "sin-boton"}`).catch(() => null);
const search = async () => {
  if (await visible('#mercado button[aria-label="Quitar la foto"]')) {
    await page.click('#mercado button[aria-label="Quitar la foto"]');
    await sleep(150);
  }
  const input = await page.$('#mercado input[data-photo-input="file"]');
  await input.uploadFile(PHOTO);
  await page.waitForSelector("#mercado img[data-photo-preview]", { timeout: 15000 });
  await click("Buscar dónde se vende");
  await page.waitForSelector(`${FOTO} [data-visual-results]`, { timeout: 10000 });
};
const by = (list, group) => list.filter((x) => x.group === group);

await click("^Por foto$");
await page.waitForSelector('#mercado input[data-photo-input="file"]', { timeout: 15000 });

// --- Mientras verifica ---
verifyDelayMs = 1500;
await search();
await page.waitForSelector(`${FOTO} [data-site-status="checking"]`, { timeout: 5000 }).catch(() => null);
let r = await visualRows();
const candidates = ["activa.com.uy", "agotada.com.uy", "caida.com.uy", "protegida.com.uy", "casadelmate.com", "probable.com", "outdoorgear.com", "rota.com"];
assert(candidates.every((site) => r.find((x) => x.site === site)?.statusText === "Verificando…"), "Después de mostrar los resultados se lanza la verificación: cada fila candidata dice «Verificando…»");
assert(r.find((x) => x.site === "amazon.com").status === null && r.find((x) => x.site === "instagram.com").status === null && r.find((x) => x.site === "articulo.mercadolibre.com.uy").status === null, "Los ocultos del exterior y las redes no se verifican; Mercado Libre queda afuera porque ya hay 8 candidatos");
assert((await note(FOTO))?.startsWith("checking|Verificando que los sitios estén activos y sean de Uruguay…|sin-boton"), "Una línea avisa que se está verificando");
assert(by(r, "uy_stores").length === 4 && by(r, "unconfirmed").length === 4 && by(r, "no-disponibles").length === 0, "Mientras tanto la lista se ve como antes: nada se mueve hasta saber");
const call = verifyCalls[0];
assert(verifyCalls.length === 1 && call.method === "POST" && /application\/json/.test(call.type) && Object.keys(call.body).join() === "tokens" && call.body.tokens.length === 8, `Se manda un solo pedido con hasta 8 permisos y nada más (${call.body.tokens.length})`);
assert(call.body.tokens.map(urlOf).map((u) => new URL(u).hostname).join() === candidates.join(), "El orden es: primero Tiendas de Uruguay, después Sin confirmar");
assert(!/https?:\/\//.test(call.raw) && !/casadelmate|activa\.com/.test(call.raw), "El pedido lleva permisos firmados, no direcciones");

// --- Resultado de la verificación ---
await page.waitForSelector(`${FOTO} [data-verify-note="done"]`, { timeout: 10000 }).catch(() => null);
verifyDelayMs = 0;
r = await visualRows();
const row = (site) => r.find((x) => x.site === site);
assert(row("activa.com.uy").statusText === "Activa" && row("activa.com.uy").group === "uy_stores" && row("activa.com.uy").signals === "Uruguay: teléfono +598", "Tienda activa: «Activa», con sus indicios de Uruguay en una frase corta");
assert(row("agotada.com.uy").statusText === "Agotado" && row("agotada.com.uy").group === "uy_stores" && row("agotada.com.uy").signals === null, "Producto agotado: «Agotado», y sigue entre las tiendas de Uruguay");
assert(row("protegida.com.uy").statusText === "No se pudo verificar" && row("protegida.com.uy").group === "uy_stores" && row("protegida.com.uy").signals === null && row("protegida.com.uy").uruguay === "Uruguay: confirmado", "Sitio protegido: «No se pudo verificar». No se da por caído ni pierde su lugar, y no se le cree un indicio");
assert(by(r, "no-disponibles").map((x) => x.site).join() === "caida.com.uy,rota.com" && by(r, "no-disponibles").every((x) => !x.shown && x.statusText === "Caída") && /^No disponibles: la página ya no existe o está caída \(2\)$/.test(await textOf(`${FOTO} details[data-unavailable] summary`)) && (await page.$eval(`${FOTO} details[data-unavailable]`, (d) => !d.open)), "Las caídas pasan al bloque plegado «No disponibles», con la cuenta");
assert(row("casadelmate.com").group === "uy_stores" && row("casadelmate.com").shown && row("casadelmate.com").uruguay === "Uruguay: confirmado" && row("casadelmate.com").statusText === "Activa", "Un .com de «Sin confirmar» con indicios fuertes sube a «Tiendas de Uruguay», como confirmado");
assert(row("casadelmate.com").signals === "Uruguay: dirección en Montevideo, teléfono +598", `Muestra la frase «Uruguay: dirección en Montevideo, teléfono +598» (${row("casadelmate.com").signals})`);
assert(row("probable.com").group === "uy_stores" && row("probable.com").uruguay === "Uruguay: probable" && row("probable.com").signals === "Uruguay: envíos a todo el país", "Uno con indicios medios también sube, como «probable»");
assert(row("outdoorgear.com").group === "unconfirmed" && row("outdoorgear.com").statusText === "Activa" && row("outdoorgear.com").uruguay === null && !row("outdoorgear.com").shown, "Uno sin indicios (none) sigue en «Sin confirmar», aunque esté activo");
assert(/^Tiendas de Uruguay \(5\)/i.test(await textOf(`${FOTO} [data-visual-group="uy_stores"]`)) && /^Sin confirmar: no se sabe si venden en Uruguay \(1\)$/.test(await textOf(`${FOTO} details[data-visual-group="unconfirmed"] summary`)), "Las cuentas de cada grupo se actualizan");
assert((await page.title()) !== "HACKEADO" && (await page.$(`${FOTO} [data-site-signals] img, ${FOTO} [data-site-signals] b`)) === null && !(await page.evaluate((s) => document.querySelector(s).innerHTML.includes("onerror"), FOTO)), "Un «indicio» con HTML que llegara del servidor no se ejecuta ni se inserta");
assert((await note(FOTO)) === "done|Se abrió cada sitio para ver si está activo y si es de Uruguay.|con-boton", "Al terminar queda el botón «Verificar de nuevo»");
assert(outside.length === 0, `El navegador no abrió ninguna de las tiendas: la verificación la hace el servidor${outside.length ? ` (${outside[0]})` : ""}`);
assert((await overflow()).length === 0, "Verificación a 1280 px: sin desborde horizontal");
await shot("r14-verificacion-1280", 1280);
await page.setViewport({ width: 390, height: 844 });
await sleep(400);
const o390 = await overflow();
assert(o390.length === 0, `Verificación a 390 px: sin desborde horizontal${o390.length ? ` (${o390.join(", ")})` : ""}`);
await shot("r14-verificacion-390", 390);
await page.setViewport({ width: 1280, height: 900 });
await sleep(300);

// --- No se repite sola; «Verificar de nuevo» sí ---
await click("^Lote CSV$");
await sleep(400);
await click("^Por foto$");
await sleep(1200);
assert(verifyCalls.length === 1, "Cambiar de pestaña, o esperar, no repite la verificación");
await page.click(`${FOTO} [data-verify-again]`);
await page.waitForFunction(() => true);
await sleep(700);
assert(verifyCalls.length === 2 && verifyCalls[1].body.tokens.length === 8 && (await note(FOTO))?.startsWith("done|"), "«Verificar de nuevo» repite la verificación una vez");

// --- Si la verificación falla, la vista sigue igual ---
for (const [mode, label] of [["down", "El servicio falla"], ["notConfigured", "No está configurada (el endpoint responde VERIFY_NOT_CONFIGURED)"], ["rate", "Se llegó al límite de uso"], ["garbage", "Respuesta con otra forma"]]) {
  verifyMode = mode;
  const before = verifyCalls.length;
  await search();
  await page.waitForSelector(`${FOTO} [data-verify-note="failed"]`, { timeout: 10000 }).catch(() => null);
  r = await visualRows();
  assert((await note(FOTO)) === "failed|No se pudo verificar los sitios.|con-boton" && verifyCalls.length === before + 1, `${label}: una línea «No se pudo verificar los sitios»`);
  assert(by(r, "uy_stores").length === 4 && by(r, "unconfirmed").length === 4 && by(r, "no-disponibles").length === 0 && r.every((x) => x.status === null), `${label.split(":")[0].split(" (")[0]}: la lista queda como antes, sin indicadores ni cambios de grupo`);
}
verifyMode = "ok";
await page.click(`${FOTO} [data-verify-again]`);
await page.waitForSelector(`${FOTO} [data-verify-note="done"]`, { timeout: 10000 }).catch(() => null);
assert(by(await visualRows(), "no-disponibles").length === 2, "Después de una falla se puede verificar de nuevo a mano");

withTokens = false;
const beforeNoTokens = verifyCalls.length;
await search();
await sleep(900);
r = await visualRows();
assert(verifyCalls.length === beforeNoTokens && (await note(FOTO))?.startsWith("failed|No se pudo verificar los sitios.") && r.every((x) => x.status === null) && by(r, "uy_stores").length === 4, "Si el servidor no entrega permisos (falta VERIFY_SECRET), no se pide nada y la vista sigue igual, con la misma línea");
withTokens = true;

// --- La vista «En la web (Uruguay)» también verifica ---
await search();
await page.waitForSelector(`${FOTO} [data-verify-note="done"]`, { timeout: 10000 }).catch(() => null);
const beforeWeb = verifyCalls.length;
await click("^En la web \\(Uruguay\\)$");
await sleep(200);
await page.click("#mercado [data-web-search]");
await page.waitForSelector(`${WEB} [data-verify-note="done"]`, { timeout: 10000 }).catch(() => null);
const w = await rows(WEB, "data-web-seller");
const wrow = (site) => w.find((x) => x.site === site);
assert(verifyCalls.length === beforeWeb + 1 && verifyCalls.at(-1).body.tokens.map(urlOf).map((u) => new URL(u).hostname).join() === "ferreteria.com.uy,sinpista.com,muerta.com", "La búsqueda por nombre también se verifica: primero las tiendas de Uruguay, después las sin confirmar; ni Amazon ni YouTube");
assert(wrow("ferreteria.com.uy").statusText === "Activa" && wrow("ferreteria.com.uy").signals === "Uruguay: RUT" && wrow("ferreteria.com.uy").group === "principal", "Ahí también: «Activa» y los indicios de Uruguay");
assert(wrow("sinpista.com").group === "principal" && wrow("sinpista.com").uruguay === "Uruguay: confirmado" && wrow("sinpista.com").signals === "Uruguay: dirección en Salto", "Una tienda sin confirmar con indicios sube a la lista principal");
assert(wrow("muerta.com").group === "no-disponibles" && !wrow("muerta.com").shown && /^No disponibles: la página ya no existe o está caída \(1\)$/.test(await textOf(`${WEB} details[data-unavailable] summary`)), "La caída pasa a «No disponibles»");
assert(wrow("amazon.com").group === "ocultos" && wrow("amazon.com").status === null && wrow("youtube.com").status === null && /2 resultados de tiendas/.test(await textOf(`${WEB} [data-web-results] [role='status']`)), "Los ocultos y lo que no es tienda quedan como estaban, y la cuenta de tiendas se actualiza");
assert((await overflow()).length === 0, "Vista web verificada a 1280 px: sin desborde horizontal");
await shot("r14-verificacion-web-1280", 1280);
assert(outside.length === 0, "En toda la prueba el navegador no abrió ninguna página de terceros");
assert(problems.length === 0, `Sin errores en la consola${problems.length ? `: ${problems[0]}` : ""}`);

console.log(`\nRESULTADO: ${passed}/${total} casos en navegador`);
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
if (passed !== total) process.exit(1);
