/* ═══════════════════════════════════════════════════════
   TUGESTOR · productos.js  — v2 con stock, coste, barras
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";

export let PRODUCTOS = [];
export function setProductos(p) { PRODUCTOS = p; }

export async function loadProductos() {
  const { data, error } = await supabase.from("productos")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadProductos:", error.message); return []; }
  return data || [];
}

export async function refreshProductos() {
  const lista = await loadProductos();
  setProductos(lista);
  renderProductosTable(lista);
  const countEl = document.getElementById("prodCount");
  if (countEl) countEl.textContent = `${lista.length} producto${lista.length !== 1 ? "s" : ""} en catálogo`;
}

export function renderProductosTable(list) {
  const tbody = document.getElementById("prodBody");
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="11">Sin productos. Crea tu catálogo para agilizar la facturación.</td></tr>`;
    return;
  }
  const tipoBadge = {
    servicio:    `<span class="badge b-income">Servicio</span>`,
    producto:    `<span class="badge b-ic">Producto</span>`,
    suscripcion: `<span class="badge b-pendiente">Suscripción</span>`,
  };
  tbody.innerHTML = list.map(p => {
    const margen = (p.precio_coste > 0 && p.precio > 0)
      ? (((p.precio - p.precio_coste) / p.precio) * 100).toFixed(1) + "%"
      : "—";
    const stockBadge = p.tipo === "servicio"
      ? `<span style="color:var(--t4);font-size:11px">—</span>`
      : (p.stock_actual !== null && p.stock_actual !== undefined)
        ? (p.stock_actual <= (p.stock_minimo || 0)
            ? `<span class="badge b-vencida" title="Stock mínimo alcanzado">⚠️ ${p.stock_actual}</span>`
            : `<span class="badge b-cobrada">${p.stock_actual}</span>`)
        : `<span style="color:var(--t4);font-size:11px">—</span>`;
    return `<tr>
      <td>
        <strong style="font-size:13px">${p.nombre}</strong>
        ${p.referencia ? `<br><span class="mono" style="font-size:11px;color:var(--t4)">${p.referencia}</span>` : ""}
        ${p.codigo_barras ? `<br><span class="mono" style="font-size:10px;color:var(--t4)">🔖 ${p.codigo_barras}</span>` : ""}
      </td>
      <td style="font-size:12px;color:var(--t2);max-width:180px">${p.descripcion || "—"}</td>
      <td>${tipoBadge[p.tipo] || tipoBadge.servicio}</td>
      <td class="mono fw7">${fmt(p.precio)}</td>
      <td class="mono" style="font-size:12px;color:var(--t3)">${p.precio_coste ? fmt(p.precio_coste) : "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${margen}</td>
      <td style="font-size:12px">${p.iva}%</td>
      <td class="mono">${fmt(p.precio * (1 + p.iva / 100))}</td>
      <td>${stockBadge}</td>
      <td>${p.activo !== false ? `<span class="badge b-cobrada">Activo</span>` : `<span class="badge" style="background:#f3f4f6;color:#6b7280">Inactivo</span>`}</td>
      <td><div class="tbl-act">
        <button class="ta-btn" onclick="window._editProd('${p.id}')">✏️</button>
        <button class="ta-btn ta-del" onclick="window._delProd('${p.id}')">🗑️</button>
      </div></td>
    </tr>`;
  }).join("");
}

export function showNuevoProductoModal(prefill = {}) {
  const isEdit   = !!prefill.id;
  const tipoInit = prefill.tipo || "servicio";
  const unidades = ["unidad","hora","día","mes","kg","litro","m²","m³","proyecto"];

  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">📦 ${isEdit ? "Editar" : "Nuevo"} producto / servicio</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre *</label>
            <input id="mpd_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Nombre del producto o servicio"/></div>
          <div class="modal-field"><label>Referencia / SKU</label>
            <input id="mpd_ref" class="ff-input" value="${prefill.referencia || ""}" placeholder="Ej: SRV-001"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Código de barras <span style="font-weight:400;color:var(--t4)">(EAN, ISBN…)</span></label>
            <input id="mpd_barras" class="ff-input mono" value="${prefill.codigo_barras || ""}" placeholder="Ej: 8400000123456"/></div>
          <div class="modal-field"><label>Tipo</label>
            <select id="mpd_tipo" class="ff-select">
              <option value="servicio"    ${tipoInit === "servicio"    ? "selected" : ""}>Servicio</option>
              <option value="producto"    ${tipoInit === "producto"    ? "selected" : ""}>Producto físico</option>
              <option value="suscripcion" ${tipoInit === "suscripcion" ? "selected" : ""}>Suscripción</option>
            </select>
          </div>
        </div>
        <div class="modal-field"><label>Descripción</label>
          <textarea id="mpd_desc" class="ff-input ff-textarea" style="min-height:60px"
            placeholder="Descripción que aparecerá en las líneas del documento">${prefill.descripcion || ""}</textarea>
        </div>
        <div class="modal-grid3">
          <div class="modal-field"><label>Precio de venta (€) *</label>
            <input type="number" id="mpd_precio" class="ff-input" value="${prefill.precio || ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>Precio de coste (€)</label>
            <input type="number" id="mpd_coste" class="ff-input" value="${prefill.precio_coste || ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>IVA</label>
            <select id="mpd_iva" class="ff-select">
              <option value="21" ${(prefill.iva === 21 || prefill.iva === undefined) ? "selected" : ""}>21%</option>
              <option value="10" ${prefill.iva === 10 ? "selected" : ""}>10%</option>
              <option value="4"  ${prefill.iva === 4  ? "selected" : ""}>4%</option>
              <option value="0"  ${prefill.iva === 0  ? "selected" : ""}>0%</option>
            </select>
          </div>
        </div>

        <div id="mpd_stockSection" style="${tipoInit === "producto" ? "" : "display:none"}">
          <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">📦 Control de stock</div>
          <div class="modal-grid3">
            <div class="modal-field"><label>Stock actual</label>
              <input type="number" id="mpd_stock" class="ff-input" value="${prefill.stock_actual ?? ""}" step="1" min="0" placeholder="0"/></div>
            <div class="modal-field"><label>Stock mínimo <span style="font-weight:400;color:var(--t4)">(alerta)</span></label>
              <input type="number" id="mpd_stockMin" class="ff-input" value="${prefill.stock_minimo ?? ""}" step="1" min="0" placeholder="0"/></div>
            <div class="modal-field"><label>Unidad</label>
              <select id="mpd_unidad" class="ff-select">
                ${unidades.map(u => `<option value="${u}" ${prefill.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>

        <div id="mpd_unidadRow" style="${tipoInit === "producto" ? "display:none" : ""}">
          <div class="modal-grid2" style="margin-top:8px">
            <div class="modal-field"><label>Unidad de medida</label>
              <select id="mpd_unidadSrv" class="ff-select">
                ${unidades.map(u => `<option value="${u}" ${prefill.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </div>
            <div class="modal-field" style="justify-content:flex-end;padding-top:18px">
              <label style="flex-direction:row;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" id="mpd_activo" ${prefill.activo !== false ? "checked" : ""}/>
                <span style="font-size:13px;font-weight:500">Producto activo</span>
              </label>
            </div>
          </div>
        </div>
        <div id="mpd_activoStock" style="${tipoInit === "producto" ? "" : "display:none"};margin-top:10px">
          <label style="flex-direction:row;align-items:center;gap:6px;cursor:pointer;display:flex">
            <input type="checkbox" id="mpd_activo2" ${prefill.activo !== false ? "checked" : ""}/>
            <span style="font-size:13px;font-weight:500">Producto activo</span>
          </label>
        </div>

        <div style="background:var(--bg2);border-radius:10px;padding:12px 16px;margin-top:12px;display:flex;gap:24px;font-size:13px;flex-wrap:wrap;align-items:center">
          <span>Base: <strong id="mpd_pvBase">—</strong></span>
          <span>IVA: <strong id="mpd_pvIva">—</strong></span>
          <span>Total: <strong id="mpd_pvTotal">—</strong></span>
          <span id="mpd_pvMargen" style="margin-left:auto;font-weight:600;font-size:12px"></span>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="mpd_save">${isEdit ? "Actualizar" : "Guardar producto"}</button>
      </div>
    </div>
  `);

  document.getElementById("mpd_tipo")?.addEventListener("change", e => {
    const isP = e.target.value === "producto";
    document.getElementById("mpd_stockSection").style.display = isP ? "" : "none";
    document.getElementById("mpd_unidadRow").style.display    = isP ? "none" : "";
    document.getElementById("mpd_activoStock").style.display  = isP ? "" : "none";
  });

  const updatePreview = () => {
    const precio = parseFloat(document.getElementById("mpd_precio")?.value) || 0;
    const coste  = parseFloat(document.getElementById("mpd_coste")?.value)  || 0;
    const iva    = parseInt(document.getElementById("mpd_iva")?.value)       || 0;
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s("mpd_pvBase",  fmt(precio));
    s("mpd_pvIva",   fmt(precio * iva / 100));
    s("mpd_pvTotal", fmt(precio * (1 + iva / 100)));
    const mEl = document.getElementById("mpd_pvMargen");
    if (mEl) {
      if (coste > 0 && precio > 0) {
        const m = ((precio - coste) / precio * 100).toFixed(1);
        mEl.textContent = `Margen: ${m}%`;
        mEl.style.color = parseFloat(m) >= 30 ? "var(--green,#059669)" : parseFloat(m) >= 0 ? "var(--t3)" : "var(--red,#dc2626)";
      } else { mEl.textContent = ""; }
    }
  };
  document.getElementById("mpd_precio")?.addEventListener("input", updatePreview);
  document.getElementById("mpd_coste")?.addEventListener("input",  updatePreview);
  document.getElementById("mpd_iva")?.addEventListener("change",   updatePreview);
  updatePreview();

  document.getElementById("mpd_save").addEventListener("click", async () => {
    const nombre = document.getElementById("mpd_nombre").value.trim();
    const precio = parseFloat(document.getElementById("mpd_precio").value);
    if (!nombre || isNaN(precio)) { toast("Nombre y precio son obligatorios", "error"); return; }

    const tipo       = document.getElementById("mpd_tipo").value;
    const isProducto = tipo === "producto";
    const activo     = isProducto ? document.getElementById("mpd_activo2").checked : document.getElementById("mpd_activo").checked;
    const unidad     = isProducto ? (document.getElementById("mpd_unidad")?.value || "unidad") : (document.getElementById("mpd_unidadSrv")?.value || "unidad");
    const costeVal   = parseFloat(document.getElementById("mpd_coste")?.value);
    const stockVal   = parseInt(document.getElementById("mpd_stock")?.value);
    const stockMin   = parseInt(document.getElementById("mpd_stockMin")?.value);

    const payload = {
      user_id:       SESSION.user.id,
      nombre,
      referencia:    document.getElementById("mpd_ref").value.trim()    || null,
      codigo_barras: document.getElementById("mpd_barras").value.trim() || null,
      descripcion:   document.getElementById("mpd_desc").value.trim()   || null,
      tipo, precio,
      precio_coste:  !isNaN(costeVal) && costeVal > 0 ? costeVal : null,
      iva:           parseInt(document.getElementById("mpd_iva").value),
      unidad,
      stock_actual:  isProducto && !isNaN(stockVal) ? stockVal : null,
      stock_minimo:  isProducto && !isNaN(stockMin) ? stockMin : null,
      activo,
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("productos").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("productos").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Producto actualizado ✅" : "Producto creado ✅", "success");
    closeModal();
    await refreshProductos();
  });
}

window._editProd = async (id) => {
  const p = PRODUCTOS.find(x => x.id === id);
  if (p) showNuevoProductoModal(p);
};
window._delProd = (id) => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar producto</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este producto del catálogo?</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpdOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpdOk").addEventListener("click", async () => {
    await supabase.from("productos").delete().eq("id", id);
    closeModal(); toast("Producto eliminado", "success");
    await refreshProductos();
  });
};

export function initProductosView() {
  document.getElementById("nuevoProdBtn")?.addEventListener("click", () => showNuevoProductoModal());
  document.getElementById("prodSearch")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderProductosTable(PRODUCTOS.filter(p =>
      (p.nombre        || "").toLowerCase().includes(q) ||
      (p.referencia    || "").toLowerCase().includes(q) ||
      (p.codigo_barras || "").toLowerCase().includes(q) ||
      (p.descripcion   || "").toLowerCase().includes(q)
    ));
  });
  document.getElementById("prodFilterTipo")?.addEventListener("change", e => {
    const v = e.target.value;
    renderProductosTable(v ? PRODUCTOS.filter(p => p.tipo === v) : PRODUCTOS);
  });
}

export function buscarProductoPorCodigo(codigo) {
  if (!codigo) return null;
  const q = codigo.trim().toLowerCase();
  return PRODUCTOS.find(p =>
    (p.referencia    || "").toLowerCase() === q ||
    (p.codigo_barras || "").toLowerCase() === q
  ) || null;
}
