"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "@/lib/client/api";
import { MAX_PDF_BYTES, MAX_SOURCES, megabytes } from "@/lib/client/limits";
import { messageOf } from "@/lib/client/run-verification";
import type { SourceView } from "@/lib/client/types";
import { useT } from "./LocaleProvider";

export type SourcePhase = "uploading" | "ingesting" | "ready" | "no_text" | "failed";

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
  const queue = useRef<Promise<void>>(Promise.resolve());
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
        for (const source of sources) if (source.status === "ingesting") void ingestUntilDone(source.id, source.id);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, ingestUntilDone]);

  const uploadOne = useCallback(
    async (file: File) => {
      const key = crypto.randomUUID();
      setRows((current) => [
        ...current,
        { key, id: null, filename: file.name, phase: "uploading", pagesIngested: 0, pageCount: null, error: null },
      ]);
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

  /** Adds PDFs one after another, refusing files the server would refuse, with a plain reason. */
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
      for (const file of accepted) queue.current = queue.current.then(() => uploadOne(file));
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

  const busy = rows.some((row) => row.phase === "uploading" || row.phase === "ingesting");
  const readyCount = rows.filter((row) => row.phase === "ready").length;

  return { rows, loaded, busy, readyCount, notice, addFiles, retryRow, remove };
}
