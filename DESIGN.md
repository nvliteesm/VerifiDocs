# VerifiDocs design spec

Status: approved by Steven on 25 Nov 2026 (theme follows the device, with a toggle). **Amendment A (journey), approved by Steven on 25 Nov.** It follows the UX audit in `.design/ux-audit-2026-11-25.md`; changed sections are marked "(A)". Direction: C, "quiet instrument", with the draft kept beside the list. Evidence: `.design/research.md`, `.design/previews/direction-quiet-instrument.html`.
Dial (antislop): ENERGY 1 / RHYTHM 2 / MOTION 1.

## 1. Audience and jobs-to-be-done

- **Who:** a final-year student writing a thesis (in Indonesia, a skripsi) with references an AI helped supply. Comfortable in Word and Google Docs, not technical. (Confirmed by Steven, 25 Nov.)
- **Situation:** a laptop, usually the evening before submitting, under deadline stress. Phone is a fallback, not the target.
- **Primary task:** find which claims their sources do not support, and fix them.
- **Secondary tasks:** add the source PDFs; step through the problems one at a time; copy the corrected draft; say a verdict is wrong.
- **Not the job:** judging the student, scoring writing, rewriting prose, detecting AI. It is a self-check.

## 2. Aesthetic thesis

A quiet, dense review instrument: near-black, no accent colour, the student's own words in serif, and everything else small and plain, so the proof (the exact quote, its file and page, and a verdict you can tell apart without colour) is the only thing that stands out.

- **The one memorable element:** the verdict system. Eight verdicts, each with its own colour, icon, label and underline style in the draft.
- **Where the boldness is spent:** nowhere else. Chrome, buttons and type stay restrained.

## 3. Tokens

Source of truth is `src/app/globals.css`; the build replaces its current warm-paper values with these. **Theme:** the page follows the device's light or dark setting (a student whose device is dark sees dark, light sees light). A toggle in the header overrides it, and the choice is remembered in the browser. Dark is the designed-first theme, and both themes are complete.

### Colour (dark / light)

| Token | Dark | Light | Why |
|---|---|---|---|
| Ground | `#08090A` | `#F7F8F8` | Page background. |
| Panel | `#0E0F11` | `#FFFFFF` | Side rail, list group headers, evidence card. |
| Raised | `#16171A` | `#EEF0F2` | Selected row, active segment. |
| Line | `rgba(255,255,255,.08)` | `rgba(8,9,10,.10)` | The only separator; 1px. |
| Text | `#F7F8F8` | `#08090A` | Body and headings. |
| Muted | `#8A8F98` | `#5C616A` | Labels, ids, secondary text. 4.5:1 or better on Ground and Panel. |

The primary button is Text on Ground (white pill on dark). There is no accent colour: the only colours on the page are the verdict colours and the yellow evidence highlight.

### Verdict colours (dark / light), each with an icon and an underline style

| Verdict | Dark | Light | Underline in draft |
|---|---|---|---|
| Supported | `#84DCA3` | `#14693F` | solid, 1px |
| Partly supported | `#F0C36B` | `#8A5A00` | dashed, 2px |
| Contradicted | `#FF9F98` | `#A3201F` | wavy, 2px |
| Not in your sources | `#CFB0F0` | `#5E2A91` | dotted, 2px |
| Can't tell | `#B4BBC6` | `#3F4652` | double, 3px |
| Reference not found | `#8FD3E6` | `#0C5E73` | dashed, 2px |
| Can't check | `#AEB3BB` | `#4F545D` | dotted, 2px, dashed pill border |
| No citation given | `#E6E8EA` | `#1B1D22` | solid, 2px |

Evidence highlight: `#FFE58A` background with `#08090A` text, in both themes.
Each pair was checked at 4.5:1 or better on Ground and Panel (dark and light).

### Type

| Role | Face | Where | Why |
|---|---|---|---|
| Tool | Inter | All interface text, labels, buttons | Plain and legible at 12 to 14px. |
| Student's words | Newsreader | The draft, the claim sentence, the evidence quote, Before and After | Sets the student's text and the source's text apart from the tool's. |
| Identifiers | JetBrains Mono | `C-2`, page numbers, file names, counts | Only for things that are identifiers. |

