/* ═══════════════════════════════════════════════════════
   TUGESTOR · main.js (orquestador)
   Este archivo solo inicializa la app y conecta módulos.
   La lógica vive en: utils.js · clientes.js · facturas.js
                      dashboard.js · fiscal.js · exports.js
                      nueva-factura.js · presupuestos.js
                      productos.js · gastos.js
   ═══════════════════════════════════════════════════════ */

import { login, logout, getSession, showAuthModal } from "./auth.js";
import { supabase }                  from "./supabase.js";

// Utilidades transversales
import {
  SESSION, CLIENTES, DARK_MODE,
  setSession, setClientes,
  toast, openModal, closeModal,
  applyDarkMode, initNav, switchView,
  getYear, getTrim,
  checkFiscalDeadlines, checkOnboarding,
  showPerfilModal, fmt, fmtDate
} from "./utils.js";

// Módulos funcionales
import { refreshDashboard, refreshHistorico }   from "./dashboard.js";
import { refreshIVA, refreshIRPF }              from "./fiscal.js";
import {
  refreshFacturas, updateCierreBtn,
  showGastoRapidoModal, showSerieConfigModal
}                                               from "./facturas.js";
import {
  loadClientes, refreshClientes,
  renderClientesTable, populateClienteSelect,
  initClientesView
}                                               from "./clientes.js";
import { initNuevaFactura }                     from "./nueva-factura.js";
import {
  exportFacturasExcel, exportFacturasPDF,
  exportLibroIngPDF, exportLibroGstPDF,
  exportHistoricoExcel, exportClientesExcel
}                                               from "./exports.js";

// NUEVOS MÓDULOS
import {
  refreshPresupuestos, initPresupuestosView
}                                               from "./presupuestos.js";
import {
  loadProductos, setProductos, refreshProductos, initProductosView
}                                               from "./productos.js";
import {
  loadProveedores, setProveedores, refreshProveedores,
  refreshGastosRecurrentes, initGastosView
}                                               from "./gastos.js";

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
}
window._refresh = fullRefresh;

/* ══════════════════════════
   COBROS Y VENCIMIENTOS
══════════════════════════ */
async function refreshCobros() {
  if (!SESSION) return;
  const year = getYear(), trim = getTrim();
  const { getFechaRango } = await import("./utils.js");
  const { ini, fin } = getFechaRango(year, trim);

  // Facturas pendientes de cobro (todas las emitidas sin cobrar del usuario)
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

  // Cobrado en el trimestre
  const { data: cobradas } = await supabase.from("facturas")
    .select("base,iva").eq("user_id", SESSION.user.id)
    .eq("tipo", "emitida").eq("cobrada", true)
    .gte("fecha_cobro", ini).lte("fecha_cobro", fin);
  const totalCobrado = (cobradas || []).reduce((a, f) => a + f.base + f.base * f.iva / 100, 0);

  // Media días cobro
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
  s("cobrosVencidas",  vencidas.length);
  s("cobrosCobrado",   fmt(totalCobrado));
  s("cobrosMedia",     mediaDias > 0 ? mediaDias + " días" : "—");

  // Badge sidebar
  const badge = document.getElementById("snBadgeCobros");
  if (badge) { badge.textContent = vencidas.length; badge.style.display = vencidas.length > 0 ? "" : "none"; }

  // Tabla cobros pendientes
  const tbody = document.getElementById("cobrosBody");
  if (tbody) {
    if (!lista.length) {
      tbody.innerHTML = `<tr class="dt-empty"><td colspan="7">🎉 ¡Sin facturas pendientes de cobro!</td></tr>`;
    } else {
      tbody.innerHTML = lista.map(f => {
        const total = f.base + f.base * f.iva / 100;
        const dias  = Math.floor((hoy - new Date(f.fecha + "T12:00:00")) / 86400000);
        const diasClass = dias > 30 ? "dias-badge--red" : dias > 15 ? "dias-badge--warn" : "dias-badge--ok";
        return `<tr>
          <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}</td>
          <td><span class="badge b-income mono" style="font-size:11px">${f.numero_factura || "S/N"}</span></td>
          <td style="font-size:13px">${f.cliente_nombre || "—"}</td>
          <td class="mono fw7">${fmt(total)}</td>
          <td><span class="dias-badge ${diasClass}">${dias} días</span></td>
          <td><span class="badge b-pendiente">⏳ Pendiente</span></td>
          <td>
            <button class="ta-btn ta-cobrada" onclick="window._toggleCobro('${f.id}',true)" title="Marcar como cobrada">✅ Cobrar</button>
          </td>
        </tr>`;
      }).join("");
    }
    const countEl = document.getElementById("cobrosPendCount");
    if (countEl) countEl.textContent = `${lista.length} factura${lista.length !== 1 ? "s" : ""} pendiente${lista.length !== 1 ? "s" : ""}`;
  }

  // Tabla gastos por vencer
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
    // Badge sidebar vencidos
    const vencidosGastos = (recurrentes || []).filter(g => {
      if (!g.proxima_fecha) return false;
      const dias = Math.floor((new Date(g.proxima_fecha + "T12:00:00") - hoy) / 86400000);
      return dias < 0;
    }).length;
    const badgeV = document.getElementById("snBadgeVencidos");
    if (badgeV) { badgeV.textContent = vencidosGastos; badgeV.style.display = vencidosGastos > 0 ? "" : "none"; }
  }
}
window._refreshCobros = refreshCobros;
   Muestra una notificación en el dashboard
   si el trimestre actual está próximo a cerrar
   y hay borradores sin emitir.
