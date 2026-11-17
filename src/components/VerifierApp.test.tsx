// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimView, RunResponse } from "@/lib/client/types";
import { CONSENT_KEY, LAST_RUN_KEY } from "./storage";
import { VerifierApp } from "./VerifierApp";

/** A fake server behind `fetch`: just enough of the API for one claim to go from pasted text to a verdict. */
function fakeServer(options: { failCreate?: boolean; existingRun?: boolean } = {}) {
  const log: string[] = [];
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
    if (method === "POST" && url === "/api/runs") {
      if (options.failCreate) return json(500, { error: { code: "internal", message: "Something went wrong on our side." } });
      checked = false;
      return json(201, { runId: "run-1", status: "extracting", unitCount: 1, referenceCount: 0 });
    }
    if (method === "POST" && url === "/api/runs/run-1/extract") {
      return json(200, { unit: 0, alreadyExtracted: false, claimsAdded: 1, status: "checking", unitCount: 1, unitsExtracted: 1, claimCount: 1 });
    }
    if (method === "GET" && url === "/api/runs/run-1") return json(200, run());
    if (method === "POST" && url === "/api/claims/c1/check") {
      checked = true;
      return json(200, {
        outcome: "done",
        runCompleted: true,
        verdict: { claimId: "c1", verdict: "supported", quote: "International trade rose 5 percent.", page: 1, reason: "The passage says so.", exitStage: 7, fixSuggestion: null },
      });
    }
    if (method === "POST" && url === "/api/events") return new Response(null, { status: 204 });
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return { fetchImpl, log, count: (entry: string) => log.filter((line) => line === entry).length };
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

describe("privacy notice", () => {
  it("blocks the form until the student acknowledges it", async () => {
    vi.stubGlobal("fetch", fakeServer().fetchImpl);
    const user = userEvent.setup();
    render(<VerifierApp />);
    expect(await screen.findByText("What happens to your files")).toBeTruthy();
    expect(screen.queryByLabelText(/Draft text/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "I understand, continue" }));
    expect(await screen.findByLabelText(/Draft text/)).toBeTruthy();
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("yes");
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

  it("shows the verdict, the quote disclosure and the one-question survey", async () => {
    await finishedCheck();
    expect(screen.getAllByText("Every checked claim is supported.").length).toBeGreaterThan(0);
    expect(screen.getByText("International trade rose 5 percent")).toBeTruthy();
    expect(screen.getByText("One question")).toBeTruthy();
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
