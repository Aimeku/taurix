/* ═══════════════════════════════════════════════════════
   TAURIX · agenda.js
   
   Agenda / Calendario estilo Google Calendar:
   · Vista mensual con eventos
   · Vista semanal (columnas por día)
   · Vista diaria
   · Tipos: visita, instalación, mantenimiento, reunión, otro
   · Vincular con trabajos y clientes
   · Asignar técnico
   · Click en día para crear evento
   · Drag para mover (próximamente)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

/* ══════════════════════════
   TIPOS DE EVENTO
══════════════════════════ */
const TIPOS = [
  { id:"visita",        label:"Visita",         color:"#3b82f6", bg:"#eff6ff",  icon:"👤" },
  { id:"instalacion",   label:"Instalación",    color:"#059669", bg:"#f0fdf4",  icon:"🔧" },
  { id:"mantenimiento", label:"Mantenimiento",  color:"#f59e0b", bg:"#fef9c3",  icon:"⚙️"  },
  { id:"reunion",       label:"Reunión",        color:"#8b5cf6", bg:"#f5f3ff",  icon:"🤝" },
  { id:"presupuesto",   label:"Presupuesto",    color:"#0ea5e9", bg:"#f0f9ff",  icon:"📋" },
  { id:"otro",          label:"Otro",           color:"#6b7280", bg:"#f9fafb",  icon:"📌" },
];

const DIAS   = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

// Fecha local como YYYY-MM-DD (evita el bug UTC con toISOString)
const toLocalDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const MESES  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

let EVENTOS   = [];
let TECNICOS  = [];
let HOY       = new Date();
const HOY_STR = toLocalDateStr(new Date());
let FECHA_NAV = new Date(HOY.getFullYear(), HOY.getMonth(), 1); // primer día del mes visible
let VISTA     = "mes"; // "mes" | "semana" | "dia"

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadAgenda() {
  const year  = FECHA_NAV.getFullYear();
  const month = FECHA_NAV.getMonth();
  const ini   = toLocalDateStr(new Date(year, month - 1, 1));
  const fin   = toLocalDateStr(new Date(year, month + 2, 0));

  const [eventosRes, tecnicosRes] = await Promise.all([
    supabase.from("agenda_eventos").select("*")
      .eq("user_id", SESSION.user.id)
      .gte("fecha", ini).lte("fecha", fin)
      .order("fecha").order("hora_inicio"),
    supabase.from("empleados").select("id,nombre")
      .eq("user_id", SESSION.user.id).eq("activo", true),
  ]);

  EVENTOS  = eventosRes.data  || [];
  TECNICOS = tecnicosRes.data || [];
  return EVENTOS;
}

export async function refreshAgenda() {
  await loadAgenda();
  renderCalendario();
  renderProximosEventos();
}

/* ══════════════════════════
   RENDER PRINCIPAL
══════════════════════════ */
function renderCalendario() {
  const wrap = document.getElementById("agendaCalendario");
  if (!wrap) return;

  // Header de navegación
  const navEl = document.getElementById("agendaNavLabel");
  if (navEl) {
    if (VISTA === "mes") {
      navEl.textContent = `${MESES[FECHA_NAV.getMonth()]} ${FECHA_NAV.getFullYear()}`;
    } else if (VISTA === "semana") {
      const lunes = getLunes(FECHA_NAV);
      const domingo = new Date(lunes); domingo.setDate(lunes.getDate()+6);
      navEl.textContent = `${lunes.getDate()} ${MESES[lunes.getMonth()].slice(0,3)} — ${domingo.getDate()} ${MESES[domingo.getMonth()].slice(0,3)} ${domingo.getFullYear()}`;
    } else {
      navEl.textContent = `${FECHA_NAV.getDate()} de ${MESES[FECHA_NAV.getMonth()]} de ${FECHA_NAV.getFullYear()}`;
    }
  }

  if (VISTA === "mes")    renderMes(wrap);
  else if (VISTA === "semana") renderSemana(wrap);
  else renderDia(wrap);
}

