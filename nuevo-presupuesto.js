/* ═══════════════════════════════════════════════════════
   TAURIX · nuevo-presupuesto.js
   Vista completa de creación de presupuesto
   ─ Descuento % por línea individual
   ─ Desglose de descuento en totales y preview (solo si hay)
   ─ Selector de plantilla integrado
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, switchView
} from "./utils.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";
import { renderSelectorPlantillas } from "./plantillas-usuario.js";
import { PLANTILLAS, loadPlantillas, getPlantillaData, renderSelectorPlantillas } from "./plantillas-usuario.js";
import { refreshPresupuestos } from "./presupuestos.js";
import { refreshClientes } from "./clientes.js";
import { PLANTILLAS, loadPlantillas, getPlantillaData } from "./plantillas-usuario.js";

let LINEAS = [];
let lineaIdCounter = 0;
let clienteSeleccionadoId = null;

/* ══════════════════════════
   TOTALES — con descuento por línea
══════════════════════════ */
function getLineasTotales() {
  let subtotalBruto  = 0;
  let totalDescuento = 0;
  let baseTotal      = 0;
  const ivaMap       = {};

  LINEAS.forEach(l => {
    const bruto    = l.cantidad * l.precio;
    const descAmt  = bruto * (l.descuento || 0) / 100;
    const neto     = bruto - descAmt;
    subtotalBruto  += bruto;
    totalDescuento += descAmt;
    baseTotal      += neto;
    const ivaAmt    = neto * l.iva / 100;
    ivaMap[l.iva]   = (ivaMap[l.iva] || 0) + ivaAmt;
  });

  const ivaTotal = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  const total    = baseTotal + ivaTotal;
  return { subtotalBruto, totalDescuento, baseTotal, ivaMap, ivaTotal, total };
}

