// Tests de moneda y cotización. Sin red: la respuesta del BCU está copiada del servicio real
// (awsbcucotizaciones, cierre del 2026-10-07) y recortada a tres registros.
import {
  convertToUyu,
  describeRate,
  normalizeCurrency,
  resolveExchangeRate,
  type ExchangeRate,
} from "../src/lib/currency";
import { BCU_USD_CODE, buildBcuQuoteRequest, parseBcuLastClose, parseBcuQuote } from "../src/lib/bcu";
import { computeMarketStats } from "../src/lib/mlu/statistics";

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

const bcu7oct: ExchangeRate = {
  rate: 40.15,
  referenceDate: "2026-10-07",
  source: "bcu",
  fetchedAt: "2026-10-08T11:37:41.827Z",
  stale: false,
};

console.log("--- Publicación en USD ---");
const usd = convertToUyu(80, "USD", bcu7oct);
assert(usd.status === "ok" && usd.amountUyu === 80 * 40.15, "U$S 80 al cierre del 7/10 (40,15) son $U 3.212");
assert(usd.status === "ok" && usd.currency === "USD", "La conversión conserva la moneda original (USD)");
assert(usd.status === "ok" && usd.rate?.referenceDate === "2026-10-07" && usd.rate.source === "bcu", "La conversión informa cotización, fecha y fuente usadas");

console.log("\n--- Publicación en UYU ---");
const uyu = convertToUyu(3279, "UYU", bcu7oct);
assert(uyu.status === "ok" && uyu.amountUyu === 3279, "$U 3.279 queda en $U 3.279");
assert(uyu.status === "ok" && uyu.rate === null, "Un precio en pesos no usa ni declara cotización");
assert(convertToUyu(3279, "UYU", null).status === "ok", "Un precio en pesos se puede usar aunque no haya cotización");

console.log("\n--- Cambio de cotización ---");
const bcu8oct: ExchangeRate = { ...bcu7oct, rate: 41, referenceDate: "2026-10-08" };
const before = convertToUyu(80, "USD", bcu7oct);
const after = convertToUyu(80, "USD", bcu8oct);
assert(before.status === "ok" && after.status === "ok" && after.amountUyu - before.amountUyu === 80 * 41 - 80 * 40.15, "Al cambiar la cotización cambia el equivalente en pesos");
const mixed = [
  { price: 3279, currency: "UYU" },
  { price: 80, currency: "USD" },
  { price: 2190, currency: "UYU" },
];
const statsAt = (rate: ExchangeRate) =>
  computeMarketStats(mixed.flatMap((i) => { const c = convertToUyu(i.price, i.currency, rate); return c.status === "ok" ? [c.amountUyu] : []; }));
assert(statsAt(bcu7oct)!.median === 3212 && statsAt(bcu8oct)!.median === 3279, "La mediana del radar se recalcula con la cotización nueva (3.212 → 3.279)");
assert(convertToUyu(3279, "UYU", bcu7oct).status === "ok" && (convertToUyu(3279, "UYU", bcu8oct) as any).amountUyu === 3279, "Los precios en pesos no cambian con la cotización");

console.log("\n--- Cotización no disponible (fallback) ---");
const live = resolveExchangeRate(bcu7oct, null);
assert(live.status === "live" && live.rate.stale === false, "Con respuesta del BCU se usa esa cotización");
const stale = resolveExchangeRate(null, bcu7oct);
assert(stale.status === "stale" && stale.rate.rate === 40.15 && stale.rate.stale === true, "Sin respuesta se usa la última guardada, marcada como no actualizada");
assert(describeRate(stale.rate!) === "cotización del 7/10, no actualizada", 'Se muestra como "cotización del 7/10, no actualizada"');
const missing = resolveExchangeRate(null, null);
assert(missing.status === "missing" && missing.rate === null, "Sin respuesta y sin valor guardado no hay cotización (se pide a mano)");
assert(convertToUyu(80, "USD", missing.rate).status === "no_rate", "Sin cotización, un precio en dólares no se convierte");
assert(resolveExchangeRate({ ...bcu7oct, rate: 0 }, bcu7oct).status === "stale", "Una cotización 0 o inválida no se acepta como vigente");
const manual: ExchangeRate = { rate: 41.5, referenceDate: "2026-10-08", source: "manual", fetchedAt: "2026-10-08T12:00:00Z", stale: false };
assert(describeRate(manual) === "valor manual del 8/10" && convertToUyu(10, "USD", manual).status === "ok", "Un valor ingresado a mano se usa y se rotula como manual");
assert(describeRate(bcu7oct) === "BCU, cierre del 7/10", 'La cotización vigente se rotula "BCU, cierre del 7/10"');