/* ── Vista mensual ── */
function renderMes(wrap) {
  const year  = FECHA_NAV.getFullYear();
  const month = FECHA_NAV.getMonth();
  const primerDia = new Date(year, month, 1);
  const ultimoDia = new Date(year, month+1, 0);

  // Día de la semana del primer día (0=Dom → ajustar a 0=Lun)
  let startDow = primerDia.getDay(); // 0 Dom, 1 Lun...
  startDow = startDow === 0 ? 6 : startDow - 1;

  const celdas = [];
  // Relleno inicio
  for (let i = 0; i < startDow; i++) celdas.push(null);
  // Días del mes
  for (let d = 1; d <= ultimoDia.getDate(); d++) celdas.push(new Date(year, month, d));

  const hoyStr = toLocalDateStr(HOY);

  wrap.innerHTML = `
    <div class="cal-grid-mes">
      ${DIAS.map(d=>`<div class="cal-header-day">${d}</div>`).join("")}
      ${celdas.map(fecha => {
        if (!fecha) return `<div class="cal-cell cal-cell--vacio"></div>`;
        const fechaStr = toLocalDateStr(fecha);
        const esHoy    = fechaStr === hoyStr;
        const eventos  = EVENTOS.filter(e => e.fecha === fechaStr);
        return `
          <div class="cal-cell ${esHoy?"cal-cell--hoy":""}"
               onclick="window._clickDia('${fechaStr}')">
            <div class="cal-cell-num ${esHoy?"cal-cell-num--hoy":""}">${fecha.getDate()}</div>
            <div class="cal-cell-eventos">
              ${eventos.slice(0,3).map(e => {
                const tipo = TIPOS.find(t=>t.id===e.tipo) || TIPOS[5];
                return `<div class="cal-evento" style="background:${tipo.color};color:#fff"
                             onclick="event.stopPropagation();window._verEvento('${e.id}')"
                             title="${e.titulo}">
                  ${e.hora_inicio?e.hora_inicio.slice(0,5)+' ':''} ${e.titulo}
                </div>`;
              }).join("")}
              ${eventos.length > 3 ? `<div class="cal-evento-mas">+${eventos.length-3} más</div>` : ""}
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ── Vista semanal ── */
function renderSemana(wrap) {
  const lunes = getLunes(FECHA_NAV);
  const dias  = Array.from({length:7}, (_,i) => {
    const d = new Date(lunes); d.setDate(lunes.getDate()+i); return d;
  });
  const hoyStr = toLocalDateStr(HOY);

  wrap.innerHTML = `
    <div class="cal-grid-semana">
      <!-- Cabecera días -->
      <div class="cal-sem-time-col"></div>
      ${dias.map(d => {
        const ds = toLocalDateStr(d);
        const esHoy = ds === hoyStr;
        return `<div class="cal-sem-day-hd ${esHoy?"cal-sem-day-hd--hoy":""}">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--t3)">${DIAS[dias.indexOf(d)]}</div>
          <div style="font-size:20px;font-weight:800;color:${esHoy?"var(--accent)":"var(--t1)"}">${d.getDate()}</div>
        </div>`;
      }).join("")}

      <!-- Horas -->
      ${Array.from({length:14}, (_,h) => {
        const hora = h + 7; // 7:00 a 20:00
        return `
          <div class="cal-sem-time">${hora}:00</div>
          ${dias.map(d => {
            const ds = toLocalDateStr(d);
            const eventos = EVENTOS.filter(e => e.fecha===ds &&
              e.hora_inicio && parseInt(e.hora_inicio.slice(0,2))===hora);
            return `<div class="cal-sem-cell" onclick="window._clickDia('${ds}','${hora.toString().padStart(2,'0')}:00')">
              ${eventos.map(e => {
                const tipo = TIPOS.find(t=>t.id===e.tipo) || TIPOS[5];
                return `<div class="cal-evento-sem" style="background:${tipo.color}"
                              onclick="event.stopPropagation();window._verEvento('${e.id}')">
                  <div style="font-weight:700;font-size:11px">${e.titulo}</div>
                  ${e.hora_inicio?`<div style="font-size:10px;opacity:.85">${e.hora_inicio.slice(0,5)}${e.hora_fin?' - '+e.hora_fin.slice(0,5):''}</div>`:''}
                </div>`;
              }).join("")}
            </div>`;
          }).join("")}`;
      }).join("")}
    </div>`;
}

