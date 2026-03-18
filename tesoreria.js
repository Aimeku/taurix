/* ═══════════════════════════════════════════════════════
   TAURIX · tesoreria.js
   Módulo completo de tesorería: cuentas bancarias,
   conciliación, cashflow, previsión, importar CSV
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

export let CUENTAS = [];

/* ══════════════════════════
   CUENTAS BANCARIAS
══════════════════════════ */
export async function loadCuentas() {
  const { data, error } = await supabase.from("cuentas_bancarias")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadCuentas:", error.message); return []; }
  return data || [];
}

export async function refreshTesoreria() {
  CUENTAS = await loadCuentas();
  await renderCuentas();
  await renderMovimientos();
  await renderCashflow();
  await renderPrevisiones();
}

/* ══════════════════════════
   RENDER CUENTAS
══════════════════════════ */
async function renderCuentas() {
  const saldoTotal = CUENTAS.reduce((a, c) => a + (c.saldo_actual || 0), 0);
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("tesoCuentas", fmt(saldoTotal));

  const wrap = document.getElementById("cuentasBancariasWrap");
  if (!wrap) return;

  if (!CUENTAS.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">
      Sin cuentas bancarias configuradas.
      <br><button onclick="window._nuevaCuenta()" class="btn-outline" style="margin-top:10px;font-size:12px">+ Añadir cuenta</button>
    </div>`;
    return;
  }

  const colores = ["#3b82f6", "#059669", "#f59e0b", "#8b5cf6", "#ef4444"];
  wrap.innerHTML = CUENTAS.map((c, i) => `
    <div style="background:var(--srf);border:1px solid var(--brd);border-radius:12px;padding:16px;display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;border-radius:10px;background:${colores[i % 5]}22;color:${colores[i % 5]};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">
        ${c.tipo === "ahorro" ? "💰" : c.tipo === "tarjeta" ? "💳" : "🏦"}
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14px">${c.nombre}</div>
        <div style="font-size:12px;color:var(--t3)">${c.banco || ""} · ${c.iban ? "···" + c.iban.slice(-4) : "Sin IBAN"}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:monospace;font-size:20px;font-weight:800;color:${c.saldo_actual >= 0 ? "var(--t1)" : "#dc2626"}">${fmt(c.saldo_actual || 0)}</div>
        <div style="font-size:11px;color:var(--t3)">Actualizado: ${c.updated_at ? fmtDate(c.updated_at.slice(0, 10)) : "—"}</div>
      </div>
      <button class="ta-btn" onclick="window._editCuenta('${c.id}')">✏️</button>
    </div>`).join("");
}

/* ══════════════════════════
   MOVIMIENTOS
══════════════════════════ */
async function renderMovimientos() {
  const { data: movs } = await supabase.from("movimientos_bancarios")
    .select("*").eq("user_id", SESSION.user.id)
    .order("fecha", { ascending: false }).limit(30);

  const tbody = document.getElementById("bancoMovimientos");
  if (!tbody) return;

  if (!movs?.length) {
    tbody.innerHTML = `<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">
      Sin movimientos. Importa tu extracto bancario CSV para empezar a conciliar.
    </div>`;
    return;
  }

  const pendientes = movs.filter(m => !m.conciliado).length;
  const countEl = document.getElementById("bancoCountPend");
  if (countEl) countEl.textContent = pendientes ? `${pendientes} sin conciliar` : "Todo conciliado ✅";

  tbody.innerHTML = movs.map(m => `
    <div class="bank-row" style="${!m.conciliado ? "background:rgba(251,191,36,.04)" : ""}">
      <div class="bank-row-icon">${m.importe > 0 ? "💰" : m.descripcion?.toLowerCase().includes("nómin") ? "👥" : "📤"}</div>
      <div class="bank-row-info">
        <div class="bank-row-desc">${m.descripcion || "Sin descripción"}</div>
        <div class="bank-row-date">${fmtDate(m.fecha)} · ${m.cuenta_nombre || "Cuenta"} · ${m.referencia || ""}</div>
      </div>
      <div class="bank-row-amt ${m.importe > 0 ? "pos" : "neg"}">${m.importe > 0 ? "+" : ""}${fmt(m.importe)}</div>
      <div class="bank-row-status">
        ${m.conciliado
          ? `<span class="badge b-cobrada" style="font-size:10px">✓ Conciliado</span>`
          : `<button class="ta-btn ta-emit" onclick="window._conciliarMov('${m.id}')" style="font-size:11px;padding:3px 8px">Conciliar</button>`}
      </div>
    </div>`).join("");
}

/* ══════════════════════════
   CASHFLOW MENSUAL
══════════════════════════ */
async function renderCashflow() {
  const year = new Date().getFullYear();
  const { data: facturas } = await supabase.from("facturas")
    .select("tipo, base, iva, fecha, cobrada, fecha_cobro, estado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);

  const { data: recurrentes } = await supabase.from("gastos_recurrentes")
    .select("importe, proxima_fecha").eq("user_id", SESSION.user.id).eq("activo", true);

  const meses = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const datos = meses.map((mes, m) => {
    const cobros = (facturas || []).filter(f =>
      f.tipo === "emitida" && f.cobrada &&
      f.fecha_cobro?.startsWith(`${year}-${String(m + 1).padStart(2, "0")}`))
      .reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

    const pagos = (facturas || []).filter(f =>
      f.tipo === "recibida" &&
      f.fecha?.startsWith(`${year}-${String(m + 1).padStart(2, "0")}`))
      .reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

    return { mes, cobros, pagos, neto: cobros - pagos };
  });

  const maxVal = Math.max(...datos.map(d => Math.max(d.cobros, d.pagos))) || 1;

  const rows = document.getElementById("cashflowRows");
  if (!rows) return;

  rows.innerHTML = datos.map(d => `
    <div class="cf-row">
      <div class="cf-mes">${d.mes}</div>
      <div class="cf-bar-wrap" style="gap:4px">
        ${d.cobros > 0 ? `<div class="cf-bar-pos" style="width:${Math.max(4, (d.cobros / maxVal) * 100)}%;opacity:.8" title="Cobros: ${fmt(d.cobros)}"></div>` : ""}
        ${d.pagos > 0 ? `<div class="cf-bar-neg" style="width:${Math.max(4, (d.pagos / maxVal) * 100)}%;opacity:.8" title="Pagos: ${fmt(d.pagos)}"></div>` : ""}
        ${d.cobros === 0 && d.pagos === 0 ? `<div style="font-size:11px;color:var(--t4)">Sin datos</div>` : ""}
      </div>
      <div class="cf-val" style="color:${d.neto >= 0 ? "#059669" : "#dc2626"};font-size:13px">
        ${d.neto >= 0 ? "+" : ""}${fmt(d.neto)}
      </div>
    </div>`).join("");

  // KPIs tesorería
  const hoy = new Date();
  const en30 = new Date(hoy.getTime() + 30 * 86400000);
  const hoyStr = hoy.toISOString().slice(0, 10);
  const en30Str = en30.toISOString().slice(0, 10);

  const cobrosPrevistos = (facturas || []).filter(f =>
    f.tipo === "emitida" && !f.cobrada && f.estado === "emitida")
    .reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

  const pagosPrevistos = (recurrentes || []).filter(g => {
    const d = g.proxima_fecha;
    return d && d >= hoyStr && d <= en30Str;
  }).reduce((a, g) => a + g.importe, 0);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("tesoCobrosPrev", fmt(cobrosPrevistos));
  s("tesoPagosPrev", fmt(pagosPrevistos));
  s("tesoNeta", fmt(cobrosPrevistos - pagosPrevistos));
  // Dashboard widgets also
  s("cashCobros", fmt(cobrosPrevistos));
  s("cashPagos", fmt(pagosPrevistos));
  s("cashSaldo", fmt(cobrosPrevistos - pagosPrevistos));
}

/* ══════════════════════════
   PREVISIONES
══════════════════════════ */
async function renderPrevisiones() {
  const { data: facturas } = await supabase.from("facturas")
    .select("base, iva, fecha_vencimiento, cliente_nombre")
    .eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida")
    .eq("cobrada", false)
    .eq("estado", "emitida")
    .order("fecha_vencimiento", { ascending: true })
    .limit(10);

  const tbody = document.getElementById("previsionesBody");
  if (!tbody || !facturas) return;

  const hoy = new Date();
  tbody.innerHTML = (facturas || []).map(f => {
    const dias = f.fecha_vencimiento
      ? Math.floor((new Date(f.fecha_vencimiento) - hoy) / 86400000)
      : null;
    return `<tr>
      <td style="font-size:13px">${f.cliente_nombre || "—"}</td>
      <td class="mono fw7">${fmt(f.base + f.base * f.iva / 100)}</td>
      <td>${f.fecha_vencimiento ? fmtDate(f.fecha_vencimiento) : "—"}</td>
      <td>${dias !== null ? `<span class="dias-badge ${dias < 0 ? "dias-badge--red" : dias <= 7 ? "dias-badge--warn" : "dias-badge--ok"}">${dias < 0 ? "Vencida" : dias + "d"}</span>` : "—"}</td>
    </tr>`;
  }).join("") || `<tr class="dt-empty"><td colspan="4">Sin cobros pendientes próximos</td></tr>`;
}

/* ══════════════════════════
   IMPORTAR CSV BANCARIO
══════════════════════════ */
export function showImportarBancoModal() {
  openModal(`
    <div class="modal" style="max-width:620px">
      <div class="modal-hd">
        <span class="modal-title">📂 Importar extracto bancario</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Importa tu extracto en formato CSV. Compatible con BBVA, Santander, CaixaBank, Bankinter, Sabadell y más.</p>

        <div class="modal-field"><label>Cuenta bancaria</label>
          <select id="imp_cuenta" class="ff-select">
            ${CUENTAS.map(c => `<option value="${c.id}">${c.nombre} · ${c.banco || ""}</option>`).join("")}
            <option value="">— Sin cuenta asignada —</option>
          </select>
        </div>

        <div class="modal-field"><label>Formato CSV</label>
          <select id="imp_formato" class="ff-select">
            <option value="bbva">BBVA</option>
            <option value="santander">Santander</option>
            <option value="caixabank">CaixaBank</option>
            <option value="bankinter">Bankinter</option>
            <option value="sabadell">Sabadell</option>
            <option value="ing">ING</option>
            <option value="generico">Genérico (fecha;desc;importe)</option>
          </select>
        </div>

        <div class="modal-field">
          <label>Archivo CSV</label>
          <div style="border:2px dashed var(--brd);border-radius:10px;padding:32px;text-align:center;cursor:pointer" id="imp_dropzone" onclick="document.getElementById('imp_file').click()">
            <div style="font-size:24px;margin-bottom:8px">📄</div>
            <div style="font-size:13px;font-weight:600;color:var(--t1)">Arrastra el CSV aquí</div>
            <div style="font-size:12px;color:var(--t3);margin-top:4px">o haz click para seleccionar</div>
            <div id="imp_filename" style="font-size:12px;color:var(--accent);margin-top:8px;font-weight:600"></div>
          </div>
          <input type="file" id="imp_file" accept=".csv,.txt" style="display:none"/>
        </div>

        <div id="imp_preview" style="display:none">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">Vista previa (primeras 5 filas)</div>
          <div id="imp_preview_content" style="font-family:monospace;font-size:11px;background:var(--bg2);padding:10px;border-radius:8px;overflow-x:auto;white-space:pre"></div>
          <div style="font-size:13px;font-weight:600;margin-top:8px">
            Se importarán <strong id="imp_count">0</strong> movimientos · <strong id="imp_duplicados">0</strong> ya existentes (se omitirán)
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="imp_save" disabled>📥 Importar movimientos</button>
      </div>
    </div>
  `);

  let parsedRows = [];

  const fileInput = document.getElementById("imp_file");
  const dropzone = document.getElementById("imp_dropzone");

  const handleFile = async (file) => {
    document.getElementById("imp_filename").textContent = file.name;
    const text = await file.text();
    const formato = document.getElementById("imp_formato").value;
    parsedRows = parseCSV(text, formato);

    const preview = document.getElementById("imp_preview");
    const previewContent = document.getElementById("imp_preview_content");
    if (preview) preview.style.display = "";
    if (previewContent) {
      previewContent.textContent = parsedRows.slice(0, 5)
        .map(r => `${r.fecha}  ${r.descripcion.substring(0, 40).padEnd(40)}  ${r.importe >= 0 ? "+" : ""}${r.importe.toFixed(2)}€`)
        .join("\n");
    }
    const countEl = document.getElementById("imp_count");
    if (countEl) countEl.textContent = parsedRows.length;
    const btn = document.getElementById("imp_save");
    if (btn) btn.disabled = parsedRows.length === 0;
  };

  fileInput?.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropzone?.addEventListener("dragover", e => e.preventDefault());
  dropzone?.addEventListener("drop", e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  document.getElementById("imp_save")?.addEventListener("click", async () => {
    if (!parsedRows.length) return;
    const cuentaId = document.getElementById("imp_cuenta").value;
    const cuenta = CUENTAS.find(c => c.id === cuentaId);
    let importados = 0, omitidos = 0;

    for (const row of parsedRows) {
      const { data: existe } = await supabase.from("movimientos_bancarios")
        .select("id").eq("user_id", SESSION.user.id)
        .eq("fecha", row.fecha).eq("importe", row.importe)
        .eq("descripcion", row.descripcion).limit(1);
      if (existe?.length) { omitidos++; continue; }

      await supabase.from("movimientos_bancarios").insert({
        user_id: SESSION.user.id,
        cuenta_id: cuentaId || null,
        cuenta_nombre: cuenta?.nombre || "Sin cuenta",
        fecha: row.fecha,
        descripcion: row.descripcion,
        importe: row.importe,
        saldo: row.saldo || null,
        conciliado: false,
      });
      importados++;
    }

    closeModal();
    toast(`✅ Importados ${importados} movimientos · ${omitidos} omitidos (duplicados)`, "success", 5000);
    await refreshTesoreria();
  });
}

function parseCSV(text, formato) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];

  lines.forEach((line, i) => {
    if (i === 0 && line.toLowerCase().includes("fecha")) return; // skip header
    const parts = line.split(/[;,\t]/);
    if (parts.length < 3) return;

    let fecha, descripcion, importe, saldo;
    try {
      if (formato === "bbva") {
        fecha       = normalizaFecha(parts[0]);
        descripcion = (parts[1] || "").replace(/"/g, "").trim();
        importe     = parseFloat((parts[4] || parts[3] || "0").replace(/\./g, "").replace(",", "."));
        saldo       = parseFloat((parts[5] || "0").replace(/\./g, "").replace(",", "."));
      } else if (formato === "santander") {
        fecha       = normalizaFecha(parts[0]);
        descripcion = (parts[1] || "").replace(/"/g, "").trim();
        importe     = parseFloat((parts[3] || "0").replace(/\./g, "").replace(",", "."));
      } else if (formato === "caixabank") {
        fecha       = normalizaFecha(parts[0]);
        descripcion = (parts[2] || parts[1] || "").replace(/"/g, "").trim();
        importe     = parseFloat((parts[3] || "0").replace(/\./g, "").replace(",", "."));
        saldo       = parseFloat((parts[4] || "0").replace(/\./g, "").replace(",", "."));
      } else {
        // Genérico: fecha;descripcion;importe
        fecha       = normalizaFecha(parts[0]);
        descripcion = (parts[1] || "").replace(/"/g, "").trim();
        importe     = parseFloat((parts[2] || "0").replace(/\./g, "").replace(",", "."));
        saldo       = parts[3] ? parseFloat(parts[3].replace(/\./g, "").replace(",", ".")) : null;
      }

      if (fecha && !isNaN(importe) && descripcion) {
        rows.push({ fecha, descripcion, importe, saldo: saldo || null });
      }
    } catch (e) { /* skip malformed line */ }
  });
  return rows;
}

function normalizaFecha(raw) {
  if (!raw) return null;
  const s = raw.replace(/"/g, "").trim();
  // dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  // dd-mm-yyyy
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  // yyyy-mm-dd — ya está bien
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/* ══════════════════════════
   CONCILIAR MOVIMIENTO
══════════════════════════ */
window._conciliarMov = async (id) => {
  openModal(`
    <div class="modal" style="max-width:540px">
      <div class="modal-hd"><span class="modal-title">🔗 Conciliar movimiento</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p class="modal-note">Vincula este movimiento bancario con una factura registrada en Taurix.</p>
        <div class="modal-field"><label>Buscar factura</label>
          <input id="conc_search" class="ff-input" placeholder="Número, cliente, importe…"/>
        </div>
        <div id="conc_results" style="margin-top:10px;max-height:200px;overflow-y:auto"></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" onclick="window._marcarConciliado('${id}')">✓ Marcar conciliado (sin factura)</button>
      </div>
    </div>`);

  document.getElementById("conc_search")?.addEventListener("input", async e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const { data } = await supabase.from("facturas")
      .select("id, numero_factura, cliente_nombre, base, iva, fecha")
      .eq("user_id", SESSION.user.id)
      .or(`numero_factura.ilike.%${q}%,cliente_nombre.ilike.%${q}%`)
      .limit(5);
    const res = document.getElementById("conc_results");
    if (!res) return;
    res.innerHTML = (data || []).map(f => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border:1px solid var(--brd);border-radius:8px;margin-bottom:6px;cursor:pointer" onclick="window._conciliarConFactura('${id}','${f.id}')">
        <div>
          <div style="font-size:13px;font-weight:600">${f.numero_factura || "S/N"} · ${f.cliente_nombre || "—"}</div>
          <div style="font-size:11px;color:var(--t3)">${fmtDate(f.fecha)}</div>
        </div>
        <div style="font-family:monospace;font-weight:700">${fmt(f.base + f.base * f.iva / 100)}</div>
      </div>`).join("");
  });
};

