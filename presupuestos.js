/* ═══════════════════════════════════════════════════════
   TUGESTOR · presupuestos.js
   Módulo completo de presupuestos / ofertas
   Convertir a factura, duplicar, PDF, estados
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtDate, toast,
  openModal, closeModal, getYear, getTrim, getFechaRango
} from "./utils.js";

let paginaActual = 1;
const POR_PAGINA = 30;

/* ══════════════════════════
   CARGAR PRESUPUESTOS
══════════════════════════ */
export async function refreshPresupuestos() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const search = (document.getElementById("presSearch")?.value || "").toLowerCase();
  const estadof = document.getElementById("presFilterEstado")?.value || "";
  const desde = (paginaActual - 1) * POR_PAGINA;

  let q = supabase.from("presupuestos").select("*", { count: "exact" })
    .eq("user_id", SESSION.user.id)
    .gte("fecha", ini).lte("fecha", fin)
    .order("fecha", { ascending: false })
    .range(desde, desde + POR_PAGINA - 1);

  if (estadof) q = q.eq("estado", estadof);

  const { data, count, error } = await q;
  if (error) {
    console.error("refreshPresupuestos:", error.message);
    return;
  }

  let presupuestos = data || [];
  if (search) presupuestos = presupuestos.filter(p =>
    (p.concepto || "").toLowerCase().includes(search) ||
    (p.numero || "").toLowerCase().includes(search) ||
    (p.cliente_nombre || "").toLowerCase().includes(search)
  );

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
    enviado:   `<span class="badge b-pendiente">📤 Enviado</span>`,
    aceptado:  `<span class="badge b-cobrada">✅ Aceptado</span>`,
    rechazado: `<span class="badge b-vencida">❌ Rechazado</span>`,
    expirado:  `<span class="badge" style="background:#f3f4f6;color:#6b7280">⏰ Expirado</span>`,
  };

  tbody.innerHTML = presupuestos.map(p => {
    const total = p.base + (p.base * p.iva / 100);
    const hoy = new Date().toISOString().slice(0, 10);
    const vencido = p.fecha_validez && p.fecha_validez < hoy && p.estado !== "aceptado";
    return `
      <tr>
        <td class="mono" style="font-size:12px">${fmtDate(p.fecha)}</td>
        <td><span class="badge b-income mono" style="font-size:11px">${p.numero || "S/N"}</span></td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${p.concepto || "—"}</td>
        <td style="font-size:12px;color:var(--t3)">${p.cliente_nombre || "—"}</td>
        <td class="mono fw7">${fmt(total)}</td>
        <td>${vencido && p.estado !== "aceptado" ? estadoBadge.expirado : (estadoBadge[p.estado] || estadoBadge.borrador)}</td>
        <td style="font-size:12px;color:var(--t4)">${p.fecha_validez ? fmtDate(p.fecha_validez) : "—"}</td>
        <td style="font-size:12px;color:var(--t4)">${p.fecha_aceptacion ? fmtDate(p.fecha_aceptacion) : "—"}</td>
        <td>
          <div class="tbl-act">
            ${p.estado !== "aceptado" ? `<button class="ta-btn ta-emit" onclick="window._presTofact('${p.id}')" title="Convertir a factura">📄→🧾</button>` : ""}
            <button class="ta-btn ta-email" onclick="window._presEmail('${p.id}')" title="Enviar por email">📧</button>
            <button class="ta-btn" onclick="window._presPDF('${p.id}')" title="Descargar PDF">📄</button>
            <button class="ta-btn" onclick="window._editPres('${p.id}')" title="Editar">✏️</button>
            <button class="ta-btn" onclick="window._dupPres('${p.id}')" title="Duplicar">📋</button>
            <button class="ta-btn ta-del" onclick="window._delPres('${p.id}')" title="Eliminar">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join("");

  // KPIs de presupuestos
  const total = presupuestos.reduce((a, p) => a + p.base + p.base * p.iva / 100, 0);
  const aceptados = presupuestos.filter(p => p.estado === "aceptado");
  const pendientes = presupuestos.filter(p => p.estado === "enviado");
  const tasa = presupuestos.length > 0 ? Math.round(aceptados.length / presupuestos.length * 100) : 0;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("presKpiTotal", fmt(total));
  s("presKpiAceptados", fmt(aceptados.reduce((a, p) => a + p.base + p.base * p.iva / 100, 0)));
  s("presKpiPendientes", pendientes.length);
  s("presKpiTasa", tasa + "%");
}

/* ══════════════════════════
   MODAL NUEVO / EDITAR
══════════════════════════ */
export function showNuevoPresupuestoModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const lineasPrefill = prefill.lineas || [{ descripcion: "", cantidad: 1, precio: 0, iva: 21 }];

  openModal(`
    <div class="modal modal--wide">
      <div class="modal-hd">
        <span class="modal-title">📋 ${isEdit ? "Editar" : "Nuevo"} presupuesto</span>
        <button class="modal-x" onclick="window._cm()">×</button>
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
        <div class="modal-grid3" style="margin-bottom:16px">
          <div class="modal-field"><label>Fecha *</label><input type="date" id="pm_fecha" class="ff-input" value="${prefill.fecha || new Date().toISOString().slice(0, 10)}"/></div>
          <div class="modal-field"><label>Válido hasta</label><input type="date" id="pm_validez" class="ff-input" value="${prefill.fecha_validez || ""}"/></div>
          <div class="modal-field"><label>Estado</label>
            <select id="pm_estado" class="ff-select">
              <option value="borrador" ${(prefill.estado || "borrador") === "borrador" ? "selected" : ""}>Borrador</option>
              <option value="enviado" ${prefill.estado === "enviado" ? "selected" : ""}>Enviado</option>
              <option value="aceptado" ${prefill.estado === "aceptado" ? "selected" : ""}>Aceptado</option>
              <option value="rechazado" ${prefill.estado === "rechazado" ? "selected" : ""}>Rechazado</option>
            </select>
          </div>
        </div>

        <div class="modal-field" style="margin-bottom:16px">
          <label>Concepto / asunto *</label>
          <input id="pm_concepto" class="ff-input" value="${prefill.concepto || ""}" placeholder="Descripción del presupuesto"/>
        </div>

        <!-- LÍNEAS -->
        <div class="fb-title-row" style="margin-bottom:8px">
          <div class="fb-title" style="font-size:13px;font-weight:700">Líneas</div>
          <button id="pm_addLinea" class="btn-add-linea">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Añadir línea
          </button>
        </div>
        <div class="lineas-header" style="font-size:11px">
          <div class="lh-desc">Descripción</div><div class="lh-qty">Cant.</div>
          <div class="lh-price">Precio unit.</div><div class="lh-iva">IVA</div>
          <div class="lh-total">Total</div><div class="lh-del"></div>
        </div>
        <div id="pm_lineasContainer"></div>

        <div class="lineas-totales" id="pm_totales" style="margin-top:12px">
          <div class="lt-row"><span>Base</span><strong id="pm_ltBase">0,00 €</strong></div>
          <div class="lt-row lt-total"><span>TOTAL</span><strong id="pm_ltTotal">0,00 €</strong></div>
        </div>

        <div class="modal-field" style="margin-top:16px">
          <label>Notas / condiciones</label>
          <textarea id="pm_notas" class="ff-input ff-textarea" style="min-height:70px" placeholder="Condiciones de pago, plazos, garantías…">${prefill.notas || ""}</textarea>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pm_save">${isEdit ? "Actualizar" : "Guardar presupuesto"}</button>
      </div>
    </div>
  `);

  // Líneas lógica
  let lineas = [];
  let lid = 0;

  const calcTotales = () => {
    let base = 0, ivaT = 0;
    lineas.forEach(l => { base += l.cantidad * l.precio; ivaT += l.cantidad * l.precio * l.iva / 100; });
    const bEl = document.getElementById("pm_ltBase"), tEl = document.getElementById("pm_ltTotal");
    if (bEl) bEl.textContent = fmt(base);
    if (tEl) tEl.textContent = fmt(base + ivaT);
  };

  const addLinea = (pf = {}) => {
    const id = ++lid;
    lineas.push({ id, descripcion: pf.descripcion || "", cantidad: pf.cantidad || 1, precio: pf.precio || 0, iva: pf.iva !== undefined ? pf.iva : 21 });
    const cont = document.getElementById("pm_lineasContainer");
    const row = document.createElement("div");
    row.className = "linea-row"; row.dataset.lineaId = id;
    row.innerHTML = `
      <input type="text"   class="linea-desc ff-input"  value="${pf.descripcion || ""}" data-field="descripcion" placeholder="Descripción"/>
      <input type="number" class="linea-qty  ff-input"  value="${pf.cantidad || 1}" min="0.01" step="0.01" data-field="cantidad"/>
      <div class="linea-price-wrap"><span class="linea-euro">€</span>
        <input type="number" class="linea-price ff-input" value="${pf.precio || ""}" placeholder="0.00" step="0.01" data-field="precio"/>
      </div>
      <select class="linea-iva ff-select" data-field="iva">
        <option value="21" ${(pf.iva === 21 || pf.iva === undefined) ? "selected" : ""}>21%</option>
        <option value="10" ${pf.iva === 10 ? "selected" : ""}>10%</option>
        <option value="4"  ${pf.iva === 4  ? "selected" : ""}>4%</option>
        <option value="0"  ${pf.iva === 0  ? "selected" : ""}>0%</option>
      </select>
      <div class="linea-total" id="pmlt${id}">${fmt((pf.cantidad || 1) * (pf.precio || 0))}</div>
      <button class="linea-del" onclick="window._pmDelLinea(${id})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    row.querySelectorAll("input,select").forEach(el => {
      el.addEventListener("input", () => {
        const l = lineas.find(x => x.id === id); if (!l) return;
        const f = el.dataset.field;
        if (f === "descripcion") l.descripcion = el.value;
        else if (f === "cantidad") l.cantidad = parseFloat(el.value) || 0;
        else if (f === "precio")   l.precio   = parseFloat(el.value) || 0;
        else if (f === "iva")      l.iva      = parseInt(el.value) || 0;
        const tot = document.getElementById(`pmlt${id}`);
        if (tot) tot.textContent = fmt(l.cantidad * l.precio);
        calcTotales();
      });
    });
    cont.appendChild(row);
    calcTotales();
  };

  window._pmDelLinea = (id) => {
    lineas = lineas.filter(l => l.id !== id);
    document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
    calcTotales();
  };

  lineasPrefill.forEach(l => addLinea(l));
  document.getElementById("pm_addLinea").addEventListener("click", () => addLinea());

  // Sincronizar cliente_nombre con select
  document.getElementById("pm_cliente").addEventListener("change", e => {
    const opt = e.target.selectedOptions[0];
    const nEl = document.getElementById("pm_cliente_nombre");
    if (nEl && opt.dataset.nombre) nEl.value = opt.dataset.nombre;
  });

  document.getElementById("pm_save").addEventListener("click", async () => {
    const concepto = document.getElementById("pm_concepto").value.trim();
    const fecha    = document.getElementById("pm_fecha").value;
    if (!concepto || !fecha) { toast("Concepto y fecha son obligatorios", "error"); return; }

    let base = 0, iva = 21;
    lineas.forEach(l => { base += l.cantidad * l.precio; });
    if (lineas.length > 0) iva = lineas[0].iva;

    const cSel = document.getElementById("pm_cliente").value;
    const cNom = document.getElementById("pm_cliente_nombre").value.trim();
    const clienteObj = CLIENTES.find(c => c.id === cSel);

    const payload = {
      user_id: SESSION.user.id,
      concepto, fecha,
      fecha_validez: document.getElementById("pm_validez").value || null,
      estado:        document.getElementById("pm_estado").value,
      cliente_id:    cSel || null,
      cliente_nombre: cNom || clienteObj?.nombre || "",
      base, iva,
      lineas: JSON.stringify(lineas),
      notas: document.getElementById("pm_notas").value.trim(),
    };

    // Numeración automática
    if (!isEdit) {
      const year = new Date(fecha).getFullYear();
      const { data: last } = await supabase.from("presupuestos")
        .select("numero").eq("user_id", SESSION.user.id)
        .like("numero", `${year}-%`).order("numero", { ascending: false }).limit(1);
      const lastNum = last?.[0]?.numero ? parseInt(last[0].numero.split("-")[1]) || 0 : 0;
      payload.numero = `${year}-P${String(lastNum + 1).padStart(3, "0")}`;
    }

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("presupuestos").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("presupuestos").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Presupuesto actualizado ✅" : "Presupuesto creado ✅", "success");
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

  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">🧾 Convertir presupuesto a factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p style="font-size:13.5px;color:var(--t2);line-height:1.6;margin-bottom:20px">
          Se creará una nueva factura en borrador con los datos del presupuesto <strong>${p.numero}</strong> para <strong>${p.cliente_nombre || "—"}</strong>.
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

    const lineas = p.lineas ? JSON.parse(p.lineas) : [];
    const concepto = lineas.filter(l => l.descripcion).map(l => l.descripcion).join(" · ") || p.concepto;

    const { error: fe } = await supabase.from("facturas").insert({
      user_id:       SESSION.user.id,
      tipo:          "emitida",
      estado:        "borrador",
      fecha,
      concepto,
      cliente_id:    p.cliente_id,
      cliente_nombre: p.cliente_nombre,
      base:          p.base,
      iva:           p.iva,
      tipo_operacion: "nacional",
      notas:         p.notas,
      presupuesto_origen: p.id,
    });
    if (fe) { toast("Error creando factura: " + fe.message, "error"); return; }

    // Marcar presupuesto como aceptado
    await supabase.from("presupuestos").update({
      estado: "aceptado",
      fecha_aceptacion: new Date().toISOString().slice(0, 10)
    }).eq("id", presId);

    toast("✅ Factura creada desde presupuesto", "success");
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
  const { data: p, error } = await supabase.from("presupuestos")
    .select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando presupuesto", "error"); return null; }

  const perfil = await cargarPerfil();
  const lineas = p.lineas ? JSON.parse(p.lineas) : [];

  if (!window.jspdf?.jsPDF && !window.jsPDF) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const { jsPDF } = window.jspdf || window;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const PW = 210, PH = 297, ML = 15, MR = 15, W = PW - ML - MR;
  const BRAND=[249,115,22], DARK=[11,13,18], GRAY=[107,114,128], LIGHT=[243,244,246], WHITE=[255,255,255];

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, PW, 42, "F");

  let logoB64 = perfil.logo_url ? await logoToBase64(perfil.logo_url) : null;
  if (logoB64) {
    try {
      const mime = logoB64.split(";")[0].split(":")[1];
      const fmt2 = mime.includes("png") ? "PNG" : "JPEG";
      doc.addImage(logoB64, fmt2, ML, 7, 44, 20, undefined, "FAST");
    } catch(e) { console.warn("Logo:", e); }
  } else {
    doc.setFont("helvetica","bold"); doc.setFontSize(17); doc.setTextColor(...WHITE);
    doc.text(perfil.nombre_razon_social||"Taurix", ML, 23);
  }

  doc.setFont("helvetica","bold"); doc.setFontSize(24); doc.setTextColor(...WHITE);
  doc.text("PRESUPUESTO", PW-MR, 18, {align:"right"});
  doc.setFontSize(11); doc.setFont("helvetica","normal");
  doc.text(p.numero||"S/N", PW-MR, 26, {align:"right"});
  const estadoLabel = {borrador:"Borrador",enviado:"Enviado",aceptado:"Aceptado",rechazado:"Rechazado"}[p.estado]||"";
  doc.setFontSize(9); doc.text(estadoLabel, PW-MR, 33, {align:"right"});

  let y = 52;

  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("EMITIDO POR", ML, y); y += 5;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text(perfil.nombre_razon_social||"—", ML, y); y += 5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
  if (perfil.nif)              { doc.text(`NIF: ${perfil.nif}`, ML, y); y += 4.5; }
  if (perfil.domicilio_fiscal) { const ls=doc.splitTextToSize(perfil.domicilio_fiscal,88); doc.text(ls,ML,y); y+=ls.length*4.5; }
  if (perfil.telefono)         { doc.text(`Tel: ${perfil.telefono}`, ML, y); y += 4.5; }
  if (perfil.email)            { doc.text(perfil.email, ML, y); }

  const RX = PW/2 + 5; let ry = 52;
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text("PRESUPUESTO PARA", RX, ry); ry += 5;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...DARK);
  doc.text(p.cliente_nombre||"—", RX, ry); ry += 5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
  if (p.cliente_nif)       { doc.text(`NIF: ${p.cliente_nif}`, RX, ry); ry += 4.5; }
  if (p.cliente_direccion) { doc.text(p.cliente_direccion, RX, ry); ry += 4.5; }
  if (p.cliente_email)     { doc.text(p.cliente_email, RX, ry); }

  y = Math.max(y, ry) + 10;
  doc.setDrawColor(229,231,235); doc.setLineWidth(0.3);
  doc.line(ML, y, PW-MR, y); y += 7;

  const meta = [
    { label:"Fecha emisión",  value: p.fecha ? new Date(p.fecha).toLocaleDateString("es-ES") : "—" },
    { label:"Válido hasta",   value: p.fecha_validez ? new Date(p.fecha_validez).toLocaleDateString("es-ES") : "—" },
    { label:"Referencia",     value: p.numero||"S/N" },
    { label:"Estado",         value: estadoLabel },
  ];
  const mW = W / meta.length;
  meta.forEach((m, i) => {
    const x = ML + i*mW;
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text(m.label.toUpperCase(), x, y);
    doc.setFont("helvetica","bold"); doc.setFontSize(9.5); doc.setTextColor(...DARK);
    doc.text(m.value, x, y+5.5);
  });
  y += 14;

  if (p.concepto) {
    doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
    doc.text(p.concepto, ML, y); y += 9;
  }

  doc.setFillColor(...BRAND);
  doc.rect(ML, y, W, 8, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...WHITE);
  const COL = { desc:ML+2, cant:ML+99, price:ML+119, iva:ML+145, total:PW-MR };
  doc.text("DESCRIPCIÓN", COL.desc,  y+5.2);
  doc.text("CANT.",        COL.cant,  y+5.2);
  doc.text("P. UNITARIO",  COL.price, y+5.2);
  doc.text("IVA",          COL.iva,   y+5.2);
  doc.text("TOTAL",        COL.total, y+5.2, {align:"right"});
  y += 8;

  let baseTotal = 0; const ivaMap = {};
  lineas.forEach((l, idx) => {
    const sub = (l.cantidad||0)*(l.precio||0);
    baseTotal += sub; ivaMap[l.iva] = (ivaMap[l.iva]||0)+sub*l.iva/100;
    const rH = 7.5;
    if (idx%2===0) { doc.setFillColor(...LIGHT); doc.rect(ML, y, W, rH, "F"); }
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text((l.descripcion||"—").slice(0,60), COL.desc, y+5);
    doc.text(String(l.cantidad||0), COL.cant, y+5);
    doc.text(fmt(l.precio||0), COL.price, y+5);
    doc.text((l.iva||0)+"%", COL.iva, y+5);
    doc.setFont("helvetica","bold");
    doc.text(fmt(sub), COL.total, y+5, {align:"right"});
    doc.setDrawColor(229,231,235); doc.setLineWidth(0.15);
    doc.line(ML, y+rH, PW-MR, y+rH);
    y += rH;
  });

  y += 7;
  const ivaTotal = Object.values(ivaMap).reduce((a,b)=>a+b,0);
  const totalFinal = baseTotal + ivaTotal;
  const TX = PW - MR - 72;

  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
  doc.text("Base imponible", TX, y);
  doc.setTextColor(...DARK); doc.text(fmt(baseTotal), PW-MR, y, {align:"right"}); y += 6;

  Object.entries(ivaMap).filter(([,v])=>v>0).forEach(([pct,amt]) => {
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text(`IVA ${pct}%`, TX, y);
    doc.setTextColor(...DARK); doc.text(fmt(amt), PW-MR, y, {align:"right"}); y += 6;
  });

  doc.setFillColor(...BRAND);
  doc.roundedRect(TX-4, y-2, PW-MR-TX+4, 11, 2, 2, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(11); doc.setTextColor(...WHITE);
  doc.text("TOTAL", TX, y+6);
  doc.text(fmt(totalFinal), PW-MR, y+6, {align:"right"});
  y += 18;

  if (p.notas && y < PH-40) {
    doc.setFillColor(239,246,255);
    const notaLines = doc.splitTextToSize(p.notas, W-20);
    const notaH = notaLines.length*4.5+16;
    doc.roundedRect(ML, y, W, notaH, 3, 3, "F");
    doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...BRAND);
    doc.text("NOTAS Y CONDICIONES", ML+6, y+8);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...DARK);
    doc.text(notaLines, ML+6, y+14);
    y += notaH+8;
  }

  doc.setFillColor(...LIGHT);
  doc.rect(0, PH-14, PW, 14, "F");
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
  const pie = [perfil.nombre_razon_social, perfil.nif?"NIF "+perfil.nif:null, perfil.domicilio_fiscal, perfil.email].filter(Boolean).join(" · ");
  doc.text(pie||"Generado con Taurix", PW/2, PH-6, {align:"center", maxWidth:W});

  const filename = `presupuesto_${(p.numero||p.id.slice(0,8)).replace(/\//g,"-")}.pdf`;
  if (descargar) { doc.save(filename); toast("📄 PDF descargado","success"); return null; }
  return { blob: doc.output("blob"), filename, dataUri: doc.output("datauristring") };
}

