/* ═══════════════════════════════════════════════════════
   TAURIX · utils.js  — v3 MÁXIMO
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { logout } from "./auth.js";

export let SESSION = null;
export let CLIENTES = [];
export let EMPRESA_ACTIVA = null;

export function setSession(s) { SESSION = s; }
export function setClientes(c) { CLIENTES = c; }
export function setEmpresaActiva(e) {
  EMPRESA_ACTIVA = e;
  if (e?.id) localStorage.setItem("tg_empresa_id", e.id);
}

export const TRIM_RANGOS = {
  T1: ["01-01", "03-31"], T2: ["04-01", "06-30"],
  T3: ["07-01", "09-30"], T4: ["10-01", "12-31"]
};
export const TRIM_LABELS = {
  T1: "Enero – Marzo", T2: "Abril – Junio",
  T3: "Julio – Septiembre", T4: "Octubre – Diciembre"
};
export const TRIM_PLAZOS = {
  T1: "20 de abril", T2: "20 de julio",
  T3: "20 de octubre", T4: "30 de enero"
};

export const OP_INFO = {
  nacional: "Operación sujeta a IVA español. El IVA se repercute y se declara en el Modelo 303.",
  intracomunitaria: "Entrega o adquisición intracomunitaria. Las entregas están exentas (art. 25 LIVA). Las adquisiciones tributan por inversión del sujeto pasivo.",
  exportacion: "Exportación fuera de la UE. Exenta de IVA (art. 21 LIVA). Requiere documentación aduanera.",
  importacion: "Importación de bienes de fuera de la UE. El IVA se liquida en aduana (DUA).",
  inversion_sujeto_pasivo: "Inversión del sujeto pasivo (art. 84 LIVA). La factura se emite sin IVA."
};

export const fmt = n => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);
export const fmtShort = n => { const v = Math.abs(n || 0); return v >= 1000 ? "€" + (v / 1000).toFixed(1) + "k" : "€" + v.toFixed(2); };
export const fmtDate = s => s ? new Date(s + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
export const fmtDateLong = s => s ? new Date(s + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }) : "—";

export function toast(msg, type = "info", ms = 3500) {
  const c = document.getElementById("toastEl");
  if (!c) return;
  const icons = {
    success: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warn:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };
  const el = document.createElement("div");
  el.className = `toast t-${type}`;
  el.innerHTML = `${icons[type] || ""}<span>${msg}</span>`;
  c.appendChild(el);
  const remove = () => {
    el.style.opacity = "0"; el.style.transform = "translateX(16px)"; el.style.transition = "all .2s";
    setTimeout(() => el.remove(), 220);
  };
  setTimeout(remove, ms);
  return el;
}

export function toastConDeshacer(msg, onUndo, ms = 5000) {
  const c = document.getElementById("toastEl");
  if (!c) return;
  const el = document.createElement("div");
  el.className = "toast t-success toast--with-undo";
  el.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
    <span style="flex:1">${msg}</span>
    <button class="toast-undo-btn">Deshacer</button>
  `;
  c.appendChild(el);
  let undone = false;
  const remove = () => {
    el.style.opacity = "0"; el.style.transform = "translateX(16px)"; el.style.transition = "all .2s";
    setTimeout(() => el.remove(), 220);
  };
  const tid = setTimeout(() => { if (!undone) remove(); }, ms);
  el.querySelector(".toast-undo-btn").addEventListener("click", () => {
    undone = true; clearTimeout(tid); remove();
    if (typeof onUndo === "function") onUndo();
  });
  return el;
}

/* ══════════════════════════
   MODAL
   openModal inyecta HTML en #modalEl y muestra el overlay.
   closeModal limpia y oculta.
══════════════════════════ */
export function openModal(html, { noCloseOnBackdrop = true } = {}) {
  const c = document.getElementById("modalEl");
  if (!c) { console.error("modalEl no encontrado en el DOM"); return; }
  c.innerHTML = html;
  c.style.display = "flex";
  c.style.position = "fixed";
  c.style.inset = "0";
  c.style.background = "rgba(11,13,18,.65)";
  c.style.alignItems = "center";
  c.style.justifyContent = "center";
  c.style.zIndex = "1000";
  c.style.backdropFilter = "blur(10px)";
  // Cerrar al click en el fondo
  c.onclick = noCloseOnBackdrop ? null : (e) => { if (e.target === c) closeModal(); };
}

