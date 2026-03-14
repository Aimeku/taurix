/* ═══════════════════════════════════════════════════════
   TUGESTOR · clientes.js
   Módulo completo de gestión de clientes
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, CLIENTES, setClientes, toast, openModal, closeModal } from "./utils.js";

export async function loadClientes() {
  const { data, error } = await supabase.from("clientes")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadClientes:", error.message); return []; }
  return data || [];
}

export async function refreshClientes() {
  const lista = await loadClientes();
  setClientes(lista);
  renderClientesTable(lista);
  populateClienteSelect();
  const countEl = document.getElementById("clientesCount");
  if (countEl) countEl.textContent = `${lista.length} cliente${lista.length!==1?"s":""} registrados`;
}

export function renderClientesTable(list) {
  const tbody = document.getElementById("clientesBody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="9">Sin clientes. Añade tu primer cliente.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => `
    <tr>
      <td><strong>${c.nombre||"—"}</strong>${c.razon_social?`<br><span style="font-size:11px;color:var(--t3)">${c.razon_social}</span>`:""}</td>
      <td class="mono">${c.nif||"—"}</td>
      <td style="font-size:13px">${c.email||"—"}</td>
      <td style="font-size:13px">${c.telefono||"—"}</td>
      <td>${c.pais||"ES"}</td>
      <td><span class="badge ${c.tipo==="empresa"?"b-income":"b-ic"}">${c.tipo==="empresa"?"Empresa":"Particular"}</span></td>
      <td style="text-align:center">—</td>
      <td class="mono fw7">—</td>
      <td>
        <div class="tbl-act">
          <button class="ta-btn" onclick="window._editCliente('${c.id}')">✏️</button>
          <button class="ta-btn ta-del" onclick="window._delCliente('${c.id}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join("");
}

export function populateClienteSelect() {
  const sel = document.getElementById("nfClienteSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Nuevo cliente / Sin asignar —</option>`;
  CLIENTES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.nombre}${c.nif?" · "+c.nif:""}`;
    sel.appendChild(opt);
  });
}

export function showNuevoClienteModal(prefill = {}) {
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">👤 ${prefill.id?"Editar":"Nuevo"} cliente</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Los clientes se asocian automáticamente a las facturas para agilizar la facturación.</p>
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre *</label><input id="mc_nombre" value="${prefill.nombre||""}" placeholder="Nombre o razón social"/></div>
          <div class="modal-field"><label>Tipo</label>
            <select id="mc_tipo">
              <option value="empresa"    ${prefill.tipo==="empresa"?"selected":""}>Empresa / Autónomo</option>
              <option value="particular" ${prefill.tipo==="particular"?"selected":""}>Particular</option>
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>NIF / CIF / VAT</label><input id="mc_nif" value="${prefill.nif||""}" placeholder="Ej: B12345678"/></div>
          <div class="modal-field"><label>País</label>
            <select id="mc_pais">
              ${["ES:🇪🇸 España","DE:🇩🇪 Alemania","FR:🇫🇷 Francia","IT:🇮🇹 Italia","PT:🇵🇹 Portugal","US:🇺🇸 EE.UU.","GB:🇬🇧 Reino Unido","MX:🇲🇽 México","OTHER:🌍 Otro"]
                .map(x=>{const[v,l]=x.split(":");return `<option value="${v}" ${(prefill.pais||"ES")===v?"selected":""}>${l}</option>`;}).join("")}
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Email</label><input type="email" id="mc_email" value="${prefill.email||""}" placeholder="cliente@empresa.com"/></div>
          <div class="modal-field"><label>Teléfono</label><input id="mc_tel" value="${prefill.telefono||""}" placeholder="+34 600 000 000"/></div>
        </div>
        <div class="modal-field"><label>Dirección</label><input id="mc_dir" value="${prefill.direccion||""}" placeholder="Calle, número, ciudad, CP"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="mc_save">Guardar cliente</button>
      </div>
    </div>
  `);
  document.getElementById("mc_save").onclick = async () => {
    const nombre = document.getElementById("mc_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio","error"); return; }
    const payload = {
      user_id: SESSION.user.id,
      nombre, tipo: document.getElementById("mc_tipo").value,
      nif:      document.getElementById("mc_nif").value.trim(),
      pais:     document.getElementById("mc_pais").value,
      email:    document.getElementById("mc_email").value.trim(),
      telefono: document.getElementById("mc_tel").value.trim(),
      direccion:document.getElementById("mc_dir").value.trim(),
    };
    let err;
    if (prefill.id) {
      ({ error: err } = await supabase.from("clientes").update(payload).eq("id", prefill.id));
      if (err) { toast("Error actualizando: "+err.message,"error"); return; }
      toast("Cliente actualizado","success");
    } else {
      ({ error: err } = await supabase.from("clientes").insert(payload));
      if (err) { toast("Error creando: "+err.message,"error"); return; }
      toast("Cliente creado","success");
    }
    closeModal();
    await refreshClientes();
  };
}

window._editCliente = async id => {
  const c = CLIENTES.find(x=>x.id===id);
  if (c) showNuevoClienteModal(c);
};
window._delCliente = id => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar cliente</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p class="modal-warn">⚠️ ¿Eliminar este cliente? Las facturas asociadas no se eliminarán pero perderán la referencia de cliente.</p>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_delOk">Sí, eliminar</button>
      </div>
    </div>
  `);
  document.getElementById("_delOk").onclick = async () => {
    const { error } = await supabase.from("clientes").delete().eq("id",id);
    if (error) { toast("Error eliminando: "+error.message,"error"); closeModal(); return; }
    closeModal(); toast("Cliente eliminado","success");
    await refreshClientes();
  };
};

export function initClientesView() {
  document.getElementById("nuevoClienteBtn")?.addEventListener("click", () => showNuevoClienteModal());
  document.getElementById("clienteSearch")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderClientesTable(CLIENTES.filter(c =>
      (c.nombre||"").toLowerCase().includes(q) ||
      (c.nif||"").toLowerCase().includes(q) ||
      (c.email||"").toLowerCase().includes(q)
    ));
  });
}