══════════════════════════ */
async function checkRecordatoriosTrimestrales() {
  if (!SESSION) return;

  const now  = new Date();
  const trim = "T"+(Math.floor(now.getMonth()/3)+1);
  const year = now.getFullYear();

  // Plazos de presentación (día del mes)
  const PLAZOS = { T1:{mes:4,dia:20}, T2:{mes:7,dia:20}, T3:{mes:10,dia:20}, T4:{mes:1,dia:30} };
  const plazo  = PLAZOS[trim];
  const deadlineDate = new Date(plazo.mes===1?year+1:year, plazo.mes-1, plazo.dia);
  const diffDays     = Math.ceil((deadlineDate - now) / 86400000);

  // Solo avisar si quedan ≤ 20 días para el plazo
  if (diffDays < 0 || diffDays > 20) return;

  // Comprobar si hay borradores en el trimestre actual
  const { data: borradores, error } = await supabase
    .from("facturas").select("id", { count:"exact" })
    .eq("user_id", SESSION.user.id)
    .eq("estado", "borrador")
    .gte("fecha", `${year}-${String((Math.floor(now.getMonth()/3)*3+1)).padStart(2,"0")}-01`);

  if (error) { console.warn("recordatorios:", error.message); return; }

  const numBorradores = borradores?.length || 0;
  const urgente       = diffDays <= 5;

  // Mostrar banner de recordatorio en el dashboard
  const recDiv = document.getElementById("recordatoriosBanner");
  if (!recDiv) return;

  const yaVisto = sessionStorage.getItem(`tg_rec_${year}_${trim}`);
  if (yaVisto) return;

  recDiv.innerHTML = `
    <div class="recordatorio-banner recordatorio-banner--${urgente?"urgente":"aviso"}">
      <div class="recordatorio-icon">${urgente?"🚨":"📅"}</div>
      <div class="recordatorio-body">
        <div class="recordatorio-titulo">
          ${urgente?"¡Atención!":"Recordatorio fiscal"} · ${trim} ${year}
        </div>
        <div class="recordatorio-texto">
          Faltan <strong>${diffDays} día${diffDays!==1?"s":""}</strong> para el plazo de presentación del ${trim}.
          ${numBorradores>0?`Tienes <strong>${numBorradores} factura${numBorradores!==1?"s":""} en borrador</strong> sin emitir.`:""}
          Revisa tus modelos 303 y 130 antes del plazo.
        </div>
      </div>
      <div class="recordatorio-acciones">
        <button class="btn-outline" style="font-size:12px" onclick="window._showIVA()">Ver IVA</button>
        <button class="btn-outline" style="font-size:12px" onclick="window._showIRPF()">Ver IRPF</button>
        <button class="deadline-close" onclick="
          sessionStorage.setItem('tg_rec_${year}_${trim}','1');
          this.closest('.recordatorio-banner').parentElement.innerHTML='';
        ">×</button>
      </div>
    </div>`;
  recDiv.style.display = "";
}

