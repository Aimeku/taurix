/* ═══════════════════════════════════════════════════════
   TAURIX · pipeline.js
   CRM Pipeline completo: kanban drag-drop, oportunidades,
   contactos, actividades, previsión de ingresos
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

const ETAPAS = [
  { id: "prospecto",  label: "Prospecto",         color: "#6b7280", prob: 10 },
  { id: "contactado", label: "Contactado",         color: "#3b82f6", prob: 25 },
  { id: "propuesta",  label: "Propuesta enviada",  color: "#f59e0b", prob: 50 },
  { id: "negociacion",label: "Negociación",        color: "#8b5cf6", prob: 75 },
  { id: "ganada",     label: "✅ Ganada",          color: "#059669", prob: 100 },
  { id: "perdida",    label: "❌ Perdida",         color: "#dc2626", prob: 0  },
];

let OPORTUNIDADES = [];

/* ══════════════════════════
   LOAD / SAVE
══════════════════════════ */
export async function loadOportunidades() {
  const { data, error } = await supabase.from("pipeline_oportunidades")
    .select("*").eq("user_id", SESSION.user.id).order("created_at", { ascending: false });
  if (error) { console.error("pipeline:", error.message); return []; }
  return data || [];
}

export async function refreshPipeline() {
  OPORTUNIDADES = await loadOportunidades();
  renderKanban();
  renderKPIs();
}

/* ══════════════════════════
   KPIs
══════════════════════════ */
function renderKPIs() {
  const activas = OPORTUNIDADES.filter(o => o.etapa !== "perdida");
  const ganadas = OPORTUNIDADES.filter(o => o.etapa === "ganada");
  const perdidas = OPORTUNIDADES.filter(o => o.etapa === "perdida");

  const totalPipeline = activas.reduce((a, o) => a + (o.valor || 0), 0);
  const totalGanado   = ganadas.reduce((a, o) => a + (o.valor || 0), 0);
  // Valor ponderado por probabilidad
  const valorPond = activas.reduce((a, o) => {
    const etapa = ETAPAS.find(e => e.id === o.etapa);
    return a + (o.valor || 0) * (etapa?.prob || 0) / 100;
  }, 0);

  const totalOps = OPORTUNIDADES.length;
  const tasaCierre = totalOps > 0 ? ((ganadas.length / totalOps) * 100).toFixed(0) + "%" : "—";
  const cicloMedio = ganadas.length > 0 ? calcCicloMedio(ganadas) : "—";

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("pipelineTotal",      fmt(totalPipeline));
  s("pipelineGanadas",    fmt(totalGanado));
  s("pipelineNegociacion",fmt(valorPond));
  s("pipelineTasa",       tasaCierre);
  s("pipelineCiclo",      cicloMedio);
  s("pipelinePerdidas",   perdidas.length);
}

function calcCicloMedio(ganadas) {
  const con_fechas = ganadas.filter(o => o.fecha_cierre && o.created_at);
  if (!con_fechas.length) return "—";
  const avg = con_fechas.reduce((a, o) => {
    const dias = Math.floor((new Date(o.fecha_cierre) - new Date(o.created_at)) / 86400000);
    return a + dias;
  }, 0) / con_fechas.length;
  return Math.round(avg) + "d";
}

/* ══════════════════════════
   KANBAN RENDER
══════════════════════════ */
function renderKanban() {
  const board = document.getElementById("pipelineBoard");
  if (!board) return;

  board.innerHTML = ETAPAS.map(etapa => {
    const ops = OPORTUNIDADES.filter(o => o.etapa === etapa.id);
    const total = ops.reduce((a, o) => a + (o.valor || 0), 0);

    return `
      <div class="pipeline-col" data-etapa="${etapa.id}" id="pcol_${etapa.id}">
        <div class="pipeline-col-hd" style="color:${etapa.color}">
          ${etapa.label}
          <div style="display:flex;align-items:center;gap:6px">
            <span style="background:${etapa.color}22;color:${etapa.color};padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700">${ops.length}</span>
            ${total > 0 ? `<span style="font-size:10px;color:var(--t4);font-weight:500">${fmt(total)}</span>` : ""}
          </div>
        </div>
        <div class="pipeline-cards-area" id="pcards_${etapa.id}" 
             ondragover="event.preventDefault()" 
             ondrop="window._pipelineDrop(event,'${etapa.id}')">
          ${ops.map(o => renderOportunidadCard(o, etapa)).join("")}
          ${ops.length === 0 ? `<div style="text-align:center;padding:20px 10px;color:var(--t4);font-size:12px">Sin oportunidades</div>` : ""}
        </div>
        ${etapa.id !== "ganada" && etapa.id !== "perdida" ? `
          <button class="pipeline-add-btn" onclick="window._nuevaOp('${etapa.id}')">+ Añadir</button>
        ` : ""}
      </div>`;
  }).join("");
}

