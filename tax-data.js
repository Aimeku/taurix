/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/tax-data.js
   Capa de acceso a datos del Tax Engine
   
   REGLA: Este es el ÚNICO módulo del engine que habla con Supabase.
   Los módulos de cálculo (tax-iva, tax-irpf, etc.) reciben datos
   ya normalizados — nunca hacen queries directas.
   
   COMPATIBILIDAD: Usa _getCtx() y SESSION de utils.js para respetar
   el modo gestor (empresa_id en sessionStorage) exactamente igual
   que el resto del sistema.
   ═══════════════════════════════════════════════════════════════════ */

import { supabase } from "../supabase.js";
import { SESSION } from "../utils.js";
import { getFechaRangoTrim, getFechaRangoAnual } from "./tax-rules.js";
import {
  desglosarIva,
  cuotaIrpfFactura,
  esDeducibleIVA,
  redondearSimetrico,
} from "../factura-helpers.js";

/* ── Contexto de query — SIEMPRE user_id ──────────────────────────
   Las facturas se guardan con user_id, igual que utils.js/_getCtx().
   tg_empresa_id era para multi-empresa (eliminado de la app).
   Excepción: modo gestor viendo un cliente específico (tg_gestor_ctx).
─────────────────────────────────────────────────────────────────── */
function _getCtx() {
  try {
    const raw = sessionStorage.getItem("tg_gestor_ctx");
    if (raw) {
      const ctx = JSON.parse(raw);
      if (ctx?.empresa_id) return { field: "empresa_id", value: ctx.empresa_id };
    }
  } catch (_) {}
  // SIEMPRE user_id — no usar tg_empresa_id (las facturas no se guardan por empresa)
  return { field: "user_id", value: SESSION?.user?.id ?? null };
}

/* ══════════════════════════════════════════════════════════════════
   NORMALIZACIÓN
   Convierte una fila de la tabla facturas al tipo TaxDocument
══════════════════════════════════════════════════════════════════ */

/**
 * Normaliza una fila raw de Supabase a TaxDocument.
 * 
 * REFACTOR (Hallazgo 1 del informe fiscal):
 * Antes calculaba `cuota_iva = base × iva_pct / 100`, que es incorrecto
 * en facturas multi-IVA. Ahora usa `desglosarIva()` sobre `lineas`
 * para obtener el desglose real por tipo de IVA, y el `cuota_iva`
 * agregado pasa a ser la suma de las cuotas reales.
 * 
 * El campo canónico a partir de aquí es `doc.desglose_iva`. Los otros
 * módulos (tax-iva.js, tax-irpf.js) deben leer de ahí.
 * 
 * @param {Object} row - Fila de la tabla facturas
 * @returns {import('./tax-types.js').TaxDocument}
 */
