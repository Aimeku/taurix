/* ═══════════════════════════════════════════════════════
   TAURIX · plantillas-usuario.js
   Plantillas de factura/presupuesto definidas por el usuario.
   ─ Crear, editar, eliminar plantillas con líneas predefinidas
   ─ Aplicar plantilla al crear factura o presupuesto
   ─ Generar PDFs con plantilla personalizada (logo, colores, textos legales)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

export let PLANTILLAS = [];

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadPlantillas() {
  const { data, error } = await supabase.from("plantillas_usuario")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("plantillas:", error.message); return []; }
  return data || [];
}

export async function refreshPlantillas() {
  PLANTILLAS = await loadPlantillas();
  renderPlantillasGrid();
}

/* ══════════════════════════
   RENDER GRID
══════════════════════════ */
function renderPlantillasGrid() {
  const wrap = document.getElementById("plantillasGrid");
  if (!wrap) return;

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--t3)">
        <div style="font-size:48px;margin-bottom:12px">📄</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:6px">Sin plantillas personalizadas</div>
        <div style="font-size:12px;margin-bottom:20px">Crea plantillas con tus líneas, notas y estilo habitual para facturar más rápido.</div>
        <button class="btn-primary" onclick="window._nuevaPlantilla()">+ Crear mi primera plantilla</button>
      </div>`;
    return;
  }

  const colores = ["#3b82f6", "#f97316", "#059669", "#8b5cf6", "#ef4444", "#0ea5e9"];
  wrap.innerHTML = PLANTILLAS.map((p, i) => {
    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const baseTotal = lineas.reduce((a, l) => a + (l.cantidad || 1) * (l.precio || 0), 0);
    return `
      <div class="doc-card" style="text-align:left;border-top:3px solid ${colores[i % 6]}" onclick="window._editPlantilla('${p.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div class="doc-card-icon" style="margin:0;font-size:22px">📋</div>
          <span style="font-size:10px;font-weight:700;color:${colores[i % 6]};background:${colores[i % 6]}15;padding:2px 8px;border-radius:6px">
            ${lineas.length} línea${lineas.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div class="doc-card-name" style="margin:0 0 4px">${p.nombre}</div>
        <div class="doc-card-desc" style="margin-bottom:8px">${p.concepto || "Sin concepto predefinido"}</div>
        ${baseTotal > 0 ? `<div style="font-family:monospace;font-size:14px;font-weight:700;color:var(--t1)">${fmt(baseTotal)}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="ta-btn ta-emit" onclick="event.stopPropagation();window._usarPlantillaFactura('${p.id}')" style="font-size:10px">📤 Factura</button>
          <button class="ta-btn" onclick="event.stopPropagation();window._usarPlantillaPres('${p.id}')" style="font-size:10px">📋 Presupuesto</button>
          <button class="ta-btn ta-del" onclick="event.stopPropagation();window._delPlantilla('${p.id}')" style="font-size:10px">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   MODAL CREAR/EDITAR PLANTILLA
══════════════════════════ */
export function showPlantillaModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const lineas = prefill.lineas ? (typeof prefill.lineas === "string" ? JSON.parse(prefill.lineas) : prefill.lineas) : [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }];
  const colorActual = prefill.color_principal || "#1a56db";

  openModal(`
    <div class="modal" style="max-width:960px;width:96vw">
      <div class="modal-hd">
        <span class="modal-title">📋 ${isEdit ? "Editar" : "Nueva"} plantilla</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd" style="padding:0;overflow:hidden">
        <!-- Layout 2 columnas: formulario + preview -->
        <div style="display:grid;grid-template-columns:1fr 280px;min-height:500px">

          <!-- ── Columna izquierda: formulario ── -->
          <div style="padding:20px 24px;overflow-y:auto;max-height:72vh;border-right:1px solid var(--brd)">
            <p class="modal-note" style="margin-bottom:16px">Las plantillas precargan líneas, conceptos y notas al crear facturas o presupuestos.</p>

            <div class="modal-grid2">
              <div class="modal-field"><label>Nombre de la plantilla *</label>
                <input autocomplete="off" id="plt_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Ej: Mantenimiento mensual"/>
              </div>
              <div class="modal-field"><label>Concepto predeterminado</label>
                <input autocomplete="off" id="plt_concepto" class="ff-input" value="${prefill.concepto || ""}" placeholder="Ej: Servicio de mantenimiento"/>
              </div>
            </div>

            <div class="modal-field"><label>Notas / Condiciones</label>
              <textarea autocomplete="off" id="plt_notas" class="ff-input ff-textarea" style="min-height:56px" placeholder="Forma de pago, plazos, condiciones…">${prefill.notas || ""}</textarea>
            </div>

            <!-- Estilo PDF -->
            <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px">🎨 Estilo del PDF</div>
            <div class="modal-grid3">
              <div class="modal-field"><label>Color principal</label>
                <input type="color" id="plt_color" class="ff-input" value="${colorActual}" style="height:38px;padding:4px;cursor:pointer"/>
              </div>
              <div class="modal-field"><label>Texto legal pie</label>
                <input autocomplete="off" id="plt_pie" class="ff-input" value="${prefill.texto_pie || ""}" placeholder="Inscrita en el RM…"/>
              </div>
              <div class="modal-field"><label>IBAN visible</label>
                <input autocomplete="off" id="plt_iban" class="ff-input" value="${prefill.iban_visible || ""}" placeholder="ES00 0000…"/>
              </div>
            </div>

            <!-- Líneas predefinidas -->
            <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px">📝 Líneas predefinidas</div>
            <div class="lineas-header" style="grid-template-columns:1fr 60px 100px 60px 32px">
              <div>Descripción</div><div>Cantidad</div><div>Precio (€)</div><div>IVA</div><div></div>
            </div>
            <div id="plt_lineasContainer">
              ${lineas.map((l, i) => _renderLineaPlantilla(l, i)).join("")}
            </div>
            <button class="btn-add-linea" id="plt_addLinea" style="margin-top:8px">+ Añadir línea</button>
          </div>

          <!-- ── Columna derecha: preview en vivo ── -->
          <div style="background:var(--bg2);padding:16px;overflow-y:auto;max-height:72vh">
            <div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">
              👁 Vista previa del PDF
            </div>
            <div id="plt_preview" style="background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.1);overflow:hidden;font-size:11px">
              <div id="plt_pvHeader" style="padding:14px 16px;color:#fff;border-radius:10px 10px 0 0;background:${colorActual}">
                <div style="font-size:9px;font-weight:800;letter-spacing:.1em;opacity:.7;margin-bottom:3px">PRESUPUESTO / FACTURA</div>
                <div id="plt_pvConcepto" style="font-size:13px;font-weight:700">Sin concepto</div>
              </div>
              <div style="padding:10px 16px;border-bottom:1px solid #e5e7eb">
                <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#9ca3af;margin-bottom:2px">Cliente</div>
                <div style="font-weight:600;color:#111">Tu cliente</div>
              </div>
              <div id="plt_pvLineas" style="padding:0 16px"></div>
              <div id="plt_pvTotales" style="padding:10px 16px;background:#f9fafb;border-top:1px solid #e5e7eb"></div>
              <div id="plt_pvNotas" style="padding:8px 16px;font-size:10px;color:#6b7280;border-top:1px solid #e5e7eb;display:none"></div>
              <div id="plt_pvPie" style="padding:6px 16px;font-size:9px;color:#9ca3af;border-top:1px solid #e5e7eb;display:none"></div>
            </div>
          </div>

        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="plt_del" style="margin-right:auto">🗑️ Eliminar</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="plt_save">${isEdit ? "Actualizar" : "Guardar plantilla"}</button>
      </div>
    </div>
  `);

  // ── Preview en vivo ──
  function _pltUpdatePreview() {
    const nombre   = document.getElementById("plt_nombre")?.value   || "Sin nombre";
    const concepto = document.getElementById("plt_concepto")?.value || "Sin concepto";
    const notas    = document.getElementById("plt_notas")?.value    || "";
    const pie      = document.getElementById("plt_pie")?.value      || "";
    const color    = document.getElementById("plt_color")?.value    || "#1a56db";

    // Header color
    const hdr = document.getElementById("plt_pvHeader");
    if (hdr) hdr.style.background = color;
    const pvConc = document.getElementById("plt_pvConcepto");
    if (pvConc) pvConc.textContent = concepto || nombre;

    // Líneas
    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(row => ({
      descripcion: row.querySelector("[data-field='descripcion']")?.value || "",
      cantidad:    parseFloat(row.querySelector("[data-field='cantidad']")?.value) || 1,
      precio:      parseFloat(row.querySelector("[data-field='precio']")?.value)   || 0,
      iva:         parseInt(row.querySelector("[data-field='iva']")?.value)         || 21,
    })).filter(l => l.descripcion || l.precio > 0);

    const pvLineas = document.getElementById("plt_pvLineas");
    if (pvLineas) {
      if (!lineasArr.length) {
        pvLineas.innerHTML = `<div style="padding:10px 0;color:#9ca3af;text-align:center;font-size:10px">Sin líneas definidas</div>`;
      } else {
        pvLineas.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 32px 56px 56px;gap:2px;padding:6px 0 2px;font-size:8px;font-weight:700;text-transform:uppercase;color:#9ca3af;border-bottom:1px solid #e5e7eb">
            <span>Descripción</span><span style="text-align:right">Cant</span><span style="text-align:right">Precio</span><span style="text-align:right">Total</span>
          </div>
          ${lineasArr.map(l => `
            <div style="display:grid;grid-template-columns:1fr 32px 56px 56px;gap:2px;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:10px;align-items:center">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#111">${l.descripcion}</span>
              <span style="text-align:right;color:#6b7280">${l.cantidad}</span>
              <span style="text-align:right;color:#6b7280">${l.precio.toFixed(2)}€</span>
              <span style="text-align:right;font-weight:700;color:#111">${(l.cantidad*l.precio).toFixed(2)}€</span>
            </div>`).join("")}`;
      }
    }

    // Totales
    const base = lineasArr.reduce((a,l)=>a+l.cantidad*l.precio,0);
    const iva  = lineasArr.reduce((a,l)=>a+l.cantidad*l.precio*l.iva/100,0);
    const pvTot = document.getElementById("plt_pvTotales");
    if (pvTot) pvTot.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:2px"><span>Base</span><span>${base.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#6b7280;margin-bottom:4px"><span>IVA</span><span>${iva.toFixed(2)} €</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;color:#111;border-top:1.5px solid #e5e7eb;padding-top:6px"><span>TOTAL</span><span style="font-family:monospace">${(base+iva).toFixed(2)} €</span></div>`;

    // Notas
    const pvNotas = document.getElementById("plt_pvNotas");
    if (pvNotas) { pvNotas.textContent = notas; pvNotas.style.display = notas ? "" : "none"; }

    // Pie
    const pvPie = document.getElementById("plt_pvPie");
    if (pvPie) { pvPie.textContent = pie; pvPie.style.display = pie ? "" : "none"; }
  }

  // Conectar todos los campos al preview
  ["plt_nombre","plt_concepto","plt_notas","plt_pie","plt_color"].forEach(id => {
    document.getElementById(id)?.addEventListener("input",  _pltUpdatePreview);
    document.getElementById(id)?.addEventListener("change", _pltUpdatePreview);
  });
  document.getElementById("plt_lineasContainer")?.addEventListener("input",  _pltUpdatePreview);
  document.getElementById("plt_lineasContainer")?.addEventListener("change", _pltUpdatePreview);

  // Preview inicial
  _pltUpdatePreview();

  // Añadir línea
  let lineaCount = lineas.length;
  document.getElementById("plt_addLinea").addEventListener("click", () => {
    const container = document.getElementById("plt_lineasContainer");
    container.insertAdjacentHTML("beforeend", _renderLineaPlantilla({}, lineaCount++));
    _pltUpdatePreview();
  });

  // Eliminar línea
  document.addEventListener("click", e => {
    if (e.target.closest(".plt-del-linea")) {
      e.target.closest(".linea-row")?.remove();
      _pltUpdatePreview();
    }
  });

  // Guardar
  document.getElementById("plt_save").addEventListener("click", async () => {
    const nombre = document.getElementById("plt_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }

    const rows = document.querySelectorAll("#plt_lineasContainer .linea-row");
    const lineasArr = [...rows].map(row => ({
      descripcion: row.querySelector("[data-field='descripcion']")?.value || "",
      cantidad: parseFloat(row.querySelector("[data-field='cantidad']")?.value) || 1,
      precio: parseFloat(row.querySelector("[data-field='precio']")?.value) || 0,
      iva: parseInt(row.querySelector("[data-field='iva']")?.value) || 21,
    })).filter(l => l.descripcion || l.precio > 0);

    const payload = {
      user_id: SESSION.user.id,
      nombre,
      concepto: document.getElementById("plt_concepto").value.trim() || null,
      notas: document.getElementById("plt_notas").value.trim() || null,
      lineas: JSON.stringify(lineasArr),
      color_principal: document.getElementById("plt_color").value || "#1a56db",
      texto_pie: document.getElementById("plt_pie").value.trim() || null,
      iban_visible: document.getElementById("plt_iban").value.trim() || null,
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("plantillas_usuario").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("plantillas_usuario").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }

    toast(isEdit ? "Plantilla actualizada ✅" : "Plantilla creada ✅", "success");
    closeModal();
    await refreshPlantillas();
  });

  if (isEdit) {
    document.getElementById("plt_del")?.addEventListener("click", async () => {
      await supabase.from("plantillas_usuario").delete().eq("id", prefill.id);
      closeModal(); toast("Plantilla eliminada", "success");
      await refreshPlantillas();
    });
  }
}

