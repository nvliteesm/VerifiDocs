// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summarizeReferences } from "@/lib/client/references";
import type { ReferenceSource, ReferenceSourceState } from "@/lib/client/types";
import { SourceOverview } from "./SourceOverview";

afterEach(cleanup);

let n = 0;
function ref(sourceState: ReferenceSourceState, extra: Partial<ReferenceSource> = {}): ReferenceSource {
  n += 1;
  return { id: `r${n}`, position: n, text: `Entry ${n}`, title: `Title ${n}`, byline: `Author ${n}, 2020`, refType: "journal", sourceState, documentId: null, candidate: null, ...extra };
}

function view(refs: ReferenceSource[], props: Partial<Parameters<typeof SourceOverview>[0]> = {}) {
  const onConfirm = vi.fn(async () => {});
  const onUpload = vi.fn(async () => {});
  render(<SourceOverview refs={refs} summary={summarizeReferences(refs)} running={false} limit={false} onConfirm={onConfirm} onUpload={onUpload} waiting={0} canCheck={false} {...props} />);
  return { onConfirm, onUpload };
}

describe("the sources overview", () => {
  it("leads with how many sources were retrieved", () => {
    view([ref("retrieved", { documentId: "d1" }), ref("uploaded", { documentId: "d2" }), ref("not_retrieved"), ref("possible")]);
    expect(screen.getByRole("heading", { name: "2 of 4 sources retrieved" })).toBeTruthy();
  });

  it("names a missing source by its real title and byline, never by a generic label, and never says it is fake", () => {
    view([ref("not_retrieved", { title: "Kuat Tekan Batako Dengan Variasi Serat Ijuk", byline: "Hermanto, Dony, dkk 2014", refType: "thesis" })]);
    expect(screen.getByText("Kuat Tekan Batako Dengan Variasi Serat Ijuk")).toBeTruthy();
    expect(screen.getByText("Hermanto, Dony, dkk 2014")).toBeTruthy();
    expect(screen.getByText("Could not be retrieved automatically. It may not be online.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/fake|invented|not found|wrong/i);
  });

  it("explains a match that has no free PDF, and a law or standard that is never looked up", () => {
    view([ref("matched_no_file"), ref("not_retrieved", { refType: "standard", title: "SNI 03-0349-1989" })]);
    expect(screen.getByText("We found it, but there is no free PDF. Upload it if you have it.")).toBeTruthy();
    expect(screen.getByText("Laws and standards are not looked up. Upload the PDF to check claims against it.")).toBeTruthy();
  });

  it("asks before using a possible match: one click to confirm, one to say no, and nothing is attached by itself", async () => {
    const { onConfirm } = view([ref("possible", { candidate: { title: "Pengaruh komposisi bahan pengisi styrofoam", year: 2016, doi: "10.2/z", venue: "Jurnal X", hasPdf: true } })]);
    expect(screen.getByText("Is this your source?")).toBeTruthy();
    expect(screen.getByText("Pengaruh komposisi bahan pengisi styrofoam")).toBeTruthy();
    expect(screen.getByText("2016 · Jurnal X")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, use it" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.any(String), true));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.any(String), false));
  });

  it("uploads a PDF for one reference, naming that reference for a screen reader", async () => {
    const { onUpload } = view([ref("not_retrieved", { title: "A thesis" })]);
    const input = screen.getByLabelText("Upload PDF: A thesis") as HTMLInputElement;
    const file = new File(["%PDF"], "thesis.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.any(String), file));
  });

  it("says so when the upload fails, and keeps the button", async () => {
    view([ref("not_retrieved", { title: "A thesis" })], { onUpload: vi.fn(async () => { throw new Error("no"); }) });
    fireEvent.change(screen.getByLabelText("Upload PDF: A thesis"), { target: { files: [new File(["x"], "a.pdf")] } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload PDF" })).toBeTruthy();
  });

  it("shows real progress while it looks, and no percentage", () => {
    view([ref("retrieved", { documentId: "d" }), ref("pending"), ref("pending")], { running: true });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Looking for your sources: 1 of 3 looked at.");
    expect(document.body.textContent).not.toMatch(/\d\s?%/);
  });

  it("offers to check the waiting claims only when a source is ready and claims are waiting, and says when the source limit is reached", () => {
    const onCheckWaiting = vi.fn();
    view([ref("retrieved", { documentId: "d" })], { waiting: 5, canCheck: true, onCheckWaiting, limit: true });
    fireEvent.click(screen.getByRole("button", { name: "Check the waiting claims" }));
    expect(onCheckWaiting).toHaveBeenCalled();
    expect(within(screen.getByRole("alert")).getByText(/limit of sources/)).toBeTruthy();
  });

  it("offers Find my sources for a check that has not had its lookup, and says so plainly when there is no reference list", () => {
    const onFind = vi.fn();
    view([ref("pending")], { onFind });
    fireEvent.click(screen.getByRole("button", { name: "Find my sources" }));
    expect(onFind).toHaveBeenCalled();
    cleanup();
    view([]);
    expect(screen.getByText("No reference list was found in your draft. You can still add PDFs below.")).toBeTruthy();
  });
});
