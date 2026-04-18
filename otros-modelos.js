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

/* ══════════════════════════
   MODELO 347 — Operaciones >3.005,06€
══════════════════════════ */
export async function calcModelo347(year) {
  const y = year || getYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_nif, tipo, base, iva, estado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${y}-01-01`).lte("fecha", `${y}-12-31`);

  const UMBRAL = 3005.06;
  const acum = {};
  (facturas || []).forEach(f => {
    if (f.tipo === "emitida" && f.estado !== "emitida") return;
    const key = (f.cliente_nif || f.cliente_nombre || "SIN_ID") + "_" + f.tipo;
    if (!acum[key]) acum[key] = { nombre: f.cliente_nombre, nif: f.cliente_nif, total: 0, tipo: f.tipo, ops: 0 };
    acum[key].total += f.base + f.base * (f.iva || 0) / 100;
    acum[key].ops++;
  });

  const declarables = Object.values(acum).filter(a => a.total >= UMBRAL).sort((a, b) => b.total - a.total);
  const el = document.getElementById("m347Count");
  if (el) el.textContent = declarables.length;
  return { declarables, year: y };
}

export async function exportModelo347PDF() {
  const data = await calcModelo347();
  await _cargarJsPDF();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139];

  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 28, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("MODELO 347 — DECLARACIÓN ANUAL DE OPERACIONES CON TERCEROS", PW / 2, 12, { align: "center" });
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(`Ejercicio ${data.year} · Generado: ${new Date().toLocaleDateString("es-ES")}`, PW / 2, 21, { align: "center" });

  let y = 38;
  doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Operaciones declarables (>3.005,06€): ${data.declarables.length}`, ML, y); y += 10;

  // Tabla
  const cols = [20, 60, 35, 30, 30];
  const heads = ["Tipo", "Nombre / Razón social", "NIF/CIF", "Total (€)", "Nº Ops."];
  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 9, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  let x = ML;
  heads.forEach((h, i) => { doc.text(h, x + 1, y + 6); x += cols[i]; }); y += 9;
  doc.setTextColor(...INK); doc.setFont("helvetica", "normal");

  data.declarables.forEach((d, ri) => {
    if (ri % 2 === 0) doc.setFillColor(245, 248, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 7.5, "F");
    x = ML;
    const row = [
      d.tipo === "emitida" ? "Cliente" : "Proveedor",
      (d.nombre || "—").substring(0, 30),
      d.nif || "SIN NIF",
      fmt(d.total),
      String(d.ops)
    ];
    row.forEach((v, i) => { doc.setFontSize(8); doc.text(v, x + 1, y + 5.5); x += cols[i]; });
    y += 7.5;
    if (y > 265) { doc.addPage(); y = 18; }
  });

  y += 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text("NOTA LEGAL: Plazo de presentación — Febrero del año siguiente al ejercicio declarado.", ML, y);

  doc.save(`modelo_347_${data.year}.pdf`);
  toast("Modelo 347 exportado ✅", "success");
}

/* ══════════════════════════
   MODELO 349 — Intracomunitarias
══════════════════════════ */
export async function calcModelo349() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  // user_id — consistente con el resto del sistema
  const uid349 = SESSION?.user?.id;
  const { data: ops } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_nif, base, iva, tipo, estado")
    .eq("user_id", uid349)
    .eq("tipo_operacion", "intracomunitaria")
    .gte("fecha", ini).lte("fecha", fin);

  const totalBase349 = (ops || []).reduce((a, f) => a + (f.base || 0), 0);
  const s349 = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s349("m349Count", (ops || []).length);
  s349("m349Base",  fmt(totalBase349));

  return { ops: ops || [], totalBase: totalBase349, year, trim };
}

