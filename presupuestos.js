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

  const PW=210, PH=297, ML=18, MR=18, W=PW-ML-MR;
  const INK=[15,23,42], MUTED=[100,116,139], LIGHT=[248,250,252], BORDER=[226,232,240], WHITE=[255,255,255];

  doc.setFillColor(...WHITE); doc.rect(0,0,PW,PH,"F");

  /* ── IZQUIERDA: PRESUPUESTO / QUOTE + número ── */
  doc.setFont("helvetica","bold"); doc.setFontSize(28); doc.setTextColor(...INK);
  doc.text("PRESUPUESTO", ML, 22);
  doc.setFont("helvetica","normal"); doc.setFontSize(10); doc.setTextColor(...MUTED);
  doc.text("QUOTE", ML, 29);
  doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(...INK);
  doc.text(p.numero||"S/N", ML, 38);

  /* ── DERECHA: logo o nombre empresa ── */
  let logoOk=false;
  let logoB64=perfil.logo_url ? await logoToBase64(perfil.logo_url) : null;
  if(logoB64){
    try{
      const mime=logoB64.split(";")[0].split(":")[1];
      doc.addImage(logoB64, mime.includes("png")?"PNG":"JPEG", PW-MR-42, 8, 42, 28, "", "FAST");
      logoOk=true;
    }catch(e){}
  }
  if(!logoOk){
    doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(...INK);
    doc.text(perfil.nombre_razon_social||"", PW-MR, 24, {align:"right"});
  }

  /* ── LÍNEA DIVISORA ── */
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
  doc.line(ML, 46, PW-MR, 46);

  /* ── DE / FROM  ·  PARA / TO ── */
  let y=56;
  const COL1=ML, COL2=PW/2+6, cW=W/2-10;

  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text("DE / FROM", COL1, y); doc.text("PARA / TO", COL2, y); y+=5;

  const yBlock=y;
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text((perfil.nombre_razon_social||"—").substring(0,32), COL1, y); y+=5.5;
  doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  if(perfil.nif)             { doc.text("NIF: "+perfil.nif, COL1, y); y+=4.5; }
  if(perfil.domicilio_fiscal){ const ls=doc.splitTextToSize(perfil.domicilio_fiscal,cW); doc.text(ls,COL1,y); }

  /* Cliente — solo nombre */
  doc.setFont("helvetica","bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text((p.cliente_nombre||"—").substring(0,32), COL2, yBlock);

  y=Math.max(y+5, yBlock+12)+14;

  /* ── CONCEPTO ── */
  if(p.concepto){
    doc.setFont("helvetica","bold"); doc.setFontSize(14); doc.setTextColor(...INK);
    doc.text(p.concepto, ML, y); y+=12;
  }

  /* ── TABLA 4 COLUMNAS balanceadas ──
     Descripción: ML+2 → ~118mm de ancho
     Cant:        posición 130
     P.Unit:      posición 155
     Total:       PW-MR (alineado a la derecha)
  */
  const tDesc  = ML+2;   // 20mm
  const tQty   = 82;     // -40mm → era 122
  const tPrice = 115;    // -40mm → era 155
  const tTotal = PW-MR-20; // -20mm → era 192

  // Cabecera tabla
  doc.setFillColor(...INK); doc.roundedRect(ML, y, W, 10, 1, 1, "F");
  doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...WHITE);
  doc.text("DESCRIPTION",       tDesc,  y+5.8);
  doc.text("CANT. / QTY",       tQty,   y+5.8, {align:"center"});
  doc.text("PRECIO / UNIT PRICE", tPrice, y+5.8, {align:"center"});
  doc.text("TOTAL",             tTotal, y+5.8, {align:"center"});
  y+=10;

  let baseTotal=0; const ivaMap={};
  lineas.forEach((l,idx)=>{
    const qty    = l.cantidad||1;
    const precio = l.precio||0;
    const sub    = qty*precio;
    // Ignorar líneas donde la descripción parece ser el número de presupuesto
    const desc   = (l.descripcion||"").trim();
    baseTotal+=sub;
    ivaMap[l.iva]=(ivaMap[l.iva]||0)+sub*(l.iva||0)/100;

    const rH=9;
    doc.setFillColor(idx%2===0?249:255,idx%2===0?250:255,idx%2===0?251:255);
    doc.rect(ML,y,W,rH,"F");
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.1); doc.line(ML,y+rH,ML+W,y+rH);

    // Descripción — hasta 2 líneas, ancho ~118mm
    const dl=doc.splitTextToSize(desc||"—", 94);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(dl[0], tDesc, y+5.8);
    if(dl.length>1){ doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(dl[1],tDesc,y+9.5); }

    // Cant y precio centrados en su columna
    doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text(String(qty),              tQty,   y+5.8, {align:"center"});
    doc.text(precio.toFixed(2)+" €",   tPrice, y+5.8, {align:"center"});
    doc.setFont("helvetica","bold"); doc.setTextColor(...INK);
    doc.text(sub.toFixed(2)+" €",      tTotal, y+5.8, {align:"center"});
    y+=rH;
    if(y>PH-80){doc.addPage();y=20;}
  });

  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4); doc.line(ML,y,PW-MR,y); y+=10;

  /* ── TOTALES ── */
  const xTL=PW-MR-80, xTV=PW-MR;
  const ivaTotal=Object.values(ivaMap).reduce((a,b)=>a+b,0);

  doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text("Subtotal", xTL, y);
  doc.setTextColor(...INK); doc.text(baseTotal.toFixed(2)+" €",xTV,y,{align:"right"}); y+=7;

  Object.entries(ivaMap).filter(([,v])=>v>0).sort(([a],[b])=>Number(b)-Number(a)).forEach(([pct,amt])=>{
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text("IVA / VAT "+pct+"%", xTL, y);
    doc.setTextColor(...INK); doc.text(amt.toFixed(2)+" €",xTV,y,{align:"right"}); y+=7;
  });

  doc.setDrawColor(...BORDER); doc.setLineWidth(0.3); doc.line(xTL,y,xTV,y); y+=4;
  doc.setFillColor(...INK); doc.roundedRect(xTL-4,y-2,xTV-xTL+8,13,1.5,1.5,"F");
  doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...WHITE);
  doc.text("TOTAL", xTL, y+7);
  doc.text((baseTotal+ivaTotal).toFixed(2)+" €", xTV, y+7, {align:"right"});
  y+=22;

  /* ── NOTAS ── */
  if(p.notas&&y<PH-50){
    doc.setFillColor(...LIGHT); doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
    const nl=doc.splitTextToSize(p.notas,W-10);
    const nh=nl.length*4.5+13;
    doc.roundedRect(ML,y,W,nh,1.5,1.5,"FD");
    doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("NOTAS / NOTES",ML+5,y+6);
    doc.setFont("helvetica","normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(nl,ML+5,y+11.5);
  }

  /* ── PIE ── */
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.4); doc.line(ML,PH-16,PW-MR,PH-16);
  doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
  const pie=[perfil.nombre_razon_social,perfil.nif?"NIF "+perfil.nif:null].filter(Boolean).join("  ·  ");
  doc.text(pie, ML, PH-10);
  doc.text(new Date().toLocaleDateString("es-ES"), PW-MR, PH-10, {align:"right"});

  const filename=`presupuesto_${(p.numero||p.id.slice(0,8)).replace(/\//g,"-")}.pdf`;
  if(descargar){doc.save(filename);toast("📄 PDF descargado","success");return null;}
  return {blob:doc.output("blob"),filename,dataUri:doc.output("datauristring")};
}