function _renderLineaPlantilla(l = {}, idx = 0) {
  return `
    <div class="linea-row" style="grid-template-columns:1fr 60px 100px 60px 32px">
      <input autocomplete="off" class="ff-input" data-field="descripcion" value="${l.descripcion || ""}" placeholder="Descripción"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="cantidad" value="${l.cantidad || 1}" min="0.01" step="0.01"/>
      <input autocomplete="off" type="number" class="ff-input" data-field="precio" value="${l.precio || ""}" step="0.01" placeholder="0.00"/>
      <select class="ff-select" data-field="iva">
        <option value="21" ${(l.iva || 21) === 21 ? "selected" : ""}>21%</option>
        <option value="10" ${l.iva === 10 ? "selected" : ""}>10%</option>
        <option value="4" ${l.iva === 4 ? "selected" : ""}>4%</option>
        <option value="0" ${l.iva === 0 ? "selected" : ""}>0%</option>
      </select>
      <button class="linea-del plt-del-linea" title="Eliminar línea">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
}

/* ══════════════════════════
   APLICAR PLANTILLA
══════════════════════════ */
export function getPlantillaData(plantillaId) {
  const p = PLANTILLAS.find(x => x.id === plantillaId);
  if (!p) return null;
  return {
    concepto: p.concepto,
    notas: p.notas,
    lineas: p.lineas ? JSON.parse(p.lineas) : [],
    color_principal: p.color_principal,
    texto_pie: p.texto_pie,
    iban_visible: p.iban_visible,
  };
}

/* Selector de plantilla — se usa en nuevo presupuesto y nueva factura */
export function renderPlantillaSelector(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container || !PLANTILLAS.length) return;

  container.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span style="font-size:12px;font-weight:700;color:var(--t3);align-self:center">📋 Plantilla:</span>
      ${PLANTILLAS.map(p => `
        <button class="btn-outline plt-selector-btn" data-plt-id="${p.id}" style="font-size:12px;padding:5px 12px">
          ${p.nombre}
        </button>`).join("")}
      <button class="btn-outline plt-selector-btn" data-plt-id="" style="font-size:12px;padding:5px 12px;color:var(--t4)">
        En blanco
      </button>
    </div>`;

  container.querySelectorAll(".plt-selector-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".plt-selector-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const data = btn.dataset.pltId ? getPlantillaData(btn.dataset.pltId) : null;
      if (onSelect) onSelect(data);
    });
  });
}

