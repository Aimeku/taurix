/* ═══════════════════════════════════════════════════════
   TAURIX · nueva-proforma.js
   Formulario de creación de factura proforma
   ─ Mismo sistema de plantillas que factura/presupuesto
   ─ Columnas dinámicas, selector de plantilla, preview en vivo
   ─ La proforma NO tiene validez fiscal
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, switchView
} from "./utils.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";
import { PLANTILLAS } from "./plantillas-usuario.js";
import { refreshProformas } from "./proformas.js";

/* ── Estado ── */
let LINEAS          = [];
let lineaIdCounter  = 0;
let clienteSelId    = null;
let pfPlantillaActual = null;

/* ══════════════════════════════════════════════════════
   COLUMNAS DINÁMICAS — mismo schema que nueva-factura
══════════════════════════════════════════════════════ */
const _COL_SCHEMA = {
  descripcion: { label:"Descripción",  fr:3.0, minW:120, align:"left",  inputType:"text",   dataField:"descripcion" },
  cantidad:    { label:"Cant.",        fr:0.7, minW:52,  align:"right", inputType:"number", dataField:"cantidad",   step:"0.01", min:"0.01" },
  precio:      { label:"P. unit.",     fr:1.0, minW:72,  align:"right", inputType:"number", dataField:"precio",    step:"0.01", placeholder:"0.00" },
  descuento:   { label:"Dto.",         fr:0.8, minW:60,  align:"right", inputType:"text",   dataField:"descuento", placeholder:"10%/5€" },
  subtotal:    { label:"Subtotal",     fr:1.0, minW:72,  align:"right", inputType:null,     dataField:null },
  codigo:      { label:"Código",       fr:0.7, minW:55,  align:"left",  inputType:"text",   dataField:"codigo" },
  coeficiente: { label:"Coef.",        fr:0.6, minW:50,  align:"right", inputType:"number", dataField:"coeficiente", step:"0.01" },
  iva:         { label:"IVA",          fr:0.6, minW:56,  align:"right", inputType:"select", dataField:"iva" },
  total:       { label:"Total",        fr:0.9, minW:68,  align:"right", inputType:null,     dataField:null },
};
const _COL_DEL      = { fr:0.28, minW:28 };
const _DEFAULT_COLS = ["descripcion","cantidad","precio","iva","total"];
let _pfColsActivas  = [..._DEFAULT_COLS];

function _pfGridStr() {
  return [
    ..._pfColsActivas.map(k => {
      const c = _COL_SCHEMA[k];
      return c ? `minmax(${c.minW}px, ${c.fr}fr)` : "1fr";
    }),
    `${_COL_DEL.minW}px`,
  ].join(" ");
}

function _pfApplyGridToHeader() {
  const hdr = document.getElementById("pfLineasHeader");
  if (!hdr) return;
  hdr.style.gridTemplateColumns = _pfGridStr();
  hdr.innerHTML = _pfColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    const right = c?.align === "right";
    return `<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;${right?"text-align:right":""};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${c?.label || k}</div>`;
  }).join("") + `<div></div>`;
}

function _pfApplyGridToRow(row) {
  row.style.display = "grid";
  row.style.gridTemplateColumns = _pfGridStr();
  row.style.gap = "4px";
  row.style.alignItems = "center";
  row.style.padding = "4px 0";
  row.style.borderBottom = "1px solid var(--brd)";
}

/* ══════════════════════════════════════════════════════
   TOTALES
══════════════════════════════════════════════════════ */
function _parseDescuento(raw, subtotal) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.endsWith("%")) return subtotal * (parseFloat(s) || 0) / 100;
  return parseFloat(s) || 0;
}

function getLineasTotales() {
  let baseTotal = 0;
  const ivaMap = {};
  LINEAS.forEach(l => {
    const subtotalBruto = (l.cantidad || 0) * (l.precio || 0);
    const descAmt       = _parseDescuento(l.descuento, subtotalBruto);
    const subtotal      = Math.max(0, subtotalBruto - descAmt);
    baseTotal += subtotal;
    const ivaAmt = subtotal * (l.iva || 0) / 100;
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + ivaAmt;
  });
  const ivaTotal = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  return { baseTotal, ivaMap, ivaTotal, total: baseTotal + ivaTotal };
}

