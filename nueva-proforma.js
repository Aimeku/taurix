/* ═══════════════════════════════════════════════════════
   TAURIX · nueva-proforma.js
   Formulario de creación / edición de proforma
   Misma arquitectura que nueva-factura.js / nuevo-presupuesto.js
   ─ Selector de plantilla con columnas dinámicas
   ─ Numeración PRF-YYYY-NNN independiente
   ─ Documento sin validez fiscal
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, toast, switchView, OP_INFO, OP_SIN_IVA, OP_IVA_NO_REPERCUTIDO } from "./utils.js";
import { PRODUCTOS } from "./productos.js";
import { refreshProforma } from "./proforma.js";

/* ── Estado ── */
let LINEAS        = [];
let lineaIdCnt    = 0;
let clienteSelId  = null;
let editandoId    = null;
let opTipo        = "nacional";

/* ══════════════════════════════════════════════════════
   COLUMNAS DINÁMICAS
══════════════════════════════════════════════════════ */
const _COL_SCHEMA = {
  descripcion: { label:"Descripción", fr:3.0, minW:120, align:"left",  inputType:"text",   field:"descripcion" },
  cantidad:    { label:"Cant.",       fr:0.7, minW:52,  align:"right", inputType:"number", field:"cantidad",   step:"0.01", min:"0.01" },
  precio:      { label:"P. unit.",    fr:1.0, minW:72,  align:"right", inputType:"number", field:"precio",     step:"0.01", placeholder:"0.00" },
  descuento:   { label:"Dto.",        fr:0.8, minW:60,  align:"right", inputType:"text",   field:"descuento",  placeholder:"10%/5e" },
  subtotal:    { label:"Subtotal",    fr:1.0, minW:72,  align:"right", inputType:null },
  codigo:      { label:"Código",      fr:0.7, minW:55,  align:"left",  inputType:"text",   field:"codigo" },
  coeficiente: { label:"Coef.",       fr:0.6, minW:50,  align:"right", inputType:"number", field:"coeficiente", step:"0.01" },
  iva:         { label:"IVA",         fr:0.6, minW:56,  align:"right", inputType:"select", field:"iva" },
  total:       { label:"Total",       fr:0.9, minW:68,  align:"right", inputType:null },
};
const _DEFAULT_COLS = ["descripcion","cantidad","precio","iva","total"];
let _cols = [..._DEFAULT_COLS];

function _gridStr() {
  return [..._cols.map(k => { const c=_COL_SCHEMA[k]; return c?`minmax(${c.minW}px,${c.fr}fr)`:"1fr"; }), "28px"].join(" ");
}
function _applyHeader() {
  const hdr = document.getElementById("npfLineasHeader");
  if (!hdr) return;
  hdr.style.gridTemplateColumns = _gridStr();
  hdr.innerHTML = _cols.map(k => {
    const c = _COL_SCHEMA[k];
    const r = c?.align === "right";
    return `<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;${r?"text-align:right":""};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${c?.label||k}</div>`;
  }).join("") + `<div></div>`;
}
function _applyRow(row) {
  row.style.display="grid"; row.style.gridTemplateColumns=_gridStr();
  row.style.gap="4px"; row.style.alignItems="center";
  row.style.padding="4px 0"; row.style.borderBottom="1px solid var(--brd)";
}

