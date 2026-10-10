// Tests de la foto del producto en el resumen: qué direcciones se muestran, cuáles se guardan y que las
// entradas viejas sin el campo no rompen nada. Sin red y sin navegador.
import { createDefaultInputs } from "../src/lib/finance/constants";
import { calculateBundleOptions } from "../src/lib/finance/bundles";
import { analyzeAll } from "../src/lib/finance/engine";
import { safeThumbnailUrl } from "../src/lib/photo/visual";
import {
  displayableProductImage,
  isGoogleImageHost,
  isLocalThumbnail,
  isMercadoLibreImageHost,
  safeProductImageUrl,
  storableProductImage,
} from "../src/lib/productImage";
import { loadDraft, saveDraft } from "../src/lib/storage/draft";

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

console.log("--- Hosts permitidos ---");
for (const good of [
  "https://http2.mlstatic.com/D_NQ_NP_664195-MLU78142130761_082024-F.webp",
  "https://mlstatic.com/a.jpg",
  "https://mla-s1-p.mlstatic.com/a.jpg",
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",
  "https://encrypted-tbn3.gstatic.com/shopping?q=tbn:abc",
  "https://gstatic.com/a.png",
  "https://lh3.googleusercontent.com/abc",
  "https://yt3.ggpht.com/abc",
  "https://HTTP2.MLSTATIC.COM/a.jpg",
]) {
  assert(safeProductImageUrl(good) !== null && displayableProductImage(good) !== null && storableProductImage(good) !== null, `Se acepta: ${good}`);
}
assert(safeProductImageUrl("  https://http2.mlstatic.com/a.jpg  ") === "https://http2.mlstatic.com/a.jpg", "Los espacios de alrededor se sacan");
assert(safeProductImageUrl("https://HTTP2.MLSTATIC.COM/a.jpg") === "https://http2.mlstatic.com/a.jpg", "El host queda en minúsculas");

console.log("--- Direcciones que se descartan ---");
const LOCAL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEB";
for (const bad of [
  "http://http2.mlstatic.com/a.jpg",
  "//http2.mlstatic.com/a.jpg",
  "http2.mlstatic.com/a.jpg",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)//https://http2.mlstatic.com/a.jpg",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "blob:https://http2.mlstatic.com/1234",
  "ftp://http2.mlstatic.com/a.jpg",
  "https://mlstatic.com.evil.com/a.jpg",
  "https://http2.mlstatic.com.evil.com/a.jpg",
  "https://evilmlstatic.com/a.jpg",
  "https://mlstatic.com.uy/a.jpg",
  "https://notgstatic.com/a.jpg",
  "https://gstatic.com.evil.net/a.jpg",
  "https://googleusercontent.com.evil.net/a.jpg",
  "https://ggpht.com.evil.net/a.jpg",
  "https://evil.com/http2.mlstatic.com/a.jpg",
  "https://evil.com/?u=https://http2.mlstatic.com/a.jpg",
  "https://evil.com#@http2.mlstatic.com/a.jpg",
  "https://http2.mlstatic.com@evil.com/a.jpg",
  "https://usuario:clave@http2.mlstatic.com/a.jpg",
  "https://http2.mlstatic.com:8443/a.jpg",
  "https://tienda.com.uy/foto.jpg",
  "https://sitio-raro.net/a.jpg",
  "https://127.0.0.1/a.jpg",
  "https://localhost/a.jpg",
  "https://",
  "no es una dirección",
  `https://http2.mlstatic.com/${"a".repeat(1000)}`,
  "",
  "   ",
]) {
  assert(safeProductImageUrl(bad) === null && displayableProductImage(bad) === null && storableProductImage(bad) === null, `Se descarta: ${bad.length > 70 ? `${bad.slice(0, 60)}… (${bad.length} caracteres)` : bad || "(vacía)"}`);
}
for (const bad of [null, undefined, 5, {}, [], true, ["https://http2.mlstatic.com/a.jpg"], { toString: () => "https://http2.mlstatic.com/a.jpg" }]) {
  assert(safeProductImageUrl(bad) === null && displayableProductImage(bad) === null, `Lo que no es texto se descarta: ${JSON.stringify(bad) ?? "undefined"}`);
}
assert(isMercadoLibreImageHost("http2.mlstatic.com") && !isMercadoLibreImageHost("mlstatic.com.evil.com") && !isMercadoLibreImageHost("xmlstatic.com"), "Host de Mercado Libre: mlstatic.com y subdominios, no parecidos");
assert(isGoogleImageHost("encrypted-tbn0.gstatic.com") && !isGoogleImageHost("gstatic.com.evil.com") && !isGoogleImageHost("mlstatic.com"), "Host de Google: no incluye a Mercado Libre ni parecidos");