/* ── Vista diaria ── */
function renderDia(wrap) {
  const fechaStr = toLocalDateStr(FECHA_NAV);
  const eventos  = EVENTOS.filter(e => e.fecha === fechaStr)
                          .sort((a,b) => (a.hora_inicio||"").localeCompare(b.hora_inicio||""));

  wrap.innerHTML = `
    <div style="padding:4px 0">
      ${!eventos.length ? `
        <div style="text-align:center;padding:48px 20px;color:var(--t3)">
          <div style="font-size:40px;margin-bottom:12px">📅</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">Sin eventos este día</div>
          <button class="btn-primary" onclick="window._clickDia('${fechaStr}')">+ Añadir evento</button>
        </div>` :
        eventos.map(e => {
          const tipo = TIPOS.find(t=>t.id===e.tipo) || TIPOS[5];
          const tec  = TECNICOS.find(x=>x.id===e.tecnico_id);
          return `
            <div style="display:flex;gap:14px;padding:14px;border-left:4px solid ${tipo.color};background:${tipo.bg};border-radius:0 12px 12px 0;margin-bottom:10px;cursor:pointer"
                 onclick="window._verEvento('${e.id}')">
              <div style="text-align:center;min-width:50px">
                <div style="font-size:20px">${tipo.icon}</div>
                ${e.hora_inicio?`<div style="font-size:12px;font-weight:700;color:${tipo.color}">${e.hora_inicio.slice(0,5)}</div>`:''}
                ${e.hora_fin?`<div style="font-size:10px;color:var(--t4)">${e.hora_fin.slice(0,5)}</div>`:''}
              </div>
              <div style="flex:1">
                <div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:4px">${e.titulo}</div>
                ${e.cliente_nombre?`<div style="font-size:12px;color:var(--t3)">👤 ${e.cliente_nombre}</div>`:''}
                ${tec?`<div style="font-size:12px;color:var(--t3)">🔧 ${tec.nombre}</div>`:''}
                ${e.descripcion?`<div style="font-size:12px;color:var(--t3);margin-top:4px">${e.descripcion}</div>`:''}
                ${e.direccion?`<div style="font-size:11px;color:var(--t4);margin-top:3px">📍 ${e.direccion}</div>`:''}
              </div>
            </div>`;
        }).join("")
      }
    </div>`;
}

