/* ═══════════════════════════════════════════════════════
   TAURIX · pdf-plantilla.js
   Motor PDF con soporte completo de plantillas de usuario.

   Uso:
     import { generarPDFConPlantilla } from "./pdf-plantilla.js";
     await generarPDFConPlantilla({ doc: facturaData, tipo: "factura", plantillaId });
     await generarPDFConPlantilla({ doc: presData,    tipo: "presupuesto", plantillaId });

   Cascada de plantilla:
     1. plantillaId explícito (pasado desde el formulario)
     2. plantilla marcada como es_default del usuario
     3. Diseño por defecto hardcoded (sin plantilla)
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, toast, fmt } from "./utils.js";

/* ── Cargar jsPDF si no está disponible ── */
async function _loadJsPDF() {
  if (window.jspdf?.jsPDF) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ── Cargar perfil fiscal del usuario ── */
async function _loadPerfil() {
  const { data } = await supabase
    .from("perfil_fiscal")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .maybeSingle();
  return data || {};
}

/* ── Cargar plantilla desde Supabase ──
   Orden: plantillaId → es_default → null
── */
async function _loadPlantilla(plantillaId) {
  // 1. Plantilla explícita
  if (plantillaId) {
    const { data } = await supabase
      .from("plantillas_usuario")
      .select("*")
      .eq("id", plantillaId)
      .eq("user_id", SESSION.user.id)
      .maybeSingle();
    if (data) return data;
  }
  // 2. Plantilla predeterminada
  const { data: def } = await supabase
    .from("plantillas_usuario")
    .select("*")
    .eq("user_id", SESSION.user.id)
    .eq("es_default", true)
    .maybeSingle();
  if (def) return def;
  // 3. Ninguna
  return null;
}

/* ── Normalizar cols_activas de la plantilla ──
   Soporta formato nuevo [{ key, width }] y legacy ["id", ...]
── */
function _parseCols(plantilla) {
  if (!plantilla?.cols_activas) return null;
  try {
    const raw = typeof plantilla.cols_activas === "string"
      ? JSON.parse(plantilla.cols_activas)
      : plantilla.cols_activas;
    if (!Array.isArray(raw) || !raw.length) return null;
    return raw.map(c => typeof c === "object" ? { key: c.key, width: c.width || null } : { key: c, width: null });
  } catch(e) { return null; }
}

/* ── Colores desde plantilla ── */
function _hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return [r,g,b];
}

function _plantillaColors(plt) {
  const get = (field, def) => {
    const v = plt?.[field];
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return _hexToRgb(v);
    return def;
  };
  return {
    cab:    get("color_cabecera",  [26,86,219]),
    txtCab: get("color_txt_cab",   [255,255,255]),
    acento: get("color_acento",    [26,86,219]),
    letra:  get("color_letra",     [15,23,42]),
    fondo:  get("color_fondo",     [255,255,255]),
    fdoTab: get("color_fondo_tab", [248,250,252]),
    lineas: get("color_lineas",    [226,232,240]),
  };
}

/* ── Fuente jsPDF desde nombre de plantilla ── */
function _fontName(plt) {
  const map = {
    "Helvetica":      "helvetica",
    "Arial":          "helvetica",
    "Times New Roman":"times",
    "Courier New":    "courier",
    "Georgia":        "times",
    "Trebuchet MS":   "helvetica",
    "Verdana":        "helvetica",
    "Garamond":       "times",
  };
  return map[plt?.fuente] || "helvetica";
}

/* ── Parser descuento de línea ──
   "10%" → porcentaje, "5" → importe fijo
── */
function _parseDescuento(raw, subtotal) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.endsWith("%")) return subtotal * (parseFloat(s) || 0) / 100;
  return parseFloat(s) || 0;
}

