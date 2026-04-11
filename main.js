/* ═══════════════════════════════════════════════════════
   TAURIX · main.js  — v3 MÁXIMO
   Orquestador principal. Inicializa todos los módulos:
   auth, dashboard, fiscal, IS, nóminas,
   empleados, contabilidad, tesorería, pipeline, 347, 349...
   ═══════════════════════════════════════════════════════ */

import { login, logout, getSession, showAuthModal, showResetPasswordModal } from "./auth.js";
import { supabase } from "./supabase.js";

import {
  SESSION, CLIENTES, DARK_MODE,
  setSession, setClientes,
  toast, openModal, closeModal,
  applyDarkMode, initNav, switchView,
  getYear, getTrim,
  checkFiscalDeadlines, checkOnboarding, checkRecordatoriosTrimestrales,
  showPerfilModal, fmt, fmtDate,
  initMultiEmpresa, calcModelo347
} from "./utils.js";

import { refreshDashboard, refreshHistorico, refreshIS } from "./dashboard.js";
import { refreshIVA, refreshIRPF } from "./fiscal.js";
import {
  refreshFacturas, updateCierreBtn,
  showGastoRapidoModal, showSerieConfigModal
} from "./facturas.js";
import {
  loadClientes, refreshClientes,
  renderClientesTable, populateClienteSelect,
  initClientesView
} from "./clientes.js";
import { initNuevaFactura } from "./nueva-factura.js";
import {
  exportFacturasExcel, exportFacturasPDF,
  exportLibroIngPDF, exportLibroGstPDF,
  exportHistoricoExcel, exportClientesExcel
} from "./exports.js";
import { refreshPresupuestos, initPresupuestosView } from "./presupuestos.js";
import { loadProductos, setProductos, refreshProductos, initProductosView } from "./productos.js";
import {
  loadProveedores, setProveedores, refreshProveedores,
  refreshGastosRecurrentes, initGastosView
} from "./gastos.js";
import { initPipelineView, refreshPipeline } from "./pipeline.js";
import { loadEmpleados, setEmpleados, refreshEmpleados, refreshNominas, initNominasView } from "./nominas.js";
import { initTesoreriaView, refreshTesoreria } from "./tesoreria.js";
import { initInformesView } from "./informes.js";
import { initAlertasView, refreshAlertas } from "./alertas.js";
import { initColaboradores, initColaboradoresView, refreshColaboradoresView } from "./colaboradores.js";
import {
  initModos, aplicarModo, toggleModo, showOnboardingModo,
  refreshCartera, esModoGestor, getModo
} from "./modos.js";
import { initTrabajosView, refreshTrabajos } from "./trabajos.js";
import { initAgendaView, refreshAgenda } from "./agenda.js";
import { initDocumentosView } from "./documentos.js";
import { initNuevoPresupuesto } from "./nuevo-presupuesto.js";
import { initContabilidadView, refreshLibroDiario, refreshSumasSaldos, refreshBalance, refreshPyG } from "./contabilidad.js";
import { initOtrosModelosView } from "./otros-modelos.js";
import { initAmortizacionesView } from "./amortizaciones.js";
import { initValidacionesModal, validarIdentificadorFiscal, validarIBAN } from "./validaciones.js";
import { exportarDatos303, exportarDatos130, GASTOS_DEDUCIBLES } from "./fiscal.js";
import { initRecurrentesView, refreshRecurrentes } from "./facturas-recurrentes.js";
import { initNuevaRecurrente } from "./nueva-recurrente.js";
import { initPlantillasView, refreshPlantillas } from "./plantillas-usuario.js";
import { initAlbaranesView, refreshAlbaranes } from "./albaranes.js";
import { initProformaView, refreshProforma } from "./proforma.js";
import { initNuevaProforma } from "./nueva-proforma.js";
import { restaurarContextoSiExiste } from "./gestor-context.js";
import { initTaxAsistente } from "./tax-asistente.js";



/* ══════════════════════════
   GLOBAL REFRESH
══════════════════════════ */
async function fullRefresh() {
  await updateCierreBtn();
  await refreshDashboard();
  await refreshFacturas();
  await refreshPresupuestos();
  await refreshIVA();
  // Ramificar por régimen: autónomo → IRPF 130, sociedad → IS
  const _regime = window.__TAURIX_REGIME__ ?? "autonomo_ed";
  if (_regime === "sociedad") {
    // Sociedad (SL/SA): Impuesto de Sociedades
    try { await refreshIS(); } catch (e) { console.warn("IS refresh:", e.message); }
  } else {
    // Autónomo (ED, ES, Módulos): IRPF
    await refreshIRPF();
  }
  await refreshHistorico();
  await refreshCobros();

}
window._refresh = fullRefresh;

