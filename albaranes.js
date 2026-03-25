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
  const search = (document.getElementById("albaranSearch")?.value || "").toLowerCase();

  const { data, error } = await supabase.from("presupuestos")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .eq("estado", "albaran")
    .gte("fecha", ini).lte("fecha", fin)
    .order("fecha", { ascending: false });

  if (error) { console.error("albaranes:", error.message); return; }

  let albaranes = data || [];
  if (search) {
    albaranes = albaranes.filter(a =>
      (a.concepto || "").toLowerCase().includes(search) ||
      (a.numero || "").toLowerCase().includes(search) ||
      (a.albaran_numero || "").toLowerCase().includes(search) ||
      (a.cliente_nombre || "").toLowerCase().includes(search)
    );
  }

  const countEl = document.getElementById("albaranesCount");
  if (countEl) countEl.textContent = `${albaranes.length} albarán${albaranes.length !== 1 ? "es" : ""} en el periodo`;

  const tbody = document.getElementById("albaranesBody");
  if (!tbody) return;

  if (!albaranes.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="8">Sin albaranes en este periodo. Los albaranes se crean desde presupuestos aceptados.</td></tr>`;
    return;
  }

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
          ? `<span class="badge b-cobrada">✅ Facturado</span>`
          : `<span class="badge b-pendiente">⏳ Pendiente</span>`}
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
        <p style="font-size:13px;color:var(--t2);line-height:1.6">Se creará una factura en estado <strong>borrador</strong> con todos los datos de este albarán. Luego puedes revisarla y emitirla.</p>
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

    // Marcar el albarán como facturado
    await supabase.from("presupuestos").update({ factura_id: factura.id }).eq("id", id);

    closeModal();
    toast("📤 Factura creada como borrador — revísala en Facturas", "success", 4000);
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
══════════════════════════ */
window._albaranPDF = async (id) => {
  const { data: a } = await supabase.from("presupuestos").select("*").eq("id", id).single();
  if (!a) return;

  // Cargar jsPDF si no está
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();
  const lineas = a.lineas ? (typeof a.lineas === "string" ? JSON.parse(a.lineas) : a.lineas) : [];
  const total = a.base + a.base * (a.iva || 21) / 100;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, W = PW - ML * 2;
  const BLUE = [26, 86, 219], INK = [15, 23, 42];

  // Header
  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 32, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("ALBARÁN DE ENTREGA", ML, 15);
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(`Nº ${a.albaran_numero || a.numero || "S/N"}  ·  ${fmtDate(a.albaran_fecha || a.fecha)}`, ML, 26);

  let y = 44;
  doc.setTextColor(...INK);

  // Emisor
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(pf?.nombre_razon_social || "Mi empresa", ML, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  if (pf?.nif) { doc.text(`NIF: ${pf.nif}`, ML, y); y += 5; }
  if (pf?.domicilio_fiscal) { doc.text(pf.domicilio_fiscal, ML, y); y += 5; }
  y += 4;

  // Cliente
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("Destinatario:", ML, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(a.cliente_nombre || "—", ML, y); y += 5;
  if (a.cliente_nif) { doc.text(`NIF: ${a.cliente_nif}`, ML, y); y += 5; }
  y += 8;

  // Líneas
  if (lineas.length) {
    const cols = [80, 20, 35, 35];
    const heads = ["Descripción", "Uds.", "Precio", "Importe"];
    doc.setFillColor(...BLUE); doc.rect(ML, y, W, 8, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    let x = ML;
    heads.forEach((h, i) => { doc.text(h, x + 2, y + 5.5); x += cols[i]; }); y += 8;
    doc.setTextColor(...INK); doc.setFont("helvetica", "normal");

    lineas.forEach((l, ri) => {
      if (ri % 2 === 0) doc.setFillColor(245, 248, 255); else doc.setFillColor(255, 255, 255);
      doc.rect(ML, y, W, 7, "F");
      x = ML;
      const row = [(l.descripcion || "—").substring(0, 40), String(l.cantidad || 1), fmt(l.precio || 0), fmt((l.cantidad || 1) * (l.precio || 0))];
      row.forEach((v, i) => { doc.setFontSize(8); doc.text(v, x + 2, y + 5); x += cols[i]; });
      y += 7;
      if (y > 260) { doc.addPage(); y = 18; }
    });
  }

  y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`Total: ${fmt(total)}`, PW - ML, y, { align: "right" });

  y += 20;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(150, 150, 150);
  doc.text("Conforme recibido: ____________________________     Fecha: ____/____/________", ML, y);

  doc.save(`albaran_${a.albaran_numero || a.numero || "SN"}.pdf`);
  toast("PDF de albarán descargado ✅", "success");
};

/* ══════════════════════════
   NUEVO ALBARÁN (desde presupuesto)
══════════════════════════ */
window._nuevoAlbaranDesdePresupuesto = async (presupuestoId) => {
  const num = `ALB-${new Date().getFullYear()}-${String(Date.now() % 10000).padStart(4, "0")}`;
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
  document.getElementById("albaranSearch")?.addEventListener("input", () => refreshAlbaranes());
}