/* ── Totales ── */
function _parseDto(raw, sub) {
  if (!raw && raw!==0) return 0;
  const s=String(raw).trim(); if(!s) return 0;
  if(s.endsWith("%")) return sub*(parseFloat(s)||0)/100;
  return parseFloat(s)||0;
}
function _calcTotales() {
  let base=0; const ivaMap={};
  LINEAS.forEach(l=>{
    const bruto=(l.cantidad||0)*(l.precio||0);
    const sub=Math.max(0,bruto-_parseDto(l.descuento,bruto));
    base+=sub; ivaMap[l.iva]=(ivaMap[l.iva]||0)+sub*(l.iva||0)/100;
  });
  const ivaTot=Object.values(ivaMap).reduce((a,b)=>a+b,0);
  // Para inversión del sujeto pasivo: IVA calculado pero no sumado al total
  const ivaEnTotal = OP_IVA_NO_REPERCUTIDO.includes(opTipo) ? 0 : ivaTot;
  const total = base + ivaEnTotal;
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  s("npfBase",fmt(base)); s("npfIva",fmt(ivaTot)); s("npfTotal",fmt(total));
  // Ocultar fila IVA cuando la operación no repercute IVA
  const ivaRow=document.getElementById("npfIvaRow");
  if(ivaRow){
    const mostrarIva = !OP_SIN_IVA.includes(opTipo) || OP_IVA_NO_REPERCUTIDO.includes(opTipo);
    ivaRow.style.display = mostrarIva ? "" : "none";
  }
  return {base,ivaMap,ivaTot};
}

/* ── Tipo de operación ── */
function _updateOpUI() {
  const banner = document.getElementById("npfOpBanner");
  const exencionWrap = document.getElementById("npfExencionWrap");
  const nifNote = document.getElementById("npfNifNote");
  if (banner) {
    banner.textContent = OP_INFO[opTipo] || "";
    banner.classList.toggle("visible", !!OP_INFO[opTipo]);
  }
  if (exencionWrap) exencionWrap.style.display = opTipo === "exento" ? "" : "none";
  if (nifNote) nifNote.textContent = opTipo === "intracomunitaria" ? "(VAT número UE obligatorio)" : "";
}

