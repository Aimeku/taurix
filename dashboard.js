/* ═══════════════════════════════════════════════════════
   TAURIX · dashboard.js  — v4 PREMIUM
   Dashboard enterprise: KPIs con tendencia YoY,
   gráfico anual 12 meses, health score, forecast
   semanal, top clientes, deadline fiscal widget
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, CLIENTES, fmt, fmtShort, fmtDate,
  getYear, getTrim, getFacturasTrim, getFacturasYear,
  calcIVA, calcIRPF, TRIM_LABELS
} from "./utils.js";
import { getQueryContext } from "./query-context.js";

let _chartAnual = null;

export async function refreshDashboard() {
  const year = getYear(), trim = getTrim();
  const _ctx = getQueryContext();

  // DEBUG — eliminar tras confirmar funcionamiento
  console.log("[Dashboard] ctx:", _ctx, "year:", year, "trim:", trim);

  const [
    facturasTrim, facturasAnio, facturasAnioPrev,
    porCobrarRes, recurrentesRes, nominasRes, pipelineRes, bienesRes,
  ] = await Promise.all([
    getFacturasTrim(year, trim),
    getFacturasYear(year),
    getFacturasYear(year - 1),
    supabase.from("facturas").select("base,iva,fecha,fecha_vencimiento,cliente_nombre,concepto")
      .eq(_ctx.field,_ctx.value).eq("tipo","emitida").eq("estado","emitida").eq("cobrada",false),
    supabase.from("gastos_recurrentes").select("importe,proxima_fecha,nombre")
      .eq(_ctx.field,_ctx.value).eq("activo",true),
    supabase.from("nominas").select("salario_bruto,ss_empresa")
      .eq(_ctx.field,_ctx.value).gte("fecha",`${year}-01-01`),
    supabase.from("pipeline_oportunidades").select("etapa,valor")
      .eq(_ctx.field,_ctx.value).neq("etapa","perdida"),
    supabase.from("bienes_inversion").select("valor_adquisicion,coeficiente,tipo_bien")
      .eq(_ctx.field,_ctx.value),
  ]);

  // DEBUG — muestra qué facturas llegan y sus estados
  console.log("[Dashboard] facturasTrim count:", facturasTrim.length, facturasTrim.map(f=>({id:f.id,fecha:f.fecha,tipo:f.tipo,estado:f.estado,base:f.base})));
  console.log("[Dashboard] facturasAnio count:", facturasAnio.length);

  const { ingresos, gastos, rendimiento } = calcIRPF(facturasTrim);
  const { resultado: ivaRes } = calcIVA(facturasTrim);
  const ingAnio     = calcIRPF(facturasAnio).ingresos;
  const ingPrevTrim = calcIRPF(facturasAnioPrev).ingresos / 4;

  const pendientes    = porCobrarRes.data   || [];
  const recurrentes   = recurrentesRes.data || [];
  const pipeline      = pipelineRes.data    || [];
  const bienes        = bienesRes.data      || [];

  // ── KPIs ──
  const s  = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=fmt(v); };
  const st = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("kpiIngresos", ingresos);
  s("kpiGastos", gastos);
  s("kpiBeneficio", rendimiento);
  s("kpiIVA", ivaRes);
  s("kpiIRPF", Math.max(0, rendimiento * 0.20));

  st("dashPeriodoLabel", `${TRIM_LABELS[trim]} · ${year}`);

  // Tendencia vs mismo trimestre año anterior
  renderTendencia("kpiIngTendencia", ingresos, ingPrevTrim);

  // Cobro pendiente
  const pendienteCobro = pendientes.reduce((a,f)=>a+f.base+f.base*(f.iva||0)/100, 0);
  const hoy = new Date();
  const vencidas = pendientes.filter(f=>{
    const d = f.fecha_vencimiento || f.fecha;
    return d && Math.floor((hoy-new Date(d+"T12:00:00"))/86400000) > 30;
  });
  s("kpiCobroPendiente", pendienteCobro);
  st("kpiCobroPendienteN", `${pendientes.length} factura${pendientes.length!==1?"s":""}`);

  const badgeCobros = document.getElementById("snBadgeCobros");
  if (badgeCobros) { badgeCobros.textContent=vencidas.length; badgeCobros.style.display=vencidas.length?"":"none"; }

  // Pipeline
  const pipelineValor = pipeline.reduce((a,o)=>a+(o.valor||0), 0);
  const enNeg = pipeline.filter(o=>o.etapa==="negociacion").length;
  s("kpiPipeline", pipelineValor);
  st("kpiPipelineN", `${enNeg} en negociación`);

  // Amortización anual
  const amortAnual = bienes.reduce((a,b)=>{
    const c = b.coeficiente || _coefDefault(b.tipo_bien);
    return a + b.valor_adquisicion * c / 100;
  }, 0);
  s("kpiAmortizacion", amortAnual);

  // Gauge margen
  const margen = ingresos>0 ? Math.min(100,Math.round(rendimiento/ingresos*100)) : 0;
  const gpath = document.getElementById("gaugePath");
  const glbl  = document.getElementById("gaugeLabel");
  if (gpath) {
    gpath.style.strokeDashoffset = 157 - 157*Math.max(0,margen)/100;
    gpath.style.stroke = margen>50?"#059669":margen>20?"#d97706":"#dc2626";
  }
  if (glbl) glbl.textContent = margen+"%";

  // Contadores barra lateral
  st("tCountEmit",    facturasTrim.filter(f=>f.tipo==="emitida").length);
  st("tCountRecib",   facturasTrim.filter(f=>f.tipo==="recibida").length);
  st("tCountClientes",CLIENTES.length);
  const nomN = nominasRes.data?.length||0;
  st("tCountNominas", nomN||"—");

  // Widgets secundarios
  renderHealthScore({ ingresos, gastos, rendimiento, margen, pendienteCobro, vencidas:vencidas.length, pipelineValor });
  renderProximoDeadline(trim, year);
  renderTopClientes(facturasTrim);
  await refreshCashflowPreview(pendientes, recurrentes);
  await refreshAlertasDashboard(ivaRes, Math.max(0,rendimiento*0.20));
  await drawChartAnual(year);
  await renderActividadReciente(facturasTrim);

  // Botón "Revisión fiscal" — solo visible cuando el gestor está en contexto cliente
  const btnRev = document.getElementById("dashRevisionBtn");
  if (btnRev) {
    const enCliente = !!sessionStorage.getItem("tg_gestor_ctx");
    btnRev.style.display = enCliente ? "" : "none";
  }

  // Bloque "Tu gestor necesita esto" — solo para clientes, nunca cuando el gestor está operando
  const enContextoGestor = !!sessionStorage.getItem("tg_gestor_ctx");
  if (!enContextoGestor && SESSION?.user?.id) {
    // Resolver empresa_id de forma robusta:
    // 1. localStorage (si el usuario ya seleccionó empresa antes)
    // 2. BD: primera empresa del usuario (caso más común — autónomo con una sola empresa)
    // 3. null → no mostrar el bloque
    let empresaId = localStorage.getItem("tg_empresa_id") || null;

    if (!empresaId) {
      try {
        const { data: emp } = await supabase
          .from("empresas")
          .select("id")
          .eq("user_id", SESSION.user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (emp?.id) {
          empresaId = emp.id;
          // Guardar para próximas cargas — evita la query extra
          localStorage.setItem("tg_empresa_id", emp.id);
        }
      } catch (_) { /* sin empresa registrada — no mostrar el bloque */ }
    }

    const bannerEl = document.getElementById("gestorSolicitudesBanner");
    if (bannerEl && empresaId) {
      try {
        const { renderSolicitudesCliente } = await import("./gestor-solicitudes.js");
        await renderSolicitudesCliente(bannerEl, empresaId);
      } catch (e) {
        console.warn("gestorSolicitudesBanner:", e.message);
        bannerEl.innerHTML = "";
      }
    } else if (bannerEl) {
      bannerEl.innerHTML = "";
    }
  }
}

