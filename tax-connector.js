/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-connector.js
   Conector entre el Tax Engine y la UI existente

   RESPONSABILIDAD:
   Es el ÚNICO punto de contacto entre el engine y el DOM de Taurix.
   Sustituye los cálculos inline de fiscal.js con llamadas al engine,
   manteniendo exactamente los mismos IDs de elemento que ya existen
   en el HTML para no romper nada.

   DISEÑO:
   - refreshIVA_engine()  → reemplaza refreshIVA()  de fiscal.js
   - refreshIRPF_engine() → reemplaza refreshIRPF() de fiscal.js
   - refreshAlertas_engine() → complementa refreshAlertas() de alertas.js

   MIGRACIÓN:
   En fiscal.js, reemplaza las llamadas a calcModelo303Completo/calcIRPF
   con imports de estas funciones. O bien en main.js importa este módulo
   y llama a estas funciones en lugar de las de fiscal.js.

   COMPATIBILIDAD: No rompe NADA del código existente.
   Los IDs del DOM que se actualizan son idénticos a los ya existentes.
   ═══════════════════════════════════════════════════════════════════ */

import { getYear, getTrim, fmt, TRIM_LABELS, TRIM_PLAZOS } from "../utils.js";
import { buildTaxContext } from "./tax-context.js";
import { persistirAlertas } from "./tax-data.js";

/* ══════════════════════════════════════════════════════════════════
   CACHÉ EN MEMORIA
   Evita recalcular si year+trim no han cambiado desde la última vez.
   La caché se invalida al cambiar el selector de año o trimestre.
══════════════════════════════════════════════════════════════════ */

let _cache = null;
let _cacheKey = null;

export function invalidarCache() {
  _cache = null;
  _cacheKey = null;
}

/**
 * Obtiene el contexto fiscal completo, usando caché si es posible.
 * @param {number} year
 * @param {string} trim
 * @param {Object} [opts]
 * @returns {Promise<import('./tax-context.js').TaxContextResult>}
 */
async function _getContext(year, trim, opts = {}) {
  const key = `${year}_${trim}`;
  if (_cache && _cacheKey === key) return _cache;
  const ctx = await buildTaxContext(year, trim, opts);
  _cache    = ctx;
  _cacheKey = key;
  return ctx;
}

/* ══════════════════════════════════════════════════════════════════
   REFRESH IVA (reemplaza refreshIVA de fiscal.js)
   Mantiene exactamente los mismos IDs del DOM.
══════════════════════════════════════════════════════════════════ */

/**
 * Recalcula el Modelo 303 con el engine y actualiza el DOM.
 * Drop-in replacement de refreshIVA() en fiscal.js.
 *
 * @param {Object} [opts]
 * @param {number} [opts.compensacionAnterior=0]
 */
