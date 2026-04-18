/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-types.js
   Definiciones de tipos JSDoc para el Tax Engine
   
   Vanilla JS no tiene tipos en runtime, pero estos JSDoc types:
   1. Dan autocompletado en VS Code sin TypeScript
   2. Documentan el contrato exacto entre módulos
   3. Facilitan la integración con Claude (sabe qué campos existen)
   
   Uso: @param {TaxDocument} doc  /  @returns {Resultado303}
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Documento fiscal normalizado — salida de tax-data.js.
 * Representa una factura emitida o recibida ya normalizada.
 * 
 * @typedef {Object} TaxDocument
 * @property {string}  id               - UUID del documento en Supabase
 * @property {'emitida'|'recibida'} tipo - Tipo de factura
 * @property {string}  fecha            - Fecha ISO: "2025-03-15"
 * @property {string}  [fecha_operacion] - Fecha de devengo si es distinta de la fecha de emisión (art. 6.1.f RD 1619/2012)
 * @property {string}  [fecha_emision]   - Fecha de expedición
 * @property {number}  base             - Base imponible total en € (suma de todas las líneas)
 * @property {number}  iva_pct          - Tipo de IVA principal (mayor importe) — legacy
 * @property {number}  cuota_iva        - Importe IVA total (suma real de cuotas por tipo)
 * @property {DesgloseIVA} desglose_iva - Desglose multi-IVA por tipo (21/10/4/0) con base y cuota de cada uno. FUENTE DE VERDAD.
 * @property {number}  irpf_pct         - % retención IRPF aplicada (0, 7, 15...)
 * @property {number}  cuota_irpf       - Importe retención IRPF (redondeo simétrico)
 * @property {number}  total            - Total factura (base + cuota_iva - cuota_irpf)
 * @property {string}  tipo_operacion   - "nacional"|"intracomunitaria"|"exportacion"|"importacion"|"inversion_sujeto_pasivo"|"exento"
 * @property {'emitida'|'borrador'|'anulada'} estado - Estado de la factura
 * @property {string}  [contraparte_nif]  - NIF del cliente o proveedor (para 347/349)
 * @property {string}  [contraparte_nombre] - Nombre del cliente o proveedor
 * @property {string}  [contraparte_pais]  - ISO2 del país de la contraparte (ES, DE, FR, ...)
 * @property {boolean} [es_rectificativa]  - true si es factura rectificativa
 * @property {string}  [rectif_tipo_motivo] - R1|R2|R3|R4|R5 (art. 80 LIVA)
 * @property {string}  [rectif_factura_original] - Número de la factura rectificada
 * @property {boolean} [deducible_iva]     - false si el IVA no es deducible
 * @property {string}  [tipo_documento]    - "factura_completa"|"factura_simplificada"|"ticket_no_deducible"
 * @property {number}  [pct_deduccion_iva] - % de deducción IVA (100 por defecto, < 100 en prorrata)
 * @property {boolean} [clasifica_actividad_sujeta_con_derecho] - true para emitidas con derecho a deducir IVA soportado (nacional/IC/export/ISP), false para exento art. 20
 */

/**
 * Desglose multi-IVA de una factura.
 * Clave: tipo de IVA (21/10/4/0). Valor: { base, cuota } redondeados.
 * 
 * @typedef {Object} DesgloseIVA
 * @property {{base:number, cuota:number}} 21
 * @property {{base:number, cuota:number}} 10
 * @property {{base:number, cuota:number}} 4
 * @property {{base:number, cuota:number}} 0
 * @property {number} base_total
 * @property {number} cuota_total
 * @property {number} dto_global_amt
 */

/**
 * Perfil fiscal del autónomo.
 * Refleja los campos de la tabla perfil_fiscal en Supabase.
 * 
 * @typedef {Object} PerfilFiscal
 * @property {string}  user_id
 * @property {string}  nombre_razon_social
 * @property {string}  nif
 * @property {string}  [actividad]          - Descripción de la actividad
 * @property {string}  [actividad_iae]      - Epígrafe IAE (ej: "7499")
 * @property {string}  [regime]             - "estimacion_directa"|"estimacion_directa_simplificada"|"modulos"
 * @property {string}  [fecha_alta]         - Fecha ISO de alta en actividad
 * @property {string}  [domicilio_fiscal]
 * @property {number}  [reta_mensual]       - Cuota mensual RETA actual en €
 * @property {boolean} [criterio_caja]      - true si está acogido al RECC (art. 163 LIVA)
 * @property {string}  [empresa_id]         - Si no es null: empresa en modo gestor
 */

/**
 * Resultado del cálculo del Modelo 303.
 * 
 * @typedef {Object} Resultado303
 * @property {Object}  repercutido         - IVA repercutido por tipo
 * @property {number}  repercutido.tipo21  - Cuota IVA al 21%
 * @property {number}  repercutido.tipo10  - Cuota IVA al 10%
 * @property {number}  repercutido.tipo4   - Cuota IVA al 4%
 * @property {number}  repercutido.total   - Total IVA repercutido
 * @property {Object}  soportado           - IVA soportado deducible
 * @property {number}  soportado.interior  - IVA soportado en operaciones interiores
 * @property {number}  soportado.importacion - IVA soportado en importaciones
 * @property {number}  soportado.total     - Total IVA deducible
 * @property {number}  resultado           - Casilla 64: diferencia repercutido - soportado
 * @property {number}  compensacion_anterior - Cuotas negativas de periodos anteriores
 * @property {number}  resultado_final     - resultado + compensacion_anterior (puede ser negativo)
 * @property {'a_ingresar'|'a_compensar'|'a_devolver'} estado_resultado
 * @property {Object}  por_operacion       - Bases agrupadas por tipo de operación
 * @property {number}  base_exenta         - Total bases exentas (exportaciones + IC emitidas)
 * @property {Object}  isp                 - ISP: { base, cuota }
 * @property {Object}  casillas            - Mapa numérico casilla → valor para la AEAT
 */

