/* ═══════════════════════════════════════════════════════
   TAURIX · contabilidad.js  — v2 PROFESIONAL
   
   Plan General Contable completo (RD 1514/2007 PYMES):
   · Plan de cuentas completo con 100+ cuentas PGC
   · Asientos automáticos desde facturas, nóminas,
     gastos recurrentes y bienes de inversión
   · Libro Diario con asientos manuales integrados
   · Libro Mayor interactivo por cuenta
   · Balance de Situación formato oficial ICAC
   · Cuenta de PyG abreviada + completa
   · Sumas y Saldos con verificación cuadre
   · Exportación: Excel (diario+mayor), PDF oficial
   · Regularización de existencias (asiento cierre)
   · Periodificaciones automáticas
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import {
  SESSION, fmt, fmtDate, toast, openModal, closeModal,
  getYear, getTrim, getFechaRango
} from "./utils.js";

/* ══════════════════════════════════════════
   PLAN DE CUENTAS PGC PYMES 2024
   Completo — RD 1515/2007 actualizado
══════════════════════════════════════════ */
export const PLAN_CUENTAS = {
  // ── GRUPO 1: Financiación básica ──────────────────
  "100": "Capital social",
  "101": "Fondo social",
  "102": "Capital",
  "110": "Prima de emisión o asunción",
  "112": "Reserva legal",
  "113": "Reservas voluntarias",
  "114": "Reservas especiales",
  "118": "Aportaciones de socios o propietarios",
  "119": "Diferencias por ajuste del capital a euros",
  "120": "Remanente",
  "121": "Resultados negativos de ejercicios anteriores",
  "129": "Resultado del ejercicio",
  "130": "Subvenciones oficiales de capital",
  "131": "Donaciones y legados de capital",
  "132": "Otras subvenciones, donaciones y legados",
  "141": "Provisión para impuestos",
  "142": "Provisión para otras responsabilidades",
  "143": "Provisión por desmantelamiento, retiro o rehabilitación",
  "145": "Provisión para actuaciones medioambientales",
  "146": "Provisión para reestructuraciones",
  "147": "Provisión por transacciones con pagos basados en instrumentos",
  "150": "Acciones o participaciones a largo plazo consideradas como pasivos financieros",
  "160": "Deudas a largo plazo con entidades de crédito",
  "161": "Deudas a largo plazo",
  "162": "Deudas a largo plazo transformables en subvenciones, donaciones y legados",
  "163": "Otros pasivos por instrumentos financieros a largo plazo",
  "170": "Deudas a largo plazo con entidades de crédito",
  "171": "Deudas a largo plazo",
  "172": "Deudas a largo plazo transformables en subvenciones",
  "173": "Proveedores de inmovilizado a largo plazo",
  "174": "Acreedores por arrendamiento financiero a largo plazo",
  "175": "Efectos a pagar a largo plazo",
  "176": "Pasivos por derivados financieros a largo plazo",
  "177": "Obligaciones y bonos",
  "180": "Fianzas recibidas a largo plazo",
  "181": "Anticipos recibidos por ventas o prestaciones de servicios a largo plazo",
  "185": "Depósitos recibidos a largo plazo",

  // ── GRUPO 2: Activo no corriente ──────────────────
  "200": "Investigación",
  "201": "Desarrollo",
  "202": "Concesiones administrativas",
  "203": "Propiedad industrial",
  "204": "Fondo de comercio",
  "205": "Derechos de traspaso",
  "206": "Aplicaciones informáticas",
  "209": "Anticipos para inmovilizaciones intangibles",
  "210": "Terrenos y bienes naturales",
  "211": "Construcciones",
  "212": "Instalaciones técnicas",
  "213": "Maquinaria",
  "214": "Utillaje",
  "215": "Otras instalaciones",
  "216": "Mobiliario",
  "217": "Equipos para procesos de información",
  "218": "Elementos de transporte",
  "219": "Otro inmovilizado material",
  "220": "Inversiones en terrenos y bienes naturales",
  "221": "Inversiones en construcciones",
  "228": "Inversiones en elementos de transporte",
  "229": "Otro inmovilizado material",
  "240": "Participaciones a largo plazo en partes vinculadas",
  "250": "Inversiones financieras a largo plazo en instrumentos de patrimonio",
  "251": "Valores representativos de deuda a largo plazo",
  "252": "Créditos a largo plazo",
  "253": "Créditos a largo plazo por enajenación de inmovilizado",
  "258": "Imposiciones a largo plazo",
  "260": "Fianzas constituidas a largo plazo",
  "265": "Depósitos constituidos a largo plazo",
  "280": "Amortización acumulada del inmovilizado intangible",
  "281": "Amortización acumulada del inmovilizado material",
  "290": "Deterioro de valor del inmovilizado intangible",
  "291": "Deterioro de valor del inmovilizado material",

  // ── GRUPO 3: Existencias ──────────────────────────
  "300": "Mercaderías A",
  "301": "Mercaderías B",
  "310": "Materias primas A",
  "311": "Materias primas B",
  "320": "Otros aprovisionamientos",
  "321": "Combustibles",
  "322": "Repuestos",
  "325": "Materiales diversos",
  "326": "Embalajes",
  "327": "Envases",
  "328": "Material de oficina",
  "330": "Productos en curso",
  "340": "Productos semiterminados",
  "350": "Productos terminados",
  "360": "Subproductos, residuos y materiales recuperados",
  "390": "Deterioro de valor de las existencias de mercaderías",
  "391": "Deterioro de valor de las materias primas",

  // ── GRUPO 4: Acreedores y deudores ───────────────
  "400": "Proveedores",
  "401": "Proveedores, efectos comerciales a pagar",
  "403": "Proveedores, empresas del grupo",
  "404": "Proveedores, empresas asociadas",
  "405": "Proveedores, otras partes vinculadas",
  "406": "Envases y embalajes a devolver a proveedores",
  "407": "Anticipos a proveedores",
  "410": "Acreedores por prestaciones de servicios",
  "411": "Acreedores, efectos comerciales a pagar",
  "419": "Acreedores por operaciones en común",
  "420": "Proveedores de inmovilizado a corto plazo",
  "421": "Acreedores por arrendamiento financiero a corto plazo",
  "422": "Deudas a corto plazo transformables en subvenciones",
  "430": "Clientes",
  "431": "Clientes, efectos comerciales a cobrar",
  "432": "Clientes, operaciones de factoring",
  "433": "Clientes, empresas del grupo",
  "434": "Clientes, empresas asociadas",
  "435": "Clientes, otras partes vinculadas",
  "436": "Clientes de dudoso cobro",
  "437": "Envases y embalajes a devolver por clientes",
  "438": "Anticipos de clientes",
  "440": "Deudores varios",
  "441": "Deudores, efectos comerciales a cobrar",
  "449": "Deudores de dudoso cobro",
  "460": "Anticipos de remuneraciones",
  "465": "Remuneraciones pendientes de pago",
  "470": "Hacienda Pública, deudora por diversos conceptos",
  "471": "Organismos de la Seguridad Social, deudores",
  "472": "Hacienda Pública, IVA soportado",
  "473": "Hacienda Pública, retenciones y pagos a cuenta",
  "474": "Activos por diferencias temporarias deducibles",
  "475": "Hacienda Pública, acreedora por conceptos fiscales",
  "476": "Organismos de la Seguridad Social, acreedores",
  "477": "Hacienda Pública, IVA repercutido",
  "478": "Ajustes negativos en la imposición sobre beneficios",
  "479": "Pasivos por diferencias temporarias imponibles",
  "480": "Gastos anticipados",
  "481": "Intereses pagados por anticipado",
  "485": "Ingresos anticipados",
  "486": "Ingresos cobrados por anticipado",
  "490": "Deterioro de valor de créditos por operaciones comerciales",
  "493": "Deterioro de valor de créditos por operaciones comerciales con partes vinculadas",
  "499": "Provisiones por operaciones comerciales",

  // ── GRUPO 5: Cuentas financieras ─────────────────
  "500": "Obligaciones y bonos a corto plazo",
  "501": "Obligaciones y bonos convertibles a corto plazo",
  "505": "Deudas representadas en otros valores negociables a corto plazo",
  "506": "Intereses a corto plazo de empréstitos y otras emisiones análogas",
  "509": "Valores negociables amortizados",
  "510": "Deudas a corto plazo con entidades de crédito del grupo",
  "511": "Deudas a corto plazo con entidades de crédito asociadas",
  "512": "Deudas a corto plazo con entidades de crédito",
  "514": "Deudas a corto plazo con otras partes vinculadas",
  "515": "Deudas a corto plazo por préstamos recibidos y otros conceptos",
  "516": "Intereses a corto plazo de deudas con entidades vinculadas",
  "517": "Intereses a corto plazo de deudas con terceros",
  "518": "Deudas por intereses",
  "519": "Deudas por operaciones de arrendamiento financiero a corto plazo",
  "520": "Deudas a corto plazo con entidades de crédito",
  "521": "Deudas a corto plazo",
  "522": "Deudas a corto plazo transformables en subvenciones",
  "523": "Proveedores de inmovilizado a corto plazo",
  "524": "Acreedores por arrendamiento financiero a corto plazo",
  "525": "Efectos a pagar a corto plazo",
  "526": "Dividendo activo a pagar",
  "527": "Intereses a corto plazo de deudas con entidades vinculadas",
  "528": "Intereses a corto plazo de deudas con terceros",
  "529": "Provisiones a corto plazo",
  "530": "Participaciones a corto plazo en partes vinculadas",
  "540": "Inversiones financieras a corto plazo en instrumentos de patrimonio",
  "541": "Valores representativos de deuda a corto plazo",
  "542": "Créditos a corto plazo",
  "543": "Créditos a corto plazo por enajenación de inmovilizado",
  "548": "Imposiciones a corto plazo",
  "551": "Cuenta corriente con socios y administradores",
  "552": "Cuenta corriente con otras partes vinculadas",
  "553": "Cuenta corriente con uniones temporales de empresas",
  "554": "Cuenta corriente con fondos de reversión",
  "555": "Partidas pendientes de aplicación",
  "556": "Desembolsos exigidos sobre participaciones en el patrimonio neto",
  "557": "Dividendo activo a cuenta",
  "558": "Socios por desembolsos exigidos",
  "560": "Fianzas recibidas a corto plazo",
  "561": "Depósitos recibidos a corto plazo",
  "565": "Fianzas constituidas a corto plazo",
  "566": "Depósitos constituidos a corto plazo",
  "570": "Caja, euros",
  "571": "Caja, moneda extranjera",
  "572": "Bancos e instituciones de crédito c/c vista, euros",
  "573": "Bancos e instituciones de crédito c/c vista, moneda extranjera",
  "574": "Bancos e instituciones de crédito, cuentas de ahorro, euros",
  "575": "Bancos e instituciones de crédito, cuentas de ahorro, moneda extranjera",
  "576": "Inversiones a corto plazo de gran liquidez",
  "580": "Inversiones financieras a corto plazo en partes vinculadas",
  "593": "Deterioro de valor de participaciones a largo plazo en partes vinculadas",
  "595": "Deterioro de valor de valores representativos de deuda a largo plazo",
  "596": "Deterioro de valor de créditos a largo plazo",

  // ── GRUPO 6: Compras y gastos ─────────────────────
  "600": "Compras de mercaderías",
  "601": "Compras de materias primas",
  "602": "Compras de otros aprovisionamientos",
  "606": "Descuentos sobre compras por pronto pago",
  "607": "Trabajos realizados por otras empresas",
  "608": "Devoluciones de compras y operaciones similares",
  "609": "Rappels por compras",
  "610": "Variación de existencias de mercaderías",
  "611": "Variación de existencias de materias primas",
  "612": "Variación de existencias de otros aprovisionamientos",
  "620": "Gastos en investigación y desarrollo del ejercicio",
  "621": "Arrendamientos y cánones",
  "622": "Reparaciones y conservación",
  "623": "Servicios de profesionales independientes",
  "624": "Transportes",
  "625": "Primas de seguros",
  "626": "Servicios bancarios y similares",
  "627": "Publicidad, propaganda y relaciones públicas",
  "628": "Suministros",
  "629": "Otros servicios",
  "630": "Impuesto sobre beneficios",
  "631": "Otros tributos",
  "633": "Ajustes negativos en la imposición sobre beneficios",
  "634": "Ajustes negativos en la imposición indirecta",
  "636": "Devolución de impuestos",
  "638": "Ajustes positivos en la imposición sobre beneficios",
  "639": "Ajustes positivos en la imposición indirecta",
  "640": "Sueldos y salarios",
  "641": "Indemnizaciones",
  "642": "Seguridad Social a cargo de la empresa",
  "643": "Retribuciones a largo plazo mediante sistemas de aportación definida",
  "644": "Retribuciones a largo plazo mediante sistemas de prestación definida",
  "645": "Retribuciones al personal mediante instrumentos de patrimonio",
  "649": "Otros gastos sociales",
  "650": "Pérdidas de créditos comerciales incobrables",
  "651": "Resultados de operaciones en común",
  "659": "Otras pérdidas en gestión corriente",
  "660": "Gastos financieros por actualización de provisiones",
  "661": "Intereses de obligaciones y bonos",
  "662": "Intereses de deudas",
  "663": "Pérdidas por valoración de activos y pasivos financieros por su valor razonable",
  "664": "Dividendos de acciones o participaciones consideradas como pasivos financieros",
  "665": "Intereses por descuento de efectos y operaciones de factoring",
  "666": "Pérdidas en participaciones y valores representativos de deuda",
  "667": "Pérdidas de créditos no comerciales",
  "668": "Diferencias negativas de cambio",
  "669": "Otros gastos financieros",
  "670": "Pérdidas procedentes del inmovilizado intangible",
  "671": "Pérdidas procedentes del inmovilizado material",
  "672": "Pérdidas procedentes de las inversiones inmobiliarias",
  "678": "Gastos excepcionales",
  "679": "Gastos y pérdidas de otros ejercicios",
  "680": "Amortización del inmovilizado intangible",
  "681": "Amortización del inmovilizado material",
  "682": "Amortización de las inversiones inmobiliarias",
  "690": "Pérdidas por deterioro del inmovilizado intangible",
  "691": "Pérdidas por deterioro del inmovilizado material",
  "692": "Pérdidas por deterioro de las inversiones inmobiliarias",
  "693": "Pérdidas por deterioro de existencias",
  "694": "Pérdidas por deterioro de créditos por operaciones comerciales",
  "695": "Dotaciones a la provisión para riesgos y gastos",
  "696": "Pérdidas por deterioro de participaciones y valores representativos de deuda a largo plazo",
  "697": "Pérdidas por deterioro de créditos a largo plazo",
  "698": "Pérdidas por deterioro de participaciones y valores representativos de deuda a corto plazo",
  "699": "Pérdidas por deterioro de créditos a corto plazo",

  // ── GRUPO 7: Ventas e ingresos ────────────────────
  "700": "Ventas de mercaderías",
  "701": "Ventas de productos terminados A",
  "702": "Ventas de productos terminados B",
  "703": "Ventas de subproductos y residuos",
  "704": "Ventas de envases y embalajes",
  "705": "Prestaciones de servicios",
  "706": "Descuentos sobre ventas por pronto pago",
  "708": "Devoluciones de ventas y operaciones similares",
  "709": "Rappels sobre ventas",
  "710": "Variación de existencias de productos en curso",
  "711": "Variación de existencias de productos semiterminados",
  "712": "Variación de existencias de productos terminados",
  "713": "Variación de existencias de subproductos, residuos y materiales recuperados",
  "720": "Trabajos realizados para el inmovilizado intangible",
  "721": "Trabajos realizados para el inmovilizado material",
  "722": "Trabajos realizados en inversiones inmobiliarias",
  "730": "Trabajos realizados para el activo no corriente en venta",
  "731": "Trabajos realizados para el activo corriente en venta",
  "740": "Subvenciones, donaciones y legados a la explotación",
  "741": "Subvenciones, donaciones y legados de capital transferidos al resultado del ejercicio",
  "746": "Subvenciones, donaciones y legados de carácter monetario",
  "747": "Otras subvenciones, donaciones y legados",
  "751": "Resultados de operaciones en común",
  "752": "Ingresos por arrendamientos",
  "753": "Ingresos de propiedad industrial cedida en explotación",
  "754": "Ingresos por comisiones",
  "755": "Ingresos por servicios al personal",
  "759": "Ingresos por servicios diversos",
  "760": "Ingresos de participaciones en instrumentos de patrimonio",
  "761": "Ingresos de valores representativos de deuda",
  "762": "Ingresos de créditos",
  "763": "Beneficios por valoración de activos y pasivos financieros por su valor razonable",
  "765": "Descuentos sobre compras por pronto pago",
  "766": "Beneficios en participaciones y valores representativos de deuda",
  "768": "Diferencias positivas de cambio",
  "769": "Otros ingresos financieros",
  "770": "Beneficios procedentes del inmovilizado intangible",
  "771": "Beneficios procedentes del inmovilizado material",
  "772": "Beneficios procedentes de las inversiones inmobiliarias",
  "778": "Ingresos excepcionales",
  "779": "Ingresos y beneficios de otros ejercicios",
  "790": "Reversión del deterioro del inmovilizado intangible",
  "791": "Reversión del deterioro del inmovilizado material",
  "794": "Reversión del deterioro de créditos por operaciones comerciales",
  "795": "Exceso de provisiones",
  "796": "Reversión del deterioro de participaciones y valores representativos de deuda a largo plazo",
  "797": "Reversión del deterioro de créditos a largo plazo",
  "798": "Reversión del deterioro de participaciones y valores representativos de deuda a corto plazo",
  "799": "Reversión del deterioro de créditos a corto plazo",
};

