"use client";

// Finds the source files for a run's reference list, in the browser, one short request per reference (two at a time),
// the same way claims are checked: nothing runs long on the server. A matched reference has its PDF fetched and handed
// to the sources list, which reads it like an upload; a look-alike waits for the student's yes or no; the rest wait for
// an upload. Work already done is saved on the server, so a reload or a second press never repeats it.
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, type Api } from "@/lib/client/api";
import { entriesToWorkOn, summarizeReferences } from "@/lib/client/references";
import type { ReferenceSource, SourceView } from "@/lib/client/types";

type Adopt = (doc: { documentId: string; filename: string; status: SourceView["status"]; pageCount: number }) => Promise<unknown>;

const CONCURRENCY = 2;
const RETRY_AFTER_MS = 1500;

export function useReferences(api: Api, runId: string | null, adopt: Adopt) {
  const [refs, setRefs] = useState<ReferenceSource[]>([]);
  const [running, setRunning] = useState(false);
  /** A plain note for the student, such as the source limit being reached. */
  const [limit, setLimit] = useState(false);
  const refsRef = useRef<ReferenceSource[]>([]);
  const token = useRef(0);
  const startedFor = useRef<string | null>(null);

  const put = useCallback((next: ReferenceSource) => {
    refsRef.current = refsRef.current.map((ref) => (ref.id === next.id ? next : ref));
    setRefs(refsRef.current);
  }, []);

  // The list for the run on screen. A different run (or none) starts fresh.
  useEffect(() => {
    token.current += 1;
    startedFor.current = null;
    refsRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the list when the run changes
    setRefs([]);
    setRunning(false);
    setLimit(false);
    if (!runId) return;
    const mine = token.current;
    api
      .listReferences(runId)
      .then((list) => {
        if (token.current !== mine) return;
        refsRef.current = list;
        setRefs(list);
      })
      .catch(() => undefined);
  }, [api, runId]);

  /** Fetches a matched entry's PDF and hands it to the sources list. A failure leaves the entry for an upload. */
  const retrieve = useCallback(
    async (id: string, mine: number) => {
      if (!runId) return;
      try {
        const reply = await api.retrieveReference(runId, id);
        if (token.current !== mine) return;
        put(reply.reference);
        if (reply.document) void adopt(reply.document);
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "too_many_documents") setLimit(true);
      }
    },
    [api, runId, adopt, put],
  );

  const one = useCallback(
    async (entry: ReferenceSource, mine: number) => {
      if (!runId) return;
      let current = entry;
      if (current.sourceState === "pending") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            current = await api.discoverReference(runId, entry.id);
            if (token.current !== mine) return;
            put(current);
            break;
          } catch {
            if (token.current !== mine) return;
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
          }
        }
      }
      if (current.sourceState === "matched") await retrieve(entry.id, mine);
    },
    [api, runId, put, retrieve],
  );

  /** Works through every entry that is not settled, two at a time. */
  const start = useCallback(async () => {
    if (!runId || running) return;
    startedFor.current = runId;
    const mine = token.current;
    setRunning(true);
    try {
      const fresh = await api.listReferences(runId).catch(() => refsRef.current);
      if (token.current !== mine) return;
      refsRef.current = fresh;
      setRefs(fresh);
      const queue = entriesToWorkOn(fresh);
      const worker = async () => {
        for (;;) {
          const next = queue.shift();
          if (!next || token.current !== mine) return;
          await one(next, mine);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      if (token.current === mine) setRunning(false);
    }
  }, [api, runId, running, one]);

  /** Starts once per run, however many times it is asked (a re-render, a second effect). */
  const startOnce = useCallback(() => {
    if (runId && startedFor.current !== runId) void start();
  }, [runId, start]);

  const confirm = useCallback(
    async (id: string, accept: boolean) => {
      if (!runId) return;
      const mine = token.current;
      const next = await api.confirmReference(runId, id, accept);
      put(next);
      if (accept && next.sourceState === "matched") await retrieve(id, mine);
    },
    [api, runId, put, retrieve],
  );

  /** The student's own PDF for one entry: uploaded, linked to the entry, and read like any source. */
  const uploadFor = useCallback(
    async (id: string, file: File) => {
      if (!runId) return;
      const uploaded = await api.upload(file);
      const linked = await api.linkReference(runId, id, uploaded.documentId);
      put(linked);
      void adopt({ documentId: uploaded.documentId, filename: file.name, status: uploaded.status, pageCount: uploaded.pageCount });
    },
    [api, runId, adopt, put],
  );

  const summary = summarizeReferences(refs);
  return { refs, summary, running, limit, start, startOnce, confirm, uploadFor };
}