/* ══════════════════════════════════════════════════════
   LÍNEAS
══════════════════════════════════════════════════════ */
function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         prefill.iva !== undefined ? prefill.iva : 21,
    descuento:   prefill.descuento   ?? "",
    codigo:      prefill.codigo      ?? "",
    coeficiente: prefill.coeficiente ?? "",
  };
  LINEAS.push(linea);

  const container = document.getElementById("pfLineasContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "linea-row";
  row.dataset.lineaId = id;

  row.innerHTML = _pfColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    if (!c) return `<div></div>`;
    const alignStyle = c.align === "right" ? "text-align:right" : "";
    const baseStyle  = `width:100%;box-sizing:border-box;${alignStyle}`;

    if (k === "total") {
      return `<div id="pfLtRow${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
    }
    if (k === "subtotal") {
      return `<div data-subtotal="${id}" style="font-size:12px;text-align:right;font-family:monospace;color:var(--t2)">0,00 €</div>`;
    }
    if (k === "iva") {
      return `<select class="ff-select" data-field="iva" style="${baseStyle}">
        <option value="21" ${linea.iva===21?"selected":""}>21%</option>
        <option value="10" ${linea.iva===10?"selected":""}>10%</option>
        <option value="4"  ${linea.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${linea.iva===0 ?"selected":""}>0%</option>
      </select>`;
    }
    const val    = linea[k] !== undefined ? linea[k] : "";
    const type   = c.inputType || "text";
    const extras = [
      c.step        ? `step="${c.step}"` : "",
      c.min         ? `min="${c.min}"`   : "",
      c.placeholder ? `placeholder="${c.placeholder}"` : "",
    ].filter(Boolean).join(" ");
    return `<input autocomplete="off" type="${type}" class="ff-input" data-field="${k}" value="${val}" ${extras} style="${baseStyle}"/>`;
  }).join("") +
  `<button class="linea-del" onclick="window._pfDelLinea(${id})" title="Eliminar" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  _pfApplyGridToRow(row);

  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => _onLineaChange(id, el));
    el.addEventListener("change", () => _onLineaChange(id, el));
  });

  // Autocomplete descripcion
  const descInput = row.querySelector("[data-field='descripcion']");
  if (descInput && PRODUCTOS?.length) {
    descInput.addEventListener("focus", () => _buildProdDropdown(descInput, row, id));
  }

  container.appendChild(row);
  _updateTotalesUI();
  _updatePreview();
  if (!prefill.descripcion && descInput) descInput.focus();
}

function _buildProdDropdown(descInput, row, id) {
  if (descInput._dd) return;
  const dd = document.createElement("div");
  dd.className = "csc-dropdown";
  dd.style.cssText = "display:none;position:absolute;top:calc(100%+4px);left:0;right:0;z-index:300;min-width:260px";
  descInput.parentElement.style.position = "relative";
  descInput.parentElement.appendChild(dd);
  descInput._dd = dd;

  const render = (lista) => {
    dd.innerHTML = lista.map(p => `
      <div class="csd-item" data-pid="${p.id}">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <div><div class="csd-name">${p.nombre}</div>${p.referencia?`<div class="csd-meta">Ref: ${p.referencia}</div>`:""}</div>
          <div style="text-align:right;flex-shrink:0"><div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio)}</div><div class="csd-meta">IVA ${p.iva}%</div></div>
        </div>
      </div>`).join("") || `<div class="csd-empty">Sin resultados</div>`;
    dd.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        const p = PRODUCTOS.find(x => x.id === item.dataset.pid);
        if (!p) return;
        const linea = LINEAS.find(l => l.id === id);
        if (linea) { linea.descripcion=p.descripcion||p.nombre; linea.precio=p.precio; linea.iva=p.iva; }
        const f = (field, val) => { const el=row.querySelector(`[data-field="${field}"]`); if(el) el.value=val; };
        f("descripcion", p.descripcion||p.nombre);
        f("precio", p.precio); f("iva", p.iva);
        const rowEl = document.getElementById(`pfLtRow${id}`);
        if (rowEl) rowEl.textContent = fmt((linea?.cantidad||1)*p.precio);
        dd.style.display = "none";
        _updateTotalesUI(); _updatePreview();
      });
    });
    dd.style.display = "";
  };

  descInput.addEventListener("input", () => {
    const q = descInput.value.toLowerCase().trim();
    const lista = PRODUCTOS.filter(p => p.activo !== false &&
      (!q || p.nombre.toLowerCase().includes(q) || (p.referencia||"").toLowerCase().includes(q))
    ).slice(0, 10);
    render(lista);
  });
  descInput.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; }, 200));
  render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 10));
}

