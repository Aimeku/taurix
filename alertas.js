/* ═══════════════════════════════════════════════════════
   TAURIX · alertas.js
   Sistema de alertas fiscales inteligente:
   · Calendario fiscal completo 2025/2026
   · Deadlines con días restantes en tiempo real
   · Alertas automáticas por situación fiscal
   · Recordatorios de retenciones, SS, nóminas
   · Notificaciones no leídas con persistencia
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, getYear, getTrim, getFacturasTrim, calcIVA, calcIRPF } from "./utils.js";

/* ══════════════════════════
   CALENDARIO FISCAL 2025/2026
   Todas las obligaciones AEAT + SS
══════════════════════════ */
const CALENDARIO_FISCAL = (year) => [
  // ── ENERO ──
  { fecha:`${year}-01-20`, modelo:"111/115", desc:"Retenciones e ingresos a cuenta — T4 año anterior", tipo:"retencion", urgencia:"alta" },
  { fecha:`${year}-01-30`, modelo:"303",     desc:"Declaración IVA — T4 año anterior", tipo:"iva", urgencia:"alta" },
  { fecha:`${year}-01-30`, modelo:"130",     desc:"Pago fraccionado IRPF — T4 año anterior", tipo:"irpf", urgencia:"alta" },
  { fecha:`${year}-01-31`, modelo:"390",     desc:"Resumen anual IVA — Ejercicio anterior", tipo:"iva", urgencia:"alta" },
  { fecha:`${year}-01-31`, modelo:"190",     desc:"Resumen anual retenciones — Ejercicio anterior", tipo:"retencion", urgencia:"alta" },
  { fecha:`${year}-02-28`, modelo:"347",     desc:"Declaración anual operaciones con terceros >3.005€", tipo:"informativa", urgencia:"media" },
  // ── ABRIL ──
  { fecha:`${year}-04-15`, modelo:"100",     desc:"Inicio campaña Renta y Patrimonio — Presentación por internet", tipo:"irpf", urgencia:"media" },
  { fecha:`${year}-04-20`, modelo:"111/115", desc:"Retenciones e ingresos a cuenta — T1", tipo:"retencion", urgencia:"alta" },
  { fecha:`${year}-04-22`, modelo:"303",     desc:"Declaración IVA — T1 (Ene-Mar)", tipo:"iva", urgencia:"alta" },
  { fecha:`${year}-04-22`, modelo:"130",     desc:"Pago fraccionado IRPF — T1 (Ene-Mar)", tipo:"irpf", urgencia:"alta" },
  { fecha:`${year}-04-22`, modelo:"349",     desc:"Recapitulativo operaciones intracomunitarias — T1", tipo:"informativa", urgencia:"media" },
  { fecha:`${year}-05-05`, modelo:"202",     desc:"Pago fraccionado IS — 1P (si régimen general)", tipo:"is", urgencia:"media" },
  { fecha:`${year}-06-30`, modelo:"100",     desc:"Fin campaña Renta — Último día presentación", tipo:"irpf", urgencia:"alta" },
  // ── JULIO ──
  { fecha:`${year}-07-20`, modelo:"111/115", desc:"Retenciones e ingresos a cuenta — T2", tipo:"retencion", urgencia:"alta" },
  { fecha:`${year}-07-22`, modelo:"303",     desc:"Declaración IVA — T2 (Abr-Jun)", tipo:"iva", urgencia:"alta" },
  { fecha:`${year}-07-22`, modelo:"130",     desc:"Pago fraccionado IRPF — T2 (Abr-Jun)", tipo:"irpf", urgencia:"alta" },
  { fecha:`${year}-07-22`, modelo:"349",     desc:"Recapitulativo operaciones intracomunitarias — T2", tipo:"informativa", urgencia:"media" },
  { fecha:`${year}-09-15`, modelo:"202",     desc:"Pago fraccionado IS — 2P", tipo:"is", urgencia:"media" },
  // ── OCTUBRE ──
  { fecha:`${year}-10-20`, modelo:"111/115", desc:"Retenciones e ingresos a cuenta — T3", tipo:"retencion", urgencia:"alta" },
  { fecha:`${year}-10-22`, modelo:"303",     desc:"Declaración IVA — T3 (Jul-Sep)", tipo:"iva", urgencia:"alta" },
  { fecha:`${year}-10-22`, modelo:"130",     desc:"Pago fraccionado IRPF — T3 (Jul-Sep)", tipo:"irpf", urgencia:"alta" },
  { fecha:`${year}-10-22`, modelo:"349",     desc:"Recapitulativo operaciones intracomunitarias — T3", tipo:"informativa", urgencia:"media" },
  { fecha:`${year}-11-25`, modelo:"200",     desc:"Impuesto de Sociedades — Ejercicio anterior", tipo:"is", urgencia:"alta" },
  { fecha:`${year}-12-15`, modelo:"202",     desc:"Pago fraccionado IS — 3P", tipo:"is", urgencia:"media" },
];