function renderOportunidadCard(o, etapa) {
  const venc = o.fecha_cierre ? calcDiasVencimiento(o.fecha_cierre) : null;
  const vencClass = venc !== null ? (venc < 0 ? "op-venc-late" : venc <= 7 ? "op-venc-soon" : "") : "";
  const priorBadge = { alta: "🔴", media: "🟡", baja: "🟢" }[o.prioridad] || "";

  return `
    <div class="pipeline-item ${etapa.id}" 
         draggable="true"
         data-id="${o.id}"
         ondragstart="window._pipelineDragStart(event,'${o.id}')"
         onclick="window._verOp('${o.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div class="pipeline-item-name">${priorBadge} ${o.nombre}</div>
        <button class="ta-btn" style="padding:2px 5px;font-size:11px" 
                onclick="event.stopPropagation();window._editOp('${o.id}')">✏️</button>
      </div>
      ${o.cliente_nombre ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">👤 ${o.cliente_nombre}</div>` : ""}
      ${o.valor ? `<div class="pipeline-item-amt">${fmt(o.valor)}</div>` : ""}
      ${o.responsable ? `<div style="font-size:10px;color:var(--t4);margin-top:4px">👤 ${o.responsable}</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        ${o.fecha_cierre ? `<div class="pipeline-item-date ${vencClass}" style="font-size:10px">📅 ${fmtDate(o.fecha_cierre)}${venc !== null ? ` (${venc >= 0 ? venc + "d" : "vencida"})` : ""}</div>` : "<div></div>"}
        ${o.etapa !== "ganada" && o.etapa !== "perdida" ? `<div style="font-size:10px;color:var(--t4)">${etapa.prob}%</div>` : ""}
      </div>
      ${o.etiquetas ? renderEtiquetas(o.etiquetas) : ""}
    </div>`;
}

function renderEtiquetas(etiquetasStr) {
  try {
    const arr = typeof etiquetasStr === "string" ? JSON.parse(etiquetasStr) : etiquetasStr;
    if (!arr?.length) return "";
    const colors = ["#3b82f6", "#8b5cf6", "#f59e0b", "#059669", "#ef4444"];
    return `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
      ${arr.map((t, i) => `<span style="background:${colors[i % 5]}22;color:${colors[i % 5]};padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">${t}</span>`).join("")}
    </div>`;
  } catch { return ""; }
}

function calcDiasVencimiento(fecha) {
  return Math.floor((new Date(fecha) - new Date()) / 86400000);
}

/* ══════════════════════════
   DRAG & DROP
══════════════════════════ */
let _dragId = null;
window._pipelineDragStart = (event, id) => {
  _dragId = id;
  event.dataTransfer.effectAllowed = "move";
};

window._pipelineDrop = async (event, nuevaEtapa) => {
  event.preventDefault();
  if (!_dragId) return;
  const op = OPORTUNIDADES.find(o => o.id === _dragId);
  if (!op || op.etapa === nuevaEtapa) { _dragId = null; return; }

  const { error } = await supabase.from("pipeline_oportunidades")
    .update({ etapa: nuevaEtapa, updated_at: new Date().toISOString() })
    .eq("id", _dragId);
  if (error) { toast("Error: " + error.message, "error"); }
  else {
    op.etapa = nuevaEtapa;
    toast(`Oportunidad movida a "${ETAPAS.find(e => e.id === nuevaEtapa)?.label}"`, "success", 2000);
    if (nuevaEtapa === "ganada") showConvertirFacturaPrompt(op);
  }
  _dragId = null;
  renderKanban();
  renderKPIs();
};

