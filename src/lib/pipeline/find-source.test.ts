import { describe, expect, it } from "vitest";
import { matchResolvedToDocuments } from "./find-source";

const doc = (id: string, filename: string, head: string, status: "ready" | "no_text" = "ready") => ({ id, status, filename, head });

describe("matchResolvedToDocuments (an uploaded PDF for a reference Crossref or OpenAlex found)", () => {
  it("matches a title that contains a one-letter word, such as 'a' (UAT 23 Nov 2026)", () => {
    const head = "arXiv:1503.02531v1 [stat.ML] 9 Mar 2015 Distilling the Knowledge in a Neural Network Geoffrey Hinton";
    const result = matchResolvedToDocuments([doc("d1", "distill.pdf", head)], {
      title: "Distilling the Knowledge in a Neural Network",
    });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("matches a title in capitals that starts with a one-letter word after a colon", () => {
    const head = "Published as a conference paper at ICLR 2015 ADAM: A METHOD FOR STOCHASTIC OPTIMIZATION Diederik P. Kingma";
    const result = matchResolvedToDocuments([doc("d1", "adam.pdf", head)], { title: "Adam: A Method for Stochastic Optimization" });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("matches an arXiv DOI to the arXiv id printed on the first page", () => {
    const head = "arXiv:1412.6980v9 [cs.LG] 30 Jan 2017 Some other words";
    const result = matchResolvedToDocuments([doc("d1", "paper.pdf", head)], {
      title: "A title that is not printed",
      doi: "10.48550/arxiv.1412.6980",
    });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("does not match a different arXiv id that starts the same way", () => {
    const head = "arXiv:1412.69801v1 [cs.LG] Something else";
    const result = matchResolvedToDocuments([doc("d1", "paper.pdf", head)], {
      title: "A title that is not printed",
      doi: "10.48550/arxiv.1412.6980",
    });
    expect(result).toEqual({ kind: "none" });
  });

  it("still matches a title with no one-letter words", () => {
    const head = "Deep Residual Learning for Image Recognition Kaiming He";
    const result = matchResolvedToDocuments([doc("d1", "resnet.pdf", head)], { title: "Deep Residual Learning for Image Recognition" });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("does not match when only part of the title is printed", () => {
    const head = "Distilling the Knowledge Geoffrey Hinton";
    const result = matchResolvedToDocuments([doc("d1", "x.pdf", head)], { title: "Distilling the Knowledge in a Neural Network" });
    expect(result).toEqual({ kind: "none" });
  });

  it("matches a DOI printed on the first pages", () => {
    const head = "Nature 521 doi:10.1038/nature14539 Deep learning";
    const result = matchResolvedToDocuments([doc("d1", "x.pdf", head)], { title: "Something else entirely", doi: "10.1038/nature14539" });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("falls back to the filename when the title words are there", () => {
    const result = matchResolvedToDocuments([doc("d1", "Distilling-the-Knowledge-in-a-Neural-Network.pdf", "")], {
      title: "Distilling the Knowledge in a Neural Network",
    });
    expect(result).toEqual({ kind: "found", documentId: "d1" });
  });

  it("prefers the title on the page over a filename match", () => {
    const result = matchResolvedToDocuments(
      [
        doc("byName", "Deep-Residual-Learning-for-Image-Recognition.pdf", "Unrelated text"),
        doc("byTitle", "scan.pdf", "Deep Residual Learning for Image Recognition"),
      ],
      { title: "Deep Residual Learning for Image Recognition" },
    );
    expect(result).toEqual({ kind: "found", documentId: "byTitle" });
  });

  it("returns none when nothing matches", () => {
    expect(matchResolvedToDocuments([doc("d1", "x.pdf", "Unrelated")], { title: "Attention Is All You Need" })).toEqual({ kind: "none" });
  });
});
