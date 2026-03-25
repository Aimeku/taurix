/* ═══════════════════════════════════════════════════════
   TAURIX · proforma.js
   Facturas Proforma — documento previo sin valor fiscal
   ─ Crear, editar, enviar, convertir a factura
   ─ PDF proforma con marca de agua "PROFORMA"
   ─ Estados: borrador → enviada → confirmada → convertida
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, fmtDate, toast, openModal, closeModal, getYear, getTrim, getFechaRango } from "./utils.js";
import { PRODUCTOS } from "./productos.js";
import { refreshFacturas } from "./facturas.js";

/* ══════════════════════════
   REFRESH / LISTADO
══════════════════════════ */
export async function refreshProforma() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const search   = (document.getElementById("proformaSearch")?.value || "").toLowerCase();
  const estadof  = document.getElementById("proformaFilterEstado")?.value || "";
  const desdef   = document.getElementById("proformaFilterDesde")?.value || "";
  const hastaf   = document.getElementById("proformaFilterHasta")?.value || "";

  const { data, error } = await supabase.from("proformas")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", desdef || ini).lte("fecha", hastaf || fin)
    .order("fecha", { ascending: false });

  if (error) { console.error("proforma:", error.message); return; }

  let lista = data || [];
  if (search)  lista = lista.filter(p =>
    (p.concepto||"").toLowerCase().includes(search) ||
    (p.numero||"").toLowerCase().includes(search) ||
    (p.cliente_nombre||"").toLowerCase().includes(search)
  );
  if (estadof) lista = lista.filter(p => p.estado === estadof);

  // KPIs
  const s = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const total   = lista.reduce((a,p)=>a+p.base+p.base*(p.iva||21)/100, 0);
  s("pfKpiTotal",       fmt(total));
  s("pfKpiConfirmadas", lista.filter(p=>p.estado==="confirmada").length);
  s("pfKpiPendientes",  lista.filter(p=>["borrador","enviada"].includes(p.estado)).length);
  s("pfKpiConvertidas", lista.filter(p=>p.estado==="convertida").length);
  s("proformaCount",    `${lista.length} proforma${lista.length!==1?"s":""} en el periodo`);

  const tbody = document.getElementById("proformaBody");
  if (!tbody) return;

  if (!lista.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="9">Sin proformas en este periodo. Crea tu primera proforma.</td></tr>`;
    return;
  }

  const estadoBadge = {
    borrador:   `<span class="badge b-draft">Borrador</span>`,
    enviada:    `<span class="badge b-pendiente">📤 Enviada</span>`,
    confirmada: `<span class="badge b-cobrada">✅ Confirmada</span>`,
    rechazada:  `<span class="badge b-vencida">❌ Rechazada</span>`,
    convertida: `<span class="badge b-ic">🔄 Convertida</span>`,
    caducada:   `<span class="badge" style="background:#f3f4f6;color:#6b7280">⏰ Caducada</span>`,
  };

  tbody.innerHTML = lista.map(p => {
    const total  = p.base + p.base*(p.iva||21)/100;
    const hoy    = new Date().toISOString().slice(0,10);
    const estado = (p.estado==="enviada"&&p.fecha_validez&&p.fecha_validez<hoy) ? "caducada" : p.estado;
    return `<tr>
      <td class="mono" style="font-size:12px">${fmtDate(p.fecha)}</td>
      <td><span class="badge b-income mono" style="font-size:11px;cursor:pointer" onclick="window._editProforma('${p.id}')">${p.numero||"PREL"}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${p.concepto||"—"}</td>
      <td style="font-size:12px;color:var(--t3)">${p.cliente_nombre||"—"}</td>
      <td class="mono fw7">${fmt(total)}</td>
      <td>${estadoBadge[estado]||estadoBadge.borrador}</td>
      <td style="font-size:12px;color:var(--t4)">${p.fecha_validez?fmtDate(p.fecha_validez):"—"}</td>
      <td style="font-size:12px">${p.factura_id?`<span class="badge b-cobrada" style="font-size:10px">Factura generada</span>`:"—"}</td>
      <td><div class="tbl-act">
        ${estado!=="convertida"?`<button class="ta-btn ta-emit" onclick="window._proformaToFactura('${p.id}')" title="Convertir a factura">📄 Factura</button>`:""}
        <button class="ta-btn ta-email" onclick="window._proformaEmail('${p.id}')" title="Enviar por email">📧</button>
        <button class="ta-btn" onclick="window._proformaPDF('${p.id}')" title="PDF">📄 PDF</button>
        <button class="ta-btn" onclick="window._editProforma('${p.id}')" title="Editar">✏️</button>
        <button class="ta-btn ta-del" onclick="window._delProforma('${p.id}')" title="Eliminar">🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   MODAL NUEVA / EDITAR PROFORMA
══════════════════════════ */
export function showProformaModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const lineas = prefill.lineas
    ? (typeof prefill.lineas==="string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{ descripcion:"", cantidad:1, precio:0, iva:21 }];

  openModal(`
    <div class="modal modal--wide" style="max-width:860px">
      <div class="modal-hd">
        <span class="modal-title">📋 ${isEdit?"Editar":"Nueva"} factura proforma</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:linear-gradient(135deg,#fef9c3,#fef3c7);border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px;display:flex;gap:8px;align-items:center">
          <span style="font-size:16px">⚠️</span>
          <span><strong>Documento sin valor fiscal.</strong> La proforma se usa para que el cliente confirme el pedido antes de emitir la factura definitiva.</span>
        </div>

        <!-- Cliente -->
        <div class="modal-grid2" style="margin-bottom:12px">
          <div class="modal-field"><label>Cliente *</label>
            <select id="pf_cliente" class="ff-select" onchange="window._pfClienteSelect()">
              <option value="">— Sin asignar —</option>
              ${CLIENTES.map(c=>`<option value="${c.id}" data-nombre="${c.nombre}" data-nif="${c.nif||""}" data-dir="${c.direccion||""}" ${prefill.cliente_id===c.id?"selected":""}>${c.nombre}${c.nif?" · "+c.nif:""}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Nombre cliente (libre)</label>
            <input id="pf_cliente_nombre" class="ff-input" value="${prefill.cliente_nombre||""}" placeholder="O escribe directamente"/>
          </div>
        </div>
        <div class="modal-grid2" style="margin-bottom:12px">
          <div class="modal-field"><label>NIF / CIF</label>
            <input id="pf_cliente_nif" class="ff-input" value="${prefill.cliente_nif||""}" placeholder="B12345678"/>
          </div>
          <div class="modal-field"><label>Email cliente</label>
            <input id="pf_cliente_email" class="ff-input" type="email" value="${prefill.cliente_email||""}" placeholder="cliente@empresa.com"/>
          </div>
        </div>

        <!-- Datos -->
        <div class="modal-grid3" style="margin-bottom:12px">
          <div class="modal-field"><label>Fecha *</label>
            <input type="date" id="pf_fecha" class="ff-input" value="${prefill.fecha||new Date().toISOString().slice(0,10)}"/>
          </div>
          <div class="modal-field"><label>Válida hasta</label>
            <input type="date" id="pf_validez" class="ff-input" value="${prefill.fecha_validez||""}"/>
          </div>
          <div class="modal-field"><label>Estado</label>
            <select id="pf_estado" class="ff-select">
              ${["borrador","enviada","confirmada","rechazada"].map(e=>`<option value="${e}" ${(prefill.estado||"borrador")===e?"selected":""}>${e.charAt(0).toUpperCase()+e.slice(1)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="modal-field" style="margin-bottom:16px">
          <label>Concepto / Asunto *</label>
          <input id="pf_concepto" class="ff-input" value="${prefill.concepto||""}" placeholder="Ej: Suministro de equipos informáticos"/>
        </div>

        <!-- Líneas -->
        <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Líneas del presupuesto</div>
        <div class="lineas-header" style="grid-template-columns:1fr 60px 100px 56px 32px">
          <div>Descripción</div><div>Cant.</div><div>Precio (€)</div><div>IVA</div><div></div>
        </div>
        <div id="pf_lineas">
          ${lineas.map((_,i)=>"").join("")}
        </div>
        <button class="btn-add-linea" id="pf_addLinea" style="margin-top:8px">+ Añadir línea</button>

        <div class="lineas-totales" id="pf_totales" style="margin-top:12px">
          <div class="lt-row"><span>Base imponible</span><strong id="pf_ltBase">0,00 €</strong></div>
          <div class="lt-row"><span>IVA</span><strong id="pf_ltIva">0,00 €</strong></div>
          <div class="lt-row lt-total"><span>TOTAL PROFORMA</span><strong id="pf_ltTotal">0,00 €</strong></div>
        </div>

        <div class="modal-field" style="margin-top:14px">
          <label>Condiciones / Notas</label>
          <textarea id="pf_notas" class="ff-input ff-textarea" style="min-height:60px" placeholder="Condiciones de pago, plazos de entrega, garantías…">${prefill.notas||""}</textarea>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit?`<button class="btn-modal-danger" id="pf_del" style="margin-right:auto">🗑️ Eliminar</button>`:""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pf_save">${isEdit?"Actualizar proforma":"Crear proforma"}</button>
      </div>
    </div>
  `);

  // Cliente select
  window._pfClienteSelect = () => {
    const sel = document.getElementById("pf_cliente");
    const opt = sel.options[sel.selectedIndex];
    if (opt.value) {
      document.getElementById("pf_cliente_nombre").value = opt.dataset.nombre||"";
      document.getElementById("pf_cliente_nif").value    = opt.dataset.nif||"";
    }
  };

  // Líneas
  let lineasArr = [...lineas];
  let lid = 0;

  const calcTotales = () => {
    let base=0, iva=0;
    lineasArr.forEach(l=>{ const sub=l.cantidad*l.precio; base+=sub; iva+=sub*l.iva/100; });
    const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    s("pf_ltBase",fmt(base)); s("pf_ltIva",fmt(iva)); s("pf_ltTotal",fmt(base+iva));
  };

  const addLinea = (pf={}) => {
    const id = ++lid;
    const l  = { id, descripcion:pf.descripcion||"", cantidad:pf.cantidad||1, precio:pf.precio||0, iva:pf.iva!==undefined?pf.iva:21 };
    lineasArr.push(l);
    const cont = document.getElementById("pf_lineas");
    const row  = document.createElement("div");
    row.className = "linea-row"; row.dataset.lineaId = id;
    row.style.gridTemplateColumns = "1fr 60px 100px 56px 32px";
    row.innerHTML = `
      <input type="text" class="ff-input" data-field="descripcion" value="${l.descripcion}" placeholder="Descripción del producto o servicio"/>
      <input type="number" class="ff-input" data-field="cantidad" value="${l.cantidad}" min="0.01" step="0.01"/>
      <div class="linea-price-wrap"><span class="linea-euro">€</span>
        <input type="number" class="linea-price ff-input" data-field="precio" value="${l.precio||""}" placeholder="0.00" step="0.01"/>
      </div>
      <select class="linea-iva ff-select" data-field="iva">
        <option value="21" ${l.iva===21?"selected":""}>21%</option>
        <option value="10" ${l.iva===10?"selected":""}>10%</option>
        <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
      </select>
      <button class="linea-del" onclick="window._pfDelLinea(${id})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    row.querySelectorAll("input,select").forEach(el => el.addEventListener("input",()=>{
      const lx=lineasArr.find(x=>x.id===id); if(!lx)return;
      const f=el.dataset.field;
      if(f==="descripcion")lx.descripcion=el.value;
      else if(f==="cantidad")lx.cantidad=parseFloat(el.value)||0;
      else if(f==="precio")lx.precio=parseFloat(el.value)||0;
      else if(f==="iva")lx.iva=parseInt(el.value)||0;
      calcTotales();
    }));

    // Autocomplete productos
    if (PRODUCTOS?.length > 0) {
      const descEl = row.querySelector("[data-field='descripcion']");
      if (descEl) {
        const dd = document.createElement("div");
        dd.style.cssText = "position:absolute;z-index:300;width:280px;top:100%;left:0;background:var(--srf);border:1px solid var(--brd);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);display:none;max-height:220px;overflow-y:auto";
        descEl.parentElement.style.position = "relative";
        descEl.parentElement.appendChild(dd);
        descEl.addEventListener("input", () => {
          const q = descEl.value.toLowerCase();
          const matches = PRODUCTOS.filter(p=>p.activo!==false&&(p.nombre.toLowerCase().includes(q)||(p.descripcion||"").toLowerCase().includes(q))).slice(0,6);
          if (!q||!matches.length){dd.style.display="none";return;}
          dd.innerHTML = matches.map(p=>`<div style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--brd);font-size:12px" data-pid="${p.id}" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
            <div style="font-weight:600">${p.nombre}</div><div style="color:var(--t3);font-size:10px">${p.descripcion||""}</div>
            <div style="color:var(--accent);font-weight:700;font-family:monospace;margin-top:2px">${fmt(p.precio)} · IVA ${p.iva}%</div>
          </div>`).join("");
          dd.querySelectorAll("[data-pid]").forEach(item=>item.addEventListener("mousedown",e=>{
            e.preventDefault();
            const p=PRODUCTOS.find(x=>x.id===item.dataset.pid);if(!p)return;
            const lx=lineasArr.find(x=>x.id===id);if(lx){lx.descripcion=p.descripcion||p.nombre;lx.precio=p.precio;lx.iva=p.iva;}
            descEl.value=p.descripcion||p.nombre;
            row.querySelector("[data-field='precio']").value=p.precio;
            row.querySelector("[data-field='iva']").value=p.iva;
            dd.style.display="none"; calcTotales();
          }));
          dd.style.display="";
        });
        descEl.addEventListener("blur",()=>setTimeout(()=>{dd.style.display="none";},200));
      }
    }
    cont.appendChild(row); calcTotales();
  };

  window._pfDelLinea = (id) => {
    lineasArr = lineasArr.filter(l=>l.id!==id);
    document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
    calcTotales();
  };

  lineas.forEach(l=>addLinea(l));
  document.getElementById("pf_addLinea").addEventListener("click",()=>addLinea());

  // Guardar
  document.getElementById("pf_save").addEventListener("click", async () => {
    const concepto = document.getElementById("pf_concepto").value.trim();
    const fecha    = document.getElementById("pf_fecha").value;
    if (!concepto||!fecha) { toast("Concepto y fecha son obligatorios","error"); return; }
    if (!lineasArr.length||lineasArr.every(l=>!l.precio||l.precio<=0)) { toast("Añade al menos una línea con precio","error"); return; }

    let base=0; const ivaMap={};
    lineasArr.forEach(l=>{const sub=l.cantidad*l.precio;base+=sub;ivaMap[l.iva]=(ivaMap[l.iva]||0)+sub*l.iva/100;});
    const ivaMain = parseInt(Object.entries(ivaMap).sort(([,a],[,b])=>b-a)[0]?.[0])||21;

    // Numeración
    const year = new Date(fecha).getFullYear();
    const {data:last} = await supabase.from("proformas").select("numero").eq("user_id",SESSION.user.id)
      .like("numero",`PRF-${year}-%`).order("numero",{ascending:false}).limit(1);
    const lastN = last?.[0]?.numero ? parseInt((last[0].numero.match(/-(\d+)$/) || [])[1])||0 : 0;
    const numero = isEdit ? prefill.numero : `PRF-${year}-${String(lastN+1).padStart(3,"0")}`;

    const payload = {
      user_id:        SESSION.user.id,
      numero, concepto, fecha,
      fecha_validez:  document.getElementById("pf_validez").value||null,
      estado:         document.getElementById("pf_estado").value||"borrador",
      cliente_id:     document.getElementById("pf_cliente").value||null,
      cliente_nombre: document.getElementById("pf_cliente_nombre").value.trim()||null,
      cliente_nif:    document.getElementById("pf_cliente_nif").value.trim()||null,
      cliente_email:  document.getElementById("pf_cliente_email").value.trim()||null,
      base, iva: ivaMain,
      lineas: JSON.stringify(lineasArr.map(l=>({descripcion:l.descripcion,cantidad:l.cantidad,precio:l.precio,iva:l.iva}))),
      notas: document.getElementById("pf_notas").value.trim()||null,
    };

    let err;
    if (isEdit) { ({error:err}=await supabase.from("proformas").update(payload).eq("id",prefill.id)); }
    else        { ({error:err}=await supabase.from("proformas").insert(payload)); }

    if (err) { toast("Error: "+err.message,"error"); return; }
    toast(isEdit?"Proforma actualizada ✅":`Proforma ${numero} creada ✅`,"success");
    closeModal(); await refreshProforma();
  });

  if (isEdit) {
    document.getElementById("pf_del")?.addEventListener("click", async()=>{
      if(!confirm("¿Eliminar esta proforma?"))return;
      await supabase.from("proformas").delete().eq("id",prefill.id);
      closeModal(); toast("Proforma eliminada","success"); await refreshProforma();
    });
  }
}

/* ══════════════════════════
   CONVERTIR PROFORMA → FACTURA
══════════════════════════ */
window._proformaToFactura = async (id) => {
  const {data:p} = await supabase.from("proformas").select("*").eq("id",id).single();
  if (!p) return;

  openModal(`
    <div class="modal" style="max-width:440px">
      <div class="modal-hd"><span class="modal-title">📄 Convertir a factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <div style="background:var(--bg2);border-radius:10px;padding:14px;margin-bottom:14px">
          <div style="font-weight:600">${p.concepto}</div>
          <div style="font-size:12px;color:var(--t3)">${p.cliente_nombre||"—"} · ${fmt(p.base+p.base*(p.iva||21)/100)}</div>
        </div>
        <p style="font-size:13px;line-height:1.6">Se creará una <strong>factura en borrador</strong> con todos los datos de esta proforma. Podrás revisarla y emitirla desde Facturas.</p>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_pf2fOk">Crear factura borrador</button>
      </div>
    </div>`);

  document.getElementById("_pf2fOk").addEventListener("click", async()=>{
    const {data:factura, error:fe} = await supabase.from("facturas").insert({
      user_id:        SESSION.user.id,
      concepto:       p.concepto,
      base:           p.base,
      iva:            p.iva||21,
      tipo:           "emitida",
      tipo_operacion: "nacional",
      estado:         "borrador",
      fecha:          new Date().toISOString().slice(0,10),
      cliente_id:     p.cliente_id,
      cliente_nombre: p.cliente_nombre,
      cliente_nif:    p.cliente_nif,
      lineas:         p.lineas,
      notas:          `Factura generada desde proforma ${p.numero}${p.notas?"\n"+p.notas:""}`,
    }).select().single();

    if (fe) { toast("Error: "+fe.message,"error"); return; }

    await supabase.from("proformas").update({estado:"convertida", factura_id:factura.id}).eq("id",id);
    closeModal();
    toast(`📄 Factura borrador creada desde proforma ${p.numero}. Revísala en Facturas.`,"success",4000);
    await refreshProforma(); await refreshFacturas();
  });
};

/* ══════════════════════════
   PDF PROFORMA con marca de agua
══════════════════════════ */
window._proformaPDF = async (id) => {
  const {data:p} = await supabase.from("proformas").select("*").eq("id",id).single();
  if (!p) return;

  if (!window.jspdf) {
    await new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";s.onload=res;s.onerror=rej;document.head.appendChild(s);});
  }

  const {data:pf} = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).maybeSingle();
  const lineas = p.lineas ? JSON.parse(p.lineas) : [];
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit:"mm",format:"a4"});
  const PW=210, ML=18, MR=18, W=PW-ML-MR;
  const BLUE=[26,86,219], INK=[15,23,42], MUTED=[100,116,139];

  // Fondo
  doc.setFillColor(255,255,255); doc.rect(0,0,PW,297,"F");

  // MARCA DE AGUA "PROFORMA" diagonal
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({opacity:0.07}));
  doc.setFont("helvetica","bold"); doc.setFontSize(72); doc.setTextColor(26,86,219);
  doc.text("PROFORMA",105,148,{align:"center",angle:45});
  doc.restoreGraphicsState();

  // Header azul
  doc.setFillColor(...BLUE); doc.rect(0,0,PW,32,"F");
  doc.setTextColor(255,255,255); doc.setFont("helvetica","bold"); doc.setFontSize(20);
  doc.text("FACTURA PROFORMA",ML,17);
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  doc.text(`${p.numero}  ·  ${fmtDate(p.fecha)}`,ML,26);

  // Validez
  if (p.fecha_validez) {
    doc.setFontSize(9); doc.text(`Válida hasta: ${fmtDate(p.fecha_validez)}`,PW-MR,26,{align:"right"});
  }

  let y=44;
  doc.setTextColor(...INK);

  // Emisor
  doc.setFont("helvetica","bold"); doc.setFontSize(9);
  doc.text(pf?.nombre_razon_social||"—",ML,y); y+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  if(pf?.nif){doc.text("NIF: "+pf.nif,ML,y);y+=4.5;}
  if(pf?.domicilio_fiscal){const ls=doc.splitTextToSize(pf.domicilio_fiscal,70);doc.text(ls,ML,y);y+=ls.length*4.5;}
  y+=4;

  // Cliente
  let ry=44;
  const COL2=PW/2+6;
  doc.setTextColor(...MUTED); doc.setFontSize(8); doc.setFont("helvetica","bold");
  doc.text("DESTINATARIO:",COL2,ry); ry+=5;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text(p.cliente_nombre||"—",COL2,ry); ry+=5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  if(p.cliente_nif){doc.text("NIF: "+p.cliente_nif,COL2,ry);ry+=4.5;}

  y=Math.max(y,ry)+8;
  doc.setDrawColor(226,232,240); doc.setLineWidth(0.4); doc.line(ML,y,PW-MR,y); y+=8;

  // Concepto
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("Concepto: "+p.concepto,ML,y); y+=10;

  // Tabla líneas
  const cW={desc:88,qty:18,price:28,iva:16,total:24};
  doc.setFillColor(...BLUE); doc.rect(ML,y,W,8,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont("helvetica","bold");
  let x=ML+2;
  ["Descripción","Cant.","Precio","IVA","Total"].forEach((h,i)=>{doc.text(h,x,y+5.5);x+=[cW.desc,cW.qty,cW.price,cW.iva,cW.total][i];});
  y+=8;

  let base=0; const ivaMap={};
  lineas.forEach((l,ri)=>{
    const sub=(l.cantidad||1)*(l.precio||0);
    base+=sub; ivaMap[l.iva]=(ivaMap[l.iva]||0)+sub*l.iva/100;
    if(ri%2===0){doc.setFillColor(247,250,255);}else{doc.setFillColor(255,255,255);}
    doc.rect(ML,y,W,7,"F");
    doc.setFontSize(8.5); doc.setTextColor(...INK); doc.setFont("helvetica","normal");
    x=ML+2;
    [(l.descripcion||"—").substring(0,45),String(l.cantidad||1),parseFloat(l.precio||0).toFixed(2)+" €",(l.iva||0)+"%",sub.toFixed(2)+" €"]
      .forEach((v,i)=>{if(i===4)doc.setFont("helvetica","bold");doc.text(v,x,y+5);if(i===4)doc.setFont("helvetica","normal");x+=[cW.desc,cW.qty,cW.price,cW.iva,cW.total][i];});
    y+=7; if(y>260){doc.addPage();y=20;}
  });

  doc.setDrawColor(...BLUE); doc.setLineWidth(0.4); doc.line(ML,y,PW-MR,y); y+=6;

  // Totales
  const ivaTotal=Object.values(ivaMap).reduce((a,b)=>a+b,0);
  const xTL=PW-MR-80, xTV=PW-MR;
  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text("Base imponible",xTL,y); doc.setTextColor(...INK); doc.text(base.toFixed(2)+" €",xTV,y,{align:"right"}); y+=6;
  Object.entries(ivaMap).filter(([,v])=>v>0).forEach(([pct,amt])=>{
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text("IVA "+pct+"%",xTL,y); doc.setTextColor(...INK); doc.text(amt.toFixed(2)+" €",xTV,y,{align:"right"}); y+=6;
  });
  doc.setDrawColor(226,232,240); doc.setLineWidth(0.3); doc.line(xTL,y,xTV,y); y+=4;
  doc.setFillColor(...BLUE); doc.roundedRect(xTL-4,y-2,xTV-xTL+8,13,1.5,1.5,"F");
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(255,255,255);
  doc.text("TOTAL PROFORMA",xTL,y+7);
  doc.text((base+ivaTotal).toFixed(2)+" €",xTV,y+7,{align:"right"}); y+=18;

  // Notas
  if(p.notas&&y<260){
    doc.setFillColor(248,250,252); doc.setDrawColor(226,232,240); doc.setLineWidth(0.3);
    const nl=doc.splitTextToSize(p.notas,W-10);
    doc.roundedRect(ML,y,W,nl.length*4.5+12,1.5,1.5,"FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("CONDICIONES / NOTAS",ML+4,y+6);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(nl,ML+4,y+11); y+=nl.length*4.5+16;
  }

  // Aviso legal
  doc.setDrawColor(226,232,240); doc.line(ML,285,PW-MR,285);
  doc.setFont("helvetica","italic"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text("Este documento es una factura proforma sin valor fiscal ni contable. No constituye una factura a efectos del IVA.",ML,290);
  doc.text(`${pf?.nombre_razon_social||""} · NIF: ${pf?.nif||"—"}`,PW-MR,290,{align:"right"});

  doc.save(`proforma_${p.numero||"PREL"}.pdf`);
  toast("PDF proforma descargado ✅","success");
};

/* ══════════════════════════
   EMAIL PROFORMA
══════════════════════════ */
window._proformaEmail = async (id) => {
  const {data:p} = await supabase.from("proformas").select("*").eq("id",id).single();
  if (!p) return;

  openModal(`
    <div class="modal" style="max-width:560px">
      <div class="modal-hd"><span class="modal-title">📧 Enviar proforma por email</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:14px">
          💡 Se descargará el PDF y se abrirá tu cliente de correo con el mensaje prellenado.
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Email del cliente *</label>
            <input id="pfe_to" class="ff-input" type="email" value="${p.cliente_email||""}" placeholder="cliente@empresa.com"/>
          </div>
          <div class="modal-field"><label>CC (separados por coma)</label>
            <input id="pfe_cc" class="ff-input" placeholder="cc1@empresa.com, cc2@empresa.com"/>
          </div>
        </div>
        <div class="modal-field"><label>Abrir con</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <label class="email-client-opt"><input type="radio" name="pfe_client" value="gmail" checked/><span>📧 Gmail</span></label>
            <label class="email-client-opt"><input type="radio" name="pfe_client" value="outlook"/><span>📘 Outlook</span></label>
            <label class="email-client-opt"><input type="radio" name="pfe_client" value="local"/><span>🖥️ App sistema</span></label>
          </div>
        </div>
        <div class="modal-field"><label>Asunto</label>
          <input id="pfe_subject" class="ff-input" value="Proforma ${p.numero||""} — ${p.concepto||""}"/>
        </div>
        <div class="modal-field"><label>Mensaje</label>
          <textarea id="pfe_body" class="ff-input ff-textarea" style="min-height:110px">Estimado/a cliente,

Adjuntamos la factura proforma ${p.numero||""} por importe de ${fmt(p.base+p.base*(p.iva||21)/100)}.

Concepto: ${p.concepto||""}
${p.fecha_validez?"Válida hasta: "+fmtDate(p.fecha_validez):""}

Una vez confirme el pedido, procederemos a emitir la factura definitiva.

Quedo a su disposición para cualquier consulta.

Atentamente</textarea>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pfe_send">📧 Descargar PDF y abrir correo</button>
      </div>
    </div>`);

  document.getElementById("pfe_send").addEventListener("click", async()=>{
    const to      = document.getElementById("pfe_to").value.trim();
    const ccRaw   = document.getElementById("pfe_cc").value;
    const cc      = ccRaw.split(",").map(e=>e.trim()).filter(e=>e&&e.includes("@")).join(",");
    const subject = document.getElementById("pfe_subject").value.trim();
    const body    = document.getElementById("pfe_body").value.trim();
    if (!to) { toast("Introduce el email del cliente","error"); return; }

    await window._proformaPDF(id);
    const client = document.querySelector("input[name='pfe_client']:checked")?.value||"gmail";
    let url;
    if (client==="gmail") url=`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}${cc?`&cc=${encodeURIComponent(cc)}`:""}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    else if (client==="outlook") url=`https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc?`&cc=${encodeURIComponent(cc)}`:""}`;
    else url=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}${cc?`&cc=${encodeURIComponent(cc)}`:""}&body=${encodeURIComponent(body)}`;
    window.open(url,"_blank");

    // Marcar como enviada
    if (p.estado==="borrador") {
      await supabase.from("proformas").update({estado:"enviada"}).eq("id",id);
      await refreshProforma();
    }
    closeModal(); toast("📧 Correo abierto. Adjunta el PDF y envía.","success",4000);
  });
};

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._editProforma = async (id) => {
  const {data:p} = await supabase.from("proformas").select("*").eq("id",id).single();
  if (!p) { toast("Error cargando proforma","error"); return; }
  const lineas = p.lineas ? JSON.parse(p.lineas) : [];
  showProformaModal({...p, lineas});
};
window._delProforma = (id) => {
  openModal(`
    <div class="modal" style="max-width:380px">
      <div class="modal-hd"><span class="modal-title">Eliminar proforma</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta proforma? No se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpfOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpfOk").addEventListener("click", async()=>{
    await supabase.from("proformas").delete().eq("id",id);
    closeModal(); toast("Proforma eliminada","success"); await refreshProforma();
  });
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initProformaView() {
  document.getElementById("nuevaProformaBtn")?.addEventListener("click", ()=>showProformaModal());
  document.getElementById("proformaSearch")?.addEventListener("input", ()=>refreshProforma());
  ["proformaFilterEstado","proformaFilterDesde","proformaFilterHasta"].forEach(id=>{
    document.getElementById(id)?.addEventListener("change",()=>refreshProforma());
  });
  document.getElementById("proformaFilterReset")?.addEventListener("click",()=>{
    ["proformaSearch","proformaFilterEstado","proformaFilterDesde","proformaFilterHasta"].forEach(id=>{
      const el=document.getElementById(id);if(el)el.value="";
    });
    refreshProforma();
  });
  refreshProforma();
}
