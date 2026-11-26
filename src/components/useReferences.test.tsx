// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, type Api } from "@/lib/client/api";
import type { ReferenceSource, ReferenceSourceState } from "@/lib/client/types";
import { useReferences } from "./useReferences";

afterEach(cleanup);

const entry = (id: string, sourceState: ReferenceSourceState = "pending", extra: Partial<ReferenceSource> = {}): ReferenceSource => ({
  id, position: 1, text: id, title: `Title ${id}`, byline: "", refType: "journal", sourceState, documentId: null, candidate: null, ...extra,
});
const doc = { documentId: "doc-1", filename: "a.pdf", status: "ingesting" as const, pageCount: 5 };

function setup(list: ReferenceSource[], api: Partial<Api>) {
  const adopt = vi.fn(async () => "ready");
  const full = { listReferences: async () => list, ...api } as unknown as Api;
  const hook = renderHook(() => useReferences(full, "run-1", adopt));
  return { hook, adopt };
}

describe("useReferences", () => {
  it("looks every pending entry up, retrieves the matched ones into the sources list, and reports real counts", async () => {
    const results: Record<string, ReferenceSource> = {
      a: entry("a", "matched", { candidate: { title: "A", year: 2015, doi: null, venue: null, hasPdf: true } }),
      b: entry("b", "not_retrieved"),
      c: entry("c", "possible", { candidate: { title: "C", year: 2016, doi: null, venue: null, hasPdf: true } }),
    };
    const retrieve = vi.fn(async (_run: string, id: string) => ({ reference: entry(id, "retrieved", { documentId: "doc-1" }), document: doc }));
    const { hook, adopt } = setup([entry("a"), entry("b"), entry("c")], { discoverReference: async (_r, id) => results[id]!, retrieveReference: retrieve });
    await act(async () => {
      await hook.result.current.start();
    });
    expect(retrieve).toHaveBeenCalledTimes(1); // only the matched one: a possible match is never attached by itself
    expect(adopt).toHaveBeenCalledWith(doc);
    expect(hook.result.current.summary).toEqual({ total: 3, retrieved: 1, possible: 1, missing: 1, pending: 0 });
    expect(hook.result.current.running).toBe(false);
  });

  it("works two entries at a time", async () => {
    let active = 0;
    let peak = 0;
    const slow = async (_r: string, id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return entry(id, "not_retrieved");
    };
    const { hook } = setup([entry("a"), entry("b"), entry("c"), entry("d")], { discoverReference: slow });
    await act(async () => {
      await hook.result.current.start();
    });
    expect(peak).toBe(2);
    expect(hook.result.current.summary.missing).toBe(4);
  });

  it("tries a failed lookup once more, and leaves the entry pending if it still fails (nothing is guessed)", async () => {
    const discover = vi.fn(async () => {
      throw new ApiClientError(503, "lookup_failed", "later");
    });
    const { hook } = setup([entry("a")], { discoverReference: discover });
    vi.useFakeTimers();
    const run = act(async () => {
      const done = hook.result.current.start();
      await vi.advanceTimersByTimeAsync(2000);
      await done;
    });
    await run;
    vi.useRealTimers();
    expect(discover).toHaveBeenCalledTimes(2);
    expect(hook.result.current.summary.pending).toBe(1);
  });

  it("does not repeat work that is already saved, and starts a run only once", async () => {
    const discover = vi.fn(async (_r: string, id: string) => entry(id, "not_retrieved"));
    const { hook } = setup([entry("a", "retrieved", { documentId: "d" }), entry("b", "not_retrieved"), entry("c")], { discoverReference: discover });
    await act(async () => {
      hook.result.current.startOnce();
      hook.result.current.startOnce();
    });
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith("run-1", "c");
  });

  it("says the source limit was reached and keeps going with the rest", async () => {
    const retrieve = vi.fn(async () => {
      throw new ApiClientError(409, "too_many_documents", "limit");
    });
    const matched = (id: string) => entry(id, "matched", { candidate: { title: id, year: null, doi: null, venue: null, hasPdf: true } });
    const { hook } = setup([entry("a"), entry("b")], { discoverReference: async (_r, id) => matched(id), retrieveReference: retrieve });
    await act(async () => {
      await hook.result.current.start();
    });
    expect(hook.result.current.limit).toBe(true);
    expect(hook.result.current.running).toBe(false);
  });

  it("links a student's upload to its reference and hands the file to the sources list", async () => {
    const link = vi.fn(async (_r: string, id: string, documentId: string) => entry(id, "uploaded", { documentId }));
    const { hook, adopt } = setup([entry("a", "not_retrieved")], { upload: async () => ({ documentId: "up-1", status: "ingesting", pageCount: 3 }) as never, linkReference: link });
    await waitFor(() => expect(hook.result.current.refs).toHaveLength(1));
    await act(async () => {
      await hook.result.current.uploadFor("a", new File(["%PDF"], "mine.pdf"));
    });
    expect(link).toHaveBeenCalledWith("run-1", "a", "up-1");
    expect(adopt).toHaveBeenCalledWith({ documentId: "up-1", filename: "mine.pdf", status: "ingesting", pageCount: 3 });
    expect(hook.result.current.summary.retrieved).toBe(1);
  });
});
