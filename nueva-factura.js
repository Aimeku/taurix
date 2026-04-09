/* ═══════════════════════════════════════════════════════
   TUGESTOR · nueva-factura.js
   Módulo completo: líneas, preview en vivo, guardar/emitir
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, isCerrado, switchView,
  getYear, getTrim, OP_INFO, OP_SIN_IVA, OP_IVA_NO_REPERCUTIDO,
  parseDescuentoGlobal
} from "./utils.js";
import { emitirFacturaDB } from "./facturas.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";
import { refreshDashboard } from "./dashboard.js";
import { refreshFacturas } from "./facturas.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";
import { PLANTILLAS, getPlantillaDefault } from "./plantillas-usuario.js";

/* ── Estado interno del formulario ── */
let LINEAS = [];
let lineaIdCounter = 0;
let PERFIL_FISCAL_CACHE = null;
let clienteSeleccionadoId = null;
let opTipoActual = "nacional";
let nfPlantillaActual = null;   // plantilla aplicada actualmente

/* ══════════════════════════
   TOTALES
══════════════════════════ */
/* ── Parsea el valor de descuento de una línea.
   Acepta "10%" → porcentaje, "10" → importe fijo.
   Devuelve el importe de descuento a restar del subtotal. ── */
function _parseDescuento(raw, subtotal) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.endsWith("%")) {
    const pct = parseFloat(s) || 0;
    return subtotal * pct / 100;
  }
  return parseFloat(s) || 0;
}

function _getNfDescuentoGlobal() {
  const tipo=document.getElementById("nfDtoTipo")?.value||"pct";
  const valor=document.getElementById("nfDtoValor")?.value||"";
  if(!valor)return ""; return tipo==="pct"?valor+"%":valor;
}
function getLineasTotales() {
  const toggle=document.getElementById("nfIrpfToggle");
  const irpfPct=(toggle?.checked)?(parseInt(document.getElementById("nfIrpf")?.value)||0):0;
  let subtotalLineas=0; const ivaRaw={};
  LINEAS.forEach(l=>{
    const sub=Math.max(0,l.cantidad*l.precio-_parseDescuento(l.descuento,l.cantidad*l.precio));
    subtotalLineas+=sub; const p=l.iva||0; ivaRaw[p]=(ivaRaw[p]||0)+sub;
  });
  const rawDto=_getNfDescuentoGlobal();
  const{importe:dtoGlobal}=parseDescuentoGlobal(rawDto,subtotalLineas);
  const baseTotal=Math.max(0,subtotalLineas-dtoGlobal);
  const scale=subtotalLineas>0?baseTotal/subtotalLineas:1;
  const ivaMap={};
  Object.entries(ivaRaw).forEach(([p,s])=>{const a=s*scale*(parseFloat(p)/100);if(a>0)ivaMap[p]=(ivaMap[p]||0)+a;});
  const ivaTotal=Object.values(ivaMap).reduce((a,b)=>a+b,0);
  const irpfAmt=baseTotal*irpfPct/100;
  const ivaEnTotal=OP_IVA_NO_REPERCUTIDO.includes(opTipoActual)?0:ivaTotal;
  const total=baseTotal+ivaEnTotal-irpfAmt;
  return{subtotalLineas,dtoGlobal,rawDto,baseTotal,ivaMap,ivaTotal,irpfAmt,irpfPct,total};
}

/* ══════════════════════════
   LÍNEAS
══════════════════════════ */

