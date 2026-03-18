/* ═══════════════════════════════════════════════════════
   TAURIX · amortizaciones.js
   
   Registro de bienes de inversión y amortizaciones:
   · Tabla oficial RD 634/2015 (IS) / LIRPF art. 30
   · Amortización lineal, degresiva, por unidades
   · Libro de bienes de inversión (art. 104-110 LIVA)
   · Regularización IVA bienes de inversión (5/10 años)
   · Exportación Excel / PDF para AEAT
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal, getYear } from "./utils.js";
import { TABLAS_AMORTIZACION, calcAmortizacion } from "./fiscal.js";

/* ══════════════════════════
   LOAD / REFRESH
══════════════════════════ */
export async function loadBienesInversion() {
  const { data, error } = await supabase.from("bienes_inversion")
    .select("*").eq("user_id", SESSION.user.id).order("fecha_alta", { ascending: false });
  if (error) { console.error("bienes_inversion:", error.message); return []; }
  return data || [];
}

export async function refreshBienesInversion() {
  const bienes = await loadBienesInversion();
  renderTablaBienes(bienes);
  renderResumenAmortizacion(bienes);
}

/* ══════════════════════════
   RENDER TABLA
══════════════════════════ */
function renderTablaBienes(bienes) {
  const tbody = document.getElementById("bienesBody");
  if (!tbody) return;

  if (!bienes.length) {
    tbody.innerHTML = `<tr class="dt-empty"><td colspan="10">Sin bienes de inversión registrados. Añade equipos, vehículos, instalaciones y mobiliario afecto a tu actividad.</td></tr>`;
    return;
  }

  tbody.innerHTML = bienes.map(b => {
    const calc = calcAmortizacion({
      valorAdquisicion: b.valor_adquisicion,
      fechaAlta: b.fecha_alta,
      tipo: b.tipo_bien,
      coefElegido: b.coeficiente,
    });
    const cuotaAnual  = calc?.cuotaAnual  || 0;
    const amortAcum   = calc?.amortAcum   || 0;
    const valorNeto   = calc?.valorNeto   || b.valor_adquisicion;
    const pctAmort    = b.valor_adquisicion > 0 ? (amortAcum / b.valor_adquisicion * 100).toFixed(0) : 0;

    // Regularización IVA bienes de inversión
    const esInmueble  = b.tipo_bien?.includes("Edificio") || b.tipo_bien?.includes("construccion");
    const periodoReg  = esInmueble ? 10 : 5; // años (art. 107 LIVA)
    const añosDesde   = new Date().getFullYear() - new Date(b.fecha_alta || Date.now()).getFullYear();
    const enPeriodoReg = añosDesde < periodoReg;

    return `<tr>
      <td>
        <strong style="font-size:13px">${b.nombre}</strong>
        <br><span style="font-size:11px;color:var(--t3)">${b.tipo_bien || "—"}</span>
        ${b.referencia ? `<br><span class="mono" style="font-size:10px;color:var(--t4)">${b.referencia}</span>` : ""}
      </td>
      <td class="mono">${fmt(b.valor_adquisicion)}</td>
      <td class="mono" style="color:var(--t3)">${fmt(b.iva_soportado || 0)}</td>
      <td style="font-size:12px">${fmtDate(b.fecha_alta)}</td>
      <td style="font-size:12px">${b.coeficiente || calc?.coef || "—"}%</td>
      <td class="mono fw7">${fmt(cuotaAnual)}</td>
      <td class="mono">${fmt(amortAcum)}</td>
      <td>
        <div style="background:var(--brd);border-radius:4px;height:6px;width:80px">
          <div style="background:${pctAmort >= 100 ? "#059669" : "var(--accent)"};width:${Math.min(100, pctAmort)}%;height:100%;border-radius:4px"></div>
        </div>
        <div style="font-size:10px;color:var(--t3);margin-top:2px">${pctAmort}% amortizado</div>
      </td>
      <td class="mono fw7" style="color:${valorNeto > 0 ? "var(--t1)" : "#059669"}">${fmt(Math.max(0, valorNeto))}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${enPeriodoReg ? `<span class="badge b-pendiente" style="font-size:9px">🔄 Reg. IVA ${periodoReg}a</span>` : ""}
          <div class="tbl-act">
            <button class="ta-btn" onclick="window._editBien('${b.id}')">✏️</button>
            <button class="ta-btn ta-del" onclick="window._delBien('${b.id}')">🗑️</button>
          </div>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function renderResumenAmortizacion(bienes) {
  const year = getYear();
  const totalInversion = bienes.reduce((a, b) => a + (b.valor_adquisicion || 0), 0);
  const cuotaTotal = bienes.reduce((a, b) => {
    const calc = calcAmortizacion({ valorAdquisicion: b.valor_adquisicion, fechaAlta: b.fecha_alta, tipo: b.tipo_bien, coefElegido: b.coeficiente });
    return a + (calc?.cuotaAnual || 0);
  }, 0);
  const valorNetoTotal = bienes.reduce((a, b) => {
    const calc = calcAmortizacion({ valorAdquisicion: b.valor_adquisicion, fechaAlta: b.fecha_alta, tipo: b.tipo_bien, coefElegido: b.coeficiente });
    return a + Math.max(0, calc?.valorNeto || b.valor_adquisicion);
  }, 0);
  const ivaSoportado = bienes.reduce((a, b) => a + (b.iva_soportado || 0), 0);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("bienesTotal",      fmt(totalInversion));
  s("bienesAmortAnual", fmt(cuotaTotal));
  s("bienesValorNeto",  fmt(valorNetoTotal));
  s("bienesIVA",        fmt(ivaSoportado));
}

/* ══════════════════════════
   MODAL NUEVO BIEN
══════════════════════════ */
export function showNuevoBienModal(prefill = {}) {
  const isEdit = !!prefill.id;
  const tipoOptions = Object.entries(TABLAS_AMORTIZACION).map(([tipo, tabla]) =>
    `<option value="${tipo}" ${prefill.tipo_bien === tipo ? "selected" : ""}>${tipo} (coef. máx. ${tabla.coefMax}%)</option>`
  ).join("");

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">🏗️ ${isEdit ? "Editar" : "Nuevo"} bien de inversión</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Los bienes de inversión se amortizan según las tablas oficiales de la AEAT. La amortización es un gasto deducible en el IRPF / IS y el IVA soportado puede ser objeto de regularización (art. 104-110 LIVA).</p>

        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre / Descripción *</label>
            <input id="bi_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Ej: MacBook Pro 14', Mesa escritorio…"/></div>
          <div class="modal-field"><label>Referencia / Nº serie</label>
            <input id="bi_ref" class="ff-input" value="${prefill.referencia || ""}" placeholder="Nº serie, modelo…"/></div>
        </div>
        <div class="modal-field"><label>Tipo de bien (tabla de amortización)</label>
          <select id="bi_tipo" class="ff-select">${tipoOptions}</select>
        </div>
        <div class="modal-grid3">
          <div class="modal-field"><label>Valor de adquisición (€) *</label>
            <input type="number" id="bi_valor" class="ff-input" value="${prefill.valor_adquisicion || ""}" step="0.01"/></div>
          <div class="modal-field"><label>IVA soportado (€)</label>
            <input type="number" id="bi_iva" class="ff-input" value="${prefill.iva_soportado || ""}" step="0.01" placeholder="0.00"/></div>
          <div class="modal-field"><label>Coeficiente de amortización %</label>
            <input type="number" id="bi_coef" class="ff-input" value="${prefill.coeficiente || ""}" step="0.5" min="1" max="100" placeholder="Dejar vacío = máximo legal"/>
            <div id="bi_coef_info" style="font-size:11px;color:var(--t3);margin-top:3px"></div>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Fecha de alta / compra *</label>
            <input type="date" id="bi_fecha" class="ff-input" value="${prefill.fecha_alta || new Date().toISOString().slice(0,10)}"/></div>
          <div class="modal-field"><label>% Afectación a la actividad</label>
            <input type="number" id="bi_afectacion" class="ff-input" value="${prefill.pct_afectacion || 100}" min="1" max="100" step="1"/>
            <div style="font-size:11px;color:var(--t3);margin-top:3px">Solo el % afecto es deducible fiscalmente</div>
          </div>
        </div>
        <div class="modal-field"><label>Descripción de uso en la actividad</label>
          <input id="bi_uso" class="ff-input" value="${prefill.uso_actividad || ""}" placeholder="Ej: Equipo de trabajo para desarrollo de software"/></div>

        <!-- Preview amortización -->
        <div id="bi_preview" style="background:var(--bg2);border-radius:10px;padding:14px;margin-top:12px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em;margin-bottom:10px">📊 Preview amortización</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
            <div><div style="font-size:11px;color:var(--t3)">Cuota anual</div><strong id="bi_prev_cuota">—</strong></div>
            <div><div style="font-size:11px;color:var(--t3)">Cuota mensual</div><strong id="bi_prev_cuotames">—</strong></div>
            <div><div style="font-size:11px;color:var(--t3)">Vida útil</div><strong id="bi_prev_vida">—</strong></div>
            <div><div style="font-size:11px;color:var(--t3)">Totalmente amortizado en</div><strong id="bi_prev_fin">—</strong></div>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="bi_del" style="margin-right:auto">🗑️ Eliminar bien</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="bi_save">${isEdit ? "Actualizar" : "Registrar bien"}</button>
      </div>
    </div>
  `);

  // Actualizar coef info y preview
  const updatePreview = () => {
    const tipo  = document.getElementById("bi_tipo")?.value;
    const valor = parseFloat(document.getElementById("bi_valor")?.value) || 0;
    const coef  = parseFloat(document.getElementById("bi_coef")?.value) || 0;
    const fecha = document.getElementById("bi_fecha")?.value;
    const tabla = TABLAS_AMORTIZACION[tipo];

    if (tabla) {
      const infoEl = document.getElementById("bi_coef_info");
      if (infoEl) infoEl.textContent = `Coef. máximo: ${tabla.coefMax}% · Período máximo: ${tabla.periodoMax} años`;
    }

    if (valor > 0 && tipo) {
      const calc = calcAmortizacion({ valorAdquisicion: valor, fechaAlta: fecha, tipo, coefElegido: coef || undefined });
      if (calc) {
        const fechaFin = new Date((fecha ? new Date(fecha).getFullYear() : new Date().getFullYear()) + calc.vidaUtil, 0, 1);
        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s("bi_prev_cuota",    fmt(calc.cuotaAnual));
        s("bi_prev_cuotames", fmt(calc.cuotaAnual / 12));
        s("bi_prev_vida",     calc.vidaUtil + " años");
        s("bi_prev_fin",      fechaFin.getFullYear().toString());
      }
    }
  };

  document.getElementById("bi_tipo")?.addEventListener("change", updatePreview);
  document.getElementById("bi_valor")?.addEventListener("input", updatePreview);
  document.getElementById("bi_coef")?.addEventListener("input", updatePreview);
  updatePreview();

  document.getElementById("bi_save").addEventListener("click", async () => {
    const nombre = document.getElementById("bi_nombre").value.trim();
    const valor  = parseFloat(document.getElementById("bi_valor").value);
    const fecha  = document.getElementById("bi_fecha").value;
    if (!nombre || isNaN(valor) || !fecha) { toast("Nombre, valor y fecha son obligatorios", "error"); return; }

    const payload = {
      user_id:           SESSION.user.id,
      nombre,
      referencia:        document.getElementById("bi_ref").value.trim(),
      tipo_bien:         document.getElementById("bi_tipo").value,
      valor_adquisicion: valor,
      iva_soportado:     parseFloat(document.getElementById("bi_iva").value) || 0,
      coeficiente:       parseFloat(document.getElementById("bi_coef").value) || null,
      fecha_alta:        fecha,
      pct_afectacion:    parseInt(document.getElementById("bi_afectacion").value) || 100,
      uso_actividad:     document.getElementById("bi_uso").value.trim(),
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("bienes_inversion").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("bienes_inversion").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Bien actualizado ✅" : "Bien registrado ✅", "success");
    closeModal();
    await refreshBienesInversion();
  });

  if (isEdit) {
    document.getElementById("bi_del")?.addEventListener("click", async () => {
      await supabase.from("bienes_inversion").delete().eq("id", prefill.id);
      closeModal(); toast("Bien eliminado", "success");
      await refreshBienesInversion();
    });
  }
}

window._editBien = async (id) => {
  const { data } = await supabase.from("bienes_inversion").select("*").eq("id", id).single();
  if (data) showNuevoBienModal(data);
};
window._delBien = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar bien</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este bien de inversión del registro? No afecta a las facturas ya registradas.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_dbiOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_dbiOk").addEventListener("click", async () => {
    await supabase.from("bienes_inversion").delete().eq("id", id);
    closeModal(); toast("Bien eliminado", "success");
    await refreshBienesInversion();
  });
};