/* ══════════════════════════
   REFRESH ALERTAS VIEW
══════════════════════════ */
export async function refreshAlertas() {
  const year  = getYear();
  const trim  = getTrim();
  const hoy   = new Date();

  // Datos fiscales actuales
  const facturasTrim = await getFacturasTrim(year, trim);
  const { resultado: ivaRes } = calcIVA(facturasTrim);
  const { rendimiento, retenciones } = calcIRPF(facturasTrim);
  const irpfRes = Math.max(0, rendimiento * 0.20 - retenciones);

  // Facturas vencidas
  const { data: vencidas } = await supabase.from("facturas")
    .select("id,cliente_nombre,base,iva,fecha,numero_factura")
    .eq("user_id", SESSION.user.id).eq("tipo","emitida")
    .eq("estado","emitida").eq("cobrada",false);
  const vencidasReal = (vencidas||[]).filter(f => {
    const d = f.fecha_vencimiento || f.fecha;
    return d && Math.floor((hoy-new Date(d+"T12:00:00"))/86400000) > 30;
  });

  // Gastos recurrentes vencidos
  const { data: recVenc } = await supabase.from("gastos_recurrentes")
    .select("nombre,importe,proxima_fecha").eq("user_id",SESSION.user.id)
    .eq("activo",true).lte("proxima_fecha",hoy.toISOString().slice(0,10));

  // Construir alertas dinámicas
  const alertas = buildAlertas({
    year, trim, hoy, ivaRes, irpfRes,
    vencidasReal, recVenc: recVenc||[],
    facturasTrim
  });

  // Renderizar alertas activas
  renderAlertasActivas(alertas);

  // Renderizar calendario fiscal
  renderCalendarioFiscal(year, hoy);

  // Update badge topbar
  const urgentes = alertas.filter(a => a.nivel === "urgente").length;
  const badge = document.getElementById("snBadgeAlertas");
  const dot   = document.getElementById("notifDot");
  if (badge) { badge.textContent = urgentes||""; badge.style.display = urgentes?"":"none"; }
  if (dot)   dot.style.display = urgentes ? "" : "none";
}

