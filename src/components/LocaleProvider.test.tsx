// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_KEY } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";
import { LocaleProvider, useT } from "./LocaleProvider";

function Probe() {
  const { t, ready } = useT();
  return <p data-testid="probe">{ready ? t("draft.title") : "not ready"}</p>;
}

function setBrowserLanguages(languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "en";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LocaleProvider", () => {
  it("starts in the browser's language when nothing is saved", async () => {
    setBrowserLanguages(["id-ID", "en-US"]);
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect((await screen.findByTestId("probe")).textContent).toBe("Draf kamu");
    expect(document.documentElement.lang).toBe("id");
  });

  it("prefers the saved choice over the browser's language", async () => {
    setBrowserLanguages(["id-ID"]);
    window.localStorage.setItem(LOCALE_KEY, "en");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect((await screen.findByTestId("probe")).textContent).toBe("Your draft");
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English with no provider, so a component can be used on its own", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("Your draft");
  });
});

describe("LanguageToggle", () => {
  it("shows which language is on, switches it, remembers it and updates the page language", async () => {
    setBrowserLanguages(["en-US"]);
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LanguageToggle />
        <Probe />
      </LocaleProvider>,
    );
    const english = await screen.findByRole("button", { name: "EN (English)" });
    const indonesian = screen.getByRole("button", { name: "ID (Bahasa Indonesia)" });
    expect(english.getAttribute("aria-pressed")).toBe("true");
    expect(indonesian.getAttribute("aria-pressed")).toBe("false");

    await user.click(indonesian);
    expect(screen.getByTestId("probe").textContent).toBe("Draf kamu");
    expect(indonesian.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.lang).toBe("id");
    expect(window.localStorage.getItem(LOCALE_KEY)).toBe("id");
    expect(screen.getByRole("group", { name: "Bahasa" })).toBeTruthy(); // the group's own name changes too

    await user.click(screen.getByRole("button", { name: "EN (English)" }));
    expect(screen.getByTestId("probe").textContent).toBe("Your draft");
    expect(window.localStorage.getItem(LOCALE_KEY)).toBe("en");
  });

  it("can be reached and used with the keyboard", async () => {
    setBrowserLanguages(["en-US"]);
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LanguageToggle />
        <Probe />
      </LocaleProvider>,
    );
    await screen.findByRole("button", { name: "EN (English)" });
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "ID (Bahasa Indonesia)" }));
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("probe").textContent).toBe("Draf kamu");
  });
});
