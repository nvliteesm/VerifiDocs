"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { Api } from "@/lib/client/api";
import { resumeVerification, retryClaim, runVerification } from "@/lib/client/run-verification";
import type { VerifyInput } from "@/lib/client/types";
import { initialState, reduce, type VerifyEvent } from "@/lib/client/verifier-state";
import { LAST_RUN_KEY, readStored, writeStored } from "./storage";

/** Wires the tested orchestrator (run-verification.ts) to React state. Only one check runs at a time. */
export function useVerification(api: Api) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const controller = useRef<AbortController | null>(null);
  const deps = useMemo(() => ({ api }), [api]);

  /** Stops any check in progress and returns the signal for the next one. */
  const nextSignal = useCallback(() => {
    controller.current?.abort();
    const fresh = new AbortController();
    controller.current = fresh;
    return fresh.signal;
  }, []);

  const start = useCallback(
    (input: VerifyInput) => {
      const signal = nextSignal();
      dispatch({ type: "reset" });
      void runVerification(deps, input, dispatch, signal);
    },
    [deps, nextSignal],
  );

  /** Reopens a check. When `quiet`, a run that no longer exists just clears the stored id instead of showing an error. */
  const resume = useCallback(
    (runId: string, quiet = false) => {
      const signal = nextSignal();
      const emit = (event: VerifyEvent) => {
        if (quiet && event.type === "failed") {
          writeStored(LAST_RUN_KEY, null);
          dispatch({ type: "reset" });
          return;
        }
        dispatch(event);
      };
      void resumeVerification(deps, runId, emit, signal);
    },
    [deps, nextSignal],
  );

  const retry = useCallback(
    (claimId: string) => {
      if (!state.runId) return;
      void retryClaim(deps, state.runId, claimId, dispatch, nextSignal());
    },
    [deps, nextSignal, state.runId],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    writeStored(LAST_RUN_KEY, null);
    dispatch({ type: "reset" });
  }, []);

  // Remember the latest check, so a reload can reopen it (a check is kept for 30 days).
  useEffect(() => {
    if (state.runId) writeStored(LAST_RUN_KEY, state.runId);
  }, [state.runId]);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, start, resume, retry, reset, lastRunId: () => readStored(LAST_RUN_KEY) };
}
