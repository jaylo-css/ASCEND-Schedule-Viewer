/* ASCEND Schedule Viewer — reading uploaded files (PDF / images) entirely in the browser. */
(function (root) {
  'use strict';

  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const MAX_PDF_PAGES = 3;

  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) {
      loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.async = true; s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = () => { delete loaded[url]; reject(new Error('Could not download a required component. Check your internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  }

  async function pdfjs() {
    await loadScript(PDFJS_URL);
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return root.pdfjsLib;
  }

  function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name); }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This image could not be opened. Try PNG or JPG.'));
      img.src = src;
    });
  }

  async function fileToImage(file) {
    const url = URL.createObjectURL(file);
    try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  function canvasFrom(src, scale) {
    const w = Math.round((src.naturalWidth || src.width) * scale);
    const h = Math.round((src.naturalHeight || src.height) * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }

  async function renderPdfPages(file, targetWidth) {
    const lib = await pdfjs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: targetWidth / base.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(c);
    }
    return pages;
  }

  /** Small preview for the upload list. */
  async function thumbnail(file) {
    try {
      const src = isPdf(file) ? (await renderPdfPages(file, 360))[0] : await fileToImage(file);
      const scale = Math.min(1, 360 / (src.naturalWidth || src.width));
      return canvasFrom(src, scale).toDataURL('image/jpeg', 0.8);
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------- AI images */

  function canvasToPayload(c, mime) {
    const dataUrl = c.toDataURL(mime, 0.92);
    return { mime, dataUrl, b64: dataUrl.split(',')[1] };
  }

  /** Images for the AI: PDFs rendered to pages, photos capped at ~2000px. */
  async function filesForAI(files) {
    const out = [];
    for (const f of files) {
      if (isPdf(f)) {
        (await renderPdfPages(f, 1800)).forEach((c) => out.push(canvasToPayload(c, 'image/jpeg')));
      } else {
        const img = await fileToImage(f);
        const longest = Math.max(img.naturalWidth, img.naturalHeight);
        out.push(canvasToPayload(canvasFrom(img, Math.min(1, 2000 / longest)), 'image/jpeg'));
      }
    }
    return out;
  }

  /* ------------------------------------------------------- offline words */

  async function pdfWords(file) {
    const lib = await pdfjs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const words = [];
    let yOffset = 0;
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 2 });
      const tc = await page.getTextContent();
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const tx = lib.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || 10;
        const x = tx[4], base = tx[5] + yOffset;
        const width = (it.width || it.str.length * fh * 0.5) * vp.scale;
        const cw = width / it.str.length;
        // Split each text run into word boxes so the table rebuild works the same as with OCR.
        const re = /\S+/g;
        let m;
        while ((m = re.exec(it.str))) {
          const x0 = x + m.index * cw;
          words.push({ text: m[0], x0, x1: x0 + m[0].length * cw, y0: base - fh * 0.8, y1: base + fh * 0.2 });
        }
      });
      yOffset += vp.height;
    }
    return words;
  }

  let worker = null;
  let progressHandler = null; // the worker is reused, so its logger forwards to whoever is scanning now
  async function ocrWorker() {
    await loadScript(TESSERACT_URL);
    if (!worker) {
      worker = await root.Tesseract.createWorker('eng', 1, {
        logger: (m) => { if (progressHandler && m.status === 'recognizing text') progressHandler(m.progress); },
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
    }
    return worker;
  }

  function prepForOcr(src) {
    const w = src.naturalWidth || src.width;
    // Upscale small screenshots so letters are ~25px tall; keep big photos manageable.
    const scale = Math.max(1, Math.min(3, 2400 / w));
    const c = canvasFrom(src, scale);
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: c, scale };
  }

  function parseTsv(tsv) {
    const words = [];
    String(tsv || '').split('\n').forEach((line) => {
      const c = line.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const text = c.slice(11).join('\t').trim();
      const conf = +c[10];
      if (!text || conf < 20) return;
      const left = +c[6], top = +c[7], w = +c[8], h = +c[9];
      words.push({ text, conf, x0: left, y0: top, x1: left + w, y1: top + h });
    });
    return words;
  }

  async function recognize(wk, canvas, psm) {
    await wk.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await wk.recognize(canvas, {}, { text: true, tsv: true, blocks: true });
    let words = parseTsv(data.tsv);
    if (!words.length && Array.isArray(data.words)) {
      words = data.words.filter((w) => w.confidence >= 20)
        .map((w) => ({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
    }
    return words;
  }

  function overlaps(a, b) {
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return ix > 0 && iy > 0 && ix * iy > 0.3 * (a.x1 - a.x0) * (a.y1 - a.y0);
  }

  // Two passes: "uniform block" (PSM 6) reads table rows best; "sparse text" (PSM 11) catches
  // the small, half-line-offset fragments inside multi-line cells (e.g. "405L" under "T1 -").
  async function ocrWords(src, onProgress) {
    const wk = await ocrWorker();
    const { canvas } = prepForOcr(src);
    progressHandler = (p) => onProgress && onProgress(p * 0.5);
    const main = await recognize(wk, canvas, '6');
    progressHandler = (p) => onProgress && onProgress(0.5 + p * 0.5);
    const sparse = await recognize(wk, canvas, '11');
    progressHandler = null;
    const hit = (a, b) => overlaps(a, b) || overlaps(b, a);
    // A shaky block-pass word (often two cell lines mashed together) gives way to a confident sparse-pass word.
    const kept = main.filter((m) => !(m.conf < 70 && sparse.some((s) => s.conf >= 75 && s.conf > m.conf + 10 && hit(m, s))));
    root.SVExtract.lastPasses = { main, sparse };
    return kept.concat(sparse.filter((s) => !kept.some((m) => hit(s, m))));
  }

  /**
   * Offline extraction for a list of files.
   * onStatus(message, fraction) reports progress.
   */
  async function offline(files, onStatus) {
    const P = root.SVParser;
    const all = [];
    const meta = { term: '', schoolYear: '' };
    const kinds = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const label = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
      let words = [];
      if (isPdf(f)) {
        onStatus('Reading PDF text' + label + '…', i / files.length);
        words = await pdfWords(f);
        if (words.length < 15) {
          // Scanned PDF: no text layer, fall back to OCR on the rendered page(s).
          const pages = await renderPdfPages(f, 2200);
          words = [];
          for (const pg of pages) {
            onStatus('Scanning PDF page' + label + '…', i / files.length);
            const off = words.length ? Math.max(...words.map((w) => w.y1)) + 50 : 0;
            (await ocrWords(pg, (p) => onStatus('Scanning PDF' + label + '…', (i + p) / files.length)))
              .forEach((w) => words.push(Object.assign(w, { y0: w.y0 + off, y1: w.y1 + off })));
          }
        }
      } else {
        onStatus('Loading text recognizer' + label + '…', i / files.length);
        const img = await fileToImage(f);
        words = await ocrWords(img, (p) => onStatus('Scanning image' + label + '… ' + Math.round(p * 100) + '%', (i + p) / files.length));
      }
      root.SVExtract.lastWords = words; // handy when debugging a bad scan from the console
      const r = P.parseWords(words);
      kinds.push(r.kind);
      r.subjects.forEach((s) => all.push(s));
      if (!meta.term && r.meta.term) meta.term = r.meta.term;
      if (!meta.schoolYear && r.meta.schoolYear) meta.schoolYear = r.meta.schoolYear;
    }
    onStatus('Done', 1);
    return { subjects: P.mergeSubjects(all), meta, kinds };
  }

  root.SVExtract = { isPdf, thumbnail, filesForAI, offline, loadScript };
})(window);
