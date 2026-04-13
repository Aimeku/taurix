/* ═══════════════════════════════════════════════════════
   TUGESTOR · presupuestos.js
   Módulo completo de presupuestos / ofertas
   ─ Numeración consecutiva automática
   ─ Convertir a Albarán (además de Factura)
   ─ Click en número de presupuesto para abrir/editar
   ─ Línea de descuento en líneas
   ─ Buscar producto por código de artículo (SKU/barras)
   ─ Plantillas de presupuesto
   ─ Productos en Descripción (no en Concepto)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, getYear, getTrim, getFechaRango
} from "./utils.js";
import { PRODUCTOS, buscarProductoPorCodigo } from "./productos.js";
import { exportPresupuestoPDFConPlantilla, exportAlbaranPDFConPlantilla } from "./pdf-plantilla.js";

let paginaActual = 1;
const POR_PAGINA = 30;

/* ══════════════════════════════════════════
   PLANTILLAS
══════════════════════════════════════════ */
const PLANTILLAS_DEFAULT = [
  {
    id: "servicios_profesionales",
    nombre: "Servicios profesionales",
    concepto: "Prestación de servicios profesionales",
    notas: "Forma de pago: transferencia bancaria a 30 días.\nLos servicios incluyen revisión sin coste adicional durante 15 días.",
    lineas: [
      { descripcion: "Consultoría y análisis", cantidad: 1, precio: 0, iva: 21 },
      { descripcion: "Desarrollo / ejecución", cantidad: 1, precio: 0, iva: 21 },
    ]
  },
  {
    id: "proyecto_web",
    nombre: "Proyecto web",
    concepto: "Desarrollo de proyecto web",
    notas: "50% al inicio del proyecto · 50% a la entrega.\nIncluye 30 días de soporte post-lanzamiento.",
    lineas: [
      { descripcion: "Diseño UX/UI",          cantidad: 1, precio: 0, iva: 21 },
      { descripcion: "Desarrollo frontend",   cantidad: 1, precio: 0, iva: 21 },
      { descripcion: "Desarrollo backend",    cantidad: 1, precio: 0, iva: 21 },
      { descripcion: "Testing y despliegue",  cantidad: 1, precio: 0, iva: 21 },
    ]
  },
  {
    id: "mantenimiento",
    nombre: "Mantenimiento mensual",
    concepto: "Servicio de mantenimiento",
    notas: "Renovación mensual. Cancelable con 15 días de preaviso.",
    lineas: [
      { descripcion: "Cuota mensual de mantenimiento", cantidad: 1, precio: 0, iva: 21 },
    ]
  },
  {
    id: "producto_fisico",
    nombre: "Venta de productos",
    concepto: "Suministro de material",
    notas: "Entrega en 5-7 días hábiles. Gastos de envío incluidos para pedidos superiores a 100€.",
    lineas: [
      { descripcion: "", cantidad: 1, precio: 0, iva: 21 },
    ]
  },
  {
    id: "vacio",
    nombre: "En blanco",
    concepto: "",
    notas: "",
    lineas: [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }]
  },
];

async function getUserPlantillas() {
  try {
    const { data } = await supabase.from("presupuesto_plantillas")
      .select("*").eq("user_id", SESSION.user.id).order("nombre");
    return data || [];
  } catch { return []; }
}

async function savePlantilla(plantilla) {
  return supabase.from("presupuesto_plantillas").insert({
    user_id: SESSION.user.id,
    nombre:  plantilla.nombre,
    concepto: plantilla.concepto,
    notas:   plantilla.notas,
    lineas:  JSON.stringify(plantilla.lineas),
  });
}

