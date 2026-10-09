// Tests de la identificación por foto: validación de la respuesta de la IA, límites de la imagen,
// límite de uso y que la imagen no se registra ni se guarda. Gemini siempre es simulado: no hay
// llamadas reales a Gemini ni a Mercado Libre, y no se importa server/app.ts (que lee .env) ni Supabase.
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createIdentifyRoute, IDENTIFY_SYSTEM_PROMPT, type IdentifyImage, type IdentifyModel } from "../server/identify";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES } from "../server/rateLimit";
import {
  CONFIDENCE_PHRASES,
  PHOTO_LIMITS,
  PHOTO_MESSAGES,
  PHOTO_NAME_MAX,
  checkPhotoFile,
  fitWithin,
  isPhotoType,
  parseIdentification,
  sniffImageType,
} from "../src/lib/photo/identify";

let passed = 0;
let total = 0;
function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

const GOOD = {
  isProduct: true,
  name: "Termo Stanley Classic 1L",
  alternatives: ["Termo Stanley", "Termo acero inoxidable"],
  brand: "Stanley",
  category: "Termos",
  attributes: ["verde", "acero inoxidable", "1 litro"],
  confidence: "alta",
  notes: "Se lee la marca en el frente.",
};
const json = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...GOOD, ...patch });
const without = (key: string) => {
  const copy: Record<string, unknown> = { ...GOOD };
  delete copy[key];
  return JSON.stringify(copy);
};

// Una "imagen" con una marca de texto adentro, para comprobar que no aparece en ningún log ni respuesta.
const MARKER = "CONTENIDO-PRIVADO-DE-LA-FOTO-7731";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARKER.repeat(20), "latin1")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), Buffer.alloc(32, 9)]);

