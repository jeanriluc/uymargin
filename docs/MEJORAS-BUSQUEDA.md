# Mejoras de la búsqueda de mercado (ronda 9)

Rama `ronda-9-busqueda`, desde `main` (`6089315`). Fecha: 2026-10-09.

## 1. Cómo funciona hoy

1. El Radar y el Lote llaman a `GET /api/search-mlu?q=…&rate=…` (con sesión y límite de uso: 60 por minuto y 1.500 por día por usuario, compartido con "Por enlace").
2. El servidor busca candidatos en dos fuentes en paralelo (`gatherCandidates`, `server/app.ts`): la búsqueda por palabras del catálogo de Mercado Libre (hasta 50, con un reintento a los 400 ms) y los más vendidos de la categoría que Mercado Libre le asigna al texto.
3. Para cada candidato pide sus ofertas activas (`/products/{id}/items`, de a 25, con un presupuesto de 4 s) y se queda con **la oferta más barata** como precio del producto.
4. `relevanceOf` (`src/lib/mlu/relevance.ts`) separa "coinciden" de "relacionados": un producto coincide solo si su nombre o ficha mencionan **todas** las palabras y números buscados.
5. La estadística (mínimo, mediana, promedio, máximo) se arma solo con los que coinciden, en pesos (los dólares se pasan con la cotización del pedido), **sin excluir ningún precio**.
6. El Radar recalcula esa estadística en el navegador con la cotización vigente (`liveStats` en `App.tsx`) y marca, sin excluir, los precios a más de 3 veces la mediana o a menos de un tercio.
7. La mediana es el precio sugerido: el Radar la ofrece para simular y el Lote la usa como precio de venta de cada fila.
8. El Lote consulta fila por fila, en serie, con 250 ms de pausa. Si la respuesta no trae estadística, la fila queda "Sin dato de mercado".
9. Los precios cargados a mano usan otra regla: ahí sí se excluyen atípicos con el filtro IQR (`computeMarketStats`).
10. No hay caché de búsquedas: cada consulta, incluso repetida, va a Mercado Libre. Solo se cachean los vendedores (10 min).

"Por enlace" (`/api/analyze-url`) no se revisó en detalle en esta ronda.

## 2. Debilidades, con evidencia

| # | Debilidad | Evidencia |
|---|---|---|
| D1 | La mediana es una "mediana de mínimos": cada producto aporta solo su oferta más barata. Una liquidación o un vendedor que remata baja el precio de referencia. | `server/app.ts`, comentario "La oferta activa más barata" antes de armar cada `MluItem`. |
| D2 | Nuevos y usados se mezclan. La condición de la oferta más barata se muestra en la tarjeta pero no se usa para filtrar ni para avisar. | `condition` solo aparece en `CatalogProductCard.tsx` y `ExactOffersSection.tsx`; la estadística no la mira. |
| D3 | En el Radar no se excluyen atípicos; solo se marca lo que está a más de 3× la mediana. Con pocos precios, uno raro mueve la mediana. | `server/app.ts`: "sin excluir ninguno"; `statistics.ts`: `FAR_FROM_MEDIAN_FACTOR = 3`. |
| D4 | El Lote aceptaba una mediana hecha con un solo precio sin avisar. | `BatchAuditor.tsx`: alcanza con `data.stats.median > 0`. El Radar sí avisa con menos de 3 (`SMALL_SAMPLE`). |
| D5 | La coincidencia exige todas las palabras. Un nombre de catálogo largo (marca + modelo + medida + color) suele no coincidir con nada y la fila queda sin dato. No hay segundo intento con menos palabras. | `relevanceOf` devuelve `matches: false` si falta un solo término. El Lote solo sugiere "probá con un nombre más corto". |
| D6 | El Lote no tenía reintento ni cancelación: una fila que falla por un 429 o un corte quedaba perdida y había que correr todo de nuevo, gastando cuota. | `handleRunBatch` era un único `for` sin salida. |
| D7 | Sin caché: repetir un lote o una búsqueda gasta cuota de Mercado Libre y del límite de uso por usuario (1.500 por día alcanzan para unos 15 lotes de 100 filas). | No hay ningún caché de `/api/search-mlu`; solo `sellerCache`. |
| D8 | Dato parcial: si el presupuesto de 4 s no alcanza, quedan productos que coinciden pero no se consultaron (`matchedNotChecked`). La mediana se calcula igual con lo que llegó. El Radar lo avisa; el Lote no. | `RADAR_OFFERS_BUDGET_MS = 4000`; `relevance.matchedNotChecked` se muestra en `MarketSummary.tsx` pero `BatchAuditor.tsx` no lo usa. |
| D9 | Variantes del mismo producto (color, talle) son productos de catálogo distintos y cuentan como precios separados. | Cada `MluItem` es un `product.id` del catálogo. |
| D10 | Dos cálculos de la misma mediana: el servidor redondea y el Radar recalcula en el navegador. El Lote usa la del servidor. Pueden diferir en un peso. | `Math.round(quantile(...))` en el servidor; `computeMarketStats` en `App.tsx`. |
| D11 | Cuando el límite de uso propio responde 429, el Lote no espera el `Retry-After`: sigue con la fila siguiente, que también falla. | El bucle del Lote no mira `res.status === 429`. |

## 3. Mejoras priorizadas

Valor y riesgo de 1 (bajo) a 5 (alto).

| # | Mejora | Resuelve | Valor | Esfuerzo | Riesgo | Estado |
|---|---|---|---|---|---|---|
| M1 | Indicador de confiabilidad (Dato sólido / Dato flojo / Pocas muestras) en Radar y Lote, con rango p25–p75 | D3, D4 | 5 | S | 1 | **Hecho** |
| M2 | Aviso de precios muy fuera de rango, sin excluirlos | D3 | 4 | S | 1 | **Hecho** (dentro de M1) |
| M3 | Aviso de usados mezclados con nuevos | D2 | 4 | S | 1 | **Hecho** (dentro de M1) |
| M4 | Lote: reintentar solo las filas sin dato | D6 | 4 | S | 2 | **Hecho** |
| M5 | Lote: botón Cancelar que conserva lo consultado | D6 | 3 | S | 2 | **Hecho** |
| M6 | Lote: esperar el `Retry-After` ante un 429 en vez de seguir fallando | D11 | 4 | S | 2 | **Hecho** |
| M13 | Lote: avisar en la fila cuando el dato es parcial (`matchedNotChecked`) | D8 | 3 | S | 1 | Pendiente |
| M14 | Lote: al cancelar o frenar por límite, dejar las filas no consultadas como "sin consultar" para poder retomarlas | D6 | 3 | S | 2 | **Hecho** |
| M7 | Segundo intento automático con menos palabras (marca + modelo) cuando no coincide nada, marcado como "búsqueda ampliada" | D5 | 5 | M | 3 | Pendiente |
| M8 | Caché de búsquedas en el servidor (10–30 min por consulta y cotización) | D7 | 4 | M | 2 | Pendiente |
| M9 | Filtro opcional "solo nuevos", apagado por defecto | D2 | 4 | M | 3 (cambia la mediana si se prende) | Pendiente |
| M10 | Precio "típico" por producto (mediana de sus ofertas) además del más barato, opcional | D1 | 5 | L | 4 (cambia la mediana) | Pendiente |
| M11 | Agrupar variantes del mismo producto | D9 | 3 | L | 3 | Pendiente |
| M12 | Un solo lugar para calcular la mediana (servidor o navegador) | D10 | 2 | S | 3 | Pendiente |

## 4. Lo implementado

Nada de esto cambia la mediana, el precio sugerido ni ningún número que ya se mostraba.

