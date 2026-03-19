import { supabase } from "./supabase.js";

/* ══════════════════════════
   GOOGLE OAUTH
══════════════════════════ */
export async function login() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://taurix.es/",
        queryParams: { prompt: "consent", access_type: "offline" },
      },
    });
    if (error) throw error;
  } catch (err) {
    console.error("Login Google error:", err.message);
  }
}

/* ══════════════════════════
   EMAIL + CONTRASEÑA
══════════════════════════ */
export async function loginEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes("Email not confirmed"))
      throw new Error("Debes confirmar tu email antes de entrar. Revisa tu bandeja de entrada (también el spam).");
    if (error.message.includes("Invalid login credentials"))
      throw new Error("Email o contraseña incorrectos. Si acabas de registrarte, confirma tu email primero.");
    throw new Error(error.message);
  }
  return data;
}

export async function registerEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: "https://taurix.es/" },
  });
  if (error) {
    if (error.message.includes("already registered") || error.message.includes("User already registered"))
      throw new Error("Este email ya tiene una cuenta. Inicia sesión.");
    if (error.message.includes("Password should be"))
      throw new Error("La contraseña debe tener al menos 6 caracteres.");
    throw new Error(error.message);
  }
  return { needsConfirm: !data.session };
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://taurix.es/",
  });
  if (error) throw new Error(error.message);
}

/* ══════════════════════════
   LOGOUT
══════════════════════════ */
export async function logout() {
  await supabase.auth.signOut();
  window.location.reload();
}