/* ══════════════════════════════════════════════════
   MODAL ENVIAR PRESUPUESTO POR EMAIL
   — Genera el PDF, lo descarga automáticamente,
     y abre el cliente de email con todo prellenado
══════════════════════════════════════════════════ */
export async function showEnviarEmailModal(presId) {
  const { data: p, error } = await supabase.from("presupuestos")
    .select("*").eq("id", presId).single();
  if (error || !p) { toast("Error cargando presupuesto", "error"); return; }

  const perfil  = await cargarPerfil();
  const cliente = CLIENTES.find(c => c.id === p.cliente_id);
  const emailTo = cliente?.email || p.cliente_email || "";
  const emailDe = perfil.email || "";
  const totalFmt = fmt(p.base + p.base * p.iva / 100);
  const validez  = p.fecha_validez
    ? new Date(p.fecha_validez).toLocaleDateString("es-ES") : "";

  const bodyDefecto = `Estimado/a ${p.cliente_nombre || "cliente"},

Adjunto encontrará el presupuesto ${p.numero || ""} correspondiente a: ${p.concepto || "los servicios solicitados"}.

Importe total: ${totalFmt}${validez ? "\nVálido hasta: " + validez : ""}

Para aceptar el presupuesto o resolver cualquier duda, puede responder a este correo.

Un saludo,
${perfil.nombre_razon_social || ""}${perfil.telefono ? "\n" + perfil.telefono : ""}`;

  openModal(`
    <div class="modal" style="max-width:580px">
      <div class="modal-hd">
        <span class="modal-title">📧 Enviar presupuesto por email</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Resumen del presupuesto -->
        <div style="background:var(--srf2);border:1px solid var(--brd);border-radius:12px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:14px">
          <div style="width:44px;height:44px;background:var(--ox-lt);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📋</div>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-hd);font-weight:800;font-size:14px;color:var(--t1)">${p.numero || "S/N"} · ${p.cliente_nombre || "—"}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:2px">${p.concepto || "—"}</div>
          </div>
          <div style="font-family:var(--font-hd);font-weight:900;font-size:18px;color:var(--ox);white-space:nowrap">${totalFmt}</div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field">
            <label>Tu email (remitente) *</label>
            <input id="em_de" class="ff-input" type="email" value="${emailDe}" placeholder="tu@empresa.com"/>
          </div>
          <div class="modal-field">
            <label>Email del cliente (destinatario) *</label>
            <input id="em_to" class="ff-input" type="email" value="${emailTo}" placeholder="cliente@empresa.com"/>
          </div>
        </div>

        <div class="modal-field">
          <label>CC (con copia, opcional)</label>
          <input id="em_cc" class="ff-input" type="email" placeholder="otro@empresa.com"/>
        </div>

        <div class="modal-field">
          <label>Asunto del email</label>
          <input id="em_subject" class="ff-input" value="Presupuesto ${p.numero || ""} — ${p.concepto || ""}"/>
        </div>

        <div class="modal-field">
          <label>Mensaje</label>
          <textarea id="em_body" class="ff-input ff-textarea" style="min-height:150px;font-size:13px;line-height:1.6">${bodyDefecto}</textarea>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13.5px;color:var(--t2)">
            <input type="checkbox" id="em_adjuntar" checked style="width:16px;height:16px;accent-color:var(--ox)"/>
            <span>📎 Descargar automáticamente el PDF para adjuntarlo</span>
          </label>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13.5px;color:var(--t2)">
            <input type="checkbox" id="em_marcar" checked style="width:16px;height:16px;accent-color:var(--ox)"/>
            <span>📤 Marcar presupuesto como "Enviado" al enviar</span>
          </label>
        </div>

        <div style="background:var(--ox-lt);border:1px solid var(--ox-mid);border-radius:9px;padding:11px 14px;margin-top:18px;font-size:12.5px;color:var(--ox-dd);display:flex;gap:10px;align-items:flex-start;line-height:1.5">
          <span style="font-size:16px;flex-shrink:0">💡</span>
          <span>El botón abrirá tu cliente de correo (Gmail, Outlook…) con todo prellenado. Solo tendrás que adjuntar el PDF descargado y pulsar Enviar.</span>
        </div>
      </div>

      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="em_send" style="gap:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Preparar y enviar
        </button>
      </div>
    </div>
  `);

  document.getElementById("em_send")?.addEventListener("click", async () => {
    const to      = document.getElementById("em_to").value.trim();
    const de      = document.getElementById("em_de").value.trim();
    const cc      = document.getElementById("em_cc").value.trim();
    const subject = document.getElementById("em_subject").value.trim();
    const body    = document.getElementById("em_body").value.trim();
    const adjuntar  = document.getElementById("em_adjuntar").checked;
    const marcarEnv = document.getElementById("em_marcar").checked;

    if (!to)      { toast("Introduce el email del cliente", "error"); return; }
    if (!subject) { toast("Introduce el asunto", "error"); return; }

    const btn = document.getElementById("em_send");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Preparando…`;

    try {
      // 1. Descargar PDF si está marcado
      if (adjuntar) {
        btn.innerHTML = `<span class="spin"></span> Generando PDF…`;
        await generarPDFPresupuesto(presId, true);
        // Pequeña pausa para que el navegador procese la descarga
        await new Promise(r => setTimeout(r, 400));
      }

      // 2. Marcar como enviado si está marcado
      if (marcarEnv && p.estado === "borrador") {
        await supabase.from("presupuestos").update({
          estado: "enviado",
          fecha_envio: new Date().toISOString().slice(0, 10)
        }).eq("id", presId);
      }

      // 3. Construir mailto y abrir cliente de correo
      const mailtoParams = new URLSearchParams();
      if (cc) mailtoParams.set("cc", cc);
      mailtoParams.set("subject", subject);
      mailtoParams.set("body", body);

      // URLSearchParams codifica + en vez de %20, corregimos
      const mailtoStr = `mailto:${encodeURIComponent(to)}?${mailtoParams.toString().replace(/\+/g, "%20")}`;

      // También añadir "from" hint si el cliente lo soporta
      const mailtoFull = de ? mailtoStr.replace("mailto:", `mailto:`) : mailtoStr;

      window.location.href = mailtoFull;

      closeModal();
      toast(`📧 Cliente de correo abierto — adjunta el PDF descargado y envía`, "success", 6000);
      await refreshPresupuestos();

    } catch(e) {
      toast("Error: " + e.message, "error");
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Preparar y enviar`;
    }
  });
}

function _defaultEmailBody(p, perfil) {
  // kept for backwards compat — not used in new flow
  return "";
}

function _bodyToHtml(text, p, perfil) {
  // kept for backwards compat — not used in new flow
  return "";
}

window._logoutAndReconnect = async () => {
  await supabase.auth.signOut();
  window.location.reload();
};

window._presTofact = convertirAFactura;
window._presPDF   = (id) => generarPDFPresupuesto(id, true);
window._presEmail = (id) => showEnviarEmailModal(id);
window._editPres = async (id) => {
  const { data, error } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (error || !data) { toast("Error cargando presupuesto", "error"); return; }
  const lineas = data.lineas ? JSON.parse(data.lineas) : [];
  showNuevoPresupuestoModal({ ...data, lineas });
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

export function initPresupuestosView() {
  document.getElementById("nuevoPres Btn")?.addEventListener("click", () => showNuevoPresupuestoModal());
  document.getElementById("nuevoPresBtn")?.addEventListener("click", () => showNuevoPresupuestoModal());
  document.getElementById("presSearch")?.addEventListener("input", () => refreshPresupuestos());
  document.getElementById("presFilterEstado")?.addEventListener("change", () => refreshPresupuestos());
}