/* ══════════════════════════
   CONSTRUIR ALERTAS
══════════════════════════ */
function buildAlertas({ year, trim, hoy, ivaRes, irpfRes, vencidasReal, recVenc, facturasTrim }) {
  const alertas = [];
  const addDias = (fecha) => Math.ceil((new Date(fecha) - hoy) / 86400000);

  // ── Deadlines fiscales próximos ──
  const plazos = {
    T1: { iva: `${year}-04-22`, irpf: `${year}-04-22`, ret: `${year}-04-20` },
    T2: { iva: `${year}-07-22`, irpf: `${year}-07-22`, ret: `${year}-07-20` },
    T3: { iva: `${year}-10-22`, irpf: `${year}-10-22`, ret: `${year}-10-20` },
    T4: { iva: `${year+1}-01-31`, irpf: `${year+1}-01-30`, ret: `${year+1}-01-20` },
  };
  const p = plazos[trim];

  const diasIVA  = addDias(p.iva);
  const diasIRPF = addDias(p.irpf);

  if (diasIVA >= 0 && diasIVA <= 30) {
    alertas.push({
      nivel: diasIVA <= 7 ? "urgente" : "aviso",
      icono: diasIVA <= 7 ? "🚨" : "⏰",
      titulo: `Modelo 303 — IVA ${trim} vence en ${diasIVA} días`,
      desc: `Resultado estimado: ${ivaRes >= 0 ? fmt(ivaRes) + " a ingresar" : fmt(Math.abs(ivaRes)) + " a compensar"}. Plazo: ${new Date(p.iva).toLocaleDateString("es-ES",{day:"numeric",month:"long"})}.`,
      acciones: [
        { label: "Ver IVA 303", vista: "iva" },
        { label: "Exportar casillas", fn: "_exportar303" },
      ]
    });
  }

  if (diasIRPF >= 0 && diasIRPF <= 30) {
    alertas.push({
      nivel: diasIRPF <= 7 ? "urgente" : "aviso",
      icono: diasIRPF <= 7 ? "🚨" : "⏰",
      titulo: `Modelo 130 — IRPF ${trim} vence en ${diasIRPF} días`,
      desc: `Resultado estimado: ${fmt(irpfRes)} a ingresar. Plazo: ${new Date(p.irpf).toLocaleDateString("es-ES",{day:"numeric",month:"long"})}.`,
      acciones: [{ label: "Ver IRPF 130", vista: "irpf" }]
    });
  }

  // ── Facturas vencidas ──
  if (vencidasReal.length > 0) {
    const totalVenc = vencidasReal.reduce((a,f)=>a+f.base+f.base*(f.iva||0)/100, 0);
    alertas.push({
      nivel: vencidasReal.length >= 3 ? "urgente" : "aviso",
      icono: "⚠️",
      titulo: `${vencidasReal.length} factura${vencidasReal.length>1?"s":""} vencida${vencidasReal.length>1?"s":""}`,
      desc: `Total pendiente de cobro vencido: ${fmt(totalVenc)}. Las facturas con más de 30 días sin cobrar pueden provisionar como gasto de difícil cobro.`,
      acciones: [{ label: "Ver cobros", vista: "cobros" }]
    });
  }

  // ── Gastos recurrentes pendientes ──
  if (recVenc.length > 0) {
    const totalRec = recVenc.reduce((a,g)=>a+g.importe, 0);
    alertas.push({
      nivel: "aviso",
      icono: "🔁",
      titulo: `${recVenc.length} gasto${recVenc.length>1?"s":""} recurrente${recVenc.length>1?"s":""} pendiente${recVenc.length>1?"s":""}`,
      desc: `Total: ${fmt(totalRec)}. Incluye: ${recVenc.slice(0,3).map(g=>g.nombre).join(", ")}${recVenc.length>3?"…":""}.`,
      acciones: [{ label: "Ver gastos recurrentes", vista: "gastos" }]
    });
  }

  // ── Alerta sin perfil fiscal ──
  // (si no hay facturas, probablemente no tiene perfil)
  if (!facturasTrim.length) {
    alertas.push({
      nivel: "info",
      icono: "💡",
      titulo: "Sin facturas en este periodo",
      desc: "Si no tienes actividad en este trimestre, el Modelo 303 y 130 se presentan igualmente con resultado cero (modelo negativo). No presentar puede implicar sanción de 200€.",
      acciones: []
    });
  }

  // ── Recordatorio reserva fiscal ──
  const ingTotal = facturasTrim.filter(f=>f.tipo==="emitida"&&f.estado==="emitida").reduce((a,f)=>a+f.base,0);
  if (ingTotal > 0) {
    const reserva = ingTotal * 0.30;
    alertas.push({
      nivel: "info",
      icono: "💰",
      titulo: `Reserva fiscal recomendada: ${fmt(reserva)}`,
      desc: `Con ${fmt(ingTotal)} facturados este periodo, deberías tener ${fmt(reserva)} (30%) reservados para IVA e IRPF. Esta es una estimación orientativa.`,
      acciones: []
    });
  }

  // ── Ordenar: urgente primero ──
  const orden = { urgente: 0, aviso: 1, info: 2, ok: 3 };
  return alertas.sort((a,b) => (orden[a.nivel]||3) - (orden[b.nivel]||3));
}

