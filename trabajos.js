/* ═══════════════════════════════════════════════════════
   TAURIX · trabajos.js
   Gestión de órdenes de trabajo / intervenciones.
   · Vista Kanban (pendiente / en curso / terminado / facturado)
   · Vista Lista con búsqueda y filtros
   · Crear, editar, cambiar estado, convertir a factura
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";
import { readSedeIdFromForm, applySedeFilter } from "./sedes.js";

const ESTADOS = [
  { id: "pendiente",  label: "⏳ Pendiente",  color: "#d97706", bg: "#fef9c3" },
  { id: "en_curso",   label: "🔧 En curso",   color: "#3b82f6", bg: "#eff6ff" },
  { id: "terminado",  label: "✅ Terminado",  color: "#059669", bg: "#f0fdf4" },
  { id: "facturado",  label: "🧾 Facturado",  color: "#6b7280", bg: "#f9fafb" },
];

const PRIORIDADES = [
  { id: "baja",   label: "Baja",   color: "#6b7280" },
  { id: "media",  label: "Media",  color: "#f59e0b" },
  { id: "alta",   label: "Alta",   color: "#dc2626" },
];

let TRABAJOS  = [];
let TECNICOS  = [];
let VISTA_TRB = "kanban"; // "kanban" | "lista"

/* ══════════════════════════
   LOAD
══════════════════════════ */
async function loadTrabajos() {
  if (!SESSION) return [];
  let qTr = supabase.from("trabajos").select("*")
    .eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false });
  qTr = applySedeFilter(qTr);
  const [trRes, tecRes] = await Promise.all([
    qTr,
    supabase.from("empleados").select("id,nombre")
      .eq("user_id", SESSION.user.id).eq("activo", true),
  ]);
  if (trRes.error) console.warn("trabajos:", trRes.error.message);
  TRABAJOS = trRes.data  || [];
  TECNICOS = tecRes.data || [];
  return TRABAJOS;
}

/* ══════════════════════════
   REFRESH
══════════════════════════ */
export async function refreshTrabajos() {
  await loadTrabajos();
  renderKPIs();
  if (VISTA_TRB === "kanban") renderKanban();
  else renderLista();
}

/* ══════════════════════════
   KPIs
══════════════════════════ */
function renderKPIs() {
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("trabajosTotal",    TRABAJOS.length);
  s("trabajosPendiente", TRABAJOS.filter(t => t.estado === "pendiente").length);
  s("trabajosEnCurso",   TRABAJOS.filter(t => t.estado === "en_curso").length);
  s("trabajosTerminado", TRABAJOS.filter(t => t.estado === "terminado").length);
  s("trabajosFacturado", TRABAJOS.filter(t => t.estado === "facturado").length);
}

/* ══════════════════════════
   VISTA KANBAN
══════════════════════════ */
function renderKanban() {
  const wrap = document.getElementById("trabajosKanban");
  if (!wrap) return;

  wrap.innerHTML = ESTADOS.map(est => {
    const items = TRABAJOS.filter(t => t.estado === est.id);
    return `
      <div style="background:var(--bg2);border-radius:12px;padding:14px;min-height:200px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:12px;font-weight:700;color:${est.color}">${est.label}</span>
          <span style="background:${est.bg};color:${est.color};border-radius:100px;padding:2px 8px;font-size:11px;font-weight:700">${items.length}</span>
        </div>
        ${items.length === 0
          ? `<div style="text-align:center;padding:20px;color:var(--t4);font-size:12px">Sin trabajos</div>`
          : items.map(t => tarjetaTrabajo(t)).join("")}
      </div>`;
  }).join("");
}

