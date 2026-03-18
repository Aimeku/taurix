/* ═══════════════════════════════════════════════════════
   TAURIX · trabajos.js
   
   Gestión de trabajos / órdenes de trabajo:
   · Crear trabajo con cliente, técnico, descripción
   · Estados: Pendiente → En curso → Terminado → Facturado
   · Asignar técnico del equipo
   · Añadir materiales usados del catálogo
   · Convertir trabajo terminado a factura en 1 click
   · Vista kanban por estado
   · Vista lista con filtros
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, fmtDate, toast, openModal, closeModal, getYear } from "./utils.js";
import { PRODUCTOS } from "./productos.js";

/* ══════════════════════════
   ESTADOS
══════════════════════════ */
const ESTADOS = [
  { id:"pendiente",  label:"Pendiente",   color:"#f59e0b", bg:"#fef9c3", icon:"⏳" },
  { id:"en_curso",   label:"En curso",    color:"#3b82f6", bg:"#eff6ff", icon:"🔧" },
  { id:"terminado",  label:"Terminado",   color:"#059669", bg:"#f0fdf4", icon:"✅" },
  { id:"facturado",  label:"Facturado",   color:"#6b7280", bg:"#f9fafb", icon:"🧾" },
];

const PRIORIDADES = [
  { id:"baja",   label:"Baja",   color:"#059669" },
  { id:"normal", label:"Normal", color:"#3b82f6" },
  { id:"alta",   label:"Alta",   color:"#f59e0b" },
  { id:"urgente",label:"Urgente",color:"#dc2626" },
];

let TRABAJOS   = [];
let TECNICOS   = [];
let VISTA      = "kanban"; // "kanban" | "lista"

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadTrabajos() {
  const [trabajosRes, tecnicosRes] = await Promise.all([
    supabase.from("trabajos").select("*")
      .eq("user_id", SESSION.user.id)
      .order("created_at", { ascending: false }),
    supabase.from("empleados").select("id,nombre,puesto")
      .eq("user_id", SESSION.user.id).eq("activo", true),
  ]);
  TRABAJOS = trabajosRes.data || [];
  TECNICOS = tecnicosRes.data || [];
  return TRABAJOS;
}

export async function refreshTrabajos() {
  await loadTrabajos();
  renderKPIs();
  if (VISTA === "kanban") renderKanban();
  else renderLista();
}

/* ══════════════════════════
   KPIs
══════════════════════════ */
function renderKPIs() {
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("trabajosTotal",     TRABAJOS.length);
  s("trabajosPendiente", TRABAJOS.filter(t=>t.estado==="pendiente").length);
  s("trabajosEnCurso",   TRABAJOS.filter(t=>t.estado==="en_curso").length);
  s("trabajosTerminado", TRABAJOS.filter(t=>t.estado==="terminado").length);
  s("trabajosFacturado", TRABAJOS.filter(t=>t.estado==="facturado").length);
}

/* ══════════════════════════
   KANBAN
══════════════════════════ */
function renderKanban() {
  const board = document.getElementById("trabajosKanban");
  if (!board) return;

  board.innerHTML = ESTADOS.map(est => {
    const trabajos = TRABAJOS.filter(t => t.estado === est.id);
    return `
      <div class="trabajo-col" data-estado="${est.id}"
           ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="window._dropTrabajo(event,'${est.id}')">
        <div class="trabajo-col-hd" style="border-left:3px solid ${est.color}">
          <span style="font-size:14px">${est.icon}</span>
          <span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${est.color}">${est.label}</span>
          <span style="margin-left:auto;background:${est.bg};color:${est.color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${trabajos.length}</span>
        </div>
        <div class="trabajo-col-body" id="col_${est.id}">
          ${trabajos.map(t => renderTarjeta(t)).join("")}
          ${!trabajos.length ? `<div style="text-align:center;padding:20px 10px;color:var(--t4);font-size:12px">Sin trabajos</div>` : ""}
        </div>
      </div>`;
  }).join("");
}

