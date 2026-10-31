/* ASCEND Schedule Viewer — parsing & normalization helpers.
 * Pure functions only (no DOM), so they also run under Node for testing. */
(function (root) {
  'use strict';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

  /* ------------------------------------------------------------------ time */

  function toMin(h, m, ap) {
    h = +h; m = +m;
    if (ap) {
      ap = ap.toUpperCase();
      if (ap === 'P' && h < 12) h += 12;
      if (ap === 'A' && h === 12) h = 0;
    }
    return h * 60 + m;
  }

  // Guess AM/PM when the source omits it (e.g. calendar view "11:00 - 1:00").
  function guessAp(h) { return (h >= 7 && h <= 11) ? 'A' : 'P'; }

  function hhmm(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function parseHHMM(s) {
    if (s == null) return null;
    const m = String(s).trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*([AaPp])?\.?\s*[Mm]?\.?$/);
    if (!m) return null;
    const v = toMin(m[1], m[2], m[3]);
    return v >= 0 && v < 24 * 60 ? v : null;
  }

  function fmtTime(min, opts) {
    opts = opts || {};
    let h = Math.floor(min / 60), m = min % 60;
    if (opts.h24) return hhmm(min);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const t = opts.short && m === 0 ? String(h) : h + ':' + String(m).padStart(2, '0');
    return opts.noAp ? t : t + ' ' + ap;
  }

  function fmtRange(s, e, opts) {
    opts = opts || {};
    if (opts.h24) return hhmm(s) + '–' + hhmm(e);
    const sameAp = (s < 720) === (e < 720);
    return sameAp
      ? fmtTime(s, { noAp: true }) + '–' + fmtTime(e)
      : fmtTime(s) + '–' + fmtTime(e);
  }

  // Matches "11:00AM - 01:00PM", "5:00 PM-9:00 PM", "11:00 - 1:00", OCR'd "11.00AM 01:00PM".
  const TIME_RANGE_RE = /(\d{1,2})\s*[:.;]\s*(\d{2})\s*(?:([AaPp])\.?\s?[Mm]\.?)?\s*(?:-|–|—|~|to\b)?\s*(\d{1,2})\s*[:.;]\s*(\d{2})\s*(?:([AaPp])\.?\s?[Mm]\.?)?/g;

  function rangeFromMatch(m) {
    let [, h1, m1, a1, h2, m2, a2] = m;
    if (!a1 && !a2) { a1 = guessAp(+h1); a2 = guessAp(+h2); }
    else if (!a1) a1 = (+h1 > +h2 && +h1 !== 12) || (+h2 === 12 && +h1 < 12) ? 'A' : a2;
    else if (!a2) a2 = a1;
    let s = toMin(h1, m1, a1), e = toMin(h2, m2, a2);
    if (e <= s && e + 720 < 24 * 60) e += 720;
    if (s >= 24 * 60 || e > 24 * 60 || e <= s) return null;
    return { start: s, end: e };
  }

  /* ------------------------------------------------------------------ days */

  const FULL_DAY_RE = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi;

  function normDay(s) {
    if (!s) return '';
    const k = String(s).trim().slice(0, 3).toLowerCase();
    const map = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
    if (map[k]) return map[k];
    const code = parseDayCode(s);
    return code && code.length === 1 ? code[0] : '';
  }

  // Compact codes used on CORs: M, T, W, TH, F, S/Sa, Su, and combos like MTH, TF, MWF, TTH.
  function parseDayCode(tok) {
    const s = String(tok || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!s || s.length > 7) return null;
    const out = [];
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('TH', i)) { out.push('Thu'); i += 2; }
      else if (s.startsWith('SU', i)) { out.push('Sun'); i += 2; }
      else if (s.startsWith('SA', i)) { out.push('Sat'); i += 2; }
      else {
        const one = { M: 'Mon', T: 'Tue', W: 'Wed', F: 'Fri', S: 'Sat', R: 'Thu' }[s[i]];
        if (!one) return null;
        out.push(one); i += 1;
      }
    }
    return out.filter((d, k) => out.indexOf(d) === k);
  }

  /* ------------------------------------------------------- tokens & rooms */

  // Subject codes: CPCNET1L, CPELX330, ENOJT110, PATHFIT2 … (≥4 letters so sections like CPE231 don't match)
  const CODE_RE = /\b([A-Z]{4,9}\d{1,3}[A-Z0-9]{0,2})\b/;
  const CODE_RE_G = new RegExp(CODE_RE.source, 'g');
  const SECTION_RE = /^[A-Z]{2,5}\d{2,4}[A-Z]?$/;
  const ROOM_RE = /(?:\bSET\s*-?\s*VR\s*-?\s*\d+[A-Z]?\b|\bVR\s*-?\s*\d+\b|\b[A-Z]{1,4}\d{0,2}\s*-\s*\d{2,4}[A-Z]?\b|\b\d{3,4}[A-Z]\b|\b(?:ONLINE|TBA|TBD|ASYNC(?:HRONOUS)?|GYM|AVR)\b)/gi;

  // OCR often reads the digit 1 as "I" and 0 as "O" in codes: CPCNETIL → CPCNET1L, CPTHS2ID → CPTHS21D.
  function fixCode(tok) {
    let t = String(tok || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/I[A-Z]?$/.test(t) && (!/\d/.test(t) || /\dI[A-Z]?$/.test(t))) t = t.replace(/I([A-Z]?)$/, '1$1');
    return t.replace(/(\d)O/g, '$10');
  }
  const STATUS_RE = /\b(enrolled|officially\s+enrolled|dropped|withdrawn|pending|reserved|assessed|validated)\b/gi;
  const UNITS_RE = /\b(\d{1,2}\.\d{1,2})\b/g;

  function isOnlineRoom(room) {
    return /\bVR\s*-?\s*\d|\bVR\b|SET\s*VR|VIRTUAL|ONLINE|ASYNC|REMOTE|\bZOOM\b|\bMEET\b|\bTEAMS\b/i.test(room || '');
  }

  function cleanRoom(r) {
    return String(r || '').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------------ professors */

  const DEGREES = /^(ms|msc|m\.?s\.?|meng|m\.?eng|ma|mba|mit|mscpe|mscoe|msece|msee|msit|mscs|mem|mep|phd|ph\.?d\.?|dit|deng|d\.?eng|edd|ed\.?d|pece|pee|ece|cpe|ree|rme|lpt|pcpe|ceng|jr|sr|ii|iii|iv|dr)\.?$/i;
  const NAME_PREFIX = /^(dr|engr|eng|prof|mr|ms|mrs|mx|atty|arch|sir|maam|ma'am|fr|sis|br)\.?\s+/i;
  const PARTICLES = new Set(['de', 'del', 'dela', 'della', 'delos', 'la', 'las', 'los', 'san', 'santa', 'sta', 'sto', 'van', 'von', 'da', 'di', 'du', 'mac', 'mc']);

  function titleCaseName(s) {
    if (/[a-z]/.test(s)) return s; // already mixed case — trust it
    return s.toLowerCase().replace(/(^|[\s\-'])([a-zñ])/g, (m, p, c) => p + c.toUpperCase())
      .replace(/\b(De|Del|Dela|Delos|La|Los|Las|Van|Von|Da|Di)\b(?=\s)/g, (w) => w.toLowerCase())
      .replace(/^([a-z])/, (c) => c.toUpperCase());
  }

  // A comma part like "MS", "MENG", "MSCpE, PhD" is a degree, not a first name.
  // Unknown degree-looking tokens (M…/D…/B… caps) only count when the name itself is mixed case,
  // so ALL-CAPS "DELA CRUZ, MARIA" isn't mistaken for a degree.
  function isDegreeChunk(chunk, nameIsMixed) {
    const toks = chunk.trim().split(/\s+/);
    if (!toks.length || toks.length > 3) return false;
    return toks.every((t) => DEGREES.test(t)
      || (nameIsMixed && /^[MDB][A-Z][A-Za-z]{0,5}\.?$/.test(t) && t.replace(/[^A-Z]/g, '').length >= 2));
  }

  /** "Charles David Y. Fernandez, MS" → "Fernandez"; "Dr. Juan A. Dela Cruz" → "Dela Cruz"; "DELA CRUZ, JUAN A." → "Dela Cruz". */
  function lastName(full) {
    if (!full) return '';
    let s = String(full).replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2,}/.test(s)) return '';
    let parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    const nameIsMixed = /[a-z]/.test(parts[0]);
    while (parts.length > 1 && isDegreeChunk(parts[parts.length - 1], nameIsMixed)) parts.pop();
    if (parts.length >= 2) {
      // "LAST, First M." format
      return titleCaseName(parts[0].replace(NAME_PREFIX, ''));
    }
    let name = parts[0];
    while (NAME_PREFIX.test(name)) name = name.replace(NAME_PREFIX, '');
    let toks = name.split(' ').filter(Boolean);
    while (toks.length > 1 && /^(jr|sr|ii|iii|iv|v)\.?$/i.test(toks[toks.length - 1])) toks.pop();
    while (toks.length > 1 && DEGREES.test(toks[toks.length - 1]) && toks[toks.length - 1] === toks[toks.length - 1].toUpperCase()) toks.pop();
    if (toks.length === 1) return titleCaseName(toks[0]);
    let lastInitial = -1;
    toks.forEach((t, i) => { if (/^[A-Z]\.?$/i.test(t) || /^ma\.$/i.test(t)) lastInitial = i; });
    let sur;
    if (lastInitial >= 0 && lastInitial < toks.length - 1) {
      sur = toks.slice(lastInitial + 1);
    } else {
      let i = toks.length - 1;
      while (i > 0 && PARTICLES.has(toks[i - 1].toLowerCase())) i--;
      sur = toks.slice(i);
    }
    return titleCaseName(sur.join(' '));
  }

  /* --------------------------------------------------------- abbreviation */

  const ACRONYMS = new Set(['IT', 'OJT', 'NSTP', 'PE', 'ICT', 'IOT', 'AI', 'ML', 'DSP', 'VLSI', 'CAD', 'GE', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'PC', 'OS', 'UI', 'UX', 'HCI', 'ECE', 'EE', 'CS', 'IS', 'PATHFIT', 'ROTC', 'CWTS', 'LTS', 'STS', 'RPH', 'TCW', 'UTS', 'MMW', 'DBMS', 'SQL', 'LAN', 'WAN', 'IC', 'PCB', 'VR', 'AR', 'RF', 'HDL', 'FPGA', 'NU', 'API', '2D', '3D', 'CCNA', 'OOP', 'NSTP1', 'NSTP2']);

  const PHRASES = [
    [/\bCPE\s*ELECTIVE\s*(\d+)/g, 'CpE Elective $1'], // OCR sometimes glues it: "CPEELECTIVE3"
    [/\bON[\s-]*THE[\s-]*JOB\s+TRAINING\b/g, 'OJT'],
    [/\bNATIONAL SERVICE TRAINING PROGRAM\b/g, 'NSTP'],
    [/\bPHYSICAL ACTIVIT(?:Y|IES) TOWARDS? HEALTH AND FITNESS\b/g, 'PATHFIT'],
    [/\bOBJECT[\s-]*ORIENTED PROGRAMMING\b/g, 'OOP'],
    [/\bDATA STRUCTURES? AND ALGORITHMS?\b/g, 'Data Struct & Algo'],
    [/\bDIGITAL SIGNAL PROCESSING\b/g, 'DSP'],
    [/\bCOMPUTER[\s-]AIDED (?:DRAFTING|DESIGN)\b/g, 'CAD'],
    [/\bINTERNET OF THINGS\b/g, 'IoT'],
    [/\bARTIFICIAL INTELLIGENCE\b/g, 'AI'],
    [/\bMACHINE LEARNING\b/g, 'ML'],
    [/\bHUMAN[\s-]COMPUTER INTERACTION\b/g, 'HCI'],
    [/\bENGINEERING ECONOMICS\b/g, "Eng'g Econ"],
    [/\bENGINEERING MANAGEMENT\b/g, "Eng'g Mgmt"],
    [/\bCOMPUTER ENGINEERING\b/g, 'CpE'],
    [/\bCOMPUTER NETWORKS?\b/g, 'CompNet'],
    [/\bDIFFERENTIAL EQUATIONS\b/g, 'Diff Eq'],
    [/\bUNDERSTANDING THE SELF\b/g, 'UTS'],
    [/\bREADINGS IN PHILIPPINE HISTORY\b/g, 'RPH'],
    [/\bTHE CONTEMPORARY WORLD\b/g, 'TCW'],
    [/\bMATHEMATICS IN THE MODERN WORLD\b/g, 'MMW'],
    [/\bSCIENCE,? TECHNOLOGY,? AND SOCIETY\b/g, 'STS'],
    [/\bPURPOSIVE COMMUNICATION\b/g, 'Purposive Comm'],
    [/\bFEEDBACK AND CONTROL SYSTEMS?\b/g, 'Feedback & Control'],
    [/\bMICROPROCESSORS? AND MICROCONTROLLERS?\b/g, 'Microprocessors & MCU'],
    [/\bCOMPUTER ARCHITECTURE AND ORGANIZATION\b/g, 'Comp Arch & Org'],
    [/\bDATA AND DIGITAL COMMUNICATIONS?\b/g, 'Data & Digital Comms'],
    [/\bOPERATING SYSTEMS?\b/g, 'Operating Systems'],
    [/\bFUNDAMENTALS OF\b/g, 'Fund. of'],
    [/\bINTRODUCTION TO\b/g, 'Intro to'],
    [/\bSEMINARS? AND FIELD TRIPS?\b/g, 'Seminars & Field Trips'],
    [/\bCAPSTONE DESIGN PROJECT\b/g, 'Capstone Design'],
    [/\bEMERGING TECHNOLOGIES\b/g, 'Emerging Tech'],
    [/\bPROFESSIONAL PRACTICE\b/g, 'Prof. Practice'],
  ];

  const WORD_ABBR = {
    TECHNOLOGIES: 'Tech', TECHNOLOGY: 'Tech', ENGINEERING: "Eng'g", COMPUTER: 'Comp', COMPUTERS: 'Comp', COMPUTING: 'Computing',
    PROGRAMMING: 'Prog', INTRODUCTION: 'Intro', FUNDAMENTALS: 'Fund.', PRINCIPLES: 'Prin.', MANAGEMENT: 'Mgmt',
    SYSTEMS: 'Sys', SYSTEM: 'Sys', LABORATORY: 'Lab', PROFESSIONAL: 'Prof.', COMMUNICATIONS: 'Comms', COMMUNICATION: 'Comm',
    MATHEMATICS: 'Math', ARCHITECTURE: 'Arch', ORGANIZATION: 'Org', APPLICATIONS: 'Apps', APPLICATION: 'App',
    ENVIRONMENT: "Env't", DEVELOPMENT: "Dev't", INFORMATION: 'Info', ADVANCED: 'Adv.', DIFFERENTIAL: 'Diff.',
    EQUATIONS: 'Eqns', PROBABILITY: 'Prob.', STATISTICS: 'Stats', PHYSICAL: 'Phys.', EDUCATION: 'Ed.',
    ENVIRONMENTAL: "Env'l", ALGORITHMS: 'Algo', STRUCTURES: 'Struct', PROJECT: 'Proj.', ELECTRONICS: 'Electronics',
    ELECTRONIC: 'Electronic', ELECTRICAL: 'Elec.', INTEGRATED: 'Integ.', DESIGN: 'Design', DATABASE: 'DB',
    MICROPROCESSORS: 'Microproc.', MICROPROCESSOR: 'Microproc.', MICROCONTROLLERS: 'MCU', INSTRUMENTATION: 'Instru.',
    TECHNICAL: 'Tech.', CALCULUS: 'Calc', NUMERICAL: 'Num.', DIGITAL: 'Digital', ANALYSIS: 'Analysis', SECURITY: 'Security',
    INTERMEDIATE: 'Interm.', OCCUPATIONAL: 'Occ.', ENTREPRENEURSHIP: 'Entrep.', TECHNOPRENEURSHIP: 'Technopreneurship', PHILIPPINE: 'PH',
  };
  const SMALL_WORDS = new Set(['IN', 'OF', 'THE', 'FOR', 'TO', 'ON', 'WITH', 'A', 'AN', 'AT', 'BY']);

  function caseWord(w, abbr, isFirst) {
    if (!/[A-Z]/.test(w) || /[a-z]/.test(w)) return w; // numbers, symbols, or already mixed case (CpE, IoT)
    const bare = w.replace(/[^A-Z0-9]/g, '');
    if (w === 'AND' || w === '&') return '&';
    if (bare === 'CPE') return w.replace('CPE', 'CpE');
    if (ACRONYMS.has(bare)) return w;
    if (SMALL_WORDS.has(w) && !isFirst) return w.toLowerCase();
    if (abbr && WORD_ABBR[bare]) return WORD_ABBR[bare];
    return w.toLowerCase().replace(/(^|[-/(])([a-z])/g, (m, p, c) => p + c.toUpperCase())
      .replace(/-(The|Of|And|In)-/g, (m) => m.toLowerCase());
  }

  function shortenMain(main, abbr) {
    let s = ' ' + main.replace(/\s+/g, ' ').trim() + ' ';
    const upper = s.toUpperCase();
    // Apply phrase rules on an uppercase copy, but keep any mixed-case words (e.g. "CpE") from the source.
    if (s !== upper) {
      // Only uppercase words participate in phrase matching; mixed-case words are kept verbatim.
      s = s.replace(/\b[A-Za-z]*[a-z][A-Za-z]*\b/g, (w) => (/^[A-Z]/.test(w) && /[A-Z].*[A-Z]/.test(w) ? w : w.toUpperCase()));
    }
    PHRASES.forEach(([re, rep]) => { s = s.replace(re, rep); });
    const words = s.trim().split(' ').filter(Boolean);
    return words.map((w, i) => caseWord(w, abbr, i === 0)).join(' ').replace(/\s+&\s+/g, ' & ').trim();
  }

  function splitSuffix(desc) {
    const d = String(desc || '').replace(/\s+/g, ' ').trim();
    const m = d.match(/^(.*\S)\s*[-–—:]\s+([A-Za-z]+(?:\s[A-Za-z]+)?)$/) || d.match(/^(.*\S)\s+[-–—]\s*([A-Za-z]+(?:\s[A-Za-z]+)?)$/);
    if (m && m[1].length > 3) return { main: m[1].replace(/\s*[-–—:]\s*$/, ''), suffix: m[2] };
    const lab = d.match(/^(.*\S)\s+(LAB|LABORATORY|LEC|LECTURE)$/i);
    if (lab) return { main: lab[1], suffix: lab[2] };
    return { main: d, suffix: '' };
  }

  function normSuffix(sfx) {
    const u = sfx.toUpperCase();
    if (u === 'LAB' || u === 'LABORATORY') return { text: 'Lab', always: true };
    if (u === 'LEC' || u === 'LECTURE') return { text: 'Lec', always: false };
    return { text: caseWord(u, false, true), always: false };
  }

  const MAX_SHORT = 30;
  function truncateWords(s, max) {
    if (s.length <= max) return s;
    const words = s.split(' ');
    let out = '';
    for (const w of words) {
      if ((out + ' ' + w).trim().length > max - 1) break;
      out = (out + ' ' + w).trim();
    }
    return (out || s.slice(0, max - 1)).replace(/[\s&,\-–]+$/, '') + '…';
  }

  /** Short display name for one description. withSuffix forces keeping e.g. "(Drafting)". */
  function shortName(desc, withSuffix) {
    if (!desc) return '';
    const { main, suffix } = splitSuffix(desc);
    const sfx = suffix ? normSuffix(suffix) : null;
    const tail = sfx && (sfx.always || withSuffix) ? ' ' + sfx.text : '';
    let name = shortenMain(main, false);
    if ((name + tail).length > 20) name = shortenMain(main, true);
    return truncateWords(name + tail, MAX_SHORT);
  }

  /** Short names for a whole list, keeping suffixes only where needed to tell subjects apart. */
  function shortNames(descs) {
    const base = descs.map((d) => shortName(d, false));
    const counts = {};
    base.forEach((b) => { counts[b.toLowerCase()] = (counts[b.toLowerCase()] || 0) + 1; });
    return base.map((b, i) => (counts[b.toLowerCase()] > 1 ? shortName(descs[i], true) : b));
  }

  /* ----------------------------------------------------------- meta (term) */

  function detectMeta(text) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const meta = { term: '', schoolYear: '' };
    const syRe = /(20\d{2})\s*[-–—\/]\s*(20\d{2})/g;
    let m;
    while ((m = syRe.exec(t))) {
      if (+m[2] === +m[1] + 1) { meta.schoolYear = m[1] + '–' + m[2]; break; }
    }
    const ord = { '1': '1st', '2': '2nd', '3': '3rd', first: '1st', second: '2nd', third: '3rd', '1st': '1st', '2nd': '2nd', '3rd': '3rd' };
    const tm = t.match(/\b(1st|2nd|3rd|first|second|third)\s*(term|trimester|semester|sem)\b/i)
      || t.match(/\b(term|trimester|semester)\s*[:#-]?\s*([123])\b/i);
    if (tm) {
      if (/^(term|trimester|semester)$/i.test(tm[1])) meta.term = ord[tm[2]] + ' ' + cap(tm[1]);
      else meta.term = ord[tm[1].toLowerCase()] + ' ' + cap(tm[2].toLowerCase() === 'sem' ? 'semester' : tm[2]);
    } else if (/\bsummer\b/i.test(t)) meta.term = 'Summer Term';
    return meta;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  /* ------------------------------------------------------ row text parsing */

  /** Parse one table row (columns already in left-to-right order) into a subject. */
  function parseRowText(raw) {
    let t = ' ' + String(raw || '').replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    const codeM = t.match(CODE_RE);
    if (!codeM) return null;
    const code = codeM[1];
    let rest = t.slice(codeM.index + codeM[0].length);

    const times = [];
    let firstIdx = -1, lastEnd = -1;
    TIME_RANGE_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RANGE_RE.exec(rest))) {
      const r = rangeFromMatch(m);
      if (r) {
        times.push(r);
        if (firstIdx < 0) firstIdx = m.index;
        lastEnd = m.index + m[0].length;
      }
    }
    let pre = firstIdx >= 0 ? rest.slice(0, firstIdx) : rest;
    let post = firstIdx >= 0 ? rest.slice(lastEnd) : '';

    // Days: full names (portal list view) or a compact code right before the time (COR).
    let days = [];
    pre = pre.replace(FULL_DAY_RE, (w) => { const d = normDay(w); if (d && w.length >= 3 && /^[A-Z]/.test(w)) { days.push(d); return ' '; } return w; });
    let preToks = pre.trim().split(' ').filter(Boolean);
    if (!days.length && preToks.length) {
      const last = preToks[preToks.length - 1];
      const dc = /^[A-Za-z]{1,7}$/.test(last) && !SMALL_WORDS.has(last.toUpperCase()) && last.toUpperCase() !== 'LAB' ? parseDayCode(last) : null;
      if (dc) { days = dc; preToks.pop(); }
    }

    // Section is the last section-looking token before the day/time.
    let section = '';
    for (let i = preToks.length - 1; i >= 0; i--) {
      if (SECTION_RE.test(preToks[i]) && !CODE_RE.test(preToks[i])) { section = preToks[i]; preToks.splice(i, 1); break; }
    }
    let description = preToks.join(' ').replace(/\s*[-–—]\s*$/, '').replace(/^[-–—\s]+/, '').trim();

    // Rooms, instructor, units after the times.
    const rooms = [];
    let afterRooms = post;
    ROOM_RE.lastIndex = 0;
    let lastRoomEnd = 0;
    let rm;
    while ((rm = ROOM_RE.exec(post))) {
      // Rooms sit right after the time column; stop once we reach the instructor's mixed-case name.
      const between = post.slice(lastRoomEnd, rm.index);
      if (rooms.length && /[a-z]{2,}/.test(between)) break;
      rooms.push(cleanRoom(rm[0]));
      lastRoomEnd = rm.index + rm[0].length;
    }
    afterRooms = post.slice(lastRoomEnd);
    // A room split like "T1 - 407L/T1 - 420L" is two rooms; "/" separators are fine.
    let unitsMatch = afterRooms.match(UNITS_RE);
    const units = unitsMatch ? unitsMatch[unitsMatch.length - 1] : '';
    let instr = afterRooms.replace(STATUS_RE, ' ').replace(UNITS_RE, ' ').replace(/[\/|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/[a-z]/.test(instr) && !/,/.test(instr)) instr = instr.length > 5 && /[A-Z]{2,}\s+[A-Z]/.test(instr) ? instr : '';
    instr = instr.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z.)]+$/, '');
    // A real name has at least two name-like words (or a "Last, First" comma); single OCR scraps don't count.
    if (instr.split(' ').filter((t) => /^[A-Z][A-Za-z'.-]+$/.test(t) || /^[A-Z]\.$/.test(t)).length < 2 && !/,/.test(instr)) instr = '';

    // Pair days ↔ times ↔ rooms.
    const meetings = [];
    const n = Math.max(days.length, times.length ? (days.length ? days.length : times.length) : 0);
    for (let i = 0; i < n; i++) {
      const tm = times[i] || times[0];
      if (!tm) continue;
      const room = rooms.length === n ? rooms[i] : rooms.length === 1 ? rooms[0] : rooms.join(' / ');
      meetings.push({ day: days[i] || '', start: tm.start, end: tm.end, room: room || '' });
    }

    return { code, description, section, instructor: instr, units, meetings };
  }

  /* ------------------------------------------- positional table rebuilding */

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /** Group word boxes ({text,x0,y0,x1,y1}) into visual lines. */
  function groupLines(words, h) {
    const sorted = words.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const lines = [];
    for (const w of sorted) {
      const yc = (w.y0 + w.y1) / 2;
      const line = lines.length ? lines[lines.length - 1] : null;
      if (line && Math.abs(yc - line.yc) < 0.5 * h) {
        line.words.push(w);
        line.yc = (line.yc * (line.words.length - 1) + yc) / line.words.length;
      } else {
        lines.push({ yc, words: [w] });
      }
    }
    lines.forEach((l) => l.words.sort((a, b) => a.x0 - b.x0));
    return lines;
  }

  /** Words on a line → phrases split at column-sized gaps. */
  function phrasesOf(line, h) {
    const out = [];
    let cur = null;
    for (const w of line.words) {
      if (cur && w.x0 - cur.x1 < 0.9 * h) {
        cur.text += ' ' + w.text; cur.x1 = Math.max(cur.x1, w.x1);
      } else {
        cur = { text: w.text, x0: w.x0, x1: w.x1, yc: line.yc };
        out.push(cur);
      }
    }
    return out;
  }

  /** Rebuild column-ordered row text from a set of lines: phrases that overlap horizontally share a column. */
  function rowText(lines, h) {
    const phrases = [];
    lines.forEach((l) => phrasesOf(l, h).forEach((p) => phrases.push(p)));
    // union phrases whose x-ranges overlap
    const parent = phrases.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < phrases.length; i++) {
      for (let j = i + 1; j < phrases.length; j++) {
        const a = phrases[i], b = phrases[j];
        if (a.yc === b.yc) continue; // same line, different column
        if (a.x0 < b.x1 - 0.1 * h && b.x0 < a.x1 - 0.1 * h) parent[find(i)] = find(j);
      }
    }
    const groups = {};
    phrases.forEach((p, i) => { (groups[find(i)] = groups[find(i)] || []).push(p); });
    return Object.values(groups)
      .map((g) => ({ x: Math.min(...g.map((p) => p.x0)), text: g.sort((a, b) => a.yc - b.yc || a.x0 - b.x0).map((p) => p.text).join(' ') }))
      .sort((a, b) => a.x - b.x)
      .map((g) => g.text)
      .join(' ');
  }

  /**
   * Table extraction from positioned words (PDF text layer or OCR).
   * Returns { subjects, meta, text, kind } where kind hints at what was detected.
   */
  function parseWords(words) {
    // Drop table-border characters OCR glues onto words ("|CPE", "[SOFTWARE").
    words = (words || []).map((w) => Object.assign({}, w, { text: String((w && w.text) || '').replace(/[|\[\]{}’‘“”«»]/g, '').trim() }))
      .filter((w) => w.text);
    const fullText = textFromWords(words);
    const meta = detectMeta(fullText);
    if (!words.length) return { subjects: [], meta, text: '', kind: 'empty' };

    const h = median(words.map((w) => w.y1 - w.y0)) || 10;
    const lines = groupLines(words, h);

    // Calendar/grid view (a "Sun Mon Tue …" header row) can't be rebuilt from positions alone.
    if (lines.some((l) => l.words.filter((w) => /^(sun|mon|tue|wed|thu|fri|sat)$/i.test(w.text)).length >= 5)) {
      return { subjects: [], meta, text: fullText, kind: 'calendar' };
    }

    // Row anchors: subject codes in the left-most column.
    let anchors = [];
    lines.forEach((l, li) => l.words.forEach((w) => {
      const tok = w.text.replace(/[^A-Z0-9]/g, '');
      if (CODE_RE.test(tok) && tok.length === w.text.replace(/[^A-Za-z0-9]/g, '').length && tok.match(CODE_RE)[1] === tok) anchors.push({ li, w, yc: l.yc });
    }));
    if (!anchors.length) {
      const calendar = /\bSun\b.*\bMon\b.*\bTue\b/i.test(fullText);
      return { subjects: [], meta, text: fullText, kind: calendar ? 'calendar' : 'none' };
    }
    const minX = Math.min(...anchors.map((a) => a.w.x0));
    anchors = anchors.filter((a) => a.w.x0 < minX + 3 * h);
    // Misread codes ("CPCNETIL") are still row starts if they sit in the code column and can be repaired.
    lines.forEach((l, li) => {
      const w = l.words[0];
      if (!w || anchors.some((a) => a.li === li) || w.x0 > minX + 2 * h) return;
      const fixed = fixCode(w.text);
      if (/^[A-Z]{4,9}\d/.test(fixed) && fixed.length >= 6 && fixed.length <= 11 && CODE_RE.test(fixed)) {
        w.text = fixed;
        anchors.push({ li, w, yc: l.yc });
      }
    });
    anchors.forEach((a) => { a.w.text = fixCode(a.w.text); });
    // one anchor per line
    anchors = anchors.filter((a, i) => anchors.findIndex((b) => b.li === a.li) === i).sort((a, b) => a.yc - b.yc);

    // Line pitch inside multi-line cells.
    const diffs = [];
    for (let i = 1; i < lines.length; i++) {
      const d = lines[i].yc - lines[i - 1].yc;
      if (d > 0.6 * h && d < 1.9 * h) diffs.push(d);
    }
    const p = median(diffs) || 1.3 * h;

    // Body bounds: below the table header, above the TOTAL row.
    const first = anchors[0], last = anchors[anchors.length - 1];
    let top = first.yc - 3 * p;
    lines.forEach((l) => {
      if (l.yc < first.yc - 0.4 * h && l.words.some((w) => /^(DESCRIPTION|SCHEDULE|INSTRUCTOR|UNITS|SECTION)$/i.test(w.text))) top = Math.max(top, l.yc + 0.5 * h);
    });
    let bottom = last.yc + 4 * p;
    for (const l of lines) {
      if (l.yc > last.yc && l.words.some((w) => /^TOTAL$/i.test(w.text))) { bottom = Math.min(bottom, l.yc - 0.4 * h); break; }
    }
    const body = lines.filter((l) => l.yc > top && l.yc < bottom);

    // Are multi-line cells vertically centred (COR) or top-aligned (portal)?
    let centred = false;
    body.forEach((l) => {
      if (anchors.some((a) => lines[a.li] === l)) return;
      if (l.yc < first.yc - 0.5 * h) { centred = true; return; }
      const prev = anchors.filter((a) => a.yc <= l.yc + 0.3 * h).pop();
      if (!prev) return;
      const off = (l.yc - prev.yc) / p;
      const frac = Math.abs(off - Math.round(off));
      if (frac > 0.3 && frac < 0.7) centred = true;
    });

    const rows = anchors.map(() => []);
    body.forEach((l) => {
      let idx;
      const own = anchors.findIndex((a) => lines[a.li] === l);
      if (own >= 0) idx = own;
      else if (centred) {
        idx = 0;
        anchors.forEach((a, i) => { if (Math.abs(a.yc - l.yc) < Math.abs(anchors[idx].yc - l.yc)) idx = i; });
      } else {
        idx = Math.max(0, anchors.filter((a) => a.yc <= l.yc + 0.3 * h).length - 1);
      }
      rows[idx].push(l);
    });

    const subjects = rows.map((rl) => parseRowText(rowText(rl, h))).filter(Boolean);
    return { subjects: mergeSubjects(subjects), meta, text: fullText, kind: 'table' };
  }

  function textFromWords(words) {
    if (!words.length) return '';
    const h = median(words.map((w) => w.y1 - w.y0)) || 10;
    return groupLines(words, h).map((l) => l.words.map((w) => w.text).join(' ')).join('\n');
  }

  /** Fallback for plain text without positions: split on subject codes. */
  function parseText(text) {
    const meta = detectMeta(text);
    const flat = String(text || '').replace(/\s+/g, ' ');
    const idx = [];
    let m;
    CODE_RE_G.lastIndex = 0;
    while ((m = CODE_RE_G.exec(flat))) idx.push(m.index);
    const subjects = idx.map((s, i) => parseRowText(flat.slice(s, idx[i + 1] || flat.length))).filter(Boolean);
    return { subjects: mergeSubjects(subjects), meta, text };
  }

  function mergeSubjects(list) {
    const out = [];
    const byKey = {};
    list.forEach((s) => {
      const key = (s.code || '') + '|' + (s.section || '');
      const prev = byKey[key];
      if (!prev) { byKey[key] = s; out.push(s); return; }
      if ((s.description || '').length > (prev.description || '').length) prev.description = s.description;
      ['instructor', 'units', 'section', 'short'].forEach((k) => { if (!prev[k] && s[k]) prev[k] = s[k]; });
      (s.meetings || []).forEach((mt) => {
        if (!prev.meetings.some((p) => p.day === mt.day && p.start === mt.start && p.end === mt.end)) prev.meetings.push(mt);
      });
    });
    return out;
  }

  /* -------------------------------------------------- AI output normalize */

  function fromAI(json) {
    const subjects = (json && Array.isArray(json.subjects) ? json.subjects : []).map((s) => ({
      code: String(s.code || '').trim().toUpperCase(),
      description: String(s.description || '').trim(),
      short: String(s.short_name || '').trim(),
      section: String(s.section || '').trim().toUpperCase(),
      instructor: String(s.instructor_last_name || s.instructor || '').trim(),
      units: String(s.units || '').trim(),
      meetings: (Array.isArray(s.meetings) ? s.meetings : []).map((mt) => {
        const start = parseHHMM(mt.start), end = parseHHMM(mt.end);
        return { day: normDay(mt.day), start, end, room: String(mt.room || '').trim() };
      }).filter((mt) => mt.start != null && mt.end != null && mt.end > mt.start),
    })).filter((s) => s.code || s.description);
    const meta = { term: '', schoolYear: '' };
    if (json && json.term) meta.term = String(json.term).trim();
    if (json && json.school_year) {
      const sy = String(json.school_year).match(/(20\d{2})\s*[-–—\/]\s*(20\d{2})/);
      meta.schoolYear = sy ? sy[1] + '–' + sy[2] : String(json.school_year).trim();
    }
    return { subjects: mergeSubjects(subjects), meta };
  }

  function extractJSON(text) {
    const s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* fall through */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error('The AI did not return readable JSON.');
  }

  const api = {
    DAYS, DAY_NAMES, toMin, hhmm, parseHHMM, fmtTime, fmtRange, normDay, parseDayCode,
    isOnlineRoom, cleanRoom, lastName, shortName, shortNames, detectMeta,
    parseRowText, parseWords, parseText, textFromWords, mergeSubjects, fromAI, extractJSON,
  };
  root.SVParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
