/* ═══════════════════════════════════════════════════════
   TAURIX · nordigen.js
   
   Conexión bancaria automática via GoCardless/Nordigen
   (antes Nordigen, ahora GoCardless Bank Account Data)
   
   · Gratuito hasta 50 conexiones/mes
   · Cubre +2.000 bancos europeos (BBVA, Santander,
     CaixaBank, Bankinter, ING, Sabadell, Openbank...)
   · PSD2 compliant — acceso con consentimiento del usuario
   · Los movimientos se sincronizan automáticamente
   
   API docs: https://bankaccountdata.gocardless.com/docs/
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

/* ══════════════════════════
   CONFIG
   Necesitas crear una cuenta gratuita en:
   https://bankaccountdata.gocardless.com/
   y guardar SECRET_ID y SECRET_KEY en Supabase secrets
   o en variables de entorno de tu edge function.
══════════════════════════ */

// Base URL de tu Edge Function de Supabase que hace proxy a Nordigen
// (necesario para no exponer las API keys en el frontend)
const NORDIGEN_PROXY = "https://biiyzjzdvuahajndltap.supabase.co/functions/v1/nordigen";

/* ══════════════════════════
   BANCOS ESPAÑOLES
   (subset de los más usados)
══════════════════════════ */
const BANCOS_ES = [
  { id:"BBVA_BBVAESMM",        nombre:"BBVA",              logo:"🏦", bic:"BBVAESMM" },
  { id:"SANTANDER_BSCHESMMXXX",nombre:"Santander",         logo:"🏦", bic:"BSCHESMMXXX" },
  { id:"CAIXABANK_CAIXESBBXXX",nombre:"CaixaBank",         logo:"🏦", bic:"CAIXESBBXXX" },
  { id:"BANKINTER_BKBKESMM",   nombre:"Bankinter",         logo:"🏦", bic:"BKBKESMM" },
  { id:"SABADELL_BSABESBBXXX", nombre:"Banco Sabadell",    logo:"🏦", bic:"BSABESBBXXX" },
  { id:"ING_INGDESFFXXX",      nombre:"ING",               logo:"🏦", bic:"INGDESFFXXX" },
  { id:"OPENBANK_OPENESMMXXX", nombre:"Openbank",          logo:"🏦", bic:"OPENESMMXXX" },
  { id:"UNICAJA_UCJAES2MXXX",  nombre:"Unicaja",           logo:"🏦", bic:"UCJAES2MXXX" },
  { id:"IBERCAJA_CAZRES2ZXXX", nombre:"Ibercaja",          logo:"🏦", bic:"CAZRES2ZXXX" },
  { id:"KUTXABANK_BASKES2BXXX",nombre:"Kutxabank",         logo:"🏦", bic:"BASKES2BXXX" },
  { id:"ABANCA_ABNAES2GXXX",   nombre:"Abanca",            logo:"🏦", bic:"ABNAES2GXXX" },
  { id:"CAJAMAR_CCRIES2AXXX",  nombre:"Cajamar",           logo:"🏦", bic:"CCRIES2AXXX" },
  { id:"REVOLUT_REVOLT21XXX",  nombre:"Revolut",           logo:"💜", bic:"REVOLT21XXX" },
  { id:"WISE_TRWIBEB1XXX",     nombre:"Wise",              logo:"💚", bic:"TRWIBEB1XXX" },
];

/* ══════════════════════════
   CUENTAS CONECTADAS
══════════════════════════ */
export async function loadConexionesBancarias() {
  const { data, error } = await supabase.from("conexiones_bancarias")
    .select("*").eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false });
  if (error) { console.error("conexiones bancarias:", error.message); return []; }
  return data || [];
}

