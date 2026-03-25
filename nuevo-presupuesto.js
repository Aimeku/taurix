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
import { PLANTILLAS, loadPlantillas, getPlantillaData, renderSelectorPlantillas } from "./plantillas-usuario.js";
import { refreshPresupuestos } from "./presupuestos.js";
import { refreshClientes, populateClienteSelect } from "./clientes.js";

let LINEAS = [];
let lineaIdCounter = 0;
let clienteSeleccionadoId = null;

/* ══════════════════════════
   TOTALES
══════════════════════════ */
function getLineasTotales() {
  let baseTotal = 0;
  const ivaMap = {};
  LINEAS.forEach(l => {
    const subtotal = l.cantidad * l.precio;
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
function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad: prefill.cantidad || 1,
    precio: prefill.precio || 0,
    iva: prefill.iva !== undefined ? prefill.iva : 21,
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
  if (descInput && PRODUCTOS?.length > 0) {
    const dropdown = document.createElement("div");
    dropdown.className = "csc-dropdown prod-autocomplete";
    dropdown.style.cssText = "position:absolute;z-index:300;width:320px;top:100%;left:0;max-height:280px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.15);border-radius:10px;border:1px solid var(--brd);background:var(--srf);display:none";
    descInput.parentElement.style.position = "relative";
    descInput.parentElement.appendChild(dropdown);

    const _showProdDropdown = (lista, titulo) => {
      if (!lista.length) { dropdown.style.display = "none"; return; }
      dropdown.innerHTML = (titulo ? `<div style="padding:8px 14px;font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--brd)">${titulo}</div>` : "") +
        lista.map(p => {
          const stockInfo = p.tipo !== "servicio" && p.stock_actual !== null && p.stock_actual !== undefined
            ? `<span style="font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600;background:${p.stock_actual > 0 ? '#dcfce7' : '#fee2e2'};color:${p.stock_actual > 0 ? '#166534' : '#991b1b'};margin-left:6px">Stock: ${p.stock_actual}</span>`
            : "";
          return `<div class="csd-item prod-ac-item" data-id="${p.id}"
            style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd)"
            onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background=''">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;color:var(--t1)">${p.nombre}${stockInfo}</div>
                ${p.descripcion ? `<div style="font-size:11px;color:var(--t3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.descripcion.substring(0,60)}</div>` : ""}
                ${p.referencia ? `<div style="font-size:10px;color:var(--t4);font-family:monospace">Ref: ${p.referencia}</div>` : ""}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio)}</div>
                <div style="font-size:10px;color:var(--t3)">IVA ${p.iva}%</div>
              </div>
            </div>
          </div>`;
        }).join("");
      dropdown.querySelectorAll(".prod-ac-item").forEach(item => {
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          const p = PRODUCTOS.find(x => x.id === item.dataset.id);
          if (!p) return;
          const linea = LINEAS.find(l => l.id === id);
          if (linea) {
            linea.descripcion = p.descripcion || p.nombre;
            linea.precio = p.precio; linea.iva = p.iva;
            descInput.value = p.descripcion || p.nombre;
            row.querySelector("[data-field='precio']").value = p.precio;
            row.querySelector("[data-field='iva']").value = p.iva;
            document.getElementById(`npLtRow${id}`).textContent = fmt(linea.cantidad * linea.precio);
            updateTotalesUI(); updatePreview();
          }
          dropdown.style.display = "none";
        });
      });
      dropdown.style.display = "";
    };

    descInput.addEventListener("input", () => {
      const q = descInput.value.toLowerCase().trim();
      if (!q) { dropdown.style.display = "none"; return; }
      const matches = PRODUCTOS.filter(p =>
        p.activo !== false && (
          p.nombre.toLowerCase().includes(q) ||
          (p.referencia||"").toLowerCase().includes(q) ||
          (p.descripcion||"").toLowerCase().includes(q)
        )
      ).slice(0, 8);
      _showProdDropdown(matches, null);
    });
    descInput.addEventListener("focus", () => {
      if (!descInput.value.trim()) {
        _showProdDropdown(PRODUCTOS.filter(p => p.activo !== false).slice(0, 8), "📦 Catálogo de productos");
      }
    });
    descInput.addEventListener("blur", () => setTimeout(() => { dropdown.style.display = "none"; }, 220));
  }

  container.appendChild(row);
  updateTotalesUI(); updatePreview();
  if (!prefill.descripcion) descInput?.focus();
}

function onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if (field === "descripcion") linea.descripcion = el.value;
  else if (field === "cantidad") linea.cantidad = parseFloat(el.value) || 0;
  else if (field === "precio") linea.precio = parseFloat(el.value) || 0;
  else if (field === "iva") linea.iva = parseInt(el.value) || 0;
  document.getElementById(`npLtRow${id}`).textContent = fmt(linea.cantidad * linea.precio);
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

  // Selector de plantilla en el formulario
  renderSelectorPlantillas("npPlantillaSelectorWrap", (data) => {
    LINEAS=[]; lineaIdCounter=0;
    const c=document.getElementById("npLineasContainer"); if(c) c.innerHTML="";
    if (data) {
      (data.lineas||[]).forEach(l=>addLinea(l));
      const co=document.getElementById("npConcepto"); if(co&&data.concepto) co.value=data.concepto;
      const no=document.getElementById("npNotas");    if(no&&data.notas)    no.value=data.notas;
      toast("✅ Plantilla aplicada","success",2000);
    } else { addLinea(); }
    updateTotalesUI(); updatePreview();
  });
}

/* ── Aplicar plantilla desde fuera ── */
function _applyPlantillaToNP(data) {
  if (!data) return;
  LINEAS=[]; lineaIdCounter=0;
  const c=document.getElementById("npLineasContainer"); if(c) c.innerHTML="";
  (data.lineas||[]).forEach(l=>addLinea(l));
  if (!LINEAS.length) addLinea();
  const co=document.getElementById("npConcepto"); if(co&&data.concepto) co.value=data.concepto;
  const no=document.getElementById("npNotas");    if(no&&data.notas)    no.value=data.notas;
  updateTotalesUI(); updatePreview();
  toast("✅ Plantilla aplicada","success",2000);
}
window._applyPlantillaToPresupuesto      = _applyPlantillaToNP;
window._applyPlantillaToNuevoPresupuesto = _applyPlantillaToNP;
