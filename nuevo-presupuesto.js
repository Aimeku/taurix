/* ═══════════════════════════════════════════════════════
   TAURIX · nuevo-presupuesto.js
   Vista completa de creación de presupuesto (como nueva-factura)
   ─ Líneas, preview en vivo, guardar cliente, plantillas
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, switchView, OP_INFO, OP_SIN_IVA, OP_IVA_NO_REPERCUTIDO
} from "./utils.js";
import { PRODUCTOS, buscarProductoPorCodigo, refreshProductos } from "./productos.js";
import { PLANTILLAS, getPlantillaDefault } from "./plantillas-usuario.js";
import { refreshPresupuestos } from "./presupuestos.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";
import { getNextDocumentNumber } from "./numeracion-docs.js";
import { renderSedeSelector, readSedeIdFromForm } from "./sedes.js";

let LINEAS = [];
let lineaIdCounter = 0;
let clienteSeleccionadoId = null;
let npPlantillaActual = null;
let npOpTipoActual = "nacional";

/* ── Descuento global sobre subtotal ── */
let _dtoGlobal = { tipo: "pct", valor: 0 };

/* ══════════════════════════
   TOTALES
══════════════════════════ */
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

/* ══════════════════════════
   TIPO DE OPERACIÓN
══════════════════════════ */
function updateNpOpUI() {
  const banner = document.getElementById("npOpInfoBanner");
  const exencionWrap = document.getElementById("npExencionWrap");
  if (banner) {
    banner.textContent = OP_INFO[npOpTipoActual] || "";
    banner.classList.toggle("visible", !!OP_INFO[npOpTipoActual]);
  }
  if (exencionWrap) exencionWrap.style.display = npOpTipoActual === "exento" ? "" : "none";
}

function getLineasTotales() {
  let baseSinDtoGlobal = 0;
  const ivaMap = {};
  LINEAS.forEach(l => {
    const subtotalBruto = l.cantidad * l.precio;
    const descAmt       = _parseDescuento(l.descuento, subtotalBruto);
    const subtotal      = Math.max(0, subtotalBruto - descAmt);
    baseSinDtoGlobal += subtotal;
  });
  // Descuento global
  let dtoGlobalAmt = 0;
  if (_dtoGlobal.valor > 0) {
    dtoGlobalAmt = _dtoGlobal.tipo === "pct"
      ? baseSinDtoGlobal * _dtoGlobal.valor / 100
      : Math.min(_dtoGlobal.valor, baseSinDtoGlobal);
    dtoGlobalAmt = Math.max(0, dtoGlobalAmt);
  }
  const baseTotal = Math.max(0, baseSinDtoGlobal - dtoGlobalAmt);
  const ratio     = baseSinDtoGlobal > 0 ? baseTotal / baseSinDtoGlobal : 0;
  LINEAS.forEach(l => {
    const subtotalBruto = l.cantidad * l.precio;
    const descAmt       = _parseDescuento(l.descuento, subtotalBruto);
    const subtotalLinea = Math.max(0, subtotalBruto - descAmt);
    const ivaAmt        = subtotalLinea * ratio * l.iva / 100;
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + ivaAmt;
  });
  const ivaTotal   = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  const ivaEnTotal = OP_IVA_NO_REPERCUTIDO.includes(npOpTipoActual) ? 0 : ivaTotal;
  const npToggle   = document.getElementById("npIrpfToggle");
  const irpfPct    = npToggle?.checked ? (parseInt(document.getElementById("npIrpfSel")?.value) || 0) : 0;
  const irpfAmt    = baseTotal * irpfPct / 100;
  const total      = baseTotal + ivaEnTotal - irpfAmt;
  return { baseSinDtoGlobal, dtoGlobalAmt, baseTotal, ivaMap, ivaTotal, irpfPct, irpfAmt, total };
}
function updateTotalesUI() {
  const { dtoGlobalAmt, baseTotal, ivaTotal, irpfPct, irpfAmt, total } = getLineasTotales();
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("npBase", fmt(baseTotal));
  s("npIva",  fmt(ivaTotal));
  s("npTotal", fmt(total));
  // Fila retención IRPF
  const npIrpfRow = document.getElementById("npIrpfRow");
  if (npIrpfRow) npIrpfRow.style.display = irpfPct > 0 ? "" : "none";
  s("npIrpfLbl", `Retención IRPF (${irpfPct}%)`);
  s("npIrpfVal", `−${fmt(irpfAmt)}`);
  // Fila dto global
  const npDtoRow = document.getElementById("npDtoGlobalRow");
  if (npDtoRow) {
    if (dtoGlobalAmt > 0) {
      npDtoRow.style.display = "";
      const lbl = document.getElementById("npDtoGlobalLbl");
      const val = document.getElementById("npDtoGlobalVal");
      if (lbl) lbl.textContent = _dtoGlobal.tipo === "pct" ? `Dto. global (−${_dtoGlobal.valor}%)` : "Dto. global";
      if (val) val.textContent = `−${fmt(dtoGlobalAmt)}`;
    } else {
      npDtoRow.style.display = "none";
    }
  }
  // Ocultar fila IVA cuando la operación no repercute IVA al total
  const ivaRow = document.getElementById("npIvaRow");
  if (ivaRow) {
    const mostrarIva = !OP_SIN_IVA.includes(npOpTipoActual) || OP_IVA_NO_REPERCUTIDO.includes(npOpTipoActual);
    ivaRow.style.display = mostrarIva ? "" : "none";
  }
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
              ${p.sku ? `<div class="csd-meta" style="font-family:monospace">SKU: ${p.sku}</div>` : ""}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio_venta)}</div>
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
        (p.sku || "").toLowerCase().includes(q)
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
  precio:      { label:"Subtotal",     fr:1.0, minW:72,  align:"right", inputType:"number", dataField:"precio",    step:"0.01", placeholder:"0.00" },
  descuento:   { label:"Dto.",         fr:0.8, minW:60,  align:"right", inputType:"text",   dataField:"descuento", placeholder:"10%/5€" },
  codigo:      { label:"Código",       fr:0.7, minW:55,  align:"left",  inputType:"text",   dataField:"codigo" },
  coeficiente: { label:"Coef.",        fr:0.6, minW:50,  align:"right", inputType:"number", dataField:"coeficiente", step:"0.01" },
  iva:         { label:"IVA",          fr:0.6, minW:56,  align:"right", inputType:"select", dataField:"iva" },
  total:       { label:"Total",        fr:0.9, minW:68,  align:"right", inputType:null,     dataField:null },
};
const _COL_DEL     = { fr:0.28, minW:28 };
const _DEFAULT_COLS = ["descripcion","cantidad","precio","iva","total"];