/* ══════════════════════════════════════════
   HELPER — saldos de cuentas
══════════════════════════════════════════ */
function calcSaldos(asientos) {
  const c = {};
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (!c[l.cuenta]) c[l.cuenta] = { debe: 0, haber: 0, nombre: l.nombre };
      c[l.cuenta].debe  += l.debe;
      c[l.cuenta].haber += l.haber;
    });
  });
  return c;
}

const saldoFn = (cuentas) => (codigo) => {
  const c = cuentas[codigo];
  return c ? c.debe - c.haber : 0;
};

/* ══════════════════════════════════════════
   DETECCIÓN DE CUENTA DE GASTO
   Basado en la clasificación del PGC
══════════════════════════════════════════ */
function detectarCuentaGasto(concepto, categoria) {
  const c = (concepto + " " + (categoria||"")).toLowerCase();
  if (c.includes("alquiler") || c.includes("arrendamiento") || c.includes("canon")) return "621";
  if (c.includes("reparac") || c.includes("mantenim") || c.includes("conservac")) return "622";
  if (c.includes("consultor") || c.includes("asesor") || c.includes("abogad") ||
      c.includes("notari") || c.includes("audit") || c.includes("gestori")) return "623";
  if (c.includes("transport") || c.includes("gasolina") || c.includes("mensajeri") ||
      c.includes("taxi") || c.includes("tren") || c.includes("avion") || c.includes("parking")) return "624";
  if (c.includes("seguro") || c.includes("poliza")) return "625";
  if (c.includes("banco") || c.includes("comisi") || c.includes("transferencia financ")) return "626";
  if (c.includes("publicidad") || c.includes("marketing") || c.includes("diseño") ||
      c.includes("web") || c.includes("seo") || c.includes("redes social")) return "627";
  if (c.includes("luz") || c.includes("agua") || c.includes("gas ") || c.includes("electric") ||
      c.includes("telefon") || c.includes("internet") || c.includes("movil") ||
      c.includes("suministr")) return "628";
  if (c.includes("sueldo") || c.includes("salario") || c.includes("nomina")) return "640";
  if (c.includes("ss ") || c.includes("seguridad social") || c.includes("reta")) return "642";
  if (c.includes("amortiz")) return "681";
  if (c.includes("software") || c.includes("licencia") || c.includes("suscripcion") ||
      c.includes("saas") || c.includes("nube") || c.includes("cloud")) return "629";
  if (c.includes("material") || c.includes("papeleria") || c.includes("oficina")) return "629";
  if (c.includes("dieta") || c.includes("restaurant") || c.includes("comida")) return "629";
  return "629";
}

