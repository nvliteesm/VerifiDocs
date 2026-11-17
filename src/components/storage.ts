// localStorage that never throws. It is used only for per-viewer conveniences (whether the privacy notice was
// acknowledged, and the id of the last check so a reload can reopen it). It can be empty, blocked or throwing in a
// private window, so the page must work without it. Nothing from a draft or a source is ever stored here.
export const CONSENT_KEY = "verifidocs.notice.v1";
export const LAST_RUN_KEY = "verifidocs.lastRun";
export const THEME_KEY = "verifidocs.theme";

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignored on purpose */
  }
}
