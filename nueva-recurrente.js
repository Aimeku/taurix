/* ═══════════════════════════════════════════════════════
   TAURIX · nueva-recurrente.js
   Vista completa de creación / edición de factura recurrente.
   Misma arquitectura que nueva-factura.js.
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, toast, switchView,
  OP_INFO, OP_SIN_IVA, OP_IVA_NO_REPERCUTIDO
} from "./utils.js";
import { PRODUCTOS, refreshProductos } from "./productos.js";
import { refreshRecurrentes } from "./facturas-recurrentes.js";

/* ── Estado ── */
let LINEAS       = [];
let lineaIdCnt   = 0;
let clienteSelId = null;
let editandoId   = null;
let opTipo       = "nacional";
/* ── Descuento global sobre subtotal ── */
let _dtoGlobal = { tipo: "pct", valor: 0 };
let _initDone    = false;

/* ══════════════════════════════════════════════════════
   COLUMNAS
══════════════════════════════════════════════════════ */
const _COL_SCHEMA = {
  descripcion: { label:"Descripción", fr:3.0, minW:120, align:"left",  inputType:"text",   field:"descripcion" },
  cantidad:    { label:"Cant.",       fr:0.7, minW:52,  align:"right", inputType:"number", field:"cantidad",   step:"0.01", min:"0.01" },
  precio:      { label:"Subtotal",    fr:1.0, minW:72,  align:"right", inputType:"number", field:"precio",     step:"0.01", placeholder:"0.00" },
  descuento:   { label:"Dto.",        fr:0.8, minW:60,  align:"right", inputType:"text",   field:"descuento",  placeholder:"10%/5€" },
  iva:         { label:"IVA",         fr:0.6, minW:56,  align:"right", inputType:"select", field:"iva" },
  total:       { label:"Total",       fr:0.9, minW:68,  align:"right", inputType:null },
};
const _DEFAULT_COLS = ["descripcion","cantidad","precio","iva","total"];
let _cols = [..._DEFAULT_COLS];

function _gridStr() {
  return [..._cols.map(k => { const c=_COL_SCHEMA[k]; return c?`minmax(${c.minW}px,${c.fr}fr)`:"1fr"; }), "28px"].join(" ");
}
function _applyHeader() {
  const hdr = document.getElementById("nrLineasHeader");
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

/* ══════════════════════════════════════════════════════
   TOTALES
══════════════════════════════════════════════════════ */
function _parseDto(raw, sub) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim(); if (!s) return 0;
  if (s.endsWith("%")) return sub * (parseFloat(s) || 0) / 100;
  return parseFloat(s) || 0;
}

function _calcTotales() {
  const toggle  = document.getElementById("nrIrpfToggle");
  const irpfPct = toggle?.checked ? (parseInt(document.getElementById("nrIrpf")?.value) || 0) : 0;
  let baseSinDto = 0; const ivaMap = {};
  LINEAS.forEach(l => {
    const bruto = (l.cantidad||0) * (l.precio||0);
    const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
    baseSinDto += sub;
  });
  // Descuento global
  let dtoGlobalAmt = 0;
  if (_dtoGlobal.valor > 0) {
    dtoGlobalAmt = _dtoGlobal.tipo === "pct"
      ? baseSinDto * _dtoGlobal.valor / 100
      : Math.min(_dtoGlobal.valor, baseSinDto);
    dtoGlobalAmt = Math.max(0, dtoGlobalAmt);
  }
  const base   = Math.max(0, baseSinDto - dtoGlobalAmt);
  const ratio  = baseSinDto > 0 ? base / baseSinDto : 0;
  LINEAS.forEach(l => {
    const bruto = (l.cantidad||0) * (l.precio||0);
    const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + sub * ratio * (l.iva||0) / 100;
  });
  const ivaTot    = Object.values(ivaMap).reduce((a,b) => a+b, 0);
  const ivaEnTot  = OP_IVA_NO_REPERCUTIDO.includes(opTipo) ? 0 : ivaTot;
  const irpfAmt   = base * irpfPct / 100;
  const total     = base + ivaEnTot - irpfAmt;

  const s = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("nrBase",    fmt(base));
  s("nrIva",     fmt(ivaTot));
  s("nrIrpfAmt", fmt(irpfAmt));
  s("nrIrpfLbl", `IRPF (−${irpfPct}%)`);
  s("nrTotal",   fmt(total));

  // Fila dto global
  const dtoRow = document.getElementById("nrDtoGlobalRow");
  if (dtoRow) {
    if (dtoGlobalAmt > 0) {
      dtoRow.style.display = "";
      const lbl = document.getElementById("nrDtoGlobalLbl");
      const val = document.getElementById("nrDtoGlobalVal");
      if (lbl) lbl.textContent = _dtoGlobal.tipo === "pct" ? `Dto. global (−${_dtoGlobal.valor}%)` : "Dto. global";
      if (val) val.textContent = `−${fmt(dtoGlobalAmt)}`;
    } else { dtoRow.style.display = "none"; }
  }

  // IVA row visibility
  const ivaRow = document.getElementById("nrIvaRow");
  if (ivaRow) {
    const mostrar = !OP_SIN_IVA.includes(opTipo) || OP_IVA_NO_REPERCUTIDO.includes(opTipo);
    ivaRow.style.display = mostrar ? "" : "none";
  }
  // IRPF row visibility
  const irpfRow = document.getElementById("nrIrpfRow");
  if (irpfRow) irpfRow.style.display = irpfPct > 0 ? "" : "none";

  // Estimación anual
  const freq  = document.getElementById("nrFrecuencia")?.value || "mensual";
  const mult  = { mensual:12, bimestral:6, trimestral:4, semestral:2, anual:1 }[freq] || 12;
  s("nrAnualEstim", total > 0 ? `≈ ${fmt(total * mult)} / año estimado` : "");

  return { base, ivaMap, ivaTot, irpfPct, irpfAmt, total, dtoGlobalAmt };
}