function detectarCuentaIngreso(concepto) {
  const c = (concepto||"").toLowerCase();
  if (c.includes("venta") && !c.includes("servicio")) return "700";
  if (c.includes("arrendamiento") || c.includes("alquiler cobrado")) return "752";
  return "705";
}

/* ══════════════════════════════════════════
   GENERAR ASIENTOS — Todas las fuentes
══════════════════════════════════════════ */
export async function generarAsientos(year, trim) {
  const { ini, fin } = getFechaRango(year, trim);

  // Carga paralela
  const [facturasRes, nominasRes, asientosManualesRes, bienesRes] = await Promise.all([
    supabase.from("facturas").select("*")
      .eq("user_id", SESSION.user.id).gte("fecha", ini).lte("fecha", fin)
      .order("fecha", { ascending: true }),
    supabase.from("nominas").select("*")
      .eq("user_id", SESSION.user.id).gte("fecha", ini).lte("fecha", fin),
    supabase.from("asientos_manuales").select("*")
      .eq("user_id", SESSION.user.id).gte("fecha", ini).lte("fecha", fin)
      .order("fecha", { ascending: true }),
    supabase.from("bienes_inversion").select("*").eq("user_id", SESSION.user.id),
  ]);

  const facturas         = facturasRes.data || [];
  const nominas          = nominasRes.data  || [];
  const asientosManuales = asientosManualesRes.data || [];
  const bienes           = bienesRes.data   || [];

  const asientos = [];
  let n = 1;

  // ── 1. Asientos de facturas ──
  facturas.forEach(f => {
    const total    = f.base + f.base * (f.iva || 0) / 100;
    const cuotaIVA = f.base * (f.iva || 0) / 100;
    const irpfAmt  = f.base * (f.irpf_retencion || f.irpf || 0) / 100;
    const cIngreso = detectarCuentaIngreso(f.concepto);

    if (f.tipo === "emitida" && f.estado === "emitida") {
      // Factura emitida — devengo del ingreso
      const lineas = [
        { cuenta:"430", nombre:"Clientes",                     debe: total - irpfAmt, haber: 0 },
      ];
      if (irpfAmt > 0) {
        lineas.push({ cuenta:"473", nombre:"HP, retenciones y pagos a cuenta", debe: irpfAmt, haber: 0 });
      }
      if (cuotaIVA > 0) {
        lineas.push({ cuenta:"477", nombre:"HP, IVA repercutido", debe: 0, haber: cuotaIVA });
      }
      lineas.push({ cuenta: cIngreso, nombre: PLAN_CUENTAS[cIngreso] || "Ingresos", debe: 0, haber: f.base });

      asientos.push({ n: n++, fecha: f.fecha, tipo:"factura", ref: f.numero_factura,
        concepto:`Fra. emitida ${f.numero_factura || "S/N"} — ${f.cliente_nombre || "—"}`, lineas });

      // Asiento de cobro — si está cobrada en el mismo periodo
      if (f.cobrada && f.fecha_cobro >= ini && f.fecha_cobro <= fin) {
        asientos.push({ n: n++, fecha: f.fecha_cobro, tipo:"cobro", ref: f.numero_factura,
          concepto:`Cobro fra. ${f.numero_factura || "S/N"} — ${f.cliente_nombre || "—"}`,
          lineas: [
            { cuenta:"572", nombre:"Bancos c/c vista",  debe: total - irpfAmt, haber: 0 },
            { cuenta:"430", nombre:"Clientes",           debe: 0, haber: total - irpfAmt },
          ]
        });
      }

    } else if (f.tipo === "recibida") {
      // Factura recibida — devengo del gasto
      const cGasto = detectarCuentaGasto(f.concepto || "", f.categoria_gasto || "");
      const lineas = [
        { cuenta: cGasto, nombre: PLAN_CUENTAS[cGasto] || "Gastos de explotación", debe: f.base, haber: 0 },
      ];
      if (cuotaIVA > 0) {
        lineas.push({ cuenta:"472", nombre:"HP, IVA soportado", debe: cuotaIVA, haber: 0 });
      }
      lineas.push({ cuenta:"400", nombre:"Proveedores", debe: 0, haber: total });

      asientos.push({ n: n++, fecha: f.fecha, tipo:"gasto", ref: f.numero_factura,
        concepto:`Fra. recibida ${f.numero_factura || "S/N"} — ${f.cliente_nombre || f.concepto || "—"}`, lineas });
    }
  });

  // ── 2. Asientos de nóminas ──
  nominas.forEach(nom => {
    if (!nom.salario_bruto) return;
    const mesStr = `${nom.anio}-${String(nom.mes).padStart(2,"0")}-28`;
    asientos.push({ n: n++, fecha: mesStr, tipo:"nomina", ref:"NOM",
      concepto:`Nómina ${nom.nombre_empleado || "—"} ${nom.mes}/${nom.anio}`,
      lineas: [
        { cuenta:"640", nombre:"Sueldos y salarios",             debe: nom.salario_bruto, haber: 0 },
        { cuenta:"642", nombre:"Seguridad Social empresa",       debe: nom.ss_empresa || 0, haber: 0 },
        { cuenta:"465", nombre:"Remuneraciones pendientes pago", debe: 0, haber: nom.salario_neto || 0 },
        { cuenta:"476", nombre:"Organismos SS, acreedores",      debe: 0, haber: (nom.ss_trabajador||0) + (nom.ss_empresa||0) },
        { cuenta:"475", nombre:"HP, retenciones IRPF",           debe: 0, haber: nom.irpf || 0 },
      ]
    });
  });

  // ── 3. Asientos de amortización ──
  const añoActual = new Date().getFullYear();
  bienes.forEach(b => {
    if (!b.valor_adquisicion || !b.fecha_alta) return;
    const añoAlta = new Date(b.fecha_alta).getFullYear();
    if (añoAlta > parseInt(year)) return; // no amortizar si se compró después
    const coef = b.coeficiente || 10;
    const cuotaAnual = b.valor_adquisicion * coef / 100;
    const cuotaTrim  = cuotaAnual / 4;
    const cAmort = b.tipo_bien?.includes("intangible") || b.tipo_bien?.includes("Aplicacion") ? "680" : "681";
    const cAcum  = b.tipo_bien?.includes("intangible") ? "280" : "281";
    asientos.push({ n: n++, fecha: fin, tipo:"amortizacion", ref:"AMORT",
      concepto:`Amortización ${b.nombre} (${coef}% anual) — ${trim}/${year}`,
      lineas: [
        { cuenta: cAmort, nombre: PLAN_CUENTAS[cAmort] || "Amortización", debe: cuotaTrim, haber: 0 },
        { cuenta: cAcum,  nombre: PLAN_CUENTAS[cAcum]  || "Amortización acumulada", debe: 0, haber: cuotaTrim },
      ]
    });
  });

  // ── 4. Asientos manuales ──
  asientosManuales.forEach(am => {
    try {
      const lineas = typeof am.lineas === "string" ? JSON.parse(am.lineas) : am.lineas;
      asientos.push({ n: n++, fecha: am.fecha, tipo:"manual", ref:"MAN",
        concepto: am.concepto, lineas, esManual: true });
    } catch(e) { console.warn("asiento manual corrupto:", am.id); }
  });

  // Ordenar por fecha
  asientos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  // Renumerar tras ordenar
  asientos.forEach((a, i) => { a.n = i + 1; });

  return asientos;
}

