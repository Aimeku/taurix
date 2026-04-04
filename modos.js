/* ═══════════════════════════════════════════════════════
   TAURIX · modos.js
   
   Plan único — un solo sidebar para todos los usuarios.
   No hay modo empresario ni modo gestor.
   
   esModoGestor() devuelve siempre true para que
   initMultiEmpresa y el selector de empresa sigan
   funcionando exactamente igual para todos los usuarios.
   ═══════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════
   SIDEBAR UNIFICADO
   Un solo plan. Una sola experiencia.
══════════════════════════════════════════ */
// Items base — siempre visibles independientemente del régimen
const SIDEBAR_BASE = [
  { sep: true, label: null },
  { view:"dashboard",     label:"Dashboard",             icon:"grid" },
  { view:"alertas",       label:"Alertas fiscales",      icon:"bell",   badge:"snBadgeAlertas" },
  { sep: true, label:"Clientes y presupuestos" },
  { view:"clientes",      label:"Clientes",              icon:"users" },
  { view:"presupuestos",  label:"Presupuestos",          icon:"file-text", badge:"snBadgePres" },
  { view:"albaranes",     label:"Albaranes",             icon:"clipboard" },
  { sep: true, label:"Facturas" },
  { view:"facturas",      label:"Facturas",              icon:"file",   badge:"snBadgeBorradores" },
  { view:"recurrentes",   label:"Facturas recurrentes",  icon:"refresh" },
  { view:"proformas",     label:"Proformas",             icon:"file-text" },
  { view:"verifactu",     label:"Verifactu",             icon:"shield" },
  { sep: true, label:"Trabajo y agenda" },
  { view:"trabajos",      label:"Trabajos",              icon:"briefcase" },
  { view:"agenda",        label:"Agenda",                icon:"calendar" },
  { view:"pipeline",      label:"Pipeline CRM",          icon:"bar-chart" },
  { sep: true, label:"Gastos y tesorería" },
  { action:"gastoRapido", label:"Gasto rápido",          icon:"zap",    accent:true },
  { view:"gastos",        label:"Proveedores / Gastos",  icon:"credit-card", badge:"snBadgeVencidos" },
  { view:"tesoreria",     label:"Tesorería y banco",     icon:"bank" },
  { sep: true, label:"RRHH y Nóminas" },
  { view:"empleados",     label:"Empleados",             icon:"users2" },
  { view:"nominas",       label:"Nóminas",               icon:"card" },
  { view:"ss",            label:"Seguridad Social",      icon:"shield2" },
];

// Items fiscales según régimen
const SIDEBAR_FISCAL_AUTONOMO = [
  { sep: true, label:"Fiscal AEAT" },
  { view:"iva",           label:"IVA · Modelo 303",      icon:"layers" },
  { view:"irpf",          label:"IRPF · Modelo 130",     icon:"dollar" },
  { view:"otros-modelos", label:"Otros modelos",         icon:"check-square" },
  { view:"libros",        label:"Libros oficiales",      icon:"book" },
  { view:"amortizaciones",label:"Bienes e Inmovilizado", icon:"bar-chart2" },
];

const SIDEBAR_FISCAL_SOCIEDAD = [
  { sep: true, label:"Fiscal AEAT" },
  { view:"iva",           label:"IVA · Modelo 303",      icon:"layers" },
  { view:"is",            label:"IS · Mod. 200 / 202",   icon:"monitor" },
  { view:"otros-modelos", label:"Otros modelos",         icon:"check-square" },
  { view:"libros",        label:"Libros oficiales",      icon:"book" },
  { view:"amortizaciones",label:"Bienes e Inmovilizado", icon:"bar-chart2" },
];

const SIDEBAR_FISCAL_MODULOS = [
  { sep: true, label:"Fiscal AEAT" },
  { view:"iva",           label:"IVA · Modelo 303",      icon:"layers" },
  { view:"irpf",          label:"IRPF · Módulos (131)",  icon:"dollar" },
  { view:"otros-modelos", label:"Otros modelos",         icon:"check-square" },
  { view:"libros",        label:"Libros oficiales",      icon:"book" },
  { view:"amortizaciones",label:"Bienes e Inmovilizado", icon:"bar-chart2" },
];

// Items finales — siempre visibles
const SIDEBAR_TAIL = [
  { sep: true, label:"Contabilidad PGC" },
  { view:"contabilidad",  label:"Plan General Contable", icon:"file-text2" },
  { sep: true, label:"Análisis e Informes" },
  { view:"historico",     label:"Análisis anual",        icon:"activity" },
  { view:"informes",      label:"Informes avanzados",    icon:"bar-chart3" },
  { view:"cobros",        label:"Cobros y vencimientos", icon:"card2",  badge:"snBadgeCobros" },
  { sep: true, label:"Administración" },
  { view:"productos",     label:"Catálogo",              icon:"package" },
  { view:"plantillas",    label:"Mis plantillas",        icon:"layout" },
  { view:"documentos",    label:"Documentos",            icon:"folder" },
  { view:"colaboradores", label:"Colaboradores",         icon:"users3", badge:"colaboradoresBadge" },
];

