/* ═══════════════════════════════════════════════════════
   TAURIX · nuevo-albaran.js
   Formulario de creación / edición directa de albaranes.
   Misma arquitectura que nueva-proforma.js / nuevo-presupuesto.js.

   ─ Líneas con columnas dinámicas y catálogo de productos
   ─ Selector de plantilla con columnas configurables
   ─ Numeración independiente A-YYYY-NNNN
   ─ Descuento por línea + descuento global
   ─ Tipo de operación completo
   ─ Fecha de entrega (fecha_aceptacion → usada por el PDF)
   ─ Edición de albaranes existentes (directos y de presupuesto)
   ─ Reduce stock opcional
   ─ Guarda en tabla presupuestos con estado = "albaran"
   ═══════════════════════════════════════════════════════ */

import { supabase }                        from './supabase.js';
import {
  SESSION, CLIENTES, fmt, toast,
  switchView, OP_INFO, OP_SIN_IVA, OP_IVA_NO_REPERCUTIDO,
} from './utils.js';
import { PRODUCTOS, refreshProductos }     from './productos.js';
import { refreshAlbaranes }                from './albaranes.js';
import { getNextDocumentNumber }            from './numeracion-docs.js';
import { renderSedeSelector, readSedeIdFromForm } from './sedes.js';

/* ══════════════════════════════════════════════════════
   ESTADO INTERNO
══════════════════════════════════════════════════════ */
let LINEAS       = [];
let lineaIdCnt   = 0;
let clienteSelId = null;
let editandoId   = null;   // null → modo creación, string → modo edición
let opTipo       = 'nacional';

/* Descuento global sobre el subtotal */
let _dtoGlobal = { tipo: 'pct', valor: 0 };

/* ══════════════════════════════════════════════════════
   COLUMNAS DINÁMICAS  (misma definición que nueva-proforma)
══════════════════════════════════════════════════════ */
const _COL_SCHEMA = {
  descripcion: { label:'Descripción', fr:3.0, minW:120, align:'left',  inputType:'text',   field:'descripcion' },
  cantidad:    { label:'Cant.',       fr:0.7, minW:52,  align:'right', inputType:'number', field:'cantidad',   step:'0.01', min:'0.01' },
  precio:      { label:'Precio',      fr:1.0, minW:72,  align:'right', inputType:'number', field:'precio',     step:'0.01', placeholder:'0.00' },
  descuento:   { label:'Dto.',        fr:0.8, minW:60,  align:'right', inputType:'text',   field:'descuento',  placeholder:'10%/5€' },
  codigo:      { label:'Código',      fr:0.7, minW:55,  align:'left',  inputType:'text',   field:'codigo' },
  coeficiente: { label:'Coef.',       fr:0.6, minW:50,  align:'right', inputType:'number', field:'coeficiente', step:'0.01' },
  iva:         { label:'IVA',         fr:0.6, minW:56,  align:'right', inputType:'select', field:'iva' },
  total:       { label:'Total',       fr:0.9, minW:68,  align:'right', inputType:null },
};
const _DEFAULT_COLS = ['descripcion','cantidad','precio','iva','total'];
let _cols = [..._DEFAULT_COLS];

function _gridStr() {
  return [..._cols.map(k => {
    const c = _COL_SCHEMA[k];
    return c ? `minmax(${c.minW}px,${c.fr}fr)` : '1fr';
  }), '28px'].join(' ');
}

function _applyHeader() {
  const hdr = document.getElementById('naLineasHeader');
  if (!hdr) return;
  hdr.style.gridTemplateColumns = _gridStr();
  hdr.innerHTML = _cols.map(k => {
    const c = _COL_SCHEMA[k];
    const r = c?.align === 'right';
    return `<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;${r ? 'text-align:right' : ''};overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${c?.label || k}</div>`;
  }).join('') + '<div></div>';
}

function _applyRow(row) {
  row.style.display = 'grid';
  row.style.gridTemplateColumns = _gridStr();
  row.style.gap = '4px';
  row.style.alignItems = 'center';
  row.style.padding = '4px 0';
  row.style.borderBottom = '1px solid var(--brd)';
}

/* ══════════════════════════════════════════════════════
   TOTALES
══════════════════════════════════════════════════════ */
function _parseDto(raw, sub) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.endsWith('%')) return sub * (parseFloat(s) || 0) / 100;
  return parseFloat(s) || 0;
}