/* ══════════════════════════
   SESIÓN ACTUAL
══════════════════════════ */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/* ══════════════════════════
   MODAL DE AUTENTICACIÓN
══════════════════════════ */
export function showAuthModal() {
  document.getElementById("authModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "authModal";
  modal.innerHTML = `
    <div class="auth-overlay" id="authOverlay" onclick="event.stopPropagation();event.preventDefault()">
      <div class="auth-card" onclick="event.stopPropagation()">
        <div class="auth-header">
          <div class="auth-logo-wrap">
            <img src="Logo_Sin_Texto_transparent.png" alt="Taurix" class="auth-logo-bull"/>
          </div>
          <h2 class="auth-title" id="authTitle">Accede a Taurix</h2>
          <p class="auth-sub" id="authSub">La herramienta fiscal que mereces</p>
        </div>
        <div class="auth-tabs" id="authTabs">
          <button class="auth-tab active" data-tab="login">Entrar</button>
          <button class="auth-tab" data-tab="register">Crear cuenta</button>
        </div>
        <div class="auth-error" id="authError" style="display:none"></div>
        <div class="auth-success" id="authSuccess" style="display:none"></div>

        <!-- LOGIN -->
        <div class="auth-panel" id="panelLogin">

          <div class="auth-field"><label>Email</label><input type="email" id="loginEmail" placeholder="tu@email.com" autocomplete="email"/></div>
          <div class="auth-field"><label>Contraseña</label>
            <div class="auth-pw-wrap">
              <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password"/>
              <button type="button" class="auth-pw-toggle" data-target="loginPassword">👁</button>
            </div>
          </div>
          <button class="auth-forgot" id="authForgotBtn">¿Olvidaste la contraseña?</button>
          <button class="auth-submit" id="loginSubmitBtn"><span>Entrar</span></button>
          <p class="auth-switch">¿No tienes cuenta? <button class="auth-link" data-tab="register">Créate una gratis →</button></p>
        </div>

        <!-- REGISTRO -->
        <div class="auth-panel" id="panelRegister" style="display:none">

          <div class="auth-field"><label>Email</label><input type="email" id="registerEmail" placeholder="tu@email.com" autocomplete="email"/></div>
          <div class="auth-field"><label>Contraseña <span style="color:var(--t4);font-weight:400">(mín. 6 caracteres)</span></label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword">👁</button>
            </div>
          </div>
          <div class="auth-field"><label>Confirmar contraseña</label>
            <div class="auth-pw-wrap">
              <input type="password" id="registerPassword2" placeholder="••••••••" autocomplete="new-password"/>
              <button type="button" class="auth-pw-toggle" data-target="registerPassword2">👁</button>
            </div>
          </div>
          <button class="auth-submit" id="registerSubmitBtn"><span>Crear cuenta gratis</span></button>
          <p class="auth-switch">¿Ya tienes cuenta? <button class="auth-link" data-tab="login">Inicia sesión →</button></p>
        </div>

        <!-- RECUPERAR CONTRASEÑA -->
        <div class="auth-panel" id="panelForgot" style="display:none">
          <p style="font-size:13.5px;color:var(--t2);margin-bottom:18px;line-height:1.6">Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.</p>
          <div class="auth-field"><label>Email</label><input type="email" id="forgotEmail" placeholder="tu@email.com"/></div>
          <button class="auth-submit" id="forgotSubmitBtn"><span>Enviar enlace</span></button>
          <button class="auth-forgot" id="backToLoginBtn">← Volver al inicio de sesión</button>
        </div>

        <button class="auth-close" id="authCloseBtn">×</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const showError   = msg => { const e=document.getElementById("authError");   e.textContent=msg; e.style.display=msg?"":"none"; document.getElementById("authSuccess").style.display="none"; };
  const showSuccess = msg => { const e=document.getElementById("authSuccess"); e.textContent=msg; e.style.display=msg?"":"none"; document.getElementById("authError").style.display="none"; };
  const setLoading  = (btn, loading, label) => {
    btn.disabled=loading;
    btn.innerHTML=loading ? `<span class="auth-spinner"></span><span>Un momento…</span>` : `<span>${label}</span>`;
  };

  const switchTab = tab => {
    document.querySelectorAll(".auth-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
    ["login","register","forgot"].forEach(p => {
      document.getElementById("panel"+p.charAt(0).toUpperCase()+p.slice(1)).style.display = p===tab?"":"none";
    });
    document.getElementById("authTabs").style.display = tab==="forgot"?"none":"";
    showError(""); showSuccess("");
    const titles={login:"Accede a Taurix",register:"Crea tu cuenta gratis",forgot:"Recuperar contraseña"};
    document.getElementById("authTitle").textContent=titles[tab];
  };

  document.querySelectorAll(".auth-tab,.auth-link").forEach(el=>el.addEventListener("click",()=>switchTab(el.dataset.tab)));
  document.querySelectorAll(".auth-pw-toggle").forEach(btn=>btn.addEventListener("click",()=>{
    const input=document.getElementById(btn.dataset.target);
    input.type=input.type==="password"?"text":"password";
    btn.textContent=input.type==="password"?"👁":"🙈";
  }));

  ["panelLogin","panelRegister","panelForgot"].forEach((pid,i)=>{
    const submitIds=["loginSubmitBtn","registerSubmitBtn","forgotSubmitBtn"];
    document.getElementById(pid)?.addEventListener("keydown",e=>{if(e.key==="Enter") document.getElementById(submitIds[i])?.click();});
  });


  document.getElementById("loginSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("loginEmail").value.trim();
    const pw=document.getElementById("loginPassword").value;
    if(!email||!pw){showError("Rellena email y contraseña.");return;}
    const btn=document.getElementById("loginSubmitBtn");
    setLoading(btn,true,"Entrar");
    try { await loginEmail(email,pw); modal.remove(); window.location.reload(); }
    catch(e){ showError(e.message); setLoading(btn,false,"Entrar"); }
  });

  document.getElementById("registerSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("registerEmail").value.trim();
    const pw1=document.getElementById("registerPassword").value;
    const pw2=document.getElementById("registerPassword2").value;
    if(!email){showError("Introduce tu email.");return;}
    if(pw1.length<6){showError("La contraseña debe tener al menos 6 caracteres.");return;}
    if(pw1!==pw2){showError("Las contraseñas no coinciden.");return;}
    const btn=document.getElementById("registerSubmitBtn");
    setLoading(btn,true,"Crear cuenta gratis");
    try {
      const {needsConfirm}=await registerEmail(email,pw1);
      if(needsConfirm){
        showSuccess(`✅ Cuenta creada. Te hemos enviado un email a ${email} — confírmalo y luego inicia sesión aquí.`);
        switchTab("login");
        // Rellenar email en el login para facilitar el acceso
        setTimeout(() => {
          const loginEmailInput = document.getElementById("loginEmail");
          if (loginEmailInput) loginEmailInput.value = email;
        }, 100);
      }
      else { modal.remove(); window.location.reload(); }
    } catch(e){ showError(e.message); setLoading(btn,false,"Crear cuenta gratis"); }
  });

  document.getElementById("authForgotBtn").addEventListener("click",()=>switchTab("forgot"));
  document.getElementById("backToLoginBtn").addEventListener("click",()=>switchTab("login"));
  document.getElementById("forgotSubmitBtn").addEventListener("click", async ()=>{
    const email=document.getElementById("forgotEmail").value.trim();
    if(!email){showError("Introduce tu email.");return;}
    const btn=document.getElementById("forgotSubmitBtn");
    setLoading(btn,true,"Enviar enlace");
    try { await resetPassword(email); showSuccess(`📧 Enlace enviado a ${email}. Revisa tu bandeja de entrada.`); setLoading(btn,false,"Enviar enlace"); }
    catch(e){ showError(e.message); setLoading(btn,false,"Enviar enlace"); }
  });

  document.getElementById("authCloseBtn").addEventListener("click",()=>modal.remove());
  // No cerrar al hacer clic fuera — solo con el botón X
  document.getElementById("authOverlay").addEventListener("click", e => e.stopPropagation());
  // Escape desactivado — solo se cierra con el botón ×

  supabase.auth.onAuthStateChange((event,session)=>{
    if((event==="SIGNED_IN"||event==="TOKEN_REFRESHED")&&session){ modal.remove(); window.location.reload(); }
  });

  setTimeout(()=>document.getElementById("loginEmail")?.focus(),100);
}

/* ══════════════════════════
   MODAL NUEVA CONTRASEÑA
   Se muestra cuando el usuario llega
   desde el enlace del email de reset
══════════════════════════ */
export function showResetPasswordModal() {
  // Ocultar landing, mostrar solo el modal
  document.getElementById("landingPage")?.classList.add("hidden");
  document.getElementById("appShell")?.classList.add("hidden");

  const modal = document.createElement("div");
  modal.id = "resetPwModal";
  modal.innerHTML = `
    <div class="auth-overlay" id="resetPwOverlay" style="z-index:10000">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo-wrap">
            <img src="Logo_Sin_Texto_transparent.png" alt="Taurix" class="auth-logo-bull"/>
          </div>
          <h2 class="auth-title">Nueva contraseña</h2>
          <p class="auth-sub">Elige una contraseña segura para tu cuenta</p>
        </div>
        <div class="auth-error"  id="rpError"   style="display:none"></div>
        <div class="auth-success" id="rpSuccess" style="display:none"></div>

        <div class="auth-field">
          <label>Nueva contraseña</label>
          <div class="auth-pw-wrap">
            <input type="password" id="rpPw1" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
            <button type="button" class="auth-pw-toggle" data-target="rpPw1">👁</button>
          </div>
        </div>
        <div class="auth-field">
          <label>Confirmar contraseña</label>
          <div class="auth-pw-wrap">
            <input type="password" id="rpPw2" placeholder="Repite la contraseña" autocomplete="new-password"/>
            <button type="button" class="auth-pw-toggle" data-target="rpPw2">👁</button>
          </div>
        </div>

        <!-- Indicador de fortaleza -->
        <div id="rpStrengthWrap" style="margin-bottom:16px;display:none">
          <div style="height:4px;background:var(--brd);border-radius:4px;overflow:hidden;margin-bottom:5px">
            <div id="rpStrengthBar" style="height:100%;width:0%;transition:width .3s,background .3s;border-radius:4px"></div>
          </div>
          <div id="rpStrengthLabel" style="font-size:11px;color:var(--t3)"></div>
        </div>

        <button class="auth-submit" id="rpSubmitBtn"><span>Guardar nueva contraseña</span></button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const showError   = msg => { const e=document.getElementById("rpError");   e.textContent=msg; e.style.display=msg?"":"none"; };
  const showSuccess = msg => { const e=document.getElementById("rpSuccess"); e.textContent=msg; e.style.display=msg?"":"none"; };
  const setLoading  = (loading) => {
    const btn = document.getElementById("rpSubmitBtn");
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<span class="auth-spinner"></span><span>Guardando…</span>`
      : `<span>Guardar nueva contraseña</span>`;
  };

  // Toggle visibilidad contraseña
  modal.querySelectorAll(".auth-pw-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === "password" ? "text" : "password";
      btn.textContent = input.type === "password" ? "👁" : "🙈";
    });
  });

  // Indicador de fortaleza
  document.getElementById("rpPw1")?.addEventListener("input", e => {
    const pw = e.target.value;
    const wrap = document.getElementById("rpStrengthWrap");
    const bar  = document.getElementById("rpStrengthBar");
    const lbl  = document.getElementById("rpStrengthLabel");
    if (!pw) { if(wrap) wrap.style.display="none"; return; }
    if(wrap) wrap.style.display = "";

    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    const levels = [
      { pct:"20%", color:"#dc2626", label:"Muy débil" },
      { pct:"40%", color:"#f97316", label:"Débil" },
      { pct:"60%", color:"#eab308", label:"Regular" },
      { pct:"80%", color:"#22c55e", label:"Buena" },
      { pct:"100%",color:"#059669", label:"Excelente" },
    ];
    const lvl = levels[Math.min(score, 4)];
    if(bar) { bar.style.width=lvl.pct; bar.style.background=lvl.color; }
    if(lbl) { lbl.textContent=`Fortaleza: ${lvl.label}`; lbl.style.color=lvl.color; }
  });

  // Enter para enviar
  modal.addEventListener("keydown", e => { if(e.key==="Enter") document.getElementById("rpSubmitBtn")?.click(); });

  document.getElementById("rpSubmitBtn").addEventListener("click", async () => {
    const pw1 = document.getElementById("rpPw1").value;
    const pw2 = document.getElementById("rpPw2").value;
    showError("");

    if (!pw1 || pw1.length < 8) { showError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (pw1 !== pw2)             { showError("Las contraseñas no coinciden."); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw new Error(error.message);

      showSuccess("✅ Contraseña actualizada correctamente. Redirigiendo…");
      setTimeout(() => {
        modal.remove();
        // Limpiar el hash de la URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Recargar para entrar con la nueva sesión
        window.location.reload();
      }, 1800);
    } catch(e) {
      showError(e.message || "Error al actualizar la contraseña.");
      setLoading(false);
    }
  });

  // Focus automático
  setTimeout(() => document.getElementById("rpPw1")?.focus(), 100);
}
