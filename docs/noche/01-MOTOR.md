# 01 · Precisión del motor financiero

> Análisis de solo lectura de `src/lib/finance/` (rama `ronda-9-busqueda`, commit `c58ad22`). Las cifras de impacto salen de correr el motor real en una copia aparte, sin tocar la carpeta del repo: `npm ci`, `tsc`, `npm test` (438 comprobaciones en verde, 0 fallas) y `vite build` pasan.
> **Ojo:** la copia incluye cambios tuyos sin commitear en `BatchAuditor.tsx`, `batchCsv.ts` y `verify_tabs.ts`. No los toqué.

## Caso típico usado para medir impacto

Importador que compra a **USD 25** por unidad, dólar a **$ 40**, precio de venta **$ 2.290**, ML Clásica, envío pago por el comprador. Con los valores por defecto (literal E) el motor da **$ 992 de ganancia neta, 43,3 % de margen, semáforo Excelente**.

Reproducible con el script `probe.ts`: lo dejé fuera del repo, la lógica está resumida abajo.

## Lo que está bien (verificado)

- **Fórmula de IVA en régimen general** (`dgi-taxes.ts:42-62`): ganancia bruta menos IVA a pagar es igual a la ganancia sin IVA. La IRAE se calcula sobre esa base. Es consistente.
- **Herramientas derivadas sin fórmulas propias**: calculadora inversa (`engine.ts:252`), sensibilidad (`sensitivity.ts`) y escenarios (`scenarios.ts`) llaman todas a `analyzeChannel`. Los tests de ida y vuelta lo confirman: dólar de quiebre en 162/162 casos y escenario base idéntico en 108/108.
- **Semáforo único** en `constants.ts:14` y `engine.ts:124`. El problema de tres umbrales distintos del análisis anterior quedó resuelto.
- **IVA mínimo literal E**: el código lo deja fuera a propósito (`dgi-taxes.ts:36-38`). Es correcto como costo **fijo**, pero hoy no se muestra en ninguna parte (ver M-04).

## Hallazgos

### M-01 · El crédito de IVA de compra viene activado por defecto y no cuadra con un importador
- **Qué pasa:** `costIncludesVat: true` por defecto (`constants.ts:96`). El texto del interruptor habla de "e-factura con RUT" (`CostPanel.tsx:236`). Un importador en régimen general que carga el costo **FOB en USD** (sin IVA) recibe igual un crédito del 22/122 de ese costo, que en realidad no pagó.
  - Lo que sí paga es el IVA de importación en aduana, sobre CIF más arancel. Ese IVA también es crédito, pero no está en el costo cargado.
- **Impacto en el caso típico (régimen general):**
  - Con el valor por defecto: $ 813 de ganancia, 35,5 %.
  - Sin crédito de compra: $ 633, 27,6 %.
  - Diferencia: **−$ 180 por unidad, −7,9 puntos de margen.**
- **Evidencia:** `constants.ts:96`, `dgi-taxes.ts:47`, `CostPanel.tsx:233-238` y la corrida del motor.
- **Qué se propone:** no cambiar la fórmula. Agregar una pregunta explícita: "¿El costo que cargaste incluye IVA?", con la opción "Lo importo yo (FOB/CIF, sin IVA)". Por defecto, apagado si la moneda es USD.
  - Esto cambia números visibles en régimen general → **validar con contador** cómo modelar el IVA de importación y el anticipo.
- Valor 5 · Confianza 4 · Riesgo 3 · Esfuerzo S.
- **Qué podría estar mal en mi análisis:** quizás tus 2 usuarios compran a mayoristas locales con e-factura y nunca importan directo. En ese caso el valor por defecto es correcto y el riesgo es menor.

### M-02 · Costo de importación incompleto (literal E y general)
- **Qué pasa:** el motor recibe "costo mayorista" más un "flete de adquisición". No hay campos para arancel, tasa consular, IVA de importación (costo en literal E), anticipo de IVA, despachante ni seguro.
  - Un importador que carga solo el FOB **sobreestima el margen**.