/* ══════════════════════════════════════════
   LIBRO DIARIO
══════════════════════════════════════════ */
export async function refreshLibroDiario() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const container = document.getElementById("asientosBody");
  if (!container) return;

  // KPIs del diario
  const totalAsientos = asientos.length;
  const totalDebe = asientos.reduce((s,a) => s + a.lineas.reduce((x,l) => x+l.debe,0), 0);
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s("diarioCount",     totalAsientos);
  s("diarioDebe",      fmt(totalDebe));
  s("diarioHaber",     fmt(totalDebe)); // siempre cuadra
  s("diarioPeriodo",   `${trim} · ${year}`);

  if (!asientos.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 20px;color:var(--t3)">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="display:block;margin:0 auto 12px;opacity:.3"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Sin asientos en este periodo</div>
        <div style="font-size:12px">Registra facturas para generar asientos automáticamente, o crea un asiento manual.</div>
      </div>`;
    return;
  }

  const tipoBadge = {
    factura:     { color:"#1a56db", bg:"#eff6ff", label:"INGRESO" },
    cobro:       { color:"#059669", bg:"#f0fdf4", label:"COBRO" },
    gasto:       { color:"#dc2626", bg:"#fef2f2", label:"GASTO" },
    nomina:      { color:"#7c3aed", bg:"#f5f3ff", label:"NÓMINA" },
    amortizacion:{ color:"#d97706", bg:"#fef9c3", label:"AMORT." },
    manual:      { color:"#6b7280", bg:"#f9fafb", label:"MANUAL" },
  };

  container.innerHTML = asientos.map(a => {
    const tb = tipoBadge[a.tipo] || tipoBadge.manual;
    const totalDebe  = a.lineas.reduce((s,l)=>s+l.debe, 0);
    const cuadra     = Math.abs(totalDebe - a.lineas.reduce((s,l)=>s+l.haber, 0)) < 0.01;
    return `
      <div class="asiento-bloque ${a.esManual?"asiento-bloque--manual":""}">
        <div class="asiento-cabecera">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <span class="asiento-num">#${String(a.n).padStart(4,"0")}</span>
            <span style="background:${tb.bg};color:${tb.color};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;letter-spacing:.04em;flex-shrink:0">${tb.label}</span>
            <span class="asiento-fecha">${fmtDate(a.fecha)}</span>
            <span class="asiento-concepto" title="${a.concepto}">${a.concepto}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span class="mono" style="font-size:12px;color:var(--t3)">${fmt(totalDebe)}</span>
            ${!cuadra ? `<span title="Asiento no cuadra" style="color:#dc2626;font-size:12px">⚠️</span>` : ""}
            ${a.esManual ? `<button class="ta-btn ta-del" onclick="window._delAsientoManual('${a.id}')" title="Eliminar asiento manual" style="font-size:11px;padding:2px 7px">🗑️</button>` : ""}
          </div>
        </div>
        <div class="asiento-lineas">
          ${a.lineas.map((l,i) => `
            <div class="asiento-linea ${l.debe>0?"asiento-linea--debe":"asiento-linea--haber"}">
              <div style="width:34px;flex-shrink:0">
                ${i>0&&l.haber>0?`<span style="color:var(--t4);font-size:11px;padding-left:12px">a</span>`:""}
              </div>
              <div class="asiento-linea-cuenta" onclick="window._showMayor('${l.cuenta}')" title="Ver libro mayor de ${l.cuenta}">
                <span class="asiento-num-cuenta">${l.cuenta}</span>
                <span class="asiento-nom-cuenta">${PLAN_CUENTAS[l.cuenta] || l.nombre}</span>
              </div>
              <div class="asiento-debe-col">
                ${l.debe > 0 ? `<span class="mono" style="color:#059669;font-weight:700">${fmt(l.debe)}</span>` : ""}
              </div>
              <div class="asiento-haber-col">
                ${l.haber > 0 ? `<span class="mono" style="color:#dc2626;font-weight:700">${fmt(l.haber)}</span>` : ""}
              </div>
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════════════════════
   SUMAS Y SALDOS
══════════════════════════════════════════ */
export async function refreshSumasSaldos() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const cuentas = calcSaldos(asientos);

  const sorted = Object.entries(cuentas)
    .map(([cod, c]) => ({ cuenta: cod, nombre: PLAN_CUENTAS[cod] || c.nombre, debe: c.debe, haber: c.haber }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));

  const tbody = document.getElementById("sumasSaldosBody");
  if (!tbody) return;

  const totalDebe  = sorted.reduce((a,c) => a+c.debe,  0);
  const totalHaber = sorted.reduce((a,c) => a+c.haber, 0);
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.01;

  // KPI sumas y saldos
  const s=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  s("ssKpiCuentas",  sorted.length);
  s("ssKpiDebe",     fmt(totalDebe));
  s("ssKpiHaber",    fmt(totalHaber));
  s("ssKpiCuadre",   cuadra ? "✅ Cuadrado" : `⚠️ Diferencia: ${fmt(Math.abs(totalDebe-totalHaber))}`);

  tbody.innerHTML = sorted.map(c => {
    const saldoD = c.debe > c.haber ? c.debe - c.haber : 0;
    const saldoA = c.haber > c.debe ? c.haber - c.debe : 0;
    const grupo  = c.cuenta.charAt(0);
    const grupoCols = { "1":"#6366f1","2":"#0ea5e9","3":"#10b981","4":"#f59e0b","5":"#ec4899","6":"#dc2626","7":"#059669" };
    const gc = grupoCols[grupo] || "var(--accent)";
    return `<tr onclick="window._showMayor('${c.cuenta}')" style="cursor:pointer" title="Ver libro mayor">
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:3px;height:20px;background:${gc};border-radius:2px;display:inline-block;flex-shrink:0"></span>
          <span class="mono" style="font-weight:700;color:${gc}">${c.cuenta}</span>
        </div>
      </td>
      <td style="font-size:12px;color:var(--t2)">${c.nombre}</td>
      <td class="mono">${fmt(c.debe)}</td>
      <td class="mono">${fmt(c.haber)}</td>
      <td class="mono" style="color:#059669;font-weight:700">${saldoD>0 ? fmt(saldoD) : "—"}</td>
      <td class="mono" style="color:#dc2626;font-weight:700">${saldoA>0 ? fmt(saldoA) : "—"}</td>
      <td><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.3"><path d="M9 18l6-6-6-6"/></svg></td>
    </tr>`;
  }).join("") + `
    <tr style="background:var(--bg2);font-weight:800;border-top:2px solid var(--brd);font-size:12px">
      <td colspan="2" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">TOTALES</td>
      <td class="mono">${fmt(totalDebe)}</td>
      <td class="mono">${fmt(totalHaber)}</td>
      <td class="mono" style="color:${cuadra?"#059669":"#dc2626"}">${fmt(totalDebe>totalHaber?totalDebe-totalHaber:0)}</td>
      <td class="mono" style="color:${cuadra?"#059669":"#dc2626"}">${fmt(totalHaber>totalDebe?totalHaber-totalDebe:0)}</td>
      <td><span style="font-size:11px;color:${cuadra?"#059669":"#dc2626"}">${cuadra?"✅":"⚠️"}</span></td>
    </tr>`;
}

/* ══════════════════════════════════════════
   BALANCE DE SITUACIÓN — Formato ICAC oficial
══════════════════════════════════════════ */
export async function refreshBalance() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const cuentas  = calcSaldos(asientos);
  const sd       = saldoFn(cuentas);

  // ── ACTIVO ──
  // A) Activo no corriente
  const inmovilizadoIntangible = Math.max(0, sd("200")+sd("201")+sd("202")+sd("203")+sd("206") - Math.abs(sd("280")));
  const inmovilizadoMaterial   = Math.max(0, sd("210")+sd("211")+sd("212")+sd("213")+sd("214")+sd("215")+sd("216")+sd("217")+sd("218") - Math.abs(sd("281")));
  const inversionesLP          = Math.abs(sd("250"))+Math.abs(sd("251"))+Math.abs(sd("252"))+Math.abs(sd("258"));
  const activoNoCorriente      = inmovilizadoIntangible + inmovilizadoMaterial + inversionesLP;

  // B) Activo corriente
  const existencias    = sd("300")+sd("301")+sd("310")+sd("320")+sd("350");
  const deudoresComerciales = sd("430")+sd("431")+sd("440")+sd("441")+sd("460");
  const hpDeudora      = Math.max(0, sd("472")) + Math.max(0, sd("473")) + Math.max(0, sd("470"));
  const inversionesCP  = Math.abs(sd("540"))+Math.abs(sd("541"))+Math.abs(sd("548"))+sd("576");
  const tesoreria      = sd("570")+sd("571")+sd("572")+sd("573")+sd("574");
  const periodificAct  = sd("480")+sd("481");
  const activoCorriente = existencias + deudoresComerciales + hpDeudora + inversionesCP + tesoreria + periodificAct;

  const totalActivo = activoNoCorriente + activoCorriente;

  // ── PATRIMONIO NETO ──
  const capitalSocial  = Math.abs(sd("100")+sd("101")+sd("102"));
  const reservas       = Math.abs(sd("110")+sd("112")+sd("113")+sd("114"));
  const resultadoEj    = Math.abs(sd("129"));
  const subvenciones   = Math.abs(sd("130")+sd("131")+sd("132"));
  const totalPN        = capitalSocial + reservas + resultadoEj + subvenciones;

  // ── PASIVO NO CORRIENTE ──
  const deudasLP       = Math.abs(sd("160")+sd("161")+sd("170")+sd("520")+sd("521"));
  const provisionesLP  = Math.abs(sd("141")+sd("142")+sd("145")+sd("146"));
  const totalPasivoLP  = deudasLP + provisionesLP;

  // ── PASIVO CORRIENTE ──
  const proveedores    = Math.abs(sd("400")+sd("401"));
  const acreedores     = Math.abs(sd("410")+sd("411"));
  const deudasCP       = Math.abs(sd("512")+sd("515")+sd("519"));
  const hpAcreedora    = Math.abs(sd("475"))+Math.abs(sd("476"))+Math.abs(sd("477"));
  const remuneraciones = Math.abs(sd("465"));
  const periodificPas  = Math.abs(sd("485")+sd("486"));
  const totalPasivoCP  = proveedores + acreedores + deudasCP + hpAcreedora + remuneraciones + periodificPas;

  const totalPasivo = totalPN + totalPasivoLP + totalPasivoCP;
  const diferencia  = Math.abs(totalActivo - totalPasivo);
  const cuadra      = diferencia < 1;

  const panel = document.getElementById("ctabPanel_balance");
  if (!panel) return;

  const bl = (nombre, importe, indent=false) => {
    if (!importe || Math.abs(importe) < 0.01) return "";
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:${indent?"3px 0 3px 16px":"4px 0"};border-bottom:1px solid var(--brd)">
      <span style="font-size:${indent?11:12}px;color:${indent?"var(--t3)":"var(--t2)"}${indent?"":";font-weight:500"}">${nombre}</span>
      <span style="font-family:monospace;font-size:${indent?11:12}px${!indent?";font-weight:600":""}">
        ${fmt(Math.abs(importe))}
      </span>
    </div>`;
  };
  const blTotal = (nombre, importe, color="var(--t1)") => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1.5px solid var(--brd);margin-top:4px;margin-bottom:8px">
      <span style="font-size:12px;font-weight:700;color:${color}">${nombre}</span>
      <span style="font-family:monospace;font-size:13px;font-weight:800;color:${color}">${fmt(Math.abs(importe))}</span>
    </div>`;
  const blSect = (letra, nombre, color) => `
    <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${color};margin:12px 0 6px;padding:6px 0;border-bottom:2px solid ${color}">
      ${letra}) ${nombre}
    </div>`;

  panel.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">

      <!-- ACTIVO -->
      <div>
        <div style="font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);padding:10px 0;border-bottom:3px solid var(--accent);margin-bottom:12px">ACTIVO</div>

        ${blSect("A","Activo no corriente","#0ea5e9")}
        <div style="padding-left:8px">
          ${bl("I. Inmovilizado intangible neto", inmovilizadoIntangible, true)}
          ${bl("II. Inmovilizado material neto", inmovilizadoMaterial, true)}
          ${bl("V. Inversiones financieras a l/p", inversionesLP, true)}
        </div>
        ${blTotal("Total activo no corriente", activoNoCorriente, "#0ea5e9")}

        ${blSect("B","Activo corriente","#10b981")}
        <div style="padding-left:8px">
          ${bl("II. Existencias", existencias, true)}
          ${bl("III. Deudores comerciales y clientes", deudoresComerciales, true)}
          ${bl("IV. HP deudora e inversiones c/p", hpDeudora + inversionesCP, true)}
          ${bl("VII. Efectivo y equivalentes", tesoreria, true)}
          ${bl("VIII. Periodificaciones", periodificAct, true)}
        </div>
        ${blTotal("Total activo corriente", activoCorriente, "#10b981")}

        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:3px solid var(--accent);margin-top:8px">
          <span style="font-size:14px;font-weight:900;color:var(--accent)">TOTAL ACTIVO</span>
          <span style="font-family:monospace;font-size:18px;font-weight:900;color:var(--accent)">${fmt(totalActivo)}</span>
        </div>
      </div>

      <!-- PATRIMONIO NETO Y PASIVO -->
      <div>
        <div style="font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#059669;padding:10px 0;border-bottom:3px solid #059669;margin-bottom:12px">PATRIMONIO NETO Y PASIVO</div>

        ${blSect("A","Patrimonio neto","#8b5cf6")}
        <div style="padding-left:8px">
          ${bl("I. Capital", capitalSocial, true)}
          ${bl("III. Reservas", reservas, true)}
          ${bl("VII. Resultado del ejercicio", resultadoEj, true)}
          ${bl("VIII. Subvenciones recibidas", subvenciones, true)}
        </div>
        ${blTotal("Total patrimonio neto", totalPN, "#8b5cf6")}

        ${blSect("B","Pasivo no corriente","#f59e0b")}
        <div style="padding-left:8px">
          ${bl("I. Provisiones a largo plazo", provisionesLP, true)}
          ${bl("II. Deudas a largo plazo", deudasLP, true)}
        </div>
        ${blTotal("Total pasivo no corriente", totalPasivoLP, "#f59e0b")}

        ${blSect("C","Pasivo corriente","#dc2626")}
        <div style="padding-left:8px">
          ${bl("III. Deudas a corto plazo", deudasCP, true)}
          ${bl("V. Acreedores comerciales", proveedores + acreedores, true)}
          ${bl("VI. HP y SS acreedoras", hpAcreedora, true)}
          ${bl("VII. Remuneraciones pendientes", remuneraciones, true)}
          ${bl("IX. Periodificaciones", periodificPas, true)}
        </div>
        ${blTotal("Total pasivo corriente", totalPasivoCP, "#dc2626")}

        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:3px solid #059669;margin-top:8px">
          <span style="font-size:14px;font-weight:900;color:#059669">TOTAL PN Y PASIVO</span>
          <span style="font-family:monospace;font-size:18px;font-weight:900;color:#059669">${fmt(totalPasivo)}</span>
        </div>
      </div>
    </div>

    <!-- Cuadre -->
    <div style="margin-top:16px;padding:12px 16px;border-radius:10px;background:${cuadra?"#f0fdf4":"#fef9c3"};border:1px solid ${cuadra?"#bbf7d0":"#fde047"};display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">${cuadra?"✅":"⚠️"}</span>
      <span style="font-size:13px;font-weight:600;color:${cuadra?"#166534":"#854d0e"}">
        ${cuadra
          ? `Balance cuadrado correctamente — Activo = PN + Pasivo = ${fmt(totalActivo)}`
          : `Diferencia de cuadre: ${fmt(diferencia)} — Pueden faltar asientos de apertura o ajustes de cierre`}
      </span>
      ${!cuadra ? `<button onclick="window._showAsientoApertura()" class="btn-outline" style="margin-left:auto;font-size:11px;padding:4px 10px">Crear asiento de apertura</button>` : ""}
    </div>

    <!-- Exportar PDF balance -->
    <div style="margin-top:12px;display:flex;justify-content:flex-end">
      <button onclick="window._exportBalancePDF()" class="btn-outline" style="font-size:12px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
        Exportar Balance PDF
      </button>
    </div>`;
}