/**
 * Resultado del cálculo del Modelo 130.
 * 
 * @typedef {Object} Resultado130
 * @property {number}  ingresos_trim       - Ingresos del trimestre
 * @property {number}  gastos_trim         - Gastos deducibles del trimestre
 * @property {number}  ingresos_acum       - Ingresos acumulados trimestres anteriores
 * @property {number}  gastos_acum         - Gastos acumulados trimestres anteriores
 * @property {number}  ingresos_total      - Total ingresos YTD
 * @property {number}  gastos_total        - Total gastos deducibles YTD
 * @property {number}  rend_neto_acum      - Rendimiento neto acumulado (ing - gst)
 * @property {number}  pago_fraccionado    - 20% del rendimiento neto acumulado
 * @property {number}  retenciones_acum    - Retenciones IRPF acumuladas
 * @property {number}  pagos_previos       - Pagos fraccionados trimestres anteriores
 * @property {number}  resultado           - A ingresar (≥ 0, nunca negativo)
 * @property {string}  trim                - "T1"|"T2"|"T3"|"T4"
 * @property {number}  year
 */

/**
 * Resultado de la proyección anual IRPF.
 * 
 * @typedef {Object} ProyeccionAnual
 * @property {number}  ingresos_proyect    - Ingresos anuales proyectados
 * @property {number}  gastos_proyect      - Gastos anuales proyectados
 * @property {number}  rend_proyect        - Rendimiento neto proyectado
 * @property {number}  pago_anual_130      - Total pagos fraccionados proyectados
 * @property {number}  cuota_renta_estimada - Cuota del Modelo 100 estimada
 * @property {number}  tipo_efectivo       - Tipo efectivo estimado (%)
 * @property {number}  reserva_mensual     - € a reservar por mes
 * @property {string}  trim_base           - Trimestre sobre el que se proyecta
 */

/**
 * Resultado del simulador Renta (Modelo 100).
 * 
 * @typedef {Object} SimuladorRenta
 * @property {number}  rend_actividad      - Rendimiento neto de la actividad
 * @property {number}  reduccion_actividad - Reducción art. 32.2 LIRPF
 * @property {number}  otros_ingresos      - Otros rendimientos (capital, trabajo...)
 * @property {number}  base_imponible_gral - Base imponible general
 * @property {number}  minimo_personal     - Mínimo personal y familiar aplicado
 * @property {number}  cuota_integra       - Cuota íntegra estatal + autonómica
 * @property {number}  retenciones         - Retenciones soportadas del año
 * @property {number}  pagos_frac_130      - Total pagos fraccionados 130
 * @property {number}  cuota_liquida       - Cuota íntegra − retenciones − pagos
 * @property {number}  tipo_efectivo       - Cuota íntegra / base imponible (%)
 * @property {'a_pagar'|'a_devolver'} estado
 */

/**
 * Alerta fiscal generada por el engine.
 * 
 * @typedef {Object} TaxAlert
 * @property {string}  id                  - Identificador único
 * @property {'umbral_347'|'prorrata'|'renta_alta'|'retenciones_bajas'|'plazo'|'gasto_riesgo'|'primer_año'|'isp'|'info'} tipo
 * @property {'critica'|'alta'|'media'|'baja'} severidad
 * @property {string}  mensaje             - Texto para mostrar al usuario
 * @property {string}  [norma]             - Referencia legal: "Art. 115 LIVA"
 * @property {string}  [modelo]            - Modelo afectado: "303"|"130"
 * @property {string}  [accion]            - Texto del CTA: "Ver Modelo 303"
 * @property {string}  [accion_url]        - Hash de navegación: "#fiscal-303"
 * @property {boolean} resuelta            - Si el usuario la ha marcado como vista
 */

/**
 * Gasto clasificado con deducibilidad calculada.
 * 
 * @typedef {Object} GastoClasificado
 * @property {string}  id
 * @property {string}  concepto
 * @property {number}  base                - Base del gasto
 * @property {number}  iva                 - IVA del gasto
 * @property {string}  fecha
 * @property {string}  categoria           - Categoría del gasto (clave de GASTOS_DEDUCIBLES)
 * @property {number}  pct_deducible_irpf  - 0-100: % deducible en IRPF
 * @property {number}  pct_deducible_iva   - 0-100: % IVA deducible
 * @property {number}  importe_deducible   - base × pct_deducible_irpf / 100
 * @property {number}  iva_deducible       - iva × pct_deducible_iva / 100
 * @property {'bajo'|'medio'|'alto'} riesgo
 * @property {string}  [norma]
 * @property {string}  [nota]              - Explicación para el usuario
 */

/**
 * Contexto fiscal completo serializado para Claude.
 * Contiene todos los datos calculados + perfil + alertas.
 * 
 * @typedef {Object} TaxContextForClaude
 * @property {PerfilFiscal}    perfil
 * @property {string}          trim
 * @property {number}          year
 * @property {Resultado303}    resultado_303
 * @property {Resultado130}    resultado_130
 * @property {ProyeccionAnual} proyeccion
 * @property {TaxAlert[]}      alertas
 * @property {GastoClasificado[]} gastos_clasificados
 * @property {Object}          resumen_347          - Acumulados por NIF para 347
 * @property {string}          timestamp            - ISO timestamp del cálculo
 */

// Este archivo no exporta funciones — solo tipos JSDoc.
// Importarlo no tiene efecto en runtime, pero el IDE lo usa para autocompletado.
export const __TYPES_VERSION__ = "1.0.0";