function renderTarjeta(t) {
  const est   = ESTADOS.find(e=>e.id===t.estado);
  const prio  = PRIORIDADES.find(p=>p.id===t.prioridad);
  const tec   = TECNICOS.find(e=>e.id===t.tecnico_id);
  const total = (t.materiales||[]).reduce((a,m)=>a+(m.precio||0)*(m.cantidad||1),0) + (t.mano_obra||0);

  return `
    <div class="trabajo-card" draggable="true"
         ondragstart="window._dragTrabajo(event,'${t.id}')"
         onclick="window._editTrabajo('${t.id}')">
      ${prio ? `<div style="height:3px;background:${prio.color};border-radius:3px 3px 0 0;margin:-12px -12px 10px"></div>` : ""}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="font-size:13px;font-weight:700;color:var(--t1);line-height:1.4;flex:1">${t.titulo}</div>
        <span style="font-size:10px;font-weight:700;font-family:monospace;color:var(--t4);white-space:nowrap">#${t.numero||"—"}</span>
      </div>
      ${t.cliente_nombre ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">👤 ${t.cliente_nombre}</div>` : ""}
      ${t.descripcion ? `<div style="font-size:11px;color:var(--t3);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.descripcion}</div>` : ""}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap;gap:4px">
        <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
          ${tec ? `<span style="background:var(--bg2);color:var(--t3);font-size:10px;padding:2px 7px;border-radius:6px">🔧 ${tec.nombre}</span>` : ""}
          ${prio ? `<span style="background:${prio.color}18;color:${prio.color};font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px">${prio.label}</span>` : ""}
          ${t.fecha_programada ? `<span style="font-size:10px;color:var(--t4)">📅 ${fmtDate(t.fecha_programada)}</span>` : ""}
        </div>
        ${total > 0 ? `<span style="font-size:12px;font-weight:700;font-family:monospace;color:var(--accent)">${fmt(total)}</span>` : ""}
      </div>
      <div style="display:flex;gap:5px;margin-top:8px">
        <button onclick="event.stopPropagation();window._imprimirTrabajo('${t.id}')"
                style="flex:1;padding:5px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:10px;font-weight:700;color:#1a56db;cursor:pointer">
          🖨️ Imprimir
        </button>
        ${t.estado==="terminado" ? `
        <button onclick="event.stopPropagation();window._convertirAFactura('${t.id}')"
                style="flex:2;padding:5px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:10px;font-weight:700;color:#059669;cursor:pointer">
          🧾 A factura
        </button>` : ""}
      </div>
    </div>`;
}

/* ══════════════════════════
   LISTA
══════════════════════════ */
function renderLista() {
  const tbody = document.getElementById("trabajosListaBody");
  if (!tbody) return;

  const q = document.getElementById("trabajosBusqueda")?.value?.toLowerCase() || "";
  const filtro = document.getElementById("trabajosFiltroEstado")?.value || "";

  let list = TRABAJOS;
  if (q)      list = list.filter(t => (t.titulo+t.cliente_nombre+t.descripcion).toLowerCase().includes(q));
  if (filtro) list = list.filter(t => t.estado === filtro);

  if (!list.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">Sin trabajos</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const est  = ESTADOS.find(e=>e.id===t.estado);
    const prio = PRIORIDADES.find(p=>p.id===t.prioridad);
    const tec  = TECNICOS.find(e=>e.id===t.tecnico_id);
    const total = (t.materiales||[]).reduce((a,m)=>a+(m.precio||0)*(m.cantidad||1),0) + (t.mano_obra||0);
    return `<tr style="cursor:pointer" onclick="window._editTrabajo('${t.id}')">
      <td class="mono" style="font-size:11px;color:var(--t4)">#${t.numero||"—"}</td>
      <td style="font-weight:600">${t.titulo}</td>
      <td style="font-size:12px;color:var(--t3)">${t.cliente_nombre||"—"}</td>
      <td>${tec ? `<span style="font-size:12px">${tec.nombre}</span>` : `<span style="color:var(--t4)">—</span>`}</td>
      <td><span style="background:${est?.bg};color:${est?.color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px">${est?.icon} ${est?.label}</span></td>
      <td>${prio ? `<span style="color:${prio.color};font-size:11px;font-weight:700">${prio.label}</span>` : "—"}</td>
      <td class="mono" style="font-weight:700">${total>0?fmt(total):"—"}</td>
      <td>${t.fecha_programada ? fmtDate(t.fecha_programada) : "—"}</td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   DRAG & DROP
══════════════════════════ */
let _dragId = null;
window._dragTrabajo = (e, id) => { _dragId = id; e.dataTransfer.effectAllowed="move"; };
window._dropTrabajo = async (e, nuevoEstado) => {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  if (!_dragId) return;
  await supabase.from("trabajos").update({ estado: nuevoEstado }).eq("id", _dragId);
  _dragId = null;
  await refreshTrabajos();
};

