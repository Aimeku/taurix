/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-context.js
   Serialización del contexto fiscal completo para Claude

   RESPONSABILIDAD ÚNICA:
   Orquestar todas las funciones del engine y producir un objeto
   TaxContextForClaude serializable — listo para enviarse como
   system prompt o user message a la API de Anthropic.

   FLUJO:
   1. Recibe year + trim del caller (la UI)
   2. Llama a tax-data.js para obtener los documentos
   3. Llama a los motores (tax-iva, tax-irpf, tax-gastos)
   4. Genera alertas con tax-alerts
   5. Empaqueta todo en TaxContextForClaude
   6. Devuelve también los resultados para que la UI pueda pintarlos

   REGLA: Este módulo no toca el DOM. Recibe datos de la capa de datos
   y devuelve objetos. El conector (tax-connector.js) se encarga del DOM.
   ═══════════════════════════════════════════════════════════════════ */

import {
  getTaxDocumentsHastaTrim,
  getTaxDocumentsYear,
  getPerfilFiscal,
  getResultadoGuardado,
} from "./tax-data.js";

import { calcModelo303, detectarProrrata } from "./tax-iva.js";
import {
  calcModelo130,
  calcProyeccionAnual,
  calcRetencionAplicable,
} from "./tax-irpf.js";
import {
  clasificarGastos,
  resumenPorCategoria,
  totalDeducibilidad,
  calcAcumulado347,
  detectarProximosUmbral347,
  totalRetenciones190,
} from "./tax-gastos.js";
import {
  generarAlertas,
  serializarAlertasParaClaude,
} from "./tax-alerts.js";
import { TRIM_ORDEN } from "./tax-rules.js";

/* ══════════════════════════════════════════════════════════════════
   FUNCIÓN PRINCIPAL
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el contexto fiscal completo para un trimestre.
 * Orquesta todas las capas del engine en una sola llamada.
 *
 * @param {number} year
 * @param {string} trim  - "T1"|"T2"|"T3"|"T4"
 * @param {Object} [opts]
 * @param {number}  [opts.compensacionAnterior303=0]  - IVA negativo a compensar del trimestre anterior
 * @param {number}  [opts.pagosPrevios130=0]          - Si ya se tienen calculados externamente
 * @param {number}  [opts.pctProrrataIva=100]         - Prorrata del año en curso (si aplica)
 * @returns {Promise<TaxContextResult>}
 */
export async function buildTaxContext(year, trim, opts = {}) {
  const {
    compensacionAnterior303 = 0,
    pagosPrevios130         = 0,
    pctProrrataIva          = 100,
  } = opts;

  // ── 1. Datos ──────────────────────────────────────────────────
  const [docsAcum, docsAno, perfil] = await Promise.all([
    getTaxDocumentsHastaTrim(year, trim),   // para el 130 (YTD)
    getTaxDocumentsYear(year),              // para 347, 190, 390
    getPerfilFiscal(),
  ]);

  // Docs solo del trimestre actual (para el 303)
  const { ini: iniTrim, fin: finTrim } = _rangoTrim(year, trim);
  const docsTrim = docsAcum.filter(d => d.fecha >= iniTrim && d.fecha <= finTrim);

  // ── 2. Modelos fiscales ───────────────────────────────────────
  const r303      = calcModelo303(docsTrim, compensacionAnterior303);
  const r130      = calcModelo130(docsAcum, pagosPrevios130, trim, year);
  const proyeccion = calcProyeccionAnual(r130, trim, pagosPrevios130 + r130.resultado);
  const retencion  = calcRetencionAplicable(perfil?.fecha_alta ?? null, year);

  // ── 3. Detección de prorrata ──────────────────────────────────
  const { hayProrrata, prorrata } = detectarProrrata(r303);

  // ── 4. Gastos clasificados ────────────────────────────────────
  const recibidas = docsAcum.filter(d => d.tipo === "recibida");
  const gastosClasificados = clasificarGastos(recibidas, hayProrrata ? (prorrata?.redondeado ?? 100) : 100);
  const resumenGastos      = resumenPorCategoria(gastosClasificados);
  const totalesGastos      = totalDeducibilidad(gastosClasificados);

  // ── 5. Modelos informativos ───────────────────────────────────
  const acumulado347      = calcAcumulado347(docsAno);
  const proximosUmbral347 = detectarProximosUmbral347(docsAno);

  const emitidas = docsAno.filter(d => d.tipo === "emitida");
  const retenciones190 = totalRetenciones190(emitidas);

  // ── 6. Alertas ────────────────────────────────────────────────
  const alertas = generarAlertas({
    r303,
    r130,
    proyeccion,
    perfil,
    docs:              docsAno,
    acumulado347,
    proximosUmbral347,
    trim,
    year,
  });

  // ── 7. Construir contexto para Claude ─────────────────────────
  const contextoParaClaude = _buildClaudeContext({
    perfil,
    trim,
    year,
    r303,
    r130,
    proyeccion,
    retencion,
    prorrata: hayProrrata ? prorrata : null,
    alertas,
    resumenGastos,
    totalesGastos,
    acumulado347,
    retenciones190,
  });

  return {
    // Resultados para la UI (tax-connector.js los consume para pintar el DOM)
    r303,
    r130,
    proyeccion,
    retencion,
    perfil,
    gastosClasificados,
    resumenGastos,
    totalesGastos,
    acumulado347,
    proximosUmbral347,
    retenciones190,
    alertas,
    hayProrrata,
    prorrata: hayProrrata ? prorrata : null,
    // Contexto serializado para Claude
    contextoParaClaude,
    // Metadatos
    trim,
    year,
    timestamp: new Date().toISOString(),
  };
}