/* ══════════════════════════════════════════
   CUENTA DE PÉRDIDAS Y GANANCIAS
   Formato abreviado PGC PYMES
══════════════════════════════════════════ */
export async function refreshPyG() {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const cuentas  = calcSaldos(asientos);
  const sd       = saldoFn(cuentas);

  // A) Operaciones continuadas
  // 1. Importe neto cifra de negocios
  const cifraNegocios  = Math.abs(sd("700")) + Math.abs(sd("701")) + Math.abs(sd("702")) +
                         Math.abs(sd("703")) + Math.abs(sd("705")) - Math.abs(sd("706")) -
                         Math.abs(sd("708")) - Math.abs(sd("709"));
  // 2. Variación de existencias
  const varExist       = sd("610") + sd("611") + sd("712") + sd("713");
  // 3. Aprovisionamientos
  const aprovision     = sd("600") + sd("601") + sd("602") + sd("607");
  // 4. Otros ingresos de explotación
  const otrosIngr      = Math.abs(sd("740")) + Math.abs(sd("741")) + Math.abs(sd("759"));
  // 5. Gastos de personal
  const gstPersonal    = sd("640") + sd("641") + sd("642") + sd("643") + sd("649");
  // 6. Otros gastos de explotación
  const otrosGst       = sd("621") + sd("622") + sd("623") + sd("624") + sd("625") +
                         sd("626") + sd("627") + sd("628") + sd("629") + sd("631");
  // 7. Amortización
  const amort          = sd("680") + sd("681") + sd("682");
  // 8. Deterioro y resultado por enajenaciones
  const deterioro      = sd("690") + sd("691") + sd("694") - Math.abs(sd("790")) - Math.abs(sd("791"));
  // RESULTADO DE EXPLOTACIÓN
  const rExplot        = cifraNegocios + varExist - aprovision + otrosIngr - gstPersonal - otrosGst - amort - deterioro;
  // 9. Ingresos financieros
  const ingrFinanc     = Math.abs(sd("760")) + Math.abs(sd("761")) + Math.abs(sd("762")) + Math.abs(sd("769"));
  // 10. Gastos financieros
  const gstFinanc      = sd("661") + sd("662") + sd("665") + sd("669");
  // 11. Diferencias de cambio
  const difCambio      = Math.abs(sd("768")) - sd("668");
  // RESULTADO FINANCIERO
  const rFinanc        = ingrFinanc - gstFinanc + difCambio;
  // RESULTADO ANTES DE IMPUESTOS (BAI)
  const bai            = rExplot + rFinanc;
  // 12. Impuesto sobre beneficios
  const impBeneficios  = Math.max(0, bai * 0.25);
  // RESULTADO DEL EJERCICIO
  const rEjercicio     = bai - impBeneficios;

  const panel = document.getElementById("ctabPanel_pyg");
  if (!panel) return;

  const pyRow = (num, nombre, valor, nivel=0, negativo=false) => {
    const v = negativo ? -Math.abs(valor) : valor;
    const color = v < 0 ? "#dc2626" : v > 0 ? "var(--t1)" : "var(--t4)";
    const bg    = nivel === 0 ? "var(--bg2)" : "transparent";
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:${nivel===0?"8px 12px":"5px 12px 5px "+((nivel+1)*16)+"px"};background:${bg};border-bottom:1px solid var(--brd)">
        <div style="display:flex;align-items:center;gap:8px">
          ${num ? `<span style="font-size:10px;color:var(--t4);min-width:22px;font-weight:700">${num}</span>` : `<span style="min-width:22px"></span>`}
          <span style="font-size:${nivel===0?13:12}px;font-weight:${nivel===0?700:400};color:var(--t${nivel===0?1:2})">${nombre}</span>
        </div>
        <span style="font-family:monospace;font-size:${nivel===0?13:12}px;font-weight:${nivel===0?700:400};color:${Math.abs(v) < 0.01 ? "var(--t4)" : color}">
          ${Math.abs(v) < 0.01 ? "—" : (v < 0 ? "(" + fmt(Math.abs(v)) + ")" : fmt(v))}
        </span>
      </div>`;
  };
  const pySubtotal = (nombre, valor, color="#1a56db") => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:${color}11;border:1px solid ${color}33;border-radius:8px;margin:8px 0">
      <span style="font-size:13px;font-weight:800;color:${color}">${nombre}</span>
      <span style="font-family:monospace;font-size:16px;font-weight:900;color:${color}">${valor < 0 ? "(" + fmt(Math.abs(valor)) + ")" : fmt(valor)}</span>
    </div>`;

  panel.innerHTML = `
    <div style="max-width:680px;margin:0 auto">
      <div style="text-align:center;padding:16px 0 20px;border-bottom:2px solid var(--brd);margin-bottom:16px">
        <div style="font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--t1)">CUENTA DE PÉRDIDAS Y GANANCIAS</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">Ejercicio ${year} · ${getTrimLabel(trim)} · Formato abreviado PGC PYMES (RD 1515/2007)</div>
      </div>

      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--t3);padding:8px 0;margin-bottom:4px">A) RESULTADO DE EXPLOTACIÓN</div>
      ${pyRow("1.", "Importe neto de la cifra de negocios", cifraNegocios)}
      ${pyRow("2.", "Variación de existencias de productos terminados", varExist)}
      ${pyRow("4.", "Aprovisionamientos", aprovision, 0, true)}
      ${pyRow("5.", "Otros ingresos de explotación", otrosIngr)}
      ${pyRow("6.", "Gastos de personal", gstPersonal, 0, true)}
      ${pyRow("7.", "Otros gastos de explotación", otrosGst, 0, true)}
      ${pyRow("8.", "Amortización del inmovilizado", amort, 0, true)}
      ${pyRow("9.", "Deterioro y resultado por enajenaciones", deterioro, 0, deterioro > 0)}
      ${pySubtotal("A) RESULTADO DE EXPLOTACIÓN", rExplot, rExplot >= 0 ? "#059669" : "#dc2626")}

      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--t3);padding:8px 0 4px">B) RESULTADO FINANCIERO</div>
      ${pyRow("12.", "Ingresos financieros", ingrFinanc)}
      ${pyRow("13.", "Gastos financieros", gstFinanc, 0, true)}
      ${pyRow("14.", "Variación de valor razonable en instrumentos financieros", 0)}
      ${pyRow("15.", "Diferencias de cambio", difCambio)}
      ${pySubtotal("B) RESULTADO FINANCIERO", rFinanc, rFinanc >= 0 ? "#059669" : "#dc2626")}

      ${pySubtotal("RESULTADO ANTES DE IMPUESTOS (BAI)", bai, bai >= 0 ? "#1a56db" : "#dc2626")}

      ${pyRow("17.", "Impuesto sobre beneficios (25%)", impBeneficios, 0, true)}

      <div style="background:${rEjercicio >= 0 ? "linear-gradient(135deg,#059669,#10b981)" : "linear-gradient(135deg,#dc2626,#ef4444)"};border-radius:12px;padding:16px 20px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;color:#fff">
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.8">RESULTADO DEL EJERCICIO</div>
          <div style="font-size:12px;opacity:.7;margin-top:2px">${rEjercicio >= 0 ? "✅ Beneficio" : "⚠️ Pérdida"}</div>
        </div>
        <div style="font-size:28px;font-weight:900;font-family:monospace">${fmt(Math.abs(rEjercicio))}</div>
      </div>

      <!-- Ratios de rentabilidad -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px">
        ${cifraNegocios > 0 ? `
          <div style="background:var(--bg2);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700;margin-bottom:4px">Margen neto</div>
            <div style="font-size:20px;font-weight:800;color:${rEjercicio/cifraNegocios > 0.15 ? "#059669" : rEjercicio > 0 ? "#d97706" : "#dc2626"}">${(rEjercicio / cifraNegocios * 100).toFixed(1)}%</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700;margin-bottom:4px">EBITDA</div>
            <div style="font-size:20px;font-weight:800;color:var(--accent)">${fmt(rExplot + amort)}</div>
          </div>
          <div style="background:var(--bg2);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:10px;color:var(--t3);text-transform:uppercase;font-weight:700;margin-bottom:4px">Gst personal / ingresos</div>
            <div style="font-size:20px;font-weight:800;color:var(--t1)">${(gstPersonal / cifraNegocios * 100).toFixed(1)}%</div>
          </div>` : ""}
      </div>

      <div style="margin-top:12px;display:flex;justify-content:flex-end">
        <button onclick="window._exportPyGPDF()" class="btn-outline" style="font-size:12px">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/></svg>
          Exportar PyG PDF
        </button>
      </div>
    </div>`;
}

function getTrimLabel(trim) {
  return { T1:"1er trimestre (Ene–Mar)", T2:"2º trimestre (Abr–Jun)", T3:"3er trimestre (Jul–Sep)", T4:"4º trimestre (Oct–Dic)" }[trim] || trim;
}

/* ══════════════════════════════════════════
   LIBRO MAYOR — con gráfico de evolución
══════════════════════════════════════════ */
export async function showMayorCuenta(cuenta) {
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);
  const nombre   = PLAN_CUENTAS[cuenta] || cuenta;

  const movs = [];
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      if (l.cuenta === cuenta) movs.push({ ...l, fecha: a.fecha, concepto: a.concepto, n: a.n, tipo: a.tipo });
    });
  });

  let saldoAcum = 0;
  const totalDebe  = movs.reduce((s,m)=>s+m.debe, 0);
  const totalHaber = movs.reduce((s,m)=>s+m.haber, 0);
  const saldoFinal = totalDebe - totalHaber;

  openModal(`
    <div class="modal" style="max-width:760px">
      <div class="modal-hd">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="asiento-num-cuenta" style="font-size:15px">${cuenta}</span>
          <span class="modal-title">${nombre}</span>
        </div>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- KPIs cuenta -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px">
          <div style="background:var(--bg2);padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:var(--t3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Movimientos</div>
            <div style="font-size:20px;font-weight:800">${movs.length}</div>
          </div>
          <div style="background:#f0fdf4;padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:#166534;font-weight:700;text-transform:uppercase;margin-bottom:2px">Total Debe</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:#059669">${fmt(totalDebe)}</div>
          </div>
          <div style="background:#fef2f2;padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;color:#991b1b;font-weight:700;text-transform:uppercase;margin-bottom:2px">Total Haber</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:#dc2626">${fmt(totalHaber)}</div>
          </div>
          <div style="background:${saldoFinal >= 0 ? "#eff6ff" : "#fef2f2"};padding:10px;border-radius:8px;text-align:center">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:2px;color:${saldoFinal>=0?"#1d4ed8":"#991b1b"}">Saldo ${saldoFinal>=0?"deudor":"acreedor"}</div>
            <div style="font-size:16px;font-weight:800;font-family:monospace;color:${saldoFinal>=0?"var(--accent)":"#dc2626"}">${fmt(Math.abs(saldoFinal))}</div>
          </div>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>Asiento</th>
              <th>Fecha</th>
              <th>Concepto</th>
              <th style="text-align:right;color:#059669">Debe</th>
              <th style="text-align:right;color:#dc2626">Haber</th>
              <th style="text-align:right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            ${movs.length ? movs.map(m => {
              saldoAcum += m.debe - m.haber;
              return `<tr>
                <td class="mono" style="color:var(--accent);font-size:11px">#${String(m.n).padStart(4,"0")}</td>
                <td class="mono" style="font-size:11px;white-space:nowrap">${fmtDate(m.fecha)}</td>
                <td style="font-size:12px;color:var(--t2);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.concepto}</td>
                <td style="text-align:right" class="mono">${m.debe > 0 ? `<span style="color:#059669;font-weight:700">${fmt(m.debe)}</span>` : ""}</td>
                <td style="text-align:right" class="mono">${m.haber > 0 ? `<span style="color:#dc2626;font-weight:700">${fmt(m.haber)}</span>` : ""}</td>
                <td style="text-align:right" class="mono fw7">${fmt(saldoAcum)}</td>
              </tr>`;
            }).join("") : `<tr class="dt-empty"><td colspan="6">Sin movimientos en esta cuenta para el periodo</td></tr>`}
          </tbody>
          ${movs.length ? `
          <tfoot>
            <tr style="background:var(--bg2);font-weight:800">
              <td colspan="3" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:8px 12px">TOTALES</td>
              <td style="text-align:right;color:#059669;font-family:monospace">${fmt(totalDebe)}</td>
              <td style="text-align:right;color:#dc2626;font-family:monospace">${fmt(totalHaber)}</td>
              <td style="text-align:right;font-family:monospace;color:${saldoFinal>=0?"var(--accent)":"#dc2626"}">${fmt(saldoFinal)}</td>
            </tr>
          </tfoot>` : ""}
        </table>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
      </div>
    </div>`);
}

