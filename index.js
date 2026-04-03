/* ═══════════════════════════════════════════════════════════════════
   TAURIX · tax-engine/index.js
   API pública del Tax Engine — v1.1.0

   El resto de la aplicación importa SOLO desde aquí:
     import { calcModelo303, calcModelo130, generarAlertas } from './tax-engine/index.js'

   Nunca importar directamente de tax-iva.js, tax-irpf.js, etc.
   desde fuera de la carpeta tax-engine/.
   ═══════════════════════════════════════════════════════════════════ */

// ── Capa de datos ──────────────────────────────────────────────────
export {
  getTaxDocumentsTrim,
  getTaxDocumentsYear,
  getTaxDocumentsHastaTrim,
  getPerfilFiscal,
  getGastos,
  getResultadoGuardado,
  guardarResultado,
  getAlertasActivas,
  resolverAlerta,
  persistirAlertas,
} from "./tax-data.js";

// ── Motor IVA ─────────────────────────────────────────────────────
export {
  calcModelo303,
  calcProrrata,
  detectarProrrata,
  calcRegularizacionProrrata,
  calcModelo390,
  validateModelo303,
} from "./tax-iva.js";

// ── Motor IRPF ────────────────────────────────────────────────────
export {
  calcModelo130,
  calcPagosPrevios130,
  calcProyeccionAnual,
  calcSimuladorRenta,
  calcRetencionAplicable,
} from "./tax-irpf.js";

// ── Motor Gastos ──────────────────────────────────────────────────
export {
  inferirCategoria,
  clasificarGasto,
  clasificarGastos,
  resumenPorCategoria,
  totalDeducibilidad,
  calcAcumulado347,
  detectarProximosUmbral347,
  prepararModelo190,
  totalRetenciones190,
} from "./tax-gastos.js";

// ── Motor Alertas ─────────────────────────────────────────────────
export {
  generarAlertas,
  alertasPlazos,
  alertasIVA,
  alertasIRPF,
  alertas347,
  alertasRetenciones,
  alertasFacturacion,
  alertasReservaFiscal,
  alertasModelo349,
  serializarAlertasParaClaude,
} from "./tax-alerts.js";

// ── Reglas y constantes (solo las que necesita la UI) ─────────────
export {
  TIPOS_IVA,
  TABLAS_AMORTIZACION,
  GASTOS_DEDUCIBLES,
  TIPOS_OPERACION,
  UMBRAL_347,
  PLAZOS_TRIMESTRALES,
  TRIM_LABELS,
  TRIM_ORDEN,
  TRIM_RANGOS,
  trimAnteriores,
  getFechaRangoTrim,
  getFechaRangoAnual,
  AÑO_ACTIVO,
} from "./tax-rules.js";

// ── Versión del engine ────────────────────────────────────────────
export const TAX_ENGINE_VERSION = "1.1.0";