console.log("\n--- Moneda desconocida ---");
const brl = convertToUyu(500, "BRL", bcu7oct);
assert(brl.status === "unknown_currency" && brl.currency === "BRL", "Un precio en BRL no se convierte y conserva su moneda original");
assert(convertToUyu(500, "", bcu7oct).status === "unknown_currency", "Un precio sin moneda no se asume en pesos ni en dólares");
assert(convertToUyu(500, undefined, bcu7oct).status === "unknown_currency", "Una moneda ausente (undefined) no se calcula");
assert(normalizeCurrency("usd") === "USD" && normalizeCurrency(" U$S ") === "USD" && normalizeCurrency("pesos") === "UYU", "Se reconocen las formas habituales de USD y UYU");
assert(normalizeCurrency("EUR") === null && normalizeCurrency("ARS") === null, "EUR y ARS no se tratan como moneda conocida");
assert(convertToUyu(Number.NaN, "USD", bcu7oct).status === "invalid_amount", "Un monto inválido no produce un número");

console.log("\n--- Respuesta del BCU ---");
const BCU_OK = `<?xml version="1.0" encoding="utf-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><wsbcucotizaciones.ExecuteResponse xmlns="Cotiza"><Salida xmlns="Cotiza"><respuestastatus><status>1</status><codigoerror>0</codigoerror><mensaje/></respuestastatus><datoscotizaciones><datoscotizaciones.dato xmlns="Cotiza"><Fecha>2026-10-07</Fecha><Moneda>2224</Moneda><Nombre>DLS. USA CABLE</Nombre><CodigoISO>DLS.</CodigoISO><Emisor>ESTADOS UNIDOS</Emisor><TCC>40.150000</TCC><TCV>40.150000</TCV><ArbAct>1.000000</ArbAct><FormaArbitrar>0</FormaArbitrar></datoscotizaciones.dato><datoscotizaciones.dato xmlns="Cotiza"><Fecha>2026-10-07</Fecha><Moneda>2225</Moneda><Nombre>DLS. USA BILLETE</Nombre><CodigoISO>DLS.</CodigoISO><Emisor>ESTADOS UNIDOS</Emisor><TCC>40.150000</TCC><TCV>40.150000</TCV><ArbAct>1.000000</ArbAct><FormaArbitrar>0</FormaArbitrar></datoscotizaciones.dato></datoscotizaciones></Salida></wsbcucotizaciones.ExecuteResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
const BCU_NO_DATE = `<Salida xmlns="Cotiza"><respuestastatus><status>0</status><codigoerror>100</codigoerror><mensaje>No existe cotización para la fecha indicada</mensaje></respuestastatus></Salida>`;
const BCU_LAST = `<wsultimocierre.ExecuteResponse xmlns="Cotiza"><Salida xmlns="Cotiza"><Fecha>2026-10-07</Fecha></Salida></wsultimocierre.ExecuteResponse>`;
const quote = parseBcuQuote(BCU_OK);
assert(quote.ok && quote.quote.currencyCode === BCU_USD_CODE && quote.quote.buy === 40.15 && quote.quote.date === "2026-10-07", "Se lee la cotización del dólar billete (código 2225) con su fecha");
assert(quote.ok && quote.quote.name === "DLS. USA BILLETE", "Se elige el registro correcto entre varias monedas");
const noDate = parseBcuQuote(BCU_NO_DATE);
assert(!noDate.ok && noDate.error === "No existe cotización para la fecha indicada", "Un día sin cierre devuelve el error del BCU, no un número");
assert(!parseBcuQuote("<html>error</html>").ok, "Una respuesta que no es del servicio se rechaza");
assert(!parseBcuQuote(BCU_OK.replace(/<TCC>40.150000<\/TCC>/g, "<TCC>0</TCC>")).ok, "Una cotización en 0 se rechaza");
assert(parseBcuLastClose(BCU_LAST) === "2026-10-07" && parseBcuLastClose("<x/>") === null, "Se lee la fecha del último cierre");
assert(buildBcuQuoteRequest("2026-10-07").body.includes("<cot:item>2225</cot:item>") && buildBcuQuoteRequest("2026-10-07").body.includes("<cot:FechaDesde>2026-10-07</cot:FechaDesde>"), "El pedido al BCU lleva el código del dólar y la fecha");

console.log("\n=================================================");
console.log(`RESULTADO: ${passed}/${total} casos de moneda y cotización`);
console.log("=================================================");
if (passed !== total) process.exit(1);
