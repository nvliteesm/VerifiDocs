// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Api } from "@/lib/client/api";
import type { SourceView } from "@/lib/client/types";
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
