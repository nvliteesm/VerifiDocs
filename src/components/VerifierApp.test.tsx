// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_DRAFT, EXAMPLE_REFERENCES, EXAMPLE_SOURCE_FILENAME, EXAMPLE_SOURCE_URL, exampleFor } from "@/lib/client/example";
import type { ClaimView, RunResponse } from "@/lib/client/types";
import { LocaleProvider } from "./LocaleProvider";
import { CONSENT_KEY, LAST_RUN_KEY } from "./storage";
import { VerifierApp } from "./VerifierApp";

/** A fake server behind `fetch`: just enough of the API for one claim to go from pasted text to a verdict. */
function fakeServer(
  options: {
    failCreate?: boolean;
    existingRun?: boolean;
    hangChecks?: boolean;
    deleteStatus?: number;
    exampleFails?: boolean;
    importFails?: boolean;
    /** How many references the imported document ends with (default 2). */
    importRefs?: number;
  } = {},
) {
  const log: string[] = [];
  const eventBodies: { name: string; props: Record<string, unknown> }[] = [];
  let checked = options.existingRun ?? false;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const claim = (): ClaimView => ({
    id: "c1",
    position: 1,
    text: "International trade rose 5 percent",
    citation: "(Vaswani et al., 2017)",
    citationInherited: false,
    section: null,
    status: checked ? "done" : "pending",
    verdict: checked ? "supported" : null,
    quote: checked ? "International trade rose 5 percent." : null,
    page: checked ? 1 : null,
    reason: checked ? "The passage says so." : null,
    exitStage: checked ? 7 : null,
    fixSuggestion: null,
  });
  const run = (): RunResponse => ({
    run: {
      id: "run-1",
      status: checked ? "completed" : "checking",
      unitCount: 1,
      unitsExtracted: 1,
      claimCount: 1,
      createdAt: "t",
      completedAt: checked ? "t" : null,
    },
    progress: { checked: checked ? 1 : 0, total: 1 },
    counts: checked ? { supported: 1 } : {},
    fixList: [],
    failedParts: [],
    claims: [claim()],
    references: [],
  });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    const method = init?.method ?? "GET";
    log.push(`${method} ${url}`);
    if (method === "GET" && url === "/api/sources") return json(200, { sources: [] });
    if (method === "GET" && (url === EXAMPLE_SOURCE_URL || url === exampleFor("id").sourceUrl)) {
      return options.exampleFails ? new Response("nope", { status: 500 }) : new Response(new Blob(["%PDF-1.4 example"]), { status: 200 });
    }
    if (method === "POST" && url === "/api/sources") return json(201, { documentId: "doc-ex", status: "ingesting", pageCount: 1 });
    if (method === "POST" && url === "/api/import") {
      if (options.importFails) {
        return json(422, { error: { code: "not_public", message: "The document could not be opened. Make sure Share is set to “Anyone with the link” and the link is right." } });
      }
      const isPdf = init?.body instanceof FormData;
      return json(200, {
        text: "Imported draft text (Smith, 2021).",
        source: isPdf ? "pdf" : "link",
        warnings: isPdf ? [] : ["footnotes"],
        truncated: false,
        referenceCount: options.importRefs ?? 2,
      });
    }
    if (method === "POST" && url === "/api/sources/doc-ex/ingest") {
      return json(200, { documentId: "doc-ex", status: "ready", pagesIngested: 1, pageCount: 1, done: true });
    }
    if (method === "POST" && url === "/api/runs") {
      if (options.failCreate) return json(500, { error: { code: "internal", message: "Something went wrong on our side." } });
      checked = false;
      return json(201, { runId: "run-1", status: "extracting", unitCount: 1, referenceCount: 0 });
    }
    if (method === "POST" && url === "/api/runs/run-1/extract") {
      return json(200, { unit: 0, alreadyExtracted: false, claimsAdded: 1, status: "checking", unitCount: 1, unitsExtracted: 1, claimCount: 1 });
    }
    if (method === "GET" && url === "/api/runs/run-1") return json(200, run());
    if (method === "DELETE" && url === "/api/runs/run-1") {
      const status = options.deleteStatus ?? 204;
      return status === 204 ? new Response(null, { status }) : json(status, { error: { code: "internal", message: "Something went wrong on our side." } });
    }
    if (method === "POST" && url === "/api/claims/c1/check") {
      if (options.hangChecks) return new Promise<Response>(() => {}); // the model never answers
      checked = true;
      return json(200, {
        outcome: "done",
        runCompleted: true,
        verdict: { claimId: "c1", verdict: "supported", quote: "International trade rose 5 percent.", page: 1, reason: "The passage says so.", exitStage: 7, fixSuggestion: null },
      });
    }
    if (method === "POST" && url === "/api/events") {
      eventBodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return { fetchImpl, log, eventBodies, count: (entry: string) => log.filter((line) => line === entry).length };
}

/** Scan the draft, then start the check of the cited claims (what the screen asks of the student in two presses). */
async function checkAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Scan my draft" }));
  await user.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
}