/* ══════════════════════════════════════════════════════
   TIPO DE OPERACIÓN
══════════════════════════════════════════════════════ */
function _updateOpUI() {
  const banner       = document.getElementById("nrOpBanner");
  const exencionWrap = document.getElementById("nrExencionWrap");
  const nifNote      = document.getElementById("nrNifNote");
  if (banner) {
    banner.textContent = OP_INFO[opTipo] || "";
    banner.classList.toggle("visible", !!OP_INFO[opTipo]);
  }
  if (exencionWrap) exencionWrap.style.display = opTipo === "exento" ? "" : "none";
  if (nifNote) nifNote.textContent = opTipo === "intracomunitaria" ? "(VAT número UE obligatorio)" : "";
}

/* ══════════════════════════════════════════════════════
   AÑADIR LÍNEA
══════════════════════════════════════════════════════ */
function _addLinea(pf = {}) {
  const id  = ++lineaIdCnt;
  const sinIva = OP_SIN_IVA.includes(opTipo);
  const l = {
    id,
    descripcion: pf.descripcion || "",
    cantidad:    pf.cantidad    || 1,
    precio:      pf.precio      || 0,
    iva:         sinIva ? 0 : (pf.iva !== undefined ? pf.iva : 21),
    descuento:   pf.descuento   ?? "",
  };
  LINEAS.push(l);
  const cont = document.getElementById("nrLineasContainer"); if (!cont) return;
  const row  = document.createElement("div");
  row.className = "linea-row"; row.dataset.lineaId = id;
  row.innerHTML = _cols.map(k => {
    const c  = _COL_SCHEMA[k]; if (!c) return `<div></div>`;
    const a  = c.align === "right" ? "text-align:right" : "";
    const bs = `width:100%;box-sizing:border-box;${a}`;
    if (k === "total")    return `<div id="nrLt${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
    if (k === "subtotal") return `<div style="font-size:12px;text-align:right;font-family:monospace;color:var(--t2)">0,00 €</div>`;
    if (k === "iva") return `<select class="ff-select" data-field="iva" style="${bs}" ${sinIva ? "disabled" : ""}>
      <option value="21" ${l.iva===21?"selected":""}>21%</option>
      <option value="10" ${l.iva===10?"selected":""}>10%</option>
      <option value="4"  ${l.iva===4 ?"selected":""}>4%</option>
      <option value="0"  ${l.iva===0 ?"selected":""}>0%</option></select>`;
    const v  = l[k] !== undefined ? l[k] : "";
    const ex = [c.step?`step="${c.step}"`:"", c.min?`min="${c.min}"`:"", c.placeholder?`placeholder="${c.placeholder}"`:""].filter(Boolean).join(" ");
    return `<input autocomplete="off" type="${c.inputType||"text"}" class="ff-input" data-field="${k}" value="${v}" ${ex} style="${bs}"/>`;
  }).join("") + `<button class="linea-del" onclick="window._nrDelLinea(${id})" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  _applyRow(row);
  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => _onChange(id, el));
    el.addEventListener("change", () => _onChange(id, el));
  });
  // Dropdown catálogo
  const di = row.querySelector("[data-field='descripcion']");
  if (di) _buildProdDropdown(di, p => {
    const lx = LINEAS.find(x => x.id === id);
    if (lx) { lx.descripcion = p.descripcion||p.nombre; lx.precio = p.precio_venta; lx.iva = sinIva ? 0 : p.iva; lx.producto_id = p.id; }
    const f = (field, val) => { const el=row.querySelector(`[data-field="${field}"]`); if(el) el.value=val; };
    f("descripcion", p.descripcion||p.nombre); f("precio", p.precio_venta); if (!sinIva) f("iva", p.iva);
    const tot = document.getElementById(`nrLt${id}`);
    if (tot) tot.textContent = fmt((lx?.cantidad||1) * p.precio_venta);
    _calcTotales();
    _actualizarVisibilidadReducirStock("nrReducirStockWrap");
  });
  cont.appendChild(row); _calcTotales(); _actualizarVisibilidadReducirStock("nrReducirStockWrap");
}