/** Devuelve los SIDEBAR_ITEMS correctos según el régimen del perfil */
function getSidebarItems() {
  const regime = window.__TAURIX_REGIME__ ?? "autonomo_ed";
  // Grupos: sociedad → IS, autonomo_mod → 131, resto → 130
  const esSociedad = regime === "sociedad";
  const esModulos  = regime === "autonomo_mod";

  let fiscalItems;
  if (esSociedad) {
    fiscalItems = SIDEBAR_FISCAL_SOCIEDAD;
  } else if (esModulos) {
    fiscalItems = SIDEBAR_FISCAL_MODULOS;
  } else {
    fiscalItems = SIDEBAR_FISCAL_AUTONOMO;
  }

  return [...SIDEBAR_BASE, ...fiscalItems, ...SIDEBAR_TAIL];
}

// Alias para compatibilidad con código existente
const SIDEBAR_ITEMS = getSidebarItems();

/* ══════════════════════════════════════════
   SVG ICONS (inline, sin dependencias)
══════════════════════════════════════════ */
const ICONS = {
  grid:           `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>`,
  bell:           `<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>`,
  users:          `<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75M21 21v-2a4 4 0 00-3-3.87"/>`,
  users2:         `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.74"/>`,
  users3:         `<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 3.13a4 4 0 010 7.75"/><path d="M21 21v-2a4 4 0 00-3-3.87"/>`,
  "file-text":    `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="10" y1="17" x2="8" y2="17"/>`,
  "file-text2":   `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10,9 9,9 8,9"/>`,
  "bar-chart":    `<rect x="2" y="3" width="6" height="18" rx="1"/><rect x="9" y="8" width="6" height="13" rx="1"/><rect x="16" y="13" width="6" height="8" rx="1"/>`,
  "bar-chart2":   `<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>`,
  "bar-chart3":   `<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>`,
  file:           `<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>`,
  "plus-circle":  `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
  zap:            `<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>`,
  "credit-card":  `<path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="2"/>`,
  bank:           `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`,
  link:           `<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
  package:        `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="17"/><line x1="9.5" y1="14.5" x2="14.5" y2="14.5"/>`,
  card:           `<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  card2:          `<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>`,
  shield:         `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  shield2:        `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/>`,
  layers:         `<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`,
  dollar:         `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>`,
  monitor:        `<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>`,
  "check-square": `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>`,
  book:           `<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>`,
  activity:       `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
  folder:         `<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>`,
  briefcase:      `<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>`,
  calendar:       `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  refresh:        `<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>`,
  layout:         `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>`,
  clipboard:      `<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>`,
};

function svgIcon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name] || ICONS.file}</svg>`;
}

/* ══════════════════════════════════════════
   API PÚBLICA — compatibilidad total
   Todos los callers existentes siguen
   funcionando sin modificaciones.
══════════════════════════════════════════ */

/** Siempre "gestor" — plan único */
export function getModo()          { return "gestor"; }

/** Siempre true — para que initMultiEmpresa active el selector de empresa */
export function esModoGestor()     { return true; }

/** Siempre false */
export function esModoEmpresario() { return false; }

/**
 * Inicializa el sidebar unificado.
 * Devuelve siempre true (nunca necesita onboarding).
 */
export async function initModos() {
  aplicarModo();
  return true;
}

/**
 * Construye el sidebar unificado.
 * Se llama al inicio y al reconectar el DOM (p.ej. después de un context switch).
 */
export function aplicarModo() {
  const nav = document.querySelector(".sidebar-nav");
  if (!nav) {
    // DOM no listo — reintentar
    if (document.readyState !== "complete") {
      document.addEventListener("DOMContentLoaded", () => aplicarModo(), { once: true });
    } else {
      setTimeout(() => aplicarModo(), 100);
    }
    return;
  }

  const items = getSidebarItems();
  nav.innerHTML = items.map(item => {
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

    const special = item.view === "is"
      ? `<span class="is-badge" style="font-size:9px;padding:1px 6px">IS</span>`
      : "";

    return `<button class="sn-item" data-view="${item.view}">
      ${svgIcon(item.icon)}
      <span>${item.label}</span>
      ${badge}${special}
    </button>`;
  }).join("");

  // Re-registrar listeners (main.js los define en _rebindNav)
  if (window._rebindNav) {
    window._rebindNav();
  } else {
    let attempts = 0;
    const waitRebind = setInterval(() => {
      attempts++;
      if (window._rebindNav) {
        clearInterval(waitRebind);
        window._rebindNav();
      } else if (attempts > 20) {
        clearInterval(waitRebind);
        console.warn("[modos] _rebindNav no disponible tras 2s");
      }
    }, 100);
  }
}

/** No-op — ya no hay modos que alternar. Mantenido por compatibilidad. */
export function toggleModo() {}

/** No-op — ya no hay onboarding de selección de modo. */
export function showOnboardingModo() {}

/** No-op — la vista Cartera ya no existe en el sidebar. */
export async function refreshCartera() {}