/* ── Añadir línea ── */
function _addLinea(pf={}) {
  const id=++lineaIdCnt;
  const sinIva = OP_SIN_IVA.includes(opTipo);
  const l={id,descripcion:pf.descripcion||"",cantidad:pf.cantidad||1,precio:pf.precio||0,
           iva:sinIva ? 0 : (pf.iva!==undefined?pf.iva:21),descuento:pf.descuento??"",
           codigo:pf.codigo??"",coeficiente:pf.coeficiente??""};
  LINEAS.push(l);
  const cont=document.getElementById("npfLineasContainer"); if(!cont)return;
  const row=document.createElement("div");
  row.className="linea-row"; row.dataset.lineaId=id;
  row.innerHTML=_cols.map(k=>{
    const c=_COL_SCHEMA[k]; if(!c)return`<div></div>`;
    const a=c.align==="right"?"text-align:right":"";
    const bs=`width:100%;box-sizing:border-box;${a}`;
    if(k==="total") return`<div id="npfLt${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
    if(k==="subtotal") return`<div style="font-size:12px;text-align:right;font-family:monospace;color:var(--t2)">0,00 €</div>`;
    if(k==="iva") return`<select class="ff-select" data-field="iva" style="${bs}" ${sinIva?"disabled":""}>
      <option value="21" ${l.iva===21?"selected":""}>21%</option>
      <option value="10" ${l.iva===10?"selected":""}>10%</option>
      <option value="4"  ${l.iva===4?"selected":""}>4%</option>
      <option value="0"  ${l.iva===0?"selected":""}>0%</option></select>`;
    const v=l[k]!==undefined?l[k]:"";
    const ex=[c.step?`step="${c.step}"`:"",c.min?`min="${c.min}"`:"",c.placeholder?`placeholder="${c.placeholder}"`:""].filter(Boolean).join(" ");
    return`<input autocomplete="off" type="${c.inputType||"text"}" class="ff-input" data-field="${k}" value="${v}" ${ex} style="${bs}"/>`;
  }).join("")+`<button class="linea-del" onclick="window._npfDelLinea(${id})" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  _applyRow(row);
  row.querySelectorAll("input,select").forEach(el=>{
    el.addEventListener("input",()=>_onChange(id,el));
    el.addEventListener("change",()=>_onChange(id,el));
  });
  const di=row.querySelector("[data-field='descripcion']");
  if(di) _buildProdDropdown(di, (p) => {
    const lx=LINEAS.find(x=>x.id===id);
    if(lx){lx.descripcion=p.descripcion||p.nombre;lx.precio=p.precio;lx.iva=p.iva;}
    const f=(field,val)=>{const el=row.querySelector(`[data-field="${field}"]`);if(el)el.value=val;};
    f("descripcion",p.descripcion||p.nombre);f("precio",p.precio);f("iva",p.iva);
    const tot=document.getElementById(`npfLt${id}`);
    if(tot)tot.textContent=fmt((lx?.cantidad||1)*p.precio);
    _calcTotales();
  });
  cont.appendChild(row); _calcTotales();
}

/* ══════════════════════════════════════════════════════
   DROPDOWN CATÁLOGO DE PRODUCTOS
   Réplica exacta de nueva-factura.js — mismas clases CSS,
   mismos campos buscados, mismo comportamiento al focus.
══════════════════════════════════════════════════════ */
function _buildProdDropdown(descInput, onSelect) {
  if (!descInput) return;

  const dd = document.createElement("div");
  dd.className = "csc-dropdown";
  dd.style.cssText = "display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:300;min-width:280px";
  descInput.parentElement.style.position = "relative";
  descInput.parentElement.appendChild(dd);

  const _render = (lista) => {
    if (!lista.length) {
      dd.innerHTML = `<div class="csd-empty">Sin productos en el catálogo</div>`;
      dd.style.display = "";
      return;
    }
    dd.innerHTML = lista.map(p => {
      const stockBadge = p.tipo !== "servicio" && p.stock_actual != null
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:5px;font-weight:700;margin-left:6px;background:${p.stock_actual>0?"#dcfce7":"#fee2e2"};color:${p.stock_actual>0?"#166534":"#991b1b"}">Stock: ${p.stock_actual}</span>`
        : "";
      return `<div class="csd-item" data-pid="${p.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div class="csd-name">${p.nombre}${stockBadge}</div>
            ${p.descripcion ? `<div class="csd-meta">${p.descripcion}</div>` : ""}
            ${p.referencia  ? `<div class="csd-meta" style="font-family:monospace">Ref: ${p.referencia}</div>` : ""}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio)}</div>
            <div class="csd-meta">IVA ${p.iva}%</div>
          </div>
        </div>
      </div>`;
    }).join("");
    dd.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        const p = PRODUCTOS.find(x => x.id === item.dataset.pid);
        if (p && onSelect) onSelect(p);
        dd.style.display = "none";
      });
    });
    dd.style.display = "";
  };

  // Focus: muestra todo el catálogo (igual que nueva-factura)
  descInput.addEventListener("focus", () => {
    if (!PRODUCTOS?.length) return;
    _render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 12));
  });

  // Input: filtra por nombre, descripcion y referencia
  descInput.addEventListener("input", () => {
    if (!PRODUCTOS?.length) return;
    const q = descInput.value.toLowerCase().trim();
    if (!q) {
      _render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 12));
      return;
    }
    const m = PRODUCTOS.filter(p =>
      p.activo !== false && (
        p.nombre.toLowerCase().includes(q) ||
        (p.descripcion || "").toLowerCase().includes(q) ||
        (p.referencia  || "").toLowerCase().includes(q)
      )
    ).slice(0, 10);
    if (!m.length) {
      dd.innerHTML = `<div class="csd-empty">Sin resultados para "${q}"</div>`;
      dd.style.display = "";
      return;
    }
    _render(m);
  });

  descInput.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; }, 200));
}