function _onChange(id, el) {
  const l = LINEAS.find(x => x.id === id); if (!l) return;
  const f = el.dataset.field;
  if      (f === "descripcion") l.descripcion = el.value;
  else if (f === "cantidad")    l.cantidad    = parseFloat(el.value) || 0;
  else if (f === "precio")      l.precio      = parseFloat(el.value) || 0;
  else if (f === "iva")         l.iva         = parseInt(el.value)   || 0;
  else if (f === "descuento")   l.descuento   = el.value;
  const bruto = (l.cantidad||0) * (l.precio||0);
  const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
  const tot   = document.getElementById(`nrLt${id}`);
  if (tot) tot.textContent = fmt(sub);
  const rowSub = document.querySelector(`.linea-row[data-linea-id="${id}"] [data-subtotal="${id}"]`);
  if (rowSub) rowSub.textContent = fmt(bruto);
  _calcTotales();
}

window._nrDelLinea = id => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  _calcTotales();
};

/* ══════════════════════════════════════════════════════
   DROPDOWN CATÁLOGO
══════════════════════════════════════════════════════ */
function _buildProdDropdown(descInput, onSelect) {
  if (!descInput) return;
  const dd = document.createElement("div");
  dd.className = "csc-dropdown";
  dd.style.cssText = "display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:300;min-width:280px";
  descInput.parentElement.style.position = "relative";
  descInput.parentElement.appendChild(dd);
  const _render = lista => {
    if (!lista.length) { dd.innerHTML=`<div class="csd-empty">Sin productos en el catálogo</div>`; dd.style.display=""; return; }
    dd.innerHTML = lista.map(p => `<div class="csd-item" data-pid="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div class="csd-name">${p.nombre}</div>
          ${p.descripcion?`<div class="csd-meta">${p.descripcion}</div>`:""}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio_venta)}</div>
          <div class="csd-meta">IVA ${p.iva}%</div>
        </div>
      </div></div>`).join("");
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
  descInput.addEventListener("focus", () => { if (PRODUCTOS?.length) _render(PRODUCTOS.filter(p=>p.activo!==false).slice(0,12)); });
  descInput.addEventListener("input", () => {
    if (!PRODUCTOS?.length) return;
    const q = descInput.value.toLowerCase().trim();
    if (!q) { _render(PRODUCTOS.filter(p=>p.activo!==false).slice(0,12)); return; }
    const m = PRODUCTOS.filter(p => p.activo!==false && (p.nombre.toLowerCase().includes(q)||(p.descripcion||"").toLowerCase().includes(q))).slice(0,10);
    if (!m.length) { dd.innerHTML=`<div class="csd-empty">Sin resultados para "${q}"</div>`; dd.style.display=""; return; }
    _render(m);
  });
  descInput.addEventListener("blur", () => setTimeout(() => { dd.style.display="none"; }, 200));
}

/* ══════════════════════════════════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════════════════════════════════ */
function _initClienteSearch() {
  const inp = document.getElementById("nrClienteSearch");
  const dd  = document.getElementById("nrClienteDropdown");
  const lmp = document.getElementById("nrClienteLimpiar");
  if (!inp) return;
  inp.addEventListener("input", () => {
    const q = inp.value.toLowerCase();
    if (q.length < 2) { dd.style.display="none"; return; }
    const hits = CLIENTES.filter(c => (c.nombre||"").toLowerCase().includes(q) || (c.nif||"").toLowerCase().includes(q)).slice(0,8);
    dd.innerHTML = hits.length
      ? hits.map(c=>`<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif||""}${c.email?" · "+c.email:""}</div></div>`).join("")
      : `<div class="csd-empty">Sin resultados · Se creará como cliente nuevo</div>`;
    dd.querySelectorAll(".csd-item").forEach(item => item.addEventListener("mousedown", e => {
      e.preventDefault();
      const c = CLIENTES.find(x => x.id === item.dataset.id); if (!c) return;
      clienteSelId = c.id; inp.value = c.nombre; if (lmp) lmp.style.display = "";
      const f = (id, v) => { const el=document.getElementById(id); if(el) el.value=v||""; };
      f("nrClienteNombre",          c.nombre);
      f("nrClienteNombreComercial", c.nombre_comercial);
      f("nrClienteNif",             c.nif);
      f("nrClienteEmail",           c.email);
      f("nrClienteTel",             c.telefono);
      f("nrClienteDireccion",       c.direccion);
      f("nrClienteCiudad",          c.ciudad);
      f("nrClienteProvincia",       c.provincia);
      f("nrClienteCp",              c.codigo_postal);
      if (c.pais) { const el=document.getElementById("nrClientePais"); if(el) el.value=c.pais; }
      if (c.tipo) { const el=document.getElementById("nrClienteTipo"); if(el) el.value=c.tipo; }
      document.getElementById("nrClientePanel")?.classList.add("cliente-panel--filled");
      dd.style.display = "none";
    }));
    dd.style.display = "";
  });
  inp.addEventListener("blur", () => setTimeout(() => { dd.style.display="none"; }, 200));
  lmp?.addEventListener("click", () => {
    clienteSelId=null; inp.value=""; lmp.style.display="none";
    ["nrClienteNombre","nrClienteNombreComercial","nrClienteNif","nrClienteEmail",
     "nrClienteTel","nrClienteDireccion","nrClienteCiudad","nrClienteProvincia","nrClienteCp"].forEach(id => {
      const el=document.getElementById(id); if(el) el.value="";
    });
    const pais=document.getElementById("nrClientePais"); if(pais) pais.value="ES";
    const tipo=document.getElementById("nrClienteTipo"); if(tipo) tipo.value="empresa";
    document.getElementById("nrClientePanel")?.classList.remove("cliente-panel--filled");
  });
}

/* ══════════════════════════════════════════════════════
   IRPF TOGGLE
══════════════════════════════════════════════════════ */
function _initIrpfToggle() {
  const toggle = document.getElementById("nrIrpfToggle");
  const sel    = document.getElementById("nrIrpf");
  const hint   = document.getElementById("nrIrpfHint");
  if (!toggle) return;
  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      if (sel)  { sel.style.display=""; }
      if (hint) { hint.style.display="none"; }
    } else {
      if (sel)  { sel.style.display="none"; sel.value="15"; }
      if (hint) { hint.style.display=""; hint.textContent="No aplicar"; }
    }
    _calcTotales();
  });
  sel?.addEventListener("change", _calcTotales);
}

