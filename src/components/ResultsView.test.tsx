// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankFixList } from "@/lib/fix-list";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { countVerdicts, initialState, type Phase, type VerifierState } from "@/lib/client/verifier-state";
import { ResultsView } from "./ResultsView";

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

  it("still shows the general explanation for a judged verdict", () => {
    view(stateOf([claim("contradicted", { reason: "The source says 5 percent.", quote: "five percent" })]));
    expect(screen.getByText(/the opposite, or gives a different value/)).toBeTruthy();
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
    expect(screen.getByText(/Add this reference to your reference list/)).toBeTruthy();
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
  it("shows the page in the evidence disclosure and starts it closed", () => {
    view(stateOf([claim("contradicted", { quote: "five percent", page: 4, reason: "r" })]));
    const summary = screen.getByText(/What your source says \(page 4\)/);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
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
