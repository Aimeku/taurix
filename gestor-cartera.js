/* ═══════════════════════════════════════════════════════
   TAURIX · gestor/cartera.js

   Carga datos de toda la cartera del gestor.
   Una sola query para todas las facturas de todos
   los clientes — sin bucles N+1.

   loadCarteraGestor() devuelve:
   [{
     empresa_id, nombre_cliente, email_cliente, nif,
     facturacion_trim, gastos_trim, iva_estimado,
     irpf_estimado, pendiente_cobro,
     facturas_emitidas_count, gastos_count, sin_nif,
     gestor_revisado, ultimo_acceso,
     semaforo: 'verde'|'amarillo'|'rojo',
     alertas: string[]
   }]
   ═══════════════════════════════════════════════════════ */

import { supabase }   from './supabase.js';
import { getYear, getTrim, getFechaRango } from './utils.js';
import { getGestorUserId, getCarteraCache, setCarteraCache } from './gestor-store.js';
import { calcularScoreFiscal } from './gestor-score.js';

const ORDEN_SEMAFORO = { rojo: 0, amarillo: 1, verde: 2 };

/**
 * Carga y calcula los datos de toda la cartera.
 * @param {boolean} forzar  Ignorar cache y recargar desde BD
 */
export async function loadCarteraGestor(forzar = false) {
  if (!forzar) {
    const cached = getCarteraCache();
    if (cached) return cached;
  }

  const gestorId = getGestorUserId();
  if (!gestorId) return [];

  const year = getYear();
  const trim = getTrim();
  const { ini, fin } = getFechaRango(year, trim);

  /* ── 1. Clientes del gestor (dos fuentes) ── */
  const [gcRes, colabRes] = await Promise.all([
    supabase.from('gestor_clients')
      .select('empresa_id, nombre_cliente, email_cliente, ultimo_acceso_cliente')
      .eq('gestor_user_id', gestorId)
      .eq('activo', true),

    supabase.from('colaboradores')
      .select('owner_id, nombre, email, ultima_actividad')
      .eq('colaborador_id', gestorId)
      .eq('estado', 'activo'),
  ]);

  // Construir lista base unificada
  let clientesBase = (gcRes.data || []).map(c => ({
    empresa_id:     c.empresa_id,
    nombre_cliente: c.nombre_cliente,
    email_cliente:  c.email_cliente,
    ultimo_acceso:  c.ultimo_acceso_cliente,
    origen:         'gc',
  }));

  // Añadir los de colaboradores que aún no estén en gestor_clients
  const gcEmpresaIds = new Set(clientesBase.map(c => c.empresa_id));
  const colabs = colabRes.data || [];

  if (colabs.length > 0) {
    const ownerIds = [...new Set(colabs.map(c => c.owner_id).filter(Boolean))];
    if (ownerIds.length > 0) {
      const { data: emprs } = await supabase.from('empresas')
        .select('id, nombre, nif, user_id')
        .in('user_id', ownerIds);

      const empByOwner = {};
      (emprs || []).forEach(e => { empByOwner[e.user_id] = e; });

      for (const c of colabs) {
        const e = empByOwner[c.owner_id];
        if (!e || gcEmpresaIds.has(e.id)) continue;
        clientesBase.push({
          empresa_id:     e.id,
          nombre_cliente: c.nombre || c.email || e.nombre || '(sin nombre)',
          email_cliente:  c.email,
          nif:            e.nif,
          ultimo_acceso:  c.ultima_actividad,
          origen:         'colab',
        });
      }
    }
  }

  if (clientesBase.length === 0) {
    setCarteraCache([]);
    return [];
  }

  /* ── 2. Una query para todas las facturas del trimestre ── */
  const empresaIds = clientesBase.map(c => c.empresa_id).filter(Boolean);

  const [trimRes, cobrosRes, cierresRes, solicitudesRes] = await Promise.all([
    // Facturas del trimestre (emitidas + recibidas)
    supabase.from('facturas')
      .select('empresa_id, tipo, base, iva, cobrada, cliente_nif')
      .in('empresa_id', empresaIds)
      .gte('fecha', ini)
      .lte('fecha', fin),

    // Facturas pendientes de cobro (sin límite de fecha)
    supabase.from('facturas')
      .select('empresa_id, base, iva')
      .in('empresa_id', empresaIds)
      .eq('tipo', 'emitida')
      .eq('cobrada', false),

    // Estado de revisión del gestor en este trimestre
    supabase.from('cierres_trimestrales')
      .select('empresa_id, gestor_revisado_en, modelo_303_ok, modelo_130_ok')
      .in('empresa_id', empresaIds)
      .eq('year', year)
      .eq('trimestre', trim),

    // Solicitudes pendientes por empresa
    supabase.from('solicitudes_documentos')
      .select('empresa_id')
      .in('empresa_id', empresaIds)
      .eq('estado', 'pendiente'),
  ]);

  const facturasRaw = trimRes.data       || [];
  const cobrosRaw   = cobrosRes.data     || [];
  const cierresRaw  = cierresRes.data    || [];
  const solicRaw    = solicitudesRes.data || [];

  // Indexar por empresa_id → O(1) lookup
  const facPorEmpresa    = _agrupar(facturasRaw);
  const cobrosPorEmpresa = _agrupar(cobrosRaw);
  const cierrePorEmpresa = {};
  cierresRaw.forEach(c => { cierrePorEmpresa[c.empresa_id] = c; });
  const solicPorEmpresa  = {};
  solicRaw.forEach(s => {
    solicPorEmpresa[s.empresa_id] = (solicPorEmpresa[s.empresa_id] || 0) + 1;
  });

  /* ── 3. Calcular métricas por cliente ── */
  const resultado = clientesBase.map(cliente => {
    const facs     = facPorEmpresa[cliente.empresa_id]    || [];
    const cobros   = cobrosPorEmpresa[cliente.empresa_id] || [];
    const cierre   = cierrePorEmpresa[cliente.empresa_id] || null;

    const emitidas  = facs.filter(f => f.tipo === 'emitida');
    const recibidas = facs.filter(f => f.tipo === 'recibida');

    const facturacion_trim = _sumaBase(emitidas);
    const gastos_trim      = _sumaBase(recibidas);

    const ivaRep = emitidas.reduce( (s, f) => s + (f.base||0)*(f.iva||0)/100, 0);
    const ivaSop = recibidas.reduce((s, f) => s + (f.base||0)*(f.iva||0)/100, 0);
    const iva_estimado  = ivaRep - ivaSop;
    const irpf_estimado = Math.max(0, (facturacion_trim - gastos_trim) * 0.20);
    const pendiente_cobro = cobros.reduce(
      (s, f) => s + (f.base||0) * (1 + (f.iva||0)/100), 0
    );

    const sin_nif = emitidas.filter(f => !f.cliente_nif?.trim()).length;

    const alertas = _alertas({
      emitidas, recibidas, sin_nif, iva_estimado,
      facturacion_trim, ultimo_acceso: cliente.ultimo_acceso,
    });

    const { score: score_fiscal, estado: estado_fiscal, motivos: score_motivos } =
      calcularScoreFiscal({
        facturacion_trim,
        gastos_trim,
        iva_estimado,
        alertas,
        solicitudes_pendientes: solicPorEmpresa[cliente.empresa_id] || 0,
        facturas_emitidas_count: emitidas.length,
      });

    return {
      empresa_id:              cliente.empresa_id,
      nombre_cliente:          cliente.nombre_cliente || '(sin nombre)',
      email_cliente:           cliente.email_cliente  || '',
      nif:                     cliente.nif            || '',
      ultimo_acceso:           cliente.ultimo_acceso,
      facturacion_trim,
      gastos_trim,
      iva_estimado,
      irpf_estimado,
      pendiente_cobro,
      facturas_emitidas_count: emitidas.length,
      gastos_count:            recibidas.length,
      sin_nif,
      solicitudes_pendientes:  solicPorEmpresa[cliente.empresa_id] || 0,
      gestor_revisado:         !!cierre?.gestor_revisado_en,
      modelo_303_ok:           !!cierre?.modelo_303_ok,
      semaforo:                _semaforo({ emitidas, recibidas, alertas, cierre }),
      alertas,
      score_fiscal,
      estado_fiscal,
      score_motivos,
    };
  });

  resultado.sort(
    (a, b) => (ORDEN_SEMAFORO[a.semaforo]??1) - (ORDEN_SEMAFORO[b.semaforo]??1)
  );

  setCarteraCache(resultado);
  return resultado;
}