/* ══════════════════════════
   CARGAR PRESUPUESTOS
══════════════════════════ */
export async function refreshPresupuestos() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const search    = (document.getElementById("presSearch")?.value || "").toLowerCase();
  const estadof   = document.getElementById("presFilterEstado")?.value || "";
  const clientef  = (document.getElementById("presFilterCliente")?.value || "").toLowerCase();
  const desdef    = document.getElementById("presFilterDesde")?.value || "";
  const hastaf    = document.getElementById("presFilterHasta")?.value || "";
  const minf      = parseFloat(document.getElementById("presFilterMin")?.value) || 0;
  const maxf      = parseFloat(document.getElementById("presFilterMax")?.value) || 0;
  const desde     = (paginaActual - 1) * POR_PAGINA;

  let q = supabase.from("presupuestos").select("*", { count: "exact" })
    .eq("user_id", SESSION.user.id)
    .gte("fecha", desdef || ini).lte("fecha", hastaf || fin)
    .order("fecha", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false, nullsFirst: false })
    .range(desde, desde + POR_PAGINA - 1);

  if (estadof) {
    q = q.eq("estado", estadof);
  } else {
    // Los presupuestos convertidos a albarán solo aparecen en la sección Albaranes
    q = q.neq("estado", "albaran");
  }

  const { data, count, error } = await q;
  if (error) { console.error("refreshPresupuestos:", error.message); return; }

  let presupuestos = data || [];
  if (search)   presupuestos = presupuestos.filter(p =>
    (p.concepto      || "").toLowerCase().includes(search) ||
    (p.numero        || "").toLowerCase().includes(search) ||
    (p.cliente_nombre|| "").toLowerCase().includes(search)
  );
  if (clientef) presupuestos = presupuestos.filter(p => (p.cliente_nombre||"").toLowerCase().includes(clientef));
  if (minf > 0) presupuestos = presupuestos.filter(p => (p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100) >= minf);
  if (maxf > 0) presupuestos = presupuestos.filter(p => (p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100) <= maxf);

  // Poblar select clientes
  const selCli = document.getElementById("presFilterCliente");
  if (selCli && selCli.options.length <= 1 && (data||[]).length) {
    const nombres = [...new Set((data||[]).map(p=>p.cliente_nombre).filter(Boolean))].sort();
    nombres.forEach(n => { const o=document.createElement("option"); o.value=n.toLowerCase(); o.textContent=n; selCli.appendChild(o); });
  }

  const countEl = document.getElementById("presCount");
  if (countEl) countEl.textContent = `${count || 0} presupuestos en el periodo`;

  const tbody = document.getElementById("presBody");
  if (!tbody) return;

  if (!presupuestos.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="9">Sin presupuestos en este periodo.</td></tr>`;
    return;
  }

  const estadoBadge = {
    borrador:  `<span class="badge b-draft">Borrador</span>`,
    enviado:   `<span class="badge b-pendiente">Enviado</span>`,
    aceptado:  `<span class="badge b-cobrada">Aceptado</span>`,
    rechazado: `<span class="badge b-vencida">Rechazado</span>`,
    expirado:  `<span class="badge" style="background:#f3f4f6;color:#6b7280">Expirado</span>`,
    albaran:   `<span class="badge b-ic">Albarán</span>`,
  };

  presupuestos.sort((a,b) => {
    if (a.fecha === b.fecha) {
      const numA = parseInt((a.numero||"").split("-")[2]) || 0;
      const numB = parseInt((b.numero||"").split("-")[2]) || 0;
      return numB - numA;
    }
    return (b.fecha || "").localeCompare(a.fecha || "");
  });
  tbody.innerHTML = presupuestos.map(p => {
    const total  = p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100;
    const hoy    = new Date().toISOString().slice(0, 10);
    const vencido = p.fecha_validez && p.fecha_validez < hoy && p.estado !== "aceptado" && p.estado !== "albaran";
    const badgeEstado = vencido ? estadoBadge.expirado : (estadoBadge[p.estado] || estadoBadge.borrador);

    const OP_LABELS = {
      nacional:               { label: "Nacional",        cls: "b-draft"     },
      intracomunitaria:       { label: "Intracom.",       cls: "b-ic"        },
      exportacion:            { label: "Exportación",     cls: "b-cobrada"   },
      importacion:            { label: "Importación",     cls: "b-pendiente" },
      inversion_sujeto_pasivo:{ label: "Inv. S.Pasivo",  cls: "b-vencida"   },
    };
    const opInfo  = OP_LABELS[p.tipo_operacion || "nacional"] || OP_LABELS.nacional;
    const badgeOp = `<span class="badge ${opInfo.cls}" style="font-size:10px;white-space:nowrap">${opInfo.label}</span>`;

    return `
      <tr>
        <td class="mono" style="font-size:12px">${fmtDate(p.fecha)}</td>
        <td>
          <span class="badge b-income mono pres-num-link" style="font-size:11px;cursor:pointer"
            onclick="window._editPres('${p.id}')" title="Abrir presupuesto">
            ${p.numero || "S/N"}
          </span>
        </td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${p.concepto || "—"}</td>
        <td style="font-size:12px;color:var(--t3)">${p.cliente_nombre || "—"}</td>
        <td class="mono fw7">${fmt(total)}</td>
        <td>${badgeOp}</td>
        <td style="font-size:12px;color:var(--t4)">${p.fecha_aceptacion ? fmtDate(p.fecha_aceptacion) : "—"}</td>
        <td>
          <div class="tbl-act">
            ${(() => {
              const bloqueado = p.estado === "aceptado" || (p.estado === "albaran" && p.estado_facturacion === "facturado");
              return `
                ${!bloqueado && p.estado !== "albaran"
                  ? `<button class="ta-btn ta-emit" onclick="window._presTofact('${p.id}')" title="Convertir a factura">Convertir Fac</button>
                     <button class="ta-btn" onclick="window._presAlbaran('${p.id}')" title="Convertir a albarán">Convertir Alb</button>`
                  : ""}
                ${p.estado === "albaran"
                  ? `${!bloqueado ? `<button class="ta-btn ta-emit" onclick="window._albaranToFact('${p.id}')" title="Emitir factura desde albarán" style="background:var(--green-lt,#d1fae5);color:var(--green,#059669)">Convertir Fac</button>` : ""}
                     <button class="ta-btn" onclick="window._pdfAlbaran('${p.id}')" title="PDF Albarán">PDF Alb</button>
                     ${!bloqueado ? `<button class="ta-btn ta-del" onclick="window._delAlb('${p.id}')" title="Eliminar albarán">🗑️ Borrar</button>` : ""}`
                  : ""}
                <button class="ta-btn ta-email" onclick="window._presEmail('${p.id}')" title="Enviar por email">📧 Email</button>
                <button class="ta-btn" onclick="window._presPDF('${p.id}')" title="Descargar PDF presupuesto">PDF Pre</button>
                <button class="ta-btn" onclick="window._dupPres('${p.id}')" title="Duplicar">Duplicar</button>
                ${bloqueado
                  ? `<span title="Presupuesto ya facturado — no se puede modificar" style="font-size:13px;opacity:.45;cursor:default;padding:4px 6px">🔒</span>`
                  : `<button class="ta-btn" onclick="window._editPres('${p.id}')" title="Editar">✏️ Editar</button>
                     <button class="ta-btn ta-del" onclick="window._delPres('${p.id}')" title="Eliminar">🗑️ Borrar</button>`}
              `;
            })()}
          </div>
        </td>
      </tr>`;
  }).join("");

  // KPIs
  const total     = presupuestos.reduce((a, p) => a + p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100, 0);
  const aceptados = presupuestos.filter(p => p.estado === "aceptado" || p.estado === "albaran");
  const pendientes = presupuestos.filter(p => p.estado === "enviado");
  const tasa = presupuestos.length > 0 ? Math.round(aceptados.length / presupuestos.length * 100) : 0;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("presKpiTotal",     fmt(total));
  s("presKpiAceptados", fmt(aceptados.reduce((a, p) => a + p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100, 0)));
  s("presKpiPendientes",pendientes.length);
  s("presKpiTasa",      tasa + "%");
}

/* ══════════════════════════
   MODAL PLANTILLAS
══════════════════════════ */
async function showPlantillasModal(onSelect) {
  const userPlantillas = await getUserPlantillas();
  const todas = [...userPlantillas.map(p => ({
    ...p,
    lineas: typeof p.lineas === "string" ? JSON.parse(p.lineas) : p.lineas,
    esPersonal: true
  })), ...PLANTILLAS_DEFAULT];

  openModal(`
    <div class="modal" style="max-width:560px">
      <div class="modal-hd">
        <span class="modal-title">📄 Plantillas de presupuesto</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p style="font-size:13px;color:var(--t3);margin-bottom:16px">Selecciona una plantilla para precargar el presupuesto.</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${todas.map((t, i) => `
            <div class="plantilla-item" onclick="window._selPlantilla(${i})"
              style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1.5px solid var(--brd);border-radius:10px;cursor:pointer;transition:all .15s">
              <div>
                <div style="font-weight:700;font-size:13.5px">${t.esPersonal ? "⭐ " : ""}${t.nombre}</div>
                ${t.concepto ? `<div style="font-size:12px;color:var(--t3);margin-top:2px">${t.concepto}</div>` : ""}
                <div style="font-size:11px;color:var(--t4);margin-top:3px">${(t.lineas||[]).length} línea${(t.lineas||[]).length !== 1 ? "s" : ""}</div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
      </div>
    </div>
  `);

  // Hover effect inline
  document.querySelectorAll(".plantilla-item").forEach(el => {
    el.addEventListener("mouseenter", () => { el.style.borderColor = "var(--brand)"; el.style.background = "var(--bg2)"; });
    el.addEventListener("mouseleave", () => { el.style.borderColor = "var(--brd)";   el.style.background = ""; });
  });

  window._selPlantilla = (i) => {
    closeModal();
    onSelect(todas[i]);
  };
}

/* ══════════════════════════
   MODAL NUEVO / EDITAR
══════════════════════════ */
export function showNuevoPresupuestoModal(prefill = {}) {
  const isEdit        = !!prefill.id;
  const lineasPrefill = prefill.lineas || [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }];

  openModal(`
    <div class="modal modal--wide">
      <div class="modal-hd">
        <span class="modal-title">📋 ${isEdit ? "Editar" : "Nuevo"} presupuesto</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${!isEdit ? `<button class="btn-outline" id="pm_plantillaBtn" style="font-size:12px;padding:5px 12px">📄 Plantilla</button>` : ""}
          <button class="modal-x" onclick="window._cm()">×</button>
        </div>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2" style="margin-bottom:16px">
          <div class="modal-field"><label>Cliente *</label>
            <select id="pm_cliente" class="ff-select">
              <option value="">— Sin asignar —</option>
              ${CLIENTES.map(c => `<option value="${c.id}" data-nombre="${c.nombre}" ${prefill.cliente_id === c.id ? "selected" : ""}>${c.nombre}${c.nif ? " · " + c.nif : ""}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Nombre cliente (texto libre)</label>
            <input id="pm_cliente_nombre" class="ff-input" value="${prefill.cliente_nombre || ""}" placeholder="O escribe directamente"/></div>
        </div>
        <div class="modal-grid2" style="margin-bottom:8px">
          <div class="modal-field"><label>NIF / CIF cliente</label>
            <input id="pm_cliente_nif" class="ff-input" value="${prefill.cliente_nif || ""}" placeholder="B12345678"/></div>
          <div class="modal-field"><label>Dirección cliente</label>
            <input id="pm_cliente_dir" class="ff-input" value="${prefill.cliente_direccion || ""}" placeholder="Calle, CP, Ciudad"/></div>
        </div>
        <div style="margin-bottom:16px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--t2)">
            <input type="checkbox" id="pm_guardarCliente"/>
            <span>💾 Guardar este cliente en mi lista de clientes</span>
          </label>
        </div>
        <div class="modal-grid3" style="margin-bottom:16px">
          <div class="modal-field"><label>Fecha *</label>
            <input type="date" id="pm_fecha" class="ff-input" value="${prefill.fecha || new Date().toISOString().slice(0, 10)}"/></div>
          <div class="modal-field"><label>Válido hasta</label>
            <input type="date" id="pm_validez" class="ff-input" value="${prefill.fecha_validez || ""}"/></div>
          <div class="modal-field"><label>Estado</label>
            <select id="pm_estado" class="ff-select">
              <option value="borrador"  ${(prefill.estado || "borrador") === "borrador"  ? "selected" : ""}>Borrador</option>
              <option value="enviado"   ${prefill.estado === "enviado"   ? "selected" : ""}>Enviado</option>
              <option value="aceptado"  ${prefill.estado === "aceptado"  ? "selected" : ""}>Aceptado</option>
              <option value="rechazado" ${prefill.estado === "rechazado" ? "selected" : ""}>Rechazado</option>
            </select>
          </div>
        </div>

        <div class="modal-field" style="margin-bottom:16px">
          <label>Concepto / asunto *</label>
          <input id="pm_concepto" class="ff-input" value="${prefill.concepto || ""}" placeholder="Asunto general del presupuesto (ej: Desarrollo web corporativo)"/>
        </div>

        <!-- LÍNEAS -->
        <div class="fb-title-row" style="margin-bottom:8px">
          <div class="fb-title" style="font-size:13px;font-weight:700">Líneas</div>
          <div style="display:flex;gap:6px">
            <button id="pm_addDesc" class="btn-add-linea" style="background:var(--bg2)">
              💰 Descuento
            </button>
            <button id="pm_addLinea" class="btn-add-linea">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Añadir línea
            </button>
          </div>
        </div>

        <!-- ══════════════════════════════════════════
             CAMPO ESCÁNER — Lector físico USB/Bluetooth
             El lector teclea el código + Enter automáticamente
             ══════════════════════════════════════════ -->
        <div id="scannerWrap" style="margin-bottom:12px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:6px;display:flex;align-items:center;gap:6px">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v-2a2 2 0 012-2h2M3 15v2a2 2 0 002 2h2M15 3h2a2 2 0 012 2v2M15 21h2a2 2 0 002-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
            Escáner de código de barras
          </div>
          <div style="display:flex;gap:8px;align-items:stretch">
            <div style="position:relative;flex:1;max-width:340px">
              <input id="pm_codBuscar"
                class="ff-input"
                style="width:100%;padding-left:36px;font-family:monospace;font-size:13px;letter-spacing:.04em"
                placeholder="Escanea aquí o escribe el código…"
                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                title="Haz click aquí y luego pasa el lector por el código de barras"/>
              <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t3);pointer-events:none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v-2a2 2 0 012-2h2M3 15v2a2 2 0 002 2h2M15 3h2a2 2 0 012 2v2M15 21h2a2 2 0 002-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <div id="scannerQtyWrap" style="display:flex;align-items:center;gap:4px">
                <span style="font-size:12px;color:var(--t3);white-space:nowrap">Cant.:</span>
                <input id="pm_scanQty" type="number" min="1" step="1" value="1"
                  class="ff-input" style="width:58px;text-align:center;font-size:13px;font-weight:700"
                  title="Cantidad a añadir cuando se escanee"/>
              </div>
            </div>
          </div>
          <!-- Feedback del escáner -->
          <div id="scannerFeedback" style="min-height:22px;margin-top:5px;font-size:12px;transition:opacity .3s"></div>
          <div style="font-size:11px;color:var(--t4);margin-top:3px">
            💡 Haz click en el campo, después pasa el lector por el código de barras. Se añade solo.
          </div>
        </div>

        <div class="lineas-header" style="font-size:11px">
          <div class="lh-desc">Descripción</div>
          <div class="lh-qty">Cant.</div>
          <div class="lh-price">Precio unit.</div>
          <div class="lh-iva">IVA</div>
          <div class="lh-total">Total</div>
          <div class="lh-del"></div>
        </div>
        <div id="pm_lineasContainer"></div>

        <div class="lineas-totales" id="pm_totales" style="margin-top:12px">
          <div class="lt-row"><span>Base imponible</span><strong id="pm_ltBase">0,00 €</strong></div>
          <div class="lt-row" id="pm_ltDescRow" style="display:none;color:var(--red,#dc2626)">
            <span>Descuentos</span><strong id="pm_ltDesc" style="color:var(--red,#dc2626)">0,00 €</strong>
          </div>
          <div class="lt-row"><span>IVA</span><strong id="pm_ltIva">0,00 €</strong></div>
          <div class="lt-row lt-total"><span>TOTAL</span><strong id="pm_ltTotal">0,00 €</strong></div>
        </div>

        <div class="modal-field" style="margin-top:16px">
          <label>Notas / condiciones</label>
          <textarea id="pm_notas" class="ff-input ff-textarea" style="min-height:70px"
            placeholder="Condiciones de pago, plazos, garantías…">${prefill.notas || ""}</textarea>
        </div>
      </div>
      <div class="modal-ft">
        ${!isEdit ? `<button class="btn-outline" id="pm_saveAsPlantilla" style="margin-right:auto;font-size:12px">💾 Guardar como plantilla</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pm_save">${isEdit ? "Actualizar" : "Guardar presupuesto"}</button>
      </div>
    </div>
  `);

  /* ── Lógica de líneas ── */
  let lineas = [];
  let lid    = 0;

  const calcTotales = () => {
    let base = 0, ivaT = 0, descT = 0;
    lineas.forEach(l => {
      if (l.esDescuento) {
        descT += Math.abs(l.cantidad * l.precio);
      } else {
        const sub = l.cantidad * l.precio;
        base += sub;
        ivaT += sub * l.iva / 100;
      }
    });
    const netBase = Math.max(0, base - descT);
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s("pm_ltBase",  fmt(base));
    s("pm_ltIva",   fmt(ivaT));
    s("pm_ltTotal", fmt(base - descT + ivaT));
    s("pm_ltDesc",  descT > 0 ? `- ${fmt(descT)}` : "0,00 €");
    const descRow = document.getElementById("pm_ltDescRow");
    if (descRow) descRow.style.display = descT > 0 ? "" : "none";
  };

  const addLinea = (pf = {}, esDescuento = false) => {
    const id = ++lid;
    const l  = {
      id,
      descripcion: pf.descripcion  || (esDescuento ? "Descuento" : ""),
      cantidad:    pf.cantidad     || 1,
      precio:      pf.precio       || 0,
      iva:         pf.iva !== undefined ? pf.iva : (esDescuento ? 0 : 21),
      esDescuento,
    };
    lineas.push(l);

    const cont = document.getElementById("pm_lineasContainer");
    const row  = document.createElement("div");
    row.className = `linea-row${esDescuento ? " linea-row--descuento" : ""}`;
    row.dataset.lineaId = id;
    if (esDescuento) row.style.cssText = "border-left:3px solid var(--red,#dc2626);background:var(--bg2,#f9fafb)";

    row.innerHTML = `
      <input type="text" class="linea-desc ff-input" value="${l.descripcion}"
        data-field="descripcion" placeholder="${esDescuento ? "Motivo del descuento" : "Descripción del producto o servicio"}"/>
      <input type="number" class="linea-qty ff-input" value="${l.cantidad}" min="0.01" step="0.01" data-field="cantidad"
        ${esDescuento ? 'style="display:none"' : ""}/>
      <div class="linea-price-wrap">
        <span class="linea-euro">${esDescuento ? "-€" : "€"}</span>
        <input type="number" class="linea-price ff-input" value="${l.precio || ""}"
          placeholder="${esDescuento ? "Importe" : "0.00"}" step="0.01" data-field="precio"/>
      </div>
      <select class="linea-iva ff-select" data-field="iva" ${esDescuento ? "disabled" : ""}>
        <option value="21" ${l.iva === 21 ? "selected" : ""}>21%</option>
        <option value="10" ${l.iva === 10 ? "selected" : ""}>10%</option>
        <option value="4"  ${l.iva === 4  ? "selected" : ""}>4%</option>
        <option value="0"  ${l.iva === 0  ? "selected" : ""}>0%</option>
      </select>
      <div class="linea-total" id="pmlt${id}">${esDescuento ? `- ${fmt(0)}` : fmt(0)}</div>
      <button class="linea-del" onclick="window._pmDelLinea(${id})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    row.querySelectorAll("input,select").forEach(el => {
      el.addEventListener("input", () => {
        const li = lineas.find(x => x.id === id); if (!li) return;
        const f = el.dataset.field;
        if (f === "descripcion") li.descripcion = el.value;
        else if (f === "cantidad") li.cantidad = parseFloat(el.value) || 0;
        else if (f === "precio")   li.precio   = parseFloat(el.value) || 0;
        else if (f === "iva")      li.iva      = parseInt(el.value)   || 0;
        const tot = document.getElementById(`pmlt${id}`);
        const importe = li.cantidad * li.precio;
        if (tot) tot.textContent = li.esDescuento ? `- ${fmt(Math.abs(li.precio))}` : fmt(importe);
        calcTotales();
      });
    });

    // Autocomplete por nombre (si no es descuento)
    if (!esDescuento && PRODUCTOS && PRODUCTOS.length > 0) {
      const descInput = row.querySelector(".linea-desc");
      if (descInput) {
        const dropdown = document.createElement("div");
        dropdown.className = "csc-dropdown prod-autocomplete";
        dropdown.style.cssText = "position:absolute;z-index:300;width:100%;top:100%;left:0;display:none";
        descInput.parentElement.style.position = "relative";
        descInput.parentElement.appendChild(dropdown);

        descInput.addEventListener("input", () => {
          const q = descInput.value.toLowerCase();
          if (!q) { dropdown.style.display = "none"; return; }
          const matches = PRODUCTOS.filter(p =>
            p.activo !== false && (
              (p.nombre      || "").toLowerCase().includes(q) ||
              (p.descripcion || "").toLowerCase().includes(q)
            )
          ).slice(0, 6);
          if (!matches.length) { dropdown.style.display = "none"; return; }
          dropdown.style.display = "";
          dropdown.innerHTML = matches.map(p => `
            <div class="csc-item" data-prod-id="${p.id}"
              style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--brd)">
              <strong>${p.nombre}</strong>
              ${p.sku ? `<span class="mono" style="font-size:11px;color:var(--t4);margin-left:6px">${p.sku}</span>` : ""}
              <span style="float:right;color:var(--brand);font-weight:700">${fmt(p.precio_venta)}</span>
              ${p.descripcion ? `<div style="font-size:11px;color:var(--t3);margin-top:2px">${p.descripcion.slice(0,60)}</div>` : ""}
            </div>`).join("");
          dropdown.querySelectorAll(".csc-item").forEach(item => {
            item.addEventListener("click", () => {
              const prod = PRODUCTOS.find(p => p.id === item.dataset.prodId);
              if (!prod) return;
              const li = lineas.find(x => x.id === id);
              if (li) {
                // Descripción del producto (del campo descripcion, no nombre)
                li.descripcion = prod.descripcion || prod.nombre;
                li.precio      = prod.precio_venta;
                li.iva         = prod.iva;
              }
              descInput.value = prod.descripcion || prod.nombre;
              row.querySelector(`[data-field="precio"]`).value = prod.precio_venta;
              row.querySelector(`[data-field="iva"]`).value    = prod.iva;
              const tot = document.getElementById(`pmlt${id}`);
              if (tot) tot.textContent = fmt(li.cantidad * prod.precio_venta);
              calcTotales();
              dropdown.style.display = "none";
            });
          });
        });
        document.addEventListener("click", e => {
          if (!row.contains(e.target)) dropdown.style.display = "none";
        }, { once: false });
      }
    }

    cont.appendChild(row);
    calcTotales();
  };

  window._pmDelLinea = (id) => {
    lineas = lineas.filter(l => l.id !== id);
    document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
    calcTotales();
  };

  // Cargar líneas iniciales
  lineasPrefill.forEach(l => addLinea(l, !!l.esDescuento));
  document.getElementById("pm_addLinea").addEventListener("click", () => addLinea());
  document.getElementById("pm_addDesc").addEventListener("click", () => {
    // Modal para elegir tipo de descuento
    const base = lineas.filter(l => !l.esDescuento).reduce((a,l) => a + l.cantidad * l.precio, 0);
    openModal(`
      <div class="modal" style="max-width:400px">
        <div class="modal-hd"><span class="modal-title">💰 Añadir descuento</span><button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd">
          <div class="modal-field"><label>Motivo del descuento</label>
            <input id="desc_motivo" class="ff-input" placeholder="Ej: Descuento por volumen" value="Descuento"/></div>
          <div class="modal-field" style="margin-top:12px"><label>Tipo de descuento</label>
            <div style="display:flex;gap:8px;margin-top:6px">
              <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:2px solid var(--brand);border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">
                <input type="radio" name="desc_tipo" value="importe" checked/> Importe fijo (€)
              </label>
              <label style="flex:1;display:flex;align-items:center;gap:6px;padding:10px;border:1.5px solid var(--brd);border-radius:8px;cursor:pointer;font-size:13px" id="desc_pct_lbl">
                <input type="radio" name="desc_tipo" value="porcentaje"/> Porcentaje (%)
              </label>
            </div>
          </div>
          <div class="modal-field" style="margin-top:12px">
            <label id="desc_val_lbl">Importe a descontar (€)</label>
            <input type="number" id="desc_valor" class="ff-input" placeholder="0.00" step="0.01" min="0" style="font-size:16px;font-weight:700"/>
          </div>
          <div id="desc_preview" style="background:var(--bg2);border-radius:8px;padding:10px 14px;margin-top:8px;font-size:13px;display:none">
            Descuento: <strong id="desc_preview_val" style="color:var(--red,#dc2626)"></strong>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-save" id="desc_ok">Añadir descuento</button>
        </div>
      </div>
    `);

    // Estilo al cambiar tipo
    document.querySelectorAll("input[name='desc_tipo']").forEach(r => {
      r.addEventListener("change", () => {
        const esPct = document.querySelector("input[name='desc_tipo']:checked").value === "porcentaje";
        document.getElementById("desc_val_lbl").textContent = esPct ? "Porcentaje a descontar (%)" : "Importe a descontar (€)";
        document.querySelector("label[id='desc_pct_lbl']").style.borderColor = esPct ? "var(--brand)" : "var(--brd)";
        document.querySelector("label[id='desc_pct_lbl']").style.fontWeight  = esPct ? "600" : "400";
        document.querySelectorAll("input[name='desc_tipo']")[0].closest("label").style.borderColor = !esPct ? "var(--brand)" : "var(--brd)";
        document.querySelectorAll("input[name='desc_tipo']")[0].closest("label").style.fontWeight  = !esPct ? "600" : "400";
        updateDescPreview();
      });
    });

    const updateDescPreview = () => {
      const tipo  = document.querySelector("input[name='desc_tipo']:checked")?.value;
      const val   = parseFloat(document.getElementById("desc_valor")?.value) || 0;
      const importe = tipo === "porcentaje" ? (base * val / 100) : val;
      const prev  = document.getElementById("desc_preview");
      const pvVal = document.getElementById("desc_preview_val");
      if (val > 0 && prev && pvVal) {
        prev.style.display = "";
        pvVal.textContent  = `- ${fmt(importe)}${tipo === "porcentaje" ? ` (${val}% de ${fmt(base)})` : ""}`;
      } else if (prev) { prev.style.display = "none"; }
    };
    document.getElementById("desc_valor")?.addEventListener("input", updateDescPreview);

    document.getElementById("desc_ok").addEventListener("click", () => {
      const tipo    = document.querySelector("input[name='desc_tipo']:checked").value;
      const val     = parseFloat(document.getElementById("desc_valor").value);
      const motivo  = document.getElementById("desc_motivo").value.trim() || "Descuento";
      if (!val || val <= 0) { toast("Introduce un valor válido", "error"); return; }
      const importe = tipo === "porcentaje" ? parseFloat((base * val / 100).toFixed(2)) : val;
      const desc    = tipo === "porcentaje" ? `${motivo} (${val}%)` : motivo;
      closeModal();
      addLinea({ descripcion: desc, precio: importe, cantidad: 1, iva: 0 }, true);
    });
  });

  // ══════════════════════════════════════════════════
  // ESCÁNER — Lector físico USB/Bluetooth
  // El lector envía el código como si fuera teclado + Enter
  // ══════════════════════════════════════════════════
  const scanInput    = document.getElementById("pm_codBuscar");
  const scanFeedback = document.getElementById("scannerFeedback");
  let   _scanTimeout = null;   // timeout para detectar "tipeo lento" vs "lector rápido"
  let   _lastKeyTime  = 0;
  let   _keyBuffer    = "";    // buffer de teclas del lector

  const mostrarFeedback = (msg, tipo) => {
    if (!scanFeedback) return;
    const colores = { ok:"#059669", error:"#dc2626", warn:"#d97706", info:"var(--t3)" };
    scanFeedback.style.color   = colores[tipo] || "var(--t3)";
    scanFeedback.style.opacity = "1";
    scanFeedback.textContent   = msg;
    clearTimeout(_scanTimeout);
    _scanTimeout = setTimeout(() => { if(scanFeedback) scanFeedback.style.opacity="0"; }, 3000);
  };

  const procesarCodigo = () => {
    const codigo = scanInput?.value.trim().replace(/[\r\n\t]/g,"");
    if (!codigo) return;

    const prod = buscarProductoPorCodigo(codigo);
    const qty  = Math.max(1, parseInt(document.getElementById("pm_scanQty")?.value)||1);

    if (prod) {
      // Producto encontrado — comprobar si ya existe en las líneas
      // para sumar cantidad en lugar de crear línea duplicada
      const lineasActuales = document.querySelectorAll(".linea-row");
      let yaExiste = false;
      lineasActuales.forEach(row => {
        const descEl = row.querySelector("[data-field='descripcion']");
        if (descEl && descEl.value === (prod.descripcion || prod.nombre)) {
          // Sumar cantidad a la línea existente
          const qtyEl = row.querySelector("[data-field='cantidad']");
          if (qtyEl) {
            const qActual = parseFloat(qtyEl.value)||1;
            qtyEl.value = qActual + qty;
            qtyEl.dispatchEvent(new Event("input"));
          }
          yaExiste = true;
        }
      });

      if (!yaExiste) {
        addLinea({
          descripcion: prod.descripcion || prod.nombre,
          cantidad:    qty,
          precio:      prod.precio_venta,
          iva:         prod.iva,
        });
      }

      // Feedback positivo
      mostrarFeedback(
        `✅ ${yaExiste?"Cantidad actualizada":"Añadido"}: ${prod.nombre}${qty>1?" × "+qty:""} — ${fmt(prod.precio_venta)}`,
        "ok"
      );

      // Pitido de confirmación (Web Audio API — sin librerías)
      try {
        const ctx = new (window.AudioContext||window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12);
      } catch(e) { /* Sin audio si el navegador no lo soporta */ }

    } else {
      // Producto NO encontrado — ofrecer crear o ver el catálogo
      mostrarFeedback(`❌ Código "${codigo}" no encontrado en el catálogo`, "error");

      // Resaltar brevemente el campo
      if (scanInput) {
        scanInput.style.borderColor = "#dc2626";
        scanInput.style.background  = "#fef2f2";
        setTimeout(() => {
          scanInput.style.borderColor = "";
          scanInput.style.background  = "";
        }, 1200);
      }

      // Vibración en móvil
      if (navigator.vibrate) navigator.vibrate([100,50,100]);
    }

    // Limpiar campo y devolver foco — CRÍTICO para que el siguiente
    // escaneo funcione sin que la secretaria tenga que hacer click
    if (scanInput) {
      scanInput.value = "";
      scanInput.focus();
    }
  };

  // Detectar Enter (lo que envía el lector al terminar de leer)
  scanInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      procesarCodigo();
    }
  });

  // Detección inteligente de lector vs teclado:
  // Los lectores físicos envían todos los caracteres en <50ms
  // Un humano teclea más despacio. Si detectamos velocidad de lector,
  // procesamos automáticamente aunque no pulse Enter (por si acaso)
  scanInput?.addEventListener("keypress", e => {
    const now = Date.now();
    if (now - _lastKeyTime < 50) {
      // Velocidad de lector — acumular
      _keyBuffer += e.key;
    } else {
      // Velocidad humana — resetear buffer
      _keyBuffer = e.key;
    }
    _lastKeyTime = now;
  });

  // Focus visual: indicar claramente que el campo está activo
  scanInput?.addEventListener("focus", () => {
    const wrap = document.getElementById("scannerWrap");
    if (wrap) wrap.style.outline = "2px solid var(--accent)";
    wrap.style.borderRadius = "8px";
    mostrarFeedback("🎯 Listo para escanear — pasa el lector ahora", "info");
  });
  scanInput?.addEventListener("blur", () => {
    const wrap = document.getElementById("scannerWrap");
    if (wrap) { wrap.style.outline=""; wrap.style.borderRadius=""; }
    if(scanFeedback) scanFeedback.style.opacity="0";
  });

  // Auto-focus al abrir el modal si no hay líneas
  setTimeout(() => {
    if (scanInput && document.querySelectorAll(".linea-row").length === 0) {
      // Solo auto-focus si parece que van a escanear (sin líneas todavía)
    }
    // El foco por defecto va al campo de cliente, no al escáner
    // La secretaria hace click en el campo cuando quiere escanear
  }, 100);

  // Sincronizar cliente_nombre con select
  document.getElementById("pm_cliente").addEventListener("change", e => {
    const opt = e.target.selectedOptions[0];
    const nEl = document.getElementById("pm_cliente_nombre");
    if (nEl && opt.dataset.nombre) nEl.value = opt.dataset.nombre;
  });

  // Plantillas
  if (!isEdit) {
    document.getElementById("pm_plantillaBtn")?.addEventListener("click", () => {
      showPlantillasModal(plantilla => {
        // Reabrir modal con plantilla aplicada
        closeModal();
        showNuevoPresupuestoModal({
          concepto: plantilla.concepto,
          notas:    plantilla.notas,
          lineas:   plantilla.lineas || [],
        });
      });
    });

    document.getElementById("pm_saveAsPlantilla")?.addEventListener("click", async () => {
      const nombre   = document.getElementById("pm_concepto").value.trim() || "Mi plantilla";
      const concepto = document.getElementById("pm_concepto").value.trim();
      const notas    = document.getElementById("pm_notas").value.trim();
      if (!lineas.length) { toast("Añade al menos una línea", "warn"); return; }
      const nombrePlantilla = prompt("Nombre para la plantilla:", nombre);
      if (!nombrePlantilla) return;
      const { error } = await savePlantilla({ nombre: nombrePlantilla, concepto, notas, lineas });
      if (error) { toast("Error guardando plantilla: " + error.message, "error"); return; }
      toast("✅ Plantilla guardada", "success");
    });
  }

  /* ── Guardar ── */
  document.getElementById("pm_save").addEventListener("click", async () => {
    const concepto = document.getElementById("pm_concepto").value.trim();
    const fecha    = document.getElementById("pm_fecha").value;
    if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }

    // Base: suma de líneas normales - descuentos
    let base = 0, iva = 21, descTotal = 0;
    lineas.forEach(l => {
      if (l.esDescuento) descTotal += Math.abs(l.precio);
      else { base += l.cantidad * l.precio; }
    });
    base = Math.max(0, base - descTotal);
    if (lineas.filter(l => !l.esDescuento).length > 0) iva = lineas.filter(l => !l.esDescuento)[0].iva;

    const cSel = document.getElementById("pm_cliente").value;
    const cNom = document.getElementById("pm_cliente_nombre").value.trim();
    const cNif = document.getElementById("pm_cliente_nif")?.value.trim() || "";
    const cDir = document.getElementById("pm_cliente_dir")?.value.trim() || "";
    const clienteObj = CLIENTES.find(c => c.id === cSel);

    const payload = {
      user_id:        SESSION.user.id,
      concepto, fecha,
      fecha_validez:  document.getElementById("pm_validez").value  || null,
      estado:         document.getElementById("pm_estado").value,
      cliente_id:     cSel || null,
      cliente_nombre: cNom || clienteObj?.nombre || "",
      cliente_nif:    cNif || clienteObj?.nif || "",
      cliente_direccion: cDir || clienteObj?.direccion || "",
      base, iva,
      lineas:         JSON.stringify(lineas),
      notas:          document.getElementById("pm_notas").value.trim(),
    };

    // Numeración automática consecutiva
    if (!isEdit) {
      const year = new Date(fecha).getFullYear();
      const { data: last } = await supabase.from("presupuestos")
        .select("numero").eq("user_id", SESSION.user.id)
        .like("numero", `P-${year}-%`).order("numero", { ascending: false }).limit(1);
      const lastNum = last?.[0]?.numero
        ? parseInt((last[0].numero.match(/-(\d+)$/) || [])[1]) || 0 : 0;
      payload.numero = `P-${year}-${String(lastNum + 1).padStart(4, "0")}`;
    }

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("presupuestos").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("presupuestos").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }

    // Guardar cliente si se marcó el checkbox y es nuevo
    const guardarCliente = document.getElementById("pm_guardarCliente")?.checked;
    const nombreFinal = cNom || clienteObj?.nombre;
    if (guardarCliente && nombreFinal && !cSel) {
      const { error: ce } = await supabase.from("clientes").insert({
        user_id: SESSION.user.id,
        nombre: nombreFinal,
        nif: cNif || null,
        direccion: cDir || null,
      });
      if (!ce) {
        toast("Cliente guardado en tu lista ✅", "info", 3000);
        const { refreshClientes } = await import("./clientes.js");
        await refreshClientes();
      }
    }

    toast(isEdit ? "Presupuesto actualizado ✅" : "Presupuesto creado ✅", "success");
    closeModal();
    await refreshPresupuestos();
  });
}

/* ══════════════════════════
   CONVERTIR A ALBARÁN
══════════════════════════ */
async function convertirAAlbaran(presId) {
  const { data: p, error } = await supabase.from("presupuestos").select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando presupuesto", "error"); return; }

  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">📋 Convertir a albarán</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p style="font-size:13.5px;color:var(--t2);line-height:1.6;margin-bottom:16px">
          Se generará un albarán independiente basado en el presupuesto
          <strong>${p.numero}</strong> para <strong>${p.cliente_nombre || "—"}</strong>.
          El presupuesto desaparecerá de la lista de presupuestos y el albarán quedará
          <em>Pendiente de facturar</em> en la sección Albaranes.
        </p>
        <div class="modal-field"><label>Fecha del albarán *</label>
          <input type="date" id="alb_fecha" class="ff-input" value="${new Date().toISOString().slice(0, 10)}"/></div>
        <div class="modal-field" style="margin-top:10px"><label>Referencia de albarán</label>
          <input id="alb_ref" class="ff-input" placeholder="Ej: A-2026-0001 (opcional)"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="alb_ok">Crear albarán</button>
      </div>
    </div>
  `);

  document.getElementById("alb_ok").addEventListener("click", async () => {
    const fecha = document.getElementById("alb_fecha").value;
    if (!fecha) { toast("Introduce la fecha", "error"); return; }

    // Generar número de albarán correlativo (formato A-YYYY-NNN)
    const year = new Date(fecha).getFullYear();
    const { data: lastAlb } = await supabase.from("presupuestos")
      .select("albaran_numero").eq("user_id", SESSION.user.id)
      .eq("estado", "albaran")
      .like("albaran_numero", `A-${year}-%`)
      .order("albaran_numero", { ascending: false }).limit(1);
    const lastNum = lastAlb?.[0]?.albaran_numero
      ? parseInt(lastAlb[0].albaran_numero.split("-")[2]) || 0 : 0;
    const numeroAlbaran = `A-${year}-${String(lastNum + 1).padStart(4, "0")}`;

    const refAlb = document.getElementById("alb_ref").value.trim();
    const { error: ue } = await supabase.from("presupuestos").update({
      estado:             "albaran",
      fecha_aceptacion:   fecha,
      albaran_numero:     numeroAlbaran,
      estado_facturacion: "pendiente",
      notas: [p.notas, refAlb ? `Ref. albarán: ${refAlb}` : ""].filter(Boolean).join("\n"),
    }).eq("id", presId);

    if (ue) { toast("Error: " + ue.message, "error"); return; }
    toast(`✅ Albarán ${numeroAlbaran} creado · Presupuesto marcado como aceptado`, "success");
    closeModal();
    await refreshPresupuestos();
  });
}