/* ═══════════════════════════════════════════════════════
   LÓGICA DE RÉGIMEN — adapta la UI según autónomo/sociedad
   Se llama al cargar y cada vez que se guarda el perfil.
═══════════════════════════════════════════════════════ */

/**
 * Navega a la vista de impuesto directo correcta según el régimen.
 * Autónomo → IRPF (Modelo 130)
 * Sociedad  → IS  (Modelos 200/202)
 */
window._goTaxDirecto = function() {
  const regime = window.__TAURIX_REGIME__ ?? "autonomo_ed";
  window._switchView(regime === "sociedad" ? "is" : "irpf");
};

/**
 * Adapta todos los elementos de la UI que dependen del régimen:
 * - qa-card de impuesto directo
 * - Alerta del dashboard
 * - Calendario fiscal
 * Se llama al inicio y al cambiar el régimen.
 */
window._adaptarUIRegimen = function() {
  const regime = window.__TAURIX_REGIME__ ?? "autonomo_ed";
  const esSociedad = regime === "sociedad";
  // autonomo_mod desactivado — se trata igual que autónomo estándar

  // qa-card impuesto directo
  const lbl = document.getElementById("qaTaxDirectoLabel");
  const sub = document.getElementById("qaTaxDirectoSub");
  if (lbl) lbl.textContent = esSociedad ? "IS" : "IRPF";
  if (sub) sub.textContent = esSociedad ? "Modelos 200/202" : "Modelo 130";

  // Alerta del dashboard
  const title = document.getElementById("alertaTaxDirectoTitle");
  const desc  = document.getElementById("alertaTaxDirectoDesc");
  const btn   = document.getElementById("alertaTaxDirectoBtn");
  if (title) title.textContent = esSociedad
    ? "IS — Pago fraccionado Mod.202 pendiente"
    : "IRPF — Modelo 130 pendiente";
  if (desc) desc.innerHTML = esSociedad
    ? "El Modelo 202 (pago fraccionado IS) vence el 20 de julio. Cuota estimada: <strong id='alertaIRPFVal'>—</strong>."
    : "El plazo de presentación del Modelo 130 también es el 20 de julio. Pago fraccionado estimado: <strong id='alertaIRPFVal'>—</strong>.";
  if (btn) btn.textContent = esSociedad ? "Ver Mod. 202 / IS" : "Ver Modelo 130";

  // Calendario fiscal — modelos según régimen
  const modelos = esSociedad
    ? { T1: "303 / 202", T2: "303 / 202", T3: "303 / 202", T4: "303 / 200 / 347" }
    : { T1: "303 / 130", T2: "303 / 130 / 111", T3: "303 / 130 / 111", T4: "303 / 130 / 347" };
  const calT1 = document.getElementById("calT1modelo");
  const calT2 = document.getElementById("calT2modelo");
  const calT3 = document.getElementById("calT3modelo");
  const calT4 = document.getElementById("calT4modelo");
  if (calT1) calT1.textContent = modelos.T1;
  if (calT2) calT2.textContent = modelos.T2;
  if (calT3) calT3.textContent = modelos.T3;
  if (calT4) calT4.textContent = modelos.T4;
};

// switchView con renderizado lazy para vistas que lo necesitan
const _switchViewBase = switchView;
window._switchView = async (view) => {
  _switchViewBase(view);
  if (view === "nuevo-presupuesto") {
    initNuevoPresupuesto();
  }
};

