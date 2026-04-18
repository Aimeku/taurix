/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-irpf.js
   Motor de cálculo IRPF — funciones puras sin efectos secundarios
   
   Normas:
   - LIRPF (Ley 35/2006) arts. 27-32 (actividades económicas)
   - RIRPF (RD 439/2007) art. 110 (pagos fraccionados)
   - Modelo 130: acumulación ANUAL correcta (no solo trimestral)
   
   REFACTOR v2 (post-auditoría fiscal 2026):
   - Hallazgo 1: lee `base` del TaxDocument ya normalizado (multi-IVA ok).
   - Hallazgo 10: redondeo simétrico por factura.
   - Hallazgo 16: reducción art. 32.2.1 marcada como CONDICIONAL.
     Por defecto ya no se aplica automáticamente en el simulador.
   - Hallazgo 16: excepción 70% del 130 con distinción clara
     ejercicio anterior vs ejercicio en curso.
   - Hallazgo 22: tramos estatales correctos 2025 + preparación para
     aplicar escala autonómica (entregable en lote 16).
   ═══════════════════════════════════════════════════════════════════ */

import {
  PCT_PAGO_FRACCIONADO_130,
  PCT_RETENCION_PROFESIONAL,
  PCT_RETENCION_REDUCIDA,
  TRAMOS_IRPF_2025,
  MINIMOS_PERSONALES,
  REDUCCION_ACTIVIDAD_ECONOMICA,
  REDUCCION_RENTAS_BAJAS,
  LIMITE_PLAN_PENSIONES,
  TRIM_ORDEN,
} from "./tax-rules.js";
import { redondearSimetrico, yearDeFecha } from "../factura-helpers.js";

const _r = redondearSimetrico;

/* ══════════════════════════════════════════════════════════════════
   MODELO 130 — Pago fraccionado IRPF trimestral
   Art. 110 LIRPF — el cálculo es ACUMULADO (YTD)
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 130 a partir de los documentos acumulados
 * desde T1 hasta el trimestre actual (inclusive).
 * 
 * IMPORTANTE: docsAcum DEBE contener todos los documentos YTD, no
 * solo los del trimestre actual. El pago fraccionado de cada
 * trimestre = 20 % del rendimiento YTD − retenciones YTD − pagos
 * fraccionados anteriores.
 * 
 * @param {import('./tax-types.js').TaxDocument[]} docsAcum
 * @param {number} pagosPrevios - Suma de 130 de trimestres anteriores
 * @param {string} trim         - "T1"|"T2"|"T3"|"T4"
 * @param {number} year
 * @param {Object} [opts]
 * @param {boolean} [opts.aplicarGastoEDS=false] - true → estimación directa simplificada (5% gastos DJ, tope 2.000€)
 * @returns {import('./tax-types.js').Resultado130}
 */
export function calcModelo130(docsAcum, pagosPrevios, trim, year, opts = {}) {
  const { aplicarGastoEDS = false } = opts;

  // Segregar documentos por tipo
  const emitidas  = docsAcum.filter(d => d.tipo === "emitida" && d.estado === "emitida");
  const recibidas = docsAcum.filter(d => d.tipo === "recibida" && d.estado !== "anulada");

  // Ingresos = suma de bases de facturas emitidas (respetando rectificativas con signo)
  const ingresos_total = _r(emitidas.reduce((s, d) => s + (d.base ?? 0), 0));

  // Gastos directos = suma de bases de facturas recibidas
  const gastos_total_directo = _r(recibidas.reduce((s, d) => s + (d.base ?? 0), 0));

  // Gasto adicional por estimación directa simplificada (art. 30.2.4ª LIRPF):
  // 5 % sobre el rendimiento neto previo, tope 2.000 €/año.
  // Desde Ley 31/2022 + RD-ley 4/2023 APLICABLE TAMBIÉN AL 130
  // (Hallazgo 16 del informe fiscal).
  const rendPrevio  = ingresos_total - gastos_total_directo;
  let gastoEDS = 0;
  if (aplicarGastoEDS && rendPrevio > 0) {
    gastoEDS = Math.min(rendPrevio * 0.05, 2000);
  }
  const gastos_total = _r(gastos_total_directo + gastoEDS);

  // Retenciones soportadas acumuladas (suma de cuota_irpf de emitidas con retención)
  const retenciones_acum = _r(
    emitidas.reduce((s, d) => s + (d.cuota_irpf ?? 0), 0)
  );

  // Rendimiento neto acumulado
  const rend_neto_acum = _r(ingresos_total - gastos_total);

  // 20 % del rendimiento neto acumulado (art. 110.1 LIRPF)
  const pago_fraccionado = _r(Math.max(0, rend_neto_acum * PCT_PAGO_FRACCIONADO_130));

  // Resultado = pago_frac − retenciones YTD − pagos anteriores (nunca < 0)
  const resultado = _r(Math.max(0, pago_fraccionado - retenciones_acum - pagosPrevios));

  // % de ingresos con retención (para alertar excepción 70% del 130)
  const ingresosConRetencion = _r(
    emitidas
      .filter(d => (d.irpf_pct ?? 0) > 0)
      .reduce((s, d) => s + (d.base ?? 0), 0)
  );
  const pct_con_retencion = ingresos_total > 0 ? ingresosConRetencion / ingresos_total : 0;

  return {
    // Totales YTD
    ingresos_total,
    gastos_total,
    gasto_difjustificacion: _r(gastoEDS),
    rend_neto_acum,
    pago_fraccionado,
    retenciones_acum,
    pagos_previos:     _r(pagosPrevios),
    resultado,
    // Meta
    trim,
    year,
    pct_con_retencion,
    // Casillas del modelo 130 (referencia para exportación)
    casillas: {
      "01": ingresos_total,       // Ingresos del período (YTD)
      "02": _r(gastos_total_directo), // Gastos deducibles directos (YTD)
      "03": _r(gastoEDS),         // 5% difícil justificación EDS (si aplica)
      "04": rend_neto_acum,       // Rendimiento neto
      "05": pago_fraccionado,     // 20% del rend. neto
      "06": retenciones_acum,     // Retenciones y pagos a cuenta YTD
      "07": _r(pagosPrevios),     // Pagos fraccionados periodos anteriores
      "08": 0,                    // Reducciones por hipoteca (no implementado)
      "09": resultado,            // A ingresar
    },
  };
}