/* ── helpers ── */

function _agrupar(rows) {
  return rows.reduce((acc, r) => {
    if (!r.empresa_id) return acc;
    (acc[r.empresa_id] ??= []).push(r);
    return acc;
  }, {});
}

function _sumaBase(facs) {
  return facs.reduce((s, f) => s + (f.base || 0), 0);
}

function _alertas({ emitidas, recibidas, sin_nif, iva_estimado, facturacion_trim, ultimo_acceso }) {
  const out = [];
  if (emitidas.length === 0 && recibidas.length === 0)
    out.push('Sin actividad en el trimestre');
  if (emitidas.length > 0 && recibidas.length === 0)
    out.push('Sin gastos registrados');
  if (sin_nif > 0)
    out.push(`${sin_nif} factura${sin_nif > 1 ? 's' : ''} sin NIF`);
  if (facturacion_trim > 0 && iva_estimado > facturacion_trim * 0.25)
    out.push('IVA estimado inusualmente alto');
  if (ultimo_acceso) {
    const dias = Math.floor((Date.now() - new Date(ultimo_acceso)) / 86400000);
    if (dias > 30) out.push(`Cliente inactivo hace ${dias} días`);
  }
  return out;
}

function _semaforo({ emitidas, recibidas, alertas, cierre }) {
  const criticas = alertas.filter(a =>
    a.includes('Sin actividad') || a.includes('sin NIF') ||
    a.includes('IVA estimado inusualmente alto')
  );
  if (criticas.length > 0) return 'rojo';
  if (emitidas.length > 0 && recibidas.length > 0 && cierre?.gestor_revisado_en)
    return 'verde';
  return 'amarillo';
}