/* ══════════════════════════
   RENDER ALERTAS ACTIVAS
══════════════════════════ */
function renderAlertasActivas(alertas) {
  const wrap = document.getElementById("alertasActivasWrap");
  if (!wrap) return;

  if (!alertas.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:6px">Todo al día</div>
        <div style="font-size:13px;color:var(--t3)">No hay alertas fiscales urgentes en este momento.</div>
      </div>`;
    return;
  }

  const clases = { urgente:"alerta-fiscal--urgente", aviso:"alerta-fiscal--aviso", info:"alerta-fiscal--info", ok:"alerta-fiscal--ok" };

  wrap.innerHTML = alertas.map((a,i) => `
    <div class="alerta-fiscal ${clases[a.nivel]||"alerta-fiscal--info"}" id="alerta_${i}">
      <div class="af-icon">${a.icono}</div>
      <div style="flex:1">
        <div class="af-title">${a.titulo}</div>
        <div class="af-desc">${a.desc}</div>
        ${a.acciones?.length ? `
          <div class="af-actions">
            ${a.acciones.map(ac => ac.vista
              ? `<button class="af-btn" onclick="window._switchView('${ac.vista}')">${ac.label}</button>`
              : `<button class="af-btn" onclick="window['${ac.fn}']&&window['${ac.fn}']()">${ac.label}</button>`
            ).join("")}
          </div>` : ""}
      </div>
    </div>`).join("");
}

/* ══════════════════════════
   CALENDARIO FISCAL VISUAL
══════════════════════════ */
function renderCalendarioFiscal(year, hoy) {
  const wrap = document.getElementById("calendarioFiscalWrap");
  if (!wrap) return;

  const eventos = CALENDARIO_FISCAL(year);
  const hoyStr  = hoy.toISOString().slice(0,10);

  // Agrupar por mes
  const porMes = {};
  eventos.forEach(e => {
    const mes = e.fecha.substring(0,7);
    if (!porMes[mes]) porMes[mes] = [];
    porMes[mes].push(e);
  });

  const mNom = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const tipoColor = { iva:"#1a56db", irpf:"#8b5cf6", retencion:"#f59e0b", is:"#059669", informativa:"#6b7280" };
  const tipoLabel = { iva:"IVA", irpf:"IRPF", retencion:"Retenciones", is:"IS", informativa:"Informativa" };

  wrap.innerHTML = Object.entries(porMes).sort().map(([mes, evs]) => {
    const [y,m] = mes.split("-");
    const hayPasado = evs.some(e => e.fecha < hoyStr);
    const hayFuturo = evs.some(e => e.fecha >= hoyStr);
    const hayUrgente = evs.some(e => {
      const dias = Math.ceil((new Date(e.fecha)-hoy)/86400000);
      return dias >= 0 && dias <= 14;
    });

    return `
      <div style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:800;color:${hayUrgente?"#dc2626":"var(--t1)"}">${mNom[parseInt(m)]} ${y}</div>
          ${hayUrgente?`<span class="badge" style="background:#fee2e2;color:#dc2626;font-size:10px">⚡ Próximo</span>`:""}
          <div style="flex:1;height:1px;background:var(--brd)"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${evs.map(e => {
            const dias = Math.ceil((new Date(e.fecha)-hoy)/86400000);
            const pasado = e.fecha < hoyStr;
            const color  = tipoColor[e.tipo] || "#6b7280";
            const diasTxt = pasado ? "Vencido" : dias === 0 ? "Hoy" : dias === 1 ? "Mañana" : `en ${dias}d`;
            const urgente = !pasado && dias <= 7;
            return `
              <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:var(--srf);border:1px solid ${urgente?color+"44":"var(--brd)"};border-left:3px solid ${pasado?"var(--brd)":color};border-radius:10px;opacity:${pasado?0.5:1}">
                <div style="min-width:36px">
                  <div style="font-size:13px;font-weight:800;font-family:monospace;color:${pasado?"var(--t4)":urgente?"#dc2626":"var(--t1)"}">${e.fecha.slice(8)}</div>
                  <div style="font-size:10px;color:${pasado?"var(--t4)":urgente?"#dc2626":"var(--t3)"};font-weight:600">${diasTxt}</div>
                </div>
                <div style="flex:1">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                    <span style="background:${color}22;color:${color};font-size:10px;font-weight:700;padding:1px 7px;border-radius:6px">Mod. ${e.modelo}</span>
                    <span style="background:var(--bg2);color:var(--t3);font-size:10px;padding:1px 6px;border-radius:6px">${tipoLabel[e.tipo]||e.tipo}</span>
                    ${urgente?`<span style="background:#fee2e2;color:#dc2626;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px">⚡ URGENTE</span>`:""}
                    ${pasado?`<span style="background:#f3f4f6;color:#6b7280;font-size:10px;padding:1px 6px;border-radius:6px">✓ Periodo pasado</span>`:""}
                  </div>
                  <div style="font-size:12px;color:var(--t2)">${e.desc}</div>
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initAlertasView() {
  refreshAlertas();

  // Exportar funciones globales para los botones
  window._exportar303 = () => {
    import("./fiscal.js").then(m => m.exportarDatos303());
  };
  window._exportar130 = () => {
    import("./fiscal.js").then(m => m.exportarDatos130());
  };
}