/* ══════════════════════════
   MODAL NUEVA OPORTUNIDAD
══════════════════════════ */
window._nuevaOp = (etapaInicial = "prospecto") => showOportunidadModal({ etapa: etapaInicial });
window._editOp  = async (id) => {
  const op = OPORTUNIDADES.find(o => o.id === id);
  if (op) showOportunidadModal(op);
};
window._verOp   = (id) => {
  const op = OPORTUNIDADES.find(o => o.id === id);
  if (op) showOportunidadDetalle(op);
};

function showOportunidadModal(prefill = {}) {
  const isEdit = !!prefill.id;
  openModal(`
    <div class="modal" style="max-width:660px">
      <div class="modal-hd">
        <span class="modal-title">🎯 ${isEdit ? "Editar" : "Nueva"} oportunidad</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre de la oportunidad *</label>
            <input id="op_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Ej: Proyecto web Empresa XYZ"/></div>
          <div class="modal-field"><label>Cliente</label>
            <select id="op_cliente" class="ff-select">
              <option value="">— Sin cliente asignado —</option>
              ${CLIENTES.map(c => `<option value="${c.id}" data-nombre="${c.nombre}" ${prefill.cliente_id === c.id ? "selected" : ""}>${c.nombre}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="modal-grid3">
          <div class="modal-field"><label>Valor estimado (€)</label>
            <input type="number" id="op_valor" class="ff-input" value="${prefill.valor || ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>Etapa</label>
            <select id="op_etapa" class="ff-select">
              ${ETAPAS.map(e => `<option value="${e.id}" ${(prefill.etapa || "prospecto") === e.id ? "selected" : ""}>${e.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Prioridad</label>
            <select id="op_prioridad" class="ff-select">
              <option value="alta"  ${prefill.prioridad === "alta"  ? "selected" : ""}>🔴 Alta</option>
              <option value="media" ${prefill.prioridad === "media" || !prefill.prioridad ? "selected" : ""}>🟡 Media</option>
              <option value="baja"  ${prefill.prioridad === "baja"  ? "selected" : ""}>🟢 Baja</option>
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Fecha de cierre estimada</label>
            <input type="date" id="op_fecha_cierre" class="ff-input" value="${prefill.fecha_cierre || ""}"/></div>
          <div class="modal-field"><label>Responsable</label>
            <input id="op_responsable" class="ff-input" value="${prefill.responsable || ""}" placeholder="Nombre del responsable"/></div>
        </div>
        <div class="modal-field"><label>Origen del lead</label>
          <select id="op_origen" class="ff-select">
            ${["Referido", "Web / Inbound", "LinkedIn", "Email frío", "Evento / Feria", "Llamada saliente", "Otro"].map(o =>
              `<option value="${o}" ${prefill.origen === o ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </div>
        <div class="modal-field"><label>Etiquetas <span style="font-weight:400;color:var(--t4)">(separadas por coma)</span></label>
          <input id="op_etiquetas" class="ff-input" value="${prefill.etiquetas ? (typeof prefill.etiquetas === "string" ? JSON.parse(prefill.etiquetas).join(", ") : prefill.etiquetas.join(", ")) : ""}" placeholder="Urgente, Recurrente, Gran cuenta…"/></div>
        <div class="modal-field"><label>Descripción / Notas</label>
          <textarea id="op_notas" class="ff-input ff-textarea" style="min-height:80px" 
            placeholder="Detalles de la oportunidad, requisitos del cliente, próximos pasos…">${prefill.notas || ""}</textarea>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="op_del" style="margin-right:auto">🗑️ Eliminar</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="op_save">${isEdit ? "Actualizar" : "Crear oportunidad"}</button>
      </div>
    </div>
  `);

  document.getElementById("op_save").addEventListener("click", async () => {
    const nombre = document.getElementById("op_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }

    const clienteSel = document.getElementById("op_cliente");
    const etiquetasRaw = document.getElementById("op_etiquetas").value;
    const etiquetas = etiquetasRaw ? etiquetasRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

    const payload = {
      user_id:        SESSION.user.id,
      nombre,
      cliente_id:     clienteSel.value || null,
      cliente_nombre: clienteSel.options[clienteSel.selectedIndex]?.dataset.nombre || null,
      valor:          parseFloat(document.getElementById("op_valor").value) || null,
      etapa:          document.getElementById("op_etapa").value,
      prioridad:      document.getElementById("op_prioridad").value,
      fecha_cierre:   document.getElementById("op_fecha_cierre").value || null,
      responsable:    document.getElementById("op_responsable").value.trim() || null,
      origen:         document.getElementById("op_origen").value,
      etiquetas:      JSON.stringify(etiquetas),
      notas:          document.getElementById("op_notas").value.trim(),
      updated_at:     new Date().toISOString(),
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("pipeline_oportunidades").update(payload).eq("id", prefill.id));
    } else {
      payload.created_at = new Date().toISOString();
      ({ error: err } = await supabase.from("pipeline_oportunidades").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Oportunidad actualizada ✅" : "Oportunidad creada ✅", "success");
    closeModal();
    await refreshPipeline();
  });

  if (isEdit) {
    document.getElementById("op_del")?.addEventListener("click", async () => {
      await supabase.from("pipeline_oportunidades").delete().eq("id", prefill.id);
      closeModal();
      toast("Oportunidad eliminada", "success");
      await refreshPipeline();
    });
  }
}

/* ══════════════════════════
   DETALLE OPORTUNIDAD
══════════════════════════ */
function showOportunidadDetalle(op) {
  const etapa = ETAPAS.find(e => e.id === op.etapa);
  const dias = op.fecha_cierre ? calcDiasVencimiento(op.fecha_cierre) : null;

  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">🎯 ${op.nombre}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <!-- Header con datos clave -->
        <div style="background:var(--bg2);border-radius:12px;padding:16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em;margin-bottom:4px">Valor</div>
            <div style="font-size:24px;font-weight:800;color:var(--accent)">${op.valor ? fmt(op.valor) : "—"}</div>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em;margin-bottom:4px">Etapa</div>
            <span style="display:inline-flex;align-items:center;gap:6px;background:${etapa?.color}22;color:${etapa?.color};padding:4px 10px;border-radius:8px;font-weight:700;font-size:13px">${etapa?.label}</span>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em;margin-bottom:4px">Cierre estimado</div>
            <div style="font-size:14px;font-weight:600">${op.fecha_cierre ? fmtDate(op.fecha_cierre) : "—"}</div>
            ${dias !== null ? `<div style="font-size:11px;color:${dias < 0 ? "#dc2626" : dias <= 7 ? "#d97706" : "var(--t3)"}">${dias < 0 ? "⚠️ Vencida" : dias === 0 ? "Hoy" : "en " + dias + "d"}</div>` : ""}
          </div>
        </div>

        <!-- Datos -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="font-size:13px"><span style="color:var(--t3)">Cliente:</span> <strong>${op.cliente_nombre || "—"}</strong></div>
          <div style="font-size:13px"><span style="color:var(--t3)">Responsable:</span> <strong>${op.responsable || "—"}</strong></div>
          <div style="font-size:13px"><span style="color:var(--t3)">Origen:</span> <strong>${op.origen || "—"}</strong></div>
          <div style="font-size:13px"><span style="color:var(--t3)">Prioridad:</span> <strong>${{ alta: "🔴 Alta", media: "🟡 Media", baja: "🟢 Baja" }[op.prioridad] || "—"}</strong></div>
        </div>

        ${op.etiquetas ? renderEtiquetas(op.etiquetas) : ""}

        ${op.notas ? `
          <div style="background:var(--bg2);border-radius:10px;padding:12px;margin-top:12px">
            <div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:6px">NOTAS</div>
            <div style="font-size:13px;color:var(--t2);line-height:1.65">${op.notas.replace(/\n/g, "<br>")}</div>
          </div>` : ""}

        <!-- Actividad rápida -->
        <div style="margin-top:20px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em;margin-bottom:8px">Añadir nota de actividad</div>
          <div style="display:flex;gap:8px">
            <select id="op_act_tipo" class="ff-select" style="min-width:150px">
              <option>📞 Llamada</option>
              <option>📧 Email</option>
              <option>🤝 Reunión</option>
              <option>📝 Nota</option>
              <option>📅 Seguimiento</option>
            </select>
            <input id="op_act_nota" class="ff-input" style="flex:1" placeholder="¿Qué pasó? ¿Próximos pasos?"/>
            <button class="btn-primary" style="padding:8px 14px;font-size:13px" id="op_act_save">Añadir</button>
          </div>
        </div>

        <!-- Historial de actividad -->
        <div id="op_actividad_list" style="margin-top:12px;max-height:180px;overflow-y:auto">
          <div style="text-align:center;padding:16px;color:var(--t4);font-size:12px">Cargando actividad…</div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <button class="btn-modal-save" onclick="window._cm();window._editOp('${op.id}')">✏️ Editar</button>
        ${op.etapa !== "ganada" ? `<button id="op_marcar_ganada" style="padding:10px 20px;border:none;border-radius:10px;background:#059669;color:#fff;font-weight:700;font-size:14px;cursor:pointer">🎉 Marcar ganada</button>` : `<button id="op_crear_factura" style="padding:10px 20px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-weight:700;font-size:14px;cursor:pointer">📤 Crear factura</button>`}
      </div>
    </div>
  `);

  // Cargar actividad
  loadActividad(op.id);

  document.getElementById("op_act_save")?.addEventListener("click", async () => {
    const tipo = document.getElementById("op_act_tipo").value;
    const nota = document.getElementById("op_act_nota").value.trim();
    if (!nota) return;
    await supabase.from("pipeline_actividad").insert({
      user_id: SESSION.user.id,
      oportunidad_id: op.id,
      tipo, nota,
      fecha: new Date().toISOString()
    });
    document.getElementById("op_act_nota").value = "";
    loadActividad(op.id);
  });

  document.getElementById("op_marcar_ganada")?.addEventListener("click", async () => {
    await supabase.from("pipeline_oportunidades").update({ etapa: "ganada" }).eq("id", op.id);
    closeModal();
    toast("🎉 ¡Oportunidad ganada!", "success");
    await refreshPipeline();
    showConvertirFacturaPrompt(op);
  });

  document.getElementById("op_crear_factura")?.addEventListener("click", () => {
    closeModal();
    showConvertirFacturaPrompt(op);
  });
}

async function loadActividad(opId) {
  const { data } = await supabase.from("pipeline_actividad")
    .select("*").eq("oportunidad_id", opId).order("fecha", { ascending: false }).limit(20);
  const list = document.getElementById("op_actividad_list");
  if (!list) return;
  if (!data?.length) {
    list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--t4);font-size:12px">Sin actividad registrada</div>`;
    return;
  }
  list.innerHTML = data.map(a => `
    <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--brd);align-items:flex-start">
      <span style="font-size:14px;flex-shrink:0">${a.tipo?.split(" ")[0] || "📝"}</span>
      <div style="flex:1">
        <div style="font-size:13px;color:var(--t1)">${a.nota}</div>
        <div style="font-size:11px;color:var(--t4);margin-top:2px">${fmtDate(a.fecha?.slice(0, 10))} · ${a.tipo}</div>
      </div>
    </div>`).join("");
}

function showConvertirFacturaPrompt(op) {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">🎉 ¡Oportunidad ganada!</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <div style="text-align:center;padding:16px 0">
          <div style="font-size:48px;margin-bottom:12px">🎉</div>
          <p style="font-size:16px;font-weight:700;margin-bottom:4px">${op.nombre}</p>
          ${op.valor ? `<p style="font-size:24px;font-weight:800;color:#059669">${fmt(op.valor)}</p>` : ""}
          <p style="font-size:13px;color:var(--t3);margin-top:8px">¿Quieres crear la factura ahora con los datos de esta oportunidad?</p>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Ahora no</button>
        <button class="btn-modal-save" onclick="window._cm();window._switchView('nueva-factura')">📤 Crear factura ahora</button>
      </div>
    </div>`);
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initPipelineView() {
  document.getElementById("nuevaOportunidadBtn")?.addEventListener("click", () => window._nuevaOp());
  refreshPipeline();
}
