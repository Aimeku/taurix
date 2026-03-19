/* ═══════════════════════════════════════════════════════
   TAURIX · otros-modelos.js
   Modelos fiscales 111, 115, 123, 190, 347, 349, 390
   Cálculos reales + exportación PDF
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, getYear, getTrim, getFechaRango, TRIM_LABELS, TRIM_PLAZOS } from "./utils.js";

/* ══════════════════════════
   MODELO 111 — Retenciones IRPF
   (trabajadores + profesionales)
══════════════════════════ */
export async function calcModelo111() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  // Retenciones de facturas emitidas (rendimientos profesionales)
  const { data: facturas } = await supabase.from("facturas")
    .select("base, irpf_retencion, cliente_nombre")
    .eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida").eq("estado", "emitida")
    .gte("fecha", ini).lte("fecha", fin)
    .not("irpf_retencion", "is", null);

  // Retenciones de nóminas
  const { data: nominas } = await supabase.from("nominas")
    .select("irpf, nombre_empleado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", ini).lte("fecha", fin);

  const retProf = (facturas || []).reduce((a, f) => a + f.base * (f.irpf_retencion || 0) / 100, 0);
  const retNom  = (nominas  || []).reduce((a, n) => a + (n.irpf || 0), 0);
  const total   = retProf + retNom;

  // Update UI
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("m111Nominas", fmt(retNom));
  s("m111Prof",    fmt(retProf));

  return { retProf, retNom, total, facturas: facturas || [], nominas: nominas || [], year, trim };
}

export async function exportModelo111PDF() {
  const data = await calcModelo111();
  await generarPDFModelo({
    numero: "111",
    titulo: "RETENCIONES E INGRESOS A CUENTA DEL IRPF",
    subtitulo: "Rendimientos del Trabajo y Actividades Económicas",
    year: data.year, trim: data.trim,
    resultado: data.total,
    filas: [
      { label: "Retenciones de trabajadores (nóminas)", valor: data.retNom },
      { label: "Retenciones de profesionales (facturas)", valor: data.retProf },
      { label: "CUOTA A INGRESAR", valor: data.total, bold: true },
    ],
    plazo: TRIM_PLAZOS[data.trim],
    nota: "Retenciones e ingresos a cuenta del Impuesto sobre la Renta de las Personas Físicas. Liquidación trimestral."
  });
}

/* ══════════════════════════
   MODELO 115 — Alquiler
══════════════════════════ */
export async function calcModelo115() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  const { data: alquileres } = await supabase.from("facturas")
    .select("base, iva, concepto")
    .eq("user_id", SESSION.user.id).eq("tipo", "recibida")
    .gte("fecha", ini).lte("fecha", fin)
    .or("concepto.ilike.%alquiler%,concepto.ilike.%arrendamiento%,concepto.ilike.%renta%");

  const baseAlquiler = (alquileres || []).reduce((a, f) => a + f.base, 0);
  const retencion    = baseAlquiler * 0.19; // 19% sobre base

  const el = document.getElementById("m115Base");
  if (el) el.textContent = fmt(baseAlquiler);

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

  const { data: ops } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_nif, base, iva, tipo, estado")
    .eq("user_id", SESSION.user.id)
    .eq("tipo_operacion", "intracomunitaria")
    .gte("fecha", ini).lte("fecha", fin);

  const el = document.getElementById("m349Count");
  if (el) el.textContent = (ops || []).length;

  return { ops: ops || [], year, trim };
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

/* ══════════════════════════
   MODELO 390 — Resumen anual IVA
══════════════════════════ */
export async function calcModelo390(year) {
  const y = year || getYear();
  let repTotal = 0, sopTotal = 0;

  for (const trim of ["T1", "T2", "T3", "T4"]) {
    const { data: facs } = await supabase.from("facturas")
      .select("base, iva, tipo, estado")
      .eq("user_id", SESSION.user.id)
      .gte("fecha", `${y}-${trim === "T1" ? "01-01" : trim === "T2" ? "04-01" : trim === "T3" ? "07-01" : "10-01"}`)
      .lte("fecha", `${y}-${trim === "T1" ? "03-31" : trim === "T2" ? "06-30" : trim === "T3" ? "09-30" : "12-31"}`);

    (facs || []).forEach(f => {
      const cuota = f.base * (f.iva || 0) / 100;
      if (f.tipo === "emitida" && f.estado === "emitida") repTotal += cuota;
      else if (f.tipo === "recibida") sopTotal += cuota;
    });
  }

  return { repTotal, sopTotal, resultado: repTotal - sopTotal, year: y };
}

export async function exportModelo390PDF() {
  const data = await calcModelo390();
  await generarPDFModelo({
    numero: "390",
    titulo: "DECLARACIÓN-RESUMEN ANUAL DEL IVA",
    subtitulo: "Resumen de las declaraciones-liquidaciones periódicas (Modelo 303)",
    year: data.year, trim: "ANUAL",
    resultado: data.resultado,
    filas: [
      { label: "IVA repercutido total año", valor: data.repTotal },
      { label: "IVA soportado deducible total año", valor: data.sopTotal },
      { label: "RESULTADO ANUAL IVA", valor: data.resultado, bold: true },
    ],
    plazo: "Enero del año siguiente",
    nota: "Declaración informativa anual complementaria al Modelo 303. Art. 71.4 RIVA."
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
    resultado: data190.retNom + data190.retProf,
    filas: [
      { label: "Retenciones rendimientos del trabajo", valor: data190.retNom },
      { label: "Retenciones rendimientos profesionales", valor: data190.retProf },
      { label: "TOTAL RETENCIONES AÑO", valor: data190.retNom + data190.retProf, bold: true },
    ],
    plazo: "Enero del año siguiente",
    nota: "Declaración informativa anual complementaria al Modelo 111. Debe incluir todos los perceptores con datos identificativos."
  });
}