/**
 * Suma los resultados del Modelo 130 de trimestres anteriores.
 */
export function calcPagosPrevios130(resultadosPrevios) {
  return _r(resultadosPrevios.reduce((s, r) => s + (r?.resultado ?? 0), 0));
}

/* ══════════════════════════════════════════════════════════════════
   PROYECCIÓN ANUAL
   Extrapola datos YTD para proyectar el año completo
══════════════════════════════════════════════════════════════════ */

/**
 * Proyecta los datos fiscales anuales a partir de los YTD.
 * 
 * ⚠️ ATENCIÓN (Hallazgo 16 del informe):
 * La extrapolación lineal × (4/trim) solo es representativa para
 * negocios NO estacionales. Para hostelería/turismo/comercio
 * estacional, el usuario debería ajustar manualmente. Esta función
 * expone la proyección con una marca `estacionalidad_nota` para
 * que la UI muestre el aviso.
 * 
 * @param {import('./tax-types.js').Resultado130} r130
 * @param {string} trim
 * @param {number} totalPagados130
 * @param {Object} [opts]
 * @param {boolean} [opts.aplicarReduccion32=false] - true si cumple requisitos art. 32.2.2 LIRPF
 * @param {boolean} [opts.aplicarGastoEDS=false]   - true si está en estimación directa simplificada
 * @returns {import('./tax-types.js').ProyeccionAnual}
 */
export function calcProyeccionAnual(r130, trim, totalPagados130 = 0, opts = {}) {
  const idx    = TRIM_ORDEN.indexOf(trim);
  const factor = 4 / (idx + 1);                   // T1→×4, T2→×2, T3→×1.33, T4→×1

  const ingresos_proyect = _r(r130.ingresos_total * factor);
  const gastos_proyect   = _r(r130.gastos_total   * factor);
  const rend_proyect     = _r(ingresos_proyect - gastos_proyect);

  // Simulador Renta con los proyectados
  const simRenta = calcSimuladorRenta({
    rendimientoActividad: rend_proyect,
    retenciones:          r130.retenciones_acum * factor,
    pagosFrac130:         totalPagados130 * factor,
    edSimplificada:       opts.aplicarGastoEDS === true,
    aplicarReduccion32:   opts.aplicarReduccion32 === true,
  });

  const tipo_efectivo = ingresos_proyect > 0
    ? _r((simRenta.cuota_integra / ingresos_proyect) * 100, 2)
    : 0;

  return {
    ingresos_proyect,
    gastos_proyect,
    rend_proyect,
    pago_anual_130:        _r(totalPagados130 * factor),
    cuota_renta_estimada:  _r(simRenta.cuota_liquida),
    tipo_efectivo,
    reserva_mensual:       _r(simRenta.cuota_liquida / 12),
    trim_base:             trim,
    estacionalidad_nota:   idx < 3
      ? "Proyección lineal desde YTD — no apta para negocios estacionales. Ajusta manualmente si corresponde."
      : null,
  };
}

/* ══════════════════════════════════════════════════════════════════
   SIMULADOR RENTA — Modelo 100 (declaración anual IRPF)
   Orientativo. NO sustituye a la declaración real.
══════════════════════════════════════════════════════════════════ */

