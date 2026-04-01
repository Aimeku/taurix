/* ═══════════════════════════════════════════════════════
   TAURIX · gestor-score.js

   Fiscal Health Score: clasifica la salud fiscal de un
   cliente a partir de los datos ya calculados en cartera.

   calcularScoreFiscal(datos) — usa datos ya cargados,
   sin queries adicionales.

   calcularScoreFiscalAsync(empresa_id, year, trim) —
   versión que carga sus propios datos (uso standalone).
   ═══════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────
   CONSTANTES
────────────────────────────────────────── */
const PENALIZACIONES = {
  sin_gastos:             20,
  margen_excesivo:        15,
  iva_incoherente:        15,
  solicitudes_pendientes: 10,
  alerta:                 10,
  sin_ingresos:           25,
};

// Fecha de inicio de cada trimestre (mes-día)
const TRIM_INICIO = { T1: '01-01', T2: '04-01', T3: '07-01', T4: '10-01' };

/**
 * Días transcurridos desde el inicio del trimestre hasta hoy.
 * Devuelve null si no se puede calcular (datos insuficientes).
 */
function _diasDesdeInicioTrim(year, trim) {
  if (!year || !trim || !TRIM_INICIO[trim]) return null;
  const inicio = new Date(`${year}-${TRIM_INICIO[trim]}T00:00:00`);
  const hoy    = new Date();
  return Math.floor((hoy - inicio) / 86400000);
}

/* ──────────────────────────────────────────
   FUNCIÓN PRINCIPAL — usa datos precalculados
   Llamar desde gestor-cartera.js sin queries extra
────────────────────────────────────────── */

/**
 * Calcula el score fiscal a partir de datos ya disponibles en la cartera.
 *
 * @param {object} datos  Objeto cliente de loadCarteraGestor()
 * @param {number} [datos.year]   Año del trimestre evaluado
 * @param {string} [datos.trim]   Trimestre evaluado ('T1'–'T4')
 * @returns {{ score: number, estado: string, motivos: string[] }}
 */
export function calcularScoreFiscal(datos) {
  const {
    facturacion_trim        = 0,
    gastos_trim             = 0,
    iva_estimado            = 0,
    alertas                 = [],
    solicitudes_pendientes  = 0,
    facturas_emitidas_count = 0,
    year                    = null,
    trim                    = null,
  } = datos;

  // ── Inicio de trimestre: período de gracia de 20 días ──
  // Si el trimestre lleva menos de 20 días activo, no penalizar por falta de actividad.
  const diasTrim        = _diasDesdeInicioTrim(year, trim);
  const enPeriodoGracia = diasTrim !== null && diasTrim < 20;

  let score   = 100;
  const motivos = [];

  // ── Sin gastos ──
  if (!enPeriodoGracia && facturacion_trim > 0 && gastos_trim === 0) {
    score -= PENALIZACIONES.sin_gastos;
    motivos.push('Sin gastos registrados en el trimestre');
  }

  // ── Sin actividad ──
  if (facturas_emitidas_count === 0 && gastos_trim === 0) {
    if (!enPeriodoGracia) {
      score -= PENALIZACIONES.sin_ingresos;
      motivos.push('Sin actividad registrada en el trimestre');
    }
    // En período de gracia: no penalizar ni añadir motivo
  } else if (facturas_emitidas_count === 0 && gastos_trim > 0) {
    score -= 15;
    motivos.push('Sin facturas emitidas (solo gastos)');
  }

  // ── Margen bruto > 80% ──
  if (facturacion_trim > 0) {
    const margen = (facturacion_trim - gastos_trim) / facturacion_trim;
    if (margen > 0.80) {
      score -= PENALIZACIONES.margen_excesivo;
      motivos.push(`Margen bruto muy alto (${Math.round(margen * 100)}%) — posibles gastos no registrados`);
    }
  }

  // ── IVA incoherente ──
  if (facturacion_trim > 0 && iva_estimado > facturacion_trim * 0.40) {
    score -= PENALIZACIONES.iva_incoherente;
    motivos.push('IVA estimado inusualmente alto respecto a la facturación');
  }
  if (iva_estimado < -5000) {
    score -= 10;
    motivos.push('IVA muy negativo — revisar facturas recibidas');
  }

  // ── Solicitudes pendientes ──
  if (solicitudes_pendientes > 0) {
    const pen = Math.min(solicitudes_pendientes * PENALIZACIONES.solicitudes_pendientes, 20);
    score -= pen;
    motivos.push(`${solicitudes_pendientes} solicitud${solicitudes_pendientes > 1 ? 'es' : ''} de documentos sin respuesta`);
  }

  // ── Alertas detectadas ──
  if (alertas.length > 0) {
    const pen = Math.min(alertas.length * PENALIZACIONES.alerta, 30);
    score -= pen;
  }

  score = Math.max(0, Math.min(100, score));

  let estado = score >= 80 ? 'ok'
             : score >= 50 ? 'revisar'
             :               'riesgo';

  // En período de gracia: nunca mostrar riesgo aunque el score sea bajo
  if (enPeriodoGracia && estado === 'riesgo') estado = 'revisar';

  return { score, estado, motivos, enPeriodoGracia: !!enPeriodoGracia };
}