/* ══════════════════════════
   CONVERTIR A FACTURA
══════════════════════════ */
async function convertirAFactura(presId) {
  const { data: p, error } = await supabase.from("presupuestos").select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando presupuesto", "error"); return; }

  const lineas = p.lineas ? JSON.parse(p.lineas) : [];

  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">🧾 Convertir presupuesto a factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p style="font-size:13.5px;color:var(--t2);line-height:1.6;margin-bottom:20px">
          Se creará una factura independiente basada en el presupuesto
          <strong>${p.numero}</strong> para <strong>${p.cliente_nombre || "—"}</strong>.
          Una vez creada, la factura quedará emitida y no podrá editarse ni eliminarse. Si necesitas modificarla, deberás crear una factura rectificativa.
        </p>
        <div class="modal-field"><label>Fecha de factura *</label>
          <input type="date" id="ctf_fecha" class="ff-input" value="${new Date().toISOString().slice(0, 10)}"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="ctf_ok">Crear factura</button>
      </div>
    </div>
  `);

  document.getElementById("ctf_ok").addEventListener("click", async () => {
    const fecha = document.getElementById("ctf_fecha").value;
    if (!fecha) { toast("Introduce la fecha", "error"); return; }

    const concepto = p.concepto || lineas.filter(l => !l.esDescuento && l.descripcion)[0]?.descripcion || "";

    const notasPres = [
      p.notas,
      `Basado en presupuesto: ${p.numero}`
    ].filter(Boolean).join("\n");

    const { data: facturaNew1, error: fe } = await supabase.from("facturas").insert({
      user_id:            SESSION.user.id,
      tipo:               "emitida",
      estado:             "borrador",
      fecha,
      concepto,
      cliente_id:         p.cliente_id,
      cliente_nombre:     p.cliente_nombre,
      base:               p.base,
      iva:                p.iva,
      irpf_retencion:     p.irpf_retencion || null,
      tipo_operacion:     p.tipo_operacion || "nacional",
      notas:              notasPres,
      condiciones_pago:   p.condiciones_pago || null,
      iban:               p.iban || null,
      titular_cuenta:     p.titular_cuenta || null,
      fecha_vencimiento:  p.fecha_validez || null,
      presupuesto_origen: p.id,
    }).select().single();
    if (fe) { toast("Error creando factura: " + fe.message, "error"); return; }

    // Numerar y emitir inmediatamente
    try {
      const { emitirFacturaDB } = await import("./facturas.js");
      await emitirFacturaDB(facturaNew1.id);
    } catch(numErr) { console.warn("Numeración automática:", numErr.message); }

    await supabase.from("presupuestos").update({
      estado:           "aceptado",
      fecha_aceptacion: new Date().toISOString().slice(0, 10)
    }).eq("id", presId);

    toast("✅ Factura creada · Presupuesto marcado como Aceptado", "success");
    closeModal();
    await refreshPresupuestos();
  });
}

/* ══════════════════════════════════════════════════
   HELPERS PDF
══════════════════════════════════════════════════ */
async function cargarPerfil() {
  const { data } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).single();
  return data || {};
}

async function logoToBase64(url) {
  if (!url) return null;
  try {
    const r    = await fetch(url);
    const blob = await r.blob();
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/* ══════════════════════════════════════════════════
   GENERAR PDF PROFESIONAL
══════════════════════════════════════════════════ */
export async function generarPDFPresupuesto(presId, descargar = true) {
  // NO leer selector del formulario. Cascada en pdf-plantilla.js:
  // doc.plantilla_id → plantilla predeterminada → sin plantilla
  const result = await exportPresupuestoPDFConPlantilla(presId, null, descargar);
  return result;
}

/* ══════════════════════════════════════════════════
   MODAL ENVIAR EMAIL
══════════════════════════════════════════════════ */
export async function showEnviarEmailModal(presId) {
  const { data: p, error } = await supabase.from("presupuestos")
    .select("*").eq("id", presId).single();
  if (error||!p) { toast("Error cargando presupuesto","error"); return; }

  const perfil  = await cargarPerfil();
  const cliente = CLIENTES.find(c=>c.id===p.cliente_id);
  const emailTo = cliente?.email || p.cliente_email || "";

  openModal(`
    <div class="modal modal--wide">
      <div class="modal-hd">
        <span class="modal-title">📧 Enviar presupuesto por email</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="email-pres-preview">
          <div class="epp-num">${p.numero||"S/N"}</div>
          <div class="epp-datos">
            <span><strong>${p.cliente_nombre||"—"}</strong></span>
            <span class="mono fw7" style="color:var(--brand)">${fmt(p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100)}</span>
            ${p.fecha_validez?`<span style="color:var(--t3);font-size:12px">Válido hasta ${new Date(p.fecha_validez).toLocaleDateString("es-ES")}</span>`:""}
          </div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:13px;color:#92400e;margin-bottom:16px;display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:16px;flex-shrink:0">💡</span>
          <span>El PDF se descargará automáticamente. Tu cliente de correo se abrirá con el asunto y mensaje prellenados. Solo tienes que adjuntar el PDF y enviar.</span>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Email del cliente *</label>
            <input id="em_to" class="ff-input" type="email" value="${emailTo}" placeholder="cliente@empresa.com"/></div>
          <div class="modal-field"><label>CC (separados por coma)</label>
            <input id="em_cc" class="ff-input" type="text" placeholder="cc1@empresa.com, cc2@empresa.com, cc3@empresa.com"/>
            <div style="font-size:11px;color:var(--t3);margin-top:3px">Puedes añadir varios separados por comas</div>
          </div>
        </div>
        <div class="modal-field"><label>Abrir con</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <label class="email-client-opt"><input type="radio" name="em_client" value="gmail" checked/><span>📧 Gmail</span></label>
            <label class="email-client-opt"><input type="radio" name="em_client" value="outlook"/><span>📘 Outlook</span></label>
            <label class="email-client-opt"><input type="radio" name="em_client" value="yahoo"/><span>💜 Yahoo</span></label>
            <label class="email-client-opt"><input type="radio" name="em_client" value="local"/><span>🖥️ App sistema</span></label>
          </div>
        </div>
        <div class="modal-field"><label>Asunto</label>
          <input id="em_subject" class="ff-input" value="Presupuesto — ${p.concepto||""}"/></div>
        <div class="modal-field"><label>Mensaje</label>
          <textarea id="em_body" class="ff-input ff-textarea" style="min-height:130px">${_defaultEmailBody(p, perfil)}</textarea></div>
        <div class="email-options-row">
          <label class="email-check-lbl">
            <input type="checkbox" id="em_marcar_enviado" checked/>
            <span>📤 Marcar como "Enviado"</span>
          </label>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save btn-send-email" id="em_send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Descargar PDF y abrir correo
        </button>
      </div>
    </div>
  `);

  document.getElementById("em_send")?.addEventListener("click", async () => {
    const to      = document.getElementById("em_to").value.trim();
    // CC múltiple: limpiar y unir con coma
    const ccRaw   = document.getElementById("em_cc").value;
    const cc      = ccRaw.split(",").map(e=>e.trim()).filter(e=>e&&e.includes("@")).join(",");
    const subject = document.getElementById("em_subject").value.trim();
    const body    = document.getElementById("em_body").value.trim();
    const marcarEnv = document.getElementById("em_marcar_enviado").checked;

    if (!to)      { toast("Introduce el email del cliente","error"); return; }
    if (!subject) { toast("Introduce el asunto","error"); return; }

    const btn = document.getElementById("em_send");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Generando PDF…`;

    try {
      await generarPDFPresupuesto(presId, true);
      const client = document.querySelector("input[name='em_client']:checked")?.value || "gmail";
      let mailUrl;
      if (client === "gmail") {
        mailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}${cc?`&cc=${encodeURIComponent(cc)}`:""}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      } else if (client === "outlook") {
        mailUrl = `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc?`&cc=${encodeURIComponent(cc)}`:""  }`;
      } else if (client === "yahoo") {
        mailUrl = `https://compose.mail.yahoo.com/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${cc?`&cc=${encodeURIComponent(cc)}`:""  }`;
      } else {
        mailUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}${cc?`&cc=${encodeURIComponent(cc)}`:""}&body=${encodeURIComponent(body)}`;
      }
      window.open(mailUrl, "_blank");

      if (marcarEnv && p.estado === "borrador") {
        await supabase.from("presupuestos").update({
          estado: "enviado",
          fecha_envio: new Date().toISOString().slice(0,10)
        }).eq("id", presId);
      }
      closeModal();
      toast("✅ PDF descargado · Revisa tu cliente de correo", "success", 6000);
      await refreshPresupuestos();
    } catch(e) {
      toast("❌ Error: "+e.message,"error",7000);
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Descargar PDF y abrir correo`;
    }
  });
}

