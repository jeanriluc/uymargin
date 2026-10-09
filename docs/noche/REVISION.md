# REVISIÓN — análisis de UyMargin (09/10/2026)

**Acceso al repo: SÍ.** Carpeta `uymargin---analizador-de-rentabilidad-mayorista` conectada a las 08:23, rama `ronda-9-busqueda` (`c58ad22`). Solo lectura: no se tocó código ni se hicieron commits. Lo único que se escribió es esta carpeta `docs/noche/`.

## Resumen
_(se completa al cierre)_

## Estado
| Área | Estado |
|---|---|
| 1. Motor financiero | ✅ hecho — 01-MOTOR.md |
| 2. Búsqueda de mercado | ⏳ |
| 3. Producto y UX | ⏳ |
| 4. Competencia y mercado | ⏳ |
| 5. Seguridad y robustez | ⏳ |
| 6. Calidad y mantenimiento | ⏳ |
| 7. Visión | ⏳ |

## Tabla de hallazgos
| ID | Área | Título | Qué se propone | Valor | Conf. | Riesgo | Esf. | Evidencia | Recomendación | Decisión |
|---|---|---|---|---|---|---|---|---|---|---|
| M-01 | Motor | Crédito de IVA de compra activo por defecto con costo FOB | Preguntar si el costo incluye IVA; apagado por defecto en USD | 5 | 4 | 3 | S | `constants.ts:96`, `dgi-taxes.ts:47`; −$180/u en caso típico | Hacer, con contador | [ ] Hacer [ ] Rechazar [ ] Después |
| M-02 | Motor | Costo de importación incompleto | Sección opcional de costeo antes del motor | 5 | 3 | 4 | M | `types.ts:177`; IVA import. sola −9,6 pts | Después, con contador | [ ] Hacer [ ] Rechazar [ ] Después |
| M-03 | Motor | Comisión ML con/sin IVA sin verificar | Tabla del panel → constantes con fuente | 5 | 2 | 3 | S | `types.ts:156`; −2,8 pts si es +IVA | Validar primero | [ ] Hacer [ ] Rechazar [ ] Después |
| M-04 | Motor | IVA mínimo literal E invisible | Sección opcional "Costos fijos del mes" + equilibrio | 4 | 4 | 1 | S | Decreto 310/025; margen 43→17,5 % a 10 u/mes | Hacer | [ ] Hacer [ ] Rechazar [ ] Después |
| M-05 | Motor | Venta exenta suma saldo de IVA | — | 2 | 4 | 2 | S | `dgi-taxes.ts:48`; +$54/u | Contador | [ ] Hacer [ ] Rechazar [ ] Después |
| M-06 | Motor | IRAE ficto no modelado | Opción "IRAE ficto" | 3 | 3 | 3 | S | DGI 2023; ~$100/u | Contador | [ ] Hacer [ ] Rechazar [ ] Después |
| M-07 | Motor | MP 3,99 % solo a 14 días | Selector de plazo | 3 | 3 | 1 | S | Tiendli 08/10/2026 | Hacer tras confirmar en panel MP | [ ] Hacer [ ] Rechazar [ ] Después |
| M-08 | Motor | Packs: precio sube y ahorro inventado | Corregir salto y `\|\|`→`??` | 3 | 5 | 2 | S | `bundles.ts:49,62,97`; reproducido | Hacer | [ ] Hacer [ ] Rechazar [ ] Después |
| M-09 | Motor | 20 % de pérdida por devolución oculto | Explicarlo en la ayuda | 2 | 4 | 1 | S | `engine.ts:58` | Hacer | [ ] Hacer [ ] Rechazar [ ] Después |
| M-10 | Motor | ROI anualizado simple | Rotular "simple" | 1 | 5 | 1 | S | `engine.ts:172` | Después | [ ] Hacer [ ] Rechazar [ ] Después |
| M-11 | Motor | Sin publicidad ni cuotas | Campo opcional % publicidad | 3 | 3 | 2 | S | grep sin resultados | Después | [ ] Hacer [ ] Rechazar [ ] Después |
| M-12 | Motor | Capital inmovilizado | Capital y días de recupero en Lote | 3 | 3 | 1 | S | `types.ts:194` | Después | [ ] Hacer [ ] Rechazar [ ] Después |
| M-13 | Motor | Constantes sin fuente ni fecha | Fuente + fecha + test de vencimiento | 3 | 5 | 1 | S | `constants.ts` | Hacer | [ ] Hacer [ ] Rechazar [ ] Después |