/* ══════════════════════════════════════════════════
   MODAL ENVIAR EMAIL VIA GMAIL
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

        <div class="email-taurix-badge">
          <img src="Logo_Taurix.png" alt="Taurix" style="height:20px"/>
          <span>Enviado desde <strong>presupuestos@taurix.es</strong> en nombre tuyo</span>
        </div>

        <div class="email-pres-preview">
          <div class="epp-num">${p.numero||"S/N"}</div>
          <div class="epp-datos">
            <span><strong>${p.cliente_nombre||"—"}</strong></span>
            <span class="mono fw7" style="color:var(--brand)">${fmt(p.base+p.base*p.iva/100)}</span>
            ${p.fecha_validez?`<span style="color:var(--t3);font-size:12px">Válido hasta ${new Date(p.fecha_validez).toLocaleDateString("es-ES")}</span>`:""}
          </div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field">
            <label>Email del cliente *</label>
            <input id="em_to" class="ff-input" type="email" value="${emailTo}" placeholder="cliente@empresa.com"/>
          </div>
          <div class="modal-field">
            <label>CC (opcional)</label>
            <input id="em_cc" class="ff-input" type="email" placeholder="copia@tuempresa.com"/>
          </div>
        </div>

        <div class="modal-field">
          <label>Asunto</label>
          <input id="em_subject" class="ff-input" value="Presupuesto ${p.numero||""} — ${p.concepto||""}"/>
        </div>

        <div class="modal-field">
          <label>Mensaje</label>
          <textarea id="em_body" class="ff-input ff-textarea" style="min-height:120px">${_defaultEmailBody(p, perfil)}</textarea>
        </div>

        <div class="email-options-row">
          <label class="email-check-lbl">
            <input type="checkbox" id="em_adjuntar" checked/>
            <span>📎 Adjuntar PDF del presupuesto</span>
          </label>
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
          Enviar presupuesto
        </button>
      </div>
    </div>
  `);

  document.getElementById("em_send")?.addEventListener("click", async () => {
    const to      = document.getElementById("em_to").value.trim();
    const subject = document.getElementById("em_subject").value.trim();
    const body    = document.getElementById("em_body").value.trim();
    const cc      = document.getElementById("em_cc").value.trim();
    const adjuntar    = document.getElementById("em_adjuntar").checked;
    const marcarEnv   = document.getElementById("em_marcar_enviado").checked;

    if (!to)      { toast("Introduce el email del cliente","error"); return; }
    if (!subject) { toast("Introduce el asunto","error"); return; }

    const btn = document.getElementById("em_send");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Generando PDF…`;

    try {
      let pdfBase64 = null, pdfFilename = null;
      if (adjuntar) {
        const result = await generarPDFPresupuesto(presId, false);
        if (result) {
          pdfBase64 = await new Promise((res,rej) => {
            const reader = new FileReader();
            reader.onload  = () => res(reader.result.split(",")[1]);
            reader.onerror = rej;
            reader.readAsDataURL(result.blob);
          });
          pdfFilename = result.filename;
        }
      }

      btn.innerHTML = `<span class="spin"></span> Enviando…`;

      const { data: resp, error: fnErr } = await supabase.functions.invoke("send-presupuesto", {
        body: {
          to, cc: cc||null,
          from_name:   perfil.nombre_razon_social || "Taurix",
          from_email:  "presupuestos@taurix.es",
          subject,
          body_text: body,
          body_html: _bodyToHtml(body, p, perfil),
          pdf_base64:  pdfBase64,
          pdf_filename: pdfFilename,
        }
      });

      if (fnErr) throw new Error(fnErr.message);
      if (resp?.error) throw new Error(resp.error);

      if (marcarEnv && p.estado === "borrador") {
        await supabase.from("presupuestos").update({
          estado: "enviado",
          fecha_envio: new Date().toISOString().slice(0,10)
        }).eq("id", presId);
      }

      closeModal();
      toast(`✅ Presupuesto enviado a ${to}`, "success", 5000);
      await refreshPresupuestos();

    } catch(e) {
      toast("❌ Error: "+e.message,"error",7000);
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar desde Gmail`;
    }
  });
}

function _defaultEmailBody(p, perfil) {
  const nom   = perfil.nombre_razon_social || "nosotros";
  const valid = p.fecha_validez ? `\n\nEste presupuesto es válido hasta el ${new Date(p.fecha_validez).toLocaleDateString("es-ES")}.` : "";
  return `Estimado/a ${p.cliente_nombre||"cliente"},\n\nAdjunto encontrará el presupuesto ${p.numero||""} correspondiente a: ${p.concepto||"los servicios solicitados"}.\n\nImporte total: ${fmt(p.base+p.base*p.iva/100)}${valid}\n\nPara aceptar el presupuesto o si tiene cualquier consulta, no dude en contactarnos.\n\nUn saludo,\n${nom}`;
}

function _bodyToHtml(text, p, perfil) {
  const esc  = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const body = esc.split("\n\n").map(b=>`<p style="margin:0 0 14px;line-height:1.6">${b.replace(/\n/g,"<br/>")}</p>`).join("");
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
<tr><td style="background:#1a56db;padding:28px 36px">
  <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800">Presupuesto ${p.numero||""}</h1>
  <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:14px">${p.concepto||""}</p>
</td></tr>
<tr><td style="background:#eff6ff;padding:20px 36px;border-bottom:2px solid #dbeafe">
  <span style="font-size:11px;color:#6b7280;text-transform:uppercase">Importe total</span><br/>
  <span style="font-size:28px;font-weight:800;color:#1a56db">${fmt(p.base+p.base*p.iva/100)}</span>
</td></tr>
<tr><td style="padding:32px 36px;font-size:15px;color:#374151">${body}</td></tr>
<tr><td style="background:#f9fafb;padding:18px 36px;border-top:1px solid #e5e7eb">
  <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center">
    ${perfil.nombre_razon_social||""}${perfil.nif?" · NIF "+perfil.nif:""}
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
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