window._conciliarConFactura = async (movId, facturaId) => {
  await supabase.from("movimientos_bancarios").update({
    conciliado: true, factura_id: facturaId
  }).eq("id", movId);
  closeModal();
  toast("Movimiento conciliado con factura ✅", "success");
  await renderMovimientos();
};

window._marcarConciliado = async (id) => {
  await supabase.from("movimientos_bancarios").update({ conciliado: true }).eq("id", id);
  closeModal();
  toast("Movimiento marcado como conciliado", "success");
  await renderMovimientos();
};

/* ══════════════════════════
   MODAL NUEVA CUENTA
══════════════════════════ */
window._nuevaCuenta = () => showCuentaModal();
window._editCuenta  = (id) => {
  const c = CUENTAS.find(x => x.id === id);
  if (c) showCuentaModal(c);
};

function showCuentaModal(prefill = {}) {
  const isEdit = !!prefill.id;
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🏦 ${isEdit ? "Editar" : "Nueva"} cuenta bancaria</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre / Alias *</label>
            <input id="cb_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Cuenta principal, Cuenta gastos…"/></div>
          <div class="modal-field"><label>Banco</label>
            <input id="cb_banco" class="ff-input" value="${prefill.banco || ""}" placeholder="BBVA, Santander, CaixaBank…"/></div>
        </div>
        <div class="modal-field"><label>IBAN</label>
          <input id="cb_iban" class="ff-input" value="${prefill.iban || ""}" placeholder="ES00 0000 0000 0000 0000 0000"/></div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Tipo de cuenta</label>
            <select id="cb_tipo" class="ff-select">
              <option value="corriente" ${(prefill.tipo || "corriente") === "corriente" ? "selected" : ""}>Cuenta corriente</option>
              <option value="ahorro"    ${prefill.tipo === "ahorro"    ? "selected" : ""}>Cuenta ahorro</option>
              <option value="tarjeta"   ${prefill.tipo === "tarjeta"   ? "selected" : ""}>Tarjeta crédito</option>
              <option value="otra"      ${prefill.tipo === "otra"      ? "selected" : ""}>Otra</option>
            </select>
          </div>
          <div class="modal-field"><label>Saldo actual (€)</label>
            <input type="number" id="cb_saldo" class="ff-input" value="${prefill.saldo_actual || 0}" step="0.01"/></div>
        </div>
        <div class="modal-field"><label>Moneda</label>
          <select id="cb_moneda" class="ff-select">
            <option value="EUR" ${(prefill.moneda || "EUR") === "EUR" ? "selected" : ""}>€ EUR — Euro</option>
            <option value="USD" ${prefill.moneda === "USD" ? "selected" : ""}>$ USD — Dólar</option>
            <option value="GBP" ${prefill.moneda === "GBP" ? "selected" : ""}>£ GBP — Libra</option>
          </select>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="cb_del" style="margin-right:auto">🗑️ Eliminar</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="cb_save">${isEdit ? "Actualizar" : "Añadir cuenta"}</button>
      </div>
    </div>`);

  document.getElementById("cb_save").addEventListener("click", async () => {
    const nombre = document.getElementById("cb_nombre").value.trim();
    if (!nombre) { toast("El nombre es obligatorio", "error"); return; }
    const payload = {
      user_id:      SESSION.user.id,
      nombre,
      banco:        document.getElementById("cb_banco").value.trim(),
      iban:         document.getElementById("cb_iban").value.trim(),
      tipo:         document.getElementById("cb_tipo").value,
      saldo_actual: parseFloat(document.getElementById("cb_saldo").value) || 0,
      moneda:       document.getElementById("cb_moneda").value,
      updated_at:   new Date().toISOString(),
    };
    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("cuentas_bancarias").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("cuentas_bancarias").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Cuenta actualizada ✅" : "Cuenta añadida ✅", "success");
    closeModal();
    CUENTAS = await loadCuentas();
    await renderCuentas();
  });

  if (isEdit) {
    document.getElementById("cb_del")?.addEventListener("click", async () => {
      await supabase.from("cuentas_bancarias").delete().eq("id", prefill.id);
      closeModal(); toast("Cuenta eliminada", "success");
      CUENTAS = await loadCuentas(); await renderCuentas();
    });
  }
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initTesoreriaView() {
  document.getElementById("importarBancoBtn")?.addEventListener("click", showImportarBancoModal);
  document.getElementById("nuevaCuentaBtn")?.addEventListener("click", () => window._nuevaCuenta());
  refreshTesoreria();
}
