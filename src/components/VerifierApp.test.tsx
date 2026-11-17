// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_DRAFT, EXAMPLE_REFERENCES, EXAMPLE_SOURCE_FILENAME, EXAMPLE_SOURCE_URL } from "@/lib/client/example";
import type { ClaimView, RunResponse } from "@/lib/client/types";
import { CONSENT_KEY, LAST_RUN_KEY } from "./storage";
import { VerifierApp } from "./VerifierApp";

/** A fake server behind `fetch`: just enough of the API for one claim to go from pasted text to a verdict. */
function fakeServer(
  options: { failCreate?: boolean; existingRun?: boolean; hangChecks?: boolean; deleteStatus?: number; exampleFails?: boolean } = {},
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
    claims: [claim()],
    references: [],
  });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    const method = init?.method ?? "GET";
    log.push(`${method} ${url}`);
    if (method === "GET" && url === "/api/sources") return json(200, { sources: [] });
    if (method === "GET" && url === EXAMPLE_SOURCE_URL) {
      return options.exampleFails ? new Response("nope", { status: 500 }) : new Response(new Blob(["%PDF-1.4 example"]), { status: 200 });
    }
    if (method === "POST" && url === "/api/sources") return json(201, { documentId: "doc-ex", status: "ingesting", pageCount: 1 });
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

const DRAFT = "International trade rose 5 percent (Vaswani et al., 2017).";
const REFS = "Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS.";

async function openApp(server: ReturnType<typeof fakeServer>, opts: { lastRun?: boolean } = {}) {
  window.localStorage.setItem(CONSENT_KEY, "yes");
  if (opts.lastRun) window.localStorage.setItem(LAST_RUN_KEY, "run-1");
  vi.stubGlobal("fetch", server.fetchImpl);
  render(<VerifierApp />);
  return screen.findByLabelText(/Draft text/).catch(() => null);
}

function fill(draft = DRAFT, refs = REFS) {
  fireEvent.change(screen.getByLabelText(/Draft text/), { target: { value: draft } });
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
    expect(await screen.findByLabelText(/Draft text/)).toBeTruthy(); // the product is not hidden behind the note
    expect(screen.getByRole("button", { name: "Try an example" })).toHaveProperty("disabled", true); // hidden once a draft is typed
    expect(screen.getByRole("button", { name: "Choose PDFs" })).toHaveProperty("disabled", true);
    fill();
    expect(screen.getByRole("button", { name: "Check my claims" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Before you start")).toBeNull();
    expect(screen.getByRole("button", { name: "Check my claims" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Choose PDFs" })).toHaveProperty("disabled", false);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("yes");
  });

  it("puts the draft before the sources in the page, so a phone shows the draft first", async () => {
    await openApp(fakeServer());
    const draft = screen.getByLabelText(/Draft text/);
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));

    expect(await screen.findByText("Check stopped")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong on our side.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit draft" }));
    expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe(DRAFT);
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe(REFS);
    expect(screen.getByRole("button", { name: "Check my claims" })).toHaveProperty("disabled", false);
  });

  it("Try again sends the same draft again", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ failCreate: true });
    await openApp(server);
    fill();
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe(DRAFT);
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe(REFS);
  });

  it("Start a new check clears the draft", async () => {
    const { user } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Start a new check" }));
    expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(/Reference list/) as HTMLTextAreaElement).value).toBe("");
  });

  it("Check again runs the same draft again", async () => {
    const { user, server } = await finishedCheck();
    await user.click(screen.getByRole("button", { name: "Check again with my sources" }));
    await waitFor(() => expect(server.count("POST /api/runs")).toBe(2));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
    await user.click(await screen.findByRole("button", { name: "Stop checking" }));
    await screen.findByText("Check stopped by you");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Results" }));
  });

  it("does not show Stop once the check has finished", async () => {
    const user = userEvent.setup();
    await openApp(fakeServer());
    fill();
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
    await screen.findByText("Check complete");
    expect(screen.queryByRole("button", { name: "Stop checking" })).toBeNull();
  });
});

describe("deleting a check", () => {
  async function finishedCheck(server = fakeServer()) {
    const user = userEvent.setup();
    await openApp(server);
    fill();
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe(""); // the draft is gone too
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    expect(document.activeElement).toBe(screen.getByLabelText(/Draft text/));

    fireEvent.click(screen.getByRole("button", { name: "Check my claims" }));
    await screen.findByText("Check complete");
    await user.click(screen.getByRole("button", { name: "Start a new check" }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Draft text/));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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

describe("Try an example", () => {
  it("is offered while the draft is empty, and fills the draft, the reference list and the source", async () => {
    const user = userEvent.setup();
    const server = fakeServer();
    await openApp(server);
    expect(screen.getByText(/made-up report and draft/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try an example" }));

    await waitFor(() => expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe(EXAMPLE_DRAFT));
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
    await user.click(screen.getByRole("button", { name: "Check my claims" }));
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
    expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe("");
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
    fireEvent.change(screen.getByLabelText(/Draft text/), { target: { value: "" } });
    await user.click(await screen.findByRole("button", { name: "Try an example" }));
    await waitFor(() => expect((screen.getByLabelText(/Draft text/) as HTMLTextAreaElement).value).toBe(EXAMPLE_DRAFT));
    expect(server.count("POST /api/sources")).toBe(1);
  });
});

describe("starting a check", () => {
  it("starts only one run when the button is clicked several times in the same instant", async () => {
    const server = fakeServer();
    await openApp(server);
    fill();
    const button = screen.getByRole("button", { name: "Check my claims" });
    // Three clicks in one tick, before React has re-rendered the button away. Native click() does not flush
    // React between clicks (fireEvent would), which is what makes this the same-instant case.
    button.click();
    button.click();
    button.click();
    await screen.findByText("Check complete");
    expect(server.count("POST /api/runs")).toBe(1);
  });

  it("keeps the start button disabled, and says why, until there is a draft", async () => {
    await openApp(fakeServer());
    const button = screen.getByRole("button", { name: "Check my claims" });
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
    expect(await screen.findByLabelText(/Draft text/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.localStorage.getItem(LAST_RUN_KEY)).toBeNull();
  });
});