function normalizarFactura(row) {
  const base  = Number(row.base ?? 0);
  const op    = row.tipo_operacion ?? "nacional";

  // Desglose real por tipo de IVA (leyendo `lineas` JSON con fallback)
  const desglose = desglosarIva(row);

  // Cuota IVA total ya redondeada simétricamente por tipo y sumada
  const cuota_iva = desglose.cuota_total;

  // IRPF con redondeo simétrico
  const irpf = cuotaIrpfFactura(row, desglose);

  // Tipo de IVA "principal" para compatibilidad con código legacy
  // (el que tiene mayor base en el desglose)
  let iva_pct_principal = Number(row.iva ?? row.iva_pct ?? 0);
  let maxBase = 0;
  for (const pct of [21, 10, 4, 0]) {
    if (desglose[pct].base > maxBase) {
      maxBase = desglose[pct].base;
      iva_pct_principal = pct;
    }
  }

  // Flag semántico que determina si la operación tiene derecho a deducir
  // IVA soportado (nacional / IC / exportacion / ISP emitida SÍ; exento art. 20 NO).
  // Clave para el cálculo correcto de prorrata (Hallazgo 8).
  const claseSujetaConDerecho =
    row.tipo === "emitida" &&
    row.estado === "emitida" &&
    ["nacional", "intracomunitaria", "exportacion", "inversion_sujeto_pasivo"].includes(op);
  const claseExentaSinDerecho =
    row.tipo === "emitida" &&
    row.estado === "emitida" &&
    op === "exento";

  return {
    id:                  row.id,
    tipo:                row.tipo,                          // "emitida" | "recibida"
    fecha:               row.fecha_operacion ?? row.fecha,  // fecha de devengo
    fecha_operacion:     row.fecha_operacion ?? row.fecha,
    fecha_emision:       row.fecha_emision ?? row.fecha,
    base:                redondearSimetrico(desglose.base_total || base),
    iva_pct:             iva_pct_principal,
    cuota_iva,
    desglose_iva:        desglose,                          // ← FUENTE DE VERDAD
    irpf_pct:            irpf.pct,
    cuota_irpf:          irpf.cuota,
    total:               redondearSimetrico(desglose.base_total + cuota_iva - irpf.cuota),
    tipo_operacion:      op,
    estado:              row.estado ?? "emitida",
    contraparte_nif:     row.cliente_nif ?? row.proveedor_nif ?? null,
    contraparte_nombre:  row.cliente_nombre ?? row.proveedor_nombre ?? null,
    contraparte_pais:    row.cliente_pais ?? row.proveedor_pais ?? "ES",
    es_rectificativa:    !!(row.es_rectificativa ?? row.factura_rectif_de),
    rectif_tipo_motivo:  row.rectif_tipo_motivo ?? null,
    rectif_factura_original: row.rectif_factura_original ?? null,
    numero_factura:      row.numero_factura ?? null,
    deducible_iva:       row.deducible_iva ?? esDeducibleIVA(row),
    tipo_documento:      row.tipo_documento ?? null,
    pct_deduccion_iva:   row.pct_deduccion_iva ?? 100,
    clasifica_actividad_sujeta_con_derecho: claseSujetaConDerecho,
    clasifica_actividad_exenta_sin_derecho: claseExentaSinDerecho,
  };
}

/* ══════════════════════════════════════════════════════════════════
   QUERIES PRINCIPALES
══════════════════════════════════════════════════════════════════ */

/**
 * Obtiene documentos fiscales normalizados para un trimestre.
 * Solo facturas emitidas (estado='emitida') y recibidas.
 * 
 * @param {number} year
 * @param {string} trim  - "T1"|"T2"|"T3"|"T4"
 * @returns {Promise<import('./tax-types.js').TaxDocument[]>}
 */
export async function getTaxDocumentsTrim(year, trim) {
  if (!SESSION?.user?.id) return [];
  const { ini, fin } = getFechaRangoTrim(year, trim);
  const ctx = _getCtx();

  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq(ctx.field, ctx.value)
    .gte("fecha", ini)
    .lte("fecha", fin)
    .not("estado", "eq", "anulada");

  if (error) {
    console.error("[tax-data] getTaxDocumentsTrim:", error.message);
    return [];
  }

  // Post-filtro por fecha de devengo (art. 75 LIVA): si la factura tiene
  // fecha_operacion distinta de fecha_emision, se usa fecha_operacion para
  // decidir el trimestre (Hallazgo 12 del informe fiscal).
  // Si la columna fecha_operacion no existe aún en la BD, normalizarFactura
  // cae a fecha y este filtro no rechaza nada.
  return (data || [])
    .map(normalizarFactura)
    .filter(d => {
      const f = d.fecha_operacion || d.fecha;
      return f >= ini && f <= fin;
    });
}

/**
 * Obtiene documentos fiscales normalizados para un año completo.
 * 
 * @param {number} year
 * @returns {Promise<import('./tax-types.js').TaxDocument[]>}
 */
export async function getTaxDocumentsYear(year) {
  if (!SESSION?.user?.id) return [];
  const { ini, fin } = getFechaRangoAnual(year);
  const ctx = _getCtx();

  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq(ctx.field, ctx.value)
    .gte("fecha", ini)
    .lte("fecha", fin)
    .not("estado", "eq", "anulada");

  if (error) {
    console.error("[tax-data] getTaxDocumentsYear:", error.message);
    return [];
  }

  return (data || []).map(normalizarFactura);
}

