/* ═══════════════════════════════════════════════════════
   TAURIX · nuevo-presupuesto.js
   Vista completa de creación de presupuesto (como nueva-factura)
   ─ Líneas, preview en vivo, guardar cliente, plantillas
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, switchView
} from "./utils.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";
import { PLANTILLAS, getPlantillaDefault } from "./plantillas-usuario.js";
import { refreshPresupuestos } from "./presupuestos.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";

let LINEAS = [];
let lineaIdCounter = 0;
let clienteSeleccionadoId = null;
let npPlantillaActual = null;
let npMostrarDescuento = false;

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

function getLineasTotales() {
  let baseTotal = 0;
  const ivaMap = {};
  LINEAS.forEach(l => {
    const subtotalBruto = l.cantidad * l.precio;
    const descAmt       = _parseDescuento(l.descuento, subtotalBruto);
    const subtotal      = Math.max(0, subtotalBruto - descAmt);
    baseTotal += subtotal;
    const ivaAmt = subtotal * l.iva / 100;
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + ivaAmt;
  });
  const ivaTotal = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  const total = baseTotal + ivaTotal;
  return { baseTotal, ivaMap, ivaTotal, total };
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


function _npDescuentoCeldaHTML(id, val="") {
  return npMostrarDescuento
    ? `<input autocomplete="off" type="text" class="linea-dto ff-input"
        placeholder="10% / 5€" value="${val}" data-field="descuento"
        title="Descuento: número (€) o porcentaje (10%)"
        style="width:72px;text-align:right"/>`
    : "";
}

function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         prefill.iva !== undefined ? prefill.iva : 21,
    descuento:   prefill.descuento   ?? ""
  };
  LINEAS.push(linea);

  const container = document.getElementById("npLineasContainer");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "linea-row";
  row.dataset.lineaId = id;
  row.innerHTML = `
    <input autocomplete="off" type="text" class="linea-desc ff-input" placeholder="Descripción del producto o servicio" value="${linea.descripcion}" data-field="descripcion"/>
    <input autocomplete="off" type="number" class="linea-qty ff-input" value="${linea.cantidad}" min="0.01" step="0.01" data-field="cantidad"/>
    <div class="linea-price-wrap">
      <span class="linea-euro">€</span>
      <input autocomplete="off" type="number" class="linea-price ff-input" value="${linea.precio || ""}" placeholder="0.00" step="0.01" data-field="precio"/>
    </div>
    ${_npDescuentoCeldaHTML(id, linea.descuento)}
    <select class="linea-iva ff-select" data-field="iva">
      <option value="21" ${linea.iva === 21 ? "selected" : ""}>21%</option>
      <option value="10" ${linea.iva === 10 ? "selected" : ""}>10%</option>
      <option value="4"  ${linea.iva === 4  ? "selected" : ""}>4%</option>
      <option value="0"  ${linea.iva === 0  ? "selected" : ""}>0%</option>
    </select>
    <div class="linea-total" id="npLtRow${id}">0,00 €</div>
    <button class="linea-del" onclick="window._npDelLinea(${id})" title="Eliminar línea">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input", () => onLineaChange(id, el));
    el.addEventListener("change", () => onLineaChange(id, el));
  });

  // Autocomplete catálogo
  const descInput = row.querySelector(".linea-desc");
  // Autocomplete catálogo de productos — al hacer focus muestra todo el catálogo
  _buildProdDropdown(descInput, (p) => {
    const linea = LINEAS.find(l => l.id === id);
    if (!linea) return;
    linea.descripcion = p.descripcion || p.nombre;
    linea.precio      = p.precio;
    linea.iva         = p.iva;
    linea.tipo        = p.tipo || "producto";
    descInput.value = p.descripcion || p.nombre;
    row.querySelector("[data-field='precio']").value = p.precio;
    row.querySelector("[data-field='iva']").value    = p.iva;
    document.getElementById(`npLtRow${id}`).textContent = fmt(linea.cantidad * linea.precio);
    updateTotalesUI(); updatePreview();
  });

  container.appendChild(row);
  updateTotalesUI(); updatePreview();
  if (!prefill.descripcion) descInput?.focus();
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
  const subtotal      = Math.max(0, subtotalBruto - descAmt);
  document.getElementById(`npLtRow${id}`).textContent = fmt(subtotal);
  updateTotalesUI(); updatePreview();
}

window._npDelLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  updateTotalesUI(); updatePreview();
};

function updateTotalesUI() {
  const { baseTotal, ivaTotal, total } = getLineasTotales();
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("npBase", fmt(baseTotal));
  s("npIva", fmt(ivaTotal));
  s("npTotal", fmt(total));
}

/* ══════════════════════════
   PREVIEW
══════════════════════════ */
function updatePreview() {
  const nombre = document.getElementById("npClienteNombre")?.value || "—";
  const nif = document.getElementById("npClienteNif")?.value || "";
  const fecha = document.getElementById("npFecha")?.value || "—";
  const concepto = document.getElementById("npConcepto")?.value || "—";
  const { baseTotal, ivaTotal, total } = getLineasTotales();

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
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--t3);margin-bottom:8px">
        <span>IVA</span><span>${fmt(ivaTotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:var(--t1);border-top:2px solid var(--brd);padding-top:8px">
        <span>TOTAL</span><span>${fmt(total)}</span>
      </div>
    </div>`;
}

/* ══════════════════════════
   GUARDAR PRESUPUESTO
══════════════════════════ */
async function savePresupuesto() {
  const concepto = document.getElementById("npConcepto")?.value.trim();
  const fecha = document.getElementById("npFecha")?.value;
  if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) { toast("Añade al menos una línea con precio", "error"); return; }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry = Object.entries(ivaMap).sort(([, a], [, b]) => b - a)[0];
  const ivaMain = ivaEntry ? parseInt(ivaEntry[0]) : 21;

  const clienteNombre = document.getElementById("npClienteNombre")?.value.trim();
  const clienteNif = document.getElementById("npClienteNif")?.value.trim();
  const clienteDir = document.getElementById("npClienteDir")?.value.trim();
  const guardarCliente = document.getElementById("npGuardarCliente")?.checked;

  const btn = document.getElementById("npGuardarBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Guardando…`; }

  // Guardar cliente si es nuevo y se marcó
  let cId = clienteSeleccionadoId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif || null, direccion: clienteDir || null
    }).select().single();
    if (!ce && nc) { cId = nc.id; await refreshClientes(); }
  }

  const clienteObj = cId ? CLIENTES.find(c => c.id === cId) : null;

  // Numeración automática
  const year = new Date(fecha).getFullYear();
  const { data: last } = await supabase.from("presupuestos")
    .select("numero").eq("user_id", SESSION.user.id)
    .like("numero", `PRE-${year}-%`).order("numero", { ascending: false }).limit(1);
  const lastNum = last?.[0]?.numero ? parseInt((last[0].numero.match(/-(\d+)$/) || [])[1]) || 0 : 0;
  const numero = `PRE-${year}-${String(lastNum + 1).padStart(3, "0")}`;

  const { error } = await supabase.from("presupuestos").insert({
    user_id: SESSION.user.id,
    numero,
    concepto, fecha,
    fecha_validez: document.getElementById("npValidez")?.value || null,
    estado: "borrador",
    cliente_id: cId || null,
    cliente_nombre: clienteNombre || clienteObj?.nombre || "",
    cliente_nif: clienteNif || clienteObj?.nif || "",
    base: baseTotal,
    iva: ivaMain,
    lineas: JSON.stringify(LINEAS.map(l => ({
      descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, iva: l.iva,
      descuento: l.descuento ?? "",
      subtotal: Math.max(0, l.cantidad*l.precio - _parseDescuento(l.descuento, l.cantidad*l.precio)),
    }))),
    notas: document.getElementById("npNotas")?.value.trim() || null,
  });

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = "Guardar presupuesto"; }
    toast("Error: " + error.message, "error"); return;
  }

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
  ["npClienteNombre", "npClienteNif", "npClienteDir", "npConcepto", "npNotas"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const csi = document.getElementById("npClienteSearch"); if (csi) csi.value = "";
  document.getElementById("npFecha").value = new Date().toISOString().slice(0, 10);
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
        document.getElementById("npClienteNombre").value = c.nombre;
        document.getElementById("npClienteNif").value = c.nif || "";
        document.getElementById("npClienteDir").value = c.direccion || "";
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
    ["npClienteNombre", "npClienteNif", "npClienteDir"].forEach(id => { document.getElementById(id).value = ""; });
    clearBtn.style.display = "none";
    updatePreview();
  });
}