/* ══════════════════════════
   PRÓXIMOS EVENTOS (sidebar)
══════════════════════════ */
function renderProximosEventos() {
  const wrap = document.getElementById("proximosEventos");
  if (!wrap) return;

  const hoyStr = toLocalDateStr(HOY);
  const proximos = EVENTOS
    .filter(e => e.fecha >= hoyStr)
    .sort((a,b) => a.fecha.localeCompare(b.fecha) || (a.hora_inicio||"").localeCompare(b.hora_inicio||""))
    .slice(0,8);

  if (!proximos.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:20px;color:var(--t4);font-size:12px">Sin próximos eventos</div>`;
    return;
  }

  wrap.innerHTML = proximos.map(e => {
    const tipo  = TIPOS.find(t=>t.id===e.tipo) || TIPOS[5];
    const esHoy = e.fecha === hoyStr;
    const dias  = Math.ceil((new Date(e.fecha) - HOY) / 86400000);
    return `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--brd);cursor:pointer"
           onclick="window._verEvento('${e.id}')">
        <div style="width:36px;height:36px;background:${tipo.color}18;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${tipo.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.titulo}</div>
          <div style="font-size:11px;color:var(--t3)">
            ${esHoy?`<span style="color:${tipo.color};font-weight:700">Hoy</span>`:fmtDate(e.fecha)}
            ${e.hora_inicio?` · ${e.hora_inicio.slice(0,5)}`:''}
            ${e.cliente_nombre?` · ${e.cliente_nombre}`:''}
          </div>
        </div>
        <div style="font-size:10px;color:${esHoy?tipo.color:"var(--t4)"};font-weight:${esHoy?700:400};white-space:nowrap">
          ${esHoy?"Hoy":dias===1?"Mañana":`${dias}d`}
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   MODAL NUEVO / EDITAR EVENTO
══════════════════════════ */
export function showNuevoEventoModal(prefill = {}) {
  const isEdit = !!prefill.id;

  const clienteOpts = CLIENTES.map(c =>
    `<option value="${c.id}" data-nombre="${c.nombre}" ${prefill.cliente_id===c.id?"selected":""}>${c.nombre}</option>`
  ).join("");

  const tecnicoOpts = TECNICOS.length === 0
    ? `<option value="">Sin técnicos — ve a Empleados para añadirlos</option>`
    : `<option value="">Sin asignar</option>` +
      TECNICOS.map(e => `<option value="${e.id}" ${prefill.tecnico_id===e.id?"selected":""}>${e.nombre}</option>`).join("");

  openModal(`
    <div class="modal" style="max-width:560px">
      <div class="modal-hd">
        <span class="modal-title">📅 ${isEdit?"Editar":"Nuevo"} evento</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Tipo de evento — selector visual -->
        <div style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:block">Tipo de evento</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${TIPOS.map(t => `
              <label style="cursor:pointer">
                <input type="radio" name="ev_tipo" value="${t.id}"
                       ${(prefill.tipo||"visita")===t.id?"checked":""}
                       style="display:none"/>
                <span class="ev-tipo-btn" data-tipo="${t.id}"
                      style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;border:1.5px solid ${(prefill.tipo||"visita")===t.id?t.color:"var(--brd)"};background:${(prefill.tipo||"visita")===t.id?t.bg:"transparent"};color:${(prefill.tipo||"visita")===t.id?t.color:"var(--t2)"};transition:all .15s;cursor:pointer">
                  ${t.icon} ${t.label}
                </span>
              </label>`).join("")}
          </div>
        </div>

        <div class="modal-field">
          <label>Título *</label>
          <input id="ev_titulo" class="ff-input" value="${prefill.titulo||""}"
                 placeholder="Ej: Revisión caldera · Instalación split · Reunión cliente"/>
        </div>

        <div class="modal-grid2">
          <div class="modal-field"><label>Fecha *</label>
            <input type="date" id="ev_fecha" class="ff-input" value="${prefill.fecha||toLocalDateStr(new Date())}"/>
          </div>
          <div class="modal-field"><label>Todo el día</label>
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer">
              <input type="checkbox" id="ev_todo_dia" ${prefill.todo_dia?"checked":""} style="width:16px;height:16px"/>
              <span style="font-size:13px">Sin hora específica</span>
            </label>
          </div>
          <div class="modal-field" id="ev_hora_wrap" ${prefill.todo_dia?'style="display:none"':""}>
            <label>Hora inicio</label>
            <input type="time" id="ev_hora_inicio" class="ff-input" value="${prefill.hora_inicio||"09:00"}"/>
          </div>
          <div class="modal-field" id="ev_hora_fin_wrap" ${prefill.todo_dia?'style="display:none"':""}>
            <label>Hora fin</label>
            <input type="time" id="ev_hora_fin" class="ff-input" value="${prefill.hora_fin||"10:00"}"/>
          </div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field"><label>Cliente</label>
            <select id="ev_cliente" class="ff-select">
              <option value="">— Sin cliente —</option>
              ${clienteOpts}
            </select>
          </div>
          <div class="modal-field"><label>Técnico</label>
            <select id="ev_tecnico" class="ff-select">${tecnicoOpts}</select>
          </div>
        </div>

        <div class="modal-field">
          <label>Dirección / ubicación</label>
          <input id="ev_direccion" class="ff-input" value="${prefill.direccion||""}"
                 placeholder="Calle, número, ciudad…"/>
        </div>

        <div class="modal-field">
          <label>Notas</label>
          <textarea id="ev_notas" class="ff-input ff-textarea" style="min-height:64px"
                    placeholder="Observaciones, acceso, material necesario…">${prefill.descripcion||""}</textarea>
        </div>

        <!-- Color del evento -->
        <div class="modal-field">
          <label>Color</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
            ${["#3b82f6","#059669","#f59e0b","#dc2626","#8b5cf6","#ec4899","#0ea5e9","#6b7280"].map(c =>
              `<label style="cursor:pointer">
                <input type="radio" name="ev_color" value="${c}" ${(prefill.color||"#3b82f6")===c?"checked":""}
                       style="display:none"/>
                <span style="display:block;width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${(prefill.color||"#3b82f6")===c?"#0f172a":"transparent"};transition:border .15s"
                      onclick="this.parentElement.querySelector('input').checked=true;document.querySelectorAll('[name=ev_color]').forEach(r=>{r.nextElementSibling.style.borderColor=r.checked?'#0f172a':'transparent'})">
                </span>
              </label>`).join("")}
          </div>
        </div>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        ${isEdit ? `<button class="btn-modal-danger" onclick="window._delEvento('${prefill.id}')">Eliminar</button>` : ""}
        <button class="btn-modal-save" id="ev_save">${isEdit?"Actualizar":"Crear evento"}</button>
      </div>
    </div>`);

  // Toggle tipo visual
  document.querySelectorAll('input[name="ev_tipo"]').forEach(radio => {
    radio.addEventListener("change", () => {
      document.querySelectorAll(".ev-tipo-btn").forEach(btn => {
        const tipo = TIPOS.find(t=>t.id===btn.dataset.tipo);
        if (!tipo) return;
        const sel = btn.dataset.tipo === radio.value;
        btn.style.borderColor = sel ? tipo.color : "var(--brd)";
        btn.style.background  = sel ? tipo.bg    : "transparent";
        btn.style.color       = sel ? tipo.color : "var(--t2)";
      });
    });
  });

  // Toggle todo el día
  document.getElementById("ev_todo_dia")?.addEventListener("change", e => {
    const hide = e.target.checked;
    document.getElementById("ev_hora_wrap").style.display    = hide ? "none" : "";
    document.getElementById("ev_hora_fin_wrap").style.display = hide ? "none" : "";
  });

  document.getElementById("ev_save").addEventListener("click", async () => {
    const titulo = document.getElementById("ev_titulo").value.trim();
    const fecha  = document.getElementById("ev_fecha").value;
    if (!titulo || !fecha) { toast("Título y fecha son obligatorios","error"); return; }

    const clienteSel = document.getElementById("ev_cliente");
    const todoDia    = document.getElementById("ev_todo_dia")?.checked;

    const payload = {
      user_id:        SESSION.user.id,
      titulo,
      tipo:           document.querySelector('input[name="ev_tipo"]:checked')?.value || "visita",
      fecha,
      todo_dia:       todoDia || false,
      hora_inicio:    todoDia ? null : document.getElementById("ev_hora_inicio")?.value || null,
      hora_fin:       todoDia ? null : document.getElementById("ev_hora_fin")?.value    || null,
      cliente_id:     clienteSel.value || null,
      cliente_nombre: clienteSel.selectedOptions[0]?.dataset.nombre || null,
      tecnico_id:     document.getElementById("ev_tecnico")?.value  || null,
      direccion:      document.getElementById("ev_direccion")?.value.trim() || null,
      descripcion:    document.getElementById("ev_notas")?.value.trim()     || null,
      color:          document.querySelector('input[name="ev_color"]:checked')?.value || "#3b82f6",
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase.from("agenda_eventos").update(payload).eq("id", prefill.id));
    } else {
      ({ error } = await supabase.from("agenda_eventos").insert(payload));
    }

    if (error) { toast("Error: "+error.message,"error"); return; }
    toast(isEdit?"Evento actualizado ✅":"Evento creado ✅","success");
    closeModal();
    await refreshAgenda();
  });
}