/**
 * Simula la cuota de la declaración anual de IRPF (Modelo 100).
 * 
 * IMPORTANTE (Hallazgo 16 del informe fiscal):
 * La reducción del art. 32.2.1 LIRPF (2.000 €) es CONDICIONAL.
 * Requiere cumplir los 5 requisitos del art. 32.2.2. Por ello el
 * parámetro `aplicarReduccion32` es FALSE por defecto: el simulador
 * no aplica la reducción salvo que el usuario confirme que cumple.
 * 
 * @param {Object} params
 * @param {number} params.rendimientoActividad
 * @param {number} [params.otrosIngresos=0]
 * @param {number} [params.retenciones=0]
 * @param {number} [params.pagosFrac130=0]
 * @param {number} [params.hijos=0]
 * @param {number} [params.discapacidad=0]
 * @param {boolean} [params.edSimplificada=false]
 * @param {number} [params.planPensiones=0]
 * @param {boolean} [params.aplicarReduccion32=false] - art. 32.2.1 LIRPF (condicional)
 * @param {string} [params.ccaa=null]  - CCAA para aplicar escala autonómica (lote 16)
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
    aplicarReduccion32   = false,     // Hallazgo 16: condicional por defecto
    ccaa                 = null,      // Hallazgo 22 (se completa en lote 16)
  } = params;

  // Estimación directa simplificada: 5% gastos de difícil justificación
  // (art. 30.2.4ª LIRPF) — máximo 2.000€
  let rendAjustado = rendimientoActividad;
  let deduccionDJ  = 0;
  if (edSimplificada && rendimientoActividad > 0) {
    deduccionDJ  = Math.min(rendimientoActividad * 0.05, 2000);
    rendAjustado = rendimientoActividad - deduccionDJ;
  }

  // Reducción por rendimientos de actividades económicas (art. 32.2 LIRPF)
  // Solo si el usuario CONFIRMA que cumple requisitos (Hallazgo 16).
  const reduccionActividad = aplicarReduccion32 ? _calcReduccionActividad(rendAjustado) : 0;
  const rendConReduccion   = Math.max(0, rendAjustado - reduccionActividad);

  // Reducción por plan de pensiones (art. 51 LIRPF)
  const reduccionPP = Math.min(planPensiones, LIMITE_PLAN_PENSIONES);

  // Base imponible general
  const baseImponible = Math.max(0, rendConReduccion + otrosIngresos - reduccionPP);

  // Mínimo personal y familiar (arts. 57-61 LIRPF)
  const minimo = _calcMinimo(hijos, discapacidad);

  // Base liquidable sobre la que se aplican los tramos
  const baseLiquidable = Math.max(0, baseImponible - minimo);

  // Cuota íntegra: estatal + autonómica
  // Mientras no tengamos escala autonómica por CCAA (lote 16), se usa
  // la tabla TRAMOS_IRPF_2025 que ya combina estatal + autonómica media.
  const cuota_integra = _calcCuotaTramos(baseLiquidable);

  // Cuota líquida: admite ser negativa (a devolver), con tope en el
  // total de retenciones + pagos fraccionados (art. 103 LIRPF).
  const cuota_liquida = Math.max(
    -(retenciones + pagosFrac130),
    cuota_integra - retenciones - pagosFrac130
  );

  const tipo_efectivo = baseImponible > 0
    ? _r((cuota_integra / baseImponible) * 100, 2)
    : 0;

  return {
    rend_actividad:      _r(rendimientoActividad),
    deduccion_dif_just:  _r(deduccionDJ),
    reduccion_actividad: _r(reduccionActividad),
    reduccion_actividad_aplicada_condicional: aplicarReduccion32,
    otros_ingresos:      _r(otrosIngresos),
    reduccion_pp:        _r(reduccionPP),
    base_imponible:      _r(baseImponible),
    minimo_personal:     _r(minimo),
    base_liquidable:     _r(baseLiquidable),
    cuota_integra:       _r(cuota_integra),
    retenciones:         _r(retenciones),
    pagos_frac_130:      _r(pagosFrac130),
    cuota_liquida:       _r(cuota_liquida),
    tipo_efectivo,
    estado:              cuota_liquida >= 0 ? "a_pagar" : "a_devolver",
    ccaa_usada:          ccaa,
    aviso_ccaa:          !ccaa
      ? "Estimación con escala estatal + autonómica media. La escala autonómica real puede diferir hasta ±7 puntos."
      : null,
    aviso_reduccion32:   !aplicarReduccion32 && rendAjustado > 0
      ? "No se ha aplicado la reducción del art. 32.2 LIRPF. Si cumples los requisitos (sin rendimientos del trabajo, 70% ingresos con retención, gastos ≤30% ingresos, estimación directa, sin entidad en atribución), puedes activarla."
      : null,
  };
}

/* ══════════════════════════════════════════════════════════════════
   RETENCIÓN APLICABLE AL EMITIR FACTURA
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el porcentaje de retención que debe aplicar el autónomo
 * en sus facturas a clientes.
 * 
 * @param {string|null} fechaAltaActividad  - ISO "YYYY-MM-DD"
 * @param {number} year                      - Ejercicio actual
 * @returns {{ pct: number, reducida: boolean, nota: string }}
 */
