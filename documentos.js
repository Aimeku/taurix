/* ═══════════════════════════════════════════════════════
   TAURIX · documentos.js
   Gestor de documentos completo:
   · Upload a Supabase Storage
   · Organización por carpetas
   · Búsqueda y filtro
   · Vista previa PDF/imagen
   · Descarga y eliminación
   · Vinculación a facturas/nóminas
   ═══════════════════════════════════════════════════════ */

import { supabase } from "./supabase.js";
import { SESSION, fmt, fmtDate, toast, openModal, closeModal } from "./utils.js";

const CARPETAS = [
  { id:"facturas",      icon:"📄", label:"Facturas emitidas",  color:"#1a56db" },
  { id:"gastos",        icon:"🧾", label:"Facturas recibidas", color:"#dc2626" },
  { id:"nominas",       icon:"👥", label:"Nóminas",            color:"#059669" },
  { id:"contratos",     icon:"📝", label:"Contratos",          color:"#8b5cf6" },
  { id:"aeat",          icon:"🏛️", label:"Declaraciones AEAT", color:"#f59e0b" },
  { id:"banco",         icon:"🏦", label:"Extractos bancarios",color:"#0ea5e9" },
  { id:"seguros",       icon:"🛡️", label:"Seguros",            color:"#6b7280" },
  { id:"otros",         icon:"📁", label:"Otros",              color:"#94a3b8" },
];

let DOCUMENTOS = [];
let _carpetaActiva = null;

/* ══════════════════════════
   LOAD / REFRESH
══════════════════════════ */
export async function loadDocumentos() {
  const { data, error } = await supabase.from("documentos")
    .select("*").eq("user_id", SESSION.user.id)
    .order("created_at", { ascending: false });
  if (error) { console.error("documentos:", error.message); return []; }
  return data || [];
}

export async function refreshDocumentos() {
  DOCUMENTOS = await loadDocumentos();
  renderCarpetas();
  renderDocumentosLista(_carpetaActiva);
}

/* ══════════════════════════
   RENDER CARPETAS (grid)
══════════════════════════ */
function renderCarpetas() {
  const grid = document.getElementById("carpetasGrid");
  if (!grid) return;

  const counts = {};
  const sizes  = {};
  DOCUMENTOS.forEach(d => {
    counts[d.carpeta] = (counts[d.carpeta]||0) + 1;
    sizes[d.carpeta]  = (sizes[d.carpeta]||0)  + (d.tamano||0);
  });

  grid.innerHTML = CARPETAS.map(c => `
    <div class="carpeta-card ${_carpetaActiva===c.id?"carpeta-card--active":""}"
         style="border-left:3px solid ${c.color}" 
         onclick="window._selectCarpeta('${c.id}')">
      <div style="font-size:24px;margin-bottom:8px">${c.icon}</div>
      <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:2px">${c.label}</div>
      <div style="font-size:12px;color:var(--t3)">${counts[c.id]||0} doc${(counts[c.id]||0)!==1?"s":""}</div>
      ${sizes[c.id] ? `<div style="font-size:11px;color:var(--t4);margin-top:2px">${formatBytes(sizes[c.id])}</div>` : ""}
    </div>`).join("");

  // Total
  const totalDocs = DOCUMENTOS.length;
  const totalSize = DOCUMENTOS.reduce((a,d)=>a+(d.tamano||0),0);
  const totalEl   = document.getElementById("docsTotalInfo");
  if (totalEl) totalEl.textContent = `${totalDocs} documentos · ${formatBytes(totalSize)} total`;
}