function tarjetaTrabajo(t) {
  const prio = PRIORIDADES.find(p => p.id === t.prioridad) || PRIORIDADES[1];
  const tec  = TECNICOS.find(x => x.id === t.tecnico_id);
  return `
    <div style="background:var(--srf);border:1px solid var(--brd);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;transition:all .15s"
         onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--brd)'"
         data-id="${t.id}" onclick="window._verTrabajo(this.dataset.id)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600;color:var(--t1);flex:1">${t.titulo}</span>
        <span style="font-size:10px;font-weight:700;color:${prio.color};margin-left:6px">${prio.label}</span>
      </div>
      ${t.cliente_nombre ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">👤 ${t.cliente_nombre}</div>` : ""}
      ${tec ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">🔧 ${tec.nombre}</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <span style="font-size:11px;color:var(--t4)">${t.fecha ? fmtDate(t.fecha) : ""}</span>
        ${t.importe ? `<span style="font-size:12px;font-weight:700;font-family:monospace;color:var(--accent)">${fmt(t.importe)}</span>` : ""}
      </div>
    </div>`;
}

/* ══════════════════════════
   VISTA LISTA
══════════════════════════ */
function renderLista() {
  const tbody = document.getElementById("trabajosListaBody");
  if (!tbody) return;

  const busq   = document.getElementById("trabajosBusqueda")?.value.toLowerCase() || "";
  const filtro = document.getElementById("trabajosFiltroEstado")?.value || "";

  let lista = TRABAJOS;
  if (busq)   lista = lista.filter(t => t.titulo?.toLowerCase().includes(busq) || t.cliente_nombre?.toLowerCase().includes(busq));
  if (filtro) lista = lista.filter(t => t.estado === filtro);

  if (!lista.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="8">Sin trabajos que mostrar</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(t => {
    const est  = ESTADOS.find(e => e.id === t.estado) || ESTADOS[0];
    const prio = PRIORIDADES.find(p => p.id === t.prioridad) || PRIORIDADES[1];
    const tec  = TECNICOS.find(x => x.id === t.tecnico_id);
    return `<tr style="cursor:pointer" data-id="${t.id}" onclick="window._verTrabajo(this.dataset.id)">
      <td class="mono" style="font-size:11px">${t.numero || "—"}</td>
      <td style="font-weight:600">${t.titulo}</td>
      <td style="font-size:12px;color:var(--t3)">${t.cliente_nombre || "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${tec ? tec.nombre : "—"}</td>
      <td><span style="background:${est.bg};color:${est.color};padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">${est.label}</span></td>
      <td><span style="color:${prio.color};font-size:12px;font-weight:600">${prio.label}</span></td>
      <td class="mono">${t.importe ? fmt(t.importe) : "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${t.fecha ? fmtDate(t.fecha) : "—"}</td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   VER TRABAJO (detalle)
══════════════════════════ */
window._verTrabajo = (id) => {
  const t = TRABAJOS.find(x => String(x.id) === String(id));
  if (!t) return;
  const est  = ESTADOS.find(e => e.id === t.estado) || ESTADOS[0];
  const prio = PRIORIDADES.find(p => p.id === t.prioridad) || PRIORIDADES[1];
  const tec  = TECNICOS.find(x => x.id === t.tecnico_id);

  openModal(`
    <div class="modal" style="max-width:500px">
      <div class="modal-hd" style="border-bottom:3px solid ${est.color}">
        <span class="modal-title">🔧 ${t.titulo}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          <span style="background:${est.bg};color:${est.color};padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700">${est.label}</span>
          <span style="color:${prio.color};font-size:12px;font-weight:600;padding:3px 10px;background:var(--bg2);border-radius:8px">${prio.label} prioridad</span>
        </div>
        ${t.cliente_nombre ? `<div style="font-size:13px;color:var(--t2);margin-bottom:6px">👤 ${t.cliente_nombre}</div>` : ""}
        ${tec ? `<div style="font-size:13px;color:var(--t2);margin-bottom:6px">🔧 Técnico: ${tec.nombre}</div>` : ""}
        ${t.fecha ? `<div style="font-size:13px;color:var(--t2);margin-bottom:6px">📅 ${fmtDate(t.fecha)}</div>` : ""}
        ${t.direccion ? `<div style="font-size:13px;color:var(--t2);margin-bottom:6px">📍 ${t.direccion}</div>` : ""}
        ${t.importe ? `<div style="font-size:15px;font-weight:700;font-family:monospace;color:var(--accent);margin-bottom:6px">${fmt(t.importe)} €</div>` : ""}
        ${t.descripcion ? `<div style="font-size:13px;color:var(--t3);background:var(--bg2);border-radius:8px;padding:10px;line-height:1.6">${t.descripcion}</div>` : ""}
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <button class="btn-modal-danger" onclick="window._cm();window._deleteTrabajo('${t.id}')">Eliminar</button>
        <button class="btn-outline" onclick="window._cm();window._editTrabajo('${t.id}')">✏️ Editar</button>
        ${t.estado === "terminado" ? `<button class="btn-modal-save" onclick="window._cm();window._factTrabajo('${t.id}')">🧾 Facturar</button>` : ""}
      </div>
    </div>`);
};

window._editTrabajo = (id) => {
  const t = TRABAJOS.find(x => String(x.id) === String(id));
  if (t) showNuevoTrabajoModal(t);
};

window._deleteTrabajo = async (id) => {
  const { error } = await supabase.from("trabajos").delete().eq("id", id);
  if (error) { toast("Error: " + error.message, "error"); return; }
  toast("Trabajo eliminado", "success");
  await refreshTrabajos();
};

window._factTrabajo = (id) => {
  toast("Convirtiendo trabajo a factura… (próximamente)", "info");
};

/* ══════════════════════════
   MODAL NUEVO / EDITAR
══════════════════════════ */
async function showNuevoTrabajoModal(prefill = {}) {
  const isEdit = !!prefill.id;

  if (!TECNICOS.length) {
    const { data } = await supabase.from("empleados")
      .select("id,nombre").eq("user_id", SESSION.user.id).eq("activo", true);
    TECNICOS = data || [];
  }

  const clienteOpts = CLIENTES.map(c =>
    `<option value="${c.id}" data-nombre="${c.nombre}" ${prefill.cliente_id === c.id ? "selected" : ""}>${c.nombre}</option>`
  ).join("");

  const tecnicoOpts = TECNICOS.length === 0
    ? `<option value="">Sin técnicos — añade empleados primero</option>`
    : `<option value="">Sin asignar</option>` +
      TECNICOS.map(e => `<option value="${e.id}" ${prefill.tecnico_id === e.id ? "selected" : ""}>${e.nombre}</option>`).join("");

  openModal(`
    <div class="modal" style="max-width:540px">
      <div class="modal-hd">
        <span class="modal-title">🔧 ${isEdit ? "Editar" : "Nuevo"} trabajo</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-field"><label>Título *</label>
          <input id="trb_titulo" class="ff-input" value="${prefill.titulo || ""}" placeholder="Ej: Instalación bomba calor · Revisión anual · …"/>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Estado</label>
            <select id="trb_estado" class="ff-select">
              ${ESTADOS.map(e => `<option value="${e.id}" ${(prefill.estado || "pendiente") === e.id ? "selected" : ""}>${e.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Prioridad</label>
            <select id="trb_prioridad" class="ff-select">
              ${PRIORIDADES.map(p => `<option value="${p.id}" ${(prefill.prioridad || "media") === p.id ? "selected" : ""}>${p.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Fecha</label>
            <input type="date" id="trb_fecha" class="ff-input" value="${prefill.fecha || ""}"/>
          </div>
          <div class="modal-field"><label>Importe (€)</label>
            <input type="number" id="trb_importe" class="ff-input" value="${prefill.importe || ""}" placeholder="0.00" step="0.01"/>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Cliente</label>
            <select id="trb_cliente" class="ff-select">
              <option value="">— Sin cliente —</option>
              ${clienteOpts}
            </select>
          </div>
          <div class="modal-field"><label>Técnico</label>
            <select id="trb_tecnico" class="ff-select">${tecnicoOpts}</select>
          </div>
        </div>
        <div class="modal-field"><label>Dirección</label>
          <input id="trb_direccion" class="ff-input" value="${prefill.direccion || ""}" placeholder="Calle, número, ciudad…"/>
        </div>
        <div class="modal-field"><label>Descripción / notas</label>
          <textarea id="trb_desc" class="ff-input ff-textarea" style="min-height:70px"
                    placeholder="Descripción del trabajo, materiales, observaciones…">${prefill.descripcion || ""}</textarea>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        ${isEdit ? `<button class="btn-modal-danger" onclick="window._deleteTrabajo('${prefill.id}');window._cm()">Eliminar</button>` : ""}
        <button class="btn-modal-save" id="trb_save">${isEdit ? "Actualizar" : "Crear trabajo"}</button>
      </div>
    </div>`);

  document.getElementById("trb_save").addEventListener("click", async () => {
    const titulo = document.getElementById("trb_titulo").value.trim();
    if (!titulo) { toast("El título es obligatorio", "error"); return; }

    const clienteSel = document.getElementById("trb_cliente");
    const payload = {
      user_id:        SESSION.user.id,
      sede_id:        prefill.sede_id !== undefined ? prefill.sede_id : (readSedeIdFromForm("trb_sede_id") || null),
      titulo,
      estado:         document.getElementById("trb_estado").value,
      prioridad:      document.getElementById("trb_prioridad").value,
      fecha:          document.getElementById("trb_fecha").value || null,
      importe:        parseFloat(document.getElementById("trb_importe").value) || null,
      cliente_id:     clienteSel.value || null,
      cliente_nombre: clienteSel.selectedOptions[0]?.dataset.nombre || null,
      tecnico_id:     document.getElementById("trb_tecnico").value || null,
      direccion:      document.getElementById("trb_direccion").value.trim() || null,
      descripcion:    document.getElementById("trb_desc").value.trim() || null,
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase.from("trabajos").update(payload).eq("id", prefill.id));
    } else {
      ({ error } = await supabase.from("trabajos").insert(payload));
    }

    if (error) { toast("Error: " + error.message, "error"); return; }
    toast(isEdit ? "Trabajo actualizado ✅" : "Trabajo creado ✅", "success");
    closeModal();
    await refreshTrabajos();
  });
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initTrabajosView() {
  // Toggle vista kanban / lista
  document.getElementById("trabajosVistaKanban")?.addEventListener("click", () => {
    VISTA_TRB = "kanban";
    document.getElementById("trabajosKanbanWrap")?.classList.remove("hidden");
    document.getElementById("trabajosListaWrap")?.classList.add("hidden");
    document.getElementById("trabajosVistaKanban")?.classList.add("active");
    document.getElementById("trabajosVistaLista")?.classList.remove("active");
    renderKanban();
  });

  document.getElementById("trabajosVistaLista")?.addEventListener("click", () => {
    VISTA_TRB = "lista";
    document.getElementById("trabajosKanbanWrap")?.classList.add("hidden");
    document.getElementById("trabajosListaWrap")?.classList.remove("hidden");
    document.getElementById("trabajosVistaKanban")?.classList.remove("active");
    document.getElementById("trabajosVistaLista")?.classList.add("active");
    renderLista();
  });

  // Búsqueda y filtro en vista lista
  document.getElementById("trabajosBusqueda")?.addEventListener("input", renderLista);
  document.getElementById("trabajosFiltroEstado")?.addEventListener("change", renderLista);

  // Nuevo trabajo
  document.getElementById("nuevoTrabajoBtn")?.addEventListener("click", () => showNuevoTrabajoModal());
}