export function closeModal() {
  const c = document.getElementById("modalEl");
  if (!c) return;
  c.innerHTML = "";
  c.style.display = "none";
  c.onclick = null;
}
window._cm = closeModal;

export let DARK_MODE = localStorage.getItem("tg_dark") === "1";

export function applyDarkMode(on) {
  document.documentElement.classList.toggle("dark", on);
  DARK_MODE = on;
  localStorage.setItem("tg_dark", on ? "1" : "0");
  const btn = document.getElementById("darkModeBtn");
  if (btn) btn.title = on ? "Modo claro" : "Modo oscuro";
  if (btn) btn.innerHTML = on
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
}

export function initNav() {
  document.querySelectorAll(".sn-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.querySelectorAll(".btn-link[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.querySelectorAll(".contab-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".contab-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const panelId = "ctabPanel_" + tab.dataset.ctab;
      document.querySelectorAll("[id^='ctabPanel_']").forEach(p => p.style.display = "none");
      const panel = document.getElementById(panelId);
      if (panel) panel.style.display = "";
    });
  });
}

export function switchView(view) {
  document.querySelectorAll(".sn-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelector(`.sn-item[data-view="${view}"]`)?.classList.add("active");
  const v = document.getElementById(`view-${view}`);
  if (v) v.classList.add("active");
  document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
}
window._switchView = switchView;

export function getYear() {
  return parseInt(document.getElementById("yearSelect")?.value || new Date().getFullYear());
}
export function getTrim() {
  return document.getElementById("trimestreSelect")?.value || "T1";
}
export function getFechaRango(year, trim) {
  const [i, f] = TRIM_RANGOS[trim];
  return { ini: `${year}-${i}`, fin: `${year}-${f}` };
}

export async function getFacturasTrim(year, trim) {
  if (!SESSION) return [];
  const { ini, fin } = getFechaRango(year, trim);
  const { data, error } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha", ini).lte("fecha", fin);
  if (error) { console.error("getFacturasTrim:", error.message); return []; }
  return data || [];
}

export async function getFacturasYear(year) {
  if (!SESSION) return [];
  const { data, error } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);
  if (error) { console.error("getFacturasYear:", error.message); return []; }
  return data || [];
}

export function isCerrado(year, trim) {
  try {
    return localStorage.getItem(`tg_cierre_${year}_${trim}`) === "1";
  } catch { return false; }
}

export function calcIVA(facturas) {
  const rep = { 21: 0, 10: 0, 4: 0, 0: 0, total: 0 };
  const sop = { int: 0, imp: 0, total: 0 };
  const byOp = { nacional: 0, intracomunitaria: 0, exportacion: 0, inversion_sujeto_pasivo: 0 };
  facturas.forEach(f => {
    const cuota = f.base * (f.iva || 0) / 100;
    const op = f.tipo_operacion || "nacional";
    if (f.tipo === "emitida" && f.estado === "emitida") {
      const k = [21, 10, 4, 0].includes(f.iva) ? f.iva : 21;
      rep[k] = (rep[k] || 0) + cuota;
      rep.total += cuota;
      byOp[op] = (byOp[op] || 0) + f.base;
    } else if (f.tipo === "recibida") {
      if (op === "importacion") sop.imp += cuota;
      else sop.int += cuota;
      sop.total += cuota;
    }
  });
  return { rep, sop, resultado: rep.total - sop.total, byOp };
}

