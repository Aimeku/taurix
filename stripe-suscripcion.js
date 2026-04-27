/* ═══════════════════════════════════════════════════════════════════
   TAURIX · stripe-suscripcion.js
   Gestión completa de suscripciones en el frontend:
     · checkSubscription()    → guard de acceso a la app
     · showPlanSelector()     → overlay de selección de plan (primera vez)
     · renderPlanTab()        → HTML del tab "Plan" en Ajustes
     · initPlanTab()          → listeners del tab "Plan"
     · abrirPortalStripe()    → redirige al portal de Stripe
   ═══════════════════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { toast }    from "./utils.js";

const PROJECT_ID   = "biiyzjzdvuahajndltap";
const ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaXl6anpkdnVhaGFqbmRsdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjI5MzEsImV4cCI6MjA4NTQzODkzMX0.sm_0aKM08sduk3E0elmMaLRCuqlxgWulTp7Kx3WHc_4";
const EDGE_BASE    = `https://${PROJECT_ID}.supabase.co/functions/v1`;

/* ── Estados válidos para acceder a la app ── */
const VALID_STATUSES = ["trialing", "active", "past_due"];

/* ─────────────────────────────────────────────────────────────────
   checkSubscription
   Carga los datos de suscripción del usuario y decide si puede
   entrar a la app.
   Devuelve: { canAccess: boolean, subData: object | null }
───────────────────────────────────────────────────────────────── */
export async function checkSubscription(userId) {
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) console.warn("[stripe-suscripcion] Error cargando sub:", error.message);

  // Admin siempre entra
  if (sub?.is_admin) return { canAccess: true, subData: sub };

  // Sin registro o sin status válido → paywall
  if (!sub || !VALID_STATUSES.includes(sub.status)) {
    return { canAccess: false, subData: sub };
  }

  return { canAccess: true, subData: sub };
}

