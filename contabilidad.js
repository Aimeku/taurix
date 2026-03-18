/* ═══════════════════════════════════════════════════════
   TAURIX · contabilidad.js
   Plan General Contable: asientos automáticos desde
   facturas/gastos/nóminas, libro diario, mayor, sumas y
   saldos, balance de situación, cuenta de PyG
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal, getYear, getTrim, getFechaRango } from "./utils.js";

/* ══════════════════════════
   PLAN DE CUENTAS PGC (extracto)
══════════════════════════ */
export const PLAN_CUENTAS = {
  // Grupo 1 — Financiación básica
  "100": "Capital social",
  "112": "Reserva legal",
  "129": "Resultado del ejercicio",
  // Grupo 2 — Inmovilizado
  "210": "Terrenos y bienes naturales",
  "211": "Construcciones",
  "213": "Maquinaria",
  "216": "Mobiliario",
  "217": "Equipos para procesos de información",
  "220": "Inversiones en terrenos",
  "281": "Amortización acumulada inmovilizado material",
  // Grupo 3 — Existencias
  "300": "Mercaderías",
  "310": "Materias primas",
  // Grupo 4 — Acreedores y deudores
  "400": "Proveedores",
  "401": "Proveedores, efectos comerciales a pagar",
  "410": "Acreedores por prestaciones de servicios",
  "430": "Clientes",
  "431": "Clientes, efectos comerciales a cobrar",
  "440": "Deudores varios",
  "460": "Anticipos de remuneraciones",
  "465": "Remuneraciones pendientes de pago",
  "470": "Hacienda Pública, deudora por IVA",
  "472": "Hacienda Pública, IVA soportado",
  "473": "Hacienda Pública, retenciones y pagos a cuenta",
  "474": "Activos por diferencias temporarias",
  "475": "Hacienda Pública, acreedora por IVA",
  "476": "Organismos SS, acreedores",
  "477": "Hacienda Pública, IVA repercutido",
  "480": "Gastos anticipados",
  "485": "Ingresos anticipados",
  // Grupo 5 — Cuentas financieras
  "520": "Deudas a corto plazo con entidades de crédito",
  "551": "Cuenta corriente con socios y administradores",
  "570": "Caja, euros",
  "572": "Bancos e instituciones de crédito c/c vista, euros",
  "580": "Inversiones financieras temporales",
  // Grupo 6 — Compras y gastos
  "600": "Compras de mercaderías",
  "621": "Arrendamientos y cánones",
  "622": "Reparaciones y conservación",
  "623": "Servicios de profesionales independientes",
  "624": "Transportes",
  "625": "Primas de seguros",
  "626": "Servicios bancarios y similares",
  "627": "Publicidad, propaganda y relaciones públicas",
  "628": "Suministros",
  "629": "Otros servicios",
  "640": "Sueldos y salarios",
  "642": "Seguridad Social a cargo de la empresa",
  "649": "Otros gastos sociales",
  "681": "Amortización del inmovilizado material",
  // Grupo 7 — Ventas e ingresos
  "700": "Ventas de mercaderías",
  "705": "Prestaciones de servicios",
  "706": "Descuentos sobre ventas por pronto pago",
  "740": "Subvenciones, donaciones y legados",
  "751": "Resultados de operaciones en común",
  "760": "Ingresos de participaciones en instrumentos de patrimonio",
  "769": "Otros ingresos financieros",
};