/* ══════════════════════════
   VER EVENTO (detalle)
══════════════════════════ */
window._verEvento = async (id) => {
  const ev   = EVENTOS.find(e=>e.id===id);
  if (!ev) return;
  const tipo = TIPOS.find(t=>t.id===ev.tipo)||TIPOS[5];
  const tec  = TECNICOS.find(x=>x.id===ev.tecnico_id);

  openModal(`
    <div class="modal" style="max-width:440px">
      <div class="modal-hd" style="border-bottom:3px solid ${tipo.color}">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">${tipo.icon}</span>
          <span class="modal-title">${ev.titulo}</span>
        </div>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:10px;align-items:center">
            <span style="background:${tipo.bg};color:${tipo.color};padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700">${tipo.icon} ${tipo.label}</span>
          </div>
          <div style="display:flex;gap:8px;color:var(--t2);font-size:13px;align-items:center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <strong>${fmtDate(ev.fecha)}</strong>
            ${!ev.todo_dia && ev.hora_inicio ? `· ${ev.hora_inicio.slice(0,5)}${ev.hora_fin?" - "+ev.hora_fin.slice(0,5):""}` : "· Todo el día"}
          </div>
          ${ev.cliente_nombre?`<div style="font-size:13px;color:var(--t2)">👤 ${ev.cliente_nombre}</div>`:""}
          ${tec?`<div style="font-size:13px;color:var(--t2)">🔧 ${tec.nombre}</div>`:""}
          ${ev.direccion?`<div style="font-size:13px;color:var(--t2)">📍 ${ev.direccion}</div>`:""}
          ${ev.descripcion?`<div style="font-size:13px;color:var(--t3);background:var(--bg2);border-radius:8px;padding:10px">${ev.descripcion}</div>`:""}
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <button class="btn-outline" onclick="window._cm();window._editEvento('${ev.id}')">✏️ Editar</button>
      </div>
    </div>`);
};