/* ══════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════ */
function _npInitPlantillaSelector() {
  const sel = document.getElementById("npPlantillaSel");
  if (!sel) return;

  const plantillas = (typeof PLANTILLAS !== "undefined") ? PLANTILLAS : [];
  const defP = plantillas.find(p => p.es_default) || plantillas[0];

  sel.innerHTML = [
    `<option value="">— Sin plantilla —</option>`,
    ...plantillas.map(p => {
      const tag = p.es_default ? " ⭐ Predeterminada" : "";
      return `<option value="${p.id}" ${defP?.id===p.id?"selected":""}>${p.nombre}${tag}</option>`;
    })
  ].join("");

  if (defP) _applyPlantillaToPresupuesto(_npGetPlantillaData(defP.id));

  sel.addEventListener("change", () => {
    const id = sel.value;
    if (!id) {
      npPlantillaActual = null;
      npMostrarDescuento = false;
      _npRefreshDescuentoCol();
      return;
    }
    _applyPlantillaToPresupuesto(_npGetPlantillaData(id));
  });
}

function _npGetPlantillaData(id) {
  const p = (PLANTILLAS||[]).find(x => x.id === id);
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

function _npRefreshDescuentoCol() {
  const hdrDto = document.getElementById("npHdrDescuento");
  if (hdrDto) hdrDto.style.display = npMostrarDescuento ? "" : "none";

  document.querySelectorAll("#npLineasContainer .linea-row").forEach(row => {
    const lineaId = parseInt(row.dataset.lineaId);
    const linea   = LINEAS.find(l => l.id === lineaId);
    const existing = row.querySelector("[data-field='descuento']");
    if (npMostrarDescuento) {
      if (!existing) {
        const dtoEl = document.createElement("input");
        dtoEl.autocomplete = "off";
        dtoEl.type = "text";
        dtoEl.className = "linea-dto ff-input";
        dtoEl.placeholder = "10% / 5€";
        dtoEl.dataset.field = "descuento";
        dtoEl.title = "Descuento: número (€) o porcentaje (10%)";
        dtoEl.style.cssText = "width:72px;text-align:right";
        dtoEl.value = linea?.descuento ?? "";
        dtoEl.addEventListener("input",  () => onLineaChange(lineaId, dtoEl));
        dtoEl.addEventListener("change", () => onLineaChange(lineaId, dtoEl));
        const ivaEl = row.querySelector("[data-field='iva']");
        if (ivaEl) row.insertBefore(dtoEl, ivaEl);
      }
    } else {
      if (existing) existing.remove();
      if (linea) { linea.descuento = ""; }
    }
  });
  updateTotalesUI(); updatePreview();
}

window._applyPlantillaToPresupuesto = function(data) {
  if (!data) return;
  npPlantillaActual = data;
  const colsActivas = data.colsActivas || [];
  npMostrarDescuento = colsActivas.includes("descuento");
  _npRefreshDescuentoCol();
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initNuevoPresupuesto() {
  const fechaEl = document.getElementById("npFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().slice(0, 10);

  initClienteSearch();

  ["npClienteNombre", "npClienteNif", "npFecha", "npConcepto", "npNotas", "npValidez"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });

  document.getElementById("npAddLineaBtn")?.addEventListener("click", () => addLinea());
  document.getElementById("npGuardarBtn")?.addEventListener("click", () => savePresupuesto());

  if (LINEAS.length === 0) addLinea();
  _npInitPlantillaSelector();
}