/* ══════════════════════════
   COBROS Y VENCIMIENTOS
══════════════════════════ */
async function refreshCobros() {
  if (!SESSION) return;
  const year = getYear(), trim = getTrim();
  const { getFechaRango } = await import("./utils.js");
  const { ini, fin } = getFechaRango(year, trim);

  const { data: pendientes } = await supabase.from("facturas")
    .select("*").eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida").eq("estado", "emitida").eq("cobrada", false)
    .order("fecha", { ascending: true });

  const lista = pendientes || [];
  const hoy = new Date();
  const totalPendiente = lista.reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);
  const vencidas = lista.filter(f => {
    const dias = Math.floor((hoy - new Date(f.fecha + "T12:00:00")) / 86400000);
    return dias > 30;
  });

  const { data: cobradas } = await supabase.from("facturas")
    .select("base,iva").eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida").eq("cobrada", true)
    .gte("fecha_cobro", ini).lte("fecha_cobro", fin);
  const totalCobrado = (cobradas || []).reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

  const { data: cobHist } = await supabase.from("facturas")
    .select("fecha,fecha_cobro").eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida").eq("cobrada", true).not("fecha_cobro", "is", null).limit(50);
  const mediaDias = cobHist?.length
    ? Math.round(cobHist.reduce((a, f) => {
        const dias = Math.floor((new Date(f.fecha_cobro) - new Date(f.fecha + "T12:00:00")) / 86400000);
        return a + dias;
      }, 0) / cobHist.length)
    : 0;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("cobrosPendiente", fmt(totalPendiente));
  s("cobrosVencidas", vencidas.length);
  s("cobrosCobrado", fmt(totalCobrado));
  s("cobrosMedia", mediaDias > 0 ? mediaDias + " días" : "—");

  const badge = document.getElementById("snBadgeCobros");
  if (badge) { badge.textContent = vencidas.length; badge.style.display = vencidas.length > 0 ? "" : "none"; }

  const tbody = document.getElementById("cobrosBody");
  if (tbody) {
    if (!lista.length) {
      tbody.innerHTML = `<tr class="dt-empty"><td colspan="8">🎉 ¡Sin facturas pendientes de cobro!</td></tr>`;
    } else {
      tbody.innerHTML = lista.map(f => {
        const total = f.base + f.base * f.iva / 100;
        const dias = Math.floor((hoy - new Date(f.fecha + "T12:00:00")) / 86400000);
        const diasClass = dias > 30 ? "dias-badge--red" : dias > 15 ? "dias-badge--warn" : "dias-badge--ok";
        return `<tr>
          <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
          <td><span class="badge b-income mono" style="font-size:11px">${f.numero_factura || "S/N"}</span></td>
          <td style="font-size:13px">${f.cliente_nombre || "—"}</td>
          <td class="mono fw7">${fmt(total)}</td>
          <td><span class="dias-badge ${diasClass}">${dias} días</span></td>
          <td><span class="badge b-pendiente">⏳ Pendiente</span></td>
          <td>
            <button class="ta-btn" onclick="window._sendRecordatorio('${f.id}','${f.cliente_nombre?.replace(/'/g, "")}')" title="Enviar recordatorio">📧</button>
          </td>
          <td>
            <button class="ta-btn ta-cobrada" onclick="window._toggleCobro('${f.id}',true)" title="Marcar como cobrada">✅ Cobrar</button>
          </td>
        </tr>`;
      }).join("");
    }
    const countEl = document.getElementById("cobrosPendCount");
    if (countEl) countEl.textContent = `${lista.length} factura${lista.length !== 1 ? "s" : ""} pendiente${lista.length !== 1 ? "s" : ""}`;
  }

  // Gastos por vencer
  const { data: recurrentes } = await supabase.from("gastos_recurrentes")
    .select("*").eq("user_id", SESSION.user.id).eq("activo", true)
    .order("proxima_fecha", { ascending: true }).limit(10);

  const tbodyGV = document.getElementById("gastosVencenBody");
  if (tbodyGV) {
    const lista2 = (recurrentes || []).filter(g => {
      if (!g.proxima_fecha) return false;
      const dias = Math.floor((new Date(g.proxima_fecha + "T12:00:00") - hoy) / 86400000);
      return dias <= 30;
    });
    if (!lista2.length) {
      tbodyGV.innerHTML = `<tr class="dt-empty"><td colspan="6">Sin gastos recurrentes próximos en los próximos 30 días.</td></tr>`;
    } else {
      tbodyGV.innerHTML = lista2.map(g => {
        const dias = Math.floor((new Date(g.proxima_fecha + "T12:00:00") - hoy) / 86400000);
        const diasClass = dias < 0 ? "dias-badge--red" : dias <= 5 ? "dias-badge--warn" : "dias-badge--ok";
        return `<tr>
          <td><strong style="font-size:13px">${g.nombre}</strong></td>
          <td style="font-size:12px;color:var(--t3)">${g.proveedor_nombre || "—"}</td>
          <td class="mono fw7">${fmt(g.importe)}</td>
          <td>${fmtDate(g.proxima_fecha)}</td>
          <td><span class="dias-badge ${diasClass}">${dias < 0 ? "Vencido" : dias === 0 ? "Hoy" : dias + " días"}</span></td>
          <td><button class="ta-btn ta-emit" onclick="window._registrarGastoRec('${g.id}')">⚡ Registrar</button></td>
        </tr>`;
      }).join("");
    }

    const vencidosGastos = (recurrentes || []).filter(g => {
      if (!g.proxima_fecha) return false;
      return Math.floor((new Date(g.proxima_fecha + "T12:00:00") - hoy) / 86400000) < 0;
    }).length;
    const badgeV = document.getElementById("snBadgeVencidos");
    if (badgeV) { badgeV.textContent = vencidosGastos; badgeV.style.display = vencidosGastos > 0 ? "" : "none"; }
  }
}