function _onChange(id,el){
  const l=LINEAS.find(x=>x.id===id); if(!l)return;
  const f=el.dataset.field;
  if(f==="descripcion")l.descripcion=el.value;
  else if(f==="cantidad")l.cantidad=parseFloat(el.value)||0;
  else if(f==="precio")l.precio=parseFloat(el.value)||0;
  else if(f==="iva")l.iva=parseInt(el.value)||0;
  else if(f==="descuento")l.descuento=el.value;
  else if(f==="codigo")l.codigo=el.value;
  else if(f==="coeficiente")l.coeficiente=el.value;
  const bruto=(l.cantidad||0)*(l.precio||0);
  const sub=Math.max(0,bruto-_parseDto(l.descuento,bruto));
  const tot=document.getElementById(`npfLt${id}`);
  if(tot)tot.textContent=fmt(sub);
  _calcTotales();
}

window._npfDelLinea=id=>{
  LINEAS=LINEAS.filter(l=>l.id!==id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  _calcTotales();
};

function _rebuildLineas(){
  const c=document.getElementById("npfLineasContainer"); if(!c)return;
  const snaps=LINEAS.map(l=>({...l}));
  c.innerHTML=""; LINEAS=[]; lineaIdCnt=0;
  snaps.forEach(s=>_addLinea(s));
}

/* ══════════════════════════════════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════════════════════════════════ */
async function _initPlantillaSel(){
  const sel=document.getElementById("npfPlantillaSel");
  const badge=document.getElementById("npfPlantillaBadge");
  if(!sel)return;
  sel.innerHTML=`<option value="">Cargando...</option>`; sel.disabled=true;
  let plantillas=[];
  try{
    const{data}=await supabase.from("plantillas_usuario").select("id,nombre,es_default,cols_activas")
      .eq("user_id",SESSION.user.id).order("nombre");
    plantillas=data||[];
  }catch(e){console.warn("plantillas:",e.message);}
  sel.disabled=false;
  if(!plantillas.length){sel.innerHTML=`<option value="">— Sin plantillas —</option>`;return;}
  const defP=plantillas.find(p=>p.es_default)||null;
  sel.innerHTML=[`<option value="">— Sin plantilla —</option>`,
    ...plantillas.map(p=>`<option value="${p.id}" ${defP?.id===p.id?"selected":""}>${p.nombre}${p.es_default?" ⭐":""}</option>`)
  ].join("");
  const updBadge=id=>{if(badge){const p=plantillas.find(x=>x.id===id);badge.style.display=p?.es_default?"inline":"none";}};
  const apply=p=>{
    if(!p){_cols=[..._DEFAULT_COLS];_applyHeader();_rebuildLineas();return;}
    let cols=[];
    try{const raw=p.cols_activas?(typeof p.cols_activas==="string"?JSON.parse(p.cols_activas):p.cols_activas):null;
      if(Array.isArray(raw))cols=raw.map(c=>typeof c==="object"?c.key:c).filter(k=>_COL_SCHEMA[k]);}catch(e){}
    _cols=cols.length?cols:[..._DEFAULT_COLS];
    if(!_cols.includes("descripcion"))_cols.unshift("descripcion");
    _applyHeader(); _rebuildLineas();
  };
  if(defP){updBadge(defP.id);apply(plantillas.find(p=>p.id===defP.id));}
  sel.addEventListener("change",()=>{
    const id=sel.value; updBadge(id);
    apply(id?plantillas.find(p=>p.id===id):null);
  });
}

/* ══════════════════════════════════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════════════════════════════════ */
function _initClienteSearch(){
  const inp=document.getElementById("npfClienteSearch");
  const dd=document.getElementById("npfClienteDropdown");
  const lmp=document.getElementById("npfClienteLimpiar");
  if(!inp)return;
  inp.addEventListener("input",()=>{
    const q=inp.value.toLowerCase();
    if(q.length<2){dd.style.display="none";return;}
    const hits=CLIENTES.filter(c=>(c.nombre||"").toLowerCase().includes(q)||(c.nif||"").toLowerCase().includes(q)).slice(0,8);
    dd.innerHTML=hits.length
      ?hits.map(c=>`<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif||""}</div></div>`).join("")
      :`<div class="csd-empty">Sin resultados</div>`;
    dd.querySelectorAll(".csd-item").forEach(item=>item.addEventListener("mousedown",e=>{
      e.preventDefault();
      const c=CLIENTES.find(x=>x.id===item.dataset.id); if(!c)return;
      clienteSelId=c.id; inp.value=c.nombre; if(lmp)lmp.style.display="";
      const f=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||"";};
      f("npfClienteNombre",c.nombre);
      f("npfClienteNif",c.nif);
      f("npfClienteEmail",c.email);
      f("npfClienteTel",c.telefono);
      f("npfClienteDireccion",c.direccion);
      f("npfClienteCiudad",c.ciudad);
      f("npfClienteProvincia",c.provincia);
      f("npfClienteCp",c.codigo_postal);
      f("npfClienteNombreComercial",c.nombre_comercial);
      if(c.pais){const ps=document.getElementById("npfClientePais");if(ps)ps.value=c.pais;}
      if(c.tipo){const tp=document.getElementById("npfClienteTipo");if(tp)tp.value=c.tipo;}
      document.getElementById("npfClientePanel")?.classList.add("cliente-panel--filled");
      dd.style.display="none";
    }));
    dd.style.display="";
  });
  inp.addEventListener("blur",()=>setTimeout(()=>{dd.style.display="none";},200));
  lmp?.addEventListener("click",()=>{
    clienteSelId=null;inp.value="";lmp.style.display="none";
    ["npfClienteNombre","npfClienteNif","npfClienteEmail","npfClienteTel",
     "npfClienteDireccion","npfClienteCiudad","npfClienteProvincia","npfClienteCp","npfClienteNombreComercial"].forEach(id=>{
      const el=document.getElementById(id);if(el)el.value="";
    });
    const ps=document.getElementById("npfClientePais");if(ps)ps.value="ES";
    const tp=document.getElementById("npfClienteTipo");if(tp)tp.value="empresa";
    document.getElementById("npfClientePanel")?.classList.remove("cliente-panel--filled");
  });
}