/**
 * Obtiene los documentos acumulados desde T1 hasta el trimestre dado (inclusive).
 * Necesario para el cálculo correcto del Modelo 130.
 * 
 * @param {number} year
 * @param {string} trim  - "T1"|"T2"|"T3"|"T4"
 * @returns {Promise<import('./tax-types.js').TaxDocument[]>}
 */
export async function getTaxDocumentsHastaTrim(year, trim) {
  if (!SESSION?.user?.id) return [];
  const { ini: iniAño } = getFechaRangoAnual(year);
  const { fin: finTrim } = getFechaRangoTrim(year, trim);
  const ctx = _getCtx();

  const { data, error } = await supabase
    .from("facturas")
    .select("*")
    .eq(ctx.field, ctx.value)
    .gte("fecha", iniAño)
    .lte("fecha", finTrim)
    .not("estado", "eq", "anulada");

  if (error) {
    console.error("[tax-data] getTaxDocumentsHastaTrim:", error.message);
    return [];
  }

  return (data || []).map(normalizarFactura);
}

/* ══════════════════════════════════════════════════════════════════
   PERFIL FISCAL
══════════════════════════════════════════════════════════════════ */

/**
 * Obtiene el perfil fiscal del usuario/empresa activa.
 * Devuelve null si no existe.
 * 
 * @returns {Promise<import('./tax-types.js').PerfilFiscal|null>}
 */
