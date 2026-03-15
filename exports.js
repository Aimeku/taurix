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
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.width, ph = doc.internal.pageSize.height;
  const m = 14; let y = 0;
  const isIncome = f.tipo==="emitida";
  const CR = isIncome?[26,86,219]:[185,28,28];

  // Cabecera
  doc.setFillColor(11,13,18); doc.rect(0,0,pw,42,"F");

  // Logo empresa (si existe)
  if (pf?.logo_url && pf.logo_url.startsWith("data:image")) {
    try {
      const ext = pf.logo_url.includes("image/png") ? "PNG"
                : pf.logo_url.includes("image/svg") ? "SVG"
                : "JPEG";
      doc.addImage(pf.logo_url, ext, m, 6, 0, 28, "", "FAST");
    } catch(e) {
      // logo fallback: nombre empresa
      doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont("helvetica","bold");
      doc.text(pf?.nombre_razon_social||"Taurix", m, 16);
    }
  } else {
    doc.setTextColor(255,255,255); doc.setFontSize(20); doc.setFont("helvetica","bold");
    doc.text(pf?.nombre_razon_social||"Taurix", m, 16);
  }

  doc.setTextColor(249,115,22); doc.setFontSize(9); doc.setFont("helvetica","normal");
  if(pf?.nif) doc.text("NIF: "+pf.nif, m, 29);
  if(pf?.domicilio_fiscal) doc.text(pf.domicilio_fiscal.substring(0,55), m, 35);
  if(pf?.email) doc.text(pf.email, m, 39.5);

  doc.setTextColor(255,255,255);
  doc.setFontSize(22); doc.setFont("helvetica","bold");
  doc.text("FACTURA",pw-m,16,{align:"right"});
  doc.setTextColor(249,115,22); doc.setFontSize(13); doc.setFont("helvetica","bold");
  doc.text(f.numero_factura||"BORRADOR",pw-m,26,{align:"right"});
  doc.setTextColor(180,180,180); doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text(`Fecha: ${f.fecha||"—"}`,pw-m,33,{align:"right"});
  if(f.fecha_emision&&f.fecha_emision!==f.fecha) doc.text(`Emisión: ${f.fecha_emision}`,pw-m,38,{align:"right"});
  doc.setTextColor(0,0,0); y=52;

  // Cliente
  doc.setFillColor(247,248,252); doc.rect(m,y,(pw-m*2)/2-4,28,"F");
  doc.setFontSize(7.5); doc.setTextColor(120,120,120); doc.setFont("helvetica","bold");
  doc.text(isIncome?"FACTURAR A":"PROVEEDOR",m+4,y+6);
  doc.setTextColor(0,0,0); doc.setFontSize(10); doc.setFont("helvetica","bold");
  doc.text((f.cliente_nombre||"—").substring(0,30),m+4,y+13);
  doc.setFontSize(8); doc.setFont("helvetica","normal"); doc.setTextColor(80,80,80);
  if(f.cliente_nif) doc.text("NIF/CIF: "+f.cliente_nif,m+4,y+20);
  const opLabels2={nacional:"Operación nacional",intracomunitaria:"Operación intracomunitaria",exportacion:"Exportación",importacion:"Importación",inversion_sujeto_pasivo:"Inversión sujeto pasivo"};
  doc.text(opLabels2[f.tipo_operacion]||"",m+4,y+26);
  y+=36;

  // Estado de cobro en cabecera (solo facturas emitidas)
  if (isIncome && f.estado==="emitida") {
    const cobroTxt = f.cobrada
      ? `✓ COBRADA${f.fecha_cobro?" el "+f.fecha_cobro:""}`
      : "PENDIENTE DE COBRO";
    doc.setFillColor(f.cobrada?220:255,f.cobrada?252:251,f.cobrada?231:235);
    doc.rect(pw-m-55,52,55,10,"F");
    doc.setTextColor(f.cobrada?6:146,f.cobrada?95:64,f.cobrada?70:0);
    doc.setFontSize(7.5); doc.setFont("helvetica","bold");
    doc.text(cobroTxt,pw-m-28,58,{align:"center"});
    doc.setTextColor(0,0,0);
  }

  // Tabla líneas
  const colsW={desc:85,qty:18,price:28,iva:16,total:28};
  const tableW=pw-m*2;
  doc.setFillColor(...CR); doc.rect(m,y,tableW,9,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont("helvetica","bold");
  let x=m+2;
  ["Descripción","Cant.","P. unit.","IVA","Total"].forEach((h,i)=>{
    doc.text(h,x,y+6); x+=[colsW.desc,colsW.qty,colsW.price,colsW.iva,colsW.total][i];
  });
  y+=9; doc.setTextColor(0,0,0); doc.setFont("helvetica","normal");

  let baseTotal=0; const ivaMap={};
  lineas.forEach((l,ri)=>{
    const subtotal=(l.cantidad||1)*(l.precio||0);
    const ivaAmt=subtotal*(l.iva||0)/100;
    baseTotal+=subtotal; ivaMap[l.iva]=(ivaMap[l.iva]||0)+ivaAmt;
    if(ri%2===0){doc.setFillColor(250,251,255);}else{doc.setFillColor(255,255,255);}
    doc.rect(m,y,tableW,8,"F");
    doc.setFontSize(8.5); x=m+2;
    [l.descripcion?.substring(0,42)||"—",String(l.cantidad||1),parseFloat(l.precio||0).toFixed(2)+" €",(l.iva||0)+"%",subtotal.toFixed(2)+" €"]
      .forEach((v,i)=>{
        if(i===4){doc.setFont("helvetica","bold");}
        doc.text(v,x,y+5.5);
        if(i===4){doc.setFont("helvetica","normal");}
        x+=[colsW.desc,colsW.qty,colsW.price,colsW.iva,colsW.total][i];
      });
    y+=8; if(y>ph-60){doc.addPage();y=20;}
  });

  doc.setDrawColor(...CR); doc.setLineWidth(0.5); doc.line(m,y,pw-m,y); y+=6;

  // Totales
  const ivaTotal=Object.values(ivaMap).reduce((a,b)=>a+b,0);
  const irpfAmt=baseTotal*(f.irpf_retencion||0)/100;
  const totalFinal=baseTotal+ivaTotal-irpfAmt;
  const colW=75, xRight=pw-m-colW*2;

  const addRow=(label,value,bold=false,color=null)=>{
    if(bold){doc.setFillColor(247,248,252);doc.rect(xRight,y,colW*2,8,"F");}
    doc.setFont("helvetica",bold?"bold":"normal"); doc.setFontSize(9);
    if(color)doc.setTextColor(...color);else doc.setTextColor(60,60,60);
    doc.text(label,xRight+3,y+5.5); doc.setTextColor(0,0,0);
    doc.text(value,pw-m-2,y+5.5,{align:"right"}); y+=9;
  };
  addRow("Base imponible",baseTotal.toFixed(2)+" €",true);
  Object.entries(ivaMap).filter(([,v])=>v>0).sort(([a],[b])=>b-a).forEach(([pct,amt])=>{
    addRow(`IVA ${pct}%`,amt.toFixed(2)+" €");
  });
  if(f.irpf_retencion>0) addRow(`IRPF (−${f.irpf_retencion}%)`,"-"+irpfAmt.toFixed(2)+" €",false,[185,28,28]);
  y+=2; doc.setFillColor(...CR); doc.rect(xRight,y,colW*2,12,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont("helvetica","bold");
  doc.text("TOTAL",xRight+4,y+8.5); doc.text(totalFinal.toFixed(2)+" €",pw-m-2,y+8.5,{align:"right"});
  y+=20;

  if(f.notas){
    doc.setFillColor(255,251,235); doc.rect(m,y,tableW,14,"F");
    doc.setFontSize(7.5); doc.setTextColor(120,80,0); doc.setFont("helvetica","bold");
    doc.text("NOTAS Y CONDICIONES",m+3,y+5);
    doc.setFont("helvetica","normal"); doc.setTextColor(80,60,0);
    doc.text((doc.splitTextToSize(f.notas,tableW-6)[0])||"",m+3,y+11); y+=18;
  }

  const opLegal={
    nacional:"Operación sujeta a IVA español según la Ley 37/1992 del IVA.",
    intracomunitaria:"Operación intracomunitaria exenta de IVA (Art. 25 LIVA).",
    exportacion:"Exportación exenta de IVA (Art. 21 LIVA). No sujeta a IVA español.",
    importacion:"Importación — IVA liquidado en aduana mediante DUA.",
    inversion_sujeto_pasivo:"Inversión del sujeto pasivo (Art. 84 LIVA)."
  };
  doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(m,ph-22,pw-m,ph-22);
  doc.setFontSize(7); doc.setTextColor(140); doc.setFont("helvetica","normal");
  doc.text(opLegal[f.tipo_operacion]||"",m,ph-16);
  doc.text(`${pf?.nombre_razon_social||""} · NIF: ${pf?.nif||"—"}`,m,ph-10);
  doc.text(new Date().toLocaleDateString("es-ES"),pw-m,ph-10,{align:"right"});

  const fname=f.numero_factura?f.numero_factura.replace(/[\/\\]/g,"-"):"borrador";
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
