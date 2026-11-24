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

  describe("a short, generic title (E34 in the eval of 24 Nov 2026)", () => {
    // LeCun et al. (2015), "Deep learning": the phrase is in the introduction of many other papers.
    const lecun = { title: "Deep learning", doi: "10.1038/nature14539" };
    // A real abstract runs about 1,000 characters, so the introduction starts well past the title page.
    const abstract = "Abstract. We introduce a method for optimization that is simple to implement and uses little memory. ".repeat(9);
    const introduction = `${abstract}1 Introduction Machine learning has had many success stories, such as recent advances in deep learning (Deng et al., 2013).`;
    const filler = " Results are reported in the tables below.".repeat(20);

    it("does not take another paper that only says the phrase in a sentence of its introduction", () => {
      const head = `Published as a conference paper at ICLR 2015 ADAM: A METHOD FOR STOCHASTIC OPTIMIZATION Diederik Kingma ${introduction}${filler}`;
      expect(matchResolvedToDocuments([doc("adam", "adam.pdf", head)], lecun)).toEqual({ kind: "none" });
    });

    it("takes the paper whose title page opens with it", () => {
      const head = "Deep learning Yann LeCun, Yoshua Bengio & Geoffrey Hinton Deep learning allows computational models that are composed of multiple processing layers";
      expect(matchResolvedToDocuments([doc("lecun", "scan0042.pdf", head)], lecun)).toEqual({ kind: "found", documentId: "lecun" });
    });

    it("picks the real paper, not an earlier upload that mentions the phrase", () => {
      const other = doc("adam", "adam.pdf", `ADAM: A METHOD FOR STOCHASTIC OPTIMIZATION ${introduction}${filler}`);
      const real = doc("lecun", "scan0042.pdf", "Deep learning Yann LeCun, Yoshua Bengio & Geoffrey Hinton");
      expect(matchResolvedToDocuments([other, real], lecun)).toEqual({ kind: "found", documentId: "lecun" });
    });

    it("still matches by the DOI printed in the paper, wherever the title is", () => {
      const head = `${"Preamble text. ".repeat(60)}Nature 521, 436-444 doi:10.1038/nature14539 Deep learning is discussed here.`;
      expect(matchResolvedToDocuments([doc("lecun", "x.pdf", head)], lecun)).toEqual({ kind: "found", documentId: "lecun" });
    });

    it("still matches a long title that sits below a long journal header", () => {
      const header = "Contents lists available at ScienceDirect Journal of Applied Findings journal homepage: www.example.org ".repeat(6);
      const head = `${header}Quantum inflation dynamics in household spending patterns Smith and Lee Abstract`;
      expect(matchResolvedToDocuments([doc("j", "paper.pdf", head)], { title: "Quantum inflation dynamics in household spending patterns" })).toEqual({ kind: "found", documentId: "j" });
    });

    it("falls back to the filename for a short title, as for any other", () => {
      expect(matchResolvedToDocuments([doc("f", "Deep-Learning.pdf", introduction)], lecun)).toEqual({ kind: "found", documentId: "f" });
    });
  });

  it("returns none when nothing matches", () => {
    expect(matchResolvedToDocuments([doc("d1", "x.pdf", "Unrelated")], { title: "Attention Is All You Need" })).toEqual({ kind: "none" });
  });
});