/* ──────────────────────────────────────────
   VERSIÓN ASYNC STANDALONE
   Para uso desde revision-cliente u otras vistas
   que necesitan el score sin pasar por la cartera
────────────────────────────────────────── */

export async function calcularScoreFiscalAsync(empresa_id, year, trim) {
  const { supabase } = await import('./supabase.js');
  const { getFacturasTrim, getFechaRango } = await import('./utils.js');
  const { calcularAlertasCliente } = await import('./gestor-alertas.js');

  // Usar empresa_id directamente para las queries
  const { ini, fin } = getFechaRango(year, trim);

  const [facRes, solRes, alertas] = await Promise.all([
    supabase.from('facturas')
      .select('tipo, base, iva, estado, cliente_nif')
      .eq('empresa_id', empresa_id)
      .gte('fecha', ini).lte('fecha', fin),

    supabase.from('solicitudes_documentos')
      .select('id')
      .eq('empresa_id', empresa_id)
      .eq('estado', 'pendiente'),

    calcularAlertasCliente(empresa_id),
  ]);

  const facs     = facRes.data || [];
  const emitidas = facs.filter(f => f.tipo === 'emitida' && f.estado === 'emitida');
  const recibidas= facs.filter(f => f.tipo === 'recibida');

  const facturacion_trim = emitidas.reduce((s, f) => s + (f.base || 0), 0);
  const gastos_trim      = recibidas.reduce((s, f) => s + (f.base || 0), 0);
  const ivaRep = emitidas.reduce((s, f) => s + (f.base||0)*(f.iva||0)/100, 0);
  const ivaSop = recibidas.reduce((s, f) => s + (f.base||0)*(f.iva||0)/100, 0);

  return calcularScoreFiscal({
    facturacion_trim,
    gastos_trim,
    iva_estimado:            ivaRep - ivaSop,
    alertas,
    solicitudes_pendientes:  solRes.data?.length || 0,
    facturas_emitidas_count: emitidas.length,
  });
}

/* ──────────────────────────────────────────
   RENDER HELPERS — badge y barra visual
────────────────────────────────────────── */

const SCORE_COLOR = { ok: '#059669', revisar: '#d97706', riesgo: '#dc2626' };
const SCORE_BG    = { ok: '#f0fdf4', revisar: '#fefce8', riesgo: '#fef2f2' };
const SCORE_LABEL = { ok: 'OK',      revisar: 'Revisar', riesgo: 'Riesgo'  };

/**
 * HTML del badge de estado (inline, sin contenedor extra).
 * @param {'ok'|'revisar'|'riesgo'} estado
 * @param {number} score
 */
export function scoreBadgeHtml(estado, score) {
  const color = SCORE_COLOR[estado] || '#6b7280';
  const bg    = SCORE_BG[estado]    || '#f3f4f6';
  const label = SCORE_LABEL[estado] || estado;
  return `
    <span style="display:inline-flex;align-items:center;gap:4px;
                 background:${bg};color:${color};
                 font-size:10px;font-weight:800;
                 padding:3px 8px;border-radius:6px;
                 border:1px solid ${color}33;white-space:nowrap">
      <span style="width:5px;height:5px;border-radius:50%;
                   background:${color};flex-shrink:0"></span>
      ${label} · ${score}
    </span>`;
}

/**
 * HTML de la barra de progreso del score.
 * @param {number} score  0-100
 * @param {'ok'|'revisar'|'riesgo'} estado
 */
export function scoreBarra(score, estado) {
  const color = SCORE_COLOR[estado] || '#6b7280';
  return `
    <div style="height:3px;background:var(--brd);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${score}%;background:${color};
                  border-radius:2px;transition:width .4s"></div>
    </div>`;
}