/* ══════════════════════════
   GENERAR ASIENTOS AUTOMÁTICOS
   desde facturas del periodo
══════════════════════════ */
export async function generarAsientos(year, trim) {
  const { ini, fin } = getFechaRango(year, trim);
  const { data: facturas } = await supabase.from("facturas")
    .select("*").eq("user_id", SESSION.user.id)
    .gte("fecha", ini).lte("fecha", fin)
    .order("fecha", { ascending: true });

  const asientos = [];
  let nAsiento = 1;

  (facturas || []).forEach(f => {
    const total = f.base + f.base * (f.iva || 0) / 100;
    const cuotaIVA = f.base * (f.iva || 0) / 100;
    const irpfAmt = f.base * (f.irpf_retencion || 0) / 100;

    if (f.tipo === "emitida" && f.estado === "emitida") {
      // Factura emitida: Cliente / IVA repercutido / Ingresos
      asientos.push({
        n: nAsiento++,
        fecha: f.fecha,
        concepto: `Factura emitida ${f.numero_factura || "S/N"} · ${f.cliente_nombre || "—"}`,
        lineas: [
          { cuenta: "430", nombre: "Clientes", debe: total - irpfAmt, haber: 0 },
          ...(irpfAmt > 0 ? [{ cuenta: "473", nombre: "HP, retenciones a cuenta", debe: irpfAmt, haber: 0 }] : []),
          { cuenta: "477", nombre: "HP, IVA repercutido", debe: 0, haber: cuotaIVA },
          { cuenta: "705", nombre: "Prestaciones de servicios", debe: 0, haber: f.base },
        ]
      });
    } else if (f.tipo === "recibida") {
      // Factura recibida: Gastos / IVA soportado / Proveedor
      const cuentaGasto = detectarCuentaGasto(f.concepto || "");
      asientos.push({
        n: nAsiento++,
        fecha: f.fecha,
        concepto: `Factura recibida ${f.numero_factura || "S/N"} · ${f.cliente_nombre || f.concepto || "—"}`,
        lineas: [
          { cuenta: cuentaGasto, nombre: PLAN_CUENTAS[cuentaGasto] || "Gastos", debe: f.base, haber: 0 },
          ...(cuotaIVA > 0 ? [{ cuenta: "472", nombre: "HP, IVA soportado", debe: cuotaIVA, haber: 0 }] : []),
          { cuenta: "400", nombre: "Proveedores", debe: 0, haber: total },
        ]
      });
    }
  });

  return asientos;
}

function detectarCuentaGasto(concepto) {
  const c = concepto.toLowerCase();
  if (c.includes("alquiler") || c.includes("arrendamiento")) return "621";
  if (c.includes("seguro")) return "625";
  if (c.includes("publicidad") || c.includes("marketing")) return "627";
  if (c.includes("gasolina") || c.includes("transporte") || c.includes("taxi")) return "624";
  if (c.includes("teléfono") || c.includes("internet") || c.includes("luz") || c.includes("agua") || c.includes("gas ")) return "628";
  if (c.includes("consultor") || c.includes("asesor") || c.includes("abogado") || c.includes("notario")) return "623";
  if (c.includes("reparac") || c.includes("mantenim")) return "622";
  return "629";
}

/* ══════════════════════════
   LIBRO DIARIO RENDER
══════════════════════════ */
export async function refreshLibroDiario() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const container = document.getElementById("asientosBody");
  if (!container) return;

  if (!asientos.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--t3);font-size:13px">Sin asientos para este periodo. Registra facturas para generarlos automáticamente.</div>`;
    return;
  }

  container.innerHTML = asientos.map(a => `
    <div style="border-bottom:2px solid var(--brd);padding-bottom:4px;margin-bottom:0">
      <div style="background:var(--bg1);padding:7px 14px;display:flex;align-items:center;gap:12px;font-size:12px;border-bottom:1px solid var(--brd)">
        <strong style="font-family:monospace;color:var(--accent)">#${String(a.n).padStart(4,"0")}</strong>
        <span style="color:var(--t3)">${fmtDate(a.fecha)}</span>
        <span style="color:var(--t1);font-weight:600">${a.concepto}</span>
      </div>
      ${a.lineas.map(l => `
        <div class="asiento-row" style="${l.debe > 0 ? "" : "padding-left:40px"}">
          <div style="font-size:11px;color:var(--t4)">${fmtDate(a.fecha)}</div>
          <div style="font-size:13px">${l.cuenta ? `<span class="asiento-cuenta">${l.cuenta}</span> ` : ""}${l.nombre}</div>
          <div></div>
          <div class="asiento-debe">${l.debe > 0 ? fmt(l.debe) : ""}</div>
          <div class="asiento-haber">${l.haber > 0 ? fmt(l.haber) : ""}</div>
        </div>`).join("")}
    </div>`).join("");
}

