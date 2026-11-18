// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankFixList } from "@/lib/fix-list";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { countVerdicts, initialState, type Phase, type VerifierState } from "@/lib/client/verifier-state";
import { ResultsView, shortQuote } from "./ResultsView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let n = 0;
function claim(verdict: Verdict | null, extra: Partial<ClaimView> = {}): ClaimView {
  n += 1;
  return {
    id: `c${n}`,
    position: n,
    text: `Claim number ${n}`,
    citation: "(Smith, 2021)",
    citationInherited: false,
    section: null,
    need: "must",
    status: verdict ? "done" : "pending",
    verdict,
    quote: null,
    page: null,
    reason: null,
    exitStage: null,
    fixSuggestion: null,
    ...extra,
  };
}

function stateOf(claims: ClaimView[], phase: Phase = "done"): VerifierState {
  return {
    ...initialState,
    phase,
    runId: "run-1",
    claims,
    counts: countVerdicts(claims),
    fixList: rankFixList(claims).map((c) => c.id),
  };
}

const noop = () => {};
const view = (state: VerifierState, onEvent = vi.fn()) =>
  render(<ResultsView state={state} onRetryClaim={noop} onEvent={onEvent} />);

describe("ResultsView tally", () => {
  it("uses the singular for one claim", () => {
    view(stateOf([claim("contradicted", { quote: "q", reason: "r" })]));
    expect(screen.getAllByText("1 of 1 claim needs attention.").length).toBeGreaterThan(0);
  });

  it("uses the plural for several claims", () => {
    view(stateOf([claim("contradicted"), claim("supported"), claim("not_in_sources")]));
    expect(screen.getAllByText("2 of 3 claims need attention.").length).toBeGreaterThan(0);
  });

  it("does not show a tally while claims are still being checked", () => {
    view(stateOf([claim(null), claim(null)], "checking"));
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("announces the outcome in a status region that stays on the page", () => {
    view(stateOf([claim("supported")]));
    expect(screen.getByRole("status").textContent).toContain("Every checked claim is supported.");
  });
});

describe("ResultsView filter", () => {
  it("opens on All, not an empty list, when nothing needs attention", () => {
    view(stateOf([claim("supported", { text: "A supported claim" })]));
    expect(screen.getByText("A supported claim")).toBeTruthy();
    expect(screen.queryByText("Nothing in this filter.")).toBeNull();
    expect(screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens on Needs attention when something does", () => {
    view(stateOf([claim("supported", { text: "fine one" }), claim("contradicted", { text: "wrong one" })]));
    expect(screen.getByText("wrong one")).toBeTruthy();
    expect(screen.queryByText("fine one")).toBeNull();
  });
});

describe("ResultsView flagging", () => {
  const flaggable = () => claim("contradicted", { text: "wrong one", quote: "five percent", page: 2, reason: "r" });

  it("asks why first, and sends the verdict and the chosen reason once", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([flaggable()]), onEvent);

    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(onEvent).not.toHaveBeenCalled(); // nothing is sent until a reason is chosen
    const group = screen.getByRole("group", { name: "What looks wrong with this verdict?" });
    await user.click(within(group).getByRole("button", { name: "It is on a different page" }));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("verdict_flagged_wrong", { verdict: "contradicted", reason: "wrong_page" });
    expect(screen.getByText("Thanks, noted.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "This verdict is wrong" })).toBeNull();
  });

  it("never offers a text box, so nothing typed can leave the page", async () => {
    const user = userEvent.setup();
    view(stateOf([flaggable()]));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("moves focus to the first reason, and then to the thank-you line", async () => {
    const user = userEvent.setup();
    view(stateOf([flaggable()]));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "The quote does not support this" }));
    await user.click(screen.getByRole("button", { name: "It misread my claim" }));
    expect(document.activeElement).toBe(screen.getByText("Thanks, noted."));
  });

  it("lets the student back out without sending anything, with focus back on the button they started from", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([flaggable()]), onEvent);
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    await user.click(screen.getByRole("button", { name: "Never mind" }));
    const again = screen.getByRole("button", { name: "This verdict is wrong" });
    expect(again).toBeTruthy();
    expect(document.activeElement).toBe(again); // not the page body
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("only offers reasons that fit: quote reasons need a quote, 'already uploaded' needs a no-match verdict", async () => {
    const user = userEvent.setup();
    const { unmount } = view(stateOf([flaggable()]));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.queryByRole("button", { name: "I already uploaded this source" })).toBeNull();
    expect(screen.getByRole("button", { name: "The quote does not support this" })).toBeTruthy();
    unmount();

    view(stateOf([claim("cant_check", { reason: "The reference exists, but no uploaded source matches it." })]));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.getByRole("button", { name: "I already uploaded this source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "The quote does not support this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "It is on a different page" })).toBeNull();
  });

  it("remembers a flagged claim after the filter changes, so it cannot be flagged twice", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([claim("contradicted", { text: "wrong one" }), claim("supported", { text: "fine one" })]), onEvent);

    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    await user.click(screen.getByRole("button", { name: "It misread my claim" }));
    expect(screen.getByText("Thanks, noted.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByRole("button", { name: /^Needs attention/ }));

    expect(screen.getByText("Thanks, noted.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "This verdict is wrong" })).toBeNull();
    expect(onEvent.mock.calls.filter(([name]) => name === "verdict_flagged_wrong")).toHaveLength(1);
  });

  it("flags only the claim that was clicked", async () => {
    const user = userEvent.setup();
    view(stateOf([claim("contradicted", { text: "first" }), claim("not_in_sources", { text: "second" })]));
    const buttons = screen.getAllByRole("button", { name: "This verdict is wrong" });
    await user.click(buttons[0]!);
    await user.click(screen.getByRole("button", { name: "It misread my claim" }));
    expect(screen.getAllByRole("button", { name: "This verdict is wrong" })).toHaveLength(1);
    expect(screen.getAllByText("Thanks, noted.")).toHaveLength(1);
  });
});

describe("ResultsView when the student stopped the check", () => {
  const stopped = (claims: ClaimView[]): VerifierState => ({ ...stateOf(claims, "done"), stopped: true });

  it("says how far it got, and counts what needs attention among the checked claims", () => {
    view(stopped([claim("contradicted"), claim(null), claim(null)]));
    expect(screen.getAllByText("Stopped after 1 of 3 claims. 1 needs attention.").length).toBeGreaterThan(0);
    expect(screen.getByText("Check stopped by you")).toBeTruthy();
  });

  it("never claims everything is supported when claims were left unchecked", () => {
    view(stopped([claim("supported"), claim(null)]));
    expect(screen.queryByText("Every checked claim is supported.")).toBeNull();
    expect(screen.getAllByText("Stopped after 1 of 2 claims.").length).toBeGreaterThan(0);
  });

  it("labels the unchecked claims 'Not checked', not 'Waiting'", () => {
    view(stopped([claim("contradicted"), claim(null, { text: "left over" })]));
    const card = screen.getByText("left over").closest("li")!;
    expect(within(card).getByText("Not checked")).toBeTruthy();
    expect(screen.queryByText("Waiting…")).toBeNull();
  });

  it("explains a stop before any claims were found, instead of 'no checkable claims'", () => {
    view(stopped([]));
    expect(screen.getByText("You stopped the check before any claims were found.")).toBeTruthy();
    expect(screen.queryByText(/No checkable claims were found/)).toBeNull();
  });

  it("still shows 'Waiting…' for unchecked claims while a check is running", () => {
    view(stateOf([claim(null, { text: "in the queue" })], "checking"));
    expect(within(screen.getByText("in the queue").closest("li")!).getByText("Waiting…")).toBeTruthy();
  });
});

describe("ResultsView verdict text", () => {
  it("shows an early-exit reason once, without repeating the general explanation", () => {
    view(
      stateOf([
        claim("cant_check", { reason: "The reference exists, but no uploaded source matches it. Upload the PDF to check this claim." }),
      ]),
    );
    expect(screen.getAllByText(/no uploaded source matches it/)).toHaveLength(1);
    expect(screen.queryByText(/no readable PDF of it was uploaded/)).toBeNull();
  });

  it("shows a judged verdict's reason and one short what-to-do line, with no general explanation", () => {
    view(stateOf([claim("contradicted", { reason: "The source says 5 percent.", quote: "five percent" })]));
    expect(screen.getByText("The source says 5 percent.")).toBeTruthy();
    expect(screen.getByText(/Change the sentence to match the source/)).toBeTruthy();
    expect(screen.queryByText(/the opposite, or gives a different value/)).toBeNull();
  });

  it("gives no upload-a-PDF advice when the real cause is an empty reference list", () => {
    view(
      stateOf([
        claim("reference_not_found", {
          reason: '"smith 2021" cannot be matched because no reference list was added. Paste your reference list and check again.',
        }),
      ]),
    );
    expect(screen.queryByText(/What to do:/)).toBeNull();
    expect(screen.queryByText(/mistyped/)).toBeNull();
  });

  it("tells the student to add the entry when a citation is not in their reference list", () => {
    view(stateOf([claim("reference_not_found", { reason: '"smith 2021" is not in your reference list.' })]));
    expect(screen.getByText(/Add it to your reference list/)).toBeTruthy();
    expect(screen.queryByText(/upload its PDF/)).toBeNull();
  });

  it("offers the upload advice when no online record and no upload matched", () => {
    view(
      stateOf([
        claim("reference_not_found", {
          reason: 'Reference 1 ("Kementerian Keuangan...") was not found in Crossref or OpenAlex, and none of your uploaded PDFs matches it.',
        }),
      ]),
    );
    expect(screen.getByText(/upload its PDF/)).toBeTruthy();
  });
});

describe("ResultsView evidence and copying", () => {
  it("shows the page in the evidence disclosure, open for Contradicted and Partly supported", () => {
    view(
      stateOf([
        claim("contradicted", { quote: "five percent", page: 4, reason: "r" }),
        claim("partial", { quote: "six percent", page: 5, reason: "r" }),
      ]),
    );
    expect(screen.getByText(/What your source says \(page 4\)/).closest("details")?.hasAttribute("open")).toBe(true);
    expect(screen.getByText(/What your source says \(page 5\)/).closest("details")?.hasAttribute("open")).toBe(true);
  });

  it("keeps the evidence closed for a Supported claim, and counts an open only when the student clicks", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([claim("supported", { quote: "five percent", page: 4 })]), onEvent);
    const summary = screen.getByText(/What your source says \(page 4\)/);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    expect(onEvent.mock.calls.filter(([name]) => name === "evidence_opened")).toHaveLength(0);
    await user.click(summary);
    expect(onEvent.mock.calls.filter(([name]) => name === "evidence_opened")).toHaveLength(1);
  });

  it("does not count a card that starts open as the student opening it", () => {
    const onEvent = vi.fn();
    view(stateOf([claim("contradicted", { quote: "five percent", page: 4, reason: "r" })]), onEvent);
    expect(onEvent.mock.calls.filter(([name]) => name === "evidence_opened")).toHaveLength(0);
  });

  it("tells the student when a suggested sentence could not be copied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    view(stateOf([claim("contradicted", { quote: "q", reason: "r", fixSuggestion: "Trade rose 5 percent." })]));
    await user.click(screen.getByRole("button", { name: "Copy sentence" }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  it("reports a copied sentence once, and only when the copy worked", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([claim("contradicted", { quote: "q", reason: "r", fixSuggestion: "Trade rose 5 percent." })]), onEvent);
    await user.click(screen.getByRole("button", { name: "Copy sentence" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(onEvent.mock.calls.filter(([name]) => name === "fix_accepted")).toHaveLength(1);
  });
});

describe("ResultsView after the scan", () => {
  const scanned = () =>
    stateOf(
      [
        claim("no_citation_given", { citation: null, reason: "The claim has no citation." }),
        claim("no_citation_given", { citation: null, reason: "The claim has no citation." }),
        claim("reference_not_found", { reason: '"Brown 2017" is not in your reference list.' }),
        claim(null),
        claim(null),
        claim(null),
      ],
      "scanned",
    );

  it("says the scan is complete and leads with the sentences that need a source", () => {
    view(scanned());
    expect(screen.getByText("Scan complete")).toBeTruthy();
    expect(screen.getByText("2 sentences need a source.")).toBeTruthy();
    expect(screen.getByText("1 cite something that is not in your reference list")).toBeTruthy();
    expect(screen.getByText("3 cited and ready to check")).toBeTruthy();
  });

  it("leaves out a line that has nothing in it, and uses the singular for one sentence", () => {
    view(stateOf([claim("no_citation_given", { citation: null }), claim(null)], "scanned"));
    expect(screen.getByText("1 sentence needs a source.")).toBeTruthy();
    expect(screen.queryByText(/could use one/)).toBeNull();
    expect(screen.queryByText(/not in your reference list/)).toBeNull();
    expect(screen.getByText("1 cited and ready to check")).toBeTruthy();
  });

  it("treats a general statement with no citation as a suggestion, not a problem", () => {
    view(stateOf([
      claim("no_citation_given", { citation: null }),
      claim("no_citation_given", { citation: null, need: "should" }),
      claim("no_citation_given", { citation: null, need: "should" }),
    ], "done"));
    // Nothing was checked against a source, so this is still a scan result, not "Check complete".
    expect(screen.getByText("Scan complete")).toBeTruthy();
    expect(screen.getByText("1 sentence needs a source.")).toBeTruthy();
    expect(screen.getByText("2 more could use one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs attention (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No citation \(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Could use a source (2)" })).toBeTruthy();
    expect(document.querySelectorAll(".claims > li")).toHaveLength(1); // the suggestions wait behind their own filter
  });

  it("shows a suggestion card as 'Could use a source', with softer advice", async () => {
    const user = userEvent.setup();
    view(stateOf([claim("no_citation_given", { citation: null, need: "should" }), claim("contradicted")], "done"));
    await user.click(screen.getByRole("button", { name: /^All \(2\)$/ }));
    expect(screen.getByText("Could use a source")).toBeTruthy();
    expect(screen.getByText("A source would make this stronger.")).toBeTruthy();
    // A source was looked at (Contradicted), so the usual tally is back.
    expect(screen.getByText("Check complete")).toBeTruthy();
  });

  it("calls a cited claim that has no verdict 'Not checked yet', not 'Waiting', and shows no progress bar", () => {
    view(scanned());
    expect(screen.getAllByText("Not checked yet")).toHaveLength(3);
    expect(screen.queryByText("Waiting…")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not show the 'need attention' tally until the check has finished", () => {
    view(scanned());
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
  });

  it("lists the claims that need a citation or a reference first, and the waiting ones too, under 'Needs attention'", () => {
    view(scanned());
    expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("claim"))).toHaveLength(6);
  });

  it("keeps the old summary once the check is done", () => {
    view(stateOf([claim("supported", { quote: "q", page: 1 }), claim("no_citation_given", { citation: null })], "done"));
    expect(screen.queryByText(/^Found \d+ claims?\.$/)).toBeNull();
    expect(screen.getAllByText("1 of 2 claims need attention.").length).toBeGreaterThan(0);
  });

  it("moves focus to the Results heading when the scan ends, and again when the check then ends", () => {
    const { rerender } = render(<ResultsView state={stateOf([claim(null)], "extracting")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<ResultsView state={stateOf([claim(null)], "scanned")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));

    // The student presses "Check 1 cited claim": that button leaves the page and focus falls to the body.
    (document.activeElement as HTMLElement).blur();
    rerender(<ResultsView state={stateOf([claim(null)], "checking")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    rerender(<ResultsView state={stateOf([claim("supported", { quote: "q", page: 1 })], "done")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });
});

describe("ResultsView focus", () => {
  it("moves focus to the Results heading when a check the student started finishes and focus was lost", () => {
    const { rerender } = render(<ResultsView state={stateOf([claim(null)], "checking")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<ResultsView state={stateOf([claim("supported")], "done")} focusWhenDone onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });

  it("does not take focus when a check is reopened after a reload, even though it passes through 'checking'", () => {
    const { rerender } = view(stateOf([claim(null)], "starting"));
    rerender(<ResultsView state={stateOf([claim("supported")], "done")} onRetryClaim={noop} onEvent={noop} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not take focus from something the student is using", () => {
    const { rerender } = render(
      <>
        <input aria-label="elsewhere" />
        <ResultsView state={stateOf([claim(null)], "checking")} focusWhenDone onRetryClaim={noop} onEvent={noop} />
      </>,
    );
    const input = screen.getByLabelText("elsewhere");
    input.focus();
    rerender(
      <>
        <input aria-label="elsewhere" />
        <ResultsView state={stateOf([claim("supported")], "done")} focusWhenDone onRetryClaim={noop} onEvent={noop} />
      </>,
    );
    expect(document.activeElement).toBe(input);
  });

  it("does not grab focus when a finished check is simply reopened", () => {
    view(stateOf([claim("supported")], "done"));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("ResultsView claim errors", () => {
  it("offers Try again for a claim that failed in the browser", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const failed = claim(null, { text: "unlucky claim" });
    render(
      <ResultsView
        state={{ ...stateOf([failed], "done"), claimErrors: { [failed.id]: "This claim could not be checked right now." } }}
        onRetryClaim={onRetry}
        onEvent={noop}
      />,
    );
    const card = screen.getByText("unlucky claim").closest("li")!;
    await user.click(within(card).getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith(failed.id);
  });
});

describe("ResultsView sections", () => {
  // A long draft: three sections, problems only in the second, more claims in it than one page holds.
  function longDraft() {
    const intro = Array.from({ length: 5 }, () => claim("supported", { section: "1. Introduction" }));
    const background = Array.from({ length: 25 }, () => claim("no_citation_given", { citation: null, section: "2. Background" }));
    const results = Array.from({ length: 3 }, () => claim("supported", { section: "4. Results" }));
    return [...intro, ...background, ...results];
  }

  it("groups claims under their headings, in the order of the draft, with a count on each", async () => {
    const user = userEvent.setup();
    view(stateOf(longDraft()));
    // "Needs attention" shows only the section with work in it.
    expect(screen.getAllByRole("button", { expanded: true }).map((b) => b.textContent)).toEqual(["▾2. Background25 need attention"]);
    await user.click(screen.getByRole("button", { name: /^All \(33\)$/ }));
    const heads = document.querySelectorAll(".section-head button");
    expect([...heads].map((b) => b.textContent)).toEqual([
      "▸1. Introduction5 claims",
      "▾2. Background25 need attention",
      "▸4. Results3 claims",
    ]);
  });

  it("opens the first section with work in it, and pages long sections 20 at a time", async () => {
    const user = userEvent.setup();
    view(stateOf(longDraft(), "done"));
    await user.click(screen.getByRole("button", { name: /^All \(33\)$/ }));
    const background = screen.getByRole("button", { name: /2\. Background/ });
    expect(background.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /1\. Introduction/ }).getAttribute("aria-expanded")).toBe("false");

    const region = document.getElementById(background.getAttribute("aria-controls")!)!;
    expect(within(region).getAllByRole("listitem")).toHaveLength(20);
    await user.click(within(region).getByRole("button", { name: "Show 5 more (5 left)" }));
    expect(within(region).getAllByRole("listitem")).toHaveLength(25);

    // A closed section opens on a press.
    const intro = screen.getByRole("button", { name: /1\. Introduction/ });
    await user.click(intro);
    expect(intro.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a short list without section rows when the draft has no headings", () => {
    view(stateOf([claim("contradicted"), claim("supported")]));
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("says when a claim takes the citation at the end of its paragraph", () => {
    view(stateOf([claim("supported", { citation: "(Lee & Park, 2021)", citationInherited: true, quote: "q", page: 2 })]));
    expect(screen.getByText("(Lee & Park, 2021) · from the end of its paragraph")).toBeTruthy();
  });

  it("names what was checked when the draft came from a link or a file", () => {
    render(<ResultsView state={stateOf([claim("supported")])} draftLabel="Google Doc" onRetryClaim={noop} onEvent={vi.fn()} />);
    expect(screen.getByText("Draft: Google Doc")).toBeTruthy();
  });
});

describe("ResultsView parts that were not read", () => {
  it("names each part the AI could not read, and reads it again on a press", async () => {
    const user = userEvent.setup();
    const onReadPart = vi.fn().mockResolvedValue(undefined);
    const state = { ...stateOf([claim("supported")], "scanned"), failedParts: [{ unit: 4, section: "3.2 Requirements" }, { unit: 0, section: null }] };
    render(<ResultsView state={state} onRetryClaim={noop} onReadPart={onReadPart} onEvent={vi.fn()} />);
    const group = screen.getByRole("group", { name: "The AI could not read 2 parts of your draft, so their claims are missing:" });
    expect(within(group).getByText("3.2 Requirements")).toBeTruthy();
    expect(within(group).getByText("Start of the draft")).toBeTruthy();
    await user.click(within(group).getAllByRole("button", { name: "Read again" })[0]!);
    expect(onReadPart).toHaveBeenCalledWith(4);
  });

  it("says nothing about unread parts while the scan is still running", () => {
    const state = { ...stateOf([claim(null)], "extracting"), failedParts: [{ unit: 1, section: null }] };
    view(state);
    expect(screen.queryByText(/could not read/)).toBeNull();
  });
});

describe("ResultsView claims with no known heading", () => {
  it("puts them last, as 'Other claims'", async () => {
    const user = userEvent.setup();
    view(stateOf([claim("supported", { section: null }), claim("supported", { section: "1. Introduction" }), claim("contradicted", { section: "2. Background" })]));
    await user.click(screen.getByRole("button", { name: /^All \(3\)$/ }));
    expect([...document.querySelectorAll(".section-name")].map((el) => el.textContent)).toEqual(["1. Introduction", "2. Background", "Other claims"]);
  });
});

describe("Find a source on a claim card", () => {
  const PAPER = {
    rank: 1,
    openalexId: "https://openalex.org/W1",
    doi: "https://doi.org/10.1/w1",
    title: "Flexible work in small firms",
    year: 2021,
    authors: ["Kim Lee", "Mei Tan"],
    venue: "Journal of Work",
    openAccessPdf: null,
    sentence: "Casual employment grew 18% between 2015 and 2020.",
    relevance: "direct" as const,
  };
  const uncited = (extra: Partial<ClaimView> = {}) => claim("no_citation_given", { citation: null, ...extra });
  const show = (claims: ClaimView[], onFindSources = vi.fn(), onEvent = vi.fn()) =>
    render(<ResultsView state={stateOf(claims)} onRetryClaim={noop} onEvent={onEvent} onFindSources={onFindSources} />);

  it("offers Find a source only on a No citation card", () => {
    show([uncited(), claim("contradicted", { quote: "q", page: 1 })]);
    expect(screen.getAllByRole("button", { name: "Find a source" })).toHaveLength(1);
  });

  it("says it is searching while it waits, then shows what the server found", async () => {
    const user = userEvent.setup();
    let finish: (value: string | null) => void = () => {};
    const onFind = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    show([uncited()], onFind);
    await user.click(screen.getByRole("button", { name: "Find a source" }));
    expect(onFind).toHaveBeenCalledWith("c" + n);
    expect(screen.getByRole("button", { name: "Searching for papers…" })).toHaveProperty("disabled", true);
    finish("The paper search is busy. Try again in a moment.");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The paper search is busy. Try again in a moment.");
    expect(screen.getByRole("button", { name: "Find a source" })).toHaveProperty("disabled", false);
  });

  it("shows found papers as unread leads, with a link out and copyable citations", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onEvent = vi.fn();
    show([uncited({ sourcesSearched: true, sources: [PAPER] })], vi.fn(), onEvent);

    expect(screen.getByText("Not read yet: open one and check it before you cite it.")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Flexible work in small firms/ });
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1/w1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toContain("(opens in a new tab)");
    expect(screen.getByText("Lee & Tan · 2021 · Journal of Work")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Find a source" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Copy in-text" }));
    expect(write).toHaveBeenLastCalledWith("(Lee & Tan, 2021)");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(write).toHaveBeenLastCalledWith("Lee, K., & Tan, M. (2021). Flexible work in small firms. Journal of Work. https://doi.org/10.1/w1");
    expect(onEvent).toHaveBeenCalledWith("source_copied", { kind: "in_text" });
    expect(onEvent).toHaveBeenCalledWith("source_copied", { kind: "reference" });
  });

  it("says plainly when no paper was found", () => {
    show([uncited({ sourcesSearched: true, sources: [] })]);
    expect(screen.getByText("No paper found. A product or company fact is best cited from its official page.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Find a source" })).toBeNull();
  });

  it("marks a paper that is only on the same topic", () => {
    show([uncited({ sourcesSearched: true, sources: [PAPER, { ...PAPER, rank: 2, relevance: "related", title: "Rostering in retail" }] })]);
    expect(screen.getAllByText("Same topic, not your exact claim")).toHaveLength(1);
  });
});

describe("shortQuote", () => {
  it("keeps a short sentence whole, and cuts a long one at a word with an ellipsis", () => {
    expect(shortQuote("Casual employment grew 18%.")).toBe("Casual employment grew 18%.");
    const long = `${"word ".repeat(80)}end.`;
    const cut = shortQuote(long);
    expect(cut.endsWith("word…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(241);
  });
});

describe("Check a claim against a found paper", () => {
  const PAPER = {
    rank: 1,
    openalexId: "https://openalex.org/W1",
    doi: "https://doi.org/10.1/w1",
    title: "Flexible work in small firms",
    year: 2021,
    authors: ["Kim Lee"],
    venue: null,
    openAccessPdf: "https://repo.example/w1.pdf",
    sentence: "Casual employment grew 18% between 2015 and 2020.",
    relevance: "direct" as const,
  };
  const card = (sources = [PAPER, { ...PAPER, rank: 2, openAccessPdf: null, title: "Paywalled study" }]) =>
    claim("no_citation_given", { citation: null, sourcesSearched: true, sources });

  it("offers a free-PDF check only where there is a free PDF, and an upload everywhere", () => {
    render(<ResultsView state={stateOf([card()])} onRetryClaim={noop} onEvent={vi.fn()} onFindSources={vi.fn()} onAttachSource={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Check my claim against it" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Upload its PDF" })).toHaveLength(2);
  });

  it("shows each stage while it works, and the message when it fails", async () => {
    const user = userEvent.setup();
    let finish: (value: string | null) => void = () => {};
    const onAttach = vi.fn((_c: string, _r: number, _t: string, _f: File | null, stage: (s: "getting" | "reading" | "checking") => void) => {
      stage("reading");
      return new Promise<string | null>((resolve) => (finish = resolve));
    });
    render(<ResultsView state={stateOf([card()])} onRetryClaim={noop} onEvent={vi.fn()} onFindSources={vi.fn()} onAttachSource={onAttach} />);
    await user.click(screen.getByRole("button", { name: "Check my claim against it" }));
    expect(onAttach.mock.calls[0]!.slice(1, 4)).toEqual([1, "Flexible work in small firms", null]);
    expect(screen.getByText("Reading the paper…")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Upload its PDF" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    finish("This paper could not be downloaded. Upload its PDF instead.");
    expect(await screen.findByText("This paper could not be downloaded. Upload its PDF instead.")).toBeTruthy();
  });

  it("sends an uploaded PDF for the paper it was chosen for", async () => {
    const user = userEvent.setup();
    const onAttach = vi.fn().mockResolvedValue(null);
    render(<ResultsView state={stateOf([card()])} onRetryClaim={noop} onEvent={vi.fn()} onFindSources={vi.fn()} onAttachSource={onAttach} />);
    await user.click(screen.getAllByRole("button", { name: "Upload its PDF" })[1]!);
    const file = new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" });
    await user.upload(document.querySelector('.found input[type="file"]') as HTMLInputElement, file);
    expect(onAttach.mock.calls[0]!.slice(1, 4)).toEqual([2, "Paywalled study", file]);
  });

  it("marks a claim checked against a paper found here, so the student knows the draft still lacks it", () => {
    render(<ResultsView state={stateOf([claim("supported", { citation: "(Lee, 2021)", citationSource: "found", quote: "q", page: 3 })])} onRetryClaim={noop} onEvent={vi.fn()} />);
    expect(screen.getByText("Found here: not in your draft yet")).toBeTruthy();
  });
});