/* ══════════════════════════
   MODAL NUEVO / EDITAR TRABAJO
══════════════════════════ */
export function showNuevoTrabajoModal(prefill = {}) {
  const isEdit = !!prefill.id;

  const clienteOpts = CLIENTES.map(c =>
    `<option value="${c.id}" data-nombre="${c.nombre}" ${prefill.cliente_id===c.id?"selected":""}>${c.nombre}</option>`
  ).join("");

  const tecnicoOpts = TECNICOS.length === 0
    ? `<option value="">Sin técnicos — añade empleados primero</option>`
    : `<option value="">Sin asignar</option>` +
      TECNICOS.map(e =>
        `<option value="${e.id}" ${prefill.tecnico_id===e.id?"selected":""}>${e.nombre}${e.puesto?` · ${e.puesto}`:""}</option>`
      ).join("");

  const tecnicoHint = TECNICOS.length === 0
    ? `<div style="font-size:11px;color:#d97706;margin-top:4px;display:flex;align-items:center;gap:5px">
        ⚠️ No tienes técnicos/empleados.
        <button onclick="window._cm();window._switchView&&window._switchView('empleados')"
                style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;font-weight:700;padding:0">
          Añadir empleados →
        </button>
      </div>` : "";

  const materiales = prefill.materiales || [];

  openModal(`
    <div class="modal modal--wide" style="max-width:780px">
      <div class="modal-hd">
        <span class="modal-title">🔧 ${isEdit?"Editar":"Nuevo"} trabajo</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <div class="modal-grid2">
          <div class="modal-field" style="grid-column:1/-1">
            <label>Título del trabajo *</label>
            <input id="tj_titulo" class="ff-input" value="${prefill.titulo||""}"
                   placeholder="Ej: Instalación aire acondicionado · Reparación caldera…"/>
          </div>
          <div class="modal-field"><label>Cliente</label>
            <select id="tj_cliente" class="ff-select">
              <option value="">— Sin cliente —</option>
              ${clienteOpts}
            </select>
          </div>
          <div class="modal-field"><label>Técnico asignado</label>
            <select id="tj_tecnico" class="ff-select" ${TECNICOS.length===0?"disabled":""}>
              ${tecnicoOpts}
            </select>
            ${tecnicoHint}
          </div>
          <div class="modal-field"><label>Estado</label>
            <select id="tj_estado" class="ff-select">
              ${ESTADOS.map(e=>`<option value="${e.id}" ${(prefill.estado||"pendiente")===e.id?"selected":""}>${e.icon} ${e.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Prioridad</label>
            <select id="tj_prioridad" class="ff-select">
              ${PRIORIDADES.map(p=>`<option value="${p.id}" ${(prefill.prioridad||"normal")===p.id?"selected":""}>${p.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Fecha programada</label>
            <input type="date" id="tj_fecha" class="ff-input" value="${prefill.fecha_programada||""}"/>
          </div>
          <div class="modal-field"><label>Hora</label>
            <input type="time" id="tj_hora" class="ff-input" value="${prefill.hora||""}"/>
          </div>
        </div>

        <div class="modal-field">
          <label>Descripción / notas del trabajo</label>
          <textarea id="tj_desc" class="ff-input ff-textarea" style="min-height:72px"
            placeholder="Describe el trabajo a realizar, observaciones, acceso al lugar…">${prefill.descripcion||""}</textarea>
        </div>

        <div class="modal-field">
          <label>Dirección / ubicación</label>
          <input id="tj_direccion" class="ff-input" value="${prefill.direccion||""}"
                 placeholder="Calle, número, ciudad…"/>
        </div>

        <!-- Materiales -->
        <div style="margin-top:16px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
            <span>📦 Materiales utilizados</span>
            <button id="tj_addMat" class="btn-outline" style="font-size:11px;padding:4px 10px">+ Añadir material</button>
          </div>
          <div id="tj_materiales">
            ${materiales.map((m,i) => renderMatRow(m,i)).join("")}
          </div>
          ${!materiales.length ? `<div style="font-size:12px;color:var(--t4);padding:8px 0" id="tj_matEmpty">Sin materiales añadidos</div>` : ""}
        </div>

        <!-- Mano de obra -->
        <div class="modal-grid2" style="margin-top:12px">
          <div class="modal-field"><label>Mano de obra (€)</label>
            <input type="number" id="tj_manoObra" class="ff-input" value="${prefill.mano_obra||""}"
                   step="0.01" min="0" placeholder="0.00"/>
          </div>
          <div class="modal-field"><label>IVA</label>
            <select id="tj_iva" class="ff-select">
              <option value="21" ${(prefill.iva||21)===21?"selected":""}>21%</option>
              <option value="10" ${prefill.iva===10?"selected":""}>10%</option>
              <option value="0"  ${prefill.iva===0 ?"selected":""}>0%</option>
            </select>
          </div>
        </div>

        <!-- Total estimado -->
        <div style="background:var(--bg2);border-radius:10px;padding:12px 16px;margin-top:8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px;font-weight:600;color:var(--t2)">Total estimado</span>
          <span style="font-size:18px;font-weight:800;font-family:monospace;color:var(--accent)" id="tj_totalPreview">0,00 €</span>
        </div>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        ${isEdit ? `
          <button class="btn-outline" onclick="window._imprimirTrabajo('${prefill.id}')">
            🖨️ Imprimir orden
          </button>` : ""}
        ${isEdit && prefill.estado==="terminado" ? `
          <button class="btn-outline" style="color:#059669;border-color:#059669"
                  onclick="window._convertirAFactura('${prefill.id}');window._cm()">
            🧾 Convertir a factura
          </button>` : ""}
        <button class="btn-modal-save" id="tj_save">${isEdit?"Actualizar":"Crear trabajo"}</button>
      </div>
    </div>`);

  // Material rows
  let matCount = materiales.length;
  const updateTotal = () => {
    const mano  = parseFloat(document.getElementById("tj_manoObra")?.value)||0;
    const mats  = [...document.querySelectorAll(".tj-mat-row")].reduce((a,row) => {
      const qty = parseFloat(row.querySelector(".tj-mat-qty")?.value)||0;
      const prc = parseFloat(row.querySelector(".tj-mat-price")?.value)||0;
      return a + qty * prc;
    }, 0);
    const total = mano + mats;
    const prev  = document.getElementById("tj_totalPreview");
    if (prev) prev.textContent = fmt(total);
  };

  // Bind autocomplete on existing material rows
  document.querySelectorAll(".tj-mat-row").forEach(row => bindMatRowAutocomplete(row, updateTotal));

  document.getElementById("tj_addMat")?.addEventListener("click", () => {
    const empty = document.getElementById("tj_matEmpty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.innerHTML = renderMatRow({}, matCount++);
    const newRow = div.firstElementChild;
    document.getElementById("tj_materiales")?.appendChild(newRow);
    newRow.querySelector(".tj-mat-qty")?.addEventListener("input", updateTotal);
    newRow.querySelector(".tj-mat-price")?.addEventListener("input", updateTotal);
    bindMatRowAutocomplete(newRow, updateTotal);
    newRow.querySelector(".tj-mat-name")?.focus();
  });

  document.getElementById("tj_manoObra")?.addEventListener("input", updateTotal);
  document.querySelectorAll(".tj-mat-qty,.tj-mat-price").forEach(el => el.addEventListener("input", updateTotal));
  updateTotal();

  window._removeMat = (i) => {
    document.querySelector(`.tj-mat-row[data-i="${i}"]`)?.remove();
    updateTotal();
  };

  document.getElementById("tj_save").addEventListener("click", async () => {
    const titulo = document.getElementById("tj_titulo").value.trim();
    if (!titulo) { toast("El título es obligatorio","error"); return; }

    const clienteSel = document.getElementById("tj_cliente");
    const clienteNombre = clienteSel?.selectedOptions[0]?.dataset.nombre || "";

    const materiales = [...document.querySelectorAll(".tj-mat-row")].map(row => ({
      nombre:      row.querySelector(".tj-mat-name")?.value||"",
      cantidad:    parseFloat(row.querySelector(".tj-mat-qty")?.value)||1,
      precio:      parseFloat(row.querySelector(".tj-mat-price")?.value)||0,
      producto_id: row.dataset.productoId || null,
    })).filter(m => m.nombre);

    const manoObra = parseFloat(document.getElementById("tj_manoObra")?.value)||0;

    const payload = {
      user_id:          SESSION.user.id,
      titulo,
      cliente_id:       document.getElementById("tj_cliente").value || null,
      cliente_nombre:   clienteNombre,
      tecnico_id:       document.getElementById("tj_tecnico").value || null,
      estado:           document.getElementById("tj_estado").value,
      prioridad:        document.getElementById("tj_prioridad").value,
      fecha_programada: document.getElementById("tj_fecha").value || null,
      hora:             document.getElementById("tj_hora").value || null,
      descripcion:      document.getElementById("tj_desc").value.trim() || null,
      direccion:        document.getElementById("tj_direccion").value.trim() || null,
      mano_obra:        manoObra || null,
      iva:              parseInt(document.getElementById("tj_iva").value),
      materiales:       materiales.length ? JSON.stringify(materiales) : null,
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase.from("trabajos").update(payload).eq("id", prefill.id));
    } else {
      // Número auto
      const { count } = await supabase.from("trabajos")
        .select("*", { count:"exact", head:true }).eq("user_id", SESSION.user.id);
      payload.numero = String((count||0)+1).padStart(4,"0");
      ({ error } = await supabase.from("trabajos").insert(payload));
    }

    if (error) { toast("Error: "+error.message,"error"); return; }

    // Descontar stock de productos usados (solo al crear, no al editar)
    if (!isEdit) {
      for (const mat of materiales) {
        if (!mat.producto_id || !mat.cantidad) continue;
        const prod = (PRODUCTOS||[]).find(p=>p.id===mat.producto_id);
        if (prod && prod.stock_actual !== null) {
          const nuevoStock = Math.max(0, prod.stock_actual - mat.cantidad);
          await supabase.from("productos").update({ stock_actual: nuevoStock })
            .eq("id", mat.producto_id);
          // Alerta si stock bajo
          if (nuevoStock <= (prod.stock_minimo||0)) {
            toast(`⚠️ Stock bajo en "${prod.nombre}": ${nuevoStock} unidades`, "warn", 5000);
          }
        }
      }
    }

    toast(isEdit?"Trabajo actualizado ✅":"Trabajo creado ✅","success");
    closeModal();
    await refreshTrabajos();
  });
}

function renderMatRow(m={}, i=0) {
  const stockInfo = m.producto_id && PRODUCTOS.find(p=>p.id===m.producto_id);
  const stockBadge = stockInfo && stockInfo.stock_actual !== null
    ? `<span style="font-size:10px;color:${stockInfo.stock_actual<=0?"#dc2626":stockInfo.stock_actual<=(stockInfo.stock_minimo||0)?"#d97706":"#059669"};font-weight:700" title="Stock disponible: ${stockInfo.stock_actual} ${stockInfo.unidad||"uds"}">
        Stock: ${stockInfo.stock_actual}
      </span>` : "";

  return `
    <div class="tj-mat-row" data-i="${i}" data-producto-id="${m.producto_id||""}"
         style="display:grid;grid-template-columns:1fr 70px 95px 32px;gap:6px;margin-bottom:6px;align-items:center">
      <div style="position:relative">
        <input class="ff-input tj-mat-name" placeholder="Material del catálogo o nombre libre…"
               value="${m.nombre||""}" autocomplete="off" style="font-size:12px"/>
        <div class="tj-mat-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--srf);border:1px solid var(--brd);border-radius:8px;z-index:100;max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.12)"></div>
        ${stockBadge ? `<div style="margin-top:2px">${stockBadge}</div>` : ""}
      </div>
      <input type="number" class="ff-input tj-mat-qty" placeholder="Cant."
             value="${m.cantidad||1}" min="0.01" step="0.01"
             style="font-size:12px;text-align:center"/>
      <input type="number" class="ff-input tj-mat-price" placeholder="Precio €"
             value="${m.precio||""}" min="0" step="0.01"
             style="font-size:12px;text-align:right;font-family:monospace"/>
      <button onclick="window._removeMat(${i})" class="ta-btn ta-del" style="font-size:12px">×</button>
    </div>`;
}

function bindMatRowAutocomplete(row, updateTotal) {
  const nameInput = row.querySelector(".tj-mat-name");
  const qtyInput  = row.querySelector(".tj-mat-qty");
  const priceInput= row.querySelector(".tj-mat-price");
  const dropdown  = row.querySelector(".tj-mat-dropdown");
  if (!nameInput || !dropdown) return;

  nameInput.addEventListener("input", () => {
    const q = nameInput.value.toLowerCase().trim();
    if (!q || q.length < 1) { dropdown.style.display="none"; return; }

    const matches = (PRODUCTOS||[]).filter(p =>
      p.activo !== false && (
        p.nombre.toLowerCase().includes(q) ||
        (p.referencia||"").toLowerCase().includes(q) ||
        (p.codigo_barras||"").toLowerCase().includes(q)
      )
    ).slice(0,8);

    if (!matches.length) { dropdown.style.display="none"; return; }

    dropdown.innerHTML = matches.map(p => {
      const stockOk = p.stock_actual === null || p.stock_actual > 0;
      const stockTxt = p.stock_actual !== null ? ` · Stock: ${p.stock_actual}` : "";
      return `<div class="tj-mat-ac-item" data-id="${p.id}" data-nombre="${p.nombre}"
                   data-precio="${p.precio}" data-unidad="${p.unidad||""}"
                   style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);opacity:${stockOk?1:0.5}">
        <div>
          <div style="font-size:12px;font-weight:600">${p.nombre}</div>
          <div style="font-size:10px;color:var(--t3)">${p.referencia||p.tipo||""}${stockTxt}</div>
        </div>
        <div style="font-size:12px;font-weight:700;font-family:monospace;color:var(--accent)">${fmt(p.precio)}</div>
      </div>`;
    }).join("");

    dropdown.querySelectorAll(".tj-mat-ac-item").forEach(item => {
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        nameInput.value  = item.dataset.nombre;
        priceInput.value = item.dataset.precio;
        row.dataset.productoId = item.dataset.id;
        dropdown.style.display = "none";
        // Show stock badge
        const prod = PRODUCTOS.find(p=>p.id===item.dataset.id);
        if (prod && prod.stock_actual !== null) {
          let badge = row.querySelector(".tj-stock-badge");
          if (!badge) { badge = document.createElement("div"); badge.className="tj-stock-badge"; badge.style.cssText="margin-top:2px;font-size:10px;font-weight:700"; nameInput.parentElement.appendChild(badge); }
          const low = prod.stock_actual <= (prod.stock_minimo||0);
          badge.style.color = prod.stock_actual<=0?"#dc2626":low?"#d97706":"#059669";
          badge.textContent = prod.stock_actual<=0 ? "⚠️ Sin stock" : low ? `⚠️ Stock bajo: ${prod.stock_actual}` : `✓ Stock disponible: ${prod.stock_actual}`;
        }
        updateTotal();
      });
    });

    dropdown.style.display = "";
  });

  nameInput.addEventListener("blur", () => setTimeout(()=>{ dropdown.style.display="none"; }, 200));
  nameInput.addEventListener("focus", () => { if(nameInput.value) nameInput.dispatchEvent(new Event("input")); });
}

/* ══════════════════════════
   CONVERTIR A FACTURA
══════════════════════════ */
window._convertirAFactura = async (id) => {
  const t = TRABAJOS.find(x => x.id === id);
  if (!t) return;

  const mats = typeof t.materiales === "string"
    ? JSON.parse(t.materiales) : (t.materiales || []);

  const lineas = [];
  if (t.mano_obra > 0) {
    lineas.push({ descripcion:"Mano de obra", cantidad:1, precio:t.mano_obra, iva:t.iva||21 });
  }
  mats.forEach(m => {
    if (m.nombre) lineas.push({ descripcion:m.nombre, cantidad:m.cantidad||1, precio:m.precio||0, iva:t.iva||21 });
  });

  const base = lineas.reduce((a,l) => a + l.cantidad*l.precio, 0);

  openModal(`
    <div class="modal" style="max-width:520px">
      <div class="modal-hd">
        <span class="modal-title">🧾 Convertir trabajo a factura</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="background:var(--bg2);border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="font-size:14px;font-weight:700;margin-bottom:4px">${t.titulo}</div>
          <div style="font-size:12px;color:var(--t3)">
            ${t.cliente_nombre||"Sin cliente"} · ${lineas.length} línea${lineas.length!==1?"s":""}
          </div>
        </div>
        <div style="margin-bottom:16px">
          ${lineas.map(l=>`
            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--brd);font-size:13px">
              <span>${l.descripcion} ${l.cantidad!==1?`× ${l.cantidad}`:""}</span>
              <span class="mono fw7">${fmt(l.cantidad*l.precio)}</span>
            </div>`).join("")}
          <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:15px;font-weight:800;color:var(--accent)">
            <span>Total (sin IVA)</span>
            <span class="mono">${fmt(base)}</span>
          </div>
        </div>
        <div class="modal-field">
          <label>Notas adicionales en la factura</label>
          <input id="tjf_notas" class="ff-input" placeholder="Trabajo realizado el ${fmtDate(t.fecha_programada||new Date().toISOString().slice(0,10))}…"/>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="tjf_ok">Crear factura →</button>
      </div>
    </div>`);

  document.getElementById("tjf_ok").addEventListener("click", async () => {
    const notas = document.getElementById("tjf_notas").value.trim();

    // Crear factura
    const { data: serie } = await supabase.rpc("get_next_factura_number", {
      user_id: SESSION.user.id, serie: "FAC"
    });

    const { error } = await supabase.from("facturas").insert({
      user_id:        SESSION.user.id,
      tipo:           "emitida",
      estado:         "emitida",
      fecha:          new Date().toISOString().slice(0,10),
      numero_factura: serie || `FAC-${Date.now()}`,
      cliente_id:     t.cliente_id || null,
      cliente_nombre: t.cliente_nombre || "",
      concepto:       t.titulo,
      base,
      iva:            t.iva || 21,
      lineas:         JSON.stringify(lineas),
      notas:          notas || `Trabajo #${t.numero} — ${t.descripcion||""}`,
    });

    if (error) { toast("Error creando factura: "+error.message,"error"); return; }

    // Marcar trabajo como facturado
    await supabase.from("trabajos").update({ estado:"facturado" }).eq("id", id);

    toast("✅ Factura creada correctamente","success",4000);
    closeModal();
    await refreshTrabajos();
  });
};

