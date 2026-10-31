/* ASCEND Schedule Viewer — draws the schedule image on a <canvas>.
 * Everything is sized in "u" units (1u = 1px on a 1080-wide portrait image) so any output size works. */
(function (root) {
  'use strict';
  const P = root.SVParser;

  const PALETTE = ['#2F6FEB', '#0E9BC2', '#7A4FE0', '#D0347E', '#13955F', '#C27C0E', '#4B47D6', '#0E8F84', '#D4572A', '#5A6B85'];

  const THEMES = {
    midnight: {
      name: 'Midnight', bg: ['#090e2c', '#111a55'], style: 'solid',
      text: '#ffffff', sub: '#c3cdfa', accent: '#2ec5f0', gold: '#f5b81c', muted: 'rgba(255,255,255,0.55)',
      line: 'rgba(255,255,255,0.07)', lineStrong: 'rgba(255,255,255,0.16)', panel: 'rgba(255,255,255,0.06)', deco: 0.16,
    },
    ascend: {
      name: 'ASCEND Blue', bg: ['#1a1f6a', '#1f57ad', '#16a6d8'], style: 'card',
      text: '#ffffff', sub: '#dce8ff', accent: '#9fe8ff', gold: '#ffc93c', muted: 'rgba(255,255,255,0.7)',
      line: 'rgba(255,255,255,0.12)', lineStrong: 'rgba(255,255,255,0.25)', panel: 'rgba(255,255,255,0.12)', deco: 0.2,
    },
    light: {
      name: 'Light', bg: ['#f7f9ff', '#e6eeff'], style: 'tint',
      text: '#151b4d', sub: '#3a4785', accent: '#1479c7', gold: '#c98c00', muted: 'rgba(21,27,77,0.55)',
      line: 'rgba(21,27,77,0.08)', lineStrong: 'rgba(21,27,77,0.16)', panel: 'rgba(21,27,77,0.05)', deco: 0.09,
    },
  };

  // Where each class was drawn (canvas px), so the page can map a tap on the image to a subject.
  let hits = [];

  const SANS = 'Inter, "Segoe UI", Roboto, system-ui, sans-serif';
  const HEAD = 'Montserrat, Inter, "Segoe UI", system-ui, sans-serif';

  function setFont(ctx, weight, size, fam) { ctx.font = `${weight} ${Math.max(1, size).toFixed(1)}px ${fam || SANS}`; }
  function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, withHex, t) {
    const a = hexToRgb(hex), b = hexToRgb(withHex);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

  // Word-wrap on plain spaces only (NBSP keeps "T1 - 405L" or "2:00 PM" together).
  // `indent` reserves room on the first line for a pill or icon; if nothing fits beside it, the text starts on line 2.
  function wrap(ctx, text, maxW, indent) {
    indent = indent || 0;
    const lines = [];
    let cur = '';
    const fits = (s) => ctx.measureText(s).width <= maxW - (lines.length ? 0 : indent);
    String(text || '').split(/ +/).filter(Boolean).forEach((w) => {
      const test = cur ? cur + ' ' + w : w;
      if (fits(test)) { cur = test; return; }
      if (cur || (indent && !lines.length)) { lines.push(cur); cur = ''; }
      if (fits(w)) { cur = w; return; }
      for (const ch of w) { // a single word wider than the box: break it
        if (cur && !fits(cur + ch)) { lines.push(cur); cur = ch; } else cur += ch;
      }
    });
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }
  const NB = ' ';
  const keepTogether = (s) => String(s || '').trim().replace(/ /g, NB).replace(new RegExp(NB + '?/' + NB + '?', 'g'), ' / ');

  function ellipsize(ctx, text, maxW) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text.trimEnd() + '…';
  }

  /* --------------------------------------------------------- data shaping */

  function flatten(data) {
    const out = [];
    (data.subjects || []).forEach((s, si) => {
      (s.meetings || []).forEach((m) => {
        if (!m.day || m.start == null || m.end == null || m.end <= m.start) return;
        out.push({ subj: s, color: s.color || PALETTE[si % PALETTE.length], day: m.day, start: m.start, end: m.end, room: m.room || '', online: m.mode === 'online' });
      });
    });
    return out;
  }

  /** Time axis: hour rows, with long empty stretches squeezed into a thin "no classes" band. */
  function segments(ms, collapse) {
    const s0 = Math.floor(Math.min(...ms.map((m) => m.start)) / 60) * 60;
    const e0 = Math.ceil(Math.max(...ms.map((m) => m.end)) / 60) * 60;
    if (!collapse) return [{ a: s0, b: e0, gap: false }];
    const segs = [];
    for (let h = s0; h < e0; h += 60) {
      const active = ms.some((m) => m.start < h + 60 && m.end > h);
      const last = segs[segs.length - 1];
      if (last && last.active === active) last.b = h + 60;
      else segs.push({ a: h, b: h + 60, active });
    }
    return segs.map((s) => ({ a: s.a, b: s.b, gap: !s.active && s.b - s.a >= 120 }));
  }

  function assignLanes(list) {
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster = [], clusterEnd = -1;
    const flush = () => { const n = Math.max(...cluster.map((m) => m.lane)) + 1; cluster.forEach((m) => { m.lanes = n; }); };
    list.forEach((m) => {
      if (cluster.length && m.start >= clusterEnd) { flush(); cluster = []; clusterEnd = -1; }
      const used = cluster.filter((c) => c.end > m.start).map((c) => c.lane);
      let lane = 0;
      while (used.includes(lane)) lane++;
      m.lane = lane;
      cluster.push(m);
      clusterEnd = Math.max(clusterEnd, m.end);
    });
    if (cluster.length) flush();
  }

  /* -------------------------------------------------------------- pieces */

  function drawBackground(ctx, W, H, th, u) {
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    th.bg.forEach((c, i) => g.addColorStop(i / (th.bg.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Circuit traces, echoing the ASCEND logo.
    // Kept in the top-right corner (in u units from the edge) so they never cross the timetable.
    const traces = [
      [[0, 22], [120, 22], [150, 52], [150, 96]],
      [[0, 58], [70, 58], [96, 84], [96, 128]],
      [[0, 94], [30, 94], [46, 110], [46, 150]],
    ];
    ctx.save();
    ctx.lineWidth = Math.max(1, 3 * u);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(th.accent, th.deco * 1.6);
    traces.forEach((t) => {
      ctx.beginPath();
      t.forEach(([dx, y], i) => (i ? ctx.lineTo(W - dx * u, y * u) : ctx.moveTo(W - dx * u, y * u)));
      ctx.stroke();
      const [ex, ey] = t[t.length - 1];
      const s = 12 * u;
      ctx.fillStyle = rgba(th.gold, Math.min(1, th.deco * 3.5));
      ctx.fillRect(W - ex * u - s / 2, ey * u - s / 2, s, s);
    });
    ctx.restore();
  }

  function drawHeader(ctx, data, th, u, x, y, W, logo, opt) {
    const meta = data.meta || {};
    const L = Math.round(138 * u);
    if (logo && logo.complete && logo.naturalWidth) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 18 * u;
      ctx.beginPath(); ctx.arc(x + L / 2, y + L / 2, L / 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      ctx.drawImage(logo, x, y, L, L);
    }
    const tx = x + L + 30 * u;
    const maxW = W - tx - x;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    let title = opt.title || 'CLASS SCHEDULE';
    let fs = 54 * u;
    setFont(ctx, 800, fs, HEAD); spacing(ctx, 1.5 * u);
    while (ctx.measureText(title).width > maxW && fs > 26 * u) { fs -= 2 * u; setFont(ctx, 800, fs, HEAD); }
    ctx.fillStyle = th.text;
    let ty = y + 50 * u;
    ctx.fillText(title, tx, ty);
    spacing(ctx, 0);

    const program = meta.program || 'BS Computer Engineering';
    setFont(ctx, 700, 30 * u);
    ctx.fillStyle = th.accent;
    ty += 44 * u;
    ctx.fillText(ellipsize(ctx, program, maxW), tx, ty);

    const termBits = [meta.term, meta.schoolYear ? 'S.Y. ' + meta.schoolYear : ''].filter(Boolean).join('  •  ');
    if (termBits) {
      setFont(ctx, 500, 28 * u);
      ctx.fillStyle = th.sub;
      ty += 40 * u;
      ctx.fillText(ellipsize(ctx, termBits, maxW), tx, ty);
    }
    if (meta.caption) {
      setFont(ctx, 700, 24 * u);
      ctx.fillStyle = th.gold;
      ty += 36 * u;
      ctx.fillText(ellipsize(ctx, meta.caption, maxW), tx, ty);
    }
    return Math.max(y + L, ty + 12 * u);
  }

  function pill(ctx, x, yMid, text, fs, bg, fg) {
    setFont(ctx, 800, fs); spacing(ctx, 0.6 * fs / 10);
    const w = ctx.measureText(text).width + fs * 1.0;
    const h = fs * 1.55;
    ctx.fillStyle = bg;
    rr(ctx, x, yMid - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + fs * 0.5, yMid + fs * 0.05);
    spacing(ctx, 0);
    return w;
  }
  function pillWidth(ctx, text, fs) {
    setFont(ctx, 800, fs); spacing(ctx, 0.6 * fs / 10);
    const w = ctx.measureText(text).width + fs * 1.0;
    spacing(ctx, 0);
    return w;
  }

  function modeColors(th, color, online) {
    if (th.style === 'solid') {
      return online ? { bg: '#ffffff', fg: color } : { bg: 'rgba(255,255,255,0.22)', fg: '#ffffff' };
    }
    return online ? { bg: color, fg: '#ffffff' } : { bg: rgba(color, 0.14), fg: color };
  }

  function blockFill(ctx, th, color, x, y, w, h, r, online, u) {
    ctx.save();
    if (th.style === 'solid') {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, mix(color, '#ffffff', 0.08));
      g.addColorStop(1, mix(color, '#000000', 0.12));
      ctx.fillStyle = g;
    } else if (th.style === 'card') {
      ctx.shadowColor = 'rgba(5,10,40,0.25)'; ctx.shadowBlur = 10 * u; ctx.shadowOffsetY = 3 * u;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
    } else {
      ctx.fillStyle = mix(color, '#ffffff', 0.86);
    }
    rr(ctx, x, y, w, h, r); ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(ctx, x, y, w, h, r); ctx.clip();
    if (th.style !== 'solid') {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.max(4, 7 * u), h);
    }
    if (online) {
      // diagonal stripes mark online classes
      ctx.strokeStyle = th.style === 'solid' ? 'rgba(255,255,255,0.09)' : rgba(color, 0.09);
      ctx.lineWidth = 8 * u;
      for (let s = -h; s < w + h; s += 26 * u) {
        ctx.beginPath(); ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + h, y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function personIcon(ctx, x, yMid, s, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x + s / 2, yMid - s * 0.2, s * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + s / 2, yMid + s * 0.42, s * 0.42, s * 0.34, 0, Math.PI, 0); ctx.fill();
    ctx.restore();
  }

  function blockInfo(m, opt) {
    const s = m.subj;
    const prof = (s.prof || '').trim();
    const label = [opt.showCode && s.code, opt.showSection && s.section].filter(Boolean).join(' · ');
    return {
      name: s.short || s.description || s.code || 'Untitled',
      label,
      time: opt.showTime ? P.fmtRange(m.start, m.end, { h24: opt.h24 }).replace(/ (AM|PM)/g, NB + '$1').replace('–', ' – ') : '',
      room: m.room || '',
      online: m.online,
      prof: prof || 'TBA',
      profMissing: !prof,
    };
  }

  /* ---------------------------------------------------------------- grid */

  function drawGrid(ctx, area, ms, th, u, opt) {
    const days = P.DAYS.filter((d) => ms.some((m) => m.day === d));
    const timeW = Math.round(78 * u);
    const headH = Math.round(60 * u);
    const segs = segments(ms, opt.collapse);
    const gapH = Math.round(54 * u);
    const nGaps = segs.filter((s) => s.gap).length;
    const activeMin = segs.filter((s) => !s.gap).reduce((t, s) => t + s.b - s.a, 0);
    const gridTop = area.y + headH;
    const k = Math.max(0.1, (area.h - headH - nGaps * gapH) / activeMin);
    const Y = (t) => {
      let y = gridTop;
      for (const s of segs) {
        const len = s.gap ? gapH : (s.b - s.a) * k;
        if (t <= s.b) return y + ((Math.max(t, s.a) - s.a) / (s.b - s.a)) * len;
        y += len;
      }
      return y;
    };
    const gridBottom = Y(segs[segs.length - 1].b);
    const colW = (area.w - timeW) / days.length;
    const colX = (i) => area.x + timeW + i * colW;

    // day headers
    days.forEach((d, i) => {
      ctx.fillStyle = th.panel;
      rr(ctx, colX(i) + 4 * u, area.y, colW - 8 * u, headH - 12 * u, 12 * u); ctx.fill();
      setFont(ctx, 800, Math.min(26 * u, colW * 0.2), HEAD); spacing(ctx, 1.5 * u);
      ctx.fillStyle = th.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(d.toUpperCase(), colX(i) + colW / 2, area.y + (headH - 12 * u) / 2 + u);
      spacing(ctx, 0);
    });

    // column separators
    ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(1, u);
    for (let i = 0; i <= days.length; i++) {
      ctx.beginPath(); ctx.moveTo(colX(i), gridTop); ctx.lineTo(colX(i), gridBottom); ctx.stroke();
    }

    // hour lines + labels
    const labelled = new Set();
    setFont(ctx, 600, 20 * u);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    segs.forEach((s) => {
      if (s.gap) {
        const y0 = Y(s.a), y1 = Y(s.b);
        ctx.save();
        ctx.fillStyle = th.panel;
        ctx.fillRect(area.x + timeW, y0, area.w - timeW, y1 - y0);
        setFont(ctx, 700, 16 * u); spacing(ctx, 3 * u);
        ctx.fillStyle = th.muted; ctx.textAlign = 'center';
        ctx.fillText('NO CLASSES', area.x + timeW + (area.w - timeW) / 2, (y0 + y1) / 2);
        ctx.restore();
        setFont(ctx, 600, 20 * u); ctx.textAlign = 'right';
        return;
      }
      for (let t = s.a; t <= s.b; t += 60) {
        const y = Y(t);
        ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(1, u);
        ctx.beginPath(); ctx.moveTo(area.x + timeW - 6 * u, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
        if (!labelled.has(t)) {
          labelled.add(t);
          ctx.fillStyle = th.muted;
          ctx.fillText(opt.h24 ? P.hhmm(t) : P.fmtTime(t, { short: true }), area.x + timeW - 10 * u, y);
        }
      }
    });

    // blocks
    const byDay = {};
    ms.forEach((m) => { (byDay[m.day] = byDay[m.day] || []).push(Object.assign({}, m)); });
    const blocks = [];
    days.forEach((d, i) => {
      assignLanes(byDay[d]);
      byDay[d].forEach((m) => {
        const inner = colW - 8 * u;
        const w = inner / m.lanes;
        blocks.push({
          m, info: blockInfo(m, opt),
          x: colX(i) + 4 * u + m.lane * w, y: Y(m.start) + 2 * u, w: w - (m.lanes > 1 ? 3 * u : 0), h: Y(m.end) - Y(m.start) - 4 * u,
        });
      });
    });
    layoutBlocks(ctx, blocks, th, u, colW, opt);
  }

  // Pick one font size that fits every block; drop low-priority lines only if a block still can't fit.
  // opt.fontScale (the "Text size" slider) scales the starting size and how big the details are next to the name.
  function layoutBlocks(ctx, blocks, th, u, colW, opt) {
    const fsc = opt.fontScale || 1;
    const maxFs = Math.min(36 * u, colW * 0.18) * fsc;
    const minFs = Math.min(maxFs, Math.max(11 * u, Math.min(15 * u, colW * 0.1)) * Math.min(1, fsc));
    const metaRatio = Math.min(1.05, Math.max(0.72, 0.88 * fsc));
    const measure = (b, fs, drop) => {
      const pad = fs * 0.45;
      const mfs = fs * metaRatio, mlh = mfs * 1.4, lh = fs * 1.14;
      const maxW = b.w - pad * 2 - (th.style === 'solid' ? 0 : 6 * u);
      setFont(ctx, 800, fs, HEAD);
      // "&" stays on the line before ("CompNet &" / "Security") so it never sits alone on a line.
      const nameText = b.info.name.replace(/ & /g, NB + '& ');
      // A word too wide for the block would be split mid-word — treat that size as "doesn't fit".
      let broken = nameText.split(/ +/).some((w) => ctx.measureText(w).width > maxW);
      const nameLines = wrap(ctx, nameText, maxW);
      setFont(ctx, 600, mfs);
      if (b.info.room && ctx.measureText(keepTogether(b.info.room)).width > maxW) broken = true;
      const metas = [];
      if (b.info.time && !drop.includes('time')) {
        setFont(ctx, 600, mfs);
        metas.push({ k: 'time', lines: wrap(ctx, b.info.time, maxW) });
      }
      if (!drop.includes('room')) {
        const pw = pillWidth(ctx, b.info.online ? 'ONLINE' : 'F2F', mfs * 0.72) + mfs * 0.4;
        setFont(ctx, 600, mfs);
        metas.push({ k: 'room', pw, lines: b.info.room ? wrap(ctx, keepTogether(b.info.room), maxW, pw) : [''] });
      }
      if (!drop.includes('prof')) {
        setFont(ctx, b.info.profMissing ? '500 italic' : 600, mfs);
        metas.push({ k: 'prof', lines: wrap(ctx, b.info.prof, maxW, mfs * 1.3) });
      }
      let labelLines = [];
      if (b.info.label && !drop.includes('label')) {
        setFont(ctx, 700, mfs * 0.92); spacing(ctx, 0.8 * u);
        labelLines = wrap(ctx, b.info.label.replace(/ · /g, NB + '· '), maxW);
        spacing(ctx, 0);
      }
      const metaH = metas.reduce((t, mt) => t + mt.lines.length * mlh, 0) + (metas.length ? fs * 0.2 : 0);
      const need = pad * 2 + labelLines.length * mlh * 0.95 + nameLines.length * lh + metaH;
      return { need, broken, nameLines, labelLines, metas, metaH, pad, mfs, mlh, lh, fs, maxW };
    };
    let fs = maxFs;
    for (; fs > minFs; fs -= 0.5 * u) {
      if (blocks.every((b) => { const L = measure(b, fs, []); return !L.broken && L.need <= b.h; })) break;
    }
    fs = Math.max(fs, minFs);
    const dropOrder = ['label', 'time', 'prof', 'room'];
    blocks.forEach((b) => {
      let drop = [];
      let L = measure(b, fs, drop);
      for (const d of dropOrder) { if (L.need <= b.h) break; drop.push(d); L = measure(b, fs, drop); }
      drawBlock(ctx, b, L, th, u);
      hits.push({ x: b.x, y: b.y, w: b.w, h: b.h, id: b.m.subj.id });
    });
  }

  function drawBlock(ctx, b, L, th, u) {
    const { m, info } = b;
    const r = Math.min(14 * u, b.w / 4);
    blockFill(ctx, th, m.color, b.x, b.y, b.w, b.h, r, m.online, u);
    const solid = th.style === 'solid';
    const txt = solid ? '#ffffff' : '#121845';
    const soft = solid ? 'rgba(255,255,255,0.82)' : 'rgba(18,24,69,0.72)';
    const x = b.x + L.pad + (solid ? 0 : 6 * u);
    const maxW = L.maxW;

    ctx.save();
    rr(ctx, b.x, b.y, b.w, b.h, r); ctx.clip();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let y = b.y + L.pad;

    if (L.labelLines.length) {
      setFont(ctx, 700, L.mfs * 0.92); spacing(ctx, 0.8 * u);
      ctx.fillStyle = solid ? 'rgba(255,255,255,0.75)' : m.color;
      L.labelLines.forEach((ln) => { ctx.fillText(ln, x, y + L.mfs * 0.9); y += L.mlh * 0.95; });
      spacing(ctx, 0);
    }

    setFont(ctx, 800, L.fs, HEAD);
    ctx.fillStyle = txt;
    const maxNameLines = Math.max(1, Math.floor((b.y + b.h - L.pad - L.metaH - y) / L.lh));
    let lines = L.nameLines;
    if (lines.length > maxNameLines) {
      lines = lines.slice(0, maxNameLines);
      lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1] + '…', maxW);
    }
    lines.forEach((ln) => { y += L.lh; ctx.fillText(ln, x, y - L.lh * 0.2); });
    y += L.fs * 0.2;

    L.metas.forEach((mt) => {
      const yMid = y + L.mlh / 2;
      let indent = 0;
      if (mt.k === 'room') {
        const mc = modeColors(th, m.color, m.online);
        pill(ctx, x, yMid, m.online ? 'ONLINE' : 'F2F', L.mfs * 0.72, mc.bg, mc.fg);
        indent = mt.pw;
        setFont(ctx, 600, L.mfs);
      } else if (mt.k === 'prof') {
        personIcon(ctx, x, yMid, L.mfs * 0.95, soft);
        indent = L.mfs * 1.3;
        setFont(ctx, info.profMissing ? '500 italic' : 600, L.mfs);
      } else {
        setFont(ctx, 600, L.mfs);
      }
      ctx.fillStyle = soft; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      mt.lines.forEach((ln, i) => {
        if (ln) ctx.fillText(ln, x + (i ? 0 : indent), y + L.mlh * (i + 0.5));
      });
      ctx.textBaseline = 'alphabetic';
      y += L.mlh * mt.lines.length;
    });
    ctx.restore();
  }

  /* ---------------------------------------------------------------- list */

  function drawList(ctx, area, ms, th, u, opt) {
    const days = P.DAYS.filter((d) => ms.some((m) => m.day === d)).map((d) => ({
      d, items: ms.filter((m) => m.day === d).sort((a, b) => a.start - b.start),
    }));
    const fsc = opt.fontScale || 1;
    // Text grows faster than the cards, so a bigger text size really reads bigger even when space is tight.
    const DAY_H = 54 * (0.8 + 0.2 * fsc), DAY_GAP = 26, ITEM_H = 128 * (0.7 + 0.3 * fsc), ITEM_GAP = 12;
    const colHeight = (ds) => ds.reduce((t, g, i) => t + DAY_H + g.items.length * ITEM_H + (g.items.length - 1) * ITEM_GAP + (i ? DAY_GAP : 0), 0);

    let cols = [days];
    let s = area.h / (colHeight(days) * u);
    if (s < 1 && days.length > 1) {
      // Two columns, split where the heights balance best — used when it makes the text clearly
      // bigger and each column is still wide enough (squares, landscapes, very full weeks).
      let best = null;
      for (let i = 1; i < days.length; i++) {
        const hmax = Math.max(colHeight(days.slice(0, i)), colHeight(days.slice(i)));
        if (!best || hmax < best.h) best = { i, h: hmax };
      }
      const s2 = Math.min(area.h / (best.h * u), ((area.w - 28 * u) / 2) / (620 * u));
      if (s < 0.68 || s2 > s * 1.2) {
        cols = [days.slice(0, best.i), days.slice(best.i)];
        s = Math.max(s, s2);
      }
    }
    s = Math.min(s, 1.3);
    const TS = fsc; // text scale inside items
    const S = s * u;
    const gutter = 28 * u;
    const colW = (area.w - gutter * (cols.length - 1)) / cols.length;
    const used = Math.max(...cols.map(colHeight)) * S;
    const offY = Math.max(0, (area.h - used) / 2.5);

    cols.forEach((col, ci) => {
      const x0 = area.x + ci * (colW + gutter);
      let y = area.y + offY;
      col.forEach((g, gi) => {
        if (gi) y += DAY_GAP * S;
        setFont(ctx, 800, 28 * S * Math.min(1.2, fsc), HEAD); spacing(ctx, 3 * S);
        ctx.fillStyle = th.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const label = P.DAY_NAMES[g.d].toUpperCase();
        ctx.fillText(label, x0, y + DAY_H * S / 2 - 4 * S);
        const lw = ctx.measureText(label).width;
        spacing(ctx, 0);
        ctx.strokeStyle = th.lineStrong; ctx.lineWidth = Math.max(1, 2 * S);
        ctx.beginPath(); ctx.moveTo(x0 + lw + 18 * S, y + DAY_H * S / 2 - 4 * S); ctx.lineTo(x0 + colW, y + DAY_H * S / 2 - 4 * S); ctx.stroke();
        y += DAY_H * S;
        g.items.forEach((m, ii) => {
          if (ii) y += ITEM_GAP * S;
          drawListItem(ctx, m, x0, y, colW, ITEM_H * S, th, S, u, opt, TS);
          y += ITEM_H * S;
        });
      });
    });
  }

  function drawListItem(ctx, m, x, y, w, h, th, S0, u, opt, TS) {
    const S = S0 * (TS || 1); // font/detail scale; card size comes from h and w
    const info = blockInfo(m, opt);
    const solid = th.style === 'solid';
    const r = 16 * S;
    hits.push({ x, y, w, h, id: m.subj.id });
    ctx.save();
    if (solid) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
    } else if (th.style === 'card') {
      ctx.shadowColor = 'rgba(5,10,40,0.25)'; ctx.shadowBlur = 10 * S; ctx.shadowOffsetY = 3 * S;
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
    } else {
      ctx.shadowColor = 'rgba(21,27,77,0.10)'; ctx.shadowBlur = 12 * S; ctx.shadowOffsetY = 3 * S;
      ctx.fillStyle = '#ffffff';
    }
    rr(ctx, x, y, w, h, r); ctx.fill();
    ctx.restore();

    ctx.save();
    rr(ctx, x, y, w, h, r); ctx.clip();
    const timeW = 158 * S;
    // time column tinted with the subject colour
    ctx.fillStyle = solid ? m.color : rgba(m.color, 0.12);
    ctx.fillRect(x, y, timeW, h);
    if (m.online) {
      ctx.strokeStyle = solid ? 'rgba(255,255,255,0.12)' : rgba(m.color, 0.12);
      ctx.lineWidth = 7 * S;
      for (let s = -h; s < timeW + h; s += 22 * S) { ctx.beginPath(); ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + h, y); ctx.stroke(); }
    }
    const tcol = solid ? '#ffffff' : m.color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fmt = (t) => (opt.h24 ? P.hhmm(t) : P.fmtTime(t));
    setFont(ctx, 800, 28 * S); ctx.fillStyle = tcol;
    ctx.fillText(fmt(m.start), x + timeW / 2, y + h / 2 - 16 * S);
    setFont(ctx, 600, 23 * S); ctx.fillStyle = solid ? 'rgba(255,255,255,0.85)' : rgba(m.color, 0.9);
    ctx.fillText(fmt(m.end), x + timeW / 2, y + h / 2 + 19 * S);

    const txt = solid ? '#ffffff' : '#121845';
    const soft = solid ? 'rgba(255,255,255,0.75)' : 'rgba(18,24,69,0.7)';
    const tx = x + timeW + 22 * S;
    const maxW = w - timeW - 36 * S;
    ctx.textAlign = 'left';

    let nfs = 34 * S;
    setFont(ctx, 800, nfs, HEAD);
    while (ctx.measureText(info.name).width > maxW && nfs > 24 * S) { nfs -= S; setFont(ctx, 800, nfs, HEAD); }
    ctx.fillStyle = txt; ctx.textBaseline = 'alphabetic';
    const nameY = y + h / 2 - 5 * S;
    ctx.fillText(ellipsize(ctx, info.name, maxW), tx, nameY);

    // meta row: [MODE] room · prof · code
    const yMid = y + h / 2 + 28 * S;
    const mc = modeColors(th, m.color, m.online);
    let cx = tx + pill(ctx, tx, yMid, m.online ? 'ONLINE' : 'F2F', 17 * S, mc.bg, mc.fg) + 12 * S;
    const bits = [];
    if (info.room) bits.push({ t: info.room });
    bits.push({ t: info.prof, prof: true, missing: info.profMissing });
    if (info.label) bits.push({ t: info.label });
    ctx.textBaseline = 'middle';
    bits.forEach((bit, i) => {
      if (cx > tx + maxW - 30 * S) return;
      if (i) {
        setFont(ctx, 600, 23 * S); ctx.fillStyle = soft;
        ctx.fillText('·', cx, yMid); cx += 16 * S;
      }
      if (bit.prof) { personIcon(ctx, cx, yMid, 22 * S, soft); cx += 28 * S; }
      setFont(ctx, bit.missing ? '500 italic' : 600, 23 * S); ctx.fillStyle = soft;
      const t = ellipsize(ctx, bit.t, tx + maxW - cx);
      ctx.fillText(t, cx, yMid);
      cx += ctx.measureText(t).width + 12 * S;
    });
    ctx.restore();
  }

  /* -------------------------------------------------------------- footer */

  function drawFooter(ctx, th, u, x, y, W, h) {
    const yMid = y + h / 2;
    const fs = 15 * u;
    // The legend sits on the page background, so dark themes use the light-on-dark pill style.
    const legendTheme = th.style === 'tint' ? th : THEMES.midnight;
    const f2f = modeColors(legendTheme, '#2F6FEB', false);
    const onl = modeColors(legendTheme, '#2F6FEB', true);
    let cx = x;
    cx += pill(ctx, cx, yMid, 'F2F', fs, f2f.bg, f2f.fg) + 10 * u;
    setFont(ctx, 600, 20 * u); ctx.fillStyle = th.muted; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('Face-to-face', cx, yMid); cx += ctx.measureText('Face-to-face').width + 26 * u;
    cx += pill(ctx, cx, yMid, 'ONLINE', fs, onl.bg, onl.fg) + 10 * u;
    setFont(ctx, 600, 20 * u); ctx.fillStyle = th.muted;
    ctx.fillText('Online', cx, yMid);

    setFont(ctx, 800, 17 * u, HEAD); spacing(ctx, 3 * u);
    ctx.textAlign = 'right'; ctx.fillStyle = th.muted;
    ctx.fillText('ASCEND', W - x, yMid);
    spacing(ctx, 0);
    ctx.textAlign = 'left';
  }

  /* ---------------------------------------------------------------- main */

  function render(canvas, data, opt) {
    const W = Math.round(opt.width), H = Math.round(opt.height);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const th = THEMES[opt.theme] || THEMES.midnight;
    const u = Math.min(W / 1080, H / 1350);
    hits = [];

    drawBackground(ctx, W, H, th, u);
    const pad = Math.round(36 * u);
    const top = opt.wallpaper ? Math.round(H * 0.25) : Math.round(60 * u);
    const bottom = opt.wallpaper ? Math.round(H * 0.075) : Math.round(36 * u);
    const footerH = Math.round(58 * u);

    const headerBottom = drawHeader(ctx, data, th, u, pad, top, W, opt.logo, opt);
    const area = { x: pad, y: headerBottom + 34 * u, w: W - pad * 2 };
    area.h = H - bottom - footerH - 18 * u - area.y;

    const ms = flatten(data);
    if (!ms.length || area.h < 80 * u) {
      setFont(ctx, 600, 30 * u); ctx.fillStyle = th.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ms.length ? 'Not enough room — pick a taller size' : 'Add a class to see your schedule', W / 2, area.y + Math.max(area.h, 100 * u) / 2);
    } else if (opt.layout === 'list') {
      drawList(ctx, area, ms, th, u, opt);
    } else {
      drawGrid(ctx, area, ms, th, u, opt);
    }
    drawFooter(ctx, th, u, pad, H - bottom - footerH, W, footerH);
    return hits;
  }

  root.SVRender = { render, THEMES, PALETTE, flatten };
})(window);
