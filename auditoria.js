/* ═══════════════════════════════════════════════════════
   TAURIX · auditoria.js
   
   Registro completo de cambios — solo lectura.
   Los datos vienen de triggers automáticos en Supabase.
   El frontend solo lee y filtra, nunca escribe directamente.
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

/* ══════════════════════════
   CONFIG
══════════════════════════ */
const ACCIONES = {
  crear:    { label:"Creación",      color:"#059669", bg:"#f0fdf4", icon:"✚" },
  editar:   { label:"Modificación",  color:"#3b82f6", bg:"#eff6ff", icon:"✎" },
  eliminar: { label:"Eliminación",   color:"#dc2626", bg:"#fef2f2", icon:"✕" },
  emitir:   { label:"Emisión",       color:"#1a56db", bg:"#eff6ff", icon:"▶" },
  firmar:   { label:"Firma",         color:"#059669", bg:"#f0fdf4", icon:"✓" },
  acceso:   { label:"Acceso",        color:"#6b7280", bg:"#f9fafb", icon:"⚷" },
  exportar: { label:"Exportación",   color:"#8b5cf6", bg:"#f5f3ff", icon:"↓" },
};

const ENTIDADES = {
  facturas:     { label:"Factura",      icon:"🧾" },
  presupuestos: { label:"Presupuesto",  icon:"📋" },
  clientes:     { label:"Cliente",      icon:"👤" },
  gastos:       { label:"Gasto",        icon:"💳" },
  trabajos:     { label:"Trabajo",      icon:"🔧" },
  empleados:    { label:"Empleado",     icon:"👷" },
  nominas:      { label:"Nómina",       icon:"💰" },
  productos:    { label:"Producto",     icon:"📦" },
};

const POR_PAGINA = 50;
let pagina = 1;
let totalRegistros = 0;

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadAuditoria(filtros = {}) {
  let q = supabase.from("auditoria")
    .select("*", { count:"exact" })
    .eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false })
    .range((pagina-1)*POR_PAGINA, pagina*POR_PAGINA - 1);

  if (filtros.accion)   q = q.eq("accion",   filtros.accion);
  if (filtros.entidad)  q = q.eq("entidad",  filtros.entidad);
  if (filtros.desde)    q = q.gte("created_at", filtros.desde + "T00:00:00");
  if (filtros.hasta)    q = q.lte("created_at", filtros.hasta + "T23:59:59");
  if (filtros.busqueda) q = q.ilike("entidad_ref", `%${filtros.busqueda}%`);

  const { data, error, count } = await q;
  if (error) { console.error("auditoria:", error.message); return []; }
  totalRegistros = count || 0;
  return data || [];
}

/* ══════════════════════════
   REGISTRAR DESDE FRONTEND
   Para acciones que no tienen trigger
   (login, exportar, etc.)
══════════════════════════ */
export async function registrarAccion(accion, entidad, entidadId, entidadRef, datosDespues = null) {
  if (!SESSION) return;
  await supabase.from("auditoria").insert({
    user_id:       SESSION.user.id,
    accion,
    entidad,
    entidad_id:    entidadId || null,
    entidad_ref:   entidadRef || null,
    datos_despues: datosDespues ? JSON.stringify(datosDespues) : null,
  }).catch(() => {}); // silencioso — no bloquear UI si falla
}

/* ══════════════════════════
   RENDER
══════════════════════════ */
export async function refreshAuditoriaView() {
  const filtros = getFiltros();
  const datos   = await loadAuditoria(filtros);

  renderKPIs(datos);
  renderTimeline(datos);
  renderPaginacion();
}

function getFiltros() {
  return {
    accion:   document.getElementById("auditoriaAccion")?.value  || "",
    entidad:  document.getElementById("auditoriaEntidad")?.value || "",
    desde:    document.getElementById("auditoriaDesde")?.value   || "",
    hasta:    document.getElementById("auditoriaHasta")?.value   || "",
    busqueda: document.getElementById("auditoriaBusqueda")?.value|| "",
  };
}

