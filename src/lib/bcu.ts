/**
 * Cliente del servicio de cotizaciones del Banco Central del Uruguay.
 *
 * Fuente (verificada el 2026-10-08 leyendo los WSDL publicados por el BCU):
 *   https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsultimocierre?wsdl
 *   https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones?wsdl
 *   https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcumonedas?wsdl
 *
 * Es SOAP y no envía cabeceras CORS, así que solo se puede consultar desde el servidor.
 * Este módulo no hace red: arma los pedidos e interpreta las respuestas, para poder probarlo.
 */

export const BCU_BASE_URL = "https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet";

/** Código de moneda del BCU para "DLS. USA BILLETE" (listado por awsbcumonedas, grupo 2). */
export const BCU_USD_CODE = 2225;

const ENVELOPE_OPEN =
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza"><soapenv:Header/><soapenv:Body>';
const ENVELOPE_CLOSE = "</soapenv:Body></soapenv:Envelope>";

export const BCU_LAST_CLOSE = {
  url: `${BCU_BASE_URL}/awsultimocierre`,
  soapAction: "Cotizaaction/AWSULTIMOCIERRE.Execute",
  body: `${ENVELOPE_OPEN}<cot:wsultimocierre.Execute/>${ENVELOPE_CLOSE}`,
};

export function buildBcuQuoteRequest(date: string, currencyCode: number = BCU_USD_CODE) {
  return {
    url: `${BCU_BASE_URL}/awsbcucotizaciones`,
    soapAction: "Cotizaaction/AWSBCUCOTIZACIONES.Execute",
    body:
      `${ENVELOPE_OPEN}<cot:wsbcucotizaciones.Execute><cot:Entrada>` +
      `<cot:Moneda><cot:item>${currencyCode}</cot:item></cot:Moneda>` +
      `<cot:FechaDesde>${date}</cot:FechaDesde><cot:FechaHasta>${date}</cot:FechaHasta><cot:Grupo>0</cot:Grupo>` +
      `</cot:Entrada></cot:wsbcucotizaciones.Execute>${ENVELOPE_CLOSE}`,
  };
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/** Fecha del último cierre (AAAA-MM-DD) o null si la respuesta no la trae. */
export function parseBcuLastClose(xml: string): string | null {
  const date = tag(xml, "Fecha");
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export interface BcuQuote {
  date: string;
  currencyCode: number;
  name: string;
  /** Tipo de cambio comprador. */
  buy: number;
  /** Tipo de cambio vendedor. */
  sell: number;
}

export type BcuQuoteResult = { ok: true; quote: BcuQuote } | { ok: false; error: string };

/** Interpreta la respuesta de awsbcucotizaciones para una moneda y una fecha. */
export function parseBcuQuote(xml: string, currencyCode: number = BCU_USD_CODE): BcuQuoteResult {
  const status = tag(xml, "status");
  if (status !== "1") {
    return { ok: false, error: tag(xml, "mensaje") || `El BCU respondió con estado ${status ?? "desconocido"}` };
  }
  const records = xml.split(/<datoscotizaciones\.dato[\s>]/).slice(1);
  for (const record of records) {
    if (Number(tag(record, "Moneda")) !== currencyCode) continue;
    const date = tag(record, "Fecha");
    const buy = Number(tag(record, "TCC"));
    const sell = Number(tag(record, "TCV"));
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(buy > 0) || !(sell > 0)) {
      return { ok: false, error: "El BCU devolvió una cotización incompleta" };
    }
    return { ok: true, quote: { date, currencyCode, name: tag(record, "Nombre") || "", buy, sell } };
  }
  return { ok: false, error: "El BCU no devolvió cotización para el dólar en esa fecha" };
}