export function calcIRPF(facturas) {
  let ingresos = 0, gastos = 0, retenciones = 0;
  facturas.forEach(f => {
    if (f.tipo === "emitida" && f.estado === "emitida") {
      ingresos += f.base;
      if (f.irpf) retenciones += f.base * f.irpf / 100;
    } else if (f.tipo === "recibida") {
      gastos += f.base;
    }
  });
  const rendimiento = ingresos - gastos;
  const pagoFrac = Math.max(0, rendimiento * 0.20);
  return { ingresos, gastos, rendimiento, retenciones, pagoFrac, resultado: Math.max(0, pagoFrac - retenciones) };
}

export async function calcVerifactuHash(factura, hashAnterior = "") {
  const campos = [
    factura.numero_factura || "",
    factura.fecha || "",
    factura.base?.toFixed(2) || "0.00",
    factura.iva?.toString() || "0",
    factura.cliente_nif || "",
    hashAnterior
  ].join("|");
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(campos));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function registrarVerifactu(facturaId) {
  const { data: f } = await supabase.from("facturas").select("*").eq("id", facturaId).single();
  if (!f) throw new Error("Factura no encontrada");
  const { data: ultima } = await supabase.from("verifactu_registro")
    .select("hash_factura").eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const hash = await calcVerifactuHash(f, ultima?.hash_factura || "");
  const { error } = await supabase.from("verifactu_registro").insert({
    user_id: SESSION.user.id, factura_id: facturaId,
    numero_factura: f.numero_factura, hash_factura: hash,
    hash_anterior: ultima?.hash_factura || "",
    fecha_registro: new Date().toISOString(), firmado: true
  });
  if (error) throw new Error(error.message);
  await supabase.from("facturas").update({ verifactu_hash: hash, verifactu_fecha: new Date().toISOString() }).eq("id", facturaId);
  return hash;
}

export async function refreshVerifactu() {
  if (!SESSION) return;
  const { data, error } = await supabase.from("verifactu_registro")
    .select("*").eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false }).limit(50);
  if (error) { console.error("refreshVerifactu:", error.message); return; }
  const lista = data || [];
  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("vfFactFirmadas", lista.length);
  s("vfUltimoReg", lista[0] ? fmtDate(lista[0].created_at?.slice(0, 10)) : "—");
  s("vfHash", lista[0]?.hash_factura || "—");
  s("vfRectif", lista.filter(r => r.numero_factura?.includes("R")).length || "0");
  const tbody = document.getElementById("verifactuBody");
  if (!tbody) return;
  if (!lista.length) { tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">Sin facturas firmadas</td></tr>`; return; }
  tbody.innerHTML = lista.map(r => `
    <tr>
      <td><span class="badge b-income mono" style="font-size:11px">${r.numero_factura || "—"}</span></td>
      <td class="mono" style="font-size:12px">${fmtDate(r.created_at?.slice(0, 10))}</td>
      <td style="font-size:12px;color:var(--t3)">—</td>
      <td class="mono fw7">—</td>
      <td style="font-size:10px;font-family:monospace;color:var(--t4);max-width:180px;overflow:hidden;text-overflow:ellipsis">${r.hash_factura || "—"}</td>
      <td><button class="ta-btn" data-id="${r.factura_id}" onclick="window._verQR(this.dataset.id)" title="Ver QR">📱</button></td>
      <td><span class="badge b-cobrada">✓ Firmada</span></td>
    </tr>`).join("");
}

export async function calcModelo347(year) {
  if (!SESSION) return [];
  const { data: facturas } = await supabase.from("facturas")
    .select("cliente_nombre, cliente_nif, tipo, base, iva, estado")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);
  const UMBRAL = 3005.06;
  const acumulados = {};
  (facturas || []).forEach(f => {
    const key = f.cliente_nif || f.cliente_nombre || "SIN_NIF";
    if (!acumulados[key]) acumulados[key] = { nombre: f.cliente_nombre, nif: f.cliente_nif, total: 0, tipo: f.tipo };
    acumulados[key].total += f.base + f.base * (f.iva || 0) / 100;
  });
  return Object.values(acumulados).filter(a => a.total >= UMBRAL);
}

