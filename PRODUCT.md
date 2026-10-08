# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Comerciantes mayoristas e importadores de Uruguay que compran lotes de productos para revender, principalmente en **Mercado Libre Uruguay (MLU)** y/o en tienda propia / POS. Hoy el usuario principal es el propio dueño del producto operando su negocio; la visión de producto es evolucionar hacia un SaaS que otros comerciantes uruguayos usen directamente, aunque todavía no existe autenticación multiusuario (la app usa credenciales propias de Supabase vía `SupabaseModal`, no cuentas separadas por cliente).

El momento de uso típico es **de pie, con el celular, en el depósito del mayorista**, decidiendo en segundos si conviene cerrar la compra de un lote antes de que la oportunidad se enfríe.

## Product Purpose

UyMargin responde con precisión la pregunta que un comerciante uruguayo necesita resolver antes de comprar un lote: *"¿Cuánto me queda limpio en el bolsillo si compro esto a mi mayorista y lo vendo en Uruguay?"* Simula el margen neto real después de impuestos (DGI), comisiones de canal y logística, comparando canales de venta en paralelo para que la decisión de compra sea inmediata y confiable.

Éxito significa que el comerciante puede, en el momento de la compra y sin hacer cuentas a mano, saber si comprar, negociar o descartar un producto — y que esa cifra coincide con lo que termina quedando "limpio" después de impuestos reales.

## Positioning

A diferencia de calculadoras de margen genéricas (de otros países o sin contexto fiscal), UyMargin modela con precisión el régimen tributario uruguayo real — la brecha entre **Literal E (pequeña empresa DGI)** y **Régimen General (IRAE + IVA con crédito fiscal de compras y servicios facturados con RUT)**, con alícuotas de IVA del 22%, 10% y 0% — y lo cruza en tiempo real contra la estructura de comisiones y logística específica de Mercado Libre Uruguay y de la venta por tienda propia. Ningún competidor genérico modela ese cruce fiscal + multicanal uruguayo con esta precisión.

## Operating Context

- Evaluar un producto puntual desde una URL de una publicación de Mercado Libre Uruguay (scraping/extracción automática de datos de la publicación).
- Buscar un término en el radar de mercado para obtener mediana, promedio, mínimo y máximo de precios vigentes.
- Simular el canal MLU (comisiones Clásica/Premium, cargo fijo por debajo de $U 1.200, Mercado Envíos) contra Tienda Propia/POS (pasarelas como Mercado Pago y Handy, logística DAC/Mirtrans/Cadetería Mvd).
- Armar packs/combos (x2, x3, x4) para evitar el cargo fijo de MLU en tickets menores a $U 1.200.
- Cargar catálogos completos en CSV/Excel y rankear por rentabilidad para decisiones de compra de inventario en lote.
- Monitorear publicaciones de competidores en MLU y recibir alertas cuando bajan de precio o amenazan el margen objetivo.
- Guardar auditorías y seguimiento de competidores en Supabase (credenciales propias del usuario) para consultarlas después.
- Consultar al copiloto Gemini sobre un diagnóstico ya calculado (la IA interpreta, no calcula ni inventa cifras).
- Exportar el resultado a CSV/Excel, imprimir una ficha ejecutiva, o compartirla por WhatsApp.

## Capabilities and Constraints

- Motor fiscal determinístico (`dgi-taxes.ts`) para Literal E vs Régimen General (IRAE + IVA con crédito fiscal), con alícuotas 22/10/0%.
- Motor de canales (`channels.ts`) con comisiones MLU (Clásica/Premium), cargo fijo por ticket bajo $U 1.200, y tarifas reales de logística uruguaya: DAC ($U 210), Mirtrans ($U 195), Cadetería Mvd ($U 170), Mercado Envíos ($U 180/210/245).
- Motor de packs/bundles (`bundles.ts`) para neutralizar el cargo fijo de MLU en tickets bajos.
- Prueba de estrés de tipo de cambio USD/UYU (+5%, +10%) sobre el margen.
- Copiloto IA (Gemini, vía `@google/genai`) que solo analiza diagnósticos ya calculados de forma determinística; no debe inventar ni reemplazar cifras.
- Persistencia en Supabase (tablas `uymargin_audits`, `competitor_tracking`) con RLS; el usuario provee sus propias credenciales, no hay multi-tenencia con login todavía — esto es una limitación conocida, no un gap a disimular.
- Suite de pruebas doradas (`scripts/verify_all.ts`) que valida los cálculos financieros; cambios al motor financiero deben mantenerla pasando.
- Idioma: español (Uruguay) exclusivamente; mercado objetivo exclusivamente uruguayo (no generalizar a otros países sin que el usuario lo pida).

## Brand Commitments

- Nombre: **UyMargin**.
- Propuesta de valor citable: *"¿Cuánto me queda limpio en el bolsillo si compro esto a mi mayorista y lo vendo en Uruguay?"*
- Principio de decisión ejecutiva: **"Un número, un color, una frase"** — toda pantalla de decisión debe poder leerse en 5 segundos desde un celular.

## Evidence on Hand

- Tarifas y constantes fiscales/logísticas reales de Uruguay (`src/lib/finance/constants.ts`, `dgi-taxes.ts`): tasas de IVA, comisiones MLU, tarifas DAC/Mirtrans/Cadetería Mvd/Mercado Envíos.
- Backend real en Supabase con tablas `uymargin_audits` y `competitor_tracking` (RLS activo).
- Suite de pruebas automatizadas con casos dorados verificando el motor financiero.
- **No existen** testimonios, casos de éxito, logos de clientes ni métricas de uso reales todavía — cualquier prueba social de ese tipo sería inventada; no se debe fabricar ni sugerir que existe.

## Product Principles

1. **Un número, un color, una frase.** Toda decisión ejecutiva se resume en una cifra neta, un semáforo de color y una frase corta, pensada para leerse desde el celular en el depósito del mayorista.
2. **El motor fiscal nunca improvisa.** Los cálculos de IVA, IRAE y Literal E son 100% determinísticos; la IA solo interpreta esos números, nunca los sustituye ni los inventa.
3. **Multicanal por defecto.** Toda decisión de compra se evalúa contra Mercado Libre Uruguay y Tienda Propia/POS en paralelo, nunca contra un solo canal aislado.
4. **Diseñado para el momento de la compra**, no para un análisis de escritorio sin apuro: la app asume uso móvil, bajo presión de tiempo, de pie frente al proveedor.
5. **Evidencia real, nunca fabricada.** Tarifas, impuestos y constantes deben ser reales y verificables; no se inventan testimonios, casos de éxito ni métricas de clientes.