/* ══════════════════════════
   RENDER LISTA
══════════════════════════ */
function renderDocumentosLista(carpeta, busqueda = "") {
  const wrap = document.getElementById("documentosLista");
  if (!wrap) return;

  let docs = carpeta
    ? DOCUMENTOS.filter(d => d.carpeta === carpeta)
    : DOCUMENTOS;

  if (busqueda) {
    const q = busqueda.toLowerCase();
    docs = docs.filter(d => d.nombre.toLowerCase().includes(q) || (d.notas||"").toLowerCase().includes(q));
  }

  if (!docs.length) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--t3)">
        <div style="font-size:40px;margin-bottom:12px">${carpeta ? CARPETAS.find(c=>c.id===carpeta)?.icon||"📁" : "📂"}</div>
        <div style="font-size:14px;font-weight:600">Sin documentos</div>
        <div style="font-size:12px;margin-top:6px">Arrastra archivos aquí o usa el botón para subir</div>
      </div>`;
    return;
  }

  wrap.innerHTML = docs.map(d => {
    const ext  = d.nombre.split(".").pop().toLowerCase();
    const icon = { pdf:"📄", png:"🖼️", jpg:"🖼️", jpeg:"🖼️", xlsx:"📊", xls:"📊", docx:"📝", doc:"📝", csv:"📊" }[ext] || "📎";
    const color = CARPETAS.find(c=>c.id===d.carpeta)?.color || "var(--t3)";
    return `
      <div class="doc-row" id="doc_${d.id}">
        <div class="doc-icon" style="background:${color}18;color:${color}">${icon}</div>
        <div class="doc-info" onclick="window._verDoc('${d.id}')">
          <div class="doc-nombre">${d.nombre}</div>
          <div class="doc-meta">
            ${d.carpeta ? `<span style="background:${color}18;color:${color};padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">${CARPETAS.find(c=>c.id===d.carpeta)?.label||d.carpeta}</span>` : ""}
            <span>${d.tamano ? formatBytes(d.tamano) : "—"}</span>
            <span>${fmtDate(d.created_at?.slice(0,10))}</span>
            ${d.vinculado_a ? `<span>🔗 ${d.vinculado_a}</span>` : ""}
            ${d.notas ? `<span title="${d.notas}">📝 ${d.notas.substring(0,40)}</span>` : ""}
          </div>
        </div>
        <div class="doc-actions">
          <button class="ta-btn" onclick="window._descargarDoc('${d.id}')" title="Descargar">⬇️</button>
          <button class="ta-btn ta-del" onclick="window._delDoc('${d.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join("");
}

