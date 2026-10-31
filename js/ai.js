/* ASCEND Schedule Viewer — AI extraction using the student's own API key.
 * Requests go straight from the browser to the chosen provider; nothing passes through ASCEND. */
(function (root) {
  'use strict';

  const PROVIDERS = {
    gemini: {
      label: 'Google Gemini',
      badge: 'Free tier',
      defaultModel: 'gemini-flash-latest',
      keyUrl: 'https://aistudio.google.com/apikey',
      keyHint: 'Starts with "AIza…". Free from Google AI Studio.',
      keyPattern: /^AIza[\w-]{20,}$/,
      keyShape: 'Gemini keys start with “AIza”',
    },
    openai: {
      label: 'OpenAI (ChatGPT)',
      badge: 'Paid',
      defaultModel: 'gpt-5-mini',
      keyUrl: 'https://platform.openai.com/api-keys',
      keyHint: 'Starts with "sk-…". Needs API credits (separate from ChatGPT Plus).',
      keyPattern: /^sk-(?!ant-)[\w-]{20,}$/,
      keyShape: 'OpenAI keys start with “sk-”',
    },
    anthropic: {
      label: 'Anthropic Claude',
      badge: 'Paid',
      defaultModel: 'claude-opus-5-5',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      keyHint: 'Starts with "sk-ant-…". Needs API credits.',
      keyPattern: /^sk-ant-[\w-]{20,}$/,
      keyShape: 'Claude keys start with “sk-ant-”',
    },
  };

  const PROMPT = `You read class schedules of Computer Engineering students in the Philippines.
The image(s) show a Certificate of Registration (COR) or a student-portal "Schedule Viewer" in list view or calendar/grid view. Several images may be parts of the same schedule.

Return ONLY a JSON object with this shape:
{
  "term": "e.g. \\"2nd Term\\" or \\"1st Semester\\"; \\"\\" if not shown",
  "school_year": "e.g. \\"2026-2027\\"; \\"\\" if not shown",
  "subjects": [
    {
      "code": "subject code, e.g. CPCNET1L",
      "description": "full subject title as printed",
      "short_name": "short but recognizable title, at most 24 characters",
      "section": "e.g. CPE231; \\"\\" if not shown",
      "instructor_last_name": "surname only; \\"\\" if not shown",
      "units": "e.g. 3.0; \\"\\" if not shown",
      "meetings": [ { "day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun", "start": "HH:MM 24-hour", "end": "HH:MM 24-hour", "room": "room exactly as printed" } ]
    }
  ]
}

Rules:
- One entry per subject code + section. Merge duplicates that appear in several images.
- One meeting per day. Day codes: M=Mon, T=Tue, W=Wed, TH=Thu, F=Fri, S or Sa=Sat, Su=Sun. Combined codes split into days: MTH = Mon+Thu, TF = Tue+Fri, MWF = Mon+Wed+Fri, TTH = Tue+Thu.
- Convert times to 24-hour (05:00PM -> 17:00). In calendar views without AM/PM, use the time axis to decide.
- If a room cell lists several rooms separated by "/" and the count equals the number of days, give each day its room in order; otherwise repeat the same room for every day.
- instructor_last_name: surname only, without titles or degrees (Dr., Engr., Prof., MS, MENG, PhD). Keep multi-word surnames such as "Dela Cruz".
- short_name: title case, keep numbers and "Lab". Examples: "ON-THE-JOB TRAINING 1" -> "OJT 1"; "EMERGING TECHNOLOGIES IN CpE" -> "Emerging Tech in CpE"; "COMPUTER NETWORKS AND SECURITY - LAB" -> "CompNet & Security Lab"; "CAPSTONE DESIGN PROJECT 2 - DRAFTING" -> "Capstone Design 2"; "CpE LAWS AND PROFESSIONAL PRACTICE" -> "CpE Laws & Prof. Practice".
- Never output personal information (student name, student number, address, birthday, contact details, fees). Only schedule data.
- Do not invent subjects. Use "" for anything unreadable. If no schedule is visible, return "subjects": [].`;

  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['term', 'school_year', 'subjects'],
    properties: {
      term: { type: 'string' },
      school_year: { type: 'string' },
      subjects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'description', 'short_name', 'section', 'instructor_last_name', 'units', 'meetings'],
          properties: {
            code: { type: 'string' },
            description: { type: 'string' },
            short_name: { type: 'string' },
            section: { type: 'string' },
            instructor_last_name: { type: 'string' },
            units: { type: 'string' },
            meetings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['day', 'start', 'end', 'room'],
                properties: {
                  day: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
                  start: { type: 'string' },
                  end: { type: 'string' },
                  room: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };

  class AIError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function readError(res, provider) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && (j.error.message || j.error.type)) || j.message || '';
    } catch (e) { /* not JSON */ }
    const name = PROVIDERS[provider].label;
    if (res.status === 400 && /api key|API_KEY/i.test(detail)) return new AIError(`${name} rejected the API key. Check that you copied the whole key.`, 401);
    if (res.status === 401 || res.status === 403) return new AIError(`${name} rejected the API key (${res.status}). Check that you copied the whole key and that it is active.`, res.status);
    if (res.status === 404) return new AIError(`${name} could not find the model. Open "Advanced" and reset the model name. ${detail}`, 404);
    if (res.status === 429) return new AIError(`${name} says you've hit a rate limit or run out of quota. Wait a minute and try again, or use Offline mode.`, 429);
    if (res.status >= 500) return new AIError(`${name} is having trouble right now (${res.status}). Try again in a bit, or use Offline mode.`, res.status);
    return new AIError(`${name} error ${res.status}: ${detail || res.statusText}`, res.status);
  }

  /** Format check only (never sent anywhere): catches a key pasted under the wrong provider. */
  function keyLooksRight(provider, key) {
    const p = PROVIDERS[provider];
    return !p || !key || p.keyPattern.test(key);
  }

  // Every request: no cookies, no referrer, no caching, and a time limit so a stuck request can't hang the app.
  const TIMEOUT_MS = 180000;
  async function post(url, headers, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new AIError('The AI took too long to answer. Try again, or upload fewer images.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callGemini(key, model, images) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await post(url, { 'Content-Type': 'application/json', 'x-goog-api-key': key }, {
      contents: [{
        role: 'user',
        parts: [{ text: PROMPT }].concat(images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.b64 } }))),
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    });
    if (!res.ok) throw await readError(res, 'gemini');
    const j = await res.json();
    const cand = j.candidates && j.candidates[0];
    if (!cand || !cand.content) {
      const why = (j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'no answer';
      throw new AIError(`Gemini returned no result (${why}).`);
    }
    return cand.content.parts.map((p) => p.text || '').join('');
  }

  async function callOpenAI(key, model, images) {
    const res = await post('https://api.openai.com/v1/chat/completions', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, {
      model,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: PROMPT }].concat(images.map((im) => ({ type: 'image_url', image_url: { url: im.dataUrl, detail: 'high' } }))),
      }],
    });
    if (!res.ok) throw await readError(res, 'openai');
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg) throw new AIError('OpenAI returned no result.');
    if (msg.refusal) throw new AIError('OpenAI declined to read this image: ' + msg.refusal);
    return msg.content || '';
  }

  // Models that accept server-side refusal fallbacks ("default" routing).
  const CLAUDE_FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-1|sonnet-5-5)$/;

  async function callAnthropic(key, model, images) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model,
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }))
          .concat([{ type: 'text', text: PROMPT }]),
      }],
    };
    if (CLAUDE_FALLBACK_MODELS.test(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    const res = await post('https://api.anthropic.com/v1/messages', headers, body);
    if (!res.ok) throw await readError(res, 'anthropic');
    const j = await res.json();
    if (j.stop_reason === 'refusal') throw new AIError('Claude declined to read this image. Try Offline mode or another provider.');
    if (j.stop_reason === 'max_tokens') throw new AIError('Claude ran out of room before finishing. Try uploading fewer images at once.');
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  /** images: [{mime, b64, dataUrl}] → normalized {subjects, meta} via SVParser.fromAI */
  async function extract({ provider, key, model, images }) {
    if (!PROVIDERS[provider]) throw new AIError('Unknown AI provider.');
    if (!key) throw new AIError('Please paste your API key first.');
    model = (model || '').trim() || PROVIDERS[provider].defaultModel;
    let text;
    try {
      if (provider === 'gemini') text = await callGemini(key, model, images);
      else if (provider === 'openai') text = await callOpenAI(key, model, images);
      else text = await callAnthropic(key, model, images);
    } catch (e) {
      if (e instanceof AIError) throw e;
      // fetch() network/CORS failures land here. OpenAI answers a wrong key without CORS headers,
      // so in the browser a bad OpenAI key looks exactly like a network failure.
      const name = PROVIDERS[provider].label;
      if (provider === 'openai') throw new AIError(`Couldn't get an answer from ${name}. This usually means the API key is wrong or has no credits. If the key is right, check your internet connection or ad-blocker.`);
      throw new AIError(`Couldn't reach ${name}. Check your internet connection (and that no ad-blocker is blocking it), then try again.`);
    }
    const json = root.SVParser.extractJSON(text);
    return root.SVParser.fromAI(json);
  }

  root.SVAI = { PROVIDERS, extract, keyLooksRight, AIError };
})(window);
