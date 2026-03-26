/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   ─ Editor profesional de plantillas de documentos
   ─ Diseño, logo, fuentes, colores, márgenes, visibilidad
   ─ Preview PDF en tiempo real
   ─ ES / EN (idioma del documento)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

export async function loadPlantillas() {
  const { data, error } = await supabase.from("plantillas_usuario")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  return data || [];
}

export async function refreshPlantillas() {
  PLANTILLAS = await loadPlantillas();
  _renderGrid();
}

function _renderGrid() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;
  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--t3)">
        <div style="font-size:52px;margin-bottom:14px">📄</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;color:var(--t1)">Sin plantillas todavía</div>
        <div style="font-size:13px;margin-bottom:24px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto">
          Crea plantillas con tu logo, colores y estilo para que todos tus documentos tengan imagen de marca.
        </div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()" style="padding:11px 28px">✨ Crear primera plantilla</button>
      </div>`;
    return;
  }
  const COLS = ["#3b82f6","#f97316","#059669","#8b5cf6","#ef4444","#0ea5e9","#ec4899","#14b8a6"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const base   = lineas.reduce((a, l) => a + (l.cantidad||1)*(l.precio||0), 0);
    const color  = p.color_cabecera || COLS[i % COLS.length];
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${color};cursor:pointer" onclick="window._editPlantilla('${p.id}')">
        <div style="background:${color}18;border-radius:8px;padding:8px 10px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
          ${p.logo_b64 ? `<img src="${p.logo_b64}" style="max-height:24px;max-width:60px;object-fit:contain"/>` : `<span style="font-size:11px;font-weight:700;color:${color}">${p.nombre}</span>`}
          <span style="font-size:10px;color:${color};font-weight:700">${p.fuente||"Helvetica"}</span>
        </div>
        <div class="doc-card-name" style="margin:0 0 4px">${p.nombre}</div>
        <div class="doc-card-desc" style="margin-bottom:8px">${p.concepto||"Sin concepto"}</div>
        ${base > 0 ? `<div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">${fmt(base)}</div>` : ""}
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:${color}15;color:${color};font-weight:600">${lineas.length} línea${lineas.length!==1?"s":""}</span>
          ${p.idioma==="en"?`<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:#f0f9ff;color:#0369a1;font-weight:600">EN</span>`:`<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:#fef9c3;color:#854d0e;font-weight:600">ES</span>`}
        </div>
        <div style="display:flex;gap:5px">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

function _lineaHTML(l) {
  l = l || {};
  return `<div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
    <input autocomplete="off" class="ff-input" data-field="descripcion" value="${(l.descripcion||"").replace(/"/g,'&quot;')}" placeholder="Descripción"/>
    <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad||1}" min="0.01" step="0.01"/>
    <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio||""}" step="0.01" placeholder="0.00"/>
    <select class="ff-select" data-field="iva">
      <option value="21" ${(l.iva||21)===21?"selected":""}>21%</option>
      <option value="10" ${l.iva===10?"selected":""}>10%</option>
      <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
      <option value="0"  ${l.iva===0 ?"selected":""}>0%</option>
    </select>
    <button class="linea-del plt-del-linea" title="Eliminar">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>`;
}

export function showPlantillaModal(prefill) {
  // Navegar a la vista completa en vez de abrir modal
  prefill = prefill || {};
  window._epCurrentPrefill = prefill;
  window._switchView?.("editar-plantilla");
}