/* ─────────────────────────────────────────────────────────────────
   showPlanSelector
   Muestra el overlay de selección de plan (Autónomo / Sociedad).
   Se llama cuando el usuario no tiene suscripción activa.
   onSelect(plan) se ejecuta después de redirigir a Stripe.
───────────────────────────────────────────────────────────────── */
export function showPlanSelector(subData = null) {
  // Eliminar overlay previo si existe
  document.getElementById("planSelectorOverlay")?.remove();

  const esCancelado = subData?.status === "canceled";
  const esPastDue   = subData?.status === "past_due";

  const overlay = document.createElement("div");
  overlay.id = "planSelectorOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:var(--bg1,#f2f3f7);
    display:flex;flex-direction:column;align-items:center;
    justify-content:flex-start;padding:40px 16px 32px;
    overflow-y:auto;font-family:var(--font,system-ui,sans-serif);
  `;

  overlay.innerHTML = `
    <!-- Logo -->
    <img src="Logo_Sin_Texto_transparent.png"
      style="width:52px;height:52px;border-radius:14px;margin-bottom:24px" alt="Taurix"/>

    <!-- Título -->
    ${esCancelado ? `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 20px;margin-bottom:24px;text-align:center">
        <p style="font-size:13px;font-weight:700;color:#991b1b;margin:0 0 4px">Tu suscripción está cancelada</p>
        <p style="font-size:12.5px;color:#7f1d1d;margin:0">Elige un plan para volver a tener acceso</p>
      </div>
    ` : esPastDue ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 20px;margin-bottom:24px;text-align:center">
        <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 4px">Hay un problema con tu pago</p>
        <p style="font-size:12.5px;color:#78350f;margin:0">Actualiza tu método de pago para continuar</p>
      </div>
    ` : `
      <h1 style="font-size:22px;font-weight:800;color:var(--t1,#0d0f16);margin:0 0 8px;text-align:center">
        Elige tu plan
      </h1>
      <p style="font-size:14px;color:var(--t3,#6b7280);margin:0 0 32px;text-align:center;max-width:360px;line-height:1.5">
        7 días de prueba gratuita. Sin cargo hasta que termine el periodo de prueba.
        Cancela cuando quieras.
      </p>
    `}

    <!-- Tarjetas de planes -->
    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;width:100%;max-width:640px;margin-bottom:32px">

      <!-- Plan Autónomo -->
      <div class="plan-card" id="planCardAutonomo" data-plan="autonomo"
        style="flex:1;min-width:240px;max-width:290px;border:2px solid var(--brd,#e5e7eb);
               border-radius:16px;padding:28px 24px;cursor:pointer;background:var(--srf,#fff);
               transition:border-color .15s,box-shadow .15s;position:relative">
        <div style="font-size:13px;font-weight:700;color:var(--ox,#f97316);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">
          Autónomo
        </div>
        <div style="font-size:28px;font-weight:800;color:var(--t1,#0d0f16);margin-bottom:4px" id="planPrecioAutonomo">
          —
        </div>
        <div style="font-size:12px;color:var(--t3,#6b7280);margin-bottom:20px">por mes + IVA</div>
        <ul style="list-style:none;padding:0;margin:0 0 24px;display:flex;flex-direction:column;gap:10px">
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Facturas, presupuestos y albaranes
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Modelos 130, 303 y 390
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            IRPF y gastos deducibles
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Régimen de autónomos
          </li>
        </ul>
        <button class="plan-select-btn" data-plan="autonomo"
          style="width:100%;padding:12px;background:var(--ox,#f97316);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;transition:opacity .15s">
          Empezar 7 días gratis
        </button>
      </div>

      <!-- Plan Sociedad -->
      <div class="plan-card" id="planCardSociedad" data-plan="sociedad"
        style="flex:1;min-width:240px;max-width:290px;border:2px solid var(--brd,#e5e7eb);
               border-radius:16px;padding:28px 24px;cursor:pointer;background:var(--srf,#fff);
               transition:border-color .15s,box-shadow .15s;position:relative">
        <div style="font-size:13px;font-weight:700;color:var(--ox,#f97316);margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">
          Sociedad
        </div>
        <div style="font-size:28px;font-weight:800;color:var(--t1,#0d0f16);margin-bottom:4px" id="planPrecioSociedad">
          —
        </div>
        <div style="font-size:12px;color:var(--t3,#6b7280);margin-bottom:20px">por mes + IVA</div>
        <ul style="list-style:none;padding:0;margin:0 0 24px;display:flex;flex-direction:column;gap:10px">
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Todo lo del plan Autónomo
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Contabilidad y libro diario
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            Impuesto de Sociedades
          </li>
          <li style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--t2,#374151)">
            <span style="color:var(--ox,#f97316);font-weight:700;flex-shrink:0">✓</span>
            SL, SA y otras formas jurídicas
          </li>
        </ul>
        <button class="plan-select-btn" data-plan="sociedad"
          style="width:100%;padding:12px;background:var(--ox,#f97316);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;transition:opacity .15s">
          Empezar 7 días gratis
        </button>
      </div>

    </div>

    <!-- Nota legal -->
    <p style="font-size:11px;color:var(--t4,#9ca3af);text-align:center;max-width:400px;line-height:1.6;margin:0">
      Al continuar aceptas los <a href="#" onclick="document.getElementById('openTerminos')?.click();return false"
      style="color:var(--ox,#f97316);text-decoration:none">Términos de servicio</a>.
      No se realizará ningún cargo hasta el día 8. Cancela en cualquier momento desde Ajustes.
    </p>

    <!-- Spinner de carga (oculto) -->
    <div id="planSelectorSpinner" style="display:none;margin-top:24px;text-align:center">
      <div style="width:32px;height:32px;border:3px solid var(--brd);border-top-color:var(--ox,#f97316);
                  border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px"></div>
      <p style="font-size:13px;color:var(--t3)">Redirigiendo a la pasarela de pago…</p>
    </div>

    <!-- Error -->
    <div id="planSelectorError" style="display:none;margin-top:16px;background:#fef2f2;
      border:1px solid #fecaca;border-radius:10px;padding:10px 16px;font-size:13px;color:#991b1b;text-align:center;max-width:400px">
    </div>

    <style>
      @keyframes spin { to { transform: rotate(360deg); } }
      .plan-card:hover {
        border-color: var(--ox, #f97316) !important;
        box-shadow: 0 4px 20px rgba(249,115,22,.12);
      }
      .plan-select-btn:hover { opacity: .88; }
    </style>
  `;

  document.body.appendChild(overlay);

  // ── Cargar precios desde Stripe (si los tienes publicados en metadata) ──
  // Por ahora se muestran "—" hasta que los configures en Stripe Products.
  // Si quieres mostrar precios fijos, cámbialos aquí:
  document.getElementById("planPrecioAutonomo").textContent = "19€";
  document.getElementById("planPrecioSociedad").textContent = "29€";

  // ── Eventos de los botones ────────────────────────────────────
  overlay.querySelectorAll(".plan-select-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const plan = btn.dataset.plan;
      await _iniciarCheckout(plan);
    });
  });

  // Click en la tarjeta también activa
  overlay.querySelectorAll(".plan-card").forEach(card => {
    card.addEventListener("click", async () => {
      const plan = card.dataset.plan;
      await _iniciarCheckout(plan);
    });
  });
}