/* ── Sistema de grid dinámico para NP ── */
let _npColsActivas = [..._DEFAULT_COLS];

function _npGridStr() {
  const frParts = _npColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    return c ? `minmax(${c.minW}px, ${c.fr}fr)` : "1fr";
  });
  frParts.push(`${_COL_DEL.minW}px`);
  return frParts.join(" ");
}

function _npApplyGridToHeader() {
  const hdr = document.getElementById("npLineasHeader");
  if (!hdr) return;
  hdr.style.gridTemplateColumns = _npGridStr();
  hdr.innerHTML = _npColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    const lbl = c?.label || k;
    const right = c?.align === "right";
    return `<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;${right?"text-align:right":""};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${lbl}</div>`;
  }).join("") + `<div></div>`;
}

function _npApplyGridToRow(row) {
  row.style.display = "grid";
  row.style.gridTemplateColumns = _npGridStr();
  row.style.gap = "4px";
  row.style.alignItems = "center";
  row.style.padding = "4px 0";
  row.style.borderBottom = "1px solid var(--brd)";
}

function _npReapplyGridToAllRows() {
  document.querySelectorAll("#npLineasContainer .linea-row").forEach(row => {
    _npApplyGridToRow(row);
  });
}

function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const sinIva = OP_SIN_IVA.includes(npOpTipoActual);
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         sinIva ? 0 : (prefill.iva !== undefined ? prefill.iva : 21),
    descuento:   prefill.descuento   ?? "",
    codigo:      prefill.codigo      ?? "",
    coeficiente: prefill.coeficiente ?? "",
  };
  LINEAS.push(linea);

  const container = document.getElementById("npLineasContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "linea-row";
  row.dataset.lineaId = id;

  row.innerHTML = _npColsActivas.map(k => {
    const c = _COL_SCHEMA[k];
    if (!c) return `<div></div>`;
    const align = c.align === "right" ? "text-align:right" : "";
    const baseStyle = `width:100%;box-sizing:border-box;${align}`;

    if (k === "total") {
      return `<div class="linea-total" id="npLtRow${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
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
    const val = linea[k] !== undefined ? linea[k] : "";
    const type = c.inputType || "text";
    const extras = [
      c.step        ? `step="${c.step}"` : "",
      c.min         ? `min="${c.min}"`   : "",
      c.placeholder ? `placeholder="${c.placeholder}"` : "",
    ].filter(Boolean).join(" ");
    return `<input autocomplete="off" type="${type}" class="ff-input" data-field="${k}" value="${val}" ${extras} style="${baseStyle}"/>`;
  }).join("") +
  `<button class="linea-del" onclick="window._npDelLinea(${id})" title="Eliminar línea" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  _npApplyGridToRow(row);

  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => onLineaChange(id, el));
    el.addEventListener("change", () => onLineaChange(id, el));
  });

  const descInput = row.querySelector("[data-field='descripcion']");
  if (descInput) {
    _buildProdDropdown(descInput, (p) => {
      const linea = LINEAS.find(l => l.id === id);
      if (!linea) return;
      linea.descripcion = p.descripcion || p.nombre;
      linea.precio      = p.precio_venta;
      linea.iva         = p.iva;
      linea.producto_id = p.id;
      const f = (field, val) => { const el=row.querySelector(`[data-field="${field}"]`); if(el) el.value=val; };
      f("descripcion", linea.descripcion);
      f("precio", linea.precio);
      f("iva", linea.iva);
      document.getElementById(`npLtRow${id}`).textContent = fmt(linea.cantidad * linea.precio);
      updateTotalesUI(); updatePreview();
      _actualizarVisibilidadReducirStock("npReducirStockWrap");
    });
  }

  container.appendChild(row);
  updateTotalesUI();
  updatePreview();
  _actualizarVisibilidadReducirStock("npReducirStockWrap");
  // No auto-focus: el usuario elige por dónde empezar
}

function onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if (field === "descripcion")    linea.descripcion = el.value;
  else if (field === "cantidad")  linea.cantidad    = parseFloat(el.value) || 0;
  else if (field === "precio")    linea.precio      = parseFloat(el.value) || 0;
  else if (field === "iva")       linea.iva         = parseInt(el.value)   || 0;
  else if (field === "descuento") linea.descuento   = el.value;
  const subtotalBruto = linea.cantidad * linea.precio;
  const descAmt       = _parseDescuento(linea.descuento, subtotalBruto);
  const subtotalNeto  = Math.max(0, subtotalBruto - descAmt);
  const rowTotal = document.getElementById(`npLtRow${id}`);
  if (rowTotal) rowTotal.textContent = fmt(subtotalNeto);
  const rowSub = document.querySelector(`.linea-row[data-linea-id="${id}"] [data-subtotal="${id}"]`);
  if (rowSub) rowSub.textContent = fmt(subtotalBruto);
  updateTotalesUI(); updatePreview();
}

window._npDelLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  updateTotalesUI(); updatePreview();
};

/* ══════════════════════════
   PREVIEW
══════════════════════════ */
function updatePreview() {
  const nombre = document.getElementById("npClienteNombre")?.value || "—";
  const nif = document.getElementById("npClienteNif")?.value || "";
  const fecha = document.getElementById("npFecha")?.value || "—";
  const concepto = document.getElementById("npConcepto")?.value || "—";
  const { baseTotal, ivaTotal, irpfPct, irpfAmt, total } = getLineasTotales();

  const previewEl = document.getElementById("npPreviewContent");
  if (!previewEl) return;

  previewEl.innerHTML = `
    <div style="padding:16px 20px;background:var(--sb);color:#fff;border-radius:10px 10px 0 0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><div style="font-size:11px;font-weight:800;letter-spacing:.1em;opacity:.5">PRESUPUESTO</div></div>
        <div style="text-align:right"><div style="font-size:11px;opacity:.5">${fmtDate(fecha)}</div></div>
      </div>
    </div>
    <div style="padding:14px 20px">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;color:var(--t4);letter-spacing:.1em;margin-bottom:4px">Cliente</div>
      <div style="font-size:14px;font-weight:700">${nombre}</div>
      ${nif ? `<div style="font-size:11px;color:var(--t3)">${nif}</div>` : ""}
    </div>
    <div style="padding:0 20px 14px">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;color:var(--t4);letter-spacing:.1em;margin-bottom:4px">Concepto</div>
      <div style="font-size:13px">${concepto}</div>
    </div>
    ${LINEAS.length ? `<div style="padding:0 20px">
      ${LINEAS.filter(l => l.descripcion || l.precio > 0).map(l => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--brd);font-size:12px">
          <span>${l.descripcion || "—"}</span>
          <span class="mono fw7">${fmt(l.cantidad * l.precio)}</span>
        </div>`).join("")}
    </div>` : ""}
    <div style="padding:14px 20px;background:var(--srf2);border-radius:0 0 10px 10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-bottom:4px">
        <span>Base</span><span>${fmt(baseTotal)}</span>
      </div>
      ${(!OP_SIN_IVA.includes(npOpTipoActual) || OP_IVA_NO_REPERCUTIDO.includes(npOpTipoActual)) ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-bottom:4px">
        <span>IVA</span><span>${fmt(ivaTotal)}</span>
      </div>` : ""}
      ${irpfPct > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#dc2626;margin-bottom:4px">
        <span>Retención IRPF (${irpfPct}%)</span><span>−${fmt(irpfAmt)}</span>
      </div>` : ""}
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:var(--t1);border-top:2px solid var(--brd);padding-top:8px">
        <span>TOTAL</span><span>${fmt(total)}</span>
      </div>
    </div>`;
}

/* ══════════════════════════
   GUARDAR PRESUPUESTO
══════════════════════════ */

/* ── Descuento de stock al guardar (si el checkbox está marcado) ── */
async function _descontarStockSiProcede(checkboxId, docRef = null) {
  if (!document.getElementById(checkboxId)?.checked) return;
  try {
    const { descontarStockPorVenta } = await import("./stock-sedes.js");
    const sedeId = document.getElementById("npSedeId")?.value || null;
    await descontarStockPorVenta(LINEAS, sedeId, docRef, "presupuesto");
  } catch (e) {
    console.warn("[stock presupuesto]", e);
  }
  refreshProductos().catch(() => {});
}

/* ── Mostrar/ocultar el checkbox según haya líneas con producto_id ── */
function _actualizarVisibilidadReducirStock(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const tieneProductos = LINEAS.some(l => l.producto_id);
  wrap.style.display = tieneProductos ? "flex" : "none";
}

async function savePresupuesto() {
  const concepto = document.getElementById("npConcepto")?.value.trim();
  const fecha = document.getElementById("npFecha")?.value;
  const condicionesPago  = document.getElementById("npCondicionesPago")?.value.trim() || null;
  const iban             = document.getElementById("npIban")?.value.trim() || null;
  const titularCuenta    = document.getElementById("npTitularCuenta")?.value.trim() || null;
  if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) { toast("Añade al menos una línea con precio", "error"); return; }
  if ((document.getElementById("npPlantillaSel")?.value || "none") === "none") { toast("Debes seleccionar una plantilla antes de guardar. Crea una desde la sección Plantillas.", "error"); return; }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry = Object.entries(ivaMap).sort(([, a], [, b]) => b - a)[0];
  const ivaMain = ivaEntry ? parseInt(ivaEntry[0]) : 21;

  const clienteNombre          = document.getElementById("npClienteNombre")?.value.trim();
  const clienteNombreComercial = document.getElementById("npClienteNombreComercial")?.value.trim();
  const clienteNif    = document.getElementById("npClienteNif")?.value.trim();
  const clienteDir    = document.getElementById("npClienteDir")?.value.trim();
  const clienteEmail  = document.getElementById("npClienteEmail")?.value.trim();
  const clienteTel    = document.getElementById("npClienteTel")?.value.trim();
  const clientePais   = document.getElementById("npClientePais")?.value || "ES";
  const clienteTipo   = document.getElementById("npClienteTipo")?.value || "empresa";
  const clienteCiudad = document.getElementById("npClienteCiudad")?.value.trim();
  const clienteProv   = document.getElementById("npClienteProvincia")?.value.trim();
  const clienteCp     = document.getElementById("npClienteCp")?.value.trim();
  const guardarCliente = document.getElementById("npGuardarCliente")?.checked;

  const btn = document.getElementById("npGuardarBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Guardando…`; }

  // Guardar cliente si es nuevo y se marcó
  let cId = clienteSeleccionadoId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif || null,
      direccion: clienteDir || null, pais: clientePais, tipo: clienteTipo,
      ciudad: clienteCiudad || null, provincia: clienteProv || null,
      codigo_postal: clienteCp || null,
      email: clienteEmail || null, telefono: clienteTel || null,
      emails:    clienteEmail ? [clienteEmail] : null,
      telefonos: clienteTel   ? [clienteTel]   : null,
    }).select().single();
    if (!ce && nc) { cId = nc.id; await refreshClientes(); }
  }

  const clienteObj = cId ? CLIENTES.find(c => c.id === cId) : null;

  const lineasJson = JSON.stringify(LINEAS.map(l => ({
    descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, iva: l.iva,
    descuento: l.descuento ?? "",
    subtotal: Math.max(0, l.cantidad*l.precio - _parseDescuento(l.descuento, l.cantidad*l.precio)),
    producto_id: l.producto_id || null,
  })));

  const npIrpfToggleEl = document.getElementById("npIrpfToggle");
  const npIrpfSelEl    = document.getElementById("npIrpfSel");
  const irpfRetencion  = npIrpfToggleEl?.checked ? (parseInt(npIrpfSelEl?.value) || null) : null;

  const payload = {
    concepto, fecha,
    fecha_validez: document.getElementById("npValidez")?.value || null,
    sede_id: readSedeIdFromForm("npSedeId"),
    cliente_id: cId || null,
    cliente_nombre:           clienteNombre           || clienteObj?.nombre           || "",
    cliente_nombre_comercial: clienteNombreComercial  || clienteObj?.nombre_comercial || null,
    cliente_nif:              clienteNif              || clienteObj?.nif              || "",
    cliente_direccion:        clienteDir              || clienteObj?.direccion        || "",
    cliente_email:            clienteEmail            || clienteObj?.email            || null,
    cliente_tel:              clienteTel              || clienteObj?.telefono         || null,
    cliente_ciudad:           clienteCiudad           || clienteObj?.ciudad          || null,
    cliente_provincia:        clienteProv             || clienteObj?.provincia        || null,
    cliente_cp:               clienteCp               || clienteObj?.codigo_postal    || null,
    descuento_global: _dtoGlobal.valor > 0 ? JSON.stringify({ tipo: _dtoGlobal.tipo, valor: _dtoGlobal.valor }) : null,
    condiciones_pago:  condicionesPago,
    iban:              iban,
    titular_cuenta:    titularCuenta,
    base: baseTotal,
    iva: ivaMain,
    lineas: lineasJson,
    notas: (() => {
      const motivoExencion = document.getElementById("npMotivoExencion")?.value.trim();
      const notasVal = document.getElementById("npNotas")?.value.trim() || null;
      if (npOpTipoActual === "exento" && motivoExencion) {
        return notasVal ? notasVal + "\n\nMotivo de exención: " + motivoExencion : "Motivo de exención: " + motivoExencion;
      }
      return notasVal;
    })(),
    tipo_operacion: npOpTipoActual,
  };
  const _npPlantillaId = document.getElementById("npPlantillaSel")?.value || "none";

  // ── MODO EDICIÓN: UPDATE manteniendo el mismo número ──────
  const editingId = window._npEditingId || null;
  if (editingId) {
    const numero = window._npEditingNumero;
    const _updateExtras = { plantilla_id: _npPlantillaId, ...(irpfRetencion != null ? { irpf_retencion: irpfRetencion } : {}) };
    let { error } = await supabase.from("presupuestos")
      .update({ ...payload, ..._updateExtras }).eq("id", editingId);
    if (error && (error.message?.includes("plantilla_id") || error.message?.includes("irpf_retencion") || error.message?.includes("schema cache"))) {
      ({ error } = await supabase.from("presupuestos").update(payload).eq("id", editingId));
    }
    if (error) {
      if (btn) { btn.disabled = false; btn.textContent = "Actualizar presupuesto"; }
      toast("Error: " + error.message, "error"); return;
    }
    window._npEditingId = null;
    window._npEditingNumero = null;
    await _descontarStockSiProcede("npReducirStock");
    toast(`✅ Presupuesto ${numero} actualizado`, "success");
    resetForm();
    if (btn) { btn.disabled = false; btn.textContent = "Guardar presupuesto"; }
    await refreshPresupuestos();
    switchView("presupuestos");
    return;
  }

  // ── MODO CREACIÓN: INSERT con nuevo número ─────────────────
  const numero = await getNextDocumentNumber('presupuesto', fecha);

  const _insertExtras = { plantilla_id: _npPlantillaId, ...(irpfRetencion != null ? { irpf_retencion: irpfRetencion } : {}) };
  let { error: _npErr } = await supabase.from("presupuestos").insert({
    user_id: SESSION.user.id, numero, estado: "borrador", ...payload, ..._insertExtras,
  });
  if (_npErr && (_npErr.message?.includes("plantilla_id") || _npErr.message?.includes("irpf_retencion") || _npErr.message?.includes("schema cache"))) {
    ({ error: _npErr } = await supabase.from("presupuestos").insert({
      user_id: SESSION.user.id, numero, estado: "borrador", ...payload,
    }));
  }
  const error = _npErr;

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = "Guardar presupuesto"; }
    toast("Error: " + error.message, "error"); return;
  }

  await _descontarStockSiProcede("npReducirStock");
  toast(`✅ Presupuesto ${numero} creado`, "success");
  resetForm();
  if (btn) { btn.disabled = false; btn.textContent = "Guardar presupuesto"; }
  await refreshPresupuestos();
  switchView("presupuestos");
}

