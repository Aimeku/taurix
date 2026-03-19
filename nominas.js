/* ═══════════════════════════════════════════════════════
   TAURIX · nominas.js
   Módulo completo de nóminas: empleados, cálculo SS/IRPF,
   generación PDF, TC1/TC2, SEPA XML
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

export let EMPLEADOS = [];
export function setEmpleados(e) { EMPLEADOS = e; }

/* ══════════════════════════
   TABLAS SS 2025
══════════════════════════ */
const SS_TRAB = 0.0635;  // 4.7% CC + 1.55% desempleo + 0.1% FP + 0.1% FOGASA + mecanismo equidad
const SS_EMP  = 0.2980;  // 23.6% CC + 5.5% desempleo + 0.6% FP + ... empresa

const IRPF_TRAMOS = [
  { hasta: 12450,  tipo: 0.19 },
  { hasta: 20200,  tipo: 0.24 },
  { hasta: 35200,  tipo: 0.30 },
  { hasta: 60000,  tipo: 0.37 },
  { hasta: 300000, tipo: 0.45 },
  { hasta: Infinity, tipo: 0.47 },
];

/* ══════════════════════════
   CÁLCULO IRPF NÓMINA
══════════════════════════ */
export function calcIRPFNomina(salarioAnual, situacion = "soltero") {
  // Mínimo personal: 5.550€ general, +1.150 si <65 años
  const minPersonal = 5550;
  const reduccionTrabajo = salarioAnual <= 13115 ? 5565 : salarioAnual <= 16825 ? 5565 - 1.5 * (salarioAnual - 13115) : 1000;
  const baseIRPF = Math.max(0, salarioAnual - reduccionTrabajo);

  let cuota = 0;
  let base = baseIRPF - minPersonal;
  if (base <= 0) return 0;

  let anterior = 0;
  for (const tramo of IRPF_TRAMOS) {
    const enTramo = Math.min(base, tramo.hasta - anterior);
    if (enTramo <= 0) break;
    cuota += enTramo * tramo.tipo;
    anterior = tramo.hasta;
    if (base <= tramo.hasta) break;
  }
  // Retención mensual
  return Math.max(0, cuota / 12);
}

/* ══════════════════════════
   CÁLCULO NÓMINA COMPLETA
══════════════════════════ */
export function calcNomina(empleado, mes, anio) {
  const salarioBruto = empleado.salario_bruto_anual / 14; // 14 pagas si tiene 2 extras

  // Pagas extra en junio y diciembre
  const esExtraJunio = mes === 6;
  const esExtraDic   = mes === 12;
  const pagoMes = esExtraJunio || esExtraDic
    ? salarioBruto  // mes de paga extra
    : salarioBruto;

  // SS trabajador
  const ssTrabajador = pagoMes * SS_TRAB;
  // SS empresa
  const ssEmpresa = pagoMes * SS_EMP;
  // IRPF
  const irpfMensual = calcIRPFNomina(empleado.salario_bruto_anual, empleado.situacion_familiar);
  const irpfPct = empleado.salario_bruto_anual > 0
    ? ((irpfMensual / pagoMes) * 100).toFixed(1)
    : 0;

  const salarioNeto = pagoMes - ssTrabajador - irpfMensual;
  const costeTotalEmpresa = pagoMes + ssEmpresa;

  return {
    empleado_id: empleado.id,
    nombre: empleado.nombre,
    mes, anio,
    salario_bruto:       +pagoMes.toFixed(2),
    ss_trabajador:       +ssTrabajador.toFixed(2),
    ss_empresa:          +ssEmpresa.toFixed(2),
    irpf:                +irpfMensual.toFixed(2),
    irpf_pct:            +irpfPct,
    salario_neto:        +salarioNeto.toFixed(2),
    coste_empresa:       +costeTotalEmpresa.toFixed(2),
  };
}

/* ══════════════════════════
   LOAD
══════════════════════════ */
export async function loadEmpleados() {
  const { data, error } = await supabase.from("empleados")
    .select("*").eq("user_id", SESSION.user.id).order("nombre");
  if (error) { console.error("loadEmpleados:", error.message); return []; }
  return data || [];
}

