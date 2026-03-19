/* ═══════════════════════════════════════════════════════
   TAURIX · main.js  — v3 MÁXIMO
   Orquestador principal. Inicializa todos los módulos:
   auth, dashboard, fiscal, IS, Verifactu, nóminas,
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
  initMultiEmpresa, refreshVerifactu, calcModelo347
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
import { initNordigenView, refreshConexionesBancarias, autoSyncBancos } from "./nordigen.js";
import { initTrabajosView, refreshTrabajos } from "./trabajos.js";
import { initAgendaView, refreshAgenda } from "./agenda.js";
import { initDocumentosView } from "./documentos.js";
import { initContabilidadView, refreshLibroDiario, refreshSumasSaldos, refreshBalance, refreshPyG } from "./contabilidad.js";
import { initOtrosModelosView } from "./otros-modelos.js";
import { initAmortizacionesView } from "./amortizaciones.js";
import { initValidacionesModal, validarIdentificadorFiscal, validarIBAN } from "./validaciones.js";
import { exportarDatos303, exportarDatos130, GASTOS_DEDUCIBLES } from "./fiscal.js";



/* ══════════════════════════
   GLOBAL REFRESH
══════════════════════════ */
async function fullRefresh() {
  await updateCierreBtn();
  await refreshDashboard();
  await refreshFacturas();
  await refreshPresupuestos();
  await refreshIVA();
  await refreshIRPF();
  await refreshHistorico();
  await refreshCobros();
  // IS solo si es sociedad
  try { await refreshIS(); } catch (e) { console.warn("IS refresh:", e.message); }
  // Verifactu si vista activa
  if (document.getElementById("view-verifactu")?.classList.contains("active")) {
    await refreshVerifactu();
  }
}
window._refresh = fullRefresh;
window._switchView = switchView;  // alias global para módulos externos

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

  /* ── Auth listener ── */
  // NOTA: NO usar reload() aquí — causa bucle infinito.
  // La sesión ya se gestiona con getSession() más abajo.
  // Solo escuchamos SIGNED_OUT para limpiar la UI.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      document.getElementById("appShell")?.classList.add("hidden");
      document.getElementById("landingPage")?.classList.remove("hidden");
    }
    // Supabase envía PASSWORD_RECOVERY cuando el usuario llega
    // desde el enlace del email de restablecer contraseña
    if (event === "PASSWORD_RECOVERY") {
      showResetPasswordModal();
    }
  });

  /* ── CTA / landing ── */
  ["ctaNavBtn", "ctaHeroBtn", "ctaHeroSecBtn", "ctaPlanGratisBtn",
   "ctaPlanProBtn", "ctaPlanBizBtn", "ctaFinalBtn"].forEach(id => {
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
  const session = await getSession();
  if (!session) return;
  setSession(session);

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
  const sfr = document.getElementById("sfRegimeTxt");
  if (sfr && pf?.regime) {
    const labels = { autonomo_ed: "Autónomo · Est. Directa", autonomo_es: "Autónomo · Est. Simplificada", sociedad: "Sociedad", autonomo_mod: "Autónomo · Módulos" };
    sfr.textContent = labels[pf.regime] || "Autónomo · IRPF";
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

  /* ── Verifactu ── */
  document.getElementById("view-verifactu")?.addEventListener("click", async () => {
    if (document.getElementById("view-verifactu")?.classList.contains("active")) {
      await refreshVerifactu();
    }
  });
  document.getElementById("verifactuExportBtn")?.addEventListener("click", () => toast("Export XML Verifactu en desarrollo", "info"));

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

  /* ── Nóminas (stubs hasta módulo completo) ── */
  document.getElementById("generarNominaBtn")?.addEventListener("click", () => {
    toast("El módulo de nóminas está disponible en el plan Business", "info");
  });
  document.getElementById("exportNominasBtn")?.addEventListener("click", () => toast("Exportar nóminas próximamente", "info"));
  ["exportTC1Btn", "exportTC2Btn", "exportSEPANominasBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => toast("Disponible en plan Business", "info"));
  });
  document.getElementById("nuevoEmpleadoBtn")?.addEventListener("click", () => {
    toast("Módulo RRHH disponible en plan Business", "info");
  });

  /* ── Tesorería ── */
  document.getElementById("importarBancoBtn")?.addEventListener("click", () => {
    toast("Importación CSV bancario: arrastra el fichero aquí (próximamente)", "info");
  });
  document.getElementById("nuevaCuentaBtn")?.addEventListener("click", () => {
    toast("Gestión de cuentas bancarias próximamente", "info");
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
  // exportAuditoriaBtn removed //
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

  /* ── Modo empresario/gestor ── */
  const modoOk = await initModos();
  if (!modoOk) showOnboardingModo();

  /* ── Colaboradores view ── */
  initColaboradoresView();

  /* ── Banco automático view ── */
  initNordigenView();

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

  /* ── Nueva empresa ── */
  document.getElementById("nuevaEmpresaTopBtn")?.addEventListener("click", showNuevaEmpresaModal);

  /* ── Notificaciones ── */
  document.getElementById("notifBtn")?.addEventListener("click", () => switchView("alertas"));

  /* ── Rebind nav: se llama cada vez que el sidebar se reconstruye ── */
  window._rebindNav = () => {
    document.querySelectorAll(".sn-item[data-view]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const view = btn.dataset.view;
        switchView(view);
        if (view === "pipeline")        await refreshPipeline();
        if (view === "alertas")         await refreshAlertas();
        if (view === "documentos")      { const { refreshDocumentos } = await import("./documentos.js"); await refreshDocumentos(); }
        if (view === "tesoreria")       await refreshTesoreria();
        if (view === "verifactu")       { const { refreshVerifactu } = await import("./utils.js"); await refreshVerifactu(); }
        if (view === "otros-modelos")   await initOtrosModelosView();
        if (view === "contabilidad")    await refreshLibroDiario();
        if (view === "amortizaciones")  { const { refreshBienesInversion } = await import("./amortizaciones.js"); await refreshBienesInversion(); }
        if (view === "nominas")         { const { refreshNominas } = await import("./nominas.js"); await refreshNominas(); }
        if (view === "empleados")       { const { refreshEmpleados } = await import("./nominas.js"); if(refreshEmpleados) await refreshEmpleados(); }
        if (view === "colaboradores")   await refreshColaboradoresView();
        if (view === "banco-auto")      await refreshConexionesBancarias();
        if (view === "cartera")         await refreshCartera();
        if (view === "trabajos")        await refreshTrabajos();
        if (view === "agenda")          await refreshAgenda();
        if (view === "informes")        initInformesView();
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

  // Llamar ahora que está definida
  window._rebindNav();

  // Toggle modo global
  window._toggleModo = () => toggleModo();
  window._refreshDashboard = () => refreshDashboard();

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
          <div class="modal-field"><label>Nombre / Razón social *</label><input id="ne_nombre" class="ff-input" placeholder="Mi empresa S.L."/></div>
          <div class="modal-field"><label>CIF *</label><input id="ne_nif" class="ff-input" placeholder="B12345678"/></div>
        </div>
        <div class="modal-field"><label>Régimen fiscal</label>
          <select id="ne_regime" class="ff-select">
            <option value="sociedad">Sociedad Limitada / SA</option>
            <option value="autonomo_ed">Autónomo · Estimación Directa</option>
          </select>
        </div>
        <div class="modal-field"><label>Domicilio fiscal</label><input id="ne_dir" class="ff-input" placeholder="Calle, CP, Ciudad"/></div>
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