/* ══════════════════════════
   GLOBAL HANDLERS
══════════════════════════ */
window._nuevaPlantilla = () => showPlantillaModal();
window._editPlantilla = (id) => {
  const p = PLANTILLAS.find(x => x.id === id);
  if (p) showPlantillaModal(p);
};
window._delPlantilla = (id) => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar plantilla</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar esta plantilla?</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpltOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpltOk").addEventListener("click", async () => {
    await supabase.from("plantillas_usuario").delete().eq("id", id);
    closeModal(); toast("Plantilla eliminada", "success");
    await refreshPlantillas();
  });
};
window._usarPlantillaFactura = (id) => {
  const data = getPlantillaData(id);
  if (!data) return;
  // Navegar a nueva factura y aplicar plantilla
  window._switchView?.("nueva-factura");
  // Dejar un tick para que la vista se renderice
  setTimeout(() => window._applyPlantillaToFactura?.(data), 200);
};
window._usarPlantillaPres = (id) => {
  const data = getPlantillaData(id);
  if (!data) return;
  window._switchView?.("presupuestos");
  setTimeout(() => window._editPres?.("new_from_template_" + id), 200);
};

/* ══════════════════════════
   SELECTOR INLINE — para facturas, presupuestos, albaranes
   Llama a esta función pasando el containerId y un callback onSelect(data)
══════════════════════════ */
export async function renderSelectorPlantillas(containerId, onSelect) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  if (!PLANTILLAS.length) await loadPlantillas();

  if (!PLANTILLAS.length) {
    wrap.innerHTML = `
      <div style="padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px;font-size:12px;color:var(--t4);display:flex;align-items:center;gap:8px">
        📋 Sin plantillas — <a href="#" onclick="window._switchView('plantillas');return false" style="color:var(--accent);font-weight:600">Crea tu primera plantilla →</a>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div style="padding:10px 14px;background:rgba(26,86,219,.04);border:1.5px dashed rgba(26,86,219,.2);border-radius:10px">
      <div style="font-size:11px;font-weight:700;color:var(--t3);margin-bottom:8px">📋 Usar plantilla</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${PLANTILLAS.map(p => `
          <button class="plt-sel-btn btn-outline" data-plt-id="${p.id}"
            style="font-size:12px;padding:4px 12px;border-radius:7px;transition:all .15s">
            ${p.nombre}
          </button>`).join("")}
        <button class="plt-sel-btn btn-outline" data-plt-id=""
          style="font-size:12px;padding:4px 12px;border-radius:7px;color:var(--t4)">
          ✕ En blanco
        </button>
      </div>
    </div>`;

  wrap.querySelectorAll(".plt-sel-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".plt-sel-btn").forEach(b => {
        b.style.background   = "";
        b.style.borderColor  = "";
        b.style.color        = "";
      });
      if (btn.dataset.pltId) {
        btn.style.background  = "var(--accent)";
        btn.style.borderColor = "var(--accent)";
        btn.style.color       = "#fff";
        const data = getPlantillaData(btn.dataset.pltId);
        if (onSelect && data) onSelect(data);
      } else {
        if (onSelect) onSelect(null);
      }
    });
  });
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initPlantillasView() {
  document.getElementById("nuevaPlantillaBtn")?.addEventListener("click", () => showPlantillaModal());
  refreshPlantillas();
}