/* ══════════════════════════════════════════════════════════════════
   BUILDER DEL CONTEXTO PARA CLAUDE
   Produce el texto estructurado que va al system prompt.
   Diseñado para ser denso en información pero compacto en tokens.
══════════════════════════════════════════════════════════════════ */

/**
 * @private
 */
function _buildClaudeContext(params) {
  const {
    perfil, trim, year, r303, r130, proyeccion,
    retencion, prorrata, alertas, resumenGastos,
    totalesGastos, acumulado347, retenciones190,
  } = params;

  const fmt = n => new Intl.NumberFormat("es-ES", {
    style: "currency", currency: "EUR", minimumFractionDigits: 2,
  }).format(n || 0);

  const pct = n => `${(n || 0).toFixed(2)}%`;

  const lines = [];

  // ── Perfil ──────────────────────────────────────────────────
  lines.push("=== PERFIL FISCAL ===");
  lines.push(`Nombre: ${perfil?.nombre_razon_social ?? "No configurado"}`);
  lines.push(`NIF: ${perfil?.nif ?? "—"}`);
  lines.push(`Actividad: ${perfil?.actividad ?? "—"}`);
  lines.push(`Régimen: ${_labelRegimen(perfil?.regime)}`);
  if (perfil?.fecha_alta) lines.push(`Alta en actividad: ${perfil.fecha_alta}`);
  lines.push(`Retención aplicable: ${pct(retencion.pct * 100)}${retencion.reducida ? " (reducida — primeros 3 años)" : ""}`);
  lines.push("");

  // ── Periodo ──────────────────────────────────────────────────
  lines.push("=== PERIODO ACTIVO ===");
  lines.push(`Ejercicio: ${year} · Trimestre: ${trim}`);
  lines.push("");

  // ── Modelo 303 ───────────────────────────────────────────────
  lines.push("=== MODELO 303 — IVA TRIMESTRAL ===");
  lines.push(`IVA repercutido total: ${fmt(r303.repercutido.total)}`);
  lines.push(`  · Al 21%: ${fmt(r303.repercutido.tipo21)}`);
  lines.push(`  · Al 10%: ${fmt(r303.repercutido.tipo10)}`);
  lines.push(`  · Al 4%:  ${fmt(r303.repercutido.tipo4)}`);
  lines.push(`IVA soportado deducible: ${fmt(r303.soportado.total)}`);
  lines.push(`  · Interior: ${fmt(r303.soportado.interior)}`);
  lines.push(`  · Importaciones: ${fmt(r303.soportado.importacion)}`);
  lines.push(`Resultado (cas.64): ${fmt(r303.resultado_final)} → ${r303.estado_resultado}`);
  if (r303.base_exenta > 0) lines.push(`Base exenta/IC/exportaciones: ${fmt(r303.base_exenta)}`);
  if (r303.isp?.cuota > 0)  lines.push(`ISP declarado: base ${fmt(r303.isp.base)}, cuota ${fmt(r303.isp.cuota)}`);
  if (prorrata) lines.push(`Prorrata de IVA: ${prorrata.redondeado}% (${prorrata.tipo})`);
  lines.push("");

  // ── Modelo 130 ───────────────────────────────────────────────
  lines.push("=== MODELO 130 — IRPF TRIMESTRAL (acumulado YTD) ===");
  lines.push(`Ingresos totales YTD: ${fmt(r130.ingresos_total)}`);
  lines.push(`Gastos deducibles YTD: ${fmt(r130.gastos_total)}`);
  lines.push(`Rendimiento neto acumulado: ${fmt(r130.rend_neto_acum)}`);
  lines.push(`20% s/rendimiento (cas.06): ${fmt(r130.pago_fraccionado)}`);
  lines.push(`Retenciones acumuladas (cas.07): ${fmt(r130.retenciones_acum)}`);
  lines.push(`Pagos fraccionados previos (cas.08): ${fmt(r130.pagos_previos)}`);
  lines.push(`Resultado a ingresar (cas.09): ${fmt(r130.resultado)}`);
  lines.push("");

  // ── Proyección anual ─────────────────────────────────────────
  lines.push("=== PROYECCIÓN ANUAL (extrapolación desde " + trim + ") ===");
  lines.push(`Ingresos proyectados: ${fmt(proyeccion.ingresos_proyect)}`);
  lines.push(`Rendimiento neto proyectado: ${fmt(proyeccion.rend_proyect)}`);
  lines.push(`Cuota Renta estimada (Mod.100): ${fmt(proyeccion.cuota_renta_estimada)}`);
  lines.push(`Tipo efectivo estimado: ${pct(proyeccion.tipo_efectivo)}`);
  lines.push(`Reserva mensual recomendada: ${fmt(proyeccion.reserva_mensual)}`);
  lines.push("");

  // ── Gastos clasificados ───────────────────────────────────────
  lines.push("=== GASTOS DEDUCIBLES (YTD, clasificados) ===");
  lines.push(`Total gasto base: ${fmt(totalesGastos.total_base)}`);
  lines.push(`Total deducible IRPF: ${fmt(totalesGastos.total_deducible_irpf)}`);
  lines.push(`Total IVA deducible: ${fmt(totalesGastos.total_iva_deducible)}`);
  if (totalesGastos.gasto_riesgo_alto > 0) {
    lines.push(`⚠️ Gasto en categorías de riesgo alto: ${fmt(totalesGastos.gasto_riesgo_alto)}`);
  }
  if (resumenGastos.length > 0) {
    lines.push("Desglose por categoría:");
    resumenGastos.slice(0, 8).forEach(c => {
      lines.push(`  · ${c.label}: base ${fmt(c.total_base)}, deducible ${fmt(c.total_deducible)} (${c.pct_deducible_irpf}%)${c.riesgo !== "bajo" ? " [riesgo " + c.riesgo + "]" : ""}`);
    });
  }
  lines.push("");

  // ── Modelo 347 ───────────────────────────────────────────────
  if (acumulado347.length > 0) {
    lines.push("=== MODELO 347 — OPERACIONES CON TERCEROS (YTD) ===");
    lines.push(`Operaciones que superan el umbral (${fmt(3005.06)}): ${acumulado347.length}`);
    acumulado347.slice(0, 5).forEach(r => {
      lines.push(`  · ${r.nombre} (NIF: ${r.nif || "—"}): ${fmt(r.total_operaciones)}`);
    });
    lines.push("");
  }

  // ── Modelo 190 / Retenciones ─────────────────────────────────
  if (retenciones190.total_retenido > 0) {
    lines.push("=== RETENCIONES (para Modelo 190) ===");
    lines.push(`Base total con retenciones: ${fmt(retenciones190.total_base)}`);
    lines.push(`Total retenciones soportadas: ${fmt(retenciones190.total_retenido)}`);
    lines.push(`Tipo medio de retención: ${pct(retenciones190.tipo_medio)}`);
    lines.push("");
  }

  // ── Alertas activas ───────────────────────────────────────────
  lines.push("=== ALERTAS FISCALES ACTIVAS ===");
  const alertasTexto = serializarAlertasParaClaude(alertas);
  lines.push(alertasTexto);
  lines.push("");

  // ── Instrucción para Claude ───────────────────────────────────
  lines.push("=== INSTRUCCIONES ===");
  lines.push("Eres el asesor fiscal integrado en Taurix. Tienes acceso a los datos reales del contribuyente que se muestran arriba.");
  lines.push("Cuando respondas:");
  lines.push("1. Usa los importes y porcentajes reales del contexto, no valores genéricos.");
  lines.push("2. Cita la norma legal relevante cuando sea pertinente (LIRPF, LIVA, artículos concretos).");
  lines.push("3. Diferencia siempre entre lo que es seguro y lo que es una estimación.");
  lines.push("4. Si el usuario pregunta sobre algo que no está en el contexto (datos futuros, CCAA específica, etc.), indícalo claramente.");
  lines.push("5. Responde en español.");

  return lines.join("\n");
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */

function _rangoTrim(year, trim) {
  const rangos = {
    T1: ["01-01", "03-31"],
    T2: ["04-01", "06-30"],
    T3: ["07-01", "09-30"],
    T4: ["10-01", "12-31"],
  };
  const [ini, fin] = rangos[trim];
  return { ini: `${year}-${ini}`, fin: `${year}-${fin}` };
}

function _labelRegimen(regime) {
  const labels = {
    autonomo_ed:  "Autónomo · Estimación Directa",
    autonomo_es:  "Autónomo · Estimación Simplificada",
    sociedad:     "Sociedad Limitada / SA",
    autonomo_mod: "Autónomo · Módulos",
    estimacion_directa_simplificada: "Autónomo · Estimación Directa Simplificada",
  };
  return labels[regime] ?? regime ?? "No configurado";
}
