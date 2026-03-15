/* ═══════════════════════════════════════════════════════
   TUGESTOR · exports.js
   PDF individual de factura, libros oficiales (PDF),
   exportación Excel (facturas, clientes, histórico)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, toast, fmt, fmtDate, getYear, getTrim, getFechaRango, TRIM_LABELS } from "./utils.js";
import { showPerfilModal } from "./utils.js";

/* ══════════════════════════════════════════
   PDF FACTURA INDIVIDUAL
══════════════════════════════════════════ */
export async function exportFacturaPDF(facturaId) {
  if (!window.jspdf?.jsPDF) { toast("jsPDF no disponible","error"); return; }
  const { data: f, error: fe } = await supabase.from("facturas").select("*").eq("id",facturaId).single();
  if (fe || !f) { toast("Factura no encontrada","error"); return; }
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).single();

  let lineas = [];
  try { lineas = f.lineas ? JSON.parse(f.lineas) : []; } catch(e) { lineas=[]; }
  if (!lineas.length) {
    lineas = [{ descripcion: f.concepto||"Servicio", cantidad:1, precio:f.base, iva:f.iva, subtotal:f.base }];
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });
  const PW=210, PH=297, ML=18, MR=18, W=PW-ML-MR;
  const isIncome = f.tipo==="emitida";

  // Paleta elegante
  const INK    = [15,23,42];      // slate-900
  const ACCENT = [15,23,42];      // mismo para facturas (azul oscuro / sobrio)
  const MUTED  = [100,116,139];   // slate-500
  const LIGHT  = [248,250,252];   // slate-50
  const BORDER = [226,232,240];   // slate-200
  const WHITE  = [255,255,255];
  const GREEN  = [5,150,105];
  const RED    = [220,38,38];

  /* ── CABECERA BLANCA CON LÍNEA FINA ── */
  doc.setFillColor(...WHITE);
  doc.rect(0,0,PW,PH,"F");

  // Bloque logo / nombre emisor — arriba izquierda
  let logoOk = false;
  if (pf?.logo_url && pf.logo_url.startsWith("data:image")) {
    try {
      const ext = pf.logo_url.includes("image/png")?"PNG":"JPEG";
      doc.addImage(pf.logo_url, ext, ML, 16, 0, 22, "", "FAST");
      logoOk = true;
    } catch(e) {}
  }
  if (!logoOk) {
    // Nombre empresa como "logotipo tipográfico"
    doc.setFont("helvetica","bold");
    doc.setFontSize(22);
    doc.setTextColor(...INK);
    doc.text(pf?.nombre_razon_social||"Taurix", ML, 30);
  }

  // Datos fiscales emisor debajo del logo
  const yEmisor = logoOk ? 42 : 36;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  let ye = yEmisor;
  if(pf?.nif)             { doc.text("NIF: "+pf.nif, ML, ye); ye+=4.5; }
  if(pf?.domicilio_fiscal){ doc.text(pf.domicilio_fiscal.substring(0,55), ML, ye); ye+=4.5; }
  if(pf?.email)           { doc.text(pf.email, ML, ye); ye+=4.5; }
  if(pf?.telefono)        { doc.text(pf.telefono, ML, ye); }

  // Bloque FACTURA — arriba derecha
  doc.setFont("helvetica","bold"); doc.setFontSize(28); doc.setTextColor(...INK);
  doc.text("FACTURA", PW-MR, 26, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text("Nº  "+( f.numero_factura||"BORRADOR"), PW-MR, 34, {align:"right"});
  doc.text("Fecha: "+( f.fecha||"—"), PW-MR, 40, {align:"right"});
  if(f.fecha_vencimiento) doc.text("Vencimiento: "+f.fecha_vencimiento, PW-MR, 46, {align:"right"});

  // Badge cobro
  if(isIncome && f.estado==="emitida") {
    const cobrada = f.cobrada;
    const bColor = cobrada ? GREEN : RED;
    const bTxt   = cobrada ? "✓ COBRADA" : "PENDIENTE DE COBRO";
    doc.setFillColor(...bColor);
    doc.roundedRect(PW-MR-44, 52, 44, 8, 1.5, 1.5, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...WHITE);
    doc.text(bTxt, PW-MR-22, 57.2, {align:"center"});
  }

  // Línea separadora elegante
  const yLine = 64;
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
  doc.line(ML, yLine, PW-MR, yLine);

  // Bloque "FACTURAR A"
  let y = yLine + 10;
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text(isIncome?"FACTURAR A":"PROVEEDOR", ML, y); y+=5;
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text((f.cliente_nombre||"—").substring(0,40), ML, y); y+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  if(f.cliente_nif)       { doc.text("NIF/CIF: "+f.cliente_nif, ML, y); y+=4.5; }
  if(f.cliente_direccion) { doc.text(f.cliente_direccion.substring(0,55), ML, y); y+=4.5; }
  if(f.cliente_email)     { doc.text(f.cliente_email, ML, y); y+=4.5; }

  // Tipo operación como chip
  const opLabels = {nacional:"Operación nacional",intracomunitaria:"Intracomunitaria",exportacion:"Exportación",importacion:"Importación",inversion_sujeto_pasivo:"Inv. sujeto pasivo"};
  const opTxt = opLabels[f.tipo_operacion]||"Nacional";
  doc.setFillColor(...LIGHT); doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
  const chipW = doc.getTextWidth(opTxt)+8;
  doc.roundedRect(ML, y+1, chipW, 7, 1.5, 1.5, "FD");
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(opTxt, ML+4, y+5.8);
  y += 16;

  // ── TABLA DE LÍNEAS ──
  const colDesc  = ML;
  const colQty   = ML+100;
  const colPrice = ML+116;
  const colIva   = ML+142;
  const colTotal = PW-MR;

  // Cabecera tabla — fondo slate oscuro
  doc.setFillColor(...INK);
  doc.roundedRect(ML, y, W, 8, 1, 1, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...WHITE);
  doc.text("DESCRIPCIÓN",   colDesc+2,   y+5.5);
  doc.text("CANT.",         colQty,      y+5.5);
  doc.text("P. UNIT.",      colPrice,    y+5.5);
  doc.text("IVA",           colIva,      y+5.5);
  doc.text("TOTAL",         colTotal,    y+5.5, {align:"right"});
  y += 8;

  let baseTotal=0; const ivaMap={};
  lineas.forEach((l,ri) => {
    const qty = l.cantidad||1;
    const precio = l.precio||0;
    const subtotal = qty*precio;
    const ivaAmt = subtotal*(l.iva||0)/100;
    baseTotal += subtotal;
    ivaMap[l.iva] = (ivaMap[l.iva]||0)+ivaAmt;

    // Fila alterna
    if(ri%2===0){ doc.setFillColor(249,250,251); } else { doc.setFillColor(...WHITE); }
    doc.rect(ML, y, W, 8.5, "F");

    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    // Descripción — puede ser larga, split
    const descLines = doc.splitTextToSize(l.descripcion||"—", 90);
    doc.text(descLines[0], colDesc+2, y+5.5);
    if(descLines.length>1) { doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text(descLines[1], colDesc+2, y+9); }

    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(String(qty),                        colQty,   y+5.5);
    doc.text(precio.toFixed(2)+" €",             colPrice, y+5.5);
    doc.text((l.iva||0)+"%",                     colIva,   y+5.5);
    doc.setFont("helvetica","bold");
    doc.text(subtotal.toFixed(2)+" €",           colTotal, y+5.5, {align:"right"});
    y += 8.5;
    if(y > PH-70){ doc.addPage(); y=20; }
  });

  // Línea cierre tabla
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4);
  doc.line(ML, y, PW-MR, y); y+=8;

  // ── TOTALES — columna derecha ──
  const xTL = PW-MR-80; const xTV = PW-MR;
  const rowH = 7;

  const addTotalRow = (label, value, bold=false, color=INK) => {
    doc.setFont("helvetica", bold?"bold":"normal");
    doc.setFontSize(bold?10:9);
    doc.setTextColor(...MUTED);
    doc.text(label, xTL, y);
    doc.setTextColor(...color);
    doc.text(value, xTV, y, {align:"right"});
    y += rowH;
  };

  const ivaTotal = Object.values(ivaMap).reduce((a,b)=>a+b,0);
  const irpfAmt  = baseTotal*(f.irpf_retencion||0)/100;
  const totalFinal = baseTotal+ivaTotal-irpfAmt;

  addTotalRow("Base imponible", baseTotal.toFixed(2)+" €");
  Object.entries(ivaMap).filter(([,v])=>v>0).sort(([a],[b])=>b-a).forEach(([pct,amt])=>{
    addTotalRow(`IVA ${pct}%`, amt.toFixed(2)+" €");
  });
  if(f.irpf_retencion>0) addTotalRow(`IRPF (−${f.irpf_retencion}%)`, "−"+irpfAmt.toFixed(2)+" €", false, RED);

  y += 2;
  // Caja total final
  doc.setFillColor(...INK);
  doc.roundedRect(xTL-4, y-2, xTV-xTL+4+4, 13, 1.5, 1.5, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...WHITE);
  doc.text("TOTAL", xTL, y+7);
  doc.text(totalFinal.toFixed(2)+" €", xTV, y+7, {align:"right"});
  y += 20;

  // Notas
  if(f.notas && y < PH-50) {
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
    doc.setFillColor(...LIGHT);
    const notaLines = doc.splitTextToSize(f.notas, W-8);
    const notaH = notaLines.length*4.5+10;
    doc.roundedRect(ML, y, W, notaH, 1.5, 1.5, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("NOTAS Y CONDICIONES", ML+4, y+6);
    doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...INK);
    doc.text(notaLines, ML+4, y+11);
  }

  // ── PIE ELEGANTE ──
  const footerY = PH-18;
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4);
  doc.line(ML, footerY, PW-MR, footerY);
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  const opLegal={nacional:"Operación sujeta a IVA español (Ley 37/1992).",intracomunitaria:"Operación intracomunitaria exenta de IVA (Art. 25 LIVA).",exportacion:"Exportación exenta (Art. 21 LIVA).",importacion:"IVA liquidado en aduana mediante DUA.",inversion_sujeto_pasivo:"Inversión del sujeto pasivo (Art. 84 LIVA)."};
  doc.text(opLegal[f.tipo_operacion]||"", ML, footerY+5);
  doc.text(`${pf?.nombre_razon_social||"Taurix"} · NIF: ${pf?.nif||"—"} · Generado con Taurix`, ML, footerY+10);
  doc.text(new Date().toLocaleDateString("es-ES"), PW-MR, footerY+10, {align:"right"});

  const fname = f.numero_factura ? f.numero_factura.replace(/[\/\\]/g,"-") : "borrador";
  doc.save(`factura_${fname}.pdf`);
  toast("PDF descargado correctamente","success");
}

