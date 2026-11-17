// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "./storage";
import { ThemeToggle } from "./ThemeToggle";

/** A matchMedia whose result the test can change, like an operating system switching at sunset. */
function fakeSystemTheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("dark") ? dark : false;
    },
    media: query,
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn),
  }));
  return {
    set(next: boolean) {
      dark = next;
      act(() => listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent)));
    },
    listenerCount: () => listeners.size,
  };
}

const isOn = () => screen.getByRole("switch", { name: "Dark mode" }).getAttribute("aria-checked");

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("starts in the system theme", async () => {
    fakeSystemTheme(true);
    render(<ThemeToggle />);
    expect(isOn()).toBe("true");
  });

  it("follows the system when it changes while the student has not chosen", () => {
    const system = fakeSystemTheme(true);
    render(<ThemeToggle />);
    system.set(false);
    expect(isOn()).toBe("false");
    system.set(true);
    expect(isOn()).toBe("true");
  });

  it("stops following the system once the student chooses, and remembers the choice", async () => {
    const user = userEvent.setup();
    const system = fakeSystemTheme(true);
    render(<ThemeToggle />);
    await user.click(screen.getByRole("switch", { name: "Dark mode" })); // dark -> light
    expect(isOn()).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    system.set(true); // the system flips, but the student chose light
    expect(isOn()).toBe("false");
  });

  it("uses a saved choice over the system and does not listen to it", () => {
    document.documentElement.dataset.theme = "light";
    const system = fakeSystemTheme(true);
    render(<ThemeToggle />);
    expect(isOn()).toBe("false");
    expect(system.listenerCount()).toBe(0);
  });

  it("stops listening when it leaves the page", () => {
    const system = fakeSystemTheme(false);
    const { unmount } = render(<ThemeToggle />);
    expect(system.listenerCount()).toBe(1);
    unmount();
    expect(system.listenerCount()).toBe(0);
  });
});
