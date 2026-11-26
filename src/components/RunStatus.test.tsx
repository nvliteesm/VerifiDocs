// @vitest-environment jsdom
// The strip above the workspace: progress, the scan summary, the tally, a stopped check, unread parts, focus.
// Ported from the old ResultsView tests (25 Nov 2026), which covered the same behaviour in the card list.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankFixList } from "@/lib/fix-list";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { countVerdicts, initialState, type Phase, type VerifierState } from "@/lib/client/verifier-state";
import { RunStatus } from "./RunStatus";

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
  return { ...initialState, phase, runId: "run-1", claims, counts: countVerdicts(claims), fixList: rankFixList(claims).map((c) => c.id) };
}

const view = (state: VerifierState, props: { focusWhenDone?: boolean; onReadPart?: (unit: number) => Promise<void> } = {}) =>
  render(<RunStatus state={state} focusWhenDone={props.focusWhenDone ?? false} onReadPart={props.onReadPart} />);

describe("the scan summary", () => {
  const scanned = () =>
    stateOf(
      [
        claim("no_citation_given", { citation: null }),
        claim("no_citation_given", { citation: null }),
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

  it("leads with the citation that is not in the list, not with an all-clear", () => {
    view(stateOf([claim("reference_not_found", { reason: '"Brown 2017" is not in your reference list.' }), claim(null)], "scanned"));
    expect(screen.getByText("1 citation is not in your reference list.")).toBeTruthy();
    expect(screen.queryByText("No sentence is missing a source it needs.")).toBeNull();
    expect(screen.getByText("1 cited and ready to check")).toBeTruthy();
  });

  it("still says nothing is missing when nothing is", () => {
    view(stateOf([claim(null), claim(null)], "scanned"));
    expect(screen.getByText("No sentence is missing a source it needs.")).toBeTruthy();
  });

  it("leaves out a line that has nothing in it, and uses the singular for one sentence", () => {
    view(stateOf([claim("no_citation_given", { citation: null }), claim(null)], "scanned"));
    expect(screen.getByText("1 sentence needs a source.")).toBeTruthy();
    expect(screen.queryByText(/could use one/)).toBeNull();
    expect(screen.queryByText(/not in your reference list/)).toBeNull();
  });

  it("treats a general statement with no citation as a suggestion, and keeps it a scan result", () => {
    view(
      stateOf(
        [claim("no_citation_given", { citation: null }), claim("no_citation_given", { citation: null, need: "should" }), claim("no_citation_given", { citation: null, need: "should" })],
        "done",
      ),
    );
    // Nothing was checked against a source, so this is still a scan result, not "Check complete".
    expect(screen.getByText("Scan complete")).toBeTruthy();
    expect(screen.getByText("1 sentence needs a source.")).toBeTruthy();
    expect(screen.getByText("2 more could use one")).toBeTruthy();
  });

  it("shows no progress bar and no 'need attention' tally until the check has finished", () => {
    view(scanned());
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
  });
});

describe("the tally", () => {
  it("uses the singular for one claim, and the plural for several", () => {
    const { unmount } = view(stateOf([claim("contradicted", { quote: "q", reason: "r" })]));
    expect(screen.getAllByText("1 of 1 claim needs attention.").length).toBeGreaterThan(0);
    unmount();
    view(stateOf([claim("contradicted"), claim("supported"), claim("not_in_sources")]));
    expect(screen.getAllByText("2 of 3 claims need attention.").length).toBeGreaterThan(0);
  });

  it("is read aloud and kept out of the way: the stats line in the workspace says it in numbers", () => {
    view(stateOf([claim("contradicted")]));
    expect(screen.getByText("1 of 1 claim needs attention.").className).toContain("sr-only");
  });

  it("is not shown while claims are still being checked, when the progress bar is", () => {
    view(stateOf([claim(null), claim(null)], "checking"));
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("announces the outcome in a status region that stays on the page", () => {
    view(stateOf([claim("supported")]));
    expect(screen.getByRole("status").textContent).toContain("Every checked claim is supported.");
  });

  it("keeps 'Check complete' for screen readers, and shows the eyebrow when the check stopped", () => {
    const { unmount } = view(stateOf([claim("contradicted", { quote: "q", reason: "r" })]));
    expect(screen.getByText("Check complete").className).toContain("sr-only");
    unmount();
    view({ ...stateOf([claim("contradicted", { quote: "q", reason: "r" })]), stopped: true });
    expect(screen.getByText("Check stopped by you").className).not.toContain("sr-only");
  });

  it("names a wrong year by its citation, once per reference, even for a supported claim", () => {
    const yearNotes = [{ position: 9, cited: 2015, published: 2013 }];
    view(stateOf([claim("supported", { citation: "(Mikolov et al., 2015)", yearNotes }), claim("partial", { citation: "(Mikolov et al., 2015)", yearNotes })]));
    expect(screen.getAllByText("Wrong year in your list: (Mikolov et al., 2015), published 2013.")).toHaveLength(1);
  });

  it("shows no year line when no year is off", () => {
    view(stateOf([claim("supported"), claim("contradicted")]));
    expect(screen.queryByText(/Wrong year/)).toBeNull();
  });
});

describe("when the student stopped the check", () => {
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

  it("explains a stop before any claims were found, instead of 'no checkable claims'", () => {
    view(stopped([]));
    expect(screen.getByText("You stopped the check before any claims were found.")).toBeTruthy();
    expect(screen.queryByText(/No checkable claims were found/)).toBeNull();
  });
});

describe("parts of the draft that were not read", () => {
  it("names each part the AI could not read, and reads it again on a press", async () => {
    const user = userEvent.setup();
    const onReadPart = vi.fn().mockResolvedValue(undefined);
    const state = { ...stateOf([claim("supported")], "scanned"), failedParts: [{ unit: 4, section: "3.2 Requirements" }, { unit: 0, section: null }] };
    view(state, { onReadPart });
    const group = screen.getByRole("group", { name: "The AI could not read 2 parts of your draft, so their claims are missing:" });
    expect(within(group).getByText("3.2 Requirements")).toBeTruthy();
    expect(within(group).getByText("Start of the draft")).toBeTruthy();
    await user.click(within(group).getAllByRole("button", { name: "Read again" })[0]!);
    expect(onReadPart).toHaveBeenCalledWith(4);
  });

  it("says nothing about unread parts while the scan is still running", () => {
    view({ ...stateOf([claim(null)], "extracting"), failedParts: [{ unit: 1, section: null }] });
    expect(screen.queryByText(/could not read/)).toBeNull();
  });
});

describe("where focus goes", () => {
  it("moves to the Results heading when the scan ends, and again when the check then ends", () => {
    const { rerender } = render(<RunStatus state={stateOf([claim(null)], "extracting")} focusWhenDone />);
    expect(document.activeElement).toBe(document.body);
    rerender(<RunStatus state={stateOf([claim(null)], "scanned")} focusWhenDone />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));

    // The student presses "Check 1 cited claim": that button leaves the page and focus falls to the body.
    (document.activeElement as HTMLElement).blur();
    rerender(<RunStatus state={stateOf([claim(null)], "checking")} focusWhenDone />);
    rerender(<RunStatus state={stateOf([claim("supported", { quote: "q", page: 1 })], "done")} focusWhenDone />);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });

  it("does not take focus when a check is reopened after a reload, even though it passes through 'checking'", () => {
    const { rerender } = view(stateOf([claim(null)], "starting"));
    rerender(<RunStatus state={stateOf([claim("supported")], "done")} focusWhenDone={false} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not take focus from something the student is using", () => {
    const { rerender } = render(
      <>
        <input aria-label="elsewhere" />
        <RunStatus state={stateOf([claim(null)], "checking")} focusWhenDone />
      </>,
    );
    const input = screen.getByLabelText("elsewhere");
    input.focus();
    rerender(
      <>
        <input aria-label="elsewhere" />
        <RunStatus state={stateOf([claim("supported")], "done")} focusWhenDone />
      </>,
    );
    expect(document.activeElement).toBe(input);
  });

  it("does not grab focus when a finished check is simply reopened", () => {
    view(stateOf([claim("supported")], "done"));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the stages of a run", () => {
  it("lists the real stages while the claims are being checked, with the real count and no percentage", () => {
    const claims = [claim("supported"), claim(null), claim(null)];
    view(stateOf(claims, "checking"));
    const stages = [...document.querySelectorAll(".stages li")];
    expect(stages.map((li) => [li.textContent?.trim(), (li as HTMLElement).dataset.status])).toEqual([
      ["Document read", "done"],
      ["Finding claims", "done"],
      ["Checking claims 1/3", "active"],
      ["Results", "todo"],
    ]);
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
  });

  it("marks Finding claims as the active stage while the draft is being read", () => {
    view({ ...initialState, phase: "extracting", runId: "r" });
    const active = document.querySelector('.stages li[data-status="active"]');
    expect(active?.textContent).toContain("Finding claims");
  });
});
