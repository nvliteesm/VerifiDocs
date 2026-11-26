// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rankFixList } from "@/lib/fix-list";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { countVerdicts, initialState, type Phase, type VerifierState } from "@/lib/client/verifier-state";
import { Workspace } from "./Workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let n = 0;
function claim(text: string, verdict: Verdict | null, extra: Partial<ClaimView> = {}): ClaimView {
  n += 1;
  return {
    id: `c${n}`,
    position: n,
    text,
    citation: "(Stats Office, 2024)",
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

const noop = () => {};
function view(state: VerifierState, draftText: string | null, onEvent = vi.fn()) {
  render(<Workspace state={state} draftText={draftText} draftLabel="brief.txt" focusWhenDone={false} sources={null} actions={null} onRetryClaim={noop} onEvent={onEvent} />);
  return onEvent;
}
/** The sentence in the draft (the claim list has a row with the same words). */
const sentence = (text: RegExp | string) => screen.getAllByRole("button", { name: text }).find((button) => button.classList.contains("hl"))!;

/** Two claims in one pasted draft: a wrong number (with a fix), and a supported one. */
function twoClaims() {
  const wrong = claim("Subsidies dropped by 18% in 2023.", "contradicted", {
    quote: "Subsidy reduction remains at 8% as of Dec 2023.",
    page: 4,
    sourceFile: "Stats-Office-2024.pdf",
    reason: "The source gives a different figure.",
    fixSuggestion: "Subsidies dropped by 8% in 2023.",
  });
  const fine = claim("Inflation was 3.2% in Q4.", "supported", { quote: "Inflation was 3.2% in Q4.", page: 2 });
  const draft = `Intro.\n\n${wrong.text} Then ${fine.text}\n\nEnd.`;
  return { wrong, fine, draft };
}

describe("the draft canvas", () => {
  it("shows the whole draft with each claim sentence as a button tagged C-n, and the title names the file", () => {
    const { wrong, fine, draft } = twoClaims();
    view(stateOf([wrong, fine]), draft);
    expect(screen.getByRole("heading", { name: "brief.txt" })).toBeTruthy();
    expect(screen.getByText(/Intro\./)).toBeTruthy();
    expect(sentence(/Subsidies dropped by 18%/).textContent).toContain("C-1");
    expect(sentence(/Inflation was 3.2%/).textContent).toContain("C-2");
  });

  it("starts with nothing selected, and says what to do", () => {
    const { wrong, fine, draft } = twoClaims();
    view(stateOf([wrong, fine]), draft);
    expect(screen.getByText("Select a sentence in the draft to see its check.")).toBeTruthy();
  });

  it("underlines by status with a plain-text cue for screen readers, not colour alone", () => {
    const { wrong, fine, draft } = twoClaims();
    view(stateOf([wrong, fine]), draft);
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("v-contradicted");
    expect(sentence(/Inflation was 3.2%/).className).toContain("v-supported");
    expect(within(sentence(/Subsidies dropped by 18%/)).getByText("(Contradicted)")).toBeTruthy();
  });
});

describe("the claim inspector", () => {
  it("fills with the claim that was pressed: verdict, the draft sentence against the source quote, file and page", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    const onEvent = view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    const inspector = screen.getByRole("complementary", { name: "Claim inspector" });
    expect(inspector.querySelector(".insp .badge")?.textContent).toBe("Contradicted"); // the pill: icon, label and colour
    expect(within(inspector).getByText("The source gives a different figure.")).toBeTruthy();
    // The sentence is kept in the card (hidden while Before shows it), with the differing number marked.
    expect(inspector.querySelector(".insp-sentence")?.textContent).toBe("Subsidies dropped by 18% in 2023.");
    expect(inspector.querySelector(".ba-before")?.textContent).toBe("Subsidies dropped by 18% in 2023.");
    expect(inspector.querySelector(".ba-after")?.textContent).toBe("Subsidies dropped by 8% in 2023.");
    expect(inspector.querySelector(".wd-old")?.textContent).toBe("18%");
    expect(inspector.querySelector(".wd-new")?.textContent).toBe("8%");
    // With a suggested fix, the reason line is enough: the general meaning and "What to do" are left out.
    expect(within(inspector).queryByText("The source says something different.")).toBeNull();
    expect(within(inspector).getByText(/Subsidy reduction remains at/)).toBeTruthy();
    expect(within(inspector).getAllByText("Stats-Office-2024.pdf").length).toBeGreaterThan(0); // in the properties row and the evidence header
    expect(within(inspector).getAllByText("p. 4").length).toBeGreaterThan(0);
    expect(sentence(/Subsidies dropped by 18%/).getAttribute("aria-current")).toBe("true");
    expect(onEvent).toHaveBeenCalledWith("evidence_opened", { verdict: "contradicted" });
  });

  it("names the one number a fix changes", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(screen.getByText("Change 18% to 8%")).toBeTruthy();
  });

  it("offers no fix on a supported claim", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Inflation was 3.2%/));
    expect(screen.queryByRole("button", { name: "Apply fix" })).toBeNull();
  });

  it("sends the verdict and the chosen reason when the student says it is wrong", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    const onEvent = view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    await user.click(screen.getAllByRole("button").find((b) => b.closest(".flag-reasons") && b.className.includes("chip"))!);
    expect(onEvent).toHaveBeenCalledWith("verdict_flagged_wrong", expect.objectContaining({ verdict: "contradicted" }));
  });
});