function _onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if      (field === "descripcion")  linea.descripcion  = el.value;
  else if (field === "cantidad")     linea.cantidad     = parseFloat(el.value) || 0;
  else if (field === "precio")       linea.precio       = parseFloat(el.value) || 0;
  else if (field === "iva")          linea.iva          = parseInt(el.value)   || 0;
  else if (field === "descuento")    linea.descuento    = el.value;
  else if (field === "codigo")       linea.codigo       = el.value;
  else if (field === "coeficiente")  linea.coeficiente  = el.value;
  const subtotalBruto = (linea.cantidad||0) * (linea.precio||0);
  const descAmt       = _parseDescuento(linea.descuento, subtotalBruto);
  const subtotal      = Math.max(0, subtotalBruto - descAmt);
  const rowEl = document.getElementById(`pfLtRow${id}`);
  if (rowEl) rowEl.textContent = fmt(subtotal);
  _updateTotalesUI();
  _updatePreview();
}

window._pfDelLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  _updateTotalesUI();
  _updatePreview();
};

function _updateTotalesUI() {
  const { baseTotal, ivaMap, ivaTotal, total } = getLineasTotales();
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("pfBase",  fmt(baseTotal));
  s("pfIva",   fmt(ivaTotal));
  s("pfTotal", fmt(total));
}

/* ══════════════════════════════════════════════════════
   REBUILD ROWS (cuando cambia plantilla)
══════════════════════════════════════════════════════ */
function _pfRebuildAllRows() {
  const container = document.getElementById("pfLineasContainer");
  if (!container) return;
  const snaps = LINEAS.map(l => ({...l}));
  container.innerHTML = "";
  LINEAS = [];
  lineaIdCounter = 0;
  snaps.forEach(s => addLinea(s));
  _updateTotalesUI();
  _updatePreview();
}