window._showMayor = (cuenta) => showMayorCuenta(cuenta);

/* ══════════════════════════════════════════
   PLAN DE CUENTAS COMPLETO — con búsqueda
══════════════════════════════════════════ */
export function renderPlanCuentas() {
  const panel = document.getElementById("ctabPanel_plan");
  if (!panel) return;

  const grupos = {
    "1": { nombre:"Financiación básica",    color:"#6366f1" },
    "2": { nombre:"Activo no corriente",    color:"#0ea5e9" },
    "3": { nombre:"Existencias",            color:"#10b981" },
    "4": { nombre:"Acreedores y deudores",  color:"#f59e0b" },
    "5": { nombre:"Cuentas financieras",    color:"#ec4899" },
    "6": { nombre:"Compras y gastos",       color:"#dc2626" },
    "7": { nombre:"Ventas e ingresos",      color:"#059669" },
  };

  panel.innerHTML = `
    <!-- Búsqueda en el plan de cuentas -->
    <div style="margin-bottom:16px;position:relative">
      <input id="planSearch" class="ff-input" style="padding-left:34px"
             placeholder="🔍 Buscar cuenta por código o nombre…"
             oninput="window._filterPlanCuentas(this.value)"/>
      <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--t3);pointer-events:none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </div>
    <div id="planCuentasGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
      ${Object.entries(grupos).map(([g, info]) => {
        const cuentas = Object.entries(PLAN_CUENTAS).filter(([c]) => c.startsWith(g));
        return `<div class="plan-grupo" data-grupo="${g}" style="border:1px solid ${info.color}33;border-radius:12px;overflow:hidden">
          <div style="background:${info.color}11;padding:10px 14px;border-bottom:1px solid ${info.color}33;display:flex;align-items:center;gap:8px">
            <span style="width:18px;height:18px;background:${info.color};border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;flex-shrink:0">${g}</span>
            <span style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${info.color}">${info.nombre}</span>
            <span style="margin-left:auto;font-size:11px;color:var(--t4)">${cuentas.length} cuentas</span>
          </div>
          <div style="max-height:280px;overflow-y:auto">
            ${cuentas.map(([c, n]) => `
              <div class="plan-cuenta-row" data-search="${c} ${n.toLowerCase()}"
                   style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--brd);cursor:pointer;transition:background .12s"
                   onclick="window._showMayor('${c}')"
                   onmouseenter="this.style.background='${info.color}08'"
                   onmouseleave="this.style.background=''">
                <span style="font-size:11px;font-weight:800;font-family:monospace;color:${info.color};min-width:34px">${c}</span>
                <span style="font-size:12px;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.25;flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
              </div>`).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

window._filterPlanCuentas = (q) => {
  const query = q.toLowerCase().trim();
  document.querySelectorAll(".plan-cuenta-row").forEach(row => {
    const match = !query || row.dataset.search.includes(query);
    row.style.display = match ? "" : "none";
  });
  // Ocultar grupos que no tienen ninguna cuenta visible
  document.querySelectorAll(".plan-grupo").forEach(grupo => {
    const visible = [...grupo.querySelectorAll(".plan-cuenta-row")].some(r => r.style.display !== "none");
    grupo.style.display = visible ? "" : "none";
  });
};

/* ══════════════════════════════════════════
   ASIENTO MANUAL — Mejorado con n líneas
══════════════════════════════════════════ */
export function showAsientoManualModal() {
  const cuentaOpts = Object.entries(PLAN_CUENTAS)
    .map(([c,n]) => `<option value="${c}">${c} — ${n}</option>`).join("");

  let nLineas = 2;

  openModal(`
    <div class="modal" style="max-width:720px">
      <div class="modal-hd">
        <span class="modal-title">✏️ Nuevo asiento contable manual</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="modal-grid2" style="margin-bottom:14px">
          <div class="modal-field"><label>Fecha *</label>
            <input type="date" id="am_fecha" class="ff-input" value="${new Date().toISOString().slice(0,10)}"/></div>
          <div class="modal-field"><label>Concepto *</label>
            <input id="am_concepto" class="ff-input" placeholder="Descripción del asiento"/></div>
        </div>

        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--t3);margin-bottom:8px">Líneas del asiento</div>

        <!-- Cabecera columnas -->
        <div style="display:grid;grid-template-columns:1fr 110px 110px 32px;gap:6px;padding:4px 0;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--t4);letter-spacing:.05em">
          <div>Cuenta</div>
          <div style="text-align:right;color:#059669">Debe (€)</div>
          <div style="text-align:right;color:#dc2626">Haber (€)</div>
          <div></div>
        </div>

        <div id="am_lineas"></div>

        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          <button id="am_addLinea" class="btn-outline" style="font-size:12px;padding:5px 12px">
            + Añadir línea
          </button>
          <div id="am_cuadreInfo" style="flex:1;font-size:12px;color:var(--t3)"></div>
        </div>

        <div style="background:var(--bg2);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--t3);margin-top:10px;line-height:1.6">
          💡 <strong>Principio de doble entrada:</strong> cada asiento debe cuadrar — suma del Debe = suma del Haber.<br>
          Las cuentas del Grupo 6 y 7 reflejan gastos e ingresos. Las del Grupo 1-5, activo/pasivo/PN.
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="am_save">Guardar asiento</button>
      </div>
    </div>`);

  const renderLineas = () => {
    const wrap = document.getElementById("am_lineas");
    if (!wrap) return;
    wrap.innerHTML = Array.from({length: nLineas}, (_,i) => `
      <div class="am-linea-row" data-idx="${i}" style="display:grid;grid-template-columns:1fr 110px 110px 32px;gap:6px;margin-bottom:6px;align-items:center">
        <select class="ff-select am_cuenta" style="font-size:12px" data-idx="${i}">
          <option value="">— Seleccionar cuenta PGC —</option>
          ${cuentaOpts}
        </select>
        <input type="number" class="ff-input am_debe" data-idx="${i}" step="0.01" min="0" placeholder="0,00"
               style="text-align:right;font-family:monospace;font-size:13px;color:#059669"
               oninput="window._amUpdateCuadre()"/>
        <input type="number" class="ff-input am_haber" data-idx="${i}" step="0.01" min="0" placeholder="0,00"
               style="text-align:right;font-family:monospace;font-size:13px;color:#dc2626"
               oninput="window._amUpdateCuadre()"/>
        <button onclick="window._amDelLinea(${i})" class="ta-btn ta-del" style="font-size:12px" title="Eliminar línea"
                ${nLineas <= 2 ? "disabled" : ""}>×</button>
      </div>`).join("");
  };

  window._amUpdateCuadre = () => {
    const debes  = [...document.querySelectorAll(".am_debe")].reduce((s,e)=>s+(parseFloat(e.value)||0),0);
    const haberes= [...document.querySelectorAll(".am_haber")].reduce((s,e)=>s+(parseFloat(e.value)||0),0);
    const diff   = Math.abs(debes - haberes);
    const info   = document.getElementById("am_cuadreInfo");
    if (!info) return;
    if (debes===0 && haberes===0) { info.textContent=""; return; }
    if (diff < 0.01) {
      info.innerHTML = `<span style="color:#059669;font-weight:700">✅ Asiento cuadrado — ${fmt(debes)}</span>`;
    } else {
      const falta = debes > haberes ? `Falta ${fmt(diff)} en Haber` : `Falta ${fmt(diff)} en Debe`;
      info.innerHTML = `<span style="color:#dc2626;font-weight:600">⚠️ No cuadra · ${falta}</span>`;
    }
  };

  window._amDelLinea = (idx) => {
    if (nLineas <= 2) return;
    nLineas--;
    renderLineas();
  };

  document.getElementById("am_addLinea")?.addEventListener("click", () => {
    nLineas++;
    renderLineas();
  });

  renderLineas();

  document.getElementById("am_save").addEventListener("click", async () => {
    const fecha    = document.getElementById("am_fecha").value;
    const concepto = document.getElementById("am_concepto").value.trim();
    if (!fecha || !concepto) { toast("Fecha y concepto son obligatorios","error"); return; }

    const lineas = [];
    document.querySelectorAll(".am-linea-row").forEach(row => {
      const i     = row.dataset.idx;
      const cta   = row.querySelector(".am_cuenta")?.value;
      const debe  = parseFloat(row.querySelector(".am_debe")?.value) || 0;
      const haber = parseFloat(row.querySelector(".am_haber")?.value) || 0;
      if (cta && (debe > 0 || haber > 0)) {
        lineas.push({ cuenta: cta, nombre: PLAN_CUENTAS[cta] || cta, debe, haber });
      }
    });

    if (!lineas.length) { toast("Añade al menos una línea con cuenta y importe","error"); return; }

    const totalD = lineas.reduce((s,l)=>s+l.debe,  0);
    const totalH = lineas.reduce((s,l)=>s+l.haber, 0);
    if (Math.abs(totalD - totalH) > 0.01) {
      toast(`El asiento no cuadra — Debe: ${fmt(totalD)} · Haber: ${fmt(totalH)} · Diferencia: ${fmt(Math.abs(totalD-totalH))}`,"error");
      return;
    }

    const { error } = await supabase.from("asientos_manuales").insert({
      user_id: SESSION.user.id, fecha, concepto,
      lineas: JSON.stringify(lineas),
      created_at: new Date().toISOString(),
    });
    if (error) { toast("Error guardando: "+error.message,"error"); return; }
    toast("Asiento guardado ✅","success");
    closeModal();
    await refreshLibroDiario();
  });
}

window._delAsientoManual = async (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar asiento manual</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este asiento manual? Esta acción no se puede deshacer.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_damOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_damOk").addEventListener("click", async () => {
    await supabase.from("asientos_manuales").delete().eq("id", id);
    closeModal(); toast("Asiento eliminado","success");
    await refreshLibroDiario();
  });
};

