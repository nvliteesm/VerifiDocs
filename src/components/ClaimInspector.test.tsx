// @vitest-environment jsdom
// One claim in the inspector: what the verdict says, the evidence, the fix, flagging, and finding a source.
// Ported from the old ResultsView card tests (25 Nov 2026); the card is now the inspector.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimView, Verdict } from "@/lib/client/types";
import { shortQuote } from "./claim-bits";
import { ClaimInspector } from "./ClaimInspector";
import type { AttachFn, EventFn, FindFn } from "./FoundSources";

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

const noop = () => {};
interface Extra {
  error?: string;
  ended?: boolean;
  scanned?: boolean;
  canApply?: boolean;
  onEvent?: EventFn;
  onFlag?: (reason: never) => void;
  onRetry?: () => void;
  onFindSources?: FindFn;
  onFindWebSources?: FindFn;
  onAttachSource?: AttachFn;
}
function inspect(c: ClaimView, extra: Extra = {}) {
  return render(
    <ClaimInspector
      claim={c}
      label="C-1"
      ended={extra.ended ?? false}
      scanned={extra.scanned ?? false}
      error={extra.error}
      flagged={false}
      resolution={null}
      canApply={extra.canApply ?? true}
      place={null}
      onPrev={noop}
      onNext={noop}
      onApply={noop}
      onIgnore={noop}
      onUndo={noop}
      onFlag={(extra.onFlag as never) ?? noop}
      onRetry={extra.onRetry ?? noop}
      onEvent={extra.onEvent ?? noop}
      onFindSources={extra.onFindSources}
      onFindWebSources={extra.onFindWebSources}
      onAttachSource={extra.onAttachSource}
    />,
  );
}

describe("what the verdict says", () => {
  it("shows an early-exit reason once, without repeating the general explanation", () => {
    inspect(claim("cant_check", { reason: "The reference exists, but no uploaded source matches it. Upload the PDF to check this claim." }));
    expect(screen.getAllByText(/no uploaded source matches it/)).toHaveLength(1);
    expect(screen.queryByText(/no readable PDF of it was uploaded/)).toBeNull();
  });

  it("shows a judged verdict's reason, what it means, and one short what-to-do line", () => {
    inspect(claim("contradicted", { reason: "The source says 5 percent.", quote: "five percent" }));
    expect(screen.getByText("The source says 5 percent.")).toBeTruthy();
    expect(screen.getByText("The source says something different.")).toBeTruthy();
    expect(screen.getByText(/Change the sentence to match the source/)).toBeTruthy();
    expect(screen.queryByText(/the opposite, or gives a different value/)).toBeNull();
  });

  it("gives no upload-a-PDF advice when the real cause is an empty reference list", () => {
    inspect(claim("reference_not_found", { reason: '"smith 2021" cannot be matched because no reference list was added. Paste your reference list and check again.' }));
    expect(screen.queryByText(/What to do:/)).toBeNull();
    expect(screen.queryByText(/mistyped/)).toBeNull();
  });

  it("tells the student to add the entry when a citation is not in their reference list", () => {
    inspect(claim("reference_not_found", { reason: '"smith 2021" is not in your reference list.' }));
    expect(screen.getByText(/Add it to your reference list/)).toBeTruthy();
    expect(screen.queryByText(/upload its PDF/)).toBeNull();
  });

  it("offers the upload advice when no online record and no upload matched", () => {
    inspect(claim("reference_not_found", { reason: 'Reference 1 ("Kementerian Keuangan...") was not found in Crossref or OpenAlex, and none of your uploaded PDFs matches it.' }));
    expect(screen.getByText(/upload its PDF/)).toBeTruthy();
  });

  it("shows a general statement with no citation as 'Could use a source', with softer advice and no fix block", () => {
    inspect(claim("no_citation_given", { citation: null, need: "should" }));
    expect(screen.getByText("Could use a source")).toBeTruthy();
    expect(screen.getByText("A source would make this stronger.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Suggested fix" })).toBeNull();
  });

  it("says an unchecked claim is 'Not checked yet' after the scan, 'Not checked' once the check ended, and 'Waiting…' while it runs", () => {
    const { unmount } = inspect(claim(null), { scanned: true });
    expect(screen.getByText("Not checked yet")).toBeTruthy();
    unmount();
    const second = inspect(claim(null), { ended: true });
    expect(screen.getByText("Not checked")).toBeTruthy();
    second.unmount();
    inspect(claim(null));
    expect(screen.getByText("Waiting…")).toBeTruthy();
  });

  it("says when a claim takes the citation at the end of its paragraph", () => {
    inspect(claim("supported", { citation: "(Lee & Park, 2021)", citationInherited: true, quote: "q", page: 2 }));
    expect(screen.getByText("(Lee & Park, 2021), from the end of its paragraph")).toBeTruthy();
  });

  it("marks a claim checked against a paper found here, so the student knows the draft still lacks it", () => {
    inspect(claim("supported", { citation: "(Lee, 2021)", citationSource: "found", quote: "q", page: 3 }));
    expect(screen.getByText("Found here: not in your draft yet")).toBeTruthy();
  });

  it("says so when the year in the student's list is off, even when the claim is supported", () => {
    inspect(claim("supported", { citation: "(Mikolov et al., 2015)", yearNotes: [{ position: 9, cited: 2015, published: 2013 }] }));
    expect(screen.getByText("Wrong year: your list says 2015, the paper came out in 2013.")).toBeTruthy();
  });
});