export async function loadNominas(mes, anio) {
  const { data, error } = await supabase.from("nominas")
    .select("*").eq("user_id", SESSION.user.id).eq("mes", mes).eq("anio", anio);
  if (error) { console.error("loadNominas:", error.message); return []; }
  return data || [];
}

/* ══════════════════════════
   REFRESH EMPLEADOS VIEW
══════════════════════════ */
export async function refreshEmpleados() {
  const lista = await loadEmpleados();
  setEmpleados(lista);

  const countEl = document.getElementById("empleadosCount");
  if (countEl) countEl.textContent = `${lista.length} empleado${lista.length !== 1 ? "s" : ""} activos`;

  // KPIs
  const costeMes = lista.reduce((a, e) => a + (e.salario_bruto_anual / 14) * (1 + SS_EMP), 0);
  const irpfAcum = lista.reduce((a, e) => a + calcIRPFNomina(e.salario_bruto_anual), 0) * 12;
  const ssAcum   = lista.reduce((a, e) => a + (e.salario_bruto_anual / 14) * SS_TRAB * 14, 0);

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s("kpiEmpleados", lista.length);
  s("kpiCosteSalarial", fmt(costeMes));
  s("kpiIrpfNom", fmt(irpfAcum));
  s("kpiSSNom", fmt(ssAcum));

  // Grid de tarjetas
  const grid = document.getElementById("empleadosGrid");
  if (!grid) return;

  if (!lista.length) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--t3);grid-column:1/-1">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px;display:block;opacity:.3"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <p style="font-size:13px">No hay empleados registrados. Añade tu primer empleado.</p>
    </div>`;
    return;
  }

  const colores = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899"];
  grid.innerHTML = lista.map((e, i) => {
    const nomMes = calcNomina(e, new Date().getMonth() + 1, new Date().getFullYear());
    const iniciales = e.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    const color = colores[i % colores.length];
    return `
      <div class="empleado-card" onclick="window._verEmpleado('${e.id}')">
        <div class="empleado-avatar" style="background:${color}">${iniciales}</div>
        <div class="empleado-info">
          <div class="empleado-name">${e.nombre}</div>
          <div class="empleado-role">${e.puesto || "Sin puesto"} · ${e.departamento || "Sin dpto."}</div>
          <div style="font-size:12px;color:var(--t3);margin-bottom:6px">${e.tipo_contrato || "Contrato indefinido"}</div>
          <div class="empleado-meta">
            <span class="empleado-tag">💰 ${fmt(nomMes.salario_neto)}/mes</span>
            <span class="empleado-tag">🏢 ${fmt(nomMes.coste_empresa)}/mes coste</span>
            <span class="empleado-tag">${e.jornada || "Jornada completa"}</span>
          </div>
        </div>
        <div>
          <button class="ta-btn" onclick="event.stopPropagation();window._editEmpleado('${e.id}')">✏️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   REFRESH NÓMINAS VIEW