/* ══════════════════════════════════════════
   PDF LIBRO INGRESOS
══════════════════════════════════════════ */
export async function exportLibroIngPDF() {
  if (!window.jspdf?.jsPDF) { toast("jsPDF no disponible","error"); return; }
  const { data: pf, error: pe } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).single();
  if (!pf?.nombre_razon_social) { toast("Completa el perfil fiscal primero","warn"); showPerfilModal(); return; }

  const year=getYear(), trim=getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const { data: facs, error: fe } = await supabase.from("facturas").select("*")
    .eq("user_id",SESSION.user.id).eq("tipo","emitida").gte("fecha",ini).lte("fecha",fin).order("fecha",{ascending:true});
  if (fe) { toast("Error cargando facturas: "+fe.message,"error"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF(); const pw=doc.internal.pageSize.width; const m=14; let y=18;

  doc.setFillColor(26,86,219); doc.rect(0,0,pw,28,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(14); doc.setFont("helvetica","bold");
  doc.text("LIBRO REGISTRO DE VENTAS E INGRESOS",pw/2,12,{align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`Art. 68.1 Reglamento IRPF (RD 439/2007) · ${TRIM_LABELS[trim]} ${year}`,pw/2,21,{align:"center"});
  doc.setTextColor(0,0,0); y=36;

  doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text("DATOS DEL CONTRIBUYENTE",m,y); y+=5;
  doc.setFont("helvetica","normal");
  doc.text(`Nombre/Razón Social: ${pf.nombre_razon_social}   ·   NIF: ${pf.nif}`,m,y); y+=5;
  if(pf.actividad){doc.text(`Actividad: ${pf.actividad}`,m,y); y+=5;}
  doc.text(`Periodo: ${trim} · ${year}   ·   Generado: ${new Date().toLocaleDateString("es-ES")}`,m,y); y+=10;

  const facts=facs||[];
  if(!facts.length){
    doc.setFont("helvetica","italic"); doc.setTextColor(100,100,100);
    doc.text("No existen facturas emitidas en este periodo.",pw/2,y,{align:"center"});
  } else {
    let totBase=0,totIVA=0;
    facts.forEach(f=>{totBase+=f.base; totIVA+=(f.base*f.iva)/100;});

    doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.text("RESUMEN",m,y); y+=6;
    doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.text(`Registros: ${facts.length}   ·   Base: ${totBase.toFixed(2)} €   ·   IVA: ${totIVA.toFixed(2)} €   ·   Total: ${(totBase+totIVA).toFixed(2)} €`,m,y); y+=10;

    const cols=[18,26,30,24,20,15,20,24];
    const heads=["Fecha","Nº Factura","Cliente","NIF","Base (€)","IVA%","Cuota IVA","Total (€)"];
    doc.setFillColor(26,86,219); doc.rect(m,y,pw-m*2,9,"F");
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont("helvetica","bold");
    let x=m; heads.forEach((h,i)=>{doc.text(h,x+1,y+6); x+=cols[i];}); y+=9;
    doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");

    facts.forEach((f,ri)=>{
      const cuota=(f.base*f.iva)/100, total=f.base+cuota;
      if(ri%2===0){doc.setFillColor(245,248,255);}else{doc.setFillColor(255,255,255);}
      doc.rect(m,y,pw-m*2,7.5,"F"); x=m;
      const row=[f.fecha||"",f.numero_factura||"Borrador",(f.cliente_nombre||"—").substring(0,14),(f.cliente_nif||"—"),f.base.toFixed(2),f.iva+"%",cuota.toFixed(2),total.toFixed(2)];
      row.forEach((v,i)=>{doc.text(String(v),x+1,y+5.5); x+=cols[i];}); y+=7.5;
      if(y>265){doc.addPage();y=18;}
    });
    y+=8;
    doc.setFontSize(9.5); doc.setFont("helvetica","bold"); doc.text("INFORMACIÓN FISCAL ORIENTATIVA",m,y); y+=6;
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`• IVA repercutido a declarar (Modelo 303): ${totIVA.toFixed(2)} €`,m,y); y+=5;
    doc.text(`• Rendimiento íntegro para Modelo 130: ${totBase.toFixed(2)} €`,m,y);
  }

  _addFooterPDF(doc, pf, year, trim);
  doc.save(`libro_ingresos_${pf.nif}_${year}_${trim}.pdf`);
  toast("Libro de ingresos exportado","success");
}

/* ══════════════════════════════════════════
   PDF LIBRO GASTOS
══════════════════════════════════════════ */
export async function exportLibroGstPDF() {
  if (!window.jspdf?.jsPDF) { toast("jsPDF no disponible","error"); return; }
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).single();
  if (!pf?.nombre_razon_social) { toast("Completa el perfil fiscal primero","warn"); showPerfilModal(); return; }

  const year=getYear(), trim=getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const { data: facs, error: fe } = await supabase.from("facturas").select("*")
    .eq("user_id",SESSION.user.id).eq("tipo","recibida").gte("fecha",ini).lte("fecha",fin).order("fecha",{ascending:true});
  if (fe) { toast("Error cargando gastos: "+fe.message,"error"); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF(); const pw=doc.internal.pageSize.width; const m=14; let y=18;

  doc.setFillColor(185,28,28); doc.rect(0,0,pw,28,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont("helvetica","bold");
  doc.text("LIBRO REGISTRO DE COMPRAS Y GASTOS",pw/2,12,{align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`Art. 68.2 Reglamento IRPF (RD 439/2007) · ${TRIM_LABELS[trim]} ${year}`,pw/2,21,{align:"center"});
  doc.setTextColor(0,0,0); y=36;

  doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text("DATOS DEL CONTRIBUYENTE",m,y); y+=5;
  doc.setFont("helvetica","normal");
  doc.text(`Nombre/Razón Social: ${pf.nombre_razon_social}   ·   NIF: ${pf.nif}`,m,y); y+=5;
  doc.text(`Periodo: ${trim} · ${year}   ·   Generado: ${new Date().toLocaleDateString("es-ES")}`,m,y); y+=10;

  const facts=facs||[];
  if(!facts.length){
    doc.setFont("helvetica","italic"); doc.setTextColor(100,100,100);
    doc.text("No existen gastos registrados en este periodo.",pw/2,y,{align:"center"});
  } else {
    let totBase=0,totIVA=0;
    facts.forEach(f=>{totBase+=f.base; totIVA+=(f.base*f.iva)/100;});

    doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.text("RESUMEN",m,y); y+=6;
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`Registros: ${facts.length}   ·   Base deducible: ${totBase.toFixed(2)} €   ·   IVA: ${totIVA.toFixed(2)} €   ·   Total: ${(totBase+totIVA).toFixed(2)} €`,m,y); y+=10;

    const cols=[18,26,34,20,15,22,22];
    const heads=["Fecha","Nº Fra.","Proveedor/Concepto","Base (€)","IVA%","Cuota IVA","Total (€)"];
    doc.setFillColor(185,28,28); doc.rect(m,y,pw-m*2,9,"F");
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont("helvetica","bold");
    let x=m; heads.forEach((h,i)=>{doc.text(h,x+1,y+6); x+=cols[i];}); y+=9;
    doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");

    facts.forEach((f,ri)=>{
      const cuota=(f.base*f.iva)/100, total=f.base+cuota;
      if(ri%2===0){doc.setFillColor(255,245,245);}else{doc.setFillColor(255,255,255);}
      doc.rect(m,y,pw-m*2,7.5,"F"); x=m;
      const row=[f.fecha,f.numero_factura||"S/N",(f.concepto||"—").substring(0,20),f.base.toFixed(2),f.iva+"%",cuota.toFixed(2),total.toFixed(2)];
      row.forEach((v,i)=>{doc.text(String(v),x+1,y+5.5); x+=cols[i];}); y+=7.5;
      if(y>265){doc.addPage();y=18;}
    });
    y+=8;
    doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.text("GASTOS DEDUCIBLES",m,y); y+=6;
    doc.setFont("helvetica","normal"); doc.setFontSize(9);
    doc.text(`• IVA soportado deducible (Modelo 303): ${totIVA.toFixed(2)} €`,m,y); y+=5;
    doc.text(`• Gastos deducibles actividad (Modelo 130): ${totBase.toFixed(2)} €`,m,y);
  }
  _addFooterPDF(doc, pf, year, trim);
  doc.save(`libro_gastos_${pf.nif}_${year}_${trim}.pdf`);
  toast("Libro de gastos exportado","success");
}

function _addFooterPDF(doc, pf, year, trim) {
  const ph=doc.internal.pageSize.getHeight(), pw=doc.internal.pageSize.width, m=14;
  const tpe="{total_pages_count_string}";
  const pc=doc.internal.getNumberOfPages();
  for(let i=1;i<=pc;i++){
    doc.setPage(i); doc.setDrawColor(200); doc.line(m,ph-11,pw-m,ph-11);
    doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`Taurix · ${pf.nif} · ${year} ${trim}`,m,ph-6);
    doc.text(`Pág. ${i} de ${tpe}`,pw-30,ph-6);
  }
  if(typeof doc.putTotalPages==="function") doc.putTotalPages(tpe);
}

/* ══════════════════════════════════════════
   EXCEL — FACTURAS
══════════════════════════════════════════ */
export async function exportFacturasExcel() {
  if (!window.XLSX) { toast("SheetJS no disponible","error"); return; }
  const year=getYear(), trim=getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const { data: facs, error } = await supabase.from("facturas").select("*")
    .eq("user_id",SESSION.user.id).gte("fecha",ini).lte("fecha",fin).order("fecha",{ascending:true});
  if (error) { toast("Error: "+error.message,"error"); return; }
  if (!facs?.length) { toast("Sin facturas para exportar","info"); return; }

  const rows = facs.map(f=>({
    Fecha: f.fecha, "Nº Factura": f.numero_factura||"Borrador",
    Concepto: f.concepto, "Cliente/Proveedor": f.cliente_nombre||"",
    NIF: f.cliente_nif||"", Operación: f.tipo_operacion||"nacional",
    "Base Imponible": f.base, "IVA (%)": f.iva,
    "Cuota IVA": +((f.base*f.iva/100).toFixed(2)),
    "Total": +(f.base+(f.base*f.iva/100)).toFixed(2),
    Tipo: f.tipo, Estado: f.estado,
    Cobrada: f.tipo==="emitida"?(f.cobrada?"Sí":"No"):"—",
    "Fecha cobro": f.fecha_cobro||""
  }));

  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `Facturas ${trim} ${year}`);
  window.XLSX.writeFile(wb, `facturas_${year}_${trim}.xlsx`);
  toast("Excel exportado correctamente","success");
}

export async function exportHistoricoExcel() {
  if (!window.XLSX) { toast("SheetJS no disponible","error"); return; }
  const year=getYear(); const rows=[];
  for (const trim of ["T1","T2","T3","T4"]) {
    const { getFacturasTrim, calcIVA, calcIRPF } = await import("./utils.js");
    const facs = await getFacturasTrim(year, trim);
    const iva  = calcIVA(facs); const irpf = calcIRPF(facs);
    rows.push({ Año:year, Trimestre:trim, Ingresos:irpf.ingresos, Gastos:irpf.gastos,
      Rendimiento:irpf.rendimiento, "IVA Repercutido":iva.rep.total,
      "IVA Soportado":iva.sop.total, "Resultado IVA (303)":iva.resultado,
      "Retenciones IRPF":irpf.retenciones, "Resultado IRPF (130)":irpf.resultado });
  }
  const ws=window.XLSX.utils.json_to_sheet(rows);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,`Histórico ${year}`);
  window.XLSX.writeFile(wb,`historico_fiscal_${year}.xlsx`);
  toast("Excel histórico exportado","success");
}

