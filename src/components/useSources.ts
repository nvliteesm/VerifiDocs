"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "@/lib/client/api";
import { MAX_PDF_BYTES, MAX_SOURCES, megabytes } from "@/lib/client/limits";
import { createLimiter } from "@/lib/client/pool";
import { messageOf } from "@/lib/client/run-verification";
import type { SourceView } from "@/lib/client/types";
import { useT } from "./LocaleProvider";

/** "waiting": added, but its turn to upload has not come yet (at most INGEST_CONCURRENCY run at once). */
export type SourcePhase = "waiting" | "uploading" | "ingesting" | "ready" | "no_text" | "failed";

/**
 * How many PDFs upload and read at once. One at a time took 38 s for ten PDFs in the UAT of 23 Nov 2026; three keeps
 * the server's model budget and the database connections comfortable.
 */
export const INGEST_CONCURRENCY = 3;

export interface SourceRow {
  /** A key that is stable while the row is on screen, before and after the server gives it an id. */
  key: string;
  id: string | null;
  filename: string;
  phase: SourcePhase;
  pagesIngested: number;
  pageCount: number | null;
  error: string | null;
}

function rowOf(source: SourceView, failedText: string): SourceRow {
  return {
    key: source.id,
    id: source.id,
    filename: source.filename,
    phase: source.status === "failed" ? "failed" : source.status,
    pagesIngested: source.pagesIngested,
    pageCount: source.pageCount,
    error: source.status === "failed" ? failedText : null,
  };
}