══════════════════════════ */
export async function refreshNominas() {
  const mes  = parseInt(document.getElementById("nominasMes")?.value  || new Date().getMonth() + 1);
  const anio = parseInt(document.getElementById("nominasAnio")?.value || new Date().getFullYear());

  if (!EMPLEADOS.length) {
    const body = document.getElementById("nominasBody");
    if (body) body.innerHTML = `<div style="text-align:center;padding:32px;color:var(--t3);font-size:13px">No hay empleados. Añade empleados para generar nóminas.</div>`;
    return;
  }

  // Cargar nóminas existentes del mes
  const nominasGuardadas = await loadNominas(mes, anio);
  const nominasMap = {};
  nominasGuardadas.forEach(n => { nominasMap[n.empleado_id] = n; });

  const body = document.getElementById("nominasBody");
  if (!body) return;

  let totalBruto = 0, totalSSTrab = 0, totalIRPF = 0, totalSSEmp = 0, totalNeto = 0;

  body.innerHTML = EMPLEADOS.map(e => {
    const calc = nominasMap[e.id] || calcNomina(e, mes, anio);
    const estado = nominasMap[e.id]?.estado || "pendiente";
    totalBruto  += calc.salario_bruto;
    totalSSTrab += calc.ss_trabajador;
    totalIRPF   += calc.irpf;
    totalSSEmp  += calc.ss_empresa;
    totalNeto   += calc.salario_neto;

    const estadoBadge = { pagada: "b-cobrada", calculada: "b-ic", pendiente: "b-pendiente" }[estado] || "b-pendiente";

    return `
      <div class="nomina-row" style="border-bottom:1px solid var(--brd)">
        <div style="padding:11px 14px">
          <div style="font-weight:600;font-size:13px">${e.nombre}</div>
          <div style="font-size:11px;color:var(--t3)">${e.puesto || ""} · IRPF ${calc.irpf_pct}%</div>
        </div>
        <div style="padding:11px 14px;font-family:monospace;font-weight:600">${fmt(calc.salario_bruto)}</div>
        <div style="padding:11px 14px;font-family:monospace;color:#dc2626">-${fmt(calc.ss_trabajador)}</div>
        <div style="padding:11px 14px;font-family:monospace;color:#dc2626">-${fmt(calc.irpf)}</div>
        <div style="padding:11px 14px;font-family:monospace;color:var(--t3);font-size:12px">${fmt(calc.ss_empresa)}</div>
        <div style="padding:11px 14px;font-family:monospace;font-weight:800;color:#059669">${fmt(calc.salario_neto)}</div>
        <div style="padding:8px 14px;display:flex;gap:6px;align-items:center">
          <span class="badge ${estadoBadge}" style="font-size:10px">${estado}</span>
          <button class="ta-btn" onclick="window._pdfNomina('${e.id}',${mes},${anio})" title="PDF nómina">📄</button>
          ${estado !== "pagada" ? `<button class="ta-btn ta-cobrada" onclick="window._marcarPagada('${e.id}',${mes},${anio})" title="Marcar pagada">✅</button>` : ""}
        </div>
      </div>`;
  }).join("");

  // Totales
  const st = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  st("nomTotalBruto",  fmt(totalBruto));
  st("nomTotalSSTrab", fmt(totalSSTrab));
  st("nomTotalIRPF",   fmt(totalIRPF));
  st("nomTotalSSEmp",  fmt(totalSSEmp));
  st("nomTotalNeto",   fmt(totalNeto));
}