window._editEvento = async (id) => {
  const ev = EVENTOS.find(e=>e.id===id);
  if (ev) showNuevoEventoModal(ev);
};

window._delEvento = async (id) => {
  await supabase.from("agenda_eventos").delete().eq("id", id);
  closeModal(); toast("Evento eliminado","success");
  await refreshAgenda();
};

window._clickDia = (fechaStr, hora) => {
  showNuevoEventoModal({ fecha: fechaStr, hora_inicio: hora||"09:00", hora_fin: hora ? `${String(parseInt(hora)+1).padStart(2,"0")}:00` : "10:00" });
};

/* ══════════════════════════
   HELPERS
══════════════════════════ */
function getLunes(fecha) {
  const d = new Date(fecha);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initAgendaView() {
  // Navegación
  document.getElementById("agendaPrev")?.addEventListener("click", () => {
    if (VISTA==="mes")    FECHA_NAV.setMonth(FECHA_NAV.getMonth()-1);
    else if (VISTA==="semana") FECHA_NAV.setDate(FECHA_NAV.getDate()-7);
    else FECHA_NAV.setDate(FECHA_NAV.getDate()-1);
    refreshAgenda();
  });
  document.getElementById("agendaNext")?.addEventListener("click", () => {
    if (VISTA==="mes")    FECHA_NAV.setMonth(FECHA_NAV.getMonth()+1);
    else if (VISTA==="semana") FECHA_NAV.setDate(FECHA_NAV.getDate()+7);
    else FECHA_NAV.setDate(FECHA_NAV.getDate()+1);
    refreshAgenda();
  });
  document.getElementById("agendaHoy")?.addEventListener("click", () => {
    FECHA_NAV = new Date(HOY.getFullYear(), HOY.getMonth(), HOY.getDate());
    refreshAgenda();
  });

  // Toggle vista
  ["mes","semana","dia"].forEach(v => {
    document.getElementById(`agendaVista_${v}`)?.addEventListener("click", () => {
      VISTA = v;
      document.querySelectorAll(".agenda-vista-btn").forEach(b=>b.classList.remove("active"));
      document.getElementById(`agendaVista_${v}`)?.classList.add("active");
      refreshAgenda();
    });
  });

  // Nuevo evento
  document.getElementById("nuevoEventoBtn")?.addEventListener("click", () => showNuevoEventoModal());

  refreshAgenda();
}
