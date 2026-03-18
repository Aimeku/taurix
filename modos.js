/* ═══════════════════════════════════════════════════════
   TAURIX · modos.js
   
   Sistema de modos: Empresario / Gestor
   
   · Un único codebase, dos experiencias distintas
   · El modo define qué ve el sidebar, no qué existe
   · El gestor puede ver la cartera de todos sus clientes
   · El empresario ve solo su negocio, sin tecnicismos
   · Toggle en la topbar para cambiar de modo
   · Onboarding inteligente al primer login
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, toast, openModal, closeModal } from "./utils.js";

/* ══════════════════════════════════════════
   DEFINICIÓN DE MODOS
══════════════════════════════════════════ */
export const MODOS = {
  empresario: {
    label:     "Modo empresario",
    labelCorto:"Empresario",
    icon:      "🏢",
    color:     "#1a56db",
    desc:      "Vista simple y visual. Todo lo que necesitas para gestionar tu negocio.",
    sidebar: [
      // Lo que ve un autónomo/empresario — sin tecnicismos
      { sep: true, label: null },                          // inicio sin label
      { view:"dashboard",    label:"Dashboard",            icon:"grid" },
      { view:"alertas",      label:"Alertas",              icon:"bell",   badge:"snBadgeAlertas" },
      { sep: true, label:"Comercial" },
      { view:"clientes",     label:"Clientes",             icon:"users" },
      { view:"presupuestos", label:"Presupuestos",         icon:"file-text", badge:"snBadgePres" },
      { view:"pipeline",     label:"Pipeline",             icon:"bar-chart" },
      { view:"trabajos",     label:"Trabajos",             icon:"briefcase" },
      { view:"agenda",       label:"Agenda",               icon:"calendar" },
      { view:"facturas",     label:"Facturas",             icon:"file",   badge:"snBadgeBorradores" },
      { view:"nueva-factura",label:"Nueva factura",        icon:"plus-circle" },
      { sep: true, label:"Gastos" },
      { action:"gastoRapido",label:"Gasto rápido",        icon:"zap",    accent:true },
      { view:"gastos",       label:"Proveedores",          icon:"credit-card", badge:"snBadgeVencidos" },
      { view:"tesoreria",    label:"Tesorería",            icon:"bank" },
      { view:"banco-auto",   label:"Importar movimientos del banco",     icon:"link" },
      { sep: true, label:"Catálogo" },
      { view:"productos",    label:"Productos / Servicios",icon:"package" },
      { sep: true, label:"Equipo" },
      { view:"empleados",    label:"Empleados",            icon:"users2" },
      { view:"nominas",      label:"Nóminas",              icon:"card" },
      { sep: true, label:"Gestión" },
      { view:"cobros",       label:"Cobros",               icon:"card2",  badge:"snBadgeCobros" },
      { view:"documentos",   label:"Documentos",           icon:"folder" },
      { view:"colaboradores",label:"Colaboradores",        icon:"users3", badge:"colaboradoresBadge" },
    ]
  },

  gestor: {
    label:     "Modo gestor",
    labelCorto:"Gestor / Asesor",
    icon:      "💼",
    color:     "#059669",
    desc:      "Acceso completo. Contabilidad, fiscal, modelos AEAT y herramientas profesionales.",
    sidebar: [
      // Lo que ve un gestor/asesor — completo
      { sep: true, label: null },
      { view:"cartera",      label:"Cartera de clientes",  icon:"briefcase", badge:"carteraBadge", gestor:true },
      { view:"dashboard",    label:"Dashboard",            icon:"grid" },
      { view:"alertas",      label:"Alertas fiscales",     icon:"bell",   badge:"snBadgeAlertas" },
      { sep: true, label:"Comercial" },
      { view:"clientes",     label:"Clientes",             icon:"users" },
      { view:"presupuestos", label:"Presupuestos",         icon:"file-text", badge:"snBadgePres" },
      { view:"pipeline",     label:"Pipeline CRM",         icon:"bar-chart" },
      { view:"trabajos",     label:"Trabajos",             icon:"briefcase" },
      { view:"agenda",       label:"Agenda",               icon:"calendar" },
      { view:"facturas",     label:"Facturas",             icon:"file",   badge:"snBadgeBorradores" },
      { view:"nueva-factura",label:"Nueva factura",        icon:"plus-circle" },
      { view:"verifactu",    label:"Verifactu",            icon:"shield" },
      { sep: true, label:"Gastos y tesorería" },
      { action:"gastoRapido",label:"Gasto rápido",        icon:"zap",    accent:true },
      { view:"gastos",       label:"Proveedores",          icon:"credit-card", badge:"snBadgeVencidos" },
      { view:"tesoreria",    label:"Tesorería y banco",    icon:"bank" },
      { view:"banco-auto",   label:"Importar movimientos del banco",     icon:"link" },
      { sep: true, label:"RRHH y Nóminas" },
      { view:"empleados",    label:"Empleados",            icon:"users2" },
      { view:"nominas",      label:"Nóminas",              icon:"card" },
      { view:"ss",           label:"Seguridad Social",     icon:"shield2" },
      { sep: true, label:"Fiscal AEAT" },
      { view:"iva",          label:"IVA · Modelo 303",     icon:"layers" },
      { view:"irpf",         label:"IRPF · Modelo 130",    icon:"dollar" },
      { view:"is",           label:"Impuesto Sociedades",  icon:"monitor" },
      { view:"otros-modelos",label:"Otros modelos",        icon:"check-square" },
      { view:"libros",       label:"Libros oficiales",     icon:"book" },
      { view:"amortizaciones",label:"Bienes e Inmovilizado",icon:"bar-chart2" },
      { sep: true, label:"Contabilidad PGC" },
      { view:"contabilidad", label:"Plan General Contable",icon:"file-text2" },
      { sep: true, label:"Análisis e Informes" },
      { view:"historico",    label:"Análisis anual",       icon:"activity" },
      { view:"informes",     label:"Informes avanzados",   icon:"bar-chart3" },
      { view:"cobros",       label:"Cobros y vencimientos",icon:"card2",  badge:"snBadgeCobros" },
      { sep: true, label:"Administración" },
      { view:"productos",    label:"Catálogo",             icon:"package" },
      { view:"documentos",   label:"Documentos",           icon:"folder" },
      { view:"colaboradores",label:"Colaboradores",        icon:"users3", badge:"colaboradoresBadge" },
      { view:"auditoria",    label:"Auditoría",            icon:"shield3" },
    ]
  }
};

