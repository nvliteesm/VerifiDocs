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
  it("remembers a flagged claim after the filter changes, so it cannot be flagged twice", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    view(stateOf([claim("contradicted", { text: "wrong one" }), claim("supported", { text: "fine one" })]), onEvent);

    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.getByRole("button", { name: "Thanks, noted" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.click(screen.getByRole("button", { name: /^Needs attention/ }));

    const flagged = screen.getByRole("button", { name: "Thanks, noted" });
    expect(flagged).toHaveProperty("disabled", true);
    await user.click(flagged);
    expect(onEvent.mock.calls.filter(([name]) => name === "verdict_flagged_wrong")).toHaveLength(1);
  });

  it("flags only the claim that was clicked", async () => {
    const user = userEvent.setup();
    view(stateOf([claim("contradicted", { text: "first" }), claim("not_in_sources", { text: "second" })]));
    const buttons = screen.getAllByRole("button", { name: "This verdict is wrong" });
    await user.click(buttons[0]!);
    expect(screen.getAllByRole("button", { name: "This verdict is wrong" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Thanks, noted" })).toHaveLength(1);
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
