/* ═══════════════════════════════════════════════════════
   TAURIX · facturas-recurrentes.js
   Facturas recurrentes automáticas: mensuales, trimestrales,
   anuales. Genera borradores automáticamente.
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, switchView
} from "./utils.js";
import { PRODUCTOS } from "./productos.js";

let RECURRENTES = [];

/* ══════════════════════════
   LOAD / REFRESH
══════════════════════════ */
export async function loadRecurrentes() {
  const { data, error } = await supabase.from("facturas_recurrentes")
    .select("*").eq("user_id", SESSION.user.id)
    .order("proxima_generacion", { ascending: true });
  if (error) { console.error("facturas_recurrentes:", error.message); return []; }
  return data || [];
}

export async function refreshRecurrentes() {
  RECURRENTES = await loadRecurrentes();
  renderRecurrentesTable();
  renderKPIs();
}

/* ══════════════════════════
   KPIs
══════════════════════════ */
function renderKPIs() {
  const activas = RECURRENTES.filter(r => r.activa);
  const totalMes = activas.reduce((a, r) => {
    const base = r.base || 0;
    const multiplier = { mensual: 1, bimestral: 0.5, trimestral: 1/3, semestral: 1/6, anual: 1/12 }[r.frecuencia] || 1;
    return a + base * multiplier;
  }, 0);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("recKpiActivas", activas.length);
  s("recKpiMensual", fmt(totalMes));
  s("recKpiAnual", fmt(totalMes * 12));

  const proxima = activas.find(r => r.proxima_generacion);
  s("recKpiProxima", proxima ? fmtDate(proxima.proxima_generacion) : "—");
}