/* ══════════════════════════
   HELPER: dropdown catálogo de productos
   Usa las mismas clases CSS que el dropdown de clientes (csc-dropdown, csd-item, csd-name, csd-meta)
══════════════════════════ */
function _buildProdDropdown(descInput, onSelect) {
  if (!descInput) return;

  // Crear dropdown con la misma clase que el de clientes
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
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:5px;font-weight:700;margin-left:6px;background:${p.stock_actual > 0 ? "#dcfce7" : "#fee2e2"};color:${p.stock_actual > 0 ? "#166534" : "#991b1b"}">Stock: ${p.stock_actual}</span>`
        : "";
      return `
        <div class="csd-item" data-pid="${p.id}">
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

  // Al hacer focus: mostrar todo el catálogo
  descInput.addEventListener("focus", () => {
    if (!PRODUCTOS?.length) return;
    _render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 12));
  });

  // Al escribir: filtrar
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



/* ══════════════════════════════════════════════════════
   COLUMNAS DINÁMICAS — esquema centralizado
   Cada columna tiene: key, label, fr (proporción grid),
   minW (ancho mínimo en px), align, inputType.
   El grid se recalcula cada vez que cambia la plantilla.
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
const _COL_DEL = { fr:0.28, minW:28 };  // columna del botón eliminar

/* Columnas por defecto si no hay plantilla */
const _DEFAULT_COLS = ["descripcion","cantidad","precio","iva","total"];

/* ── Sistema de grid dinámico para NF ──
   _nfColsActivas: array de keys según la plantilla seleccionada.
   _nfGridStr(): devuelve la string grid-template-columns para header y filas.
   Se recalcula cuando cambia la plantilla.
─────────────────────────────────────────────────────────── */
let _nfColsActivas = [..._DEFAULT_COLS];

function _nfGridStr() {
  const frParts = _nfColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    return c ? `minmax(${c.minW}px, ${c.fr}fr)` : "1fr";
  });
  frParts.push(`${_COL_DEL.minW}px`);  // botón eliminar
  return frParts.join(" ");
}

function _nfApplyGridToHeader() {
  const hdr = document.getElementById("nfLineasHeader");
  if (!hdr) return;
  hdr.style.gridTemplateColumns = _nfGridStr();
  // Reconstruir celdas del header dinámicamente
  hdr.innerHTML = _nfColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    const lbl = c?.label || k;
    const right = c?.align === "right";
    return `<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;${right?"text-align:right":""};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${lbl}</div>`;
  }).join("") + `<div></div>`; // hueco botón eliminar
}

function _nfApplyGridToRow(row) {
  row.style.display = "grid";
  row.style.gridTemplateColumns = _nfGridStr();
  row.style.gap = "4px";
  row.style.alignItems = "center";
  row.style.padding = "4px 0";
  row.style.borderBottom = "1px solid var(--brd)";
}

/** Reaplica el grid a todas las filas existentes (sin recrearlas) */
function _nfReapplyGridToAllRows() {
  document.querySelectorAll("#lineasContainer .linea-row").forEach(row => {
    _nfApplyGridToRow(row);
  });
}

function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const sinIva = OP_SIN_IVA.includes(opTipoActual);
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         sinIva ? 0 : (prefill.iva !== undefined ? prefill.iva : 21),
    tipo:        prefill.tipo        || "servicio",
    descuento:   prefill.descuento   ?? "",
    codigo:      prefill.codigo      ?? "",
    coeficiente: prefill.coeficiente ?? "",
  };
  LINEAS.push(linea);

  const container = document.getElementById("lineasContainer");
  const row = document.createElement("div");
  row.className = "linea-row";
  row.dataset.lineaId = id;
  // Input hidden para tipo (no en el grid visual)
  row.dataset.tipo = linea.tipo || "servicio";

  // Construir celdas según columnas activas
  row.innerHTML = _nfColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    if (!c) return `<div></div>`;
    const align = c.align === "right" ? "text-align:right" : "";
    const baseStyle = `width:100%;box-sizing:border-box;${align}`;

    if (k === "total") {
      return `<div class="linea-total" id="ltRow${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
    }
    if (k === "subtotal") {
      return `<div data-subtotal="${id}" style="font-size:12px;text-align:right;font-family:monospace;color:var(--t2)">0,00 €</div>`;
    }
    if (k === "iva") {
      return `<select class="ff-select" data-field="iva" style="${baseStyle}" ${sinIva?"disabled":""}>
        <option value="21" ${linea.iva===21?"selected":""}>21%</option>
        <option value="10" ${linea.iva===10?"selected":""}>10%</option>
        <option value="4"  ${linea.iva===4 ?"selected":""}>4%</option>
        <option value="0"  ${linea.iva===0 ?"selected":""}>0%</option>
      </select>`;
    }
    const val = linea[k] !== undefined ? linea[k] : "";
    const type = c.inputType || "text";
    const extras = [
      c.step        ? `step="${c.step}"` : "",
      c.min         ? `min="${c.min}"`   : "",
      c.placeholder ? `placeholder="${c.placeholder}"` : "",
    ].filter(Boolean).join(" ");
    return `<input autocomplete="off" type="${type}" class="ff-input" data-field="${k}" value="${val}" ${extras} style="${baseStyle}"/>`;
  }).join("") +
  `<button class="linea-del" onclick="window._delLinea(${id})" title="Eliminar línea" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  // Aplicar grid
  _nfApplyGridToRow(row);

  // Listeners
  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => onLineaChange(id, el));
    el.addEventListener("change", () => onLineaChange(id, el));
  });

  // Autocomplete en campo descripcion
  const descInput = row.querySelector("[data-field='descripcion']");
  if (descInput) {
    _buildProdDropdown(descInput, (p) => {
      const linea = LINEAS.find(l => l.id === id);
      if (!linea) return;
      linea.descripcion = p.descripcion || p.nombre;
      linea.precio      = p.precio;
      linea.iva         = p.iva;
      linea.tipo        = p.tipo || "producto";
      row.dataset.tipo  = linea.tipo;
      const f = (field, val) => { const el=row.querySelector(`[data-field="${field}"]`); if(el) el.value=val; };
      f("descripcion", linea.descripcion);
      f("precio", linea.precio);
      f("iva", linea.iva);
      const rowEl = document.getElementById(`ltRow${id}`);
      if (rowEl) rowEl.textContent = fmt(linea.cantidad * linea.precio);
      updateTotalesUI(); updatePreview();
    });
  }

  container.appendChild(row);
  updateTotalesUI();
  updatePreview();
  if (!prefill.descripcion && descInput) descInput.focus();
}

function onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if      (field === "descripcion") linea.descripcion = el.value;
  else if (field === "cantidad")    linea.cantidad    = parseFloat(el.value) || 0;
  else if (field === "precio")      linea.precio      = parseFloat(el.value) || 0;
  else if (field === "iva")         linea.iva         = parseInt(el.value)   || 0;
  else if (field === "descuento")   linea.descuento   = el.value;
  else if (field === "tipo")      { linea.tipo        = el.value; updateIrpfVisibility(); return; }
  const subtotalBruto = linea.cantidad * linea.precio;
  const descAmt       = _parseDescuento(linea.descuento, subtotalBruto);
  const subtotal      = Math.max(0, subtotalBruto - descAmt);
  const rowEl = document.getElementById(`ltRow${id}`);
  if (rowEl) rowEl.textContent = fmt(subtotal);
  updateTotalesUI();
  updatePreview();
}

window._delLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  updateIrpfVisibility();
  updateTotalesUI();
  updatePreview();
};

function updateTotalesUI() {
  const{subtotalLineas,dtoGlobal,rawDto,baseTotal,ivaMap,irpfAmt,irpfPct,total}=getLineasTotales();
  const el=id=>document.getElementById(id);
  const show=(id,v)=>{const e=el(id);if(e)e.style.display=v?"":"none";};
  show("ltSubtotalRow",dtoGlobal>0); if(el("ltSubtotal"))el("ltSubtotal").textContent=fmt(subtotalLineas);
  show("ltDtoRow",dtoGlobal>0);
  if(dtoGlobal>0){const{label}=parseDescuentoGlobal(rawDto,subtotalLineas);
    if(el("ltDtoLbl"))el("ltDtoLbl").textContent=label||"Descuento";
    if(el("ltDtoAmt"))el("ltDtoAmt").textContent="−"+fmt(dtoGlobal);}
  if(el("ltBase"))el("ltBase").textContent=fmt(baseTotal);
  if(el("ltTotal"))el("ltTotal").textContent=fmt(total);
  show("ltIrpfRow",irpfPct>0);
  if(el("ltIrpf"))el("ltIrpf").textContent=fmt(irpfAmt);
  if(el("ltIrpfLbl"))el("ltIrpfLbl").textContent=`IRPF (−${irpfPct}%)`;
  if(el("ltIvaRows")){
    const mostrar=!OP_SIN_IVA.includes(opTipoActual)||OP_IVA_NO_REPERCUTIDO.includes(opTipoActual);
    el("ltIvaRows").innerHTML=mostrar?Object.entries(ivaMap).filter(([,v])=>v>0).sort(([a],[b])=>b-a)
      .map(([p,a])=>`<div class="lt-row"><span>IVA ${p}%</span><strong>${fmt(a)}</strong></div>`).join(""):"";
  }
  const prev=el("nfDtoPreview");
  if(prev){if(dtoGlobal>0){prev.textContent=`Ahorro: −${fmt(dtoGlobal)}`;prev.style.display="";}else prev.style.display="none";}
}

/* ══════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════ */
function initClienteSearch() {
  const input    = document.getElementById("clienteSearchInput");
  const dropdown = document.getElementById("clienteDropdown");
  const limpiar  = document.getElementById("clienteLimpiarBtn");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    limpiar.style.display = q ? "" : "none";
    if (!q) { dropdown.style.display="none"; clienteSeleccionadoId=null; return; }
    const matches = CLIENTES.filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      (c.nif||"").toLowerCase().includes(q) ||
      (c.email||"").toLowerCase().includes(q)
    ).slice(0,8);
    dropdown.innerHTML = matches.length
      ? matches.map(c=>`<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif?c.nif+" · ":""}${c.email||""}</div></div>`).join("")
      : `<div class="csd-empty">Sin resultados · Se creará como cliente nuevo</div>`;
    dropdown.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("click", () => {
        const c = CLIENTES.find(x=>x.id===item.dataset.id);
        if (!c) return;
        clienteSeleccionadoId = c.id;
        input.value = c.nombre;
        limpiar.style.display = "";
        dropdown.style.display = "none";
        const set = (id,v) => { const e=document.getElementById(id); if(e) e.value=v; };
        set("nfNombre",c.nombre); set("nfNif",c.nif||"");
        set("nfPais",c.pais||"ES"); set("nfTipoCliente",c.tipo||"empresa");
        set("nfDireccion", c.direccion||"");
        set("nfNombreComercial", c.nombre_comercial||"");
        set("nfTipoEmpresa",     c.tipo_empresa||"");
        set("nfCiudad",          c.ciudad||"");
        set("nfProvincia",       c.provincia||"");
        set("nfCp",              c.codigo_postal||"");
        set("nfEmailCliente",    c.email||"");
        set("nfTelCliente",      c.telefono||"");
        document.getElementById("nfClientePanel")?.classList.add("cliente-panel--filled");
        updateIrpfVisibility();
        updatePreview();
      });
    });
    dropdown.style.display = "";
  });

  input.addEventListener("blur",  () => setTimeout(()=>{ dropdown.style.display="none"; },180));
  input.addEventListener("focus", () => { if(input.value) input.dispatchEvent(new Event("input")); });
  limpiar.addEventListener("click", () => {
    input.value=""; limpiar.style.display="none"; dropdown.style.display="none";
    clienteSeleccionadoId=null;
    ["nfNombre","nfNif","nfDireccion","nfNombreComercial","nfTipoEmpresa",
     "nfCiudad","nfProvincia","nfCp","nfEmailCliente","nfTelCliente"].forEach(id=>{
      const e=document.getElementById(id); if(e) e.value="";
    });
    const pais = document.getElementById("nfPais"); if(pais) pais.value="ES";
    const tipo = document.getElementById("nfTipoCliente"); if(tipo) tipo.value="empresa";
    document.getElementById("nfClientePanel")?.classList.remove("cliente-panel--filled");
    updatePreview();
  });
}

/* ══════════════════════════
   TIPO DE OPERACIÓN
══════════════════════════ */
function updateOpUI() {
  const banner    = document.getElementById("opInfoBanner");
  const pvOpNote  = document.getElementById("pvOpNote");
  const nifNote   = document.getElementById("nifNote");
  const exencionWrap = document.getElementById("nfExencionWrap");
  if (banner)  { banner.textContent=OP_INFO[opTipoActual]||""; banner.classList.toggle("visible",!!OP_INFO[opTipoActual]); }
  if (nifNote) nifNote.textContent = opTipoActual==="intracomunitaria"?"(VAT número UE obligatorio)":"";
  if (exencionWrap) exencionWrap.style.display = opTipoActual==="exento"?"":"none";
  if (pvOpNote) {
    const notes = {
      intracomunitaria:        "Operación intracomunitaria exenta de IVA según Directiva 2006/112/CE.",
      exportacion:             "Exportación exenta de IVA según art. 21 LIVA.",
      inversion_sujeto_pasivo: "Operación con inversión del sujeto pasivo según art. 84.Uno.2º LIVA.",
      importacion:             "Importación — IVA liquidado en aduana (DUA)."
    };
    pvOpNote.textContent     = notes[opTipoActual]||"";
    pvOpNote.style.display   = notes[opTipoActual]?"":"none";
  }
}

/* ══════════════════════════
   PREVIEW EN VIVO
══════════════════════════ */
function updatePreview() {
  const { baseTotal, ivaMap, irpfAmt, irpfPct, total } = getLineasTotales();
  const fecha   = document.getElementById("nfFecha")?.value;
  const nombre  = document.getElementById("nfNombre")?.value  || "";
  const nif     = document.getElementById("nfNif")?.value     || "";
  const dir     = document.getElementById("nfDireccion")?.value || "";
  const notas   = document.getElementById("nfNotas")?.value   || "";
  const ops     = {nacional:"Nacional",intracomunitaria:"Intracomunitaria",exportacion:"Exportación",importacion:"Importación",inversion_sujeto_pasivo:"Inv. Sujeto Pasivo",exento:"Exento"};
  const set     = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

  set("pvFecha",  fecha?fmtDate(fecha):"—");
  set("pvCliente",nombre||"—");
  set("pvNif",    nif ? "NIF/CIF: "+nif : "—");
  set("pvOp",     ops[opTipoActual]||"Nacional");

  // Dirección en preview
  const pvDirEl = document.getElementById("pvClienteDir");
  if (pvDirEl) pvDirEl.textContent = dir || "";

  const pvLineas = document.getElementById("pvLineas");
  if (pvLineas) {
    const hasContent = LINEAS.some(l=>l.descripcion||l.precio>0);
    pvLineas.innerHTML = !hasContent
      ? `<div class="fpv-lineas-empty">Las líneas aparecerán aquí…</div>`
      : LINEAS.filter(l=>l.descripcion||l.precio>0).map(l=>`
          <div class="fpv-linea-row">
            <span class="fpvl-desc">${l.descripcion||"—"}</span>
            <span class="fpvl-qty">${l.cantidad}</span>
            <span class="fpvl-price">${fmt(l.precio)}</span>
            <span class="fpvl-total">${fmt(l.cantidad*l.precio)}</span>
          </div>`).join("");
  }

  set("pvBase",    baseTotal>0?fmt(baseTotal):"—");
  set("pvTotal",   total>0?fmt(total):"— €");
  set("pvIrpfAmt", irpfAmt>0?"−"+fmt(irpfAmt):"—");
  set("pvIrpfLbl", `IRPF (−${irpfPct}%)`);
  const pvIrpfRow = document.getElementById("pvIrpfRow");
  if (pvIrpfRow) pvIrpfRow.style.display = irpfPct>0?"":"none";
  const pvIvaDesglose = document.getElementById("pvIvaDesglose");
  if (pvIvaDesglose) {
    const mostrarIvaPreview = !OP_SIN_IVA.includes(opTipoActual) || OP_IVA_NO_REPERCUTIDO.includes(opTipoActual);
    pvIvaDesglose.innerHTML = mostrarIvaPreview
      ? Object.entries(ivaMap)
          .filter(([,v])=>v>0).sort(([a],[b])=>b-a)
          .map(([pct,amt])=>`<div class="fpvt-row"><span>IVA ${pct}%</span><span>${fmt(amt)}</span></div>`)
          .join("")
      : "";
  }
  const pvNotas = document.getElementById("pvNotas");
  if (pvNotas) { pvNotas.innerHTML=notas.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\r?\n/g,"<br>"); pvNotas.style.display=notas?"":"none"; }
}

/* ══════════════════════════
   LÓGICA IRPF INTELIGENTE
   - Sociedad o cliente particular → campo oculto
   - Autónomo + cliente empresa   → toggle ON/OFF + selector %
══════════════════════════ */
function updateIrpfVisibility() {
  const wrap   = document.getElementById("irpfFieldWrap");
  const toggle = document.getElementById("nfIrpfToggle");
  const sel    = document.getElementById("nfIrpf");
  const hint   = document.getElementById("nfIrpfHint");
  if (!wrap || !toggle || !sel) return;

  const regime       = PERFIL_FISCAL_CACHE?.regime || "autonomo_ed";
  const tipoCliente  = document.getElementById("nfTipoCliente")?.value || "empresa";
  const esSociedad   = regime === "sociedad";
  const esParticular = tipoCliente === "particular";

  // Al menos una línea debe ser servicio para que aplique IRPF
  const hayServicio  = LINEAS.length === 0 || LINEAS.some(l => (l.tipo || "servicio") === "servicio");

  const irpfAplica = !esSociedad && !esParticular && hayServicio;

  if (!irpfAplica) {
    wrap.style.display = "none";
    toggle.checked = false;
    sel.style.display = "none";
    sel.value = "0";
    if (hint) { hint.style.display = ""; hint.textContent = "No aplicar"; }
  } else {
    wrap.style.display = "";
  }

  updateTotalesUI();
  updatePreview();
}

function initIrpfToggle() {
  const toggle = document.getElementById("nfIrpfToggle");
  const sel    = document.getElementById("nfIrpf");
  const hint   = document.getElementById("nfIrpfHint");
  if (!toggle || !sel) return;

  toggle.addEventListener("change", () => {
    if (toggle.checked) {
      sel.style.display = "";
      if (hint) hint.style.display = "none";
    } else {
      sel.style.display = "none";
      sel.value = "0"; // sin retención cuando toggle OFF
      if (hint) { hint.style.display = ""; hint.textContent = "No aplicar"; }
    }
    updateTotalesUI();
    updatePreview();
  });

  sel.addEventListener("change", () => { updateTotalesUI(); updatePreview(); });
}


async function loadPerfilForPreview() {
  if (!SESSION) return;
  if (!PERFIL_FISCAL_CACHE) {
    const { data, error } = await supabase.from("perfil_fiscal").select("*").eq("user_id",SESSION.user.id).single();
    if (error && error.code!=="PGRST116") console.warn("perfil preview:", error.message);
    PERFIL_FISCAL_CACHE = data;
  }
  const pf  = PERFIL_FISCAL_CACHE;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v||""; };
  set("pvEmisorNombre", pf?.nombre_razon_social||"Tu nombre / empresa");
  set("pvEmisorNif",    pf?.nif?"NIF: "+pf.nif:"");
  set("pvEmisorDir",    pf?.domicilio_fiscal||"");

  // Logo en preview
  const logoWrap = document.getElementById("pvEmisorLogo");
  if (logoWrap) {
    if (pf?.logo_url) {
      logoWrap.innerHTML = `<img src="${pf.logo_url}" style="max-height:40px;max-width:120px;object-fit:contain;margin-bottom:4px"/>`;
    } else {
      logoWrap.innerHTML = "";
    }
  }

  // Actualizar visibilidad del IRPF según régimen del emisor
  updateIrpfVisibility();
}

/* ══════════════════════════
   GUARDAR / EMITIR
══════════════════════════ */
async function saveFactura() {
  if (!LINEAS.length || LINEAS.every(l=>!l.precio||l.precio<=0)) {
    toast("Añade al menos una línea con precio","error"); return;
  }
  const fecha        = document.getElementById("nfFecha")?.value;
  const toggle   = document.getElementById("nfIrpfToggle");
  const irpf     = toggle?.checked
    ? (parseInt(document.getElementById("nfIrpf")?.value) || 0)
    : 0;
  const tipo         = document.getElementById("nfTipo")?.value;
  const tipoCliente       = document.getElementById("nfTipoCliente")?.value;
  const clienteNombre     = document.getElementById("nfNombre")?.value.trim();
  const clienteNif        = document.getElementById("nfNif")?.value.trim();
  const clienteDir        = document.getElementById("nfDireccion")?.value.trim();
  const pais              = document.getElementById("nfPais")?.value || "ES";
  const notas             = document.getElementById("nfNotas")?.value.trim();
  const clienteNombreC    = document.getElementById("nfNombreComercial")?.value.trim();
  const clienteTipoEmp    = document.getElementById("nfTipoEmpresa")?.value || null;
  const clienteCiudad     = document.getElementById("nfCiudad")?.value.trim();
  const clienteProvincia  = document.getElementById("nfProvincia")?.value.trim();
  const clienteCp         = document.getElementById("nfCp")?.value.trim();
  const clienteEmail      = document.getElementById("nfEmailCliente")?.value.trim();
  const clienteTel        = document.getElementById("nfTelCliente")?.value.trim();
  const guardarCliente    = document.getElementById("nfGuardarCliente")?.checked;

  if (!fecha)                                         { toast("Introduce la fecha de la factura","error"); return; }
  if (!clienteNombre && !clienteSeleccionadoId)       { toast("Introduce el nombre del cliente","error"); return; }
  if (tipoCliente==="empresa"&&!clienteNif&&!clienteSeleccionadoId)
                                                      { toast("El NIF es obligatorio para empresas","error"); return; }
  if (tipoCliente==="empresa"&&!clienteDir&&!clienteSeleccionadoId)
                                                      { toast("La dirección fiscal es obligatoria para empresas","error"); return; }

  const fobj = new Date(fecha);
  const year = fobj.getFullYear();
  const trim = "T"+(Math.floor(fobj.getMonth()/3)+1);
  if (await isCerrado(year,trim)) { toast(`El trimestre ${trim} de ${year} está cerrado`,"error"); return; }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry  = Object.entries(ivaMap).sort(([,a],[,b])=>b-a)[0];
  const ivaMain   = ivaEntry ? parseInt(ivaEntry[0]) : 0;
  const concepto  = LINEAS.filter(l=>l.descripcion).map(l=>l.descripcion).join(" · ") || "Factura";

  const btn = document.getElementById("nfEmitirBtn");
  if (btn) { btn.disabled=true; btn.innerHTML=`<span class="spin"></span> Emitiendo factura…`; }

  // Crear cliente nuevo si procede
  let cId = clienteSeleccionadoId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif,
      tipo: tipoCliente, pais, direccion: clienteDir,
      nombre_comercial: clienteNombreC || null,
      tipo_empresa:     clienteTipoEmp || null,
      ciudad:           clienteCiudad || null,
      provincia:        clienteProvincia || null,
      codigo_postal:    clienteCp || null,
      email:            clienteEmail || null,
      telefono:         clienteTel || null,
      emails:           clienteEmail ? [clienteEmail] : null,
      telefonos:        clienteTel   ? [clienteTel]   : null,
    }).select().single();
    if (ce) { toast("Error creando cliente: "+ce.message,"warn"); }
    else    { cId=nc.id; await refreshClientes(); }
  }

  const resolvedNombre = cId ? (CLIENTES.find(c=>c.id===cId)?.nombre||clienteNombre) : clienteNombre;
  const resolvedNif    = cId ? (CLIENTES.find(c=>c.id===cId)?.nif   ||clienteNif)    : clienteNif;
  const resolvedDir    = cId ? (CLIENTES.find(c=>c.id===cId)?.direccion||clienteDir)  : clienteDir;

  // Crear factura como borrador temporal para que emitirFacturaDB pueda asignar número
  const { data: fData, error } = await supabase.from("facturas").insert({
    user_id: SESSION.user.id, concepto, base: baseTotal,
    iva: ivaMain, irpf_retencion: irpf, tipo, fecha,
    tipo_operacion: opTipoActual, estado: "borrador",
    tipo_cliente: tipoCliente, cliente_id: cId,
    cliente_nombre: resolvedNombre, cliente_nif: resolvedNif,
    cliente_direccion: resolvedDir,
    cliente_pais: pais,
    notas: (() => {
      const motivoExencion = document.getElementById("nfMotivoExencion")?.value.trim();
      if (opTipoActual === "exento" && motivoExencion) {
        return notas ? notas + "\n\nMotivo de exención: " + motivoExencion : "Motivo de exención: " + motivoExencion;
      }
      return notas;
    })(),
    lineas: JSON.stringify(LINEAS.map(l=>({
      descripcion: l.descripcion, cantidad: l.cantidad,
      precio: l.precio, iva: l.iva,
      descuento: l.descuento ?? "",
      subtotal: Math.max(0, l.cantidad*l.precio - _parseDescuento(l.descuento, l.cantidad*l.precio)),
      tipo: l.tipo || "servicio"
    }))),
  }).select().single();
  // Intentar guardar plantilla_id; si la columna no existe, ignorar silenciosamente
  const _nfPlantillaId = document.getElementById("nfPlantillaSel")?.value || null;
  if (!error && fData?.id && _nfPlantillaId) {
    const { error: pe } = await supabase.from("facturas")
      .update({ plantilla_id: _nfPlantillaId }).eq("id", fData.id);
    if (pe && !pe.message?.includes("plantilla_id") && !pe.message?.includes("schema cache")) {
      console.warn("plantilla_id factura:", pe.message);
    }
  }

  if (error) {
    if (btn) { btn.disabled=false; btn.innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Emitir factura`; }
    toast("Error guardando: "+error.message,"error"); return;
  }

  // Emitir directamente — asignar número definitivo
  if (fData) {
    try {
      const num = await emitirFacturaDB(fData.id);
      toast(`✅ Factura emitida: ${num}`,"success");
    } catch(e) {
      toast("Error al emitir: "+e.message,"error");
    }
  }

  // Reset formulario
  resetForm();
  if (btn) {
    btn.disabled=false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Emitir factura`;
  }
  await refreshDashboard(); await refreshFacturas();
  switchView("facturas");
}

function resetForm() {
  LINEAS=[]; lineaIdCounter=0; clienteSeleccionadoId=null; opTipoActual="nacional";
  document.getElementById("lineasContainer").innerHTML="";
  ["nfNombre","nfNif","nfDireccion","nfNotas","nfNombreComercial",
   "nfCiudad","nfProvincia","nfCp","nfEmailCliente","nfTelCliente"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
  const nfTEmp = document.getElementById("nfTipoEmpresa"); if(nfTEmp) nfTEmp.value="";
  const nfPais = document.getElementById("nfPais"); if(nfPais) nfPais.value="ES";
  const nfTipo = document.getElementById("nfTipoCliente"); if(nfTipo) nfTipo.value="empresa";
  const csi=document.getElementById("clienteSearchInput"); if(csi) csi.value="";
  const clb=document.getElementById("clienteLimpiarBtn"); if(clb) clb.style.display="none";
  document.getElementById("nfClientePanel")?.classList.remove("cliente-panel--filled");
  document.getElementById("nfFecha").value=new Date().toISOString().slice(0,10);
  document.getElementById("nfGuardarCliente").checked=false;
  document.querySelectorAll(".op-type-btn").forEach(b=>b.classList.remove("active"));
  document.querySelector(".op-type-btn[data-op='nacional']")?.classList.add("active");
  updateOpUI(); addLinea(); updatePreview();
}


/* ══════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════ */
async function _nfInitPlantillaSelector() {
  const sel   = document.getElementById("nfPlantillaSel");
  const badge = document.getElementById("nfPlantillaDefaultBadge");
  if (!sel) return;

  // Mostrar estado de carga
  sel.innerHTML = `<option value="">Cargando plantillas…</option>`;
  sel.disabled = true;

  // Cargar siempre desde Supabase para garantizar datos frescos
  let plantillas = [];
  try {
    const { data, error } = await supabase
      .from("plantillas_usuario")
      .select("id, nombre, es_default, cols_activas, cols_pct")
      .eq("user_id", SESSION.user.id)
      .order("nombre");
    if (error) throw error;
    plantillas = data || [];
    // Sincronizar con el array global para que getPlantillaData funcione
    if (plantillas.length) {
      plantillas.forEach(p => {
        const idx = PLANTILLAS.findIndex(x => x.id === p.id);
        if (idx === -1) PLANTILLAS.push(p);
        else PLANTILLAS[idx] = { ...PLANTILLAS[idx], ...p };
      });
    }
    console.log("[Plantillas] cargadas para selector:", plantillas.length, plantillas.map(p=>p.nombre));
  } catch(e) {
    console.error("[Plantillas] error cargando:", e.message);
  }

  sel.disabled = false;

  if (!plantillas.length) {
    sel.innerHTML = `<option value="">— Sin plantillas guardadas —</option>`;
    if (badge) badge.style.display = "none";
    return;
  }

  const defP = plantillas.find(p => p.es_default) || plantillas[0];

  sel.innerHTML = [
    `<option value="">— Sin plantilla —</option>`,
    ...plantillas.map(p => {
      const tag = p.es_default ? " ⭐ Predeterminada" : "";
      return `<option value="${p.id}" ${defP?.id===p.id?"selected":""}>${p.nombre}${tag}</option>`;
    })
  ].join("");

  const _updBadge = (id) => {
    if (!badge) return;
    const p = plantillas.find(x => x.id === id);
    badge.style.display = (p?.es_default) ? "inline" : "none";
  };

  if (defP) {
    _updBadge(defP.id);
    _applyPlantillaToFactura(_nfGetPlantillaDataLocal(defP));
  }

  sel.addEventListener("change", () => {
    const id = sel.value;
    _updBadge(id);
    if (!id) {
      nfPlantillaActual = null;
      _nfColsActivas = [..._DEFAULT_COLS];
      _nfApplyGridToHeader();
      _nfRebuildAllRows();
      return;
    }
    const p = plantillas.find(x => x.id === id);
    if (p) _applyPlantillaToFactura(_nfGetPlantillaDataLocal(p));
  });
}

// Obtiene los datos de plantilla desde el objeto ya cargado (sin buscar en PLANTILLAS global)
function _nfGetPlantillaDataLocal(p) {
  if (!p) return null;
  let colsActivas = [];
  try {
    const raw = p.cols_activas
      ? (typeof p.cols_activas === "string" ? JSON.parse(p.cols_activas) : p.cols_activas)
      : null;
    if (Array.isArray(raw)) {
      colsActivas = raw.map(c => typeof c === "object" ? c.key : c);
    }
  } catch(e) {}
  return { id: p.id, colsActivas };
}

function _nfGetPlantillaData(id) {
  const p = (PLANTILLAS||[]).find(x => x.id === id);
  return _nfGetPlantillaDataLocal(p);
}


window._applyPlantillaToFactura = function(data) {
  if (!data) return;
  nfPlantillaActual = data;
  const colsActivas = (data.colsActivas || []).filter(k => _COL_SCHEMA[k]);
  _nfColsActivas = colsActivas.length ? colsActivas : [..._DEFAULT_COLS];
  // Asegurarse de que descripcion siempre está primero
  if (!_nfColsActivas.includes("descripcion")) _nfColsActivas.unshift("descripcion");
  // IVA: no forzar — la plantilla del usuario decide si incluirla o no.
  // Reconstruir el header
  _nfApplyGridToHeader();
  // Reconstruir todas las filas con el nuevo grid (sin perder datos)
  _nfRebuildAllRows();
};

function _nfRebuildAllRows() {
  const container = document.getElementById("lineasContainer");
  if (!container) return;
  // Guardar datos actuales
  const snapshots = LINEAS.map(l => ({...l}));
  // Vaciar y recrear
  container.innerHTML = "";
  LINEAS = [];
  lineaIdCounter = 0;
  snapshots.forEach(snap => addLinea(snap));
  updateTotalesUI(); updatePreview();
}

/* ══════════════════════════
   INIT
══════════════════════════ */
// ── Descuento global ──
function _nfRestoreDto(raw){
  const f=document.getElementById("nfDtoFields"),t=document.getElementById("nfDtoToggle"),
        tp=document.getElementById("nfDtoTipo"),v=document.getElementById("nfDtoValor");
  if(!raw){if(f)f.style.display="none";if(t)t.textContent="+ Añadir descuento";if(v)v.value="";return;}
  const isPct=raw.endsWith("%");if(tp)tp.value=isPct?"pct":"eur";if(v)v.value=isPct?raw.slice(0,-1):raw;
  if(f)f.style.display="";if(t)t.textContent="− Quitar descuento";updateTotalesUI();
}
window._nfToggleDto=function(){
  const f=document.getElementById("nfDtoFields"),t=document.getElementById("nfDtoToggle");
  if(!f)return;const open=f.style.display!=="none";
  f.style.display=open?"none":"";t.textContent=open?"+ Añadir descuento":"− Quitar descuento";
  if(open){const v=document.getElementById("nfDtoValor");if(v)v.value="";updateTotalesUI();}
  else setTimeout(()=>document.getElementById("nfDtoValor")?.focus(),50);
};
window._nfClearDto=function(){
  const v=document.getElementById("nfDtoValor");if(v)v.value="";
  const f=document.getElementById("nfDtoFields");if(f)f.style.display="none";
  const t=document.getElementById("nfDtoToggle");if(t)t.textContent="+ Añadir descuento";
  updateTotalesUI();
};
export function initNuevaFactura() {
  const fechaEl = document.getElementById("nfFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value=new Date().toISOString().slice(0,10);
  loadPerfilForPreview();

  // Descuento global — listeners registrados aquí (DOM garantizado)
  document.getElementById("nfDtoValor")?.addEventListener("input",  updateTotalesUI);
  document.getElementById("nfDtoTipo")?.addEventListener("change",  updateTotalesUI);

  document.querySelectorAll(".op-type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".op-type-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      opTipoActual = btn.dataset.op;
      updateOpUI();
      const sinIva = OP_SIN_IVA.includes(opTipoActual);
      if (sinIva) {
        LINEAS.forEach(l=>{ l.iva=0; });
        document.querySelectorAll("#lineasContainer [data-field='iva']").forEach(sel=>{ sel.value="0"; sel.disabled=true; });
        updateTotalesUI();
      } else {
        document.querySelectorAll("#lineasContainer [data-field='iva']").forEach(sel=>{ sel.disabled=false; });
      }
      updatePreview();
    });
  });

  initClienteSearch();
  initIrpfToggle();
  ["nfNombre","nfNif","nfDireccion","nfFecha","nfNotas"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });
  document.getElementById("nfTipoCliente")?.addEventListener("change", updateIrpfVisibility);
  document.getElementById("addLineaBtn")?.addEventListener("click", ()=>addLinea());

  // ══════════════════════════════════════════════════
  // ESCÁNER en Nueva Factura — igual que en presupuestos
  // ══════════════════════════════════════════════════
  const nfScanInput    = document.getElementById("nfScanInput");
  const nfScanFeedback = document.getElementById("nfScanFeedback");

  const nfProcesarCodigo = () => {
    const codigo = nfScanInput?.value.trim().replace(/[\r\n\t]/g,"");
    if (!codigo) return;
    const prod = buscarProductoPorCodigo ? buscarProductoPorCodigo(codigo) : null;
    const qty  = Math.max(1, parseInt(document.getElementById("nfScanQty")?.value)||1);

    if (prod) {
      // Buscar línea existente con mismo nombre para sumar cantidad
      let yaExiste = false;
      LINEAS.forEach(l => {
        if (l.descripcion === (prod.descripcion||prod.nombre)) {
          l.cantidad += qty;
          const row = document.querySelector(`.linea-row[data-linea-id="${l.id}"]`);
          if (row) {
            const qEl = row.querySelector("[data-field='cantidad']");
            if (qEl) { qEl.value = l.cantidad; }
          }
          yaExiste = true;
        }
      });
      if (!yaExiste) addLinea({ descripcion: prod.descripcion||prod.nombre, cantidad: qty, precio: prod.precio, iva: prod.iva });
      updateTotalesUI(); updatePreview();
      if (nfScanFeedback) {
        nfScanFeedback.style.color="#059669"; nfScanFeedback.style.opacity="1";
        nfScanFeedback.textContent=`✅ ${yaExiste?"Cantidad actualizada":"Añadido"}: ${prod.nombre}${qty>1?" × "+qty:""} — ${fmt(prod.precio)}`;
        setTimeout(()=>{ if(nfScanFeedback) nfScanFeedback.style.opacity="0"; },3000);
      }
      try {
        const ctx=new(window.AudioContext||window.webkitAudioContext)();
        const osc=ctx.createOscillator(); const g=ctx.createGain();
        osc.connect(g); g.connect(ctx.destination); osc.frequency.value=880;
        g.gain.setValueAtTime(0.15,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.12);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.12);
      } catch(e){}
    } else {
      if (nfScanFeedback) {
        nfScanFeedback.style.color="#dc2626"; nfScanFeedback.style.opacity="1";
        nfScanFeedback.textContent=`❌ Código "${codigo}" no encontrado`;
        setTimeout(()=>{ if(nfScanFeedback) nfScanFeedback.style.opacity="0"; },3000);
      }
      if(nfScanInput){ nfScanInput.style.borderColor="#dc2626"; nfScanInput.style.background="#fef2f2"; setTimeout(()=>{ nfScanInput.style.borderColor=""; nfScanInput.style.background=""; },1200); }
    }
    if(nfScanInput){ nfScanInput.value=""; nfScanInput.focus(); }
  };

  nfScanInput?.addEventListener("keydown", e => { if(e.key==="Enter"){ e.preventDefault(); nfProcesarCodigo(); } });
  nfScanInput?.addEventListener("focus", () => {
    if(nfScanFeedback){ nfScanFeedback.style.color="var(--t3)"; nfScanFeedback.style.opacity="1"; nfScanFeedback.textContent="🎯 Listo para escanear"; }
  });
  nfScanInput?.addEventListener("blur", () => { if(nfScanFeedback) nfScanFeedback.style.opacity="0"; });
  document.getElementById("nfEmitirBtn")?.addEventListener("click",  ()=>saveFactura());
  if (LINEAS.length===0) addLinea();
  _nfApplyGridToHeader();
  _nfInitPlantillaSelector();
}

// Exponer para que main.js o switchView puedan refrescar el selector al abrir la vista
window._nfRefreshPlantillaSel = () => _nfInitPlantillaSelector();