/* ══════════════════════════════════════════════════════
   NUMERACIÓN
══════════════════════════════════════════════════════ */
async function _getNextNumero(){
  const year=new Date().getFullYear();
  const{data:last}=await supabase.from("proformas").select("numero").eq("user_id",SESSION.user.id)
    .like("numero",`PRF-${year}-%`).order("numero",{ascending:false}).limit(1);
  const n=last?.[0]?.numero?parseInt((last[0].numero.match(/-(\d+)$/)||[])[1])||0:0;
  return`PRF-${year}-${String(n+1).padStart(3,"0")}`;
}

/* ══════════════════════════════════════════════════════
   GUARDAR
══════════════════════════════════════════════════════ */
async function _save(){
  const concepto=document.getElementById("npfConcepto")?.value.trim();
  const fecha=document.getElementById("npfFecha")?.value;
  if(!concepto||!fecha){toast("Concepto y fecha son obligatorios","error");return;}
  if(!LINEAS.length||LINEAS.every(l=>!l.precio||l.precio<=0)){toast("Añade al menos una línea con precio","error");return;}

  const btn=document.getElementById("npfGuardarBtn");
  if(btn){btn.disabled=true;btn.innerHTML=`<span class="spin"></span> Guardando...`;}

  const{base,ivaMap}=_calcTotales();
  const ivaMain=parseInt(Object.entries(ivaMap).sort(([,a],[,b])=>b-a)[0]?.[0]||21);

  let cId=clienteSelId;
  if(!cId&&document.getElementById("npfGuardarCliente")?.checked){
    const nombre=document.getElementById("npfClienteNombre")?.value.trim();
    if(nombre){
      const{data:nc}=await supabase.from("clientes").insert({
        user_id:SESSION.user.id, nombre,
        nif:document.getElementById("npfClienteNif")?.value.trim()||null,
        email:document.getElementById("npfClienteEmail")?.value.trim()||null,
        telefono:document.getElementById("npfClienteTel")?.value.trim()||null,
        direccion:document.getElementById("npfClienteDireccion")?.value.trim()||null,
        ciudad:document.getElementById("npfClienteCiudad")?.value.trim()||null,
        provincia:document.getElementById("npfClienteProvincia")?.value.trim()||null,
        codigo_postal:document.getElementById("npfClienteCp")?.value.trim()||null,
        nombre_comercial:document.getElementById("npfClienteNombreComercial")?.value.trim()||null,
        pais:document.getElementById("npfClientePais")?.value||"ES",
        tipo:document.getElementById("npfClienteTipo")?.value||"empresa",
      }).select().single();
      if(nc)cId=nc.id;
    }
  }

  const numero=editandoId
    ?document.getElementById("npfNumeroDisplay")?.textContent||""
    :await _getNextNumero();

  const payload={
    user_id:SESSION.user.id,numero,concepto,fecha,
    fecha_validez:document.getElementById("npfValidez")?.value||null,
    estado:document.getElementById("npfEstado")?.value||"borrador",
    cliente_id:cId||null,
    cliente_nombre:document.getElementById("npfClienteNombre")?.value.trim()||null,
    cliente_nif:document.getElementById("npfClienteNif")?.value.trim()||null,
    cliente_email:document.getElementById("npfClienteEmail")?.value.trim()||null,
    cliente_direccion:document.getElementById("npfClienteDireccion")?.value.trim()||null,
    cliente_pais:document.getElementById("npfClientePais")?.value||"ES",
    base,iva:ivaMain,
    tipo_operacion: opTipo,
    lineas:JSON.stringify(LINEAS.map(l=>({descripcion:l.descripcion,cantidad:l.cantidad,precio:l.precio,
      iva:l.iva,descuento:l.descuento??"",codigo:l.codigo??"",coeficiente:l.coeficiente??""}))),
    notas: (() => {
      const motivoExencion = document.getElementById("npfMotivoExencion")?.value.trim();
      const notasVal = document.getElementById("npfNotas")?.value.trim() || null;
      if (opTipo === "exento" && motivoExencion) {
        return notasVal ? notasVal + "\n\nMotivo de exención: " + motivoExencion : "Motivo de exención: " + motivoExencion;
      }
      return notasVal;
    })(),
  };

  let err;
  if(editandoId){({error:err}=await supabase.from("proformas").update(payload).eq("id",editandoId));}
  else{({error:err}=await supabase.from("proformas").insert(payload));}

  if(err){toast("Error: "+err.message,"error");if(btn){btn.disabled=false;btn.textContent=editandoId?"Actualizar proforma":"Guardar proforma";}return;}

  toast(editandoId?"Proforma actualizada":`Proforma ${numero} creada`,"success");
  _resetForm(); await refreshProforma(); switchView("proformas");
}

