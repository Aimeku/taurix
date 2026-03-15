/* ═══════════════════════════════════════════════════════
   TUGESTOR · utils.js
   Constantes, estado global, helpers de formato,
   toast con "Deshacer", modal, dark mode, navegación
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { logout } from "./auth.js";

/* ══════════════════════════
   ESTADO GLOBAL
══════════════════════════ */
export let SESSION = null;
export let CLIENTES = [];

export function setSession(s) { SESSION = s; }
export function setClientes(c) { CLIENTES = c; }

export const TRIM_RANGOS = {
  T1: ["01-01","03-31"], T2: ["04-01","06-30"],
  T3: ["07-01","09-30"], T4: ["10-01","12-31"]
};
export const TRIM_LABELS = {
  T1:"Enero – Marzo", T2:"Abril – Junio",
  T3:"Julio – Septiembre", T4:"Octubre – Diciembre"
};
export const TRIM_PLAZOS = {
  T1:"20 de abril", T2:"20 de julio",
  T3:"20 de octubre", T4:"30 de enero"
};

export const OP_INFO = {
  nacional: "Operación sujeta a IVA español. El IVA se repercute y se declara en el Modelo 303.",
  intracomunitaria: "Entrega o adquisición intracomunitaria. Las entregas están exentas (art. 25 LIVA). Las adquisiciones tributan por inversión del sujeto pasivo. No se aplica IVA en factura.",
  exportacion: "Exportación fuera de la UE. Exenta de IVA (art. 21 LIVA). No se aplica IVA en la factura. Requiere documentación aduanera.",
  importacion: "Importación de bienes de fuera de la UE. El IVA se liquida en aduana (DUA). Se puede deducir si la empresa es sujeto pasivo.",
  inversion_sujeto_pasivo: "Inversión del sujeto pasivo (art. 84 LIVA). El destinatario español es quien liquida el IVA. La factura se emite sin IVA."
};

/* ══════════════════════════
   FORMAT
══════════════════════════ */
export const fmt      = n => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(n||0);
export const fmtShort = n => { const v=Math.abs(n||0); return (v>=1000?"€"+(v/1000).toFixed(1)+"k":"€"+v.toFixed(2)); };
export const fmtDate  = s => s ? new Date(s+"T12:00:00").toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";