const DRAFT = "International trade rose 5 percent (Vaswani et al., 2017).";
const REFS = "Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS.";

async function openApp(server: ReturnType<typeof fakeServer>, opts: { lastRun?: boolean } = {}) {
  window.localStorage.setItem(CONSENT_KEY, "yes");
  if (opts.lastRun) window.localStorage.setItem(LAST_RUN_KEY, "run-1");
  vi.stubGlobal("fetch", server.fetchImpl);
  render(<VerifierApp />);
  return screen.findByLabelText(/Text or Google Docs link/).catch(() => null);
}

function fill(draft = DRAFT, refs = REFS) {
  fireEvent.change(screen.getByLabelText(/Text or Google Docs link/), { target: { value: draft } });
  fireEvent.change(screen.getByLabelText(/Reference list/), { target: { value: refs } });
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("privacy note", () => {
  it("shows the form at once, keeps checking and uploading locked until 'Got it', and remembers the choice", async () => {
    vi.stubGlobal("fetch", fakeServer().fetchImpl);
    const user = userEvent.setup();
    render(<VerifierApp />);
    expect(await screen.findByText("Before you start")).toBeTruthy();
    expect(await screen.findByLabelText(/Text or Google Docs link/)).toBeTruthy(); // the product is not hidden behind the note
    expect(screen.getByRole("button", { name: "Try an example" })).toHaveProperty("disabled", true); // hidden once a draft is typed
    expect(screen.getByRole("button", { name: "Choose PDFs" })).toHaveProperty("disabled", true);
    fill();
    expect(screen.getByRole("button", { name: "Scan my draft" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Before you start")).toBeNull();
    expect(screen.getByRole("button", { name: "Scan my draft" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Choose PDFs" })).toHaveProperty("disabled", false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("yes");
  });

  it("puts the draft before the sources in the page, so a phone shows the draft first", async () => {
    await openApp(fakeServer());
    const draft = screen.getByLabelText(/Text or Google Docs link/);
    const sources = screen.getByRole("heading", { name: "Your sources" });
    expect(draft.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("a check that fails to start", () => {
  it("keeps the draft and the reference list, and lets the student retry or edit", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ failCreate: true });
    await openApp(server);
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));

    expect(await screen.findByText("Check stopped")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong on our side.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe(DRAFT);
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe(REFS);
    expect(screen.getByRole("button", { name: "Scan my draft" })).toHaveProperty("disabled", false);
  });

  it("Try again sends the same draft again", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ failCreate: true });
    await openApp(server);
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    await screen.findByText("Check stopped");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(server.count("POST /api/runs")).toBe(2));
  });
});

describe("a finished check", () => {
  async function finishedCheck() {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    fill();
    await checkAll(user);
    await screen.findByText("Check complete");
    return { user, server };
  }

  it("shows the verdict, the quote disclosure and the small pay question", async () => {
    await finishedCheck();
    expect(screen.getAllByText("Every checked claim is supported.").length).toBeGreaterThan(0);
    expect(screen.getByText("International trade rose 5 percent")).toBeTruthy();
    expect(screen.getByText("Would you pay for this if it were not free?")).toBeTruthy();
  });

  it("drops the intro text once a check exists, but keeps one heading for screen readers", async () => {
    await finishedCheck();
    expect(screen.queryByText(/Paste your draft and see which claims/)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("moves focus to the Results heading when the check finishes", async () => {
    await finishedCheck();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });

  it("Edit draft brings the draft back so a sentence can be fixed without re-pasting", async () => {
    const { user } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe(DRAFT);
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe(REFS);
  });

  it("Start a new check clears the draft", async () => {
    const { user } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Start a new check" }));
    expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe("");
  });

  it("Check again runs the same draft again", async () => {
    const { user, server } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Check again with my sources" }));
    await waitFor(() => expect(server.count("POST /api/runs")).toBe(2));
    await user.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    await screen.findByText("Check complete");
  });

  it("says when the report could not be copied", async () => {
    const { user } = await finishedCheck();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("blocked"));
    await user.click(screen.getByRole("button", { name: "Copy report" }));
    expect(await screen.findByText(/Could not copy the report/)).toBeTruthy();
  });

  it("confirms a copied report, then goes back to Copy report", async () => {
    const { user } = await finishedCheck();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await user.click(screen.getByRole("button", { name: "Copy report" }));
      expect(await screen.findByRole("button", { name: "Report copied" })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(3100);
      expect(await screen.findByRole("button", { name: "Copy report" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stopping a check", () => {
  it("offers Stop while claims are being checked, and ends the check as stopped by the student", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer({ hangChecks: true }));
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    await user.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    const stop = await screen.findByRole("button", { name: "Stop checking" });
    expect(screen.getByRole("button", { name: "Start a new check" })).toHaveProperty("disabled", true);

    await user.click(stop);
    expect(await screen.findByText("Check stopped by you")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop checking" })).toBeNull();
    expect(screen.getByText("Not checked")).toBeTruthy(); // the claim that was never judged
    expect(screen.getAllByText("Stopped before any claim was checked.").length).toBeGreaterThan(0);
    // The student can move on straight away.
    expect(screen.getByRole("button", { name: "Start a new check" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Edit draft" })).toBeTruthy();
  });

  it("puts focus on the Results heading after Stop, because the Stop button has left the page", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer({ hangChecks: true }));
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    await user.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    await user.click(await screen.findByRole("button", { name: "Stop checking" }));
    await screen.findByText("Check stopped by you");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });

  it("does not show Stop once the check has finished", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    fill();
    await checkAll(user);
    await screen.findByText("Check complete");
    expect(screen.queryByRole("button", { name: "Stop checking" })).toBeNull();
  });
});

describe("deleting a check", () => {
  async function finishedCheck(server = fakeServer()) {
    const user = userEvent.setup();
    await openApp(server);
    fill();
    await checkAll(user);
    await screen.findByText("Check complete");
    return { user, server };
  }

  it("takes two steps, and keeping it changes nothing", async () => {
    const { user, server } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    const group = screen.getByRole("group", { name: "Delete this check?" });
    expect(group.textContent).toContain("can't be undone");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep it" })); // the safe choice has focus

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: "Delete this check?" })).toBeNull();
    expect(screen.getByText("Check complete")).toBeTruthy();
    expect(server.log).not.toContain("DELETE /api/runs/run-1");
  });

  it("deletes on the server, clears the screen and the remembered check, and says so", async () => {
    const { user, server } = await finishedCheck();
    expect(window.localStorage.getItem(LAST_RUN_KEY)).toBe("run-1");
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));

    expect(await screen.findByText("Your check was deleted from our servers.")).toBeTruthy();
    expect(server.count("DELETE /api/runs/run-1")).toBe(1);
    expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe(""); // the draft is gone too
    expect(window.localStorage.getItem(LAST_RUN_KEY)).toBeNull();
    expect(screen.queryByText("Check complete")).toBeNull();
  });

  it("does not pretend it worked when the server could not delete it", async () => {
    const { user } = await finishedCheck(fakeServer({ deleteStatus: 500 }));
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not delete the check");
    expect(screen.getByText("Check complete")).toBeTruthy(); // the results are still there
    expect(window.localStorage.getItem(LAST_RUN_KEY)).toBe("run-1");
    expect(screen.queryByText("Your check was deleted from our servers.")).toBeNull();
  });

  it("treats a check that is already gone (deleted in another tab) as deleted", async () => {
    const { user } = await finishedCheck(fakeServer({ deleteStatus: 404 }));
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));
    expect(await screen.findByText("Your check was deleted from our servers.")).toBeTruthy();
  });

  it("is not offered while a check is still running", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer({ hangChecks: true }));
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    await user.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    await screen.findByRole("button", { name: "Stop checking" });
    expect(screen.queryByRole("button", { name: "Delete this check" })).toBeNull();
  });

  it("can delete a check that was reopened after a reload", async () => {
    const server = fakeServer({ existingRun: true });
    await openApp(server, { lastRun: true });
    await screen.findByText("Check complete");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await screen.findByText("Your check was deleted from our servers.");
    expect(server.count("DELETE /api/runs/run-1")).toBe(1);
  });
});

describe("keyboard focus is never dropped to the top of the page", () => {
  async function finished() {
    const user = userEvent.setup();
    await openApp(fakeServer());
    fill();
    await checkAll(user);
    await screen.findByText("Check complete");
    return user;
  }

  it("returns to 'Delete this check' after 'Keep it'", async () => {
    const user = await finished();
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete this check" }));
  });

  it("closes the delete prompt with Escape and returns focus to the button that opened it", async () => {
    const user = await finished();
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    expect(screen.getByRole("group", { name: "Delete this check?" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Delete this check?" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete this check" }));
  });

  it("moves to the confirmation message after a delete", async () => {
    const user = await finished();
    await user.click(screen.getByRole("button", { name: "Delete this check" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete it" }));
    const note = await screen.findByText("Your check was deleted from our servers.");
    await waitFor(() => expect(document.activeElement).toBe(note));
  });

  it("moves to the draft box after 'Edit draft' and after 'Start a new check'", async () => {
    const user = await finished();
    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Text or Google Docs link/));

    fireEvent.click(screen.getByRole("button", { name: "Scan my draft" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    await screen.findByText("Check complete");
    await user.click(screen.getByRole("button", { name: "Start a new check" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Text or Google Docs link/));
  });

  it("moves to the filled draft after 'Try an example'", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    await user.click(screen.getByRole("button", { name: "Try an example" }));
    const draft = await screen.findByDisplayValue(EXAMPLE_DRAFT);
    await waitFor(() => expect(document.activeElement).toBe(draft));
  });

  it("does not take focus on the first page load", async () => {
    await openApp(fakeServer());
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the one-question survey", () => {
  it("sends only the answer when a button is pressed, with no price question", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    fill();
    await checkAll(user);
    await screen.findByText("Check complete");

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Rp\d|fair/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Maybe" }));
    await waitFor(() => expect(server.eventBodies.some((e) => e.name === "would_pay_answered")).toBe(true));
    expect(server.eventBodies.find((e) => e.name === "would_pay_answered")).toEqual({ name: "would_pay_answered", props: { answer: "maybe" } });
    expect(screen.getByText("Thank you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Maybe" })).toBeNull(); // answered once
  });
});

describe("the scan, then the check", () => {
  it("stops after the scan: it shows what it found, and checks nothing until the student asks", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(screen.getByText("Found 1 claim.")).toBeTruthy();
    expect(screen.getByText("Not checked yet")).toBeTruthy();
    expect(server.count("POST /api/claims/claim-1/check")).toBe(0);
    expect(server.log.some((line) => line.includes("/check"))).toBe(false);
  });

  it("offers one button for the cited claims, with the count, and a Copy report and Edit draft beside it", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    expect(await screen.findByRole("button", { name: "Check 1 cited claim" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy report" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop checking" })).toBeNull();
  });

  it("reminds the student to add the PDFs when none is ready, and the reminder goes once one is", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    expect(await screen.findByText("Add the PDFs these claims cite, then check them.")).toBeTruthy();
  });

  it("checks the cited claims when the button is pressed, then shows the finished check", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    fill();
    await checkAll(user);
    expect(await screen.findByText("Check complete")).toBeTruthy();
    expect(server.log.some((line) => line.includes("/check"))).toBe(true);
    expect(screen.queryByRole("button", { name: /^Check \d+ cited claims?$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy report" })).toBeTruthy();
  });

  it("copies a report from the scan, before any check", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await openApp(fakeServer());
    fill();
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    await user.click(await screen.findByRole("button", { name: "Copy report" }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]![0])).toContain("not checked yet");
  });

  it("keeps the scan result when the screen is reopened later, instead of starting a check by itself", async () => {
    await openApp(fakeServer({ existingRun: false }), { lastRun: true });
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check 1 cited claim" })).toBeTruthy();
  });
});

describe("bringing a draft in without pasting it", () => {
  const LINK = "https://docs.google.com/document/d/1zNfrhNd-YvYB6stWLrujUCABad9c6EQcCdJWlmdfMe8/edit?usp=sharing";
  const draftBox = () => screen.getByLabelText("Text or Google Docs link") as HTMLTextAreaElement;
  const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  it("reads a pasted Google Docs link and scans it at once, with no text box in between", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    await user.click(draftBox());
    await user.paste(LINK);
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(server.count("POST /api/import")).toBe(1);
    expect(server.count("POST /api/runs")).toBe(1);
    // The results say what was checked.
    expect(screen.getByText("Draft: Google Doc")).toBeTruthy();
  });

  it("waits when the document has no reference list at the end, and opens the reference list box", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ importRefs: 0 });
    await openApp(server);
    await user.click(draftBox());
    await user.paste(LINK);

    // One line for the document, not a box holding all of it.
    expect(await screen.findByText("Google Doc")).toBeTruthy();
    expect(screen.queryByLabelText("Text or Google Docs link")).toBeNull();
    expect(screen.getByText("No reference list found at the end. Paste it below.")).toBeTruthy();
    expect(screen.getByText(/Footnotes were found/)).toBeTruthy();
    expect(server.count("POST /api/runs")).toBe(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Reference list/)));

    fireEvent.change(screen.getByLabelText(/Reference list/), { target: { value: REFS } });
    await user.click(screen.getByRole("button", { name: "Scan my draft" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(server.count("POST /api/runs")).toBe(1);
  });

  it("goes back to the empty box with 'Use a different draft'", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer({ importRefs: 0 }));
    await user.click(draftBox());
    await user.paste(LINK);
    await user.click(await screen.findByRole("button", { name: "Use a different draft" }));
    await waitFor(() => expect(document.activeElement).toBe(draftBox()));
    expect(draftBox().value).toBe("");
  });

  it("shows the document again, not its text, after 'Edit draft'", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    await user.click(draftBox());
    await user.paste(LINK);
    await user.click(await screen.findByRole("button", { name: "Edit draft" }));
    expect(await screen.findByText("Google Doc")).toBeTruthy();
    expect(screen.queryByLabelText("Text or Google Docs link")).toBeNull();
    expect(screen.getByRole("button", { name: "Scan my draft" })).toHaveProperty("disabled", false);
  });

  it("offers one press to read a link that was typed rather than pasted", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    fireEvent.change(draftBox(), { target: { value: `My draft is at ${LINK}, please read it.` } });
    expect(screen.queryByText("That looks like a Google Docs link.")).toBeNull(); // a real draft that mentions a link
    fireEvent.change(draftBox(), { target: { value: LINK } });
    expect(screen.getByText("That looks like a Google Docs link.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan my draft" })).toHaveProperty("disabled", true); // the link is not a draft
    await user.click(screen.getByRole("button", { name: "Read the document" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(server.count("POST /api/import")).toBe(1);
  });

  it("says plainly why a document could not be read, and keeps the box", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer({ importFails: true }));
    await user.click(draftBox());
    await user.paste(LINK);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Make sure Share is set to “Anyone with the link”/);
    expect(draftBox()).toBeTruthy();
  });

  it("reads nothing until the privacy note has been acknowledged", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    const user = userEvent.setup();
    render(<VerifierApp />);
    await screen.findByLabelText(/Text or Google Docs link/);
    fireEvent.change(draftBox(), { target: { value: LINK } });
    expect(screen.getByRole("button", { name: "Read the document" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Choose a file" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByRole("button", { name: "Read the document" })).toHaveProperty("disabled", false);
    expect(server.count("POST /api/import")).toBe(0);
  });

  it("reads a .txt file in the browser, with no request to the server, and scans it", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    await user.upload(fileInput(), new File(["﻿First paragraph.\r\n\r\n\r\n\r\nSecond paragraph."], "draft.txt", { type: "text/plain" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(server.count("POST /api/import")).toBe(0);
    expect(screen.getByText("Draft: draft.txt")).toBeTruthy();
  });

  it("sends a .pdf draft to the server to be read, then scans it", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    await user.upload(fileInput(), new File(["%PDF-1.4"], "draft.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(server.count("POST /api/import")).toBe(1);
  });

  it("refuses a type it cannot read, and scans a .docx at once", async () => {
    // A dropped file skips the picker's type filter, so the screen must refuse it itself.
    const user = userEvent.setup({ applyAccept: false });
    const server = fakeServer();
    await openApp(server);
    await user.upload(fileInput(), new File(["x"], "old.doc"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose a \.docx, \.pdf or \.txt file/);
    expect(server.count("POST /api/runs")).toBe(0);

    await user.upload(fileInput(), new File(["x"], "thesis.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    expect(await screen.findByText("Scan complete")).toBeTruthy();
    expect(screen.getByText("Draft: thesis.docx")).toBeTruthy();
  });
});

describe("Bahasa Indonesia", () => {
  function openIndonesian(server = fakeServer()) {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["id-ID", "en-US"]);
    window.localStorage.setItem(CONSENT_KEY, "yes");
    vi.stubGlobal("fetch", server.fetchImpl);
    render(
      <LocaleProvider>
        <VerifierApp />
      </LocaleProvider>,
    );
  }

  it("shows the screen in Indonesian when the browser asks for it, and switches back to English", async () => {
    const user = userEvent.setup();
    openIndonesian();
    expect(await screen.findByLabelText("Teks atau link Google Docs")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sumber kamu" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pindai drafku" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("id");

    await user.click(screen.getByRole("button", { name: "EN (English)" }));
    expect(await screen.findByLabelText("Text or Google Docs link")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan my draft" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("loads the Indonesian example, and runs a check in Indonesian", async () => {
    const user = userEvent.setup();
    const example = exampleFor("id");
    openIndonesian();
    await user.click(await screen.findByRole("button", { name: "Coba contoh" }));
    await waitFor(() => expect((screen.getByLabelText("Teks atau link Google Docs") as HTMLTextAreaElement).value).toBe(example.draft));
    expect((screen.getByLabelText(/Daftar pustaka/) as HTMLTextAreaElement).value).toBe(example.references);
    expect(await screen.findByText(example.sourceFilename)).toBeTruthy();
    expect(await screen.findByText("Siap, 1 halaman")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Pindai drafku" }));
    await screen.findByText("Pindai selesai");
    await user.click(await screen.findByRole("button", { name: "Cek 1 klaim bersitasi" }));
    await screen.findByText("Cek selesai");
    expect(screen.getAllByText("Semua klaim yang dicek didukung sumber.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Salin laporan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hapus cek ini" })).toBeTruthy();
  });

  it("loads the English example when the screen is English, even if Indonesian was used before", async () => {
    const user = userEvent.setup();
    openIndonesian();
    await user.click(await screen.findByRole("button", { name: "EN (English)" }));
    await user.click(await screen.findByRole("button", { name: "Try an example" }));
    await waitFor(() => expect((screen.getByLabelText("Text or Google Docs link") as HTMLTextAreaElement).value).toBe(EXAMPLE_DRAFT));
  });
});

describe("Try an example", () => {
  it("is offered while the draft is empty, and fills the draft, the reference list and the source", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    expect(screen.getByText(/made-up report and draft/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try an example" }));

    await waitFor(() => expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe(EXAMPLE_DRAFT));
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe(EXAMPLE_REFERENCES);
    expect(await screen.findByText(EXAMPLE_SOURCE_FILENAME)).toBeTruthy();
    expect(server.count("POST /api/sources")).toBe(1);
    // With a draft in the box the button has done its job and goes away.
    expect(screen.queryByRole("button", { name: "Try an example" })).toBeNull();
  });

  it("runs like any other check, through the normal upload and check path", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    await user.click(screen.getByRole("button", { name: "Try an example" }));
    await screen.findByText("Ready, 1 page");
    await checkAll(user);
    await screen.findByText("Check complete");
    expect(server.count("POST /api/runs")).toBe(1);
  });

  it("is not offered once the student has typed their own draft", async () => {
    await openApp(fakeServer());
    fill("My own paragraph (Author, 2020).", "");
    expect(screen.queryByRole("button", { name: "Try an example" })).toBeNull();
  });

  it("says so, and changes nothing, when the example cannot be loaded", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ exampleFails: true });
    await openApp(server);
    await user.click(screen.getByRole("button", { name: "Try an example" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load the example");
    expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe("");
    expect(server.count("POST /api/sources")).toBe(0);
    expect(screen.getByRole("button", { name: "Try an example" })).toBeTruthy(); // can try again
  });

  it("does not upload the example source twice if it is used again", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    await user.click(screen.getByRole("button", { name: "Try an example" }));
    await screen.findByText("Ready, 1 page");
    // Clear the draft so the button comes back, then press it again.
    fireEvent.change(screen.getByLabelText(/Text or Google Docs link/), { target: { value: "" } });
    await user.click(await screen.findByRole("button", { name: "Try an example" }));
    await waitFor(() => expect((screen.getByLabelText(/Text or Google Docs link/) as HTMLTextAreaElement).value).toBe(EXAMPLE_DRAFT));
    expect(server.count("POST /api/sources")).toBe(1);
  });
});

describe("starting a check", () => {
  it("starts only one run when the button is clicked several times in the same instant", async () => {
    const server = fakeServer();
    await openApp(server);
    fill();
    const button = screen.getByRole("button", { name: "Scan my draft" });
    // Three clicks in one tick, before React has re-rendered the button away. Native click() does not flush
    // React between clicks (fireEvent would), which is what makes this the same-instant case.
    button.click();
    button.click();
    button.click();
    fireEvent.click(await screen.findByRole("button", { name: /^Check \d+ cited claims?$/ }));
    await screen.findByText("Check complete");
    expect(server.count("POST /api/runs")).toBe(1);
  });

  it("keeps the start button disabled, and says why, until there is a draft", async () => {
    await openApp(fakeServer());
    const button = screen.getByRole("button", { name: "Scan my draft" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-describedby")).toBe("start-reason");
    expect(document.getElementById("start-reason")?.textContent).toBe("Add your draft to continue.");
  });
});

describe("reopening a check after a reload", () => {
  it("shows the last results, explains that a recheck needs the draft again, and offers no recheck", async () => {
    const server = fakeServer({ existingRun: true });
    await openApp(server, { lastRun: true });
    expect(await screen.findByText("Check complete")).toBeTruthy();
    // Reopening a finished check is not "the student just pressed Check", so focus must stay where it was.
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByText(/start a new check and paste your draft/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check again with my sources" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit draft" })).toBeNull();
  });

  it("starts fresh, with no error, when the remembered check no longer exists", async () => {
    const server = fakeServer();
    const original = server.fetchImpl;
    const gone = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/runs/run-1")) {
        return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found." } }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return original(input, init);
    };
    window.localStorage.setItem(CONSENT_KEY, "yes");
    window.localStorage.setItem(LAST_RUN_KEY, "run-1");
    vi.stubGlobal("fetch", gone);
    render(<VerifierApp />);
    expect(await screen.findByLabelText(/Text or Google Docs link/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.localStorage.getItem(LAST_RUN_KEY)).toBeNull();
  });
});