/* ══════════════════════════════════════════
   SVG ICONS (inline, sin dependencias)
══════════════════════════════════════════ */
const ICONS = {
  grid:        `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>`,
  bell:        `<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>`,
  users:       `<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.87"/>`,
  users2:      `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.74"/>`,
  users3:      `<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75"/><path d="M21 21v-2a4 4 0 00-3-3.87"/>`,
  "file-text": `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="10" y1="17" x2="8" y2="17"/>`,
  "file-text2":`<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10,9 9,9 8,9"/>`,
  "bar-chart": `<rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="8" width="6" height="13" rx="1"/><rect x="16" y="13" width="6" height="8" rx="1"/>`,
  "bar-chart2":`<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>`,
  "bar-chart3":`<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>`,
  file:        `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>`,
  "plus-circle":`<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  zap:         `<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>`,
  "credit-card":`<path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="2"/>`,
  bank:        `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`,
  link:        `<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
  package:     `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9.5" y1="14.5" x2="14.5" y2="14.5"/>`,
  card:        `<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  card2:       `<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  shield:      `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  shield2:     `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/>`,
  shield3:     `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  layers:      `<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`,
  dollar:      `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>`,
  monitor:     `<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`,
  "check-square":`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>`,
  book:        `<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>`,
  activity:    `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  folder:      `<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>`,
  briefcase:   `<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>`,
  calendar:    `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
};