/* ══════════════════════════════════════════════════════
   CARGAR PARA EDITAR (llamado desde proforma.js)
══════════════════════════════════════════════════════ */
export async function cargarProformaParaEditar(id){
  const{data:p}=await supabase.from("proformas").select("*").eq("id",id).single();
  if(!p){toast("Proforma no encontrada","error");return;}
  editandoId=id; _resetForm(false);
  const numEl=document.getElementById("npfNumeroDisplay"); if(numEl)numEl.textContent=p.numero;
  const titEl=document.getElementById("npfTitulo"); if(titEl)titEl.textContent=`Editar ${p.numero}`;
  const btnEl=document.getElementById("npfGuardarBtn"); if(btnEl)btnEl.textContent="Actualizar proforma";
  const f=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||"";};
  f("npfConcepto",p.concepto);f("npfFecha",p.fecha);f("npfValidez",p.fecha_validez||"");
  f("npfEstado",p.estado||"borrador");f("npfClienteNombre",p.cliente_nombre||"");
  f("npfClienteNif",p.cliente_nif||"");f("npfClienteEmail",p.cliente_email||"");
  f("npfClienteDireccion",p.cliente_direccion||"");
  if(p.cliente_pais){const ps=document.getElementById("npfClientePais");if(ps)ps.value=p.cliente_pais;}
  f("npfNotas",p.notas||"");
  // Restaurar tipo de operación
  opTipo = p.tipo_operacion || "nacional";
  document.querySelectorAll(".npf-op-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.op === opTipo);
  });
  _updateOpUI();
  const sel=document.getElementById("npfPlantillaSel"); if(sel)sel.value="";
  const lineas=p.lineas?(typeof p.lineas==="string"?JSON.parse(p.lineas):p.lineas):[];
  lineas.forEach(l=>_addLinea(l)); _calcTotales();
  switchView("nueva-proforma");
}

