// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InconsistentFigures } from "@/lib/client/consistency";
import { ConsistencyPanel } from "./ConsistencyPanel";

afterEach(cleanup);

const found: InconsistentFigures[] = [
  {
    key: "k", label: "Daya serap air batako daun ketapang kering", kind: "value",
    places: [
      { label: "x", value: "1,893", unit: "%", sentence: "Daun ketapang kering menyerap air 1,893%.", section: "Tabel 4.5", part: 1 },
      { label: "x", value: "1,839", unit: "%", sentence: "Batako daun ketapang kering sebesar 1,839%.", section: "Pembahasan", part: 2 },
    ],
  },
];

function view(props: Partial<Parameters<typeof ConsistencyPanel>[0]> = {}) {
  const onRun = vi.fn();
  render(<ConsistencyPanel phase="idle" done={0} total={5} found={[]} figureCount={0} onRun={onRun} {...props} />);
  return onRun;
}

describe("Check my numbers", () => {
  it("explains what it does and that it is separate from checking sources, and runs on one press", () => {
    const onRun = view();
    expect(screen.getByText(/separate from checking your sources/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check my numbers" }));
    expect(onRun).toHaveBeenCalled();
  });

  it("shows the real part it is on, with no percentage, and no button while it runs", () => {
    view({ phase: "running", done: 2, total: 5 });
    expect(screen.getByRole("status").textContent).toContain("Reading part 3 of 5");
    expect(screen.queryByRole("button", { name: "Check my numbers" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it("names where each differing value appears, and does not say which one is right", () => {
    view({ phase: "done", found, figureCount: 12 });
    expect(screen.getByRole("heading", { name: "Inconsistent figures detected" })).toBeTruthy();
    expect(screen.getByText("Daya serap air batako daun ketapang kering")).toBeTruthy();
    const places = within(screen.getByRole("list", { name: "Appears in" })).getAllByRole("listitem");
    expect(places.map((li) => li.textContent)).toEqual([
      "1,893 %Tabel 4.5Daun ketapang kering menyerap air 1,893%.",
      "1,839 %PembahasanBatako daun ketapang kering sebesar 1,839%.",
    ]);
    expect(screen.getByText(/We cannot tell which one is right/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/correct value|should be|wrong/i);
  });

  it("says plainly that finding nothing is a limited result, and how many figures were read", () => {
    view({ phase: "done", found: [], figureCount: 12 });
    expect(screen.getByRole("status").textContent).toContain("limited check");
    expect(screen.getByRole("status").textContent).toContain("Figures read: 12");
  });

  it("offers a retry when the numbers could not be read, and waits while the main check runs", () => {
    view({ phase: "failed", disabled: true });
    expect(screen.getByRole("alert").textContent).toContain("Try again");
    expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