/* ── Cargar logo a base64 desde URL ── */
async function _logoToBase64(url) {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/* ══════════════════════════════════════════════════════
   FUNCIÓN PRINCIPAL: generarPDFConPlantilla
   ─ tipo: "factura" | "presupuesto"
   ─ doc:  objeto de la factura / presupuesto de Supabase
   ─ plantillaId: string UUID o null
   ─ descargar: boolean (default true)
══════════════════════════════════════════════════════ */
export async function generarPDFConPlantilla({ doc: docData, tipo, plantillaId = null, descargar = true }) {
  await _loadJsPDF();
  const { jsPDF } = window.jspdf;

  const perfil   = await _loadPerfil();
  const plantilla = await _loadPlantilla(plantillaId);
  const cols      = _parseCols(plantilla);
  const colores   = _plantillaColors(plantilla);
  const font      = _fontName(plantilla);

  // Parámetros de página y márgenes
  const ML  = plantilla?.margen   ?? 18;
  const MR  = plantilla?.margen   ?? 18;
  const PW  = 210, PH = 297;
  const W   = PW - ML - MR;
  const tamF = Math.max(7, Math.min(12, (plantilla?.tam_fuente ?? 9)));

  // Estilo de cabecera: "solido" | "gradiente" | "linea" | "sin"
  const estiloCab = plantilla?.estilo_cab || "solido";

  // Colores útiles fijos
  const BORDER = colores.lineas;
  const WHITE  = [255,255,255];
  const MUTED  = [100,116,139];

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Fondo del documento
  doc.setFillColor(...colores.fondo);
  doc.rect(0, 0, PW, PH, "F");

  // ── LOGO ──
  // Fuente: plantilla.logo_b64 > perfil.logo_url
  let logoB64 = plantilla?.logo_b64 || null;
  if (!logoB64 && perfil.logo_url) {
    logoB64 = await _logoToBase64(perfil.logo_url);
  }
  const mostrarLogo = plantilla ? (plantilla.mostrar_logo !== false) : true;

  /* ── Sistema de coordenadas IDÉNTICO al preview HTML ──────────────────────
     El preview usa un div de ~420px de ancho sobre A4 (595pt = 210mm).
     SCALE_PREV = pvW / 595  (preview usa pvW ≈ 420px)

     Para el PDF usamos la misma lógica pero en mm:
       A4 width = 210 mm  →  equivale a 595 pt en jsPDF
       PX_PER_MM = 595 / 210 ≈ 2.835

     Conversión slider → mm en PDF:
       logoSize (slider 16–80 px en preview) → en mm: logoSize / PX_PER_MM
         porque en preview maxHeight = logoSize * SCALE px,
         y 1 mm en PDF = PX_PER_MM px en preview con la misma escala.

       logoY  (slider 0..60) → topY_mm = logoY / PX_PER_MM
         en preview: topPx = Math.max(0, Math.min(55, logoY * SCALE))
         en PDF:     topY  = Math.max(0, Math.min(55/PX_PER_MM, logoY / PX_PER_MM))

       logoX  (slider -120..120) → offsetX_mm = logoX * (PW / 240)
         en preview: offsetPx = logoX * (pvW / 240)
         en PDF:     offsetX  = logoX * (PW  / 240)   [misma proporción en mm]

     Posición base: logo centrado horizontalmente en el documento (PW/2).
     X=0 → centro. X>0 → derecha. X<0 → izquierda.
     El logo se ancla en su centro horizontal (translate -logoW/2).
  ─────────────────────────────────────────────────────────────────────────── */

  const PX_PER_MM  = 595 / 210;                       // puntos jsPDF por mm A4

  // Valores del slider desde la plantilla
  const logoSizePx = plantilla?.logo_size ?? 30;      // px en el slider (= px en preview a escala 1:1)
  const logoXSlider = plantilla?.logo_x   ?? 0;       // slider -120..120
  const logoYSlider = plantilla?.logo_y   ?? 8;       // slider 0..60

  // Convertir a mm para el PDF
  const logoH_mm   = Math.max(2, logoSizePx / PX_PER_MM);            // altura en mm
  const logoW_mm   = logoH_mm * 3;                                    // ancho máximo (ratio 3:1)
  const logoOffX   = logoXSlider * (PW / 240);                        // offset X en mm desde el centro
  const logoOffY   = Math.max(0, Math.min(55 / PX_PER_MM, logoYSlider / PX_PER_MM)); // Y desde top de cabecera

  // Posición final: centro del documento + offset, anclado en el centro del logo
  const logoCX     = PW / 2 + logoOffX;               // centro X del logo en mm
  const logoLeft   = Math.max(ML, Math.min(PW - MR - logoW_mm, logoCX - logoW_mm / 2));
  const logoTop    = logoOffY;                         // Y desde el borde superior del documento

  let logoOk = false;
  if (mostrarLogo && logoB64) {
    try {
      const mime = logoB64.split(";")[0].split(":")[1] || "image/png";
      const ext  = mime.includes("png") ? "PNG" : "JPEG";
      // addImage(data, format, x, y, w, h)
      // x e y en mm, w y h en mm — usa logoLeft/logoTop + tamaño calculado
      doc.addImage(logoB64, ext, logoLeft, logoTop, logoW_mm, logoH_mm, "", "FAST");
      logoOk = true;
    } catch(e) { console.warn("Logo PDF error:", e.message); }
  }

  // ── CABECERA ──
  // La cabecera empieza justo debajo del logo (si existe) o en posición fija.
  // En el preview la cabecera tiene padding-top implícito por el logo; aquí la ponemos
  // exactamente donde termina el logo + un pequeño espacio.
  const tipoLabel = tipo === "factura" ? "FACTURA" : "PRESUPUESTO";
  const numero    = docData.numero_factura || docData.numero || "BORRADOR";
  const fecha     = docData.fecha;
  const fmtFecha  = d => { if(!d)return"—"; const [yr,mo,dy]=d.split("-"); return `${dy}/${mo}/${yr}`; };

  // CAB_TOP: si hay logo, la cabecera empieza DESPUÉS del logo (logo está encima/solapado).
  // Replicamos el comportamiento del preview: logo es position:absolute sobre la cabecera.
  // Entonces: cabecera empieza en un punto fijo, logo se superpone encima.
  const CAB_TOP = 6;   // la cabecera siempre empieza a 6mm del borde superior
  const cabH    = logoOk
    ? Math.max(18, logoH_mm + logoOffY + 4)  // cabecera lo suficientemente alta para contener el logo
    : 18;

  if (estiloCab !== "sin") {
    if (estiloCab === "solido" || estiloCab === "gradiente") {
      doc.setFillColor(...colores.cab);
      doc.rect(ML, CAB_TOP, W, cabH, "F");
    } else if (estiloCab === "linea") {
      doc.setDrawColor(...colores.cab);
      doc.setLineWidth(1);
      doc.line(ML, CAB_TOP + cabH, PW - MR, CAB_TOP + cabH);
    }

    // Texto cabecera — queda a la izquierda, el logo flota a la derecha
    const txtColor = estiloCab === "linea" ? colores.letra : colores.txtCab;
    // Padding derecho proporcional al logo para evitar solapamiento
    const textMaxX = logoOk ? Math.min(ML + W * 0.55, logoLeft - 4) : PW - MR - 4;

    doc.setFont(font, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...txtColor);
    const tipoTxt = doc.splitTextToSize(tipoLabel, textMaxX - ML - 4);
    doc.text(tipoTxt, ML + 4, CAB_TOP + 6);
    doc.setFontSize(tamF + 3);
    doc.text(numero.substring(0, 30), ML + 4, CAB_TOP + 12);
    doc.setFont(font, "normal");
    doc.setFontSize(7.5);
    doc.text(fmtFecha(fecha), PW - MR - 2, CAB_TOP + 7, { align: "right" });
    if (docData.fecha_validez) {
      doc.setFontSize(7);
      doc.text("Válido hasta: " + fmtFecha(docData.fecha_validez), PW - MR - 2, CAB_TOP + 12, { align: "right" });
    }

    // Redibujar logo ENCIMA de la cabecera (z-order en jsPDF: último dibujado = encima)
    if (logoOk && logoB64) {
      try {
        const mime = logoB64.split(";")[0].split(":")[1] || "image/png";
        const ext  = mime.includes("png") ? "PNG" : "JPEG";
        doc.addImage(logoB64, ext, logoLeft, logoTop, logoW_mm, logoH_mm, "", "FAST");
      } catch(e) {}
    }
  } else {
    // Sin cabecera: solo texto plano
    doc.setFont(font, "bold");
    doc.setFontSize(20);
    doc.setTextColor(...colores.letra);
    doc.text(tipoLabel, ML, CAB_TOP + 10);
    doc.setFontSize(11);
    doc.text(numero, ML, CAB_TOP + 17);
  }

  let y = CAB_TOP + cabH + 8;

  // ── EMISOR / CLIENTE ──
  // Posiciones con offsets de la plantilla
  const emisorX = ML + (plantilla?.emisor_x ?? 0);
  const emisorY = y + (plantilla?.emisor_y ?? 0);
  const clienteX = PW / 2 + 6 + (plantilla?.cliente_x ?? 0);
  const clienteY = y + (plantilla?.cliente_y ?? 0);
  const cW = W / 2 - 12;

  const mostrarEmisor = plantilla ? (plantilla.mostrar_emisor !== false) : true;

  if (mostrarEmisor) {
    doc.setFont(font, "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text("DE / FROM", emisorX, emisorY);
    doc.text(tipo === "factura" ? "FACTURAR A / BILL TO" : "PARA / TO", clienteX, clienteY);

    let ey = emisorY + 5;
    doc.setFont(font, "bold");
    doc.setFontSize(tamF + 1);
    doc.setTextColor(...colores.letra);
    doc.text((perfil.nombre_razon_social || "—").substring(0, 32), emisorX, ey); ey += 5.5;
    doc.setFont(font, "normal");
    doc.setFontSize(tamF);
    doc.setTextColor(...MUTED);
    if (perfil.nif)             { doc.text("NIF: " + perfil.nif, emisorX, ey); ey += 4.5; }
    if (perfil.domicilio_fiscal){ const ls = doc.splitTextToSize(perfil.domicilio_fiscal, cW); doc.text(ls, emisorX, ey); ey += ls.length * 4.5; }

    let cy = clienteY + 5;
    doc.setFont(font, "bold");
    doc.setFontSize(tamF + 1);
    doc.setTextColor(...colores.letra);
    doc.text((docData.cliente_nombre || "—").substring(0, 32), clienteX, cy); cy += 5.5;
    doc.setFont(font, "normal");
    doc.setFontSize(tamF);
    doc.setTextColor(...MUTED);
    if (docData.cliente_nif)       { doc.text("NIF: " + docData.cliente_nif, clienteX, cy); cy += 4.5; }
    if (docData.cliente_direccion) { const ls = doc.splitTextToSize(docData.cliente_direccion, cW); doc.text(ls, clienteX, cy); cy += ls.length * 4.5; }
    if (docData.forma_pago)        { doc.text("Forma pago: " + docData.forma_pago, clienteX, cy); cy += 4.5; }

    y = Math.max(ey, cy) + 8;
  }

  // Línea divisora
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.line(ML, y, PW - MR, y);
  y += 6;

  // Concepto (para presupuesto)
  if (docData.concepto && tipo === "presupuesto") {
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.setTextColor(...colores.letra);
    doc.text(docData.concepto.substring(0, 60), ML, y);
    y += 8;
  }

  // ── TABLA DE LÍNEAS ──
  // Columnas: si la plantilla define cols_activas, usarlas; si no, usar columnas por defecto
  const DEFAULT_COLS = [
    { key: "descripcion", label: "Descripción",  width: null },
    { key: "cantidad",    label: "Cant.",         width: null },
    { key: "precio",      label: "P. unit.",      width: null },
    { key: "iva",         label: "IVA",           width: null },
    { key: "total",       label: "Total",         width: null },
  ];

  const COL_LABELS = {
    descripcion: "Descripción",  cantidad: "Cant.",   precio: "P. unit.",
    subtotal:    "Subtotal",     iva:      "IVA",     total:  "Total",
    descuento:   "Descuento",   codigo:   "Código",  coeficiente: "Coef.",
  };

  const activeCols = cols || DEFAULT_COLS;

  // Calcular anchos reales en mm
  // Las columnas con width definido reciben ese % del ancho total
  // Las demás se reparten el espacio restante
  const totalPct  = activeCols.reduce((s, c) => s + (c.width || 0), 0);
  const pctUsed   = Math.min(100, totalPct);
  const mmPerPct  = W / 100;
  const nAuto     = activeCols.filter(c => !c.width).length;
  const mmAuto    = nAuto > 0 ? (W - pctUsed * mmPerPct) / nAuto : 0;
  const colWidths = activeCols.map(c => c.width ? c.width * mmPerPct : mmAuto);

  // Asegurarse de que la columna descripción tenga un mínimo razonable
  const descIdx = activeCols.findIndex(c => c.key === "descripcion");
  const minDesc = 40;
  if (descIdx !== -1 && colWidths[descIdx] < minDesc) {
    const surplus = minDesc - colWidths[descIdx];
    colWidths[descIdx] = minDesc;
    // Reducir de otras columnas proporcionalmente
    const others = colWidths.filter((_, i) => i !== descIdx && colWidths[i] > 8);
    if (others.length > 0) {
      const reduce = surplus / others.length;
      colWidths.forEach((_, i) => { if (i !== descIdx) colWidths[i] = Math.max(8, colWidths[i] - reduce); });
    }
  }

  // Calcular posiciones X de cada columna
  const colX = [ML];
  for (let i = 1; i < activeCols.length; i++) {
    colX.push(colX[i - 1] + colWidths[i - 1]);
  }

  // Fila cabecera de tabla
  doc.setFillColor(...colores.acento);
  doc.rect(ML, y, W, 8.5, "F");
  doc.setFont(font, "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  activeCols.forEach((col, i) => {
    const label = COL_LABELS[col.key] || col.key;
    const isRight = col.key !== "descripcion";
    const xPos = isRight
      ? colX[i] + colWidths[i] - 1
      : colX[i] + 2;
    doc.text(label.toUpperCase(), xPos, y + 5.8, { align: isRight ? "right" : "left" });
  });
  y += 8.5;

  // Filas de datos
  let lineas = [];
  try { lineas = docData.lineas ? JSON.parse(docData.lineas) : []; } catch(e) { lineas = []; }
  if (!lineas.length) {
    lineas = [{ descripcion: docData.concepto || "Servicio", cantidad: 1, precio: docData.base || 0, iva: docData.iva || 21 }];
  }

  let baseTotal = 0;
  const ivaMap = {};
  let descuentoTotalDoc = 0;

  lineas.forEach((l, ri) => {
    const qty          = l.cantidad || 1;
    const precio       = l.precio || 0;
    const subtotalBruto = qty * precio;
    const descAmt      = _parseDescuento(l.descuento, subtotalBruto);
    const subtotal     = Math.max(0, subtotalBruto - descAmt);

    descuentoTotalDoc += descAmt;
    baseTotal += subtotal;
    const ivaAmt = subtotal * (l.iva || 0) / 100;
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + ivaAmt;

    const rH = 8;
    // Fondo alternado
    if (ri % 2 === 0) {
      doc.setFillColor(...colores.fdoTab);
    } else {
      doc.setFillColor(...colores.fondo);
    }
    doc.rect(ML, y, W, rH, "F");
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.1);
    doc.line(ML, y + rH, ML + W, y + rH);

    doc.setFont(font, "normal");
    doc.setFontSize(tamF);
    doc.setTextColor(...colores.letra);

    activeCols.forEach((col, i) => {
      let val = "";
      const isRight = col.key !== "descripcion";

      switch (col.key) {
        case "descripcion":  val = (l.descripcion || "—").substring(0, 50); break;
        case "cantidad":     val = String(qty); break;
        case "precio":       val = precio.toFixed(2) + " €"; break;
        case "subtotal":     val = subtotal.toFixed(2) + " €"; break;
        case "iva":          val = (l.iva || 0) + "%"; break;
        case "descuento":
          val = descAmt > 0
            ? (String(l.descuento || "").endsWith("%") ? l.descuento : descAmt.toFixed(2) + " €")
            : "—";
          break;
        case "codigo":       val = l.codigo || l.referencia || "—"; break;
        case "coeficiente":  val = l.coeficiente != null ? String(l.coeficiente) : "1.00"; break;
        case "total":
          val = subtotal.toFixed(2) + " €";
          doc.setFont(font, "bold");
          break;
      }

      const xPos = isRight
        ? colX[i] + colWidths[i] - 1
        : colX[i] + 2;
      const dl = doc.splitTextToSize(val, colWidths[i] - 2);
      doc.text(dl[0], xPos, y + 5.2, { align: isRight ? "right" : "left" });
      if (col.key === "total") doc.setFont(font, "normal");
    });

    y += rH;
    if (y > PH - 70) { doc.addPage(); y = 20; }
  });

  // Línea de cierre tabla
  doc.setDrawColor(...colores.acento);
  doc.setLineWidth(0.5);
  doc.line(ML, y, PW - MR, y);
  y += 8;

  // ── TOTALES ──
  const ivaTotal    = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  const irpfAmt     = baseTotal * (docData.irpf_retencion || 0) / 100;
  const totalFinal  = baseTotal + ivaTotal - irpfAmt;

  const xTL = PW - MR - 80;
  const xTV = PW - MR;

  const _totRow = (label, value, color) => {
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.setTextColor(...(color || MUTED));
    doc.text(label, xTL, y);
    doc.setTextColor(...colores.letra);
    doc.text(value, xTV, y, { align: "right" });
    y += 6.5;
  };

  _totRow("Base imponible", baseTotal.toFixed(2) + " €");

  if (descuentoTotalDoc > 0) {
    _totRow("Descuentos", "- " + descuentoTotalDoc.toFixed(2) + " €", [200, 50, 50]);
  }

  Object.entries(ivaMap).filter(([, v]) => v > 0).sort(([a], [b]) => Number(b) - Number(a)).forEach(([pct, amt]) => {
    _totRow("IVA " + pct + "%", amt.toFixed(2) + " €");
  });

  if (docData.irpf_retencion > 0) {
    _totRow("IRPF " + docData.irpf_retencion + "%", "- " + irpfAmt.toFixed(2) + " €", [185, 28, 28]);
  }

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(xTL, y, xTV, y);
  y += 4;

  doc.setFillColor(...colores.acento);
  doc.roundedRect(xTL - 4, y - 2, xTV - xTL + 8, 13, 1.5, 1.5, "F");
  doc.setFont(font, "bold");
  doc.setFontSize(12);
  doc.setTextColor(...WHITE);
  doc.text("TOTAL", xTL, y + 7);
  doc.text(totalFinal.toFixed(2) + " €", xTV, y + 7, { align: "right" });
  y += 20;

  // ── NOTAS ──
  const notas = docData.notas;
  if (notas && y < PH - 50) {
    const LIGHT = colores.fdoTab;
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    const nl = doc.splitTextToSize(notas, W - 10);
    const nh = nl.length * 4.5 + 13;
    doc.roundedRect(ML, y, W, nh, 1.5, 1.5, "FD");
    doc.setFont(font, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("NOTAS / NOTES", ML + 5, y + 6);
    doc.setFont(font, "normal");
    doc.setFontSize(tamF);
    doc.setTextColor(...colores.letra);
    doc.text(nl, ML + 5, y + 11.5);
    y += nh + 6;
  }

  // ── TEXTO PIE (de la plantilla) ──
  const textoPie = plantilla?.texto_pie;
  if (textoPie && y < PH - 40) {
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const pieL = doc.splitTextToSize(textoPie, W);
    doc.text(pieL, ML, y);
    y += pieL.length * 4 + 4;
  }

  // ── IBAN (de la plantilla) ──
  const iban = plantilla?.iban_visible;
  if (iban && y < PH - 30) {
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...colores.letra);
    doc.text("Datos bancarios: " + iban, ML, y);
    y += 6;
  }

  // ── VERIFACTU block (solo facturas) ──
  if (tipo === "factura" && docData.verifactu_hash && y < PH - 35) {
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.setLineWidth(0.3);
    const vfH = 14;
    doc.roundedRect(ML, y, W, vfH, 1.5, 1.5, "FD");
    doc.setFont(font, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(22, 101, 52);
    doc.text("✓ VERIFACTU — RD 1007/2023 · Factura verificable electrónicamente", ML + 4, y + 5);
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.text("Hash: " + docData.verifactu_hash.substring(0, 32) + "…", ML + 4, y + 10);
    const fecha_vf = docData.verifactu_fecha ? new Date(docData.verifactu_fecha).toLocaleDateString("es-ES") : "";
    doc.text("Firmado: " + fecha_vf, PW - MR, y + 10, { align: "right" });
    y += vfH + 6;
  }

  // ── PIE DE PÁGINA ──
  const mostrarPie = plantilla ? (plantilla.mostrar_pie !== false) : true;
  if (mostrarPie) {
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.4);
    doc.line(ML, PH - 16, PW - MR, PH - 16);
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);

    const pieIzq = tipo === "factura"
      ? ({ nacional:"Operación sujeta a IVA español · Ley 37/1992.", intracomunitaria:"Op. intracomunitaria exenta IVA · Art. 25 LIVA.", exportacion:"Exportación exenta de IVA · Art. 21 LIVA.", importacion:"IVA liquidado en aduana mediante DUA.", inversion_sujeto_pasivo:"Inversión sujeto pasivo · Art. 84 LIVA." }[docData.tipo_operacion] || "")
      : (docData.fecha_validez ? "Válido hasta: " + fmtFecha(docData.fecha_validez) : "");

    doc.text(pieIzq, ML, PH - 10);
    const pieDer = [perfil.nombre_razon_social, perfil.nif ? "NIF " + perfil.nif : null].filter(Boolean).join(" · ");
    doc.text(pieDer, PW - MR, PH - 10, { align: "right" });
  }

  // ── GUARDAR / DEVOLVER ──
  const tipoFmt  = tipo === "factura" ? "factura" : "presupuesto";
  const numFmt   = (docData.numero_factura || docData.numero || docData.id?.slice(0, 8) || "doc").replace(/[\/\\]/g, "-");
  const filename = `${tipoFmt}_${numFmt}.pdf`;

  if (descargar) {
    doc.save(filename);
    toast("📄 PDF descargado", "success");
    return null;
  }
  return { blob: doc.output("blob"), filename, dataUri: doc.output("datauristring") };
}