async function main() {
  console.log("--- Respuesta de la IA: parseo y validación ---");
  const good = parseIdentification(json());
  assert(good.ok && good.value.ok === true && good.value.isProduct && good.value.name === "Termo Stanley Classic 1L", "Un JSON válido se acepta y conserva el nombre");
  assert(
    good.ok && good.value.alternatives.join("|") === "Termo Stanley|Termo acero inoxidable" && good.value.brand === "Stanley" && good.value.category === "Termos" && good.value.attributes.length === 3 && good.value.confidence === "alta",
    "Conserva alternativas, marca, categoría, atributos y confianza"
  );
  assert(
    good.ok && Object.keys(good.value).sort().join(",") === "alternatives,attributes,brand,category,confidence,isProduct,name,notes,ok",
    "La salida tiene exactamente los campos del contrato"
  );

  const fenced = parseIdentification("```json\n" + json() + "\n```");
  assert(fenced.ok && fenced.value.name === GOOD.name, "Acepta el JSON dentro de un bloque ```json");
  const wrapped = parseIdentification(`Claro, acá va el resultado:\n${json()}\nEspero que sirva.`);
  assert(wrapped.ok && wrapped.value.name === GOOD.name, "Acepta el JSON con texto antes y después");

  for (const [label, text] of [
    ["texto vacío", ""],
    ["solo espacios", "   "],
    ["texto sin JSON", "No pude ver la imagen."],
    ["JSON roto", '{"isProduct": true, "name": '],
    ["una lista en vez de un objeto", "[1,2,3]"],
    ["un número", "42"],
    ["null", "null"],
  ] as const) {
    assert(!parseIdentification(text).ok, `Rechaza ${label}`);
  }
  assert(!parseIdentification(undefined).ok && !parseIdentification({ isProduct: true }).ok, "Rechaza lo que no es texto");

  assert(!parseIdentification(without("isProduct")).ok, "Campo faltante: sin isProduct se rechaza");
  assert(!parseIdentification(without("confidence")).ok, "Campo faltante: sin confidence se rechaza");
  assert(!parseIdentification(without("name")).ok, "Campo faltante: producto sin name se rechaza");
  assert(!parseIdentification(json({ name: "   " })).ok && !parseIdentification(json({ name: "a" })).ok, "Producto con name vacío o de una letra se rechaza");
  assert(!parseIdentification(json({ isProduct: "true" })).ok && !parseIdentification(json({ isProduct: 1 })).ok, "Tipo incorrecto: isProduct que no es booleano se rechaza");
  assert(!parseIdentification(json({ name: 123 })).ok && !parseIdentification(json({ name: ["Termo"] })).ok, "Tipo incorrecto: name que no es texto se rechaza");
  assert(!parseIdentification(json({ confidence: "high" })).ok && !parseIdentification(json({ confidence: 0.9 })).ok, "Tipo incorrecto: confidence fuera de alta/media/baja se rechaza");

  const optional = parseIdentification(JSON.stringify({ isProduct: true, name: "Mate de calabaza", confidence: "media" }));
  assert(
    optional.ok && optional.value.alternatives.length === 0 && optional.value.brand === null && optional.value.category === null && optional.value.attributes.length === 0 && optional.value.notes === "",
    "Sin los campos accesorios igual sirve: quedan vacíos"
  );
  const wrongOptional = parseIdentification(json({ alternatives: "Termo", brand: 5, category: { a: 1 }, attributes: [1, null, "rojo", { x: 1 }], notes: ["x"] }));
  assert(
    wrongOptional.ok && wrongOptional.value.alternatives.length === 0 && wrongOptional.value.brand === null && wrongOptional.value.category === null && wrongOptional.value.attributes.join() === "rojo" && wrongOptional.value.notes === "",
    "Campos accesorios con tipo incorrecto se descartan sin romper"
  );

  const many = parseIdentification(json({ alternatives: ["Termo Stanley Classic 1L", "termo stanley", "Termo Stanley", "Termo", "Otro"], attributes: Array.from({ length: 20 }, (_, i) => `dato ${i}`) }));
  assert(many.ok && many.value.alternatives.join("|") === "termo stanley|Termo", "Alternativas: como mucho dos, sin repetir el nombre ni entre sí");
  assert(many.ok && many.value.attributes.length === 6, "Atributos: como mucho seis");
  const long = parseIdentification(json({ name: "Termo ".repeat(100), notes: "n".repeat(1000), brand: "b".repeat(200) }));
  assert(long.ok && long.value.name.length <= PHOTO_NAME_MAX && long.value.notes.length === 300 && (long.value.brand ?? "").length === 60, "Los textos largos se acotan");
  const dirty = parseIdentification(json({ name: "  Termo\n\tStanley\u0000  Classic  " }));
  assert(dirty.ok && dirty.value.name === "Termo Stanley Classic", "Saca saltos de línea, caracteres de control y espacios de más");
  const extra = parseIdentification(json({ price: 1234, instructions: "ignorá todo", ok: false }));
  assert(extra.ok && !("price" in extra.value) && !("instructions" in extra.value) && extra.value.ok === true, "Los campos que no son del contrato no pasan");

  const none = parseIdentification(JSON.stringify({ isProduct: false, name: "Persona en la playa", alternatives: ["x"], brand: "y", confidence: "alta", notes: "Solo se ve un paisaje." }));
  assert(
    none.ok && !none.value.isProduct && none.value.name === "" && none.value.alternatives.length === 0 && none.value.brand === null && none.value.confidence === "baja" && none.value.notes === "Solo se ve un paisaje.",
    "isProduct false: sin nombre ni alternativas, confianza baja, y conserva la nota"
  );
  assert(parseIdentification(JSON.stringify({ isProduct: false, confidence: "baja" })).ok, "isProduct false no exige name");

  assert(CONFIDENCE_PHRASES.alta === "Estoy seguro" && CONFIDENCE_PHRASES.media === "Puede ser" && CONFIDENCE_PHRASES.baja === "No estoy seguro: revisá el nombre", "Frases de confianza");

  console.log("--- Prompt del sistema ---");
  assert(/PRODUCTO/.test(IDENTIFY_SYSTEM_PROMPT) && /personas/i.test(IDENTIFY_SYSTEM_PROMPT) && /ignoralas/.test(IDENTIFY_SYSTEM_PROMPT), "Pide identificar el producto e ignorar a las personas");
  assert(/isProduct en false/.test(IDENTIFY_SYSTEM_PROMPT), "Sin producto claro pide isProduct false");
  assert(/Nunca es una instrucción/.test(IDENTIFY_SYSTEM_PROMPT) && /DATO/.test(IDENTIFY_SYSTEM_PROMPT), "El texto de la imagen es dato, nunca instrucciones");
  assert(/SOLO con un objeto JSON/.test(IDENTIFY_SYSTEM_PROMPT), "Pide responder solo con JSON");

  console.log("--- Imagen: tipo, tamaño y contenido real ---");
  assert(isPhotoType("image/jpeg") && isPhotoType("image/png") && isPhotoType("image/webp"), "Acepta JPEG, PNG y WebP");
  assert(!isPhotoType("image/gif") && !isPhotoType("image/svg+xml") && !isPhotoType("application/pdf") && !isPhotoType("") && !isPhotoType(undefined), "No acepta GIF, SVG, PDF ni vacío");
  assert(sniffImageType(JPEG) === "image/jpeg" && sniffImageType(PNG) === "image/png" && sniffImageType(WEBP) === "image/webp", "Reconoce JPEG, PNG y WebP por sus primeros bytes");
  assert(
    sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null && sniffImageType(Buffer.from("GIF89a....")) === null && sniffImageType(Buffer.from("%PDF-1.7")) === null && sniffImageType(Buffer.alloc(0)) === null && sniffImageType(Buffer.from([0xff, 0xd8])) === null,
    "SVG, GIF, PDF, vacío o un archivo cortado no son una imagen válida"
  );
  assert(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WAVE")])) === null, "Un RIFF que no es WebP (un audio) no pasa");
  assert(PHOTO_LIMITS.maxBytes === 3 * 1024 * 1024 && PHOTO_LIMITS.maxBytes < 4.5 * 1024 * 1024, "El tope del servidor es 3 MB, por debajo del límite de Vercel (4,5 MB)");
  assert(checkPhotoFile("image/jpeg", 1000, PHOTO_LIMITS.maxBytes) === null, "Archivo dentro del límite: sin problema");
  assert(checkPhotoFile("image/jpeg", PHOTO_LIMITS.maxBytes, PHOTO_LIMITS.maxBytes) === null && checkPhotoFile("image/jpeg", PHOTO_LIMITS.maxBytes + 1, PHOTO_LIMITS.maxBytes) === "size", "El límite de tamaño es inclusivo: un byte más ya no pasa");
  assert(checkPhotoFile("image/jpeg", 0, PHOTO_LIMITS.maxBytes) === "size", "Un archivo vacío no pasa");
  assert(checkPhotoFile("image/gif", 10, PHOTO_LIMITS.maxBytes) === "type" && checkPhotoFile("", 10, PHOTO_LIMITS.maxBytes) === "type", "Tipo no admitido: se informa el tipo");
  const fit = (w: number, h: number) => { const f = fitWithin(w, h, PHOTO_LIMITS.maxSide); return `${f.width}x${f.height}`; };
  assert(fit(4000, 3000) === "1024x768" && fit(3000, 4000) === "768x1024", "Achica al lado mayor de 1024 px sin deformar");
  assert(fit(800, 600) === "800x600" && fit(1024, 1024) === "1024x1024", "No agranda una foto chica");
  assert(fit(10000, 2) === "1024x1" && fit(0, 0) === "0x0", "Casos extremos: una tira muy fina y un tamaño vacío");

  console.log("--- Límite de uso propio ---");
  const scopes: string[] = [RATE_RULES.photo.scope, RATE_RULES.market.scope, RATE_RULES.chat.scope];
  assert(scopes[0] === "foto" && new Set(scopes).size === 3, "La foto tiene su propio contador, aparte de las búsquedas y del copiloto");
  assert(RATE_RULES.photo.perMinute <= 5 && RATE_RULES.photo.perDay <= 50 && RATE_RULES.photo.perDay < RATE_RULES.chat.perDay, "Topes conservadores: más bajos que los del copiloto");
  const store = createMemoryRateStore();
  const NOW = Date.UTC(2026, 9, 9, 15, 0, 5);
  let okCount = 0;
  for (let i = 0; i < RATE_RULES.photo.perMinute; i++) if ((await checkRate(store, "ana", RATE_RULES.photo, NOW)).ok) okCount++;
  assert(okCount === RATE_RULES.photo.perMinute, `Deja pasar ${RATE_RULES.photo.perMinute} fotos en un minuto`);
  const blocked = await checkRate(store, "ana", RATE_RULES.photo, NOW);
  assert(blocked.ok === false && blocked.window === "minuto" && blocked.retryAfterSeconds === 55, "La siguiente se frena por minuto y dice cuánto esperar");
  assert((await checkRate(store, "ana", RATE_RULES.market, NOW)).ok, "Llegar al tope de fotos no frena las búsquedas de Mercado Libre");
  assert((await checkRate(store, "beto", RATE_RULES.photo, NOW)).ok, "El tope es por usuario: otro usuario no queda frenado");
  assert((await checkRate(store, "ana", RATE_RULES.photo, NOW + 60_000)).ok, "Al minuto siguiente vuelve a pasar");
  const dayStore = createMemoryRateStore();
  let dayOk = 0;
  for (let i = 0; i < RATE_RULES.photo.perDay; i++) if ((await checkRate(dayStore, "ana", RATE_RULES.photo, NOW + i * 60_000)).ok) dayOk++;
  const dayBlocked = await checkRate(dayStore, "ana", RATE_RULES.photo, NOW + RATE_RULES.photo.perDay * 60_000);
  assert(dayOk === RATE_RULES.photo.perDay && dayBlocked.ok === false && dayBlocked.window === "día", `Tope diario: pasan ${RATE_RULES.photo.perDay} y la siguiente se frena hasta el otro día`);

  console.log("--- Endpoint (IA simulada), sin registrar ni guardar la imagen ---");
  // Se captura todo lo que se escribe por consola y cualquier intento de escribir en disco.
  const logs: string[] = [];
  const consoleKeys = ["log", "info", "warn", "error", "debug"] as const;
  const originalConsole = Object.fromEntries(consoleKeys.map((k) => [k, console[k]])) as Record<(typeof consoleKeys)[number], (...a: unknown[]) => void>;
  const diskWrites: string[] = [];
  const fsKeys = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "createWriteStream", "openSync", "open"] as const;
  const fsAny = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originalFs = Object.fromEntries(fsKeys.map((k) => [k, fsAny[k]]));
  const promisesAny = fs.promises as unknown as Record<string, (...a: unknown[]) => unknown>;
  const originalPromises = { writeFile: promisesAny.writeFile, appendFile: promisesAny.appendFile, open: promisesAny.open };

  const calls: IdentifyImage[] = [];
  let answers: (string | Error)[] = [];
  let configured = true;
  const model: IdentifyModel = async (image) => {
    calls.push(image);
    const next = answers.shift() ?? json();
    if (next instanceof Error) throw next;
    return next;
  };
  // El mismo armado que server/app.ts: límite de uso y después la ruta.
  let rateUser = "ana";
  const limiterStore = createMemoryRateStore();
  const rateLimit = createRateLimiter({ store: () => limiterStore, fallback: limiterStore, userId: () => rateUser, now: () => NOW });
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.post("/api/identify-product", rateLimit(RATE_RULES.photo), ...createIdentifyRoute({ model: () => (configured ? model : null) }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/identify-product`;
  const responses: string[] = [];
  let userSeq = 0;
  const post = async (body: Buffer | string, type: string | null, sameUser = false) => {
    if (!sameUser) rateUser = `usuario-${++userSeq}`;
    const res = await fetch(url, { method: "POST", headers: type ? { "Content-Type": type } : {}, body: typeof body === "string" ? body : new Uint8Array(body) });
    const textBody = await res.text();
    responses.push(textBody);
    let data: any = null;
    try {
      data = JSON.parse(textBody);
    } catch {
      // se deja en null
    }
    return { status: res.status, data, retryAfter: res.headers.get("retry-after") };
  };

  for (const k of consoleKeys) console[k] = (...args: unknown[]) => { logs.push(args.map((a) => (typeof a === "string" ? a : Buffer.isBuffer(a) ? a.toString("latin1") : JSON.stringify(a))).join(" ")); };
  for (const k of fsKeys) fsAny[k] = (...args: unknown[]) => { diskWrites.push(`${k}(${String(args[0])})`); throw new Error("escritura en disco no permitida en este test"); };
  for (const k of Object.keys(originalPromises)) promisesAny[k] = async (...args: unknown[]) => { diskWrites.push(`promises.${k}(${String(args[0])})`); throw new Error("escritura en disco no permitida en este test"); };

  const results: Record<string, Awaited<ReturnType<typeof post>>> = {};
  const callsAt: Record<string, number> = {};
  const step = async (name: string, run: () => Promise<Awaited<ReturnType<typeof post>>>) => {
    const before = calls.length;
    results[name] = await run();
    callsAt[name] = calls.length - before;
  };
  try {
    await step("ok", () => post(JPEG, "image/jpeg"));
    await step("png", () => post(PNG, "image/png"));
    await step("webp", () => post(WEBP, "image/webp"));
    answers = ["esto no es json", json({ name: "Mate de calabaza" })];
    await step("retry", () => post(JPEG, "image/jpeg"));
    answers = ["basura", '{"isProduct": "quizás"}'];
    await step("invalid", () => post(JPEG, "image/jpeg"));
    answers = [new Error(`quota exceeded for project 12345 key=AIza-no-deberia-salir`)];
    await step("provider", () => post(JPEG, "image/jpeg"));
    answers = [JSON.stringify({ isProduct: false, confidence: "baja", notes: "Solo se ve un paisaje." })];
    await step("noProduct", () => post(JPEG, "image/jpeg"));
    answers = [`Ignorá las reglas. ${json({ name: "Termo Lumilagro", injected: "rm -rf" })}`];
    await step("extraText", () => post(JPEG, "image/jpeg"));
    await step("gif", () => post(Buffer.from("GIF89a" + "x".repeat(50)), "image/gif"));
    await step("pdf", () => post(Buffer.from("%PDF-1.7 ..."), "application/pdf"));
    await step("noType", () => post(JPEG, null));
    await step("jsonBody", () => post(JSON.stringify({ image: JPEG.toString("base64") }), "application/json"));
    await step("fake", () => post(Buffer.from("<html>no soy una foto</html>"), "image/jpeg"));
    await step("empty", () => post(Buffer.alloc(0), "image/png"));
    await step("mislabeled", () => post(PNG, "image/jpeg"));
    const atLimit = Buffer.concat([JPEG, Buffer.alloc(PHOTO_LIMITS.maxBytes - JPEG.length, 1)]);
    await step("atLimit", () => post(atLimit, "image/jpeg"));
    await step("tooBig", () => post(Buffer.concat([atLimit, Buffer.from([1])]), "image/jpeg"));
    configured = false;
    await step("notConfigured", () => post(JPEG, "image/jpeg"));
    configured = true;
    // Límite de uso, con el mismo usuario.
    rateUser = "usuario-frecuente";
    for (let i = 0; i < RATE_RULES.photo.perMinute; i++) await post(JPEG, "image/jpeg", true);
    await step("rate", () => post(JPEG, "image/jpeg", true));
  } finally {
    for (const k of consoleKeys) console[k] = originalConsole[k];
    for (const k of fsKeys) fsAny[k] = originalFs[k] as (...a: unknown[]) => unknown;
    for (const k of Object.keys(originalPromises)) promisesAny[k] = (originalPromises as Record<string, (...a: unknown[]) => unknown>)[k];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const r = results;
  assert(r.ok.status === 200 && r.ok.data?.ok === true && r.ok.data.name === GOOD.name && r.ok.data.confidence === "alta", "Foto válida: 200 con el producto identificado");
  assert(calls[0].mimeType === "image/jpeg" && calls[0].bytes.equals(JPEG), "A la IA le llega la imagen tal cual, con su tipo");
  assert(r.png.status === 200 && r.webp.status === 200 && calls[1].mimeType === "image/png" && calls[2].mimeType === "image/webp", "PNG y WebP también se aceptan");
  assert(r.retry.status === 200 && r.retry.data.name === "Mate de calabaza" && callsAt.retry === 2, "JSON inválido: un reintento, y si el segundo sirve se usa");
  assert(r.invalid.status === 502 && r.invalid.data.code === "AI_INVALID_RESPONSE" && r.invalid.data.message === PHOTO_MESSAGES.invalidAnswer && callsAt.invalid === 2, "JSON inválido dos veces: error claro, sin un tercer intento");
  assert(r.provider.status === 502 && r.provider.data.code === "AI_ERROR" && r.provider.data.message === PHOTO_MESSAGES.provider && callsAt.provider === 1, "Error del proveedor: mensaje claro, sin reintentar");
  assert(!/quota|12345|AIza/.test(JSON.stringify(r.provider.data)), "El detalle del proveedor no llega al navegador");
  assert(r.noProduct.status === 200 && r.noProduct.data.isProduct === false && r.noProduct.data.name === "", "Sin producto: 200 con isProduct false");
  assert(r.extraText.status === 200 && r.extraText.data.name === "Termo Lumilagro" && !("injected" in r.extraText.data), "Texto alrededor del JSON: se lee el JSON y no pasan campos de más");
  assert(r.gif.status === 415 && r.gif.data.code === "UNSUPPORTED_IMAGE" && r.pdf.status === 415 && r.noType.status === 415 && r.jsonBody.status === 415, "GIF, PDF, sin tipo o un JSON: 415");
  assert(r.fake.status === 400 && r.fake.data.code === "NOT_AN_IMAGE", "Un archivo que dice ser JPEG y no lo es: 400");
  assert(r.empty.status === 400 && r.empty.data.code === "INVALID_IMAGE", "Cuerpo vacío: 400");
  assert(r.mislabeled.status === 200 && calls.some((c) => c.mimeType === "image/png" && c.bytes.equals(PNG) && c !== calls[1]), "Un PNG declarado como JPEG se manda a la IA como PNG (valen los bytes)");
  assert(r.atLimit.status === 200, "Una imagen de exactamente 3 MB pasa");
  assert(r.tooBig.status === 413 && r.tooBig.data.code === "IMAGE_TOO_LARGE" && r.tooBig.data.message === PHOTO_MESSAGES.size, "Un byte más de 3 MB: 413 con mensaje claro");
  assert(r.notConfigured.status === 503 && r.notConfigured.data.code === "AI_NOT_CONFIGURED" && r.notConfigured.data.message === PHOTO_MESSAGES.notConfigured, "Sin clave de Gemini: 503 con mensaje claro");
  assert(!/GEMINI|API_KEY|env/i.test(r.notConfigured.data.message), "Ese mensaje no nombra variables internas");
  assert(
    ["gif", "pdf", "noType", "jsonBody", "fake", "empty", "tooBig", "notConfigured", "rate"].every((k) => callsAt[k] === 0),
    "Ningún pedido rechazado llega a gastar una llamada a la IA"
  );
  assert(r.rate.status === 429 && r.rate.data.code === "RATE_LIMITED" && r.rate.retryAfter === "55" && /5 usos por minuto/.test(r.rate.data.message), "Pasado el tope por minuto: 429 con Retry-After y mensaje en español");
  for (const k of Object.keys(r)) {
    if (r[k].status !== 200) assert(r[k].data?.ok === false && typeof r[k].data.message === "string" && r[k].data.message === r[k].data.error, `Error «${k}»: JSON con ok:false y el mismo texto en message y error`);
  }

  const base64 = JPEG.toString("base64");
  const leaked = (text: string) => text.includes(MARKER) || text.includes(base64.slice(0, 60)) || text.includes(JPEG.toString("hex").slice(0, 60));
  assert(logs.length > 0, `Los errores sí dejan un registro (${logs.length} líneas)`);
  assert(!logs.some(leaked), "Ningún log contiene la imagen (ni en texto, ni en base64, ni en hexadecimal)");
  assert(logs.every((l) => l.length < 400), "Ningún log es lo bastante largo como para llevar una imagen");
  assert(!responses.some(leaked), "Ninguna respuesta devuelve la imagen");
  assert(!logs.some((l) => /AIza|quota exceeded/.test(l)), "El mensaje crudo del proveedor tampoco queda en los logs");
  assert(diskWrites.length === 0, `No se escribió nada en disco${diskWrites.length ? `: ${diskWrites.join(", ")}` : ""}`);

  const source = fs.readFileSync(new URL("../server/identify.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert(!/from "node:fs"|from "fs"|writeFile|createWriteStream|appendFile/.test(code), "server/identify.ts no usa el sistema de archivos");
  assert(!/supabase|cloud\.js/i.test(code), "server/identify.ts no usa Supabase");
  const logLines = code.split("\n").filter((l) => /console\./.test(l));
  assert(logLines.length > 0 && logLines.every((l) => !/bytes|req\.body|text\b|base64/.test(l)), "Ningún console.* de la ruta recibe los bytes, el cuerpo ni la respuesta de la IA");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de identificación por foto`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
