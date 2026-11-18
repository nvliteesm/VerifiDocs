"use client";

import { useT } from "./LocaleProvider";

/** EN | ID. Two real buttons in a group; the pressed one is the current language. */
export function LanguageToggle() {
  const { locale, setLocale, t } = useT();
  return (
    <div className="segment lang" role="group" aria-label={t("lang.group")}>
      <button type="button" lang="en" aria-pressed={locale === "en"} aria-label={`${t("lang.en")} (${t("lang.enName")})`} onClick={() => setLocale("en")}>
        {t("lang.en")}
      </button>
      <button type="button" lang="id" aria-pressed={locale === "id"} aria-label={`${t("lang.id")} (${t("lang.idName")})`} onClick={() => setLocale("id")}>
        {t("lang.id")}
      </button>
    </div>
  );
}
