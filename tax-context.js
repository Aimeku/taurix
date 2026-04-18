/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-context.js
   Serialización del contexto fiscal completo para Claude

   FLUJO:
   - Autónomo → 303 + 130 (IRPF fraccionado) + proyección renta
   - Sociedad  → 303 + IS (Impuesto Sociedades) + pagos frac. 202
   ═══════════════════════════════════════════════════════════════════ */

import {
  getTaxDocumentsHastaTrim,
  getTaxDocumentsYear,
  getPerfilFiscal,
  getResultadoGuardado,
} from "./tax-data.js";

import { supabase } from "../supabase.js";

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
import {
  getTipoContribuyente, GRUPOS,
  esSociedad, esAutonomo,
  aplicaGastoEDS, getTipoIS, getModelosObligatorios, labelRegimen,
} from "./tax-regime.js";

/* ══════════════════════════════════════════════════════════════════
   FUNCIÓN PRINCIPAL
══════════════════════════════════════════════════════════════════ */

export async function buildTaxContext(year, trim, opts = {}) {
  const {
    compensacionAnterior303 = 0,
    pagosPrevios130         = 0,
    pctProrrataIva          = 100,
  } = opts;

  // ── 1. Datos base ─────────────────────────────────────────────
  const [docsAcum, docsAno, perfil] = await Promise.all([
    getTaxDocumentsHastaTrim(year, trim),
    getTaxDocumentsYear(year),
    getPerfilFiscal(),
  ]);

  const { ini: iniTrim, fin: finTrim } = _rangoTrim(year, trim);
  const docsTrim = docsAcum.filter(d => d.fecha >= iniTrim && d.fecha <= finTrim);

  // ── 2. Detectar régimen — via tax-regime.js (única fuente de verdad) ──
  const regime   = perfil?.regime ?? "autonomo_ed";
  const tipoContrib = getTipoContribuyente(regime);
  const _esSociedad = tipoContrib === GRUPOS.SOCIEDAD;
  // _esModulos siempre false — autonomo_mod desactivado (tax-regime.js lo mapea a AUTONOMO)
  const _esModulos  = false;
  // autonomo_es aplica 5% adicional de gastos de difícil justificación
  const _eds5pct    = aplicaGastoEDS(regime);

  // ── 3. IVA — igual para todos los regímenes ───────────────────
  const r303 = calcModelo303(docsTrim, compensacionAnterior303);
  const { hayProrrata, prorrata } = detectarProrrata(r303);

  // ── 4. Impuesto directo — ramificación por régimen ────────────
  const retencion = calcRetencionAplicable(perfil?.fecha_alta ?? null, year);
  let r130       = null;
  let proyeccion = null;
  let rIS        = null;

  if (_esSociedad) {
    // SOCIEDAD (SL/SA): IS (LIS 27/2014) — no presenta 130
    const _ctx = _getQueryCtx();
    rIS = await _calcIS(year, _ctx);
  } else {
    // AUTÓNOMO (ED / ES): Modelo 130 — 20% rendimiento neto acumulado (art. 110 LIRPF)
    // autonomo_mod desactivado → cae aquí también (tax-regime.js lo mapea a AUTONOMO)
    // autonomo_es: 5% gastos EDS se aplica en simulador Renta, no en el 130
    r130       = calcModelo130(docsAcum, pagosPrevios130, trim, year);
    proyeccion = calcProyeccionAnual(r130, trim, pagosPrevios130 + r130.resultado);
  }

  // ── 5. Gastos clasificados ────────────────────────────────────
  const recibidas = docsAcum.filter(d => d.tipo === "recibida");
  const gastosClasificados = clasificarGastos(recibidas, hayProrrata ? (prorrata?.redondeado ?? 100) : 100);
  const resumenGastos      = resumenPorCategoria(gastosClasificados);
  const totalesGastos      = totalDeducibilidad(gastosClasificados);

  // ── 6. Modelos informativos ───────────────────────────────────
  const acumulado347      = calcAcumulado347(docsAno);
  const proximosUmbral347 = detectarProximosUmbral347(docsAno);
  const emitidas          = docsAno.filter(d => d.tipo === "emitida");
  const retenciones190    = totalRetenciones190(emitidas);

  // ── 7. Alertas ────────────────────────────────────────────────
  const alertas = generarAlertas({
    r303,
    r130:       r130 ?? _r130Vacio(),
    proyeccion: proyeccion ?? _proyeccionVacia(),
    perfil,
    docs:              docsAno,
    acumulado347,
    proximosUmbral347,
    trim,
    year,
  });

  if (_esSociedad && rIS) {
    _alertasIS(rIS, trim, year, alertas);
  }
  // ── 8. Contexto para Claude ───────────────────────────────────
  const modelos = getModelosObligatorios(regime);
  const contextoParaClaude = _buildClaudeContext({
    perfil, trim, year,
    esSociedad: _esSociedad,
    esModulos:  _esModulos,
    eds5pct:    _eds5pct,
    modelos,
    r303,
    r130:       r130 ?? _r130Vacio(),
    proyeccion: proyeccion ?? _proyeccionVacia(),
    rIS,
    retencion,
    prorrata:   hayProrrata ? prorrata : null,
    alertas,
    resumenGastos,
    totalesGastos,
    acumulado347,
    retenciones190,
  });

  return {
    r303,
    r130:       r130 ?? _r130Vacio(),
    proyeccion: proyeccion ?? _proyeccionVacia(),
    rIS,
    esSociedad:  _esSociedad,
    esModulos:   _esModulos,
    tipoContrib,
    regime,
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
    prorrata:   hayProrrata ? prorrata : null,
    contextoParaClaude,
    trim,
    year,
    timestamp:  new Date().toISOString(),
  };
}