**M1–M3 · Confiabilidad del dato** — commits `c58ad22` y `d88d0d0`.
- Lógica en `src/lib/mlu/reliability.ts` (`assessMarketData`). Reglas: menos de 3 precios = "Pocas muestras"; "Dato sólido" pide 5 o más precios, que p75/p25 no pase de 1,5, ningún precio a más de 3× la mediana (o menos de un tercio) y que no haya usados mezclados con nuevos; el resto es "Dato flojo".
- Radar: etiqueta junto al título del resumen y una línea "la mitad de los productos que coinciden se vende entre $U X y $U Y", con los motivos si no es sólido.
- Lote: la etiqueta aparece debajo del precio de mercado de cada fila (con el motivo al pasar el mouse) y el CSV suma al final la columna "Confiabilidad del dato".
- Cómo probarlo: buscar un producto en el Radar y mirar la etiqueta; correr un lote y revisar la columna de precio y el CSV. Tests: `npx tsx scripts/verify_search.ts` (17 casos).

**M4–M5 · Lote: reintentar y cancelar** — commit `29b2d57`.
- "Reintentar N sin dato" vuelve a consultar solo las filas sin dato de mercado; las que ya tenían precio no se tocan ni gastan cuota.
- "Cancelar" corta después de la consulta en curso y deja en la tabla lo ya consultado. Si se cancela un reintento, las filas que no se llegaron a consultar conservan su resultado anterior.
- La prueba en navegador de esto fue manual, con Mercado Libre simulado (lote de 3 filas: cancelar, reintentar, 429 por minuto y 429 diario).
- Cómo probarlo: correr el lote de ejemplo, tocar Cancelar a mitad; después "Reintentar". Tests: `npx tsx scripts/verify_tabs.ts` (casos de reintento y cancelación).

**M6 y M14 · Lote: límite de uso y retomar** — commits `49c7658` y `7e577f3`.
- Si una consulta responde 429 con una espera de hasta 65 s (tope por minuto), el Lote espera ese tiempo, lo muestra en el progreso y repite la fila una vez. Se puede cancelar durante la espera.
- Si la espera es mayor (tope diario), frena el lote, avisa "Llegaste al límite de uso de hoy" y deja en la tabla lo ya consultado.
- Al cancelar o frenar, las filas que no se llegaron a consultar quedan en la tabla como "Sin dato de mercado" con el motivo "No se llegó a consultar", y "Reintentar" las retoma sin volver a consultar las demás.
- Tests: `npx tsx scripts/verify_tabs.ts` (casos de `rateLimitDecision`).

## 5. Pendiente, ordenado por valor

1. **M7** Segundo intento con menos palabras: es lo que más filas "sin dato" rescataría en el Lote. Hay que mostrar claramente que el dato salió de una búsqueda ampliada.
2. **M10** Precio típico por producto: ataca el sesgo más grande (D1), pero cambia la mediana, así que tiene que ser opcional y compararse contra la actual antes de prenderlo.
3. **M8** Caché de búsquedas: ahorra cuota y hace instantáneo repetir un lote.
4. **M9** Filtro "solo nuevos".
5. **M13** Aviso de dato parcial en el Lote.
6. **M11** Agrupar variantes.
7. **M12** Unificar el cálculo de la mediana.

## 6. Hipótesis de mejoras grandes

- **Caché + histórico de precios:** guardar cada mediana consultada con su fecha (hay una tabla `price_history` que hoy no se usa desde la búsqueda) permitiría mostrar "hace un mes valía X" y detectar precios de liquidación.
- **Alertas:** avisar cuando la mediana de un producto guardado baja más de un porcentaje, o cuando el margen cae de "Bueno" a "Ajustado".
- **Lote en paralelo con cola:** 3–4 consultas a la vez con espera ante 429 bajaría el tiempo de un lote de 100 filas a un tercio.
- **Señal de demanda:** usar la cantidad de ofertas activas y de vendedores como indicador de competencia, además del precio.
- **Confiabilidad dentro del semáforo:** hoy el semáforo de una fila del Lote no distingue un precio sólido de uno flojo; se podría mostrar "Bueno (dato flojo)".

## 7. Qué revisar primero

1. Que las reglas de "Dato sólido" (5 precios, p75/p25 ≤ 1,5) te parezcan razonables con productos reales; se cambian en `RELIABILITY_RULES`.
2. Cuántas filas de un lote real quedan "Sin dato de mercado": eso mide cuánto vale M7.
3. Si la mediana de mínimos (D1) te está dando precios más bajos que lo que ves al entrar a Mercado Libre.
4. Cuántos usados aparecen mezclados en tus búsquedas habituales (el aviso nuevo lo muestra).
5. El dato parcial (`matchedNotChecked`): el Radar lo avisa, el Lote todavía no.
6. Probar Cancelar y Reintentar con un lote real, no solo con datos simulados.
7. El CSV del Lote tiene tres columnas nuevas al final desde la ronda 8 (dos) y esta (una): revisar si alguna planilla tuya depende del ancho.
8. El límite de 1.500 consultas por día por usuario frente al tamaño de tus lotes.
9. La diferencia entre precios manuales (excluyen atípicos) y Radar (no excluyen): decidir si tiene que ser igual.
10. `scripts/e2e_tabs.mjs` y `scripts/e2e_risk.mjs` no cubren lo nuevo de esta ronda; la prueba en navegador de hoy fue manual, con datos simulados.

---

# Ronda 10: calibración y búsqueda ampliada

Rama `ronda-10-calibracion`, desde `main` (`52c19b7`). Ninguno de los dos cambios modifica la mediana ni el precio sugerido.

## A. Calibración del indicador de confiabilidad (commit `fff89fb`)

**Qué resuelve.** El indicador daba "Dato sólido" a datos con un rango enorme, porque p75/p25 solo mira la mitad central de los precios.

**Cambios** (todos en `RELIABILITY_RULES`, `src/lib/mlu/reliability.ts`):
- `maxRange: 4`: si el máximo es más de 4 veces el mínimo, el dato es "Dato flojo" con el motivo "los precios van de $U X a $U Y".
- `smallSampleMax: 6` y `smallSampleFarFactor: 2`: con 6 precios o menos, un precio cuenta como "muy fuera de rango" si duplica la mediana (o es menos de la mitad). Con 7 o más sigue el corte de 3 veces.

**Evidencia.**

| Precios | Antes | Ahora |
|---|---|---|
| 900, 1.500, 2.400, 2.450, 2.500, 6.000 (la olla) | Dato sólido | Dato flojo: "los precios van de $U 900 a $U 6.000; hay 2 precios muy fuera de rango" |
| 2.400, 2.450, 2.500, 2.550, 5.200 | Dato sólido | Dato flojo: "hay 1 precio muy fuera de rango" |
| 2.400, 2.450, 2.500, 2.550, 2.600, 2.500 | Dato sólido | Dato sólido |
| 1.000 … 4.000 (8 precios, rango 4,0) | Dato sólido | Dato sólido |
| 1.000 … 4.100 (8 precios, rango 4,1) | Dato sólido | Dato flojo: "los precios van de $U 1.000 a $U 4.100" |

En todos los casos la mediana es la misma antes y después. Tests: `scripts/verify_search.ts`, sección "Calibración".

**Qué puede salir mal.**
- El umbral de 4 veces es un criterio mío, no está medido con búsquedas reales. Productos con variantes legítimas muy distintas (por ejemplo, el mismo termo en 500 ml y 2 l que coinciden con la búsqueda) van a salir "flojo": es lo buscado, pero conviene mirarlo con datos reales.
- Con 6 precios o menos, el indicador puede decir "hay 1 precio muy fuera de rango" (corte de 2 veces) sin que el Radar marque ninguna tarjeta como "precio muy distinto a la mediana" (corte de 3 veces). Son dos cortes distintos a propósito, pero puede confundir.
- El motivo usa "$U" (como el resto de la app), no "$".

**Impacto en números visibles.** Ninguno en precios, mediana, márgenes ni semáforo. Cambia la etiqueta de confiabilidad de algunos datos de "sólido" a "flojo", en pantalla y en la columna del CSV.

**Valor 4 · Confianza 4 · Riesgo 1.**

