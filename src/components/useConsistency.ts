"use client";

// "Check my numbers": reads the figures each part of the draft reports (one short request per part, two at a time) and
// compares them in the browser. Nothing is stored: the answers live here until the run changes. A different tool from
// checking claims against sources; it never changes a verdict.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "@/lib/client/api";
import { findInconsistencies, type FigureOccurrence, type InconsistentFigures } from "@/lib/client/consistency";

const CONCURRENCY = 2;

export type ConsistencyPhase = "idle" | "running" | "done" | "failed";

export function useConsistency(api: Api, runId: string | null, unitCount: number) {
  const [phase, setPhase] = useState<ConsistencyPhase>("idle");
  const [done, setDone] = useState(0);
  const [found, setFound] = useState<InconsistentFigures[]>([]);
  const [figureCount, setFigureCount] = useState(0);
  const token = useRef(0);

  // A different run (or none) starts fresh.
  useEffect(() => {
    token.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the results when the run changes
    setPhase("idle");
    setDone(0);
    setFound([]);
    setFigureCount(0);
  }, [runId]);

  const run = useCallback(async () => {
    if (!runId || unitCount === 0 || phase === "running") return;
    const mine = ++token.current;
    setPhase("running");
    setDone(0);
    setFound([]);
    const all: FigureOccurrence[] = [];
    let failures = 0;
    const queue = Array.from({ length: unitCount }, (_, index) => index);
    const worker = async () => {
      for (;;) {
        const unit = queue.shift();
        if (unit === undefined || token.current !== mine) return;
        let read = false;
        // A part the model could not read is tried once more: it is usually busy, not broken.
        for (let attempt = 0; attempt < 2 && !read; attempt += 1) {
          try {
            const reply = await api.readFigures(runId, unit);
            if (token.current !== mine) return;
            all.push(...reply.figures.map((figure) => ({ ...figure, part: unit })));
            read = true;
          } catch {
            if (token.current !== mine) return;
          }
        }
        if (!read) failures += 1;
        if (token.current === mine) setDone((count) => count + 1);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (token.current !== mine) return;
    setFigureCount(all.length);
    setFound(findInconsistencies(all));
    // Some parts could not be read: say so, and still show what the others gave.
    setPhase(failures === unitCount ? "failed" : "done");
  }, [api, runId, unitCount, phase]);

  return { phase, done, total: unitCount, found, figureCount, run };
}