/* ══════════════════════════
   SUMAS Y SALDOS
══════════════════════════ */
export async function refreshSumasSaldos() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  const cuentas = {};
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (!cuentas[l.cuenta]) {
        cuentas[l.cuenta] = { cuenta: l.cuenta, nombre: l.nombre, debe: 0, haber: 0 };
      }
      cuentas[l.cuenta].debe  += l.debe;
      cuentas[l.cuenta].haber += l.haber;
    });
  });

  const sorted = Object.values(cuentas).sort((a, b) => a.cuenta.localeCompare(b.cuenta));
  const tbody = document.getElementById("sumasSaldosBody");
  if (!tbody) return;

  const totalDebe  = sorted.reduce((a, c) => a + c.debe, 0);
  const totalHaber = sorted.reduce((a, c) => a + c.haber, 0);

  tbody.innerHTML = sorted.map(c => {
    const saldoDeudor   = c.debe > c.haber ? c.debe - c.haber : 0;
    const saldoAcreedor = c.haber > c.debe ? c.haber - c.debe : 0;
    return `<tr>
      <td class="mono" style="color:var(--accent)">${c.cuenta}</td>
      <td>${c.nombre}</td>
      <td class="mono">${fmt(c.debe)}</td>
      <td class="mono">${fmt(c.haber)}</td>
      <td class="mono" style="color:#059669">${saldoDeudor > 0 ? fmt(saldoDeudor) : "—"}</td>
      <td class="mono" style="color:#dc2626">${saldoAcreedor > 0 ? fmt(saldoAcreedor) : "—"}</td>
    </tr>`;
  }).join("") + `<tr style="background:var(--bg2);font-weight:700;border-top:2px solid var(--brd)">
    <td colspan="2">TOTALES</td>
    <td class="mono">${fmt(totalDebe)}</td>
    <td class="mono">${fmt(totalHaber)}</td>
    <td class="mono" style="color:#059669">${fmt(totalDebe > totalHaber ? totalDebe - totalHaber : 0)}</td>
    <td class="mono" style="color:#dc2626">${fmt(totalHaber > totalDebe ? totalHaber - totalDebe : 0)}</td>
  </tr>`;
}

/* ══════════════════════════
   BALANCE DE SITUACIÓN
══════════════════════════ */
export async function refreshBalance() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  const cuentas = {};
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (!cuentas[l.cuenta]) cuentas[l.cuenta] = { debe: 0, haber: 0 };
      cuentas[l.cuenta].debe  += l.debe;
      cuentas[l.cuenta].haber += l.haber;
    });
  });

  const saldo = (cuenta) => {
    const c = cuentas[cuenta];
    if (!c) return 0;
    return c.debe - c.haber;
  };

  // Activo
  const activoNo      = saldo("211") + saldo("213") + saldo("217") - Math.abs(saldo("281"));
  const activoCo      = saldo("300") + saldo("430") + saldo("440") + saldo("472") + saldo("570") + saldo("572");
  const totalActivo   = activoNo + activoCo;

  // Pasivo + PN
  const pn            = saldo("100") + saldo("112") + saldo("129");
  const pasivoLP      = Math.abs(saldo("520"));
  const pasivoCo      = Math.abs(saldo("400")) + Math.abs(saldo("465")) + Math.abs(saldo("476")) + Math.abs(saldo("477"));
  const totalPasivo   = pn + pasivoLP + pasivoCo;

  const panel = document.getElementById("ctabPanel_balance");
  if (!panel) return;

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div>
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid var(--accent)">ACTIVO</div>
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">A) Activo no corriente</div>
          ${buildBalanceLine("Inmovilizado material neto", activoNo)}
          <div style="display:flex;justify-content:space-between;font-weight:700;padding:6px 0;border-top:1px solid var(--brd);margin-top:4px"><span>Total no corriente</span><span style="font-family:monospace">${fmt(activoNo)}</span></div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">B) Activo corriente</div>
          ${buildBalanceLine("Existencias", saldo("300"))}
          ${buildBalanceLine("Clientes y deudores", saldo("430") + saldo("440"))}
          ${buildBalanceLine("HP deudora (IVA)", saldo("472"))}
          ${buildBalanceLine("Tesorería", saldo("570") + saldo("572"))}
          <div style="display:flex;justify-content:space-between;font-weight:700;padding:6px 0;border-top:1px solid var(--brd);margin-top:4px"><span>Total corriente</span><span style="font-family:monospace">${fmt(activoCo)}</span></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding:10px 0;border-top:2px solid var(--t1);margin-top:8px;color:var(--accent)">
          <span>TOTAL ACTIVO</span><span style="font-family:monospace">${fmt(totalActivo)}</span>
        </div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#059669;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #059669">PATRIMONIO NETO Y PASIVO</div>
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">A) Patrimonio neto</div>
          ${buildBalanceLine("Capital social", saldo("100"))}
          ${buildBalanceLine("Reservas", saldo("112"))}
          ${buildBalanceLine("Resultado ejercicio", saldo("129"))}
          <div style="display:flex;justify-content:space-between;font-weight:700;padding:6px 0;border-top:1px solid var(--brd);margin-top:4px"><span>Total PN</span><span style="font-family:monospace">${fmt(pn)}</span></div>
        </div>
        <div style="margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">B) Pasivo no corriente</div>
          ${buildBalanceLine("Deudas largo plazo", pasivoLP)}
          <div style="display:flex;justify-content:space-between;font-weight:700;padding:6px 0;border-top:1px solid var(--brd);margin-top:4px"><span>Total no corriente</span><span style="font-family:monospace">${fmt(pasivoLP)}</span></div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--t3);margin-bottom:8px">C) Pasivo corriente</div>
          ${buildBalanceLine("Proveedores", Math.abs(saldo("400")))}
          ${buildBalanceLine("Remuneraciones pendientes", Math.abs(saldo("465")))}
          ${buildBalanceLine("SS acreedora", Math.abs(saldo("476")))}
          ${buildBalanceLine("HP acreedora (IVA)", Math.abs(saldo("477")))}
          <div style="display:flex;justify-content:space-between;font-weight:700;padding:6px 0;border-top:1px solid var(--brd);margin-top:4px"><span>Total corriente</span><span style="font-family:monospace">${fmt(pasivoCo)}</span></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding:10px 0;border-top:2px solid var(--t1);margin-top:8px;color:#059669">
          <span>TOTAL PN + PASIVO</span><span style="font-family:monospace">${fmt(totalPasivo)}</span>
        </div>
      </div>
    </div>
    ${Math.abs(totalActivo - totalPasivo) < 1 
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 16px;margin-top:12px;font-size:12px;color:#166534;font-weight:600">✅ Balance cuadrado correctamente</div>`
      : `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:10px 16px;margin-top:12px;font-size:12px;color:#854d0e;font-weight:600">⚠️ Diferencia: ${fmt(Math.abs(totalActivo - totalPasivo))} — Puede haber asientos manuales pendientes</div>`}`;
}

function buildBalanceLine(nombre, importe) {
  if (!importe || Math.abs(importe) < 0.01) return "";
  return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--brd)">
    <span style="color:var(--t2)">${nombre}</span>
    <span style="font-family:monospace">${fmt(importe)}</span>
  </div>`;
}