/* ══════════════════════════
   EXPORTAR LIBRO BIENES PDF
   Art. 104-110 LIVA
══════════════════════════ */
export async function exportLibroBienesPDF() {
  const bienes = await loadBienesInversion();
  if (!bienes.length) { toast("Sin bienes de inversión registrados", "info"); return; }

  // Cargar jsPDF
  if (!window.jspdf?.jsPDF) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("*").eq("user_id", SESSION.user.id).single();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const PW = 297, ML = 14, W = PW - ML * 2;
  const BLUE = [26, 86, 219];

  doc.setFillColor(...BLUE); doc.rect(0, 0, PW, 28, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("LIBRO REGISTRO DE BIENES DE INVERSIÓN", PW / 2, 11, { align: "center" });
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
  doc.text(`Arts. 104-110 LIVA (RD 1624/1992) · Regularización IVA bienes de inversión`, PW / 2, 18, { align: "center" });
  doc.text(`${pf?.nombre_razon_social || "—"} · NIF: ${pf?.nif || "—"} · Ejercicio: ${getYear()}`, PW / 2, 24, { align: "center" });

  let y = 36;
  const cols = [50, 40, 25, 22, 18, 22, 22, 22, 25, 18, 20];
  const heads = ["Bien / Descripción","Tipo","F. Alta","Valor adq.","IVA soport.","Coef %","Cuota anual","Amort.acum.","Valor neto","% Afect.","Período reg."];

  doc.setFillColor(...BLUE); doc.rect(ML, y, W, 8, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  let x = ML;
  heads.forEach((h, i) => { doc.text(h, x + 1, y + 5); x += cols[i]; }); y += 8;

  doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "normal");
  bienes.forEach((b, ri) => {
    const calc = calcAmortizacion({ valorAdquisicion: b.valor_adquisicion, fechaAlta: b.fecha_alta, tipo: b.tipo_bien, coefElegido: b.coeficiente });
    if (ri % 2 === 0) doc.setFillColor(245, 248, 255); else doc.setFillColor(255, 255, 255);
    doc.rect(ML, y, W, 7, "F"); x = ML;
    const esInm = b.tipo_bien?.includes("Edificio");
    const row = [
      (b.nombre || "—").substring(0, 24),
      (b.tipo_bien || "—").substring(0, 20),
      b.fecha_alta || "—",
      fmt(b.valor_adquisicion),
      fmt(b.iva_soportado || 0),
      (calc?.coef || "—") + "%",
      fmt(calc?.cuotaAnual || 0),
      fmt(calc?.amortAcum || 0),
      fmt(Math.max(0, calc?.valorNeto || b.valor_adquisicion)),
      (b.pct_afectacion || 100) + "%",
      (esInm ? "10 años" : "5 años"),
    ];
    row.forEach((v, i) => { doc.setFontSize(7.5); doc.text(String(v), x + 1, y + 4.5); x += cols[i]; });
    y += 7;
    if (y > 185) { doc.addPage(); y = 20; }
  });

  y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
  doc.text("NOTA LEGAL: El período de regularización es de 5 años para bienes muebles y de 10 años para bienes inmuebles (art. 107 LIVA). Si varía el porcentaje de utilización en la actividad, debe regularizarse la deducción del IVA soportado.", ML, y, { maxWidth: W });

  doc.save(`libro_bienes_inversion_${getYear()}.pdf`);
  toast("Libro de bienes de inversión exportado ✅", "success");
}

/* ══════════════════════════
   INIT VIEW
══════════════════════════ */
export function initAmortizacionesView() {
  document.getElementById("nuevoBienBtn")?.addEventListener("click", () => showNuevoBienModal());
  document.getElementById("exportLibroBienesBtn")?.addEventListener("click", exportLibroBienesPDF);
  refreshBienesInversion();
}
