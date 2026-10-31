# ASCEND Schedule Viewer

A web tool for Computer Engineering students. A student uploads their Certificate of Registration (COR) or a student-portal schedule screenshot. The tool reads it, lets them fix anything that's wrong, and produces a clean, phone-sized schedule image with the ASCEND branding.

It's a **static website**: plain HTML, CSS, and JavaScript with no server, no database, and no build step. Everything runs in the student's browser.

## Features

- **Animated guide**: a 4-step tutorial (open schedule → hide personal info → upload → check & download) opens on each visit. Students can tick *Don't show this again*, and replay it any time from **Guide** in the header.
- **Simple screens**: the start screen has only upload, key, and the Read button. Upload tips, privacy details, the AI-vs-Offline explanation, image options, and per-subject fields open from buttons when needed.

- **Two ways to read a schedule**
  - **AI mode**: the student pastes their own API key. Supported providers are Google Gemini (free tier), OpenAI, and Anthropic Claude. It reads every format, including the portal's calendar view.
  - **Offline mode**: no key needed. It reads the PDF text layer directly, or runs on-device OCR (Tesseract) on images. It's less accurate, so the app warns students to double-check. It reads COR PDFs and List-view screenshots, but not the calendar view.
- **Schedule first**: after reading, students land on their schedule image with a short "things to check" note. Tapping the image opens it full screen with zoom and Download. Tapping a class there opens that subject for editing.
- **Text size**: a slider (70–150%) makes the text on the image bigger or smaller. In the weekly grid, a short class may hide its time line at large sizes (the hours stay on the left axis), and a name with a long word only grows as far as its column allows.
- **Review & edit**: every field can be edited. That covers program, term, school year, and an optional label. Per subject: short name, full title, code, section, professor, colour, and days/times/rooms. Professor fields that are still blank are highlighted, and the image shows "TBA" until they're filled in.
- **Smart cleanup**
  - Long titles are shortened (e.g. *ON-THE-JOB TRAINING 1* → *OJT 1*).
  - Professors are reduced to last names (*Dr. Corazon B. Rebong* → *Rebong*).
  - Day codes are expanded (*MTH* → Mon + Thu).
  - Split rooms are assigned per day (*T1 - 407L/T1 - 420L* + *TF*).
  - Rooms with **VR** (e.g. *SET VR20*) are marked **Online**; everything else is **F2F**.
- **The image** shows only the days and hours that have classes, and squeezes long breaks into a thin "No classes" band.
  - Layouts: weekly grid or day list.
  - Themes: Midnight, ASCEND Blue, Light.
  - Lock-screen mode leaves room for the phone's clock.
  - Optional subject codes, sections, and 24-hour time.
  - Sizes: "Fit this phone" (on phones), 9:20, 9:19.5, 9:16, square (1:1), QHD, 4:5, 16:9, or a custom size. Downloads as a PNG, or shares straight to the phone's gallery where supported.
- **Warnings**: missing days or times, schedule conflicts, missing term, and a guessed school year.
- **Save / open**: students can save an editable `.json` copy to update later (e.g. when professors are posted).

## Privacy

- No analytics, no tracking, no server. Files and schedules stay in the browser tab and are gone on refresh.
- In AI mode, images go **directly** from the student's browser to the chosen AI provider with the student's own key.
- API keys stay in memory unless the student ticks *Remember on this device*, which saves the key in that browser's `localStorage`. *Forget key* removes it.
- Fonts (Google Fonts), the PDF reader (cdnjs), and the OCR engine (jsDelivr) are loaded from public CDNs. They never receive student files.

## Security

- **Content Security Policy.** The page can only load code from itself and the pinned pdf.js / Tesseract.js paths. It can only connect to those CDNs and the three AI APIs. Inline scripts and styles, plugins, forms, and framing are all blocked.
  - The policy is sent as a header by `vercel.json` and repeated in a `<meta>` tag in `index.html` for GitHub Pages. **Keep the two in sync.**
- **Subresource Integrity.** pdf.js and Tesseract.js are pinned to exact versions and checked against SHA-384 hashes. Their web workers are downloaded with the hash checked and started from a local `blob:` copy. A tampered CDN file is refused.
  - To upgrade, recompute the hashes in `js/extract.js` (the command is in the comment there) and update both CSP copies.
- **Other headers (Vercel):** `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, COOP/CORP, and a `Permissions-Policy` that turns off the camera, microphone, location and other device APIs. A script check also refuses to run inside a frame on hosts without headers.
- **Untrusted input is validated:**
  - **Uploads:** checked by their first bytes, not the file name. Limits are 25 MB per file, 60 MP per image, and 3 PDF pages.
  - **Imported `.json` files and saved preferences:** only known keys are copied, with type and range checks and length limits (no prototype tricks).
  - **AI replies:** treated as data. Arrays are capped, strings are clipped, and everything is escaped before it reaches the page.
- **API requests** send no cookies and no referrer, aren't cached, and time out after 3 minutes. Keys go in headers, never in URLs.
- **Text fields** have length limits, and all user text is HTML-escaped when shown.

**If you host this, keep it that way.** Don't add analytics, trackers, or form back-ends, or the privacy notice on the page stops being true.

## Hosting (pick one)

**Vercel:** import the GitHub repository at vercel.com/new (framework preset: *Other*, no build command, output directory: the root), or run `npx vercel --prod` in this folder. `vercel.json` adds the security headers.

**GitHub Pages:** push this folder to a GitHub repository, then go to *Settings → Pages → Deploy from branch → main / root*. The site will be at `https://<user>.github.io/<repo>/`.

**Netlify:** go to app.netlify.com/drop and drag this folder onto the page.

**Locally (for testing):** run `python -m http.server 8000` in this folder, then open http://localhost:8000. Opening `index.html` by double-clicking mostly works, but a local server is closer to how it behaves online.

## Project layout

| File | What it does |
|---|---|
| `index.html` | Page structure and all on-page text (instructions, privacy notice). |
| `css/style.css` | Styles (light and dark, phone-first). |
| `js/parser.js` | Pure parsing logic: times, day codes, rooms, last names, title shortening, table rebuild from word positions. Runs in Node too. |
| `js/extract.js` | Reads files: PDF text (pdf.js), PDF/page rendering, OCR (Tesseract.js, two passes). |
| `js/ai.js` | AI providers, the extraction prompt, and the JSON schema. |
| `js/render.js` | Draws the schedule image on a canvas (layouts, themes, sizes). |
| `js/app.js` | UI controller: upload, settings, editor, notices, download/share, save/open. |
| `js/logo-data.js` | The logo badge embedded as a data URL, so image export works even from `file://`. |
| `assets/` | Logo badge, icons, and the original logo. |
| `vercel.json` | Vercel settings: the security headers (CSP and others). |

## Common maintenance

- **A subject's short name looks wrong:** add a rule to `PHRASES` (whole phrases) or `WORD_ABBR` (single words) in `js/parser.js`. Students can always edit the name themselves.
- **An AI provider retires a model:** change `defaultModel` in `PROVIDERS` in `js/ai.js`. Students can also override the model under *Advanced*.
  - The defaults are `gemini-flash-latest` (an alias Google keeps current), `gpt-5-mini`, and `claude-opus-5-5`.
  - For Claude, the app requests low reasoning effort and server-side refusal fallbacks (`fallbacks: "default"`).
- **The portal or COR layout changes:** Offline mode finds rows by subject codes in the left-most column (4–9 letters, then digits) and reads the other columns by position. If codes or sections change format, update `CODE_RE` / `SECTION_RE` in `js/parser.js`.