/* ══════════════════════════════════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════════════════════════════════ */
async function _pfInitPlantillaSelector() {
  const sel   = document.getElementById("pfPlantillaSel");
  const badge = document.getElementById("pfPlantillaDefaultBadge");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando plantillas…</option>`;
  sel.disabled  = true;

  let plantillas = [];
  try {
    const { data, error } = await supabase
      .from("plantillas_usuario")
      .select("id, nombre, es_default, cols_activas, cols_pct")
      .eq("user_id", SESSION.user.id)
      .order("nombre");
    if (error) throw error;
    plantillas = data || [];
    console.log("[Proforma] plantillas cargadas:", plantillas.length);
  } catch(e) { console.error("[Proforma] error plantillas:", e.message); }

  sel.disabled = false;

  if (!plantillas.length) {
    sel.innerHTML = `<option value="">— Sin plantillas —</option>`;
    if (badge) badge.style.display = "none";
    return;
  }

  const defP = plantillas.find(p => p.es_default) || plantillas[0];
  sel.innerHTML = [
    `<option value="">— Sin plantilla —</option>`,
    ...plantillas.map(p =>
      `<option value="${p.id}" ${defP?.id===p.id?"selected":""}>${p.nombre}${p.es_default?" ⭐ Predeterminada":""}</option>`
    )
  ].join("");

  const _updBadge = (id) => {
    if (!badge) return;
    const p = plantillas.find(x => x.id === id);
    badge.style.display = p?.es_default ? "inline" : "none";
  };

  const _applyPlantilla = (p) => {
    if (!p) {
      _pfColsActivas = [..._DEFAULT_COLS];
      _pfApplyGridToHeader();
      _pfRebuildAllRows();
      return;
    }
    pfPlantillaActual = p;
    let colsActivas = [];
    try {
      const raw = p.cols_activas
        ? (typeof p.cols_activas === "string" ? JSON.parse(p.cols_activas) : p.cols_activas)
        : null;
      if (Array.isArray(raw)) colsActivas = raw.map(c => typeof c === "object" ? c.key : c);
    } catch(e) {}
    const filtered = colsActivas.filter(k => _COL_SCHEMA[k]);
    _pfColsActivas = filtered.length ? filtered : [..._DEFAULT_COLS];
    if (!_pfColsActivas.includes("descripcion")) _pfColsActivas.unshift("descripcion");
    _pfApplyGridToHeader();
    _pfRebuildAllRows();
  };

  if (defP) { _updBadge(defP.id); _applyPlantilla(plantillas.find(p => p.id === defP.id)); }

  sel.addEventListener("change", () => {
    const id = sel.value;
    _updBadge(id);
    _applyPlantilla(id ? plantillas.find(p => p.id === id) : null);
  });
}

window._pfRefreshPlantillaSel = () => _pfInitPlantillaSelector();

/* ══════════════════════════════════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════════════════════════════════ */
function _initClienteSearch() {
  const input  = document.getElementById("pfClienteSearch");
  const dd     = document.getElementById("pfClienteDropdown");
  const limpiar= document.getElementById("pfClienteLimpiar");
  if (!input || !dd) return;

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    if (!q || q.length < 2) { dd.style.display = "none"; return; }
    const matches = CLIENTES.filter(c =>
      (c.nombre||"").toLowerCase().includes(q) || (c.nif||"").toLowerCase().includes(q)
    ).slice(0, 8);
    dd.innerHTML = matches.length
      ? matches.map(c => `<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif||""}</div></div>`).join("")
      : `<div class="csd-empty">Sin coincidencias</div>`;
    dd.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        const c = CLIENTES.find(x => x.id === item.dataset.id);
        if (!c) return;
        clienteSelId = c.id;
        input.value = c.nombre;
        if (limpiar) limpiar.style.display = "";
        const f = (id, v) => { const el=document.getElementById(id); if(el) el.value=v; };
        f("pfClienteNombre", c.nombre);
        f("pfClienteNif",    c.nif || "");
        f("pfClienteDir",    c.direccion || "");
        dd.style.display = "none";
        _updatePreview();
      });
    });
    dd.style.display = "";
  });
  input.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; }, 200));
  limpiar?.addEventListener("click", () => {
    clienteSelId = null;
    input.value  = "";
    limpiar.style.display = "none";
    ["pfClienteNombre","pfClienteNif","pfClienteDir"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    _updatePreview();
  });
}

/* ══════════════════════════════════════════════════════
   PREVIEW EN VIVO
══════════════════════════════════════════════════════ */
function _updatePreview() {
  const nombre   = document.getElementById("pfClienteNombre")?.value || "—";
  const nif      = document.getElementById("pfClienteNif")?.value    || "";
  const concepto = document.getElementById("pfConcepto")?.value      || "—";
  const fecha    = document.getElementById("pfFecha")?.value         || "—";
  const { baseTotal, ivaTotal, total } = getLineasTotales();

  const previewEl = document.getElementById("pfPreviewContent");
  if (!previewEl) return;

  previewEl.innerHTML = `
    <div style="background:var(--accent);color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">
      <div style="font-size:9px;font-weight:800;letter-spacing:.12em;opacity:.7;text-transform:uppercase;margin-bottom:4px">FACTURA PROFORMA</div>
      <div style="font-size:8px;opacity:.6;margin-bottom:8px">Documento sin validez fiscal</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="font-size:14px;font-weight:700;line-height:1.3;max-width:60%">${concepto}</div>
        <div style="text-align:right;font-size:10px;opacity:.8">${fecha !== "—" ? fmtDate(fecha) : ""}</div>
      </div>
    </div>
    <div style="padding:10px 16px;border-bottom:1px solid var(--brd);font-size:11px">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;color:var(--t4);margin-bottom:3px">Cliente</div>
      <div style="font-weight:700;color:var(--t1)">${nombre}</div>
      ${nif ? `<div style="color:var(--t3);font-size:10px">NIF: ${nif}</div>` : ""}
    </div>
    ${LINEAS.filter(l => l.descripcion||l.precio>0).length ? `
    <div style="padding:6px 16px;border-bottom:1px solid var(--brd)">
      ${LINEAS.filter(l=>l.descripcion||l.precio>0).map(l=>{
        const subtotalBruto=(l.cantidad||1)*(l.precio||0);
        const desc=_parseDescuento(l.descuento,subtotalBruto);
        const sub=Math.max(0,subtotalBruto-desc);
        return `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:10px;border-bottom:1px solid var(--bg2)">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1)">${l.descripcion||"—"}</span>
          <span style="font-family:monospace;font-weight:700;flex-shrink:0;margin-left:8px;color:var(--t1)">${fmt(sub)}</span>
        </div>`;
      }).join("")}
    </div>` : ""}
    <div style="padding:10px 16px;background:var(--bg2);border-radius:0 0 10px 10px">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:3px"><span>Base</span><span>${fmt(baseTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:6px"><span>IVA</span><span>${fmt(ivaTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900;color:var(--t1);border-top:1px solid var(--brd);padding-top:6px">
        <span>TOTAL</span><span>${fmt(total)}</span>
      </div>
      <div style="margin-top:8px;font-size:8px;color:var(--t4);text-align:center;border-top:1px solid var(--brd);padding-top:6px">
        Documento sin validez fiscal · No sustituye a la factura
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════
   NUMERACIÓN AUTOMÁTICA
══════════════════════════════════════════════════════ */
async function _getNextNumero() {
  const year = new Date().getFullYear();
  const { data: last } = await supabase
    .from("proformas")
    .select("numero")
    .eq("user_id", SESSION.user.id)
    .like("numero", `PRO-${year}-%`)
    .order("numero", { ascending: false })
    .limit(1);
  const lastNum = last?.[0]?.numero
    ? parseInt((last[0].numero.match(/-(\d+)$/) || [])[1]) || 0
    : 0;
  return `PRO-${year}-${String(lastNum + 1).padStart(3, "0")}`;
}

/* ══════════════════════════════════════════════════════
   GUARDAR PROFORMA
══════════════════════════════════════════════════════ */
async function _saveProforma() {
  const concepto = document.getElementById("pfConcepto")?.value.trim();
  const fecha    = document.getElementById("pfFecha")?.value;
  if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) {
    toast("Añade al menos una línea con precio", "error"); return;
  }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry = Object.entries(ivaMap).sort(([,a],[,b]) => b-a)[0];
  const ivaMain  = ivaEntry ? parseInt(ivaEntry[0]) : 21;

  const clienteNombre = document.getElementById("pfClienteNombre")?.value.trim();
  const clienteNif    = document.getElementById("pfClienteNif")?.value.trim();
  const clienteDir    = document.getElementById("pfClienteDir")?.value.trim();
  const guardarCliente= document.getElementById("pfGuardarCliente")?.checked;

  const btn = document.getElementById("pfGuardarBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Guardando…`; }

  // Guardar cliente nuevo si procede
  let cId = clienteSelId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif||null, direccion: clienteDir||null
    }).select().single();
    if (nc) cId = nc.id;
  }

  const numero = await _getNextNumero();

  const { error } = await supabase.from("proformas").insert({
    user_id:          SESSION.user.id,
    numero,
    concepto, fecha,
    estado:           "borrador",
    cliente_id:       cId || null,
    cliente_nombre:   clienteNombre || "",
    cliente_nif:      clienteNif    || "",
    cliente_direccion:clienteDir    || "",
    base:             baseTotal,
    iva:              ivaMain,
    plantilla_id:     pfPlantillaActual?.id || null,
    lineas:           JSON.stringify(LINEAS.map(l => ({
      descripcion: l.descripcion,
      cantidad:    l.cantidad,
      precio:      l.precio,
      iva:         l.iva,
      descuento:   l.descuento ?? "",
      codigo:      l.codigo    ?? "",
      coeficiente: l.coeficiente ?? "",
      subtotal:    Math.max(0, l.cantidad*l.precio - _parseDescuento(l.descuento, l.cantidad*l.precio)),
    }))),
    notas: document.getElementById("pfNotas")?.value.trim() || null,
  });

  if (error) {
    if (btn) { btn.disabled=false; btn.textContent="Guardar proforma"; }
    toast("Error: " + error.message, "error"); return;
  }

  toast(`Proforma ${numero} creada`, "success");
  _resetForm();
  if (btn) { btn.disabled=false; btn.textContent="Guardar proforma"; }
  await refreshProformas();
  switchView("proformas");
}