export async function getPerfilFiscal() {
  if (!SESSION?.user?.id) return null;
  const ctx = _getCtx();

  // Perfil propio del usuario (siempre se lee — tiene el regime real)
  const { data: perfilPropio } = await supabase
    .from("perfil_fiscal")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .maybeSingle();

  // Si estamos en modo gestor, intentar leer datos de la tabla empresas
  // Solo pedimos columnas que sabemos que existen (nombre, nif, regime)
  if (ctx.field === "empresa_id") {
    const { data: emp } = await supabase
      .from("empresas")
      .select("id, nombre, nif, regime")
      .eq("id", ctx.value)
      .maybeSingle();

    if (emp) {
      // Mezclar: datos de empresa + regime del perfil propio como fallback
      // El regime de la empresa tiene prioridad; si no tiene, usar el del perfil
      return {
        user_id:             SESSION.user.id,
        empresa_id:          emp.id,
        nombre_razon_social: emp.nombre ?? perfilPropio?.nombre_razon_social,
        nif:                 emp.nif    ?? perfilPropio?.nif,
        actividad:           perfilPropio?.actividad ?? null,
        domicilio_fiscal:    perfilPropio?.domicilio_fiscal ?? null,
        regime:              emp.regime ?? perfilPropio?.regime ?? "autonomo_ed",
        fecha_alta:          perfilPropio?.fecha_alta ?? null,
        reta_mensual:        perfilPropio?.reta_mensual ?? null,
      };
    }

    // La empresa no existe o falló — usar perfil propio completo
    if (perfilPropio) return perfilPropio;
    return null;
  }

  // Modo usuario normal — devolver perfil propio directamente
  if (perfilPropio) return perfilPropio;

  console.warn("[tax-data] getPerfilFiscal: sin perfil");
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   GASTOS
══════════════════════════════════════════════════════════════════ */

/**
 * Obtiene los gastos del periodo (tabla gastos, no facturas recibidas).
 * 
 * @param {number} year
 * @param {string|null} trim  - null para año completo
 * @returns {Promise<Object[]>}
 */
export async function getGastos(year, trim = null) {
  if (!SESSION?.user?.id) return [];
  const ctx = _getCtx();

  let query = supabase
    .from("gastos")
    .select("*")
    .eq(ctx.field, ctx.value);

  if (trim) {
    const { ini, fin } = getFechaRangoTrim(year, trim);
    query = query.gte("fecha", ini).lte("fecha", fin);
  } else {
    const { ini, fin } = getFechaRangoAnual(year);
    query = query.gte("fecha", ini).lte("fecha", fin);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[tax-data] getGastos:", error.message);
    return [];
  }
  return data || [];
}

/* ══════════════════════════════════════════════════════════════════
   PERIODOS GUARDADOS (tabla tax_periodos)
   Permite leer resultados ya calculados y almacenados
══════════════════════════════════════════════════════════════════ */

/**
 * Lee el resultado guardado de un modelo para un periodo.
 * Devuelve null si no existe (habrá que calcularlo).
 * 
 * @param {string} modelo  - "303"|"130"|"347"|"390"
 * @param {number} year
 * @param {string|null} trim
 * @returns {Promise<Object|null>}
 */
export async function getResultadoGuardado(modelo, year, trim = null) {
  if (!SESSION?.user?.id) return null;
  const ctx = _getCtx();

  const field = ctx.field === "empresa_id" ? "empresa_id" : "user_id";
  let query = supabase
    .from("tax_periodos")
    .select("*")
    .eq(field, ctx.value)
    .eq("modelo", modelo)
    .eq("year", year);

  if (trim) query = query.eq("trim", trim);
  else      query = query.is("trim", null);

  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data ?? null;
}

/**
 * Guarda el resultado de un cálculo para un periodo.
 * Hace upsert — si ya existe, lo actualiza.
 * 
 * @param {string} modelo
 * @param {number} year
 * @param {string|null} trim
 * @param {Object} resultado_json  - Output completo del engine
 * @param {number} resultado_importe - Casilla resultado final
 * @param {string} [estado]        - "borrador"|"presentado"|"pagado"
 */
export async function guardarResultado(modelo, year, trim, resultado_json, resultado_importe, estado = "borrador") {
  if (!SESSION?.user?.id) return;
  const ctx = _getCtx();

  const record = {
    user_id:           ctx.field === "user_id" ? ctx.value : SESSION.user.id,
    empresa_id:        ctx.field === "empresa_id" ? ctx.value : null,
    modelo,
    year,
    trim,
    resultado_json,
    resultado_importe,
    estado,
  };

  const { error } = await supabase
    .from("tax_periodos")
    .upsert(record, { onConflict: "user_id,empresa_id,modelo,year,trim" });

  if (error) {
    console.error("[tax-data] guardarResultado:", error.message);
  }
}

/* ══════════════════════════════════════════════════════════════════
   ALERTAS (tabla tax_alerts)
══════════════════════════════════════════════════════════════════ */

/**
 * Obtiene las alertas fiscales activas (no resueltas) del usuario.
 * 
 * @returns {Promise<import('./tax-types.js').TaxAlert[]>}
 */
export async function getAlertasActivas() {
  if (!SESSION?.user?.id) return [];
  const ctx = _getCtx();
  const field = ctx.field === "empresa_id" ? "empresa_id" : "user_id";

  const { data, error } = await supabase
    .from("tax_alerts")
    .select("*")
    .eq(field, ctx.value)
    .eq("resuelta", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[tax-data] getAlertasActivas:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Marca una alerta como resuelta.
 * @param {string} alertaId
 */
export async function resolverAlerta(alertaId) {
  if (!SESSION?.user?.id) return;
  await supabase
    .from("tax_alerts")
    .update({ resuelta: true })
    .eq("id", alertaId);
}

/**
 * Persiste un array de alertas generadas por el engine.
 * Evita duplicados: no inserta si ya existe una alerta del mismo tipo
 * para el mismo periodo y no está resuelta.
 * 
 * @param {import('./tax-types.js').TaxAlert[]} alertas
 */
export async function persistirAlertas(alertas) {
  if (!SESSION?.user?.id || !alertas.length) return;
  const ctx = _getCtx();

  const records = alertas.map(a => ({
    user_id:    ctx.field === "user_id"    ? ctx.value : SESSION.user.id,
    empresa_id: ctx.field === "empresa_id" ? ctx.value : null,
    tipo:       a.tipo,
    severidad:  a.severidad,
    modelo:     a.modelo ?? null,
    mensaje:    a.mensaje,
    norma_ref:  a.norma  ?? null,
    accion_url: a.accion_url ?? null,
    resuelta:   false,
    expires_at: a.expires_at ?? null,
  }));

  const { error } = await supabase
    .from("tax_alerts")
    .upsert(records, { onConflict: "user_id,tipo,modelo" });

  if (error) {
    console.error("[tax-data] persistirAlertas:", error.message);
  }
}
