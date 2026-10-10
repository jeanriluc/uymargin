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
- **Nube:** guarda auditorías de "Por enlace" y "Lote CSV" en Supabase, a través del servidor. Son compartidas entre los usuarios con acceso.
- **Tema:** claro por defecto, con opción de oscuro desde el botón del encabezado. La elección se recuerda.
- **Copiloto (opcional):** un asistente con Gemini que comenta un resultado ya calculado. No calcula ni reemplaza las cifras.

Limitaciones conocidas, documentadas en el registro de auditoría interno (no publicado): no hay cuentas de usuario; el seguimiento de competidores está programado pero no tiene acceso desde la interfaz; "Por enlace" solo lee publicaciones de catálogo; de cada vendedor se muestra solo lo que informa Mercado Libre (apodo, reputación, MercadoLíder y transacciones); no hay estrellas, opiniones ni unidades en stock.

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
| `HOST` | Dirección en la que escucha el servidor (por defecto `127.0.0.1`, solo esta máquina; `0.0.0.0` para exponerlo a la red) |
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | Credenciales de una aplicación de Mercado Libre. Necesarias para el radar y "Por enlace" |
| `ML_ACCESS_TOKEN` | Alternativa a las dos anteriores: un token de acceso ya emitido |
| `GEMINI_API_KEY` | Copiloto e identificación de producto por foto |
| `APIFY_TOKEN` | **Secreta, solo servidor.** Búsqueda visual (Google Lens) y búsqueda "En la web (Uruguay)" de la pestaña Por foto (Apify). Sin ella quedan la identificación con IA y los botones de Google |
| `VERIFY_SECRET` | **Secreta, solo servidor.** Firma los permisos con los que la pestaña Por foto le pide al servidor que verifique si una tienda es de Uruguay y está activa. Mínimo 32 caracteres (`openssl rand -hex 32`). Sin ella no se verifica y lo demás sigue igual |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Proyecto de Supabase para el login (clave pública; queda en el JavaScript del navegador) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta, solo servidor.** Valida sesiones, guarda auditorías y cuenta el límite de uso |
| `ALLOWED_EMAILS` | **Solo servidor.** Correos que pueden usar la app, separados por comas |
| `AUTH_DISABLED`, `VITE_AUTH_DISABLED` | Solo desarrollo local: saltean el login. Se ignoran en producción y en Vercel |
| `NODE_ENV` | `production` para servir la interfaz compilada |

Todas las rutas `/api/*` exigen sesión (enlace mágico de Supabase Auth) y un correo de `ALLOWED_EMAILS`. El navegador no escribe en Supabase: las auditorías pasan por `/api/audits`. Los pasos de configuración y el SQL a aplicar están en [`docs/acceso-supabase.md`](docs/acceso-supabase.md) y `supabase/migrations/`.

## Estructura