/* ══════════════════════════
   GENERADOR PDF GENÉRICO MODELOS
══════════════════════════ */
async function generarPDFModelo({ numero, titulo, subtitulo, year, trim, resultado, filas, plazo, nota }) {
  await _cargarJsPDF();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139], LIGHT = [248, 250, 252];

  // Cabecera
  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`MODELO ${numero}`, ML, 13);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text(titulo, ML, 20);
  doc.setFontSize(8);
  doc.text(subtitulo, ML, 27);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(`M-${numero}`, PW - ML, 20, { align: "right" });

  let y = 42;
  doc.setTextColor(...INK);

  // Datos contribuyente
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 18, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("DATOS DEL OBLIGADO TRIBUTARIO", ML + 4, y + 5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...INK);
  doc.text(`${pf?.nombre_razon_social || "—"}`, ML + 4, y + 11);
  doc.text(`NIF: ${pf?.nif || "—"}`, ML + 4, y + 16);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text(`Periodo: ${trim} · ${year}`, PW - ML, y + 11, { align: "right" });
  doc.text(`Plazo: ${plazo}`, PW - ML, y + 16, { align: "right" });
  y += 26;

  // Cuerpo del modelo
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("LIQUIDACIÓN", ML, y); y += 6;
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.5); doc.line(ML, y, PW - ML, y); y += 6;

  filas.forEach((f, i) => {
    if (i % 2 === 0) doc.setFillColor(248, 250, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 8, "F");
    doc.setFont("helvetica", f.bold ? "bold" : "normal");
    doc.setFontSize(f.bold ? 10 : 9);
    if (f.bold) { doc.setTextColor(...BLUE); } else { doc.setTextColor(...INK); }
    doc.text(f.label, ML + 3, y + 5.5);
    if (f.valor !== null && f.valor !== undefined) {
      doc.text(fmt(f.valor), PW - ML - 2, y + 5.5, { align: "right" });
    } else if (f.texto) {
      doc.text(f.texto, PW - ML - 2, y + 5.5, { align: "right" });
    }
    y += 8;
  });

  y += 8;

  // Resultado final
  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text("RESULTADO A INGRESAR", ML + 4, y + 9);
  doc.text(fmt(resultado), PW - ML - 2, y + 9, { align: "right" });
  y += 22;

  // Nota legal
  if (nota) {
    doc.setFillColor(...LIGHT); doc.setDrawColor(200);
    const lines = doc.splitTextToSize("NOTA LEGAL: " + nota, W - 8);
    doc.rect(ML, y, W, lines.length * 4.5 + 8, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(lines, ML + 4, y + 6);
    y += lines.length * 4.5 + 14;
  }

  // Firma / sello
  doc.setDrawColor(200); doc.line(ML, y, ML + 70, y); doc.line(PW - ML - 70, y, PW - ML, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del obligado tributario", ML + 10, y + 5);
  doc.text("Fecha y sello AEAT", PW - ML - 50, y + 5);

  // Footer
  doc.setFontSize(7);
  doc.text(`Generado con Taurix · ${new Date().toLocaleDateString("es-ES")} · Este documento es orientativo. Verifique con la AEAT antes de presentar.`, PW / 2, 290, { align: "center" });

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
export async function initOtrosModelosView() {
  await Promise.all([calcModelo111(), calcModelo115(), calcModelo349()]);
  await calcModelo347();

  document.getElementById("export111Btn")?.addEventListener("click", exportModelo111PDF);
  document.getElementById("export115Btn")?.addEventListener("click", exportModelo115PDF);
  document.getElementById("export347Btn")?.addEventListener("click", exportModelo347PDF);

  // Exportaciones para software contable y ficheros oficiales AEAT
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

  // Obtener perceptores (empleados con retención + profesionales)
  const { data: facturas } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`)
    .eq("tipo","emitida").not("irpf_retencion","is",null);

  const { data: nominas } = await supabase.from("nominas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha",`${year}-01-01`);

  const rpad  = (v,n) => String(v||"").toUpperCase().padEnd(n," ").slice(0,n);
  const lpad0 = (v,n) => String(Math.round(v||0)).padStart(n,"0").slice(0,n);
  const nifDec = rpad((pf.nif||"").replace(/[-\s]/g,""), 9);
  const nomDec = rpad(pf.nombre_razon_social||"", 40);

  const perceptores = [];

  // Profesionales (facturas con retención)
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

  // Trabajadores (nóminas)
  const porEmp = {};
  (nominas||[]).forEach(n => {
    const k = (n.nombre_empleado||"EMPLEADO").toUpperCase();
    if (!porEmp[k]) porEmp[k] = { nif:"", nombre:n.nombre_empleado||"", base:0, retencion:0 };
    porEmp[k].base      += n.salario_bruto||0;
    porEmp[k].retencion += n.irpf||0;
  });
  Object.values(porEmp).forEach(p => {
    perceptores.push({ ...p, clave:"A", subclave:"01" }); // A = rendimientos trabajo
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