window._showIVA   = () => switchView("iva");
window._showIRPF  = () => switchView("irpf");
window._switchView = (v) => switchView(v);

/* ══════════════════════════
   DOMContentLoaded
══════════════════════════ */
document.addEventListener("DOMContentLoaded", async () => {

  /* ── LANDING: botones CTA ── */
  // CTA buttons → auth modal
  ["ctaHeroBtn","ctaNavBtn","ctaPlanGratisBtn","ctaPlanProBtn","ctaFinalBtn"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => showAuthModal());
  });

  /* ── Landing: smooth scroll ── */
  document.querySelectorAll(".lp-links a").forEach(a => {
    a.addEventListener("click", e => {
      e.preventDefault();
      const text   = a.textContent.trim().toLowerCase();
      const target = text==="precios"?document.getElementById("precios"):text==="faq"?document.getElementById("faq"):null;
      if (target) target.scrollIntoView({ behavior:"smooth", block:"start" });
    });
  });

  /* ── Modales legales ── */
  ["Privacidad","Terminos","Cookies"].forEach(n => {
    document.getElementById(`open${n}`)?.addEventListener("click", e => {
      e.preventDefault(); document.getElementById(`modal${n}`).style.display="flex";
    });
  });
  document.getElementById("cookieLeerMas")?.addEventListener("click", e => {
    e.preventDefault(); document.getElementById("modalCookies").style.display="flex";
  });
  ["modalPrivacidad","modalTerminos","modalCookies"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => { if(e.target.id===id) e.target.style.display="none"; });
  });
  document.addEventListener("keydown", e => {
    if (e.key==="Escape") ["modalPrivacidad","modalTerminos","modalCookies"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.style.display="none";
    });
  });

  /* ── Cookie banner ── */
  if (!localStorage.getItem("tg_cookies_ok")) {
    setTimeout(()=>{ const b=document.getElementById("cookieBanner"); if(b) b.style.display="flex"; },1200);
  }
  document.getElementById("cookieAceptar")?.addEventListener("click", () => {
    localStorage.setItem("tg_cookies_ok","1");
    const b=document.getElementById("cookieBanner");
    if(b){b.style.animation="slideDownOut .3s ease forwards"; setTimeout(()=>b.style.display="none",300);}
  });
  document.getElementById("cookieRechazar")?.addEventListener("click", () => {
    localStorage.setItem("tg_cookies_ok","essential");
    const b=document.getElementById("cookieBanner");
    if(b){b.style.animation="slideDownOut .3s ease forwards"; setTimeout(()=>b.style.display="none",300);}
  });

  /* ── Eliminar cuenta (RGPD) ── */
  document.getElementById("deleteAccountBtn")?.addEventListener("click", () => {
    openModal(`
      <div style="text-align:center;padding:8px 0 16px">
        <div style="width:52px;height:52px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <h3 style="font-size:17px;font-weight:800;color:var(--t1);margin:0 0 8px">Eliminar cuenta permanentemente</h3>
        <p style="font-size:13.5px;color:var(--t2);line-height:1.6;margin:0 0 20px">Se borrarán <strong>todos tus datos</strong>: facturas, clientes, perfil fiscal e historial. Esta acción es <strong>irreversible</strong>.</p>
        <p style="font-size:12px;color:var(--t4);margin:0 0 24px">Escribe <strong>ELIMINAR</strong> para confirmar:</p>
        <input id="deleteConfirmInput" type="text" class="ff-input" placeholder="ELIMINAR" style="text-align:center;font-weight:700;letter-spacing:2px;margin-bottom:20px"/>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn-outline" onclick="closeModal()">Cancelar</button>
          <button id="deleteConfirmBtn" class="btn-danger" disabled>Eliminar mi cuenta</button>
        </div>
      </div>
    `);
    const input = document.getElementById("deleteConfirmInput");
    const btn   = document.getElementById("deleteConfirmBtn");
    input?.addEventListener("input",()=>{ btn.disabled=input.value.trim()!=="ELIMINAR"; });
    btn?.addEventListener("click", async () => {
      btn.disabled=true; btn.innerHTML=`<span class="spin"></span> Eliminando…`;
      try {
        const uid = SESSION.user.id;
        const tables = ["facturas","clientes","perfil_fiscal","cierres_trimestrales","factura_series"];
        for (const t of tables) {
          const { error } = await supabase.from(t).delete().eq("user_id",uid);
          if (error) console.warn(`delete ${t}:`, error.message);
        }
        await supabase.auth.signOut();
        localStorage.clear();
        closeModal();
        document.getElementById("appShell")?.classList.add("hidden");
        document.getElementById("landingPage")?.classList.remove("hidden");
        toast("Cuenta eliminada. Hasta pronto.","success",5000);
      } catch(e) {
        toast("Error al eliminar: "+e.message,"error");
        btn.disabled=false; btn.textContent="Eliminar mi cuenta";
      }
    });
  });

  /* ══════════════════════════
     SESIÓN
  ══════════════════════════ */
  const session = await getSession();
  if (!session) return;
  setSession(session);

  /* ── Mostrar app ── */
  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.remove("hidden");

  /* ── Info usuario ── */
  const email    = session.user.email;
  const initials = email[0].toUpperCase();
  ["sfAvatar","topbarAvatar"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=initials; });
  ["sfEmail"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=email; });
  const sfName = document.getElementById("sfName");
  if (sfName) sfName.textContent = email.split("@")[0];

  /* ── Perfil fiscal ── */
  const { data: pf, error: pfe } = await supabase.from("perfil_fiscal").select("*").eq("user_id",session.user.id).single();
  if (pfe && pfe.code!=="PGRST116") console.warn("perfil init:", pfe.message);
  const sfr = document.getElementById("sfRegimeTxt");
  if (sfr && pf?.regime) {
    const labels={autonomo_ed:"Autónomo · Est. Directa",autonomo_es:"Autónomo · Est. Simplificada",sociedad:"Sociedad",autonomo_mod:"Autónomo · Módulos"};
    sfr.textContent=labels[pf.regime]||"Autónomo · IRPF";
  }

  /* ── Selector de año/trimestre ── */
  const now    = new Date();
  const curY   = now.getFullYear();
  const curT   = "T"+(Math.floor(now.getMonth()/3)+1);
  const yearSel = document.getElementById("yearSelect");
  for (let y=curY; y>=curY-3; y--) {
    const o=document.createElement("option"); o.value=y; o.textContent=y; yearSel.appendChild(o);
  }
  yearSel.value=curY;
  document.getElementById("trimestreSelect").value=curT;

  /* ── Navegación ── */
  initNav();
  initNuevaFactura();

  /* ── Cambio de periodo ── */
  const onPeriod = async () => { await fullRefresh(); };
  yearSel.addEventListener("change", onPeriod);
  document.getElementById("trimestreSelect")?.addEventListener("change", onPeriod);

  /* ── Dark mode ── */
  applyDarkMode(DARK_MODE);
  document.getElementById("darkModeBtn")?.addEventListener("click", ()=>applyDarkMode(!DARK_MODE));

  /* ── Sidebar acciones ── */
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("perfilFiscalBtn")?.addEventListener("click", showPerfilModal);
  document.getElementById("gastoRapidoBtn")?.addEventListener("click", showGastoRapidoModal);

  // Botón configurar numeración (si existe en el HTML)
  document.getElementById("serieConfigBtn")?.addEventListener("click", showSerieConfigModal);

  /* ── Accesos rápidos dashboard ── */
  document.getElementById("qaGastoRapido")?.addEventListener("click", showGastoRapidoModal);
  document.querySelector('.qa-card[onclick*="nueva-factura"]')?.addEventListener("click", () => switchView("nueva-factura"));

  /* ── Clientes ── */
  initClientesView();
  document.getElementById("exportClientesBtn")?.addEventListener("click", exportClientesExcel);

  /* ── Presupuestos ── */
  initPresupuestosView();

  /* ── Productos ── */
  initProductosView();

  /* ── Proveedores / Gastos recurrentes ── */
  initGastosView();

  /* ── Cobros ── */
  document.getElementById("cobrosRefreshBtn")?.addEventListener("click", refreshCobros);

  /* ── Facturas ── */
  document.getElementById("exportFacturasExcelBtn")?.addEventListener("click", exportFacturasExcel);
  document.getElementById("exportFacturasPdfBtn")?.addEventListener("click",   exportFacturasPDF);
  document.getElementById("irNuevaFacturaBtn")?.addEventListener("click",      ()=>switchView("nueva-factura"));

  ["facturasSearch","filterTipo","filterEstado","filterOp"].forEach(id=>{
    document.getElementById(id)?.addEventListener("input",  ()=>refreshFacturas());
    document.getElementById(id)?.addEventListener("change", ()=>refreshFacturas());
  });
  ["filterFechaFrom","filterFechaTo","filterImporteMin","filterImporteMax"].forEach(id=>{
    document.getElementById(id)?.addEventListener("change", ()=>refreshFacturas());
  });

  /* ── IVA / IRPF ── */
  document.getElementById("exportIvaBtn")?.addEventListener("click",  ()=>exportLibroIngPDF());
  document.getElementById("exportIrpfBtn")?.addEventListener("click", ()=>exportLibroGstPDF());

  /* ── Libros oficiales ── */
  document.getElementById("exportLibroIngBtn")?.addEventListener("click",      exportLibroIngPDF);
  document.getElementById("exportLibroIngExcelBtn")?.addEventListener("click", exportFacturasExcel);
  document.getElementById("exportLibroGstBtn")?.addEventListener("click",      exportLibroGstPDF);
  document.getElementById("exportLibroGstExcelBtn")?.addEventListener("click", async ()=>{
    const year=getYear(),trim=getTrim();
    const {ini,fin}={...(() => {
      const TRIM_RANGOS={T1:["01-01","03-31"],T2:["04-01","06-30"],T3:["07-01","09-30"],T4:["10-01","12-31"]};
      const [i,f]=TRIM_RANGOS[trim]; return {ini:`${year}-${i}`,fin:`${year}-${f}`};
    })()};
    const {data,error}=await supabase.from("facturas").select("*")
      .eq("user_id",SESSION.user.id).eq("tipo","recibida").gte("fecha",ini).lte("fecha",fin);
    if (error) { toast("Error: "+error.message,"error"); return; }
    if (!data?.length) { toast("Sin gastos para exportar","info"); return; }
    const rows=data.map(f=>({Fecha:f.fecha,"Nº":f.numero_factura||"S/N",Concepto:f.concepto,"Base":f.base,"IVA%":f.iva,"Cuota IVA":+((f.base*f.iva/100).toFixed(2)),"Total":+(f.base+f.base*f.iva/100).toFixed(2)}));
    const ws=window.XLSX.utils.json_to_sheet(rows);
    const wb=window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb,ws,`Gastos ${trim} ${year}`);
    window.XLSX.writeFile(wb,`gastos_${year}_${trim}.xlsx`);
    toast("Excel de gastos exportado","success");
  });
  ["exportLibroBienesBtn","exportLibroProvBtn"].forEach(id=>{
    document.getElementById(id)?.addEventListener("click",()=>toast("Próximamente disponible","info"));
  });

  /* ── Histórico ── */
  document.getElementById("exportHistExcelBtn")?.addEventListener("click", exportHistoricoExcel);
  document.getElementById("dashExportBtn")?.addEventListener("click",      exportFacturasExcel);

  /* ══════════════════════════
     CARGA INICIAL
  ══════════════════════════ */
  const clientes = await loadClientes();
  setClientes(clientes);
  renderClientesTable(clientes);
  populateClienteSelect();
  const countEl = document.getElementById("clientesCount");
  if (countEl) countEl.textContent = `${clientes.length} clientes registrados`;

  // Cargar catálogo y proveedores
  const productos = await loadProductos();
  setProductos(productos);

  const proveedores = await loadProveedores();
  setProveedores(proveedores);

  await fullRefresh();
  await refreshProductos();
  await refreshProveedores();
  await refreshGastosRecurrentes();

  /* ── Post-carga ── */
  checkFiscalDeadlines();
  await checkOnboarding();
  await checkRecordatoriosTrimestrales();
});