/* ══════════════════════════
   LÍNEAS — con campo descuento %
══════════════════════════ */
function addLinea(prefill = {}) {
  const id = ++lineaIdCounter;
  const linea = {
    id,
    descripcion: prefill.descripcion || "",
    cantidad:    prefill.cantidad    || 1,
    precio:      prefill.precio      || 0,
    iva:         prefill.iva !== undefined ? prefill.iva : 21,
    descuento:   prefill.descuento   || 0,
  };
  LINEAS.push(linea);

  const container = document.getElementById("npLineasContainer");
  if (!container) return;

  const row = document.createElement("div");
  row.className = "linea-row np-linea-row";
  row.dataset.lineaId = id;
  row.style.cssText = "display:grid;grid-template-columns:1fr 56px 88px 60px 56px 78px 30px;gap:4px;align-items:center;margin-bottom:4px";

  row.innerHTML = `
    <input autocomplete="off" type="text" class="linea-desc ff-input"
      placeholder="Descripción" value="${linea.descripcion}" data-field="descripcion"/>
    <input autocomplete="off" type="number" class="ff-input"
      value="${linea.cantidad}" min="0.01" step="0.01" data-field="cantidad"/>
    <div class="linea-price-wrap" style="position:relative">
      <span class="linea-euro">€</span>
      <input autocomplete="off" type="number" class="linea-price ff-input"
        value="${linea.precio||""}" placeholder="0.00" step="0.01" data-field="precio"/>
    </div>
    <div style="position:relative">
      <input autocomplete="off" type="number" class="ff-input"
        value="${linea.descuento||""}" placeholder="0" min="0" max="100" step="0.01"
        data-field="descuento" style="padding-right:18px" title="Descuento %"/>
      <span style="position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--t3);pointer-events:none">%</span>
    </div>
    <select class="linea-iva ff-select" data-field="iva">
      <option value="21" ${linea.iva===21?"selected":""}>21%</option>
      <option value="10" ${linea.iva===10?"selected":""}>10%</option>
      <option value="4"  ${linea.iva===4 ?"selected":""}>4%</option>
      <option value="0"  ${linea.iva===0 ?"selected":""}>0%</option>
    </select>
    <div class="linea-total" id="npLtRow${id}"
      style="text-align:right;font-size:12px;font-weight:700;font-family:monospace;line-height:1.3">
      0,00 €
    </div>
    <button class="linea-del" onclick="window._npDelLinea(${id})" title="Eliminar línea">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  row.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input",  () => onLineaChange(id, el));
    el.addEventListener("change", () => onLineaChange(id, el));
  });

  // Autocomplete catálogo
  const descInput = row.querySelector(".linea-desc");
  if (descInput && PRODUCTOS?.length > 0) {
    const dropdown = document.createElement("div");
    dropdown.className = "csc-dropdown prod-autocomplete";
    dropdown.style.cssText = "position:absolute;z-index:200;width:100%;top:100%;left:0;display:none";
    descInput.parentElement.style.position = "relative";
    descInput.parentElement.appendChild(dropdown);

    descInput.addEventListener("input", () => {
      const q = descInput.value.toLowerCase();
      if (!q || q.length < 2) { dropdown.style.display = "none"; return; }
      const matches = PRODUCTOS.filter(p =>
        p.activo !== false &&
        (p.nombre.toLowerCase().includes(q) || (p.referencia||"").toLowerCase().includes(q))
      ).slice(0, 6);
      if (!matches.length) { dropdown.style.display = "none"; return; }
      dropdown.innerHTML = matches.map(p => `
        <div class="csd-item prod-ac-item" data-id="${p.id}"
          style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="csd-name">${p.nombre}</div>
            <div class="csd-meta">${p.referencia?p.referencia+" · ":""}${p.tipo||""}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--accent)">${fmt(p.precio)}</div>
        </div>`).join("");
      dropdown.querySelectorAll(".prod-ac-item").forEach(item => {
        item.addEventListener("mousedown", e => {
          e.preventDefault();
          const p = PRODUCTOS.find(x => x.id === item.dataset.id);
          if (!p) return;
          const l = LINEAS.find(x => x.id === id);
          if (l) {
            l.descripcion = p.nombre; l.precio = p.precio; l.iva = p.iva;
            descInput.value = p.nombre;
            row.querySelector("[data-field='precio']").value = p.precio;
            row.querySelector("[data-field='iva']").value    = p.iva;
            _updateLineaTotal(id);
            updateTotalesUI(); updatePreview();
          }
          dropdown.style.display = "none";
        });
      });
      dropdown.style.display = "";
    });
    descInput.addEventListener("blur", () => setTimeout(() => { dropdown.style.display = "none"; }, 200));
  }

  container.appendChild(row);
  _updateLineaTotal(id);
  updateTotalesUI();
  updatePreview();
  if (!prefill.descripcion) descInput?.focus();
}

function _updateLineaTotal(id) {
  const l  = LINEAS.find(x => x.id === id);
  const el = document.getElementById(`npLtRow${id}`);
  if (!l || !el) return;
  const bruto = l.cantidad * l.precio;
  const desc  = bruto * (l.descuento || 0) / 100;
  const neto  = bruto - desc;
  if (l.descuento > 0) {
    el.innerHTML = `<span style="text-decoration:line-through;color:var(--t4);font-size:10px;display:block">${fmt(bruto)}</span>${fmt(neto)}`;
  } else {
    el.textContent = fmt(neto);
  }
}

function onLineaChange(id, el) {
  const linea = LINEAS.find(l => l.id === id);
  if (!linea) return;
  const field = el.dataset.field;
  if      (field === "descripcion") linea.descripcion = el.value;
  else if (field === "cantidad")    linea.cantidad    = parseFloat(el.value) || 0;
  else if (field === "precio")      linea.precio      = parseFloat(el.value) || 0;
  else if (field === "iva")         linea.iva         = parseInt(el.value)   || 0;
  else if (field === "descuento")   linea.descuento   = parseFloat(el.value) || 0;
  _updateLineaTotal(id);
  updateTotalesUI();
  updatePreview();
}

window._npDelLinea = (id) => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  updateTotalesUI(); updatePreview();
};

/* ══════════════════════════
   TOTALES UI
══════════════════════════ */
function updateTotalesUI() {
  const { subtotalBruto, totalDescuento, baseTotal, ivaTotal, total } = getLineasTotales();
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  // Filas que aparecen solo con descuento
  const hayDescuento = totalDescuento > 0;
  const subRow  = document.getElementById("npSubtotalRow");
  const descRow = document.getElementById("npDescuentoRow");
  if (subRow)  subRow.style.display  = hayDescuento ? "" : "none";
  if (descRow) descRow.style.display = hayDescuento ? "" : "none";

  s("npSubtotal",  fmt(subtotalBruto));
  s("npDescuento", `- ${fmt(totalDescuento)}`);
  s("npBase",      fmt(baseTotal));
  s("npIva",       fmt(ivaTotal));
  s("npTotal",     fmt(total));
}

/* ══════════════════════════
   PREVIEW EN VIVO
══════════════════════════ */
function updatePreview() {
  const nombre   = document.getElementById("npClienteNombre")?.value || "—";
  const nif      = document.getElementById("npClienteNif")?.value    || "";
  const fecha    = document.getElementById("npFecha")?.value         || "—";
  const concepto = document.getElementById("npConcepto")?.value      || "—";
  const validez  = document.getElementById("npValidez")?.value       || "";
  const notas    = document.getElementById("npNotas")?.value         || "";
  const { subtotalBruto, totalDescuento, baseTotal, ivaMap, ivaTotal, total } = getLineasTotales();

  const previewEl = document.getElementById("npPreviewContent");
  if (!previewEl) return;

  const lineasConDatos = LINEAS.filter(l => l.descripcion || l.precio > 0);
  const hayDescuento   = totalDescuento > 0;

  previewEl.innerHTML = `
    <div style="padding:16px 20px;background:var(--accent);color:#fff;border-radius:10px 10px 0 0">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:10px;font-weight:800;letter-spacing:.12em;opacity:.6;margin-bottom:2px">PRESUPUESTO</div>
          <div style="font-size:13px;font-weight:700;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${concepto}</div>
        </div>
        <div style="text-align:right;font-size:11px;opacity:.8">
          <div>${fmtDate(fecha)}</div>
          ${validez?`<div>Válido hasta ${fmtDate(validez)}</div>`:""}
        </div>
      </div>
    </div>

    <div style="padding:10px 20px;border-bottom:1px solid var(--brd)">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;color:var(--t4);letter-spacing:.1em;margin-bottom:2px">Cliente</div>
      <div style="font-size:13px;font-weight:700">${nombre}</div>
      ${nif?`<div style="font-size:11px;color:var(--t3)">${nif}</div>`:""}
    </div>

    ${lineasConDatos.length ? `
    <div style="padding:0 20px">
      <div style="display:grid;grid-template-columns:1fr 36px 56px 36px 64px;gap:4px;padding:7px 0 4px;font-size:9px;font-weight:700;text-transform:uppercase;color:var(--t4);letter-spacing:.05em;border-bottom:1px solid var(--brd)">
        <span>Descripción</span>
        <span style="text-align:right">Cant</span>
        <span style="text-align:right">Precio</span>
        <span style="text-align:right">Dto</span>
        <span style="text-align:right">Total</span>
      </div>
      ${lineasConDatos.map(l => {
        const bruto = l.cantidad * l.precio;
        const desc  = bruto * (l.descuento||0) / 100;
        const neto  = bruto - desc;
        return `<div style="display:grid;grid-template-columns:1fr 36px 56px 36px 64px;gap:4px;padding:5px 0;border-bottom:1px solid var(--brd);font-size:11px;align-items:start">
          <span style="color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.descripcion||"—"}</span>
          <span style="text-align:right;color:var(--t3)">${l.cantidad}</span>
          <span style="text-align:right;color:var(--t3)">${fmt(l.precio)}</span>
          <span style="text-align:right;color:${l.descuento>0?"#dc2626":"var(--t4)"};font-weight:${l.descuento>0?"700":"400"}">${l.descuento>0?l.descuento+"%":"—"}</span>
          <span style="text-align:right;font-weight:700;font-family:monospace">${fmt(neto)}</span>
        </div>`;
      }).join("")}
    </div>` : `<div style="padding:20px;text-align:center;font-size:12px;color:var(--t4)">Añade líneas para ver el detalle</div>`}

    <div style="padding:12px 20px;background:var(--bg2);border-radius:0 0 10px 10px;margin-top:2px">
      ${hayDescuento ? `
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:3px">
          <span>Subtotal</span><span style="font-family:monospace">${fmt(subtotalBruto)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#dc2626;font-weight:700;margin-bottom:3px;padding-bottom:4px;border-bottom:1px dashed #fca5a5">
          <span>Descuento</span><span style="font-family:monospace">- ${fmt(totalDescuento)}</span>
        </div>` : ""}
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:3px">
        <span>Base imponible</span><span style="font-family:monospace">${fmt(baseTotal)}</span>
      </div>
      ${Object.entries(ivaMap).filter(([,v])=>v>0).sort(([a],[b])=>b-a).map(([pct,amt])=>`
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:3px">
          <span>IVA ${pct}%</span><span style="font-family:monospace">${fmt(amt)}</span>
        </div>`).join("")}
      <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:900;color:var(--t1);border-top:2px solid var(--brd);padding-top:8px;margin-top:4px">
        <span>TOTAL</span><span style="font-family:monospace">${fmt(total)}</span>
      </div>
    </div>
    ${notas?`<div style="padding:10px 20px;font-size:11px;color:var(--t3);border-top:1px solid var(--brd);line-height:1.5">${notas}</div>`:""}
  `;
}

/* ══════════════════════════
   GUARDAR PRESUPUESTO
══════════════════════════ */
async function savePresupuesto() {
  const concepto = document.getElementById("npConcepto")?.value.trim();
  const fecha    = document.getElementById("npFecha")?.value;
  if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) {
    toast("Añade al menos una línea con precio", "error"); return;
  }

  const { baseTotal, ivaMap } = getLineasTotales();
  const ivaEntry = Object.entries(ivaMap).sort(([,a],[,b]) => b-a)[0];
  const ivaMain  = ivaEntry ? parseInt(ivaEntry[0]) : 21;

  const clienteNombre  = document.getElementById("npClienteNombre")?.value.trim();
  const clienteNif     = document.getElementById("npClienteNif")?.value.trim();
  const clienteDir     = document.getElementById("npClienteDir")?.value.trim();
  const guardarCliente = document.getElementById("npGuardarCliente")?.checked;

  const btn = document.getElementById("npGuardarBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Guardando…`; }

  let cId = clienteSeleccionadoId;
  if (!cId && guardarCliente && clienteNombre) {
    const { data: nc, error: ce } = await supabase.from("clientes").insert({
      user_id: SESSION.user.id, nombre: clienteNombre, nif: clienteNif||null, direccion: clienteDir||null
    }).select().single();
    if (!ce && nc) { cId = nc.id; await refreshClientes(); }
  }

  const clienteObj = cId ? CLIENTES.find(c => c.id === cId) : null;
  const year = new Date(fecha).getFullYear();
  const { data: last } = await supabase.from("presupuestos")
    .select("numero").eq("user_id", SESSION.user.id)
    .like("numero", `PRE-${year}-%`).order("numero", { ascending: false }).limit(1);
  const lastNum = last?.[0]?.numero ? parseInt((last[0].numero.match(/-(\d+)$/) || [])[1]) || 0 : 0;
  const numero  = `PRE-${year}-${String(lastNum + 1).padStart(3, "0")}`;

  const { error } = await supabase.from("presupuestos").insert({
    user_id:        SESSION.user.id,
    numero, concepto, fecha,
    fecha_validez:  document.getElementById("npValidez")?.value || null,
    estado:         "borrador",
    cliente_id:     cId || null,
    cliente_nombre: clienteNombre || clienteObj?.nombre || "",
    cliente_nif:    clienteNif    || clienteObj?.nif    || "",
    base:           baseTotal,
    iva:            ivaMain,
    lineas: JSON.stringify(LINEAS.map(l => ({
      descripcion: l.descripcion, cantidad: l.cantidad,
      precio: l.precio, iva: l.iva, descuento: l.descuento || 0,
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
  LINEAS=[]; lineaIdCounter=0; clienteSeleccionadoId=null;
  const container = document.getElementById("npLineasContainer");
  if (container) container.innerHTML="";
  ["npClienteNombre","npClienteNif","npClienteDir","npConcepto","npNotas"].forEach(id => {
    const el=document.getElementById(id); if(el) el.value="";
  });
  const csi=document.getElementById("npClienteSearch"); if(csi) csi.value="";
  const clb=document.getElementById("npClienteLimpiar"); if(clb) clb.style.display="none";
  document.getElementById("npFecha").value = new Date().toISOString().slice(0,10);
  document.getElementById("npGuardarCliente").checked = false;
  document.querySelectorAll(".np-plt-btn").forEach(b => { b.style.background=""; b.style.borderColor=""; b.style.color=""; });
  addLinea();
  updatePreview();
}

/* ══════════════════════════
   CLIENTE SEARCH
══════════════════════════ */
function initClienteSearch() {
  const input    = document.getElementById("npClienteSearch");
  const dropdown = document.getElementById("npClienteDropdown");
  const clearBtn = document.getElementById("npClienteLimpiar");
  if (!input || !dropdown) return;

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    if (!q || q.length < 2) { dropdown.style.display="none"; return; }
    const matches = CLIENTES.filter(c =>
      (c.nombre||"").toLowerCase().includes(q) || (c.nif||"").toLowerCase().includes(q)
    ).slice(0,8);
    if (!matches.length) {
      dropdown.innerHTML=`<div class="csd-empty">Sin coincidencias — escribe manualmente</div>`;
      dropdown.style.display=""; return;
    }
    dropdown.innerHTML = matches.map(c=>`
      <div class="csd-item" data-id="${c.id}">
        <div class="csd-name">${c.nombre}</div>
        <div class="csd-meta">${c.nif||"Sin NIF"} · ${c.email||""}</div>
      </div>`).join("");
    dropdown.querySelectorAll(".csd-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        const c = CLIENTES.find(x=>x.id===item.dataset.id);
        if (!c) return;
        clienteSeleccionadoId = c.id;
        input.value = c.nombre;
        document.getElementById("npClienteNombre").value = c.nombre;
        document.getElementById("npClienteNif").value    = c.nif||"";
        document.getElementById("npClienteDir").value    = c.direccion||"";
        dropdown.style.display="none";
        if (clearBtn) clearBtn.style.display="";
        updatePreview();
      });
    });
    dropdown.style.display="";
  });
  input.addEventListener("blur", ()=>setTimeout(()=>{ dropdown.style.display="none"; },200));
  clearBtn?.addEventListener("click", ()=>{
    clienteSeleccionadoId=null; input.value="";
    ["npClienteNombre","npClienteNif","npClienteDir"].forEach(id=>{ document.getElementById(id).value=""; });
    clearBtn.style.display="none"; updatePreview();
  });
}

