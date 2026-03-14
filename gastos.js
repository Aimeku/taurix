/* ═══════════════════════════════════════════════════════
   TUGESTOR · gastos.js
   Módulo de gastos y proveedores
   Gestión de proveedores + gastos recurrentes + vencimientos
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal, getYear, getTrim, getFechaRango } from "./utils.js";

export let PROVEEDORES = [];
export function setProveedores(p) { PROVEEDORES = p; }

/* ══════════════════════════
   PROVEEDORES
══════════════════════════ */
export async function loadProveedores() {
  const { data, error } = await supabase.from("proveedores")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadProveedores:", error.message); return []; }
  return data || [];
}

export async function refreshProveedores() {
  const lista = await loadProveedores();
  setProveedores(lista);
  renderProveedoresTable(lista);
  const countEl = document.getElementById("provCount");
  if (countEl) countEl.textContent = `${lista.length} proveedor${lista.length !== 1 ? "es" : ""} registrados`;
  populateProveedorSelect();
}

export function renderProveedoresTable(list) {
  const tbody = document.getElementById("provBody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">Sin proveedores. Añade tus proveedores habituales.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(p => `
    <tr>
      <td><strong style="font-size:13px">${p.nombre}</strong></td>
      <td class="mono">${p.nif || "—"}</td>
      <td style="font-size:12px">${p.email || "—"}</td>
      <td style="font-size:12px">${p.telefono || "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${p.categoria || "—"}</td>
      <td><span class="badge ${p.activo !== false ? "b-cobrada" : ""}">${p.activo !== false ? "Activo" : "Inactivo"}</span></td>
      <td>
        <div class="tbl-act">
          <button class="ta-btn" onclick="window._editProv('${p.id}')">✏️</button>
          <button class="ta-btn ta-del" onclick="window._delProv('${p.id}')">🗑️</button>
        </div>
      </td>
    </tr>`).join("");
}

export function populateProveedorSelect() {
  const sel = document.getElementById("gastoProv");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Sin proveedor —</option>`;
  PROVEEDORES.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id; opt.textContent = `${p.nombre}${p.nif ? " · " + p.nif : ""}`;
    sel.appendChild(opt);
  });
}

export function showNuevoProveedorModal(prefill = {}) {
  const isEdit = !!prefill.id;
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🏭 ${isEdit ? "Editar" : "Nuevo"} proveedor</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre / Razón social *</label><input id="mpv_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Nombre del proveedor"/></div>
          <div class="modal-field"><label>NIF / CIF</label><input id="mpv_nif" class="ff-input" value="${prefill.nif || ""}" placeholder="B12345678"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Email</label><input type="email" id="mpv_email" class="ff-input" value="${prefill.email || ""}" placeholder="proveedor@empresa.com"/></div>
          <div class="modal-field"><label>Teléfono</label><input id="mpv_tel" class="ff-input" value="${prefill.telefono || ""}" placeholder="+34 600 000 000"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Categoría</label>
            <select id="mpv_cat" class="ff-select">
              ${["Suministros","Servicios profesionales","Software / Suscripciones","Material de oficina","Transporte","Telecomunicaciones","Alquiler","Seguros","Publicidad","Otros"].map(c =>
                `<option value="${c}" ${prefill.categoria === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>IBAN / Cuenta bancaria</label><input id="mpv_iban" class="ff-input" value="${prefill.iban || ""}" placeholder="ES00 0000 0000 0000 0000 0000"/></div>
        </div>
        <div class="modal-field"><label>Dirección</label><input id="mpv_dir" class="ff-input" value="${prefill.direccion || ""}" placeholder="Dirección fiscal"/></div>
        <div class="modal-field"><label>Notas</label><textarea id="mpv_notas" class="ff-input ff-textarea" style="min-height:60px" placeholder="Notas sobre este proveedor…">${prefill.notas || ""}</textarea></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="mpv_save">${isEdit ? "Actualizar" : "Guardar proveedor"}</button>
      </div>
    </div>
  `);

  document.getElementById("mpv_save").addEventListener("click", async () => {
    const nombre = document.getElementById("mpv_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }
    const payload = {
      user_id: SESSION.user.id, nombre,
      nif:       document.getElementById("mpv_nif").value.trim(),
      email:     document.getElementById("mpv_email").value.trim(),
      telefono:  document.getElementById("mpv_tel").value.trim(),
      categoria: document.getElementById("mpv_cat").value,
      iban:      document.getElementById("mpv_iban").value.trim(),
      direccion: document.getElementById("mpv_dir").value.trim(),
      notas:     document.getElementById("mpv_notas").value.trim(),
      activo: true,
    };
    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("proveedores").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("proveedores").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Proveedor actualizado ✅" : "Proveedor creado ✅", "success");
    closeModal();
    await refreshProveedores();
  });
}

window._editProv = async (id) => {
  const p = PROVEEDORES.find(x => x.id === id);
  if (p) showNuevoProveedorModal(p);
};
window._delProv = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar proveedor</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este proveedor?</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dpvOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dpvOk").addEventListener("click", async () => {
    await supabase.from("proveedores").delete().eq("id", id);
    closeModal(); toast("Proveedor eliminado", "success");
    await refreshProveedores();
  });
};

/* ══════════════════════════
   GASTOS RECURRENTES
══════════════════════════ */
export async function refreshGastosRecurrentes() {
  const { data, error } = await supabase.from("gastos_recurrentes")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("refreshGastosRecurrentes:", error.message); return; }

  const tbody = document.getElementById("gastosRecBody");
  if (!tbody) return;

  const list = data || [];
  if (!list.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">Sin gastos recurrentes configurados.</td></tr>`;
    return;
  }

  const frecBadge = {
    mensual:   `<span class="badge b-ic">Mensual</span>`,
    trimestral:`<span class="badge b-pendiente">Trimestral</span>`,
    anual:     `<span class="badge b-draft">Anual</span>`,
    semanal:   `<span class="badge b-income">Semanal</span>`,
  };

  const hoy = new Date().toISOString().slice(0, 10);
  tbody.innerHTML = list.map(g => {
    const vencido = g.proxima_fecha && g.proxima_fecha <= hoy && g.activo;
    return `
      <tr>
        <td><strong style="font-size:13px">${g.nombre}</strong></td>
        <td style="font-size:12px">${PROVEEDORES.find(p => p.id === g.proveedor_id)?.nombre || g.proveedor_nombre || "—"}</td>
        <td class="mono fw7">${fmt(g.importe)}</td>
        <td>${frecBadge[g.frecuencia] || `<span class="badge b-draft">${g.frecuencia}</span>`}</td>
        <td class="${vencido ? "c-red fw7" : ""}">${g.proxima_fecha ? fmtDate(g.proxima_fecha) : "—"}</td>
        <td>${g.activo ? `<span class="badge b-cobrada">Activo</span>` : `<span class="badge" style="background:#f3f4f6;color:#6b7280">Pausado</span>`}</td>
        <td>
          <div class="tbl-act">
            ${g.activo ? `<button class="ta-btn ta-emit" onclick="window._registrarGastoRec('${g.id}')" title="Registrar ahora">⚡ Registrar</button>` : ""}
            <button class="ta-btn" onclick="window._editGastoRec('${g.id}')">✏️</button>
            <button class="ta-btn ta-del" onclick="window._delGastoRec('${g.id}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

export function showNuevoGastoRecModal(prefill = {}) {
  const isEdit = !!prefill.id;
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🔁 ${isEdit ? "Editar" : "Nuevo"} gasto recurrente</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre *</label><input id="mgr_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Ej: Suscripción Adobe, Alquiler oficina…"/></div>
          <div class="modal-field"><label>Proveedor</label>
            <select id="mgr_prov" class="ff-select">
              <option value="">— Sin proveedor —</option>
              ${PROVEEDORES.map(p => `<option value="${p.id}" ${prefill.proveedor_id === p.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="modal-grid3">
          <div class="modal-field"><label>Importe (€) *</label><input type="number" id="mgr_importe" class="ff-input" value="${prefill.importe || ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>IVA</label>
            <select id="mgr_iva" class="ff-select">
              <option value="21" ${(prefill.iva === 21 || !prefill.iva) ? "selected" : ""}>21%</option>
              <option value="10" ${prefill.iva === 10 ? "selected" : ""}>10%</option>
              <option value="4"  ${prefill.iva === 4  ? "selected" : ""}>4%</option>
              <option value="0"  ${prefill.iva === 0  ? "selected" : ""}>0%</option>
            </select>
          </div>
          <div class="modal-field"><label>Frecuencia</label>
            <select id="mgr_frec" class="ff-select">
              <option value="mensual"    ${(prefill.frecuencia || "mensual") === "mensual"    ? "selected" : ""}>Mensual</option>
              <option value="trimestral" ${prefill.frecuencia === "trimestral" ? "selected" : ""}>Trimestral</option>
              <option value="anual"      ${prefill.frecuencia === "anual"      ? "selected" : ""}>Anual</option>
              <option value="semanal"    ${prefill.frecuencia === "semanal"    ? "selected" : ""}>Semanal</option>
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Primera / próxima fecha</label><input type="date" id="mgr_fecha" class="ff-input" value="${prefill.proxima_fecha || new Date().toISOString().slice(0, 10)}"/></div>
          <div class="modal-field"><label>Categoría</label>
            <select id="mgr_cat" class="ff-select">
              ${["Software / SaaS","Alquiler","Suministros","Seguros","Nóminas","Marketing","Otros"].map(c =>
                `<option value="${c}" ${prefill.categoria === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="modal-field"><label>Notas</label><input id="mgr_notas" class="ff-input" value="${prefill.notas || ""}" placeholder="Referencia de contrato, detalles…"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="mgr_save">${isEdit ? "Actualizar" : "Guardar gasto recurrente"}</button>
      </div>
    </div>
  `);

  document.getElementById("mgr_save").addEventListener("click", async () => {
    const nombre  = document.getElementById("mgr_nombre").value.trim();
    const importe = parseFloat(document.getElementById("mgr_importe").value);
    if (!nombre || isNaN(importe)) { toast("Nombre e importe obligatorios", "error"); return; }
    const pId = document.getElementById("mgr_prov").value;
    const pNom = PROVEEDORES.find(p => p.id === pId)?.nombre || "";
    const payload = {
      user_id: SESSION.user.id, nombre, importe,
      iva:           parseInt(document.getElementById("mgr_iva").value),
      frecuencia:    document.getElementById("mgr_frec").value,
      proxima_fecha: document.getElementById("mgr_fecha").value,
      categoria:     document.getElementById("mgr_cat").value,
      notas:         document.getElementById("mgr_notas").value.trim(),
      proveedor_id:  pId || null,
      proveedor_nombre: pNom,
      activo: true,
    };
    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("gastos_recurrentes").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("gastos_recurrentes").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Gasto recurrente actualizado ✅" : "Gasto recurrente creado ✅", "success");
    closeModal();
    await refreshGastosRecurrentes();
  });
}

window._registrarGastoRec = async (id) => {
  const { data: g, error } = await supabase.from("gastos_recurrentes").select("*").eq("id", id).single();
  if (error || !g) return;

  // Crear factura recibida
  const { error: fe } = await supabase.from("facturas").insert({
    user_id:        SESSION.user.id,
    tipo:           "recibida",
    estado:         "emitida",
    fecha:          new Date().toISOString().slice(0, 10),
    concepto:       g.nombre,
    cliente_nombre: g.proveedor_nombre || "",
    cliente_id:     g.proveedor_id || null,
    base:           g.importe,
    iva:            g.iva || 21,
    tipo_operacion: "nacional",
    cobrada:        false,
  });
  if (fe) { toast("Error registrando gasto: " + fe.message, "error"); return; }

  // Calcular próxima fecha
  const proxFecha = new Date(g.proxima_fecha || new Date());
  if (g.frecuencia === "mensual")    proxFecha.setMonth(proxFecha.getMonth() + 1);
  if (g.frecuencia === "trimestral") proxFecha.setMonth(proxFecha.getMonth() + 3);
  if (g.frecuencia === "anual")      proxFecha.setFullYear(proxFecha.getFullYear() + 1);
  if (g.frecuencia === "semanal")    proxFecha.setDate(proxFecha.getDate() + 7);

  await supabase.from("gastos_recurrentes").update({
    proxima_fecha: proxFecha.toISOString().slice(0, 10)
  }).eq("id", id);

  toast(`✅ Gasto "${g.nombre}" registrado como factura`, "success");
  await refreshGastosRecurrentes();
};

window._editGastoRec = async (id) => {
  const { data, error } = await supabase.from("gastos_recurrentes").select("*").eq("id", id).single();
  if (data) showNuevoGastoRecModal(data);
};
window._delGastoRec = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar gasto recurrente</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este gasto recurrente? No afecta a las facturas ya registradas.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dgrOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dgrOk").addEventListener("click", async () => {
    await supabase.from("gastos_recurrentes").delete().eq("id", id);
    closeModal(); toast("Gasto recurrente eliminado", "success");
    await refreshGastosRecurrentes();
  });
};

export function initGastosView() {
  // Tabs dentro de la vista gastos
  document.querySelectorAll(".gastos-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gastos-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".gastos-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById(`gastosPanel_${btn.dataset.tab}`);
      if (panel) panel.classList.add("active");
    });
  });

  document.getElementById("nuevoProvBtn")?.addEventListener("click", () => showNuevoProveedorModal());
  document.getElementById("nuevoGastoRecBtn")?.addEventListener("click", () => showNuevoGastoRecModal());

  document.getElementById("provSearch")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderProveedoresTable(PROVEEDORES.filter(p =>
      (p.nombre || "").toLowerCase().includes(q) ||
      (p.nif || "").toLowerCase().includes(q)
    ));
  });
}