export async function loadEmpresas() {
  if (!SESSION) return [];
  const { data, error } = await supabase.from("empresas").select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadEmpresas:", error.message); return []; }
  return data || [];
}

export async function initMultiEmpresa() {
  const empresas = await loadEmpresas();
  const sel = document.getElementById("empresaSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Empresa personal —</option>`;
  empresas.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id; opt.textContent = `${e.nombre} · ${e.nif || ""}`;
    sel.appendChild(opt);
  });
  const lastId = localStorage.getItem("tg_empresa_id");
  if (lastId && empresas.find(e => e.id === lastId)) sel.value = lastId;
  sel.addEventListener("change", async () => {
    setEmpresaActiva(empresas.find(e => e.id === sel.value) || null);
    if (window._refresh) await window._refresh();
  });
}

export function checkFiscalDeadlines() {
  const hoy = new Date();
  const mes = hoy.getMonth() + 1, dia = hoy.getDate();
  const plazos = [
    { mes: 4,  dia: 20, trim: "T1", label: "T1 (Ene–Mar)" },
    { mes: 7,  dia: 20, trim: "T2", label: "T2 (Abr–Jun)" },
    { mes: 10, dia: 20, trim: "T3", label: "T3 (Jul–Sep)" },
    { mes: 1,  dia: 30, trim: "T4", label: "T4 (Oct–Dic)" },
  ];
  const banner = document.getElementById("fiscalDeadlineBanner");
  if (!banner) return;
  let html = "";
  plazos.forEach(p => {
    if (mes !== p.mes) return;
    const diasRestantes = p.dia - dia;
    if (diasRestantes < 0 || diasRestantes > 15) return;
    const urgencia = diasRestantes <= 5 ? "urgente" : "aviso";
    const color = urgencia === "urgente" ? "#dc2626" : "#d97706";
    const bg    = urgencia === "urgente" ? "#fef2f2" : "#fef9c3";
    html = `<div style="background:${bg};border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:12px 20px;margin-bottom:12px;display:flex;align-items:center;gap:12px;font-size:13px;font-weight:500">
      <span style="font-size:18px">${urgencia === "urgente" ? "🚨" : "⚠️"}</span>
      <span><strong>Plazo fiscal próximo:</strong> Modelos 303 y 130 del ${p.label} — presentar antes del ${String(p.dia).padStart(2,"0")}/${String(p.mes).padStart(2,"0")}.
      ${diasRestantes === 0 ? " ¡<strong>Último día!</strong>" : ` Quedan <strong>${diasRestantes} día${diasRestantes !== 1 ? "s" : ""}</strong>.`}</span>
      <button onclick="window._switchView('iva')" style="margin-left:auto;font-size:12px;padding:5px 12px;border:1.5px solid ${color};border-radius:8px;background:none;color:${color};cursor:pointer;font-weight:600">Ver Modelo 303 →</button>
    </div>`;
  });
  banner.innerHTML = html;
  banner.style.display = html ? "" : "none";
}

export async function checkOnboarding() {
  if (localStorage.getItem("tg_onboard_done") === "1") return;
  // FIX: usar maybeSingle() — .single() da 406 si el usuario no tiene perfil aún
  const { data: pf } = await supabase.from("perfil_fiscal")
    .select("nombre_razon_social").eq("user_id", SESSION.user.id).maybeSingle();
  if (pf?.nombre_razon_social) { localStorage.setItem("tg_onboard_done", "1"); return; }
  const banner = document.getElementById("onboardingBanner");
  if (!banner) return;
  banner.style.display = "";
  banner.innerHTML = `
    <div style="background:linear-gradient(135deg,#1a56db,#1e40af);color:#fff;border-radius:12px;padding:16px 24px;margin-bottom:16px;display:flex;align-items:center;gap:16px">
      <span style="font-size:24px">👋</span>
      <div style="flex:1"><strong>¡Bienvenido a Taurix!</strong> Antes de empezar, completa tu perfil fiscal para que aparezca en tus facturas y libros oficiales.</div>
      <button onclick="window.showPerfilModal()" style="background:#fff;color:#1a56db;border:none;padding:8px 18px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">Completar perfil →</button>
      <button onclick="this.closest('#onboardingBanner').style.display='none';localStorage.setItem('tg_onboard_done','1')" style="background:rgba(255,255,255,.15);color:#fff;border:none;padding:8px;border-radius:6px;cursor:pointer;font-size:16px">×</button>
    </div>`;
}