/* ══════════════════════════
   ACCIONES GLOBALES
══════════════════════════ */
window._editTrabajo = async (id) => {
  const t = TRABAJOS.find(x => x.id === id);
  if (!t) return;
  const parsed = { ...t, materiales: typeof t.materiales==="string" ? JSON.parse(t.materiales||"[]") : (t.materiales||[]) };
  showNuevoTrabajoModal(parsed);
};

window._delTrabajo = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar trabajo</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este trabajo? No se puede deshacer.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dtOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dtOk").addEventListener("click", async () => {
    await supabase.from("trabajos").delete().eq("id", id);
    closeModal(); toast("Trabajo eliminado","success");
    await refreshTrabajos();
  });
};


/* ══════════════════════════
   PDF ORDEN DE TRABAJO
══════════════════════════ */
export async function generarPDFTrabajo(trabajoId) {
  // Cargar jsPDF si no está
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      if (document.querySelector('script[src*="jspdf"]')) { res(); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const t = TRABAJOS.find(x => x.id === trabajoId);
  if (!t) { toast("Trabajo no encontrado","error"); return; }

  const tec   = TECNICOS.find(e => e.id === t.tecnico_id);
  const mats  = typeof t.materiales === "string"
    ? JSON.parse(t.materiales || "[]") : (t.materiales || []);

  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).maybeSingle();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:"mm", format:"a4" });
  const PW = 210, ML = 18, W = PW - ML*2;

  // ── Colores ──
  const BLUE  = [26,86,219];
  const DARK  = [15,23,42];
  const MUTED = [100,116,139];
  const GREEN = [5,150,105];
  const AMBER = [217,119,6];

  const est   = ESTADOS.find(e => e.id === t.estado);
  const prio  = PRIORIDADES.find(p => p.id === t.prioridad);

  // ── Cabecera azul ──
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PW, 32, "F");

  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold");
  doc.setFontSize(16);
  doc.text("ORDEN DE TRABAJO", ML, 13);

  doc.setFontSize(9);
  doc.setFont("helvetica","normal");
  doc.text(`Nº ${t.numero || "—"}  ·  ${new Date().toLocaleDateString("es-ES")}`, ML, 20);
  if (pf?.nombre_razon_social) {
    doc.setFontSize(8);
    doc.text(pf.nombre_razon_social, PW - ML, 13, { align:"right" });
    if (pf.nif) doc.text(`NIF: ${pf.nif}`, PW - ML, 19, { align:"right" });
  }

  // ── Badge estado ──
  const estadoColors = {
    pendiente:[245,158,11], en_curso:[59,130,246],
    terminado:[5,150,105],  facturado:[107,114,128]
  };
  const ec = estadoColors[t.estado] || estadoColors.pendiente;
  doc.setFillColor(...ec);
  doc.roundedRect(PW - ML - 32, 22, 32, 7, 2, 2, "F");
  doc.setTextColor(255,255,255);
  doc.setFontSize(8);
  doc.setFont("helvetica","bold");
  doc.text((est?.label || t.estado).toUpperCase(), PW - ML - 16, 27, { align:"center" });

  let y = 40;

  // ── Bloque trabajo ──
  doc.setTextColor(...DARK);
  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text(t.titulo, ML, y); y += 7;

  if (t.descripcion) {
    doc.setFont("helvetica","normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(t.descripcion, W);
    doc.text(lines, ML, y);
    y += lines.length * 4.5 + 4;
  }

  // ── Grid info (2 columnas) ──
  y += 2;
  const infoBox = (label, value, x, yy, w) => {
    doc.setFillColor(248,250,252);
    doc.rect(x, yy, w, 14, "F");
    doc.setDrawColor(226,232,240);
    doc.rect(x, yy, w, 14, "S");
    doc.setTextColor(...MUTED);
    doc.setFontSize(7);
    doc.setFont("helvetica","normal");
    doc.text(label.toUpperCase(), x+4, yy+5);
    doc.setTextColor(...DARK);
    doc.setFontSize(9);
    doc.setFont("helvetica","bold");
    doc.text(String(value||"—").slice(0,35), x+4, yy+11);
  };

  const half = (W-4)/2;
  infoBox("Cliente",           t.cliente_nombre||"—",                 ML,       y,   half);
  infoBox("Técnico asignado",  tec?.nombre||"Sin asignar",             ML+half+4, y,  half);
  y += 17;
  infoBox("Fecha programada",  t.fecha_programada ? fmtDate(t.fecha_programada) : "—", ML, y, half);
  infoBox("Prioridad",         prio?.label||"Normal",                  ML+half+4, y, half);
  y += 17;

  if (t.direccion) {
    infoBox("Dirección / Ubicación", t.direccion, ML, y, W);
    y += 17;
  }
  y += 2;

  // ── Descripción del trabajo ──
  if (t.notas) {
    doc.setFillColor(255,251,235);
    doc.setDrawColor(253,230,138);
    doc.rect(ML, y, W, 1, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...AMBER);
    doc.text("NOTAS", ML, y+5);
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...DARK);
    const noLines = doc.splitTextToSize(t.notas, W);
    doc.text(noLines, ML, y+10);
    y += noLines.length * 4.5 + 16;
  }

  // ── Materiales ──
  if (mats.length > 0) {
    // Cabecera tabla
    doc.setFillColor(...BLUE);
    doc.rect(ML, y, W, 8, "F");
    doc.setTextColor(255,255,255);
    doc.setFont("helvetica","bold");
    doc.setFontSize(8);
    doc.text("MATERIALES UTILIZADOS", ML+3, y+5.5);
    y += 8;

    // Columnas: Descripción | Cantidad | Precio unit. | Total
    const cols = [W*0.55, W*0.15, W*0.15, W*0.15];
    const heads = ["Descripción", "Cant.", "Precio unit.", "Total"];
    let x = ML;

    doc.setFillColor(241,245,249);
    doc.rect(ML, y, W, 7, "F");
    doc.setTextColor(...MUTED);
    doc.setFontSize(7.5);
    doc.setFont("helvetica","bold");
    heads.forEach((h,i) => {
      doc.text(h, x+2, y+4.8, { align: i>0?"right":"left", maxWidth: cols[i]-4 });
      x += cols[i];
    });
    y += 7;

    mats.forEach((m, ri) => {
      if (!m.nombre) return;
      const total = (m.cantidad||1)*(m.precio||0);
      if (ri%2===0) { doc.setFillColor(248,250,252); doc.rect(ML,y,W,6.5,"F"); }
      doc.setDrawColor(226,232,240);
      doc.rect(ML, y, W, 6.5, "S");
      doc.setTextColor(...DARK);
      doc.setFontSize(8);
      doc.setFont("helvetica","normal");
      x = ML;
      const rowData = [m.nombre, String(m.cantidad||1), fmt(m.precio||0), fmt(total)];
      rowData.forEach((v,i) => {
        doc.text(v.slice(0,45), x + (i>0?cols[i]-2:2), y+4.5, { align:i>0?"right":"left", maxWidth:cols[i]-4 });
        x += cols[i];
      });
      y += 6.5;
      if (y > 260) { doc.addPage(); y = 20; }
    });

    // Totales
    const totalMat  = mats.reduce((a,m)=>(a+(m.cantidad||1)*(m.precio||0)),0);
    const totalMO   = t.mano_obra || 0;
    const totalBase = totalMat + totalMO;
    const totalIVA  = totalBase*(t.iva||21)/100;
    const totalFin  = totalBase + totalIVA;

    y += 2;
    const drawTotal = (label, valor, bold=false) => {
      if (bold) { doc.setFillColor(241,245,249); doc.rect(ML+W*0.55,y,W*0.45,7,"F"); }
      doc.setFont("helvetica", bold?"bold":"normal");
      doc.setFontSize(8.5);
      if(bold) doc.setTextColor(...BLUE); else doc.setTextColor(...MUTED);
      doc.text(label, ML+W*0.56, y+5);
      doc.setTextColor(...DARK);
      doc.text(fmt(valor), PW-ML-2, y+5, { align:"right" });
      y += 7;
    };
    if (totalMO>0) drawTotal("Mano de obra", totalMO);
    drawTotal("Materiales", totalMat);
    drawTotal(`IVA ${t.iva||21}%`, totalIVA);
    drawTotal("TOTAL ESTIMADO", totalFin, true);
    y += 4;
  }

  // ── Mano de obra sola (sin materiales) ──
  else if (t.mano_obra > 0) {
    doc.setFillColor(241,245,249);
    doc.rect(ML, y, W, 7, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...DARK);
    doc.text("Mano de obra:", ML+3, y+5);
    doc.text(fmt(t.mano_obra), PW-ML-2, y+5, { align:"right" });
    y += 12;
  }

  // ── Firma técnico ──
  y = Math.max(y, 230);
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.3);
  doc.line(ML, y, ML+70, y);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma del técnico", ML, y+5);
  doc.text(tec?.nombre||"", ML, y+9);

  doc.line(PW-ML-70, y, PW-ML, y);
  doc.text("Firma del cliente / Conforme", PW-ML-70, y+5);
  doc.text(t.cliente_nombre||"", PW-ML-70, y+9);

  // ── Pie ──
  doc.setFontSize(7); doc.setTextColor(...MUTED);
  doc.text(`Orden de trabajo generada por Taurix · ${new Date().toLocaleDateString("es-ES")}`, PW/2, 290, { align:"center" });

  doc.save(`orden_trabajo_${t.numero||t.id.slice(0,8)}.pdf`);
  toast("🖨️ PDF de trabajo descargado", "success");
}