function resetForm() {
  LINEAS = []; lineaIdCounter = 0; clienteSeleccionadoId = null;
  const container = document.getElementById("npLineasContainer");
  if (container) container.innerHTML = "";
  ["npClienteNombre", "npClienteNombreComercial", "npClienteNif", "npClienteDir", "npClienteEmail", "npClienteTel",
   "npClienteCiudad", "npClienteProvincia", "npClienteCp", "npConcepto", "npNotas"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const csi = document.getElementById("npClienteSearch"); if (csi) csi.value = "";
  document.getElementById("npFecha").value = new Date().toISOString().slice(0, 10);
  ["npIban","npTitularCuenta","npCondicionesPago"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  // Reset retención IRPF
  const _rToggle = document.getElementById("npIrpfToggle");
  const _rSel    = document.getElementById("npIrpfSel");
  const _rRow    = document.getElementById("npIrpfRow");
  if (_rToggle) _rToggle.checked = false;
  if (_rSel)    { _rSel.value = "15"; _rSel.style.display = "none"; }
  if (_rRow)    _rRow.style.display = "none";
  const paisEl = document.getElementById("npClientePais"); if (paisEl) paisEl.value = "ES";
  const tipoEl = document.getElementById("npClienteTipo"); if (tipoEl) tipoEl.value = "empresa";
  const tEmpEl = document.getElementById("npClienteTipoEmpresa"); if (tEmpEl) tEmpEl.value = "";
  document.getElementById("npGuardarCliente").checked = false;
  addLinea();
  updatePreview();
}

/* ══════════════════════════
   CLIENTE SEARCH
══════════════════════════ */
function initClienteSearch() {
  const input = document.getElementById("npClienteSearch");
  const dropdown = document.getElementById("npClienteDropdown");
  const clearBtn = document.getElementById("npClienteLimpiar");
  if (!input || !dropdown) return;

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    if (!q || q.length < 2) { dropdown.style.display = "none"; return; }
    const matches = CLIENTES.filter(c =>
      (c.nombre || "").toLowerCase().includes(q) || (c.nif || "").toLowerCase().includes(q)
    ).slice(0, 8);
    if (!matches.length) {
      dropdown.innerHTML = `<div class="csd-empty">Sin coincidencias — escribe los datos del cliente manualmente</div>`;
      dropdown.style.display = ""; return;
    }
    dropdown.innerHTML = matches.map(c => `
      <div class="csd-item" data-id="${c.id}">
        <div class="csd-name">${c.nombre}</div>
        <div class="csd-meta">${c.nif || "Sin NIF"} · ${c.email || ""}</div>
      </div>`).join("");
    dropdown.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        const c = CLIENTES.find(x => x.id === item.dataset.id);
        if (!c) return;
        clienteSeleccionadoId = c.id;
        input.value = c.nombre;
        document.getElementById("npClienteNombre").value    = c.nombre;
        document.getElementById("npClienteNombreComercial").value = c.nombre_comercial || "";
        document.getElementById("npClienteNif").value       = c.nif || "";
        document.getElementById("npClienteDir").value       = c.direccion || "";
        document.getElementById("npClienteEmail").value     = c.email || "";
        document.getElementById("npClienteTel").value       = c.telefono || "";
        document.getElementById("npClienteCiudad").value    = c.ciudad || "";
        document.getElementById("npClienteProvincia").value = c.provincia || "";
        document.getElementById("npClienteCp").value        = c.codigo_postal || "";
        const npPais = document.getElementById("npClientePais");
        if (npPais) npPais.value = c.pais || "ES";
        const npTipo = document.getElementById("npClienteTipo");
        if (npTipo) npTipo.value = c.tipo || "empresa";
        const npTEmp = document.getElementById("npClienteTipoEmpresa");
        if (npTEmp) npTEmp.value = c.tipo_empresa || "";
        dropdown.style.display = "none";
        if (clearBtn) clearBtn.style.display = "";
        updatePreview();
      });
    });
    dropdown.style.display = "";
  });
  input.addEventListener("blur", () => setTimeout(() => { dropdown.style.display = "none"; }, 200));

  clearBtn?.addEventListener("click", () => {
    clienteSeleccionadoId = null;
    input.value = "";
    ["npClienteNombre", "npClienteNombreComercial", "npClienteNif", "npClienteDir", "npClienteEmail", "npClienteTel",
     "npClienteCiudad", "npClienteProvincia", "npClienteCp"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    const npPais = document.getElementById("npClientePais"); if (npPais) npPais.value = "ES";
    const npTipo = document.getElementById("npClienteTipo"); if (npTipo) npTipo.value = "empresa";
    const npTEmp = document.getElementById("npClienteTipoEmpresa"); if (npTEmp) npTEmp.value = "";
    clearBtn.style.display = "none";
    updatePreview();
  });
}