describe("applying a fix", () => {
  it("puts the suggested sentence in the draft, moves on, and the undo line brings the old one back", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    const onEvent = view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));

    expect(onEvent).toHaveBeenCalledWith("fix_accepted");
    // The panel has moved on (here to the done state, the only issue being handled) and says what happened.
    expect(screen.getByText("Fix applied to C-1.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText("Fix applied to C-1.").closest(".last-action"));
    const applied = sentence(/Subsidies dropped by 8%/);
    expect(applied.className).toContain("hl-applied");
    expect(applied.querySelector("ins")?.textContent).toBe("Subsidies dropped by 8% in 2023.");

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("v-contradicted");
    expect(screen.getByRole("button", { name: "Apply fix" })).toBeTruthy(); // back on the claim
  });
  it("copies the draft with the fix in it, and the rest of the text untouched", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getAllByRole("button", { name: "Copy fixed draft" })[0]!);
    expect(await navigator.clipboard.readText()).toBe(draft.replace("18%", "8%"));
    expect(screen.getAllByRole("button", { name: "Copied" }).length).toBeGreaterThan(0);
  });

  it("fits the fix to its place when the claim sentence stops before its own citation and full stop", async () => {
    const fell = claim("Food prices fell during the same year", "contradicted", { fixSuggestion: "Food prices rose by 7.1 percent in 2023." });
    const draft = "Spending rose. Food prices fell during the same year (Stats Office, 2024). Rent is high.";
    const user = userEvent.setup();
    view(stateOf([fell]), draft);
    await user.click(sentence(/Food prices fell/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getAllByRole("button", { name: "Copy fixed draft" })[0]!);
    expect(await navigator.clipboard.readText()).toBe("Spending rose. Food prices rose by 7.1 percent in 2023 (Stats Office, 2024). Rent is high.");
  });

  it("says so when the draft could not be copied", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("button", { name: "Copy fixed draft" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("lets the student ignore a claim, says so, and undo that", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(screen.getByText("C-1 ignored.")).toBeTruthy();
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("hl-ignored");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("v-contradicted");
  });
});

describe("moving between issues", () => {
  function three() {
    const a = claim("Alpha is 1%.", "contradicted", { fixSuggestion: "Alpha is 2%." });
    const ok = claim("Beta holds.", "supported");
    const c = claim("Gamma is 5%.", "partial", { fixSuggestion: "Gamma is 6%." });
    return { a, ok, c, draft: `${a.text} ${ok.text} ${c.text}` };
  }

  it("steps through the open issues in draft order, skips supported claims, wraps round, and says where it is", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    view(stateOf([a, ok, c]), draft);
    const inspector = () => screen.getByRole("complementary", { name: "Claim inspector" });

    await user.click(within(inspector()).getByRole("button", { name: "Next issue" }));
    expect(sentence(/Alpha is 1%/).getAttribute("aria-current")).toBe("true");
    expect(within(inspector()).getByText("1 of 2")).toBeTruthy();
    await user.click(within(inspector()).getByRole("button", { name: "Next issue" }));
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
    await user.click(within(inspector()).getByRole("button", { name: "Next issue" }));
    expect(sentence(/Alpha is 1%/).getAttribute("aria-current")).toBe("true");
    await user.click(within(inspector()).getByRole("button", { name: "Previous issue" }));
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
  });

  it("carries on to the next issue after a fix is applied, and leaves it out of the count", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    view(stateOf([a, ok, c]), draft);
    await user.click(sentence(/Alpha is 1%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(within(screen.getByRole("complementary", { name: "Claim inspector" })).getByRole("button", { name: "Next issue" }));
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });

  it("disables the canvas 'Next issue' when nothing is open", () => {
    const ok = claim("Beta holds.", "supported");
    view(stateOf([ok]), "Beta holds.");
    const buttons = screen.getAllByRole("button", { name: "Next issue" });
    expect(buttons.some((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("filters", () => {
  it("lists the verdicts that are present with a count each, and mutes the sentences a filter leaves out", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const filters = within(screen.getByRole("group", { name: "Filter claims" }));
    expect(filters.getByRole("button", { name: /^All claims\s*2$/ })).toBeTruthy();
    expect(filters.getByRole("button", { name: /^Contradicted\s*1$/ })).toBeTruthy();
    expect(filters.getByRole("button", { name: /^Supported\s*1$/ })).toBeTruthy();
    expect(filters.queryByRole("button", { name: /^Partly/ })).toBeNull(); // no such claim

    await user.click(filters.getByRole("button", { name: /^Supported/ }));
    expect(filters.getByRole("button", { name: /^Supported/ }).getAttribute("aria-pressed")).toBe("true");
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("hl-muted");
    expect(sentence(/Inflation was 3.2%/).className).not.toContain("hl-muted");
  });
});

describe("the stats line", () => {
  it("says the outcome in one line, and counts down as fixes are applied", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const line = () => document.querySelector(".result-line")?.textContent ?? "";
    expect(line()).toBe("1 to fix, 1 supported.");
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    expect(line()).toBe("0 left to fix, 1 handled.");
    expect(screen.getByRole("img", { name: "Verdicts across the draft" })).toBeTruthy();
  });
});

describe("the claim list", () => {
  function pair() {
    const partial = claim("Gamma is 5%.", "partial", { page: 3, fixSuggestion: "Gamma is 6%." });
    const contradicted = claim("Alpha is 1%.", "contradicted", { page: 2, fixSuggestion: "Alpha is 2%." });
    return { partial, contradicted, draft: `${partial.text} ${contradicted.text}` };
  }
  const rows = () => [...document.querySelectorAll(".cl-row")] as HTMLElement[];

  it("groups the claims by verdict, most serious group first, each group with its count", () => {
    const { partial, contradicted, draft } = pair();
    const fine = claim("Beta holds.", "supported");
    view(stateOf([partial, fine, contradicted]), `${draft} ${fine.text}`);
    const heads = [...document.querySelectorAll(".cl-head")].map((head) => head.textContent);
    expect(heads).toEqual(["Contradicted1", "Partly supported1", "Supported1"]);
    expect(rows().map((row) => row.querySelector(".cl-id")?.textContent)).toEqual(["C-2", "C-1", "C-3"]);
    expect(rows()[0]!.querySelector(".cl-page")?.textContent).toBe("p.\u00a02");
  });

  it("selects the claim when a row is pressed, in the draft and below", async () => {
    const { partial, contradicted, draft } = pair();
    const user = userEvent.setup();
    view(stateOf([partial, contradicted]), draft);
    await user.click(rows()[1]!); // the partly supported one
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Apply fix" })).toBeTruthy();
  });

  it("keeps a claim in the list once it is resolved, shown as done, and drops it from the count", async () => {
    const { partial, contradicted, draft } = pair();
    const user = userEvent.setup();
    view(stateOf([partial, contradicted]), draft);
    for (const text of [/Alpha is 1%/, /Gamma is 5%/]) {
      await user.click(sentence(text));
      await user.click(screen.getByRole("button", { name: "Apply fix" }));
    }
    expect(document.querySelectorAll(".cl-done")).toHaveLength(2);
    expect(document.querySelector(".result-line")?.textContent).toBe("0 left to fix, 2 handled.");
  });

  it("lists only what the filter keeps, and says so when nothing matches", async () => {
    const { partial, contradicted, draft } = pair();
    const user = userEvent.setup();
    view(stateOf([partial, contradicted]), draft);
    const filters = within(screen.getByRole("group", { name: "Filter claims" }));
    await user.click(filters.getByRole("button", { name: /^Contradicted/ }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector(".cl-id")?.textContent).toBe("C-2");
  });
});

describe("a draft the browser does not have", () => {
  it("rebuilds it from the checked sentences, says so, and still applies fixes", async () => {
    const { wrong, fine } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), null);
    expect(screen.getByText(/These are the checked sentences, in order/)).toBeTruthy();
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getAllByRole("button", { name: "Copy fixed draft" })[0]!);
    expect(await navigator.clipboard.readText()).toBe("Subsidies dropped by 8% in 2023. Inflation was 3.2% in Q4.");
  });

  it("lists a sentence it cannot find in the text apart, and offers to copy its fix instead of applying it", async () => {
    const { wrong, fine } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), "A draft that no longer holds either sentence.");
    expect(screen.getByRole("heading", { name: "Not found in the text" })).toBeTruthy();
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(screen.queryByRole("button", { name: "Apply fix" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy sentence" })).toBeTruthy();
  });
});

describe("the review sheet and the sources drawer", () => {
  it("opens the claim as a sheet when a sentence is pressed, and closes it again", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const ws = document.querySelector(".ws") as HTMLElement;
    expect(ws.dataset.sheet).toBe("closed");
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(ws.dataset.sheet).toBe("open");
    await user.click(screen.getByRole("button", { name: "Close this issue" }));
    expect(ws.dataset.sheet).toBe("closed");
    expect(screen.getByText("Select a sentence in the draft to see its check.")).toBeTruthy();
  });

  it("keeps the sources drawer closed until asked, closes with Escape, and gives focus back to its button", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const toggle = screen.getByRole("button", { name: "Show sources" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect((document.querySelector(".ws-grid") as HTMLElement).dataset.side).toBe("closed");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide sources" }).getAttribute("aria-expanded")).toBe("true");
    expect((document.querySelector(".ws-grid") as HTMLElement).dataset.side).toBe("open");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.keyboard("{Escape}");
    expect((document.querySelector(".ws-grid") as HTMLElement).dataset.side).toBe("closed");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show sources" }));
  });
});

describe("the journey (DESIGN.md 4b)", () => {
  function three() {
    const a = claim("Alpha is 1%.", "contradicted", { fixSuggestion: "Alpha is 2%." });
    const ok = claim("Beta holds.", "supported");
    const c = claim("Gamma is 5%.", "partial", { fixSuggestion: "Gamma is 6%." });
    return { a, ok, c, draft: `${a.text} ${ok.text} ${c.text}` };
  }

  it("opens the most serious issue by itself when a check the student started ends", () => {
    const { a, ok, c, draft } = three();
    const props = { draftText: draft, draftLabel: null, focusWhenDone: true, sources: null, actions: null, onRetryClaim: () => {}, onEvent: vi.fn() };
    const { rerender } = render(<Workspace state={stateOf([{ ...a, verdict: null }, { ...ok, verdict: null }, { ...c, verdict: null }], "checking")} {...props} />);
    expect(screen.getByText("Select a sentence in the draft to see its check.")).toBeTruthy();
    rerender(<Workspace state={stateOf([a, ok, c])} {...props} />);
    expect(sentence(/Alpha is 1%/).getAttribute("aria-current")).toBe("true"); // contradicted outranks partly supported
  });

  it("does not open anything by itself when a finished check is reopened", () => {
    const { a, ok, c, draft } = three();
    render(<Workspace state={stateOf([a, ok, c])} draftText={draft} draftLabel={null} focusWhenDone={false} sources={null} actions={null} onRetryClaim={() => {}} onEvent={vi.fn()} />);
    expect(screen.getByText("Select a sentence in the draft to see its check.")).toBeTruthy();
  });

  it("moves to the next issue after Apply fix, keeping the way back", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    view(stateOf([a, ok, c]), draft);
    await user.click(sentence(/Alpha is 1%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Fix applied to C-1.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("ends in a done state that offers the fixed draft first, and the pay question", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    render(
      <Workspace state={stateOf([a, ok, c])} draftText={draft} draftLabel={null} focusWhenDone={false} sources={null} actions={null} onRetryClaim={() => {}} onEvent={vi.fn()} onCopyReport={vi.fn()} survey={<p>Would you pay?</p>} />,
    );
    await user.click(sentence(/Alpha is 1%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(screen.getByText("All 2 handled. Copy your fixed draft to use it.")).toBeTruthy();
    const done = document.querySelector(".done") as HTMLElement;
    expect(within(done).getByRole("button", { name: "Copy fixed draft" }).className).toContain("btn-primary");
    expect(within(done).getByRole("button", { name: "Copy report" })).toBeTruthy();
    expect(within(done).getByText("Would you pay?")).toBeTruthy();
  });

  it("moves focus to the done headline when the last issue is handled in this visit, so it is not lost", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    render(<Workspace state={stateOf([a, ok, c])} draftText={draft} draftLabel={null} focusWhenDone sources={null} actions={null} onRetryClaim={() => {}} onEvent={vi.fn()} />);
    await user.click(sentence(/Alpha is 1%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    expect(document.activeElement).toBe(document.getElementById("done-title"));
  });

  it("makes everything behind the sources drawer inert while it is open, and live again when it closes", async () => {
    const { a, ok, c, draft } = three();
    const user = userEvent.setup();
    view(stateOf([a, ok, c]), draft);
    await user.click(screen.getByRole("button", { name: "Show sources" }));
    const behind = () => [".top", ".ws-bar", ".pane-draft", ".pane-review"].map((selector) => (document.querySelector(selector) as HTMLElement | null)?.inert);
    expect(behind().filter((flag) => flag !== undefined).every(Boolean)).toBe(true);
    await user.keyboard("{Escape}");
    expect(behind().some(Boolean)).toBe(false);
  });

  it("keeps the student's draft on screen while it is being read", () => {
    render(<Workspace state={{ ...initialState, phase: "extracting", runId: "r" }} draftText="My pasted draft about prices." draftLabel={null} focusWhenDone sources={null} actions={null} onRetryClaim={() => {}} onEvent={vi.fn()} />);
    expect(screen.getByText("My pasted draft about prices.")).toBeTruthy();
    expect(screen.getByText("Finding the claims in your draft...")).toBeTruthy();
  });
});

describe("coverage: what could be checked, before any count of problems", () => {
  const draftOf = (...texts: string[]) => texts.join(" ");

  it("with no sources, says the paper has been reviewed but not verified, and offers to add sources, instead of an issue count", async () => {
    const a = claim("Alpha is 1%.", "cant_check");
    const b = claim("Beta is 2%.", "reference_not_found");
    const c = claim("Gamma holds.", "no_citation_given", { need: "must" });
    const user = userEvent.setup();
    view(stateOf([a, b, c], "scanned"), draftOf(a.text, b.text, c.text));
    expect(screen.getByText("Your paper has been reviewed, but we couldn't verify its claims because the original sources haven't been added yet.")).toBeTruthy();
    expect(document.querySelector(".result-line")?.textContent).not.toMatch(/to fix/);
    const cta = screen.getByRole("button", { name: "Add missing sources" });
    expect(cta.className).toContain("btn-primary");
    await user.click(cta);
    expect((document.querySelector(".ws-grid") as HTMLElement).dataset.side).toBe("open");
  });

  it("shows how the claims divide, without double counting, using words and numbers as well as colour", () => {
    const claims = [
      claim("One.", "supported"), claim("Two.", "contradicted"), claim("Three.", "reference_not_found"), claim("Four.", "cant_check"), claim("Five.", "cant_check"),
    ];
    view(stateOf(claims, "done"), draftOf(...claims.map((c) => c.text)));
    const items = [...document.querySelectorAll(".cov-legend li")].map((li) => li.textContent);
    expect(items).toEqual(["Supported1", "To review1", "Citations to fix1", "Waiting for sources2"]);
    expect(document.querySelector(".result-line")?.textContent).toBe("2 of 5 claims are checked against your sources. 2 are waiting for more sources.");
    // The primary action is not shown when some claims were already checked.
    expect(screen.getByRole("button", { name: "Add missing sources" }).className).not.toContain("btn-primary");
  });

  it("keeps the plain count-down line when nothing is waiting for a source", () => {
    const a = claim("Alpha is 1%.", "contradicted", { fixSuggestion: "Alpha is 2%." });
    const ok = claim("Beta holds.", "supported");
    view(stateOf([a, ok]), draftOf(a.text, ok.text));
    expect(document.querySelector(".result-line")?.textContent).toBe("1 to fix, 1 supported.");
    expect(screen.queryByRole("button", { name: "Add missing sources" })).toBeNull();
  });
});

describe("a long list of findings (Start here, grouping, filters)", () => {
  /** One confirmed problem, one citation missing from the list in six places, and two more findings in two sections. */
  function many() {
    const bad = claim("Subsidies fell 18%.", "contradicted", { section: "2. Hasil", quote: "8%", page: 4, sourceFile: "s.pdf", fixSuggestion: "Subsidies fell 8%." });
    const missing = [1, 2, 3, 4, 5, 6].map((k) => claim(`Darmono says thing ${k}.`, "reference_not_found", { citation: "(Darmono, 2016)", section: "1. Latar Belakang", reason: '"Darmono 2016" is not in your reference list.' }));
    const unclear = claim("Usage peaked in 2020.", "cant_tell", { section: "2. Hasil" });
    const uncited = claim("Mining harms the land.", "no_citation_given", { need: "must", citation: null, section: "1. Latar Belakang" });
    const claims = [bad, ...missing, unclear, uncited];
    return { claims, draft: claims.map((c) => c.text).join(" ") };
  }

  it("shows the few findings to start on, repeats already grouped, the confirmed problem first, and says how many more there are", () => {
    const { claims, draft } = many();
    view(stateOf(claims), draft);
    const section = screen.getByRole("region", { name: "Start here" });
    const items = [...section.querySelectorAll(".start-item")].map((li) => li.textContent);
    expect(items).toHaveLength(4); // contradicted, Darmono x6, cant_tell, no citation
    expect(items[0]).toContain("Subsidies fell 18%.");
    expect(items[1]).toContain("Darmono, 2016");
    expect(items[1]).toContain("6 places");
    expect(items.some((text) => text?.includes("Usage peaked"))).toBe(true);
  });

  it("does not drop the student into the first issue when a finished check has more than five findings", () => {
    const { claims, draft } = many();
    const props = { draftText: draft, draftLabel: null, focusWhenDone: true, sources: null, actions: null, onRetryClaim: () => {}, onEvent: vi.fn() };
    const checking = claims.map((c) => ({ ...c, verdict: null as Verdict | null }));
    const { rerender } = render(<Workspace state={stateOf(checking, "checking")} {...props} />);
    rerender(<Workspace state={stateOf(claims)} {...props} />);
    expect(document.querySelector('.hl[aria-current="true"]')).toBeNull();
    expect(screen.getByRole("region", { name: "Start here" })).toBeTruthy();
  });

  it("reviews the finding that was pressed, and Start here steps aside", async () => {
    const { claims, draft } = many();
    const user = userEvent.setup();
    view(stateOf(claims), draft);
    await user.click(screen.getByRole("button", { name: /Review: C-1/ }));
    expect(sentence(/Subsidies fell 18%/).getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("region", { name: "Start here" })).toBeNull();
  });

  it("lists a citation repeated in six places as one line with a count, and opens to every place", async () => {
    const { claims, draft } = many();
    const user = userEvent.setup();
    view(stateOf(claims), draft);
    const summary = document.querySelector(".cl-repeat-sum") as HTMLElement;
    expect(summary.textContent).toContain("Darmono, 2016");
    expect(summary.textContent).toContain("6 places");
    expect(document.querySelectorAll(".cl-repeat .cl-nested .cl-row")).toHaveLength(6);
    await user.click(summary);
    expect((document.querySelector(".cl-repeat") as HTMLDetailsElement).open).toBe(true);
  });

  it("filters by severity and by section, together with the issue type", async () => {
    const { claims, draft } = many();
    const user = userEvent.setup();
    view(stateOf(claims), draft);
    const muted = () => [...document.querySelectorAll(".hl.hl-muted")].length;
    expect(muted()).toBe(0);
    await user.click(within(screen.getByRole("group", { name: "Severity" })).getByRole("button", { name: "High" }));
    expect(muted()).toBe(claims.length - 1); // only the contradicted claim is high
    await user.click(within(screen.getByRole("group", { name: "Severity" })).getByRole("button", { name: "Any severity" }));
    await user.selectOptions(screen.getByLabelText("Section"), "1. Latar Belakang");
    expect(muted()).toBe(2); // the contradicted claim and the unclear one sit in "2. Hasil"
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All sections", "2. Hasil", "1. Latar Belakang"]);
  });

  it("offers Add this source on a claim that waits for its file, which opens the sources", async () => {
    const waiting = claim("Hermanto says pores matter.", "cant_check", { citation: "(Hermanto, 2014)", reason: "The reference exists, but no uploaded source matches it. Upload the PDF to check this claim." });
    const user = userEvent.setup();
    view(stateOf([waiting], "scanned"), waiting.text);
    await user.click(sentence(/Hermanto says/));
    await user.click(screen.getByRole("button", { name: "Add this source" }));
    expect((document.querySelector(".ws-grid") as HTMLElement).dataset.side).toBe("open");
  });
});