/* ══════════════════════════════════════════════════════════════════
   CÁLCULO IS — Impuesto sobre Sociedades
   Ley 27/2014 — Tipo general 25%, PYME 23% si CN < 1M €
   Misma lógica que dashboard.js::refreshIS() pero sin DOM
══════════════════════════════════════════════════════════════════ */

async function _calcIS(year, ctx) {
  // ctx viene de buildTaxContext — mismo que usa tax-data para 303/130
  // Si no se pasa, calcularlo (por compatibilidad)
  ctx = ctx ?? _getQueryCtx();
  try {

    const [fR, nR, bR] = await Promise.all([
      supabase.from("facturas")
        .select("tipo,base,iva,estado,irpf,irpf_retencion")
        .eq(ctx.field, ctx.value)
        .gte("fecha", `${year}-01-01`)
        .lte("fecha", `${year}-12-31`),
      // Taurix no gestiona nóminas (SaaS fiscal, no laboral).
      // Devolvemos array vacío para preservar la shape del destructuring.
      Promise.resolve({ data: [], error: null }),
      supabase.from("bienes_inversion")
        .select("valor_adquisicion,coeficiente,tipo_bien")
        .eq(ctx.field, ctx.value),
    ]);

    const facs   = fR.data  || [];
    const noms   = nR.data  || [];
    const bienes = bR.data  || [];

    const ingresos = facs
      .filter(f => f.tipo === "emitida" && f.estado === "emitida")
      .reduce((a, f) => a + (f.base || 0), 0);

    const gastos_explot = facs
      .filter(f => f.tipo === "recibida")
      .reduce((a, f) => a + (f.base || 0), 0);

    // gastos_personal queda en 0 porque Taurix no registra nóminas.
    // Si el usuario tiene empleados y quiere estimar el IS, debe
    // darlos de alta como facturas recibidas con concepto "nóminas".
    const gastos_personal = noms
      .reduce((a, n) => a + (n.salario_bruto || 0) + (n.ss_empresa || 0), 0);

    const amortizaciones = bienes
      .reduce((a, b) => a + (b.valor_adquisicion || 0) * _coefAmortIS(b.tipo_bien, b.coeficiente) / 100, 0);

    const total_gastos = gastos_explot + gastos_personal + amortizaciones;
    const baii         = ingresos - total_gastos;
    const base_imponible = Math.max(0, baii);

    // Tipo: 23% PYME (CN < 1M €, art. 29.1 LIS), 25% general
    const es_pyme       = ingresos < 1_000_000;
    const tipo_is       = es_pyme ? 0.23 : 0.25;
    const cuota_integra = base_imponible * tipo_is;

    const retenciones = facs
      .filter(f => f.tipo === "emitida" && f.estado === "emitida")
      .reduce((a, f) => a + (f.base || 0) * ((f.irpf_retencion || f.irpf || 0) / 100), 0);

    const cuota_diferencial  = Math.max(0, cuota_integra - retenciones);
    const tipo_efectivo      = ingresos > 0 ? (cuota_integra / ingresos) * 100 : 0;
    // Pago fraccionado 202: 18% cuota íntegra año anterior (art. 40 LIS)
    // Usamos la cuota actual como estimación
    const pago_fraccionado_202 = cuota_integra * 0.18;

    return {
      ingresos, gastos_explot, gastos_personal, amortizaciones,
      total_gastos, baii, bai: baii,
      base_imponible, tipo_is, tipo_is_pct: tipo_is * 100, es_pyme,
      cuota_integra, retenciones, pagos_fraccionados: 0,
      cuota_diferencial, tipo_efectivo, pago_fraccionado_202,
      norma: "Ley 27/2014 (LIS) · Art. 29 (tipo) · Art. 40 (pagos fraccionados)",
    };
  } catch (err) {
    console.error("[tax-context] _calcIS:", err);
    return _isVacio();
  }
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS IS
══════════════════════════════════════════════════════════════════ */

function _alertasIS(rIS, trim, year, alertas) {
  const fmt = n => new Intl.NumberFormat("es-ES", { style:"currency", currency:"EUR", minimumFractionDigits:2 }).format(n||0);
  const plazos202 = { T1:"20 de abril", T2:"20 de octubre", T3:"20 de diciembre" };

  if (rIS.cuota_integra > 0 && plazos202[trim]) {
    alertas.push({
      tipo: "is_pago_fraccionado", severidad: "alta",
      titulo: "Modelo 202 — Pago fraccionado IS",
      mensaje: `Pago fraccionado IS estimado: ${fmt(rIS.pago_fraccionado_202)}. Plazo: ${plazos202[trim]} de ${year}. Cuota íntegra base: ${fmt(rIS.cuota_integra)} al ${rIS.tipo_is_pct}%.`,
      norma: "Art. 40 LIS · Ley 27/2014",
    });
  }

  if (trim === "T4") {
    alertas.push({
      tipo: "is_modelo_200", severidad: "media",
      titulo: "Modelo 200 — Declaración IS anual",
      mensaje: `El Modelo 200 se presenta en julio de ${year + 1} (25 días tras 6 meses del cierre, art. 124 LIS). Cuota diferencial estimada: ${fmt(rIS.cuota_diferencial)}.`,
      norma: "Art. 124 LIS · Ley 27/2014",
    });
  }
}

/* ══════════════════════════════════════════════════════════════════
   BUILDER CONTEXTO CLAUDE — ramifica por régimen
══════════════════════════════════════════════════════════════════ */

function _buildClaudeContext(params) {
  const {
    perfil, trim, year, esSociedad, esModulos, eds5pct, modelos,
    r303, r130, proyeccion, rIS,
    retencion, prorrata, alertas,
    resumenGastos, totalesGastos,
    acumulado347, retenciones190,
  } = params;

  const fmt = n => new Intl.NumberFormat("es-ES", { style:"currency", currency:"EUR", minimumFractionDigits:2 }).format(n||0);
  const pct = n => `${(n||0).toFixed(2)}%`;
  const lines = [];

  lines.push("=== PERFIL FISCAL ===");
  lines.push(`Nombre: ${perfil?.nombre_razon_social ?? "No configurado"}`);
  lines.push(`NIF: ${perfil?.nif ?? "—"}`);
  lines.push(`Actividad: ${perfil?.actividad ?? "—"}`);
  lines.push(`Régimen: ${_labelRegimen(perfil?.regime)}`);
  const _tipoLabel = esSociedad
    ? "PERSONA JURÍDICA (SL/SA) — tributa IS, NO presenta Mod.130 ni Mod.131"
      : eds5pct
        ? "PERSONA FÍSICA — Autónomo Est. Simplificada, tributa IRPF Mod.130 (+5% gastos difícil just.)"
        : "PERSONA FÍSICA — Autónomo Est. Directa, tributa IRPF Mod.130";
  lines.push(`Tipo contribuyente: ${_tipoLabel}`);
  if (modelos) {
    lines.push(`Modelos obligatorios trimestrales: ${modelos.trimestrales.join(", ")}`);
    lines.push(`Modelos obligatorios anuales: ${modelos.anuales.join(", ")}`);
  }
  if (!esSociedad && perfil?.fecha_alta) lines.push(`Alta actividad: ${perfil.fecha_alta}`);
  if (!esSociedad) lines.push(`Retención aplicable: ${pct(retencion.pct * 100)}${retencion.reducida ? " (reducida)" : ""}`);
  lines.push("");

  lines.push("=== PERIODO ACTIVO ===");
  lines.push(`Ejercicio: ${year} · Trimestre: ${trim}`);
  lines.push("");

  // IVA — igual para todos
  lines.push("=== MODELO 303 — IVA TRIMESTRAL ===");
  lines.push(`IVA repercutido total: ${fmt(r303.repercutido.total)}`);
  lines.push(`  · 21%: ${fmt(r303.repercutido.tipo21)} · 10%: ${fmt(r303.repercutido.tipo10)} · 4%: ${fmt(r303.repercutido.tipo4)}`);
  lines.push(`IVA soportado deducible: ${fmt(r303.soportado.total)}`);
  lines.push(`  · Interior: ${fmt(r303.soportado.interior)} · Importaciones: ${fmt(r303.soportado.importacion)}`);
  lines.push(`Resultado cas.64: ${fmt(r303.resultado_final)} → ${r303.estado_resultado}`);
  if (prorrata) lines.push(`Prorrata IVA: ${prorrata.redondeado}% (${prorrata.tipo})`);
  lines.push("");

  // Impuesto directo — ramificación
  if (esSociedad) {
    lines.push("=== IMPUESTO SOBRE SOCIEDADES (LIS 27/2014) ===");
    lines.push("⚠️ SOCIEDAD: NO presenta Modelo 130. Presenta Modelo 202 (pagos fraccionados) y Modelo 200 (anual).");
    lines.push(`Ingresos explotación: ${fmt(rIS?.ingresos ?? 0)}`);
    lines.push(`Gastos explotación: ${fmt(rIS?.gastos_explot ?? 0)}`);
    lines.push(`Gastos personal: ${fmt(rIS?.gastos_personal ?? 0)}`);
    lines.push(`Amortizaciones: ${fmt(rIS?.amortizaciones ?? 0)}`);
    lines.push(`BAII: ${fmt(rIS?.baii ?? 0)}`);
    lines.push(`Base imponible estimada: ${fmt(rIS?.base_imponible ?? 0)}`);
    lines.push(`Tipo IS: ${pct(rIS?.tipo_is_pct ?? 25)}${rIS?.es_pyme ? " (PYME art.29.1 LIS)" : " (general art.29 LIS)"}`);
    lines.push(`Cuota íntegra: ${fmt(rIS?.cuota_integra ?? 0)}`);
    lines.push(`Retenciones soportadas: ${fmt(rIS?.retenciones ?? 0)}`);
    lines.push(`Cuota diferencial Mod.200: ${fmt(rIS?.cuota_diferencial ?? 0)}`);
    lines.push(`Tipo efectivo: ${pct(rIS?.tipo_efectivo ?? 0)}`);
    lines.push(`Pago fraccionado Mod.202 estimado: ${fmt(rIS?.pago_fraccionado_202 ?? 0)}`);
    const plazos202 = { T1:"20 abril", T2:"20 octubre", T3:"20 diciembre", T4:"No aplica" };
    lines.push(`Plazo Mod.202 este trimestre: ${plazos202[trim]}`);
    lines.push(`Plazo Mod.200 anual: julio ${year+1} (art. 124 LIS)`);
  } else {
    lines.push("=== MODELO 130 — IRPF TRIMESTRAL (YTD) ===");
    lines.push(`Ingresos YTD: ${fmt(r130.ingresos_total)}`);
    lines.push(`Gastos deducibles YTD: ${fmt(r130.gastos_total)}`);
    lines.push(`Rendimiento neto acum.: ${fmt(r130.rend_neto_acum)}`);
    lines.push(`20% rendimiento cas.06: ${fmt(r130.pago_fraccionado)}`);
    lines.push(`Retenciones acum. cas.07: ${fmt(r130.retenciones_acum)}`);
    lines.push(`Pagos previos cas.08: ${fmt(r130.pagos_previos)}`);
    lines.push(`Resultado cas.09: ${fmt(r130.resultado)}`);
    lines.push("");
    lines.push("=== PROYECCIÓN ANUAL ===");
    lines.push(`Ingresos proyectados: ${fmt(proyeccion.ingresos_proyect)}`);
    lines.push(`Cuota Renta estimada Mod.100: ${fmt(proyeccion.cuota_renta_estimada)}`);
    lines.push(`Tipo efectivo estimado: ${pct(proyeccion.tipo_efectivo)}`);
    lines.push(`Reserva mensual recomendada: ${fmt(proyeccion.reserva_mensual)}`);
  }
  lines.push("");

  lines.push("=== GASTOS DEDUCIBLES (YTD) ===");
  lines.push(`Total base: ${fmt(totalesGastos.total_base)}`);
  lines.push(`Total deducible: ${fmt(totalesGastos.total_deducible_irpf)}`);
  lines.push(`IVA deducible: ${fmt(totalesGastos.total_iva_deducible)}`);
  if (totalesGastos.gasto_riesgo_alto > 0) lines.push(`⚠️ Gasto riesgo alto: ${fmt(totalesGastos.gasto_riesgo_alto)}`);
  resumenGastos.slice(0, 6).forEach(c => {
    lines.push(`  · ${c.label}: ${fmt(c.total_base)} base, ${fmt(c.total_deducible)} deducible${c.riesgo !== "bajo" ? " [riesgo "+c.riesgo+"]" : ""}`);
  });
  lines.push("");

  if (acumulado347.length > 0) {
    lines.push("=== MODELO 347 — OPERACIONES TERCEROS ===");
    lines.push(`Superan umbral 3.005,06 €: ${acumulado347.length} operaciones`);
    acumulado347.slice(0, 5).forEach(r => lines.push(`  · ${r.nombre}: ${fmt(r.total_operaciones)}`));
    lines.push("");
  }

  if (retenciones190.total_retenido > 0) {
    lines.push("=== RETENCIONES (Mod.190) ===");
    lines.push(`Base: ${fmt(retenciones190.total_base)} · Retenido: ${fmt(retenciones190.total_retenido)} · Tipo medio: ${pct(retenciones190.tipo_medio)}`);
    lines.push("");
  }

  lines.push("=== ALERTAS FISCALES ===");
  lines.push(serializarAlertasParaClaude(alertas));
  lines.push("");

  lines.push("=== INSTRUCCIONES ===");
  lines.push("Eres el asesor fiscal de Taurix con acceso a los datos reales del contribuyente.");
  lines.push(`RÉGIMEN: ${esSociedad ? "SOCIEDAD → IS. Nunca menciones 130 ni IRPF fraccionado como obligación de esta entidad." : "AUTÓNOMO → IRPF. Nunca menciones IS ni 202 como obligación."}`);
  lines.push("1. Usa cifras reales del contexto. 2. Cita norma legal. 3. Diferencia dato real de estimación. 4. Responde en español.");

  return lines.join("\n");
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════════ */

function _rangoTrim(year, trim) {
  const r = { T1:["01-01","03-31"], T2:["04-01","06-30"], T3:["07-01","09-30"], T4:["10-01","12-31"] };
  const [ini, fin] = r[trim];
  return { ini: `${year}-${ini}`, fin: `${year}-${fin}` };
}

function _labelRegimen(regime) {
  return { autonomo_ed:"Autónomo · Estimación Directa", autonomo_es:"Autónomo · Estimación Simplificada", sociedad:"Sociedad Limitada / SA", autonomo_mod:"Autónomo · Módulos", estimacion_directa_simplificada:"Autónomo · Estimación Directa Simplificada" }[regime] ?? regime ?? "No configurado";
}

function _coefAmortIS(tipo, coef) {
  if (coef) return coef;
  return { "Equipos informáticos":26, "Aplicaciones informáticas":33, "Maquinaria":12, "Mobiliario":10, "Instalaciones":10, "Elementos de transporte":16, "Edificios y construcciones":3 }[tipo] || 10;
}

function _getQueryCtx() {
  // Las facturas se guardan con user_id — alineado con utils.js/_getCtx()
  // tg_empresa_id era para multi-empresa (eliminado). Siempre user_id.
  // Excepción: modo gestor viendo un cliente (tg_gestor_ctx con empresa_id propio de la tabla empresas)
  try {
    const raw = sessionStorage.getItem("tg_gestor_ctx");
    if (raw) {
      const ctx = JSON.parse(raw);
      if (ctx?.empresa_id) return { field:"empresa_id", value:ctx.empresa_id };
    }
  } catch(_) {}
  return { field:"user_id", value: window.__TAURIX_SESSION__?.user?.id ?? null };
}

function _r130Vacio() {
  return { ingresos_total:0, gastos_total:0, rend_neto_acum:0, pago_fraccionado:0, retenciones_acum:0, pagos_previos:0, resultado:0 };
}

function _proyeccionVacia() {
  return { ingresos_proyect:0, rend_proyect:0, cuota_renta_estimada:0, tipo_efectivo:0, reserva_mensual:0 };
}

function _isVacio() {
  return { ingresos:0, gastos_explot:0, gastos_personal:0, amortizaciones:0, total_gastos:0, baii:0, bai:0, base_imponible:0, tipo_is:0.25, tipo_is_pct:25, es_pyme:false, cuota_integra:0, retenciones:0, pagos_fraccionados:0, cuota_diferencial:0, tipo_efectivo:0, pago_fraccionado_202:0, norma:"Ley 27/2014 (LIS)" };
}
