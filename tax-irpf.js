/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-irpf.js
   Motor de cálculo IRPF — funciones puras sin efectos secundarios
   
   Normas:
   - LIRPF (Ley 35/2006) arts. 27-32 (actividades económicas)
   - RIRPF (RD 439/2007) art. 110 (pagos fraccionados)
   - Modelo 130: acumulación ANUAL correcta (no solo trimestral)
   ═══════════════════════════════════════════════════════════════════ */

import {
  PCT_PAGO_FRACCIONADO_130,
  PCT_RETENCION_PROFESIONAL,
  PCT_RETENCION_REDUCIDA,
  TRAMOS_IRPF_2024,
  MINIMOS_PERSONALES,
  REDUCCION_ACTIVIDAD_ECONOMICA,
  LIMITE_PLAN_PENSIONES,
  TRIM_ORDEN,
} from "./tax-rules.js";

/* ══════════════════════════════════════════════════════════════════
   MODELO 130 — Pago fraccionado IRPF trimestral
   Art. 110 LIRPF — la clave es que el cálculo es ACUMULADO
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 130 a partir de los documentos acumulados hasta el trimestre.
 * 
 * IMPORTANTE: docsAcum debe contener TODOS los documentos desde T1
 * hasta el trimestre actual (inclusive). No solo los del trimestre.
 * El pago fraccionado de cada trimestre = 20% del rendimiento YTD
 * menos retenciones YTD menos pagos fraccionados de trimestres anteriores.
 * 
 * @param {import('./tax-types.js').TaxDocument[]} docsAcum  - Docs desde T1 hasta trim
 * @param {number} pagosPrevios - Suma de pagos fraccionados 130 de trimestres anteriores
 * @param {string} trim         - "T1"|"T2"|"T3"|"T4"
 * @param {number} year
 * @returns {import('./tax-types.js').Resultado130}
 */
export function calcModelo130(docsAcum, pagosPrevios, trim, year) {
  // Segregar documentos por tipo
  const emitidas = docsAcum.filter(d => d.tipo === "emitida" && d.estado !== "anulada" && d.estado !== "borrador");
  const recibidas = docsAcum.filter(d => d.tipo === "recibida");

  // Ingresos = suma de bases de facturas emitidas cobradas
  const ingresos_total = emitidas.reduce((s, d) => s + (d.base ?? 0), 0);

  // Gastos = suma de bases de facturas recibidas (soportadas)
  // En estimación directa simplificada se aplica un 5% adicional de gastos
  // de difícil justificación sobre el rendimiento neto (art. 30.2.4ª LIRPF)
  // Aquí calculamos el gasto directo; el 5% se aplica al simular la Renta
  const gastos_total = recibidas.reduce((s, d) => s + (d.base ?? 0), 0);

  // Retenciones soportadas acumuladas (en facturas emitidas con IRPF)
  const retenciones_acum = emitidas.reduce((s, d) => s + (d.cuota_irpf ?? 0), 0);

  // Rendimiento neto acumulado
  const rend_neto_acum = ingresos_total - gastos_total;

  // 20% del rendimiento neto acumulado (casilla 06 del modelo 130)
  const pago_fraccionado = Math.max(0, rend_neto_acum * PCT_PAGO_FRACCIONADO_130);

  // Resultado final = pago_frac - retenciones - pagos_previos (≥ 0)
  const resultado = Math.max(0, pago_fraccionado - retenciones_acum - pagosPrevios);

  // Para mostrar el desglose del trimestre (informativo)
  const idxTrim = TRIM_ORDEN.indexOf(trim);
  // No calculamos el desglose trim aquí — si se necesita, el caller lo hace
  // con docs filtrados. Esto evita doble query.

  return {
    // Totales YTD
    ingresos_total:     _round(ingresos_total),
    gastos_total:       _round(gastos_total),
    rend_neto_acum:     _round(rend_neto_acum),
    pago_fraccionado:   _round(pago_fraccionado),
    retenciones_acum:   _round(retenciones_acum),
    pagos_previos:      _round(pagosPrevios),
    resultado:          _round(resultado),
    // Meta
    trim,
    year,
    // Casillas del modelo 130 (referencia para exportación)
    casillas: {
      "01": _round(ingresos_total),          // Ingresos del período (YTD)
      "02": _round(gastos_total),            // Gastos deducibles (YTD)
      "05": _round(rend_neto_acum),          // Rendimiento neto (ing - gst)
      "06": _round(pago_fraccionado),        // 20% del rend. neto
      "07": _round(retenciones_acum),        // Retenciones y pagos a cuenta
      "08": _round(pagosPrevios),            // Pagos fraccionados periodos anteriores
      "09": _round(resultado),               // A ingresar
    },
  };
}

/**
 * Calcula los pagos previos acumulados para un trimestre dado.
 * Suma los resultados del Modelo 130 de T1..T(n-1).
 * Para usar cuando no tienes los periodos guardados en BD.
 * 
 * @param {Object[]} resultadosPrevios - Array de Resultado130 de T1 hasta T(n-1)
 * @returns {number}
 */