function _resetForm() {
  LINEAS = []; lineaIdCounter = 0; clienteSelId = null; pfPlantillaActual = null;
  const container = document.getElementById("pfLineasContainer");
  if (container) container.innerHTML = "";
  ["pfClienteNombre","pfClienteNif","pfClienteDir","pfConcepto","pfNotas"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const csi = document.getElementById("pfClienteSearch"); if (csi) csi.value = "";
  const lmp = document.getElementById("pfClienteLimpiar"); if (lmp) lmp.style.display = "none";
  document.getElementById("pfFecha").value = new Date().toISOString().slice(0, 10);
  document.getElementById("pfGuardarCliente").checked = false;
  _pfColsActivas = [..._DEFAULT_COLS];
  addLinea();
  _pfApplyGridToHeader();
  _updatePreview();
}

/* ══════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════ */
export function initNuevaProforma() {
  const fechaEl = document.getElementById("pfFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().slice(0, 10);

  _initClienteSearch();

  ["pfClienteNombre","pfClienteNif","pfFecha","pfConcepto","pfNotas"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  _updatePreview);
    document.getElementById(id)?.addEventListener("change", _updatePreview);
  });

  document.getElementById("pfAddLineaBtn")?.addEventListener("click", () => addLinea());
  document.getElementById("pfGuardarBtn")?.addEventListener("click",  () => _saveProforma());

  if (LINEAS.length === 0) addLinea();
  _pfApplyGridToHeader();
  _pfInitPlantillaSelector();
}