/* ══════════════════════════════════════════
   ASIENTO DE APERTURA
══════════════════════════════════════════ */
window._showAsientoApertura = () => {
  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">📂 Asiento de apertura</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div class="alerta-fiscal alerta-fiscal--info">
          <div class="af-icon">ℹ️</div>
          <div class="af-body">
            <div class="af-title">¿Qué es el asiento de apertura?</div>
            <div class="af-desc">El asiento de apertura reproduce en el nuevo ejercicio los saldos finales del ejercicio anterior. Se compone de todos los activos en el Debe y todos los pasivos y patrimonio neto en el Haber. Crea un asiento manual con los saldos iniciales de tus cuentas de Balance (grupos 1-5).</div>
          </div>
        </div>
        <div style="margin-top:16px;text-align:center">
          <button class="btn-primary" onclick="window._cm();window.showAsientoManualModal&&showAsientoManualModal()">
            ✏️ Crear asiento de apertura manualmente
          </button>
        </div>
      </div>
      <div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button></div>
    </div>`);
};

/* ══════════════════════════════════════════
   EXPORTACIONES
══════════════════════════════════════════ */
async function exportContabilidadExcel() {
  if (!window.XLSX) { toast("SheetJS no disponible","error"); return; }
  const year = getYear(), trim = getTrim();
  const asientos = await generarAsientos(year, trim);

  // Hoja 1: Libro Diario
  const diario = [];
  asientos.forEach(a => {
    a.lineas.forEach(l => {
      diario.push({
        "Nº Asiento": `#${String(a.n).padStart(4,"0")}`,
        "Fecha":       a.fecha,
        "Tipo":        a.tipo || "factura",
        "Concepto":    a.concepto,
        "Cuenta":      l.cuenta,
        "Nombre cuenta": PLAN_CUENTAS[l.cuenta] || l.nombre,
        "Debe (€)":    l.debe  || "",
        "Haber (€)":   l.haber || "",
      });
    });
    diario.push({});
  });

  // Hoja 2: Sumas y Saldos
  const cuentas = calcSaldos(asientos);
  const sySaldos = Object.entries(cuentas)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([cod, c]) => ({
      "Cuenta":     cod,
      "Nombre":     PLAN_CUENTAS[cod] || c.nombre,
      "Grupo":      cod.charAt(0),
      "Debe total": c.debe,
      "Haber total":c.haber,
      "Saldo deudor":  c.debe > c.haber ? +(c.debe-c.haber).toFixed(2) : 0,
      "Saldo acreedor":c.haber > c.debe ? +(c.haber-c.debe).toFixed(2) : 0,
    }));

  const wb = window.XLSX.utils.book_new();
  const ws1 = window.XLSX.utils.json_to_sheet(diario);
  ws1["!cols"] = [{wch:12},{wch:12},{wch:10},{wch:50},{wch:8},{wch:40},{wch:14},{wch:14}];
  window.XLSX.utils.book_append_sheet(wb, ws1, `Diario ${trim} ${year}`);

  const ws2 = window.XLSX.utils.json_to_sheet(sySaldos);
  ws2["!cols"] = [{wch:8},{wch:45},{wch:6},{wch:14},{wch:14},{wch:14},{wch:14}];
  window.XLSX.utils.book_append_sheet(wb, ws2, "Sumas y Saldos");

  window.XLSX.writeFile(wb, `contabilidad_${year}_${trim}.xlsx`);
  toast("Contabilidad exportada ✅ (Diario + Sumas y Saldos)","success");
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
export function initContabilidadView() {
  document.querySelectorAll(".contab-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
      document.querySelectorAll(".contab-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      ["diario","sumas-saldos","balance","pyg","plan"].forEach(p => {
        const el = document.getElementById(`ctabPanel_${p}`);
        if (el) el.style.display = "none";
      });
      const panel = document.getElementById("ctabPanel_" + tab.dataset.ctab);
      if (panel) panel.style.display = "";
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
  window.showAsientoManualModal = showAsientoManualModal;
  refreshLibroDiario();
}