export async function exportClientesExcel() {
  if (!window.XLSX) { toast("SheetJS no disponible","error"); return; }
  if (!CLIENTES.length) { toast("Sin clientes para exportar","info"); return; }
  const rows=CLIENTES.map(c=>({Nombre:c.nombre,NIF:c.nif||"",Email:c.email||"",Teléfono:c.telefono||"",País:c.pais||"",Tipo:c.tipo,Dirección:c.direccion||""}));
  const ws=window.XLSX.utils.json_to_sheet(rows);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Clientes");
  window.XLSX.writeFile(wb,"clientes_taurix.xlsx");
  toast("Clientes exportados","success");
}

export async function exportFacturasPDF() {
  if (!window.jspdf?.jsPDF) { toast("jsPDF no disponible","error"); return; }
  const year=getYear(), trim=getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const { data: facs, error } = await supabase.from("facturas").select("*")
    .eq("user_id",SESSION.user.id).gte("fecha",ini).lte("fecha",fin).order("fecha",{ascending:true});
  if (error) { toast("Error: "+error.message,"error"); return; }
  if (!facs?.length) { toast("Sin facturas","info"); return; }

  const { jsPDF }=window.jspdf;
  const doc=new jsPDF(); const pw=doc.internal.pageSize.width; const m=14; let y=18;
  doc.setFillColor(26,86,219); doc.rect(0,0,pw,28,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont("helvetica","bold");
  doc.text("REPORTE DE FACTURAS · Taurix",pw/2,12,{align:"center"});
  doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`${TRIM_LABELS[trim]} ${year} · Exportado: ${new Date().toLocaleDateString("es-ES")}`,pw/2,21,{align:"center"});
  doc.setTextColor(0,0,0); y=36;

  const cols=[20,22,46,22,14,20]; const heads=["Fecha","Nº Factura","Concepto","Base (€)","IVA%","Total (€)"];
  doc.setFillColor(26,86,219); doc.rect(m,y,pw-m*2,9,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont("helvetica","bold");
  let x=m; heads.forEach((h,i)=>{doc.text(h,x+1,y+6); x+=cols[i];}); y+=9;
  doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");

  facs.forEach((f,ri)=>{
    const total=f.base+(f.base*f.iva)/100;
    if(ri%2===0){doc.setFillColor(245,248,255);}else{doc.setFillColor(255,255,255);}
    doc.rect(m,y,pw-m*2,7.5,"F"); x=m;
    const row=[f.fecha,f.numero_factura||"Borrador",(f.concepto||"").substring(0,26),f.base.toFixed(2),f.iva+"%",total.toFixed(2)];
    row.forEach((v,i)=>{doc.text(String(v),x+1,y+5.5); x+=cols[i];}); y+=7.5;
    if(y>265){doc.addPage();y=18;}
  });
  doc.save(`facturas_${year}_${trim}.pdf`);
  toast("PDF exportado","success");
}