/* ══════════════════════════
   SINCRONIZAR MOVIMIENTOS
══════════════════════════ */
export async function sincronizarMovimientos(conexionId) {
  const btn = document.getElementById(`syncBtn_${conexionId}`);
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Sincronizando…"; }

  try {
    const { data: conexion } = await supabase.from("conexiones_bancarias")
      .select("*").eq("id", conexionId).single();
    if (!conexion) throw new Error("Conexión no encontrada");

    // Llamar al proxy de Edge Function
    const resp = await fetch(`${NORDIGEN_PROXY}/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        requisition_id: conexion.requisition_id,
        account_id:     conexion.account_id_nordigen,
        fecha_desde:    conexion.ultima_sincronizacion || new Date(Date.now() - 90*86400000).toISOString().slice(0,10)
      })
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.message || `Error ${resp.status}`);
    }

    const { transactions } = await resp.json();
    let nuevos = 0, duplicados = 0;

    for (const tx of (transactions?.booked || [])) {
      // Evitar duplicados por ID de transacción
      const { data: existe } = await supabase.from("movimientos_bancarios")
        .select("id").eq("user_id", SESSION.user.id)
        .eq("nordigen_id", tx.transactionId).limit(1);

      if (existe?.length) { duplicados++; continue; }

      await supabase.from("movimientos_bancarios").insert({
        user_id:       SESSION.user.id,
        cuenta_id:     conexion.cuenta_bancaria_id,
        cuenta_nombre: conexion.nombre_banco,
        fecha:         tx.bookingDate || tx.valueDate,
        descripcion:   tx.remittanceInformationUnstructured ||
                       tx.creditorName || tx.debtorName || "Sin descripción",
        importe:       parseFloat(tx.transactionAmount?.amount || 0),
        saldo:         tx.balanceAfterTransaction?.balanceAmount?.amount
                       ? parseFloat(tx.balanceAfterTransaction.balanceAmount.amount) : null,
        referencia:    tx.endToEndId || tx.transactionId,
        nordigen_id:   tx.transactionId,
        conciliado:    false,
      });
      nuevos++;
    }

    // Actualizar fecha última sincronización
    await supabase.from("conexiones_bancarias").update({
      ultima_sincronizacion: new Date().toISOString(),
      saldo_actual: transactions?.booked?.[0]?.balanceAfterTransaction?.balanceAmount?.amount
                    ? parseFloat(transactions.booked[0].balanceAfterTransaction.balanceAmount.amount) : undefined
    }).eq("id", conexionId);

    toast(`✅ Sincronizado: ${nuevos} movimientos nuevos · ${duplicados} ya existían`, "success", 5000);

    // Refrescar la vista
    const { refreshTesoreria } = await import("./tesoreria.js");
    await refreshTesoreria();

  } catch(e) {
    // Si el error es de consentimiento expirado, mostrar opción de reconectar
    if (e.message?.includes("expired") || e.message?.includes("EUA_expired")) {
      toast("El consentimiento bancario ha expirado. Necesitas reconectar tu banco.", "warn", 6000);
      document.getElementById(`reconnectBtn_${conexionId}`)?.classList.remove("hidden");
    } else {
      toast("Error al sincronizar: " + e.message, "error");
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Sincronizar"; }
  }
}

/* ══════════════════════════
   CONECTAR BANCO NUEVO
══════════════════════════ */
export function showConectarBancoModal() {
  openModal(`
    <div class="modal" style="max-width:620px">
      <div class="modal-hd">
        <span class="modal-title">🏦 Conectar banco automáticamente</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">

        <!-- Explicación PSD2 -->
        <div style="background:#eff6ff;border-radius:12px;padding:16px;margin-bottom:20px;display:flex;gap:12px">
          <div style="font-size:24px;flex-shrink:0">🔒</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#1d4ed8;margin-bottom:4px">Conexión segura PSD2 — Solo lectura</div>
            <div style="font-size:12px;color:#1e40af;line-height:1.6">
              Taurix se conecta a tu banco mediante GoCardless Bank Account Data, un servicio regulado por el Banco de España (PSD2). <strong>Solo tiene acceso de lectura</strong> — nunca puede hacer transferencias ni acceder a tus credenciales bancarias. El consentimiento dura 90 días y lo puedes revocar en cualquier momento.
            </div>
          </div>
        </div>

        <!-- Buscador de banco -->
        <div class="modal-field" style="margin-bottom:16px">
          <label>Busca tu banco</label>
          <input autocomplete="off" id="bancoBusqueda" class="ff-input" placeholder="🔍 BBVA, Santander, CaixaBank…"
                 oninput="window._filtrarBancos(this.value)"/>
        </div>

        <!-- Grid de bancos -->
        <div id="bancosGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:280px;overflow-y:auto">
          ${BANCOS_ES.map(b => `
            <div class="banco-card" data-id="${b.id}" data-nombre="${b.nombre}"
                 onclick="window._seleccionarBanco('${b.id}','${b.nombre}')"
                 style="border:1.5px solid var(--brd);border-radius:10px;padding:12px;cursor:pointer;text-align:center;transition:all .15s">
              <div style="font-size:22px;margin-bottom:6px">${b.logo}</div>
              <div style="font-size:12px;font-weight:600;color:var(--t1)">${b.nombre}</div>
            </div>`).join("")}
        </div>

        <!-- Banco seleccionado -->
        <div id="bancoSeleccionado" style="display:none;margin-top:16px;background:var(--bg2);border-radius:10px;padding:14px">
          <div style="font-size:13px;font-weight:700;margin-bottom:8px">Banco seleccionado: <span id="bancoSelNombre" style="color:var(--accent)"></span></div>
          <div style="font-size:12px;color:var(--t3);line-height:1.6">
            Al continuar se abrirá la página de autenticación de tu banco. Inicia sesión con tus credenciales bancarias normales y autoriza el acceso de lectura. Volverás a Taurix automáticamente.
          </div>
        </div>

        <!-- Estado de configuración -->
        <div id="nordigenConfigWarning" style="display:none;background:#fef9c3;border-radius:10px;padding:12px 16px;margin-top:12px">
          <div style="font-size:13px;font-weight:700;color:#854d0e;margin-bottom:6px">⚙️ Configuración necesaria</div>
          <div style="font-size:12px;color:#92400e;line-height:1.65">
            Para activar la conexión bancaria automática necesitas:
            <ol style="margin:8px 0 0 16px;padding:0">
              <li style="margin-bottom:4px">Crear una cuenta gratuita en <a href="https://bankaccountdata.gocardless.com" target="_blank" style="color:#1a56db">bankaccountdata.gocardless.com</a></li>
              <li style="margin-bottom:4px">Obtener tu <strong>SECRET_ID</strong> y <strong>SECRET_KEY</strong></li>
              <li style="margin-bottom:4px">Crear la Edge Function en Supabase (te la genero yo)</li>
              <li>Añadir las keys como secrets en tu proyecto Supabase</li>
            </ol>
            <button onclick="window._showNordigenSetupGuide()" class="btn-outline" style="margin-top:10px;font-size:12px">
              📖 Ver guía de configuración
            </button>
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="conectarBancoBtn" disabled>Conectar banco →</button>
      </div>
    </div>`);

  window._filtrarBancos = (q) => {
    const query = q.toLowerCase();
    document.querySelectorAll(".banco-card").forEach(card => {
      card.style.display = !query || card.dataset.nombre.toLowerCase().includes(query) ? "" : "none";
    });
  };

  let bancoSelId = null;
  window._seleccionarBanco = (id, nombre) => {
    bancoSelId = id;
    document.querySelectorAll(".banco-card").forEach(c => {
      c.style.borderColor = c.dataset.id === id ? "var(--accent)" : "var(--brd)";
      c.style.background  = c.dataset.id === id ? "rgba(26,86,219,.06)" : "";
    });
    const sel = document.getElementById("bancoSeleccionado");
    const nom = document.getElementById("bancoSelNombre");
    if (sel) sel.style.display = "";
    if (nom) nom.textContent = nombre;
    const btn = document.getElementById("conectarBancoBtn");
    if (btn) btn.disabled = false;
  };

  document.getElementById("conectarBancoBtn").addEventListener("click", async () => {
    if (!bancoSelId) return;
    await iniciarConexionBancaria(bancoSelId);
  });
}

async function iniciarConexionBancaria(institutionId) {
  const btn = document.getElementById("conectarBancoBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Conectando…"; }

  try {
    // Llamar a la Edge Function para crear el requisition
    const resp = await fetch(`${NORDIGEN_PROXY}/create-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
      },
      body: JSON.stringify({
        institution_id: institutionId,
        redirect_uri:   "https://taurix.es/?banco_conectado=1"
      })
    });

    if (!resp.ok) {
      // Edge function no configurada — mostrar guía
      document.getElementById("nordigenConfigWarning").style.display = "";
      if (btn) { btn.disabled = false; btn.textContent = "Conectar banco →"; }
      return;
    }

    const { link, requisition_id } = await resp.json();

    // Guardar el requisition pendiente
    await supabase.from("conexiones_bancarias").insert({
      user_id:        SESSION.user.id,
      institution_id: institutionId,
      requisition_id,
      estado:         "pendiente",
      created_at:     new Date().toISOString(),
    });

    // Redirigir al banco
    closeModal();
    window.open(link, "_blank");
    toast("Se ha abierto la página de tu banco. Autoriza el acceso y vuelve aquí.", "info", 8000);

  } catch(e) {
    document.getElementById("nordigenConfigWarning").style.display = "";
    if (btn) { btn.disabled = false; btn.textContent = "Conectar banco →"; }
  }
}

