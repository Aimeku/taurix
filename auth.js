import { supabase } from "./supabase.js";

/* ══════════════════════════════════════════════════════════
   ENDPOINT — Supabase Edge Function
   Sustituye PROJECT_ID por tu ID real de proyecto Supabase.
   Lo encuentras en: Supabase Dashboard → Settings → General
   → "Reference ID"
══════════════════════════════════════════════════════════ */
// Endpoint exacto de la Edge Function
// ── Supabase Edge Function endpoint ─────────────────────────
// Project ID: biiyzjzdvuahajndltap  (Settings → General → Reference ID)
const SUPABASE_PROJECT_ID = "biiyzjzdvuahajndltap";
const SUPABASE_ANON_KEY   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaXl6anpkdnVhaGFqbmRsdGFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjI5MzEsImV4cCI6MjA4NTQzODkzMX0.sm_0aKM08sduk3E0elmMaLRCuqlxgWulTp7Kx3WHc_4";
const RESEND_ENDPOINT     = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/send-2fa-code`;

/* ══════════════════════════════════════════════════════════
   ALMACÉN TEMPORAL DE CÓDIGOS 2FA
   Se guarda en sessionStorage para que no persista entre
   recargas. Estructura: { code, email, expiresAt }
══════════════════════════════════════════════════════════ */
const TFA_KEY = "taurix_2fa_pending";

function store2FA(email, code) {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos
  sessionStorage.setItem(TFA_KEY, JSON.stringify({ email, code, expiresAt }));
}

function get2FA() {
  try {
    const raw = sessionStorage.getItem(TFA_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() > data.expiresAt) {
      sessionStorage.removeItem(TFA_KEY);
      return null; // expirado
    }
    return data;
  } catch { return null; }
}

function clear2FA() { sessionStorage.removeItem(TFA_KEY); }

/* ══════════════════════════════════════════════════════════
   GENERAR CÓDIGO DE 6 DÍGITOS
══════════════════════════════════════════════════════════ */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ══════════════════════════════════════════════════════════
   ENVIAR CÓDIGO 2FA VÍA SUPABASE EDGE FUNCTION + RESEND
══════════════════════════════════════════════════════════ */
async function send2FACode(email) {
  const code      = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email:     email,
        code:      code,
        expiresAt: expiresAt.toISOString(),
      }),
    });
  } catch (fetchErr) {
    console.error("[send2FACode] fetch error:", fetchErr);
    throw new Error("No se pudo contactar con el servidor. Comprueba tu conexión.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "No se pudo enviar el código. Inténtalo de nuevo.");
  }

  store2FA(email, code);
  return code;
}

/* ══════════════════════════════════════════════════════════
   VERIFICAR CÓDIGO 2FA
   Compara contra el código guardado en sessionStorage.
   Retorna true si es correcto y no ha expirado.
══════════════════════════════════════════════════════════ */
function verify2FACode(email, inputCode) {
  const stored = get2FA();
  if (!stored) throw new Error("El código ha expirado. Solicita uno nuevo.");
  if (stored.email !== email) throw new Error("Email no coincide. Vuelve a iniciar sesión.");
  if (stored.code !== inputCode.trim()) throw new Error("Código incorrecto. Inténtalo de nuevo.");
  clear2FA();
  return true;
}

/* ══════════════════════════════════════════════════════════
   GOOGLE OAUTH (desactivado por ahora)
══════════════════════════════════════════════════════════ */
export async function login() {
  console.warn("Google OAuth desactivado");
}

/* ══════════════════════════════════════════════════════════
   LOGIN CON EMAIL + CONTRASEÑA
   Solo autentica. NO envía código 2FA (eso se hace desde el modal).
══════════════════════════════════════════════════════════ */
export async function loginEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes("Email not confirmed"))
      throw new Error("Email o contraseña incorrectos.");
    if (error.message.includes("Invalid login credentials"))
      throw new Error("Email o contraseña incorrectos.");
    throw new Error(error.message);
  }
  return data;
}

/* ══════════════════════════════════════════════════════════
   REGISTRO CON EMAIL + CONTRASEÑA
   Sin envío de código 2FA. Supabase envía confirmación si está activado.
══════════════════════════════════════════════════════════ */
export async function registerEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: "https://taurix.es/" },
  });
  if (error) {
    if (error.message.includes("already registered")) throw new Error("Este email ya tiene una cuenta. Inicia sesión.");
    if (error.message.includes("Password should be")) throw new Error("La contraseña debe tener al menos 6 caracteres.");
    throw new Error(error.message);
  }
  return { needsConfirm: !data.session };
}

/* ══════════════════════════════════════════════════════════
   RECUPERAR CONTRASEÑA
══════════════════════════════════════════════════════════ */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://taurix.es/" });
  if (error) throw new Error(error.message);
}

/* ══════════════════════════════════════════════════════════
   SESIÓN
══════════════════════════════════════════════════════════ */
export async function logout() {
  await supabase.auth.signOut();
  sessionStorage.removeItem("taurix_no_persist");
  window.location.reload();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/* ══════════════════════════════════════════════════════════
   GESTIÓN "RECORDAR SESIÓN"
   Si el usuario NO marcó "recordar sesión", borramos la
   sesión de Supabase en cada recarga de página.
══════════════════════════════════════════════════════════ */
export async function handleRememberSession() {
  const noPersist = sessionStorage.getItem("taurix_no_persist");
  if (noPersist === "1") {
    // sessionStorage no persiste entre recargas → si está aquí es la misma pestaña
    // Si es una nueva carga de página (no navegación SPA), sessionStorage se limpia sola
    // Así que si el flag NO existe en una nueva carga, cerramos sesión
  } else if (localStorage.getItem("taurix_must_clear_on_reload") === "1") {
    // El usuario cerró y reabrió → cerrar sesión
    localStorage.removeItem("taurix_must_clear_on_reload");
    await supabase.auth.signOut();
  }
}

/* ══════════════════════════════════════════════════════════
   MODAL DE AUTENTICACIÓN
   Flujo:
     Tab "Iniciar sesión":
       Paso 1 → email + contraseña + checkbox "Recordar sesión"
       Paso 2 → código 2FA (solo si login correcto)
     Tab "Crear cuenta":
       email + contraseña (sin código 2FA)
     Panel "Olvidé mi contraseña" (oculto, desde link)
══════════════════════════════════════════════════════════ */
export function showAuthModal() {
  document.getElementById("authModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "authModal";
  modal.innerHTML = `
    <div class="auth-overlay" id="authOverlay" onclick="event.stopPropagation()">
      <div class="auth-card" onclick="event.stopPropagation()">

        <div class="auth-header">
          <div class="auth-logo-wrap">
            <img src="Logo_Sin_Texto_transparent.png" alt="Taurix" class="auth-logo-bull"/>
          </div>
          <h2 class="auth-title" id="authTitle">Accede a Taurix</h2>
          <p class="auth-sub" id="authSub">La herramienta fiscal que mereces</p>
        </div>

        <!-- TABS: Iniciar sesión / Crear cuenta -->
        <div class="auth-tabs" id="authTabs">
          <button class="auth-tab active" data-tab="login">Iniciar sesión</button>
          <button class="auth-tab" data-tab="register">Crear cuenta</button>
        </div>

        <div class="auth-error"   id="authError"   style="display:none"></div>
        <div class="auth-success" id="authSuccess" style="display:none"></div>

        <!-- ── PANEL LOGIN ── -->
        <div class="auth-panel" id="panelLogin">

          <!-- Paso 1: email + contraseña -->
          <div id="loginStep1">
            <div class="auth-field">
              <label>Email</label>
              <input type="email" id="loginEmail" placeholder="tu@email.com" autocomplete="email"/>
            </div>
            <div class="auth-field">
              <label>Contraseña</label>
              <div class="auth-pw-wrap">
                <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password"/>
                <button type="button" class="auth-pw-toggle" data-target="loginPassword">👁</button>
              </div>
            </div>

            <!-- Checkbox "Recordar sesión" -->
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:20px;font-size:13px;color:var(--t2)">
              <input type="checkbox" id="loginRemember" checked style="width:15px;height:15px;accent-color:var(--accent)"/>
              <span>Recordar mi sesión en este dispositivo</span>
            </label>

            <button class="auth-submit" id="loginSubmitBtn"><span>Entrar</span></button>

            <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--t4)">
              <button class="auth-forgot" id="goForgotBtn" style="font-size:12px;margin:0">¿Olvidaste tu contraseña?</button>
            </p>
            <p style="text-align:center;margin-top:6px;font-size:12px;color:var(--t4)">
              ¿Primera vez? <button class="auth-link" data-tab="register" style="font-size:12px">Crea tu cuenta gratis →</button>
            </p>
          </div>

          <!-- Paso 2: código 2FA -->
          <div id="loginStep2" style="display:none">
            <div style="text-align:center;margin-bottom:20px">
              <div style="font-size:32px;margin-bottom:10px">📨</div>
              <div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:4px">Código de verificación enviado</div>
              <div style="font-size:13px;color:var(--t3)">Hemos enviado un código a</div>
              <div style="font-size:15px;font-weight:700;color:var(--accent);margin-top:4px" id="loginEmailDisplay">—</div>
              <div style="font-size:11px;color:var(--t4);margin-top:6px">El código caduca en <strong>10 minutos</strong></div>
            </div>

            <div class="auth-field">
              <label style="text-align:center;display:block">Código de 6 dígitos</label>
              <input type="text" id="loginOtpCode"
                placeholder="000000" maxlength="6"
                style="font-size:32px;font-weight:800;letter-spacing:12px;text-align:center;font-family:monospace"
                autocomplete="one-time-code" inputmode="numeric"/>
            </div>

            <!-- Contador de expiración 2FA -->
            <div id="tfaExpiry" style="text-align:center;font-size:12px;color:var(--t3);margin-bottom:12px">
              Tiempo restante: <span id="tfaCountdownMin">10</span>:<span id="tfaCountdownSec">00</span>
            </div>

            <button class="auth-submit" id="loginVerifyBtn"><span>Verificar y entrar</span></button>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
              <button class="auth-forgot" id="loginResendBtn" style="margin:0" disabled>
                Reenviar (<span id="loginCountdown">60</span>s)
              </button>
              <button class="auth-forgot" id="loginBackBtn" style="margin:0">← Volver</button>
            </div>
          </div>
        </div>

        <!-- ── PANEL REGISTER ── -->
        <div class="auth-panel" id="panelRegister" style="display:none">
          <p style="font-size:13px;color:var(--t3);line-height:1.6;margin-bottom:18px">
            Crea tu cuenta gratis. Podrás acceder con email y contraseña.
          </p>
          <div class="auth-field">
            <label>Email</label>
            <input type="email" id="registerEmail" placeholder="tu@email.com" autocomplete="email"/>
          </div>
          <div class="auth-field">
            <label>Contraseña <span style="color:var(--t4);font-weight:400">(mín. 6 caracteres)</span></label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword">👁</button>
            </div>
          </div>
          <div class="auth-field">
            <label>Confirmar contraseña</label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword2" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword2">👁</button>
            </div>
          </div>
          <button class="auth-submit" id="registerSubmitBtn"><span>Crear cuenta gratis</span></button>
          <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--t4)">
            ¿Ya tienes cuenta? <button class="auth-link" data-tab="login" style="font-size:12px">Inicia sesión →</button>
          </p>
        </div>

        <!-- ── PANEL FORGOT ── -->
        <div class="auth-panel" id="panelForgot" style="display:none">
          <p style="font-size:13.5px;color:var(--t2);margin-bottom:18px;line-height:1.6">
            Te enviaremos un enlace para restablecer tu contraseña.
          </p>
          <div class="auth-field">
            <label>Email</label>
            <input type="email" id="forgotEmail" placeholder="tu@email.com"/>
          </div>
          <button class="auth-submit" id="forgotSubmitBtn"><span>Enviar enlace</span></button>
          <button class="auth-forgot" id="backToLoginBtn" style="margin-top:10px">← Volver</button>
        </div>

        <button class="auth-close" id="authCloseBtn">×</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  /* ── helpers ── */
  const showError   = msg => { const e = document.getElementById("authError");   e.textContent = msg; e.style.display = msg ? "" : "none"; document.getElementById("authSuccess").style.display = "none"; };
  const showSuccess = msg => { const e = document.getElementById("authSuccess"); e.textContent = msg; e.style.display = msg ? "" : "none"; document.getElementById("authError").style.display   = "none"; };
  const setLoading  = (btn, loading, label) => { btn.disabled = loading; btn.innerHTML = loading ? `<span class="auth-spinner"></span><span>Un momento…</span>` : `<span>${label}</span>`; };

  const switchTab = (tab) => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    ["login","register","forgot"].forEach(p => {
      const el = document.getElementById("panel" + p.charAt(0).toUpperCase() + p.slice(1));
      if (el) el.style.display = p === tab ? "" : "none";
    });
    document.getElementById("authTabs").style.display = tab === "forgot" ? "none" : "";
    // Asegurarse de que al cambiar de tab, el login vuelve al paso 1
    if (tab === "login") {
      document.getElementById("loginStep1").style.display = "";
      document.getElementById("loginStep2").style.display = "none";
    }
    showError(""); showSuccess("");
    const titles = { login: "Iniciar sesión", register: "Crear tu cuenta gratis", forgot: "Recuperar contraseña" };
    document.getElementById("authTitle").textContent = titles[tab] || "Accede a Taurix";
    const subs = { login: "Verificación en dos pasos", register: "Sin tarjeta de crédito", forgot: "Te enviamos un enlace de recuperación" };
    document.getElementById("authSub").textContent = subs[tab] || "";
  };

  document.querySelectorAll(".auth-tab, .auth-link").forEach(el =>
    el.addEventListener("click", () => switchTab(el.dataset.tab))
  );
  document.querySelectorAll(".auth-pw-toggle").forEach(btn =>
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === "password" ? "text" : "password";
      btn.textContent = input.type === "password" ? "👁" : "🙈";
    })
  );

  /* ── Variables de estado ── */
  let _loginEmail    = "";
  let _loginSession  = null; // sesión Supabase temporal hasta verificar 2FA
  let _resendTimer   = null;
  let _tfaTimer      = null;

  /* ── Temporizador de reenvío (60s) ── */
  function startResendCountdown() {
    let s = 60;
    const btn = document.getElementById("loginResendBtn");
    const sp  = document.getElementById("loginCountdown");
    if (btn) btn.disabled = true;
    if (_resendTimer) clearInterval(_resendTimer);
    _resendTimer = setInterval(() => {
      s--;
      if (sp) sp.textContent = s;
      if (s <= 0) {
        clearInterval(_resendTimer);
        if (btn) { btn.disabled = false; btn.innerHTML = "Reenviar código"; }
      }
    }, 1000);
  }

  /* ── Temporizador de expiración del código 2FA (10 min) ── */
  function startTFACountdown() {
    let totalSec = 10 * 60; // 600 segundos
    if (_tfaTimer) clearInterval(_tfaTimer);
    const updateDisplay = () => {
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const minEl = document.getElementById("tfaCountdownMin");
      const secEl = document.getElementById("tfaCountdownSec");
      if (minEl) minEl.textContent = String(m).padStart(2, "0");
      if (secEl) secEl.textContent = String(s).padStart(2, "0");
    };
    updateDisplay();
    _tfaTimer = setInterval(() => {
      totalSec--;
      updateDisplay();
      if (totalSec <= 0) {
        clearInterval(_tfaTimer);
        // El código ha expirado: volver al paso 1
        showError("El código ha expirado. Por favor, inicia sesión de nuevo.");
        clear2FA();
        // Cerrar sesión de Supabase que se abrió provisionalmente
        supabase.auth.signOut().catch(() => {});
        setTimeout(() => {
          document.getElementById("loginStep1").style.display = "";
          document.getElementById("loginStep2").style.display = "none";
          showError("El código ha expirado. Introduce tus credenciales de nuevo.");
        }, 100);
      }
    }, 1000);
  }

  /* ────────────────────────────────────────────
     LOGIN PASO 1: verificar email + contraseña
     Si son correctos → enviar código 2FA
  ──────────────────────────────────────────── */
  const doLogin = async () => {
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email)    { showError("Introduce tu email."); return; }
    if (!password) { showError("Introduce tu contraseña."); return; }

    const btn = document.getElementById("loginSubmitBtn");
    setLoading(btn, true, "Entrar");
    showError("");

    try {
      // 1. Autenticar con Supabase
      _loginSession = await loginEmail(email, password);
      _loginEmail = email;

      // 2. Enviar código 2FA vía Resend (SOLO aquí, tras login correcto)
      await send2FACode(email);

      // 3. Mostrar paso 2
      document.getElementById("loginEmailDisplay").textContent = email;
      document.getElementById("loginStep1").style.display = "none";
      document.getElementById("loginStep2").style.display = "";
      showSuccess("📧 Código enviado — revisa tu bandeja (y spam).");

      // 4. Iniciar contadores
      startResendCountdown();
      startTFACountdown();

      setTimeout(() => document.getElementById("loginOtpCode")?.focus(), 200);
    } catch (e) {
      showError(e.message);
    }

    setLoading(btn, false, "Entrar");
  };

  document.getElementById("loginSubmitBtn").addEventListener("click", doLogin);
  document.getElementById("loginPassword")?.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("loginEmail")?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("loginPassword")?.focus();
  });

  /* ────────────────────────────────────────────
     LOGIN PASO 2: verificar código 2FA
  ──────────────────────────────────────────── */
  const doVerify2FA = async () => {
    const code = document.getElementById("loginOtpCode").value.trim();
    if (!code || code.length < 6) { showError("Introduce el código de 6 dígitos."); return; }

    const btn = document.getElementById("loginVerifyBtn");
    setLoading(btn, true, "Verificar y entrar");
    showError("");

    try {
      // Verificar código localmente
      verify2FACode(_loginEmail, code);

      // Gestionar "recordar sesión"
      const remember = document.getElementById("loginRemember")?.checked !== false;
      if (!remember) {
        // Marcar para limpiar sesión en próxima carga
        sessionStorage.setItem("taurix_no_persist", "1");
        localStorage.setItem("taurix_must_clear_on_reload", "1");
      } else {
        sessionStorage.removeItem("taurix_no_persist");
        localStorage.removeItem("taurix_must_clear_on_reload");
      }

      // Detener temporizadores
      if (_resendTimer) clearInterval(_resendTimer);
      if (_tfaTimer)    clearInterval(_tfaTimer);

      // Acceso concedido → cerrar modal y recargar
      modal.remove();
      window.location.reload();

    } catch (e) {
      showError(e.message);
      setLoading(btn, false, "Verificar y entrar");
    }
  };

  document.getElementById("loginVerifyBtn").addEventListener("click", doVerify2FA);
  document.getElementById("loginOtpCode")?.addEventListener("input", e => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
    e.target.value = v;
    if (v.length === 6) doVerify2FA();
  });

  /* ── Botón volver (paso 2 → paso 1) ── */
  document.getElementById("loginBackBtn")?.addEventListener("click", () => {
    // Cancelar sesión Supabase provisional
    supabase.auth.signOut().catch(() => {});
    clear2FA();
    if (_resendTimer) clearInterval(_resendTimer);
    if (_tfaTimer)    clearInterval(_tfaTimer);
    document.getElementById("loginStep1").style.display = "";
    document.getElementById("loginStep2").style.display = "none";
    document.getElementById("loginOtpCode").value = "";
    showError(""); showSuccess("");
  });

  /* ── Botón reenviar código ── */
  document.getElementById("loginResendBtn")?.addEventListener("click", async () => {
    if (!_loginEmail) return;
    const btn = document.getElementById("loginResendBtn");
    btn.disabled = true; btn.textContent = "Enviando…";
    try {
      await send2FACode(_loginEmail);
      showSuccess("📧 Nuevo código enviado.");
      startResendCountdown();
      startTFACountdown();
    } catch (e) {
      showError(e.message);
      btn.disabled = false;
      btn.textContent = "Reenviar código";
    }
  });

  /* ────────────────────────────────────────────
     REGISTER — sin código 2FA
  ──────────────────────────────────────────── */
  document.getElementById("registerSubmitBtn").addEventListener("click", async () => {
    const email = document.getElementById("registerEmail").value.trim();
    const pw    = document.getElementById("registerPassword").value;
    const pw2   = document.getElementById("registerPassword2").value;
    if (!email || !pw) { showError("Email y contraseña obligatorios."); return; }
    if (pw !== pw2)    { showError("Las contraseñas no coinciden."); return; }
    if (pw.length < 6) { showError("Mín. 6 caracteres."); return; }

    const btn = document.getElementById("registerSubmitBtn");
    setLoading(btn, true, "Crear cuenta gratis");
    try {
      const { needsConfirm } = await registerEmail(email, pw);
      if (needsConfirm) {
        showSuccess(`✅ Cuenta creada. Confirma tu email en ${email} y luego inicia sesión.`);
        switchTab("login");
        setTimeout(() => { const li = document.getElementById("loginEmail"); if (li) li.value = email; }, 100);
      } else {
        // Cuenta creada y sesión abierta → NO enviar 2FA en registro
        modal.remove();
        window.location.reload();
      }
    } catch (e) {
      showError(e.message);
      setLoading(btn, false, "Crear cuenta gratis");
    }
  });

  /* ────────────────────────────────────────────
     FORGOT PASSWORD
  ──────────────────────────────────────────── */
  document.getElementById("goForgotBtn")?.addEventListener("click", () => switchTab("forgot"));

  document.getElementById("forgotSubmitBtn").addEventListener("click", async () => {
    const email = document.getElementById("forgotEmail").value.trim();
    if (!email) { showError("Introduce tu email."); return; }
    const btn = document.getElementById("forgotSubmitBtn");
    setLoading(btn, true, "Enviar enlace");
    try {
      await resetPassword(email);
      showSuccess(`📧 Enlace enviado a ${email}.`);
      setLoading(btn, false, "Enviar enlace");
    } catch (e) {
      showError(e.message);
      setLoading(btn, false, "Enviar enlace");
    }
  });
  document.getElementById("backToLoginBtn").addEventListener("click", () => switchTab("login"));

  /* ── Cierre ── */
  document.getElementById("authCloseBtn").addEventListener("click", () => {
    // Si el usuario cierra el modal en el paso 2, cancelar sesión provisional
    if (document.getElementById("loginStep2")?.style.display !== "none") {
      supabase.auth.signOut().catch(() => {});
      clear2FA();
    }
    if (_resendTimer) clearInterval(_resendTimer);
    if (_tfaTimer)    clearInterval(_tfaTimer);
    modal.remove();
  });
  document.getElementById("authOverlay").addEventListener("click", e => e.stopPropagation());

  setTimeout(() => document.getElementById("loginEmail")?.focus(), 100);
}