export function calcPagosPrevios130(resultadosPrevios) {
  return resultadosPrevios.reduce((s, r) => s + (r?.resultado ?? 0), 0);
}

/* ══════════════════════════════════════════════════════════════════
   PROYECCIÓN ANUAL
   Extrapola datos YTD para proyectar el año completo
══════════════════════════════════════════════════════════════════ */

/**
 * Proyecta los datos fiscales anuales a partir de los YTD.
 * 
 * @param {import('./tax-types.js').Resultado130} r130  - Resultado 130 actual
 * @param {string} trim   - Trimestre actual (para calcular factor de extrapolación)
 * @param {number} totalPagados130 - Total pagado en 130 a lo largo del año
 * @returns {import('./tax-types.js').ProyeccionAnual}
 */
export function calcProyeccionAnual(r130, trim, totalPagados130 = 0) {
  const idx    = TRIM_ORDEN.indexOf(trim);
  const factor = 4 / (idx + 1);  // T1→×4, T2→×2, T3→×1.33, T4→×1

  const ingresos_proyect = r130.ingresos_total * factor;
  const gastos_proyect   = r130.gastos_total   * factor;
  const rend_proyect     = ingresos_proyect - gastos_proyect;

  // Estimación cuota Modelo 100 con los datos proyectados
  const simRenta = calcSimuladorRenta({
    rendimientoActividad: rend_proyect,
    retenciones:          r130.retenciones_acum * factor,
    pagosFrac130:         totalPagados130 * factor,
  });

  const tipo_efectivo = ingresos_proyect > 0
    ? _round((simRenta.cuota_integra / ingresos_proyect) * 100, 2)
    : 0;

  return {
    ingresos_proyect:      _round(ingresos_proyect),
    gastos_proyect:        _round(gastos_proyect),
    rend_proyect:          _round(rend_proyect),
    pago_anual_130:        _round(totalPagados130 * factor),
    cuota_renta_estimada:  _round(simRenta.cuota_liquida),
    tipo_efectivo,
    reserva_mensual:       _round(simRenta.cuota_liquida / 12),
    trim_base:             trim,
  };
}

/* ══════════════════════════════════════════════════════════════════
   SIMULADOR RENTA — Modelo 100 (declaración anual IRPF)
   Estimación orientativa. No sustituye a la declaración real.
══════════════════════════════════════════════════════════════════ */

/**
 * Simula la cuota de la declaración anual de IRPF (Modelo 100).
 * 
 * @param {Object} params
 * @param {number} params.rendimientoActividad    - Rendimiento neto actividad económica
 * @param {number} [params.otrosIngresos=0]       - Trabajo, capital, etc.
 * @param {number} [params.retenciones=0]         - Total retenciones soportadas
 * @param {number} [params.pagosFrac130=0]        - Total pagado en pagos fraccionados 130
 * @param {number} [params.hijos=0]               - Número de hijos < 25 años
 * @param {number} [params.discapacidad=0]        - % discapacidad (0, 33, 65, 100)
 * @param {boolean} [params.edSimplificada=false] - true → aplicar deducción 5% gastos difícil justificación
 * @param {number} [params.planPensiones=0]       - Aportación a plan de pensiones (reducción)
 * @returns {import('./tax-types.js').SimuladorRenta}
 */
export function calcSimuladorRenta(params = {}) {
  const {
    rendimientoActividad = 0,
    otrosIngresos        = 0,
    retenciones          = 0,
    pagosFrac130         = 0,
    hijos                = 0,
    discapacidad         = 0,
    edSimplificada       = false,
    planPensiones        = 0,
  } = params;

  // Estimación directa simplificada: 5% gastos de difícil justificación
  // (art. 30.2.4ª LIRPF) — máximo 2.000€
  let rendAjustado = rendimientoActividad;
  if (edSimplificada && rendimientoActividad > 0) {
    const deduccionDJ = Math.min(rendimientoActividad * 0.05, 2000);
    rendAjustado = rendimientoActividad - deduccionDJ;
  }

  // Reducción por rendimiento de actividades económicas (art. 32.2 LIRPF)
  const reduccionActividad = _calcReduccionActividad(rendAjustado);
  const rendConReduccion = Math.max(0, rendAjustado - reduccionActividad);

  // Reducción por plan de pensiones (art. 51 LIRPF)
  const reduccionPP = Math.min(planPensiones, LIMITE_PLAN_PENSIONES);

  // Base imponible general
  const baseImponible = Math.max(0, rendConReduccion + otrosIngresos - reduccionPP);

  // Mínimo personal y familiar (arts. 57-61 LIRPF)
  const minimo = _calcMinimo(hijos, discapacidad);

  // Base liquidable (sobre la que se aplican los tramos)
  const baseLiquidable = Math.max(0, baseImponible - minimo);

  // Cuota íntegra (aplicando tramos IRPF 2024)
  const cuota_integra = _calcCuotaTramos(baseLiquidable);

  // Cuota líquida = cuota íntegra − retenciones − pagos fraccionados 130
  const cuota_liquida = Math.max(
    -(retenciones + pagosFrac130), // puede ser negativa (a devolver)
    cuota_integra - retenciones - pagosFrac130
  );

  const tipo_efectivo = baseImponible > 0
    ? _round((cuota_integra / baseImponible) * 100, 2)
    : 0;

  return {
    rend_actividad:      _round(rendimientoActividad),
    reduccion_actividad: _round(reduccionActividad),
    otros_ingresos:      _round(otrosIngresos),
    base_imponible:      _round(baseImponible),
    minimo_personal:     _round(minimo),
    cuota_integra:       _round(cuota_integra),
    retenciones:         _round(retenciones),
    pagos_frac_130:      _round(pagosFrac130),
    cuota_liquida:       _round(cuota_liquida),
    tipo_efectivo,
    estado:              cuota_liquida >= 0 ? "a_pagar" : "a_devolver",
  };
}