export function calcRetencionAplicable(fechaAltaActividad, year) {
  if (!fechaAltaActividad) {
    return {
      pct: PCT_RETENCION_PROFESIONAL,
      reducida: false,
      nota: `Retención estándar ${(PCT_RETENCION_PROFESIONAL * 100).toFixed(0)}%. Sin fecha de alta registrada.`,
    };
  }

  // Parseo sin Date() para evitar problemas UTC (Hallazgo 27)
  const añoAlta = yearDeFecha(fechaAltaActividad);

  // Retención reducida en el año de inicio y los 2 siguientes
  // (art. 95.1.b RIRPF)
  const tieneReducida = year <= añoAlta + 2;

  if (tieneReducida) {
    return {
      pct: PCT_RETENCION_REDUCIDA,
      reducida: true,
      nota: `Retención reducida ${(PCT_RETENCION_REDUCIDA * 100).toFixed(0)}% aplicable hasta fin de ${añoAlta + 2} (primeros 3 ejercicios, art. 95.1.b RIRPF). Comunícalo por escrito a tus clientes antes de cada ejercicio.`,
    };
  }

  return {
    pct: PCT_RETENCION_PROFESIONAL,
    reducida: false,
    nota: `Retención estándar ${(PCT_RETENCION_PROFESIONAL * 100).toFixed(0)}%.`,
  };
}

/* ══════════════════════════════════════════════════════════════════
   EXCEPCIÓN PRESENTACIÓN MODELO 130 (art. 109.1 RIRPF)
══════════════════════════════════════════════════════════════════ */

/**
 * Determina si el contribuyente está exento de presentar el 130.
 * Condición: al menos el 70% de los ingresos del ejercicio ANTERIOR
 * procedieron de actividades con retención (profesionales con IRPF).
 * 
 * Hallazgo 16 del informe: el cálculo debe basarse en el ejercicio
 * ANTERIOR, no en el acumulado en curso.
 * 
 * @param {number} ingresos_ejercicio_anterior
 * @param {number} ingresos_con_retencion_ejercicio_anterior
 * @returns {{ exento: boolean, pct: number, nota: string }}
 */
export function calcExcepcion130(ingresos_ejercicio_anterior, ingresos_con_retencion_ejercicio_anterior) {
  if (!ingresos_ejercicio_anterior || ingresos_ejercicio_anterior <= 0) {
    return {
      exento: false,
      pct: 0,
      nota: "Sin datos del ejercicio anterior. Por defecto se obliga a presentar el 130 (art. 110 LIRPF).",
    };
  }
  const pct = ingresos_con_retencion_ejercicio_anterior / ingresos_ejercicio_anterior;
  const exento = pct >= 0.70;
  return {
    exento,
    pct: _r(pct * 100, 1),
    nota: exento
      ? `${_r(pct * 100, 1)}% de tus ingresos del ejercicio anterior llevaron retención (≥70%). Estás exento de presentar el Modelo 130 (art. 109.1 RIRPF).`
      : `Solo el ${_r(pct * 100, 1)}% de tus ingresos del ejercicio anterior tuvieron retención. Debes presentar el 130.`,
  };
}

/* ══════════════════════════════════════════════════════════════════
   FUNCIONES AUXILIARES PRIVADAS
══════════════════════════════════════════════════════════════════ */

/**
 * Reducción por rendimientos de actividades económicas (art. 32.2 LIRPF).
 * ⚠️ Solo llamar cuando el contribuyente cumple los requisitos.
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
 * Mínimo personal y familiar (arts. 57-61 LIRPF).
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
 * Aplica los tramos IRPF 2025 sobre la base liquidable.
 * Los tramos de tax-rules.js combinan estatal + autonómica media.
 * Para la escala autonómica real por CCAA, ver lote 16 de la auditoría.
 * @private
 */
function _calcCuotaTramos(base) {
  let cuota = 0;
  let baseRestante = base;

  for (const tramo of TRAMOS_IRPF_2025) {
    if (baseRestante <= 0) break;
    const enTramo = Math.min(baseRestante, tramo.hasta - tramo.desde);
    cuota += enTramo * tramo.tipo;
    baseRestante -= enTramo;
  }

  return cuota;
}