/* ══════════════════════════════════════════════════════════
   MODAL NUEVA CONTRASEÑA (sin cambios)
══════════════════════════════════════════════════════════ */
export function showResetPasswordModal(recoverySession = null) {
  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.add("hidden");
  const modal = document.createElement("div");
  modal.id = "resetPwModal";
  modal.innerHTML = `<div class="auth-overlay" id="resetPwOverlay" style="z-index:10000"><div class="auth-card" style="padding:40px 36px;max-width:420px;width:90%"><div class="auth-header" style="margin-bottom:28px"><div class="auth-logo-wrap" style="margin-bottom:20px"><img src="Logo_Sin_Texto_transparent.png" alt="Taurix" class="auth-logo-bull"/></div><h2 class="auth-title" style="margin-bottom:8px">Nueva contraseña</h2><p class="auth-sub">Elige una contraseña segura</p></div><div class="auth-error" id="rpError" style="display:none;margin-bottom:16px"></div><div class="auth-success" id="rpSuccess" style="display:none;margin-bottom:16px"></div><div class="auth-field" style="margin-bottom:18px"><label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--t2)">Nueva contraseña</label><div class="auth-pw-wrap"><input type="password" id="rpPw1" placeholder="Mín. 8 caracteres" autocomplete="new-password"/><button type="button" class="auth-pw-toggle" data-target="rpPw1">👁</button></div></div><div class="auth-field" style="margin-bottom:18px"><label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:var(--t2)">Confirmar</label><div class="auth-pw-wrap"><input type="password" id="rpPw2" placeholder="Repite la contraseña" autocomplete="new-password"/><button type="button" class="auth-pw-toggle" data-target="rpPw2">👁</button></div></div><div id="rpStrengthWrap" style="margin-bottom:20px;display:none"><div style="height:4px;background:var(--brd);border-radius:4px;overflow:hidden;margin-bottom:6px"><div id="rpStrengthBar" style="height:100%;width:0%;transition:width .3s,background .3s;border-radius:4px"></div></div><div id="rpStrengthLabel" style="font-size:11px;color:var(--t3)"></div></div><button class="auth-submit" id="rpSubmitBtn" style="margin-top:8px"><span>Guardar nueva contraseña</span></button></div></div>`;
  document.body.appendChild(modal);
  const showError   = msg => { const e = document.getElementById("rpError");   e.textContent = msg; e.style.display = msg ? "" : "none"; };
  const showSuccess = msg => { const e = document.getElementById("rpSuccess"); e.textContent = msg; e.style.display = msg ? "" : "none"; };
  const setLoading  = loading => { const btn = document.getElementById("rpSubmitBtn"); btn.disabled = loading; btn.innerHTML = loading ? `<span class="auth-spinner"></span><span>Guardando…</span>` : `<span>Guardar nueva contraseña</span>`; };
  modal.querySelectorAll(".auth-pw-toggle").forEach(btn => { btn.addEventListener("click", () => { const input = document.getElementById(btn.dataset.target); input.type = input.type === "password" ? "text" : "password"; btn.textContent = input.type === "password" ? "👁" : "🙈"; }); });
  document.getElementById("rpPw1")?.addEventListener("input", e => { const pw = e.target.value; const wrap = document.getElementById("rpStrengthWrap"), bar = document.getElementById("rpStrengthBar"), lbl = document.getElementById("rpStrengthLabel"); if (!pw) { if (wrap) wrap.style.display = "none"; return; } if (wrap) wrap.style.display = ""; let score = 0; if (pw.length >= 8) score++; if (pw.length >= 12) score++; if (/[A-Z]/.test(pw)) score++; if (/[0-9]/.test(pw)) score++; if (/[^A-Za-z0-9]/.test(pw)) score++; const levels = [{ pct: "20%", color: "#dc2626", label: "Muy débil" }, { pct: "40%", color: "#f97316", label: "Débil" }, { pct: "60%", color: "#eab308", label: "Regular" }, { pct: "80%", color: "#22c55e", label: "Buena" }, { pct: "100%", color: "#059669", label: "Excelente" }]; const lvl = levels[Math.min(score, 4)]; if (bar) { bar.style.width = lvl.pct; bar.style.background = lvl.color; } if (lbl) { lbl.textContent = `Fortaleza: ${lvl.label}`; lbl.style.color = lvl.color; } });
  modal.addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("rpSubmitBtn")?.click(); });
  document.getElementById("rpSubmitBtn").addEventListener("click", async () => { const pw1 = document.getElementById("rpPw1").value, pw2 = document.getElementById("rpPw2").value; showError(""); if (!pw1 || pw1.length < 8) { showError("Mín. 8 caracteres."); return; } if (pw1 !== pw2) { showError("Las contraseñas no coinciden."); return; } setLoading(true); try { if (recoverySession?.access_token) await supabase.auth.setSession({ access_token: recoverySession.access_token, refresh_token: recoverySession.refresh_token }); const { error } = await supabase.auth.updateUser({ password: pw1 }); if (error) throw new Error(error.message); showSuccess("✅ Contraseña actualizada. Redirigiendo…"); setTimeout(() => { modal.remove(); window.history.replaceState({}, document.title, window.location.pathname); window.location.reload(); }, 1800); } catch (e) { showError(e.message); setLoading(false); } });
  setTimeout(() => document.getElementById("rpPw1")?.focus(), 100);
}