/* ══════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════ */
async function _renderNpPlantillaSelector() {
  const wrap = document.getElementById("npPlantillaSelector");
  if (!wrap) return;
  if (!PLANTILLAS.length) await loadPlantillas();
  if (!PLANTILLAS.length) {
    wrap.innerHTML=`<span style="font-size:12px;color:var(--t4)">Sin plantillas — <a href="#" onclick="window._switchView('plantillas');return false" style="color:var(--accent)">crea una aquí</a></span>`;
    return;
  }
  wrap.innerHTML=[
    ...PLANTILLAS.map(p=>`<button class="np-plt-btn btn-outline" data-plt-id="${p.id}" style="font-size:12px;padding:5px 12px;border-radius:8px">📋 ${p.nombre}</button>`),
    `<button class="np-plt-btn btn-outline" data-plt-id="" style="font-size:12px;padding:5px 12px;border-radius:8px;color:var(--t4)">✕ En blanco</button>`
  ].join("");
  wrap.querySelectorAll(".np-plt-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      wrap.querySelectorAll(".np-plt-btn").forEach(b=>{b.style.background="";b.style.borderColor="";b.style.color="";});
      if (btn.dataset.pltId) {
        btn.style.background="var(--accent)";btn.style.borderColor="var(--accent)";btn.style.color="#fff";
        const data=getPlantillaData(btn.dataset.pltId);
        if (data) _applyPlantillaToNP(data);
      } else {
        LINEAS=[];lineaIdCounter=0;
        const c=document.getElementById("npLineasContainer");if(c)c.innerHTML="";
        ["npConcepto","npNotas"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
        addLinea();updateTotalesUI();updatePreview();
      }
    });
  });
}