function _coefDefault(tipo) {
  return { "Equipos informáticos":26,"Aplicaciones informáticas":33,"Maquinaria":12,"Mobiliario":10,"Instalaciones":10,"Elementos de transporte":16,"Edificios y construcciones":3 }[tipo] || 10;
}

/* ── Tendencia KPI ── */
function renderTendencia(elId, actual, anterior) {
  const el = document.getElementById(elId);
  if (!el || !anterior) return;
  const pct = ((actual-anterior)/anterior*100);
  const up = pct >= 0;
  el.innerHTML = `<span style="color:${up?"#059669":"#dc2626"};font-size:11px;font-weight:700">${up?"▲":"▼"} ${Math.abs(pct).toFixed(1)}% vs año ant.</span>`;
}

/* ── Health Score ── */
function renderHealthScore({ ingresos,gastos,rendimiento,margen,pendienteCobro,vencidas,pipelineValor }) {
  const el = document.getElementById("healthScoreWrap");
  if (!el) return;
  let score = 100;
  const fcts = [];
  if (margen>=60) fcts.push({ok:1,txt:"Margen excelente (>60%)"});
  else if (margen>=30) { score-=10; fcts.push({ok:0.5,txt:`Margen aceptable (${margen}%)`}); }
  else { score-=25; fcts.push({ok:0,txt:`Margen bajo (${margen}%)`}); }
  if (vencidas===0) fcts.push({ok:1,txt:"Sin facturas vencidas"});
  else if (vencidas<=2) { score-=10; fcts.push({ok:0.5,txt:`${vencidas} vencida${vencidas>1?"s":""}`}); }
  else { score-=20; fcts.push({ok:0,txt:`${vencidas} facturas vencidas`}); }
  const rg = ingresos>0?gastos/ingresos:1;
  if (rg<0.4) fcts.push({ok:1,txt:"Gastos controlados (<40%)"});
  else if (rg<0.7) { score-=5; fcts.push({ok:0.5,txt:`Gastos ${(rg*100).toFixed(0)}% de ingresos`}); }
  else { score-=15; fcts.push({ok:0,txt:`Gastos altos (${(rg*100).toFixed(0)}%)`}); }
  if (pipelineValor>ingresos*0.5) fcts.push({ok:1,txt:"Pipeline sólido"});
  else if (pipelineValor>0) fcts.push({ok:0.5,txt:"Pipeline activo"});
  else { score-=5; fcts.push({ok:0,txt:"Sin pipeline activo"}); }
  score = Math.max(0,Math.min(100,score));
  const color = score>=75?"#059669":score>=50?"#d97706":"#dc2626";
  const label = score>=75?"Excelente":score>=50?"Buena":"Atención";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;padding:16px;background:var(--srf);border:1px solid var(--brd);border-radius:14px">
      <div style="position:relative;width:58px;height:58px;flex-shrink:0">
        <svg viewBox="0 0 36 36" style="transform:rotate(-90deg);width:58px;height:58px">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--brd)" stroke-width="3"/>
          <circle cx="18" cy="18" r="15" fill="none" stroke="${color}" stroke-width="3"
            stroke-dasharray="${(score*0.942).toFixed(1)} 94.2" stroke-linecap="round"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:${color}">${score}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);letter-spacing:.05em">Salud financiera · <span style="color:${color}">${label}</span></div>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px">
          ${fcts.map(f=>`<div style="display:flex;gap:5px;font-size:11px;color:var(--t2)">
            <span style="color:${f.ok===1?"#059669":f.ok===0.5?"#d97706":"#dc2626"}">${f.ok===1?"✓":f.ok===0.5?"◐":"✗"}</span>${f.txt}
          </div>`).join("")}
        </div>
      </div>
    </div>`;
}

/* ── Próximo Deadline ── */
function renderProximoDeadline(trim, year) {
  const el = document.getElementById("proximoDeadlineWrap");
  if (!el) return;
  const plazos = { T1:`${year}-04-22`,T2:`${year}-07-22`,T3:`${year}-10-22`,T4:`${year+1}-01-31` };
  const labels = { T1:"303+130 T1",T2:"303+130 T2",T3:"303+130 T3",T4:"303+130 T4 + Resumen anual" };
  const fechaStr = plazos[trim];
  const dias = Math.ceil((new Date(fechaStr)-new Date())/86400000);
  const color  = dias<=7?"#dc2626":dias<=30?"#d97706":"#059669";
  const icon   = dias<=7?"🚨":dias<=30?"⏰":"📅";
  el.innerHTML = `
    <div style="background:${dias<=7?"#fef2f2":dias<=30?"#fef9c3":"#f0fdf4"};border:1px solid ${color}33;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px">${icon}</div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.05em">Próximo plazo fiscal</div>
        <div style="font-size:13px;font-weight:600;color:var(--t1)">${labels[trim]}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:1px">Plazo: ${new Date(fechaStr).toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:26px;font-weight:800;color:${color};font-family:monospace;line-height:1">${Math.max(0,dias)}</div>
        <div style="font-size:10px;color:${color};font-weight:700">días</div>
      </div>
    </div>`;
}

/* ── Cashflow 30 días ── */
async function refreshCashflowPreview(pendientes, recurrentes) {
  try {
    const hoy = new Date();
    const hoyStr  = hoy.toISOString().slice(0,10);
    const en30Str = new Date(hoy.getTime()+30*86400000).toISOString().slice(0,10);
    const cobros = pendientes.filter(f=>{const d=f.fecha_vencimiento||f.fecha;return d&&d>=hoyStr&&d<=en30Str;}).reduce((a,f)=>a+f.base+f.base*(f.iva||0)/100,0);
    const pagos  = recurrentes.filter(g=>g.proxima_fecha&&g.proxima_fecha>=hoyStr&&g.proxima_fecha<=en30Str).reduce((a,g)=>a+g.importe,0);
    const saldo  = cobros - pagos;
    const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    s("cashCobros",fmt(cobros)); s("cashPagos",fmt(pagos)); s("cashSaldo",fmt(saldo));
    const wrap=document.getElementById("cashSaldoWrap");
    if(wrap) wrap.className=`cash-indicator ${saldo>=1000?"cash-indicator--pos":saldo>=0?"cash-indicator--warn":"cash-indicator--neg"}`;
    // Forecast 4 semanas
    const fWrap = document.getElementById("forecastSemanal");
    if (fWrap) {
      const semanas=[0,1,2,3].map(w=>{
        const i=new Date(hoy.getTime()+w*7*86400000).toISOString().slice(0,10);
        const f2=new Date(hoy.getTime()+(w+1)*7*86400000).toISOString().slice(0,10);
        const c=pendientes.filter(p=>{const d=p.fecha_vencimiento||p.fecha;return d&&d>=i&&d<=f2;}).reduce((a,p)=>a+p.base+p.base*(p.iva||0)/100,0);
        const p2=recurrentes.filter(g=>g.proxima_fecha&&g.proxima_fecha>=i&&g.proxima_fecha<=f2).reduce((a,g)=>a+g.importe,0);
        return {c,p:p2};
      });
      const mx=Math.max(...semanas.map(s=>Math.max(s.c,s.p)),1);
      fWrap.innerHTML=semanas.map((s,i)=>`
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
          <div style="width:100%;height:48px;display:flex;align-items:flex-end;justify-content:center;gap:2px">
            ${s.c>0?`<div style="flex:1;background:#05966988;height:${Math.max(3,s.c/mx*44)}px;border-radius:3px 3px 0 0" title="Cobros ${fmt(s.c)}"></div>`:"<div style='flex:1'></div>"}
            ${s.p>0?`<div style="flex:1;background:#dc262688;height:${Math.max(3,s.p/mx*44)}px;border-radius:3px 3px 0 0" title="Pagos ${fmt(s.p)}"></div>`:"<div style='flex:1'></div>"}
          </div>
          <div style="font-size:10px;color:var(--t3);font-weight:600">S${i+1}</div>
        </div>`).join("");
    }
  } catch(e) { console.warn("cashflow:",e.message); }
}

/* ── Top Clientes ── */
function renderTopClientes(facturas) {
  const wrap = document.getElementById("topClientesWrap");
  if (!wrap) return;
  const by={};
  facturas.filter(f=>f.tipo==="emitida"&&f.estado==="emitida").forEach(f=>{
    const k=f.cliente_nombre||"Sin cliente";
    if(!by[k]) by[k]={nombre:k,total:0,n:0};
    by[k].total+=f.base+f.base*(f.iva||0)/100; by[k].n++;
  });
  const sorted=Object.values(by).sort((a,b)=>b.total-a.total).slice(0,5);
  const maxV=sorted[0]?.total||1;
  const colors=["#1a56db","#0ea5e9","#8b5cf6","#f59e0b","#ec4899"];
  wrap.innerHTML = sorted.length ? sorted.map((c,i)=>`
    <div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--brd)">
      <div style="width:22px;height:22px;border-radius:5px;background:${colors[i]}22;color:${colors[i]};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;flex-shrink:0">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.nombre}</div>
        <div style="background:var(--brd);border-radius:3px;height:3px;margin-top:4px">
          <div style="background:${colors[i]};width:${(c.total/maxV*100).toFixed(0)}%;height:100%;border-radius:3px"></div>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:12px;font-weight:700;font-family:monospace">${fmt(c.total)}</div>
        <div style="font-size:10px;color:var(--t4)">${c.n} factura${c.n!==1?"s":""}</div>
      </div>
    </div>`).join("")
  : `<div style="text-align:center;padding:16px;color:var(--t4);font-size:12px">Sin facturación en este periodo</div>`;
}

/* ── Gráfico anual ── */
async function drawChartAnual(year) {
  const canvas = document.getElementById("chartEvolucion");
  if (!canvas) return;
  if (!window.Chart) {
    await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
  }
  const _ctx = getQueryContext();
  const { data: allFacts } = await supabase.from("facturas")
    .select("tipo,base,iva,fecha,cobrada,estado")
    .eq(_ctx.field,_ctx.value)
    .gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`);
  const byMes = Array(12).fill(null).map(()=>({ing:0,gst:0,cob:0}));
  (allFacts||[]).forEach(f=>{
    const m=new Date(f.fecha+"T12:00:00").getMonth();
    if(f.tipo==="emitida"){if(f.estado==="emitida")byMes[m].ing+=f.base;if(f.cobrada)byMes[m].cob+=f.base+f.base*(f.iva||0)/100;}
    else byMes[m].gst+=f.base;
  });
  let acum=0; const acumData=byMes.map(m=>{acum+=m.ing;return acum;});
  if (_chartAnual) { _chartAnual.destroy(); _chartAnual=null; }

  // Reset canvas para evitar que se estire al recrear el chart
  const parent = canvas.parentElement;
  canvas.remove();
  const newCanvas = document.createElement("canvas");
  newCanvas.id = "chartEvolucion";
  parent.appendChild(newCanvas);
  const freshCanvas = newCanvas;

  const isDark=document.documentElement.classList.contains("dark");
  const gc=isDark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.05)";
  const lc=isDark?"#9ca3af":"#6b7280";
  _chartAnual = new window.Chart(freshCanvas, {
    data: {
      labels:["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"],
      datasets:[
        {type:"bar",label:"Ingresos",data:byMes.map(m=>m.ing),backgroundColor:"rgba(26,86,219,0.78)",borderRadius:5,borderSkipped:false,barPercentage:0.42,categoryPercentage:0.72,order:2},
        {type:"bar",label:"Gastos",data:byMes.map(m=>m.gst),backgroundColor:"rgba(220,38,38,0.65)",borderRadius:5,borderSkipped:false,barPercentage:0.42,categoryPercentage:0.72,order:2},
        {type:"line",label:"Acumulado",data:acumData,borderColor:"#059669",backgroundColor:"rgba(5,150,105,0.07)",borderWidth:2,pointRadius:2.5,pointBackgroundColor:"#059669",fill:true,tension:0.4,order:1,yAxisID:"y2"},
        {type:"line",label:"Cobrado",data:byMes.map(m=>m.cob),borderColor:"#f59e0b",borderWidth:1.5,borderDash:[4,3],pointRadius:2,fill:false,tension:0.3,order:1},
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,animation:{duration:450,easing:"easeOutQuart"},
      interaction:{mode:"index",intersect:false},
      plugins:{
        legend:{display:true,position:"top",labels:{color:lc,font:{size:11,family:"'Plus Jakarta Sans',sans-serif"},boxWidth:10,padding:12}},
        tooltip:{backgroundColor:isDark?"rgba(15,23,42,.95)":"rgba(255,255,255,.97)",titleColor:isDark?"#f8fafc":"#0f172a",bodyColor:isDark?"#94a3b8":"#475569",borderColor:"rgba(26,86,219,.15)",borderWidth:1,padding:10,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`}}
      },
      scales:{
        x:{grid:{display:false},ticks:{color:lc,font:{size:11}},border:{display:false}},
        y:{beginAtZero:true,grid:{color:gc},border:{display:false},ticks:{color:lc,font:{size:11},callback:v=>fmtShort(v)}},
        y2:{position:"right",beginAtZero:true,grid:{display:false},border:{display:false},ticks:{color:"#059669",font:{size:10},callback:v=>fmtShort(v)}}
      }
    }
  });
}

/* ── Actividad reciente ── */
async function renderActividadReciente(facturasTrim) {
  const tbody = document.getElementById("recentFacturasBody");
  if (!tbody) return;
  const recent = [...facturasTrim].sort((a,b)=>b.fecha.localeCompare(a.fecha)).slice(0,8);
  if (!recent.length) { tbody.innerHTML=`<tr class="dt-empty"><td colspan="7">Sin actividad en este periodo</td></tr>`; return; }
  const hoy = new Date();
  tbody.innerHTML = recent.map(f=>{
    const total=f.base+f.base*(f.iva||0)/100;
    const dias=Math.floor((hoy-new Date(f.fecha+"T12:00:00"))/86400000);
    return `<tr>
      <td class="mono" style="font-size:12px">${fmtDate(f.fecha)}<div style="font-size:10px;color:var(--t4)">hace ${dias}d</div></td>
      <td>${f.estado==="emitida"?`<span class="badge b-income mono" style="font-size:11px">${f.numero_factura}</span>`:`<span class="badge b-draft">Borrador</span>`}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${f.concepto||"—"}</td>
      <td style="font-size:12px;color:var(--t3)">${f.cliente_nombre||"—"}</td>
      <td class="mono fw7">${fmt(total)}</td>
      <td><span class="badge ${f.tipo==="emitida"?"b-income":"b-expense"}" style="font-size:10px">${f.tipo==="emitida"?"Emitida":"Recibida"}</span></td>
      <td>${f.tipo==="emitida"&&f.estado==="emitida"?`<span class="badge ${f.cobrada?"b-cobrada":"b-pendiente"}">${f.cobrada?"Cobrada":"Pendiente"}</span>`:"<span style='color:var(--t4);font-size:11px'>—</span>"}</td>
    </tr>`;
  }).join("");
}

/* ── Alertas dashboard ── */
async function refreshAlertasDashboard(ivaRes, irpfRes) {
  const ai=document.getElementById("alertaIVAVal");   if(ai)  ai.textContent=fmt(ivaRes);
  const ar=document.getElementById("alertaIRPFVal");  if(ar)  ar.textContent=fmt(irpfRes);
  const hoy=new Date(); const mes=hoy.getMonth()+1; const dia=hoy.getDate();
  const urgente=[1,4,7,10].includes(mes)&&dia<=22;
  const dot=document.getElementById("notifDot"); if(dot) dot.style.display=urgente?"":"none";
  const badge=document.getElementById("snBadgeAlertas"); if(badge){badge.textContent=urgente?"!":"";badge.style.display=urgente?"":"none";}
}

/* ── Histórico ── */
export async function refreshHistorico() {
  const year=getYear();
  const lbl=document.getElementById("histYearLabel"); if(lbl) lbl.textContent=`Año ${year}`;
  let ingT=0,gstT=0,ivaT=0,irpfT=0; const ivR=[],irR=[];
  for(const t of["T1","T2","T3","T4"]){
    const ff=await getFacturasTrim(year,t);
    const iv=calcIVA(ff); const ir=calcIRPF(ff);
    ingT+=ir.ingresos;gstT+=ir.gastos;ivaT+=iv.resultado;irpfT+=ir.resultado;
    ivR.push({t,...iv}); irR.push({t,...ir});
  }
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=fmt(v);};
  s("histIngAnual",ingT);s("histGstAnual",gstT);s("histBenAnual",ingT-gstT);s("histIvaAnual",ivaT);s("histIrpfAnual",irpfT);
  const ib=document.getElementById("histIvaBody");
  if(ib) ib.innerHTML=ivR.map(r=>`<tr><td><span class="badge b-income">${r.t}</span></td><td class="mono">${fmt(r.rep.total)}</td><td class="mono">${fmt(r.sop.total)}</td><td class="mono fw7 ${r.resultado>0?"c-red":"c-green"}">${fmt(r.resultado)}</td><td>${r.resultado>0?`<span class="badge b-pagar">A pagar</span>`:`<span class="badge b-compen">A compensar</span>`}</td></tr>`).join("");
  const irb=document.getElementById("histIrpfBody");
  if(irb) irb.innerHTML=irR.map(r=>`<tr><td><span class="badge b-income">${r.t}</span></td><td class="mono">${fmt(r.ingresos)}</td><td class="mono">${fmt(r.gastos)}</td><td class="mono fw7">${fmt(r.rendimiento)}</td><td class="mono">${fmt(r.retenciones)}</td><td class="mono fw7 ${r.resultado>0?"c-red":"c-green"}">${fmt(r.resultado)}</td></tr>`).join("");
}

/* ── IS ── */
export async function refreshIS() {
  const year=getYear();
  const ejEl=document.getElementById("isEjercicio"); if(ejEl) ejEl.textContent=year;
  const _ctx=getQueryContext();
  const [fR,nR,bR]=await Promise.all([
    supabase.from("facturas").select("tipo,base,iva,estado,irpf,irpf_retencion").eq(_ctx.field,_ctx.value).gte("fecha",`${year}-01-01`).lte("fecha",`${year}-12-31`),
    supabase.from("nominas").select("salario_bruto,ss_empresa").eq(_ctx.field,_ctx.value).gte("fecha",`${year}-01-01`),
    supabase.from("bienes_inversion").select("valor_adquisicion,coeficiente,tipo_bien").eq(_ctx.field,_ctx.value),
  ]);
  const facs=fR.data||[]; const noms=nR.data||[]; const bienes=bR.data||[];
  const ing=facs.filter(f=>f.tipo==="emitida"&&f.estado==="emitida").reduce((a,f)=>a+f.base,0);
  const gst=facs.filter(f=>f.tipo==="recibida").reduce((a,f)=>a+f.base,0);
  const gstP=noms.reduce((a,n)=>a+(n.salario_bruto||0)+(n.ss_empresa||0),0);
  const amort=bienes.reduce((a,b)=>a+b.valor_adquisicion*(_coefDefault(b.tipo_bien))/100,0);
  const baii=ing-gst-gstP-amort;
  const base=Math.max(0,baii);
  const cuota=base*0.25;
  const ret=facs.filter(f=>f.tipo==="emitida"&&f.estado==="emitida").reduce((a,f)=>a+f.base*((f.irpf_retencion||f.irpf||0))/100,0);
  const dif=Math.max(0,cuota-ret);
  const s=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=fmt(v);};
  s("isResultContable",baii);s("isBaseImp",base);s("isCuotaIntegra",cuota);s("isCuotaDif",dif);
  s("isIngExplot",ing);s("isGstExplot",gst+gstP);s("isAmort",amort);
  s("isBAII",baii);s("isBAI",baii);s("isBaseAjust",base);
  s("isCuotaIntBruta",cuota);s("isCuotaIntAjust",cuota);s("isRetenciones",ret);s("isPagosFrac",0);
  s("isCuotaDif2",dif);s("isResultFinal",dif);s("isGstPersonal",gstP);
  const te=document.getElementById("isTipoEf"); if(te) te.textContent=ing>0?((cuota/ing)*100).toFixed(1)+"%":"—";
  const st=document.getElementById("isEstado"); if(st) st.innerHTML=dif>0?`<span class="badge b-pagar">A ingresar · Mod.200</span>`:`<span class="badge b-compen">Sin pago</span>`;
}