function svgIcon(name, size=16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.file}</svg>`;
}

/* ══════════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════════ */
let MODO_ACTUAL = "empresario";

export function getModo()         { return MODO_ACTUAL; }
export function esModoGestor()    { return MODO_ACTUAL === "gestor"; }
export function esModoEmpresario(){ return MODO_ACTUAL === "empresario"; }

/* ══════════════════════════════════════════
   INIT — leer modo guardado y construir sidebar
══════════════════════════════════════════ */
export async function initModos() {
  // Leer modo guardado en perfil o localStorage
  const guardado = localStorage.getItem("taurix_modo");

  if (guardado === "gestor" || guardado === "empresario") {
    MODO_ACTUAL = guardado;
  } else {
    // Primera vez — leer de perfil_fiscal si existe
    const { data: pf } = await supabase.from("perfil_fiscal")
      .select("modo_usuario").eq("user_id", SESSION.user.id).maybeSingle();

    if (pf?.modo_usuario) {
      MODO_ACTUAL = pf.modo_usuario;
      localStorage.setItem("taurix_modo", MODO_ACTUAL);
    } else {
      // Primer login — mostrar onboarding de selección de modo
      return false; // signal: necesita onboarding
    }
  }

  aplicarModo(MODO_ACTUAL);
  return true;
}

/* ══════════════════════════════════════════
   APLICAR MODO — reconstruir sidebar
══════════════════════════════════════════ */
export function aplicarModo(modo) {
  MODO_ACTUAL = modo;
  localStorage.setItem("taurix_modo", modo);

  const nav = document.querySelector(".sidebar-nav");
  if (!nav) return;

  const config = MODOS[modo];
  if (!config) return;

  // Reconstruir sidebar
  nav.innerHTML = config.sidebar.map(item => {
    if (item.sep) {
      return item.label
        ? `<div class="sn-separator"></div><div class="sn-section-label">${item.label}</div>`
        : `<div class="sn-separator" style="margin-top:8px"></div>`;
    }

    if (item.action === "gastoRapido") {
      return `<button class="sn-item sn-item--accent" id="gastoRapidoBtn">
        ${svgIcon(item.icon)}
        <span>${item.label}</span>
      </button>`;
    }

    const badge = item.badge
      ? `<span class="sn-badge sn-badge--red" id="${item.badge}" style="display:none"></span>`
      : "";

    const special = item.view === "verifactu"
      ? `<span class="verifactu-badge" style="font-size:9px;padding:1px 6px">✓</span>`
      : item.view === "is"
      ? `<span class="is-badge" style="font-size:9px;padding:1px 6px">IS</span>`
      : "";

    const gestor_only = item.gestor
      ? `style="background:linear-gradient(135deg,rgba(5,150,105,.08),rgba(5,150,105,.04));border-left:2px solid #059669"`
      : "";

    return `<button class="sn-item" data-view="${item.view}" ${gestor_only}>
      ${svgIcon(item.icon)}
      <span>${item.label}</span>
      ${badge}${special}
    </button>`;
  }).join("");

  // Re-registrar listeners del sidebar en main.js
  if (window._rebindNav) window._rebindNav();

  // Toggle button en topbar
  actualizarToggleBtn(modo);

  // Guardar en BD en background
  supabase.from("perfil_fiscal").update({ modo_usuario: modo })
    .eq("user_id", SESSION.user.id).then(() => {});
}

/* ══════════════════════════════════════════
   TOGGLE BUTTON EN TOPBAR
══════════════════════════════════════════ */
function actualizarToggleBtn(modo) {
  const btn = document.getElementById("modoToggleBtn");
  if (!btn) return;
  const otro = modo === "empresario" ? "gestor" : "empresario";
  const otroConfig = MODOS[otro];
  btn.innerHTML = `
    <span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700">
      ${otroConfig.icon}
      <span style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${otroConfig.labelCorto}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
    </span>`;
  btn.title = `Cambiar a ${otroConfig.label}`;

  // Color según modo actual
  const cfg = MODOS[modo];
  btn.style.borderColor = cfg.color + "44";
  btn.style.color       = cfg.color;
  btn.style.background  = cfg.color + "0d";
}

export function toggleModo() {
  const nuevo = MODO_ACTUAL === "empresario" ? "gestor" : "empresario";
  aplicarModo(nuevo);
  toast(`${MODOS[nuevo].icon} ${MODOS[nuevo].label} activado`, "success", 2500);
  // Refrescar dashboard
  if (window._refreshDashboard) window._refreshDashboard();
}

/* ══════════════════════════════════════════
   ONBOARDING MODAL — primera vez
══════════════════════════════════════════ */
export function showOnboardingModo() {
  // Crear overlay de onboarding (no un modal normal — es pantalla completa)
  const el = document.createElement("div");
  el.id = "onboardingModoOverlay";
  // Detect dark mode
  const isDark = document.documentElement.classList.contains("dark");
  const bgColor = isDark ? "#0f172a" : "#f8fafc";
  const textColor = isDark ? "#f1f5f9" : "#0f172a";

  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:${bgColor};
    display:flex;align-items:center;justify-content:center;
    animation:fadeIn .3s ease;
  `;

  el.innerHTML = `
    <div style="max-width:560px;width:90%;text-align:center;padding:20px">

      <!-- Logo -->
      <img src="Logo_Sin_Texto_transparent.png" style="width:64px;height:64px;object-fit:contain;margin-bottom:20px"/>

      <!-- Bienvenida -->
      <h1 style="font-size:26px;font-weight:900;letter-spacing:-.5px;color:var(--t1);margin-bottom:8px">
        Bienvenido a Taurix
      </h1>
      <p style="font-size:15px;color:var(--t3);margin-bottom:36px;line-height:1.6">
        Una pregunta antes de empezar.<br>
        Así preparamos la app exactamente para ti.
      </p>

      <!-- Cards de selección -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:36px;text-align:left">

        <!-- Empresario -->
        <div class="onboard-card" id="onboard_empresario"
             onclick="window._selectModo('empresario')"
             style="border:2px solid var(--brd);border-radius:20px;padding:28px 24px;cursor:pointer;transition:all .2s">
          <div style="font-size:40px;margin-bottom:14px">🏢</div>
          <div style="font-size:17px;font-weight:800;color:var(--t1);margin-bottom:8px">Soy autónomo<br>o empresario</div>
          <div style="font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:16px">
            Gestiono mi propio negocio. Quiero una herramienta clara y sin tecnicismos para facturar, controlar gastos y saber lo que debo a Hacienda.
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            ${["Facturas y presupuestos","Control de gastos","Tesorería y cobros","Alertas fiscales simples"].map(f =>
              `<div style="font-size:12px;color:#059669;display:flex;align-items:center;gap:6px">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                ${f}
              </div>`).join("")}
          </div>
        </div>

        <!-- Gestor -->
        <div class="onboard-card" id="onboard_gestor"
             onclick="window._selectModo('gestor')"
             style="border:2px solid var(--brd);border-radius:20px;padding:28px 24px;cursor:pointer;transition:all .2s">
          <div style="font-size:40px;margin-bottom:14px">💼</div>
          <div style="font-size:17px;font-weight:800;color:var(--t1);margin-bottom:8px">Soy gestor<br>o asesor fiscal</div>
          <div style="font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:16px">
            Gestiono la contabilidad y fiscalidad de varios clientes. Necesito acceso a todas las herramientas profesionales y ver varios negocios desde una cuenta.
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            ${["Contabilidad PGC completa","Modelos AEAT (303, 130, 347…)","Cartera de clientes","Informes avanzados y exportaciones"].map(f =>
              `<div style="font-size:12px;color:#059669;display:flex;align-items:center;gap:6px">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                ${f}
              </div>`).join("")}
          </div>
        </div>
      </div>

      <!-- Nota -->
      <p style="font-size:12px;color:var(--t4);line-height:1.6">
        Puedes cambiar el modo en cualquier momento desde la barra superior.<br>
        Ambos modos tienen acceso a todas las funciones — solo cambia lo que se muestra por defecto.
      </p>
    </div>`;

  document.body.appendChild(el);

  // Highlight al seleccionar
  window._selectModo = async (modo) => {
    // Visual feedback
    document.querySelectorAll(".onboard-card").forEach(c => {
      c.style.borderColor = "var(--brd)";
      c.style.background  = "";
      c.style.transform   = "";
    });
    const card = document.getElementById(`onboard_${modo}`);
    const cfg  = MODOS[modo];
    card.style.borderColor = cfg.color;
    card.style.background  = cfg.color + "08";
    card.style.transform   = "scale(1.02)";

    // Guardar y aplicar
    await new Promise(r => setTimeout(r, 350)); // pequeña pausa para ver la selección

    // Guardar en BD
    await supabase.from("perfil_fiscal").upsert({
      user_id:      SESSION.user.id,
      modo_usuario: modo,
    }, { onConflict:"user_id" });

    localStorage.setItem("taurix_modo", modo);
    aplicarModo(modo);

    // Cerrar con fade
    el.style.transition = "opacity .4s";
    el.style.opacity    = "0";
    await new Promise(r => setTimeout(r, 400));
    el.remove();

    // Mostrar bienvenida rápida
    toast(`${cfg.icon} ${cfg.label} configurado. ¡Bienvenido!`, "success", 3000);

    // Si es gestor, ofrecer crear primer cliente en cartera
    if (modo === "gestor") {
      setTimeout(() => {
        if (window._switchView) window._switchView("cartera");
      }, 500);
    }
  };
}

