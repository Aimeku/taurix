/* ═══════════════════════════════════════════════════════
   TAURIX · barcode-utils.js
   Generador de códigos de barras EAN-13 y EAN-8
   Sin dependencias externas — implementación pura JS
   ═══════════════════════════════════════════════════════ */

/**
 * Genera un código EAN-13 válido con prefijo español (84)
 * @returns {string} Código EAN-13 de 13 dígitos con dígito de control
 */
export function generarEAN13() {
  // Prefijo GS1 España: 84
  const prefix = "84";

  // Generar 10 dígitos aleatorios (total 12 sin el check digit)
  let code = prefix;
  for (let i = 0; i < 10; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }

  // Calcular dígito de control EAN-13
  const checkDigit = calcCheckDigitEAN13(code);
  return code + checkDigit;
}

/**
 * Genera un código EAN-8 válido
 * @returns {string} Código EAN-8 de 8 dígitos
 */
export function generarEAN8() {
  let code = "";
  for (let i = 0; i < 7; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  const checkDigit = calcCheckDigitEAN8(code);
  return code + checkDigit;
}

/**
 * Genera un código interno de referencia
 * Formato: TAURIX-XXXXXXXX (8 caracteres alfanuméricos)
 * @param {string} prefix - Prefijo opcional (default: "TX")
 * @returns {string}
 */
export function generarCodigoInterno(prefix = "TX") {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${code}`;
}

/**
 * Calcula el dígito de control de un EAN-13 (12 dígitos sin check)
 */
function calcCheckDigitEAN13(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(code12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return ((10 - (sum % 10)) % 10).toString();
}

/**
 * Calcula el dígito de control de un EAN-8 (7 dígitos sin check)
 */
function calcCheckDigitEAN8(code7) {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = parseInt(code7[i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return ((10 - (sum % 10)) % 10).toString();
}

/**
 * Valida si un código EAN-13 es correcto
 * @param {string} code - Código de 13 dígitos
 * @returns {boolean}
 */
export function validarEAN13(code) {
  if (!code || code.length !== 13 || !/^\d{13}$/.test(code)) return false;
  const expected = calcCheckDigitEAN13(code.slice(0, 12));
  return code[12] === expected;
}

/**
 * Valida si un código EAN-8 es correcto
 */
export function validarEAN8(code) {
  if (!code || code.length !== 8 || !/^\d{8}$/.test(code)) return false;
  const expected = calcCheckDigitEAN8(code.slice(0, 7));
  return code[7] === expected;
}

/**
 * Renderiza un código de barras EAN-13 como SVG string
 * @param {string} code - Código EAN-13 de 13 dígitos
 * @param {object} opts - { width, height, showText }
 * @returns {string} SVG markup
 */
export function renderBarcodeSVG(code, opts = {}) {
  const { width = 200, height = 80, showText = true } = opts;

  if (!code || code.length !== 13) return "";

  // Encoding tables for EAN-13
  const L_CODES = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const G_CODES = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
  const R_CODES = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];

  const PARITY = [
    "LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG",
    "LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"
  ];

  const firstDigit = parseInt(code[0]);
  const parity = PARITY[firstDigit];

  // Build binary string
  let binary = "101"; // Start guard
  for (let i = 0; i < 6; i++) {
    const digit = parseInt(code[i + 1]);
    binary += parity[i] === "L" ? L_CODES[digit] : G_CODES[digit];
  }
  binary += "01010"; // Center guard
  for (let i = 0; i < 6; i++) {
    const digit = parseInt(code[i + 7]);
    binary += R_CODES[digit];
  }
  binary += "101"; // End guard

  // Render SVG
  const barWidth = width / (binary.length + 14); // Extra padding
  const barHeight = showText ? height - 18 : height;
  let x = barWidth * 7; // Left padding

  let bars = "";
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === "1") {
      // Guard bars are taller
      const isGuard = i < 3 || (i >= 45 && i <= 49) || i >= binary.length - 3;
      const h = isGuard ? barHeight + 6 : barHeight;
      bars += `<rect x="${x.toFixed(2)}" y="2" width="${barWidth.toFixed(2)}" height="${h}" fill="#000"/>`;
    }
    x += barWidth;
  }

  let text = "";
  if (showText) {
    const fontSize = Math.max(9, Math.min(12, width / 18));
    text = `<text x="${width / 2}" y="${height - 2}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" font-weight="600" fill="#333">${code}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:white;border-radius:4px">
    ${bars}${text}
  </svg>`;
}