/* ══════════════════════════
   GENERAR MES
══════════════════════════ */
export async function generarNominasMes() {
  const mes  = parseInt(document.getElementById("nominasMes")?.value  || new Date().getMonth() + 1);
  const anio = parseInt(document.getElementById("nominasAnio")?.value || new Date().getFullYear());

  if (!EMPLEADOS.length) {
    toast("Añade empleados primero", "error"); return;
  }

  const btn = document.getElementById("generarNominaBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }

  try {
    for (const e of EMPLEADOS) {
      const calc = calcNomina(e, mes, anio);
      const { data: existente } = await supabase.from("nominas")
        .select("id").eq("user_id", SESSION.user.id)
        .eq("empleado_id", e.id).eq("mes", mes).eq("anio", anio).single();

      if (existente) continue; // ya existe

      await supabase.from("nominas").insert({
        user_id: SESSION.user.id,
        empleado_id: e.id,
        nombre_empleado: e.nombre,
        mes, anio,
        salario_bruto:   calc.salario_bruto,
        ss_trabajador:   calc.ss_trabajador,
        ss_empresa:      calc.ss_empresa,
        irpf:            calc.irpf,
        irpf_pct:        calc.irpf_pct,
        salario_neto:    calc.salario_neto,
        coste_empresa:   calc.coste_empresa,
        estado:          "calculada",
        fecha:           new Date().toISOString().slice(0, 10),
      });
    }
    toast(`Nóminas de ${mes}/${anio} generadas ✅`, "success");
    await refreshNominas();
  } catch (e) {
    toast("Error generando nóminas: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generar nómina mes"; }
  }
}

/* ══════════════════════════
   MARCAR PAGADA
══════════════════════════ */
window._marcarPagada = async (empleadoId, mes, anio) => {
  const { error } = await supabase.from("nominas").update({ estado: "pagada" })
    .eq("user_id", SESSION.user.id).eq("empleado_id", empleadoId).eq("mes", mes).eq("anio", anio);
  if (error) { toast("Error: " + error.message, "error"); return; }
  toast("Nómina marcada como pagada ✅", "success");
  await refreshNominas();
};

/* ══════════════════════════
   PDF NÓMINA
══════════════════════════ */
window._pdfNomina = async (empleadoId, mes, anio) => {
  const e = EMPLEADOS.find(x => x.id === empleadoId);
  if (!e) return;
  const calc = calcNomina(e, mes, anio);

  // Cargar jsPDF
  if (!window.jspdf?.jsPDF) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const PW = 210, ML = 18, MR = 18, W = PW - ML - MR;

  const BLUE = [26, 86, 219], INK = [15, 23, 42], MUTED = [100, 116, 139];
  const LIGHT = [248, 250, 252], BORDER = [226, 232, 240];

  // Cabecera
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, PW, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16); doc.setTextColor(255, 255, 255);
  doc.text("NÓMINA", ML, 12);
  const mNombre = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][mes - 1];
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text(`${mNombre} ${anio}`, ML, 19);

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(255, 255, 255);
  doc.text(e.nombre, PW - MR, 13, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(e.puesto || "", PW - MR, 20, { align: "right" });

  let y = 40;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("DATOS DEL TRABAJADOR", ML, y);
  y += 6;
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 22, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  const col1 = ML + 4, col2 = ML + 80, col3 = ML + 150;
  y += 6;
  doc.text("NIF:", col1, y); doc.setTextColor(...INK); doc.text(e.nif || "—", col1 + 20, y);
  doc.setTextColor(...MUTED); doc.text("NSS:", col2, y); doc.setTextColor(...INK); doc.text(e.nss || "—", col2 + 20, y);
  doc.setTextColor(...MUTED); doc.text("Categoría:", col3 - 20, y); doc.setTextColor(...INK); doc.text(e.categoria || "—", col3 + 15, y);
  y += 7;
  doc.setTextColor(...MUTED); doc.text("Tipo contrato:", col1, y); doc.setTextColor(...INK); doc.text(e.tipo_contrato || "Indefinido", col1 + 32, y);
  doc.setTextColor(...MUTED); doc.text("Inicio:", col2, y); doc.setTextColor(...INK); doc.text(e.fecha_alta ? fmtDate(e.fecha_alta) : "—", col2 + 15, y);
  y += 7;
  doc.setTextColor(...MUTED); doc.text("CCC Empresa:", col1, y); doc.setTextColor(...INK); doc.text(e.ccc || "—", col1 + 30, y);

  // Devengos y deducciones
  y += 16;
  const colD = ML, colA = ML + 100, colI = ML + 140;

  // Devengos
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("DEVENGOS", colD, y);
  y += 5;
  doc.setDrawColor(...BORDER); doc.setLineWidth(0.5);
  doc.line(colD, y, colD + 85, y);
  y += 5;

  const devengos = [
    ["Salario base", calc.salario_bruto * 0.75],
    ["Complemento", calc.salario_bruto * 0.15],
    ["Antigüedad",  calc.salario_bruto * 0.05],
    ["Horas extras", calc.salario_bruto * 0.05],
  ];
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  devengos.forEach(([label, val]) => {
    doc.setTextColor(...INK); doc.text(label, colD, y);
    doc.setTextColor(...MUTED); doc.text(fmt(val), colA - 10, y, { align: "right" });
    y += 5.5;
  });
  y += 2;
  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text("TOTAL DEVENGADO", colD, y);
  doc.text(fmt(calc.salario_bruto), colA - 10, y, { align: "right" });

  // Deducciones
  const yD = 56;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text("DEDUCCIONES", colI, yD);
  let yd = yD + 5;
  doc.setDrawColor(...BORDER); doc.line(colI, yd, colI + 60, yd);
  yd += 5;

  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  const deducciones = [
    [`SS trabajador (${(SS_TRAB * 100).toFixed(2)}%)`, calc.ss_trabajador],
    [`IRPF (${calc.irpf_pct}%)`, calc.irpf],
  ];
  deducciones.forEach(([label, val]) => {
    doc.setTextColor(...INK); doc.text(label, colI, yd);
    doc.setTextColor("#dc2626"); doc.text("-" + fmt(val), PW - MR, yd, { align: "right" });
    yd += 5.5;
  });
  yd += 2;
  doc.setFont("helvetica", "bold"); doc.setTextColor(...INK);
  doc.text("TOTAL DEDUCCIONES", colI, yd);
  doc.setTextColor("#dc2626");
  doc.text("-" + fmt(calc.ss_trabajador + calc.irpf), PW - MR, yd, { align: "right" });

  // Líquido
  y = Math.max(y, yd) + 14;
  doc.setFillColor(...BLUE);
  doc.rect(ML, y, W, 14, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text("LÍQUIDO A PERCIBIR", ML + 4, y + 9);
  doc.setFontSize(14);
  doc.text(fmt(calc.salario_neto), PW - MR - 2, y + 9, { align: "right" });

  // Aportación empresa
  y += 22;
  doc.setFillColor(...LIGHT); doc.rect(ML, y, W, 12, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text("Cuota empresa SS:", ML + 4, y + 5);
  doc.setTextColor(...INK); doc.text(fmt(calc.ss_empresa), ML + 50, y + 5);
  doc.text("Coste total empresa:", ML + 90, y + 5);
  doc.setTextColor(...BLUE); doc.setFont("helvetica", "bold");
  doc.text(fmt(calc.coste_empresa), ML + 130, y + 5);
  doc.setTextColor(...MUTED); doc.setFont("helvetica", "normal");
  doc.text(`Período: ${mNombre} ${anio}`, ML + 4, y + 10);

  // Firma
  y += 24;
  doc.setDrawColor(...BORDER); doc.line(ML, y, ML + 70, y);
  doc.line(PW - MR - 70, y, PW - MR, y);
  doc.setFontSize(8); doc.setTextColor(...MUTED);
  doc.text("Firma empresa", ML + 20, y + 5);
  doc.text("Firma trabajador", PW - MR - 50, y + 5);

  // Footer
  doc.setFontSize(7);
  doc.text("Generado con Taurix · taurix.es · Documento sin valor legal sin firmas originales", PW / 2, 290, { align: "center" });

  doc.save(`nomina_${e.nombre.replace(/\s+/g, "_")}_${mes}_${anio}.pdf`);
  toast("Nómina descargada ✅", "success");
};

/* ══════════════════════════
   MODAL EMPLEADO
══════════════════════════ */
export function showEmpleadoModal(prefill = {}) {
  const isEdit = !!prefill.id;
  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">👤 ${isEdit ? "Editar" : "Nuevo"} empleado</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:10px">Datos personales</div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Nombre completo *</label><input autocomplete="off" id="em_nombre" class="ff-input" value="${prefill.nombre || ""}" placeholder="Nombre Apellido Apellido"/></div>
          <div class="modal-field"><label>NIF / NIE</label><input autocomplete="off" id="em_nif" class="ff-input" value="${prefill.nif || ""}" placeholder="12345678A"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Email</label><input autocomplete="off" type="email" id="em_email" class="ff-input" value="${prefill.email || ""}"/></div>
          <div class="modal-field"><label>Teléfono</label><input autocomplete="off" id="em_tel" class="ff-input" value="${prefill.telefono || ""}"/></div>
        </div>
        <div class="modal-field"><label>IBAN (para transferencia nómina)</label><input autocomplete="off" id="em_iban" class="ff-input" value="${prefill.iban || ""}" placeholder="ES00 0000 0000 0000 0000 0000"/></div>

        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin:16px 0 10px">Datos laborales</div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Puesto / Cargo</label><input autocomplete="off" id="em_puesto" class="ff-input" value="${prefill.puesto || ""}" placeholder="Desarrollador Senior"/></div>
          <div class="modal-field"><label>Departamento</label><input autocomplete="off" id="em_departamento" class="ff-input" value="${prefill.departamento || ""}" placeholder="Tecnología"/></div>
        </div>
        <div class="modal-grid3">
          <div class="modal-field"><label>Tipo de contrato</label>
            <select id="em_contrato" class="ff-select">
              ${["Indefinido", "Temporal", "Prácticas", "Formación", "Obra y servicio", "Interinidad", "A tiempo parcial"].map(t =>
                `<option ${(prefill.tipo_contrato || "Indefinido") === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Jornada</label>
            <select id="em_jornada" class="ff-select">
              <option ${(prefill.jornada || "Completa") === "Completa" ? "selected" : ""}>Completa</option>
              <option ${prefill.jornada === "Parcial 50%" ? "selected" : ""}>Parcial 50%</option>
              <option ${prefill.jornada === "Parcial 75%" ? "selected" : ""}>Parcial 75%</option>
              <option ${prefill.jornada === "Parcial 25%" ? "selected" : ""}>Parcial 25%</option>
            </select>
          </div>
          <div class="modal-field"><label>Situación familiar (IRPF)</label>
            <select id="em_situacion" class="ff-select">
              <option value="soltero"   ${(prefill.situacion_familiar || "soltero") === "soltero"   ? "selected" : ""}>Soltero/a sin hijos</option>
              <option value="casado"    ${prefill.situacion_familiar === "casado"    ? "selected" : ""}>Casado/a cónyuge activo</option>
              <option value="casado_p"  ${prefill.situacion_familiar === "casado_p"  ? "selected" : ""}>Casado/a cónyuge pensionista</option>
              <option value="hijos1"    ${prefill.situacion_familiar === "hijos1"    ? "selected" : ""}>Con 1 hijo a cargo</option>
              <option value="hijos2"    ${prefill.situacion_familiar === "hijos2"    ? "selected" : ""}>Con 2+ hijos a cargo</option>
            </select>
          </div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Salario bruto ANUAL (€) *</label>
            <input autocomplete="off" type="number" id="em_salario" class="ff-input" value="${prefill.salario_bruto_anual || ""}" step="0.01" placeholder="24000.00"/></div>
          <div class="modal-field"><label>Categoría profesional</label>
            <input autocomplete="off" id="em_categoria" class="ff-input" value="${prefill.categoria || ""}" placeholder="Grupo 1 / Titulado superior"/></div>
        </div>
        <div class="modal-grid2">
          <div class="modal-field"><label>Fecha de alta *</label><input autocomplete="off" type="date" id="em_alta" class="ff-input" value="${prefill.fecha_alta || ""}"/></div>
          <div class="modal-field"><label>Nº Afiliación SS (NAF)</label><input autocomplete="off" id="em_nss" class="ff-input" value="${prefill.nss || ""}" placeholder="28/0000000000/00"/></div>
        </div>
        <div class="modal-field"><label>CCC Empresa (Código Cuenta Cotización)</label>
          <input autocomplete="off" id="em_ccc" class="ff-input" value="${prefill.ccc || ""}" placeholder="28/000000000/00"/></div>

        <!-- Preview nómina estimada -->
        <div id="em_preview" style="background:var(--bg2);border-radius:10px;padding:14px;margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div><div style="font-size:11px;color:var(--t3);margin-bottom:2px">Bruto mensual</div><strong id="em_prev_bruto" style="font-size:16px">—</strong></div>
          <div><div style="font-size:11px;color:var(--t3);margin-bottom:2px">Neto estimado</div><strong id="em_prev_neto" style="font-size:16px;color:#059669">—</strong></div>
          <div><div style="font-size:11px;color:var(--t3);margin-bottom:2px">Coste empresa/mes</div><strong id="em_prev_coste" style="font-size:16px;color:#dc2626">—</strong></div>
        </div>
      </div>
      <div class="modal-ft">
        ${isEdit ? `<button class="btn-modal-danger" id="em_del" style="margin-right:auto">🗑️ Dar de baja</button>` : ""}
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="em_save">${isEdit ? "Actualizar empleado" : "Registrar empleado"}</button>
      </div>
    </div>
  `);

  // Preview en tiempo real
  const updatePreview = () => {
    const sal = parseFloat(document.getElementById("em_salario")?.value) || 0;
    if (!sal) return;
    const bruMes = sal / 14;
    const ssTr = bruMes * SS_TRAB;
    const irpf = calcIRPFNomina(sal);
    const neto = bruMes - ssTr - irpf;
    const coste = bruMes * (1 + SS_EMP);
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s("em_prev_bruto", fmt(bruMes));
    s("em_prev_neto",  fmt(neto));
    s("em_prev_coste", fmt(coste));
  };
  document.getElementById("em_salario")?.addEventListener("input", updatePreview);
  if (prefill.salario_bruto_anual) updatePreview();

  document.getElementById("em_save").addEventListener("click", async () => {
    const nombre  = document.getElementById("em_nombre").value.trim();
    const salario = parseFloat(document.getElementById("em_salario").value);
    const alta    = document.getElementById("em_alta").value;
    if (!nombre || isNaN(salario) || !alta) { toast("Nombre, salario y fecha de alta son obligatorios", "error"); return; }

    const payload = {
      user_id:              SESSION.user.id,
      nombre,
      nif:                  document.getElementById("em_nif").value.trim(),
      email:                document.getElementById("em_email").value.trim(),
      telefono:             document.getElementById("em_tel").value.trim(),
      iban:                 document.getElementById("em_iban").value.trim(),
      puesto:               document.getElementById("em_puesto").value.trim(),
      departamento:         document.getElementById("em_departamento").value.trim(),
      tipo_contrato:        document.getElementById("em_contrato").value,
      jornada:              document.getElementById("em_jornada").value,
      situacion_familiar:   document.getElementById("em_situacion").value,
      salario_bruto_anual:  salario,
      categoria:            document.getElementById("em_categoria").value.trim(),
      fecha_alta:           alta,
      nss:                  document.getElementById("em_nss").value.trim(),
      ccc:                  document.getElementById("em_ccc").value.trim(),
    };

    let err;
    if (isEdit) {
      ({ error: err } = await supabase.from("empleados").update(payload).eq("id", prefill.id));
    } else {
      ({ error: err } = await supabase.from("empleados").insert(payload));
    }
    if (err) { toast("Error: " + err.message, "error"); return; }
    toast(isEdit ? "Empleado actualizado ✅" : "Empleado registrado ✅", "success");
    closeModal();
    EMPLEADOS = await loadEmpleados();
    setEmpleados(EMPLEADOS);
    await refreshEmpleados();
    await refreshNominas();
  });

  if (isEdit) {
    document.getElementById("em_del")?.addEventListener("click", () => {
      openModal(`
        <div class="modal">
          <div class="modal-hd"><span class="modal-title">Baja de empleado</span><button class="modal-x" onclick="window._cm()">×</button></div>
          <div class="modal-bd">
            <div class="modal-field"><label>Fecha de baja *</label><input autocomplete="off" type="date" id="em_baja_fecha" class="ff-input" value="${new Date().toISOString().slice(0, 10)}"/></div>
            <div class="modal-field"><label>Causa de la baja</label>
              <select id="em_baja_causa" class="ff-select">
                ${["Despido procedente", "Despido improcedente", "Baja voluntaria", "Fin de contrato", "Jubilación", "Mutuo acuerdo", "Otro"].map(c => `<option>${c}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
            <button class="btn-modal-danger" id="em_baja_ok">Registrar baja</button>
          </div>
        </div>`);
      document.getElementById("em_baja_ok").addEventListener("click", async () => {
        const fecha = document.getElementById("em_baja_fecha").value;
        await supabase.from("empleados").update({ fecha_baja: fecha, activo: false }).eq("id", prefill.id);
        closeModal();
        toast("Baja registrada correctamente", "success");
        EMPLEADOS = await loadEmpleados(); setEmpleados(EMPLEADOS);
        await refreshEmpleados();
      });
    });
  }
}

window._verEmpleado  = (id) => { const e = EMPLEADOS.find(x => x.id === id); if (e) showEmpleadoModal(e); };
window._editEmpleado = (id) => { const e = EMPLEADOS.find(x => x.id === id); if (e) showEmpleadoModal(e); };

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initNominasView() {
  document.getElementById("nuevoEmpleadoBtn")?.addEventListener("click", () => showEmpleadoModal());
  document.getElementById("generarNominaBtn")?.addEventListener("click", generarNominasMes);
  document.getElementById("nominasMes")?.addEventListener("change", refreshNominas);
  document.getElementById("nominasAnio")?.addEventListener("change", refreshNominas);
  document.getElementById("nominasEstado")?.addEventListener("change", refreshNominas);
}