/* ══════════════════════════
   INIT DE LA VISTA EDITAR-PLANTILLA
   Llamado por main.js cuando se activa la vista
══════════════════════════ */
window._epInit = function() {
  const prefill = window._epCurrentPrefill || {};
  window._epCurrentPrefill = null;

  const isEdit = !!prefill.id;
  const lineas = prefill.lineas
    ? (typeof prefill.lineas==="string" ? JSON.parse(prefill.lineas) : prefill.lineas)
    : [{descripcion:"",cantidad:1,precio:0,iva:21}];

  // Título de la vista
  const titulo = document.getElementById("epTitulo");
  if (titulo) titulo.textContent = isEdit ? `Editando: ${prefill.nombre}` : "Nueva plantilla";

  // Rellenar campos con prefill
  const sv = (id,v) => { const el=document.getElementById(id); if(el) el.value=v||""; };
  const sc = (id,v) => { const el=document.getElementById(id); if(el) el.checked=v!==false; };
  const sri= (id,v) => { const el=document.getElementById(id); if(el){el.value=v||el.value; const lbl=document.getElementById(id+"_val"); if(lbl)lbl.textContent=el.value;} };

  sv("ep_nombre",         prefill.nombre);
  sv("ep_concepto",       prefill.concepto);
  sv("ep_descripcion",    prefill.descripcion);
  sv("ep_notas",          prefill.notas);
  sv("ep_pie",            prefill.texto_pie);
  sv("ep_iban",           prefill.iban_visible);
  sv("ep_estilo_cab",     prefill.estilo_cab     || "solido");
  sv("ep_tamano_hoja",    prefill.tamano_hoja    || "A4");
  sv("ep_fuente",         prefill.fuente         || "Helvetica");
  sv("ep_tam_fuente",     prefill.tam_fuente     || 9);
  sv("ep_alin_val",       prefill.alin_texto     || "izq");
  sri("ep_margen",        prefill.margen         || 18);
  sri("ep_pie_altura",    prefill.pie_altura     || 14);
  sri("ep_logo_x",        prefill.logo_x         || 0);
  sri("ep_logo_y",        prefill.logo_y         || 6);
  sri("ep_logo_size",     prefill.logo_size      || 30);
  sri("ep_emisor_x",      prefill.emisor_x       || 0);
  sri("ep_emisor_y",      prefill.emisor_y       || 0);
  sri("ep_cliente_x",     prefill.cliente_x      || 0);
  sri("ep_cliente_y",     prefill.cliente_y      || 0);

  // Colores
  const COLS = {
    ep_color_cab:      prefill.color_cabecera  || "#1a56db",
    ep_color_txt_cab:  prefill.color_txt_cab   || "#ffffff",
    ep_color_acento:   prefill.color_acento    || "#1a56db",
    ep_color_letra:    prefill.color_letra     || "#0f172a",
    ep_color_fondo:    prefill.color_fondo     || "#ffffff",
    ep_color_fondo_tab:prefill.color_fondo_tab || "#f8fafc",
    ep_color_lineas:   prefill.color_lineas    || "#e2e8f0",
  };
  Object.entries(COLS).forEach(([id,val])=>{
    const pick=document.getElementById(id); if(pick) pick.value=val;
    const hex=document.getElementById(id+"_hex"); if(hex) hex.value=val;
  });

  // Checkboxes
  sc("ep_mostrar_logo",    prefill.mostrar_logo);
  sc("ep_mostrar_cab",     prefill.mostrar_cab);
  sc("ep_mostrar_pie",     prefill.mostrar_pie);
  sc("ep_mostrar_emisor",  prefill.mostrar_emisor);
  sc("ep_mostrar_email",   prefill.mostrar_email);
  sc("ep_mostrar_num_pag", prefill.mostrar_num_pag);
  sc("ep_cab_todas_pags",  prefill.cab_todas_pags || false);

  // Fecha en preview
  const fechaEl = document.getElementById("ep_pv_fecha");
  if (fechaEl) fechaEl.textContent = "FAC-2025-001 · " + new Date().toLocaleDateString("es-ES");

  // Logo
  let _logo = prefill.logo_b64 || "";
  let _idioma = prefill.idioma || "es";
  const logoPrev = document.getElementById("ep_logo_prev");
  const logoPlaceholder = document.getElementById("ep_logo_placeholder");
  const logoBtn  = document.getElementById("ep_logo_btn");
  const logoRm   = document.getElementById("ep_logo_rm");
  const logoInp  = document.getElementById("ep_logo_inp");

  const _updateLogoUI = () => {
    if (logoPrev) {
      if (_logo) {
        logoPrev.innerHTML = `<img src="${_logo}" style="max-width:96px;max-height:60px;object-fit:contain"/>`;
      } else {
        logoPrev.innerHTML = `<span id="ep_logo_placeholder" style="font-size:11px;color:var(--t4);text-align:center;line-height:1.4">Click para<br>subir logo</span>`;
      }
    }
    if (logoBtn)  logoBtn.textContent = _logo ? "📁 Cambiar logo" : "📁 Subir logo";
    if (logoRm)   logoRm.style.display = _logo ? "" : "none";
  };
  _updateLogoUI();

  logoBtn?.addEventListener("click", ()=>logoInp?.click());
  logoInp?.addEventListener("change", e=>{
    const f=e.target.files[0]; if(!f)return;
    if(f.size>500*1024){alert("El logo no puede superar 500KB");return;}
    const r=new FileReader();
    r.onload=ev=>{ _logo=ev.target.result; _updateLogoUI(); _epPv(); };
    r.readAsDataURL(f);
  });
  logoRm?.addEventListener("click",()=>{ _logo=""; _updateLogoUI(); _epPv(); });

  // Toggle mostrar logo
  const mostrarLogoLbl = document.getElementById("ep_mostrar_logo_lbl");
  document.getElementById("ep_mostrar_logo")?.addEventListener("change", e=>{
    if(mostrarLogoLbl){
      mostrarLogoLbl.style.borderColor = e.target.checked?"var(--accent)":"var(--brd)";
      mostrarLogoLbl.style.background  = e.target.checked?"var(--accent)0d":"var(--bg2)";
    }
    _epPv();
  });

  // Sync color pickers
  Object.keys(COLS).forEach(id=>{
    const pick=document.getElementById(id);
    const hex=document.getElementById(id+"_hex");
    if(!pick||!hex)return;
    pick.addEventListener("input",()=>{hex.value=pick.value;_epPv();});
    hex.addEventListener("change",()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){pick.value=hex.value;}_epPv();});
  });

  // Tabs
  window._epTab = (tab) => {
    document.querySelectorAll(".ep-tab").forEach(b=>{
      const on = b.dataset.tab===tab;
      b.style.borderBottom   = on?"2px solid var(--accent)":"2px solid transparent";
      b.style.color          = on?"var(--accent)":"var(--t3)";
      b.style.background     = on?"var(--srf)":"transparent";
    });
    document.querySelectorAll(".ep-sec").forEach(s=>{
      s.style.display = s.id===("ep-tab-"+tab) ? "" : "none";
    });
  };

  // Alineación desde botones HTML estáticos
  window._epSetAlin = (v) => {
    document.getElementById("ep_alin_val").value = v;
    document.querySelectorAll("#ep_alin_group button").forEach(b=>{
      const on = b.dataset.alin===v;
      b.style.borderColor = on?"#f97316":"var(--brd)";
      b.style.color       = on?"#f97316":"var(--t2)";
      b.style.fontWeight  = on?"700":"500";
    });
    _epPv();
  };

  // Idioma
  const LABELS_ES = {tipo:"FACTURA",de:"EMISOR",para:"CLIENTE",cant:"Cant",precio:"Precio",iva:"IVA",total:"Total",base:"Base imponible",totalDoc:"TOTAL"};
  const LABELS_EN = {tipo:"INVOICE",de:"FROM",para:"BILL TO",cant:"Qty",precio:"Price",iva:"VAT",total:"Total",base:"Subtotal",totalDoc:"TOTAL"};

  window._epLang = (lang)=>{
    _idioma=lang;
    ["es","en"].forEach(l=>{
      const btn=document.getElementById("ep_lang_"+l);
      if(!btn)return;
      btn.style.borderColor=l===lang?"var(--accent)":"var(--brd)";
      btn.style.background =l===lang?"var(--accent)":"var(--bg2)";
      btn.style.color      =l===lang?"#fff":"var(--t2)";
    });
    _epPv();
  };
  _epLang(_idioma);

  // Alineación — resaltar el botón activo al cargar
  const alinVal = document.getElementById("ep_alin_val")?.value||"izq";
  document.querySelectorAll("#ep_alin_group button").forEach(b=>{
    const on=b.dataset.alin===alinVal;
    b.style.borderColor=on?"#f97316":"var(--brd)";
    b.style.color=on?"#f97316":"var(--t2)";
    b.style.fontWeight=on?"700":"500";
  });

  // Líneas
  const _lineaHTML = (l)=>`
    <div class="linea-row" style="grid-template-columns:1fr 58px 96px 56px 30px">
      <input autocomplete="off" class="ff-input" data-field="descripcion" value="${(l.descripcion||"").replace(/"/g,"&quot;")}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad||1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio||""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva||21)===21?"selected":""}>21%</option>
        <option value="10" ${l.iva===10?"selected":""}>10%</option>
        <option value="4"  ${l.iva===4?"selected":""}>4%</option>
        <option value="0"  ${l.iva===0?"selected":""}>0%</option>
      </select>
      <button class="linea-del ep-del-linea" title="Eliminar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;

  const cont = document.getElementById("ep_lineasContainer");
  if (cont) { cont.innerHTML = ""; lineas.forEach(l=>cont.insertAdjacentHTML("beforeend",_lineaHTML(l))); }
  if (!lineas.length || lineas.every(l=>!l.descripcion)) {
    cont?.insertAdjacentHTML("beforeend", _lineaHTML({}));
  }

  document.getElementById("ep_addLinea")?.addEventListener("click",()=>{
    cont?.insertAdjacentHTML("beforeend",_lineaHTML({})); _epPv();
  });
  cont?.addEventListener("click",e=>{ if(e.target.closest(".ep-del-linea")){e.target.closest(".linea-row")?.remove();_epPv();} });
  cont?.addEventListener("input", _epPv);

  // PREVIEW
  const FONT_MAP={"Helvetica":"Helvetica,Arial,sans-serif","Arial":"Arial,sans-serif","Courier New":"'Courier New',monospace","Times New Roman":"'Times New Roman',Times,serif","Georgia":"Georgia,serif","Trebuchet MS":"'Trebuchet MS',sans-serif","Verdana":"Verdana,sans-serif","Garamond":"Garamond,serif"};

  window._epPreview = _epPv;
  function _epPv(){
    const L    = _idioma==="en"?LABELS_EN:LABELS_ES;
    const g    = id=>document.getElementById(id);
    const gv   = (id,fb)=>{ const el=g(id); return (el&&el.value)?el.value:fb; };
    const gc   = (id,fb)=>{ const el=g(id); return el?el.checked:fb; };

    const colorCab  = gv("ep_color_cab",    "#1a56db");
    const colorTxtC = gv("ep_color_txt_cab","#ffffff");
    const colorAcc  = gv("ep_color_acento", "#1a56db");
    const colorLetra= gv("ep_color_letra",  "#0f172a");
    const colorFdo  = gv("ep_color_fondo",  "#ffffff");
    const colorFdoT = gv("ep_color_fondo_tab","#f8fafc");
    const colorLin  = gv("ep_color_lineas", "#e2e8f0");
    const estCab    = gv("ep_estilo_cab",   "solido");
    const fuente    = gv("ep_fuente",       "Helvetica");
    const tamF      = parseInt(gv("ep_tam_fuente","9"))||9;
    const concepto  = gv("ep_concepto",     "")||"Concepto del documento";
    const notas     = gv("ep_notas",        "");
    const desc      = gv("ep_descripcion",  "");
    const pie       = gv("ep_pie",          "");
    const mostLogo  = gc("ep_mostrar_logo",  true);
    const mostCab   = gc("ep_mostrar_cab",   true);
    const mostPie   = gc("ep_mostrar_pie",   true);
    const mostEmisor= gc("ep_mostrar_emisor",true);
    const spEmisor  = parseInt(g("ep_margen")?.value)||18;
    const logoX     = parseInt(g("ep_logo_x")?.value)||0;
    const logoY     = parseInt(g("ep_logo_y")?.value)||6;
    const logoSize  = parseInt(g("ep_logo_size")?.value)||30;
    const emisorX   = parseInt(g("ep_emisor_x")?.value)||0;
    const emisorY   = parseInt(g("ep_emisor_y")?.value)||0;
    const clienteX  = parseInt(g("ep_cliente_x")?.value)||0;
    const clienteY  = parseInt(g("ep_cliente_y")?.value)||0;
    const alin      = gv("ep_alin_val","izq");
    const alinCSS   = alin==="centro"?"center":alin==="der"?"right":"left";

    // Doc
    const doc=g("ep_pv_doc");
    if(doc){doc.style.fontFamily=FONT_MAP[fuente];doc.style.background=colorFdo;doc.style.color=colorLetra;doc.style.fontSize=(tamF+2)+"px";doc.style.textAlign=alinCSS;}

    // Logo
    const lr=g("ep_pv_logo_row");const li=g("ep_pv_logo_img");
    if(lr){lr.style.display=(mostLogo&&_logo)?"flex":"none";lr.style.paddingTop=logoY+"px";lr.style.justifyContent=logoX>=0?"flex-end":"flex-start";}
    if(li&&_logo){li.src=_logo;li.style.maxHeight=logoSize+"px";li.style.maxWidth=(logoSize*2.5)+"px";li.style.marginRight=logoX+"px";}

    // Cabecera
    const cab=g("ep_pv_cab");
    if(cab){
      if(!mostCab||estCab==="sin"){cab.style.display="none";}
      else{
        cab.style.display="";
        if(estCab==="solido")   {cab.style.background=colorCab;cab.style.borderBottom="none";}
        if(estCab==="gradiente"){cab.style.background=`linear-gradient(135deg,${colorCab},${colorAcc})`;cab.style.borderBottom="none";}
        if(estCab==="linea")    {cab.style.background="transparent";cab.style.borderBottom=`3px solid ${colorCab}`;}
      }
    }
    const pvC=g("ep_pv_concepto");const pvT=g("ep_pv_tipo");
    if(pvC){pvC.textContent=concepto;pvC.style.color=colorTxtC;}
    if(pvT){pvT.textContent=L.tipo;pvT.style.color=colorTxtC;}

    // Emisor/cliente
    const er=g("ep_pv_emisor_row");
    if(er) er.style.display=mostEmisor?"grid":"none";
    const eb=g("ep_pv_emisor_bloque");if(eb)eb.style.transform=`translate(${emisorX}px,${emisorY}px)`;
    const cb=g("ep_pv_cliente_bloque");if(cb)cb.style.transform=`translate(${clienteX}px,${clienteY}px)`;
    const s=(id,v)=>{const el=g(id);if(el)el.textContent=v;};
    s("ep_pv_lbl_de",L.de);s("ep_pv_lbl_para",L.para);

    // Tabla
    const th=g("ep_pv_tabla_head");if(th)th.style.background=colorAcc;
    s("ep_pv_h_desc",_idioma==="en"?"Description":"Descripción");
    s("ep_pv_h_cant",L.cant);s("ep_pv_h_precio",L.precio);s("ep_pv_h_iva",L.iva);s("ep_pv_h_total",L.total);

    const rows=document.querySelectorAll("#ep_lineasContainer .linea-row");
    const larr=[...rows].map(r=>({
      d:r.querySelector("[data-field='descripcion']")?.value||"",
      c:parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      p:parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      i:parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.d||l.p>0);

    const pvLin=g("ep_pv_lineas");
    if(pvLin){
      if(!larr.length){pvLin.innerHTML=`<div style="padding:12px 0;font-size:10px;color:#9ca3af;text-align:center">Sin líneas definidas</div>`;}
      else{pvLin.innerHTML=larr.map((l,ri)=>{
        const tot=l.c*l.p;
        const bg=ri%2===0?colorFdoT:"#fff";
        return `<div style="display:grid;grid-template-columns:1fr 40px 70px 40px 70px;padding:7px 0;background:${bg};border-bottom:1px solid ${colorLin};font-size:${tamF+2}px">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${l.d}</span>
          <span style="text-align:right">${l.c}</span>
          <span style="text-align:right">${l.p.toFixed(2)}€</span>
          <span style="text-align:right">${l.i}%</span>
          <span style="text-align:right;font-weight:700;font-family:monospace">${tot.toFixed(2)}€</span>
        </div>`;
      }).join("");}
    }

    const base=larr.reduce((a,l)=>a+l.c*l.p,0);
    const iva=larr.reduce((a,l)=>a+l.c*l.p*l.i/100,0);
    const pvTot=g("ep_pv_totales");
    if(pvTot)pvTot.innerHTML=`
      <table style="margin-left:auto;border-collapse:collapse;font-size:10px;min-width:160px">
        <tr><td style="color:#6b7280;padding:2px 12px 2px 0">${L.base}</td><td style="text-align:right;font-family:monospace;color:#374151">${base.toFixed(2)} €</td></tr>
        <tr><td style="color:#6b7280;padding:2px 12px 2px 0">IVA</td><td style="text-align:right;font-family:monospace;color:#374151">${iva.toFixed(2)} €</td></tr>
        <tr style="border-top:2px solid ${colorAcc}">
          <td style="font-weight:800;color:#111;padding:4px 12px 2px 0">${L.totalDoc}</td>
          <td style="text-align:right;font-family:monospace;font-weight:800;color:${colorAcc}">${(base+iva).toFixed(2)} €</td>
        </tr>
      </table>`;

    const dw=g("ep_pv_desc_wrap");const dd=g("ep_pv_desc");
    if(dw&&dd){dw.style.display=desc?"":"none";dd.textContent=desc;}
    const pvN=g("ep_pv_notas");if(pvN){pvN.textContent=notas;pvN.style.display=notas?"":"none";}
    const pvP=g("ep_pv_pie");const pvPT=g("ep_pv_pie_txt");
    if(pvP)pvP.style.display=mostPie?"flex":"none";
    if(pvPT)pvPT.textContent=pie||"Texto legal del pie";

    // Font preview
    const fp=g("ep_font_preview");
    if(fp){fp.style.fontFamily=FONT_MAP[fuente];fp.style.fontSize=(tamF+3)+"px";}
  }

  // Conectar TODOS los inputs, selects y checkboxes del formulario al preview
  document.querySelectorAll("#view-editar-plantilla input, #view-editar-plantilla select, #view-editar-plantilla textarea").forEach(el=>{
    if(el.id==="ep_logo_inp") return; // file input — no conectar
    el.addEventListener("input",  _epPv);
    el.addEventListener("change", _epPv);
  });
  _epPv();

  // Guardar
  const guardar = async () => {
    const nombre = document.getElementById("ep_nombre")?.value.trim();
    if (!nombre) { window._epTab("diseno"); alert("El nombre de la plantilla es obligatorio"); return; }

    const rows=document.querySelectorAll("#ep_lineasContainer .linea-row");
    const lineasArr=[...rows].map(r=>({
      descripcion:r.querySelector("[data-field='descripcion']")?.value||"",
      cantidad:parseFloat(r.querySelector("[data-field='cantidad']")?.value)||1,
      precio:parseFloat(r.querySelector("[data-field='precio']")?.value)||0,
      iva:parseInt(r.querySelector("[data-field='iva']")?.value)||21,
    })).filter(l=>l.descripcion||l.precio>0);

    const g=id=>document.getElementById(id)?.value?.trim()||null;
    const gb=id=>document.getElementById(id)?.checked||false;
    const gi=(id,d)=>parseInt(document.getElementById(id)?.value)||d;

    const payload={
      user_id:SESSION.user.id, nombre,
      concepto:g("ep_concepto"),descripcion:g("ep_descripcion"),notas:g("ep_notas"),
      texto_pie:g("ep_pie"),iban_visible:g("ep_iban"),idioma:_idioma,
      lineas:JSON.stringify(lineasArr),
      color_principal:g("ep_color_cab")||"#1a56db",
      color_cabecera:g("ep_color_cab")||"#1a56db",
      color_txt_cab:g("ep_color_txt_cab")||"#ffffff",
      color_acento:g("ep_color_acento")||"#1a56db",
      color_letra:g("ep_color_letra")||"#0f172a",
      color_fondo:g("ep_color_fondo")||"#ffffff",
      color_fondo_tab:g("ep_color_fondo_tab")||"#f8fafc",
      color_lineas:g("ep_color_lineas")||"#e2e8f0",
      fuente:g("ep_fuente")||"Helvetica",
      tam_fuente:gi("ep_tam_fuente",9),
      tamano_hoja:g("ep_tamano_hoja")||"A4",
      margen:gi("ep_margen",18),
      pie_altura:gi("ep_pie_altura",14),
      alin_texto:document.getElementById("ep_alin_val")?.value||"izq",
      estilo_cab:g("ep_estilo_cab")||"solido",
      mostrar_logo:gb("ep_mostrar_logo"),mostrar_cab:gb("ep_mostrar_cab"),
      mostrar_pie:gb("ep_mostrar_pie"),mostrar_emisor:gb("ep_mostrar_emisor"),
      mostrar_email:gb("ep_mostrar_email"),mostrar_num_pag:gb("ep_mostrar_num_pag"),
      cab_todas_pags:gb("ep_cab_todas_pags"),
      logo_b64:_logo||null,
      logo_x:gi("ep_logo_x",0),logo_y:gi("ep_logo_y",6),logo_size:gi("ep_logo_size",30),
      sp_cab:gi("ep_margen",12),sp_emisor:5,sp_entre_bloques:0,sp_tabla:6,sp_pie:5,
      emisor_x:gi("ep_emisor_x",0),emisor_y:gi("ep_emisor_y",0),
      cliente_x:gi("ep_cliente_x",0),cliente_y:gi("ep_cliente_y",0),
    };

    const btn=document.getElementById("epGuardarBtn");
    if(btn){btn.disabled=true;btn.textContent="Guardando…";}

    let err;
    if(isEdit){({error:err}=await supabase.from("plantillas_usuario").update(payload).eq("id",prefill.id));}
    else      {({error:err}=await supabase.from("plantillas_usuario").insert(payload));}

    if(btn){btn.disabled=false;btn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Guardar plantilla';}

    if(err){toast("Error: "+err.message,"error");return;}
    toast(isEdit?"Plantilla actualizada ✅":"Plantilla creada ✅","success");
    await refreshPlantillas();
    window._switchView?.("plantillas");
  };

  document.getElementById("epGuardarBtn")?.addEventListener("click", guardar);
  document.getElementById("epCancelarBtn")?.addEventListener("click", ()=>window._switchView?.("plantillas"));

  // Eliminar (si es edición)
  if (isEdit) {
    // Añadir botón eliminar en actions si no existe
    const actions = document.querySelector("#view-editar-plantilla .view-actions");
    const existingDel = document.getElementById("epEliminarBtn");
    if (actions && !existingDel) {
      const delBtn = document.createElement("button");
      delBtn.id = "epEliminarBtn";
      delBtn.className = "btn-outline";
      delBtn.style.cssText = "color:#dc2626;border-color:#dc2626";
      delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> Eliminar`;
      actions.insertBefore(delBtn, actions.firstChild);
      delBtn.addEventListener("click", async()=>{
        if(!confirm("¿Eliminar esta plantilla? No se puede deshacer."))return;
        await supabase.from("plantillas_usuario").delete().eq("id",prefill.id);
        toast("Plantilla eliminada","success");
        await refreshPlantillas();
        window._switchView?.("plantillas");
      });
    }
  } else {
    // Limpiar botón eliminar si existe de una edición anterior
    document.getElementById("epEliminarBtn")?.remove();
  }
};