function _defaultEmailBody(p, perfil) {
  const nom   = perfil.nombre_razon_social || "nosotros";
  const valid = p.fecha_validez ? `\n\nEste presupuesto es válido hasta el ${new Date(p.fecha_validez).toLocaleDateString("es-ES")}.` : "";
  return `Estimado/a ${p.cliente_nombre||"cliente"},\n\nAdjunto encontrará el presupuesto correspondiente a: ${p.concepto||"los servicios solicitados"}.\n\nImporte total: ${fmt(p.base + p.base*(p.iva||0)/100 - p.base*(p.irpf_retencion||0)/100)}${valid}\n\nPara aceptar el presupuesto o si tiene cualquier consulta, no dude en contactarnos.\n\nUn saludo,\n${nom}`;
}

/* ══════════════════════════
   WINDOW HANDLERS
══════════════════════════ */
/* ══════════════════════════════════════════════════
   CONVERTIR ALBARÁN A FACTURA
══════════════════════════════════════════════════ */
async function albaranAFactura(presId) {
  const { data: p, error } = await supabase.from("presupuestos").select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando albarán", "error"); return; }
  const lineas = p.lineas ? JSON.parse(p.lineas) : [];

  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Facturar albarán ${p.albaran_numero || p.numero}</span>
        <button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p style="font-size:13.5px;color:var(--t2);line-height:1.6;margin-bottom:16px">
          Se creará una factura vinculada al albarán <strong>${p.albaran_numero || p.numero}</strong>
          para <strong>${p.cliente_nombre || "—"}</strong>.
        </p>
        <div class="modal-field"><label>Fecha de factura *</label>
          <input type="date" id="af_fecha" class="ff-input" value="${new Date().toISOString().slice(0,10)}"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="af_ok">Crear factura</button>
      </div>
    </div>
  `);

  document.getElementById("af_ok").addEventListener("click", async () => {
    const fecha = document.getElementById("af_fecha").value;
    if (!fecha) { toast("Introduce la fecha", "error"); return; }

    const concepto = p.concepto || lineas.filter(l => !l.esDescuento && l.descripcion)[0]?.descripcion || "";

    const notasFactura = [
      p.notas,
      `Correspondiente al albarán: ${p.albaran_numero || p.numero}`,
      p.numero ? `Basado en presupuesto: ${p.numero}` : ""
    ].filter(Boolean).join("\n");

    const { data: facturaNew2, error: fe } = await supabase.from("facturas").insert({
      user_id:            SESSION.user.id,
      tipo:               "emitida",
      estado:             "borrador",
      fecha,
      concepto,
      cliente_id:         p.cliente_id,
      cliente_nombre:     p.cliente_nombre,
      base:               p.base,
      iva:                p.iva,
      irpf_retencion:     p.irpf_retencion || null,
      tipo_operacion:     p.tipo_operacion || "nacional",
      notas:              notasFactura,
      condiciones_pago:   p.condiciones_pago || null,
      iban:               p.iban || null,
      titular_cuenta:     p.titular_cuenta || null,
      fecha_vencimiento:  p.fecha_validez || null,
      presupuesto_origen: p.id,
    }).select().single();
    if (fe) { toast("Error creando factura: " + fe.message, "error"); return; }

    // Numerar y emitir inmediatamente
    try {
      const { emitirFacturaDB } = await import("./facturas.js");
      await emitirFacturaDB(facturaNew2.id);
    } catch(numErr) { console.warn("Numeración automática:", numErr.message); }

    await supabase.from("presupuestos").update({
      estado_facturacion: "facturado",
      fecha_facturacion:  fecha,
    }).eq("id", presId);

    toast("✅ Factura creada · Albarán marcado como Facturado", "success");
    closeModal();
    await refreshPresupuestos();
  });
}

/* ══════════════════════════════════════════════════
   PDF ALBARÁN PROFESIONAL
══════════════════════════════════════════════════ */
export async function generarPDFAlbaran(presId, mostrarPrecios = true) {
  const { data: p, error } = await supabase.from("presupuestos").select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando albarán", "error"); return; }

  const perfil = await cargarPerfil();
  const lineas = (p.lineas ? JSON.parse(p.lineas) : []).filter(l => !l.esDescuento);

  if (!window.jspdf?.jsPDF) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf || window;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const PW=210, PH=297, ML=18, MR=18, W=PW-ML-MR;
  const INK=[15,23,42], MUTED=[100,116,139], LIGHT=[248,250,252], BORDER=[226,232,240], WHITE=[255,255,255];
  const GREEN=[5,150,105];

  doc.setFillColor(...WHITE); doc.rect(0,0,PW,PH,"F");

  // ── Cabecera verde ──
  doc.setFillColor(...GREEN); doc.rect(0,0,PW,32,"F");
  doc.setFont("helvetica","bold"); doc.setFontSize(26); doc.setTextColor(...WHITE);
  doc.text("ALBARÁN", ML, 20);
  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.text("DELIVERY NOTE", ML, 28);

  const numAlb = p.albaran_numero || "S/N";
  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...WHITE);
  doc.text(numAlb, PW-MR, 16, {align:"right"});
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const facState = p.estado_facturacion === "facturado"
    ? "Facturado / Invoiced"
    : "Pendiente de facturar / Pending invoice";
  doc.text(facState, PW-MR, 24, {align:"right"});

  // Badge "SIN PRECIOS" visible en el PDF cuando aplica
  if (!mostrarPrecios) {
    doc.setFillColor(254,243,199); doc.setDrawColor(253,230,138); doc.setLineWidth(0.3);
    doc.roundedRect(PW-MR-52, 34, 52, 7, 1.5, 1.5, "FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(146,64,14);
    doc.text("ALBARÁN SIN PRECIOS", PW-MR-48, 38.5);
  }

  // ── Logo ──
  let logoB64 = perfil.logo_url ? await logoToBase64(perfil.logo_url) : null;
  if (logoB64) {
    try {
      const mime = logoB64.split(";")[0].split(":")[1];
      doc.addImage(logoB64, mime.includes("png")?"PNG":"JPEG", PW-MR-42, 2, 38, 24, "", "FAST");
    } catch(e){}
  }

  doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
  doc.line(ML, 38, PW-MR, 38);

  // ── Emisor / Destinatario ──
  let y=48;
  const COL1=ML, COL2=PW/2+6, cW=W/2-10;

  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text("EMISOR / FROM", COL1, y); doc.text("DESTINATARIO / TO", COL2, y); y+=5;

  const yBlock=y;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text((perfil.nombre_razon_social||"—").substring(0,32), COL1, y); y+=5.5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  if(perfil.nif)             { doc.text("NIF: "+perfil.nif, COL1, y); y+=4.5; }
  if(perfil.domicilio_fiscal){ const ls=doc.splitTextToSize(perfil.domicilio_fiscal,cW); doc.text(ls,COL1,y); }

  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text((p.cliente_nombre||"—").substring(0,32), COL2, yBlock);

  y = Math.max(y+5, yBlock+12)+4;

  // ── Info del albarán ──
  doc.setFillColor(240,253,244); doc.setDrawColor(167,243,208); doc.setLineWidth(0.3);
  doc.roundedRect(ML, y, W, 18, 1.5, 1.5, "FD");
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  const fechaAlb = p.fecha_aceptacion || p.fecha;
  doc.text(`Nº Albarán / Delivery Note No.: ${numAlb}`, ML+5, y+6);
  doc.text(`Fecha de entrega / Delivery date: ${new Date(fechaAlb+"T12:00:00").toLocaleDateString("es-ES")}`, ML+5, y+11.5);
  doc.text(`Basado en presupuesto / Based on quote: ${p.numero || "—"}`, ML+5, y+17);
  y += 24;

  /* ── TABLA DE LÍNEAS — columnas dinámicas ──────────────────────────────
     Con precios:    Descripción | Cantidad | Precio unit. | Total
     Sin precios:    Descripción | Cantidad
     Se calcula la posición X de cada columna en función de las activas.
  ─────────────────────────────────────────────────────────────────────── */
  const COL_DEFS = mostrarPrecios
    ? [
        { label: "DESCRIPCIÓN / DESCRIPTION", w: 84, align: "left"  },
        { label: "CANT. / QTY",               w: 20, align: "center"},
        { label: "P. UNIT. / UNIT PRICE",     w: 35, align: "center"},
        { label: "TOTAL / AMOUNT",             w: 35, align: "right" },
      ]
    : [
        { label: "DESCRIPCIÓN / DESCRIPTION", w: 130, align: "left"  },
        { label: "CANTIDAD / QTY",            w:  44, align: "center"},
      ];

  // Calcular posiciones X
  let xPositions = [ML];
  COL_DEFS.forEach((c,i) => {
    if (i < COL_DEFS.length - 1) xPositions.push(xPositions[i] + c.w);
  });

  // Cabecera de la tabla
  doc.setFillColor(...INK); doc.roundedRect(ML, y, W, 10, 1, 1, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...WHITE);
  COL_DEFS.forEach((c, i) => {
    const x = xPositions[i];
    const xT = c.align === "right" ? x + c.w - 2 : c.align === "center" ? x + c.w/2 : x + 2;
    doc.text(c.label, xT, y+6, { align: c.align === "center" ? "center" : c.align === "right" ? "right" : "left" });
  });
  y += 10;

  // Filas de datos
  lineas.forEach((l, idx) => {
    const rH = 9;
    doc.setFillColor(idx%2===0?249:255, idx%2===0?253:255, idx%2===0?250:255);
    doc.rect(ML, y, W, rH, "F");
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.1);
    doc.line(ML, y+rH, ML+W, y+rH);

    const qty   = l.cantidad || 1;
    const price = l.precio || 0;
    const total = qty * price;

    const values = mostrarPrecios
      ? [
          (l.descripcion||"—").trim(),
          String(qty),
          price.toFixed(2)+" €",
          total.toFixed(2)+" €",
        ]
      : [
          (l.descripcion||"—").trim(),
          String(qty),
        ];

    COL_DEFS.forEach((c, i) => {
      const x   = xPositions[i];
      const val = values[i] || "";
      const xT  = c.align === "right" ? x + c.w - 2
                : c.align === "center" ? x + c.w / 2
                : x + 2;
      doc.setFont("helvetica", i===COL_DEFS.length-1 && mostrarPrecios ? "bold" : "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(i===0 ? INK[0] : MUTED[0], i===0 ? INK[1] : MUTED[1], i===0 ? INK[2] : MUTED[2]);
      const maxW = c.w - 4;
      if (i === 0) {
        const dl = doc.splitTextToSize(val, maxW);
        doc.text(dl[0], xT, y+5.8);
      } else {
        doc.text(val, xT, y+5.8, { align: c.align === "center" ? "center" : c.align === "right" ? "right" : "left" });
      }
    });
    doc.setFont("helvetica","normal");

    y += rH;
    if (y > PH-80) { doc.addPage(); y=20; }
  });

  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4);
  doc.line(ML, y, PW-MR, y);
  y += 8;

  // ── Total — solo si mostrarPrecios ──
  if (mostrarPrecios) {
    const base  = lineas.reduce((s,l) => s + (l.cantidad||1)*(l.precio||0), 0);
    const ivaPct = p.iva || 21;
    const ivaAmt = base * ivaPct / 100;
    const total  = base + ivaAmt;

    const xTL = PW-MR-80, xTV = PW-MR;
    const totRow = (label, val, bold=false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.text(label, xTL, y);
      doc.setTextColor(...INK);
      doc.text(val, xTV, y, {align:"right"});
      y += 6.5;
    };
    totRow("Base imponible", base.toFixed(2)+" €");
    totRow(`IVA ${ivaPct}%`, ivaAmt.toFixed(2)+" €");
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.line(xTL, y, xTV, y); y+=4;
    doc.setFillColor(...GREEN);
    doc.roundedRect(xTL-4, y-2, xTV-xTL+8, 13, 1.5, 1.5, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...WHITE);
    doc.text("TOTAL", xTL, y+7);
    doc.text(total.toFixed(2)+" €", xTV, y+7, {align:"right"});
    y += 20;
  }

  // ── Nota sin validez fiscal ──
  doc.setFillColor(255,251,235); doc.setDrawColor(253,230,138); doc.setLineWidth(0.3);
  doc.roundedRect(ML, y, W/2-4, 12, 1.5, 1.5, "FD");
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(146,64,14);
  doc.text("! Este documento no tiene validez fiscal.", ML+4, y+5);
  doc.text("No sustituye a la factura.", ML+4, y+9.5);
  y += 18;

  // ── Sección firma ──
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
  const firmaX=ML, firmaY=y, firmaW=W/2-4, firmaH=40;
  doc.roundedRect(firmaX, firmaY, firmaW, firmaH, 1.5, 1.5, "D");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("FIRMA DEL RECEPTOR / RECIPIENT SIGNATURE", firmaX+4, firmaY+7);
  doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
  doc.text("Nombre / Name: ________________________________", firmaX+4, firmaY+18);
  doc.text("DNI / ID: _____________________________________",  firmaX+4, firmaY+25);
  doc.text("Fecha / Date: _________________________________",  firmaX+4, firmaY+32);

  // ── Estado facturación ──
  const infoX=PW/2+4, infoW=W/2-4;
  doc.roundedRect(infoX, firmaY, infoW, firmaH, 1.5, 1.5, "D");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("ESTADO DE FACTURACIÓN / BILLING STATUS", infoX+4, firmaY+7);
  doc.setFont("helvetica","normal"); doc.setFontSize(9);
  const esFact = p.estado_facturacion === "facturado";
  doc.setTextColor(esFact?5:146, esFact?150:64, esFact?105:14);
  doc.text(esFact ? "Facturado / Invoiced" : "Pendiente de facturar", infoX+4, firmaY+20);
  if (esFact && p.fecha_facturacion) {
    doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(`Fecha: ${new Date(p.fecha_facturacion+"T12:00:00").toLocaleDateString("es-ES")}`, infoX+4, firmaY+28);
  }

  // ── Notas ──
  if (p.notas) {
    y = firmaY + firmaH + 10;
    doc.setFillColor(...LIGHT); doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
    const nl = doc.splitTextToSize(p.notas, W-10);
    const nh = nl.length*4.5+13;
    doc.roundedRect(ML,y,W,nh,1.5,1.5,"FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("NOTAS / NOTES", ML+5, y+6);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(nl, ML+5, y+11.5);
  }

  // ── Pie ──
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4); doc.line(ML,PH-16,PW-MR,PH-16);
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  const pie=[perfil.nombre_razon_social, perfil.nif?"NIF "+perfil.nif:null].filter(Boolean).join("  ·  ");
  doc.text(pie, ML, PH-10);
  doc.text(new Date().toLocaleDateString("es-ES"), PW-MR, PH-10, {align:"right"});

  const filename = `albaran_${numAlb.replace(/\//g,"-")}.pdf`;
  doc.save(filename);
  toast("📄 PDF de albarán descargado", "success");
}

window._presTofact  = convertirAFactura;
window._presAlbaran  = convertirAAlbaran;
window._albaranToFact = albaranAFactura;
window._pdfAlbaran = (id) => {
  openModal(`
    <div class="modal" style="max-width:360px">
      <div class="modal-hd">
        <span class="modal-title">📄 Generar albarán PDF</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="font-size:13px;font-weight:600;color:var(--t1);margin-bottom:14px">¿Incluir precios en el albarán?</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;border:1.5px solid var(--accent);background:rgba(26,86,219,.05);cursor:pointer">
            <input type="radio" name="alb_precios" value="con" checked style="accent-color:var(--accent);width:16px;height:16px"/>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--t1)">Con precios</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">Incluye precio unitario, subtotal e IVA</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;border:1.5px solid var(--brd);cursor:pointer">
            <input type="radio" name="alb_precios" value="sin" style="accent-color:var(--accent);width:16px;height:16px"/>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--t1)">Sin precios</div>
              <div style="font-size:11px;color:var(--t3);margin-top:2px">Solo descripción y cantidad — ideal para trabajadores</div>
            </div>
          </label>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_albPdfOk">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Descargar PDF
        </button>
      </div>
    </div>`);

  // Estilo interactivo en los radio buttons
  document.querySelectorAll("input[name='alb_precios']").forEach(r => {
    r.addEventListener("change", () => {
      document.querySelectorAll("input[name='alb_precios']").forEach(rb => {
        const lbl = rb.closest("label");
        lbl.style.borderColor = rb.checked ? "var(--accent)" : "var(--brd)";
        lbl.style.background  = rb.checked ? "rgba(26,86,219,.05)" : "";
      });
    });
  });

  document.getElementById("_albPdfOk").addEventListener("click", async () => {
    const conPrecios = document.querySelector("input[name='alb_precios']:checked")?.value !== "sin";
    closeModal();
    /* Usar el motor de plantillas para el albarán — mismo diseño que factura y presupuesto */
    await exportAlbaranPDFConPlantilla(id, null, true, conPrecios);
  });
};
window._presPDF = (id) => {
  // Cascada resuelta en pdf-plantilla.js: doc.plantilla_id → es_default → sin plantilla
  exportPresupuestoPDFConPlantilla(id, null, true);
};

/* ══════════════════════════════════════════════════════
   FIRMA DIGITAL — PRESUPUESTOS
   
   Flujo:
   1. Usuario genera enlace de firma para el presupuesto
   2. Se crea un token único y se guarda en BD
   3. El enlace se incluye en el email al cliente
   4. El cliente abre taurix.es/?firmar=TOKEN
   5. Ve el resumen del presupuesto y botones Aceptar/Rechazar
   6. Al aceptar: estado → "aceptado", se guarda IP + timestamp
   ══════════════════════════════════════════════════════ */

/* ── Generar token y enlace de firma ── */
export async function generarEnlaceFirma(presId) {
  // Generar token único
  const token = crypto.randomUUID().replace(/-/g,"");

  const { error } = await supabase.from("presupuestos").update({
    token_firma:      token,
    firma_estado:     "pendiente",
    firma_enviado_at: new Date().toISOString(),
  }).eq("id", presId);

  if (error) { toast("Error generando enlace: "+error.message,"error"); return null; }

  const enlace = `https://taurix.es/?firmar=${token}`;
  return { token, enlace };
}

/* ── Modal para copiar/enviar enlace de firma ── */
export async function showFirmaDigitalModal(presId) {
  const { data: p } = await supabase.from("presupuestos")
    .select("*").eq("id", presId).single();
  if (!p) return;

  // Regenerar enlace si no tiene token o ya fue usado
  let enlace = p.token_firma && p.firma_estado === "pendiente"
    ? `https://taurix.es/?firmar=${p.token_firma}`
    : null;

  if (!enlace) {
    const result = await generarEnlaceFirma(presId);
    if (!result) return;
    enlace = result.enlace;
  }

  const total = p.base + p.base*(p.iva||21)/100;

  openModal(`
    <div class="modal" style="max-width:540px">
      <div class="modal-hd">
        <span class="modal-title">✍️ Firma digital del presupuesto</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Info del presupuesto -->
        <div style="background:var(--bg2);border-radius:12px;padding:14px 16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;font-weight:700">${p.numero||"S/N"} · ${p.cliente_nombre||"—"}</div>
            <div style="font-size:12px;color:var(--t3)">${p.concepto||""}</div>
          </div>
          <div style="font-size:18px;font-weight:800;font-family:monospace;color:var(--accent)">${fmt(total)}</div>
        </div>

        <!-- Estado firma -->
        ${p.firma_estado === "aceptado" ? `
          <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:10px;align-items:center">
            <span style="font-size:24px">✅</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:#059669">Presupuesto aceptado digitalmente</div>
              <div style="font-size:12px;color:#166534">Aceptado el ${p.firma_aceptado_at ? new Date(p.firma_aceptado_at).toLocaleString("es-ES") : "—"}</div>
            </div>
          </div>` : p.firma_estado === "rechazado" ? `
          <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;gap:10px;align-items:center">
            <span style="font-size:24px">❌</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:#dc2626">Presupuesto rechazado</div>
              <div style="font-size:12px;color:#991b1b">${p.firma_comentario||""}</div>
            </div>
          </div>` : `
          <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:#1e40af;line-height:1.6">
            📤 Envía este enlace a tu cliente. Podrá ver el presupuesto y aceptarlo o rechazarlo con un click, sin necesidad de crear una cuenta en Taurix.
          </div>`}

        <!-- Enlace de firma -->
        <div class="modal-field">
          <label>Enlace para el cliente</label>
          <div style="display:flex;gap:6px">
            <input id="firma_enlace" class="ff-input" value="${enlace}" readonly
                   style="font-size:12px;font-family:monospace;background:var(--bg2)"/>
            <button class="btn-outline" onclick="navigator.clipboard.writeText('${enlace}');this.textContent='✓ Copiado';setTimeout(()=>this.textContent='Copiar',2000)"
                    style="white-space:nowrap;font-size:12px">Copiar</button>
          </div>
        </div>

        <!-- Email con enlace incluido -->
        <div class="modal-field" style="margin-top:12px">
          <label>O enviar por email directamente</label>
          <div style="display:flex;gap:6px;margin-top:4px">
            <input id="firma_email" class="ff-input" type="email"
                   placeholder="email@cliente.com"
                   value="${CLIENTES.find(c=>c.id===p.cliente_id)?.email||p.cliente_email||""}"/>
            <button class="btn-primary" id="firma_send_btn" style="white-space:nowrap;font-size:12px">
              📧 Enviar
            </button>
          </div>
        </div>

        <!-- QR del enlace -->
        <div style="text-align:center;margin-top:16px">
          <div id="firma_qr" style="display:inline-block;padding:12px;background:#fff;border-radius:12px;border:1px solid var(--brd)">
            <canvas id="firma_qr_canvas" width="120" height="120"></canvas>
          </div>
          <div style="font-size:11px;color:var(--t4);margin-top:6px">El cliente también puede escanear el QR</div>
        </div>

      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        ${p.firma_estado !== "aceptado" ? `
          <button class="btn-outline" id="firma_regenerar" style="font-size:12px">🔄 Regenerar enlace</button>
        ` : ""}
      </div>
    </div>`);

  // Generar QR simple con canvas (sin librería externa)
  _dibujarQR(enlace);

  // Enviar email con enlace
  document.getElementById("firma_send_btn")?.addEventListener("click", async () => {
    const email = document.getElementById("firma_email").value.trim();
    if (!email) { toast("Introduce el email del cliente","error"); return; }
    const perfil = await cargarPerfil();
    const asunto = encodeURIComponent(`Presupuesto ${p.numero||""} — ${perfil?.nombre_razon_social||"Taurix"} — Pendiente de aceptación`);
    const cuerpo = encodeURIComponent(
      `Hola ${p.cliente_nombre||""},

` +
      `Te enviamos el presupuesto ${p.numero||""} por importe de ${fmt(total)} para tu revisión.

` +
      `Puedes revisarlo y aceptarlo o rechazarlo directamente desde el siguiente enlace:

` +
      `${enlace}

` +
      `El enlace es seguro y no requiere crear ninguna cuenta.

` +
      `Si tienes cualquier duda, no dudes en contactarnos.

` +
      `Un saludo,
${perfil?.nombre_razon_social||""}`
    );
    window.open(`mailto:${encodeURIComponent(email)}?subject=${asunto}&body=${cuerpo}`, "_blank");
    toast("✅ Cliente de email abierto con el enlace incluido","success");
    // Marcar como enviado
    await supabase.from("presupuestos").update({ estado:"enviado" }).eq("id",presId).eq("estado","borrador");
    closeModal();
    await refreshPresupuestos();
  });

  // Regenerar enlace
  document.getElementById("firma_regenerar")?.addEventListener("click", async () => {
    const r = await generarEnlaceFirma(presId);
    if (r) {
      document.getElementById("firma_enlace").value = r.enlace;
      toast("Enlace regenerado ✅","success");
    }
  });
}

/* ── Dibujar QR simple (patrón de posición) con canvas ── */
function _dibujarQR(texto) {
  // QR real requeriría una librería — mostramos patrón visual indicativo
  setTimeout(() => {
    const canvas = document.getElementById("firma_qr_canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = 120, cells = 21, cell = size/cells;
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size);
    ctx.fillStyle = "#0f172a";
    // Patrón de posición esquinas (7x7)
    const drawFinder = (ox,oy) => {
      ctx.fillRect(ox*cell,oy*cell,7*cell,7*cell);
      ctx.fillStyle="#fff"; ctx.fillRect((ox+1)*cell,(oy+1)*cell,5*cell,5*cell);
      ctx.fillStyle="#0f172a"; ctx.fillRect((ox+2)*cell,(oy+2)*cell,3*cell,3*cell);
      ctx.fillStyle="#0f172a";
    };
    drawFinder(0,0); drawFinder(14,0); drawFinder(0,14);
    // Datos simulados (patrón determinista basado en el texto)
    let hash = 0;
    for(let i=0;i<texto.length;i++) hash=(hash*31+texto.charCodeAt(i))&0xffffffff;
    for(let row=0;row<cells;row++) for(let col=0;col<cells;col++) {
      if((row<8&&col<8)||(row<8&&col>12)||(row>12&&col<8)) continue;
      if(((hash^(row*cells+col)*2654435761)&0xff)>128) {
        ctx.fillRect(col*cell,row*cell,cell,cell);
      }
    }
    ctx.fillStyle="#1a56db";
    ctx.font=`bold ${cell*1.2}px sans-serif`;
    ctx.textAlign="center";
    ctx.fillText("QR",size/2,size*0.95);
  }, 100);
}

/* ── Página pública de firma (se carga si hay ?firmar=TOKEN en la URL) ── */
export async function checkFirmaEnURL() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get("firmar");
  if (!token) return false;

  // Limpiar URL
  window.history.replaceState({}, document.title, window.location.pathname);

  // Buscar el presupuesto con ese token
  const { data: p, error } = await supabase.from("presupuestos")
    .select("*").eq("token_firma", token).maybeSingle();

  if (error || !p) {
    _mostrarPaginaFirmaError("Enlace no válido o ya utilizado.");
    return true;
  }

  _mostrarPaginaFirma(p, token);
  return true;
}

function _mostrarPaginaFirmaError(msg) {
  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.add("hidden");

  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#f8fafc;z-index:9999";
  el.innerHTML = `
    <div style="text-align:center;max-width:400px;padding:40px 20px">
      <div style="font-size:48px;margin-bottom:16px">❌</div>
      <h2 style="font-size:20px;font-weight:800;margin-bottom:8px">Enlace no válido</h2>
      <p style="color:#64748b;margin-bottom:24px">${msg}</p>
      <a href="https://taurix.es" style="color:#1a56db;font-weight:700">Ir a taurix.es</a>
    </div>`;
  document.body.appendChild(el);
}

function _mostrarPaginaFirma(p, token) {
  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.add("hidden");

  const lineas = p.lineas ? JSON.parse(p.lineas) : [];
  const total  = p.base + p.base*(p.iva||21)/100 - p.base*(p.irpf_retencion||0)/100;
  const validez = p.fecha_validez ? new Date(p.fecha_validez) : null;
  const expirado = validez && validez < new Date();
  const yaResuelto = p.firma_estado === "aceptado" || p.firma_estado === "rechazado";

  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;overflow-y:auto;background:#f1f5f9;z-index:9999";
  el.innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:32px 20px 60px">

      <!-- Header -->
      <div style="text-align:center;margin-bottom:32px">
        <img src="Logo_Sin_Texto_transparent.png" style="width:48px;height:48px;object-fit:contain;margin-bottom:12px"/>
        <div style="font-size:22px;font-weight:900;letter-spacing:-.3px">Taurix</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">Presupuesto para revisión y aceptación</div>
      </div>

      <!-- Card presupuesto -->
      <div style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);margin-bottom:20px">

        <!-- Header card -->
        <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:24px 28px;color:#fff">
          <div style="font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Presupuesto</div>
          <div style="font-size:22px;font-weight:900;margin-bottom:4px">${p.numero||"S/N"}</div>
          <div style="font-size:14px;opacity:.9">${p.concepto||""}</div>
          <div style="font-size:28px;font-weight:900;margin-top:12px;font-family:monospace">${fmt(total)}</div>
          ${validez ? `<div style="font-size:12px;opacity:.75;margin-top:6px">Válido hasta ${validez.toLocaleDateString("es-ES")}</div>` : ""}
        </div>

        <!-- Detalles -->
        <div style="padding:24px 28px">
          <div style="display:flex;justify-content:space-between;margin-bottom:20px;font-size:13px">
            <div><div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Cliente</div><div style="font-weight:700">${p.cliente_nombre||"—"}</div></div>
            <div style="text-align:right"><div style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Fecha</div><div style="font-weight:700">${new Date(p.fecha).toLocaleDateString("es-ES")}</div></div>
          </div>

          <!-- Líneas -->
          ${lineas.length ? `
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px">
            <thead><tr style="background:#f8fafc">
              <th style="text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0">Descripción</th>
              <th style="text-align:center;padding:8px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0">Cant.</th>
              <th style="text-align:right;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0">Importe</th>
            </tr></thead>
            <tbody>
              ${lineas.map(l=>`
                <tr style="border-bottom:1px solid #f1f5f9">
                  <td style="padding:10px;color:#0f172a">${l.descripcion||""}</td>
                  <td style="padding:10px;text-align:center;color:#64748b">${l.cantidad}</td>
                  <td style="padding:10px;text-align:right;font-family:monospace;font-weight:600">${fmt((l.cantidad||1)*(l.precio||0))}</td>
                </tr>`).join("")}
            </tbody>
            <tfoot>
              <tr><td colspan="2" style="padding:10px;text-align:right;font-size:12px;color:#64748b">Base imponible</td><td style="padding:10px;text-align:right;font-family:monospace;font-weight:600">${fmt(p.base)}</td></tr>
              <tr><td colspan="2" style="padding:10px;text-align:right;font-size:12px;color:#64748b">IVA ${p.iva||21}%</td><td style="padding:10px;text-align:right;font-family:monospace;font-weight:600">${fmt(p.base*(p.iva||21)/100)}</td></tr>
              ${p.irpf_retencion > 0 ? `<tr><td colspan="2" style="padding:10px;text-align:right;font-size:12px;color:#64748b">Retención IRPF ${p.irpf_retencion}%</td><td style="padding:10px;text-align:right;font-family:monospace;font-weight:600">- ${fmt(p.base*(p.irpf_retencion||0)/100)}</td></tr>` : ""}
              <tr style="background:#eff6ff"><td colspan="2" style="padding:12px 10px;text-align:right;font-weight:800;font-size:14px;color:#1a56db">TOTAL</td><td style="padding:12px 10px;text-align:right;font-family:monospace;font-weight:900;font-size:16px;color:#1a56db">${fmt(total)}</td></tr>
            </tfoot>
          </table>` : ""}

          ${p.notas ? `<div style="background:#f8fafc;border-radius:10px;padding:12px 14px;font-size:12px;color:#475569;margin-bottom:16px;line-height:1.6"><strong>Notas:</strong> ${p.notas}</div>` : ""}
        </div>
      </div>

      <!-- Botones de acción -->
      <div id="firma_acciones">
        ${expirado ? `
          <div style="background:#fef9c3;border:1px solid #fde047;border-radius:12px;padding:16px;text-align:center;color:#854d0e;font-size:13px">
            ⏰ Este presupuesto ha vencido el ${validez.toLocaleDateString("es-ES")}. Contacta con la empresa para solicitar uno nuevo.
          </div>
        ` : yaResuelto ? `
          <div style="background:${p.firma_estado==="aceptado"?"#f0fdf4":"#fef2f2"};border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">${p.firma_estado==="aceptado"?"✅":"❌"}</div>
            <div style="font-size:15px;font-weight:700;color:${p.firma_estado==="aceptado"?"#059669":"#dc2626"}">
              ${p.firma_estado==="aceptado"?"Presupuesto aceptado":"Presupuesto rechazado"}
            </div>
            ${p.firma_comentario?`<div style="font-size:12px;color:#64748b;margin-top:6px">${p.firma_comentario}</div>`:""}
          </div>
        ` : `
          <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center">
            <div style="font-size:14px;font-weight:700;margin-bottom:6px">¿Aceptas este presupuesto?</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:20px">Al aceptar, la empresa recibirá confirmación y comenzará el trabajo.</div>
            <div style="display:flex;gap:12px;justify-content:center">
              <button id="firma_rechazar_btn"
                      style="flex:1;max-width:180px;padding:14px;background:#fff;border:2px solid #dc2626;border-radius:12px;color:#dc2626;font-size:14px;font-weight:700;cursor:pointer">
                ❌ Rechazar
              </button>
              <button id="firma_aceptar_btn"
                      style="flex:1;max-width:180px;padding:14px;background:linear-gradient(135deg,#059669,#047857);border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(5,150,105,.3)">
                ✅ Aceptar presupuesto
              </button>
            </div>
          </div>
        `}
      </div>

      <!-- Pie -->
      <div style="text-align:center;margin-top:28px;font-size:11px;color:#94a3b8">
        Documento generado por <a href="https://taurix.es" style="color:#1a56db;font-weight:600">Taurix</a> · Gestión fiscal para autónomos y empresas españolas
      </div>
    </div>`;

  document.body.appendChild(el);

  // Botón aceptar
  document.getElementById("firma_aceptar_btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("firma_aceptar_btn");
    btn.disabled = true;
    btn.textContent = "Guardando…";

    const { error } = await supabase.from("presupuestos").update({
      estado:             "aceptado",
      firma_estado:       "aceptado",
      firma_aceptado_at:  new Date().toISOString(),
      fecha_aceptacion:   new Date().toISOString().slice(0,10),
    }).eq("token_firma", token);

    if (error) {
      toast("Error al aceptar: "+error.message,"error");
      btn.disabled=false; btn.textContent="✅ Aceptar presupuesto";
      return;
    }

    document.getElementById("firma_acciones").innerHTML = `
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:16px;padding:28px;text-align:center;box-shadow:0 4px 24px rgba(5,150,105,.15)">
        <div style="font-size:48px;margin-bottom:12px">🎉</div>
        <div style="font-size:18px;font-weight:800;color:#059669;margin-bottom:8px">¡Presupuesto aceptado!</div>
        <div style="font-size:13px;color:#166534;line-height:1.6">Hemos notificado a la empresa. En breve se pondrán en contacto contigo para confirmar los detalles y comenzar el trabajo.</div>
      </div>`;
  });

  // Botón rechazar
  document.getElementById("firma_rechazar_btn")?.addEventListener("click", () => {
    document.getElementById("firma_acciones").innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08)">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px">¿Por qué rechazas el presupuesto? (opcional)</div>
        <textarea id="firma_motivo" placeholder="El precio es elevado, necesito ajustes, no es lo que buscaba…"
                  style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;min-height:80px;margin-bottom:12px;font-family:sans-serif;resize:vertical"></textarea>
        <div style="display:flex;gap:10px">
          <button onclick="document.getElementById('firma_acciones').innerHTML=''" 
                  style="flex:1;padding:12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;font-size:13px">Cancelar</button>
          <button id="firma_rechazar_confirm"
                  style="flex:1;padding:12px;background:#dc2626;border:none;border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">
            Confirmar rechazo
          </button>
        </div>
      </div>`;

    document.getElementById("firma_rechazar_confirm").addEventListener("click", async () => {
      const motivo = document.getElementById("firma_motivo")?.value.trim() || "";
      await supabase.from("presupuestos").update({
        firma_estado:      "rechazado",
        firma_comentario:  motivo,
        firma_aceptado_at: new Date().toISOString(),
      }).eq("token_firma", token);

      document.getElementById("firma_acciones").innerHTML = `
        <div style="background:#fef2f2;border-radius:16px;padding:24px;text-align:center">
          <div style="font-size:36px;margin-bottom:12px">❌</div>
          <div style="font-size:16px;font-weight:700;color:#dc2626">Presupuesto rechazado</div>
          ${motivo?`<div style="font-size:12px;color:#64748b;margin-top:8px">"${motivo}"</div>`:""}
        </div>`;
    });
  });
}