function _calcTotales() {
  let baseSinDto = 0;
  const ivaMap = {};

  LINEAS.forEach(l => {
    const bruto = (l.cantidad || 0) * (l.precio || 0);
    const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
    baseSinDto += sub;
  });

  let dtoGlobalAmt = 0;
  if (_dtoGlobal.valor > 0) {
    dtoGlobalAmt = _dtoGlobal.tipo === 'pct'
      ? baseSinDto * _dtoGlobal.valor / 100
      : Math.min(_dtoGlobal.valor, baseSinDto);
    dtoGlobalAmt = Math.max(0, dtoGlobalAmt);
  }

  const base  = Math.max(0, baseSinDto - dtoGlobalAmt);
  const ratio = baseSinDto > 0 ? base / baseSinDto : 0;

  LINEAS.forEach(l => {
    const bruto = (l.cantidad || 0) * (l.precio || 0);
    const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
    ivaMap[l.iva] = (ivaMap[l.iva] || 0) + sub * ratio * (l.iva || 0) / 100;
  });

  const ivaTot     = Object.values(ivaMap).reduce((a, b) => a + b, 0);
  const ivaEnTotal = OP_IVA_NO_REPERCUTIDO.includes(opTipo) ? 0 : ivaTot;
  const total      = base + ivaEnTotal;

  const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  s('naBase',  fmt(base));
  s('naIva',   fmt(ivaTot));
  s('naTotal', fmt(total));

  /* Fila descuento global */
  const dtoRow = document.getElementById('naDtoGlobalRow');
  if (dtoRow) {
    if (dtoGlobalAmt > 0) {
      dtoRow.style.display = '';
      const lbl = document.getElementById('naDtoGlobalLbl');
      const val = document.getElementById('naDtoGlobalVal');
      if (lbl) lbl.textContent = _dtoGlobal.tipo === 'pct' ? `Dto. global (−${_dtoGlobal.valor}%)` : 'Dto. global';
      if (val) val.textContent = `−${fmt(dtoGlobalAmt)}`;
    } else {
      dtoRow.style.display = 'none';
    }
  }

  /* Ocultar fila IVA cuando la operación no repercute IVA */
  const ivaRow = document.getElementById('naIvaRow');
  if (ivaRow) {
    const mostrarIva = !OP_SIN_IVA.includes(opTipo) || OP_IVA_NO_REPERCUTIDO.includes(opTipo);
    ivaRow.style.display = mostrarIva ? '' : 'none';
  }

  return { base, ivaMap, ivaTot, dtoGlobalAmt };
}

/* ══════════════════════════════════════════════════════
   TIPO DE OPERACIÓN
══════════════════════════════════════════════════════ */
function _updateOpUI() {
  const banner      = document.getElementById('naOpBanner');
  const exencionWrap = document.getElementById('naExencionWrap');
  const nifNote     = document.getElementById('naNifNote');
  if (banner) {
    banner.textContent = OP_INFO[opTipo] || '';
    banner.classList.toggle('visible', !!OP_INFO[opTipo]);
  }
  if (exencionWrap) exencionWrap.style.display = opTipo === 'exento' ? '' : 'none';
  if (nifNote) nifNote.textContent = opTipo === 'intracomunitaria' ? '(VAT número UE obligatorio)' : '';
}

