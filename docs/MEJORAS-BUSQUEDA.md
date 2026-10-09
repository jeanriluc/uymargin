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