function renderKPIs(datos) {
  const hoy = new Date().toISOString().slice(0,10);
  const hoy_datos = datos.filter(d => d.created_at.slice(0,10) === hoy);

  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("auditTotal",     totalRegistros);
  s("auditHoy",       hoy_datos.length);
  s("auditCreados",   datos.filter(d=>d.accion==="crear").length);
  s("auditEditados",  datos.filter(d=>d.accion==="editar").length);
  s("auditEliminados",datos.filter(d=>d.accion==="eliminar").length);
}

function renderTimeline(datos) {
  const body = document.getElementById("auditoriaBody");
  if (!body) return;

  if (!datos.length) {
    body.innerHTML = `
      <div style="text-align:center;padding:48px 20px;color:var(--t3)">
        <div style="font-size:40px;margin-bottom:12px">🔍</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Sin registros</div>
        <div style="font-size:12px">No hay actividad con los filtros seleccionados.</div>
      </div>`;
    return;
  }

  // Agrupar por día
  const porDia = {};
  datos.forEach(d => {
    const dia = d.created_at.slice(0,10);
    if (!porDia[dia]) porDia[dia] = [];
    porDia[dia].push(d);
  });

  body.innerHTML = Object.entries(porDia).map(([dia, registros]) => {
    const esHoy  = dia === new Date().toISOString().slice(0,10);
    const esAyer = dia === new Date(Date.now()-86400000).toISOString().slice(0,10);
    const label  = esHoy ? "Hoy" : esAyer ? "Ayer" : fmtDate(dia);

    return `
      <div class="audit-day-group">
        <div class="audit-day-label">
          <span style="background:var(--bg2);padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">${label}</span>
        </div>
        ${registros.map(r => renderRegistro(r)).join("")}
      </div>`;
  }).join("");
}

function renderRegistro(r) {
  const acc = ACCIONES[r.accion] || { label:r.accion, color:"#6b7280", bg:"#f9fafb", icon:"·" };
  const ent = ENTIDADES[r.entidad] || { label:r.entidad, icon:"📄" };
  const hora = new Date(r.created_at).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});
  const tieneDetalle = r.datos_antes || r.datos_despues;

  // Generar descripción legible del cambio
  const descripcion = _describir(r, acc, ent);

  return `
    <div class="audit-row" onclick="${tieneDetalle ? `window._verDetalleAudit('${r.id}')` : ""}">
      <div class="audit-dot" style="background:${acc.color}"></div>
      <div class="audit-time">${hora}</div>
      <div class="audit-content">
        <div class="audit-msg">
          <span class="audit-badge" style="background:${acc.bg};color:${acc.color}">${acc.icon} ${acc.label}</span>
          <span class="audit-entidad">${ent.icon} ${ent.label}</span>
          ${r.entidad_ref ? `<span class="audit-ref">${r.entidad_ref}</span>` : ""}
          <span class="audit-desc">${descripcion}</span>
        </div>
      </div>
      <div class="audit-meta">
        ${tieneDetalle ? `<span class="audit-ver-btn">Ver cambios →</span>` : ""}
      </div>
    </div>`;
}