/* ══════════════════════════
   GUÍA DE CONFIGURACIÓN
══════════════════════════ */
window._showNordigenSetupGuide = () => {
  openModal(`
    <div class="modal" style="max-width:640px">
      <div class="modal-hd">
        <span class="modal-title">📖 Guía: Activar conexión bancaria</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <div style="font-size:13px;line-height:1.8;color:var(--t2)">
          <div style="font-weight:800;font-size:15px;color:var(--t1);margin-bottom:12px">Cómo configurar GoCardless Bank Account Data (gratis)</div>

          <div style="counter-reset:step">
            ${[
              { n:1, titulo:"Crear cuenta gratuita", desc:`Ve a <a href="https://bankaccountdata.gocardless.com/user/signup/" target="_blank" style="color:var(--accent)">bankaccountdata.gocardless.com</a> y regístrate. El plan gratuito incluye hasta 50 conexiones/mes, más que suficiente para un autónomo o pyme.` },
              { n:2, titulo:"Obtener las API keys", desc:`En el dashboard ve a <strong>User Secrets → Create new</strong>. Copia el <code style="background:var(--bg2);padding:1px 5px;border-radius:4px">SECRET_ID</code> y el <code style="background:var(--bg2);padding:1px 5px;border-radius:4px">SECRET_KEY</code>.` },
              { n:3, titulo:"Crear la Edge Function en Supabase", desc:`En tu panel de Supabase → Edge Functions → New Function. El código de la función está disponible en el repositorio de Taurix. Nómbrala <code style="background:var(--bg2);padding:1px 5px;border-radius:4px">nordigen</code>.` },
              { n:4, titulo:"Añadir las keys como Secrets", desc:`En Supabase → Settings → Edge Function Secrets, añade:<br><code style="background:var(--bg2);padding:2px 8px;border-radius:4px;display:inline-block;margin-top:4px">NORDIGEN_SECRET_ID = tu_secret_id<br>NORDIGEN_SECRET_KEY = tu_secret_key</code>` },
              { n:5, titulo:"Añadir tabla en Supabase", desc:`Ejecuta este SQL en tu SQL Editor:<br><code style="background:var(--bg2);padding:4px 8px;border-radius:4px;display:block;margin-top:4px;font-size:11px">ALTER TABLE movimientos_bancarios ADD COLUMN IF NOT EXISTS nordigen_id TEXT;</code>` },
            ].map(s => `
              <div style="display:flex;gap:12px;margin-bottom:16px">
                <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0">${s.n}</div>
                <div>
                  <div style="font-weight:700;margin-bottom:3px">${s.titulo}</div>
                  <div style="font-size:12px;color:var(--t3)">${s.desc}</div>
                </div>
              </div>`).join("")}
          </div>

          <div style="background:#f0fdf4;border-radius:10px;padding:12px 16px;margin-top:8px;font-size:12px;color:#166534">
            ✅ Una vez configurado, los movimientos de todos los bancos conectados se sincronizarán automáticamente cada vez que abras Taurix.
          </div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        <a href="https://bankaccountdata.gocardless.com/user/signup/" target="_blank" class="btn-modal-save" style="text-decoration:none;display:flex;align-items:center;gap:6px">
          🔗 Ir a GoCardless
        </a>
      </div>
    </div>`);
};