Scale: 12 (labels, group titles), 13 (interface base), 14 (evidence text), 17 on 1.75 (draft, serif), 20 on 1.3 at 600 (claim title), 26 at 500 (page title, serif). Draft line length 68ch at most. Sentence case everywhere; no uppercase tracked labels.

### Spacing, radius, elevation, motion

- **Spacing:** 4px base; steps 4, 8, 12, 16, 24. Rows are 44px (touch-safe) in lists; navigation rows are 30px on pointer screens and 44px under 1024px.
- **Radius:** 6 for controls, 8 for cards and the evidence block, 999 only for the verdict pill. Reason: radius marks hierarchy; not everything is round.
- **Elevation:** none. Borders only. No shadows, no blur. Reason: flat and quiet is the thesis.
- **Focus:** 2px ring in Text colour, 2px offset, on every interactive element.
- **Motion:** 120ms ease-out on hover and selection only. One continuous motion: the "warming up" dot, a 1.4s opacity pulse. All motion stops under reduced motion.

## 4. Screens and layout

Screens: Start, Workspace, Edge states. No top navigation: a wordmark with the check-mark logo, the EN / ID toggle and the theme toggle. Everything fits one page.

### Workspace (after a check exists), laptop 1440 x 900

Three columns, borders only:
1. **Left rail, 232px.** Group "Verdicts": All claims, then one row per verdict that is present (icon, label, count in mono). Group "Sources": one row per file (status icon, name, "Ready, 3 pages"), then "Add PDF". The privacy line sits at the bottom. The rail can be hidden.
2. **Draft, flexible (about 560px).** The student's text in serif on Ground, claim sentences underlined by verdict, the selected sentence tinted and boxed in its verdict colour, a small `C-n` tag after each. Above it: the file name as page title, one line "Select a sentence to see its evidence", and the actions "Next issue" and "Copy fixed draft".
3. **Review, flexible (about 640px), split vertically.** Top: the claim list grouped by verdict, severity first, each group header with icon, name and count; rows are status icon, `C-n`, the sentence (one line, truncated) and the page. It scrolls inside about 40% of the height. Bottom: the selected claim.
   - (A) Order, top to bottom, so the action comes before the reading:
     1. Header: `C-2`, the stepper (previous, "1 of 4", next).
     2. Title: the sentence in serif, 20px.
     3. One row: the verdict pill and the citation. File and page appear once, in the evidence header, not here.
     4. One reason line: the model's "Why". The verdict's meaning line and "What to do" are shown only when there is no suggested fix.
     5. Fix: "Before" struck through, "After", **Apply fix** and **Ignore**, visible without scrolling at 1440 x 900.
     6. Evidence: file and page in the header (mono), the quote in serif with the differing words highlighted.
     7. Find a source (uncited claims only), then "This verdict is wrong".

(A) Top bar above the columns: on the left the result line in 15px (see 4b), with the thin verdict bar under it; on the right quiet buttons only: Copy report, Edit draft, Check again, New check, Delete. There is no primary button in the top bar; the primary action lives where the work is (Apply fix, or Copy fixed draft when done). "Hide sources" shows only under 1280px; "Hide inspector" is removed.

(A) The workspace fits the window: one scrollbar per pane, none on the page. **Under 1280px:** the review list collapses into the stepper alone and the rail becomes a toggle. **Under 1024px:** one pane at a time (Draft, Claim, Sources) chosen by a row of buttons, as now.

### Start (A)

Two columns, not three: the draft (main) and one side panel.
- **Privacy notice:** one line under the header, not a panel: "Your draft is kept for 30 days and checked by Google Gemini. No account needed." with **Details** (opens the full three points in place) and **Got it**. Checking stays locked until Got it, as now.
- **Main:** page title in serif, one line of explanation, then the draft card. While the draft is empty, **Try an example** is the most prominent action in the card. Paste, file, Google Docs link and the reference list work as now.
- **Side panel:** "Your sources" (the list, Add PDF, the size and count hint), one readiness line ("Draft added. 1 of 1 source read."), "What you'll get" as three short lines, and **Scan my draft**. The separate status cards and the left sources column are removed, so sources appear once.
- On a phone: notice line, draft, side panel, in that order.

