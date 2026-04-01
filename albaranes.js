/* ═══════════════════════════════════════════════════════
   TAURIX · albaranes.js
   Vista de albaranes — filtra presupuestos con estado "albaran"
   Incluye: convertir a factura, PDF, búsqueda
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal, getYear, getTrim, getFechaRango } from "./utils.js";

/* ══════════════════════════
   REFRESH ALBARANES
══════════════════════════ */
export async function refreshAlbaranes() {
  const year = getYear(), trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);
  const search     = (document.getElementById("albaranSearch")?.value || "").toLowerCase();
  const factFilter = document.getElementById("albaranFilterFacturado")?.value || "";
  const clienteF   = (document.getElementById("albaranFilterCliente")?.value || "").toLowerCase();
  const desdeF     = document.getElementById("albaranFilterDesde")?.value || "";
  const hastaF     = document.getElementById("albaranFilterHasta")?.value || "";
  const minF       = parseFloat(document.getElementById("albaranFilterMin")?.value) || 0;
  const maxF       = parseFloat(document.getElementById("albaranFilterMax")?.value) || 0;

  const { data, error } = await supabase.from("presupuestos")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .eq("estado", "albaran")
    .gte("fecha", desdeF || ini).lte("fecha", hastaF || fin)
    .order("fecha", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false, nullsFirst: false });

  if (error) { console.error("albaranes:", error.message); return; }

  let albaranes = data || [];
  if (search) albaranes = albaranes.filter(a =>
    (a.concepto||"").toLowerCase().includes(search) ||
    (a.numero||"").toLowerCase().includes(search) ||
    (a.albaran_numero||"").toLowerCase().includes(search) ||
    (a.cliente_nombre||"").toLowerCase().includes(search)
  );
  if (factFilter === "si") albaranes = albaranes.filter(a => !!a.factura_id);
  if (factFilter === "no") albaranes = albaranes.filter(a => !a.factura_id);
  if (clienteF) albaranes = albaranes.filter(a => (a.cliente_nombre||"").toLowerCase().includes(clienteF));
  if (minF > 0) albaranes = albaranes.filter(a => (a.base+a.base*(a.iva||21)/100) >= minF);
  if (maxF > 0) albaranes = albaranes.filter(a => (a.base+a.base*(a.iva||21)/100) <= maxF);

  // Poblar select clientes
  const selCli = document.getElementById("albaranFilterCliente");
  if (selCli && selCli.options.length <= 1 && (data||[]).length) {
    const nombres = [...new Set((data||[]).map(a=>a.cliente_nombre).filter(Boolean))].sort();
    nombres.forEach(n => { const o=document.createElement("option"); o.value=n.toLowerCase(); o.textContent=n; selCli.appendChild(o); });
  }

  const countEl = document.getElementById("albaranesCount");
  if (countEl) countEl.textContent = `${albaranes.length} albarán${albaranes.length !== 1 ? "es" : ""} en el periodo`;

  const tbody = document.getElementById("albaranesBody");
  if (!tbody) return;

  if (!albaranes.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="8">Sin albaranes en este periodo. Los albaranes se crean desde presupuestos aceptados.</td></tr>`;
    return;
  }

  albaranes.sort((a,b) => {
    if (a.fecha === b.fecha) return (b.id || "").localeCompare(a.id || "");
    return (b.fecha || "").localeCompare(a.fecha || "");
  });
  tbody.innerHTML = albaranes.map(a => {
    const total = a.base + a.base * (a.iva || 21) / 100;
    const facturado = !!a.factura_id;

    return `<tr>
      <td class="mono" style="font-size:12px">${fmtDate(a.albaran_fecha || a.fecha)}</td>
      <td><span class="badge b-ic mono" style="font-size:11px">${a.albaran_numero || a.numero || "S/N"}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px">${a.concepto || "—"}</td>
      <td style="font-size:12px;color:var(--t3)">${a.cliente_nombre || "—"}</td>
      <td class="mono fw7">${fmt(total)}</td>
      <td style="font-size:12px;color:var(--t4)">Pres. ${a.numero || "—"}</td>
      <td>
        ${facturado
          ? `<span class="badge b-cobrada">Facturado</span>`
          : `<span class="badge b-pendiente">Pendiente</span>`}
      </td>
      <td>
        <div class="tbl-act">
          ${!facturado ? `<button class="ta-btn ta-emit" onclick="window._albaranToFactura('${a.id}')" title="Convertir a factura">📤 Facturar</button>` : ""}
          <button class="ta-btn" onclick="window._verAlbaran('${a.id}')" title="Ver detalle">👁</button>
          <button class="ta-btn" onclick="window._albaranPDF('${a.id}')" title="Descargar PDF">📄</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/* ══════════════════════════
   CONVERTIR ALBARÁN A FACTURA
══════════════════════════ */
window._albaranToFactura = async (id) => {
  const { data: a, error } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (error || !a) { toast("Error cargando albarán", "error"); return; }

  openModal(`
    <div class="modal">
      <div class="modal-hd"><span class="modal-title">📤 Convertir albarán a factura</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <div style="background:var(--bg2);border-radius:10px;padding:16px;margin-bottom:16px">
          <div style="font-size:13px;font-weight:600">${a.concepto || "Sin concepto"}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:4px">${a.cliente_nombre || "Sin cliente"} · ${fmt(a.base + a.base * (a.iva || 21) / 100)}</div>
        </div>
        <p style="font-size:13px;color:var(--t2);line-height:1.6">Se creará una factura con todos los datos de este albarán. Una vez creada, la factura quedará emitida y no podrá editarse ni eliminarse. Si necesitas modificarla, deberás crear una factura rectificativa.</p>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="_a2fOk">Crear factura</button>
      </div>
    </div>`);

  document.getElementById("_a2fOk").addEventListener("click", async () => {
    const lineas = a.lineas ? (typeof a.lineas === "string" ? JSON.parse(a.lineas) : a.lineas) : [];

    const { data: factura, error: fe } = await supabase.from("facturas").insert({
      user_id: SESSION.user.id,
      concepto: a.concepto,
      base: a.base,
      iva: a.iva || 21,
      tipo: "emitida",
      tipo_operacion: a.tipo_operacion || "nacional",
      estado: "borrador",
      fecha: new Date().toISOString().slice(0, 10),
      cliente_id: a.cliente_id,
      cliente_nombre: a.cliente_nombre,
      cliente_nif: a.cliente_nif,
      notas: `Factura generada desde albarán ${a.albaran_numero || a.numero || ""}`,
      lineas: JSON.stringify(lineas),
    }).select().single();

    if (fe) { toast("Error: " + fe.message, "error"); return; }

    // Numerar y emitir inmediatamente
    try {
      const { emitirFacturaDB } = await import("./facturas.js");
      await emitirFacturaDB(factura.id);
    } catch(numErr) { console.warn("Numeración automática:", numErr.message); }

    // Marcar el albarán como facturado
    await supabase.from("presupuestos").update({ factura_id: factura.id }).eq("id", id);

    closeModal();
    toast("Factura creada y emitida — disponible en Facturas", "success", 4000);
    await refreshAlbaranes();
  });
};

/* ══════════════════════════
   VER DETALLE ALBARÁN
══════════════════════════ */
window._verAlbaran = async (id) => {
  const { data: a } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (!a) return;

  const lineas = a.lineas ? (typeof a.lineas === "string" ? JSON.parse(a.lineas) : a.lineas) : [];
  const total = a.base + a.base * (a.iva || 21) / 100;

  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">📦 Albarán ${a.albaran_numero || a.numero || "S/N"}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px">
          <div><span style="color:var(--t3)">Cliente:</span> <strong>${a.cliente_nombre || "—"}</strong></div>
          <div><span style="color:var(--t3)">NIF:</span> <strong>${a.cliente_nif || "—"}</strong></div>
          <div><span style="color:var(--t3)">Fecha:</span> <strong>${fmtDate(a.albaran_fecha || a.fecha)}</strong></div>
          <div><span style="color:var(--t3)">Total:</span> <strong class="mono">${fmt(total)}</strong></div>
        </div>
        ${a.concepto ? `<div style="font-size:13px;margin-bottom:12px"><span style="color:var(--t3)">Concepto:</span> ${a.concepto}</div>` : ""}

        ${lineas.length ? `
        <table class="data-table" style="margin-bottom:12px">
          <thead><tr><th>Descripción</th><th>Uds.</th><th>Precio</th><th>Importe</th></tr></thead>
          <tbody>
            ${lineas.map(l => `<tr>
              <td>${l.descripcion || "—"}</td>
              <td>${l.cantidad || 1}</td>
              <td class="mono">${fmt(l.precio || 0)}</td>
              <td class="mono fw7">${fmt((l.cantidad || 1) * (l.precio || 0))}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : ""}

        ${a.notas ? `<div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--t3)">${a.notas}</div>` : ""}
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        ${!a.factura_id ? `<button class="btn-modal-save" onclick="window._cm();window._albaranToFactura('${a.id}')">📤 Convertir a factura</button>` : ""}
      </div>
    </div>`);
};

/* ══════════════════════════
   GENERAR PDF ALBARÁN
   Delega al motor de presupuestos.js (generarPDFAlbaran)
   que presenta el modal con/sin precios y genera el PDF.
══════════════════════════ */
window._albaranPDF = (id) => {
  // window._pdfAlbaran es registrado por presupuestos.js y ya incluye
  // el modal de selección con/sin precios.
  if (typeof window._pdfAlbaran === "function") {
    window._pdfAlbaran(id);
  } else {
    toast("Error: módulo de PDF no cargado", "error");
  }
};

/* ══════════════════════════
   NUEVO ALBARÁN (desde presupuesto)
══════════════════════════ */
window._nuevoAlbaranDesdePresupuesto = async (presupuestoId) => {
  const year = new Date().getFullYear();
  const { data: lastAlb } = await supabase.from("presupuestos")
    .select("albaran_numero").eq("user_id", SESSION.user.id)
    .eq("estado", "albaran")
    .like("albaran_numero", `A-${year}-%`)
    .order("albaran_numero", { ascending: false }).limit(1);
  const lastNum = lastAlb?.[0]?.albaran_numero
    ? parseInt(lastAlb[0].albaran_numero.split("-")[2]) || 0 : 0;
  const num = `A-${year}-${String(lastNum + 1).padStart(4, "0")}`;

  await supabase.from("presupuestos").update({
    estado: "albaran",
    albaran_numero: num,
    albaran_fecha: new Date().toISOString().slice(0, 10),
  }).eq("id", presupuestoId);
  toast(`Albarán ${num} creado ✅`, "success");
  await refreshAlbaranes();
};

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initAlbaranesView() {
  document.getElementById("nuevoAlbaranBtn")?.addEventListener("click", () => {
    toast("Para crear un albarán, acepta un presupuesto y conviértelo desde la vista de Presupuestos", "info", 5000);
  });
  ["albaranSearch","albaranFilterFacturado","albaranFilterCliente","albaranFilterDesde","albaranFilterHasta","albaranFilterMin","albaranFilterMax"]
    .forEach(id => {
      document.getElementById(id)?.addEventListener("input",  ()=>refreshAlbaranes());
      document.getElementById(id)?.addEventListener("change", ()=>refreshAlbaranes());
    });
  document.getElementById("albaranFilterReset")?.addEventListener("click", ()=>{
    ["albaranSearch","albaranFilterFacturado","albaranFilterCliente","albaranFilterDesde","albaranFilterHasta","albaranFilterMin","albaranFilterMax"]
      .forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    refreshAlbaranes();
  });
}