export async function checkRecordatoriosTrimestrales() {}

export async function showPerfilModal() {
  // FIX: usar maybeSingle() en lugar de single()
  const { data: p } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).maybeSingle();
  const logoActual = p?.logo_url || "";

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">⚙️ Perfil fiscal y empresa</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Estos datos aparecen en los libros oficiales y en el encabezado de tus facturas.</p>
        <div class="modal-field">
          <label>Logo de empresa <span style="font-weight:400;color:var(--t4)">(aparece en facturas y presupuestos PDF)</span></label>
          <div style="display:flex;align-items:center;gap:16px;margin-top:6px">
            <div id="pf_logo_preview" style="width:100px;height:60px;border:2px dashed var(--brd);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--srf2);flex-shrink:0;cursor:pointer" onclick="document.getElementById('pf_logo_input').click()">
              ${logoActual ? `<img src="${logoActual}" style="max-width:96px;max-height:56px;object-fit:contain"/>` : `<span style="font-size:11px;color:var(--t4);text-align:center;padding:8px">Click para<br>subir logo</span>`}
            </div>
            <div>
              <input type="file" id="pf_logo_input" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none"/>
              <button type="button" id="pf_logo_upload_btn" class="btn-outline" style="font-size:12px;padding:7px 14px;margin-bottom:8px">📁 ${logoActual ? "Cambiar logo" : "Subir logo"}</button>
              ${logoActual ? `<button type="button" id="pf_logo_remove" class="btn-outline" style="font-size:12px;padding:7px 14px;margin-left:6px;color:var(--red);border-color:var(--red-mid)">🗑️ Quitar</button>` : ""}
              <div style="font-size:11.5px;color:var(--t4);line-height:1.5;margin-top:4px">PNG, JPG o SVG · Máx. 500KB · Fondo transparente recomendado</div>
            </div>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre o Razón Social *</label><input id="pf_nombre" class="ff-input" value="${p?.nombre_razon_social || ""}"/></div>
          <div class="modal-field"><label>NIF / CIF *</label><input id="pf_nif" class="ff-input" value="${p?.nif || ""}"/></div>
        </div>
        <div class="modal-field"><label>Actividad (epígrafe IAE)</label><input id="pf_act" class="ff-input" value="${p?.actividad || ""}" placeholder="Ej: Desarrollo de software · IAE 763"/></div>
        <div class="modal-field"><label>Domicilio Fiscal</label><textarea id="pf_dir" class="ff-input">${p?.domicilio_fiscal || ""}</textarea></div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Teléfono</label><input id="pf_tel" class="ff-input" value="${p?.telefono || ""}"/></div>
          <div class="modal-field"><label>Email fiscal</label><input type="email" id="pf_email" class="ff-input" value="${p?.email || ""}"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>IBAN (para facturas)</label><input id="pf_iban" class="ff-input" value="${p?.iban || ""}" placeholder="ES00 0000 0000 0000 0000 0000"/></div>
          <div class="modal-field"><label>BIC / SWIFT</label><input id="pf_bic" class="ff-input" value="${p?.bic || ""}" placeholder="XXXXXXXX"/></div>
        </div>
        <div class="modal-field"><label>Régimen fiscal</label>
          <select id="pf_regime" class="ff-select">
            <option value="autonomo_ed"  ${(p?.regime === "autonomo_ed"  || !p?.regime) ? "selected" : ""}>Autónomo · Estimación Directa</option>
            <option value="autonomo_es"  ${p?.regime === "autonomo_es"  ? "selected" : ""}>Autónomo · Estimación Simplificada</option>
            <option value="sociedad"     ${p?.regime === "sociedad"     ? "selected" : ""}>Sociedad Limitada / SA</option>
            <option value="autonomo_mod" ${p?.regime === "autonomo_mod" ? "selected" : ""}>Autónomo · Módulos (Estimación Objetiva)</option>
          </select>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Nº de registro mercantil</label><input id="pf_regmercantil" class="ff-input" value="${p?.registro_mercantil || ""}" placeholder="Tomo 0000, Folio 00..."/></div>
          <div class="modal-field"><label>Código LEI (si aplica)</label><input id="pf_lei" class="ff-input" value="${p?.lei || ""}" placeholder="Identificador Legal de Entidad"/></div>
        </div>
      </div>
      <div class="modal-ft" style="justify-content:space-between">
        <button class="btn-modal-danger" id="pf_delete_account" style="margin-right:auto">🗑️ Eliminar cuenta</button>
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pf_save">Guardar perfil</button>
      </div>
    </div>`, { noCloseOnBackdrop: true });

  let _logoBase64 = logoActual;
  const logoPreview = document.getElementById("pf_logo_preview");
  const logoInput   = document.getElementById("pf_logo_input");
  document.getElementById("pf_logo_upload_btn")?.addEventListener("click", () => logoInput?.click());
  logoInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { toast("El logo no puede superar 500KB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      _logoBase64 = ev.target.result;
      logoPreview.innerHTML = `<img src="${_logoBase64}" style="max-width:96px;max-height:56px;object-fit:contain"/>`;
      toast("Logo cargado — guarda el perfil para aplicarlo", "info");
    };
    reader.readAsDataURL(file);
  });
  document.getElementById("pf_logo_remove")?.addEventListener("click", () => {
    _logoBase64 = "";
    logoPreview.innerHTML = `<span style="font-size:11px;color:var(--t4);text-align:center;padding:8px">Click para<br>subir logo</span>`;
    toast("Logo eliminado — guarda para confirmar", "info");
  });

  document.getElementById("pf_delete_account").onclick = () => {
    closeModal();
    openModal(`
      <div class="modal">
        <div class="modal-hd"><span class="modal-title">⚠️ Eliminar cuenta</span><button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd">
          <p style="font-size:14px;color:var(--t2);line-height:1.7;margin-bottom:12px">Esta acción es <strong>irreversible</strong>. Se eliminarán todos tus datos.</p>
          <div class="modal-field"><label>Escribe <strong>ELIMINAR</strong> para confirmar</label><input id="deleteConfirmInput" class="ff-input" placeholder="ELIMINAR"/></div>
        </div>
        <div class="modal-ft">
          <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-danger" id="deleteConfirmBtn" disabled>Eliminar mi cuenta</button>
        </div>
      </div>`);
    const input = document.getElementById("deleteConfirmInput");
    const btn   = document.getElementById("deleteConfirmBtn");
    input?.addEventListener("input", () => { btn.disabled = input.value.trim() !== "ELIMINAR"; });
    btn?.addEventListener("click", async () => {
      btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Eliminando…`;
      try {
        const uid = SESSION.user.id;
        const tables = ["facturas","clientes","perfil_fiscal","cierres_trimestrales","factura_series",
                        "presupuestos","productos","proveedores","gastos_recurrentes",
                        "nominas","empleados","verifactu_registro","empresas"];
        for (const t of tables) await supabase.from(t).delete().eq("user_id", uid);
        await supabase.auth.signOut();
        localStorage.clear();
        closeModal();
        document.getElementById("appShell")?.classList.add("hidden");
        document.getElementById("landingPage")?.classList.remove("hidden");
        toast("Cuenta eliminada. Hasta pronto.", "success", 5000);
      } catch (e) {
        toast("Error al eliminar: " + e.message, "error");
        btn.disabled = false; btn.textContent = "Eliminar mi cuenta";
      }
    });
  };

  document.getElementById("pf_save").onclick = async () => {
    const n   = document.getElementById("pf_nombre").value.trim();
    const nif = document.getElementById("pf_nif").value.trim();
    if (!n || !nif) { toast("Nombre y NIF son obligatorios", "error"); return; }
    const regime = document.getElementById("pf_regime").value;
    // FIX: upsert con ignoreDuplicates:false para que funcione sin UNIQUE constraint explícito
    const { error: ue } = await supabase.from("perfil_fiscal").upsert({
      user_id: SESSION.user.id,
      nombre_razon_social: n, nif,
      actividad:          document.getElementById("pf_act").value.trim(),
      domicilio_fiscal:   document.getElementById("pf_dir").value.trim(),
      telefono:           document.getElementById("pf_tel").value.trim(),
      email:              document.getElementById("pf_email").value.trim(),
      iban:               document.getElementById("pf_iban").value.trim(),
      bic:                document.getElementById("pf_bic").value.trim(),
      registro_mercantil: document.getElementById("pf_regmercantil").value.trim(),
      lei:                document.getElementById("pf_lei").value.trim(),
      logo_url:           _logoBase64,
      regime,
      updated_at:         new Date().toISOString()
    }, { onConflict: "user_id", ignoreDuplicates: false });
    if (ue) {
      // Si falla el upsert (sin UNIQUE), intentar update o insert por separado
      const { data: existe } = await supabase.from("perfil_fiscal").select("user_id").eq("user_id", SESSION.user.id).maybeSingle();
      if (existe) {
        const { error: ue2 } = await supabase.from("perfil_fiscal").update({
          nombre_razon_social: n, nif, actividad: document.getElementById("pf_act").value.trim(),
          domicilio_fiscal: document.getElementById("pf_dir").value.trim(),
          telefono: document.getElementById("pf_tel").value.trim(), email: document.getElementById("pf_email").value.trim(),
          iban: document.getElementById("pf_iban").value.trim(), bic: document.getElementById("pf_bic").value.trim(),
          registro_mercantil: document.getElementById("pf_regmercantil").value.trim(),
          lei: document.getElementById("pf_lei").value.trim(), logo_url: _logoBase64, regime, updated_at: new Date().toISOString()
        }).eq("user_id", SESSION.user.id);
        if (ue2) { toast("Error guardando perfil: " + ue2.message, "error"); return; }
      } else {
        const { error: ue3 } = await supabase.from("perfil_fiscal").insert({
          user_id: SESSION.user.id, nombre_razon_social: n, nif,
          actividad: document.getElementById("pf_act").value.trim(),
          domicilio_fiscal: document.getElementById("pf_dir").value.trim(),
          telefono: document.getElementById("pf_tel").value.trim(), email: document.getElementById("pf_email").value.trim(),
          iban: document.getElementById("pf_iban").value.trim(), bic: document.getElementById("pf_bic").value.trim(),
          registro_mercantil: document.getElementById("pf_regmercantil").value.trim(),
          lei: document.getElementById("pf_lei").value.trim(), logo_url: _logoBase64, regime, updated_at: new Date().toISOString()
        });
        if (ue3) { toast("Error guardando perfil: " + ue3.message, "error"); return; }
      }
    }
    const sfr = document.getElementById("sfRegimeTxt");
    const labels = { autonomo_ed: "Autónomo · Est. Directa", autonomo_es: "Autónomo · Est. Simplificada", sociedad: "Sociedad", autonomo_mod: "Autónomo · Módulos" };
    if (sfr) sfr.textContent = labels[regime] || "Autónomo";
    closeModal();
    toast("Perfil fiscal guardado ✅", "success");
    localStorage.setItem("tg_onboard_done", "1");
    const banner = document.getElementById("onboardingBanner");
    if (banner) banner.style.display = "none";
  };
}
window.showPerfilModal = showPerfilModal;
