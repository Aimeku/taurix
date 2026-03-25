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
            <input autocomplete="off" id="mpd_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Nombre del producto o servicio"/></div>
          <div class="modal-field"><label>Referencia / SKU</label>
            <input autocomplete="off" id="mpd_ref" class="ff-input" value="${prefill.referencia || ""}" placeholder="Ej: SRV-001"/></div>
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
              <option value="producto"    ${tipoInit === "producto"    ? "selected" : ""}>📦 Producto físico</option>
              <option value="servicio"    ${tipoInit === "servicio"    ? "selected" : ""}>🔧 Servicio</option>
              <option value="suscripcion" ${tipoInit === "suscripcion" ? "selected" : ""}>🔄 Suscripción</option>
            </select>
          </div>
        </div>
        <div class="modal-field"><label>Descripción</label>
          <textarea autocomplete="off" id="mpd_desc" class="ff-input ff-textarea" style="min-height:60px"
            placeholder="Descripción que aparecerá en las líneas del documento">${prefill.descripcion || ""}</textarea>
        </div>

        <!-- Precios separados -->
        <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">💰 Precios</div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Precio de venta (€) * <span style="font-weight:400;color:var(--t4)">sin IVA</span></label>
            <input autocomplete="off" type="number" id="mpd_precio" class="ff-input" value="${prefill.precio || ""}" step="0.01" placeholder="0.00"/></div>
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

        <div id="mpd_stockSection" style="${tipoInit === "producto" ? "" : "display:none"}">
          <div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px">📦 Control de stock</div>
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

        <div id="mpd_unidadRow" style="${tipoInit === "producto" ? "display:none" : ""}">
          <div class="modal-grid2" style="margin-top:8px">
            <div class="modal-field"><label>Unidad de medida</label>
              <select id="mpd_unidadSrv" class="ff-select">
                ${unidades.map(u => `<option value="${u}" ${prefill.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </div>
            <div></div>
          </div>
        </div>

        <!-- Activo: solo visible para producto físico -->
        <div id="mpd_activoWrap" style="${tipoInit === "producto" ? "" : "display:none"};margin-top:10px">
          <label style="flex-direction:row;align-items:center;gap:6px;cursor:pointer;display:flex">
            <input autocomplete="off" type="checkbox" id="mpd_activo" ${prefill.activo !== false ? "checked" : ""}/>
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
    document.getElementById("mpd_activoWrap").style.display   = isP ? "" : "none";
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
    const nombre = document.getElementById("mpd_nombre").value.trim();
    const precio = parseFloat(document.getElementById("mpd_precio").value);
    if (!nombre || isNaN(precio)) { toast("Nombre y precio son obligatorios", "error"); return; }

    const tipo       = document.getElementById("mpd_tipo").value;
    const isProducto = tipo === "producto";
    const activo     = isProducto ? (document.getElementById("mpd_activo")?.checked ?? true) : true;
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
  document.getElementById("importarProdBtn")?.addEventListener("click", () => showImportarProductosModal());
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
  // Limpiar lo que envía el lector: quitar espacios, saltos de línea,
  // caracteres de control que algunos lectores añaden tras el código
  const q = codigo.trim().replace(/[\r\n\t]/g,"").toLowerCase();
  if (!q) return null;

  // Búsqueda exacta primero (código de barras o referencia)
  const exacto = PRODUCTOS.find(p =>
    p.activo !== false && (
      (p.codigo_barras || "").trim().toLowerCase() === q ||
      (p.referencia    || "").trim().toLowerCase() === q
    )
  );
  if (exacto) return exacto;

  // Búsqueda parcial como fallback (por si el lector lee solo parte del código)
  return PRODUCTOS.find(p =>
    p.activo !== false && (
      (p.codigo_barras || "").toLowerCase().includes(q) ||
      (p.referencia    || "").toLowerCase().includes(q)
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
            ⬇️ Descargar plantilla
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
  const TIPOS_VALIDOS = ["servicio","producto","suscripcion","service","product"];
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
    const referencia   = get("referencia","ref","sku","codigo","code");
    const codigoBarras = get("codigobarras","codigo_barras","barras","ean","isbn","barcode");
    const tipoRaw      = get("tipo","type").toLowerCase() || "servicio";
    const precioRaw    = get("precio","price","pvp");
    const costeRaw     = get("coste","costo","cost","preciocoste");
    const ivaRaw       = get("iva","vat","impuesto").replace("%","") || "21";
    const stockRaw     = get("stock","stockactual","stock_actual");
    const stockMinRaw  = get("stockminimo","stock_minimo","stockmin","minimo");
    const descripcion  = get("descripcion","description","desc");
    const unidad       = get("unidad","unit") || "unidad";

    // Validaciones obligatorias
    if (!nombre) errores.push("Nombre vacío");

    const precio = parseFloat(precioRaw.replace(",","."));
    if (isNaN(precio) || precio < 0) errores.push(`Precio inválido: "${precioRaw}"`);

    // Tipo
    const tipoMap = { servicio:"servicio", service:"servicio", producto:"producto", product:"producto", suscripcion:"suscripcion" };
    const tipo = tipoMap[tipoRaw] || "servicio";
    if (!TIPOS_VALIDOS.includes(tipoRaw) && tipoRaw) {
      avisos.push(`Tipo "${tipoRaw}" no reconocido → se usará "servicio"`);
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
      referencia:    referencia   || null,
      codigo_barras: codigoBarras || null,
      tipo,
      precio:        isNaN(precio) ? 0 : precio,
      precio_coste:  (!isNaN(coste) && coste > 0) ? coste : null,
      iva:           IVAS_VALIDOS.includes(iva) ? iva : 21,
      stock_actual:  tipo==="producto" && stock!==null && !isNaN(stock) ? stock : null,
      stock_minimo:  tipo==="producto" && stockMin!==null && !isNaN(stockMin) ? stockMin : null,
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
      <td class="mono" style="font-size:10px">${r.referencia || "—"}</td>
      <td class="mono" style="font-size:10px">${r.codigo_barras || "—"}</td>
      <td>${r.tipo}</td>
      <td class="mono">${fmt(r.precio)}</td>
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
      referencia:    r.referencia,
      codigo_barras: r.codigo_barras,
      descripcion:   r.descripcion,
      tipo:          r.tipo,
      precio:        r.precio,
      precio_coste:  r.precio_coste,
      iva:           r.iva,
      unidad:        r.unidad,
      stock_actual:  r.stock_actual,
      stock_minimo:  r.stock_minimo,
      activo:        true,
    };

    if (actualizar && (r.referencia || r.codigo_barras)) {
      // Buscar si ya existe por referencia o código de barras
      const existente = PRODUCTOS.find(p =>
        (r.referencia    && p.referencia    === r.referencia) ||
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
      "referencia":       "CAM-BL-M",
      "codigo_barras":    "8400000123456",
      "tipo":             "producto",
      "precio *":         19.95,
      "precio_coste":     8.50,
      "iva":              21,
      "stock_actual":     50,
      "stock_minimo":     10,
      "descripcion":      "Camiseta de algodón 100%",
      "unidad":           "unidad",
    },
    {
      "nombre *":         "Consultoría por hora",
      "referencia":       "CONS-H",
      "codigo_barras":    "",
      "tipo":             "servicio",
      "precio *":         75.00,
      "precio_coste":     "",
      "iva":              21,
      "stock_actual":     "",
      "stock_minimo":     "",
      "descripcion":      "Servicio de consultoría profesional",
      "unidad":           "hora",
    },
    {
      "nombre *":         "Suscripción mensual",
      "referencia":       "SUB-MES",
      "codigo_barras":    "",
      "tipo":             "suscripcion",
      "precio *":         29.00,
      "precio_coste":     "",
      "iva":              21,
      "stock_actual":     "",
      "stock_minimo":     "",
      "descripcion":      "Plan mensual de acceso",
      "unidad":           "mes",
    },
  ];

  const ws = window.XLSX.utils.json_to_sheet(plantilla);

  // Ancho de columnas
  ws["!cols"] = [
    {wch:30},{wch:15},{wch:18},{wch:12},{wch:12},{wch:14},{wch:8},
    {wch:14},{wch:14},{wch:30},{wch:10},
  ];

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Productos");

  // Hoja de instrucciones
  const instrucciones = [
    { "INSTRUCCIONES": "═══════════════════════════════════════════════" },
    { "INSTRUCCIONES": "COLUMNAS OBLIGATORIAS (marcadas con *):" },
    { "INSTRUCCIONES": "  • nombre *      → Nombre del producto o servicio" },
    { "INSTRUCCIONES": "  • precio *      → Precio de venta (sin IVA)" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "COLUMNAS OPCIONALES:" },
    { "INSTRUCCIONES": "  • referencia    → SKU o código interno (ej: CAM-BL-M)" },
    { "INSTRUCCIONES": "  • codigo_barras → EAN-13, EAN-8, ISBN, QR, etc." },
    { "INSTRUCCIONES": "  • tipo          → servicio / producto / suscripcion" },
    { "INSTRUCCIONES": "  • precio_coste  → Precio de compra (para calcular margen)" },
    { "INSTRUCCIONES": "  • iva           → 0 / 4 / 10 / 21  (por defecto: 21)" },
    { "INSTRUCCIONES": "  • stock_actual  → Unidades en stock (solo para productos físicos)" },
    { "INSTRUCCIONES": "  • stock_minimo  → Alerta cuando el stock baje de este número" },
    { "INSTRUCCIONES": "  • descripcion   → Texto que aparecerá en la línea del documento" },
    { "INSTRUCCIONES": "  • unidad        → unidad / hora / día / mes / kg / litro / m²" },
    { "INSTRUCCIONES": "" },
    { "INSTRUCCIONES": "NOTAS:" },
    { "INSTRUCCIONES": "  • Borra las filas de ejemplo antes de importar" },
    { "INSTRUCCIONES": "  • Los nombres de columna no distinguen mayúsculas" },
    { "INSTRUCCIONES": "  • Puedes usar coma o punto como separador decimal" },
    { "INSTRUCCIONES": "  • Las filas con errores se omiten automáticamente" },
  ];
  const ws2 = window.XLSX.utils.json_to_sheet(instrucciones);
  ws2["!cols"] = [{wch:65}];
  window.XLSX.utils.book_append_sheet(wb, ws2, "Instrucciones");

  window.XLSX.writeFile(wb, "plantilla_productos_taurix.xlsx");
  toast("Plantilla descargada ✅ — rellénala y súbela aquí", "success", 4000);
}