/* ─────────────────────────────────────────────────────────────────
   _iniciarCheckout  (privado)
───────────────────────────────────────────────────────────────── */
async function _iniciarCheckout(plan) {
  const btns    = document.querySelectorAll(".plan-select-btn");
  const spinner = document.getElementById("planSelectorSpinner");
  const errEl   = document.getElementById("planSelectorError");

  btns.forEach(b => { b.disabled = true; b.style.opacity = ".5"; });
  if (spinner) spinner.style.display = "";
  if (errEl)   errEl.style.display   = "none";

  try {
    const session  = await supabase.auth.getSession();
    const token    = session.data.session?.access_token;

    const resp = await fetch(`${EDGE_BASE}/create-checkout-session`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey":        ANON_KEY,
      },
      body: JSON.stringify({ plan }),
    });

    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || "Error creando sesión de pago");

    // Redirigir a Stripe Checkout
    window.location.href = data.url;

  } catch (err) {
    console.error("[planSelector] Error:", err);
    btns.forEach(b => { b.disabled = false; b.style.opacity = "1"; });
    if (spinner) spinner.style.display = "none";
    if (errEl) {
      errEl.textContent = "Error al conectar con el servidor. Inténtalo de nuevo.";
      errEl.style.display = "";
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   abrirPortalStripe
   Llama a la Edge Function y redirige al portal de cliente de Stripe.
───────────────────────────────────────────────────────────────── */
export async function abrirPortalStripe() {
  try {
    const session = await supabase.auth.getSession();
    const token   = session.data.session?.access_token;

    const resp = await fetch(`${EDGE_BASE}/create-portal-session`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
        "apikey":        ANON_KEY,
      },
    });

    const data = await resp.json();
    if (!resp.ok || !data.url) throw new Error(data.error || "Error abriendo portal");

    window.location.href = data.url;
  } catch (err) {
    console.error("[portalStripe] Error:", err);
    toast("No se pudo abrir el portal de suscripción. Inténtalo de nuevo.", "error");
  }
}

