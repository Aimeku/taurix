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
      ${t.estado==="terminado" ? `
        <button onclick="event.stopPropagation();window._convertirAFactura('${t.id}')"
                style="width:100%;margin-top:8px;padding:6px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:11px;font-weight:700;color:#059669;cursor:pointer">
          🧾 Convertir a factura
        </button>` : ""}
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

  const tecnicoOpts = `<option value="">Sin asignar</option>` +
    TECNICOS.map(e =>
      `<option value="${e.id}" ${prefill.tecnico_id===e.id?"selected":""}>${e.nombre}${e.puesto?` · ${e.puesto}`:""}</option>`
    ).join("");

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
            <select id="tj_tecnico" class="ff-select">${tecnicoOpts}</select>
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

  document.getElementById("tj_addMat")?.addEventListener("click", () => {
    const empty = document.getElementById("tj_matEmpty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.innerHTML = renderMatRow({},matCount++);
    document.getElementById("tj_materiales")?.appendChild(div.firstElementChild);
    div.querySelector(".tj-mat-qty")?.addEventListener("input", updateTotal);
    div.querySelector(".tj-mat-price")?.addEventListener("input", updateTotal);
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
      nombre:   row.querySelector(".tj-mat-name")?.value||"",
      cantidad: parseFloat(row.querySelector(".tj-mat-qty")?.value)||1,
      precio:   parseFloat(row.querySelector(".tj-mat-price")?.value)||0,
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
    toast(isEdit?"Trabajo actualizado ✅":"Trabajo creado ✅","success");
    closeModal();
    await refreshTrabajos();
  });
}

function renderMatRow(m={}, i=0) {
  return `
    <div class="tj-mat-row" data-i="${i}" style="display:grid;grid-template-columns:1fr 70px 90px 32px;gap:6px;margin-bottom:6px;align-items:center">
      <input class="ff-input tj-mat-name" placeholder="Nombre del material" value="${m.nombre||""}" style="font-size:12px"/>
      <input type="number" class="ff-input tj-mat-qty" placeholder="Cant." value="${m.cantidad||1}" min="0.01" step="0.01" style="font-size:12px;text-align:center"/>
      <input type="number" class="ff-input tj-mat-price" placeholder="Precio €" value="${m.precio||""}" min="0" step="0.01" style="font-size:12px;text-align:right"/>
      <button onclick="window._removeMat(${i})" class="ta-btn ta-del" style="font-size:12px">×</button>
    </div>`;
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