console.log("--- Miniatura local (la foto del usuario) ---");
assert(isLocalThumbnail(LOCAL) && displayableProductImage(LOCAL) === LOCAL, "La miniatura JPEG armada en el navegador se muestra");
assert(displayableProductImage("data:image/png;base64,iVBORw0KGgo=") !== null, "Una miniatura PNG en base64 también");
assert(storableProductImage(LOCAL) === null && safeProductImageUrl(LOCAL) === null, "La miniatura local nunca se guarda");
for (const bad of [
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
  "data:image/webp;base64,UklGRg==",
  "data:image/jpeg,/9j/4AAQ",
  "data:image/jpeg;base64,",
  "data:image/jpeg;base64,/9j/4AAQ\"><script>alert(1)</script>",
  "data:image/jpeg;base64,/9j/ 4AAQ",
  "data:image/jpeg;charset=utf-8;base64,/9j/4AAQ",
  "DATA:IMAGE/JPEG;BASE64,/9j/4AAQ",
  " data:image/jpeg;base64,/9j/4AAQ",
  "data:,",
  `data:image/jpeg;base64,${"A".repeat(80_000)}`,
]) {
  assert(!isLocalThumbnail(bad) && displayableProductImage(bad) === null, `data: que no es nuestra miniatura se descarta: ${bad.slice(0, 48)}${bad.length > 48 ? "…" : ""}`);
}

console.log("--- Las miniaturas de la búsqueda visual siguen igual ---");
assert(safeThumbnailUrl("https://encrypted-tbn0.gstatic.com/images?q=tbn:abc") !== null, "Miniatura de Google en la búsqueda visual: se acepta");
assert(safeThumbnailUrl("https://http2.mlstatic.com/a.jpg") === null, "La búsqueda visual sigue sin aceptar otros orígenes");

console.log("--- Entradas del cálculo, packs y borrador ---");
const defaults = createDefaultInputs();
assert(defaults.productImage === null, "Por defecto no hay foto");
const ML = "https://http2.mlstatic.com/D_NQ_NP_1.webp";
const base = { ...defaults, productName: "Termo", cost: { amount: 10, currency: "USD" as const }, exchangeRate: 40, salePrice: 900 };
const withPhoto = { ...base, productImage: ML };
assert(JSON.stringify(analyzeAll(withPhoto)) === JSON.stringify(analyzeAll(base)), "La foto no cambia ningún resultado del cálculo");
const { productImage: _omit, ...old } = base;
assert(JSON.stringify(analyzeAll(old)) === JSON.stringify(analyzeAll(base)), "Entradas viejas sin el campo: mismo resultado, sin errores");
assert(JSON.stringify(calculateBundleOptions(withPhoto)) === JSON.stringify(calculateBundleOptions(base)), "Packs: mismos resultados con foto y sin ella");
let packsOk = true;
try {
  calculateBundleOptions(old);
  calculateBundleOptions({ ...base, productImage: undefined });
} catch {
  packsOk = false;
}
assert(packsOk, "Packs: entradas sin el campo no dan error");

// localStorage simulado para el borrador.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
saveDraft(withPhoto);
assert(loadDraft(defaults).productImage === ML, "Borrador: la foto de Mercado Libre se conserva al recargar");
saveDraft({ ...base, productImage: LOCAL });
assert(![...store.values()].some((v) => v.includes("data:image")) && loadDraft(defaults).productImage === null, "Borrador: la foto del usuario no se guarda");
store.set("uymargin:draft:v1", JSON.stringify(old));
assert(loadDraft(defaults).productImage === null && loadDraft(defaults).productName === "Termo", "Borrador viejo sin el campo: queda sin foto y conserva lo demás");
store.set("uymargin:draft:v1", JSON.stringify({ ...base, productImage: "https://evil.com/a.jpg" }));
assert(loadDraft(defaults).productImage === null, "Borrador con una dirección desconocida: se descarta");
store.set("uymargin:draft:v1", JSON.stringify({ ...base, productImage: { url: ML } }));
assert(loadDraft(defaults).productImage === null, "Borrador con un valor que no es texto: se descarta");

console.log("=================================================");
console.log(`Foto del producto: ${passed}/${total} verificaciones`);
console.log("=================================================");
if (passed !== total) process.exit(1);