describe("the evidence", () => {
  it("shows the file and the page above the quote, in the source's own words", () => {
    const { container } = inspect(claim("supported", { quote: "Household spending rose by 4.2 percent in 2023.", page: 1, reason: "r", sourceFile: "Contoh-Statistics-Office-2024.pdf" }));
    const card = container.querySelector(".evidence")!;
    expect(within(card as HTMLElement).getByText("Contoh-Statistics-Office-2024.pdf")).toBeTruthy();
    expect(within(card as HTMLElement).getByText("p. 1")).toBeTruthy();
    expect(card.textContent).toContain("“Household spending rose by 4.2 percent in 2023.”");
  });

  it("names no file when the server sent none, and shows no evidence card without a quote", () => {
    const { container, unmount } = inspect(claim("supported", { quote: "Prices rose.", page: 2, reason: "r" }));
    expect(container.querySelector(".evidence-file")?.textContent).toBe("");
    unmount();
    const bare = inspect(claim("not_in_sources", { reason: "r" }));
    expect(bare.container.querySelector(".evidence")).toBeNull();
  });

  it("marks the numbers that differ between the sentence and the quote, with a line that says so", () => {
    inspect(claim("contradicted", { citation: "(Office, 2024)", text: "Spending rose by 4.2 percent", quote: "Spending rose by 7.1 percent.", page: 2, reason: "r" }));
    expect([...document.querySelectorAll("mark.num")].map((mark) => mark.textContent)).toEqual(["4.2", "7.1"]);
    expect(screen.getByText("Marked numbers differ between your sentence and the source.")).toBeTruthy();
  });

  it("marks nothing when the numbers agree", () => {
    inspect(claim("supported", { text: "Spending rose by 4.2 percent", quote: "Spending rose by 4.2 percent.", page: 2, reason: "r" }));
    expect(document.querySelector("mark.num")).toBeNull();
    expect(screen.queryByText(/Marked numbers differ/)).toBeNull();
  });

  it("shows a machine translation under the quote, labelled, with the quote first", () => {
    inspect(claim("partial", { text: "Pain fell in most patients", quote: "Pain fell in 70% of patients.", page: 3, reason: "r", quoteGloss: "Nyeri turun pada 70% pasien." }));
    const quote = screen.getByText(/Pain fell in 70% of patients/);
    const gloss = screen.getByText("Nyeri turun pada 70% pasien.");
    expect(screen.getByText("Machine translation:")).toBeTruthy();
    expect(quote.compareDocumentPosition(gloss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no translation line when there is none", () => {
    inspect(claim("partial", { quote: "Pain fell in 70% of patients.", page: 3, reason: "r" }));
    expect(screen.queryByText("Machine translation:")).toBeNull();
  });

  it("counts the student looking at a quote as opening the evidence, once", () => {
    const onEvent = vi.fn();
    const { rerender } = inspect(claim("contradicted", { quote: "five percent", page: 4, reason: "r" }), { onEvent });
    expect(onEvent.mock.calls.filter(([name]) => name === "evidence_opened")).toHaveLength(1);
    expect(onEvent).toHaveBeenCalledWith("evidence_opened", { verdict: "contradicted" });
    rerender(
      <ClaimInspector claim={null} label={null} ended={false} scanned={false} flagged={false} resolution={null} canApply place={null} onPrev={noop} onNext={noop} onApply={noop} onIgnore={noop} onUndo={noop} onFlag={noop} onRetry={noop} onEvent={onEvent} />,
    );
    expect(onEvent.mock.calls.filter(([name]) => name === "evidence_opened")).toHaveLength(1);
  });
});

describe("copying a suggested sentence", () => {
  const fixable = () => claim("contradicted", { quote: "q", reason: "r", fixSuggestion: "Trade rose 5 percent." });

  it("tells the student when it could not be copied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    inspect(fixable(), { canApply: false });
    await user.click(screen.getByRole("button", { name: "Copy sentence" }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  it("reports a copied sentence once, and only when the copy worked", async () => {
    const user = userEvent.setup();
    const onEvent = vi.fn();
    inspect(fixable(), { canApply: false, onEvent });
    await user.click(screen.getByRole("button", { name: "Copy sentence" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(onEvent.mock.calls.filter(([name]) => name === "fix_accepted")).toHaveLength(1);
  });
});

describe("a claim that failed in the browser", () => {
  it("offers Try again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    inspect(claim(null, { text: "unlucky claim" }), { ended: true, error: "This claim could not be checked right now.", onRetry });
    expect(screen.getByRole("alert").textContent).toContain("This claim could not be checked right now.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("saying a verdict is wrong", () => {
  const flaggable = () => claim("contradicted", { text: "wrong one", quote: "five percent", page: 2, reason: "r" });

  it("asks why first, and reports the chosen reason once", async () => {
    const user = userEvent.setup();
    const onFlag = vi.fn();
    inspect(flaggable(), { onFlag });
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(onFlag).not.toHaveBeenCalled(); // nothing is sent until a reason is chosen
    const group = screen.getByRole("group", { name: "What looks wrong with this verdict?" });
    await user.click(within(group).getByRole("button", { name: "It is on a different page" }));
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith("wrong_page");
  });

  it("never offers a text box, so nothing typed can leave the page", async () => {
    const user = userEvent.setup();
    inspect(flaggable());
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("moves focus to the first reason, and lets the student back out with focus back on the button they started from", async () => {
    const user = userEvent.setup();
    const onFlag = vi.fn();
    inspect(flaggable(), { onFlag });
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "The quote does not support this" }));
    await user.click(screen.getByRole("button", { name: "Never mind" }));
    const again = screen.getByRole("button", { name: "This verdict is wrong" });
    expect(document.activeElement).toBe(again); // not the page body
    expect(onFlag).not.toHaveBeenCalled();
  });

  it("only offers reasons that fit: quote reasons need a quote, 'already uploaded' needs a no-match verdict", async () => {
    const user = userEvent.setup();
    const { unmount } = inspect(flaggable());
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.queryByRole("button", { name: "I already uploaded this source" })).toBeNull();
    expect(screen.getByRole("button", { name: "The quote does not support this" })).toBeTruthy();
    unmount();

    inspect(claim("cant_check", { reason: "The reference exists, but no uploaded source matches it." }));
    await user.click(screen.getByRole("button", { name: "This verdict is wrong" }));
    expect(screen.getByRole("button", { name: "I already uploaded this source" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "The quote does not support this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "It is on a different page" })).toBeNull();
  });
});

describe("Find a source", () => {
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

  it("is offered on a No citation claim, and on no other", () => {
    inspect(uncited(), { onFindSources: vi.fn() });
    expect(screen.getAllByRole("button", { name: "Find a source" })).toHaveLength(1);
    cleanup();
    inspect(claim("contradicted", { quote: "q", page: 1 }), { onFindSources: vi.fn() });
    expect(screen.queryByRole("button", { name: "Find a source" })).toBeNull();
  });

  it("says it is searching while it waits, then shows what the server found", async () => {
    const user = userEvent.setup();
    let finish: (value: string | null) => void = () => {};
    const onFind = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    const c = uncited();
    inspect(c, { onFindSources: onFind });
    await user.click(screen.getByRole("button", { name: "Find a source" }));
    expect(onFind).toHaveBeenCalledWith(c.id);
    expect(screen.getByRole("button", { name: "Searching for papers…" })).toHaveProperty("disabled", true);
    finish("The paper search is busy. Try again in a moment.");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The paper search is busy. Try again in a moment.");
    expect(screen.getByRole("button", { name: "Find a source" })).toHaveProperty("disabled", false);
  });

  it("shows found papers as unread leads, with a link out and copyable citations", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onEvent = vi.fn();
    inspect(uncited({ sourcesSearched: true, sources: [PAPER] }), { onFindSources: vi.fn(), onEvent });

    expect(screen.getByText("Not read yet: open one and check it before you cite it.")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Flexible work in small firms/ });
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1/w1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toContain("(opens in a new tab)");
    expect(screen.getByText("Lee & Tan, 2021, Journal of Work")).toBeTruthy();
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
    inspect(uncited({ sourcesSearched: true, sources: [] }), { onFindSources: vi.fn() });
    expect(screen.getByText("No paper found. A product or company fact is best cited from its official page.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Find a source" })).toBeNull();
  });

  it("marks a paper that is only on the same topic", () => {
    inspect(uncited({ sourcesSearched: true, sources: [PAPER, { ...PAPER, rank: 2, relevance: "related", title: "Rostering in retail" }] }), { onFindSources: vi.fn() });
    expect(screen.getAllByText("Same topic, not your exact claim")).toHaveLength(1);
  });

  it("makes the source block a real heading, so a screen reader can jump to it", () => {
    inspect(uncited({ sourcesSearched: true, sources: [PAPER] }), { onFindSources: vi.fn() });
    expect(screen.getByRole("heading", { level: 4, name: "Possible sources" })).toBeTruthy();
  });
});

describe("Search the web", () => {
  const PAGE = {
    rank: 1,
    url: "https://stats.example.gov/labour",
    site: "stats.example.gov",
    title: "Labour force survey",
    sentence: "Casual jobs rose by 18 percent between 2015 and 2020.",
    relevance: "direct" as const,
    // Noon UTC, so the shown day is the same in every time zone the tests may run in.
    retrievedAt: "2026-11-25T12:00:00.000Z",
  };
  const PAPER = {
    rank: 1,
    openalexId: "https://openalex.org/W1",
    doi: "https://doi.org/10.1/w1",
    title: "Flexible work in small firms",
    year: 2021,
    authors: ["Kim Lee"],
    venue: null,
    openAccessPdf: null,
    sentence: "Casual employment grew 18% between 2015 and 2020.",
    relevance: "direct" as const,
  };
  /** An uncited claim whose paper search ran and found nothing: the state that offers the web. */
  const noPaper = (extra: Partial<ClaimView> = {}) => claim("no_citation_given", { citation: null, sourcesSearched: true, sources: [], ...extra });
  const show = (c: ClaimView, onFindWeb: FindFn | undefined = vi.fn(), onEvent: EventFn = vi.fn()) => inspect(c, { onFindSources: vi.fn(), onFindWebSources: onFindWeb, onEvent });

  it("is offered only under No paper found, and only when web search is set up", () => {
    show(noPaper());
    expect(screen.getByText("No paper found. A product or company fact is best cited from its official page.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search the web" })).toBeTruthy();
    cleanup();

    // Not set up on the server: the same card, no button.
    inspect(noPaper(), { onFindSources: vi.fn() });
    expect(screen.queryByRole("button", { name: "Search the web" })).toBeNull();
    cleanup();

    // The paper search has not run: the web is not the next step.
    show(claim("no_citation_given", { citation: null }));
    expect(screen.queryByRole("button", { name: "Search the web" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Find a source" })).toHaveLength(1);
    cleanup();

    // A paper was found: the web is not the next step either.
    show(noPaper({ sources: [PAPER] }));
    expect(screen.queryByRole("button", { name: "Search the web" })).toBeNull();
  });

  it("says it is searching while it waits, and shows the failure with the button back", async () => {
    const user = userEvent.setup();
    let finish: (value: string | null) => void = () => {};
    const onFindWeb = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    const c = noPaper();
    show(c, onFindWeb);
    await user.click(screen.getByRole("button", { name: "Search the web" }));
    expect(onFindWeb).toHaveBeenCalledWith(c.id);
    expect(screen.getByRole("button", { name: "Searching the web…" })).toHaveProperty("disabled", true);
    finish("The web search is busy. Try again in a moment.");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The web search is busy. Try again in a moment.");
    expect(screen.getByRole("button", { name: "Search the web" })).toHaveProperty("disabled", false);
  });

  it("shows pages as unread leads: site and retrieved date, a link out, and copyable web citations", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onEvent = vi.fn();
    show(noPaper({ webSearched: true, webSources: [PAGE] }), vi.fn(), onEvent);

    expect(screen.getByText("Not read yet, and not peer reviewed: open one and check it before you cite it.")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Labour force survey/ });
    expect(link.getAttribute("href")).toBe("https://stats.example.gov/labour");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("(opens in a new tab)");
    expect(screen.getByText("stats.example.gov")).toBeTruthy();
    expect(screen.getByText("Retrieved 25 November 2026")).toBeTruthy();
    expect(screen.getByText(/Casual jobs rose by 18 percent/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search the web" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Copy in-text" }));
    expect(write).toHaveBeenLastCalledWith("(stats.example.gov, n.d.)");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(write).toHaveBeenLastCalledWith("stats.example.gov. (n.d.). Labour force survey. Retrieved November 25, 2026, from https://stats.example.gov/labour");
    expect(onEvent).toHaveBeenCalledWith("source_copied", { kind: "in_text" });
    expect(onEvent).toHaveBeenCalledWith("source_copied", { kind: "reference" });
  });

  it("says plainly when no web page was found", () => {
    show(noPaper({ webSearched: true, webSources: [] }));
    expect(screen.getByText("No web page found.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search the web" })).toBeNull();
  });

  it("marks a page that is only on the same topic, and makes the block a real heading", () => {
    show(noPaper({ webSearched: true, webSources: [PAGE, { ...PAGE, rank: 2, relevance: "related", title: "Wages in retail", url: "https://retail.example/wages" }] }));
    expect(screen.getAllByText("Same topic, not your exact claim")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 4, name: "Possible web pages" })).toBeTruthy();
  });

  it("drops a title's trailing period and keeps the arrow with the last word, so it never sits alone", () => {
    show(noPaper({ webSearched: true, webSources: [{ ...PAGE, title: "Labour force survey." }, { ...PAGE, rank: 2, title: "Pricing", url: "https://p.example/x" }] }));
    const links = screen.getAllByRole("link");
    expect(links[0]!.textContent).toContain("Labour force survey");
    expect(links[0]!.textContent).not.toContain("survey.");
    expect(links[0]!.querySelector(".link-end")!.textContent).toBe("survey\u00a0↗");
    // A one-word title has no earlier words to keep apart.
    expect(links[1]!.querySelector(".link-end")!.textContent).toBe("Pricing\u00a0↗");
  });

  it("shows a page whose address is not http or https as plain text, never as a link", () => {
    show(noPaper({ webSearched: true, webSources: [{ ...PAGE, url: "javascript:alert(1)" }] }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Labour force survey")).toBeTruthy();
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
  const card = (sources = [PAPER, { ...PAPER, rank: 2, openAccessPdf: null, title: "Paywalled study" }]) => claim("no_citation_given", { citation: null, sourcesSearched: true, sources });

  it("offers a free-PDF check only where there is a free PDF, and an upload everywhere", () => {
    inspect(card(), { onFindSources: vi.fn(), onAttachSource: vi.fn() });
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
    inspect(card(), { onFindSources: vi.fn(), onAttachSource: onAttach });
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
    inspect(card(), { onFindSources: vi.fn(), onAttachSource: onAttach });
    await user.click(screen.getAllByRole("button", { name: "Upload its PDF" })[1]!);
    const file = new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" });
    await user.upload(document.querySelector('.found input[type="file"]') as HTMLInputElement, file);
    expect(onAttach.mock.calls[0]!.slice(1, 4)).toEqual([2, "Paywalled study", file]);
  });
});
