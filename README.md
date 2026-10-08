# UyMargin

Calculadora de rentabilidad para comerciantes mayoristas e importadores de Uruguay. Responde una pregunta antes de comprar un lote: **¿cuánto me queda limpio en el bolsillo si compro esto a mi mayorista y lo vendo en Uruguay?**

Simula el margen neto por unidad después de impuestos (DGI), comisiones y logística, y compara dos canales en paralelo: Mercado Libre Uruguay y tienda propia / POS. Está pensada para usarse desde el celular, en el depósito del proveedor. El contexto completo del producto está en [`PRODUCT.md`](PRODUCT.md).

## Qué hace

- **Calculadora en tres pasos:** costo mayorista (en pesos o dólares) y flete, precio de venta, y resultado con el canal que conviene.
- **Régimen tributario:** Literal E o Régimen General (IVA 22%, 10% o 0%, crédito fiscal de compras y servicios, provisión opcional de IRAE).
- **Canales:** Mercado Libre (publicación Clásica o Premium, cargo fijo en ventas de bajo valor, Mercado Envíos) y tienda propia (Mercado Pago, Handy o transferencia; envío local).
- **Packs:** sugiere combos x2, x3 y x4 para superar el umbral del cargo fijo de Mercado Libre.
- **Precio de mercado (opcional):**
  - *Radar:* busca un producto en Mercado Libre Uruguay y calcula mínimo, mediana, promedio y máximo.
  - *Por enlace:* analiza una publicación de catálogo (`mercadolibre.com.uy/.../p/MLU...`) y lista otros vendedores del mismo producto.
  - *Lote CSV:* carga un catálogo (SKU, nombre, costo, moneda) y lo ordena por rentabilidad.
- **Guardar y exportar:** historial en el navegador, exportación a CSV, impresión, resumen para copiar o enviar por WhatsApp.
- **Nube (opcional):** guarda auditorías de "Por enlace" y "Lote CSV" en un proyecto propio de Supabase.
- **Tema:** claro por defecto, con opción de oscuro desde el botón del encabezado. La elección se recuerda.
- **Copiloto (opcional):** un asistente con Gemini que comenta un resultado ya calculado. No calcula ni reemplaza las cifras.

Limitaciones conocidas, documentadas en el registro de auditoría interno (no publicado): no hay cuentas de usuario; el seguimiento de competidores está programado pero no tiene acceso desde la interfaz; "Por enlace" solo lee publicaciones de catálogo; las estrellas, opiniones y ventas que acompañan a cada publicación son estimaciones del servidor, no datos reales de Mercado Libre.

> Es una herramienta de estimación. No reemplaza el asesoramiento de un contador.

## Requisitos

- Node.js (probado con la versión 26)
- npm

## Instalación

```bash
npm install
```

Copiá las variables de entorno a un archivo `.env` en la raíz (ver la tabla de abajo). El archivo `.env` está en `.gitignore` y no se sube.

## Ejecución

```bash
npm run dev
```

Levanta un único servidor Express que sirve la interfaz (Vite en modo desarrollo) y la API. Escucha en el puerto indicado por `PORT`; el proyecto se usa con `PORT=3001`, es decir <http://localhost:3001>. Si `PORT` no está definido, usa el 3000.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `npm run build` | Genera la interfaz de producción en `dist/` |
| `npm start` | Corre el servidor sin recarga automática (con `NODE_ENV=production` sirve `dist/`) |
| `npm run lint` | Chequeo de tipos (`tsc --noEmit`) |
| `npm test` | Casos de prueba del motor financiero y de moneda/cotización, sin red |

## Tests

```bash
npm test
```

Corre `scripts/verify_finance.ts` (casos dorados del motor financiero) y `scripts/verify_currency.ts` (moneda, cotización del BCU y sus fallbacks). No usan red ni base de datos.

> **Advertencia:** `scripts/verify_all.ts` **escribe en Supabase real** (inserta y borra un registro de prueba en la tabla `uymargin_audits`). No lo ejecutes contra un proyecto con datos que te importen. `npm test` no lo usa.

