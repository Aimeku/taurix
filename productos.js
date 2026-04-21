/* ═══════════════════════════════════════════════════════
   TAURIX · productos.js  — v3 estructura ERP estándar
   Columnas: id, nombre, sku, tipo (product/service/subscription),
   descripcion, precio_venta, precio_coste, iva, unidad,
   stock_actual, stock_minimo, codigo_barras, activo,
   created_at, updated_at
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, toast, openModal, closeModal } from "./utils.js";
import { isSedesActivo, getSedesCache } from "./sedes.js";

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
    service:      `<span class="badge b-income">Servicio</span>`,
    product:      `<span class="badge b-ic">Producto</span>`,
    subscription: `<span class="badge b-pendiente">Suscripción</span>`,
    // legacy values (backwards compat with old rows)
    servicio:    `<span class="badge b-income">Servicio</span>`,
    producto:    `<span class="badge b-ic">Producto</span>`,
    suscripcion: `<span class="badge b-pendiente">Suscripción</span>`,
  };
  tbody.innerHTML = list.map(p => {
    const margen = (p.precio_coste > 0 && p.precio_venta > 0)
      ? (((p.precio_venta - p.precio_coste) / p.precio_venta) * 100).toFixed(1) + "%"
      : "—";
    const esProducto = p.tipo === "product" || p.tipo === "producto";
    const stockBadge = !esProducto
      ? `<span style="color:var(--t4);font-size:11px">—</span>`
      : (p.stock_actual !== null && p.stock_actual !== undefined)
        ? (p.stock_actual <= (p.stock_minimo || 0)
            ? `<span class="badge b-vencida" title="Stock mínimo alcanzado">⚠️ ${p.stock_actual}</span>`
            : `<span class="badge b-cobrada">${p.stock_actual}</span>`)
        : `<span style="color:var(--t4);font-size:11px">—</span>`;
    return `<tr>
      <td>
        <strong style="font-size:13px">${p.nombre}</strong>
        ${p.sku ? `<br><span class="mono" style="font-size:11px;color:var(--t4)">${p.sku}</span>` : ""}
        ${p.codigo_barras ? `<br><span class="mono" style="font-size:10px;color:var(--t4)">🔖 ${p.codigo_barras}</span>` : ""}
      </td>
      <td style="font-size:12px;color:var(--t2);max-width:180px">${p.descripcion || "—"}</td>
      <td>${tipoBadge[p.tipo] || tipoBadge.service}</td>
      <td class="mono fw7">${fmt(p.precio_venta)}</td>
      <td class="mono" style="font-size:12px;color:var(--t3)">${p.precio_coste ? fmt(p.precio_coste) : "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${margen}</td>
      <td style="font-size:12px">${p.iva}%</td>
      <td class="mono">${fmt(p.precio_venta * (1 + p.iva / 100))}</td>
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
  // Normalize legacy tipo values
  const tipoNorm = { producto:"product", servicio:"service", suscripcion:"subscription" };
  const tipoInit = tipoNorm[prefill.tipo] || prefill.tipo || "product";
  const unidades = ["unidad","hora","día","mes","kg","litro","m²","m³","proyecto"];

  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">${isEdit ? "Editar" : "Nuevo"} producto / servicio</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre *</label>
            <input autocomplete="off" id="mpd_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Nombre del producto o servicio"/></div>
          <div class="modal-field"><label>SKU <span style="font-weight:400;color:var(--t4)">(código interno único)</span></label>
            <input autocomplete="off" id="mpd_sku" class="ff-input mono" value="${prefill.sku || ""}" placeholder="Ej: SRV-001"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Código de barras <span style="font-weight:400;color:var(--t4)">(EAN, ISBN…)</span></label>
            <div style="display:flex;gap:6px">
              <input autocomplete="off" id="mpd_barras" class="ff-input mono" value="${prefill.codigo_barras || ""}" placeholder="Ej: 8400000123456" style="flex:1"/>
              <button type="button" id="mpd_genBarras" class="btn-outline" style="white-space:nowrap;font-size:11px;padding:6px 10px" title="Generar código de barras EAN-13 automáticamente">
                🔖 Generar
              </button>
            </div>
            <div id="mpd_barrasPreview" style="display:none;margin-top:8px;text-align:center;padding:12px;background:#fff;border:1px solid var(--brd);border-radius:8px"></div>
          </div>
          <div class="modal-field"><label>Tipo</label>
            <select id="mpd_tipo" class="ff-select">
              <option value="product"      ${tipoInit === "product"      ? "selected" : ""}>Producto físico</option>
              <option value="service"      ${tipoInit === "service"      ? "selected" : ""}>🔧 Servicio</option>
              <option value="subscription" ${tipoInit === "subscription" ? "selected" : ""}>Suscripción</option>
            </select>
          </div>
        </div>
        <div class="modal-field"><label>Descripción</label>
          <textarea autocomplete="off" id="mpd_desc" class="ff-input ff-textarea" style="min-height:60px"
            placeholder="Descripción que aparecerá en las líneas del documento">${prefill.descripcion || ""}</textarea>
        </div>

        <!-- Precios separados -->
        <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Precios</div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Precio de venta (€) * <span style="font-weight:400;color:var(--t4)">sin IVA</span></label>
            <input autocomplete="off" type="number" id="mpd_precio" class="ff-input" value="${prefill.precio_venta ?? ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>Precio de coste (€) <span style="font-weight:400;color:var(--t4)">sin IVA</span></label>
            <input autocomplete="off" type="number" id="mpd_coste" class="ff-input" value="${prefill.precio_coste || ""}" step="0.01" placeholder="0.00"/></div>
        </div>

        <!-- Impuestos separados -->
        <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">🏛️ Impuestos</div>
        <div class="modal-grid2">
          <div class="modal-field"><label>IVA aplicable</label>
            <select id="mpd_iva" class="ff-select">
              <option value="21" ${(prefill.iva === 21 || prefill.iva === undefined) ? "selected" : ""}>21% — General</option>
              <option value="10" ${prefill.iva === 10 ? "selected" : ""}>10% — Reducido</option>
              <option value="4"  ${prefill.iva === 4  ? "selected" : ""}>4% — Superreducido</option>
              <option value="0"  ${prefill.iva === 0  ? "selected" : ""}>0% — Exento</option>
            </select>
          </div>
          <div class="modal-field"><label>Recargo de equivalencia</label>
            <select id="mpd_recargo" class="ff-select">
              <option value="0" ${(!prefill.recargo_equivalencia || prefill.recargo_equivalencia === 0) ? "selected" : ""}>Sin recargo</option>
              <option value="5.2" ${prefill.recargo_equivalencia === 5.2 ? "selected" : ""}>5,2% (IVA 21%)</option>
              <option value="1.4" ${prefill.recargo_equivalencia === 1.4 ? "selected" : ""}>1,4% (IVA 10%)</option>
              <option value="0.5" ${prefill.recargo_equivalencia === 0.5 ? "selected" : ""}>0,5% (IVA 4%)</option>
            </select>
          </div>
        </div>

        <div id="mpd_stockSection" style="${tipoInit === "product" ? "" : "display:none"}">
          <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">Control de stock</div>
          <div class="modal-grid3">
            <div class="modal-field"><label>Stock actual</label>
              <input autocomplete="off" type="number" id="mpd_stock" class="ff-input" value="${prefill.stock_actual ?? ""}" step="1" min="0" placeholder="0"/></div>
            <div class="modal-field"><label>Stock mínimo <span style="font-weight:400;color:var(--t4)">(alerta)</span></label>
              <input autocomplete="off" type="number" id="mpd_stockMin" class="ff-input" value="${prefill.stock_minimo ?? ""}" step="1" min="0" placeholder="0"/></div>
            <div class="modal-field"><label>Unidad</label>
              <select id="mpd_unidad" class="ff-select">
                ${unidades.map(u => `<option value="${u}" ${prefill.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>

        <div id="mpd_unidadRow" style="${tipoInit === "product" ? "display:none" : ""}">
          <div class="modal-grid2" style="margin-top:8px">
            <div class="modal-field"><label>Unidad de medida</label>
              <select id="mpd_unidadSrv" class="ff-select">
                ${unidades.map(u => `<option value="${u}" ${prefill.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </div>
            <div></div>
          </div>
        </div>

        <!-- Activo: visible para todos los tipos -->
        <div style="margin-top:12px">
          <label style="flex-direction:row;align-items:center;gap:6px;cursor:pointer;display:flex">
            <input autocomplete="off" type="checkbox" id="mpd_activo" ${prefill.activo !== false ? "checked" : ""}/>
            <span style="font-size:13px;font-weight:500">Activo <span style="font-weight:400;color:var(--t4)">(desmarcar para ocultar sin eliminar)</span></span>
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

  // ═══════════════════════════════════════════════════════════════════
  // PANEL STOCK POR SEDE (solo si sedes activo + es producto + edición)
  // Inyectado post-render para no romper el modal base.
  // ═══════════════════════════════════════════════════════════════════
  if (isEdit && isSedesActivo() && prefill.tipo === "product") {
    const stockSection = document.getElementById("mpd_stockSection");
    if (stockSection) {
      _inyectarPanelStockSedes(stockSection, prefill.id);
    }
  }

  document.getElementById("mpd_tipo")?.addEventListener("change", e => {
    const isP = e.target.value === "product";
    document.getElementById("mpd_stockSection").style.display = isP ? "" : "none";
    document.getElementById("mpd_unidadRow").style.display    = isP ? "none" : "";
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

  // ── Generar código de barras EAN-13 ──
  document.getElementById("mpd_genBarras")?.addEventListener("click", async () => {
    const { generarEAN13, renderBarcodeSVG } = await import("./barcode-utils.js");
    const code = generarEAN13();
    const input = document.getElementById("mpd_barras");
    if (input) input.value = code;
    const previewEl = document.getElementById("mpd_barrasPreview");
    if (previewEl) {
      previewEl.style.display = "";
      previewEl.innerHTML = renderBarcodeSVG(code, { width: 220, height: 70 });
    }
  });

  // Si ya tiene código de barras EAN-13, mostrar preview visual
  if (prefill.codigo_barras && prefill.codigo_barras.length === 13) {
    setTimeout(async () => {
      try {
        const { renderBarcodeSVG } = await import("./barcode-utils.js");
        const previewEl = document.getElementById("mpd_barrasPreview");
        if (previewEl) {
          previewEl.style.display = "";
          previewEl.innerHTML = renderBarcodeSVG(prefill.codigo_barras, { width: 220, height: 70 });
        }
      } catch(e) { /* barcode-utils not available yet */ }
    }, 150);
  }

  document.getElementById("mpd_save").addEventListener("click", async () => {
    const nombre      = document.getElementById("mpd_nombre").value.trim();
    const precio_venta = parseFloat(document.getElementById("mpd_precio").value);
    if (!nombre || isNaN(precio_venta)) { toast("Nombre y precio son obligatorios", "error"); return; }

    const tipo       = document.getElementById("mpd_tipo").value;
    const isProducto = tipo === "product";
    const activo     = document.getElementById("mpd_activo")?.checked ?? true;
    const unidad     = isProducto ? (document.getElementById("mpd_unidad")?.value || "unidad") : (document.getElementById("mpd_unidadSrv")?.value || "unidad");
    const costeVal   = parseFloat(document.getElementById("mpd_coste")?.value);
    const stockVal   = parseInt(document.getElementById("mpd_stock")?.value);
    const stockMin   = parseInt(document.getElementById("mpd_stockMin")?.value);

    const payload = {
      user_id:       SESSION.user.id,
      nombre,
      sku:           document.getElementById("mpd_sku").value.trim()     || null,
      codigo_barras: document.getElementById("mpd_barras").value.trim()  || null,
      descripcion:   document.getElementById("mpd_desc").value.trim()    || null,
      tipo,
      precio_venta,
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
  document.getElementById("importarProdBtn")?.addEventListener("click", () => showImportarProductosModal());
  document.getElementById("prodSearch")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    renderProductosTable(PRODUCTOS.filter(p =>
      (p.nombre        || "").toLowerCase().includes(q) ||
      (p.sku           || "").toLowerCase().includes(q) ||
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
  // Limpiar lo que envía el lector: quitar espacios, saltos de línea,
  // caracteres de control que algunos lectores añaden tras el código
  const q = codigo.trim().replace(/[\r\n\t]/g,"").toLowerCase();
  if (!q) return null;

  // Búsqueda exacta primero (código de barras o SKU)
  const exacto = PRODUCTOS.find(p =>
    p.activo !== false && (
      (p.codigo_barras || "").trim().toLowerCase() === q ||
      (p.sku           || "").trim().toLowerCase() === q
    )
  );
  if (exacto) return exacto;

  // Búsqueda parcial como fallback (por si el lector lee solo parte del código)
  return PRODUCTOS.find(p =>
    p.activo !== false && (
      (p.codigo_barras || "").toLowerCase().includes(q) ||
      (p.sku           || "").toLowerCase().includes(q)
    )
  ) || null;
}

/* ══════════════════════════════════════════════════════
   IMPORTACIÓN MASIVA DE PRODUCTOS DESDE EXCEL / CSV
   ══════════════════════════════════════════════════════ */

export function showImportarProductosModal() {
  openModal(`
    <div class="modal" style="max-width:720px">
      <div class="modal-hd">
        <span class="modal-title">📥 Importar productos desde Excel / CSV</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Paso 1: Descargar plantilla -->
        <div style="background:var(--bg2);border-radius:12px;padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:14px">
          <div style="font-size:28px">📋</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;margin-bottom:3px">Paso 1 — Descarga la plantilla Excel</div>
            <div style="font-size:12px;color:var(--t3)">Rellena tus productos en la plantilla y vuelve a subirla. Las columnas marcadas con * son obligatorias.</div>
          </div>
          <button class="btn-outline" id="descPlantillaBtn" style="white-space:nowrap;font-size:12px">
            Descargar plantilla
          </button>
        </div>

        <!-- Paso 2: Subir archivo -->
        <div style="margin-bottom:16px">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px">Paso 2 — Sube tu archivo</div>
          <div id="importDropzone"
               style="border:2px dashed var(--brd);border-radius:12px;padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s"
               ondragover="event.preventDefault();this.style.borderColor='var(--accent)';this.style.background='rgba(26,86,219,.03)'"
               ondragleave="this.style.borderColor='';this.style.background=''"
               ondrop="window._importDrop(event)"
               onclick="document.getElementById('importFileInput').click()">
            <div style="font-size:32px;margin-bottom:8px">📂</div>
            <div style="font-size:13px;font-weight:600">Arrastra el Excel o CSV aquí</div>
            <div style="font-size:12px;color:var(--t3);margin-top:4px">o haz click para seleccionar</div>
            <div id="importFileName" style="margin-top:8px;font-size:12px;color:var(--accent);font-weight:600"></div>
          </div>
          <input autocomplete="off" type="file" id="importFileInput" accept=".xlsx,.xls,.csv" style="display:none"/>
        </div>

        <!-- Paso 3: Preview -->
        <div id="importPreviewWrap" style="display:none">
          <div style="font-size:13px;font-weight:700;margin-bottom:10px">
            Paso 3 — Revisa antes de importar
          </div>

          <!-- Resumen -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
            <div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#059669" id="importCountOk">0</div>
              <div style="font-size:11px;color:#166534;font-weight:600">Listos para importar</div>
            </div>
            <div style="background:#fef9c3;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#d97706" id="importCountWarn">0</div>
              <div style="font-size:11px;color:#92400e;font-weight:600">Con advertencias</div>
            </div>
            <div style="background:#fef2f2;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#dc2626" id="importCountErr">0</div>
              <div style="font-size:11px;color:#991b1b;font-weight:600">Con errores (se omitirán)</div>
            </div>
          </div>

          <!-- Tabla preview -->
          <div style="max-height:300px;overflow-y:auto;border:1px solid var(--brd);border-radius:10px">
            <table class="data-table" style="font-size:11px">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Referencia</th>
                  <th>Cód. barras</th>
                  <th>Tipo</th>
                  <th>Precio</th>
                  <th>Coste</th>
                  <th>IVA</th>
                  <th>Stock</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody id="importPreviewBody"></tbody>
            </table>
          </div>

          <!-- Opciones -->
          <div style="margin-top:14px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input autocomplete="off" type="checkbox" id="importActualizar" style="width:14px;height:14px"/>
              <span>Actualizar productos existentes si coincide la referencia o código de barras</span>
            </label>
          </div>
        </div>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="importarBtn" disabled style="min-width:160px">
          📥 Importar productos
        </button>
      </div>
    </div>
  `);

  // ── Descargar plantilla ──
  document.getElementById("descPlantillaBtn").addEventListener("click", () => {
    descargarPlantillaExcel();
  });

  // ── Drag & drop / click ──
  let parsedRows = [];

  window._importDrop = (e) => {
    e.preventDefault();
    const zone = document.getElementById("importDropzone");
    if (zone) { zone.style.borderColor=""; zone.style.background=""; }
    const file = e.dataTransfer.files[0];
    if (file) procesarArchivoImport(file);
  };

  document.getElementById("importFileInput").addEventListener("change", e => {
    if (e.target.files[0]) procesarArchivoImport(e.target.files[0]);
  });

  async function procesarArchivoImport(file) {
    // Nombre del archivo
    const fnEl = document.getElementById("importFileName");
    if (fnEl) fnEl.textContent = file.name;

    // Cargar SheetJS si no está
    if (!window.XLSX) {
      toast("Cargando librería de Excel…","info");
      await new Promise((res,rej)=>{
        const s=document.createElement("script");
        s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data   = new Uint8Array(ev.target.result);
        const wb     = window.XLSX.read(data, { type:"array" });
        const ws     = wb.Sheets[wb.SheetNames[0]];
        const raw    = window.XLSX.utils.sheet_to_json(ws, { defval:"" });

        parsedRows = validarFilas(raw);
        mostrarPreview(parsedRows);

        const btn = document.getElementById("importarBtn");
        const okCount = parsedRows.filter(r=>r._estado!=="error").length;
        if (btn) btn.disabled = okCount === 0;
      } catch(e) {
        toast("Error leyendo el archivo: " + e.message, "error");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ── Importar ──
  document.getElementById("importarBtn").addEventListener("click", async () => {
    const actualizar = document.getElementById("importActualizar")?.checked;
    await ejecutarImportacion(parsedRows, actualizar);
  });
}

/* ── Validar filas del Excel ── */
function validarFilas(raw) {
  const TIPOS_VALIDOS = ["service","product","subscription","servicio","producto","suscripcion"];
  const IVAS_VALIDOS  = [0, 4, 10, 21];

  return raw.map((row, i) => {
    const errores  = [];
    const avisos   = [];

    // Normalizar nombres de columna (insensible a mayúsculas/espacios)
    const get = (...keys) => {
      for (const k of keys) {
        const found = Object.keys(row).find(rk =>
          rk.toLowerCase().replace(/[\s_*]/g,"") === k.toLowerCase().replace(/[\s_*]/g,"")
        );
        if (found !== undefined && row[found] !== "") return String(row[found]).trim();
      }
      return "";
    };

    const nombre       = get("nombre","name","producto","product");
    // Acepta tanto "sku" como "referencia" para compatibilidad con imports legacy
    const sku          = get("sku","referencia","ref","codigo","code");
    const codigoBarras = get("codigobarras","codigo_barras","barras","ean","isbn","barcode");
    const tipoRaw      = get("tipo","type").toLowerCase() || "service";
    // Acepta tanto "precio_venta" como "precio" / "pvp"
    const precioRaw    = get("precioventa","precio_venta","precio","price","pvp");
    const costeRaw     = get("preciocoste","precio_coste","coste","costo","cost");
    const ivaRaw       = get("iva","vat","impuesto").replace("%","") || "21";
    const stockRaw     = get("stock","stockactual","stock_actual");
    const stockMinRaw  = get("stockminimo","stock_minimo","stockmin","minimo");
    const descripcion  = get("descripcion","description","desc");
    const unidad       = get("unidad","unit") || "unidad";

    // Validaciones obligatorias
    if (!nombre) errores.push("Nombre vacío");

    const precio_venta = parseFloat(precioRaw.replace(",","."));
    if (isNaN(precio_venta) || precio_venta < 0) errores.push(`Precio inválido: "${precioRaw}"`);

    // Tipo — normalizar a valores ERP estándar
    const tipoMap = {
      servicio:"service", service:"service",
      producto:"product", product:"product",
      suscripcion:"subscription", subscription:"subscription",
    };
    const tipo = tipoMap[tipoRaw] || "service";
    if (!TIPOS_VALIDOS.includes(tipoRaw) && tipoRaw) {
      avisos.push(`Tipo "${tipoRaw}" no reconocido → se usará "service"`);
    }

    // IVA
    const iva = parseInt(ivaRaw);
    if (!IVAS_VALIDOS.includes(iva)) {
      avisos.push(`IVA ${iva}% no estándar → se usará 21%`);
    }

    // Coste
    const coste = costeRaw ? parseFloat(costeRaw.replace(",",".")) : null;
    if (costeRaw && isNaN(coste)) avisos.push(`Precio de coste inválido: "${costeRaw}" (se ignorará)`);

    // Stock
    const stock    = stockRaw    ? parseInt(stockRaw)    : null;
    const stockMin = stockMinRaw ? parseInt(stockMinRaw) : null;

    // Código de barras — avisar si parece muy corto
    if (codigoBarras && codigoBarras.length < 8) {
      avisos.push(`Código de barras muy corto (${codigoBarras.length} dígitos)`);
    }

    const _estado = errores.length > 0 ? "error" : avisos.length > 0 ? "warn" : "ok";

    return {
      _fila: i + 2, // +2 porque fila 1 es cabecera en Excel
      _estado,
      _errores: errores,
      _avisos:  avisos,
      nombre,
      sku:           sku          || null,
      codigo_barras: codigoBarras || null,
      tipo,
      precio_venta:  isNaN(precio_venta) ? 0 : precio_venta,
      precio_coste:  (!isNaN(coste) && coste > 0) ? coste : null,
      iva:           IVAS_VALIDOS.includes(iva) ? iva : 21,
      stock_actual:  tipo==="product" && stock!==null && !isNaN(stock) ? stock : null,
      stock_minimo:  tipo==="product" && stockMin!==null && !isNaN(stockMin) ? stockMin : null,
      descripcion:   descripcion || null,
      unidad:        unidad || "unidad",
    };
  });
}

/* ── Mostrar preview ── */
function mostrarPreview(rows) {
  const wrap = document.getElementById("importPreviewWrap");
  if (wrap) wrap.style.display = "";

  const countOk   = rows.filter(r=>r._estado==="ok").length;
  const countWarn = rows.filter(r=>r._estado==="warn").length;
  const countErr  = rows.filter(r=>r._estado==="error").length;

  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  s("importCountOk",   countOk);
  s("importCountWarn", countWarn);
  s("importCountErr",  countErr);

  const tbody = document.getElementById("importPreviewBody");
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const bgColor = r._estado==="error" ? "#fef2f2" : r._estado==="warn" ? "#fef9c3" : "";
    const icon    = r._estado==="error" ? "❌" : r._estado==="warn" ? "⚠️" : "✅";
    const msgs    = [...(r._errores||[]), ...(r._avisos||[])].join(" · ");
    return `<tr style="background:${bgColor}">
      <td style="color:var(--t4)">${r._fila}</td>
      <td style="font-weight:600">${r.nombre || "—"}</td>
      <td class="mono" style="font-size:10px">${r.sku || "—"}</td>
      <td class="mono" style="font-size:10px">${r.codigo_barras || "—"}</td>
      <td>${r.tipo}</td>
      <td class="mono">${fmt(r.precio_venta)}</td>
      <td class="mono" style="color:var(--t3)">${r.precio_coste ? fmt(r.precio_coste) : "—"}</td>
      <td>${r.iva}%</td>
      <td>${r.stock_actual !== null ? r.stock_actual : "—"}</td>
      <td title="${msgs}">${icon} ${msgs ? `<span style="font-size:10px;color:var(--t3)">${msgs.substring(0,40)}${msgs.length>40?"…":""}</span>` : "OK"}</td>
    </tr>`;
  }).join("");
}

/* ── Ejecutar importación ── */
async function ejecutarImportacion(rows, actualizar) {
  const btn = document.getElementById("importarBtn");
  if (btn) { btn.disabled=true; btn.textContent="Importando…"; }

  const validos = rows.filter(r => r._estado !== "error");
  let importados=0, actualizados=0, errores=0;

  for (const r of validos) {
    const payload = {
      user_id:       SESSION.user.id,
      nombre:        r.nombre,
      sku:           r.sku,
      codigo_barras: r.codigo_barras,
      descripcion:   r.descripcion,
      tipo:          r.tipo,
      precio_venta:  r.precio_venta,
      precio_coste:  r.precio_coste,
      iva:           r.iva,
      unidad:        r.unidad,
      stock_actual:  r.stock_actual,
      stock_minimo:  r.stock_minimo,
      activo:        true,
    };

    if (actualizar && (r.sku || r.codigo_barras)) {
      // Buscar si ya existe por SKU o código de barras
      const existente = PRODUCTOS.find(p =>
        (r.sku           && p.sku           === r.sku) ||
        (r.codigo_barras && p.codigo_barras === r.codigo_barras)
      );
      if (existente) {
        const { error } = await supabase.from("productos").update(payload).eq("id", existente.id);
        if (error) errores++;
        else actualizados++;
        continue;
      }
    }

    const { error } = await supabase.from("productos").insert(payload);
    if (error) errores++;
    else importados++;
  }

  closeModal();
  toast(
    `✅ Importación completada: ${importados} nuevos · ${actualizados} actualizados${errores>0?" · "+errores+" errores":""}`,
    "success", 6000
  );
  await refreshProductos();
}

/* ── Descargar plantilla Excel ── */
function descargarPlantillaExcel() {
  if (!window.XLSX) {
    // Cargar XLSX y reintentar
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => descargarPlantillaExcel();
    document.head.appendChild(s);
    return;
  }

  const plantilla = [
    {
      "nombre *":         "Camiseta básica blanca",
      "sku":              "CAM-BL-M",
      "codigo_barras":    "8400000123456",
      "tipo":             "product",
      "precio_venta *":   19.95,
      "precio_coste":     8.50,
      "iva":              21,
      "unidad":           "unidad",
      "stock_actual":     50,
      "stock_minimo":     10,
      "descripcion":      "Camiseta de algodón 100%",
    },
    {
      "nombre *":         "Consultoría por hora",
      "sku":              "CONS-H",
      "codigo_barras":    "",
      "tipo":             "service",
      "precio_venta *":   75.00,
      "precio_coste":     "",
      "iva":              21,
      "unidad":           "hora",
      "stock_actual":     "",
      "stock_minimo":     "",
      "descripcion":      "Servicio de consultoría profesional",
    },
    {
      "nombre *":         "Suscripción mensual",
      "sku":              "SUB-MES",
      "codigo_barras":    "",
      "tipo":             "subscription",
      "precio_venta *":   29.00,
      "precio_coste":     "",
      "iva":              21,
      "unidad":           "mes",
      "stock_actual":     "",
      "stock_minimo":     "",
      "descripcion":      "Plan mensual de acceso",
    },
  ];

  const ws = window.XLSX.utils.json_to_sheet(plantilla);

  // Ancho de columnas
  ws["!cols"] = [
    {wch:30},{wch:15},{wch:18},{wch:14},{wch:14},{wch:14},{wch:8},
    {wch:10},{wch:14},{wch:14},{wch:30},
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Productos");

  // Hoja de instrucciones
  const instrucciones = [
    { "INSTRUCCIONES": "═══════════════════════════════════════════════════════" },
    { "INSTRUCCIONES": "ESTRUCTURA ERP ESTÁNDAR — TAURIX CATÁLOGO v3" },
    { "INSTRUCCIONES": "═══════════════════════════════════════════════════════" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "COLUMNAS OBLIGATORIAS (marcadas con *):" },
    { "INSTRUCCIONES": "  • nombre *        → Nombre del producto o servicio" },
    { "INSTRUCCIONES": "  • precio_venta *  → Precio de venta sin IVA (ej: 19.95)" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "COLUMNAS OPCIONALES:" },
    { "INSTRUCCIONES": "  • sku             → Código interno único (ej: CAM-BL-M)" },
    { "INSTRUCCIONES": "  • codigo_barras   → EAN-13, EAN-8, ISBN, etc." },
    { "INSTRUCCIONES": "  • tipo            → product / service / subscription" },
    { "INSTRUCCIONES": "  • precio_coste    → Precio de compra (para margen)" },
    { "INSTRUCCIONES": "  • iva             → 0 / 4 / 10 / 21  (por defecto: 21)" },
    { "INSTRUCCIONES": "  • unidad          → unidad / hora / día / mes / kg / litro / m²" },
    { "INSTRUCCIONES": "  • stock_actual    → Unidades en stock (solo tipo product)" },
    { "INSTRUCCIONES": "  • stock_minimo    → Alerta de reposición (solo tipo product)" },
    { "INSTRUCCIONES": "  • descripcion     → Texto en la línea del documento" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "VALORES VÁLIDOS PARA «tipo»:" },
    { "INSTRUCCIONES": "  product      → Producto físico (con control de stock)" },
    { "INSTRUCCIONES": "  service      → Servicio (sin stock)" },
    { "INSTRUCCIONES": "  subscription → Suscripción periódica (sin stock)" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "COMPATIBILIDAD: también se aceptan los valores legacy" },
    { "INSTRUCCIONES": "  producto / servicio / suscripcion (se convierten automáticamente)" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "NOTAS:" },
    { "INSTRUCCIONES": "  • Borra las filas de ejemplo antes de importar" },
    { "INSTRUCCIONES": "  • Los nombres de columna no distinguen mayúsculas" },
    { "INSTRUCCIONES": "  • Puedes usar coma o punto como separador decimal" },
    { "INSTRUCCIONES": "  • Las filas con errores se omiten automáticamente" },
    { "INSTRUCCIONES": "  • Si importas con 'referencia' en lugar de 'sku', se acepta igual" },
    { "INSTRUCCIONES": "  • Si importas con 'precio' en lugar de 'precio_venta', se acepta igual" },
  ];
  const ws2 = window.XLSX.utils.json_to_sheet(instrucciones);
  ws2["!cols"] = [{wch:65}];
  window.XLSX.utils.book_append_sheet(wb, ws2, "Instrucciones");

  window.XLSX.writeFile(wb, "plantilla_productos_taurix.xlsx");
  toast("Plantilla descargada ✅ — rellénala y súbela aquí", "success", 4000);
}

/* ═══════════════════════════════════════════════════════════════════
   STOCK MULTI-SEDE · UI en ficha del producto
═══════════════════════════════════════════════════════════════════ */

/**
 * Inyecta el panel de stock por sede al final de la sección
 * "Control de stock" del modal de producto. Carga el detalle
 * asíncronamente y muestra una mini-tabla con total + desglose.
 */
async function _inyectarPanelStockSedes(stockSection, productoId) {
  const sedes = getSedesCache();
  if (sedes.length === 0) return;

  // Placeholder mientras carga
  const wrap = document.createElement("div");
  wrap.id = "mpd_stockSedesPanel";
  wrap.style.cssText = "margin-top:14px;padding:12px 14px;background:var(--bg2);border:1px solid var(--brd);border-radius:10px";
  wrap.innerHTML = `<div style="font-size:12.5px;color:var(--t3)">Cargando stock por sede…</div>`;
  stockSection.appendChild(wrap);

  try {
    const { getStockDetallePorProducto } = await import("./stock-sedes.js");
    const detalle = await getStockDetallePorProducto(productoId);
    // Mapa sedeId → {cantidad, stock_minimo, ubicacion}
    const detalleBySede = {};
    (detalle || []).forEach(d => { detalleBySede[d.sede_id] = d; });

    const filas = sedes.map(s => {
      const d = detalleBySede[s.id];
      const cantidad = d?.cantidad ?? 0;
      const bajo = d?.stock_minimo && cantidad <= Number(d.stock_minimo);
      return `
        <tr>
          <td style="padding:7px 8px;font-weight:600;font-family:monospace;font-size:12px">
            ${_esc(s.codigo)}${s.es_principal ? ` <span style="color:#92400e;font-size:10px">★</span>` : ""}
          </td>
          <td style="padding:7px 8px;font-size:12.5px;color:var(--t2)">${_esc(s.nombre)}</td>
          <td style="padding:7px 8px;font-size:11.5px;color:var(--t4)">${_esc(d?.ubicacion || "—")}</td>
          <td style="padding:7px 8px;text-align:right;font-weight:700;font-family:monospace;font-size:13px;${bajo ? "color:#b91c1c" : ""}">${Number(cantidad)}</td>
        </tr>`;
    }).join("");

    const total = (detalle || []).reduce((a, r) => a + Number(r.cantidad || 0), 0);

    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px;flex-wrap:wrap">
        <div style="font-size:12.5px;font-weight:700;color:var(--t2)">
          Stock por sede
          <span style="margin-left:8px;font-weight:400;color:var(--t4);font-size:11.5px">
            Total: <strong style="color:var(--t2)">${total}</strong>
          </span>
        </div>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-outline" id="mpd_stockEditBtn"
                  style="font-size:11.5px;padding:5px 12px">Editar</button>
          ${sedes.length >= 2
            ? `<button type="button" class="btn-outline" id="mpd_traspasoBtn"
                       style="font-size:11.5px;padding:5px 12px">Traspasar</button>`
            : ""}
          <button type="button" class="btn-outline" id="mpd_histBtn"
                  style="font-size:11.5px;padding:5px 12px">Historial</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="border-bottom:1px solid var(--brd)">
              <th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Sede</th>
              <th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Nombre</th>
              <th style="text-align:left;padding:6px 8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Ubicación</th>
              <th style="text-align:right;padding:6px 8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Stock</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <p style="margin:8px 0 0;font-size:10.5px;color:var(--t4);line-height:1.4">
        El campo "Stock actual" arriba muestra la suma total. Para ajustar cantidades por sede,
        usa el botón <strong>Editar</strong>. Para mover stock entre sedes, usa <strong>Traspasar</strong>.
      </p>
    `;

    // Listeners
    document.getElementById("mpd_stockEditBtn")?.addEventListener("click", () => {
      _abrirModalEditarStockSedes(productoId, prefill_nombre_para_modal(productoId));
    });
    document.getElementById("mpd_traspasoBtn")?.addEventListener("click", () => {
      _abrirModalTraspasoStock(productoId, prefill_nombre_para_modal(productoId));
    });
    document.getElementById("mpd_histBtn")?.addEventListener("click", () => {
      _abrirModalHistorialStock(productoId, prefill_nombre_para_modal(productoId));
    });
  } catch (e) {
    console.error("[stock-sedes panel]", e);
    wrap.innerHTML = `<div style="font-size:12px;color:#b91c1c">Error cargando stock por sede: ${_esc(e.message || "desconocido")}</div>`;
  }
}

function prefill_nombre_para_modal(productoId) {
  return PRODUCTOS.find(p => p.id === productoId)?.nombre || "producto";
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL · Editar stock por sede
═══════════════════════════════════════════════════════════════════ */
async function _abrirModalEditarStockSedes(productoId, nombreProducto) {
  const sedes = getSedesCache();
  if (sedes.length === 0) return;

  const { getStockDetallePorProducto, ajustarStockSede } = await import("./stock-sedes.js");
  const detalle = await getStockDetallePorProducto(productoId);
  const byId = {};
  (detalle || []).forEach(d => { byId[d.sede_id] = d; });

  const filas = sedes.map(s => {
    const d = byId[s.id] || {};
    return `
      <tr data-sede="${s.id}">
        <td style="padding:10px 8px;vertical-align:middle">
          <div style="font-weight:700;font-family:monospace;font-size:13px;line-height:1.2">${_esc(s.codigo)}</div>
          <div style="font-weight:400;font-size:11px;color:var(--t4);line-height:1.3;margin-top:2px">${_esc(s.nombre)}</div>
        </td>
        <td style="padding:10px 8px;vertical-align:middle">
          <input type="number" class="ff-input _sedeStockInput" data-sede="${s.id}"
                 value="${d.cantidad ?? 0}" step="0.001"
                 style="width:100%;font-family:monospace;text-align:right;box-sizing:border-box"/>
        </td>
        <td style="padding:10px 8px;vertical-align:middle">
          <input type="number" class="ff-input _sedeStockMin" data-sede="${s.id}"
                 value="${d.stock_minimo ?? ""}" step="0.001" placeholder="—"
                 style="width:100%;font-family:monospace;text-align:right;box-sizing:border-box"/>
        </td>
        <td style="padding:10px 8px;vertical-align:middle">
          <input type="text" class="ff-input _sedeUbic" data-sede="${s.id}"
                 value="${_esc(d.ubicacion || "")}" placeholder="Estante A-3"
                 style="width:100%;font-size:12.5px;box-sizing:border-box"/>
        </td>
      </tr>`;
  }).join("");

  openModal(`
    <div class="modal" style="max-width:720px">
      <div class="modal-hd">
        <span class="modal-title">Stock por sede · ${_esc(nombreProducto)}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="margin:0 0 14px;font-size:12.5px;color:var(--t3);line-height:1.5">
          Ajusta el stock actual en cada sede. Se registrará un movimiento de tipo
          <strong>ajuste</strong> por cada cambio para mantener trazabilidad.
        </p>

        <div class="modal-field" style="margin:0 0 16px">
          <label>Motivo del ajuste <span style="font-weight:400;color:var(--t4)">(opcional)</span></label>
          <input id="_sedeStockMotivo" class="ff-input" placeholder="Ej: Inventario físico trimestral"/>
        </div>

        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;table-layout:fixed">
            <colgroup>
              <col style="width:30%"/>
              <col style="width:22%"/>
              <col style="width:18%"/>
              <col style="width:30%"/>
            </colgroup>
            <thead>
              <tr style="border-bottom:1px solid var(--brd)">
                <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:11px;text-transform:uppercase;letter-spacing:.04em">Sede</th>
                <th style="text-align:right;padding:8px;font-weight:700;color:var(--t3);font-size:11px;text-transform:uppercase;letter-spacing:.04em">Cantidad</th>
                <th style="text-align:right;padding:8px;font-weight:700;color:var(--t3);font-size:11px;text-transform:uppercase;letter-spacing:.04em">Mínimo</th>
                <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:11px;text-transform:uppercase;letter-spacing:.04em">Ubicación</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_sedeStockGuardar">Guardar cambios</button>
      </div>
    </div>
  `);

  document.getElementById("_sedeStockGuardar").addEventListener("click", async () => {
    const btn = document.getElementById("_sedeStockGuardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    const motivo = document.getElementById("_sedeStockMotivo").value.trim() || null;

    try {
      const inputs = document.querySelectorAll("._sedeStockInput");
      let cambios = 0;
      for (const inp of inputs) {
        const sedeId = inp.dataset.sede;
        const nuevaCant = Number(inp.value);
        if (isNaN(nuevaCant) || nuevaCant < 0) continue;

        const actualFila = byId[sedeId];
        const cantidadAnterior = Number(actualFila?.cantidad ?? 0);

        // Solo aplicamos el ajuste si el valor cambia O si hay
        // cambios en stock_minimo / ubicacion
        const minInput  = document.querySelector(`._sedeStockMin[data-sede="${sedeId}"]`);
        const ubicInput = document.querySelector(`._sedeUbic[data-sede="${sedeId}"]`);
        const nuevoMin  = minInput.value === "" ? null : Number(minInput.value);
        const nuevaUbic = ubicInput.value.trim() || null;

        const cantidadCambio = nuevaCant !== cantidadAnterior;
        const minCambio      = (nuevoMin ?? null)  !== (actualFila?.stock_minimo ?? null);
        const ubicCambio     = (nuevaUbic ?? null) !== (actualFila?.ubicacion   ?? null);

        if (cantidadCambio) {
          await ajustarStockSede(productoId, sedeId, nuevaCant, motivo);
          cambios++;
        }
        if ((minCambio || ubicCambio) && !cantidadCambio) {
          // Solo actualizar metadatos sin crear movimiento
          await supabase.from("stock_sedes").upsert(
            {
              user_id: SESSION.user.id,
              producto_id: productoId,
              sede_id: sedeId,
              cantidad: nuevaCant,
              stock_minimo: nuevoMin,
              ubicacion: nuevaUbic
            },
            { onConflict: "producto_id,sede_id" }
          );
          cambios++;
        } else if (minCambio || ubicCambio) {
          // Si también cambió cantidad, ya se hizo upsert arriba pero sin
          // min/ubic. Actualizamos ahora esos campos.
          await supabase.from("stock_sedes").update({
            stock_minimo: nuevoMin,
            ubicacion: nuevaUbic
          }).eq("producto_id", productoId).eq("sede_id", sedeId)
            .eq("user_id", SESSION.user.id);
        }
      }

      closeModal();
      toast(cambios > 0 ? `Stock actualizado en ${cambios} sede${cambios !== 1 ? "s" : ""}` : "Sin cambios", "success");
      await refreshProductos();
      // Re-abrir el modal del producto para ver el stock actualizado
      const prod = PRODUCTOS.find(p => p.id === productoId);
      if (prod) showNuevoProductoModal(prod);
    } catch (e) {
      console.error("[editarStockSedes]", e);
      toast("Error al guardar: " + (e.message || "desconocido"), "error");
      btn.disabled = false; btn.textContent = "Guardar cambios";
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL · Traspasar stock entre sedes
═══════════════════════════════════════════════════════════════════ */
async function _abrirModalTraspasoStock(productoId, nombreProducto) {
  const sedes = getSedesCache();
  if (sedes.length < 2) {
    toast("Necesitas al menos 2 sedes para hacer un traspaso", "warn");
    return;
  }

  const { getStockDetallePorProducto, traspasarStock } = await import("./stock-sedes.js");
  const detalle = await getStockDetallePorProducto(productoId);
  const byId = {};
  (detalle || []).forEach(d => { byId[d.sede_id] = d; });

  const opciones = (exclude) => sedes
    .filter(s => s.id !== exclude)
    .map(s => `<option value="${s.id}">${_esc(s.codigo)} · ${_esc(s.nombre)} (stock: ${byId[s.id]?.cantidad ?? 0})</option>`)
    .join("");

  openModal(`
    <div class="modal" style="max-width:540px">
      <div class="modal-hd">
        <span class="modal-title">Traspasar stock · ${_esc(nombreProducto)}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="margin:0 0 16px;font-size:12.5px;color:var(--t3);line-height:1.5">
          Mueve unidades de una sede a otra. Se registrará un movimiento tipo
          <strong>traspaso</strong> en el historial. Fiscalmente no tiene impacto:
          el producto sigue siendo tuyo.
        </p>

        <div class="modal-grid2">
          <div class="modal-field">
            <label>Sede origen *</label>
            <select id="_trOrigen" class="ff-select">
              ${sedes.map(s => `<option value="${s.id}">${_esc(s.codigo)} · ${_esc(s.nombre)} (stock: ${byId[s.id]?.cantidad ?? 0})</option>`).join("")}
            </select>
          </div>
          <div class="modal-field">
            <label>Sede destino *</label>
            <select id="_trDestino" class="ff-select">
              ${opciones(sedes[0].id)}
            </select>
          </div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field">
            <label>Cantidad a traspasar *</label>
            <input type="number" id="_trCantidad" class="ff-input" step="0.001" min="0.001" placeholder="0"/>
            <span id="_trDisponible" style="font-size:11px;color:var(--t4);margin-top:4px;display:block"></span>
          </div>
          <div class="modal-field">
            <label>Motivo <span style="font-weight:400;color:var(--t4)">(opcional)</span></label>
            <input type="text" id="_trMotivo" class="ff-input" placeholder="Reposición, traslado..."/>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_trOk">Traspasar</button>
      </div>
    </div>
  `);

  const elOrigen   = document.getElementById("_trOrigen");
  const elDestino  = document.getElementById("_trDestino");
  const elDispon   = document.getElementById("_trDisponible");

  const updateDisponible = () => {
    const origenId = elOrigen.value;
    const disp = byId[origenId]?.cantidad ?? 0;
    elDispon.textContent = `Disponible en origen: ${disp}`;
  };
  const actualizarOpcionesDestino = () => {
    const origenId = elOrigen.value;
    elDestino.innerHTML = opciones(origenId);
  };
  elOrigen.addEventListener("change", () => {
    actualizarOpcionesDestino();
    updateDisponible();
  });
  updateDisponible();

  document.getElementById("_trOk").addEventListener("click", async () => {
    const origen  = elOrigen.value;
    const destino = elDestino.value;
    const cantidad = Number(document.getElementById("_trCantidad").value);
    const motivo   = document.getElementById("_trMotivo").value.trim() || null;

    if (!origen || !destino) { toast("Selecciona origen y destino", "error"); return; }
    if (origen === destino)  { toast("Origen y destino deben ser distintos", "error"); return; }
    if (isNaN(cantidad) || cantidad <= 0) { toast("Cantidad inválida", "error"); return; }

    const btn = document.getElementById("_trOk");
    btn.disabled = true; btn.textContent = "Traspasando…";

    try {
      await traspasarStock(productoId, origen, destino, cantidad, motivo);
      closeModal();
      toast("Traspaso registrado ✅", "success");
      await refreshProductos();
      // Volver a abrir el modal del producto
      const prod = PRODUCTOS.find(p => p.id === productoId);
      if (prod) showNuevoProductoModal(prod);
    } catch (e) {
      console.error("[traspaso]", e);
      toast("Error: " + (e.message || "desconocido"), "error");
      btn.disabled = false; btn.textContent = "Traspasar";
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   MODAL · Historial de movimientos de stock
═══════════════════════════════════════════════════════════════════ */
async function _abrirModalHistorialStock(productoId, nombreProducto) {
  const { getMovimientosProducto } = await import("./stock-sedes.js");
  const sedes = getSedesCache();
  const sedeMap = {};
  sedes.forEach(s => { sedeMap[s.id] = s; });

  openModal(`
    <div class="modal" style="max-width:820px">
      <div class="modal-hd">
        <span class="modal-title">Historial de stock · ${_esc(nombreProducto)}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div id="_histContent" style="font-size:12.5px;color:var(--t3)">Cargando movimientos…</div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
      </div>
    </div>
  `);

  try {
    const movs = await getMovimientosProducto(productoId, 100);
    const cont = document.getElementById("_histContent");
    if (!cont) return;

    if (movs.length === 0) {
      cont.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--t4)">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 10px;opacity:.5">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <div style="font-size:13px">Sin movimientos registrados todavía.</div>
          <div style="font-size:11.5px;margin-top:6px;line-height:1.5">
            Cada vez que vendas, ajustes o traspases este producto<br>se registrará aquí para trazabilidad.
          </div>
        </div>`;
      return;
    }

    // Colores por tipo de movimiento
    const colores = {
      entrada:  { bg: "#dcfce7", color: "#166534", label: "Entrada"  },
      compra:   { bg: "#dcfce7", color: "#166534", label: "Compra"   },
      salida:   { bg: "#fee2e2", color: "#991b1b", label: "Salida"   },
      venta:    { bg: "#fef3c7", color: "#92400e", label: "Venta"    },
      traspaso: { bg: "#e0f2fe", color: "#075985", label: "Traspaso" },
      ajuste:   { bg: "#f3e8ff", color: "#6b21a8", label: "Ajuste"   },
    };

    const filas = movs.map(m => {
      const c = colores[m.tipo] || { bg: "#f3f4f6", color: "#374151", label: m.tipo };
      const origen = m.sede_origen ? (sedeMap[m.sede_origen]?.codigo || "¿?") : "";
      const destino = m.sede_destino ? (sedeMap[m.sede_destino]?.codigo || "¿?") : "";

      // Representación del movimiento entre sedes
      let flecha = "";
      if (m.tipo === "traspaso" && origen && destino) {
        flecha = `<span style="font-family:monospace">${_esc(origen)} → ${_esc(destino)}</span>`;
      } else if (origen) {
        flecha = `<span style="font-family:monospace">${_esc(origen)}</span>`;
      } else if (destino) {
        flecha = `<span style="font-family:monospace">→ ${_esc(destino)}</span>`;
      } else {
        flecha = `<span style="color:var(--t4)">—</span>`;
      }

      const fecha = m.fecha ? new Date(m.fecha) : null;
      const fechaStr = fecha
        ? `${String(fecha.getDate()).padStart(2,"0")}/${String(fecha.getMonth()+1).padStart(2,"0")}/${fecha.getFullYear()} ${String(fecha.getHours()).padStart(2,"0")}:${String(fecha.getMinutes()).padStart(2,"0")}`
        : "—";

      const docRef = m.documento_ref
        ? `<span style="font-size:10.5px;color:var(--t4);display:block;margin-top:2px">${_esc(m.documento_tipo || "doc")}: <code style="font-size:10px">${String(m.documento_ref).slice(0, 8)}…</code></span>`
        : "";

      return `
        <tr>
          <td style="padding:9px 8px;font-family:monospace;font-size:11.5px;color:var(--t3);white-space:nowrap">${fechaStr}</td>
          <td style="padding:9px 8px">
            <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${c.bg};color:${c.color};font-size:11px;font-weight:700">
              ${c.label}
            </span>
          </td>
          <td style="padding:9px 8px;font-size:12px">${flecha}</td>
          <td style="padding:9px 8px;text-align:right;font-family:monospace;font-weight:700;font-size:13px">${Number(m.cantidad)}</td>
          <td style="padding:9px 8px;font-size:11.5px;color:var(--t3)">${_esc(m.motivo || "")}${docRef}</td>
        </tr>`;
    }).join("");

    cont.innerHTML = `
      <p style="margin:0 0 12px;font-size:12px;color:var(--t3);line-height:1.5">
        Últimos ${movs.length} movimientos. Los movimientos son <strong>inmutables</strong>:
        si te equivocas, crea un ajuste contrario en lugar de editar uno existente.
      </p>
      <div style="overflow-x:auto;max-height:500px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--brd);position:sticky;top:0;background:var(--srf);z-index:1">
              <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Fecha</th>
              <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Tipo</th>
              <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Sede</th>
              <th style="text-align:right;padding:8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Cantidad</th>
              <th style="text-align:left;padding:8px;font-weight:700;color:var(--t3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">Motivo / Referencia</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  } catch (e) {
    console.error("[historialStock]", e);
    const cont = document.getElementById("_histContent");
    if (cont) cont.innerHTML = `<div style="color:#b91c1c">Error al cargar historial: ${_esc(e.message || "desconocido")}</div>`;
  }
}

/* ── Escape HTML helper (privado) ─────────────────────────────────── */
function _esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