/* ══════════════════════════
   CUENTA DE PyG
══════════════════════════ */
export async function refreshPyG() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  const cuentas = {};
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (!cuentas[l.cuenta]) cuentas[l.cuenta] = { debe: 0, haber: 0 };
      cuentas[l.cuenta].debe  += l.debe;
      cuentas[l.cuenta].haber += l.haber;
    });
  });

  const saldo = (cuenta) => {
    const c = cuentas[cuenta];
    if (!c) return 0;
    return c.debe - c.haber;
  };

  const ingresos  = Math.abs(saldo("705")) + Math.abs(saldo("700"));
  const gstExplot = saldo("600") + saldo("621") + saldo("622") + saldo("623") +
                    saldo("624") + saldo("625") + saldo("626") + saldo("627") +
                    saldo("628") + saldo("629");
  const gstPerso  = saldo("640") + saldo("642") + saldo("649");
  const amort     = saldo("681");
  const baii      = ingresos - gstExplot - gstPerso - amort;
  const bai       = baii; // simplificado
  const is        = Math.max(0, bai * 0.25);
  const resultado = bai - is;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
  s("pygCifraNegocios", ingresos);
  s("pygAprovision",    gstExplot);
  s("pygGstPersonal",   gstPerso);
  s("pygOtrosGst",      0);
  s("pygAmort",         amort);
  s("pygResultExplot",  baii);
  s("pygBAI",           bai);
  s("pygIS",            is);
  s("pygResultEjercicio", resultado);
}

