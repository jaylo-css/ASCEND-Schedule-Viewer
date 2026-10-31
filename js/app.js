/* ASCEND Schedule Viewer — UI controller. */
(function () {
  'use strict';
  const P = window.SVParser, R = window.SVRender, AI = window.SVAI, X = window.SVExtract;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  const MAX_FILES = 6;
  const PREFS_KEY = 'ascend-sv-prefs';
  const KEY_PREFIX = 'ascend-sv-key-';
  const TUTORIAL_OFF_KEY = 'ascend-sv-tutorial-off';
  const DEFAULT_PROGRAM = 'BS Computer Engineering';

  // localStorage can throw (private mode, blocked storage) — everything still works without it.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const isPhone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700;
  const wide = window.matchMedia('(min-width: 1100px)');

  const DEFAULT_OPTS = {
    layout: 'grid', theme: 'midnight', size: isPhone ? 'device' : '1080x2400', customW: 1080, customH: 2400,
    wallpaper: false, collapse: true, showTime: true, showCode: false, showSection: false, h24: false, fontScale: 1,
  };
  const prefs = { mode: 'ai', provider: 'gemini', models: {}, opts: Object.assign({}, DEFAULT_OPTS) };

  // Saved preferences and opened .json files are untrusted input: copy only known keys, with the
  // right types and ranges, and limit text length.
  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const cleanStr = (v, max) => String(v == null || typeof v === 'object' ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  const LIMITS = { code: 20, description: 120, short: 40, section: 20, prof: 60, units: 6, room: 40, program: 60, term: 30, schoolYear: 20, caption: 40, model: 80 };
  const MAX_SUBJECTS = 30, MAX_MEETINGS = 14;
  function cleanOpts(o) {
    const out = Object.assign({}, DEFAULT_OPTS);
    if (!o || typeof o !== 'object') return out;
    if (['grid', 'list'].includes(o.layout)) out.layout = o.layout;
    if (own(R.THEMES, o.theme)) out.theme = o.theme;
    if (typeof o.size === 'string' && /^(device|custom|\d{3,4}x\d{3,4})$/.test(o.size)) out.size = o.size;
    if (out.size === 'device' && !isPhone) out.size = DEFAULT_OPTS.size;
    ['customW', 'customH'].forEach((k) => { if (Number.isFinite(+o[k])) out[k] = Math.min(6000, Math.max(400, Math.round(+o[k]))); });
    ['wallpaper', 'collapse', 'showTime', 'showCode', 'showSection', 'h24'].forEach((k) => { if (typeof o[k] === 'boolean') out[k] = o[k]; });
    if (Number.isFinite(+o.fontScale)) out.fontScale = Math.min(1.5, Math.max(0.7, +o.fontScale));
    return out;
  }
  try {
    const saved = JSON.parse(store.get(PREFS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (['ai', 'offline'].includes(saved.mode)) prefs.mode = saved.mode;
      if (own(AI.PROVIDERS, saved.provider)) prefs.provider = saved.provider;
      Object.keys(AI.PROVIDERS).forEach((id) => {
        if (own(saved.models, id) && typeof saved.models[id] === 'string') prefs.models[id] = cleanStr(saved.models[id], LIMITS.model).trim();
      });
      prefs.opts = cleanOpts(saved.opts);
    }
  } catch (e) { /* ignore bad prefs */ }
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  const state = { files: [], data: null, source: '', keys: {}, busy: false, syGuessed: false, open: new Set() };

  let uidN = 0;
  const uid = () => 'i' + (++uidN).toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const logo = new Image();
  logo.onload = () => schedulePreview();
  logo.src = window.SV_LOGO || 'assets/ascend-badge.png';

  /* ------------------------------------------------------------- toast */
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3500);
  }

  /* ------------------------------------------------------------ modals */
  function openModal(id) {
    const d = document.getElementById(id);
    if (!d) return;
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
  }
  function closeModal(d) { if (d.close) d.close(); else d.removeAttribute('open'); }
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-modal]');
    if (opener) { openModal('modal-' + opener.dataset.modal); return; }
    const closer = e.target.closest('[data-close]');
    if (closer) closeModal(closer.closest('dialog'));
  });
  // Click on the dimmed backdrop closes info modals.
  $$('dialog.modal:not(.tutorial)').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) closeModal(d); }));

  /* ---------------------------------------------------------- tutorial */
  const TUT = [
    { title: 'Open your schedule', body: 'In the student portal, open My Schedule Viewer and tap the list button (☰). Or download your COR as a PDF.' },
    { title: 'Hide personal info', body: 'Crop or cover your name, student number and photo. Only the subject table is needed.' },
    { title: 'Upload it here', body: 'Tap Upload schedule and choose your screenshot or PDF. Then tap Read my schedule.' },
    { title: 'Check & download', body: 'Fix anything that looks wrong, then download your schedule as a phone wallpaper.' },
  ];
  const tut = $('#tutorial');
  let tutIdx = 0;
  function showSlide(i) {
    tutIdx = Math.max(0, Math.min(TUT.length - 1, i));
    $$('.tut-slide', tut).forEach((s, k) => { s.classList.toggle('active', k === tutIdx); s.classList.toggle('past', k < tutIdx); });
    $$('#tut-dots i').forEach((d, k) => d.classList.toggle('on', k === tutIdx));
    $('#tut-step').textContent = `Step ${tutIdx + 1} of ${TUT.length}`;
    $('#tut-title').textContent = TUT[tutIdx].title;
    $('#tut-body').textContent = TUT[tutIdx].body;
    $('[data-tut="back"]', tut).style.visibility = tutIdx ? 'visible' : 'hidden';
    $('[data-tut="next"]', tut).textContent = tutIdx === TUT.length - 1 ? "Let's go" : 'Next';
  }
  function openTutorial() {
    $('#tut-off').checked = store.get(TUTORIAL_OFF_KEY) === '1';
    showSlide(0);
    openModal('tutorial');
  }
  function closeTutorial(goUpload) {
    if ($('#tut-off').checked) store.set(TUTORIAL_OFF_KEY, '1'); else store.del(TUTORIAL_OFF_KEY);
    closeModal(tut);
    if (goUpload && !$('#start').hidden) {
      const dzEl = $('#dropzone');
      dzEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dzEl.classList.remove('attention'); void dzEl.offsetWidth; dzEl.classList.add('attention');
    }
  }
  tut.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tut]');
    if (!b) return;
    if (b.dataset.tut === 'next') { if (tutIdx === TUT.length - 1) closeTutorial(true); else showSlide(tutIdx + 1); }
    else if (b.dataset.tut === 'back') showSlide(tutIdx - 1);
    else closeTutorial(false);
  });
  tut.addEventListener('cancel', (e) => { e.preventDefault(); closeTutorial(false); }); // Esc key
  tut.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') showSlide(tutIdx + 1);
    if (e.key === 'ArrowLeft') showSlide(tutIdx - 1);
  });
  // swipe between slides on touch screens
  let touchX = null;
  $('.tut-stage', tut).addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('.tut-stage', tut).addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) showSlide(tutIdx + (dx < 0 ? 1 : -1));
    touchX = null;
  });
  $('#btn-help').addEventListener('click', openTutorial);

  /* ------------------------------------------------------------- views */
  function showView(name) {
    $('#start').hidden = name !== 'start';
    $('#workspace').hidden = name !== 'workspace';
    window.scrollTo({ top: 0 });
  }
  function setTab(tab) {
    $('#ws-grid').classList.toggle('show-edit', tab === 'edit');
    $('#ws-grid').classList.toggle('show-preview', tab === 'preview');
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'preview') drawPreview();
    if (!wide.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btn-to-preview').addEventListener('click', () => setTab('preview'));
  $('#btn-to-edit').addEventListener('click', () => setTab('edit'));

  // Tap a class on the image → jump to that subject, opened for editing.
  function openSubject(id) {
    state.open.add(id);
    const card = $(`[data-sid="${id}"]`);
    if (!card) return;
    card.classList.add('open');
    $('.subj-body', card).hidden = false;
    $('.subj-head', card).setAttribute('aria-expanded', 'true');
    if (!wide.matches) setTab('edit');
    setTimeout(() => {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    }, wide.matches ? 0 : 250);
  }
  /* --------------------------------------------- full-screen image viewer */
  const viewer = $('#viewer'), vImg = $('#viewer-img'), vScroll = $('#viewer-scroll');
  let viewerUrl = '';
  function setZoom(on, atX, atY) {
    // atX/atY: where the tap landed, as a fraction of the image, so zooming keeps that spot in view
    viewer.classList.toggle('zoomed', on);
    $('#btn-zoom').textContent = on ? 'Fit screen' : 'Zoom in';
    $('#btn-zoom').setAttribute('aria-pressed', String(on));
    if (on) {
      const fitW = Math.min(vScroll.clientWidth - 24, (vScroll.clientHeight - 12) * canvas.width / canvas.height);
      vImg.style.width = Math.round(Math.max(fitW * 2.2, Math.min(canvas.width, vScroll.clientWidth * 1.2))) + 'px';
      requestAnimationFrame(() => {
        vScroll.scrollLeft = (atX == null ? 0.5 : atX) * vImg.offsetWidth - vScroll.clientWidth / 2;
        vScroll.scrollTop = (atY == null ? 0 : atY) * vImg.offsetHeight - vScroll.clientHeight / 2;
      });
    } else {
      vImg.style.width = '';
    }
  }
  function openViewer() {
    drawPreview();
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = URL.createObjectURL(blob);
      vImg.src = viewerUrl;
      setZoom(false);
      $('#viewer-hint').textContent = 'Tap a class to edit it';
      openModal('viewer');
    }, 'image/png');
  }
  viewer.addEventListener('close', () => { setZoom(false); if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = ''; } });
  $('#btn-expand').addEventListener('click', openViewer);
  $('#btn-zoom').addEventListener('click', () => setZoom(!viewer.classList.contains('zoomed')));
  $('#btn-viewer-dl').addEventListener('click', () => $('#btn-download').click());
  // Tap a class → edit it; tap anywhere else on the image → zoom in/out there; tap outside the image → close.
  vImg.addEventListener('click', (e) => {
    const r = vImg.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const x = fx * canvas.width, y = fy * canvas.height;
    const hit = hits.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (hit) { closeModal(viewer); openSubject(hit.id); return; }
    setZoom(!viewer.classList.contains('zoomed'), fx, fy);
  });
  vScroll.addEventListener('click', (e) => { if (e.target === vScroll) closeModal(viewer); });
  $('#btn-back').addEventListener('click', () => showView('start'));

  const menu = $('#menu'), menuBtn = $('#btn-menu');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', () => { setTimeout(() => { menu.hidden = true; }, 0); });

  /* ------------------------------------------------------------- sizes */
  function deviceSize() {
    const dpr = window.devicePixelRatio || 1;
    let w = Math.round(screen.width * dpr), h = Math.round(screen.height * dpr);
    if (w > h) [w, h] = [h, w];
    if (w < 1080) { h = Math.round(h * 1080 / w); w = 1080; }
    if (w > 1440) { h = Math.round(h * 1440 / w); w = 1440; }
    return { w, h };
  }
  const SIZES = [
    { id: '1080x2400', label: 'Android phone (9:20)' },
    { id: '1080x2340', label: 'iPhone (9:19.5)' },
    { id: '1080x1920', label: 'Older phone / Story (9:16)' },
    { id: '1080x1080', label: 'Square (1:1)' },
    { id: '1440x3200', label: 'QHD Android (9:20)' },
    { id: '1080x1350', label: 'Portrait post (4:5)' },
    { id: '1920x1080', label: 'Laptop / desktop (16:9)' },
    { id: 'custom', label: 'Custom size…' },
  ];
  if (isPhone) SIZES.unshift({ id: 'device', label: 'Fit this phone' });
  function currentSize() {
    const id = prefs.opts.size;
    if (id === 'device') return deviceSize();
    if (id === 'custom') {
      const cl = (v, a, b, d) => Math.min(b, Math.max(a, Math.round(+v) || d));
      return { w: cl(prefs.opts.customW, 400, 4000, 1080), h: cl(prefs.opts.customH, 400, 6000, 2400) };
    }
    const [w, h] = id.split('x').map(Number);
    return { w, h };
  }

  /* ----------------------------------------------------------- preview */
  const canvas = $('#preview');
  let raf = 0;
  let hits = [];
  function schedulePreview() {
    if (raf || !state.data) return;
    raf = requestAnimationFrame(() => { raf = 0; drawPreview(); });
  }
  function drawPreview() {
    if (!state.data) return;
    const { w, h } = currentSize();
    hits = R.render(canvas, state.data, Object.assign({}, prefs.opts, { width: w, height: h, logo })) || [];
    $('#size-note').textContent = `${w} × ${h} px PNG`;
  }
  if (document.fonts && document.fonts.load) {
    Promise.all(['800 40px Montserrat', '700 20px Montserrat', '800 20px Inter', '700 20px Inter', '600 20px Inter', '500 20px Inter', 'italic 500 20px Inter']
      .map((f) => document.fonts.load(f))).catch(() => {}).then(() => schedulePreview());
  }

  /* ------------------------------------------------------------ upload */
  const fileInput = $('#file-input');
  const dz = $('#dropzone');

  async function addFiles(list) {
    const all = Array.from(list || []);
    const checked = await Promise.all(all.map((f) => X.inspectFile(f).catch(() => ({ error: `“${f.name}” could not be read.` }))));
    const bad = checked.find((r) => r.error);
    if (bad) toast(bad.error, 5000);
    for (const f of all.filter((f, i) => !checked[i].error)) {
      if (state.files.length >= MAX_FILES) { toast(`You can upload up to ${MAX_FILES} files.`); break; }
      const item = { id: uid(), file: f, thumb: null };
      state.files.push(item);
      X.thumbnail(f).then((t) => { item.thumb = t; renderFiles(); });
    }
    renderFiles();
    updateReadButton();
  }

  function renderFiles() {
    $('#file-list').innerHTML = state.files.map((it) => `
      <li class="file-item">
        ${it.thumb ? `<img src="${it.thumb}" alt="">` : '<span class="thumb-ph"></span>'}
        <span class="fname">${esc(it.file.name)}</span>
        <button type="button" class="icon-btn danger" data-remove="${it.id}" aria-label="Remove ${esc(it.file.name)}">✕</button>
      </li>`).join('');
    $('.dz-title').textContent = state.files.length ? 'Add another file' : 'Upload schedule';
  }

  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
  $('#file-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    state.files = state.files.filter((f) => f.id !== b.dataset.remove);
    renderFiles(); updateReadButton();
  });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  // Paste a screenshot straight from the clipboard.
  document.addEventListener('paste', (e) => {
    if ($('#start').hidden || (e.target.closest && e.target.closest('input, textarea'))) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { addFiles(files); toast('Screenshot added from clipboard.'); }
  });

  /* -------------------------------------------------------- read setup */
  function setMode(mode) {
    prefs.mode = mode; savePrefs();
    $$('#mode-seg [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    $('#ai-settings').hidden = mode !== 'ai';
    $('#offline-settings').hidden = mode !== 'offline';
    updateReadButton();
  }
  $$('#mode-seg [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function renderProviders() {
    $('#provider-seg').innerHTML = Object.entries(AI.PROVIDERS).map(([id, p]) =>
      `<button type="button" role="radio" data-prov="${id}" aria-checked="${id === prefs.provider}">${esc(p.label.replace(/ \(.*\)/, ''))}${p.badge === 'Free tier' ? '<span class="mini">FREE</span>' : ''}</button>`).join('');
  }
  function setProvider(id) {
    if (!AI.PROVIDERS[id]) id = 'gemini';
    prefs.provider = id; savePrefs();
    renderProviders();
    const p = AI.PROVIDERS[id];
    const remembered = store.get(KEY_PREFIX + id);
    if (remembered && !state.keys[id]) state.keys[id] = remembered;
    $('#api-key').value = state.keys[id] || '';
    $('#remember-key').checked = !!remembered;
    $('#btn-forget-key').hidden = !remembered;
    $('#ai-model').value = prefs.models[id] || p.defaultModel;
    $('#provider-name').textContent = p.label.replace(/ \(.*\)/, '');
    const link = $('#key-link');
    link.href = p.keyUrl;
    link.textContent = id === 'gemini' ? 'Get a free key' : 'Get a key';
    $('#api-key').placeholder = `Paste your ${p.label.split(' ')[0]} API key`;
    updateReadButton();
  }
  $('#provider-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-prov]'); if (b) setProvider(b.dataset.prov); });

  $('#api-key').addEventListener('input', (e) => {
    const v = e.target.value.trim().replace(/^["'`]+|["'`]+$/g, '');
    state.keys[prefs.provider] = v;
    if ($('#remember-key').checked) { if (v) store.set(KEY_PREFIX + prefs.provider, v); else store.del(KEY_PREFIX + prefs.provider); }
    updateReadButton();
  });
  $('#remember-key').addEventListener('change', (e) => {
    const v = state.keys[prefs.provider];
    if (e.target.checked && v) store.set(KEY_PREFIX + prefs.provider, v);
    if (!e.target.checked) store.del(KEY_PREFIX + prefs.provider);
    $('#btn-forget-key').hidden = !e.target.checked;
  });
  $('#btn-forget-key').addEventListener('click', () => {
    store.del(KEY_PREFIX + prefs.provider);
    state.keys[prefs.provider] = '';
    $('#api-key').value = ''; $('#remember-key').checked = false; $('#btn-forget-key').hidden = true;
    updateReadButton();
    toast('Key removed from this device.');
  });
  $('#btn-show-key').addEventListener('click', (e) => {
    const inp = $('#api-key');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Hide' : 'Show';
    e.target.setAttribute('aria-pressed', String(show));
  });
  $('#ai-model').addEventListener('input', (e) => { prefs.models[prefs.provider] = e.target.value.trim(); savePrefs(); });
  $('#btn-reset-model').addEventListener('click', () => {
    delete prefs.models[prefs.provider]; savePrefs();
    $('#ai-model').value = AI.PROVIDERS[prefs.provider].defaultModel;
  });

  function updateReadButton() {
    let msg = '', note = '';
    const key = state.keys[prefs.provider];
    if (!state.files.length) msg = 'Upload a file first.';
    else if (prefs.mode === 'ai' && !key) msg = 'Paste your API key, or switch to Offline.';
    // A warning only — key formats can change, so a key that looks odd can still be tried.
    if (!msg && prefs.mode === 'ai' && !AI.keyLooksRight(prefs.provider, key)) note = `This doesn't look like the right key. ${AI.PROVIDERS[prefs.provider].keyShape}.`;
    $('#btn-read').disabled = !!msg || state.busy;
    $('#read-hint').textContent = state.busy ? '' : msg || note;
    $('#read-hint').hidden = !(msg || note) || state.busy;
  }

  /* -------------------------------------------------------------- read */
  function setProgress(msg, frac) {
    $('#progress').hidden = false;
    $('#progress-msg').textContent = msg;
    const bar = $('#progress-bar');
    bar.parentElement.classList.toggle('indeterminate', frac == null);
    if (frac != null) bar.style.width = Math.round(Math.max(0.03, Math.min(1, frac)) * 100) + '%';
  }

  function showError(msg, actions) {
    const box = $('#read-error');
    const btns = [];
    if (actions.offline) btns.push('<button type="button" class="link-btn" data-err="offline">Try Offline</button>');
    if (actions.ai) btns.push('<button type="button" class="link-btn" data-err="ai">Try AI mode</button>');
    btns.push('<button type="button" class="link-btn" data-err="manual">Type it in</button>');
    box.innerHTML = `<p class="err-msg">${esc(msg)}</p>${btns.join(' · ')}`;
    box.hidden = false;
  }
  $('#read-error').addEventListener('click', (e) => {
    const b = e.target.closest('[data-err]');
    if (!b) return;
    $('#read-error').hidden = true;
    if (b.dataset.err === 'offline') { setMode('offline'); doRead(); }
    else if (b.dataset.err === 'ai') { setMode('ai'); $('#api-key').focus(); }
    else startManual();
  });

  async function doRead() {
    if (state.busy || !state.files.length) return;
    $('#read-error').hidden = true;
    state.busy = true; updateReadButton();
    const files = state.files.map((f) => f.file);
    try {
      let result;
      if (prefs.mode === 'ai') {
        const p = AI.PROVIDERS[prefs.provider];
        setProgress('Preparing your images…', null);
        const images = await X.filesForAI(files);
        setProgress(`${p.label.replace(/ \(.*\)/, '')} is reading your schedule…`, null);
        result = await AI.extract({ provider: prefs.provider, key: state.keys[prefs.provider], model: $('#ai-model').value, images });
      } else {
        setProgress('Starting…', 0);
        result = await X.offline(files, setProgress);
      }
      if (!result.subjects.length) {
        const cal = (result.kinds || []).includes('calendar');
        throw new Error(cal
          ? "This looks like the calendar view, which Offline can't read. Upload a List view screenshot or COR PDF, or use AI mode."
          : 'No subjects found. Make sure the whole subject table is visible and sharp, or try the other mode.');
      }
      loadData(buildData(result), prefs.mode);
    } catch (e) {
      console.error(e);
      showError(e.message || 'Something went wrong while reading the file.', { offline: prefs.mode === 'ai', ai: prefs.mode === 'offline' });
    } finally {
      state.busy = false;
      $('#progress').hidden = true;
      updateReadButton();
    }
  }
  $('#btn-read').addEventListener('click', doRead);

  /* -------------------------------------------------------- data model */
  function guessSchoolYear() {
    const d = new Date();
    const y = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
    return y + '–' + (y + 1);
  }
  function newMeeting(m) {
    m = m || {};
    const room = m.room || '';
    return { id: uid(), day: m.day || '', start: m.start == null ? null : m.start, end: m.end == null ? null : m.end, room, mode: m.mode || (P.isOnlineRoom(room) ? 'online' : 'f2f'), modeManual: !!m.mode };
  }
  function nextColor() {
    const used = new Set((state.data ? state.data.subjects : []).map((s) => s.color));
    return R.PALETTE.find((c) => !used.has(c)) || R.PALETTE[(state.data ? state.data.subjects.length : 0) % R.PALETTE.length];
  }
  function newSubject() {
    const secs = (state.data ? state.data.subjects : []).map((s) => s.section).filter(Boolean);
    const common = secs.sort((a, b) => secs.filter((x) => x === b).length - secs.filter((x) => x === a).length)[0] || '';
    return { id: uid(), code: '', description: '', short: '', shortAuto: true, section: common, prof: '', color: nextColor(), units: '', meetings: [newMeeting()] };
  }

  function buildData(result) {
    // AI and OCR output is clipped to sane lengths before it reaches the editor and the image.
    const list = result.subjects.slice(0, MAX_SUBJECTS);
    const shorts = P.shortNames(list.map((s) => cleanStr(s.description || s.code, LIMITS.description)));
    const subjects = list.map((s, i) => {
      const aiShort = cleanStr(s.short, LIMITS.short).trim();
      return {
        id: uid(),
        code: cleanStr(s.code, LIMITS.code),
        description: cleanStr(s.description, LIMITS.description),
        short: aiShort && aiShort.length <= 30 ? aiShort : shorts[i],
        shortAuto: true,
        section: cleanStr(s.section, LIMITS.section),
        prof: cleanStr(P.lastName(cleanStr(s.instructor, 120)), LIMITS.prof),
        color: R.PALETTE[i % R.PALETTE.length],
        units: cleanStr(s.units, LIMITS.units),
        meetings: (s.meetings && s.meetings.length ? s.meetings.slice(0, MAX_MEETINGS) : [{}])
          .map((m) => newMeeting(Object.assign({}, m, { room: cleanStr(m.room, LIMITS.room) }))),
      };
    });
    state.syGuessed = !result.meta.schoolYear;
    return {
      meta: { program: DEFAULT_PROGRAM, term: cleanStr(result.meta.term, LIMITS.term), schoolYear: cleanStr(result.meta.schoolYear, LIMITS.schoolYear) || guessSchoolYear(), caption: '' },
      subjects,
    };
  }

  const meetingOk = (m) => m.day && m.start != null && m.end != null && m.end > m.start;

  function loadData(data, source) {
    state.data = data;
    state.source = source;
    // Open only the subjects that need attention; everything else stays a tidy one-line summary.
    state.open = new Set(data.subjects.filter((s) => !s.meetings.length || !s.meetings.every(meetingOk)).map((s) => s.id));
    renderMeta();
    renderSubjects();
    renderNotices();
    showView('workspace');
    setTab('preview');
    drawPreview();
  }

  function startManual() {
    state.syGuessed = true;
    state.data = { meta: { program: DEFAULT_PROGRAM, term: '', schoolYear: guessSchoolYear(), caption: '' }, subjects: [] };
    state.data.subjects.push(newSubject());
    loadData(state.data, 'manual');
  }
  $('#btn-manual').addEventListener('click', startManual);

  $('#btn-sample').addEventListener('click', () => {
    const t = (h, m) => h * 60 + (m || 0);
    const sample = {
      meta: { term: '2nd Term', schoolYear: '2026–2027' },
      subjects: [
        { code: 'CPCNET1L', description: 'COMPUTER NETWORKS AND SECURITY - LAB', section: 'CPE231', meetings: [{ day: 'Mon', start: t(17), end: t(21), room: 'T1 - 405L' }] },
        { code: 'CPCNET30', description: 'COMPUTER NETWORKS AND SECURITY', section: 'CPE231', meetings: [{ day: 'Mon', start: t(12), end: t(14), room: 'SET VR20' }, { day: 'Thu', start: t(12), end: t(14), room: 'SET VR20' }] },
        { code: 'CPELX230', description: 'CPE ELECTIVE 2', section: 'CPE231', meetings: [{ day: 'Fri', start: t(17), end: t(21), room: 'T1 - 216' }] },
        { code: 'CPLAWS20', description: 'CpE LAWS AND PROFESSIONAL PRACTICE', section: 'CPE231', meetings: [{ day: 'Thu', start: t(17), end: t(19, 20), room: 'T1 - 221' }] },
        { code: 'CPSOFT1L', description: 'SOFTWARE DESIGN - LAB', section: 'CPE231', meetings: [{ day: 'Tue', start: t(17), end: t(21), room: 'T1 - 405L' }] },
        { code: 'CPSOFT30', description: 'SOFTWARE DESIGN', section: 'CPE231', meetings: [{ day: 'Tue', start: t(12), end: t(14), room: 'T1 - 407L' }, { day: 'Fri', start: t(12), end: t(14), room: 'T1 - 420L' }] },
        { code: 'CPTHS21D', description: 'CAPSTONE DESIGN PROJECT 2 - DRAFTING', section: 'CPE231', meetings: [{ day: 'Sat', start: t(17), end: t(21), room: 'T1 - 226' }] },
      ],
    };
    loadData(buildData(sample), 'sample');
    toast('Sample schedule loaded.');
  });

  /* ------------------------------------------------------------ editor */
  function renderMeta() {
    const m = state.data.meta;
    $('#meta-program').value = m.program || '';
    $('#meta-term').value = m.term || '';
    $('#meta-sy').value = m.schoolYear || '';
    $('#meta-caption').value = m.caption || '';
  }
  $$('[data-meta]').forEach((inp) => inp.addEventListener('input', () => {
    if (!state.data) return;
    state.data.meta[inp.dataset.meta] = inp.value;
    if (inp.dataset.meta === 'schoolYear') state.syGuessed = false;
    schedulePreview(); scheduleNotices();
  }));

  const timeVal = (min) => (min == null ? '' : P.hhmm(min));

  // One-line summary shown on the collapsed card, e.g. "Mon/Thu 12:00–2:00 PM".
  function summaryHTML(s) {
    const groups = [];
    s.meetings.filter(meetingOk).forEach((m) => {
      const g = groups.find((x) => x.start === m.start && x.end === m.end);
      if (g) g.days.push(m.day); else groups.push({ start: m.start, end: m.end, days: [m.day] });
    });
    const when = groups.map((g) => `${g.days.join('/')} ${P.fmtRange(g.start, g.end)}`).join(' · ') || 'No day/time yet';
    const online = s.meetings.length && s.meetings.every((m) => m.mode === 'online');
    const mixed = !online && s.meetings.some((m) => m.mode === 'online');
    const tags = [];
    tags.push(`<span class="tagx${online || mixed ? ' online' : ''}">${online ? 'Online' : mixed ? 'F2F + Online' : 'F2F'}</span>`);
    tags.push(s.prof ? `<span class="tagx">${esc(s.prof)}</span>` : '<span class="tagx warn">No professor</span>');
    if (!s.meetings.length || !s.meetings.every(meetingOk)) tags.push('<span class="tagx warn">Check time</span>');
    return `
      <span class="subj-dot" data-color="${esc(s.color)}"></span>
      <span class="subj-info">
        <span class="subj-name">${esc(s.short || s.code || 'New subject')}</span>
        <span class="subj-meta">${esc(when)}</span>
        <span class="subj-tags">${tags.join('')}</span>
      </span>
      <svg class="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>`;
  }

  function meetingHTML(mt) {
    return `
      <div class="mt${meetingOk(mt) ? '' : ' bad'}" data-mid="${mt.id}">
        <select class="mt-day" data-mf="day" aria-label="Day">
          <option value="">Day…</option>
          ${P.DAYS.map((d) => `<option value="${d}"${mt.day === d ? ' selected' : ''}>${P.DAY_NAMES[d]}</option>`).join('')}
        </select>
        <input type="time" data-mf="start" value="${timeVal(mt.start)}" step="300" aria-label="Start time">
        <input type="time" data-mf="end" value="${timeVal(mt.end)}" step="300" aria-label="End time">
        <input class="mt-room" data-mf="room" maxlength="40" value="${esc(mt.room)}" placeholder="Room" aria-label="Room">
        <div class="mt-row-end">
          <select data-mf="mode" aria-label="Face-to-face or online">
            <option value="f2f"${mt.mode === 'f2f' ? ' selected' : ''}>Face-to-face</option>
            <option value="online"${mt.mode === 'online' ? ' selected' : ''}>Online</option>
          </select>
          <button type="button" class="icon-btn danger" data-act="del-mt" aria-label="Remove this class day">✕</button>
        </div>
      </div>`;
  }

  function subjectHTML(s) {
    const open = state.open.has(s.id);
    return `
      <article class="subj${open ? ' open' : ''}" data-sid="${s.id}">
        <button type="button" class="subj-head" data-act="toggle" aria-expanded="${open}">${summaryHTML(s)}</button>
        <div class="subj-body"${open ? '' : ' hidden'}>
          <div class="subj-top">
            <input type="color" class="swatch" data-f="color" value="${esc(s.color)}" aria-label="Subject colour">
            <label class="f"><span>Name on image</span><input class="in-short" data-f="short" value="${esc(s.short)}" placeholder="Short name" maxlength="40"></label>
          </div>
          <div class="subj-fields">
            <label class="f wide"><span>Professor (last name)</span><input data-f="prof" maxlength="60" value="${esc(s.prof)}" class="${s.prof ? '' : 'missing'}" placeholder="Not assigned yet"></label>
          </div>
          <div class="meetings">
            ${s.meetings.map(meetingHTML).join('')}
          </div>
          <details class="mini-details">
            <summary>Full title, code &amp; section</summary>
            <div class="subj-fields">
              <label class="f wide"><span>Full title</span><input data-f="description" maxlength="120" value="${esc(s.description)}" placeholder="e.g. SOFTWARE DESIGN - LAB"></label>
              <label class="f"><span>Code</span><input data-f="code" maxlength="20" value="${esc(s.code)}" placeholder="CPSOFT1L"></label>
              <label class="f"><span>Section</span><input data-f="section" maxlength="20" value="${esc(s.section)}" placeholder="CPE231"></label>
            </div>
          </details>
          <div class="subj-actions">
            <button type="button" class="link-btn" data-act="add-mt">+ Add class day</button>
            <span>
              <button type="button" class="link-btn" data-act="regen" title="Re-make the short name from the full title">Reset name</button>
              ·
              <button type="button" class="link-btn danger" data-act="del-subj">Remove</button>
            </span>
          </div>
        </div>
      </article>`;
  }

  function renderSubjects() {
    $('#subjects').innerHTML = state.data.subjects.map(subjectHTML).join('') ||
      '<p class="hint center">No subjects yet. Add one below.</p>';
    paintDots($('#subjects'));
  }

  function refreshSummary(card, s) { $('.subj-head', card).innerHTML = summaryHTML(s); paintDots(card); }
  // Colours are set through the DOM, not inline style="" markup, so the CSP can block inline styles.
  function paintDots(root) { $$('.subj-dot[data-color]', root).forEach((el) => { el.style.background = el.dataset.color; }); }

  function findSubj(el) {
    const card = el.closest('[data-sid]');
    return card ? { card, s: state.data.subjects.find((x) => x.id === card.dataset.sid) } : {};
  }

  function onEdit(e) {
    const t = e.target;
    const { card, s } = findSubj(t);
    if (!s) return;
    if (t.dataset.f) {
      const f = t.dataset.f;
      s[f] = t.value;
      if (f === 'short') s.shortAuto = false;
      if (f === 'description' && s.shortAuto) {
        s.short = P.shortName(s.description);
        $('[data-f="short"]', card).value = s.short;
      }
      if (f === 'prof') t.classList.toggle('missing', !t.value.trim());
    } else if (t.dataset.mf) {
      const row = t.closest('[data-mid]');
      const mt = s.meetings.find((m) => m.id === row.dataset.mid);
      const f = t.dataset.mf;
      if (f === 'start' || f === 'end') mt[f] = t.value ? P.parseHHMM(t.value) : null;
      else mt[f] = t.value;
      if (f === 'mode') mt.modeManual = true;
      if (f === 'room' && !mt.modeManual) {
        mt.mode = P.isOnlineRoom(mt.room) ? 'online' : 'f2f';
        $('[data-mf="mode"]', row).value = mt.mode;
      }
      row.classList.toggle('bad', !meetingOk(mt));
    } else return;
    refreshSummary(card, s);
    schedulePreview(); scheduleNotices();
  }
  $('#subjects').addEventListener('input', onEdit);
  $('#subjects').addEventListener('change', onEdit);

  $('#subjects').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { card, s } = findSubj(b);
    if (!s) return;
    const act = b.dataset.act;
    if (act === 'toggle') {
      const open = !state.open.has(s.id);
      if (open) state.open.add(s.id); else state.open.delete(s.id);
      card.classList.toggle('open', open);
      $('.subj-body', card).hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      return;
    }
    if (act === 'del-subj') {
      if (!confirm(`Remove “${s.short || s.code || 'this subject'}”?`)) return;
      state.data.subjects = state.data.subjects.filter((x) => x !== s);
      renderSubjects();
    } else if (act === 'regen') {
      const all = P.shortNames(state.data.subjects.map((x) => x.description || x.code));
      s.short = all[state.data.subjects.indexOf(s)] || s.short;
      s.shortAuto = true;
      $('[data-f="short"]', card).value = s.short;
      refreshSummary(card, s);
    } else if (act === 'add-mt') {
      const last = s.meetings[s.meetings.length - 1];
      s.meetings.push(newMeeting(last ? { start: last.start, end: last.end, room: last.room } : {}));
      renderSubjects();
      const rows = $$(`[data-sid="${s.id}"] .mt`);
      const sel = rows.length ? $('[data-mf="day"]', rows[rows.length - 1]) : null;
      if (sel) sel.focus();
    } else if (act === 'del-mt') {
      const row = b.closest('[data-mid]');
      s.meetings = s.meetings.filter((m) => m.id !== row.dataset.mid);
      renderSubjects();
    }
    schedulePreview(); scheduleNotices();
  });

  $('#btn-add-subject').addEventListener('click', () => {
    const s = newSubject();
    state.data.subjects.push(s);
    state.open.add(s.id);
    renderSubjects();
    const card = $(`[data-sid="${s.id}"]`);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('[data-f="short"]', card).focus();
    schedulePreview(); scheduleNotices();
  });

  /* ----------------------------------------------------------- notices */
  let noticeTimer = 0;
  function scheduleNotices() { clearTimeout(noticeTimer); noticeTimer = setTimeout(renderNotices, 250); }

  // Short, one-line notices only — details live on each subject card.
  function renderNotices() {
    if (!state.data) return;
    const d = state.data, out = [];
    const nameOf = (s) => esc(s.short || s.code || 'Untitled');
    if (state.source === 'offline') out.push(['warn', 'Offline mode can make mistakes. Compare with your COR.']);
    if (!d.subjects.length) out.push(['warn', 'Add at least one subject.']);
    const incomplete = d.subjects.filter((s) => !s.meetings.length || !s.meetings.every(meetingOk));
    if (incomplete.length) out.push(['warn', `Missing day or time: ${incomplete.map(nameOf).join(', ')}.`]);
    const ms = R.flatten(d);
    const seen = new Set();
    ms.forEach((a, i) => ms.slice(i + 1).forEach((b) => {
      if (a.day === b.day && a.subj !== b.subj && a.start < b.end && b.start < a.end) {
        const key = [a.subj.id, b.subj.id, a.day].join();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(['warn', `Conflict: ${nameOf(a.subj)} and ${nameOf(b.subj)} overlap on ${P.DAY_NAMES[a.day]}.`]);
      }
    }));
    const noProf = d.subjects.filter((s) => !String(s.prof || '').trim()).length;
    if (noProf) out.push(['info', `${noProf} without a professor. They'll show “TBA” until you add one.`]);
    if (state.syGuessed && d.meta.schoolYear) out.push(['info', 'School year was guessed. Check it below.']);
    $('#notices').innerHTML = out.map(([k, html]) => `<div class="notice ${k}">${html}</div>`).join('');
    const warns = out.filter(([k]) => k === 'warn').length + (noProf ? 1 : 0);
    $('#check-bar').classList.toggle('warn', warns > 0);
    $('#check-title').textContent = warns ? `${warns} thing${warns > 1 ? 's' : ''} to check` : 'Looks good!';
    $('#check-sub').textContent = warns ? 'Compare with your COR, then fix it in Edit.' : 'Tap the image to see it full screen.';
  }

  /* ----------------------------------------------------------- options */
  function syncOptionControls() {
    const o = prefs.opts;
    $$('[data-opt]').forEach((el) => {
      const k = el.dataset.opt;
      if (el.type === 'checkbox') el.checked = !!o[k];
      else $$('[data-val]', el).forEach((b) => {
        const on = b.dataset.val === o[k];
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
    const sel = $('#size-select');
    sel.innerHTML = SIZES.map((s) => `<option value="${s.id}"${s.id === o.size ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
    if (!SIZES.some((s) => s.id === o.size)) { o.size = SIZES[0].id; sel.value = o.size; }
    $('#custom-size').hidden = o.size !== 'custom';
    $('#custom-w').value = o.customW; $('#custom-h').value = o.customH;
    $('#font-scale').value = Math.round((o.fontScale || 1) * 100);
    $('#font-scale-val').textContent = Math.round((o.fontScale || 1) * 100) + '%';
  }
  function setOpt(k, v) { prefs.opts[k] = v; savePrefs(); syncOptionControls(); drawPreview(); }

  $$('[data-opt]').forEach((el) => {
    if (el.type === 'checkbox') el.addEventListener('change', () => setOpt(el.dataset.opt, el.checked));
    else el.addEventListener('click', (e) => { const b = e.target.closest('[data-val]'); if (b) setOpt(el.dataset.opt, b.dataset.val); });
  });
  $('#size-select').addEventListener('change', (e) => setOpt('size', e.target.value));
  $('#font-scale').addEventListener('input', (e) => {
    prefs.opts.fontScale = +e.target.value / 100;
    $('#font-scale-val').textContent = e.target.value + '%';
    schedulePreview();
  });
  $('#font-scale').addEventListener('change', savePrefs);
  ['customW', 'customH'].forEach((k) => {
    const el = $(k === 'customW' ? '#custom-w' : '#custom-h');
    el.addEventListener('change', () => { prefs.opts[k] = +el.value; savePrefs(); drawPreview(); });
  });

  /* ---------------------------------------------------------- download */
  function fileName() {
    const { w, h } = currentSize();
    const m = state.data.meta;
    const t = [m.term, m.schoolYear].filter(Boolean).join(' ').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `ASCEND-Schedule${t ? '-' + t : ''}-${w}x${h}.png`;
  }
  function getBlob() {
    drawPreview();
    return new Promise((resolve, reject) => {
      try { canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'); }
      catch (e) { reject(e); }
    });
  }
  $('#btn-download').addEventListener('click', async () => {
    try {
      const blob = await getBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Saved! Set it as your wallpaper from your Gallery or Photos.', 5000);
    } catch (e) {
      toast(e.message || 'Download failed.');
    }
  });

  let canShareFiles = false;
  try {
    canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] }));
  } catch (e) { canShareFiles = false; }
  $('#btn-share').hidden = !canShareFiles;
  $('#btn-share').addEventListener('click', async () => {
    try {
      const blob = await getBlob();
      await navigator.share({ files: [new File([blob], fileName(), { type: 'image/png' })], title: 'My class schedule' });
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Sharing didn’t work here. Use Download instead.');
    }
  });

  /* ------------------------------------------------ save / open / reset */
  $('#btn-export').addEventListener('click', () => {
    const d = state.data;
    const json = {
      app: 'ascend-schedule-viewer', version: 1,
      meta: d.meta,
      subjects: d.subjects.map((s) => ({
        code: s.code, description: s.description, short: s.short, section: s.section, prof: s.prof, color: s.color, units: s.units,
        meetings: s.meetings.map((m) => ({ day: m.day, start: m.start == null ? '' : P.hhmm(m.start), end: m.end == null ? '' : P.hhmm(m.end), room: m.room, mode: m.mode })),
      })),
      options: prefs.opts,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'ASCEND-Schedule.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Saved. Open it here later to keep editing.');
  });

  $('#import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 1024 * 1024) throw new Error('too big');
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'ascend-schedule-viewer' || !Array.isArray(j.subjects)) throw new Error('bad');
      state.syGuessed = false;
      const obj = (v) => (v && typeof v === 'object' ? v : {});
      const meta = obj(j.meta);
      const str = (o, k) => cleanStr(own(o, k) ? o[k] : '', LIMITS[k]);
      const data = {
        meta: { program: str(meta, 'program') || DEFAULT_PROGRAM, term: str(meta, 'term'), schoolYear: str(meta, 'schoolYear'), caption: str(meta, 'caption') },
        subjects: j.subjects.filter((s) => s && typeof s === 'object').slice(0, MAX_SUBJECTS).map((s, i) => ({
          id: uid(), code: str(s, 'code'), description: str(s, 'description'), short: str(s, 'short'), shortAuto: false,
          section: str(s, 'section'), prof: str(s, 'prof'), units: str(s, 'units'),
          color: /^#[0-9a-f]{6}$/i.test(String(s.color || '')) ? s.color : R.PALETTE[i % R.PALETTE.length],
          meetings: (Array.isArray(s.meetings) ? s.meetings : []).filter((m) => m && typeof m === 'object').slice(0, MAX_MEETINGS).map((m) => newMeeting({
            day: P.normDay(String(m.day || '')), start: P.parseHHMM(String(m.start || '')), end: P.parseHHMM(String(m.end || '')),
            room: str(m, 'room'), mode: m.mode === 'online' ? 'online' : m.mode === 'f2f' ? 'f2f' : '',
          })),
        })),
      };
      if (j.options) { Object.assign(prefs.opts, cleanOpts(j.options)); savePrefs(); syncOptionControls(); }
      loadData(data, 'import');
      toast('Schedule opened.');
    } catch (err) {
      toast("That file isn't an ASCEND schedule (.json).");
    }
  });
  // keyboard access for the "Open saved copy" label in the menu
  $('#menu label').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#import-input').click(); } });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Start over? Your current schedule will be cleared.')) return;
    state.data = null; state.files = []; state.source = '';
    renderFiles(); updateReadButton();
    $('#read-error').hidden = true;
    showView('start');
  });

  // Nothing is saved automatically, so warn before leaving with a schedule open.
  window.addEventListener('beforeunload', (e) => {
    if (state.data) { e.preventDefault(); e.returnValue = ''; }
  });

  /* -------------------------------------------------------------- init */
  // Refuse to run inside another site's frame (clickjacking). Vercel also blocks this with headers.
  if (window.top !== window.self) {
    document.body.innerHTML = '<p class="framed">Open the ASCEND Schedule Viewer in its own tab.</p>';
    return;
  }
  renderProviders();
  setProvider(prefs.provider);
  setMode(prefs.mode);
  syncOptionControls();
  renderFiles();
  updateReadButton();
  if (store.get(TUTORIAL_OFF_KEY) !== '1') openTutorial();

  // Exposed for quick testing from the console / automated checks.
  window.SVApp = { state, prefs, loadData, buildData, drawPreview, openTutorial };
})();