/* ══════════════════════════
   TABLA
══════════════════════════ */
function renderRecurrentesTable() {
  const tbody = document.getElementById("recurrentesBody");
  if (!tbody) return;

  if (!RECURRENTES.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="9">Sin facturas recurrentes. Crea una para automatizar tu facturación periódica.</td></tr>`;
    return;
  }

  const freqLabel = { mensual:"Mensual", bimestral:"Bimestral", trimestral:"Trimestral", semestral:"Semestral", anual:"Anual" };
  const hoy = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = RECURRENTES.map(r => {
    const total = r.base + r.base * (r.iva || 21) / 100;
    const diasFaltan = r.proxima_generacion ? Math.floor((new Date(r.proxima_generacion) - new Date()) / 86400000) : null;
    const diasClass = diasFaltan !== null ? (diasFaltan < 0 ? "dias-badge--red" : diasFaltan <= 7 ? "dias-badge--warn" : "dias-badge--ok") : "";

    return `<tr style="${!r.activa ? "opacity:.5" : ""}">
      <td><strong style="font-size:13px">${r.concepto || "—"}</strong></td>
      <td style="font-size:12px;color:var(--t3)">${r.cliente_nombre || "—"}</td>
      <td><span class="badge b-income">${freqLabel[r.frecuencia] || r.frecuencia}</span></td>
      <td class="mono fw7">${fmt(total)}</td>
      <td>${r.proxima_generacion ? `<span class="dias-badge ${diasClass}">${fmtDate(r.proxima_generacion)}</span>` : "—"}</td>
      <td>${r.veces_generada || 0}</td>
      <td>${r.fecha_fin ? fmtDate(r.fecha_fin) : "∞ Indefinida"}</td>
      <td><span class="badge ${r.activa ? "b-cobrada" : "b-pendiente"}">${r.activa ? "✅ Activa" : "⏸ Pausada"}</span></td>
      <td>
        <div class="tbl-act">
          <button class="ta-btn" onclick="window._toggleRecurrente('${r.id}', ${!r.activa})" title="${r.activa ? "Pausar" : "Activar"}">${r.activa ? "⏸" : "▶️"}</button>
          <button class="ta-btn" onclick="window._editRecurrente('${r.id}')">✏️</button>
          <button class="ta-btn" onclick="window._generarAhora('${r.id}')" title="Generar factura ahora">⚡</button>
          <button class="ta-btn ta-del" onclick="window._delRecurrente('${r.id}')">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   GENERAR FACTURA DESDE RECURRENTE
══════════════════════════ */
async function generarFacturaDesdeRecurrente(recurrenteId) {
  const r = RECURRENTES.find(x => x.id === recurrenteId);
  if (!r) { toast("Recurrente no encontrada", "error"); return; }

  const lineas = r.lineas ? JSON.parse(r.lineas) : [{ descripcion: r.concepto, cantidad: 1, precio: r.base, iva: r.iva || 21 }];

  const { data: factura, error } = await supabase.from("facturas").insert({
    user_id: SESSION.user.id,
    concepto: r.concepto,
    base: r.base,
    iva: r.iva || 21,
    irpf_retencion: r.irpf_retencion || 0,
    tipo: r.tipo || "emitida",
    tipo_operacion: r.tipo_operacion || "nacional",
    estado: "borrador",
    fecha: new Date().toISOString().slice(0, 10),
    cliente_id: r.cliente_id,
    cliente_nombre: r.cliente_nombre,
    cliente_nif: r.cliente_nif,
    notas: `Factura recurrente (${r.frecuencia}) — generada automáticamente`,
    lineas: JSON.stringify(lineas),
    plantilla_id: r.plantilla_id || null,  // heredar plantilla de la recurrente
  }).select().single();

  if (error) { toast("Error generando factura: " + error.message, "error"); return null; }

  // Actualizar la recurrente: siguiente fecha + contador
  const nextDate = calcSiguienteFecha(r.proxima_generacion || new Date().toISOString().slice(0, 10), r.frecuencia);
  const activa = r.fecha_fin ? nextDate <= r.fecha_fin : true;

  await supabase.from("facturas_recurrentes").update({
    proxima_generacion: nextDate,
    veces_generada: (r.veces_generada || 0) + 1,
    ultima_generacion: new Date().toISOString().slice(0, 10),
    activa: activa,
  }).eq("id", recurrenteId);

  return factura;
}

function calcSiguienteFecha(fechaStr, frecuencia) {
  const d = new Date(fechaStr + "T12:00:00");
  const map = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
  d.setMonth(d.getMonth() + (map[frecuencia] || 1));
  return d.toISOString().slice(0, 10);
}

/* ══════════════════════════
   AUTO-GENERAR AL ARRANCAR
   Genera borradores para recurrentes vencidas
══════════════════════════ */
export async function autoGenerarRecurrentes() {
  if (!SESSION) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const pendientes = RECURRENTES.filter(r => r.activa && r.proxima_generacion && r.proxima_generacion <= hoy);

  if (!pendientes.length) return;

  let generadas = 0;
  for (const r of pendientes) {
    const f = await generarFacturaDesdeRecurrente(r.id);
    if (f) generadas++;
  }

  if (generadas > 0) {
    toast(`⚡ ${generadas} factura${generadas > 1 ? "s" : ""} recurrente${generadas > 1 ? "s" : ""} generada${generadas > 1 ? "s" : ""} como borrador`, "info", 5000);
    await refreshRecurrentes();
  }
}

/* ══════════════════════════
   MODAL CREAR/EDITAR RECURRENTE
══════════════════════════ */
function showRecurrenteModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const frecuencias = ["mensual", "bimestral", "trimestral", "semestral", "anual"];

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">🔄 ${isEdit ? "Editar" : "Nueva"} factura recurrente</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Las facturas recurrentes se generan automáticamente como borrador en la fecha programada. Luego puedes revisarlas y emitirlas.</p>

        <div class="modal-grid2">
          <div class="modal-field"><label>Concepto *</label>
            <input autocomplete="off" id="rec_concepto" class="ff-input" value="${prefill.concepto || ""}" placeholder="Ej: Cuota mensual mantenimiento"/>
          </div>
          <div class="modal-field"><label>Cliente</label>
            <select id="rec_cliente" class="ff-select">
              <option value="">— Sin cliente —</option>
              ${CLIENTES.map(c => `<option value="${c.id}" ${prefill.cliente_id === c.id ? "selected" : ""}>${c.nombre}${c.nif ? " · " + c.nif : ""}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="modal-grid3">
          <div class="modal-field"><label>Base imponible (€) *</label>
            <input autocomplete="off" type="number" id="rec_base" class="ff-input" value="${prefill.base || ""}" step="0.01" placeholder="0.00"/>
          </div>
          <div class="modal-field"><label>IVA</label>
            <select id="rec_iva" class="ff-select">
              <option value="21" ${(prefill.iva || 21) === 21 ? "selected" : ""}>21%</option>
              <option value="10" ${prefill.iva === 10 ? "selected" : ""}>10%</option>
              <option value="4"  ${prefill.iva === 4  ? "selected" : ""}>4%</option>
              <option value="0"  ${prefill.iva === 0  ? "selected" : ""}>0%</option>
            </select>
          </div>
          <div class="modal-field"><label>Frecuencia *</label>
            <select id="rec_freq" class="ff-select">
              ${frecuencias.map(f => `<option value="${f}" ${prefill.frecuencia === f ? "selected" : ""}>${f.charAt(0).toUpperCase() + f.slice(1)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field"><label>Próxima generación *</label>
            <input autocomplete="off" type="date" id="rec_proxima" class="ff-input" value="${prefill.proxima_generacion || new Date().toISOString().slice(0, 10)}"/>
          </div>
          <div class="modal-field"><label>Fecha fin <span style="font-weight:400;color:var(--t4)">(dejar vacío = indefinida)</span></label>
            <input autocomplete="off" type="date" id="rec_fin" class="ff-input" value="${prefill.fecha_fin || ""}"/>
          </div>
        </div>

        <div class="modal-field"><label>Notas internas</label>
          <textarea autocomplete="off" id="rec_notas" class="ff-input ff-textarea" style="min-height:60px" placeholder="Notas que se incluirán en cada factura generada">${prefill.notas || ""}</textarea>
        </div>

        <!-- Preview -->
        <div style="background:var(--bg2);border-radius:10px;padding:14px;margin-top:8px;display:flex;gap:24px;font-size:13px;flex-wrap:wrap">
          <span>Base: <strong id="rec_pvBase">—</strong></span>
          <span>IVA: <strong id="rec_pvIva">—</strong></span>
          <span>Total: <strong id="rec_pvTotal">—</strong></span>
          <span id="rec_pvAnual" style="margin-left:auto;font-weight:600;color:var(--t3)"></span>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="rec_del" style="margin-right:auto">🗑️ Eliminar</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="rec_save">${isEdit ? "Actualizar" : "Crear recurrente"}</button>
      </div>
    </div>
  `);

  // Preview en tiempo real
  const updatePreview = () => {
    const base = parseFloat(document.getElementById("rec_base")?.value) || 0;
    const iva = parseInt(document.getElementById("rec_iva")?.value) || 0;
    const freq = document.getElementById("rec_freq")?.value || "mensual";
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s("rec_pvBase", fmt(base));
    s("rec_pvIva", fmt(base * iva / 100));
    s("rec_pvTotal", fmt(base + base * iva / 100));
    const mult = { mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 }[freq] || 12;
    s("rec_pvAnual", `≈ ${fmt((base + base * iva / 100) * mult)}/año`);
  };
  ["rec_base", "rec_iva", "rec_freq"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreview);
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });
  updatePreview();

  // Guardar
  document.getElementById("rec_save").addEventListener("click", async () => {
    const concepto = document.getElementById("rec_concepto").value.trim();
    const base = parseFloat(document.getElementById("rec_base").value);
    if (!concepto || isNaN(base)) { toast("Concepto y base son obligatorios", "error"); return; }

    const clienteId = document.getElementById("rec_cliente").value || null;
    const cliente = clienteId ? CLIENTES.find(c => c.id === clienteId) : null;

    const payload = {
      user_id: SESSION.user.id,
      concepto,
      base,
      iva: parseInt(document.getElementById("rec_iva").value) || 21,
      frecuencia: document.getElementById("rec_freq").value,
      proxima_generacion: document.getElementById("rec_proxima").value,
      fecha_fin: document.getElementById("rec_fin").value || null,
      cliente_id: clienteId,
      cliente_nombre: cliente?.nombre || null,
      cliente_nif: cliente?.nif || null,
      notas: document.getElementById("rec_notas").value.trim() || null,
      activa: true,
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("facturas_recurrentes").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("facturas_recurrentes").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }

    toast(isEdit ? "Recurrente actualizada ✅" : "Factura recurrente creada ✅", "success");
    closeModal();
    await refreshRecurrentes();
  });

  if (isEdit) {
    document.getElementById("rec_del")?.addEventListener("click", async () => {
      await supabase.from("facturas_recurrentes").delete().eq("id", prefill.id);
      closeModal(); toast("Recurrente eliminada", "success");
      await refreshRecurrentes();
    });
  }
}

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._nuevaRecurrente = () => switchView("nueva-recurrente");
window._editRecurrente = (id) => {
  if (window._cargarRecurrenteParaEditar) {
    window._cargarRecurrenteParaEditar(id);
  }
};
window._delRecurrente = (id) => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar recurrente</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta factura recurrente? Las facturas ya generadas NO se eliminarán.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_drOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_drOk").addEventListener("click", async () => {
    await supabase.from("facturas_recurrentes").delete().eq("id", id);
    closeModal(); toast("Recurrente eliminada", "success");
    await refreshRecurrentes();
  });
};
window._toggleRecurrente = async (id, activa) => {
  await supabase.from("facturas_recurrentes").update({ activa }).eq("id", id);
  toast(activa ? "Recurrente activada ▶️" : "Recurrente pausada ⏸", "success");
  await refreshRecurrentes();
};
window._generarAhora = async (id) => {
  const f = await generarFacturaDesdeRecurrente(id);
  if (f) {
    toast("⚡ Factura generada como borrador — revísala en Facturas", "success", 4000);
    await refreshRecurrentes();
  }
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initRecurrentesView() {
  document.getElementById("nuevaRecurrenteBtn")?.addEventListener("click", () => switchView("nueva-recurrente"));
  refreshRecurrentes().then(() => autoGenerarRecurrentes());
}