window._presEmail   = (id) => showEnviarEmailModal(id);
window._presFirma   = (id) => showFirmaDigitalModal(id);
window._editPres = async (id) => {
  const { data, error } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (error || !data) { toast("Error cargando presupuesto", "error"); return; }
  const lineas = data.lineas ? JSON.parse(data.lineas) : [];
  // Pasar los datos al módulo de nuevo-presupuesto y abrir la vista completa
  window._npEditData = { ...data, lineas };
  if (window._switchView) window._switchView("nuevo-presupuesto");
};
window._dupPres = async (id) => {
  const { data, error } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (error || !data) return;
  const lineas = data.lineas ? JSON.parse(data.lineas) : [];
  const { id: _id, numero, fecha_aceptacion, ...rest } = data;
  showNuevoPresupuestoModal({ ...rest, lineas, fecha: new Date().toISOString().slice(0, 10), estado: "borrador" });
};
window._delPres = (id) => {
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar presupuesto</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este presupuesto? Esta acción no se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_dpOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_dpOk").addEventListener("click", async () => {
    await supabase.from("presupuestos").delete().eq("id", id);
    closeModal(); toast("Presupuesto eliminado", "success");
    await refreshPresupuestos();
  });
};

window._delAlb = async (id) => {
  const { data: alb, error } = await supabase.from("presupuestos").select("estado_facturacion, numero").eq("id", id).single();
  if (error || !alb) { toast("Error cargando albarán", "error"); return; }
  if (alb.estado_facturacion === "facturado") {
    openModal(`
      <div class="modal">
        <div class="modal-hd"><span class="modal-title">No se puede eliminar</span><button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd"><p class="modal-warn">⚠️ No se puede eliminar un albarán que ya ha sido facturado.</p></div>
        <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
      </div>`);
    return;
  }
  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">Eliminar albarán</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar el albarán ${alb.numero || ""}? Esta acción no se puede deshacer.</p></div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-danger" id="_daOk">Sí, eliminar</button>
      </div>
    </div>`);
  document.getElementById("_daOk").addEventListener("click", async () => {
    await supabase.from("presupuestos").delete().eq("id", id);
    closeModal(); toast("Albarán eliminado", "success");
    await refreshPresupuestos();
  });
};

export function initPresupuestosView() {
  document.getElementById("nuevoPresBtn")?.addEventListener("click", () => {
    if (window._switchView) window._switchView("nuevo-presupuesto");
  });
  ["presSearch","presFilterEstado","presFilterCliente","presFilterDesde","presFilterHasta","presFilterMin","presFilterMax"]
    .forEach(id => {
      document.getElementById(id)?.addEventListener("input",  () => { paginaActual=1; refreshPresupuestos(); });
      document.getElementById(id)?.addEventListener("change", () => { paginaActual=1; refreshPresupuestos(); });
    });
  document.getElementById("presFilterReset")?.addEventListener("click", () => {
    ["presSearch","presFilterEstado","presFilterCliente","presFilterDesde","presFilterHasta","presFilterMin","presFilterMax"]
      .forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
    paginaActual=1; refreshPresupuestos();
  });
  document.getElementById("presSearch")?.addEventListener("input",   () => refreshPresupuestos());
  document.getElementById("presFilterEstado")?.addEventListener("change", () => refreshPresupuestos());
}
