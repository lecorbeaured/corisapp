// shared.js
function getCfg(){
  return {
    apiBase: (localStorage.getItem("coris_api_base") ?? "").trim() || "",
    csrf: (localStorage.getItem("coris_csrf") ?? "").trim()
  };
}

function setActiveNav(){
  const path = location.pathname.split("/").pop();
  document.querySelectorAll("[data-nav]").forEach(a=>{
    if(a.getAttribute("href").endsWith(path)) a.classList.add("active");
  });
}

async function api(path, options){
  const cfg = getCfg();
  const url = cfg.apiBase.replace(/\/$/, "") + path;

  const method = ((options && options.method) ? options.method : "GET").toUpperCase();
  const headers = Object.assign({
    "Content-Type": "application/json"
  }, (options && options.headers) ? options.headers : {});

  // CSRF for state-changing requests
  if(method !== "GET" && method !== "HEAD" && method !== "OPTIONS"){
    if(!cfg.csrf) throw new Error("Missing CSRF token. Please login again.");
    headers["X-CSRF-Token"] = cfg.csrf;
  }

  const res = await fetch(url, Object.assign({}, options || {}, { headers, credentials: "include" }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if(res.status === 401){
    localStorage.removeItem("coris_csrf");
  }

  if(!res.ok){
    const msg = (data && data.error) ? data.error : ("Request failed: " + res.status);
    throw new Error(msg);
  }
  return data;
}

async function apiPublic(path, options){
  const cfg = getCfg();
  const url = cfg.apiBase.replace(/\/$/, "") + path;

  const headers = Object.assign({
    "Content-Type": "application/json"
  }, (options && options.headers) ? options.headers : {});

  const res = await fetch(url, Object.assign({}, options || {}, { headers, credentials: "include" }));
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if(!res.ok){
    const msg = (data && data.error) ? data.error : ("Request failed: " + res.status);
    throw new Error(msg);
  }
  return data;
}

function money(n){
  const x = Number(n || 0);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function showError(el, err){
  el.innerHTML = '<div class="notice bad"><strong>Problem</strong><div class="small">'+escapeHtml(err.message || String(err))+'</div></div>';
}

function requireLogin(){
  const cfg = getCfg();
  if(!cfg.csrf){
    location.href = "login.html";
    return false;
  }
  return true;
}

async function logout(){
  try{ await api(`/v1/auth/logout`, { method: "POST" }); }catch{}
  localStorage.removeItem("coris_csrf");
  location.href = "login.html";
}

/* ── Hamburger toggle ── */
function initNavToggle(){
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("mainNav");
  if(!toggle || !nav) return;

  toggle.addEventListener("click", ()=>{
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Close nav when a link is clicked (mobile)
  nav.querySelectorAll("a").forEach(a=>{
    a.addEventListener("click", ()=>{
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  // Close nav on outside click
  document.addEventListener("click", (e)=>{
    if(!nav.contains(e.target) && !toggle.contains(e.target)){
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* ── Global logout + nav auth state ── */
function initAuthUI(){
  const cfg = getCfg();
  const loggedIn = !!cfg.csrf;

  // Wire logout button
  const logoutBtn = document.getElementById("logoutBtn");
  if(logoutBtn){
    if(loggedIn){
      logoutBtn.style.display = "";
      logoutBtn.addEventListener("click", logout);
    } else {
      logoutBtn.style.display = "none";
    }
  }

  // Hide/show login nav link based on auth state
  const loginLink = document.querySelector('[data-nav][href="login.html"]');
  if(loginLink){
    loginLink.style.display = loggedIn ? "none" : "";
  }
}

/* ── Init on DOMContentLoaded ── */
document.addEventListener("DOMContentLoaded", ()=>{
  setActiveNav();
  initNavToggle();
  initAuthUI();
  initToastContainer();
});


/* ══════════════════════════════════
   MODAL SYSTEM
   ══════════════════════════════════ */

/**
 * Open a modal with form fields.
 * @param {object} opts
 * @param {string} opts.title - Modal heading
 * @param {Array}  opts.fields - Array of { key, label, type?, value?, placeholder?, required? }
 * @param {string} opts.submitLabel - Button text (default "Save")
 * @param {string} opts.submitClass - Button extra class (default "primary")
 * @param {function} opts.onSubmit - async (values) => {...}  called with { key: value } map
 */
function openModal(opts){
  closeModal(); // close any existing modal

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay open";
  overlay.id = "corisModal";

  let fieldsHtml = "";
  (opts.fields || []).forEach(f => {
    const type = f.type || "text";
    const val = f.value !== undefined && f.value !== null ? escapeHtml(String(f.value)) : "";
    const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : "";
    const req = f.required ? " required" : "";

    if(type === "select" && f.options){
      const optionsHtml = f.options.map(o => {
        const selected = String(o.value) === String(f.value) ? " selected" : "";
        return `<option value="${escapeHtml(String(o.value))}"${selected}>${escapeHtml(o.label)}</option>`;
      }).join("");
      fieldsHtml += `<div class="field"><label class="label">${escapeHtml(f.label)}</label><select class="input" data-key="${escapeHtml(f.key)}"${req}>${optionsHtml}</select></div>`;
    } else {
      fieldsHtml += `<div class="field"><label class="label">${escapeHtml(f.label)}</label><input class="input" type="${type}" data-key="${escapeHtml(f.key)}" value="${val}"${ph}${req}/></div>`;
    }
  });

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${escapeHtml(opts.title || "")}</div>
      ${fieldsHtml}
      <div class="modal-actions">
        <button class="btn" type="button" data-modal-cancel>Cancel</button>
        <button class="btn ${opts.submitClass || "primary"}" type="button" data-modal-submit>${escapeHtml(opts.submitLabel || "Save")}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Focus first input
  const firstInput = overlay.querySelector("input, select");
  if(firstInput) setTimeout(() => firstInput.focus(), 50);

  // Cancel
  overlay.querySelector("[data-modal-cancel]").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if(e.target === overlay) closeModal(); });

  // Submit
  const submitBtn = overlay.querySelector("[data-modal-submit]");
  submitBtn.addEventListener("click", async () => {
    // Gather values
    const values = {};
    overlay.querySelectorAll("[data-key]").forEach(el => {
      values[el.getAttribute("data-key")] = el.value;
    });

    // Basic required validation
    let valid = true;
    overlay.querySelectorAll("[required]").forEach(el => {
      if(!el.value.trim()){ el.style.borderColor = "var(--danger)"; valid = false; }
      else { el.style.borderColor = ""; }
    });
    if(!valid) return;

    if(opts.onSubmit){
      submitBtn.classList.add("loading");
      submitBtn.disabled = true;
      try {
        await opts.onSubmit(values);
        closeModal();
      } catch(err) {
        toast(err.message || String(err), "bad");
        submitBtn.classList.remove("loading");
        submitBtn.disabled = false;
      }
    } else {
      closeModal();
    }
  });

  // Enter key submits
  overlay.addEventListener("keydown", (e) => {
    if(e.key === "Enter") submitBtn.click();
    if(e.key === "Escape") closeModal();
  });
}

function closeModal(){
  const existing = document.getElementById("corisModal");
  if(existing) existing.remove();
}


/* ══════════════════════════════════
   CONFIRM DIALOG
   ══════════════════════════════════ */

/**
 * Show a styled confirm dialog. Returns a promise that resolves true/false.
 * @param {string} message - The question text
 * @param {object} opts - { title?, confirmLabel?, confirmClass? }
 */
function confirmDialog(message, opts){
  return new Promise((resolve) => {
    closeModal();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay open";
    overlay.id = "corisModal";

    const o = opts || {};
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${escapeHtml(o.title || "Confirm")}</div>
        <p style="color:var(--muted);margin:0 0 18px 0;">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn" type="button" data-modal-cancel>Cancel</button>
          <button class="btn ${o.confirmClass || "danger"}" type="button" data-modal-confirm>${escapeHtml(o.confirmLabel || "Confirm")}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector("[data-modal-confirm]");
    confirmBtn.focus();

    overlay.querySelector("[data-modal-cancel]").addEventListener("click", () => { closeModal(); resolve(false); });
    confirmBtn.addEventListener("click", () => { closeModal(); resolve(true); });
    overlay.addEventListener("click", (e) => { if(e.target === overlay){ closeModal(); resolve(false); } });
    overlay.addEventListener("keydown", (e) => {
      if(e.key === "Escape"){ closeModal(); resolve(false); }
      if(e.key === "Enter"){ closeModal(); resolve(true); }
    });
  });
}


/* ══════════════════════════════════
   TOAST SYSTEM
   ══════════════════════════════════ */

function initToastContainer(){
  if(document.getElementById("toastContainer")) return;
  const c = document.createElement("div");
  c.className = "toast-container";
  c.id = "toastContainer";
  document.body.appendChild(c);
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} type - "ok" | "warn" | "bad" | "" (default)
 * @param {number} duration - ms before auto-dismiss (default 4000, 0 = manual only)
 */
function toast(message, type, duration){
  const container = document.getElementById("toastContainer");
  if(!container) return;

  const el = document.createElement("div");
  el.className = "toast " + (type || "");
  el.innerHTML = `<span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close" aria-label="Close">&times;</button>`;

  container.appendChild(el);

  const dismiss = () => {
    el.classList.add("toast-exit");
    setTimeout(() => el.remove(), 220);
  };

  el.querySelector(".toast-close").addEventListener("click", dismiss);

  const dur = duration !== undefined ? duration : 4000;
  if(dur > 0) setTimeout(dismiss, dur);
}


/* ══════════════════════════════════
   SPINNER / LOADING HELPERS
   ══════════════════════════════════ */

function spinnerHtml(text){
  const label = text || "Loading…";
  return `<span class="spinner-text"><span class="spinner"></span> ${escapeHtml(label)}</span>`;
}

function btnLoading(btn, loading){
  if(loading){
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}
