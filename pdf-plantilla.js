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
export async function generarPDFConPlantilla({ doc: docData, tipo, plantillaId = null, descargar = true, mostrarPrecios = true }) {
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
  let logoB64 = plantilla?.logo_b64 || null;
  if (!logoB64 && perfil.logo_url) {
    logoB64 = await _logoToBase64(perfil.logo_url);
  }
  const mostrarLogo = plantilla ? (plantilla.mostrar_logo !== false) : true;

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * SISTEMA DE COORDENADAS — réplica exacta del preview HTML
   * ═══════════════════════════════════════════════════════════════════════
   * Preview: pvW=420px, SCALE=420/595, logo usa CSS max-height/max-width
   * con object-fit:contain → respeta el ratio nativo de la imagen.
   *
   * jsPDF.addImage(data,fmt,x,y,w,h) ESTIRA a w×h exactos → DEBEMOS
   * calcular nosotros el tamaño contenido respetando el ratio nativo.
   *
   * Conversión px→mm: 1px_preview = 210mm/420px = 0.5 mm exacto.
   * ═══════════════════════════════════════════════════════════════════════
   */

  /* Medir ratio nativo de la imagen (igual que img.naturalWidth/naturalHeight en CSS) */
  const _getNativeRatio = (b64) => new Promise(resolve => {
    try {
      const img = new Image();
      img.onload  = () => resolve(img.naturalWidth && img.naturalHeight
        ? img.naturalWidth / img.naturalHeight : 1);
      img.onerror = () => resolve(1);
      img.src = b64;
    } catch(e) { resolve(1); }
  });

  /* CSS object-fit:contain: cabe dentro de maxW×maxH preservando ratio */
  const _contain = (maxW, maxH, r) =>
    r > maxW / maxH
      ? { w: maxW, h: maxW / r }          // limitado por ancho
      : { w: maxH * r, h: maxH };         // limitado por altura

  const PVW      = 420;               // ancho del contenedor preview en px (columna CSS)
  const PV_SCALE = PVW / 595;         // SCALE del preview JS: pvW/595
  const PX_TO_MM = 210 / PVW;         // 0.5 mm/px exacto

  // Leer valores del slider exactamente igual que el preview
  const logoSizePx  = plantilla?.logo_size ?? 30;
  const logoXSlider = plantilla?.logo_x    ?? 0;
  const logoYSlider = plantilla?.logo_y    ?? 8;

  // Mismas fórmulas que _runPreview en plantillas-usuario.js:
  const maxH_px     = Math.round(logoSizePx * PV_SCALE);      // maxHeight CSS del img
  const maxW_px     = Math.round(logoSizePx * PV_SCALE * 3);  // maxWidth CSS del img
  const topPx       = Math.max(0, Math.min(55, logoYSlider * PV_SCALE));
  const maxOffsetPx = PVW / 2 - 8;
  const offsetPx    = Math.max(-maxOffsetPx, Math.min(maxOffsetPx, logoXSlider * (PVW / 240)));

  // Convertir bounds px → mm
  const maxH_mm  = Math.max(1.5, maxH_px  * PX_TO_MM);
  const maxW_mm  = Math.max(4.5, maxW_px  * PX_TO_MM);
  const logoTopY = topPx    * PX_TO_MM;    // Y desde borde superior cabecera
  const logoOffX = offsetPx * PX_TO_MM;   // offset X desde centro del documento

  // Centro horizontal: left=50% + translateX(-50%+offsetPx) → center = PW/2 + logoOffX
  const logoCX   = PW / 2 + logoOffX;

  // Calcular tamaño real aplicando object-fit:contain con ratio nativo
  let logoW_mm = maxW_mm;
  let logoH_mm = maxH_mm;
  let logoOk   = false;

  if (mostrarLogo && logoB64) {
    try {
      const nativeRatio = await _getNativeRatio(logoB64);
      const sz = _contain(maxW_mm, maxH_mm, nativeRatio);
      logoW_mm = sz.w;
      logoH_mm = sz.h;
      logoOk   = true;
    } catch(e) { logoOk = true; /* si falla ratio, usar bounds como máximos */ }
  }

  // Posición final — logo anclado en su centro horizontal, con clamp a márgenes
  const logoLeft = Math.max(ML, Math.min(PW - MR - logoW_mm, logoCX - logoW_mm / 2));
  const logoTop  = logoTopY;   // Y relativo al borde superior de la cabecera

  // ── CABECERA ──
  // En el preview: logo es position:absolute encima de ep_pv_cab_wrap.
  // En el PDF: dibujamos cabecera → texto → logo (z-order = orden de dibujo).
  const tipoLabel = tipo === "factura" ? "FACTURA" : tipo === "albaran" ? "ALBARÁN / DELIVERY NOTE" : "PRESUPUESTO";
  const numero    = docData.numero_factura || docData.numero || "BORRADOR";
  const fecha     = docData.fecha;
  const fmtFecha  = d => { if(!d)return"—"; const [yr,mo,dy]=d.split("-"); return `${dy}/${mo}/${yr}`; };

  const CAB_TOP = 5;   // cabecera empieza a 5mm del borde superior de la página
  const cabH    = logoOk
    ? Math.max(18, logoTop + logoH_mm + 3)  // crece para contener el logo
    : 18;

  if (estiloCab !== "sin") {
    if (estiloCab === "solido" || estiloCab === "gradiente") {
      doc.setFillColor(...colores.cab);
      doc.rect(ML, CAB_TOP, W, cabH, "F");
    } else if (estiloCab === "linea") {
      doc.setDrawColor(...colores.cab);
      doc.setLineWidth(0.8);
      doc.line(ML, CAB_TOP + cabH, PW - MR, CAB_TOP + cabH);
    }
    const txtColor   = estiloCab === "linea" ? colores.letra : colores.txtCab;
    const textRightX = logoOk ? Math.max(ML + 20, logoLeft - 3) : PW - MR - 4;
    const textW      = textRightX - ML - 4;
    doc.setFont(font, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...txtColor);
    doc.text(tipoLabel, ML + 4, CAB_TOP + 5.5);
    doc.setFontSize(Math.min(tamF + 3, 13));
    const numLine = doc.splitTextToSize(numero.substring(0, 30), textW);
    doc.text(numLine[0], ML + 4, CAB_TOP + 11);
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.text(fmtFecha(fecha), PW - MR - 2, CAB_TOP + 6, { align: "right" });
    if (docData.fecha_validez) {
      doc.text("Válido hasta: " + fmtFecha(docData.fecha_validez), PW - MR - 2, CAB_TOP + 11, { align: "right" });
    }
  } else {
    doc.setFont(font, "bold");
    doc.setFontSize(20);
    doc.setTextColor(...colores.letra);
    doc.text(tipoLabel, ML, CAB_TOP + 10);
    doc.setFontSize(11);
    doc.text(numero, ML, CAB_TOP + 17);
  }

  // Logo ENCIMA de la cabecera (último dibujado = encima, igual que z-index en CSS)
  if (logoOk && logoB64) {
    try {
      const mime = logoB64.split(";")[0].split(":")[1] || "image/png";
      const ext  = mime.includes("png") ? "PNG" : (mime.includes("svg") ? "SVG" : "JPEG");
      doc.addImage(logoB64, ext, logoLeft, CAB_TOP + logoTop, logoW_mm, logoH_mm, "", "FAST");
    } catch(e) { console.warn("Logo addImage error:", e.message); }
  }

  let y = CAB_TOP + cabH + 6;

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

  // Concepto (para presupuesto y albarán)
  if (docData.concepto && (tipo === "presupuesto" || tipo === "albaran")) {
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.setTextColor(...colores.letra);
    doc.text(docData.concepto.substring(0, 60), ML, y);
    y += 8;
  }

  // ── TABLA DE LÍNEAS ──
  // Columnas: si la plantilla define cols_activas, usarlas; si no, usar columnas por defecto
  // Columnas por defecto según tipo y opción mostrarPrecios
  const DEFAULT_COLS_PRECIOS  = [
    { key: "descripcion", label: "Descripción", width: null },
    { key: "cantidad",    label: "Cant.",        width: null },
    { key: "precio",      label: "P. unit.",     width: null },
    { key: "iva",         label: "IVA",          width: null },
    { key: "total",       label: "Total",        width: null },
  ];
  const DEFAULT_COLS_ALBARAN_SIN = [
    { key: "descripcion", label: "Descripción", width: null },
    { key: "cantidad",    label: "Cantidad",    width: null },
  ];
  // Columnas de importe que se ocultan cuando mostrarPrecios=false
  const PRECIO_KEYS = new Set(["precio","subtotal","total","descuento","iva","coeficiente"]);

  let DEFAULT_COLS;
  if (tipo === "albaran" && !mostrarPrecios) {
    DEFAULT_COLS = DEFAULT_COLS_ALBARAN_SIN;
  } else {
    DEFAULT_COLS = DEFAULT_COLS_PRECIOS;
  }

  const COL_LABELS = {
    descripcion: "Descripción",  cantidad: "Cant.",   precio: "P. unit.",
    subtotal:    "Subtotal",     iva:      "IVA",     total:  "Total",
    descuento:   "Descuento",   codigo:   "Código",  coeficiente: "Coef.",
  };

  // Para albarán sin precios: quitar columnas de importe aunque la plantilla las tenga
  let activeCols = cols || DEFAULT_COLS;
  if (tipo === "albaran" && !mostrarPrecios) {
    activeCols = activeCols.filter(c => !PRECIO_KEYS.has(c.key));
    // Garantizar descripcion + cantidad mínimo
    if (!activeCols.find(c => c.key === "descripcion")) activeCols.unshift({ key:"descripcion", label:"Descripción", width:null });
    if (!activeCols.find(c => c.key === "cantidad"))    activeCols.push({ key:"cantidad", label:"Cantidad", width:null });
  }

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

  // ── TOTALES ── (no se muestran en albarán sin precios)
  const ivaTotal    = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  if (tipo === "albaran" && !mostrarPrecios) {
    // Saltar bloque de totales
    y += 4;
  } else {
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
  } // end if mostrarPrecios

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
      : tipo === "albaran"
      ? "Albarán de entrega · Este documento no tiene validez fiscal · No sustituye a la factura."
      : (docData.fecha_validez ? "Válido hasta: " + fmtFecha(docData.fecha_validez) : "");

    doc.text(pieIzq, ML, PH - 10);
    const pieDer = [perfil.nombre_razon_social, perfil.nif ? "NIF " + perfil.nif : null].filter(Boolean).join(" · ");
    doc.text(pieDer, PW - MR, PH - 10, { align: "right" });
  }

  // ── SECCIÓN FIRMA (solo albaranes) ──
  if (tipo === "albaran" && y < PH - 65) {
    y += 6;
    // Nota sin validez fiscal
    doc.setFillColor(255,251,235);
    doc.setDrawColor(253,230,138);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, y, W, 11, 1.5, 1.5, "FD");
    doc.setFont(font, "normal"); doc.setFontSize(7.5);
    doc.setTextColor(146, 64, 14);
    doc.text("! Este documento no tiene validez fiscal. No incluye IVA. No sustituye a la factura.", ML + 4, y + 7);
    y += 17;

    // Cuadro firma receptor
    const firmaW = W / 2 - 4;
    const firmaH = 38;
    doc.setDrawColor(...BORDER); doc.setLineWidth(0.3);
    doc.roundedRect(ML, y, firmaW, firmaH, 1.5, 1.5, "D");
    doc.setFont(font, "bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("FIRMA DEL RECEPTOR / RECIPIENT SIGNATURE", ML + 4, y + 7);
    doc.setFont(font, "normal"); doc.setFontSize(7.5);
    doc.text("Nombre / Name: ________________________________", ML + 4, y + 17);
    doc.text("DNI / ID: _____________________________________", ML + 4, y + 24);
    doc.text("Fecha / Date: __________________________________", ML + 4, y + 31);

    // Cuadro estado facturación
    const infoX = PW / 2 + 4;
    const infoW = W / 2 - 4;
    doc.roundedRect(infoX, y, infoW, firmaH, 1.5, 1.5, "D");
    doc.setFont(font, "bold"); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text("ESTADO DE FACTURACIÓN / BILLING STATUS", infoX + 4, y + 7);
    const esFact = docData.estado_facturacion === "facturado";
    doc.setFont(font, "normal"); doc.setFontSize(9);
    doc.setTextColor(esFact ? 5 : 146, esFact ? 150 : 64, esFact ? 105 : 14);
    doc.text(esFact ? "✓ Facturado / Invoiced" : "⏳ Pendiente de facturar", infoX + 4, y + 20);
    if (esFact && docData.fecha_facturacion) {
      doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text("Fecha: " + new Date(docData.fecha_facturacion + "T12:00:00").toLocaleDateString("es-ES"), infoX + 4, y + 28);
    }
    // Badge sin precios si aplica
    if (!mostrarPrecios) {
      doc.setFillColor(254,243,199); doc.setDrawColor(253,230,138); doc.setLineWidth(0.3);
      doc.roundedRect(infoX + 4, y + 30, 42, 6, 1, 1, "FD");
      doc.setFont(font, "bold"); doc.setFontSize(6.5); doc.setTextColor(146,64,14);
      doc.text("ALBARÁN SIN PRECIOS", infoX + 6, y + 34);
    }
  }

  // ── GUARDAR / DEVOLVER ──
  const tipoFmt  = tipo === "factura" ? "factura" : tipo === "albaran" ? "albaran" : "presupuesto";
  const numFmt   = (docData.numero_factura || docData.numero_albaran || docData.numero || docData.id?.slice(0, 8) || "doc").replace(/[\/\\]/g, "-");
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

/** Genera PDF de albarán usando el motor de plantillas.
 *  mostrarPrecios: si false, oculta columnas de precio/importe/IVA.
 */
export async function exportAlbaranPDFConPlantilla(presId, plantillaId = null, descargar = true, mostrarPrecios = true) {
  const { data: p, error } = await supabase
    .from("presupuestos")
    .select("*")
    .eq("id", presId)
    .single();
  if (error || !p) { toast("Albarán no encontrado", "error"); return null; }

  const selId = plantillaId || null;

  return generarPDFConPlantilla({
    doc:           p,
    tipo:          "albaran",
    plantillaId:   selId,
    descargar,
    mostrarPrecios,
  });
}