/* ══════════════════════════════════════════════════════
   GUARDAR
══════════════════════════════════════════════════════ */

/* ── Descuento de stock al guardar (si el checkbox está marcado) ── */
async function _descontarStockSiProcede(checkboxId) {
  if (!document.getElementById(checkboxId)?.checked) return;
  const lineasConProducto = LINEAS.filter(l => l.producto_id && l.cantidad > 0);
  for (const linea of lineasConProducto) {
    const prod = PRODUCTOS.find(p => p.id === linea.producto_id);
    if (!prod || prod.tipo === "servicio" || prod.stock_actual == null) continue;
    const nuevoStock = Math.max(0, prod.stock_actual - linea.cantidad);
    const { error } = await supabase.from("productos")
      .update({ stock_actual: nuevoStock })
      .eq("id", linea.producto_id)
      .eq("user_id", SESSION.user.id);
    if (!error) prod.stock_actual = nuevoStock;
  }
  // Refrescar catálogo para que la vista se actualice sin recargar
  refreshProductos().catch(() => {});
}

function _actualizarVisibilidadReducirStock(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const tieneProductos = LINEAS.some(l => l.producto_id);
  wrap.style.display = tieneProductos ? "flex" : "none";
}

async function _save() {
  const concepto = document.getElementById("nrConcepto")?.value.trim();
  const proxima  = document.getElementById("nrProxima")?.value;
  if (!concepto || !proxima) { toast("Concepto y fecha de primera generación son obligatorios", "error"); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) { toast("Añade al menos una línea con precio", "error"); return; }

  const btn = document.getElementById("nrGuardarBtn");
  if (btn) { btn.disabled=true; btn.innerHTML=`<span class="spin"></span> Guardando…`; }

  const { base, ivaMap, irpfPct } = _calcTotales();
  const ivaEntry = Object.entries(ivaMap).sort(([,a],[,b]) => b-a)[0];
  const ivaMain  = ivaEntry ? parseInt(ivaEntry[0]) : 0;

  const clienteId    = clienteSelId;
  const clienteNombre = document.getElementById("nrClienteNombre")?.value.trim() || null;
  const clienteNif    = document.getElementById("nrClienteNif")?.value.trim()    || null;
  const clienteEmail  = document.getElementById("nrClienteEmail")?.value.trim()  || null;
  const clienteTel    = document.getElementById("nrClienteTel")?.value.trim()    || null;
  const clienteDir    = document.getElementById("nrClienteDireccion")?.value.trim() || null;
  const clienteCiudad = document.getElementById("nrClienteCiudad")?.value.trim()  || null;
  const clienteProv   = document.getElementById("nrClienteProvincia")?.value.trim()|| null;
  const clienteCp     = document.getElementById("nrClienteCp")?.value.trim()      || null;
  const clientePais   = document.getElementById("nrClientePais")?.value            || "ES";
  const clienteTipo   = document.getElementById("nrClienteTipo")?.value            || "empresa";
  const clienteNomCom = document.getElementById("nrClienteNombreComercial")?.value.trim() || null;
  const guardarCliente= document.getElementById("nrGuardarCliente")?.checked;

  // Crear cliente nuevo si procede
  let cId = clienteId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id:          SESSION.user.id,
      nombre:           clienteNombre,
      nif:              clienteNif,
      email:            clienteEmail,
      telefono:         clienteTel,
      direccion:        clienteDir,
      ciudad:           clienteCiudad,
      provincia:        clienteProv,
      codigo_postal:    clienteCp,
      pais:             clientePais,
      tipo:             clienteTipo,
      nombre_comercial: clienteNomCom,
      emails:           clienteEmail ? [clienteEmail] : null,
      telefonos:        clienteTel   ? [clienteTel]   : null,
    }).select().single();
    if (ce) { toast("Error creando cliente: " + ce.message, "warn"); }
    else    { cId = nc.id; }
  }

  const resolvedNombre = cId ? (CLIENTES.find(c=>c.id===cId)?.nombre || clienteNombre) : clienteNombre;
  const resolvedNif    = cId ? (CLIENTES.find(c=>c.id===cId)?.nif    || clienteNif)    : clienteNif;

  const motivoExencion = document.getElementById("nrMotivoExencion")?.value.trim();
  const notasBase      = document.getElementById("nrNotas")?.value.trim() || null;
  const notas = (opTipo === "exento" && motivoExencion)
    ? (notasBase ? notasBase + "\n\nMotivo de exención: " + motivoExencion : "Motivo de exención: " + motivoExencion)
    : notasBase;

  const payload = {
    user_id:             SESSION.user.id,
    concepto,
    base,
    iva:                 ivaMain,
    irpf_retencion:      irpfPct || 0,
    descuento_global:    _dtoGlobal.valor>0?JSON.stringify({tipo:_dtoGlobal.tipo,valor:_dtoGlobal.valor}):null,
    tipo_operacion:      opTipo,
    tipo:                document.getElementById("nrTipo")?.value || "emitida",
    frecuencia:          document.getElementById("nrFrecuencia")?.value || "mensual",
    proxima_generacion:  proxima,
    fecha_fin:           document.getElementById("nrFin")?.value || null,
    cliente_id:          cId || null,
    cliente_nombre:      resolvedNombre,
    cliente_nif:         resolvedNif,
    activa:              true,
    notas,
    lineas: JSON.stringify(LINEAS.map(l => ({
      descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio,
      iva: l.iva, descuento: l.descuento ?? "",
      subtotal: Math.max(0, l.cantidad*l.precio - _parseDto(l.descuento, l.cantidad*l.precio)),
      producto_id: l.producto_id || null,
    }))),
  };
  const _nrPlantillaId = document.getElementById("nrPlantillaSel")?.value || "none";

  let err;
  if (editandoId) {
    ({ error: err } = await supabase.from("facturas_recurrentes")
      .update({ ...payload, plantilla_id: _nrPlantillaId }).eq("id", editandoId));
    if (err && (err.message?.includes("plantilla_id") || err.message?.includes("schema cache"))) {
      ({ error: err } = await supabase.from("facturas_recurrentes").update(payload).eq("id", editandoId));
    }
  } else {
    ({ error: err } = await supabase.from("facturas_recurrentes")
      .insert({ ...payload, plantilla_id: _nrPlantillaId }));
    if (err && (err.message?.includes("plantilla_id") || err.message?.includes("schema cache"))) {
      ({ error: err } = await supabase.from("facturas_recurrentes").insert(payload));
    }
  }

  if (err) {
    toast("Error: " + err.message, "error");
    if (btn) { btn.disabled=false; btn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/></svg> ${editandoId ? "Actualizar" : "Crear factura recurrente"}`; }
    return;
  }

  await _descontarStockSiProcede("nrReducirStock");
  toast(editandoId ? "Recurrente actualizada ✅" : "Factura recurrente creada ✅", "success");
  _resetForm();
  await refreshRecurrentes();
  switchView("recurrentes");
}

/* ══════════════════════════════════════════════════════
   CARGAR PARA EDITAR
══════════════════════════════════════════════════════ */
export async function cargarRecurrenteParaEditar(id) {
  const { data: r } = await supabase.from("facturas_recurrentes").select("*").eq("id", id).single();
  if (!r) { toast("Recurrente no encontrada", "error"); return; }
  editandoId = id;
  _resetForm(false);

  const titEl = document.getElementById("nrTitulo"); if (titEl) titEl.textContent = `Editar recurrente`;
  const btnEl = document.getElementById("nrGuardarBtn"); if (btnEl) btnEl.textContent = "Actualizar recurrente";

  const f = (id, v) => { const el=document.getElementById(id); if(el) el.value=v||""; };
  f("nrConcepto",   r.concepto);
  f("nrProxima",    r.proxima_generacion);
  f("nrFin",        r.fecha_fin||"");
  f("nrNotas",      r.notas||"");
  f("nrClienteNombre", r.cliente_nombre||"");
  f("nrClienteNif",    r.cliente_nif||"");
  clienteSelId = r.cliente_id || null;
  if (clienteSelId) {
    const ci = document.getElementById("nrClienteSearch");
    const cl = CLIENTES.find(c => c.id === clienteSelId);
    if (ci && cl) {
      ci.value = cl.nombre;
      document.getElementById("nrClienteLimpiar").style.display="";
      // Populate all fields from saved client
      const f2 = (id, v) => { const el=document.getElementById(id); if(el) el.value=v||""; };
      f2("nrClienteNombreComercial", cl.nombre_comercial);
      f2("nrClienteEmail",   cl.email);
      f2("nrClienteTel",     cl.telefono);
      f2("nrClienteDireccion",cl.direccion);
      f2("nrClienteCiudad",  cl.ciudad);
      f2("nrClienteProvincia",cl.provincia);
      f2("nrClienteCp",      cl.codigo_postal);
      if (cl.pais) { const el=document.getElementById("nrClientePais"); if(el) el.value=cl.pais; }
      if (cl.tipo) { const el=document.getElementById("nrClienteTipo"); if(el) el.value=cl.tipo; }
    }
  }
  const freqEl = document.getElementById("nrFrecuencia"); if (freqEl && r.frecuencia) freqEl.value = r.frecuencia;
  const tipoEl = document.getElementById("nrTipo");       if (tipoEl && r.tipo)       tipoEl.value = r.tipo;

  // Tipo operación
  opTipo = r.tipo_operacion || "nacional";
  document.querySelectorAll(".nr-op-btn").forEach(b => b.classList.toggle("active", b.dataset.op === opTipo));
  _updateOpUI();

  // IRPF
  if (r.irpf_retencion > 0) {
    const toggle = document.getElementById("nrIrpfToggle");
    const sel    = document.getElementById("nrIrpf");
    const hint   = document.getElementById("nrIrpfHint");
    if (toggle) toggle.checked = true;
    if (sel)    { sel.value = String(r.irpf_retencion); sel.style.display=""; }
    if (hint)   hint.style.display = "none";
  }

  // Líneas
  const lineas = r.lineas ? (typeof r.lineas === "string" ? JSON.parse(r.lineas) : r.lineas) : [];
  if (lineas.length) {
    lineas.forEach(l => _addLinea(l));
  } else {
    // Fallback: base como una sola línea
    _addLinea({ descripcion: r.concepto, cantidad: 1, precio: r.base, iva: r.iva || 21 });
  }
  _calcTotales();

  // Restaurar plantilla_id guardada
  const nrSel = document.getElementById("nrPlantillaSel");
  if (nrSel && r.plantilla_id) {
    const _restoreSel = () => {
      const opt = nrSel.querySelector(`option[value="${r.plantilla_id}"]`);
      if (opt) { nrSel.value = r.plantilla_id; nrSel.dispatchEvent(new Event("change")); }
    };
    if (nrSel.options.length > 1) _restoreSel();
    else setTimeout(_restoreSel, 500);
  }

  switchView("nueva-recurrente");
}

/* ══════════════════════════════════════════════════════
   RESET
══════════════════════════════════════════════════════ */
function _resetForm(clearEditing = true) {
  if (clearEditing) editandoId = null;
  clienteSelId = null; LINEAS = []; lineaIdCnt = 0;
  _dtoGlobal = { tipo: "pct", valor: 0 };
  _hideDtoGlobal();
  const nrSel = document.getElementById("nrPlantillaSel");
  if (nrSel) nrSel.value = "";
  const cont = document.getElementById("nrLineasContainer"); if (cont) cont.innerHTML = "";
  ["nrConcepto","nrProxima","nrFin","nrNotas","nrMotivoExencion",
   "nrClienteNombre","nrClienteNombreComercial","nrClienteNif","nrClienteEmail",
   "nrClienteTel","nrClienteDireccion","nrClienteCiudad","nrClienteProvincia","nrClienteCp"].forEach(id => {
    const el=document.getElementById(id); if(el) el.value="";
  });
  const pais=document.getElementById("nrClientePais"); if(pais) pais.value="ES";
  const tipo=document.getElementById("nrClienteTipo"); if(tipo) tipo.value="empresa";
  const gc=document.getElementById("nrGuardarCliente"); if(gc) gc.checked=false;
  const ci = document.getElementById("nrClienteSearch"); if (ci) ci.value="";
  const lm = document.getElementById("nrClienteLimpiar"); if (lm) lm.style.display="none";
  document.getElementById("nrClientePanel")?.classList.remove("cliente-panel--filled");
  const fe = document.getElementById("nrProxima"); if (fe) fe.value = new Date().toISOString().slice(0,10);
  const fr = document.getElementById("nrFrecuencia"); if (fr) fr.value = "mensual";
  const ti = document.getElementById("nrTipo"); if (ti) ti.value = "emitida";
  // Reset IRPF
  const toggle = document.getElementById("nrIrpfToggle"); if (toggle) toggle.checked = false;
  const sel    = document.getElementById("nrIrpf"); if (sel) { sel.style.display="none"; sel.value="15"; }
  const hint   = document.getElementById("nrIrpfHint"); if (hint) { hint.style.display=""; hint.textContent="No aplicar"; }
  // Reset op type
  opTipo = "nacional";
  document.querySelectorAll(".nr-op-btn").forEach(b => b.classList.toggle("active", b.dataset.op === "nacional"));
  _updateOpUI();
  // Reset título y botón
  const titEl = document.getElementById("nrTitulo"); if (titEl) titEl.textContent = "Nueva factura recurrente";
  const btnEl = document.getElementById("nrGuardarBtn");
  if (btnEl) { btnEl.disabled=false; btnEl.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/></svg> Crear factura recurrente`; }
  _cols = [..._DEFAULT_COLS]; _applyHeader(); _addLinea(); _calcTotales();
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   SELECTOR DE PLANTILLA PDF
══════════════════════════════════════════════════════ */
async function _nrInitPlantillaSel() {
  const sel   = document.getElementById("nrPlantillaSel");
  const badge = document.getElementById("nrPlantillaDefaultBadge");
  if (!sel) return;
  sel.innerHTML = `<option value="">Cargando...</option>`; sel.disabled = true;
  let plantillas = [];
  try {
    const { data } = await supabase.from("plantillas_usuario")
      .select("id,nombre,es_default")
      .eq("user_id", SESSION.user.id).order("nombre");
    plantillas = data || [];
  } catch(e) { console.warn("plantillas recurrente:", e.message); }
  sel.disabled = false;
  if (!plantillas.length) {
    sel.innerHTML = `<option value="">— Sin plantillas —</option>`; return;
  }
  const defP = plantillas.find(p => p.es_default) || null;
  sel.innerHTML = [
    `<option value="">— Sin plantilla —</option>`,
    ...plantillas.map(p =>
      `<option value="${p.id}" ${defP?.id === p.id ? "selected" : ""}>${p.nombre}${p.es_default ? " ⭐" : ""}</option>`)
  ].join("");
  if (badge) badge.style.display = defP ? "inline" : "none";
  sel.addEventListener("change", () => {
    if (badge) { const p = plantillas.find(x => x.id === sel.value); badge.style.display = p?.es_default ? "inline" : "none"; }
  });
}

/* ── Descuento global UI (recurrente) ── */
function _showDtoGlobal(){
  const wrap=document.getElementById("nrDtoGlobalWrap"); if(!wrap)return;
  wrap.style.display="";
  const input=document.getElementById("nrDtoGlobalInput");
  const select=document.getElementById("nrDtoGlobalTipo");
  if(input)input.value=_dtoGlobal.valor||"";
  if(select)select.value=_dtoGlobal.tipo||"pct";
  input?.focus();
}
function _hideDtoGlobal(){
  const wrap=document.getElementById("nrDtoGlobalWrap");
  if(wrap)wrap.style.display="none";
  _dtoGlobal={tipo:"pct",valor:0};
  _calcTotales();
}
function initDtoGlobal(){
  const btn=document.getElementById("nrAddDtoGlobalBtn");
  const input=document.getElementById("nrDtoGlobalInput");
  const select=document.getElementById("nrDtoGlobalTipo");
  const remove=document.getElementById("nrDtoGlobalRemove");
  if(!btn)return;
  btn.addEventListener("click",()=>_showDtoGlobal());
  const _oc=()=>{_dtoGlobal.tipo=select?.value||"pct";_dtoGlobal.valor=parseFloat(input?.value)||0;_calcTotales();};
  input?.addEventListener("input",_oc); input?.addEventListener("change",_oc);
  select?.addEventListener("change",_oc);
  remove?.addEventListener("click",()=>_hideDtoGlobal());
}

export function initNuevaRecurrente() {
  const fe = document.getElementById("nrProxima");
  if (fe && !fe.value) fe.value = new Date().toISOString().slice(0,10);

  // Expose edit function globally so facturas-recurrentes.js can call it
  window._cargarRecurrenteParaEditar = cargarRecurrenteParaEditar;

  if (!_initDone) {
    _initDone = true;
    _nrInitPlantillaSel();
    _initClienteSearch();
    _initIrpfToggle();

    initDtoGlobal();
    document.getElementById("nrAddLineaBtn")?.addEventListener("click", () => _addLinea());
    document.getElementById("nrGuardarBtn")?.addEventListener("click",  () => _save());
    document.getElementById("nrCancelarBtn")?.addEventListener("click", () => { _resetForm(); switchView("recurrentes"); });

    // Tipo operación
    document.querySelectorAll(".nr-op-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nr-op-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        opTipo = btn.dataset.op;
        _updateOpUI();
        const sinIva = OP_SIN_IVA.includes(opTipo);
        if (sinIva) {
          LINEAS.forEach(l => { l.iva = 0; });
          document.querySelectorAll("#nrLineasContainer [data-field='iva']").forEach(s => { s.value="0"; s.disabled=true; });
        } else {
          document.querySelectorAll("#nrLineasContainer [data-field='iva']").forEach(s => { s.disabled=false; });
        }
        _calcTotales();
      });
    });

    // Actualizar estimación anual al cambiar frecuencia
    document.getElementById("nrFrecuencia")?.addEventListener("change", _calcTotales);
  }

  _updateOpUI();
  if (LINEAS.length === 0) _addLinea();
  _applyHeader(); _calcTotales();
}
