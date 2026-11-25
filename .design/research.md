# Design research for VerifiDocs

Accessed 25 Nov 2026 with headless Chrome at 1440x900. Screenshots are in `.design/shots/`; computed fonts and colours are in `.design/shots/styles.json`. Only what was observed on the page is stated. Marketing pages, not logged-in product screens.

Brief: audience = final-year student, laptop, near a deadline. Tone = calm, exacting, scholarly. Liked (provisional, unseen by the user) = Linear. Disliked = a generic AI chatbot UI.

## Not captured (blocked)

scite.ai and turnitin.com answered 403 to automated browsers; chatgpt.com showed a bot check. No screenshots or styles for them. Anything said about them below is from general knowledge, marked as such, and must not be treated as observed.

## Linear (linear.app) - the user's provisional reference

- Observed: near-black page (`rgb(8,9,10)`), off-white text, headline 64px at weight 510 in Inter Variable, a monospace (Berkeley Mono) for code and ids, pill-shaped nav and buttons, a product screenshot of a list / detail / properties layout: left sidebar of plain text rows with small icons, a centre detail with a quiet title and activity log, a right column of labelled properties.
- Decisions to borrow: very quiet chrome (text rows, 1px lines, no cards around everything); status shown as a small icon plus word; one navigation row (up / down arrows with "1 / 84") for stepping through items; a monospace only for identifiers.
- Decisions to avoid: the near-black default and the dense developer look (it would fight "scholarly" and a student reading prose in daylight); the list-first layout, which would demote the draft from hero to context.
- Note for the user: Linear is **dark** and **dense**. If you assumed a light, airy look, that is not Linear.

## Zotero (zotero.org) - the tool students already use for references

- Observed: white page, Avenir Next LT Pro in light weight (300) for a 60px headline, a flat red "Download" button, a desktop-app screenshot with a collection tree on the left, an item table with Title / Creator / Year in the middle and a plain details panel on the right. Radius 3px on buttons.
- Decisions to borrow: a three-pane library that students already understand (collection, items, details); sober, low-radius controls; plain labels ("Creator", "Year").
- Decisions to avoid: the scattered decorative icons around the headline; a table as the main surface, because the claim is a sentence, not a row.

## Hypothesis (web.hypothes.is) - annotation next to the text

- Observed: white page, Visby (a rounded geometric sans) for 52px headlines at weight 700 in red and ink, Inter for body at 18px, a pill "Get Started" button, an angled product illustration showing highlighted text with comment cards beside it, a cookie banner covering the lower left.
- Decisions to borrow: the pattern of highlight in the text with a note attached beside it; a yellow highlight for the exact passage.
- Decisions to avoid: tilted product illustrations; the saturated red used for headline and button together.

## Grammarly (grammarly.com) - inline issues with a card per issue

- Observed: white page, a custom sans ("matter") at 46px, weight 670, centred hero, a green call to action, and product cards showing a text with coloured underlines and a small floating card with Accept and Dismiss.
- Decisions to borrow: underline in the text plus one small card with a primary action and a dismiss; the verbs "Accept" and "Dismiss" are short and exact.
- Decisions to avoid: the centred hero and the gradient card backgrounds; tone and rewrite suggestions, which would push VerifiDocs toward writing assistance (a hard rule says it is a self-check).

## Anti-reference: a generic AI chatbot UI (chatgpt.com blocked; general knowledge, not observed)

- Pattern: a single column of chat bubbles, a prompt box at the bottom, an answer with no source beside it, sparkle icons, conversational voice.
- Why it is the wrong model here: VerifiDocs must show proof (quote and page) next to a verdict, and must not read like it is talking.

## Where the references agree

- Text stays primary; controls are small; the issue is attached to the text it concerns.
- Short verbs for actions.

## Convergence warning

All of Linear, Zotero and Grammarly settle on a near-white or near-black field, one saturated accent, and a rounded or pill call to action. A design built from them alone drifts to "neutral SaaS". VerifiDocs' own difference is the proof: the exact quote with file and page, and eight verdicts that can be told apart without colour. That, not the chrome, should be the memorable element.