/* ══════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════ */
async function _npInitPlantillaSelector() {
  const sel   = document.getElementById("npPlantillaSel");
  const badge = document.getElementById("npPlantillaDefaultBadge");
  if (!sel) return;

  sel.innerHTML = `<option value="">Cargando plantillas…</option>`;
  sel.disabled = true;

  let plantillas = [];
  try {
    const { data, error } = await supabase
      .from("plantillas_usuario")
      .select("id, nombre, es_default, cols_activas, cols_pct")
      .eq("user_id", SESSION.user.id)
      .order("nombre");
    if (error) throw error;
    plantillas = data || [];
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
    _applyPlantillaToPresupuesto(_npGetPlantillaDataLocal(defP));
  }

  sel.addEventListener("change", () => {
    const id = sel.value;
    _updBadge(id);
    if (!id) {
      npPlantillaActual = null;
      _npColsActivas = [..._DEFAULT_COLS];
      _npApplyGridToHeader();
      _npRebuildAllRows();
      return;
    }
    const p = plantillas.find(x => x.id === id);
    if (p) _applyPlantillaToPresupuesto(_npGetPlantillaDataLocal(p));
  });
}

function _npGetPlantillaDataLocal(p) {
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

function _npGetPlantillaData(id) {
  const p = (PLANTILLAS||[]).find(x => x.id === id);
  return _npGetPlantillaDataLocal(p);
}

window._applyPlantillaToPresupuesto = function(data) {
  if (!data) return;
  npPlantillaActual = data;
  const colsActivas = (data.colsActivas || []).filter(k => _COL_SCHEMA[k]);
  _npColsActivas = colsActivas.length ? colsActivas : [..._DEFAULT_COLS];
  if (!_npColsActivas.includes("descripcion")) _npColsActivas.unshift("descripcion");
  // IVA: no forzar — la plantilla del usuario decide si incluirla o no.
  // La columna IVA está disponible en COLUMNAS_CATALOGO para añadirla desde plantillas.
  _npApplyGridToHeader();
  _npRebuildAllRows();
};

function _npRebuildAllRows() {
  const container = document.getElementById("npLineasContainer");
  if (!container) return;
  const snapshots = LINEAS.map(l => ({...l}));
  container.innerHTML = "";
  LINEAS = [];
  lineaIdCounter = 0;
  snapshots.forEach(snap => addLinea(snap));
  updateTotalesUI(); updatePreview();
}

/* ══════════════════════════
   INIT
══════════════════════════ */
const _npListenersAttached = { main: false, _opBtns: false };

/* ── Descuento global UI (presupuesto) ── */
function _showDtoGlobal() {
  const wrap = document.getElementById("npDtoGlobalWrap");
  if (!wrap) return;
  wrap.style.display = "";
  const input  = document.getElementById("npDtoGlobalInput");
  const select = document.getElementById("npDtoGlobalTipo");
  if (input)  input.value  = _dtoGlobal.valor || "";
  if (select) select.value = _dtoGlobal.tipo  || "pct";
  input?.focus();
}
function _hideDtoGlobal() {
  const wrap = document.getElementById("npDtoGlobalWrap");
  if (wrap) wrap.style.display = "none";
  _dtoGlobal = { tipo: "pct", valor: 0 };
  updateTotalesUI(); updatePreview();
}
function initDtoGlobal() {
  const btn    = document.getElementById("npAddDtoGlobalBtn");
  const wrap   = document.getElementById("npDtoGlobalWrap");
  const input  = document.getElementById("npDtoGlobalInput");
  const select = document.getElementById("npDtoGlobalTipo");
  const remove = document.getElementById("npDtoGlobalRemove");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!wrap || wrap.style.display === "none" || wrap.style.display === "") {
      _showDtoGlobal();
    } else { _hideDtoGlobal(); }
  });
  const _onChange = () => {
    _dtoGlobal.tipo  = select?.value || "pct";
    _dtoGlobal.valor = parseFloat(input?.value) || 0;
    updateTotalesUI(); updatePreview();
  };
  input?.addEventListener("input",  _onChange);
  input?.addEventListener("change", _onChange);
  select?.addEventListener("change", _onChange);
  remove?.addEventListener("click", () => _hideDtoGlobal());
}

