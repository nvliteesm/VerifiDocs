"use client";

// "This verdict is wrong": the student picks one reason from a fixed list (never free text, so nothing typed can leave
// the page). Moved out of ClaimCard; the focus handling is the same.
import { useEffect, useRef, useState } from "react";
import type { FlagReason } from "@/lib/flag-reasons";
import type { MessageKey } from "@/lib/i18n";
import type { ClaimView } from "@/lib/client/types";
import { useT } from "./LocaleProvider";

/** The reasons that make sense for this verdict. A quote-based reason is offered only when there is a quote. */
export function reasonsFor(claim: ClaimView): FlagReason[] {
  const verdict = claim.verdict;
  const judged = verdict === "supported" || verdict === "partial" || verdict === "contradicted" || verdict === "not_in_sources" || verdict === "cant_tell";
  const noSourceMatch = verdict === "cant_check" || verdict === "reference_not_found" || verdict === "not_in_sources";
  return [
    ...(claim.quote ? (["quote_does_not_support", "wrong_page"] as const) : []),
    ...(judged ? (["source_says_otherwise"] as const) : []),
    "claim_misread",
    ...(noSourceMatch ? (["source_was_uploaded"] as const) : []),
    "other",
  ];
}

interface Props {
  claim: ClaimView;
  flagged: boolean;
  onFlag: (reason: FlagReason) => void;
}

export function FlagVerdict({ claim, flagged, onFlag }: Props) {
  const { t } = useT();
  // After "This verdict is wrong", the student picks a reason. The button they pressed has left the page, so focus
  // goes to the first reason, and then to the thank-you line once they choose.
  const [asking, setAsking] = useState(false);
  const firstReason = useRef<HTMLButtonElement>(null);
  const thanks = useRef<HTMLParagraphElement>(null);
  const justChose = useRef(false);
  const flagButton = useRef<HTMLButtonElement>(null);
  const backedOut = useRef(false);
  useEffect(() => {
    if (asking) firstReason.current?.focus();
    // "Never mind" removes the reasons, so put focus back on the button the student started from.
    if (!asking && backedOut.current) {
      backedOut.current = false;
      flagButton.current?.focus();
    }
  }, [asking]);
  useEffect(() => {
    if (flagged && justChose.current) {
      justChose.current = false;
      thanks.current?.focus();
    }
  }, [flagged]);

  if (flagged) {
    return (
      <p className="hint claim-foot" role="status" ref={thanks} tabIndex={-1}>
        {t("flag.thanks")}
      </p>
    );
  }
  if (asking) {
    return (
      <div className="flag-reasons claim-foot" role="group" aria-label={t("flag.group")}>
        <p className="hint">{t("flag.ask")}</p>
        <div className="chips">
          {reasonsFor(claim).map((reason, index) => (
            <button
              key={reason}
              type="button"
              className="chip"
              ref={index === 0 ? firstReason : undefined}
              onClick={() => {
                justChose.current = true;
                setAsking(false);
                onFlag(reason);
              }}
            >
              {t(`flag.${reason}` as MessageKey)}
            </button>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => {
              backedOut.current = true;
              setAsking(false);
            }}
          >
            {t("flag.cancel")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="claim-foot">
      <button type="button" className="link" ref={flagButton} onClick={() => setAsking(true)}>
        {t("flag.button")}
      </button>
    </div>
  );
}