- **Impacto:** sumar solo el IVA de importación al 22 % en literal E baja la ganancia de $ 992 a $ 772 (de 43,3 % a 33,7 %). Sin contar arancel ni despachante.
- **Evidencia:** `types.ts:177-195` (no hay campos), corrida G del motor.
- **Qué se propone:** una sección opcional "Costeo de importación" que calcule el costo puesto **antes** del motor y lo cargue como costo. Así no se toca `src/lib/finance`.
  - Las tasas (arancel por NCM, tasa consular, anticipo) **requieren contador o despachante**. No las recomiendo sin fuente.
- Valor 5 · Confianza 3 · Riesgo 4 · Esfuerzo M. Ver también V-03 en 07-VISION.md.

### M-03 · Comisión de ML "con IVA incluido": supuesto sin verificar y de alto impacto
- **Qué pasa:** el tipo de dato define la comisión como "IVA included" (`types.ts:156-159`). Valores: 13 % y 17,5 % (`constants.ts:75-78`).
  - Si ML Uruguay publica las tasas **más IVA**, en literal E el costo real sería 15,86 % y 21,35 %.
  - En régimen general el IVA de la comisión es crédito, así que el impacto ahí es casi nulo.
- **Impacto en el caso típico (literal E):** de $ 992 a $ 927, de 43,3 % a 40,5 %. **−2,8 puntos.**
- **Evidencia:** la página oficial de costos de ML Uruguay ([ayuda 870](https://www.mercadolibre.com.uy/ayuda/precios_de_tipos_de_publicaci%C3%B3n_870)) bloquea la lectura automática y no pude verificarla. El análisis previo (`docs/audit/analisis-app.md` §3.3 punto 4) ya lo marcaba como el supuesto de mayor impacto.
- **Qué se propone:** necesito que copies la tabla de tu panel de vendedor (ver datos pedidos). Después: guardar en `constants.ts` la fuente y la fecha de vigencia de cada tasa.
- Valor 5 · Confianza 2 · Riesgo 3 · Esfuerzo S (una vez tenga el dato). **Validar con contador y con tu factura de ML.**

### M-04 · IVA mínimo de literal E invisible: en ventas chicas cambia la decisión
- **Qué pasa:** la cuota mensual vigente es **$ 5.910** ([Decreto 310/025, art. 1, IMPO](https://www.impo.com.uy/bases/decretos-originales/310-2025)). Está excluida a propósito del cálculo por unidad. Es correcto no mezclarla, pero no aparece **en ningún lado**: ni en el resultado ni como punto de equilibrio.
- **Impacto en el caso típico** si toda la cuota la cubre este producto:

  | Unidades por mes | Ganancia neta | Margen |
  |---|---|---|
  | 10 | $ 401 | 17,5 % |
  | 30 | $ 795 | 34,7 % |
  | 100 | $ 933 | 40,8 % |

  Además, el aporte BPS mínimo (~$ 9.500/mes según [castillo.uy](https://castillo.uy/blog/impuestos-emprendedores-uruguay-2026/), fuente secundaria) duplicaría el efecto.
- **Qué se propone:** sección **nueva y opcional** "Costos fijos del mes", con la cuota DGI como valor sugerido, BPS, depósito y Product Ads. Debe mostrar "unidades por mes para cubrir fijos" (punto de equilibrio).
  - No cambia la ganancia por unidad ni el semáforo actual.
- Valor 4 · Confianza 4 (cuota con fuente oficial; BPS secundaria) · Riesgo 1 · Esfuerzo S.

### M-05 · Venta exenta (IVA 0 %): el saldo a favor se suma como ganancia
- **Qué pasa:** con `vatRate = 0` se sigue acreditando el IVA de comisiones y envío. `vatPayable` queda negativo y se **suma** a la ganancia.
  - En el caso típico son **+$ 54 por unidad**, que en ventas internas exentas en general no se recupera.
- **Evidencia:** `dgi-taxes.ts:48-51`, corrida H (`vatPayable = −54`). Ya figuraba en el análisis previo §3.3 punto 1 y sigue abierto.
- **Qué se propone:** **validar con contador.** No lo recomiendo como cambio sin su respuesta.
- Valor 2 (pocos productos exentos) · Confianza 4 · Riesgo 2 · Esfuerzo S.

### M-06 · IRAE: solo se modela el real al 25 %; el ficto no existe
- **Qué pasa:** `provisionIrae` aplica 25 % sobre la ganancia unitaria (`dgi-taxes.ts:54`).
  - Las empresas chicas de régimen general pueden liquidar **IRAE ficto**, con renta ficta por tramos: 12 % hasta 1.000.000 UI, 14 %, 48 % y 60 %. Ver [DGI, cambios al IRAE](https://www.gub.uy/direccion-general-impositiva/comunicacion/publicaciones/modificaciones-impuesto-renta-actividades-economicas-irae).
  - En el primer tramo eso da un IRAE cercano al 3 % de los ingresos netos de IVA, no al 25 % de la ganancia.
- **Impacto:** en el caso típico, IRAE real ≈ $ 158 por unidad contra ficto ≈ $ 56 por unidad (3 % de $ 1.877). Diferencia aproximada **$ 100 por unidad**.
- **Qué se propone:** **validar con contador** si tus usuarios están en ficto. Si lo están, agregar la opción "IRAE ficto (estimado)".
  - La página de DGI es de 2023: hay que confirmar que siga vigente.
- Valor 3 · Confianza 3 · Riesgo 3 · Esfuerzo S.

### M-07 · Pasarela Mercado Pago: el 3,99 % es solo con liberación a 14 días
- **Qué pasa:** `GATEWAYS.mercadopago` = 3,99 % más IVA (`constants.ts:44-49`).
  - Una guía uruguaya da 3,99 % a 14 días, 4,99 % a 1 día hábil y 5,99 % inmediato, todo más IVA ([Tiendli, actualizado 08/10/2026](https://tiendli.com/blog/mercadopago-uruguay-guia); fuente secundaria, sin enlace oficial).
- **Impacto:** cobrar al instante en vez de a 14 días cuesta 2 puntos más 22 % de IVA ≈ **$ 56 por unidad** en $ 2.290.
- **Qué se propone:** selector de plazo de liberación en la pasarela. Es un cambio de constantes y de interfaz, sin fórmula nueva.
  - Cambia números solo si el usuario elige otro plazo.
- Valor 3 · Confianza 3 · Riesgo 1 · Esfuerzo S. Confirmar las tasas en tu panel de Mercado Pago.

### M-08 · Packs: el "descuento" puede ser un aumento y el ahorro de cargo fijo se inventa
Dos errores reproducidos con el motor real: producto a $ 590, costo $ 300 y cargo fijo cargado en **$ 0**.

1. **El Pack x2 sale $ 1.250, más caro que dos unidades sueltas ($ 1.180)**, pero se rotula "5 % de descuento".
   - Causa: `bundles.ts:62-66` sube el precio al umbral más $ 50 si queda entre el 90 % y el 100 % del umbral.
2. **"Eliminás $U 80 de cargo fijo"** aunque el cargo fijo sea $ 0.
   - Causa: `bundles.ts:49` usa `inputs.ml.fixedFee || 40`, así que un 0 se convierte en 40. Lo mismo con el umbral (`|| 1200`).
   - El mensaje además tiene "$U 1.200" escrito fijo (`bundles.ts:97`) aunque el umbral sea otro.
- **Qué se propone:**
  - Si el salto supera el precio sin descuento, no saltar, o mostrar el descuento real (negativo).
  - Usar `??` en lugar de `||`.
  - Armar el texto con el umbral real.
  - Es un cambio en `src/lib/finance/bundles.ts`, pero no toca `analyzeChannel`. Agregar tests.
- Valor 3 · Confianza 5 · Riesgo 2 · Esfuerzo S.

### M-09 · Devoluciones: el 20 % de pérdida está fijo y no se explica
- **Qué pasa:** `engine.ts:58` calcula `price × %dev × 0,20`. La interfaz pide el % de devoluciones, pero no dice que se asume una pérdida del 20 % del precio por unidad devuelta.
  - En ML Uruguay una devolución típica implica envío de vuelta y, a veces, producto no revendible: el 20 % puede quedar corto o sobrar.
- **Qué se propone:**
  - Mostrar el supuesto en el texto de ayuda. Solo texto, sin cambio de números.
  - Más adelante, permitir editar el "costo por devolución" en $.
- Valor 2 · Confianza 4 · Riesgo 1 · Esfuerzo S.

### M-10 · ROI anualizado simple (no compuesto)
- **Qué pasa:** `engine.ts:172-175` calcula ROI × 365 / días. Es una convención válida, pero difiere del compuesto: con ROI 40 % a 45 días da 324 % simple contra ~1.400 % compuesto.
- **Qué se propone:** aclarar "simple" en el texto. **No cambiar.** El simple es más conservador y está bien para decidir.
- Valor 1 · Confianza 5 · Riesgo 1 · Esfuerzo S.

### M-11 · Falta modelar publicidad (Product Ads) y costo financiero de cuotas
- **Qué pasa:** no hay campo de publicidad. Hay guías del rubro que tratan el ACOS (gasto en anuncios sobre ventas) como parte del cálculo de margen en ML ([Base, ACOS ideal con margen del 20 %](https://base.com/es-AR/blog/?p=18396); solo vi el título, no lo leí). [Jaguar Sheet](https://jaguarsheet.com/es/blog/calculadora-rentabilidad-mercado-libre) tampoco lo incluye.
  - Tampoco hay costo de "cuotas sin interés" ofrecidas por el vendedor. `grep` de "publicidad|cuotas" en `src/` solo encuentra títulos de publicaciones.
- **Qué se propone:** campo opcional "% del precio en publicidad", que funcione como una reserva más.
  - Cambia el resultado solo si se carga un valor distinto de cero.
  - Las cuotas, solo si ML Uruguay las cobra al vendedor: dato a confirmar en tu panel.
- Valor 3 · Confianza 3 · Riesgo 2 · Esfuerzo S.

### M-12 · Capital inmovilizado
- **Qué pasa:** la rotación existe (`stockTurnoverDays`) y alimenta el ROI anualizado. No hay "plata parada" (unidades × costo) ni costo de oportunidad.
- **Qué se propone:** mostrar en el Lote "capital necesario" y "días para recuperar" cuando haya cantidad. Es una sección opcional.
- Valor 3 · Confianza 3 · Riesgo 1 · Esfuerzo S.

## Constantes sin fuente ni fecha (vigente)

Siguen sin fuente en el código: comisiones ML, cargo fijo $ 40 bajo $ 1.200, tarifas de transportistas, Mercado Pago y Handy (`constants.ts`).
- **Propuesta:** cada constante con `// fuente: URL · vigente desde: fecha`, más un test que falle si pasan más de 180 días sin revisarla.
- Valor 3 · Confianza 5 · Riesgo 1 · Esfuerzo S.

## Datos oficiales confirmados

| Dato | Valor | Fuente |
|---|---|---|
| Cuota IVA mínimo pequeña empresa 2026 | $ 5.910/mes | [Decreto 310/025 art. 1](https://www.impo.com.uy/bases/decretos-originales/310-2025) |
| Anticipos mínimos IRAE 2026 por tramo | $ 6.840 a $ 19.240 | Decreto 310/025 art. 2 |
| IRAE ficto por tramos (12/14/48/60 %) | desde ejercicio 2023 | [DGI](https://www.gub.uy/direccion-general-impositiva/comunicacion/publicaciones/modificaciones-impuesto-renta-actividades-economicas-irae) |
| Tope literal E | 305.000 UI | [RSM, 2024](https://www.rsm.global/uruguay/en/node/612) — fuente secundaria; validar |
| Dólar ≈ $ 40 (default `DEFAULT_EXCHANGE_RATE`) | razonable en 2026 | [datosuruguay](https://datosuruguay.com/dolar) — secundaria; la app usa el BCU |
