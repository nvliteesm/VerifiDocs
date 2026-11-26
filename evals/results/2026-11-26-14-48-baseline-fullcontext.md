# Baseline: whole source in context, no retrieval (2026-11-26)

Same judge model `gemini-3.8-flash`, same judge prompt. 44 claims whose label is supported, partial, contradicted or not in sources and whose citation points at an uploaded PDF, 3 runs each. The product column is `gemini-3.8-flash` from `2026-11-26-14-46-gemini-3.8-flash.json`, scored on the same claims. The baseline judge sees every page of the PDF; it has no retrieval, no second-model review, no fix step.

| System | Strict | Lenient | Missed unsupported (called Supported) | Checks that failed |
| --- | --- | --- | --- | --- |
| Baseline, as the model answered | 91.7% | 98.5% | 0 of 63 (0.0%) | 2 |
| Baseline, with the product's quote check applied | 84.1% | 90.9% | 0 of 63 (0.0%) | 2 |
| VerifiDocs (retrieval + review + quote check) | 93.2% | 100.0% | 0 of 63 (0.0%) | 0 |

Quotes the baseline gave (for a verdict that cites one) that are NOT in the source text: 10 of 115. In the product these can never be shown (hard rule 1).

Not run: NotebookLM and CekSitasi (docs/eval.md baselines 2 and 3; they need a person at their web pages). The three verdicts decided before a source is read are not compared. The product's results were not produced by this script; they come from the file named above.
