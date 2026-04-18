/* ═══════════════════════════════════════════════════════
   TAURIX · otros-modelos.js
   Modelos fiscales 111, 115, 123, 190, 347, 349, 390
   Cálculos reales + exportación PDF
   
   REFACTORIZACIÓN por lotes (post-auditoría fiscal 2026):
   · Lote 4 (este): Modelo 390 completo y correcto
   · Lote 5 (próximo): Modelo 347 con exclusiones y BOE oficial
   · Lote 6 (próximo): Modelo 349 con claves E/A/S/I/T/H/R
   · Lote 7 (próximo): Modelos 111/190 con nóminas + 115 sin falsos positivos
   · Lote 8 (próximo): A3 y ContaPlus con asientos cuadrados
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, getYear, getTrim, getFechaRango, getFacturasTrim, TRIM_LABELS, TRIM_PLAZOS } from "./utils.js";
import {
  desglosarIva,
  cuotaIrpfFactura,
  totalFactura,
  esDeducibleIVA,
  redondearSimetrico,
  TIPOS_IVA_VALIDOS,
} from "./factura-helpers.js";

const _r = redondearSimetrico;

/* ══════════════════════════
   MODELO 111 — Retenciones IRPF
   Solo profesionales (facturas con irpf_retencion > 0)
   No incluye nóminas ni rendimientos del trabajo
══════════════════════════ */
export async function calcModelo111() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  // Retenciones de facturas emitidas (rendimientos profesionales únicamente)
  const uid = SESSION?.user?.id;
  const { data: facturas } = await supabase.from("facturas")
    .select("base, irpf_retencion, cliente_nombre")
    .eq("user_id", uid)
    .eq("tipo", "emitida").eq("estado", "emitida")
    .gte("fecha", ini).lte("fecha", fin)
    .not("irpf_retencion", "is", null)
    .gt("irpf_retencion", 0);

  const retProf = (facturas || []).reduce((a, f) => a + f.base * (f.irpf_retencion || 0) / 100, 0);
  const total   = retProf;

  // Update UI
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("m111Prof",  fmt(retProf));
  s("m111Total", fmt(total));

  // Estado visual
  const stEl = document.getElementById("m111Estado");
  if (stEl) stEl.innerHTML = total > 0
    ? `<span class="badge b-pagar">A ingresar: ${fmt(total)}</span>`
    : `<span class="badge b-compen">Sin retenciones este trimestre</span>`;

  return { retProf, total, facturas: facturas || [], year, trim };
}

export async function exportModelo111PDF() {
  const data = await calcModelo111();
  await generarPDFModelo({
    numero: "111",
    titulo: "RETENCIONES E INGRESOS A CUENTA DEL IRPF",
    subtitulo: "Rendimientos de Actividades Económicas — Profesionales",
    year: data.year, trim: data.trim,
    resultado: data.total,
    filas: [
      { label: "Retenciones de profesionales (facturas con IRPF)", valor: data.retProf },
      { label: "CUOTA A INGRESAR", valor: data.total, bold: true },
    ],
    plazo: TRIM_PLAZOS[data.trim],
    nota: "Retenciones e ingresos a cuenta del IRPF sobre rendimientos de actividades económicas (art. 95 RIRPF). Liquidación trimestral."
  });
}

/* ══════════════════════════
   MODELO 115 — Alquiler
══════════════════════════ */
export async function calcModelo115() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  // user_id — consistente con el resto del sistema
  const uid115 = SESSION?.user?.id;
  // Buscar alquileres: facturas recibidas con concepto de alquiler O categoría alquiler
  const { data: alquileres } = await supabase.from("facturas")
    .select("base, iva, concepto, categoria")
    .eq("user_id", uid115).eq("tipo", "recibida")
    .gte("fecha", ini).lte("fecha", fin)
    .or("concepto.ilike.%alquiler%,concepto.ilike.%arrendamiento%,concepto.ilike.%renta%,categoria.ilike.%alquiler%,categoria.ilike.%arrendamiento%");

  const baseAlquiler = (alquileres || []).reduce((a, f) => a + f.base, 0);
  // Tipo retención arrendamiento: 19% general (art. 75.2.a RIRPF)
  const retencion    = baseAlquiler * 0.19;

  const s115 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s115("m115Base",      fmt(baseAlquiler));
  s115("m115Retencion", fmt(retencion));

  const stEl115 = document.getElementById("m115Estado");
  if (stEl115) stEl115.innerHTML = retencion > 0
    ? `<span class="badge b-pagar">A ingresar: ${fmt(retencion)}</span>`
    : `<span class="badge b-compen">Sin alquileres declarables</span>`;

  return { baseAlquiler, retencion, year, trim };
}

