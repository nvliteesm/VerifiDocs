// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportResponse } from "@/lib/client/types";
import { DraftPanel } from "./DraftPanel";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LINK = "https://docs.google.com/document/d/1FaI87eOIaxp_4i_PB9-EJQFEEjjiObE0-onccygA_r8/edit?usp=sharing";

function setup(read: Promise<ImportResponse>) {
  const onStart = vi.fn();
  render(<DraftPanel disabled={false} disabledReason={null} onStart={onStart} importer={{ link: () => read, pdf: async () => ({ text: "", source: "pdf", warnings: [], truncated: false, referenceCount: null }) }} />);
  return onStart;
}

describe("reading a Google Docs link", () => {
  it("shows that it is working with the real seconds, and says a long document takes longer, with no percentage", async () => {
    vi.useFakeTimers();
    setup(new Promise(() => {})); // never answers: a slow document
    fireEvent.change(screen.getByLabelText(/Text or Google Docs link/), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "Read the document" }));
    expect(screen.getByText("Reading the document…")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByRole("status").textContent).toContain("4s");
    expect(screen.getByRole("status").textContent).not.toContain("takes longer");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByRole("status").textContent).toContain("10s");
    expect(screen.getByRole("status").textContent).toContain("A long document takes longer. It is still working.");
    expect(screen.getByRole("status").textContent).not.toMatch(/\d\s?%/);
  });

  it("names the draft after its own title, not 'Google Doc', and starts the scan", async () => {
    const onStart = setup(
      Promise.resolve({ text: "ANALISIS KELAYAKAN SUBSTITUSI PASIR PADA BATAKO RAMAH\nLINGKUNGAN DENGAN BAHAN LIMBAH\n\nKarya Ilmiah\nSMA Santu Petrus", source: "link", warnings: [], truncated: false, referenceCount: 12 }),
    );
    fireEvent.change(screen.getByLabelText(/Text or Google Docs link/), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "Read the document" }));
    expect(await screen.findByText("Analisis kelayakan substitusi pasir pada batako ramah lingkungan dengan bahan limbah")).toBeTruthy();
    expect(screen.queryByText("Google Doc")).toBeNull();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]![0]).toMatchObject({ label: "Analisis kelayakan substitusi pasir pada batako ramah lingkungan dengan bahan limbah" });
  });

  it("keeps the generic label when the text has no title of its own", async () => {
    setup(Promise.resolve({ text: "Social media is now the main way students find products (Hidayat, 2020).", source: "link", warnings: [], truncated: false, referenceCount: 3 }));
    fireEvent.change(screen.getByLabelText(/Text or Google Docs link/), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "Read the document" }));
    expect(await screen.findByText("Google Doc")).toBeTruthy();
  });
});