### Edge states

Not separate screens; they appear in place. Warming up: a banner with the pulsing dot. Scanned PDF: the Can't check verdict, dashed and neutral, never red. A quote that failed the check: Can't tell, with the reason in "Why". A claim whose check failed in the browser: a notice with Try again. A part of the draft the AI could not read: a notice naming the part with Read again. Stopped by the student: the stats line says how far it got.

### Changes from the current build

- The warm-paper palette is replaced by the tokens above, in both themes. The theme still follows the device, with the existing toggle to override it.
- Draft and claim list are both visible; the right pane gains the grouped list above the claim.
- Remove: uppercase tracked labels ("YOUR SOURCES", "FILTER BY VERDICT", "DRAFT"), the numbered 01 / 02 / 03 list, and middle dots in the stats line and the "file · page" string.
- Evidence file and page sit in one header line in mono; properties sit as a row under the title.

## 4b. Journey rules (A)

| # | Moment | Rule | Copy (English; Indonesian in `messages.ts`) |
|---|---|---|---|
| J1 | Scan ends, sources ready | The check starts by itself. | "Checking {done} of {total}..." |
| J1 | Scan ends, a source still reading | Wait, then start by itself; say why. | "Waiting for your sources to finish reading..." |
| J1 | Scan ends, no source ready | Stop after the scan, as now, with **Check {n} cited claims** and the add-PDFs hint. | (existing) |
| J1 | A check reopened after a reload | Never starts by itself. | (existing) |
| J2 | Scanning | The pasted draft stays on screen (plain, not underlined) with the progress line; no empty panels. | "Finding the claims in your draft..." |
| J2 | Checking | Each row and sentence shows "Checking" while its request runs, and its verdict as soon as it lands. The result line counts only checked claims. | Row label "Checking" |
| J3 | Check ends (started this visit) | Select the first open issue, most serious first, unless the student already selected a claim. | Result line: "{n} to fix, {s} supported." or "Every checked claim is supported." |
| J4 | Apply fix or Ignore | Move to the next open issue at once. A line at the top of the claim panel keeps the way back. | "Fix applied to C-2." / "C-2 ignored." with **Undo** |
| J5 | Fixing | The result line counts down. | "{left} left to fix, {done} handled." |
| J6 | Last issue handled | The claim panel becomes the done state: one line, **Copy fixed draft** as the primary button, **Copy report** beside it, then the pay question. | "All {n} handled. Copy your fixed draft to use it." |
| J7 | Labels | The eyebrow says "Scanning" during the scan and "Checking" during the check. | "Scanning" / "Checking" |

Tone: the result line is plain ink, not red; red stays on underlines and pills. "Need attention" becomes "to fix" in the result line.

## 5. Components and states

Every interactive component has default, hover (120ms), focus (ring), active, disabled (muted, not-allowed cursor) unless noted.

| Component | States beyond the base |
|---|---|
| Filter row | Selected (Raised). Hidden when the verdict is absent. |
| Source row | Ready, reading (progress), no text found (dashed), failed (with Retry), removing disabled while uploading. |
| Claim row | Selected, resolved (applied or ignored), muted by filter, (A) checking (clock icon and "Checking"), waiting (clock icon). |
| Draft sentence | Verdict underline; selected; muted at 28% opacity by a filter; applied (small Before and After diff while selected); ignored (dashed). |
| Verdict pill | Eight variants. Can't check has a dashed border. |
| Evidence card | With quote; without a quote (hidden); with a machine translation line (labelled, below the quote); with marked numbers and a one-line note. |
| Fix block | No suggestion ("No sentence to suggest..."); not placeable in the draft (Copy sentence instead of Apply fix); applied; ignored. (A) After Apply fix or Ignore the panel has already moved on; the undo line is shown on the next claim. |
| (A) Done panel | Shown when no issue is open after a check: the done line, Copy fixed draft (primary), Copy report, the pay question. |
| (A) Privacy line | Collapsed (one line, Details, Got it); expanded (the three points). |
| Stepper | Wraps round; disabled when nothing is open. |
| Buttons | Primary (white on dark), secondary (outline), quiet link. |
| Draft input | Empty, typing, link detected (one press to read), reading, loaded card, too long (error), read failed. |
| Status card | Good (solid), neutral (dashed). |
| Banners | Warming up (pulse), notice, error with Try again. |
| Result line | (A) Scanning, waiting for sources, checking ({done} of {total}), done ("{n} to fix, {s} supported."), fixing ("{left} left to fix, {done} handled."), all handled, stopped, no claims found. |