/* ══════════════════════════
   RECORDATORIO DE COBRO
══════════════════════════ */
window._sendRecordatorio = (facturaId, clienteNombre) => {
  toast(`📧 Recordatorio preparado para ${clienteNombre}. Función de email en desarrollo.`, "info", 4000);
};

/* ══════════════════════════
   INIT APP
══════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {

  /* ── Auth listener — PRIMERO, antes de getSession() ── */
  let _isRecoveryFlow = false;

  /* ── Detectar PKCE recovery code en URL ANTES del listener ──
     Con flowType "pkce", Supabase intercambia el ?code= y dispara
     SIGNED_IN (no PASSWORD_RECOVERY). Guardamos la intención en
     sessionStorage para sobrevivir a cualquier redirección interna. */
  const _urlParams = new URLSearchParams(window.location.search);
  const _hasRecoveryCode = _urlParams.get("code") && _urlParams.get("type") === "recovery";
  if (_hasRecoveryCode) {
    sessionStorage.setItem("taurix_recovery_pending", "1");
  }
  if (sessionStorage.getItem("taurix_recovery_pending") === "1") {
    _isRecoveryFlow = true;
    document.getElementById("appShell")?.classList.add("hidden");
    document.getElementById("landingPage")?.classList.add("hidden");
  }

  supabase.auth.onAuthStateChange((event, session) => {
    /* PASSWORD_RECOVERY: flow implícito (antiguo) — por compatibilidad */
    if (event === "PASSWORD_RECOVERY") {
      _isRecoveryFlow = true;
      sessionStorage.setItem("taurix_recovery_pending", "1");
      document.getElementById("appShell")?.classList.add("hidden");
      document.getElementById("landingPage")?.classList.add("hidden");
      window.history.replaceState({}, document.title, window.location.pathname);
      document.getElementById("resetPwModal")?.remove();
      showResetPasswordModal(session);
      return;
    }

    /* SIGNED_IN tras intercambio PKCE del link de recovery */
    if (event === "SIGNED_IN" && sessionStorage.getItem("taurix_recovery_pending") === "1") {
      sessionStorage.removeItem("taurix_recovery_pending");
      _isRecoveryFlow = true;
      document.getElementById("appShell")?.classList.add("hidden");
      document.getElementById("landingPage")?.classList.add("hidden");
      window.history.replaceState({}, document.title, window.location.pathname);
      document.getElementById("resetPwModal")?.remove();
      showResetPasswordModal(session);
      return;
    }

    if (event === "SIGNED_OUT") {
      sessionStorage.removeItem("taurix_recovery_pending");
      // Si el SIGNED_OUT viene del signOut() post-recovery, ignorarlo:
      // el reload() que sigue a continuación ya mostrará la landing limpia.
      if (sessionStorage.getItem("taurix_recovery_signout") === "1") return;
      document.getElementById("appShell")?.classList.add("hidden");
      document.getElementById("landingPage")?.classList.remove("hidden");
    }
  });

  /* ── CTA / landing ── */
  ["ctaNavBtn", "ctaHeroBtn", "ctaHeroSecBtn", "ctaPlanGratisBtn",
   "ctaPlanUnicoBtn", "ctaFinalBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", showAuthModal);
  });

  // Modales legales
  ["openPrivacidad", "openTerminos", "openCookies"].forEach(id => {
    const el = document.getElementById(id);
    const targetMap = { openPrivacidad: "modalPrivacidad", openTerminos: "modalTerminos", openCookies: "modalCookies" };
    el?.addEventListener("click", (e) => {
      e.preventDefault();
      const modal = document.getElementById(targetMap[id]);
      if (modal) modal.style.display = "flex";
    });
  });
  document.querySelectorAll(".legal-modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.style.display = "none";
    });
  });

  // Email links
  document.querySelectorAll(".email-link").forEach(el => {
    el.href = "mailto:taurixsupport@gmail.com";
  });

  // Cookie banner
  const cookieBanner = document.getElementById("cookieBanner");
  if (!localStorage.getItem("tg_cookies") && cookieBanner) {
    cookieBanner.style.display = "";
  }
  document.getElementById("cookieAceptar")?.addEventListener("click", () => {
    localStorage.setItem("tg_cookies", "1");
    if (cookieBanner) cookieBanner.style.display = "none";
  });
  document.getElementById("cookieRechazar")?.addEventListener("click", () => {
    localStorage.setItem("tg_cookies", "essential");
    if (cookieBanner) cookieBanner.style.display = "none";
  });

  /* ── Sesión ── */
  // Si ya se activó el recovery flow, no continuar con la app
  if (_isRecoveryFlow) return;
  const session = await getSession();
  if (!session) return;
  setSession(session);

  // Exponer sesión globalmente — necesario para query-context.js y gestor/store.js
  window.__TAURIX_SESSION__ = session;

  // Restaurar contexto gestor si estaba activo (sessionStorage persiste la sesión)
  restaurarContextoSiExiste();
  initTaxAsistente();

  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.remove("hidden");

  const email = session.user.email;
  const initials = email[0].toUpperCase();
  ["sfAvatar", "topbarAvatar"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = initials; });
  ["sfEmail"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = email; });
  const sfName = document.getElementById("sfName");
  if (sfName) sfName.textContent = email.split("@")[0];

  /* ── Perfil fiscal ── */
  const { data: pf } = await supabase.from("perfil_fiscal").select("*").eq("user_id", session.user.id).maybeSingle();
  // Guardar regime globalmente — modos.js lo lee para construir el sidebar correcto
  window.__TAURIX_REGIME__ = pf?.regime ?? "autonomo_ed";
  const sfr = document.getElementById("sfRegimeTxt");
  if (sfr) {
    const labels = { autonomo_ed: "Autónomo · Est. Directa", autonomo_es: "Autónomo · Est. Simplificada", sociedad: "Sociedad Limitada", autonomo_mod: "Autónomo · Módulos" };
    sfr.textContent = labels[window.__TAURIX_REGIME__] || "Autónomo · IRPF";
  }

  /* ── Banner perfil incompleto ── eliminado ── */

  /* ── Año / trimestre ── */
  const now = new Date();
  const curY = now.getFullYear();
  const curT = "T" + (Math.floor(now.getMonth() / 3) + 1);
  const yearSel = document.getElementById("yearSelect");
  for (let y = curY; y >= curY - 4; y--) {
    const o = document.createElement("option"); o.value = y; o.textContent = y; yearSel?.appendChild(o);
  }
  if (yearSel) yearSel.value = curY;
  const trimSel = document.getElementById("trimestreSelect");
  if (trimSel) trimSel.value = curT;

  /* ── Multi-empresa ── */
  await initMultiEmpresa();

  /* ── Navegación ── */
  initNav();
  initNuevaFactura();
  // Adaptar UI al régimen del perfil (sidebar ya construido por aplicarModo en modos.js)
  if (window._adaptarUIRegimen) window._adaptarUIRegimen();

  /* ── Cambio de periodo ── */
  yearSel?.addEventListener("change", fullRefresh);
  trimSel?.addEventListener("change", fullRefresh);

  /* ── Dark mode ── */
  applyDarkMode(DARK_MODE);
  document.getElementById("darkModeBtn")?.addEventListener("click", () => applyDarkMode(!DARK_MODE));

  /* ── Sidebar ── */
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("perfilFiscalBtn")?.addEventListener("click", showPerfilModal);
  document.getElementById("gastoRapidoBtn")?.addEventListener("click", showGastoRapidoModal);
  document.getElementById("serieConfigBtn")?.addEventListener("click", showSerieConfigModal);
  document.getElementById("cobrosRefreshBtn")?.addEventListener("click", refreshCobros);
  document.getElementById("alertasRefreshBtn")?.addEventListener("click", fullRefresh);

  /* ── Dashboard accesos rápidos ── */
  document.getElementById("qaGastoRapido")?.addEventListener("click", showGastoRapidoModal);
  window._gastoRapido = () => showGastoRapidoModal();

  /* ── Clientes ── */
  initClientesView();
  document.getElementById("exportClientesBtn")?.addEventListener("click", exportClientesExcel);

  /* ── Presupuestos ── */
  initPresupuestosView();

  /* ── Albaranes ── */
  initAlbaranesView();

  /* ── Proformas ── */
  initProformaView();
  initNuevaProforma();

  /* ── Facturas recurrentes ── */
  initRecurrentesView();
  initNuevaRecurrente();

  /* ── Plantillas de usuario ── */
  initPlantillasView();

  /* ── Productos ── */
  initProductosView();

  /* ── Gastos / Proveedores ── */
  initGastosView();

  /* ── Facturas ── */
  document.getElementById("exportFacturasExcelBtn")?.addEventListener("click", exportFacturasExcel);
  document.getElementById("exportFacturasPdfBtn")?.addEventListener("click", exportFacturasPDF);
  document.getElementById("irNuevaFacturaBtn")?.addEventListener("click", () => switchView("nueva-factura"));
  ["facturasSearch", "filterTipo", "filterEstado", "filterOp"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", refreshFacturas);
    document.getElementById(id)?.addEventListener("change", refreshFacturas);
  });
  ["filterFechaFrom", "filterFechaTo", "filterImporteMin", "filterImporteMax"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", refreshFacturas);
  });

  /* ── IVA / IRPF / IS ── */
  document.getElementById("exportIvaBtn")?.addEventListener("click", exportLibroIngPDF);
  document.getElementById("exportIrpfBtn")?.addEventListener("click", exportLibroGstPDF);
  document.getElementById("exportISBtn")?.addEventListener("click", () => toast("Exportación IS en desarrollo", "info"));



  /* ── Otros modelos ── */
  ["export111Btn", "export115Btn", "export347Btn", "export349Btn", "export190Btn", "export390Btn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => {
      const num = id.replace("export", "").replace("Btn", "");
      toast(`Exportación Modelo ${num} en desarrollo`, "info");
    });
  });

  /* ── Libros ── */
  document.getElementById("exportLibroIngBtn")?.addEventListener("click", exportLibroIngPDF);
  document.getElementById("exportLibroIngExcelBtn")?.addEventListener("click", exportFacturasExcel);
  document.getElementById("exportLibroGstBtn")?.addEventListener("click", exportLibroGstPDF);
  document.getElementById("exportLibroGstExcelBtn")?.addEventListener("click", async () => {
    const year = getYear(), trim = getTrim();
    const { getFechaRango } = await import("./utils.js");
    const { ini, fin } = getFechaRango(year, trim);
    const { data, error } = await supabase.from("facturas").select("*")
      .eq("user_id", SESSION.user.id).eq("tipo", "recibida").gte("fecha", ini).lte("fecha", fin);
    if (error) { toast("Error: " + error.message, "error"); return; }
    if (!data?.length) { toast("Sin gastos para exportar", "info"); return; }
    const rows = data.map(f => ({
      Fecha: f.fecha, "Nº": f.numero_factura || "S/N", Concepto: f.concepto,
      "Base": f.base, "IVA%": f.iva, "Cuota IVA": +((f.base * f.iva / 100).toFixed(2)),
      "Total": +(f.base + f.base * f.iva / 100).toFixed(2)
    }));
    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, `Gastos ${trim} ${year}`);
    window.XLSX.writeFile(wb, `gastos_${year}_${trim}.xlsx`);
    toast("Excel de gastos exportado", "success");
  });
  ["exportLibroBienesBtn", "exportLibroProvBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => toast("Próximamente disponible", "info"));
  });

  /* ── Histórico ── */
  document.getElementById("exportHistExcelBtn")?.addEventListener("click", exportHistoricoExcel);
  document.getElementById("dashExportBtn")?.addEventListener("click", exportFacturasExcel);

  /* ── Nóminas ── */
  document.getElementById("exportNominasBtn")?.addEventListener("click", () => toast("Exportar nóminas en desarrollo", "info"));
  ["exportTC1Btn", "exportTC2Btn", "exportSEPANominasBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => toast("Exportación SEPA / TC en desarrollo", "info"));
  });

  /* ── Pipeline ── */
  document.getElementById("nuevaOportunidadBtn")?.addEventListener("click", () => {
    toast("Pipeline CRM próximamente", "info");
  });

  /* ── Documentos ── */
  document.getElementById("subirDocumentoBtn")?.addEventListener("click", () => {
    toast("Gestión documental próximamente", "info");
  });
  window._openDocFolder = (carpeta) => {
    toast(`Carpeta "${carpeta}" próximamente disponible`, "info");
  };

  /* ── Auditoría ── */
  document.getElementById("exportAuditoriaBtn")?.addEventListener("click", () => {
    toast("Exportar log de auditoría próximamente", "info");
  });

  /* ── RETA Calculator ── */
  document.getElementById("retaTramo")?.addEventListener("change", calcRetaCuota);
  document.getElementById("retaIngresos")?.addEventListener("input", calcRetaCuota);

  /* ── Contabilidad tabs ── */
  document.getElementById("nuevoAsientoBtn")?.addEventListener("click", () => {
    toast("Asiento manual próximamente", "info");
  });
  document.getElementById("contabExportBtn")?.addEventListener("click", () => {
    toast("Exportar contabilidad próximamente", "info");
  });

  /* ── Informes ── */
  /* ── Informes ── */
  initInformesView();

  /* ── Alertas fiscales ── */
  initAlertasView();

  /* ── Sidebar unificado — plan único ── */
  await initModos();

  /* ── Colaboradores view ── */
  initColaboradoresView();

  /* ── Nuevo presupuesto ── (listeners se adjuntan la primera vez que se navega a la vista) */

  /* ── Trabajos ── */
  initTrabajosView();

  /* ── Agenda ── */
  initAgendaView();

  /* ── Documentos ── */
  initDocumentosView();

  /* ── Contabilidad ── */
  initContabilidadView();

  /* ── Otros modelos fiscales ── */
  await initOtrosModelosView();

  /* ── Amortizaciones ── */
  initAmortizacionesView();

  /* ── Validaciones en modales ── */
  initValidacionesModal();

  /* ── Exportar casillas 303/130 ── */
  document.getElementById("exportIvaBtn")?.addEventListener("click", exportarDatos303);
  document.getElementById("exportIrpfBtn")?.addEventListener("click", exportarDatos130);

  /* ── Pipeline CRM ── */
  initPipelineView();

  /* ── Nóminas y empleados ── */
  initNominasView();

  /* ── Tesorería ── */
  initTesoreriaView();

  /* ── Nueva empresa (solo visible en modo gestor, initMultiEmpresa lo controla) ── */
  document.getElementById("nuevaEmpresaTopBtn")?.addEventListener("click", showNuevaEmpresaModal);

  /* ── Notificaciones ── */
  document.getElementById("notifBtn")?.addEventListener("click", () => switchView("alertas"));

  /* ── Rebind nav: se llama cada vez que el sidebar se reconstruye ── */
  window._rebindNav = () => {
    document.querySelectorAll(".sn-item[data-view]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const view = btn.dataset.view;
        switchView(view);
        if (view === "facturas")        await refreshFacturas();
        if (view === "pipeline")        await refreshPipeline();
        if (view === "alertas")         await refreshAlertas();
        if (view === "documentos")      { const { refreshDocumentos } = await import("./documentos.js"); await refreshDocumentos(); }
        if (view === "tesoreria")       await refreshTesoreria();

        if (view === "iva")  await refreshIVA();
        // Impuesto directo: solo refrescar lo que corresponde al régimen
        const _vRegime = window.__TAURIX_REGIME__ ?? "autonomo_ed";
        if (view === "irpf" && _vRegime !== "sociedad") await refreshIRPF();
        if (view === "is"   && _vRegime === "sociedad") { try { await refreshIS(); } catch(e) { console.warn("IS:",e.message); } }
        if (view === "historico")       await refreshHistorico();
        if (view === "otros-modelos")   await initOtrosModelosView();
        // view "libros" — estática, listeners registrados en init, no necesita refresh
        if (view === "contabilidad")    await refreshLibroDiario();
        if (view === "amortizaciones")  { const { refreshBienesInversion } = await import("./amortizaciones.js"); await refreshBienesInversion(); }
        if (view === "cobros")          await refreshCobros();
        if (view === "nominas")         { const { refreshNominas } = await import("./nominas.js"); await refreshNominas(); }
        if (view === "empleados")       { const { refreshEmpleados } = await import("./nominas.js"); if(refreshEmpleados) await refreshEmpleados(); }
        if (view === "colaboradores")   await refreshColaboradoresView();
        // view "cartera" eliminada — plan único
        // view "revision-cliente" eliminada — plan único
        if (view === "trabajos")        await refreshTrabajos();
        if (view === "agenda")          await refreshAgenda();
        if (view === "informes")        initInformesView();
        if (view === "albaranes")       await refreshAlbaranes();
        if (view === "proformas")        await refreshProforma();
        if (view === "nueva-proforma")   initNuevaProforma();
        if (view === "recurrentes")     await refreshRecurrentes();
        if (view === "nueva-recurrente") initNuevaRecurrente();
        if (view === "plantillas")      await refreshPlantillas();
        if (view === "editar-plantilla") window._epInit?.();
      });
    });
    // Gasto rápido button
    document.getElementById("gastoRapidoBtn")?.addEventListener("click", showGastoRapidoModal);
    // Active state on current view
    document.querySelectorAll(".sn-item[data-view]").forEach(btn => {
      const active = document.querySelector(".view.active");
      if (active && btn.dataset.view === active.id.replace("view-","")) {
        btn.classList.add("active");
      }
    });
  };

  // Re-init vistas que dependen del sidebar al reconstruirse
  const _reinitVistas = () => {
    initTrabajosView();
    initAgendaView();
  };
  window._rebindNav_orig = window._rebindNav;
  window._rebindNav = () => {
    window._rebindNav_orig();
    _reinitVistas();
  };
  // Llamar ahora que está definida
  window._rebindNav();

  // Toggle modo global
  // window._toggleModo eliminado — plan único sin modos
  window._refreshDashboard = () => refreshDashboard();
  // window._refreshCartera eliminado — vista cartera removida

  // Navegación gestionada por _rebindNav() ↑

  /* ═══════════════════════
     CARGA INICIAL
  ═══════════════════════ */
  const clientes = await loadClientes();
  setClientes(clientes);
  renderClientesTable(clientes);
  populateClienteSelect();
  const countEl = document.getElementById("clientesCount");
  if (countEl) countEl.textContent = `${clientes.length} clientes registrados`;

  const productos = await loadProductos();
  setProductos(productos);

  const proveedores = await loadProveedores();
  setProveedores(proveedores);

  // Cargar empleados
  const empleados = await loadEmpleados();
  setEmpleados(empleados);

  await fullRefresh();
  await refreshProductos();
  // Precarga de trabajos y agenda para que no salgan en blanco
  try { await refreshTrabajos(); } catch(e) { console.warn('refreshTrabajos:', e.message); }
  try { await refreshAgenda();   } catch(e) { console.warn('refreshAgenda:', e.message); }
  await refreshProveedores();
  await refreshGastosRecurrentes();
  await refreshEmpleados();

  // Actualizar 347 badge
  try {
    const partes347 = await calcModelo347(getYear());
    const el347 = document.getElementById("alert347Count");
    if (el347) el347.textContent = partes347.length;
    const m347El = document.getElementById("m347Count");
    if (m347El) m347El.textContent = partes347.length;
  } catch (e) { console.warn("347:", e.message); }

  checkFiscalDeadlines();
  await checkOnboarding();
});