/* ══════════════════════════════════════════════════════
   LÍNEAS
══════════════════════════════════════════════════════ */
function _addLinea(pf = {}) {
  const id     = ++lineaIdCnt;
  const sinIva = OP_SIN_IVA.includes(opTipo);
  const l = {
    id,
    descripcion:  pf.descripcion  || '',
    cantidad:     pf.cantidad      != null ? pf.cantidad     : 1,
    precio:       pf.precio        != null ? pf.precio       : 0,
    iva:          sinIva ? 0 : (pf.iva !== undefined ? pf.iva : 21),
    descuento:    pf.descuento     ?? '',
    codigo:       pf.codigo        ?? '',
    coeficiente:  pf.coeficiente   ?? '',
    producto_id:  pf.producto_id   || null,
  };
  LINEAS.push(l);

  const cont = document.getElementById('naLineasContainer');
  if (!cont) return;

  const row = document.createElement('div');
  row.className = 'linea-row';
  row.dataset.lineaId = id;

  row.innerHTML = _cols.map(k => {
    const c = _COL_SCHEMA[k];
    if (!c) return '<div></div>';
    const a  = c.align === 'right' ? 'text-align:right' : '';
    const bs = `width:100%;box-sizing:border-box;${a}`;

    if (k === 'total') {
      return `<div id="naLt${id}" style="font-size:13px;font-weight:700;text-align:right;font-family:monospace;color:var(--t1)">0,00 €</div>`;
    }
    if (k === 'iva') {
      return `<select class="ff-select" data-field="iva" style="${bs}" ${sinIva ? 'disabled' : ''}>
        <option value="21" ${l.iva === 21 ? 'selected' : ''}>21%</option>
        <option value="10" ${l.iva === 10 ? 'selected' : ''}>10%</option>
        <option value="4"  ${l.iva === 4  ? 'selected' : ''}>4%</option>
        <option value="0"  ${l.iva === 0  ? 'selected' : ''}>0%</option>
      </select>`;
    }

    const v  = l[k] !== undefined ? l[k] : '';
    const ex = [
      c.step        ? `step="${c.step}"`               : '',
      c.min         ? `min="${c.min}"`                 : '',
      c.placeholder ? `placeholder="${c.placeholder}"` : '',
    ].filter(Boolean).join(' ');
    return `<input autocomplete="off" type="${c.inputType || 'text'}" class="ff-input" data-field="${k}" value="${v}" ${ex} style="${bs}"/>`;
  }).join('') + `<button class="linea-del" onclick="window._naDelLinea(${id})" style="padding:4px;display:flex;align-items:center;justify-content:center">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;

  _applyRow(row);

  row.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('input',  () => _onChange(id, el));
    el.addEventListener('change', () => _onChange(id, el));
  });

  /* Dropdown catálogo en campo descripción */
  const di = row.querySelector('[data-field="descripcion"]');
  if (di) _buildProdDropdown(di, p => {
    const lx = LINEAS.find(x => x.id === id);
    if (lx) {
      lx.descripcion  = p.descripcion || p.nombre;
      lx.precio       = p.precio_venta;
      lx.iva          = p.iva;
      lx.producto_id  = p.id;
    }
    const f = (field, val) => {
      const el = row.querySelector(`[data-field="${field}"]`);
      if (el) el.value = val;
    };
    f('descripcion', p.descripcion || p.nombre);
    f('precio',       p.precio_venta);
    f('iva',          p.iva);
    const tot = document.getElementById(`naLt${id}`);
    if (tot) tot.textContent = fmt((lx?.cantidad || 1) * p.precio_venta);
    _calcTotales();
    _actualizarVisibilidadReducirStock();
  });

  cont.appendChild(row);
  _calcTotales();
  _actualizarVisibilidadReducirStock();
}

function _actualizarVisibilidadReducirStock() {
  const wrap = document.getElementById('naReducirStockWrap');
  if (!wrap) return;
  wrap.style.display = LINEAS.some(l => l.producto_id) ? 'flex' : 'none';
}

/* ══════════════════════════════════════════════════════
   DROPDOWN CATÁLOGO DE PRODUCTOS
   (réplica exacta de nueva-proforma.js / nueva-factura.js)
══════════════════════════════════════════════════════ */
function _buildProdDropdown(descInput, onSelect) {
  if (!descInput) return;

  const dd = document.createElement('div');
  dd.className = 'csc-dropdown';
  dd.style.cssText = 'display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:300;min-width:280px';
  descInput.parentElement.style.position = 'relative';
  descInput.parentElement.appendChild(dd);

  const _render = lista => {
    if (!lista.length) {
      dd.innerHTML = '<div class="csd-empty">Sin productos en el catálogo</div>';
      dd.style.display = '';
      return;
    }
    dd.innerHTML = lista.map(p => {
      const stockBadge = p.tipo !== 'servicio' && p.stock_actual != null
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:5px;font-weight:700;margin-left:6px;background:${p.stock_actual > 0 ? '#dcfce7' : '#fee2e2'};color:${p.stock_actual > 0 ? '#166534' : '#991b1b'}">Stock: ${p.stock_actual}</span>`
        : '';
      return `<div class="csd-item" data-pid="${p.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1;min-width:0">
            <div class="csd-name">${p.nombre}${stockBadge}</div>
            ${p.descripcion ? `<div class="csd-meta">${p.descripcion}</div>` : ''}
            ${p.sku ? `<div class="csd-meta" style="font-family:monospace">SKU: ${p.sku}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${fmt(p.precio_venta)}</div>
            <div class="csd-meta">IVA ${p.iva}%</div>
          </div>
        </div>
      </div>`;
    }).join('');
    dd.querySelectorAll('.csd-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const p = PRODUCTOS.find(x => x.id === item.dataset.pid);
        if (p && onSelect) onSelect(p);
        dd.style.display = 'none';
      });
    });
    dd.style.display = '';
  };

  descInput.addEventListener('focus', () => {
    if (!PRODUCTOS?.length) return;
    _render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 12));
  });
  descInput.addEventListener('input', () => {
    if (!PRODUCTOS?.length) return;
    const q = descInput.value.toLowerCase().trim();
    if (!q) { _render(PRODUCTOS.filter(p => p.activo !== false).slice(0, 12)); return; }
    const m = PRODUCTOS.filter(p =>
      p.activo !== false && (
        p.nombre.toLowerCase().includes(q) ||
        (p.descripcion || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
      )
    ).slice(0, 10);
    if (!m.length) {
      dd.innerHTML = `<div class="csd-empty">Sin resultados para "${q}"</div>`;
      dd.style.display = '';
      return;
    }
    _render(m);
  });
  descInput.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 200));
}

/* ── Cambio de campo ── */
function _onChange(id, el) {
  const l = LINEAS.find(x => x.id === id);
  if (!l) return;
  const f = el.dataset.field;
  if      (f === 'descripcion') l.descripcion  = el.value;
  else if (f === 'cantidad')    l.cantidad      = parseFloat(el.value) || 0;
  else if (f === 'precio')      l.precio        = parseFloat(el.value) || 0;
  else if (f === 'iva')         l.iva           = parseInt(el.value)   || 0;
  else if (f === 'descuento')   l.descuento     = el.value;
  else if (f === 'codigo')      l.codigo        = el.value;
  else if (f === 'coeficiente') l.coeficiente   = el.value;

  const bruto = (l.cantidad || 0) * (l.precio || 0);
  const sub   = Math.max(0, bruto - _parseDto(l.descuento, bruto));
  const tot   = document.getElementById(`naLt${id}`);
  if (tot) tot.textContent = fmt(sub);
  _calcTotales();
}

window._naDelLinea = id => {
  LINEAS = LINEAS.filter(l => l.id !== id);
  document.querySelector(`.linea-row[data-linea-id="${id}"]`)?.remove();
  _calcTotales();
};

function _rebuildLineas() {
  const c = document.getElementById('naLineasContainer');
  if (!c) return;
  const snaps = LINEAS.map(l => ({ ...l }));
  c.innerHTML = '';
  LINEAS       = [];
  lineaIdCnt   = 0;
  snaps.forEach(s => _addLinea(s));
}

/* ══════════════════════════════════════════════════════
   SELECTOR DE PLANTILLA
══════════════════════════════════════════════════════ */
async function _initPlantillaSel() {
  const sel   = document.getElementById('naPlantillaSel');
  const badge = document.getElementById('naPlantillaBadge');
  if (!sel) return;
  sel.innerHTML = '<option value="">Cargando...</option>';
  sel.disabled  = true;

  let plantillas = [];
  try {
    const { data } = await supabase.from('plantillas_usuario')
      .select('id,nombre,es_default,cols_activas')
      .eq('user_id', SESSION.user.id)
      .order('nombre');
    plantillas = data || [];
  } catch (e) { console.warn('plantillas:', e.message); }

  sel.disabled = false;
  if (!plantillas.length) {
    sel.innerHTML = '<option value="">— Sin plantillas —</option>';
    return;
  }

  const defP = plantillas.find(p => p.es_default) || null;
  sel.innerHTML = [
    '<option value="">— Sin plantilla —</option>',
    ...plantillas.map(p =>
      `<option value="${p.id}" ${defP?.id === p.id ? 'selected' : ''}>${p.nombre}${p.es_default ? ' ⭐' : ''}</option>`
    ),
  ].join('');

  const updBadge = id => {
    if (badge) {
      const p = plantillas.find(x => x.id === id);
      badge.style.display = p?.es_default ? 'inline' : 'none';
    }
  };

  const apply = p => {
    if (!p) { _cols = [..._DEFAULT_COLS]; _applyHeader(); _rebuildLineas(); return; }
    let cols = [];
    try {
      const raw = p.cols_activas ? (typeof p.cols_activas === 'string' ? JSON.parse(p.cols_activas) : p.cols_activas) : null;
      if (Array.isArray(raw)) cols = raw.map(c => typeof c === 'object' ? c.key : c).filter(k => _COL_SCHEMA[k]);
    } catch (e) {}
    _cols = cols.length ? cols : [..._DEFAULT_COLS];
    if (!_cols.includes('descripcion')) _cols.unshift('descripcion');
    _applyHeader();
    _rebuildLineas();
  };

  if (defP) { updBadge(defP.id); apply(plantillas.find(p => p.id === defP.id)); }

  sel.addEventListener('change', () => {
    const id = sel.value;
    updBadge(id);
    apply(id ? plantillas.find(p => p.id === id) : null);
  });
}

/* ══════════════════════════════════════════════════════
   BÚSQUEDA DE CLIENTE
══════════════════════════════════════════════════════ */
function _initClienteSearch() {
  const inp = document.getElementById('naClienteSearch');
  const dd  = document.getElementById('naClienteDropdown');
  const lmp = document.getElementById('naClienteLimpiar');
  if (!inp) return;

  inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase();
    if (q.length < 2) { dd.style.display = 'none'; return; }
    const hits = CLIENTES.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.nif    || '').toLowerCase().includes(q)
    ).slice(0, 8);
    dd.innerHTML = hits.length
      ? hits.map(c => `<div class="csd-item" data-id="${c.id}"><div class="csd-name">${c.nombre}</div><div class="csd-meta">${c.nif || ''}</div></div>`).join('')
      : '<div class="csd-empty">Sin resultados</div>';
    dd.querySelectorAll('.csd-item').forEach(item =>
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        const c = CLIENTES.find(x => x.id === item.dataset.id);
        if (!c) return;
        clienteSelId = c.id;
        inp.value    = c.nombre;
        if (lmp) lmp.style.display = '';
        const f = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        f('naClienteNombre',         c.nombre);
        f('naClienteNombreComercial',c.nombre_comercial);
        f('naClienteNif',            c.nif);
        f('naClienteEmail',          c.email);
        f('naClienteTel',            c.telefono);
        f('naClienteDireccion',      c.direccion);
        f('naClienteCiudad',         c.ciudad);
        f('naClienteProvincia',      c.provincia);
        f('naClienteCp',             c.codigo_postal);
        if (c.pais)  { const ps = document.getElementById('naClientePais');  if (ps) ps.value = c.pais; }
        if (c.tipo)  { const tp = document.getElementById('naClienteTipo');  if (tp) tp.value = c.tipo; }
        document.getElementById('naClientePanel')?.classList.add('cliente-panel--filled');
        dd.style.display = 'none';
      })
    );
    dd.style.display = '';
  });
  inp.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 200));

  lmp?.addEventListener('click', () => {
    clienteSelId = null;
    inp.value    = '';
    lmp.style.display = 'none';
    ['naClienteNombre','naClienteNombreComercial','naClienteNif','naClienteEmail','naClienteTel',
     'naClienteDireccion','naClienteCiudad','naClienteProvincia','naClienteCp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const ps = document.getElementById('naClientePais'); if (ps) ps.value = 'ES';
    const tp = document.getElementById('naClienteTipo'); if (tp) tp.value = 'empresa';
    document.getElementById('naClientePanel')?.classList.remove('cliente-panel--filled');
  });
}

/* ══════════════════════════════════════════════════════
   NUMERACIÓN  A-YYYY-NNNN
══════════════════════════════════════════════════════ */
async function _getNextNumero(fecha = null) {
  return getNextDocumentNumber('albaran', fecha);
}

/* ══════════════════════════════════════════════════════
   REDUCIR STOCK  (mismo patrón que nueva-proforma)
══════════════════════════════════════════════════════ */
async function _descontarStockSiProcede() {
  if (!document.getElementById('naReducirStock')?.checked) return;
  const lineasConProducto = LINEAS.filter(l => l.producto_id && l.cantidad > 0);
  for (const linea of lineasConProducto) {
    const prod = PRODUCTOS.find(p => p.id === linea.producto_id);
    if (!prod || prod.tipo === 'servicio' || prod.stock_actual == null) continue;
    const nuevoStock = Math.max(0, prod.stock_actual - linea.cantidad);
    const { error } = await supabase.from('productos')
      .update({ stock_actual: nuevoStock })
      .eq('id', linea.producto_id)
      .eq('user_id', SESSION.user.id);
    if (!error) prod.stock_actual = nuevoStock;
  }
  refreshProductos().catch(() => {});
}

/* ══════════════════════════════════════════════════════
   GUARDAR / ACTUALIZAR
══════════════════════════════════════════════════════ */
async function _save() {
  const concepto = document.getElementById('naConcepto')?.value.trim();
  const fecha    = document.getElementById('naFecha')?.value;
  if (!concepto || !fecha) { toast('Concepto y fecha son obligatorios', 'error'); return; }
  if (!LINEAS.length || LINEAS.every(l => !l.precio || l.precio <= 0)) {
    toast('Añade al menos una línea con precio', 'error');
    return;
  }

  const btn = document.getElementById('naGuardarBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Guardando...'; }

  try {
    const { base, ivaMap } = _calcTotales();
    const ivaMain = parseInt(Object.entries(ivaMap).sort(([, a], [, b]) => b - a)[0]?.[0] || 21);

    /* ── Guardar cliente nuevo si está marcado ── */
    let cId = clienteSelId;
    if (!cId && document.getElementById('naGuardarCliente')?.checked) {
      const nombre = document.getElementById('naClienteNombre')?.value.trim();
      if (nombre) {
        const { data: nc } = await supabase.from('clientes').insert({
          user_id:          SESSION.user.id,
          nombre,
          nif:              document.getElementById('naClienteNif')?.value.trim()            || null,
          email:            document.getElementById('naClienteEmail')?.value.trim()          || null,
          telefono:         document.getElementById('naClienteTel')?.value.trim()            || null,
          direccion:        document.getElementById('naClienteDireccion')?.value.trim()      || null,
          ciudad:           document.getElementById('naClienteCiudad')?.value.trim()         || null,
          provincia:        document.getElementById('naClienteProvincia')?.value.trim()      || null,
          codigo_postal:    document.getElementById('naClienteCp')?.value.trim()             || null,
          nombre_comercial: document.getElementById('naClienteNombreComercial')?.value.trim()|| null,
          pais:             document.getElementById('naClientePais')?.value                  || 'ES',
          tipo:             document.getElementById('naClienteTipo')?.value                  || 'empresa',
        }).select().single();
        if (nc) cId = nc.id;
      }
    }

    /* ── Fecha de entrega: usada por el PDF (fecha_aceptacion) ── */
    const fechaEntrega = document.getElementById('naFechaEntrega')?.value || fecha;

    /* ── Notas + motivo exención ── */
    const motivoExencion = document.getElementById('naMotivoExencion')?.value.trim();
    let notasVal         = document.getElementById('naNotas')?.value.trim() || null;
    if (opTipo === 'exento' && motivoExencion) {
      notasVal = notasVal
        ? notasVal + '\n\nMotivo de exención: ' + motivoExencion
        : 'Motivo de exención: ' + motivoExencion;
    }

    /* ── Número ── */
    const albaran_numero = editandoId
      ? (document.getElementById('naNumeroDisplay')?.textContent || '')
      : await _getNextNumero(fecha);

    /* ── Payload principal ── */
    const payload = {
      user_id:            SESSION.user.id,
      sede_id:            readSedeIdFromForm("naSedeId"),
      numero:             null,            // albarán directo — no proviene de presupuesto
      concepto,
      base,
      iva:                ivaMain,
      estado:             'albaran',
      estado_facturacion: 'pendiente',
      tipo_operacion:     opTipo,
      fecha,                               // fecha de creación (para filtros por periodo)
      fecha_aceptacion:   fechaEntrega,    // fecha de entrega → usada por generarPDFAlbaran
      albaran_numero,
      albaran_fecha:      fechaEntrega,    // redundante pero consistente con el resto del código
      cliente_id:         cId || null,
      cliente_nombre:     document.getElementById('naClienteNombre')?.value.trim()      || null,
      cliente_nif:        document.getElementById('naClienteNif')?.value.trim()         || null,
      cliente_email:      document.getElementById('naClienteEmail')?.value.trim()       || null,
      cliente_direccion:  document.getElementById('naClienteDireccion')?.value.trim()   || null,
      descuento_global:   _dtoGlobal.valor > 0
        ? JSON.stringify({ tipo: _dtoGlobal.tipo, valor: _dtoGlobal.valor })
        : null,
      lineas: JSON.stringify(LINEAS.map(l => ({
        descripcion:  l.descripcion,
        cantidad:     l.cantidad,
        precio:       l.precio,
        iva:          l.iva,
        descuento:    l.descuento  ?? '',
        codigo:       l.codigo     ?? '',
        coeficiente:  l.coeficiente?? '',
        producto_id:  l.producto_id || null,
      }))),
      notas: notasVal,
    };

    const plantillaId = document.getElementById('naPlantillaSel')?.value || null;

    let err;
    if (editandoId) {
      /* Al editar: no tocamos factura_id ni numero (por si proviene de presupuesto) */
      const updatePayload = { ...payload };
      delete updatePayload.numero; // no sobreescribir el número de presupuesto original
      if (plantillaId) updatePayload.plantilla_id = plantillaId;
      ({ error: err } = await supabase.from('presupuestos').update(updatePayload).eq('id', editandoId));
      if (err?.message?.includes('plantilla_id') || err?.message?.includes('schema cache')) {
        delete updatePayload.plantilla_id;
        ({ error: err } = await supabase.from('presupuestos').update(updatePayload).eq('id', editandoId));
      }
    } else {
      if (plantillaId) payload.plantilla_id = plantillaId;
      ({ error: err } = await supabase.from('presupuestos').insert(payload));
      if (err?.message?.includes('plantilla_id') || err?.message?.includes('schema cache')) {
        delete payload.plantilla_id;
        ({ error: err } = await supabase.from('presupuestos').insert(payload));
      }
    }

    if (err) {
      toast('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Actualizar albarán' : 'Guardar albarán'; }
      return;
    }

    await _descontarStockSiProcede();
    toast(editandoId ? 'Albarán actualizado ✅' : `Albarán ${albaran_numero} creado ✅`, 'success');
    _resetForm();
    await refreshAlbaranes();
    switchView('albaranes');

  } catch (fatalErr) {
    console.error('[nuevo-albaran] _save error:', fatalErr);
    toast('Error inesperado: ' + fatalErr.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = editandoId ? 'Actualizar albarán' : 'Guardar albarán'; }
  }
}

/* ══════════════════════════════════════════════════════
   CARGAR PARA EDITAR
   Llamado desde albaranes.js: window._editAlbaran(id)
══════════════════════════════════════════════════════ */
export async function cargarAlbaranParaEditar(id) {
  const { data: a, error } = await supabase.from('presupuestos').select('*').eq('id', id).single();
  if (error || !a) { toast('Albarán no encontrado', 'error'); return; }
  if (a.factura_id) { toast('No se puede editar un albarán ya facturado', 'error'); return; }

  editandoId = id;
  _resetForm(false);  /* limpia el form sin tocar editandoId */

  /* Número */
  const numEl = document.getElementById('naNumeroDisplay');
  if (numEl) numEl.textContent = a.albaran_numero || '';
  const titEl = document.getElementById('naTitulo');
  if (titEl) titEl.textContent = `Editar ${a.albaran_numero || 'albarán'}`;
  const btnEl = document.getElementById('naGuardarBtn');
  if (btnEl) btnEl.textContent = 'Actualizar albarán';

  /* Si este albarán proviene de un presupuesto, mostrar aviso */
  const avisoEl = document.getElementById('naAvisoPresupuesto');
  if (avisoEl) {
    if (a.numero) {
      avisoEl.style.display = '';
      avisoEl.innerHTML = `<span style="font-size:15px">ℹ️</span><span>Este albarán fue generado desde el <strong>presupuesto ${a.numero}</strong>. Los cambios aquí no modifican el presupuesto original.</span>`;
    } else {
      avisoEl.style.display = 'none';
    }
  }

  /* Campos simples */
  const f = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
  f('naConcepto',              a.concepto);
  f('naFecha',                 a.fecha);
  f('naFechaEntrega',          a.albaran_fecha || a.fecha_aceptacion || a.fecha);
  f('naClienteNombre',         a.cliente_nombre);
  f('naClienteNif',            a.cliente_nif);
  f('naClienteEmail',          a.cliente_email);
  f('naClienteDireccion',      a.cliente_direccion);
  f('naNotas',                 a.notas);

  if (a.cliente_id) {
    clienteSelId = a.cliente_id;
    const ci = document.getElementById('naClienteSearch');
    if (ci) ci.value = a.cliente_nombre || '';
    const lm = document.getElementById('naClienteLimpiar');
    if (lm) lm.style.display = '';
    document.getElementById('naClientePanel')?.classList.add('cliente-panel--filled');
  }

  /* Tipo de operación */
  opTipo = a.tipo_operacion || 'nacional';
  document.querySelectorAll('.na-op-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.op === opTipo);
  });
  _updateOpUI();

  /* Descuento global */
  if (a.descuento_global) {
    try {
      const dto = typeof a.descuento_global === 'string'
        ? JSON.parse(a.descuento_global)
        : a.descuento_global;
      _dtoGlobal = { tipo: dto.tipo || 'pct', valor: dto.valor || 0 };
      _showDtoGlobal();
    } catch (_) {}
  }

  /* Plantilla */
  const sel = document.getElementById('naPlantillaSel');
  if (sel && a.plantilla_id) {
    const opt = sel.querySelector(`option[value="${a.plantilla_id}"]`);
    if (opt) {
      sel.value = a.plantilla_id;
    } else {
      setTimeout(() => {
        const o = sel.querySelector(`option[value="${a.plantilla_id}"]`);
        if (o) sel.value = a.plantilla_id;
      }, 400);
    }
  }

  /* Líneas */
  const lineas = a.lineas
    ? (typeof a.lineas === 'string' ? JSON.parse(a.lineas) : a.lineas)
    : [];
  lineas.forEach(l => _addLinea(l));
  _calcTotales();

  switchView('nuevo-albaran');
}

/* ══════════════════════════════════════════════════════
   RESET DEL FORMULARIO
══════════════════════════════════════════════════════ */
function _resetForm(clearEditing = true) {
  if (clearEditing) editandoId = null;

  clienteSelId = null;
  LINEAS       = [];
  lineaIdCnt   = 0;

  const c = document.getElementById('naLineasContainer');
  if (c) c.innerHTML = '';

  [
    'naClienteNombre', 'naClienteNombreComercial', 'naClienteNif',
    'naClienteEmail',  'naClienteTel',              'naClienteDireccion',
    'naClienteCiudad', 'naClienteProvincia',        'naClienteCp',
    'naConcepto',      'naNotas',                   'naMotivoExencion',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const ps = document.getElementById('naClientePais'); if (ps) ps.value = 'ES';
  const tp = document.getElementById('naClienteTipo'); if (tp) tp.value = 'empresa';
  document.getElementById('naClientePanel')?.classList.remove('cliente-panel--filled');

  const fe = document.getElementById('naFecha');         if (fe) fe.value = new Date().toISOString().slice(0, 10);
  const fv = document.getElementById('naFechaEntrega');  if (fv) fv.value = '';
  const ci = document.getElementById('naClienteSearch'); if (ci) ci.value = '';
  const lm = document.getElementById('naClienteLimpiar'); if (lm) lm.style.display = 'none';

  const ti = document.getElementById('naTitulo');      if (ti) ti.textContent = 'Nuevo albarán';
  const bt = document.getElementById('naGuardarBtn');  if (bt) { bt.disabled = false; bt.textContent = 'Guardar albarán'; }
  const nd = document.getElementById('naNumeroDisplay'); if (nd) nd.textContent = '';

  const av = document.getElementById('naAvisoPresupuesto'); if (av) av.style.display = 'none';

  /* Descuento global */
  _dtoGlobal = { tipo: 'pct', valor: 0 };
  const dw = document.getElementById('naDtoGlobalWrap'); if (dw) dw.style.display = 'none';

  /* Tipo de operación → nacional */
  opTipo = 'nacional';
  document.querySelectorAll('.na-op-btn').forEach(b => b.classList.toggle('active', b.dataset.op === 'nacional'));
  _updateOpUI();

  /* Columnas y líneas */
  _cols = [..._DEFAULT_COLS];
  _applyHeader();
  _addLinea();
  _calcTotales();
}

/* ══════════════════════════════════════════════════════
   UI: DESCUENTO GLOBAL
══════════════════════════════════════════════════════ */
function _showDtoGlobal() {
  const wrap   = document.getElementById('naDtoGlobalWrap');
  if (!wrap) return;
  wrap.style.display = '';
  const input  = document.getElementById('naDtoGlobalInput');
  const select = document.getElementById('naDtoGlobalTipo');
  if (input)  input.value  = _dtoGlobal.valor || '';
  if (select) select.value = _dtoGlobal.tipo  || 'pct';
  input?.focus();
}

function _hideDtoGlobal() {
  const wrap = document.getElementById('naDtoGlobalWrap');
  if (wrap) wrap.style.display = 'none';
  _dtoGlobal = { tipo: 'pct', valor: 0 };
  _calcTotales();
}

function _initDtoGlobal() {
  const btn    = document.getElementById('naAddDtoGlobalBtn');
  const input  = document.getElementById('naDtoGlobalInput');
  const select = document.getElementById('naDtoGlobalTipo');
  const remove = document.getElementById('naDtoGlobalRemove');
  if (!btn) return;
  btn.addEventListener('click', () => _showDtoGlobal());
  const _oc = () => {
    _dtoGlobal.tipo  = select?.value || 'pct';
    _dtoGlobal.valor = parseFloat(input?.value) || 0;
    _calcTotales();
  };
  input?.addEventListener('input',  _oc);
  input?.addEventListener('change', _oc);
  select?.addEventListener('change', _oc);
  remove?.addEventListener('click',  () => _hideDtoGlobal());
}

/* ══════════════════════════════════════════════════════
   INIT  (idempotente — solo registra listeners una vez)
══════════════════════════════════════════════════════ */
let _initDone = false;

export function initNuevoAlbaran() {
  /* Fecha por defecto */
  const fe = document.getElementById('naFecha');
  if (fe && !fe.value) fe.value = new Date().toISOString().slice(0, 10);

  // Inyectar selector de sede tras el campo "Nº albarán (auto)"
  try {
    const numField = document.getElementById("naNumeroDisplay")?.closest(".ff-field");
    const sedeHTML = renderSedeSelector({ inputId: "naSedeId", wrapperClass: "ff-field" });
    if (numField && sedeHTML && !document.getElementById("naSedeId")) {
      numField.insertAdjacentHTML("afterend", sedeHTML);
    }
  } catch (e) { console.warn("[nuevo-albaran sede]", e); }

  if (!_initDone) {
    _initDone = true;

    _initClienteSearch();
    _initDtoGlobal();
    _initPlantillaSel();

    document.getElementById('naAddLineaBtn')?.addEventListener('click', () => _addLinea());
    document.getElementById('naGuardarBtn')?.addEventListener('click',  () => _save());
    document.getElementById('naCancelarBtn')?.addEventListener('click', () => {
      _resetForm();
      switchView('albaranes');
    });

    /* Tipo de operación */
    document.querySelectorAll('.na-op-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.na-op-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        opTipo = btn.dataset.op;
        _updateOpUI();
        const sinIva = OP_SIN_IVA.includes(opTipo);
        if (sinIva) {
          LINEAS.forEach(l => { l.iva = 0; });
          document.querySelectorAll('#naLineasContainer [data-field="iva"]').forEach(s => {
            s.value = '0';
            s.disabled = true;
          });
        } else {
          document.querySelectorAll('#naLineasContainer [data-field="iva"]').forEach(s => {
            s.disabled = false;
          });
        }
        _calcTotales();
      });
    });
  }

  _updateOpUI();
  if (LINEAS.length === 0) _addLinea();
  _applyHeader();
  _calcTotales();
}