/* ══════════════════════════
   TOAST (con soporte "Deshacer")
   Uso: toast("msg", "success")
        toastConDeshacer("Gasto registrado", onUndoFn)
══════════════════════════ */
export function toast(msg, type = "info", ms = 3500) {
  const c = document.getElementById("toastEl");
  const icons = {
    success:`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warn:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };
  const el = document.createElement("div");
  el.className = `toast t-${type}`;
  el.innerHTML = `${icons[type]||""}<span>${msg}</span>`;
  c.appendChild(el);
  const remove = () => {
    el.style.opacity="0"; el.style.transform="translateX(16px)"; el.style.transition="all .2s";
    setTimeout(()=>el.remove(), 220);
  };
  const tid = setTimeout(remove, ms);
  el.dataset.timerId = tid;
  return el;
}

/**
 * Toast especial con botón "Deshacer".
 * @param {string} msg - Mensaje principal
 * @param {Function} onUndo - Callback al pulsar "Deshacer"
 * @param {number} ms - Tiempo en ms antes de que desaparezca (default 5000)
 */
export function toastConDeshacer(msg, onUndo, ms = 5000) {
  const c = document.getElementById("toastEl");
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
    el.style.opacity="0"; el.style.transform="translateX(16px)"; el.style.transition="all .2s";
    setTimeout(()=>el.remove(), 220);
  };
  const tid = setTimeout(() => { if (!undone) remove(); }, ms);

  el.querySelector(".toast-undo-btn").addEventListener("click", () => {
    undone = true;
    clearTimeout(tid);
    remove();
    if (typeof onUndo === "function") onUndo();
  });
  return el;
}

/* ══════════════════════════
   MODAL
══════════════════════════ */
export function openModal(html) {
  const c = document.getElementById("modalEl");
  c.innerHTML = `<div class="modal-overlay" id="_mo">${html}</div>`;
}
}
export function closeModal() { document.getElementById("modalEl").innerHTML = ""; }
window._cm = closeModal;

/* ══════════════════════════
   DARK MODE
══════════════════════════ */
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

/* ══════════════════════════
   NAVIGATION
══════════════════════════ */
export function initNav() {
  document.querySelectorAll(".sn-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.querySelectorAll(".btn-link[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

export function switchView(view) {
  document.querySelectorAll(".sn-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelector(`.sn-item[data-view="${view}"]`)?.classList.add("active");
  const v = document.getElementById(`view-${view}`);
  if (v) v.classList.add("active");
}

/* ══════════════════════════
   PERIOD HELPERS
══════════════════════════ */
export function getYear()  { return Number(document.getElementById("yearSelect").value); }
export function getTrim()  { return document.getElementById("trimestreSelect").value; }
export function getFechaRango(year, trim) {
  const [ini,fin] = TRIM_RANGOS[trim];
  return { ini: `${year}-${ini}`, fin: `${year}-${fin}` };
}

/* ══════════════════════════
   CALCULATIONS
══════════════════════════ */
export async function getFacturasTrim(year, trim) {
  const { ini, fin } = getFechaRango(year, trim);
  const { data, error } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id).gte("fecha", ini).lte("fecha", fin);
  if (error) { console.error("getFacturasTrim:", error.message); return []; }
  return data || [];
}

export async function getFacturasYear(year) {
  const { data, error } = await supabase.from("facturas").select("*")
    .eq("user_id", SESSION.user.id)
    .gte("fecha", `${year}-01-01`).lte("fecha", `${year}-12-31`);
  if (error) { console.error("getFacturasYear:", error.message); return []; }
  return data || [];
}

export function calcIVA(facturas) {
  let rep = {21:0,10:0,4:0,total:0};
  let sop = {int:0,imp:0,total:0};
  let byOp = {nacional:0,intracomunitaria:0,exportacion:0,inversion_sujeto_pasivo:0};
  facturas.forEach(f => {
    const iva = (f.base * f.iva) / 100;
    const op  = f.tipo_operacion || "nacional";
    if (f.tipo === "emitida") {
      rep.total += iva;
      if (f.iva == 21) rep[21] += iva;
      else if (f.iva == 10) rep[10] += iva;
      else if (f.iva == 4)  rep[4]  += iva;
      byOp[op] = (byOp[op]||0) + f.base;
    } else {
      sop.total += iva;
      if (op === "importacion") sop.imp += iva;
      else sop.int += iva;
    }
  });
  return { rep, sop, resultado: rep.total - sop.total, byOp };
}

export function calcIRPF(facturas) {
  let ingresos = 0, gastos = 0, retenciones = 0;
  facturas.forEach(f => {
    if (f.tipo === "emitida") {
      ingresos += f.base;
      retenciones += (f.base * (f.irpf_retencion||0)) / 100;
    } else {
      gastos += f.base;
    }
  });
  const rendimiento = ingresos - gastos;
  const pagoFrac  = Math.max(0, rendimiento * 0.20);
  const resultado = Math.max(0, pagoFrac - retenciones);
  return { ingresos, gastos, rendimiento, retenciones, pagoFrac, resultado };
}

/* ══════════════════════════
   TRIMESTRE CERRADO
══════════════════════════ */
export async function isCerrado(year, trim) {
  const { data, error } = await supabase.from("cierres_trimestrales").select("id")
    .eq("user_id", SESSION.user.id).eq("year", year).eq("trimestre", trim);
  if (error) { console.error("isCerrado:", error.message); return false; }
  return (data||[]).length > 0;
}

/* ══════════════════════════
   DEADLINE BANNER
══════════════════════════ */
export function checkFiscalDeadlines() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const deadlines = [
    { month:4,  day:20, label:"Modelo 303 y 130 del T1" },
    { month:7,  day:20, label:"Modelo 303 y 130 del T2" },
    { month:10, day:20, label:"Modelo 303 y 130 del T3" },
    { month:1,  day:30, label:"Modelo 303 y 130 del T4 (año anterior)" },
  ];
  const banner = document.getElementById("fiscalDeadlineBanner");
  if (!banner) return;
  for (const dl of deadlines) {
    const deadlineDate = new Date(now.getFullYear(), dl.month - 1, dl.day);
    const diffDays = Math.ceil((deadlineDate - now) / 86400000);
    if (diffDays >= 0 && diffDays <= 15) {
      banner.innerHTML = `
        <div class="deadline-banner deadline-banner--${diffDays <= 3 ? "urgent" : "warn"}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${diffDays === 0 ? "¡Hoy es el plazo!" : `Faltan <strong>${diffDays} día${diffDays!==1?"s":""}</strong>`} para presentar el <strong>${dl.label}</strong> · Plazo: ${String(dl.day).padStart(2,"0")}/${String(dl.month).padStart(2,"0")}</span>
          <button onclick="this.parentElement.parentElement.style.display='none'" class="deadline-close">×</button>
        </div>`;
      banner.style.display = "";
      return;
    }
  }
  banner.style.display = "none";
}

/* ══════════════════════════
   ONBOARDING BANNER — desactivado
══════════════════════════ */
export async function checkOnboarding() {
  // Banner de onboarding eliminado — interfaz limpia desde el primer acceso
  const banner = document.getElementById("onboardingBanner");
  if (banner) banner.style.display = "none";
}

/* ══════════════════════════
   PERFIL FISCAL MODAL
══════════════════════════ */
export async function showPerfilModal() {
  const { data: p, error } = await supabase.from("perfil_fiscal").select("*").eq("user_id", SESSION.user.id).single();
  if (error && error.code !== "PGRST116") console.warn("perfil load:", error.message);

  const logoActual = p?.logo_url || "";

  openModal(`
    <div class="modal" style="max-width:600px">
      <div class="modal-hd"><span class="modal-title">📋 Perfil Fiscal</span><button class="modal-x" onclick="window._cm()">×</button></div>
      <div class="modal-bd">
        <p class="modal-note">Estos datos aparecen en los libros oficiales y en el encabezado de tus facturas.</p>

        <div class="modal-field">
          <label>Logo de empresa <span style="font-weight:400;color:var(--t4)">(aparece en facturas y presupuestos PDF)</span></label>
          <div style="display:flex;align-items:center;gap:16px;margin-top:6px">
            <div id="pf_logo_preview" style="width:100px;height:60px;border:2px dashed var(--brd);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--srf2);flex-shrink:0;cursor:pointer" onclick="document.getElementById('pf_logo_input').click()">
              ${logoActual
                ? `<img src="${logoActual}" style="max-width:96px;max-height:56px;object-fit:contain"/>`
                : `<span style="font-size:11px;color:var(--t4);text-align:center;padding:8px">Click para<br>subir logo</span>`}
            </div>
            <div>
              <input type="file" id="pf_logo_input" accept="image/png,image/jpeg,image/svg+xml,image/webp" style="display:none"/>
              <button type="button" id="pf_logo_upload_btn" class="btn-outline" style="font-size:12px;padding:7px 14px;margin-bottom:8px">
                📁 ${logoActual ? "Cambiar logo" : "Subir logo"}
              </button>
              ${logoActual ? `<button type="button" id="pf_logo_remove" class="btn-outline" style="font-size:12px;padding:7px 14px;margin-left:6px;color:var(--red);border-color:var(--red-mid)">🗑️ Quitar</button>` : ""}
              <div style="font-size:11.5px;color:var(--t4);line-height:1.5;margin-top:4px">PNG, JPG o SVG · Máx. 500KB</div>
              <div style="display:flex;align-items:center;gap:5px;margin-top:6px;padding:5px 8px;background:var(--ox-lt);border:1px solid var(--ox-mid);border-radius:6px;font-size:11px;color:var(--ox-dd);line-height:1.4">
                <span style="font-size:13px">💡</span>
                <span>Mejor con <strong>fondo transparente</strong> (PNG sin fondo) — queda perfecto en los PDFs</span>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre o Razón Social *</label><input id="pf_nombre" value="${p?.nombre_razon_social||""}"/></div>
          <div class="modal-field"><label>NIF / CIF *</label><input id="pf_nif" value="${p?.nif||""}"/></div>
        </div>
        <div class="modal-field"><label>Actividad (IAE)</label><input id="pf_act" value="${p?.actividad||""}" placeholder="Ej: Desarrollo de software · IAE 763"/></div>
        <div class="modal-field"><label>Domicilio Fiscal</label><textarea id="pf_dir">${p?.domicilio_fiscal||""}</textarea></div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Teléfono</label><input id="pf_tel" value="${p?.telefono||""}"/></div>
          <div class="modal-field"><label>Email fiscal</label><input type="email" id="pf_email" value="${p?.email||""}"/></div>
        </div>
        <div class="modal-field"><label>Régimen fiscal</label>
          <select id="pf_regime">
            <option value="autonomo_ed" ${p?.regime==="autonomo_ed"||!p?.regime?"selected":""}>Autónomo · Estimación Directa</option>
            <option value="autonomo_es" ${p?.regime==="autonomo_es"?"selected":""}>Autónomo · Estimación Simplificada</option>
            <option value="sociedad"    ${p?.regime==="sociedad"?"selected":""}>Sociedad Limitada / SA</option>
            <option value="autonomo_mod" ${p?.regime==="autonomo_mod"?"selected":""}>Autónomo · Módulos</option>
          </select>
        </div>
      </div>
      <div class="modal-ft" style="justify-content:space-between">
        <button class="btn-modal-danger" id="pf_delete_account" style="margin-right:auto">🗑️ Eliminar cuenta</button>
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="pf_save">Guardar perfil</button>
      </div>
    </div>
  `);

  // ── Logo handling ──
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

  // ── Eliminar cuenta ──
  document.getElementById("pf_delete_account").onclick = () => {
    closeModal();
    openModal(`
      <div class="modal">
        <div class="modal-hd"><span class="modal-title">⚠️ Eliminar cuenta</span><button class="modal-x" onclick="window._cm()">×</button></div>
        <div class="modal-bd">
          <p style="font-size:14px;color:var(--t2);line-height:1.7;margin-bottom:12px">
            Esta acción es <strong>irreversible</strong>. Se eliminarán todos tus datos: facturas, clientes, presupuestos y perfil fiscal.
          </p>
          <div class="modal-field">
            <label>Escribe <strong>ELIMINAR</strong> para confirmar</label>
            <input id="confirm_delete_input" class="ff-input" placeholder="ELIMINAR"/>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
          <button class="btn-modal-danger" id="confirm_delete_btn">Eliminar mi cuenta</button>
        </div>
      </div>
    `);
    document.getElementById("confirm_delete_btn").onclick = async () => {
      const val = document.getElementById("confirm_delete_input").value.trim();
      if (val !== "ELIMINAR") { toast("Escribe ELIMINAR para confirmar","error"); return; }
      const btn = document.getElementById("confirm_delete_btn");
      btn.disabled = true; btn.textContent = "Eliminando...";
      try {
        const uid = SESSION.user.id;
        await Promise.all([
          supabase.from("facturas").delete().eq("user_id", uid),
          supabase.from("clientes").delete().eq("user_id", uid),
          supabase.from("presupuestos").delete().eq("user_id", uid),
          supabase.from("perfil_fiscal").delete().eq("user_id", uid),
          supabase.from("productos").delete().eq("user_id", uid),
        ]);
        const { error: de } = await supabase.rpc("delete_user");
        if (de) throw new Error(de.message);
        await supabase.auth.signOut();
        window.location.reload();
      } catch(e) {
        toast("Error eliminando cuenta: "+e.message,"error");
        btn.disabled = false; btn.textContent = "Eliminar mi cuenta";
      }
    };
  };

  // ── Guardar perfil ──
  document.getElementById("pf_save").onclick = async () => {
    const n   = document.getElementById("pf_nombre").value.trim();
    const nif = document.getElementById("pf_nif").value.trim();
    if (!n||!nif) { toast("Nombre y NIF son obligatorios","error"); return; }
    const regime = document.getElementById("pf_regime").value;
    const { error: ue } = await supabase.from("perfil_fiscal").upsert({
      user_id: SESSION.user.id,
      nombre_razon_social: n, nif,
      actividad:        document.getElementById("pf_act").value.trim(),
      domicilio_fiscal: document.getElementById("pf_dir").value.trim(),
      telefono:         document.getElementById("pf_tel").value.trim(),
      email:            document.getElementById("pf_email").value.trim(),
      logo_url:         _logoBase64,
      regime, updated_at: new Date().toISOString()
    }, { onConflict:"user_id" });
    if (ue) { toast("Error guardando perfil: "+ue.message,"error"); return; }
    const sfr = document.getElementById("sfRegimeTxt");
    const labels = {autonomo_ed:"Autónomo · Est. Directa",autonomo_es:"Autónomo · Est. Simplificada",sociedad:"Sociedad",autonomo_mod:"Autónomo · Módulos"};
    if (sfr) sfr.textContent = labels[regime]||"Autónomo";
    closeModal();
    toast("Perfil fiscal guardado ✅","success");
  };
}
window.showPerfilModal = showPerfilModal;