/* ─────────────────────────────────────────────────────────────────
   renderPlanTab
   Devuelve el HTML del panel "Plan" en el modal de Ajustes.
   subData: objeto de la tabla subscriptions (o null)
───────────────────────────────────────────────────────────────── */
export function renderPlanTab(subData) {
  const status   = subData?.status  ?? "sin_plan";
  const plan     = subData?.plan    ?? null;
  const isAdmin  = subData?.is_admin ?? false;

  // ── Etiqueta y color del estado ──
  const statusConfig = {
    trialing:   { label: "Periodo de prueba",  color: "#0284c7", bg: "#e0f2fe" },
    active:     { label: "Activo",             color: "#15803d", bg: "#dcfce7" },
    past_due:   { label: "Pago pendiente",     color: "#b45309", bg: "#fef9c3" },
    canceled:   { label: "Cancelado",          color: "#dc2626", bg: "#fee2e2" },
    incomplete: { label: "Pendiente de activar", color: "#6b7280", bg: "#f3f4f6" },
    sin_plan:   { label: "Sin suscripción",    color: "#6b7280", bg: "#f3f4f6" },
  };
  const sc = statusConfig[status] || statusConfig["sin_plan"];

  // ── Nombre del plan ──
  const planLabel = plan === "sociedad" ? "Sociedad" : plan === "autonomo" ? "Autónomo" : "—";

  // ── Fecha relevante ──
  let fechaInfo = "";
  if (status === "trialing" && subData?.trial_ends_at) {
    const trialEnd = new Date(subData.trial_ends_at);
    const diasRestantes = Math.max(0, Math.ceil((trialEnd - Date.now()) / 86400000));
    fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
      Periodo de prueba hasta el <strong>${trialEnd.toLocaleDateString("es-ES")}</strong>
      ${diasRestantes > 0 ? `(${diasRestantes} día${diasRestantes !== 1 ? "s" : ""} restante${diasRestantes !== 1 ? "s" : ""})` : "(hoy termina)"}
    </p>`;
  } else if (status === "active" && subData?.current_period_end) {
    const nextBill = new Date(subData.current_period_end);
    fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
      Próximo cargo: <strong>${nextBill.toLocaleDateString("es-ES")}</strong>
    </p>`;
  } else if (status === "canceled" && subData?.current_period_end) {
    const endDate = new Date(subData.current_period_end);
    if (endDate > new Date()) {
      fechaInfo = `<p style="font-size:12.5px;color:var(--t3);margin:4px 0 0">
        Acceso hasta: <strong>${endDate.toLocaleDateString("es-ES")}</strong>
      </p>`;
    }
  }

  if (isAdmin) {
    return `
      <div style="padding:24px 28px 28px">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 18px">
          <p style="font-size:13px;font-weight:700;color:#15803d;margin:0 0 4px">Cuenta de administrador</p>
          <p style="font-size:12.5px;color:#166534;margin:0">Acceso completo sin restricciones.</p>
        </div>
      </div>`;
  }

  return `
    <div style="padding:24px 28px 28px">

      <!-- Estado actual -->
      <div style="background:var(--bg2,#f8f9fc);border:1px solid var(--brd);border-radius:12px;padding:16px 18px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <p style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.05em;margin:0 0 4px">Plan</p>
            <p style="font-size:15px;font-weight:700;color:var(--t1);margin:0">${planLabel}</p>
            ${fechaInfo}
          </div>
          <span style="padding:4px 10px;border-radius:20px;font-size:11.5px;font-weight:700;
                       background:${sc.bg};color:${sc.color}">
            ${sc.label}
          </span>
        </div>
      </div>

      <!-- Aviso past_due -->
      ${status === "past_due" ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-bottom:16px">
          <p style="font-size:13px;font-weight:700;color:#92400e;margin:0 0 4px">Problema con el pago</p>
          <p style="font-size:12.5px;color:#78350f;margin:0;line-height:1.5">
            No se pudo cobrar la última factura. Actualiza tu método de pago para no perder el acceso.
          </p>
        </div>` : ""}

      <!-- Botón gestionar suscripción -->
      ${(status === "trialing" || status === "active" || status === "past_due") ? `
        <button id="ajPlanPortalBtn"
          style="width:100%;padding:12px;background:var(--ox,#f97316);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;margin-bottom:10px;transition:opacity .15s">
          Gestionar suscripción
        </button>
        <p style="font-size:11px;color:var(--t4);margin:0;line-height:1.5;text-align:center">
          Cambia de plan, actualiza tu tarjeta o cancela desde el portal de Stripe.
        </p>
      ` : `
        <button id="ajPlanReactivarBtn"
          style="width:100%;padding:12px;background:var(--ox,#f97316);color:#fff;
                 border:none;border-radius:10px;font-size:14px;font-weight:700;
                 cursor:pointer;font-family:inherit;transition:opacity .15s">
          Activar suscripción
        </button>
      `}

    </div>`;
}

/* ─────────────────────────────────────────────────────────────────
   initPlanTab
   Adjunta los listeners del tab de plan en el modal de Ajustes.
───────────────────────────────────────────────────────────────── */
export function initPlanTab(subData) {
  // Botón portal Stripe
  document.getElementById("ajPlanPortalBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = "Abriendo portal…";
    await abrirPortalStripe();
    btn.disabled = false;
    btn.textContent = "Gestionar suscripción";
  });

  // Botón reactivar (usuario cancelado o sin plan)
  document.getElementById("ajPlanReactivarBtn")?.addEventListener("click", () => {
    document.getElementById("ajustesModal")?.remove();
    showPlanSelector(subData);
  });
}