export async function refreshIVA_engine(opts = {}) {
  const year = getYear();
  const trim = getTrim();

  const ctx = await _getContext(year, trim, {
    compensacionAnterior303: opts.compensacionAnterior ?? 0,
  });

  const { r303 } = ctx;

  // ── Actualizar DOM — mismos IDs que fiscal.js ──────────────────
  const s = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmt(v);
  };

  // IVA repercutido
  s("iva21Rep",      r303.repercutido.tipo21);
  s("iva10Rep",      r303.repercutido.tipo10);
  s("iva4Rep",       r303.repercutido.tipo4);
  s("ivaTotalRep",   r303.repercutido.total);

  // IVA soportado
  s("ivaSoportadoInt", r303.soportado.interior);
  s("ivaSoportadoImp", r303.soportado.importacion);
  s("ivaTotalSop",     r303.soportado.total);

  // Resumen
  s("ivaRepSumary", r303.repercutido.total);
  s("ivaSopSumary", r303.soportado.total);

  // Por tipo de operación
  s("ivaOpNac",  r303.por_operacion?.nacional             ?? 0);
  s("ivaOpIC",   (r303.por_operacion?.intracomunitaria_entrega ?? 0) +
                 (r303.por_operacion?.intracomunitaria_adq    ?? 0));
  s("ivaOpExp",  r303.por_operacion?.exportacion          ?? 0);
  s("ivaOpISP",  r303.por_operacion?.isp_emitida          ?? 0);

  // Resultado y estado
  const resEl = document.getElementById("ivaResultado303");
  const stEl  = document.getElementById("ivaEstado303");
  if (resEl) resEl.textContent = fmt(r303.resultado_final);
  if (stEl) {
    if (r303.resultado_final > 0) {
      stEl.innerHTML = `<span class="badge b-pagar">A ingresar · Modelo 303</span>`;
    } else if (r303.resultado_final < 0 && trim === "T4") {
      stEl.innerHTML = `<span class="badge b-compen">A devolver · Art. 115 LIVA</span>`;
    } else {
      const sig = { T1:"T2", T2:"T3", T3:"T4", T4:"próximo T1" }[trim];
      stEl.innerHTML = `<span class="badge b-compen">A compensar en ${sig}</span>`;
    }
  }

  // Plazo y periodo
  const deadEl = document.getElementById("ivaDeadline");
  const lblEl  = document.getElementById("ivaPeriodoLabel");
  if (deadEl) deadEl.textContent = `Plazo de presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // Casillas numéricas reales del Modelo 303
  _actualizarCasillas303(r303);

  // Alertas IVA en el panel fiscal
  _renderAlertasFiscalPanel("ivaAlertasEl", ctx.alertas, ["prorrata", "isp", "info"]);

  // Prorrata
  if (ctx.hayProrrata && ctx.prorrata) {
    const prEl = document.getElementById("ivaProrrataPct");
    if (prEl) prEl.textContent = `${ctx.prorrata.redondeado}%`;
    const prWrap = document.getElementById("ivaProrrtaWrap");
    if (prWrap) prWrap.style.display = "";
  }
}

/* ══════════════════════════════════════════════════════════════════
   REFRESH IRPF (reemplaza refreshIRPF de fiscal.js)
   Mantiene exactamente los mismos IDs del DOM.
══════════════════════════════════════════════════════════════════ */

/**
 * Recalcula el Modelo 130 con el engine y actualiza el DOM.
 * Drop-in replacement de refreshIRPF() en fiscal.js.
 */
export async function refreshIRPF_engine() {
  const year = getYear();
  const trim = getTrim();

  const ctx = await _getContext(year, trim);
  const { r130, proyeccion } = ctx;

  const s = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmt(v);
  };

  // ── Acumulados YTD ─────────────────────────────────────────────
  // El engine calcula YTD. Los campos que fiscal.js llama "periodo" y "acum"
  // los reconstruimos: periodo = total - previos, pero el engine ya tiene el total.
  // Para mantener compatibilidad con el DOM existente:
  s("irpfIngTotal",    r130.ingresos_total);
  s("irpfGstTotal",    r130.gastos_total);
  s("irpfRetAcum",     r130.retenciones_acum);
  s("irpfRendNeto",    r130.rend_neto_acum);
  s("irpfPagoFrac",    r130.pago_fraccionado);
  s("irpfMenosRet",    r130.retenciones_acum);
  s("irpfMenosPagAnt", r130.pagos_previos);

  // ── Resultado y estado ─────────────────────────────────────────
  const resEl = document.getElementById("irpfResultado130");
  const stEl  = document.getElementById("irpfEstado130");
  if (resEl) resEl.textContent = fmt(r130.resultado);
  if (stEl) {
    stEl.innerHTML = r130.resultado > 0
      ? `<span class="badge b-pagar">A ingresar · Modelo 130</span>`
      : `<span class="badge b-compen">Sin pago · Resultado ≤ 0 (no negativo)</span>`;
  }

  // ── Plazo y periodo ────────────────────────────────────────────
  const deadEl = document.getElementById("irpfDeadline");
  const lblEl  = document.getElementById("irpfPeriodoLabel");
  if (deadEl) deadEl.textContent = `Plazo de presentación: ${TRIM_PLAZOS[trim]}`;
  if (lblEl)  lblEl.textContent  = `${TRIM_LABELS[trim]} · ${year}`;

  // ── Proyección anual ───────────────────────────────────────────
  const ps = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  ps("irpfProyAnual",   fmt(proyeccion.cuota_renta_estimada));
  ps("irpfTipoEf",      `${proyeccion.tipo_efectivo.toFixed(1)}%`);
  ps("irpfReservaMes",  fmt(proyeccion.reserva_mensual));
  ps("irpfCuotaRenta",  fmt(proyeccion.cuota_renta_estimada));
  ps("irpfTipoEfRenta", `${proyeccion.tipo_efectivo}%`);

  // ── Alertas IRPF en el panel fiscal ───────────────────────────
  _renderAlertasFiscalPanel("irpfAlertasEl", ctx.alertas, ["renta_alta", "retenciones_bajas", "primer_año"]);

  // ── Retención aplicable ────────────────────────────────────────
  const retEl = document.getElementById("irpfRetencionAplicable");
  if (retEl && ctx.retencion) {
    retEl.textContent = ctx.retencion.nota;
  }
}

/* ══════════════════════════════════════════════════════════════════
   REFRESH ALERTAS ENGINE
   Genera alertas del engine y las persiste en Supabase.
   A llamar desde refreshAlertas() de alertas.js (o en sustitución).
══════════════════════════════════════════════════════════════════ */

/**
 * Genera alertas del engine para el trimestre actual y las persiste.
 * No pinta el DOM — eso lo sigue haciendo alertas.js con su propio render.
 * Devuelve el array de alertas para que alertas.js pueda incluirlas
 * en su panel junto a las suyas.
 *
 * @returns {Promise<import('./tax-types.js').TaxAlert[]>}
 */
export async function refreshAlertasEngine() {
  const year = getYear();
  const trim = getTrim();
  const ctx  = await _getContext(year, trim);

  // Persistir en Supabase (asíncrono, no bloqueamos la UI)
  persistirAlertas(ctx.alertas).catch(e =>
    console.warn("[tax-connector] persistirAlertas:", e.message)
  );

  // Actualizar badge del sidebar
  _actualizarBadgeAlertas(ctx.alertas);

  return ctx.alertas;
}

/* ══════════════════════════════════════════════════════════════════
   OBTENER CONTEXTO PARA CLAUDE
   Llamado desde el panel del asistente fiscal.
══════════════════════════════════════════════════════════════════ */

/**
 * Devuelve el system prompt completo con el contexto fiscal del usuario.
 * A usar en la llamada a la API de Anthropic desde el asistente fiscal.
 *
 * @returns {Promise<string>}
 */
export async function getContextoParaClaude() {
  const year = getYear();
  const trim = getTrim();
  const ctx  = await _getContext(year, trim);
  return ctx.contextoParaClaude;
}

/**
 * Devuelve el objeto TaxContextResult completo (para el panel del asistente).
 * @returns {Promise<Object>}
 */
export async function getTaxContextResult() {
  const year = getYear();
  const trim = getTrim();
  return _getContext(year, trim);
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS PRIVADOS
══════════════════════════════════════════════════════════════════ */

/**
 * Actualiza las casillas numéricas reales del Modelo 303 en el DOM.
 * Mismos IDs que actualizarCasillas303() en fiscal.js.
 * @private
 */
function _actualizarCasillas303(r303) {
  const cas = {
    "cas1":  (r303.por_operacion?.nacional ?? 0).toFixed(2),
    "cas3":  (r303.repercutido.tipo21).toFixed(2),
    "cas5":  (r303.repercutido.tipo10).toFixed(2),
    "cas7":  (r303.repercutido.tipo4).toFixed(2),
    "cas9":  (r303.repercutido.total).toFixed(2),
    "cas28": (r303.soportado.interior).toFixed(2),
    "cas29": (r303.soportado.importacion).toFixed(2),
    "cas40": (r303.soportado.total).toFixed(2),
    "cas64": (r303.resultado_final).toFixed(2),
    "cas78": (Math.abs(r303.compensacion_anterior ?? 0)).toFixed(2),
  };
  Object.entries(cas).forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  });
}

/**
 * Renderiza las alertas del engine en el panel fiscal (dentro de la vista IVA/IRPF).
 * Solo muestra los tipos indicados para no mezclar alertas de IVA en el panel de IRPF.
 * @private
 */
function _renderAlertasFiscalPanel(elementId, alertas, tipos) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const filtradas = alertas.filter(a => tipos.includes(a.tipo));
  if (!filtradas.length) { el.innerHTML = ""; return; }

  const clasePorSeveridad = {
    critica: "alerta-fiscal--urgente",
    alta:    "alerta-fiscal--aviso",
    media:   "alerta-fiscal--aviso",
    baja:    "alerta-fiscal--info",
  };

  el.innerHTML = filtradas.map(a => `
    <div class="alerta-fiscal ${clasePorSeveridad[a.severidad] ?? "alerta-fiscal--info"}" style="margin-bottom:8px">
      <div class="af-body">
        <div class="af-desc">${a.mensaje}</div>
        ${a.norma ? `<div style="font-size:11px;color:var(--t4);margin-top:4px">${a.norma}</div>` : ""}
      </div>
    </div>`).join("");
}

/**
 * Actualiza el badge numérico del sidebar con el conteo de alertas críticas + altas.
 * Mismos IDs que usa alertas.js.
 * @private
 */
function _actualizarBadgeAlertas(alertas) {
  const urgentes = alertas.filter(a =>
    a.severidad === "critica" || a.severidad === "alta"
  ).length;

  const badge = document.getElementById("snBadgeAlertas");
  const dot   = document.getElementById("notifDot");
  if (badge) { badge.textContent = urgentes || ""; badge.style.display = urgentes ? "" : "none"; }
  if (dot)   dot.style.display = urgentes ? "" : "none";
}
