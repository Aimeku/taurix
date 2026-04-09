async function _cargarJsPDF() {
  if (window.jspdf?.jsPDF) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ═══════════════════════════════════════════════════════
   TUGESTOR · exports.js
   PDF individual de factura, libros oficiales (PDF),
   exportación Excel (facturas, clientes, histórico)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, toast, fmt, fmtDate, getYear, getTrim, getFechaRango, TRIM_LABELS } from "./utils.js";
import { showPerfilModal } from "./utils.js";
import { exportFacturaPDFConPlantilla } from "./pdf-plantilla.js";

/* ══════════════════════════════════════════
   PDF FACTURA INDIVIDUAL
══════════════════════════════════════════ */
export async function exportFacturaPDF(facturaId, plantillaId = null) {
  // Delega al motor PDF. Cascada en pdf-plantilla.js:
  // plantillaId explícito → doc.plantilla_id en BD → plantilla predeterminada → sin plantilla
  await exportFacturaPDFConPlantilla(facturaId, plantillaId || null, true);
}

/* ══════════════════════════════════════════
   PDF LIBRO INGRESOS
══════════════════════════════════════════ */
export async function exportLibroIngPDF() {
  await _cargarJsPDF();
  const { data: pf, error: pe } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).maybeSingle();
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
  await _cargarJsPDF();
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).maybeSingle();
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
  await _cargarJsPDF();
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