/* ══════════════════════════
   UPLOAD
══════════════════════════ */
export function showUploadModal() {
  openModal(`
    <div class="modal" style="max-width:580px">
      <div class="modal-hd">
        <span class="modal-title">📤 Subir documento</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        <!-- Dropzone -->
        <div id="uploadDropzone"
             style="border:2px dashed var(--brd);border-radius:12px;padding:36px 20px;text-align:center;cursor:pointer;transition:all .2s"
             ondragover="event.preventDefault();this.style.borderColor='var(--accent)';this.style.background='rgba(26,86,219,.04)'"
             ondragleave="this.style.borderColor='';this.style.background=''"
             ondrop="window._handleDrop(event)"
             onclick="document.getElementById('uploadInput').click()">
          <div style="font-size:36px;margin-bottom:10px">📁</div>
          <div style="font-size:14px;font-weight:600;color:var(--t1)">Arrastra archivos aquí</div>
          <div style="font-size:12px;color:var(--t3);margin-top:4px">o haz click para seleccionar</div>
          <div style="font-size:11px;color:var(--t4);margin-top:6px">PDF, JPG, PNG, Excel, Word — Máx. 50MB</div>
          <input type="file" id="uploadInput" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc,.csv" style="display:none"/>
        </div>

        <!-- Archivos seleccionados -->
        <div id="uploadPreviewList" style="margin-top:12px;display:flex;flex-direction:column;gap:6px"></div>

        <div class="modal-grid2" style="margin-top:14px">
          <div class="modal-field"><label>Carpeta de destino</label>
            <select id="uploadCarpeta" class="ff-select">
              ${CARPETAS.map(c=>`<option value="${c.id}" ${_carpetaActiva===c.id?"selected":""}>${c.icon} ${c.label}</option>`).join("")}
            </select>
          </div>
          <div class="modal-field"><label>Vincular a (opcional)</label>
            <input id="uploadVinculo" class="ff-input" placeholder="Ej: FAC-2025-001, nómina enero…"/>
          </div>
        </div>
        <div class="modal-field"><label>Notas (opcional)</label>
          <input id="uploadNotas" class="ff-input" placeholder="Descripción del documento…"/>
        </div>

        <!-- Barra de progreso -->
        <div id="uploadProgress" style="display:none;margin-top:12px">
          <div style="background:var(--brd);border-radius:10px;height:8px;overflow:hidden">
            <div id="uploadProgressBar" style="background:var(--accent);height:100%;width:0%;transition:width .3s;border-radius:10px"></div>
          </div>
          <div id="uploadProgressTxt" style="font-size:12px;color:var(--t3);margin-top:6px;text-align:center">Subiendo…</div>
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button>
        <button class="btn-modal-save" id="uploadBtn" disabled>📤 Subir archivos</button>
      </div>
    </div>`);

  let filesToUpload = [];

  const renderPreview = () => {
    const list = document.getElementById("uploadPreviewList");
    if (!list) return;
    list.innerHTML = filesToUpload.map((f,i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg2);border-radius:8px">
        <span style="font-size:16px">${{ pdf:"📄", jpg:"🖼️", jpeg:"🖼️", png:"🖼️", xlsx:"📊", xls:"📊", docx:"📝", csv:"📊" }[f.name.split(".").pop().toLowerCase()]||"📎"}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${f.name}</div>
          <div style="font-size:11px;color:var(--t3)">${formatBytes(f.size)}</div>
        </div>
        <button onclick="window._removeFile(${i})" style="background:none;border:none;cursor:pointer;color:var(--t4);font-size:16px">×</button>
      </div>`).join("");
    const btn = document.getElementById("uploadBtn");
    if (btn) btn.disabled = filesToUpload.length === 0;
  };

  window._removeFile = (i) => { filesToUpload.splice(i,1); renderPreview(); };
  window._handleDrop = (e) => {
    e.preventDefault();
    const zone = document.getElementById("uploadDropzone");
    if (zone) { zone.style.borderColor=""; zone.style.background=""; }
    filesToUpload.push(...Array.from(e.dataTransfer.files));
    renderPreview();
  };

  document.getElementById("uploadInput")?.addEventListener("change", e => {
    filesToUpload.push(...Array.from(e.target.files));
    renderPreview();
  });

  document.getElementById("uploadBtn").addEventListener("click", async () => {
    if (!filesToUpload.length) return;
    const carpeta  = document.getElementById("uploadCarpeta").value;
    const vinculo  = document.getElementById("uploadVinculo").value.trim();
    const notas    = document.getElementById("uploadNotas").value.trim();
    const progWrap = document.getElementById("uploadProgress");
    const progBar  = document.getElementById("uploadProgressBar");
    const progTxt  = document.getElementById("uploadProgressTxt");
    const btn      = document.getElementById("uploadBtn");

    btn.disabled = true;
    if (progWrap) progWrap.style.display = "";
    let subidos = 0;

    for (const file of filesToUpload) {
      if (progTxt) progTxt.textContent = `Subiendo ${file.name}…`;

      // Sanitizar nombre de archivo
      const safeName = `${SESSION.user.id}/${carpeta}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._\-]/g,"_")}`;

      const { error: upErr } = await supabase.storage
        .from("documentos").upload(safeName, file, { upsert: false });

      if (upErr) {
        // Storage no configurado — guardar solo metadatos con placeholder
        console.warn("Storage no disponible, guardando metadatos:", upErr.message);
        await supabase.from("documentos").insert({
          user_id:       SESSION.user.id,
          nombre:        file.name,
          carpeta,
          tamano:        file.size,
          tipo_mime:     file.type,
          storage_path:  safeName,
          vinculado_a:   vinculo || null,
          notas:         notas || null,
        });
      } else {
        // Obtener URL pública (firmada)
        const { data: urlData } = await supabase.storage
          .from("documentos").createSignedUrl(safeName, 60*60*24*365);
        await supabase.from("documentos").insert({
          user_id:       SESSION.user.id,
          nombre:        file.name,
          carpeta,
          tamano:        file.size,
          tipo_mime:     file.type,
          storage_path:  safeName,
          vinculado_a:   vinculo || null,
          notas:         notas || null,
        });
      }

      subidos++;
      if (progBar) progBar.style.width = (subidos / filesToUpload.length * 100) + "%";
    }

    toast(`✅ ${subidos} documento${subidos>1?"s":""} subido${subidos>1?"s":""}`, "success");
    closeModal();
    await refreshDocumentos();
  });
}

/* ══════════════════════════
   VER DOCUMENTO
══════════════════════════ */
window._verDoc = async (id) => {
  const doc = DOCUMENTOS.find(d => d.id === id);
  if (!doc) return;

  const ext = doc.nombre.split(".").pop().toLowerCase();
  const isPDF = ext === "pdf";
  const isImg = ["jpg","jpeg","png","webp"].includes(ext);

  // Intentar obtener URL firmada
  let previewUrl = null;
  if (doc.storage_path) {
    const { data } = await supabase.storage.from("documentos")
      .createSignedUrl(doc.storage_path, 3600);
    previewUrl = data?.signedUrl;
  }

  openModal(`
    <div class="modal" style="max-width:700px">
      <div class="modal-hd">
        <span class="modal-title">${doc.nombre}</span>
        <button class="modal-x" onclick="window._cm()">×</button>
      </div>
      <div class="modal-bd">
        ${previewUrl && isPDF ? `
          <iframe src="${previewUrl}" style="width:100%;height:480px;border:none;border-radius:8px"></iframe>` : ""}
        ${previewUrl && isImg ? `
          <img src="${previewUrl}" style="max-width:100%;max-height:480px;border-radius:8px;display:block;margin:0 auto"/>` : ""}
        ${!previewUrl ? `
          <div style="text-align:center;padding:40px;color:var(--t3)">
            <div style="font-size:48px;margin-bottom:12px">📎</div>
            <div style="font-size:14px">Vista previa no disponible</div>
            <div style="font-size:12px;margin-top:4px">Storage no configurado o archivo no subido</div>
          </div>` : ""}
        <div style="background:var(--bg2);border-radius:10px;padding:12px 16px;margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div><span style="color:var(--t3)">Carpeta:</span> <strong>${CARPETAS.find(c=>c.id===doc.carpeta)?.label||doc.carpeta||"—"}</strong></div>
          <div><span style="color:var(--t3)">Tamaño:</span> <strong>${doc.tamano?formatBytes(doc.tamano):"—"}</strong></div>
          <div><span style="color:var(--t3)">Subido:</span> <strong>${fmtDate(doc.created_at?.slice(0,10))}</strong></div>
          <div><span style="color:var(--t3)">Tipo:</span> <strong>${doc.tipo_mime||ext.toUpperCase()}</strong></div>
          ${doc.vinculado_a?`<div style="grid-column:1/-1"><span style="color:var(--t3)">Vinculado a:</span> <strong>${doc.vinculado_a}</strong></div>`:""}
          ${doc.notas?`<div style="grid-column:1/-1"><span style="color:var(--t3)">Notas:</span> <strong>${doc.notas}</strong></div>`:""}
        </div>
      </div>
      <div class="modal-ft">
        <button class="btn-modal-cancel" onclick="window._cm()">Cerrar</button>
        ${previewUrl?`<button class="btn-modal-save" onclick="window.open('${previewUrl}','_blank')">⬇️ Descargar</button>`:""}
      </div>
    </div>`);
};

window._descargarDoc = async (id) => {
  const doc = DOCUMENTOS.find(d=>d.id===id);
  if (!doc?.storage_path) { toast("Archivo no disponible en Storage","warn"); return; }
  const { data } = await supabase.storage.from("documentos").createSignedUrl(doc.storage_path, 60);
  if (data?.signedUrl) window.open(data.signedUrl,"_blank");
  else toast("No se pudo generar el enlace de descarga","error");
};

window._delDoc = (id) => {
  openModal(`<div class="modal"><div class="modal-hd"><span class="modal-title">Eliminar documento</span><button class="modal-x" onclick="window._cm()">×</button></div><div class="modal-bd"><p class="modal-warn">⚠️ ¿Eliminar este documento definitivamente? Se eliminará también del almacenamiento.</p></div><div class="modal-ft"><button class="btn-modal-cancel" onclick="window._cm()">Cancelar</button><button class="btn-modal-danger" id="_ddOk">Sí, eliminar</button></div></div>`);
  document.getElementById("_ddOk").addEventListener("click", async () => {
    const doc = DOCUMENTOS.find(d=>d.id===id);
    if (doc?.storage_path) {
      await supabase.storage.from("documentos").remove([doc.storage_path]);
    }
    await supabase.from("documentos").delete().eq("id",id);
    closeModal(); toast("Documento eliminado","success");
    await refreshDocumentos();
  });
};

window._selectCarpeta = (id) => {
  _carpetaActiva = _carpetaActiva === id ? null : id;
  // Actualizar label de la sección
  const labelEl = document.getElementById("docsCarpetaLabel");
  const resetEl = document.getElementById("docsCarpetaReset");
  if (labelEl) {
    if (_carpetaActiva) {
      const c = CARPETAS.find(x => x.id === _carpetaActiva);
      labelEl.textContent = `${c?.icon || "📁"} ${c?.label || _carpetaActiva}`;
    } else {
      labelEl.textContent = "📂 Todos los documentos";
    }
  }
  if (resetEl) resetEl.style.display = _carpetaActiva ? "" : "none";
  refreshDocumentos();
};

/* ══════════════════════════
   HELPERS
══════════════════════════ */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(bytes)/Math.log(k));
  return (bytes/Math.pow(k,i)).toFixed(1)+" "+sizes[i];
}

/* ══════════════════════════
   INIT
══════════════════════════ */
export function initDocumentosView() {
  document.getElementById("subirDocBtn")?.addEventListener("click", showUploadModal);

  // Búsqueda en tiempo real
  document.getElementById("docsBusqueda")?.addEventListener("input", e => {
    renderDocumentosLista(_carpetaActiva, e.target.value);
  });

  // Drag and drop directo en la vista
  const mainArea = document.getElementById("documentosMainArea");
  if (mainArea) {
    mainArea.addEventListener("dragover", e => { e.preventDefault(); mainArea.style.outline="2px dashed var(--accent)"; });
    mainArea.addEventListener("dragleave", () => { mainArea.style.outline=""; });
    mainArea.addEventListener("drop", e => {
      e.preventDefault(); mainArea.style.outline="";
      if (e.dataTransfer.files.length) showUploadModal();
    });
  }

  refreshDocumentos();
}
