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
const sentence = (text: RegExp | string) => screen.getByRole("button", { name: text });

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
    expect(within(inspector).getByText("Subsidies dropped by 18% in 2023.")).toBeTruthy(); // the sentence, as the headline
    expect(within(inspector).getByText("The source says something different.")).toBeTruthy(); // what the verdict means
    expect(within(inspector).getByText(/Subsidy reduction remains at/)).toBeTruthy();
    expect(within(inspector).getByText("Stats-Office-2024.pdf")).toBeTruthy();
    expect(within(inspector).getByText("p. 4")).toBeTruthy();
    expect(sentence(/Subsidies dropped by 18%/).getAttribute("aria-current")).toBe("true");
    expect(onEvent).toHaveBeenCalledWith("evidence_opened", { verdict: "contradicted" });
  });

  it("names the one number a fix changes", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(screen.getAllByText("Change 18% to 8%").length).toBeGreaterThan(0); // in the fix block, and as the fix list row
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
  it("puts the suggested sentence in the draft, shows the change, and undo brings the old one back", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    const onEvent = view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));

    expect(onEvent).toHaveBeenCalledWith("fix_accepted");
    expect(screen.getByText("Applied to your copy of the draft.")).toBeTruthy();
    const applied = sentence(/Subsidies dropped by 8%/);
    expect(applied.className).toContain("hl-applied");
    // While selected, the old sentence stays visible, struck through, beside the new one.
    expect(applied.querySelector("del")?.textContent).toBe("Subsidies dropped by 18% in 2023.");
    expect(applied.querySelector("ins")?.textContent).toBe("Subsidies dropped by 8% in 2023.");
    expect(screen.queryByRole("button", { name: "Apply fix" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(sentence(/Subsidies dropped by 18%/).className).toContain("v-contradicted");
    expect(screen.getByRole("button", { name: "Apply fix" })).toBeTruthy();
  });

  it("copies the draft with the fix in it, and the rest of the text untouched", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getByRole("button", { name: "Copy fixed draft" }));
    expect(await navigator.clipboard.readText()).toBe(draft.replace("18%", "8%"));
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("fits the fix to its place when the claim sentence stops before its own citation and full stop", async () => {
    const fell = claim("Food prices fell during the same year", "contradicted", { fixSuggestion: "Food prices rose by 7.1 percent in 2023." });
    const draft = "Spending rose. Food prices fell during the same year (Stats Office, 2024). Rent is high.";
    const user = userEvent.setup();
    view(stateOf([fell]), draft);
    await user.click(sentence(/Food prices fell/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await user.click(screen.getByRole("button", { name: "Copy fixed draft" }));
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

  it("lets the student ignore a claim, and undo that", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    expect(screen.getByText("Ignored.")).toBeTruthy();
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
  it("counts the checked claims, the supported ones and the ones that need attention, and drops a count when a fix is applied", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const line = () => document.querySelector(".stats-line")?.textContent ?? "";
    expect(line()).toContain("2 claims checked");
    expect(line()).toContain("1 supported");
    expect(line()).toContain("1 need attention");
    await user.click(sentence(/Subsidies dropped by 18%/));
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    expect(line()).toContain("0 need attention");
    expect(line()).toContain("1 resolved");
    expect(screen.getByRole("img", { name: "Verdicts across the draft" })).toBeTruthy();
  });
});

describe("the fix list", () => {
  function pair() {
    const partial = claim("Gamma is 5%.", "partial", { fixSuggestion: "Gamma is 6%." });
    const contradicted = claim("Alpha is 1%.", "contradicted", { fixSuggestion: "Alpha is 2%." });
    return { partial, contradicted, draft: `${partial.text} ${contradicted.text}` };
  }

  it("ranks the open issues most serious first, with a count on the tab, and a press opens that claim", async () => {
    const { partial, contradicted, draft } = pair();
    const user = userEvent.setup();
    view(stateOf([partial, contradicted]), draft);
    await user.click(screen.getByRole("button", { name: /^Fix list\s*2$/ }));
    const rows = screen.getAllByRole("button").filter((button) => button.className.includes("fixrow"));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Change 1% to 2%"); // contradicted outranks partly supported
    expect(rows[0]!.textContent).toContain("Contradicted");
    expect(rows[1]!.textContent).toContain("Partly supported");

    await user.click(rows[1]!);
    expect(sentence(/Gamma is 5%/).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Apply fix" })).toBeTruthy(); // back on the Claim tab
  });

  it("drops a claim from the list once its fix is applied, and says when nothing is left", async () => {
    const { partial, contradicted, draft } = pair();
    const user = userEvent.setup();
    view(stateOf([partial, contradicted]), draft);
    for (const text of [/Alpha is 1%/, /Gamma is 5%/]) {
      await user.click(sentence(text));
      await user.click(screen.getByRole("button", { name: "Apply fix" }));
    }
    await user.click(screen.getByRole("button", { name: /^Fix list\s*0$/ }));
    expect(screen.getByText("Nothing left to fix.")).toBeTruthy();
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
    await user.click(screen.getByRole("button", { name: "Copy fixed draft" }));
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

describe("panes", () => {
  it("lets a narrow screen switch between draft, claim and sources, and opens the claim pane when a sentence is pressed", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const group = screen.getByRole("group", { name: "Panes" });
    expect(within(group).getByRole("button", { name: "Draft" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(group).getByRole("button", { name: "Sources" }));
    expect(within(group).getByRole("button", { name: "Sources" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(group).getByRole("button", { name: "Draft" }));
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(within(group).getByRole("button", { name: "Claim" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("hides and shows the inspector, and reopens it when a sentence is pressed", async () => {
    const { wrong, fine, draft } = twoClaims();
    const user = userEvent.setup();
    view(stateOf([wrong, fine]), draft);
    const toggle = screen.getByRole("button", { name: "Hide inspector" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Show inspector" }).getAttribute("aria-expanded")).toBe("false");
    await user.click(sentence(/Subsidies dropped by 18%/));
    expect(screen.getByRole("button", { name: "Hide inspector" })).toBeTruthy();
  });
});