/* ══════════════════════════════════════════
   CARTERA DE CLIENTES (solo modo gestor)
   Vista que muestra todas las empresas
   que gestiona el asesor
══════════════════════════════════════════ */
export async function refreshCartera() {
  const wrap = document.getElementById("carteraGrid");
  if (!wrap) return;

  // Cargar empresas gestionadas (from colaboradores where this user is gestor)
  const { data: colaboraciones } = await supabase.from("colaboradores")
    .select("owner_id, nombre, email, rol, estado, ultima_actividad")
    .eq("colaborador_id", SESSION.user.id)
    .eq("estado", "activo");

  // También cargar las propias empresas del gestor
  const { data: misEmpresas } = await supabase.from("empresas")
    .select("*").eq("user_id", SESSION.user.id);

  const totalClientes = (colaboraciones||[]).length + (misEmpresas||[]).length;

  // Badge en sidebar
  const badge = document.getElementById("carteraBadge");
  if (badge) {
    badge.textContent = totalClientes;
    badge.style.display = totalClientes ? "" : "none";
    badge.style.background = "#059669";
  }

  // KPIs
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("carteraTotal",   totalClientes);
  s("carteraActivos", (colaboraciones||[]).filter(c=>c.estado==="activo").length);
  s("carteraPropias", (misEmpresas||[]).length);

  if (!totalClientes) {
    wrap.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--t3)">
        <div style="font-size:48px;margin-bottom:16px">💼</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Tu cartera está vacía</div>
        <div style="font-size:13px;margin-bottom:24px;line-height:1.6;max-width:400px;margin-left:auto;margin-right:auto">
          Como gestor, puedes acceder a los datos de tus clientes cuando ellos te inviten como colaborador desde su cuenta de Taurix.
        </div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn-primary" onclick="window._copyInviteInstructions()">
            📋 Copiar instrucciones para mi cliente
          </button>
          <button class="btn-outline" onclick="window._switchView('colaboradores')">
            Ver colaboradores
          </button>
        </div>
      </div>`;
    return;
  }

  // Tarjetas de empresas propias
  const tarjetasPropias = (misEmpresas||[]).map(e => `
    <div class="cartera-card cartera-card--propia" onclick="window._switchView('dashboard')"
         title="Tu empresa principal">
      <div class="cartera-card-header">
        <div class="cartera-card-avatar" style="background:linear-gradient(135deg,#1a56db,#3b82f6)">
          ${(e.nombre||"E").charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div class="cartera-card-nombre">${e.nombre || "Mi empresa"}</div>
          <div class="cartera-card-nif">${e.nif || "—"}</div>
        </div>
        <span style="background:#eff6ff;color:#1a56db;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px">Principal</span>
      </div>
      <div class="cartera-card-footer">
        <span style="color:var(--t4);font-size:11px">Tu empresa</span>
        <button class="btn-outline" style="font-size:11px;padding:3px 10px">Gestionar →</button>
      </div>
    </div>`).join("");

  // Tarjetas de clientes gestionados
  const tarjetasClientes = (colaboraciones||[]).map(c => `
    <div class="cartera-card" onclick="window._entrarEnCuenta('${c.owner_id}','${(c.nombre||c.email).replace(/'/g,"\\'")}')">
      <div class="cartera-card-header">
        <div class="cartera-card-avatar" style="background:linear-gradient(135deg,#059669,#10b981)">
          ${(c.nombre||c.email||"C").charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div class="cartera-card-nombre">${c.nombre || c.email}</div>
          <div class="cartera-card-nif" style="font-size:11px;color:var(--t4)">${c.email}</div>
        </div>
        <span style="background:#f0fdf4;color:#059669;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px">Cliente</span>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 0">
        <span style="font-size:11px;background:var(--bg2);color:var(--t3);padding:2px 7px;border-radius:5px">
          ${c.rol === "manager" ? "Gestor total" : c.rol === "accountant" ? "Contable" : c.rol === "editor" ? "Colaborador" : "Solo lectura"}
        </span>
        ${c.ultima_actividad ? `<span style="font-size:11px;color:var(--t4)">Última actividad: ${new Date(c.ultima_actividad).toLocaleDateString("es-ES")}</span>` : ""}
      </div>
      <div class="cartera-card-footer">
        <span style="color:var(--t4);font-size:11px">Click para gestionar</span>
        <button class="btn-primary" style="font-size:11px;padding:3px 12px">Entrar →</button>
      </div>
    </div>`).join("");

  wrap.innerHTML = tarjetasPropias + tarjetasClientes;
}

// Copiar instrucciones para el cliente
window._copyInviteInstructions = () => {
  const texto = `Hola,

Para que pueda gestionar tu contabilidad desde Taurix, necesito que hagas lo siguiente:

1. Ve a taurix.es y crea una cuenta (o entra si ya tienes una)
2. En el menú lateral, ve a "Colaboradores"
3. Haz click en "Invitar colaborador"
4. Introduce mi email y asígnate el rol "Gestor / Asesor"

Con esto podré acceder a tus datos para llevar tu contabilidad.

Un saludo`;
  navigator.clipboard.writeText(texto).then(() => {
    toast("✅ Instrucciones copiadas al portapapeles", "success");
  });
};

// Entrar en cuenta de un cliente (futuro: cargar sus datos)
window._entrarEnCuenta = (ownerId, nombre) => {
  openModal(`
    <div class="modal" style="max-width:460px">
      <div class="modal-hd">
        <span class="modal-title">💼 Entrar como gestor</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:36px;margin-bottom:12px">🔄</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:8px">Entrando en cuenta de <strong>${nombre}</strong></div>
          <div style="font-size:13px;color:var(--t3);line-height:1.6">
            Esta función está disponible cuando el cliente te ha invitado como colaborador y usas su enlace de acceso.<br><br>
            <strong>Por ahora:</strong> el cliente debe darte acceso desde su cuenta y tú entras con tus credenciales en su sesión de Taurix.
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
      </div>
    </div>`);
};
