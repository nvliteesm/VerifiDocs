// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Api } from "@/lib/client/api";
import type { SourceView } from "@/lib/client/types";
import { MAX_SOURCES } from "@/lib/client/limits";
import { useSources } from "./useSources";

afterEach(cleanup);

const serverSource = (id: string, filename: string): SourceView => ({
  id,
  filename,
  status: "ready",
  pageCount: 2,
  pagesIngested: 2,
  createdAt: "2026-11-18T00:00:00Z",
});

/** A fake API whose first source list arrives only when the test lets it. */
function fakeApi() {
  let releaseList: (sources: SourceView[]) => void = () => {};
  const api = {
    listSources: () => new Promise<SourceView[]>((resolve) => (releaseList = resolve)),
    upload: async () => ({ documentId: "d1", status: "ready" as const, pageCount: 2 }),
    ingest: async () => ({ documentId: "d1", status: "ready" as const, pagesIngested: 2, pageCount: 2, done: true }),
    deleteSource: async () => {},
  } as unknown as Api;
  return { api, releaseList: (sources: SourceView[]) => releaseList(sources) };
}

/** A fake API that holds each PDF in "reading" until the test lets it finish, and records how many run at once. */
function slowApi() {
  const uploads: string[] = [];
  const releases = new Map<string, () => void>();
  let active = 0;
  let peak = 0;
  const api = {
    listSources: async () => [],
    upload: async (file: File) => {
      uploads.push(file.name);
      active += 1;
      peak = Math.max(peak, active);
      return { documentId: `d-${file.name}`, status: "ingesting" as const, pageCount: 1 };
    },
    ingest: (id: string) =>
      new Promise((resolve) =>
        releases.set(id, () => {
          releases.delete(id);
          active -= 1;
          resolve({ documentId: id, status: "ready", pagesIngested: 1, pageCount: 1, done: true });
        }),
      ),
    deleteSource: async () => {},
  } as unknown as Api;
  const releaseAll = () => [...releases.values()].forEach((release) => release());
  return { api, uploads, releaseAll, reading: () => releases.size, peak: () => peak };
}

const pdf = (name: string) => new File(["x"], name, { type: "application/pdf" });

describe("useSources: several PDFs at once (UAT 23 Nov 2026: ten PDFs took 38 s one by one)", () => {
  it("shows every file at once, reads three at a time, and reads them all", async () => {
    const { api, releaseAll, reading, peak } = slowApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map(pdf)));

    expect(result.current.rows.map((row) => row.filename)).toEqual(["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"]);
    await waitFor(() => expect(reading()).toBe(3));
    expect(result.current.rows.filter((row) => row.phase === "waiting").map((row) => row.filename)).toEqual(["d.pdf", "e.pdf"]);
    expect(result.current.busy).toBe(true);

    for (let round = 0; round < 3 && result.current.rows.some((row) => row.phase !== "ready"); round += 1) {
      await act(async () => releaseAll());
      await waitFor(() => expect(reading() > 0 || result.current.rows.every((row) => row.phase === "ready")).toBe(true));
    }
    await waitFor(() => expect(result.current.rows.every((row) => row.phase === "ready")).toBe(true));
    expect(peak()).toBe(3);
    expect(result.current.busy).toBe(false);
  });

  it("counts files still waiting toward the source limit", async () => {
    const { api } = slowApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles(Array.from({ length: MAX_SOURCES - 2 }, (_, i) => pdf(`f${i}.pdf`))));
    act(() => result.current.addFiles(["x.pdf", "y.pdf", "z.pdf"].map(pdf)));
    expect(result.current.rows).toHaveLength(MAX_SOURCES);
    expect(result.current.notice).toMatch(/z\.pdf/);
  });

  it("removes a waiting file without ever uploading it", async () => {
    const { api, uploads } = slowApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles(["a.pdf", "b.pdf", "c.pdf", "d.pdf"].map(pdf)));
    const waiting = result.current.rows.find((row) => row.filename === "d.pdf")!;
    expect(waiting.phase).toBe("waiting");
    await act(async () => result.current.remove(waiting));
    expect(result.current.rows.map((row) => row.filename)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    await waitFor(() => expect(uploads).toHaveLength(3));
    expect(uploads).not.toContain("d.pdf");
  });
});

describe("useSources: a file added before the first list arrives", () => {
  it("stays on screen when the list arrives empty", async () => {
    const { api, releaseList } = fakeApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles([new File(["x"], "report.pdf", { type: "application/pdf" })]));
    await waitFor(() => expect(result.current.rows[0]?.phase).toBe("ready"));

    await act(async () => releaseList([]));
    expect(result.current.loaded).toBe(true);
    expect(result.current.rows.map((row) => row.filename)).toEqual(["report.pdf"]);
  });

  it("is not shown twice when the list arrives with the same file", async () => {
    const { api, releaseList } = fakeApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles([new File(["x"], "report.pdf", { type: "application/pdf" })]));
    await waitFor(() => expect(result.current.rows[0]?.phase).toBe("ready"));

    await act(async () => releaseList([serverSource("d1", "report.pdf")]));
    expect(result.current.rows.map((row) => row.filename)).toEqual(["report.pdf"]);
  });

  it("still lists files from an earlier visit next to the new one", async () => {
    const { api, releaseList } = fakeApi();
    const { result } = renderHook(() => useSources(api));
    act(() => result.current.addFiles([new File(["x"], "new.pdf", { type: "application/pdf" })]));
    await waitFor(() => expect(result.current.rows[0]?.phase).toBe("ready"));

    await act(async () => releaseList([serverSource("old", "old.pdf")]));
    expect(result.current.rows.map((row) => row.filename).sort()).toEqual(["new.pdf", "old.pdf"]);
  });
});