```
server/app.ts             App Express con las rutas /api/* (cotización, radar, enlace, copiloto); no abre puertos
server/local.ts           Arranque local: Vite (desarrollo) o dist/ (producción) + app.listen
server/auth.ts            Control de acceso de /api/*: token de Supabase + ALLOWED_EMAILS
server/rateLimit.ts       Límite de uso por usuario (por minuto y por día)
server/cloud.ts           Supabase del servidor: sesiones, auditorías y contador del límite
supabase/migrations/      SQL a aplicar a mano en Supabase
api/                      Funciones de Vercel: cada archivo exporta el app de server/app.ts
vercel.json               Configuración de Vercel (framework, rewrite de la SPA, maxDuration)
src/
  App.tsx                 Pantalla principal y estado de la simulación
  lib/finance/            Motor de cálculo: impuestos DGI, canales, packs, constantes
  lib/theme.ts            Tema claro (por defecto) u oscuro
  lib/format.ts           Formato de moneda, porcentajes y tipo de cambio (es-UY)
  lib/currency.ts         Moneda original de cada precio, conversión a pesos y reglas de la cotización
  lib/bcu.ts              Pedidos y lectura de respuestas del servicio de cotizaciones del BCU
  lib/storage/            Historial y borrador de la simulación en el navegador
  lib/supabase.ts         Cliente de Supabase para la sesión y llamadas a /api/audits
  lib/api.ts              fetch de /api/* con el token de la sesión
  lib/mlu/                Tipos y estadísticas de precios de Mercado Libre
  lib/tracking/           Seguimiento de competidores (sin acceso desde la interfaz)
  components/calculator/  Costo, precio, resultado, tarjetas de canal, packs
  components/search/      Radar, Por enlace, Lote CSV
  components/cloud/       Auditorías guardadas en la nube
  components/auth/        Pantalla de ingreso y control de sesión
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

## Despliegue en Vercel

El mismo código corre de dos maneras. **Local:** `server/local.ts` (`npm run dev` / `npm start`), como siempre. **Vercel:** el frontend (Vite) sale como estático desde `dist/` y cada ruta `/api/*` es una función de `api/` que exporta el mismo app Express de `server/app.ts` (sin `app.listen`).

Detalles de la adaptación:
- `vercel.json` fija `framework: vite`, `outputDirectory: dist`, el rewrite de la SPA (todo lo que no sea `/api/` va a `index.html`) y `maxDuration` por función (60 s para radar, enlace y copiloto; 30 s cotización).
- La cotización del BCU se guarda solo en memoria y en `/tmp` de la instancia (mejor esfuerzo, sin error si no se puede escribir). La fuente de verdad de "última cotización" es el `localStorage` del navegador.
- `POST /api/tracking/check` responde **501** en Vercel (se llamaba a sí mismo por HTTP). El seguimiento de competidores no está conectado a la interfaz.
- Las funciones no tienen estado: dos instancias pueden tener cotizaciones en memoria distintas.

### Variables de entorno

Se cargan en el panel de Vercel (Project → Settings → Environment Variables), por entorno (Production / Preview / Development). **Nunca** se escriben en el repositorio.

| Variable | Dónde vive | Notas |
|---|---|---|
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET` | Secreta de servidor | Radar y "Por enlace". Alternativa: `ML_ACCESS_TOKEN` (también secreta) |
| `GEMINI_API_KEY` | Secreta de servidor | Copiloto e identificación de producto por foto |
| `APIFY_TOKEN` | Secreta de servidor | Búsqueda visual y búsqueda "En la web (Uruguay)" de Por foto. Cada búsqueda consume crédito de Apify (≈ US$ 0,015 por foto) |
| `VERIFY_SECRET` | Secreta de servidor | Verificación de sitios de Por foto (tienda de Uruguay y página activa). No tiene costo: el servidor abre las páginas |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Proyecto de Supabase para el login (clave pública; queda en el JavaScript del navegador) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta, solo servidor.** Valida sesiones, guarda auditorías y cuenta el límite de uso |
| `ALLOWED_EMAILS` | **Solo servidor.** Correos que pueden usar la app, separados por comas |
| `AUTH_DISABLED`, `VITE_AUTH_DISABLED` | Solo desarrollo local: saltean el login. Se ignoran en producción y en Vercel |
| `PORT`, `HOST` | Solo ejecución local | Vercel no las usa |

Los previews por rama usan las variables del entorno *Preview*: cargalas también ahí si querés que funcionen el radar, el copiloto o la nube.

### Pasos

1. Importar el repositorio de GitHub en Vercel. Debe detectar **Vite**; el build es `npm run build` y la salida `dist` (ya están en `vercel.json`).
2. Elegir Node.js 22 o 24 en Project Settings → Build and Deployment (el proyecto se probó localmente con Node 26, que Vercel no ofrece).
3. Cargar las variables de la tabla de arriba.
4. Deploy. Cada rama obtiene un preview.
5. Probar `/api/exchange-rate` en el preview antes de compartirlo.

Importante: estos endpoints **no tienen autenticación ni límite de uso**. En Vercel quedan públicos y gastan tu cuota de Mercado Libre y de Gemini; revisá la protección del deployment (Deployment Protection) antes de compartir la URL.

Si una función falla con el cuerpo de una petición POST vacío, probar la variable de proyecto `NODEJS_HELPERS=0` (desactiva los helpers de Vercel que reemplazan `req/res`). No verificado.