export async function exportModelo349PDF() {
  const data = await calcModelo349();
  const totalBase = data.ops.reduce((a, f) => a + f.base, 0);

  await generarPDFModelo({
    numero: "349",
    titulo: "DECLARACIÓN RECAPITULATIVA DE OPERACIONES INTRACOMUNITARIAS",
    subtitulo: "Entregas y adquisiciones intracomunitarias de bienes y servicios",
    year: data.year, trim: data.trim,
    resultado: totalBase,
    filas: [
      { label: "Operaciones intracomunitarias del periodo", valor: data.ops.length, texto: `${data.ops.length} operaciones` },
      { label: "Base total declarada", valor: totalBase },
    ],
    plazo: TRIM_PLAZOS[data.trim],
    nota: "Declaración informativa sin cuota a ingresar. Art. 79 RIVA. Se presenta aunque el importe sea cero si hay operaciones."
  });
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
    toast("No hay operaciones declarables (>3.005,06€) en el ejercicio " + year, "warn");
    return;
  }

  // Helpers formato AEAT (campos de longitud fija)
  const rpad = (v,n)   => String(v||"").toUpperCase().padEnd(n," ").slice(0,n);
  const lpad = (v,n)   => String(v||"").padStart(n," ").slice(0,n);
  const lpad0 = (v,n)  => String(v||"0").padStart(n,"0").slice(0,n);
  const importe = (v)  => {
    // Formato AEAT: 16 posiciones, sin decimales (en céntimos), sin signo
    const cents = Math.round(Math.abs(v||0)*100);
    return lpad0(cents, 16);
  };
  const signo = (v) => v >= 0 ? " " : "N";

  const nifDeclarante  = rpad((pf.nif||"").replace(/[-\s]/g,""), 9);
  const nomDeclarante  = rpad(pf.nombre_razon_social||"TAURIX", 40);
  const ejercicio      = String(year);
  const telContacto    = lpad0((pf.telefono||"").replace(/\D/g,"").slice(0,9), 9);
  const nomContacto    = rpad(pf.nombre_razon_social||"", 40);

  // ── REGISTRO TIPO 1: Declarante ──
  const totalRegistros = declarables.length;
  const totalImportes  = declarables.reduce((a,d) => a + Math.abs(d.total), 0);

  const reg1 =
    "1" +                           // tipo registro
    "347" +                          // modelo
    ejercicio +                      // ejercicio (4)
    nifDeclarante +                  // NIF (9)
    nomDeclarante +                  // nombre (40)
    "T" +                            // tipo soporte (T=telematico)
    " ".repeat(13) +                 // teléfono contacto (fijo vacío aquí) (13)
    nomContacto +                    // nombre contacto (40)
    " ".repeat(12) +                 // núm declaración (12)
    lpad0(totalRegistros, 9) +       // total registros tipo 2 (9)
    " " +                            // indicador complementaria
    " " +                            // indicador sustitutiva
    " ".repeat(13) +                 // núm declaración anterior (13)
    importe(totalImportes) +         // importe total (16)
    " ".repeat(16) +                 // importe total (metálico) (16)
    " ".repeat(204) +                // blancos hasta 500
    " ".repeat(19);                  // blancos

  // Padding a 500 caracteres
  const rec1 = reg1.padEnd(500," ").slice(0,500);

  // ── REGISTROS TIPO 2: Declarados ──
  const rec2s = declarables.map((d, i) => {
    const nifDec = rpad((d.nif||"").replace(/[-\s]/g,""), 9);
    const nomDec = rpad(d.nombre||"DESCONOCIDO", 40);
    const claveOp = d.tipo === "emitida" ? "B" : "A"; // B=ventas A=compras
    const pais    = "ES"; // España

    const reg2 =
      "2" +                         // tipo registro
      "347" +                        // modelo
      ejercicio +                    // ejercicio
      nifDeclarante +                // NIF declarante (9)
      nomDeclarante +                // nombre declarante (40)
      lpad0(i+1, 8) +                // núm registro (8)
      nifDec +                       // NIF declarado (9)
      rpad(pais, 2) +                // código país (2) — vacío si ES
      nomDec +                       // nombre declarado (40)
      claveOp +                      // clave operación (1)
      ejercicio +                    // ejercicio operación (4)
      signo(d.total) +               // signo importe (1)
      importe(d.total) +             // importe (16)
      " " +                          // operación seguro (1)
      " " +                          // arrendamiento local (1)
      " ".repeat(16) +               // importe percibido en metálico (16)
      " " +                          // signo metálico (1)
      " ".repeat(4) +                // ejercicio metálico (4)
      " ".repeat(350);               // blancos

    return reg2.padEnd(500," ").slice(0,500);
  });

  // Unir todos los registros
  const contenido = [rec1, ...rec2s].join("\r\n") + "\r\n";

  // Nombre del fichero según AEAT: 347AAAANNNNNNNNNC.txt
  const nombreFichero = `347${year}${nifDeclarante.trim()}.txt`;

  const blob = new Blob([contenido], { type:"text/plain;charset=iso-8859-1" });
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
