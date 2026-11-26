# Verdicts

Every claim ends with exactly one of eight verdicts. The eval labels use these definitions.

| Verdict | Meaning | Example |
| --- | --- | --- |
| Supported | The source states it, including any condition that matters | Claim: "Participants were adults aged 18 to 40." Source says exactly that. |
| Partial | Part is supported; part is wrong, overstated, or an exception or condition is left out | Claim: "The drug reduced pain in all patients." Source: pain fell in 70% of patients. |
| Contradicted | The source states the opposite, or a different value | Claim: "The survey had 500 respondents." Source: 300 respondents. |
| Not in sources | Plausible, but none of the uploaded sources say it | Claim: "The programme cost less than the alternative." No source mentions cost. |
| Can't tell | The source is ambiguous or unreadable (for example a scanned table), or the judge's quote could not be found in the source; the tool abstains instead of guessing | A table that did not extract, or a quote that fails verification. |
| Reference not found | The citation is not in the reference list (the student's own list is incomplete), or a journal-style reference has no Crossref or OpenAlex match and no uploaded PDF matches it either; possibly mistyped or invented, or a journal that is not indexed online. Never given to a thesis, conference paper, book, law, standard or institutional report: those are Can't check ("could not be retrieved automatically"), because not being online says nothing about them (26 Nov 2026). If an uploaded PDF does match, the claim is checked against that PDF instead. | "Smith and Lee (2021), Journal of Applied Findings" returns nothing and no upload matches. |
| Can't check | The reference exists, but no usable source file is available to check the claim against: none was uploaded, or the uploaded PDF has no extractable text (a scan; there is no OCR) | A real paper is cited but the student has not uploaded it, or the upload is a scanned PDF. |
| No citation given | A factual claim with no citation attached | "Turnover rose 23% in 2022." with no reference. |

## Rules

- Reference not found, Can't check and No citation given are produced before the judge runs. They are real verdicts, not errors.
- No citation given means no citation anywhere after the claim in its own paragraph. A sentence followed later in its paragraph by a citation is checked against that source, and the card says the citation comes "from the end of its paragraph" (18 Nov 2026). Statements about the student's own project or method are not claims and get no verdict.
- Supported requires a verified quote and page. Without one, the verdict cannot be Supported.
- When unsure between Supported and Partial, prefer Partial. A missed unsupported claim costs more than an extra flag.
- A scanned PDF with empty pages is Can't check, never a wrong verdict.
- Source availability is kept apart from the verdict. The results screen leads with coverage, in buckets that never overlap: supported, to review (a source was read), citations to fix, waiting for sources, could use a source. A claim waiting for a source is never presented as unsupported or wrong (26 Nov 2026).
- A citation to a law or regulation, a standard (SNI, ISO) or an institution (a ministry, an agency, a university as the author) is not an author and year, and Crossref and OpenAlex do not hold it. When it is not matched to the reference list it is Can't check with a plain reason ("VerifiDocs does not look these up"), never Reference not found, which would read as "possibly invented" (26 Nov 2026).
- A sentence that reads the draft's own tables, figures or experiments is the student's own analysis, not a claim about the world, and gets no verdict, like the statements about their own project or method (26 Nov 2026).

## Fix list order (proposed: confirm on the eval set)

1. Contradicted
2. Reference not found
3. Not in sources
4. Partial
5. No citation given
6. Can't tell
7. Can't check

Supported claims are not shown in the fix list.
