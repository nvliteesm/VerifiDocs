"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ApiClientError, type Api } from "@/lib/client/api";
import { checkCited, resumeVerification, retryClaim, retryPart, runVerification } from "@/lib/client/run-verification";
import type { VerifyInput } from "@/lib/client/types";
import { initialState, reduce, type VerifyEvent } from "@/lib/client/verifier-state";
import type { Translate } from "@/lib/i18n";
import { useT } from "./LocaleProvider";
import { LAST_RUN_KEY, readStored, writeStored } from "./storage";

/** Wires the tested orchestrator (run-verification.ts) to React state. Only one check runs at a time. */
export function useVerification(api: Api) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const controller = useRef<AbortController | null>(null);
  // Messages (progress lines, errors) use the language chosen at the moment each one is produced. The callbacks
  // below must not change when the language does, so the translator is read from a ref.
  const { t, locale } = useT();
  const latest = useRef({ t, locale });
  useEffect(() => {
    latest.current = { t, locale };
  });
  const deps = useMemo(
    () => ({
      api,
      t: ((key, params) => latest.current.t(key, params)) as Translate,
      get locale() {
        return latest.current.locale;
      },
    }),
    [api],
  );

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

  /** Reads a part of the draft the AI could not read before. Resolves when the results have been read again. */
  const readPart = useCallback(
    (unit: number) => (state.runId ? retryPart(deps, state.runId, unit, dispatch, nextSignal()) : Promise.resolve()),
    [deps, nextSignal, state.runId],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    writeStored(LAST_RUN_KEY, null);
    dispatch({ type: "reset" });
  }, []);

  /** Starts the check of the cited claims the scan left waiting. */
  const check = useCallback(() => {
    if (!state.runId) return;
    void checkCited(deps, state.runId, dispatch, nextSignal());
  }, [deps, nextSignal, state.runId]);

  /** Stops a running check. Claims already being checked on the server finish; no new ones are started. */
  const stop = useCallback(() => {
    controller.current?.abort();
    dispatch({ type: "stopped" });
  }, []);

  /**
   * Deletes the current check on the server now, then clears it from the screen. Returns false, leaving
   * everything as it was, if the server could not delete it, so the student is never told it is gone when it is not.
   */
  const deleteCheck = useCallback(async (): Promise<boolean> => {
    const runId = state.runId;
    if (!runId) return true;
    try {
      await api.deleteRun(runId);
    } catch (error) {
      // Already gone (for example deleted in another tab): the result the student wanted.
      if (!(error instanceof ApiClientError && error.status === 404)) return false;
    }
    controller.current?.abort();
    writeStored(LAST_RUN_KEY, null);
    dispatch({ type: "reset" });
    return true;
  }, [api, state.runId]);

  // Remember the latest check, so a reload can reopen it (a check is kept for 30 days).
  useEffect(() => {
    if (state.runId) writeStored(LAST_RUN_KEY, state.runId);
  }, [state.runId]);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, start, check, resume, retry, readPart, reset, stop, deleteCheck, lastRunId: () => readStored(LAST_RUN_KEY) };
}