Loading, empty and error exist for every list (claims, sources, fix list): "Nothing left to fix." and "No sources yet." are the empty states.

## 6. Content rules

- **Voice:** plain, short, one line per element. No apology, no hype, no "AI-powered". Says what happened and what to do. Never judges the student.
- **Languages:** English and Bahasa Indonesia, both first-class. Indonesian addresses the student as "kamu".
- **Real copy from the data model:** verdict labels are exactly Supported, Partly supported, Contradicted, Not in your sources, Can't tell, Reference not found, Can't check, No citation given. Example claim: "Food prices fell during the same year"; example evidence: "Food prices rose by 7.1 percent in 2023, the fastest increase of any category." (Contoh-Statistics-Office-2024.pdf, p. 2).
- **Naming consistency:** the button "Apply fix" produces "Fix applied to C-2." (A); "Ignore" produces "Ignored."; "Copy fixed draft" becomes "Copied"; "Add PDF" produces a source row; "Scan my draft" produces the scan summary.
- **Meta strings:** no middle dots. Use a comma or a word: "5 checked, 1 supported, 4 need attention"; file and page sit in separate spans.

## 7. Banned patterns

Global list: the "Global banned patterns" in the ui-design-orchestrator skill. Project-specific:

- No chat bubbles, no prompt box, no sparkle or magic icons, no first-person assistant voice. (Anti-reference: a generic AI chatbot UI.)
- No scores, grades, percentages of "AI-written", or similarity numbers. It is a self-check.
- No second accent colour. Colour means a verdict, or the evidence highlight.
- No uppercase tracked eyebrow labels; no 01 / 02 / 03 markers on lists that are not a sequence.
- No dead controls: a control that does nothing is removed (for example "Find sources by topic" is not built).

### Overrides (written reason)

- **Near-black ground `#08090A` (dark theme):** the global list bans a tinted near-black "without a reason". The reason is that Steven chose the dark, dense look of the Linear reference after seeing it (25 Nov). It is the single ground colour, with no gradient and no glow.
- **Theme follows the device, with a toggle:** Steven's change on 25 Nov, replacing "dark by default". A device set to dark gets dark; a device set to light gets light; the toggle overrides either.
- **Monospace for small text:** limited to identifiers (`C-n`, pages, file names, counts), which is a functional use.
- **Serif for the student's words:** Steven chose it (25 Nov) as the scholarly cue; it is the one place the product speaks in the student's voice.
- **Dense, list-first layout:** the preview was approved with the written caveat that it pulls against "calm" and against the draft being the hero; it was resolved by keeping the draft visible beside the list.

## 8. Reference decisions

- **Linear** (observed 25 Nov): quiet text rows with small status icons and one-pixel lines; items grouped by status with a count; a "1 / 84" stepper; mono for identifiers; a near-black ground. Borrowed: all of these. Not borrowed: the single sans (the student's words are serif here) and the accent.
- **Zotero** (observed): a three-pane library students already know; plain labels; low radius. Borrowed: the three-column shape and the plain wording.
- **Hypothesis** (observed): a highlight in the text with a note attached. Borrowed: the yellow highlight on the exact passage.
- **Grammarly** (observed): an underline in the text, one small card per issue, short verbs. Borrowed: underline plus a card with Apply fix and Ignore.
- **Anti-reference:** a generic AI chatbot UI (not captured; the site blocked automated browsers). Avoided: bubbles, a bottom prompt box, answers without a source beside them.
- **Not captured:** scite.ai, turnitin.com, chatgpt.com (blocked). Nothing in this spec depends on them.

## 9. Open questions

None.
