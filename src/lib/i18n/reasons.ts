// The fixed reasons the server writes (for example `"Smith 2019" is not in your reference list.`) are stored in
// English. This turns them into the screen's language when the screen is not English.
//
// It recognises each one by building a pattern from the English template in messages.ts, so the server's text and
// the pattern cannot drift apart without a test failing. A reason it does not recognise is returned unchanged: that
// is the reason the AI wrote, which is already in the language of the claim.
import { MESSAGES, type MessageKey } from "./messages";
import type { Params, Translate } from "./index";

interface Matcher {
  key: MessageKey;
  regex: RegExp;
  names: string[];
}

function matcherFor(key: MessageKey): Matcher {
  const names: string[] = [];
  const source = MESSAGES.en[key]
    .split(/(\{\w+\})/)
    .map((part) => {
      const placeholder = /^\{(\w+)\}$/.exec(part);
      if (placeholder) {
        names.push(placeholder[1]!);
        return "(.+?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return { key, regex: new RegExp(`^${source}$`, "s"), names };
}

const WHOLE_REASONS: MessageKey[] = [
  "reason.noCitation",
  "reason.unreadableCitation",
  "reason.noReferenceList",
  "reason.notInList",
  "reason.notOnline",
  "reason.noText",
  "reason.noUploadedMatch",
  "reason.noPassages",
];
const DETAILS: MessageKey[] = [
  "reason.detail.unreachable",
  "reason.detail.http",
  "reason.detail.unexpected",
  "reason.detail.unreadable",
];

const whole = WHOLE_REASONS.map(matcherFor);
const details = DETAILS.map(matcherFor);
const attempts = matcherFor("reason.attempts");

function paramsOf(matcher: Matcher, match: RegExpExecArray): Params {
  return Object.fromEntries(matcher.names.map((name, index) => [name, match[index + 1]!]));
}

function translateWith(matchers: Matcher[], text: string, t: Translate): string | null {
  for (const matcher of matchers) {
    const match = matcher.regex.exec(text);
    if (match) return t(matcher.key, paramsOf(matcher, match));
  }
  return null;
}

export function localizeReason(reason: string, t: Translate): string {
  const direct = translateWith(whole, reason, t);
  if (direct) return direct;

  // "The check could not be completed after 3 attempts: Crossref returned HTTP 429; OpenAlex could not be reached"
  const retried = attempts.regex.exec(reason);
  if (retried) {
    const parts = retried[2]!.split("; ").map((detail) => translateWith(details, detail, t) ?? detail);
    return t("reason.attempts", { n: retried[1]!, detail: parts.join("; ") });
  }
  return reason;
}