/* ══════════════════════════════════════════════════════════════════
   RETENCIÓN APLICABLE
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el porcentaje de retención que debe aplicar el autónomo
 * en sus facturas a clientes.
 * 
 * @param {string|null} fechaAltaActividad  - Fecha ISO de alta en la actividad
 * @param {number} year                      - Ejercicio actual
 * @returns {{ pct: number, reducida: boolean, nota: string }}
 */
export function calcRetencionAplicable(fechaAltaActividad, year) {
  if (!fechaAltaActividad) {
    return {
      pct: PCT_RETENCION_PROFESIONAL,
      reducida: false,
      nota: `Retención estándar ${PCT_RETENCION_PROFESIONAL * 100}%. Sin fecha de alta registrada.`,
    };
  }

  const añoAlta = new Date(fechaAltaActividad).getFullYear();
  // Retención reducida en el año de inicio y los 2 siguientes (art. 95.1.b) RIRPF)
  const tieneReducida = year <= añoAlta + 2;

  if (tieneReducida) {
    return {
      pct: PCT_RETENCION_REDUCIDA,
      reducida: true,
      nota: `Retención reducida ${PCT_RETENCION_REDUCIDA * 100}% aplicable hasta fin de ${añoAlta + 2} (primeros 3 ejercicios, art. 95.1.b) RIRPF). Comunícalo a tus clientes en la factura.`,
    };
  }

  return {
    pct: PCT_RETENCION_PROFESIONAL,
    reducida: false,
    nota: `Retención estándar ${PCT_RETENCION_PROFESIONAL * 100}%.`,
  };
}

/* ══════════════════════════════════════════════════════════════════
   FUNCIONES AUXILIARES PRIVADAS
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula la reducción por rendimientos de actividades económicas (art. 32.2 LIRPF).
 * @param {number} rendimiento
 * @returns {number}
 * @private
 */
function _calcReduccionActividad(rendimiento) {
  const { BASE, MAX, MIN, HASTA, DESDE } = REDUCCION_ACTIVIDAD_ECONOMICA;

  if (rendimiento <= 0) return 0;

  let reduccionExtra = 0;
  if (rendimiento <= HASTA) {
    reduccionExtra = MAX;
  } else if (rendimiento < DESDE) {
    // Tramo intermedio: reducción decrece linealmente
    reduccionExtra = Math.max(MIN, MAX - ((rendimiento - HASTA) / (DESDE - HASTA)) * (MAX - MIN));
  } else {
    reduccionExtra = MIN;
  }

  return BASE + reduccionExtra;
}

/**
 * Calcula el mínimo personal y familiar (arts. 57-61 LIRPF).
 * @param {number} hijos
 * @param {number} discapacidad  - % discapacidad (0, 33, 65)
 * @returns {number}
 * @private
 */
function _calcMinimo(hijos, discapacidad) {
  let minimo = MINIMOS_PERSONALES.CONTRIBUYENTE;

  // Mínimo por descendientes
  if (hijos >= 1) minimo += MINIMOS_PERSONALES.HIJO_1;
  if (hijos >= 2) minimo += MINIMOS_PERSONALES.HIJO_2;
  if (hijos >= 3) minimo += MINIMOS_PERSONALES.HIJO_3;
  if (hijos >= 4) minimo += MINIMOS_PERSONALES.HIJO_4_MAS * (hijos - 3);

  // Mínimo por discapacidad del contribuyente
  if (discapacidad >= 65) minimo += MINIMOS_PERSONALES.DISCAPACIDAD_65_MAS;
  else if (discapacidad >= 33) minimo += MINIMOS_PERSONALES.DISCAPACIDAD_33_65;

  return minimo;
}

/**
 * Aplica los tramos IRPF 2024 sobre la base liquidable.
 * @param {number} base
 * @returns {number}
 * @private
 */
function _calcCuotaTramos(base) {
  let cuota = 0;
  let baseRestante = base;

  for (const tramo of TRAMOS_IRPF_2024) {
    if (baseRestante <= 0) break;
    const enTramo = Math.min(baseRestante, tramo.hasta - tramo.desde);
    cuota += enTramo * tramo.tipo;
    baseRestante -= enTramo;
  }

  return cuota;
}

/** Redondea a N decimales */
function _round(n, dec = 2) {
  const factor = Math.pow(10, dec);
  return Math.round((n || 0) * factor) / factor;
}
