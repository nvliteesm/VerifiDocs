"use client";

// "Check my numbers": reads the figures each part of the draft reports (one short request per part, two at a time),
// compares them in the browser, and asks for the findings of different sections that may contradict. The answers are
// saved with the run, so a reload shows the last result and a repeat does not call the model again; "Check again"
// reads everything fresh. A different tool from checking claims against sources; it never changes a verdict.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "@/lib/client/api";
import { findInconsistencies, type FigureOccurrence, type InconsistentFigures } from "@/lib/client/consistency";
import type { ContradictionView } from "@/lib/client/types";

const CONCURRENCY = 2;

export type ConsistencyPhase = "idle" | "running" | "done" | "failed";

export function useConsistency(api: Api, runId: string | null, unitCount: number) {
  const [phase, setPhase] = useState<ConsistencyPhase>("idle");
  const [done, setDone] = useState(0);
  const [found, setFound] = useState<InconsistentFigures[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionView[]>([]);
  const [figureCount, setFigureCount] = useState(0);
  const token = useRef(0);
  // The client object may be a new one on every render; the effect below must run only when the run changes.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  // A different run (or none) starts fresh, then shows what was saved for it, if anything: a reload keeps the answer.
  useEffect(() => {
    const mine = ++token.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the results when the run changes
    setPhase("idle");
    setDone(0);
    setFound([]);
    setContradictions([]);
    setFigureCount(0);
    if (!runId) return;
    void (async () => {
      try {
        const saved = await apiRef.current.savedFigures(runId);
        if (token.current !== mine) return;
        // Only a complete answer is shown: a part never read means the comparison would be a partial one.
        if (saved.unitCount === 0 || saved.units.length < saved.unitCount || saved.units.some((unit) => unit.partial)) return;
        const all: FigureOccurrence[] = saved.units.flatMap((unit) => unit.figures.map((figure) => ({ ...figure, part: unit.unit })));
        setFigureCount(all.length);
        setFound(findInconsistencies(all));
        setContradictions(saved.contradictions ?? []);
        setPhase("done");
      } catch {
        // Nothing saved, or it could not be read: the student can run the check.
      }
    })();
  }, [runId]);

  const run = useCallback(async () => {
    if (!runId || unitCount === 0 || phase === "running") return;
    const refresh = phase === "done" || phase === "failed";
    const mine = ++token.current;
    setPhase("running");
    setDone(0);
    setFound([]);
    setContradictions([]);
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
            const reply = await api.readFigures(runId, unit, refresh);
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
    setPhase(failures === unitCount ? "failed" : "done");
    // The findings of different sections, compared once every part is read. If this fails the numbers still stand.
    if (failures === 0) {
      try {
        const pairs = await api.findContradictions(runId, refresh);
        if (token.current === mine) setContradictions(pairs);
      } catch {
        // Left out: it is an extra, and the numbers above are still true.
      }
    }
  }, [api, runId, unitCount, phase]);

  return { phase, done, total: unitCount, found, contradictions, figureCount, run };
}