/* ══════════════════════════
   RENDER CONEXIONES
══════════════════════════ */
export async function refreshConexionesBancarias() {
  const conexiones = await loadConexionesBancarias();

  const wrap = document.getElementById("conexionesBancariasWrap");
  if (!wrap) return;

  if (!conexiones.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:32px;color:var(--t3)">
        <div style="font-size:40px;margin-bottom:12px">🏦</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Sin bancos conectados</div>
        <div style="font-size:12px;margin-bottom:16px">Conecta tu banco para que los movimientos se importen automáticamente cada día.</div>
        <button class="btn-primary" onclick="window._showConectarBanco()">+ Conectar mi banco</button>
      </div>`;
    return;
  }

  wrap.innerHTML = conexiones.map(c => {
    const banco  = BANCOS_ES.find(b => b.id === c.institution_id);
    const estado = { activo:"✅ Activo", pendiente:"⏳ Pendiente autorización", revocado:"❌ Revocado" }[c.estado] || c.estado;
    return `
      <div style="border:1px solid var(--brd);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:14px;margin-bottom:10px">
        <div style="font-size:28px">${banco?.logo || "🏦"}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${c.nombre_banco || banco?.nombre || c.institution_id}</div>
          <div style="font-size:12px;color:var(--t3)">
            ${estado} · Última sync: ${c.ultima_sincronizacion ? fmtDate(c.ultima_sincronizacion.slice(0,10)) : "Nunca"}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          ${c.estado === "activo" ? `
            <button class="btn-outline" id="syncBtn_${c.id}" onclick="window._sincronizar('${c.id}')" style="font-size:12px">
              🔄 Sincronizar
            </button>` : c.estado === "pendiente" ? `
            <button class="btn-outline" style="font-size:12px" onclick="window._showConectarBanco()">
              Reconectar
            </button>` : ""}
          <button class="ta-btn ta-del" onclick="window._desconectarBanco('${c.id}')" title="Desconectar">🗑️</button>
        </div>
      </div>`;
  }).join("");

  // Añadir botón de conectar otro banco
  wrap.innerHTML += `
    <button class="btn-outline" onclick="window._showConectarBanco()" style="width:100%;margin-top:4px;font-size:13px">
      + Conectar otro banco
    </button>`;
}

window._showConectarBanco   = () => showConectarBancoModal();
window._sincronizar         = (id) => sincronizarMovimientos(id);
window._desconectarBanco    = async (id) => {
  await supabase.from("conexiones_bancarias").update({ estado:"revocado" }).eq("id", id);
  toast("Banco desconectado", "success");
  await refreshConexionesBancarias();
};

/* ══════════════════════════
   AUTO-SYNC AL ARRANCAR
   Si hay conexiones activas y no se ha sincronizado hoy
══════════════════════════ */
export async function autoSyncBancos() {
  if (!SESSION) return;
  const conexiones = await loadConexionesBancarias();
  const activas = conexiones.filter(c => c.estado === "activo");
  const hoy = new Date().toISOString().slice(0, 10);

  for (const c of activas) {
    const ultimaSync = c.ultima_sincronizacion?.slice(0, 10);
    if (ultimaSync !== hoy) {
      // Sincronizar en background sin bloquear la UI
      sincronizarMovimientos(c.id).catch(() => {});
    }
  }
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initNordigenView() {
  document.getElementById("conectarBancoMainBtn")?.addEventListener("click", showConectarBancoModal);
  refreshConexionesBancarias();

  // Auto-sync en background
  autoSyncBancos();

  // Detectar vuelta del banco (redirect con ?banco_conectado=1)
  const params = new URLSearchParams(window.location.search);
  if (params.get("banco_conectado") === "1") {
    toast("🎉 ¡Banco autorizado! Sincronizando movimientos…", "success", 5000);
    // Limpiar el parámetro de la URL
    window.history.replaceState({}, "", window.location.pathname);
    // Intentar activar la conexión pendiente y sincronizar
    setTimeout(async () => {
      const conexiones = await loadConexionesBancarias();
      const pendiente = conexiones.find(c => c.estado === "pendiente");
      if (pendiente) {
        await supabase.from("conexiones_bancarias")
          .update({ estado:"activo" }).eq("id", pendiente.id);
        await sincronizarMovimientos(pendiente.id);
      }
    }, 2000);
  }
}