window._imprimirTrabajo = (id) => generarPDFTrabajo(id);

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initTrabajosView() {
  document.getElementById("nuevoTrabajoBtn")?.addEventListener("click", () => showNuevoTrabajoModal());

  // Toggle vista kanban/lista
  document.getElementById("trabajosVistaKanban")?.addEventListener("click", () => {
    VISTA = "kanban";
    document.getElementById("trabajosVistaKanban")?.classList.add("active");
    document.getElementById("trabajosVistaLista")?.classList.remove("active");
    document.getElementById("trabajosKanbanWrap")?.classList.remove("hidden");
    document.getElementById("trabajosListaWrap")?.classList.add("hidden");
    renderKanban();
  });

  document.getElementById("trabajosVistaLista")?.addEventListener("click", () => {
    VISTA = "lista";
    document.getElementById("trabajosVistaLista")?.classList.add("active");
    document.getElementById("trabajosVistaKanban")?.classList.remove("active");
    document.getElementById("trabajosKanbanWrap")?.classList.add("hidden");
    document.getElementById("trabajosListaWrap")?.classList.remove("hidden");
    renderLista();
  });

  // Búsqueda y filtros en lista
  document.getElementById("trabajosBusqueda")?.addEventListener("input", renderLista);
  document.getElementById("trabajosFiltroEstado")?.addEventListener("change", renderLista);

  refreshTrabajos();
}