function _describir(r, acc, ent) {
  if (r.accion === "crear")   return `creado/a correctamente`;
  if (r.accion === "eliminar") return `eliminado/a del sistema`;
  if (r.accion === "emitir")  return `emitida y firmada`;
  if (r.accion === "acceso")  return `sesión iniciada`;
  if (r.accion === "exportar") return `datos exportados`;

  if (r.accion === "editar" && r.datos_antes && r.datos_despues) {
    try {
      const antes  = typeof r.datos_antes  === "string" ? JSON.parse(r.datos_antes)  : r.datos_antes;
      const despues = typeof r.datos_despues === "string" ? JSON.parse(r.datos_despues) : r.datos_despues;
      const cambios = [];
      const camposIgnorar = ["updated_at","created_at","id","user_id"];
      const camposLegibles = {
        estado:"estado", base:"base imponible", iva:"IVA",
        concepto:"concepto", cliente_nombre:"cliente",
        fecha:"fecha", titulo:"título", prioridad:"prioridad",
        nombre:"nombre", precio:"precio", stock_actual:"stock",
      };
      for (const [k,label] of Object.entries(camposLegibles)) {
        if (camposIgnorar.includes(k)) continue;
        if (antes[k] !== undefined && despues[k] !== undefined && antes[k] !== despues[k]) {
          const vAntes  = typeof antes[k]  === "number" ? fmt(antes[k])  : String(antes[k]||"—");
          const vDespues = typeof despues[k] === "number" ? fmt(despues[k]) : String(despues[k]||"—");
          cambios.push(`${label}: <em>${vAntes}</em> → <strong>${vDespues}</strong>`);
        }
      }
      if (cambios.length) return cambios.slice(0,3).join(" · ");
      return "datos actualizados";
    } catch { return "datos actualizados"; }
  }
  return "";
}