/* ══════════════════════════
   LIBRO MAYOR (una cuenta)
══════════════════════════ */
export async function showMayorCuenta(cuenta) {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  const movs = [];
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (l.cuenta === cuenta) movs.push({ ...l, fecha: a.fecha, concepto: a.concepto, n: a.n });
    });
  });

  const nombre = PLAN_CUENTAS[cuenta] || cuenta;
  let saldoAcum = 0;

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">📒 Mayor · ${cuenta} — ${nombre}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <table class="data-table">
          <thead><tr><th>Asiento</th><th>Fecha</th><th>Concepto</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
          <tbody>
            ${movs.map(m => {
              saldoAcum += m.debe - m.haber;
              return `<tr>
                <td class="mono" style="color:var(--accent)">#${String(m.n).padStart(4,"0")}</td>
                <td class="mono" style="font-size:12px">${fmtDate(m.fecha)}</td>
                <td style="font-size:12px;color:var(--t2)">${m.concepto}</td>
                <td class="mono" style="color:#059669">${m.debe > 0 ? fmt(m.debe) : ""}</td>
                <td class="mono" style="color:#dc2626">${m.haber > 0 ? fmt(m.haber) : ""}</td>
                <td class="mono fw7">${fmt(saldoAcum)}</td>
              </tr>`;
            }).join("") || `<tr class="dt-empty"><td colspan="6">Sin movimientos en esta cuenta para el periodo</td></tr>`}
          </tbody>
        </table>
        <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:24px;font-size:13px;padding:10px 0;border-top:2px solid var(--brd)">
          <span>Total Debe: <strong style="color:#059669">${fmt(movs.reduce((a,m)=>a+m.debe,0))}</strong></span>
          <span>Total Haber: <strong style="color:#dc2626">${fmt(movs.reduce((a,m)=>a+m.haber,0))}</strong></span>
          <span>Saldo: <strong>${fmt(saldoAcum)}</strong></span>
        </div>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
}