export function getPlantillaData(plantillaId) {
  const p=PLANTILLAS.find(x=>x.id===plantillaId);
  if(!p)return null;
  return {concepto:p.concepto,descripcion:p.descripcion,notas:p.notas,lineas:p.lineas?JSON.parse(p.lineas):[],color_principal:p.color_cabecera||p.color_principal,texto_pie:p.texto_pie,iban_visible:p.iban_visible,logo_b64:p.logo_b64};
}

export function renderPlantillaSelector(containerId,onSelect) {
  const container=document.getElementById(containerId);
  if(!container||!PLANTILLAS.length)return;
  container.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
    <span style="font-size:11px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
    ${PLANTILLAS.map(p=>`<button class="btn-outline plt-selector-btn" data-plt-id="${p.id}" style="font-size:12px;padding:4px 12px">${p.nombre}</button>`).join("")}
    <button class="btn-outline plt-selector-btn" data-plt-id="" style="font-size:12px;padding:4px 12px;color:var(--t4)">✕ En blanco</button>
  </div>`;
  container.querySelectorAll(".plt-selector-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      container.querySelectorAll(".plt-selector-btn").forEach(b=>{b.style.background="";b.style.color="";b.style.borderColor="";});
      if(btn.dataset.pltId){btn.style.background="var(--accent)";btn.style.color="#fff";btn.style.borderColor="var(--accent)";}
      if(onSelect)onSelect(btn.dataset.pltId?getPlantillaData(btn.dataset.pltId):null);
    });
  });
}
export const renderSelectorPlantillas=renderPlantillaSelector;

window._nuevaPlantilla=()=>showPlantillaModal();
window._editPlantilla=id=>{const p=PLANTILLAS.find(x=>x.id===id);if(p)showPlantillaModal(p);};
window._delPlantilla=id=>{
  openModal(`<div class="modal" style="max-width:380px"><div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla? No se puede deshacer.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dpltOk").addEventListener("click",async()=>{await supabase.from("plantillas_usuario").delete().eq("id",id);closeModal();toast("Plantilla eliminada","success");await refreshPlantillas();});
};
window._usarPlantillaFactura=id=>{const data=getPlantillaData(id);if(!data)return;window._switchView?.("nueva-factura");setTimeout(()=>window._applyPlantillaToFactura?.(data),200);};
window._usarPlantillaPres=id=>{const data=getPlantillaData(id);if(!data)return;window._switchView?.("nuevo-presupuesto");setTimeout(()=>window._applyPlantillaToPresupuesto?.(data),200);};

export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click",()=>showPlantillaModal());
  refreshPlantillas();
}

// Alias para compatibilidad — showPlantillaModal ahora navega a la vista
export { showPlantillaModal as showPlantillaView };