export async function exportModelo115PDF() {
  const data = await calcModelo115();
  await generarPDFModelo({
    numero: "115",
    titulo: "RETENCIONES E INGRESOS A CUENTA DEL IRPF",
    subtitulo: "Rentas procedentes del arrendamiento de inmuebles urbanos",
    year: data.year, trim: data.trim,
    resultado: data.retencion,
    filas: [
      { label: "Base de retención (arrendamientos)", valor: data.baseAlquiler },
      { label: "Tipo de retención aplicado", valor: null, texto: "19%" },
      { label: "CUOTA A INGRESAR", valor: data.retencion, bold: true },
    ],
    plazo: TRIM_PLAZOS[data.trim],
    nota: "Retenciones sobre rentas derivadas del arrendamiento de inmuebles urbanos. Art. 75.2.a) RIRPF."
  });
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 347 — Declaración anual de operaciones con terceros
   Art. 33 RD 1065/2007 · Orden HAC/1148/2024
   
   REFACTORIZACIÓN v2 (post-auditoría fiscal 2026):
   ─────────────────────────────────────────────────────────────────
   ▸ Hallazgo 1: total con IVA correcto vía desglosarIva() (multi-IVA).
   ▸ Hallazgo 6 (MÚLTIPLES ERRORES EN UNA FUNCIÓN):
     · Exclusión de operaciones que van en otros modelos:
       - Intracomunitarias  → van al 349
       - Inversión sujeto pasivo → en casillas 303 pero NO al 347
       - Importaciones/exportaciones → DUA las identifica
       - Facturas con retención IRPF practicada → van al 180/190
     · Filtrado de recibidas anuladas / borrador (antes solo
       filtraba emitidas no-emitidas).
     · Desglose trimestral obligatorio por cada declarado
       (exigido desde 2014).
     · Marca operaciones de "arrendamiento de local de negocio"
       para el campo específico del BOE.
     · Marca operaciones en metálico > 6.000 €/año (requisito
       adicional del 347).
     · Agrupa por contraparte sumando todas sus operaciones.
   ▸ Hallazgo 10: redondeo simétrico por factura.
   ▸ Hallazgo 11: tickets TIQ excluidos sistemáticamente.
══════════════════════════════════════════════════════════════════ */

const UMBRAL_347 = 3005.06;       // art. 33.1.a RD 1065/2007
const UMBRAL_METALICO_347 = 6000; // art. 33.1.h RD 1065/2007
const OPS_EXCLUIDAS_347 = new Set([
  "intracomunitaria",        // van al 349
  "inversion_sujeto_pasivo", // casillas 303, NO 347
  "exportacion",             // DUA identifica
  "importacion",             // DUA identifica
]);

/**
 * Detecta si una factura recibida es de arrendamiento de local de negocio.
 * El 347 requiere marcar específicamente estas operaciones
 * (campo "operaciones arrendamiento local de negocio" del registro).
 * 
 * Criterios:
 * 1. Campo explícito `es_alquiler_local` si existe en BD.
 * 2. Fallback: concepto o categoría contiene palabras clave de alquiler
 *    INMOBILIARIO (no renting de vehículos ni alquiler de maquinaria).
 *    Esto es una heurística débil — idealmente el usuario marca el
 *    campo explícito (Lote 7 del plan de refactor).
 */
function _esArrendamientoLocalNegocio(f) {
  // Campo explícito tiene prioridad absoluta
  if (typeof f.es_alquiler_local === "boolean") return f.es_alquiler_local;
  if (f.categoria === "alquiler_local" || f.categoria === "alquiler_oficina") return true;
  // Heurística conservadora: solo si hay palabra "local" u "oficina" cerca
  const txt = ((f.concepto || "") + " " + (f.categoria || "")).toLowerCase();
  const esAlquiler   = /\balquiler|\barrendamiento|\brenta\b/.test(txt);
  const esInmueble   = /\blocal\b|\boficina\b|\bdespacho\b|\bnave\b|\blocal comercial/.test(txt);
  const noEsVehiculo = !/\brenting\b|\bvehic|\bcoche\b|\bfurgoneta\b|\bcamion/.test(txt);
  return esAlquiler && esInmueble && noEsVehiculo;
}

/**
 * Determina si una factura se excluye del 347.
 * Devuelve {excluir: boolean, motivo: string|null}.
 */
function _excluirDel347(f) {
  // 1. Tickets simplificados TIQ — sin NIF del destinatario, no declarable
  if ((f.numero_factura || "").startsWith("TIQ-")) {
    return { excluir: true, motivo: "ticket_simplificado" };
  }
  // 2. Facturas anuladas o borradores no se declaran
  if (f.tipo === "emitida" && f.estado !== "emitida") {
    return { excluir: true, motivo: "estado_no_emitida" };
  }
  if (f.tipo === "recibida" && f.estado === "anulada") {
    return { excluir: true, motivo: "recibida_anulada" };
  }
  // 3. Operaciones en otros modelos (art. 33 RD 1065/2007)
  const op = f.tipo_operacion || "nacional";
  if (OPS_EXCLUIDAS_347.has(op)) {
    return { excluir: true, motivo: `operacion_${op}` };
  }
  // 4. Operaciones con retención IRPF practicada al receptor:
  //    van al 180 (alquileres) o 190 (profesionales), no al 347.
  //    CONDICIÓN: facturas recibidas con irpf > 0.
  if (f.tipo === "recibida" && (f.irpf_retencion ?? f.irpf ?? 0) > 0) {
    return { excluir: true, motivo: "retencion_practicada_180_190" };
  }
  // 5. Operaciones exentas sin contraparte identificable
  if (op === "exento" && !f.cliente_nif) {
    return { excluir: true, motivo: "exenta_sin_nif" };
  }
  return { excluir: false, motivo: null };
}

/**
 * Determina el trimestre de una factura a partir de su fecha.
 * Soporta fecha_operacion si existe (Hallazgo 12).
 */
function _trim347(f) {
  const fecha = f.fecha_operacion || f.fecha;
  if (!fecha) return "T1";
  const mes = parseInt(String(fecha).slice(5, 7), 10);
  if (mes <= 3)  return "T1";
  if (mes <= 6)  return "T2";
  if (mes <= 9)  return "T3";
  return "T4";
}

/**
 * Calcula el Modelo 347 agrupado por contraparte, con desglose trimestral.
 * 
 * @param {number} [year] - Ejercicio (defecto: año en curso).
 * @returns {Promise<{declarables:Array,excluidos:Object,year:number}>}
 */
export async function calcModelo347(year) {
  const y = year || getYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("*")                                  // necesitamos `lineas` para el desglose
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${y}-01-01`).lte("fecha", `${y}-12-31`);

  // Contador de exclusiones para diagnóstico
  const excluidos = {
    ticket_simplificado: 0,
    estado_no_emitida: 0,
    recibida_anulada: 0,
    operacion_intracomunitaria: 0,
    operacion_inversion_sujeto_pasivo: 0,
    operacion_exportacion: 0,
    operacion_importacion: 0,
    retencion_practicada_180_190: 0,
    exenta_sin_nif: 0,
  };

  // Acumulador: key = NIF(o nombre)+"_"+tipo → agregación por contraparte
  const acum = {};

  (facturas || []).forEach(f => {
    const { excluir, motivo } = _excluirDel347(f);
    if (excluir) {
      if (excluidos[motivo] !== undefined) excluidos[motivo]++;
      return;
    }

    const key = (f.cliente_nif || f.cliente_nombre || "SIN_ID") + "_" + f.tipo;
    if (!acum[key]) {
      acum[key] = {
        nombre:       f.cliente_nombre || "—",
        nif:          f.cliente_nif    || null,
        pais:         f.cliente_pais   || "ES",
        provincia:    f.cliente_provincia || null,
        tipo:         f.tipo,             // "emitida" | "recibida"
        total:        0,
        ops:          0,
        // Desglose trimestral obligatorio (art. 33 RD 1065/2007 modificado 2013)
        trim_T1: 0, trim_T2: 0, trim_T3: 0, trim_T4: 0,
        // Marcadores especiales
        es_alquiler_local_negocio: false,
        total_metalico:             0,
      };
    }
    const a = acum[key];

    // Desglose con multi-IVA correcto
    const t = totalFactura(f);
    const importeConIVA = _r(t.base_total + t.cuota_iva);  // art. 33.3 RD 1065/2007
    a.total                += importeConIVA;
    a.ops                  += 1;
    a["trim_" + _trim347(f)] += importeConIVA;

    // Marcar arrendamiento local de negocio (solo en recibidas)
    if (f.tipo === "recibida" && _esArrendamientoLocalNegocio(f)) {
      a.es_alquiler_local_negocio = true;
    }

    // Pagos en metálico (si la factura los registra explícitamente)
    if (f.pago_metalico_importe && f.pago_metalico_importe > 0) {
      a.total_metalico += Number(f.pago_metalico_importe);
    }
  });

  // Redondeo y filtrado por umbrales
  Object.values(acum).forEach(a => {
    a.total         = _r(a.total);
    a.trim_T1       = _r(a.trim_T1);
    a.trim_T2       = _r(a.trim_T2);
    a.trim_T3       = _r(a.trim_T3);
    a.trim_T4       = _r(a.trim_T4);
    a.total_metalico = _r(a.total_metalico);
  });

  // Un declarado aparece en el 347 si:
  //  - su total supera el umbral 3.005,06 € (en valor absoluto, por rectificativas)
  //  - O si hay pagos en metálico que superen 6.000 €/año
  const declarables = Object.values(acum)
    .filter(a => Math.abs(a.total) >= UMBRAL_347 || a.total_metalico > UMBRAL_METALICO_347)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // Actualizar contador del dashboard
  const el = document.getElementById("m347Count");
  if (el) el.textContent = declarables.length;

  return { declarables, excluidos, year: y, umbral: UMBRAL_347, umbral_metalico: UMBRAL_METALICO_347 };
}

export async function exportModelo347PDF() {
  const data = await calcModelo347();
  await _cargarJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }); // horizontal: necesitamos ancho para T1-T4
  const PW = 297, PH = 210, ML = 14, MR = 14, MB = 18, W = PW - ML - MR;
  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139];
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  // Cabecera
  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 28, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("MODELO 347 — DECLARACIÓN ANUAL DE OPERACIONES CON TERCEROS", PW / 2, 12, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Ejercicio ${data.year} · ${pf?.nombre_razon_social || "—"} (${pf?.nif || "—"}) · Generado: ${new Date().toLocaleDateString("es-ES")}`, PW / 2, 21, { align: "center" });

  let y = 36;
  doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(9);

  // Resumen
  const totalDeclarado = data.declarables.reduce((s, d) => s + Math.abs(d.total), 0);
  doc.setFont("helvetica", "bold");
  doc.text(`Declarados: ${data.declarables.length}`, ML, y);
  doc.text(`Total declarado: ${fmt(_r(totalDeclarado))}`, ML + 70, y);
  doc.text(`Umbral: ≥ 3.005,06 € / año`, ML + 160, y);
  y += 8;

  // Tabla con desglose trimestral (orientación apaisada nos da espacio)
  const cols = {
    tipo:   14,
    nombre: 65,
    nif:    25,
    t1:     24,
    t2:     24,
    t3:     24,
    t4:     24,
    total:  28,
    marca:  12,
    ops:    12,
  };
  const heads = ["Tipo", "Nombre / Razón social", "NIF/CIF", "T1", "T2", "T3", "T4", "TOTAL (€)", "A.L.", "Ops."];
  const widths = [cols.tipo, cols.nombre, cols.nif, cols.t1, cols.t2, cols.t3, cols.t4, cols.total, cols.marca, cols.ops];

  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 9, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  let x = ML;
  heads.forEach((h, i) => {
    // Importes alineados a la derecha
    const align = (i >= 3 && i <= 7) ? "right" : "left";
    const offX = align === "right" ? widths[i] - 2 : 2;
    doc.text(h, x + offX, y + 6, { align });
    x += widths[i];
  });
  y += 9;

  doc.setTextColor(...INK); doc.setFont("helvetica", "normal");

  data.declarables.forEach((d, ri) => {
    if (ri % 2 === 0) doc.setFillColor(245, 248, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 7.5, "F");
    x = ML;
    const tipo = d.tipo === "emitida" ? "Cliente" : "Prov.";
    const nombre = (d.nombre || "—").substring(0, 34);
    const nif = d.nif || "SIN NIF";
    const marca = d.es_alquiler_local_negocio ? "Local" : "";

    const cells = [
      { v: tipo,            align: "left"  },
      { v: nombre,          align: "left"  },
      { v: nif,             align: "left"  },
      { v: fmt(d.trim_T1),  align: "right" },
      { v: fmt(d.trim_T2),  align: "right" },
      { v: fmt(d.trim_T3),  align: "right" },
      { v: fmt(d.trim_T4),  align: "right" },
      { v: fmt(d.total),    align: "right" },
      { v: marca,           align: "left"  },
      { v: String(d.ops),   align: "right" },
    ];

    cells.forEach((c, i) => {
      doc.setFontSize(7.5);
      const offX = c.align === "right" ? widths[i] - 2 : 2;
      doc.text(c.v, x + offX, y + 5.5, { align: c.align });
      x += widths[i];
    });
    y += 7.5;
    if (y > PH - MB - 10) { doc.addPage(); y = 18; }
  });

  // Leyenda marcadores
  y += 6;
  if (y > PH - MB) { doc.addPage(); y = 18; }
  doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text("A.L. = Arrendamiento de local de negocio (casilla específica del 347).", ML, y);
  y += 4;
  doc.text("Tipo: «Cliente» = operaciones emitidas (ventas). «Prov.» = operaciones recibidas (compras).", ML, y);
  y += 8;

  // Exclusiones (diagnóstico de auditoría)
  const totalExcluidos = Object.values(data.excluidos).reduce((s, n) => s + n, 0);
  if (totalExcluidos > 0) {
    if (y > PH - MB - 30) { doc.addPage(); y = 18; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text("FACTURAS EXCLUIDAS DEL 347 (declaradas en otros modelos)", ML, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
    const motivos = {
      ticket_simplificado:               "Tickets simplificados (sin NIF)",
      estado_no_emitida:                 "Emitidas en borrador o anuladas",
      recibida_anulada:                  "Recibidas anuladas",
      operacion_intracomunitaria:        "Intracomunitarias → Modelo 349",
      operacion_inversion_sujeto_pasivo: "Inversión sujeto pasivo (no al 347)",
      operacion_exportacion:             "Exportaciones (DUA)",
      operacion_importacion:             "Importaciones (DUA)",
      retencion_practicada_180_190:      "Recibidas con retención IRPF → Modelos 180/190",
      exenta_sin_nif:                    "Exentas sin NIF contraparte",
    };
    Object.entries(data.excluidos).forEach(([motivo, n]) => {
      if (n > 0) {
        doc.text(`· ${motivos[motivo]}: ${n} factura${n > 1 ? "s" : ""}`, ML + 4, y);
        y += 4;
      }
    });
    y += 4;
  }

  // Nota legal
  if (y > PH - MB - 20) { doc.addPage(); y = 18; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("NOTA LEGAL:", ML, y); y += 4;
  doc.setFont("helvetica", "normal");
  const notas = doc.splitTextToSize(
    "Plazo de presentación: 1 al 28 de febrero del año siguiente (Orden HAC/1148/2024). El fichero oficial .txt está disponible desde el botón «Descargar fichero 347» para importar directamente en la Sede Electrónica AEAT. Documento orientativo — verifique cada declarado con su asesor antes de presentar.",
    W
  );
  doc.text(notas, ML, y);

  // Footer
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(
      `Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Página ${p}/${totalPages}`,
      PW / 2, PH - 6, { align: "center" }
    );
  }

  doc.save(`modelo_347_${data.year}.pdf`);
  toast("Modelo 347 exportado ✅", "success");
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 349 — Declaración recapitulativa de operaciones
                intracomunitarias
   Arts. 78-81 RIVA · Orden EHA/769/2010 modificada · versión 2024
   
   REFACTORIZACIÓN v2 (post-auditoría fiscal 2026):
   ─────────────────────────────────────────────────────────────────
   Hallazgo 4 del informe (CRÍTICO): el 349 anterior era plano
   (una única suma de bases sin clasificar). El 349 real exige:
   
   ▸ CLAVES DE OPERACIÓN:
     E  — Entregas intracomunitarias de BIENES
     A  — Adquisiciones intracomunitarias de BIENES
     T  — Operaciones triangulares (op. subsiguiente tras AIC)
     S  — Prestaciones de SERVICIOS (emisor presta a empresario UE)
     I  — Adquisiciones de SERVICIOS (receptor recibe de UE)
     M  — Entregas posteriores al transporte desde España
     H  — Entregas posteriores a AIC que operador intermedio hizo
     R  — Rectificaciones de periodos anteriores (signo ±)
   ▸ AGRUPACIÓN por clave + NIF-VAT del cliente/proveedor.
   ▸ VALIDACIÓN del VAT: sin VAT comunitario válido, la
     operación pierde la exención del art. 25 LIVA.
   ▸ FICHERO OFICIAL .txt (.349) compatible con sede AEAT.
══════════════════════════════════════════════════════════════════ */

/**
 * Determina la naturaleza de una factura intracomunitaria: bien o servicio.
 * Campo canónico: `naturaleza ∈ {'bien', 'servicio'}`.
 * Fallback: heurística por categoría o concepto (muy tentativa).
 */
function _naturalezaIC(f) {
  if (f.naturaleza === "bien" || f.naturaleza === "servicio") return f.naturaleza;
  // Heurística: la mayoría de autónomos IC hacen servicios (software, consultoría,
  // diseño, ...). Lo más seguro por defecto es "servicio" porque:
  //  - si facturan bienes físicos a UE suelen saber que necesitan marcarlo,
  //  - si facturan servicios no suelen rellenar el campo y es lo correcto.
  const txt = ((f.concepto || "") + " " + (f.categoria || "")).toLowerCase();
  // Keywords fuertes de bien físico
  if (/\bmercanc|\bproducto\b|\benvío\b|\benvio\b|\btransporte de bienes\b|\bexpedici/.test(txt)) {
    return "bien";
  }
  return "servicio";
}

/**
 * Calcula la clave AEAT del 349 a partir del tipo de factura y naturaleza.
 * @returns {'E'|'A'|'S'|'I'|'T'|'M'|'H'|'R'}
 */
function _claveOperacion349(f) {
  // Rectificativas: van a clave R en el 349 (regularización)
  if (f.es_rectificativa || (f.base < 0)) return "R";
  // Triangular (requiere campo explícito porque no hay forma fiable de inferir)
  if (f.tipo_operacion_349 === "triangular" || f.es_triangular) return "T";
  // Campo explícito puede forzar H o M
  if (f.clave_349_forzada && "EASITMHR".includes(f.clave_349_forzada)) return f.clave_349_forzada;

  const nat = _naturalezaIC(f);
  if (f.tipo === "emitida") {
    return nat === "bien" ? "E" : "S";
  } else {
    return nat === "bien" ? "A" : "I";
  }
}

/**
 * Validación básica de VAT intracomunitario.
 * Formato: 2 letras país + 8-12 caracteres alfanuméricos.
 * (La validación VIES real está en validaciones.js — Lote 12.)
 */
function _tieneVATValido(nif) {
  if (!nif) return false;
  const clean = String(nif).replace(/[-\s]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{8,12}$/.test(clean);
}

/**
 * Calcula el Modelo 349 del trimestre/mes actual agrupado por clave + NIF.
 * El 349 puede ser trimestral, mensual o bimensual según el volumen
 * (art. 81.1 RIVA). Aquí lo calculamos por trimestre; la periodicidad
 * real la decide el perfil del declarante.
 */
export async function calcModelo349() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const uid349 = SESSION?.user?.id;

  // Leer TODOS los campos — necesitamos `lineas` para el desglose y
  // `naturaleza`, `es_rectificativa`, `cliente_pais` para clasificar.
  const { data: ops } = await supabase.from("facturas")
    .select("*")
    .eq("user_id", uid349)
    .eq("tipo_operacion", "intracomunitaria")
    .gte("fecha", ini).lte("fecha", fin)
    .not("estado", "eq", "anulada");

  // Acumulador: key = clave + "|" + NIF-VAT
  const grupos = {};

  // Operaciones sin VAT válido (no son declarables en el 349 pero se
  // avisan como error en el PDF — el usuario debería corregirlas
  // antes de presentar o perder la exención IC).
  const errores = [];

  (ops || []).forEach(f => {
    // Emitidas sólo si están "emitida"
    if (f.tipo === "emitida" && f.estado !== "emitida") return;

    const clave = _claveOperacion349(f);
    const nifClean = String(f.cliente_nif || "").replace(/[-\s]/g, "").toUpperCase();

    // Validar VAT
    if (!_tieneVATValido(nifClean)) {
      errores.push({
        factura:  f.numero_factura || "(sin número)",
        nombre:   f.cliente_nombre || "(sin nombre)",
        nif:      f.cliente_nif    || "(vacío)",
        motivo:   "VAT comunitario no válido o ausente. Sin VAT válido, la operación no puede acogerse a la exención del art. 25 LIVA."
      });
      return;
    }

    // Agrupación por (clave, NIF-VAT)
    const key = clave + "|" + nifClean;
    if (!grupos[key]) {
      grupos[key] = {
        clave,
        nif:           nifClean,
        nombre:        f.cliente_nombre || "—",
        pais:          f.cliente_pais   || nifClean.slice(0, 2),
        importe:       0,
        numOperaciones: 0,
        // Para rectificativas necesitamos saber a qué periodo anterior afectan
        periodo_rectificado: null,
        base_rectificada:    null,
      };
    }

    const d = desglosarIva(f);
    grupos[key].importe += d.base_total;
    grupos[key].numOperaciones += 1;

    // Si es rectificativa, guardar el periodo original si lo conocemos
    if (clave === "R" && f.rectif_factura_original) {
      grupos[key].periodo_rectificado = f.rectif_factura_original;
      grupos[key].base_rectificada     = Math.abs(d.base_total);
    }
  });

  // Redondeo
  Object.values(grupos).forEach(g => {
    g.importe = _r(g.importe);
  });

  // Array final ordenado: primero las claves "normales", luego R
  const declarables = Object.values(grupos)
    .filter(g => Math.abs(g.importe) > 0)
    .sort((a, b) => {
      if (a.clave === "R" && b.clave !== "R") return 1;
      if (b.clave === "R" && a.clave !== "R") return -1;
      return Math.abs(b.importe) - Math.abs(a.importe);
    });

  // Totales por clave para el resumen
  const totalesPorClave = {};
  for (const c of ["E", "A", "T", "S", "I", "M", "H", "R"]) {
    totalesPorClave[c] = {
      operaciones: declarables.filter(d => d.clave === c).length,
      base:        _r(declarables.filter(d => d.clave === c).reduce((s, d) => s + d.importe, 0)),
    };
  }
  const totalBase349 = _r(declarables.reduce((s, d) => s + d.importe, 0));

  // Actualizar UI del dashboard
  const s349 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s349("m349Count", declarables.length);
  s349("m349Base",  fmt(totalBase349));

  return {
    declarables,
    totalesPorClave,
    totalBase: totalBase349,
    errores,
    year, trim,
  };
}

/**
 * PDF del 349 con desglose por claves y tabla de declarados.
 */
export async function exportModelo349PDF() {
  const data = await calcModelo349();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  // Construir filas del resumen por clave
  const CLAVE_DESCRIP = {
    E: "Entregas intracomunitarias de bienes",
    A: "Adquisiciones intracomunitarias de bienes",
    T: "Operaciones triangulares",
    S: "Prestaciones intracomunitarias de servicios",
    I: "Adquisiciones intracomunitarias de servicios",
    M: "Entregas posteriores a transporte desde ES",
    H: "Entregas posteriores a AIC (operador intermedio)",
    R: "Rectificaciones de periodos anteriores",
  };

  const filas = [];
  for (const c of ["E", "A", "T", "S", "I", "M", "H", "R"]) {
    const t = data.totalesPorClave[c];
    if (t.operaciones > 0) {
      filas.push({ label: `Clave ${c} — ${CLAVE_DESCRIP[c]} (${t.operaciones} decl.)`, valor: t.base });
    }
  }
  filas.push({ label: "TOTAL BASE DECLARADA", valor: data.totalBase, bold: true });

  if (data.errores.length > 0) {
    filas.push({ label: `⚠️ Operaciones con VAT inválido (NO declarables): ${data.errores.length}`, valor: null, texto: "Ver detalle en PDF" });
  }

  await generarPDFModelo({
    numero: "349",
    titulo: "DECLARACIÓN RECAPITULATIVA DE OPERACIONES INTRACOMUNITARIAS",
    subtitulo: `Entregas y adquisiciones intracomunitarias de bienes y servicios (Orden EHA/769/2010)`,
    year: data.year, trim: data.trim,
    resultado: data.totalBase,
    labelResultado: "TOTAL BASE INTRACOMUNITARIA",
    filas,
    plazo: TRIM_PLAZOS[data.trim],
    nota: "Declaración informativa sin cuota a ingresar (Art. 78-81 RIVA). El fichero oficial .349 está disponible desde el botón «Descargar fichero 349» para importar en la Sede Electrónica AEAT. Periodicidad: trimestral por defecto; mensual si superan 50.000 €/trim en entregas intracomunitarias (art. 81.1 RIVA)."
  });

  // Si hay errores de VAT, ayudamos al usuario generando un PDF adicional
  // con el detalle (sólo si hay errores).
  if (data.errores.length > 0) {
    await _generarPDFErrores349(data, pf);
  }
}

/**
 * PDF complementario listando las operaciones con VAT inválido
 * que NO se han declarado en el 349. Ayuda al usuario a corregirlas.
 * @private
 */
async function _generarPDFErrores349(data, pf) {
  await _cargarJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, MR = 18, W = PW - ML - MR;
  const RED = [220, 38, 38], INK = [15, 23, 42], MUTED = [100, 116, 139];

  doc.setFillColor(...RED); doc.rect(0, 0, PW, 24, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("MODELO 349 — ERRORES DE VALIDACIÓN", PW / 2, 11, { align: "center" });
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text(`Operaciones con VAT inválido — Ejercicio ${data.year} · ${data.trim}`, PW / 2, 18, { align: "center" });

  let y = 32;
  doc.setTextColor(...INK); doc.setFontSize(9);
  doc.text(`${data.errores.length} operación${data.errores.length > 1 ? "es" : ""} intracomunitaria${data.errores.length > 1 ? "s" : ""} detectada${data.errores.length > 1 ? "s" : ""} sin VAT válido.`, ML, y); y += 6;
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Sin VAT comunitario válido no se puede aplicar la exención del art. 25 LIVA.", ML, y); y += 4;
  doc.text("Corrige estos NIF-VAT o repercute IVA español antes de presentar el 349.", ML, y); y += 10;

  doc.setFillColor(...RED);
  doc.rect(ML, y, W, 8, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text("Nº factura",         ML + 2,  y + 5.5);
  doc.text("Cliente/Proveedor",  ML + 34, y + 5.5);
  doc.text("NIF registrado",     ML + 94, y + 5.5);
  doc.text("Motivo",             ML + 128, y + 5.5);
  y += 8;
  doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);

  data.errores.forEach((e, i) => {
    if (y > 270) { doc.addPage(); y = 18; }
    if (i % 2 === 0) doc.setFillColor(254, 242, 242); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 10, "F");
    doc.text(e.factura.substring(0, 18),        ML + 2,   y + 4);
    doc.text((e.nombre || "").substring(0, 28), ML + 34,  y + 4);
    doc.text(e.nif.substring(0, 15),            ML + 94,  y + 4);
    const motivoLines = doc.splitTextToSize(e.motivo, W - 132);
    doc.text(motivoLines, ML + 128, y + 4);
    y += 10;
  });

  y += 10;
  doc.setFont("helvetica", "italic"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text("Valida estos NIF-VAT en la base VIES: https://ec.europa.eu/taxation_customs/vies/", ML, y);

  doc.save(`modelo_349_errores_${data.year}_${data.trim}.pdf`);
  toast(`⚠️ Generado informe de errores 349 (${data.errores.length} operaciones con VAT inválido)`, "warn", 6000);
}

/* ══════════════════════════════════════════════════════════════════
   FICHERO OFICIAL AEAT — MODELO 349 (.txt / .349)
   Diseño de registro según Orden EHA/769/2010 modificada
   
   Estructura:
     - Registro tipo 1: Declarante (500 bytes)
     - Registros tipo 2: Un registro por cada declarado (500 bytes c/u)
══════════════════════════════════════════════════════════════════ */
export async function exportarFichero349() {
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();
  if (!pf?.nif) {
    toast("⚠️ Necesitas configurar tu NIF en Perfil fiscal antes de exportar el fichero oficial", "warn", 5000);
    return;
  }

  const data349 = await calcModelo349();
  if (!data349.declarables.length) {
    toast(`No hay operaciones intracomunitarias declarables en ${data349.trim} ${data349.year}`, "warn");
    return;
  }

  // Helpers idénticos al 347
  const sanitizar = (s) => String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\xFF]/g, "?")
    .toUpperCase();
  const rpad  = (v, n) => sanitizar(v).padEnd(n, " ").slice(0, n);
  const lpad  = (v, n) => String(v || "").padStart(n, " ").slice(0, n);
  const lpad0 = (v, n) => String(v || "0").padStart(n, "0").slice(0, n);
  const importe13 = (v) => lpad0(Math.round(Math.abs(Number(v) || 0) * 100), 13);
  const signo     = (v) => (Number(v) || 0) < 0 ? "N" : " ";

  const nifDecl     = rpad((pf.nif || "").replace(/[-\s]/g, ""), 9);
  const nombreDecl  = rpad(pf.nombre_razon_social || "TAURIX", 40);
  const ejercicio   = String(data349.year).padStart(4, "0");
  const trim349     = data349.trim.replace("T", "");    // "1","2","3","4"
  const periodo     = trim349 + "T";                    // "1T","2T",...
  const telefono    = lpad0((pf.telefono || "").replace(/\D/g, "").slice(0, 9), 9);
  const nombreContacto = rpad(pf.persona_contacto || pf.nombre_razon_social || "", 40);

  /* ── REGISTRO TIPO 1: Declarante ────────────────────────────── */
  const totalDeclarados = data349.declarables.length;
  const totalImportes   = data349.declarables.reduce((s, d) => s + Math.abs(d.importe), 0);
  const totalRectif     = data349.totalesPorClave.R.operaciones;

  let reg1 = "";
  reg1 += "1";                              // 001: Tipo registro
  reg1 += "349";                            // 002-004: Modelo
  reg1 += ejercicio;                        // 005-008: Ejercicio
  reg1 += nifDecl;                          // 009-017: NIF declarante
  reg1 += nombreDecl;                       // 018-057: Apellidos/nombre declarante
  reg1 += "T";                              // 058: Tipo soporte (T=telemático)
  reg1 += telefono;                         // 059-067: Teléfono contacto
  reg1 += nombreContacto;                   // 068-107: Persona contacto
  reg1 += lpad("", 13);                     // 108-120: Núm. identificativo declaración
  reg1 += " ";                              // 121: Declaración complementaria (C / " ")
  reg1 += " ";                              // 122: Declaración sustitutiva  (S / " ")
  reg1 += lpad("", 13);                     // 123-135: Núm. declaración anterior
  reg1 += periodo;                          // 136-137: Periodo (1T, 2T, 3T, 4T, 01-12 para mensual)
  reg1 += lpad0(totalDeclarados, 5);        // 138-142: Total declarados (tipo 2 excluyendo rectif)
  reg1 += importe13(totalImportes);         // 143-155: Total importes
  reg1 += lpad0(totalRectif, 5);            // 156-160: Total registros rectificativos
  reg1 += importe13(data349.totalesPorClave.R.base);  // 161-173: Total importe rectificaciones
  reg1 = reg1.padEnd(500, " ").slice(0, 500);

  /* ── REGISTROS TIPO 2: Declarados ───────────────────────────── */
  const reg2s = data349.declarables.map((d) => {
    const nifDecd = rpad(d.nif, 17);        // NIF-VAT con prefijo país (ej. "DE123456789")
    const nombreDecd = rpad(d.nombre, 40);

    let r = "";
    r += "2";                               // 001: Tipo registro
    r += "349";                             // 002-004: Modelo
    r += ejercicio;                         // 005-008: Ejercicio
    r += nifDecl;                           // 009-017: NIF declarante
    r += rpad("", 40);                      // 018-057: Apellidos declarante (blanco en reg2)
    r += nifDecd;                           // 058-074: NIF-VAT del declarado (17)
    r += nombreDecd;                        // 075-114: Nombre declarado
    r += d.clave;                           // 115: Clave de operación (E, A, S, I, T, M, H, R)
    r += importe13(d.importe);              // 116-128: Base imponible (13)
    r += signo(d.importe);                  // 129: Signo
    // Rectificaciones: campos adicionales sólo para clave R
    if (d.clave === "R") {
      r += lpad0(d.periodo_rectificado ? (d.year || data349.year) : "", 4); // 130-133: Ejercicio periodo rectificado
      r += rpad(d.periodo_rectificado ? periodo : "", 2);                   // 134-135: Periodo rectificado
      r += importe13(d.base_rectificada || 0);                              // 136-148: Base rectificada
      r += signo(d.base_rectificada || 0);                                  // 149: Signo
    }
    r = r.padEnd(500, " ").slice(0, 500);
    return r;
  });

  const contenido = [reg1, ...reg2s].join("\r\n") + "\r\n";

  // Convertir a ISO-8859-1
  const buffer = new Uint8Array(contenido.length);
  for (let i = 0; i < contenido.length; i++) {
    const code = contenido.charCodeAt(i);
    buffer[i] = code <= 0xFF ? code : 0x3F;
  }

  // Nombre fichero oficial AEAT
  const nombreFichero = `349${ejercicio}${trim349}T${nifDecl.trim()}.349`;
  const blob = new Blob([buffer], { type: "text/plain;charset=iso-8859-1" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = nombreFichero;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);

  toast(`✅ Fichero oficial 349 generado (${data349.declarables.length} declarados) — importa en la Sede Electrónica AEAT`, "success", 7000);
}

/* ══════════════════════════════════════════════════════════════════
   MODELO 390 — Declaración-resumen anual del IVA
   Orden HAC/819/2024 (versión 2024 — vigente para ejercicio 2025)
   Art. 71.4 RIVA · Informativa (no liquidatoria)
   
   REFACTORIZACIÓN v2 (post-auditoría fiscal 2026):
   ─────────────────────────────────────────────────────────────────
   ▸ Hallazgo 1 del informe: multi-IVA real mediante desglosarIva()
     en lugar de la fórmula ingenua base × iva_pct / 100.
   ▸ Hallazgo 10: redondeo simétrico por factura y por tipo de IVA.
   ▸ Hallazgo 11: deducibilidad vía esDeducibleIVA() centralizado
     (sustituye la heurística TIQ- inline).
   ▸ Hallazgo 17 (CLAVE): el 390 DEBE incluir también operaciones
     exentas sin cuota (exportaciones, entregas IC, ISP emitida,
     exento art. 20 LIVA), adquisiciones IC y ISP recibida.
     Antes el early-return `if (cuota <= 0) return` las descartaba
     todas, produciendo discrepancias inmediatas con el Modelo 349
     del mismo declarante.
   ▸ Hallazgo 24: ISP recibida usa la cuota real del documento; si
     la factura UE viene sin IVA se aplica 21% como tipo por defecto.
   ▸ Hallazgo 28: las etiquetas de casillas corresponden al diseño
     vigente publicado en BOE.
══════════════════════════════════════════════════════════════════ */

/**
 * Calcula el Modelo 390 completo agregando los 4 trimestres.
 *
 * @param {number} [year] - Ejercicio (defecto: año en curso).
 * @returns {Promise<Object>} Objeto con todas las casillas relevantes.
 */
export async function calcModelo390(year) {
  const y = year || getYear();

  /* ── Acumuladores por casilla ────────────────────────────────── */
  // IVA devengado interior — base y cuota por tipo
  const devBase = { 21: 0, 10: 0, 4: 0, 0: 0 };
  const devCuota = { 21: 0, 10: 0, 4: 0, 0: 0 };
  // Recargo de equivalencia (bases y cuotas) — soportado solo si el
  // declarante factura a sujetos en recargo. Taurix aún no modela
  // régimen REQ; se deja a 0 para no confundir.
  // Adquisiciones intracomunitarias y ISP — base y cuota autoliquidadas
  let baseIcAdq = 0, cuotaIcAdq = 0;
  let baseIspRec = 0, cuotaIspRec = 0;
  // Operaciones EXENTAS y especiales (todas las bases, aunque cuota = 0)
  let baseExportacion     = 0;  // art. 21 LIVA (cas. 103)
  let baseIcEntrega       = 0;  // art. 25 LIVA (cas. 99)
  let baseExentoInterior  = 0;  // art. 20 LIVA (cas. 105) — sin derecho
  let baseIspEmitida      = 0;  // art. 84 LIVA (cas. 122)
  // IVA soportado (interior, importaciones, bienes inversión)
  let sopInteriorBase = 0, sopInteriorCuota = 0;
  let sopImportBase   = 0, sopImportCuota   = 0;
  let sopInversionBase = 0, sopInversionCuota = 0; // bienes inversión (cas. 35-36)
  // Rectificaciones (bases de facturas rectificativas — signo negativo)
  let rectifRep = 0, rectifSop = 0;
  // Operaciones no sujetas (art. 7 LIVA) — p. ej. muestras gratuitas
  // Taurix no las modela explícitamente; se deja 0 por ahora.

  /* ── Recorrer los 4 trimestres ──────────────────────────────── */
  for (const trim of ["T1", "T2", "T3", "T4"]) {
    const facs = await getFacturasTrim(y, trim);
    for (const f of (facs || [])) {
      const op = f.tipo_operacion || "nacional";
      const d  = desglosarIva(f);                     // ← multi-IVA real

      /* ── Facturas EMITIDAS ──────────────────────────────────── */
      if (f.tipo === "emitida" && f.estado === "emitida") {
        // Rectificativas: signo ya viene negativo en las bases
        if (f.es_rectificativa || (f.base < 0)) {
          rectifRep += d.base_total + d.cuota_total;
        }

        switch (op) {
          case "exportacion":
            baseExportacion += d.base_total;
            break;

          case "intracomunitaria":
            baseIcEntrega += d.base_total;
            break;

          case "inversion_sujeto_pasivo":
            baseIspEmitida += d.base_total;
            break;

          case "exento":
            baseExentoInterior += d.base_total;      // sin derecho a deducir
            break;

          default:
            // Nacional sujeta — desglosar por tipo de IVA
            for (const pct of TIPOS_IVA_VALIDOS) {
              devBase[pct]  += d[pct].base;
              devCuota[pct] += d[pct].cuota;
            }
        }
      }

      /* ── Facturas RECIBIDAS ─────────────────────────────────── */
      else if (f.tipo === "recibida" && f.estado !== "anulada") {
        // Rectificativas recibidas
        if (f.es_rectificativa || (f.base < 0)) {
          rectifSop += d.cuota_total;
        }

        const deducible = esDeducibleIVA(f);
        const pctDed    = (f.pct_deduccion_iva ?? 100) / 100;

        switch (op) {
          case "importacion":
            sopImportBase  += d.base_total;
            if (deducible) sopImportCuota += d.cuota_total * pctDed;
            break;

          case "intracomunitaria": {
            // Art. 85 LIVA — si factura UE sin IVA, aplicar 21% por defecto
            const cuotaAIC = d.cuota_total > 0
              ? d.cuota_total
              : d.base_total * 0.21;
            baseIcAdq  += d.base_total;
            cuotaIcAdq += cuotaAIC;                 // devengado
            // Deducible en la misma declaración (efecto neutro si deducible)
            if (deducible) sopInteriorCuota += cuotaAIC * pctDed;
            break;
          }

          case "inversion_sujeto_pasivo": {
            // Art. 84 LIVA — usar cuota real; fallback 21% solo si viene a 0
            const cuotaISP = d.cuota_total > 0
              ? d.cuota_total
              : d.base_total * 0.21;
            baseIspRec  += d.base_total;
            cuotaIspRec += cuotaISP;
            if (deducible) sopInteriorCuota += cuotaISP * pctDed;
            break;
          }

          default:
            // Nacional: separar bienes inversión del resto
            // Taurix identifica bienes inversión por tabla `bienes_inversion`.
            // Como aquí no tenemos esa info cruzada por factura, acumulamos
            // en soportado interior (el ajuste fino se hace en tax-iva.js).
            sopInteriorBase += d.base_total;
            if (deducible) sopInteriorCuota += d.cuota_total * pctDed;
        }
      }
    }
  }

  /* ── Redondeo simétrico por bloque ─────────────────────────── */
  for (const pct of TIPOS_IVA_VALIDOS) {
    devBase[pct]  = _r(devBase[pct]);
    devCuota[pct] = _r(devCuota[pct]);
  }
  baseIcAdq         = _r(baseIcAdq);
  cuotaIcAdq        = _r(cuotaIcAdq);
  baseIspRec        = _r(baseIspRec);
  cuotaIspRec       = _r(cuotaIspRec);
  baseExportacion   = _r(baseExportacion);
  baseIcEntrega     = _r(baseIcEntrega);
  baseExentoInterior = _r(baseExentoInterior);
  baseIspEmitida    = _r(baseIspEmitida);
  sopInteriorBase   = _r(sopInteriorBase);
  sopInteriorCuota  = _r(sopInteriorCuota);
  sopImportBase     = _r(sopImportBase);
  sopImportCuota    = _r(sopImportCuota);
  rectifRep         = _r(rectifRep);
  rectifSop         = _r(rectifSop);

  /* ── Totales ─────────────────────────────────────────────── */
  const totalBaseDevengado = _r(
    devBase[21] + devBase[10] + devBase[4] + devBase[0] +
    baseIcAdq + baseIspRec
  );
  const repTotal = _r(
    devCuota[21] + devCuota[10] + devCuota[4] + devCuota[0] +
    cuotaIcAdq + cuotaIspRec
  );
  const sopTotal = _r(sopInteriorCuota + sopImportCuota);
  const resultado = _r(repTotal - sopTotal);

  /* ── Total operaciones realizadas (cas. 108 — informativa) ── */
  const volumenOperaciones = _r(
    devBase[21] + devBase[10] + devBase[4] + devBase[0] +
    baseExportacion + baseIcEntrega + baseExentoInterior +
    baseIspEmitida + baseIcAdq + baseIspRec
  );

  /* ── Pintar en el UI del dashboard si existen los nodos ─── */
  const s390 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s390("m390Rep", repTotal);
  s390("m390Sop", sopTotal);
  s390("m390Res", resultado);

  return {
    year: y,
    // Totales agregados (compat con código legacy — NO cambiar nombres)
    repTotal,
    sopTotal,
    resultado,
    // Desglose IVA devengado interior
    devBase,                                  // bases por tipo {21,10,4,0}
    devCuota,                                 // cuotas por tipo {21,10,4,0}
    // Autoliquidaciones (AIC + ISP recibida)
    baseIcAdq,   cuotaIcAdq,
    baseIspRec,  cuotaIspRec,
    // Operaciones exentas / especiales (base sin cuota)
    baseExportacion,                          // cas. 103
    baseIcEntrega,                            // cas. 99
    baseExentoInterior,                       // cas. 105
    baseIspEmitida,                           // cas. 122
    // IVA soportado
    sopInteriorBase,  sopInteriorCuota,
    sopImportBase,    sopImportCuota,
    // Rectificaciones
    rectifRep,  rectifSop,
    // Totales informativos
    totalBaseDevengado,
    volumenOperaciones,                       // cas. 108
  };
}

/**
 * Exporta el Modelo 390 como PDF con desglose completo por casillas.
 * Ahora incluye las bases de operaciones exentas y especiales
 * (Hallazgo 17: antes solo se veían las que tenían cuota).
 */
export async function exportModelo390PDF() {
  const data = await calcModelo390();

  // Solo incluimos filas con valor distinto de 0 para no saturar el PDF
  const _row = (label, valor, opts = {}) =>
    (Math.abs(valor) > 0.005 || opts.siempre) ? { label, valor, ...opts } : null;

  const filas = [
    // ── IVA devengado interior
    _row("Cas. 01 · Base 21% — Régimen general", data.devBase[21]),
    _row("Cas. 03 · Cuota IVA 21%",              data.devCuota[21]),
    _row("Cas. 04 · Base 10%",                   data.devBase[10]),
    _row("Cas. 06 · Cuota IVA 10%",              data.devCuota[10]),
    _row("Cas. 07 · Base 4%",                    data.devBase[4]),
    _row("Cas. 09 · Cuota IVA 4%",               data.devCuota[4]),
    // ── Adquisiciones intracomunitarias e ISP
    _row("Cas. 22 · Base adquisiciones IC",      data.baseIcAdq),
    _row("Cas. 24 · Cuota IVA adq. IC",          data.cuotaIcAdq),
    _row("Cas. 25 · Base ISP recibida",          data.baseIspRec),
    _row("Cas. 27 · Cuota IVA ISP recibida",     data.cuotaIspRec),
    // ── Operaciones exentas y especiales
    _row("Cas. 99 · Entregas IC exentas (art. 25 LIVA)", data.baseIcEntrega),
    _row("Cas. 103 · Exportaciones (art. 21 LIVA)",      data.baseExportacion),
    _row("Cas. 105 · Operaciones exentas interior (art. 20 LIVA, sin derecho)", data.baseExentoInterior),
    _row("Cas. 122 · ISP emitida (art. 84 LIVA)",        data.baseIspEmitida),
    // ── Totales devengado
    _row("TOTAL BASE IMPONIBLE DEVENGADO",       data.totalBaseDevengado,  { bold: true, siempre: true }),
    _row("TOTAL IVA DEVENGADO",                  data.repTotal,            { bold: true, siempre: true }),
    // ── IVA soportado
    _row("Cas. 28 · Base operaciones interiores deducibles",  data.sopInteriorBase),
    _row("Cas. 29 · Cuota IVA soportado interior",            data.sopInteriorCuota),
    _row("Cas. 32 · Base importaciones",                      data.sopImportBase),
    _row("Cas. 33 · Cuota IVA soportado importaciones",       data.sopImportCuota),
    _row("TOTAL IVA SOPORTADO DEDUCIBLE",        data.sopTotal,            { bold: true, siempre: true }),
    // ── Rectificaciones
    _row("Rectificaciones IVA repercutido",      data.rectifRep),
    _row("Rectificaciones IVA soportado",        data.rectifSop),
    // ── Volumen total (cas. 108)
    _row("Cas. 108 · VOLUMEN DE OPERACIONES",    data.volumenOperaciones,  { bold: true, siempre: true }),
    // ── Resultado final
    _row("RESULTADO LIQUIDACIONES AÑO",          data.resultado,           { bold: true, siempre: true }),
  ].filter(Boolean);

  await generarPDFModelo({
    numero: "390",
    titulo: "DECLARACIÓN-RESUMEN ANUAL DEL IVA",
    subtitulo: "Resumen consolidado de las declaraciones-liquidaciones periódicas del IVA (Modelo 303)",
    year: data.year, trim: "ANUAL",
    resultado: data.resultado,
    labelResultado: data.resultado >= 0 ? "RESULTADO ANUAL (IVA DEVENGADO − SOPORTADO)" : "RESULTADO ANUAL (SALDO NEGATIVO)",
    filas,
    plazo: "Del 1 al 30 de enero del año siguiente",
    nota: "Declaración informativa anual (Art. 71.4 RIVA / Orden HAC/819/2024). Debe presentarse aunque el resultado neto anual sea cero o negativo. Documento orientativo generado por Taurix — verifique cada casilla con su asesor antes de presentar ante la AEAT."
  });
}

/* ══════════════════════════
   MODELO 190 — Resumen anual retenciones
══════════════════════════ */
export async function exportModelo190PDF() {
  const year = getYear();
  const data190 = await calcModelo111();

  await generarPDFModelo({
    numero: "190",
    titulo: "RESUMEN ANUAL RETENCIONES E INGRESOS A CUENTA IRPF",
    subtitulo: "Rendimientos del trabajo, actividades económicas y otras rentas",
    year, trim: "ANUAL",
    resultado: 0 + data190.retProf,
    filas: [
      { label: "Retenciones rendimientos del trabajo", valor: 0 },
      { label: "Retenciones rendimientos profesionales", valor: data190.retProf },
      { label: "TOTAL RETENCIONES AÑO", valor: 0 + data190.retProf, bold: true },
    ],
    plazo: "Enero del año siguiente",
    nota: "Declaración informativa anual complementaria al Modelo 111. Debe incluir todos los perceptores con datos identificativos."
  });
}

/* ══════════════════════════
   GENERADOR PDF GENÉRICO MODELOS
══════════════════════════ */
async function generarPDFModelo({ numero, titulo, subtitulo, year, trim, resultado, filas, plazo, nota, labelResultado }) {
  await _cargarJsPDF();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, PH = 297, ML = 18, MR = 18, MB = 22, W = PW - ML - MR;
  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139], LIGHT = [248, 250, 252];

  let y = 42;

  // ── Helper: asegurar que queda espacio en la página; si no, nueva página
  const _needSpace = (h) => {
    if (y + h > PH - MB) {
      doc.addPage();
      y = 22;
      // Cabecera compacta en páginas siguientes
      doc.setTextColor(...MUTED); doc.setFontSize(8);
      doc.text(`Modelo ${numero} · ${pf?.nombre_razon_social || ""} · ${year}`, ML, y);
      y += 8;
    }
  };

  // Cabecera (solo en la primera página)
  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`MODELO ${numero}`, ML, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(titulo, ML, 20);
  doc.setFontSize(8);
  doc.text(subtitulo, ML, 27);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(`M-${numero}`, PW - MR, 20, { align: "right" });

  doc.setTextColor(...INK);

  // Datos contribuyente
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 18, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("DATOS DEL OBLIGADO TRIBUTARIO", ML + 4, y + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(`${pf?.nombre_razon_social || "—"}`, ML + 4, y + 11);
  doc.text(`NIF: ${pf?.nif || "—"}`, ML + 4, y + 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`Periodo: ${trim} · ${year}`, PW - MR, y + 11, { align: "right" });
  doc.text(`Plazo: ${plazo}`, PW - MR, y + 16, { align: "right" });
  y += 26;

  // Cuerpo del modelo
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("LIQUIDACIÓN", ML, y); y += 6;
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.5); doc.line(ML, y, PW - MR, y); y += 6;

  filas.forEach((f, i) => {
    _needSpace(8);
    if (i % 2 === 0) doc.setFillColor(248, 250, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 8, "F");
    doc.setFont("helvetica", f.bold ? "bold" : "normal");
    doc.setFontSize(f.bold ? 10 : 9);
    if (f.bold) { doc.setTextColor(...BLUE); } else { doc.setTextColor(...INK); }
    // El label puede ser más largo que la columna; lo recortamos si hace falta
    const labelMaxWidth = W - 55;
    const labelLines = doc.splitTextToSize(f.label, labelMaxWidth);
    doc.text(labelLines[0], ML + 3, y + 5.5);
    if (f.valor !== null && f.valor !== undefined) {
      doc.text(fmt(f.valor), PW - MR - 2, y + 5.5, { align: "right" });
    } else if (f.texto) {
      doc.text(f.texto, PW - MR - 2, y + 5.5, { align: "right" });
    }
    y += 8;
  });

  y += 4;

  // Resultado final
  _needSpace(18);
  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text(labelResultado || "RESULTADO A INGRESAR", ML + 4, y + 9);
  doc.text(fmt(resultado), PW - MR - 2, y + 9, { align: "right" });
  y += 22;

  // Nota legal
  if (nota) {
    const lines = doc.splitTextToSize("NOTA LEGAL: " + nota, W - 8);
    const notaH = lines.length * 4.5 + 8;
    _needSpace(notaH);
    doc.setFillColor(...LIGHT); doc.setDrawColor(200);
    doc.rect(ML, y, W, notaH, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(lines, ML + 4, y + 6);
    y += notaH + 6;
  }

  // Firma / sello
  _needSpace(12);
  doc.setDrawColor(200); doc.line(ML, y, ML + 70, y); doc.line(PW - MR - 70, y, PW - MR, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del obligado tributario", ML + 10, y + 5);
  doc.text("Fecha y sello AEAT", PW - MR - 50, y + 5);

  // Footer (en cada página)
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(
      `Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Página ${p}/${totalPages} · Documento orientativo. Verifique con la AEAT antes de presentar.`,
      PW / 2, 290, { align: "center" }
    );
  }

  doc.save(`modelo_${numero}_${year}_${trim}.pdf`);
  toast(`Modelo ${numero} exportado ✅`, "success");
}

async function _cargarJsPDF() {
  if (window.jspdf?.jsPDF) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ══════════════════════════
   INIT VIEW
══════════════════════════ */
let _omListenersRegistered = false;

export async function initOtrosModelosView() {
  // Actualizar plazos dinámicamente según el trimestre activo
  const trim = (typeof getTrim === "function") ? getTrim() : "T1";
  const plazos = { T1:"20 de abril", T2:"20 de julio", T3:"20 de octubre", T4:"30 de enero" };
  const plazoActual = plazos[trim] ?? "20 de julio";
  document.querySelectorAll(".me-plazo-trim").forEach(el => {
    el.textContent = `Plazo ${trim}: ${plazoActual}`;
  });

  // Calcular todos los modelos en paralelo
  await Promise.all([
    calcModelo111(),
    calcModelo115(),
    calcModelo349(),
    calcModelo390(),
  ]);
  await calcModelo347();

  // Registrar listeners solo una vez — evitar duplicados al navegar
  if (_omListenersRegistered) return;
  _omListenersRegistered = true;

  document.getElementById("export111Btn")?.addEventListener("click", exportModelo111PDF);
  document.getElementById("export115Btn")?.addEventListener("click", exportModelo115PDF);
  document.getElementById("export347Btn")?.addEventListener("click", exportModelo347PDF);
  document.getElementById("exportA3Btn")?.addEventListener("click", exportarParaA3);
  document.getElementById("exportContaPlusBtn")?.addEventListener("click", exportarParaContaPlus);
  document.getElementById("exportFichero347Btn")?.addEventListener("click", exportarFichero347);
  document.getElementById("exportFichero349Btn")?.addEventListener("click", exportarFichero349);
  document.getElementById("exportFichero190Btn")?.addEventListener("click", exportarFichero190);
  document.getElementById("export349Btn")?.addEventListener("click", exportModelo349PDF);
  document.getElementById("export190Btn")?.addEventListener("click", exportModelo190PDF);
  document.getElementById("export390Btn")?.addEventListener("click", exportModelo390PDF);
}

/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN A3 / CONTAPLUS
   Formato de asientos para importar en software contable
══════════════════════════════════════════════════════════ */

/* ── Exportar para A3 (formato Excel estructurado) ── */
export async function exportarParaA3() {
  if (!window.XLSX) {
    await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }

  const year = getYear ? getYear() : new Date().getFullYear();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();
  const { data: facturas } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`)
    .order("fecha");

  const rows = [];

  // Cabecera informativa
  rows.push({
    "EMPRESA":     pf?.nombre_razon_social || "—",
    "NIF":         pf?.nif || "—",
    "EJERCICIO":   year,
    "GENERADO":    new Date().toLocaleDateString("es-ES"),
    "SOFTWARE":    "Taurix → A3",
    "":            "",
  });
  rows.push({});

  // Cabecera columnas del diario
  rows.push({
    "Nº Asiento": "Nº Asiento", "Fecha": "Fecha", "Concepto": "Concepto",
    "Cuenta": "Cuenta", "Descripción cuenta": "Descripción cuenta",
    "Debe": "Debe", "Haber": "Haber", "Documento": "Documento"
  });

  let nAsiento = 1;
  (facturas||[]).forEach(f => {
    const total    = f.base + f.base*(f.iva||0)/100;
    const cuotaIVA = f.base*(f.iva||0)/100;
    const irpfAmt  = f.base*(f.irpf_retencion||f.irpf||0)/100;
    const fecha    = f.fecha;
    const nAsStr   = String(nAsiento).padStart(6,"0");
    const concepto = f.tipo==="emitida"
      ? `Fra. emitida ${f.numero_factura||"S/N"} ${f.cliente_nombre||""}`
      : `Fra. recibida ${f.numero_factura||"S/N"} ${f.cliente_nombre||f.concepto||""}`;

    const mkRow = (cta, desc, debe, haber, doc) => ({
      "Nº Asiento": nAsStr, "Fecha": fecha, "Concepto": concepto,
      "Cuenta": cta, "Descripción cuenta": desc,
      "Debe": debe||"", "Haber": haber||"", "Documento": doc||""
    });
    if (f.tipo==="emitida" && f.estado==="emitida") {
      rows.push(mkRow("430000","Clientes",            (f.base - irpfAmt).toFixed(2), "",           f.numero_factura||""));
      if (irpfAmt>0)  rows.push(mkRow("473000","HP, retenciones",  irpfAmt.toFixed(2), "", ""));
      if (cuotaIVA>0) rows.push(mkRow("477000","HP, IVA repercutido","", cuotaIVA.toFixed(2), ""));
      rows.push(mkRow("705000","Prestaciones de servicios","", f.base.toFixed(2), ""));
    } else if (f.tipo==="recibida") {
      rows.push(mkRow("629000","Otros servicios",     f.base.toFixed(2), "",     f.numero_factura||""));
      if (cuotaIVA>0) rows.push(mkRow("472000","HP, IVA soportado", cuotaIVA.toFixed(2), "", ""));
      rows.push(mkRow("400000","Proveedores",         "", total.toFixed(2), ""));
    }
    rows.push({});
    nAsiento++;
  });

  const ws = window.XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:12},{wch:12},{wch:45},{wch:10},{wch:35},{wch:14},{wch:14},{wch:16}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `Diario ${year}`);
  window.XLSX.writeFile(wb, `taurix_A3_${year}.xlsx`);
  toast("✅ Exportado para A3 — importa el archivo en A3 Asesor → Contabilidad → Importar diario", "success", 6000);
}

/* ── Exportar para ContaPlus (formato .txt registros fijos) ── */
export async function exportarParaContaPlus() {
  const year = getYear ? getYear() : new Date().getFullYear();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();
  const { data: facturas } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`)
    .order("fecha");

  // ContaPlus formato: DDMMAAAA;CCCCCC;CONCEPTO;DEBE;HABER;DOCUMENTO
  const pad  = (v,n,c="0") => String(v).padStart(n,c);
  const padR = (v,n)       => String(v).padEnd(n," ").slice(0,n);
  const fmtImporte = (v)   => (Math.round((v||0)*100)).toString().padStart(15,"0");

  let lineas = [];
  let nAsiento = 1;

  (facturas||[]).forEach(f => {
    const total    = f.base + f.base*(f.iva||0)/100;
    const cuotaIVA = f.base*(f.iva||0)/100;
    const irpfAmt  = f.base*(f.irpf_retencion||f.irpf||0)/100;
    const [yy,mm,dd] = (f.fecha||"2025-01-01").split("-");
    const fecha = `${dd}${mm}${yy}`;
    const nAs   = pad(nAsiento,6);
    const doc   = padR(f.numero_factura||"",12);
    const conc  = padR(f.tipo==="emitida"
      ? `Fra ${f.numero_factura||""} ${f.cliente_nombre||""}`.slice(0,40)
      : `Fra rec ${f.numero_factura||""} ${f.concepto||""}`.slice(0,40), 40);

    const mkLinea = (cta, debe, haber) =>
      `${fecha};${nAs};${padR(cta,10)};${conc};${fmtImporte(debe)};${fmtImporte(haber)};${doc}`;

    if (f.tipo==="emitida" && f.estado==="emitida") {
      lineas.push(mkLinea("4300000000", total-irpfAmt, 0));
      if (irpfAmt>0) lineas.push(mkLinea("4730000000", irpfAmt, 0));
      if (cuotaIVA>0) lineas.push(mkLinea("4770000000", 0, cuotaIVA));
      lineas.push(mkLinea("7050000000", 0, f.base));
    } else if (f.tipo==="recibida") {
      lineas.push(mkLinea("6290000000", f.base, 0));
      if (cuotaIVA>0) lineas.push(mkLinea("4720000000", cuotaIVA, 0));
      lineas.push(mkLinea("4000000000", 0, total));
    }
    nAsiento++;
  });

  const contenido = lineas.join("\r\n");
  const blob = new Blob([contenido], { type:"text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `taurix_ContaPlus_${year}.txt`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast("✅ Exportado para ContaPlus — importa en Contabilidad → Asientos → Importar", "success", 6000);
}

/* ── Fichero oficial AEAT Modelo 347 (.txt formato BOE) ──
   Diseño de registro: BOE-A-2013-12322
   Tipo 1: Registro de declarante
   Tipo 2: Registro de declarado (uno por operación >3.005,06€)
── */
/* ══════════════════════════════════════════════════════════════════
   FICHERO OFICIAL AEAT — MODELO 347 (.txt)
   Diseño de registro: Orden HAC/1148/2024 (en vigor para 2025)
   Continúa la estructura de BOE-A-2013-12322 actualizada.
   
   IMPORTANTE (Hallazgo 20 del informe fiscal):
   · Cada registro tiene EXACTAMENTE 500 bytes.
   · Codificación: ISO-8859-1 (Windows-1252 compatible).
   · Importes: 15 enteros + 2 decimales, con punto decimal "N" si negativo.
   · Desglose trimestral OBLIGATORIO por cada declarado (desde 2014).
   · Registro 1 = declarante · Registro 2 = declarado.
   
   Posiciones clave del registro 2 (declarado):
     001       Tipo registro "2"
     002-004   Modelo "347"
     005-008   Ejercicio (ej. "2025")
     009-017   NIF declarante
     018-057   Apellidos/nombre declarante
     058-066   NIF declarado
     067-075   NIF representante (blanco normalmente)
     076-115   Apellidos/nombre declarado
     116       Código provincia (2 dígitos)
     117-118   Código país ISO 3166 alpha-2 (solo no residentes)
     119       Clave operación (A=compras, B=ventas, ...)
     120-134   Importe anual (15 posiciones, 13 enteros + 2 decimales)
     135       Signo (N=negativo, espacio=positivo)
     136-150   Importe percibido en metálico (15)
     151       Signo metálico
     152       Operación seguros (X/" ")
     153       Arrendamiento local de negocio (X/" ")
     154-168   Importe 1T
     169-183   Importe 2T
     184-198   Importe 3T
     199-213   Importe 4T
     214-500   Reservados (blancos)
══════════════════════════════════════════════════════════════════ */
export async function exportarFichero347() {
  const year = getYear ? getYear() : new Date().getFullYear();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  if (!pf?.nif) {
    toast("⚠️ Necesitas configurar tu NIF en Perfil fiscal antes de exportar el fichero oficial", "warn", 5000);
    return;
  }

  const data347 = await calcModelo347(year);
  const { declarables } = data347;

  if (!declarables.length) {
    toast(`No hay operaciones declarables (≥3.005,06 €) en el ejercicio ${year}`, "warn");
    return;
  }

  /* ── Helpers formato AEAT (longitud fija) ──────────────────────── */
  // Elimina acentos y caracteres no ISO-8859-1 compatibles
  const sanitizar = (s) => String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quitar marcas de acento
    .replace(/[^\x20-\xFF]/g, "?")     // cualquier carácter fuera del rango ISO-8859-1
    .toUpperCase();

  const rpad = (v, n) => sanitizar(v).padEnd(n, " ").slice(0, n);
  const lpad = (v, n) => String(v || "").padStart(n, " ").slice(0, n);
  const lpad0 = (v, n) => String(v || "0").padStart(n, "0").slice(0, n);

  /**
   * Formato importe AEAT 15 posiciones: 13 enteros + 2 decimales, sin punto.
   * Ej: 1234.56 → "00000000123456"
   */
  const importe15 = (v) => {
    const cents = Math.round(Math.abs(Number(v) || 0) * 100);
    return lpad0(cents, 15);
  };
  const signoImporte = (v) => (Number(v) || 0) < 0 ? "N" : " ";

  /* ── Datos del declarante ──────────────────────────────────────── */
  const nifDecl     = rpad((pf.nif || "").replace(/[-\s]/g, ""), 9);
  const nombreDecl  = rpad(pf.nombre_razon_social || "TAURIX", 40);
  const ejercicio   = String(year).padStart(4, "0");
  const telefono    = lpad0((pf.telefono || "").replace(/\D/g, "").slice(0, 9), 9);
  const nombreConct = rpad(pf.persona_contacto || pf.nombre_razon_social || "", 40);

  /* ── REGISTRO TIPO 1 (Declarante) ─────────────────────────────── */
  const totalRegistros = declarables.length;
  const totalImportes  = declarables.reduce((s, d) => s + Math.abs(d.total), 0);
  const totalMetalico  = declarables.reduce((s, d) => s + (d.total_metalico || 0), 0);

  let reg1 = "";
  reg1 += "1";                                // 001: Tipo registro
  reg1 += "347";                              // 002-004: Modelo
  reg1 += ejercicio;                          // 005-008: Ejercicio
  reg1 += nifDecl;                            // 009-017: NIF declarante
  reg1 += nombreDecl;                         // 018-057: Apellidos/nombre declarante
  reg1 += "T";                                // 058: Tipo soporte (T=telemático)
  reg1 += telefono;                           // 059-067: Teléfono contacto (9)
  reg1 += nombreConct;                        // 068-107: Persona contacto (40)
  reg1 += lpad("", 13);                       // 108-120: Núm. declaración (se rellena al presentar)
  reg1 += " ";                                // 121: Declaración complementaria ("C" / " ")
  reg1 += " ";                                // 122: Declaración sustitutiva ("S" / " ")
  reg1 += lpad("", 13);                       // 123-135: Núm. declaración anterior
  reg1 += lpad0(totalRegistros, 9);           // 136-144: Total registros tipo 2
  reg1 += importe15(totalImportes);           // 145-159: Importe total operaciones
  reg1 += signoImporte(totalImportes);        // 160: Signo
  reg1 += importe15(totalMetalico);           // 161-175: Importe total metálico
  reg1 += signoImporte(totalMetalico);        // 176: Signo metálico
  reg1 += lpad("", 9);                        // 177-185: NIF representante legal
  // 186-500: Reservados (blancos)
  reg1 = reg1.padEnd(500, " ").slice(0, 500);

  /* ── REGISTROS TIPO 2 (Declarados) ────────────────────────────── */
  const reg2s = declarables.map((d, i) => {
    const nifDecd    = rpad((d.nif || "").replace(/[-\s]/g, ""), 9);
    const nombreDecd = rpad(d.nombre || "DESCONOCIDO", 40);
    // Clave de operación (art. 33 RD 1065/2007):
    //   A = Adquisiciones (compras)   — factura recibida → "A"
    //   B = Entregas (ventas)         — factura emitida  → "B"
    //   C, D, E, F, G, H... otros casos (no aplicables a Taurix básico)
    const clave = d.tipo === "emitida" ? "B" : "A";
    // Provincia: si no tenemos el dato del usuario, dejamos "00" (desconocido)
    const provincia = d.provincia ? lpad0(d.provincia, 2) : "00";
    // País (solo no residentes — para ES va en blanco)
    const codPais = (d.pais && d.pais !== "ES") ? rpad(d.pais, 2) : "  ";

    let r = "";
    r += "2";                                 // 001: Tipo registro
    r += "347";                               // 002-004: Modelo
    r += ejercicio;                           // 005-008: Ejercicio
    r += nifDecl;                             // 009-017: NIF declarante
    r += rpad("", 40);                        // 018-057: Apellidos declarante (blanco en reg2)
    r += nifDecd;                             // 058-066: NIF declarado
    r += rpad("", 9);                         // 067-075: NIF representante
    r += nombreDecd;                          // 076-115: Nombre declarado
    r += provincia;                           // 116-117: Código provincia (2)
    r += codPais;                             // 118-119: Código país (2)
    r += clave;                               // 120: Clave operación
    r += importe15(d.total);                  // 121-135: Importe anual total (15)
    r += signoImporte(d.total);               // 136: Signo importe
    r += importe15(d.total_metalico || 0);    // 137-151: Importe percibido en metálico
    r += signoImporte(d.total_metalico || 0); // 152: Signo metálico
    r += " ";                                 // 153: Operación seguros (N/A aquí)
    r += d.es_alquiler_local_negocio ? "X" : " "; // 154: Arrendamiento local de negocio ✓
    r += importe15(d.trim_T1);                // 155-169: Importe 1T
    r += signoImporte(d.trim_T1);             // 170: Signo 1T
    r += importe15(d.trim_T2);                // 171-185: Importe 2T
    r += signoImporte(d.trim_T2);             // 186: Signo 2T
    r += importe15(d.trim_T3);                // 187-201: Importe 3T
    r += signoImporte(d.trim_T3);             // 202: Signo 3T
    r += importe15(d.trim_T4);                // 203-217: Importe 4T
    r += signoImporte(d.trim_T4);             // 218: Signo 4T
    // 219-500: Reservados (blancos)
    r = r.padEnd(500, " ").slice(0, 500);

    return r;
  });

  /* ── Unir todos los registros ──────────────────────────────────── */
  const contenido = [reg1, ...reg2s].join("\r\n") + "\r\n";

  /* ── Convertir a ISO-8859-1 (Windows-1252) ─────────────────────── */
  // JavaScript nativo no tiene TextEncoder ISO-8859-1, lo hacemos manual.
  // Después de sanitizar(), toda la cadena tiene solo chars en el rango 0x20-0xFF.
  const buffer = new Uint8Array(contenido.length);
  for (let i = 0; i < contenido.length; i++) {
    const code = contenido.charCodeAt(i);
    // Saltos \r\n también caben en el byte de 8 bits
    buffer[i] = code <= 0xFF ? code : 0x3F;    // '?' si algo raro se colara
  }

  /* ── Descargar ─────────────────────────────────────────────────── */
  const nombreFichero = `347${year}${nifDecl.trim()}.txt`;
  const blob = new Blob([buffer], { type: "text/plain;charset=iso-8859-1" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = nombreFichero;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);

  toast(`✅ Fichero oficial 347 generado (${declarables.length} declarados) — importa en la Sede Electrónica AEAT`, "success", 7000);
}

/* ── Fichero oficial AEAT Modelo 190 (.txt formato BOE) ──
   Resumen anual retenciones e ingresos a cuenta IRPF
── */
export async function exportarFichero190() {
  const year = getYear ? getYear() : new Date().getFullYear();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  if (!pf?.nif) {
    toast("⚠️ Necesitas configurar tu NIF en Perfil fiscal antes de exportar el fichero oficial", "warn", 5000);
    return;
  }

  // Obtener perceptores — solo profesionales (facturas con retención IRPF)
  const { data: facturas } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`)
    .eq("tipo","emitida").not("irpf_retencion","is",null)
    .gt("irpf_retencion", 0);

  const rpad  = (v,n) => String(v||"").toUpperCase().padEnd(n," ").slice(0,n);
  const lpad0 = (v,n) => String(Math.round(v||0)).padStart(n,"0").slice(0,n);
  const nifDec = rpad((pf.nif||"").replace(/[-\s]/g,""), 9);
  const nomDec = rpad(pf.nombre_razon_social||"", 40);

  const perceptores = [];

  // Profesionales (facturas con retención IRPF — clave G, art. 95.1 RIRPF)
  const porProf = {};
  (facturas||[]).forEach(f => {
    const k = (f.cliente_nif||f.cliente_nombre||"DESCONOCIDO").toUpperCase();
    if (!porProf[k]) porProf[k] = { nif: f.cliente_nif||"", nombre: f.cliente_nombre||"", base:0, retencion:0 };
    porProf[k].base      += f.base;
    porProf[k].retencion += f.base * (f.irpf_retencion||0) / 100;
  });
  Object.values(porProf).forEach(p => {
    perceptores.push({ ...p, clave:"G", subclave:"01" }); // G = prof. art. 95.1 RIRPF
  });

  if (!perceptores.length) {
    toast("No hay perceptores con retenciones en el ejercicio " + year, "warn");
    return;
  }

  // Registro tipo 1: Declarante
  const totalRet = perceptores.reduce((a,p) => a+p.retencion, 0);
  const rec1 = (
    "1" + "190" + String(year) +
    nifDec + nomDec +
    "T" + " ".repeat(9) + nomDec +
    " ".repeat(12) + " " + " ".repeat(13) +
    lpad0(perceptores.length, 9) +
    lpad0(totalRet*100, 17) +
    " ".repeat(299)
  ).padEnd(500," ").slice(0,500);

  // Registros tipo 2: Perceptores
  const rec2s = perceptores.map((p,i) => (
    "2" + "190" + String(year) +
    nifDec + nomDec +
    lpad0(i+1,8) +
    rpad((p.nif||"").replace(/[-\s]/g,""),9) +
    " " + // representante
    rpad(p.nombre,40) +
    p.clave + p.subclave +
    " " + // signo percepciones
    lpad0(p.base*100, 12) +
    " " + // signo retenciones
    lpad0(p.retencion*100, 12) +
    " ".repeat(310)
  ).padEnd(500," ").slice(0,500));

  const contenido = [rec1, ...rec2s].join("\r\n") + "\r\n";
  const nombreFichero = `190${year}${nifDec.trim()}.txt`;

  const blob = new Blob([contenido], { type:"text/plain;charset=iso-8859-1" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = nombreFichero;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);

  toast(`✅ Fichero oficial 190 generado (${perceptores.length} perceptores) — importa en la Sede Electrónica AEAT`, "success", 7000);
}