/* ── Reset ── */
function _resetForm(clearEditing=true){
  if(clearEditing)editandoId=null;
  clienteSelId=null; LINEAS=[]; lineaIdCnt=0;
  const c=document.getElementById("npfLineasContainer"); if(c)c.innerHTML="";
  ["npfClienteNombre","npfClienteNif","npfClienteEmail","npfClienteTel","npfClienteDireccion",
   "npfClienteCiudad","npfClienteProvincia","npfClienteCp","npfClienteNombreComercial",
   "npfConcepto","npfValidez","npfNotas","npfMotivoExencion"].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value="";
  });
  const ps=document.getElementById("npfClientePais");if(ps)ps.value="ES";
  const tp=document.getElementById("npfClienteTipo");if(tp)tp.value="empresa";
  document.getElementById("npfClientePanel")?.classList.remove("cliente-panel--filled");
  const fe=document.getElementById("npfFecha");if(fe)fe.value=new Date().toISOString().slice(0,10);
  const ee=document.getElementById("npfEstado");if(ee)ee.value="borrador";
  const ci=document.getElementById("npfClienteSearch");if(ci)ci.value="";
  const lm=document.getElementById("npfClienteLimpiar");if(lm)lm.style.display="none";
  const ti=document.getElementById("npfTitulo");if(ti)ti.textContent="Nueva factura proforma";
  const bt=document.getElementById("npfGuardarBtn");if(bt){bt.disabled=false;bt.textContent="Guardar proforma";}
  const nd=document.getElementById("npfNumeroDisplay");if(nd)nd.textContent="";
  opTipo="nacional";
  document.querySelectorAll(".npf-op-btn").forEach(b=>b.classList.toggle("active",b.dataset.op==="nacional"));
  _updateOpUI();
  _cols=[..._DEFAULT_COLS]; _applyHeader(); _addLinea(); _calcTotales();
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
export function initNuevaProforma(){
  const fe=document.getElementById("npfFecha");
  if(fe&&!fe.value)fe.value=new Date().toISOString().slice(0,10);
  _initClienteSearch();
  _initPlantillaSel();
  document.getElementById("npfAddLineaBtn")?.addEventListener("click",()=>_addLinea());
  document.getElementById("npfGuardarBtn")?.addEventListener("click",()=>_save());
  document.getElementById("npfCancelarBtn")?.addEventListener("click",()=>{_resetForm();switchView("proformas");});

  // Tipo de operación
  document.querySelectorAll(".npf-op-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".npf-op-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      opTipo = btn.dataset.op;
      _updateOpUI();
      const sinIva = OP_SIN_IVA.includes(opTipo);
      if (sinIva) {
        LINEAS.forEach(l => { l.iva = 0; });
        document.querySelectorAll("#npfLineasContainer [data-field='iva']").forEach(sel => { sel.value = "0"; sel.disabled = true; });
      } else {
        document.querySelectorAll("#npfLineasContainer [data-field='iva']").forEach(sel => { sel.disabled = false; });
      }
      _calcTotales();
    });
  });
  _updateOpUI();

  if(LINEAS.length===0)_addLinea();
  _applyHeader(); _calcTotales();
}