/** The student's source PDFs: upload, read page by page until done, list, remove. Picks up unfinished ones after a reload. */
export function useSources(api: Api) {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const limit = useRef(createLimiter(INGEST_CONCURRENCY));
  /** Rows removed while still waiting: their upload must never start. */
  const removed = useRef(new Set<string>());
  const rowsRef = useRef<SourceRow[]>([]);
  rowsRef.current = rows;

  const { t, locale } = useT();
  // The callbacks below must not change when the language does (the list load would run again), so they read the
  // latest translator from this ref.
  const latest = useRef({ t, locale });
  useEffect(() => {
    latest.current = { t, locale };
  });
  const describe = useCallback((error: unknown) => messageOf(error, latest.current.t, latest.current.locale), []);

  const update = useCallback((key: string, patch: Partial<SourceRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  /** Ingests until the server says done. Safe to call again after a failure: the server resumes where it stopped. */
  const ingestUntilDone = useCallback(
    async (key: string, id: string) => {
      update(key, { phase: "ingesting", error: null });
      try {
        for (;;) {
          const progress = await api.ingest(id);
          update(key, {
            pagesIngested: progress.pagesIngested,
            pageCount: progress.pageCount,
            phase: progress.done ? progress.status : "ingesting",
          });
          if (progress.done) return;
        }
      } catch (error) {
        update(key, { phase: "failed", error: describe(error) });
      }
    },
    [api, update, describe],
  );

  useEffect(() => {
    let cancelled = false;
    api
      .listSources()
      .then((sources) => {
        if (cancelled) return;
        // Merge, do not replace: a student can add a file before this list arrives, and that row must stay.
        setRows((current) => {
          const known = new Set(current.map((row) => row.id).filter(Boolean));
          const fromServer = sources.filter((source) => !known.has(source.id)).map((source) => rowOf(source, latest.current.t("src.failedSource")));
          return [...fromServer, ...current];
        });
        setLoaded(true);
        // PDFs still being read when the page was closed carry on, through the same limit as new ones.
        for (const source of sources) {
          if (source.status === "ingesting") void limit.current(() => ingestUntilDone(source.id, source.id));
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ingestUntilDone]);

  /** Runs when this file's turn comes. Its row is already on screen, as "waiting". */
  const uploadOne = useCallback(
    async (key: string, file: File) => {
      if (removed.current.has(key)) return;
      update(key, { phase: "uploading" });
      try {
        const uploaded = await api.upload(file);
        update(key, { id: uploaded.documentId, pageCount: uploaded.pageCount, phase: uploaded.status });
        if (uploaded.status === "ingesting") await ingestUntilDone(key, uploaded.documentId);
      } catch (error) {
        update(key, { phase: "failed", error: describe(error) });
      }
    },
    [api, ingestUntilDone, update, describe],
  );

  /**
   * Adds PDFs, refusing files the server would refuse, with a plain reason. Every accepted file shows at once as
   * "waiting" (so the limit of 10 counts it straight away), and up to INGEST_CONCURRENCY upload and read at once.
   */
  const addFiles = useCallback(
    (files: File[]) => {
      setNotice(null);
      const accepted: File[] = [];
      const problems: string[] = [];
      let room = MAX_SOURCES - rowsRef.current.length;
      for (const file of files) {
        const say = latest.current.t;
        if (!/\.pdf$/i.test(file.name)) problems.push(say("src.problem.notPdf", { name: file.name }));
        else if (file.size > MAX_PDF_BYTES) problems.push(say("src.problem.size", { name: file.name, size: megabytes(MAX_PDF_BYTES) }));
        else if (room <= 0) problems.push(say("src.problem.max", { max: MAX_SOURCES, name: file.name }));
        else {
          accepted.push(file);
          room -= 1;
        }
      }
      if (problems.length > 0) setNotice(problems.join(" "));
      const added: SourceRow[] = accepted.map((file) => ({
        key: crypto.randomUUID(),
        id: null,
        filename: file.name,
        phase: "waiting",
        pagesIngested: 0,
        pageCount: null,
        error: null,
      }));
      // Counted at once, before the next render, so files added again straight away cannot pass the limit.
      rowsRef.current = [...rowsRef.current, ...added];
      setRows((current) => [...current, ...added]);
      added.forEach((row, index) => void limit.current(() => uploadOne(row.key, accepted[index]!)));
    },
    [uploadOne],
  );

  const retryRow = useCallback(
    (row: SourceRow) => {
      if (row.id) void ingestUntilDone(row.key, row.id);
    },
    [ingestUntilDone],
  );

  const remove = useCallback(
    async (row: SourceRow) => {
      removed.current.add(row.key);
      try {
        if (row.id) await api.deleteSource(row.id);
      } catch (error) {
        // A source that is already gone (404) is the outcome the student wanted. Anything else is shown.
        if (!(error instanceof Error && "status" in error && (error as { status?: number }).status === 404)) {
          update(row.key, { error: describe(error) });
          return;
        }
      }
      setRows((current) => current.filter((r) => r.key !== row.key));
    },
    [api, update, describe],
  );

  const busy = rows.some((row) => row.phase === "waiting" || row.phase === "uploading" || row.phase === "ingesting");
  const readyCount = rows.filter((row) => row.phase === "ready").length;

  /**
   * Takes over a document the server made from a found paper ("Check my claim against it"): shows it in the list and
   * reads it until done. Resolves with how it ended, so the claim check runs only after the paper has been read.
   */
  const adopt = useCallback(
    async (doc: { documentId: string; filename: string; status: SourceView["status"]; pageCount: number }): Promise<SourcePhase> => {
      const known = rowsRef.current.find((row) => row.id === doc.documentId);
      if (known && known.phase !== "ingesting" && known.phase !== "failed") return known.phase;
      const key = known?.key ?? doc.documentId;
      if (!known) {
        setRows((current) => [
          ...current,
          { key, id: doc.documentId, filename: doc.filename, phase: doc.status, pagesIngested: 0, pageCount: doc.pageCount, error: null },
        ]);
      }
      if (doc.status !== "ingesting" && !known) return doc.status;
      try {
        for (;;) {
          const progress = await api.ingest(doc.documentId);
          update(key, { pagesIngested: progress.pagesIngested, pageCount: progress.pageCount, phase: progress.done ? progress.status : "ingesting" });
          if (progress.done) return progress.status;
        }
      } catch (error) {
        update(key, { phase: "failed", error: describe(error) });
        return "failed";
      }
    },
    [api, update, describe],
  );

  return { rows, loaded, busy, readyCount, notice, addFiles, retryRow, remove, adopt };
}