/* ══════════════════════════
   RETA CALCULATOR
══════════════════════════ */
function calcRetaCuota() {
  const tramo = document.getElementById("retaTramo")?.value;
  const cuotas = {
    tramo1: 230, tramo2: 260, tramo3: 275, tramo4: 291,
    tramo5: 294, tramo6: 294, tramo7: 350, tramo8: 530
  };
  const cuotaMes = cuotas[tramo] || 230;
  const el = document.getElementById("retaCuota");
  if (el) el.textContent = cuotaMes + " €/mes";
}

/* ══════════════════════════
   NUEVA EMPRESA MODAL
══════════════════════════ */
function showNuevaEmpresaModal() {
  openModal(`
    <div class="modal">
      <div class="modal-hd">
        <span class="modal-title">🏢 Nueva empresa</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <p class="modal-note">Gestiona múltiples empresas desde una sola cuenta. Cada empresa tiene sus propios datos, facturas y libros.</p>
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre / Razón social *</label><input autocomplete="off" id="ne_nombre" class="ff-input" placeholder="Mi empresa S.L."/></div>
          <div class="modal-field"><label>CIF *</label><input autocomplete="off" id="ne_nif" class="ff-input" placeholder="B12345678"/></div>
        </div>
        <div class="modal-field"><label>Régimen fiscal</label>
          <select id="ne_regime" class="ff-select">
            <option value="sociedad">Sociedad Limitada / SA</option>
            <option value="autonomo_ed">Autónomo · Estimación Directa</option>
          </select>
        </div>
        <div class="modal-field"><label>Domicilio fiscal</label><input autocomplete="off" id="ne_dir" class="ff-input" placeholder="Calle, CP, Ciudad"/></div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="ne_save">Crear empresa</button>
      </div>
    </div>
  `);
  document.getElementById("ne_save").addEventListener("click", async () => {
    const nombre = document.getElementById("ne_nombre").value.trim();
    const nif = document.getElementById("ne_nif").value.trim();
    if (!nombre || !nif) { toast("Nombre y CIF son obligatorios", "error"); return; }
    const { error } = await supabase.from("empresas").insert({
      user_id: SESSION.user.id,
      nombre, nif,
      regime: document.getElementById("ne_regime").value,
      domicilio_fiscal: document.getElementById("ne_dir").value.trim(),
    });
    if (error) { toast("Error: " + error.message, "error"); return; }
    toast("Empresa creada ✅", "success");
    closeModal();
    await initMultiEmpresa();
  });
}