function renderPaginacion() {
  const wrap = document.getElementById("auditoriaPaginacion");
  if (!wrap) return;

  const totalPags = Math.ceil(totalRegistros / POR_PAGINA);
  if (totalPags <= 1) { wrap.innerHTML=""; return; }

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;justify-content:center;padding:16px">
      <button class="btn-outline" style="font-size:12px" ${pagina<=1?"disabled":""} onclick="window._auditPag(${pagina-1})">← Anterior</button>
      <span style="font-size:12px;color:var(--t3)">Página ${pagina} de ${totalPags} · ${totalRegistros} registros</span>
      <button class="btn-outline" style="font-size:12px" ${pagina>=totalPags?"disabled":""} onclick="window._auditPag(${pagina+1})">Siguiente →</button>
    </div>`;
}

window._auditPag = async (p) => {
  pagina = p;
  await refreshAuditoriaView();
  document.getElementById("auditoriaBody")?.scrollIntoView({ behavior:"smooth" });
};

/* ══════════════════════════
   MODAL DETALLE CAMBIO
══════════════════════════ */
window._verDetalleAudit = async (id) => {
  const { data: r } = await supabase.from("auditoria")
    .select("*").eq("id", id).single();
  if (!r) return;

  const acc = ACCIONES[r.accion] || { label:r.accion, color:"#6b7280" };
  const ent = ENTIDADES[r.entidad] || { label:r.entidad };
  const hora = new Date(r.created_at).toLocaleString("es-ES");

  const antes  = r.datos_antes  ? (typeof r.datos_antes  === "string" ? JSON.parse(r.datos_antes)  : r.datos_antes)  : null;
  const despues = r.datos_despues ? (typeof r.datos_despues === "string" ? JSON.parse(r.datos_despues) : r.datos_despues) : null;

  // Calcular diferencias
  const camposIgnorar = new Set(["updated_at","created_at","user_id","lineas","materiales"]);
  let diff = [];
  if (antes && despues) {
    const keys = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    keys.forEach(k => {
      if (camposIgnorar.has(k)) return;
      const va = antes[k], vd = despues[k];
      if (va !== vd) diff.push({ campo:k, antes:va, despues:vd });
    });
  }

  openModal(`
    <div class="modal modal--wide" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">🔍 Detalle del cambio</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Cabecera -->
        <div style="display:flex;gap:16px;align-items:center;background:var(--bg2);border-radius:12px;padding:14px 16px;margin-bottom:20px">
          <div style="width:40px;height:40px;border-radius:10px;background:${acc.color}18;display:flex;align-items:center;justify-content:center;font-size:18px;color:${acc.color};font-weight:900">${(ACCIONES[r.accion]?.icon)||"·"}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700">${acc.label} — ${ent.label} <span style="color:${acc.color}">${r.entidad_ref||""}</span></div>
            <div style="font-size:12px;color:var(--t3)">${hora}</div>
          </div>
        </div>

        <!-- Diferencias campo a campo -->
        ${diff.length ? `
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:10px">Cambios detectados</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:20px">
            ${diff.map(d => `
              <div style="display:grid;grid-template-columns:140px 1fr 20px 1fr;gap:8px;align-items:center;padding:8px 12px;background:var(--bg2);border-radius:8px;font-size:12px">
                <span style="font-weight:700;color:var(--t2)">${d.campo}</span>
                <span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-family:monospace">${String(d.antes??'—').slice(0,60)}</span>
                <span style="text-align:center;color:var(--t4)">→</span>
                <span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:6px;font-family:monospace">${String(d.despues??'—').slice(0,60)}</span>
              </div>`).join("")}
          </div>` : ""}

        <!-- JSON completo (colapsable) -->
        <details style="margin-top:4px">
          <summary style="cursor:pointer;font-size:12px;color:var(--t3);font-weight:600;padding:8px 0">Ver datos completos (JSON)</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
            ${antes ? `
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#dc2626;margin-bottom:4px">Antes</div>
                <pre style="background:#fef2f2;border-radius:8px;padding:10px;font-size:10px;overflow:auto;max-height:200px;color:#991b1b">${JSON.stringify(antes,null,2)}</pre>
              </div>` : ""}
            ${despues ? `
              <div>
                <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#059669;margin-bottom:4px">Después</div>
                <pre style="background:#f0fdf4;border-radius:8px;padding:10px;font-size:10px;overflow:auto;max-height:200px;color:#166534">${JSON.stringify(despues,null,2)}</pre>
              </div>` : ""}
          </div>
        </details>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
      </div>
    </div>`);
};

/* ══════════════════════════
   EXPORTAR LOG
══════════════════════════ */
export async function exportarAuditoria() {
  if (!window.XLSX) {
    await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }

  const filtros = getFiltros();
  // Exportar sin paginación (máx 1000)
  const { data } = await supabase.from("auditoria")
    .select("*").eq("user_id", SESSION.user.id)
    .order("created_at", { ascending:false }).limit(1000);

  const rows = (data||[]).map(r => ({
    "Fecha/Hora":    new Date(r.created_at).toLocaleString("es-ES"),
    "Acción":        ACCIONES[r.accion]?.label || r.accion,
    "Entidad":       ENTIDADES[r.entidad]?.label || r.entidad,
    "Referencia":    r.entidad_ref || "",
    "ID Registro":   r.entidad_id || "",
  }));

  const ws = window.XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{wch:20},{wch:14},{wch:14},{wch:30},{wch:38}];
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Log auditoría");
  window.XLSX.writeFile(wb, `taurix_auditoria_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast("✅ Log exportado","success");

  // Registrar la propia exportación
  await registrarAccion("exportar", "auditoria", null, `Export ${new Date().toLocaleDateString("es-ES")}`);
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initAuditoriaView() {
  ["auditoriaAccion","auditoriaEntidad","auditoriaDesde","auditoriaHasta","auditoriaBusqueda"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", async () => { pagina=1; await refreshAuditoriaView(); });
    document.getElementById(id)?.addEventListener("input",  async () => { pagina=1; await refreshAuditoriaView(); });
  });

  document.getElementById("exportAuditoriaBtn")?.addEventListener("click", exportarAuditoria);
  document.getElementById("auditoriaLimpiarBtn")?.addEventListener("click", () => {
    ["auditoriaAccion","auditoriaEntidad","auditoriaDesde","auditoriaHasta","auditoriaBusqueda"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    pagina = 1;
    refreshAuditoriaView();
  });

  refreshAuditoriaView();
}