/* ══════════════════════════════════════════════════════
   HELPERS PARA ACCESO RÁPIDO DESDE OTROS MÓDULOS
══════════════════════════════════════════════════════ */

/** Genera PDF de factura con la plantilla seleccionada o la predeterminada */
export async function exportFacturaPDFConPlantilla(facturaId, plantillaId = null, descargar = true) {
  const { data: f, error } = await supabase
    .from("facturas")
    .select("*")
    .eq("id", facturaId)
    .single();
  if (error || !f) { toast("Factura no encontrada", "error"); return null; }

  // Si el caller no pasa plantillaId, leer del selector del formulario activo
  const selId = plantillaId
    || document.getElementById("nfPlantillaSel")?.value
    || null;

  return generarPDFConPlantilla({ doc: f, tipo: "factura", plantillaId: selId, descargar });
}

/** Genera PDF de presupuesto con la plantilla seleccionada o la predeterminada */
export async function exportPresupuestoPDFConPlantilla(presId, plantillaId = null, descargar = true) {
  const { data: p, error } = await supabase
    .from("presupuestos")
    .select("*")
    .eq("id", presId)
    .single();
  if (error || !p) { toast("Presupuesto no encontrado", "error"); return null; }

  const selId = plantillaId
    || document.getElementById("npPlantillaSel")?.value
    || null;

  return generarPDFConPlantilla({ doc: p, tipo: "presupuesto", plantillaId: selId, descargar });
}