function _applyPlantillaToNP(data) {
  if (!data) return;
  LINEAS=[];lineaIdCounter=0;
  const c=document.getElementById("npLineasContainer");if(c)c.innerHTML="";
  (data.lineas||[]).forEach(l=>addLinea(l));
  if (!LINEAS.length) addLinea();
  const co=document.getElementById("npConcepto");if(co&&data.concepto)co.value=data.concepto;
  const no=document.getElementById("npNotas");if(no&&data.notas)no.value=data.notas;
  updateTotalesUI();updatePreview();
  toast("✅ Plantilla aplicada","success",2500);
}

window._applyPlantillaToPresupuesto      = _applyPlantillaToNP;
window._applyPlantillaToNuevoPresupuesto = _applyPlantillaToNP;

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initNuevoPresupuesto() {
  const fechaEl = document.getElementById("npFecha");
  if (fechaEl && !fechaEl.value) fechaEl.value = new Date().toISOString().slice(0,10);

  initClienteSearch();

  ["npClienteNombre","npClienteNif","npFecha","npConcepto","npNotas","npValidez"].forEach(id=>{
    document.getElementById(id)?.addEventListener("input",  updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });

  document.getElementById("npAddLineaBtn")?.addEventListener("click",()=>addLinea());
  document.getElementById("npGuardarBtn")?.addEventListener("click", ()=>savePresupuesto());

  if (LINEAS.length===0) addLinea();

  // Selector de plantilla integrado
  renderSelectorPlantillas("npPlantillaSelectorWrap", (data) => {
    LINEAS=[]; lineaIdCounter=0;
    const c=document.getElementById("npLineasContainer"); if(c) c.innerHTML="";
    if (data) {
      (data.lineas||[]).forEach(l=>addLinea(l));
      const co=document.getElementById("npConcepto"); if(co&&data.concepto) co.value=data.concepto;
      const no=document.getElementById("npNotas");    if(no&&data.notas)    no.value=data.notas;
      toast("✅ Plantilla aplicada","success",2000);
    } else {
      addLinea();
    }
    updateTotalesUI(); updatePreview();
  });
}