## B. Búsqueda ampliada cuando no hay precios (commits `217a8a0` y `cbff931`)

**Qué resuelve.** Un nombre de catálogo con medida ("Termo Stanley Classic 1 litro") suele no coincidir con ningún producto con ofertas, y la fila del Lote quedaba "Sin dato de mercado".

**Cambios.**
- `src/lib/mlu/broaden.ts`, `broadenQuery(nombre)`: devuelve una versión más corta o `null`. Primero saca medidas y cantidades (1 litro, 5 lts, 500ml, 2 kg, x12, 128gb, 6.5", 24 piezas); si no había, saca palabras genéricas del final (Bluetooth, inalámbrico, colores, inox, LED). Nunca deja menos de dos palabras, no toca códigos de modelo (F9-5, A54, 5G, M170) y acorta de a un paso.
- **Radar:** si no hay precios y existe una versión corta, aparece el botón "Probar con «…»". No se ejecuta solo; al tocarlo, el cuadro de búsqueda muestra el nombre que se buscó.
- **Lote:** opción "Ampliar la búsqueda si no hay precios", apagada por defecto. Encendida, hace como máximo una consulta extra por fila sin precios, con la misma espera ante el límite por minuto y el mismo freno ante el diario. La fila queda marcada "Búsqueda ampliada: «…»", su confiabilidad es como mucho "Dato flojo" con el motivo "se buscó «…» porque el nombre completo no tenía resultados", y el CSV suma al final la columna "Búsqueda ampliada".
- Los productos relacionados siguen sin usarse como precio: la consulta ampliada pasa por el mismo `/api/search-mlu`, que exige que las ofertas coincidan con todas las palabras del nombre corto.

**Evidencia.** Tests de lógica en `scripts/verify_search.ts` (23 nombres, más las reglas de marcado) y `scripts/verify_tabs.ts` (columna del CSV). Prueba en navegador con Mercado Libre simulado, `scripts/e2e_search.mjs`: 22/22, incluida la opción apagada (sigue "sin dato", una consulta por fila), encendida (marcada, flojo, columna en el CSV, una sola consulta extra) y 1280 / 390 px sin desborde horizontal.

**Qué puede salir mal.**
- Ampliar puede traer precios de otra variante (el termo de 1,4 l en vez del de 1 l). Por eso es opcional, queda marcado y nunca cuenta como sólido. El margen y el semáforo de esa fila sí se calculan con ese precio: hay que leerlos junto con la marca.
- Gasta cuota: hasta una consulta más por fila sin precios.
- La lista de unidades y de palabras genéricas es corta y hecha a mano; nombres con otras formas ("pack de 6", "talle M") no se acortan.
- No se probó contra Mercado Libre real: no sé cuántas filas rescata en un catálogo de verdad.

**Impacto en números visibles.** Ninguno para las filas que hoy tienen precio (el test de navegador lo comprueba con una fila de control). Con la opción apagada, nada cambia. Con la opción encendida, filas que estaban "Sin dato de mercado" pasan a tener precio, margen y semáforo.

**Valor 5 · Confianza 3 · Riesgo 2** (riesgo 3 si se enciende sin mirar la marca).

## Qué revisar primero (ronda 10)

1. Probar el Lote con la opción encendida sobre un catálogo real y contar cuántas filas rescata y cuántas traen una variante equivocada.
2. Ver si el umbral de 4 veces marca como "flojo" búsquedas que vos considerás buenas.
3. Decidir si el corte del Radar para marcar tarjetas (3 veces) tiene que seguir al del indicador con pocas muestras (2 veces).

---

# Ronda 11: buscar por foto

Rama `ronda-11-por-foto`, desde `main` (`26507b6`). Pestaña nueva "Por foto" junto a Radar MLU, Por enlace y Lote CSV: se sube una foto, la IA propone un nombre, el usuario lo revisa y recién entonces se busca con el Radar de siempre. No toca el motor financiero ni cambia ningún número existente.

## Qué se reutilizó

**Del asesor de IA (`/api/chat` en `server/app.ts`):**

- El mismo cliente (`@google/genai`, `GoogleGenAI` con la misma configuración) y la misma clave `GEMINI_API_KEY`, leída solo en el servidor.
- Los mismos dos modelos y en el mismo orden (`gemini-3.8-flash`, después `gemini-3.5-flash-lite`), con el mismo patrón de "si uno falla, se prueba el siguiente".
- El mismo control de acceso: la ruta cuelga de `/api`, así que pasa por `createAuthMiddleware` (token de Supabase + `ALLOWED_EMAILS`) sin código nuevo.
- El mismo limitador (`createRateLimiter` + RPC `uymargin_rate_hit`, con el contador en memoria de respaldo). Solo se agregó una regla: `RATE_RULES.photo`. El RPC recibe el nombre del contador como texto, así que no hizo falta ninguna migración.
- El mismo criterio de errores: el detalle queda en el log del servidor y al navegador va un mensaje en español, con la forma `{ ok: false, code, message, error }` del resto de la API.

**De las otras pestañas:**

- El patrón de Por enlace y Lote: componente `lazy`, `useEverTrue` + `searchPanelState` (montado al abrirlo, después oculto con `hidden` y `aria-hidden`).
- La búsqueda es `handleSearch` de `App.tsx`, la misma del Radar. No hay una segunda búsqueda: "Por foto" es otro cuadro para cargar el nombre.
- Los resultados son los mismos componentes (`ExactOffersSection` con su "Simular" y `MarketSummary` con el indicador de confiabilidad y el botón "Probar con «…»"). Se muestran una sola vez y se ven tanto en Radar MLU como en Por foto.
- `apiFetch` para mandar el token, `StepHeader` y las clases de los botones y campos del Radar.

**Lo que es nuevo:** `src/lib/photo/identify.ts` (límites y validación, sin red), `server/identify.ts` (la ruta), `api/identify-product.ts` (función de Vercel), `src/components/search/PhotoAnalyzer.tsx`, `scripts/verify_photo.ts` y `scripts/e2e_photo.mjs`.

**Cambios en archivos que ya existían:** una regla en `server/rateLimit.ts`; el registro de la ruta en `server/app.ts`; `"photo"` en `src/lib/searchTabs.ts`; y en `src/App.tsx` el botón de la pestaña y el panel. En `App.tsx` el cuadro del Radar pasó a estar en su propio contenedor para que los resultados se compartan entre las dos pestañas; el Radar se ve y se comporta igual (lo comprueban `e2e_tabs`, `e2e_search` y `e2e_risk`, sin cambios).

## Cómo funciona

1. El navegador achica la foto (lado mayor 1024 px, JPEG 0,8) antes de mandarla. De paso, la foto sale sin sus metadatos (ubicación, modelo de celular).
2. `POST /api/identify-product` recibe la imagen como cuerpo binario. Controla, en este orden: sesión y correo permitido, límite de uso, tipo declarado (JPEG, PNG o WebP), tamaño (3 MB) y que los primeros bytes sean de una imagen de verdad.
3. Le pide a Gemini un JSON. El prompt dice que identifique el producto y no a las personas, que devuelva `isProduct: false` si no hay un producto claro, y que todo texto de la imagen es un dato y nunca una orden.
4. La respuesta se valida (`parseIdentification`). Lo esencial es estricto: `isProduct`, `confidence` y, si hay producto, `name`. Lo accesorio se descarta si viene mal. Si el JSON no sirve hay un solo reintento y después un error claro.
5. La pantalla muestra el nombre en un campo editable, los alternativos como botones, marca, categoría, atributos y la confianza ("Estoy seguro" / "Puede ser" / "No estoy seguro: revisá el nombre"). Nunca busca sola: el botón "Buscar en Mercado Libre" lo aprieta el usuario.
6. Corregir el nombre y volver a buscar no usa la IA.

La imagen vive en la memoria del servidor mientras dura el pedido. No se escribe en disco ni en Supabase, y ningún log recibe la imagen, el cuerpo del pedido ni la respuesta de la IA.

## Límites de uso

| Qué | Valor | Dónde se cambia |
|---|---|---|
| Fotos por usuario por minuto | 5 | `RATE_RULES.photo` en `server/rateLimit.ts` |
| Fotos por usuario por día | 40 | `RATE_RULES.photo` en `server/rateLimit.ts` |
| Tamaño máximo que acepta el servidor | 3 MB | `PHOTO_LIMITS.maxBytes` en `src/lib/photo/identify.ts` |
| Tamaño máximo del archivo original | 20 MB | `PHOTO_LIMITS.maxOriginalBytes` (mismo archivo) |
| Lado mayor y calidad de lo que se envía | 1024 px, JPEG 0,8 | `PHOTO_LIMITS.maxSide` y `jpegQuality` (mismo archivo) |
| Espera máxima por llamada a la IA | 25 s | `IDENTIFY_TIMEOUT_MS` en `server/identify.ts` |

El contador de fotos es propio (`foto`): no gasta el de las búsquedas de Mercado Libre (`mercado`) ni el del copiloto (`chat`). La búsqueda que se hace después sí cuenta como una búsqueda normal.

## Evidencia

- `scripts/verify_photo.ts`: 94 casos. Parseo de la respuesta (JSON válido, con texto o bloque ``` alrededor, campos faltantes, tipos incorrectos, campos de más), tipo, tamaño y bytes de la imagen, límite de uso por minuto y por día, y el endpoint completo con la IA simulada. Mientras corre el endpoint se capturan `console.*` y las escrituras a disco: ningún log ni respuesta contiene la imagen, y no se escribe ningún archivo.
- `scripts/e2e_photo.mjs`: 61 casos en Chrome, con `/api/identify-product` y `/api/search-mlu` simulados. Subir, achicar (1600×1200 pasa a 1024×768), cancelar, nombre editable, alternativos, buscar, búsqueda ampliada, confiabilidad, estado conservado al cambiar de pestaña, `isProduct: false`, errores del proveedor, 413, 429, archivo de 21 MB, archivo que no es imagen, 1280 y 390 px sin desborde, sin errores de consola.
- Contra el servidor local, sin simular: un GIF devuelve 415 y un archivo que dice ser JPEG y no lo es devuelve 400. Ninguno de los dos llega a la IA.

## Lo que NO se probó

- **Ninguna llamada real a Gemini.** No sé si identifica bien, cuánto tarda, ni si los dos modelos aceptan la imagen y el pedido de JSON tal como se arma. Lo primero que hay que hacer es probar con una foto real.
- **La subida binaria en Vercel.** En local funciona. En Vercel el cuerpo pasa antes por la capa de la plataforma; los `POST` con JSON de hoy funcionan, pero este es el primer endpoint que recibe una imagen. Hay que probarlo en la vista previa.
- **`vercel.json` no se tocó**, así que la función nueva no tiene `maxDuration` propio y usa el valor por defecto de la plataforma. Las otras funciones tienen 60 s fijados. Si hiciera falta, es una línea, pero la regla es avisarte antes.

## Qué puede salir mal

- **Identificación equivocada.** Con productos genéricos o sin marca visible la IA puede proponer otra cosa, o inventar una marca aunque el prompt le pide que no. Mitigación: el nombre siempre se revisa a mano, la confianza se muestra, y la búsqueda del Radar ya exige que coincidan todas las palabras. Un nombre equivocado da resultados de otro producto con un indicador que puede decir "Dato sólido": el indicador mide los precios, no si el producto es el correcto.
- **Fotos con personas.** El prompt pide ignorarlas y la app no guarda la foto, pero la imagen igual viaja a Gemini (Google). La pantalla lo dice. Conviene confirmar las condiciones de uso de datos del plan de la clave: en los planes gratuitos Google suele reservarse el uso del contenido para mejorar sus productos.
- **Texto en la imagen que intenta dar órdenes.** El prompt lo trata como dato. Aunque el modelo obedeciera, la respuesta solo puede salir como los campos del contrato, acotados en largo, y se muestra como texto. Lo peor que puede pasar es un nombre raro en el campo, que el usuario ve antes de buscar.
- **Cuota de Gemini.** Cada foto es una llamada, y en el peor caso hasta cuatro (dos modelos por dos intentos). Comparte la clave con el copiloto. Los topes son por usuario, no globales: con N usuarios permitidos el máximo diario es N × 40 fotos. No verifiqué la cuota del plan de la clave.
- **Cancelar no devuelve el uso.** "Cancelar" corta la espera en el navegador, pero el servidor ya contó el uso y la llamada a la IA sigue su curso.
- **Los pedidos rechazados también cuentan.** El límite de uso va antes de leer la imagen, así que un archivo de tipo incorrecto que llegue al servidor gasta un uso del minuto. La pantalla frena esos archivos antes de mandarlos.
- **Límites de Vercel Hobby.** Cuerpo de hasta 4,5 MB: el tope de 3 MB queda por debajo y la foto achicada pesa mucho menos. La función nueva es la séptima del proyecto, sobre un máximo de doce.
- **Fotos HEIC.** El selector pide JPEG, PNG o WebP y los celulares suelen convertir solos. Si llega un HEIC igual, se rechaza con el mensaje de tipo no admitido.

**Impacto en números existentes.** Ninguno. No se tocó `src/lib/finance` ni la búsqueda; la regresión del motor (108 casos con huella) y las siete tandas de tests que ya había pasan igual (489 casos; la de pestañas sumó uno sola, porque recorre la lista de pestañas y ahora hay cuatro).

**Valor 4 · Confianza 3 · Riesgo 2.** La confianza es 3 y no más porque todo lo probado es con la IA simulada.

## Etapas futuras (sin implementar)

2. **Lista de páginas web que venden algo parecido**, con Google Cloud Vision Web Detection. Dato que trajiste y que no verifiqué: los primeros 1.000 usos por mes son gratis y después cuesta US$ 3,50 cada 1.000, según la página de precios de Google. Falta confirmar si exige tener facturación activada aunque no se pase del tramo gratis. Necesitaría otra clave en el servidor y su propio límite de uso.
3. **Extracción de precios de esas páginas**, marcados como orientativos: no son comparables con los de Mercado Libre (otra moneda, otro país, sin envío ni impuestos) y no deberían entrar en la mediana ni en el precio sugerido.

## Qué revisar primero (ronda 11)

1. Probar con una foto real en local o en la vista previa: que Gemini responda y que el nombre sirva.
2. Confirmar en la vista previa de Vercel que la subida de la imagen llega bien.
3. Decidir si 5 por minuto y 40 por día son los topes que querés.
4. Decidir si la función nueva lleva `maxDuration` en `vercel.json` como las demás.

---

# Ronda 12: en la web (Uruguay)

Rama `ronda-12-web-uruguay`, desde `ronda-11-por-foto` (`858d39b`; el PR #10 seguía abierto). Dentro de la pestaña "Por foto", una vez identificado el producto, hay dos vistas: "Mercado Libre" (lo de la ronda 11) y "En la web (Uruguay)", que muestra qué sitios web venden el producto según una búsqueda de Google hecha por Gemini. No toca el motor financiero, ni la búsqueda de Mercado Libre, ni ningún número existente. **No muestra precios.**

## Etapa 0: qué confirmé en la documentación y qué no

Leí la documentación oficial vigente el 9/10/2026 (`ai.google.dev/gemini-api/docs/google-search`, `/pricing`, `/structured-output`, `/tool-combination`, `/interactions-overview` y la referencia `ai.google.dev/api/generate-content`) y los tipos del SDK instalado (`@google/genai` 2.27.0).

**Confirmado:**

- **Hay dos APIs.** La documentación actual muestra la búsqueda con la API de Interactions (`client.interactions.create`, `tools: [{ type: "google_search" }]`), que es la recomendada para proyectos nuevos desde junio de 2026. `generateContent` figura como "legacy" pero "fully supported". La app (copiloto e identificación por foto) usa `generateContent`.
- **En `generateContent` la herramienta es `tools: [{ googleSearch: {} }]`.** Está en los tipos del SDK instalado (`Tool.googleSearch`).
- **Forma de `groundingMetadata`** (referencia de `generateContent` y tipos del SDK): `groundingChunks[]` con `web.uri` y `web.title`; `groundingSupports[]` con `segment` (`startIndex` y `endIndex` en bytes) y `groundingChunkIndices`; `webSearchQueries[]`; `searchEntryPoint` con `renderedContent` (HTML). El campo `web.domain` existe en el SDK pero "is not supported in Gemini API".
- **Modelos.** Los dos que usa la app (`gemini-3.8-flash` y `gemini-3.5-flash-lite`) figuran como compatibles con la búsqueda.
- **Precio.** En Gemini 3 y posteriores, plan gratuito: "Not available". Plan pago: 5.000 búsquedas gratis por mes, compartidas entre todos los modelos Gemini 3 y posteriores, y después US$ 14 cada 1.000. Se cobra **por cada búsqueda que ejecuta el modelo**, no por pedido: una sola consulta nuestra puede ser varias búsquedas.
- **JSON estructurado junto con la búsqueda.** Documentado solo para la API de Interactions (`response_format`), en vista previa y para modelos Gemini 3.
- **Interactions guarda por defecto.** `store=true` salvo que se pida lo contrario; retención de 55 días en el plan pago y 1 día en el gratuito.

**Confirmado con una prueba real** (dos llamadas con la clave local, que no tiene facturación):

- Con la herramienta de búsqueda, Gemini responde **HTTP 429 `RESOURCE_EXHAUSTED`** con el mensaje "You exceeded your current quota, please check your plan and billing details". El mismo modelo, sin la herramienta y con la misma clave, respondió bien. O sea: así se ve hoy "la búsqueda no está disponible para esta clave". El código lo reconoce y muestra "La búsqueda web necesita activar la facturación de la clave de Gemini."; el mensaje exacto quedó como caso de test.

**No pude confirmar:**

- **La forma real de una respuesta con resultados.** La clave local no tiene facturación, así que nunca vi `groundingChunks` de verdad. En particular no confirmé: si `web.uri` viene como enlace de redirección (`vertexaisearch.cloud.google.com/grounding-api-redirect/…`) o directo; si `web.title` trae el dominio (el ejemplo de la documentación de Interactions muestra dominios, como "aljazeera.com") o el título de la página; y si esos enlaces vencen. El código funciona en los dos casos: un enlace directo se valida y se usa sin pedir nada; uno de redirección se resuelve.
- **Si `responseMimeType: "application/json"` se puede combinar con `googleSearch` en `generateContent`.** No está documentado, así que no se usa: el JSON se pide en el prompt y se lee aunque venga con texto alrededor.
- **Si un 429 por cuota agotada de verdad (con facturación activa) trae el mismo mensaje.** Es probable. En ese caso la app diría "necesita activar la facturación" cuando en realidad se acabó la cuota.
- **Las condiciones de uso sobre mostrar las "sugerencias de búsqueda".** La documentación remite a los Términos del Servicio. La app muestra las búsquedas que hizo Google como enlaces, pero no el HTML de `searchEntryPoint`. Hay que leer los términos antes de usar esto con público.

**Decisión:** se usa `generateContent`, como el resto de la app, sin `responseMimeType`. La IA está inyectada (`WebSearchModel`), así que pasar a Interactions más adelante es cambiar una función. Si se hace, hay que mandar `store: false`.

## Cómo funciona

1. `POST /api/web-sellers` con `{ query }` (2 a 120 caracteres). Mismo control de acceso que el resto.
2. Si la consulta está en la memoria del servidor (30 minutos), se responde desde ahí, sin gastar un uso ni una búsqueda.
3. Límite de uso propio y después una sola llamada a Gemini con la búsqueda de Google. Sin reintentos: cada llamada cuesta búsquedas.
4. Cada fuente real (`groundingChunks`) se resuelve. El servidor solo le hace pedidos al host de redirección de Google, con `redirect: "manual"`: lee a dónde apunta y nunca visita el destino. El destino se valida (https, dominio público, sin IP, sin usuario, sin puerto raro).
5. Lo que nombró la IA se cruza con las fuentes por dominio. **Un sitio que la IA nombra y no está en las fuentes se descarta.** Un resultado por dominio, hasta 10.
6. Clasificación por dominio, en una función pura:
   - `.uy` (incluye `mercadolibre.com.uy`) con el enlace verificado: **confirmado**.
   - AliExpress, Temu, Amazon, Shein, eBay, Alibaba y similares: **internacional**, sin confirmar, digan lo que digan.
   - Dominios que llevan adentro la terminación de otro (`mercadolibre.com.uy.evil.com`): **no confirmado**.
   - El resto: **probable** si la fuente dice que vende en Uruguay; si no, **no confirmado**. Nunca "confirmado".
7. La pantalla muestra confirmados y probables en la lista principal; internacionales y sin confirmar en un bloque cerrado.

Los botones "Buscar en Google Uruguay" y "Google Shopping Uruguay" son enlaces armados en el navegador: no usan la IA, no cuestan nada y funcionan aunque la búsqueda web falle.

## Límites de uso

| Qué | Valor | Dónde se cambia |
|---|---|---|
| Búsquedas web por usuario | 5 por minuto, 20 por día | `RATE_RULES.web` en `server/rateLimit.ts` |
| Memoria de respuestas | 30 minutos, 100 consultas | `WEB_CACHE` en `server/webSellers.ts` |
| Resultados, fuentes y largo de la consulta | 10, 20 y 2 a 120 | `WEB_LIMITS` en `src/lib/web/sellers.ts` |
| Resolución de enlaces | 3 s por pedido, 3 saltos | `REDIRECT_LIMITS` en `server/webSellers.ts` |
| Espera por llamada a la IA | 25 s | `WEB_SEARCH_TIMEOUT_MS` en `server/webSellers.ts` |

## Evidencia

- `scripts/verify_web.ts`: 219 casos, con la IA y la red simuladas. Consulta, clasificación de dominios (incluye `.uy`, subdominios, tiendas globales y dominios falsos), cruce con las fuentes, un resultado por dominio, tope de 10, resolución de enlaces con defensa contra SSRF, límite de uso, memoria, error de herramienta no disponible, y que los logs no llevan la consulta, los sitios ni el texto de las páginas.
- `scripts/e2e_web.mjs`: 57 casos en Chrome con `/api/web-sellers` simulado. Botón explícito, estados, enlaces con `target` y `rel`, bloque cerrado, mensaje de facturación, botones de Google, teclado, estado conservado, 1280 y 390 px sin desborde, sin errores de consola.
- Los cuatro tests de navegador anteriores pasan sin cambios.

## Qué puede salir mal

- **Resultados irrelevantes o de un producto parecido.** La búsqueda devuelve páginas, no certezas. La pantalla lo avisa y cada tarjeta dice si parece el mismo producto, uno parecido o una coincidencia dudosa, pero eso lo dice la IA.
- **Alucinaciones.** Un sitio inventado no pasa, porque tiene que estar en las fuentes. Lo que sí puede estar inventado es el título y la frase de un sitio real: la IA puede decir que vende algo que no vende.
- **Costo.** Con facturación activa, cada consulta nuestra son una o más búsquedas de Google pagas. Los topes son por usuario: con N usuarios permitidos, el máximo diario es N × 20 consultas, y no sé cuántas búsquedas hace el modelo por consulta. La memoria es por instancia: en Vercel ayuda poco entre instancias distintas.
- **Redirecciones.** Si Google cambia el host de redirección, los enlaces dejan de resolverse y los resultados salen sin enlace y sin pasar de "probable". Se arregla agregando el host a `GOOGLE_REDIRECT_HOSTS`. Resolver hasta 20 enlaces suma tiempo a cada búsqueda.
- **Sitios que no envían a Uruguay.** "Probable" significa que la fuente lo dice, no que sea cierto. Un `.uy` tampoco garantiza que el comercio exista o tenga stock.
- **Enlaces maliciosos.** Solo se muestran enlaces https a dominios públicos, que salen de la búsqueda de Google, con `rel="noopener noreferrer"`. Eso no impide que un sitio real sea una estafa: la app no verifica reputación. Los dominios que imitan a otro quedan en el bloque cerrado, con su nombre completo a la vista.
- **Texto de las páginas que intenta dar órdenes.** El prompt lo trata como dato, y la salida solo puede ser los campos del contrato, acotados y sin precios.
- **El aviso de facturación puede ser inexacto** si en realidad se agotó la cuota (ver arriba).
- **Los resultados de Mercado Libre siguen debajo** cuando se está en la vista web: son el Radar compartido de la ronda 11. Puede confundir.

**Impacto en números existentes.** Ninguno. No se tocó `src/lib/finance` ni la búsqueda de Mercado Libre.

**Valor 4 · Confianza 2 · Riesgo 3.** La confianza es 2 porque nunca vi una respuesta real con resultados. El riesgo es 3 por el costo por búsqueda y porque la app pasa a mostrar enlaces a sitios de terceros.

## Etapa futura (sin implementar)

**Precios de esos sitios, marcados como orientativos.** Habría que visitar páginas de terceros desde el servidor, y ahí la defensa contra SSRF de esta ronda no alcanza (hoy el servidor no visita ningún destino). Los precios no serían comparables con los de Mercado Libre y no deberían entrar en la mediana ni en el precio sugerido.

## Qué revisar primero (ronda 12)

1. Activar la facturación de la clave de Gemini (o usar una que la tenga) y hacer una búsqueda real: es lo único que confirma la forma de las fuentes y de los enlaces.
2. Mirar cuántas búsquedas de Google cobra una consulta típica antes de abrirlo a más usuarios.
3. Leer los Términos del Servicio sobre las sugerencias de búsqueda.
4. Decidir si los resultados de Mercado Libre se ocultan mientras se mira la vista web.

---

# Ronda 12b: la búsqueda web pasa de Gemini a Apify

Misma rama (`ronda-12-web-uruguay`) y mismo PR (#11). **Esta nota reemplaza lo que la sección "Ronda 12" dice sobre Gemini, `groundingChunks`, la resolución de redirecciones y el aviso de facturación: ese código ya no existe.** Lo demás de la ronda 12 sigue igual: la vista, el botón explícito, los botones gratuitos de Google, el límite de uso, la memoria y la clasificación de dominios.

## Por qué

La búsqueda de Google dentro de Gemini exige facturación activada en Google, y no se va a activar. La fuente de datos pasa a ser Apify, con el actor `apify/google-search-scraper`, que devuelve los resultados orgánicos de Google con enlaces directos.

## Qué cambió

- **Proveedor.** `POST https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items`, con `countryCode: "uy"`, `languageCode: "es"`, una página, sin HTML. Espera máxima de 45 s (la función de Vercel tiene 60 s en `vercel.json`).
- **Token.** `APIFY_TOKEN`, solo en el servidor. Viaja solo en el encabezado `Authorization: Bearer`, nunca en la dirección, y no aparece en logs ni en respuestas (lo comprueban los tests).
- **Consulta.** Una sola por búsqueda: `<nombre> comprar Uruguay`, **sin comillas**, con el nombre recortado a 100 caracteres. La primera versión mandaba el nombre entre comillas y eso dejaba a Google casi sin resultados: en la prueba real, "Stanley termo 1 litro" entre comillas devolvió 1 resultado (un TikTok) y sin comillas devolvió 9 tiendas uruguayas. Las comillas que traiga el nombre también se sacan, para que nunca se arme una frase exacta.
- **Sin IA en esta vista.** Título y descripción son los que da Google, recortados. Ya no hay una frase escrita por una IA ni una opinión de "mismo producto / parecido".
- **Se eliminó:** la herramienta `googleSearch`, el parseo de `groundingChunks` y el resolvedor de redirecciones de `vertexaisearch.cloud.google.com`. El servidor ahora solo habla con `api.apify.com` y **nunca visita los enlaces de los resultados**: solo los valida y los muestra.
- **Hasta 2 resultados por dominio** (antes 1), 10 en total.
- **"Otros resultados".** Wikipedia, YouTube, Facebook, Instagram, TikTok, Reddit, Pinterest, X, diarios y blogs van a un bloque aparte, cerrado, sin indicador de Uruguay. No se muestran como vendedores. La lista de dominios está en `NON_STORE_DOMAINS` (`src/lib/web/sellers.ts`); también cuenta una ruta `/blog/` o `/noticias/` dentro de una tienda.
- **Uruguay "probable".** Antes lo decía la IA. Ahora un sitio que no es `.uy` queda "probable" si el título o la descripción de Google nombran a Uruguay o a Montevideo, o si la ruta tiene `/uy/`. Solo un `.uy` queda "confirmado".

## Errores

| Qué pasa | Código | Qué ve el usuario |
|---|---|---|
| Falta `APIFY_TOKEN`, o Apify lo rechaza (401) | `WEB_SEARCH_NOT_CONFIGURED` | "La búsqueda web no está configurada en el servidor…" |
| Sin crédito (402, o un error de uso insuficiente) | `WEB_SEARCH_NO_CREDIT` | "Se agotó el crédito del servicio de búsqueda web" |
| Tiempo agotado, error de red o cualquier otro error de Apify | `WEB_SEARCH_UNAVAILABLE` | Aviso con botón "Reintentar" |

El aviso viejo `WEB_SEARCH_NEEDS_BILLING` ya no existe.

**Advertencia: si se agota el crédito de Apify, la vista muestra el aviso y los botones gratuitos "Buscar en Google Uruguay" y "Google Shopping Uruguay" siguen andando**, porque son enlaces armados en el navegador que no pasan por el servidor. Lo mismo vale para los otros dos errores.

## Costo

Estimado: **≈ US$ 0,0045 por búsqueda** (una consulta, una página). La página del actor lo publica como "from $1.80 / 1,000 scraped search result pages" con cobro por evento; el número por búsqueda es el que se usó para decidir y hay que contrastarlo con el consumo real en el panel de Apify después de las primeras búsquedas.

Con el tope de 20 búsquedas por día por usuario, el máximo es de unos US$ 0,09 por usuario por día. La memoria de 30 minutos evita pagar dos veces la misma consulta, pero es por instancia: en Vercel ayuda poco entre instancias distintas. No hay reintentos automáticos: "Reintentar" lo aprieta el usuario y cada intento es otra búsqueda paga y otro uso del límite.

## Lo que NO se probó

- **Una búsqueda de punta a punta desde la app.** El formato de respuesta de Apify **quedó verificado contra una respuesta real**: la búsqueda "Stanley termo 1 litro comprar Uruguay" (país `uy`, idioma `es`), hecha a mano con el actor, devolvió 9 resultados orgánicos con la forma esperada (`organicResults[]` con `title`, `url`, `displayedUrl`, `description`). Esos 9 resultados son ahora el fixture (`scripts/fixtures/apify_google_search.json`): las direcciones y su orden son los reales; los títulos y las descripciones están abreviados y escritos a mano. Con ese fixture salen 9 resultados, todos de tipo tienda y con Uruguay confirmado, y Bagual (dos productos) respeta el máximo por dominio. Lo que falta es ver la misma búsqueda hecha desde la vista previa, con el token de Vercel.
- **Los códigos de error reales de Apify.** El 401 y el 402 están en su documentación. Qué tipo de error devuelve exactamente una cuenta sin crédito en este endpoint no está documentado; se reconocen el 402 y varios tipos (`not-enough-usage-to-run-paid-actor`, `monthly-usage-limit-too-low`, `limit-reached`, entre otros). Si llegara con otro tipo, se vería como "no respondió" con "Reintentar".
- **Cuánto tarda.** Si una búsqueda tarda más de 45 s, se corta. No sé cuánto tarda de verdad con `countryCode: "uy"`.
- **La calidad con otros productos.** Sin comillas Google devuelve más, pero también puede traer productos parecidos o de otra marca. Solo se probó con un termo Stanley.

## Evidencia

- `scripts/verify_web.ts`: 281 casos con `fetch` simulado. Parser con el fixture real y con casos rotos armados a mano, consulta sin comillas, clasificación de dominios y parecidos, sitios que no son tiendas, cada código de error, que la dirección de la llamada no lleva el token y que el token no aparece en logs ni en respuestas.
- `scripts/e2e_web.mjs`: 61 casos en Chrome con `/api/web-sellers` simulado, incluidos los tres avisos, "Reintentar", el bloque "Otros resultados" y que los botones de Google siguen en cada error.

## Qué puede salir mal (además de lo anterior)

- **Las descripciones de Google pueden traer precios.** Se muestran tal cual, sin tocar, y pueden estar desactualizados. La vista aclara que hay que confirmar precio y stock en la tienda. No entran en ningún cálculo.
- **Una tienda puede caer en "Otros resultados"** si su dominio empieza con `blog.` o la página está en `/blog/`, y un sitio que no vende puede quedar como tienda si no está en la lista.
- **Términos de uso.** Apify obtiene los resultados leyendo páginas de Google. Conviene revisar que ese uso sea aceptable para el proyecto.
- **Se sigue necesitando `GEMINI_API_KEY`** para identificar la foto. Lo único que dejó de depender de Gemini es la vista web.

**Valor 4 · Confianza 3 · Riesgo 2.** La confianza sube a 3 porque el formato ya se vio en una respuesta real; no pasa de ahí porque falta la búsqueda de punta a punta desde la app.

## Qué revisar primero (ronda 12b)

1. Hacer una búsqueda desde la vista previa y mirar que aparezcan las tiendas.
2. Mirar en el panel de Apify cuánto costó esa búsqueda y cuánto tardó.
3. Probar con dos o tres productos distintos, sobre todo genéricos, para ver cuánto ruido trae la consulta sin comillas.

---

# Ronda 13: búsqueda visual en «Por foto» (Google Lens)

Rama `ronda-13-busqueda-visual`, creada desde la punta de `ronda-12-web-uruguay` porque reutiliza su código y el PR #11 todavía no está en `main`.

## Por qué

Hasta la ronda 12 la foto solo servía para que la IA propusiera un nombre. Lo que hace falta es subir la foto y ver dónde se vende ese producto en Uruguay y a qué precio. Ahora el paso principal es una búsqueda visual inversa (Google Lens) y la IA queda como plan B.

## Cómo funciona

1. La foto se achica en el navegador igual que antes (1024 px, JPEG) y se manda a `POST /api/visual-search`.
2. El servidor valida tipo, tamaño (3 MB) y firma de bytes, y llama al actor de Apify `johnvc/google-lens-api` con `search_type: "visual_matches"`, 50 resultados, país `uy`, idioma `es`. Una sola llamada, 55 s de espera máxima (eran 45 s; ver "Lo que se vio con fotos reales"), sin reintentos. El token (`APIFY_TOKEN`, el mismo de la ronda 12) va solo en `Authorization: Bearer`.
3. Cada resultado se valida (`safeHttpsUrl`), no se repite una dirección y quedan como mucho 2 por dominio. Después se agrupa:
   - **Mercado Libre Uruguay** (`mercadolibre.com.uy`): bloque propio. Muestra 2 y dice cuántas publicaciones encontró en total.
   - **Tiendas de Uruguay**: los `.uy` ("confirmado") y las tiendas `.com` cuyo precio viene en pesos uruguayos o cuyo resultado nombra a Uruguay ("probable"). Primero las que traen precio.
   - **Otros países o sin confirmar**: `.ar`, `.br`, `.cl`, `.py`, `.ve`, `.mx` y demás países, tiendas globales, y las `.com` sin ninguna señal de Uruguay. Plegado.
   - **Otros resultados**: redes sociales, comparadores (Idealo y similares), sitios del Estado, blogs, diarios y dominios que imitan a otro. Plegado y sin precio.
4. **Precio.** Uruguay publica en pesos y en dólares, y se reconocen las dos monedas: dólares (`USD`, `US$`, `U$S`, `U$D`, o escrito junto al número, como "US$ 75") y pesos uruguayos (`UYU`, `$U`, `UYU$`). Un `$` suelto se toma como pesos uruguayos solo si el sitio es `.uy` (incluye Mercado Libre Uruguay); en cualquier otro dominio es ambiguo y no se muestra. Monedas vacías o raras (`.`) se descartan. Se muestra "$ 3.722" o "US$ 75", cada precio en la moneda en que vino, sin convertir, con el rótulo "precio informado por Google, confirmar en la tienda". No entra en ningún cálculo. Un precio en dólares no cuenta como señal de Uruguay; el precio en pesos uruguayos, "Uruguay", "Montevideo" y "envíos a todo el país" sí.
5. **Nombre sugerido.** Sale del título más repetido entre las publicaciones de Mercado Libre Uruguay (se miran todas, no solo las 2 que se muestran), sin "| MercadoLibre", "Cuotas sin interés", "Envío gratis" ni emojis. Si ninguno se repite, gana el que más palabras comparte con los demás. Si no hay publicaciones de Mercado Libre, sale de las tiendas de Uruguay. Queda en el campo editable.
6. **«Analizar en Radar»** busca ese nombre con el Radar de siempre: los precios reales salen de ahí. La vista «En la web (Uruguay)» de la ronda 12 sigue disponible con ese mismo nombre.
7. **Nombre automático con IA.** Si la búsqueda termina con menos de 3 resultados de Uruguay (incluso con 0), la pantalla llama sola a `/api/identify-product` (Gemini, ronda 11, gratis) con la misma foto y precarga el nombre. No gasta otra búsqueda visual. La pantalla aclara "Nombre sugerido por IA a partir de la foto". Si ya habías escrito un nombre, no se pisa.
8. **«Identificar nombre con IA (gratis)»**, el botón manual, queda para cuando la búsqueda visual falla por otro motivo (tiempo, crédito, servicio caído) o cuando la IA automática falló.
9. **«Google Lens lo reconoce como: …»** Si hay resultados de otros países pero ninguno de Uruguay, debajo de los grupos se muestra el título limpio más repetido entre las tiendas de cualquier país. Es solo informativo: no se busca nada con ese texto.

## Privacidad

- La pestaña muestra siempre: "La foto se envía a un servicio externo de búsqueda visual (Apify / Google Lens). UyMargin no la guarda." Antes la foto solo iba a Gemini; ahora va a Apify y, si se pide la IA, también a Gemini.
- La foto no se escribe en disco ni en Supabase y no aparece en ningún log. Del pedido solo queda en memoria un SHA-256 de los bytes, que es la clave de la memoria de respuestas.
- El servidor nunca visita los enlaces de los resultados.
- **Miniaturas.** El proyecto no tiene una política CSP, así que las imágenes externas no están bloqueadas y no hubo que aflojar nada. Se muestran solo las miniaturas servidas por Google (`gstatic.com`, `googleusercontent.com`, `ggpht.com`), con `referrerPolicy="no-referrer"` y carga diferida. Una miniatura de cualquier otro origen se omite. Mostrar una miniatura implica que el navegador de quien usa la app le pide esa imagen a Google.

## Costo y límites

- **≈ US$ 0,015 por foto** (dato de la prueba manual). Con el tope de 15 fotos por día por usuario, el máximo es ≈ US$ 0,23 por usuario por día.
- Límite de uso propio, scope `visual`: **3 por minuto y 15 por día** por usuario. No hizo falta migración: `uymargin_rate_hit` recibe el scope como texto y la tabla no lo restringe.
- Memoria de respuestas por hash de la foto: 30 minutos, 50 entradas. Repetir la misma foto no paga de nuevo ni gasta un uso. **Solo se guardan las respuestas con resultados**: ni las de 0 resultados ni los errores. Es por instancia: en Vercel no se comparte y se pierde al reiniciarse.
- El nombre automático con IA gasta un uso del límite de la identificación por foto (5 por minuto, 40 por día), que es aparte del de la búsqueda visual.
- **Si se agota el crédito de Apify**, el endpoint responde `VISUAL_SEARCH_NO_CREDIT` y la pantalla avisa "Se agotó el crédito del servicio de búsqueda visual". Siguen funcionando la identificación con IA, los botones gratuitos de Google y el Radar. La búsqueda web de la ronda 12 usa el mismo crédito, así que se corta junto con esta.

## Errores

| Código | Cuándo | Reintentar |
|---|---|---|
| `VISUAL_SEARCH_NOT_CONFIGURED` | Falta `APIFY_TOKEN` o Apify lo rechaza (401) | No |
| `VISUAL_SEARCH_NO_CREDIT` | Apify responde 402 o un error de límite de uso | No |
| `VISUAL_SEARCH_TIMEOUT` | Pasaron 55 s sin respuesta, o Apify respondió 408 o 504. Mensaje: "La búsqueda visual tardó demasiado" | Sí, a mano |
| `VISUAL_SEARCH_UNAVAILABLE` | Error de red, 5xx, respuesta con otra forma, o el dataset trae un item `{resultType, errorMessage}` (la corrida termina como SUCCEEDED pero falló). Mensaje: "La búsqueda visual no respondió en este momento" | Sí, a mano |
| `VISUAL_SEARCH_NO_MATCHES` | El dataset vino vacío o ningún enlace era seguro. Mensaje: "Google Lens no encontró coincidencias para esa foto". La IA propone el nombre sola | No |

Si Vercel corta la función antes de que responda (504 sin cuerpo JSON), la pantalla lo trata como `VISUAL_SEARCH_TIMEOUT`.

En todos se ofrece la identificación con IA, el campo para escribir el nombre y los botones de Google. El mensaje crudo del actor nunca se muestra ni se registra.

## Lo que se vio con fotos reales (prueba de Jean en la vista previa)

- **Con foto en base64 el actor tarda ≈ 40 s; para productos que no se venden en Uruguay Lens reconoce el producto pero devuelve resultados del exterior.**
- Con una URL pública el mismo actor tardaba ≈ 10 s. La app manda base64 porque la foto no se guarda en ningún lado.
- Con 45 s de espera a veces se cortaba antes de que el actor terminara, y **la corrida de Apify se cobra igual**. Por eso la espera pasó a 55 s, que es casi todo lo que dejan los 60 s de la función de Vercel. No hay otro límite menor en el camino: ni el navegador ni el servidor ponen otro tiempo máximo. El margen es de 5 s para el control de acceso, el contador de uso y la respuesta.
- Una lámpara (Artemide Nesso/Nessino) devolvió 50 resultados, todos del exterior. Una picadora devolvió 0 resultados a los 32 s.
- Mientras busca, la pantalla dice "Buscando… puede tardar hasta 1 minuto".

## Lo que NO se probó

- **Solo se probó con un producto de marca (termo Stanley)** antes de la prueba de arriba. Con productos genéricos (sin marca visible) los resultados pueden ser parecidos pero no idénticos, y el nombre sugerido puede ser el de otro producto. Por eso el nombre queda editable y la pantalla lo aclara.
- **El fixture de la lámpara es una reconstrucción.** `scripts/fixtures/apify_google_lens_lampara.json` tiene los ocho sitios de la respuesta real (Walmart, Amazon.com, Amazon.es, Etsy, 1stDibs, VNTG, Instagram, Temu) y el precio de Walmart, pero los títulos, las direcciones y la moneda de Walmart (`$`) están escritos a mano. Con moneda `$` el precio no se muestra; si el actor informa `US$` o `USD`, sí.
- **Yo no llamé a Apify.** El formato de entrada y de salida sale de la prueba manual de Jean. El fixture (`scripts/fixtures/apify_google_lens.json`) es una muestra recortada de esa respuesta real: 10 de 35 resultados, solo con `title`, `source`, `url`, `price` y `currency`.
- **El campo `thumbnail` no está en la muestra.** No sé qué dominio usa el actor. Si no es uno de Google, las miniaturas no se van a ver (y no se rompe nada).
- **La búsqueda de punta a punta desde la vista previa**, con el token de Vercel: cuánto tarda y cuánto cuesta de verdad.
- **Qué devuelve Apify exactamente cuando no hay crédito** con este actor. Se asumió lo mismo que en la ronda 12 (402 o un tipo de error de límite de uso).

## Evidencia

- `scripts/verify_visual.ts`: 318 casos con `fetch` simulado. Incluye la espera de 55 s, los tres mensajes (tiempo agotado, servicio caído, 0 resultados), que el 0 resultados y los errores no se guardan en la memoria, cuándo corre sola la IA y el texto "lo reconoce como" con la muestra de la lámpara. Parser y clasificación con la muestra real, item de error, moneda inválida, enlaces inseguros, dominios imitadores, duplicados y límite por dominio, nombre sugerido, memoria por hash, cada código de error, y que ni el token ni la imagen (ni su hash) aparecen en logs o respuestas.
- `scripts/e2e_visual.mjs`: 100 casos en Chrome con la API simulada, incluidos el nombre automático con IA, el renglón "Google Lens lo reconoce como", el aviso de privacidad, los cuatro grupos, los precios, las miniaturas, «Analizar en Radar», el botón de la IA y cada error.
- `scripts/e2e_photo.mjs` (62) y `scripts/e2e_web.mjs` (61) se adaptaron al flujo nuevo: ahí la búsqueda visual siempre falla y el nombre sale de la IA.

## Qué puede salir mal

- **Una tienda uruguaya con dominio `.com` y sin precio** queda en "Otros países o sin confirmar" (en la muestra le pasa a Yerbas Calzada, por la moneda inválida). Está plegado, no oculto.
- **Un precio con la moneda mal informada.** Si Google informa `UYU` para un precio que no lo es, o un `.uy` publica en dólares con un `$` suelto, se mostraría mal (en ese segundo caso, como pesos). Por eso el rótulo pide confirmar en la tienda.
- **"Envíos a todo el país" no dice qué país.** Una tienda `.com` de otro lado que lo diga entra como "probable". Las de dominio de otro país (`.ar`, `.cl`…) no entran nunca.
- **"El título más repetido" rara vez se repite tal cual.** En la práctica gana el más representativo, que puede ser demasiado genérico o demasiado largo para el Radar. Se corrige a mano.
- **Términos de uso.** Igual que en la ronda 12b: Apify obtiene los resultados leyendo Google.

- **El margen de tiempo es chico.** Si el actor tarda más de 55 s se pierde lo pagado. Mandar la foto por URL pública bajaría la espera a ≈ 10 s, pero obliga a guardar la foto en algún lado: es una decisión de privacidad, no está hecha.
- **"Lo reconoce como" puede ser largo o impreciso.** Es un título entero de una tienda, no un nombre corto.

**Valor 5 · Confianza 3 · Riesgo 3.** El riesgo sube porque la foto ahora sale a un tercero más y cada uso cuesta más que una búsqueda web.

## Qué revisar primero (ronda 13)

1. Subir la foto del termo en la vista previa y comparar los grupos con los 35 resultados de la prueba manual.
2. Mirar si se ven las miniaturas.
3. Probar con un producto genérico y ver qué nombre propone.
4. Mirar en Apify el costo y la duración de cada corrida.