export function initNuevoPresupuesto() {
  const editData = window._npEditData || null;
  window._npEditData = null; // consumir el dato — solo se usa una vez

  // Resetear siempre al entrar a la vista
  resetForm();

  const fechaEl = document.getElementById("npFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().slice(0, 10);

  // Inyectar selector de sede tras el campo "Válido hasta"
  try {
    const validezField = document.getElementById("npValidez")?.closest(".ff-field");
    const sedeHTML = renderSedeSelector({ inputId: "npSedeId", wrapperClass: "ff-field" });
    if (validezField && sedeHTML && !document.getElementById("npSedeId")) {
      validezField.insertAdjacentHTML("afterend", sedeHTML);
    }
  } catch (e) { console.warn("[nuevo-presupuesto sede]", e); }

  initClienteSearch();
  initDtoGlobal();

  // ── Adjuntar listeners SOLO la primera vez (evita multiplicación de importes) ──
  if (!_npListenersAttached.main) {
    _npListenersAttached.main = true;

    ["npClienteNombre", "npClienteNif", "npFecha", "npConcepto", "npNotas", "npValidez"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", updatePreview);
      document.getElementById(id)?.addEventListener("change", updatePreview);
    });

    document.getElementById("npAddLineaBtn")?.addEventListener("click", () => addLinea());
    document.getElementById("npGuardarBtn")?.addEventListener("click", () => savePresupuesto());

    // Retención IRPF — mismo comportamiento que en nueva factura
    document.getElementById("npIrpfToggle")?.addEventListener("change", () => {
      const toggle = document.getElementById("npIrpfToggle");
      const sel    = document.getElementById("npIrpfSel");
      if (sel) sel.style.display = toggle?.checked ? "" : "none";
      if (!toggle?.checked && sel) sel.value = "15";
      updateTotalesUI();
      updatePreview();
    });
    document.getElementById("npIrpfSel")?.addEventListener("change", () => {
      updateTotalesUI();
      updatePreview();
    });
  }

  // ── Tipo de operación ─────────────────────────────────────
  npOpTipoActual = "nacional";
  if (!_npListenersAttached._opBtns) {
    _npListenersAttached._opBtns = true;
    document.querySelectorAll(".np-op-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".np-op-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        npOpTipoActual = btn.dataset.op;
        updateNpOpUI();
        // Bloquear IVA en operaciones exentas, igual que en facturas
        const sinIva = OP_SIN_IVA.includes(npOpTipoActual);
        if (sinIva) {
          LINEAS.forEach(l => { l.iva = 0; });
          document.querySelectorAll("#npLineasContainer [data-field='iva']").forEach(sel => { sel.value = "0"; sel.disabled = true; });
          updateTotalesUI();
        } else {
          document.querySelectorAll("#npLineasContainer [data-field='iva']").forEach(sel => { sel.disabled = false; });
        }
        updatePreview();
      });
    });
  }
  updateNpOpUI();

  _npApplyGridToHeader();
  _npInitPlantillaSelector();

  // ── MODO EDICIÓN ──────────────────────────────────────────
  if (editData) {
    // Título y botón
    const titleEl = document.querySelector("#view-nuevo-presupuesto .view-title");
    if (titleEl) titleEl.textContent = `Editar presupuesto ${editData.numero || ""}`;
    const btn = document.getElementById("npGuardarBtn");
    if (btn) btn.textContent = "Actualizar presupuesto";

    // Campos de texto
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
    set("npConcepto",                editData.concepto);
    set("npFecha",                   editData.fecha);
    set("npValidez",                 editData.fecha_validez);
    set("npSedeId",                  editData.sede_id);
    set("npClienteNombre",           editData.cliente_nombre);
    set("npClienteNombreComercial",  editData.cliente_nombre_comercial);
    set("npClienteNif",              editData.cliente_nif);
    set("npClienteDir",              editData.cliente_direccion);
    set("npClienteEmail",            editData.cliente_email);
    set("npClienteTel",              editData.cliente_tel);
    set("npClienteCiudad",           editData.cliente_ciudad);
    set("npClienteProvincia",        editData.cliente_provincia);
    set("npClienteCp",               editData.cliente_cp);
    set("npNotas",                   editData.notas);
    set("npCondicionesPago",          editData.condiciones_pago);
    set("npIban",                     editData.iban);
    set("npTitularCuenta",            editData.titular_cuenta);

    // Cliente seleccionado
    clienteSeleccionadoId = editData.cliente_id || null;
    if (clienteSeleccionadoId) {
      const searchEl = document.getElementById("npClienteSearch");
      const cliente = (window.CLIENTES || []).find(c => c.id === clienteSeleccionadoId);
      if (searchEl && cliente) searchEl.value = cliente.nombre;
    }

    // Líneas
    LINEAS = []; lineaIdCounter = 0;
    const container = document.getElementById("npLineasContainer");
    if (container) container.innerHTML = "";
    (editData.lineas || []).forEach(l => addLinea(l));
    if (LINEAS.length === 0) addLinea();

    updateTotalesUI();
    updatePreview();

    // Restaurar retención IRPF si el presupuesto la tenía
    if (editData.irpf_retencion) {
      const _eToggle = document.getElementById("npIrpfToggle");
      const _eSel    = document.getElementById("npIrpfSel");
      if (_eToggle) _eToggle.checked = true;
      if (_eSel)    { _eSel.value = String(editData.irpf_retencion); _eSel.style.display = ""; }
      updateTotalesUI();
      updatePreview();
    }

    // Restaurar tipo de operación guardado
    npOpTipoActual = editData.tipo_operacion || "nacional";
    document.querySelectorAll(".np-op-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.op === npOpTipoActual);
    });
    updateNpOpUI();

    // Guardar id de edición para que savePresupuesto haga UPDATE
    window._npEditingId     = editData.id;
    window._npEditingNumero = editData.numero;
  } else {
    // Modo creación normal — limpiar título y resetear tipo operación
    const titleEl = document.querySelector("#view-nuevo-presupuesto .view-title");
    if (titleEl) titleEl.textContent = "Nuevo presupuesto";
    const btn = document.getElementById("npGuardarBtn");
    if (btn) btn.textContent = "Guardar presupuesto";
    window._npEditingId     = null;
    window._npEditingNumero = null;
    // Resetear tipo operación a nacional
    npOpTipoActual = "nacional";
    document.querySelectorAll(".np-op-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.op === "nacional");
    });
    updateNpOpUI();
    if (LINEAS.length === 0) addLinea();
  }
}

// Exponer para que main.js o switchView puedan refrescar el selector al abrir la vista
window._npRefreshPlantillaSel = () => _npInitPlantillaSelector();