`scripts/responsive-check.mjs` mide desbordes de la interfaz en 11 anchos de pantalla. Necesita la app corriendo y Google Chrome instalado (`CHROME_PATH` permite indicar otra ruta).

## Variables de entorno

Todas son opcionales para la calculadora básica. Sin ellas, la función asociada queda deshabilitada o en modo manual.

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del servidor (por defecto 3000; el proyecto usa 3001) |
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | Credenciales de una aplicación de Mercado Libre. Necesarias para el radar y "Por enlace" |
| `ML_ACCESS_TOKEN` | Alternativa a las dos anteriores: un token de acceso ya emitido |
| `GEMINI_API_KEY` | Copiloto |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Proyecto de Supabase para guardar en la nube. También se pueden cargar desde la interfaz (ícono de engranaje), que las guarda en el navegador |
| `NODE_ENV` | `production` para servir la interfaz compilada |

La tabla que necesita Supabase se crea con el script SQL que muestra la propia app en la configuración de la nube. Ese script deja la tabla abierta a cualquiera que tenga la clave pública: revisá las políticas antes de usarlo con datos reales (detalle en el registro de auditoría interno (no publicado)).

## Estructura

```
server.ts                 Servidor Express: API (cotización, radar, enlace, copiloto) y entrega de la interfaz
src/
  App.tsx                 Pantalla principal y estado de la simulación
  lib/finance/            Motor de cálculo: impuestos DGI, canales, packs, constantes
  lib/theme.ts            Tema claro (por defecto) u oscuro
  lib/format.ts           Formato de moneda, porcentajes y tipo de cambio (es-UY)
  lib/currency.ts         Moneda original de cada precio, conversión a pesos y reglas de la cotización
  lib/bcu.ts              Pedidos y lectura de respuestas del servicio de cotizaciones del BCU
  lib/storage/            Historial y borrador de la simulación en el navegador
  lib/supabase.ts         Cliente de Supabase (se carga solo cuando se usa la nube)
  lib/mlu/                Tipos y estadísticas de precios de Mercado Libre
  lib/tracking/           Seguimiento de competidores (sin acceso desde la interfaz)
  components/calculator/  Costo, precio, resultado, tarjetas de canal, packs
  components/search/      Radar, Por enlace, Lote CSV
  components/cloud/       Configuración y auditorías guardadas en Supabase
  components/ai/          Copiloto
  components/layout/      Encabezado
  components/ui/          Campos numéricos, selectores, ayudas
scripts/
  verify_finance.ts       Tests del motor financiero, sin red (npm test)
  verify_currency.ts      Tests de moneda y cotización, sin red (npm test)
  verify_all.ts           Tests que escriben en Supabase (no usar a la ligera)
  responsive-check.mjs    Medición de desbordes por ancho de pantalla
docs/                     Documentación y reportes de auditoría
PRODUCT.md                Qué es el producto, para quién y con qué principios
```

## Cotización del dólar

- **Fuente:** servicio web de cotizaciones del Banco Central del Uruguay (`cotizaciones.bcu.gub.uy`, operaciones `awsultimocierre` y `awsbcucotizaciones`), moneda 2225 "DLS. USA BILLETE". Se usa el tipo de cambio del último cierre publicado.
- El servicio es SOAP y no admite llamadas desde el navegador, así que la consulta la hace el servidor (`/api/exchange-rate`). El detalle está en `src/lib/bcu.ts`.
- Cada cotización se guarda con su valor, la fecha del cierre y la fuente.
- **Si el BCU no responde:** se usa el último valor guardado y la interfaz lo muestra como "cotización del [fecha], no actualizada".
- **Si tampoco hay valor guardado:** la app pide la cotización a mano y deja pendiente todo cálculo con montos en dólares. No existe un valor por defecto.
- La cotización se puede corregir a mano en el encabezado; queda rotulada como "valor manual".
- Los precios de publicaciones se muestran siempre en su moneda original; si están en dólares, al lado va el equivalente en pesos con la cotización y la fecha usadas. Una moneda que no sea UYU o USD no se convierte.

El servidor guarda la última cotización en `.cache/exchange-rate.json` (ignorado por git).