/* ══════════════════════════
   PLAN DE CUENTAS VIEW
══════════════════════════ */
export function renderPlanCuentas() {
  const panel = document.getElementById("ctabPanel_plan");
  if (!panel) return;

  const grupos = {
    "1": "Financiación básica",
    "2": "Inmovilizado",
    "3": "Existencias",
    "4": "Acreedores y deudores",
    "5": "Cuentas financieras",
    "6": "Compras y gastos",
    "7": "Ventas e ingresos",
  };

  panel.style.display = "";
  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:4px">
      ${Object.entries(grupos).map(([g, nombre]) => {
        const cuentas = Object.entries(PLAN_CUENTAS).filter(([c]) => c.startsWith(g));
        return `<div>
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);margin-bottom:10px">GRUPO ${g} — ${nombre}</div>
          ${cuentas.map(([c, n]) => `
            <div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--brd);cursor:pointer;align-items:center" onclick="window._showMayor('${c}')">
              <span class="asiento-cuenta" style="min-width:36px">${c}</span>
              <span style="font-size:12px;color:var(--t2)">${n}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:auto;opacity:.3"><path d="M9 18l6-6-6-6"/></svg>
            </div>`).join("")}
        </div>`;
      }).join("")}
    </div>`;
}

window._showMayor = (cuenta) => showMayorCuenta(cuenta);

/* ══════════════════════════
   ASIENTO MANUAL
══════════════════════════ */
export function showAsientoManualModal() {
  const cuentaOptions = Object.entries(PLAN_CUENTAS)
    .map(([c, n]) => `<option value="${c}">${c} — ${n}</option>`).join("");

  openModal(`
    <div class="modal" style="max-width:680px">
      <div class="modal-hd">
        <span class="modal-title">✏️ Asiento contable manual</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2">
          <div class="modal-field"><label>Fecha *</label><input type="date" id="am_fecha" class="ff-input" value="${new Date().toISOString().slice(0,10)}"/></div>
          <div class="modal-field"><label>Concepto *</label><input id="am_concepto" class="ff-input" placeholder="Descripción del asiento"/></div>
        </div>
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:var(--t3);margin:14px 0 8px">Líneas del asiento</div>
        <div id="am_lineas">
          ${[0,1].map(i => `
            <div style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;margin-bottom:8px;align-items:end">
              <div class="modal-field"><label>${i === 0 ? "Cuenta debe" : "Cuenta haber"}</label>
                <select class="ff-select am_cuenta" data-idx="${i}">
                  <option value="">— Seleccionar cuenta —</option>
                  ${cuentaOptions}
                </select>
              </div>
              <div class="modal-field"><label>Debe (€)</label><input type="number" class="ff-input am_debe" data-idx="${i}" value="" step="0.01" placeholder="0.00"/></div>
              <div class="modal-field"><label>Haber (€)</label><input type="number" class="ff-input am_haber" data-idx="${i}" value="" step="0.01" placeholder="0.00"/></div>
            </div>`).join("")}
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--t3);margin-top:8px">
          ℹ️ El asiento debe cuadrar: Total Debe = Total Haber
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="am_save">Guardar asiento</button>
      </div>
    </div>`);

  document.getElementById("am_save").addEventListener("click", async () => {
    const fecha    = document.getElementById("am_fecha").value;
    const concepto = document.getElementById("am_concepto").value.trim();
    if (!fecha || !concepto) { toast("Fecha y concepto son obligatorios", "error"); return; }

    const lineas = [];
    document.querySelectorAll(".am_cuenta").forEach((sel, i) => {
      const debe  = parseFloat(document.querySelectorAll(".am_debe")[i]?.value) || 0;
      const haber = parseFloat(document.querySelectorAll(".am_haber")[i]?.value) || 0;
      if (sel.value && (debe > 0 || haber > 0)) {
        lineas.push({ cuenta: sel.value, nombre: PLAN_CUENTAS[sel.value] || sel.value, debe, haber });
      }
    });

    const totalDebe  = lineas.reduce((a, l) => a + l.debe, 0);
    const totalHaber = lineas.reduce((a, l) => a + l.haber, 0);
    if (Math.abs(totalDebe - totalHaber) > 0.01) {
      toast(`El asiento no cuadra. Debe: ${fmt(totalDebe)} · Haber: ${fmt(totalHaber)}`, "error");
      return;
    }

    const { error } = await supabase.from("asientos_manuales").insert({
      user_id: SESSION.user.id,
      fecha, concepto,
      lineas: JSON.stringify(lineas),
      created_at: new Date().toISOString(),
    });
    if (error) { toast("Error guardando: " + error.message, "error"); return; }
    toast("Asiento guardado ✅", "success");
    closeModal();
    await refreshLibroDiario();
  });
}

/* ══════════════════════════
   INIT TABS
══════════════════════════ */
export function initContabilidadView() {
  // Tab switching
  document.querySelectorAll(".contab-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".contab-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      // Hide all panels
      ["diario","mayor","sumas-saldos","balance","pyg","plan"].forEach(p => {
        const el = document.getElementById(`ctabPanel_${p}`);
        if (el) el.style.display = "none";
      });

      const panelId = "ctabPanel_" + tab.dataset.ctab;
      const panel = document.getElementById(panelId);
      if (panel) { panel.style.display = ""; panel.style.removeProperty("display"); }

      // Lazy load per tab
      switch (tab.dataset.ctab) {
        case "diario":       await refreshLibroDiario(); break;
        case "sumas-saldos": await refreshSumasSaldos(); break;
        case "balance":      await refreshBalance(); break;
        case "pyg":          await refreshPyG(); break;
        case "plan":         renderPlanCuentas(); break;
      }
    });
  });

  document.getElementById("nuevoAsientoBtn")?.addEventListener("click", showAsientoManualModal);
  document.getElementById("contabExportBtn")?.addEventListener("click", exportContabilidadExcel);

  // Initial load — libro diario
  refreshLibroDiario();
}

/* ══════════════════════════
   EXPORT EXCEL CONTABILIDAD
══════════════════════════ */
async function exportContabilidadExcel() {
  if (!window.XLSX) { toast("SheetJS no disponible", "error"); return; }
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  const rows = [];
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      rows.push({
        "Nº Asiento":  `#${String(a.n).padStart(4,"0")}`,
        "Fecha":        a.fecha,
        "Concepto":     a.concepto,
        "Cuenta":       l.cuenta,
        "Descripción":  l.nombre,
        "Debe":         l.debe || "",
        "Haber":        l.haber || "",
      });
    });
    rows.push({ "Nº Asiento": "", "Fecha": "", "Concepto": "", "Cuenta": "", "Descripción": "", "Debe": "", "Haber": "" });
  });

  const ws = window.XLSX.utils.json_to_sheet(rows);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, `Diario ${trim} ${year}`);
  window.XLSX.writeFile(wb, `libro_diario_${year}_${trim}.xlsx`);
  toast("Libro diario exportado ✅", "success");
}
