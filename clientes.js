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
          <button class="ta-btn" onclick="window._verCliente('${c.id}')" title="Ver historial">📊</button>
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
  const PAISES = [
    "ES:🇪🇸 España","DE:🇩🇪 Alemania","FR:🇫🇷 Francia","IT:🇮🇹 Italia",
    "PT:🇵🇹 Portugal","US:🇺🇸 EE.UU.","GB:🇬🇧 Reino Unido","MX:🇲🇽 México",
    "AR:🇦🇷 Argentina","CO:🇨🇴 Colombia","CL:🇨🇱 Chile","BR:🇧🇷 Brasil",
    "NL:🇳🇱 Países Bajos","BE:🇧🇪 Bélgica","CH:🇨🇭 Suiza","PL:🇵🇱 Polonia",
    "OTHER:🌍 Otro"
  ];
  const paisOpts = PAISES.map(x => {
    const [v, l] = x.split(":");
    return `<option value="${v}" ${(prefill.pais||"ES")===v?"selected":""}>${l}</option>`;
  }).join("");

  // Convertir arrays a string para el input
  const emailsVal    = Array.isArray(prefill.emails)    ? prefill.emails.join(", ")    : (prefill.emails    || prefill.email    || "");
  const telefonosVal = Array.isArray(prefill.telefonos) ? prefill.telefonos.join(", ") : (prefill.telefonos || prefill.telefono || "");

  const secLabel = (txt) =>
    `<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--t3);margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--brd)">${txt}</div>`;

  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">👤 ${prefill.id?"Editar":"Nuevo"} cliente</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        ${secLabel("Información básica")}
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre *</label>
            <input autocomplete="off" id="mc_nombre" value="${prefill.nombre||""}" placeholder="Nombre o razón social"/></div>
          <div class="modal-field"><label>Nombre comercial</label>
            <input autocomplete="off" id="mc_nombre_comercial" value="${prefill.nombre_comercial||""}" placeholder="Marca o nombre comercial"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Tipo de cliente</label>
            <select id="mc_tipo">
              <option value="empresa"    ${(prefill.tipo||"empresa")==="empresa"?"selected":""}>Empresa / Autónomo</option>
              <option value="particular" ${prefill.tipo==="particular"?"selected":""}>Particular</option>
            </select>
          </div>
          <div class="modal-field"><label>Tipo de empresa</label>
            <select id="mc_tipo_empresa">
              <option value=""          ${!prefill.tipo_empresa?"selected":""}>— Sin especificar —</option>
              <option value="sl"        ${prefill.tipo_empresa==="sl"?"selected":""}>S.L. — Sociedad Limitada</option>
              <option value="sa"        ${prefill.tipo_empresa==="sa"?"selected":""}>S.A. — Sociedad Anónima</option>
              <option value="autonomo"  ${prefill.tipo_empresa==="autonomo"?"selected":""}>Autónomo</option>
              <option value="cooperativa" ${prefill.tipo_empresa==="cooperativa"?"selected":""}>Cooperativa</option>
              <option value="asociacion" ${prefill.tipo_empresa==="asociacion"?"selected":""}>Asociación / ONG</option>
              <option value="otro"      ${prefill.tipo_empresa==="otro"?"selected":""}>Otro</option>
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Código de cliente</label>
            <input autocomplete="off" id="mc_codigo_cliente" value="${prefill.codigo_cliente||""}" placeholder="Ej: CLI-001"/></div>
          <div class="modal-field"><label>Cuenta contable</label>
            <input autocomplete="off" id="mc_cuenta_contable" value="${prefill.cuenta_contable||""}" placeholder="Ej: 430000001"/></div>
        </div>

        ${secLabel("Identificación fiscal")}
        <div class="modal-grid2">
          <div class="modal-field"><label>Tipo de identificador</label>
            <select id="mc_tipo_id_fiscal">
              <option value="DNI"      ${prefill.tipo_identificador_fiscal==="DNI"?"selected":""}>DNI</option>
              <option value="NIF"      ${(prefill.tipo_identificador_fiscal||"NIF")==="NIF"?"selected":""}>NIF</option>
              <option value="CIF"      ${prefill.tipo_identificador_fiscal==="CIF"?"selected":""}>CIF</option>
              <option value="NIE"      ${prefill.tipo_identificador_fiscal==="NIE"?"selected":""}>NIE</option>
              <option value="VAT"      ${prefill.tipo_identificador_fiscal==="VAT"?"selected":""}>VAT (UE)</option>
              <option value="PASSPORT" ${prefill.tipo_identificador_fiscal==="PASSPORT"?"selected":""}>Pasaporte</option>
            </select>
          </div>
          <div class="modal-field"><label>Número de identificador fiscal</label>
            <input autocomplete="off" id="mc_id_fiscal" value="${prefill.identificador_fiscal||prefill.nif||""}" placeholder="Ej: B12345678 / ES-B12345678"/></div>
        </div>
        <div class="modal-field" style="margin-top:-4px">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
            <span style="flex:1;font-size:12px;font-weight:700;color:var(--t2)">Permiso de acceso / consulta fiscal</span>
            <span style="position:relative;display:inline-block;width:40px;height:22px">
              <input type="checkbox" id="mc_permiso_acceso" ${prefill.permiso_acceso_consulta?"checked":""} style="opacity:0;width:0;height:0;position:absolute"/>
              <span id="mc_toggle_track" style="position:absolute;inset:0;border-radius:11px;background:${prefill.permiso_acceso_consulta?"var(--accent,#f97316)":"var(--brd)"};transition:background .2s;cursor:pointer" onclick="const cb=document.getElementById('mc_permiso_acceso');cb.checked=!cb.checked;this.style.background=cb.checked?'var(--accent,#f97316)':'var(--brd)'">
                <span style="position:absolute;top:3px;left:${prefill.permiso_acceso_consulta?"21":"3"}px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s" id="mc_toggle_knob"></span>
              </span>
            </span>
          </label>
        </div>

        ${secLabel("Dirección")}
        <div class="modal-field"><label>Dirección</label>
          <input autocomplete="off" id="mc_dir" value="${prefill.direccion||""}" placeholder="Calle Mayor, 15, 3º B"/></div>
        <div class="modal-grid2">
          <div class="modal-field"><label>País</label>
            <select id="mc_pais">${paisOpts}</select>
          </div>
          <div class="modal-field"><label>Provincia / Estado</label>
            <input autocomplete="off" id="mc_provincia" value="${prefill.provincia||""}" placeholder="Ej: Málaga"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Ciudad</label>
            <input autocomplete="off" id="mc_ciudad" value="${prefill.ciudad||""}" placeholder="Ej: Estepona"/></div>
          <div class="modal-field"><label>Código postal</label>
            <input autocomplete="off" id="mc_cp" value="${prefill.codigo_postal||""}" placeholder="Ej: 29680"/></div>
        </div>

        ${secLabel("Contacto")}
        <div class="modal-grid2">
          <div class="modal-field"><label>Emails <span style="font-weight:400;color:var(--t3)">(separados por coma)</span></label>
            <input autocomplete="off" type="text" id="mc_emails" value="${emailsVal}" placeholder="contacto@empresa.com, facturacion@empresa.com"/></div>
          <div class="modal-field"><label>Teléfonos <span style="font-weight:400;color:var(--t3)">(separados por coma)</span></label>
            <input autocomplete="off" id="mc_telefonos" value="${telefonosVal}" placeholder="+34 600 000 000, +34 910 000 000"/></div>
        </div>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="mc_save">Guardar cliente</button>
      </div>
    </div>
  `);

  // Sincronizar toggle visual al cargar
  const cb = document.getElementById("mc_permiso_acceso");
  const track = document.getElementById("mc_toggle_track");
  const knob  = document.getElementById("mc_toggle_knob");
  if (cb && track && knob) {
    const sync = () => {
      track.style.background = cb.checked ? "var(--accent,#f97316)" : "var(--brd)";
      knob.style.left = cb.checked ? "21px" : "3px";
    };
    cb.addEventListener("change", sync);
    sync();
  }

  document.getElementById("mc_save").onclick = async () => {
    const nombre = document.getElementById("mc_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }

    // Procesar arrays de emails y teléfonos
    const parseArr = (val) => val.split(",").map(s => s.trim()).filter(Boolean);
    const emailsArr    = parseArr(document.getElementById("mc_emails").value);
    const telefonosArr = parseArr(document.getElementById("mc_telefonos").value);

    const payload = {
      user_id:                   SESSION.user.id,
      nombre,
      nombre_comercial:          document.getElementById("mc_nombre_comercial").value.trim()    || null,
      tipo:                      document.getElementById("mc_tipo").value,
      tipo_empresa:              document.getElementById("mc_tipo_empresa").value               || null,
      codigo_cliente:            document.getElementById("mc_codigo_cliente").value.trim()      || null,
      cuenta_contable:           document.getElementById("mc_cuenta_contable").value.trim()     || null,
      tipo_identificador_fiscal: document.getElementById("mc_tipo_id_fiscal").value,
      identificador_fiscal:      document.getElementById("mc_id_fiscal").value.trim()           || null,
      nif:                       document.getElementById("mc_id_fiscal").value.trim()           || null,
      permiso_acceso_consulta:   document.getElementById("mc_permiso_acceso").checked,
      direccion:                 document.getElementById("mc_dir").value.trim()                 || null,
      pais:                      document.getElementById("mc_pais").value,
      provincia:                 document.getElementById("mc_provincia").value.trim()           || null,
      ciudad:                    document.getElementById("mc_ciudad").value.trim()               || null,
      codigo_postal:             document.getElementById("mc_cp").value.trim()                  || null,
      emails:                    emailsArr.length   ? emailsArr    : null,
      telefonos:                 telefonosArr.length ? telefonosArr : null,
      email:                     emailsArr[0]   || null,
      telefono:                  telefonosArr[0] || null,
    };

    let err;
    if (prefill.id) {
      ({ error: err } = await supabase.from("clientes").update(payload).eq("id", prefill.id));
      if (err) { toast("Error actualizando: " + err.message, "error"); return; }
      toast("Cliente actualizado", "success");
    } else {
      ({ error: err } = await supabase.from("clientes").insert(payload));
      if (err) { toast("Error creando: " + err.message, "error"); return; }
      toast("Cliente creado", "success");
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

window._verCliente = async (id) => {
  const c = CLIENTES.find(x => x.id === id);
  if (!c) return;

  // Cargar facturas del cliente
  const { data: facturas } = await supabase.from("facturas")
    .select("numero_factura, fecha, base, iva, estado, cobrada, concepto")
    .eq("user_id", SESSION.user.id).eq("cliente_id", id)
    .order("fecha", { ascending: false }).limit(20);

  const total = (facturas || []).reduce((a, f) => a + f.base + f.base*(f.iva||0)/100, 0);
  const cobrado = (facturas || []).filter(f=>f.cobrada).reduce((a, f) => a + f.base + f.base*(f.iva||0)/100, 0);
  const pendiente = total - cobrado;

  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">📊 ${c.nombre} — Historial</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px">
          <div style="background:var(--bg2);padding:12px;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700">Facturas</div>
            <div style="font-size:24px;font-weight:800">${(facturas||[]).length}</div>
          </div>
          <div style="background:var(--bg2);padding:12px;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700">Total facturado</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:var(--accent)">${fmt(total)}</div>
          </div>
          <div style="background:#f0fdf4;padding:12px;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700">Cobrado</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:#059669">${fmt(cobrado)}</div>
          </div>
          <div style="background:${pendiente > 0 ? "#fef2f2" : "var(--bg2)"};padding:12px;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700">Pendiente</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:${pendiente > 0 ? "#dc2626" : "var(--t3)"}">${fmt(pendiente)}</div>
          </div>
        </div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Datos del cliente</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:13px">
          <div><span style="color:var(--t3)">NIF:</span> <strong>${c.nif||"—"}</strong></div>
          <div><span style="color:var(--t3)">Email:</span> <strong>${c.email||"—"}</strong></div>
          <div><span style="color:var(--t3)">Teléfono:</span> <strong>${c.telefono||"—"}</strong></div>
          <div><span style="color:var(--t3)">País:</span> <strong>${c.pais||"ES"}</strong></div>
          <div style="grid-column:1/-1"><span style="color:var(--t3)">Dirección:</span> <strong>${c.direccion||"—"}</strong></div>
        </div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Últimas facturas</div>
        <table class="data-table">
          <thead><tr><th>Fecha</th><th>Nº Factura</th><th>Concepto</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody>
            ${(facturas||[]).map(f => `<tr>
              <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
              <td><span class="badge b-income mono" style="font-size:11px">${f.numero_factura||"Borrador"}</span></td>
              <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.concepto||"—"}</td>
              <td class="mono fw7">${fmt(f.base+f.base*(f.iva||0)/100)}</td>
              <td><span class="badge ${f.cobrada?"b-cobrada":"b-pendiente"}">${f.cobrada?"✅":"⏳"}</span></td>
            </tr>`).join("") || `<tr class="dt-empty"><td colspan="5">Sin facturas registradas</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <button class="btn-modal-save" onclick="window._cm();window._editCliente('${c.id}')">✏️ Editar cliente</button>
      </div>
    </div>`);
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
