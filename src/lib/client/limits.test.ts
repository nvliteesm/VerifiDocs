import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENTS_PER_SESSION,
  MAX_PDF_BYTES as SERVER_MAX_PDF_BYTES,
} from "../pipeline/ingest";
import {
  MAX_DOCX_BYTES as SERVER_MAX_DOCX_BYTES,
  MAX_DRAFT_CHARS as SERVER_MAX_DRAFT_CHARS,
  MAX_REFERENCES as SERVER_MAX_REFERENCES,
} from "../pipeline/parse-draft";
import { MAX_DOCX_BYTES, MAX_DRAFT_CHARS, MAX_PDF_BYTES, MAX_REFERENCES, MAX_SOURCES, megabytes } from "./limits";

describe("client limits", () => {
  it("match the server's limits, so the screen never promises more than the server accepts", () => {
    expect(MAX_PDF_BYTES).toBe(SERVER_MAX_PDF_BYTES);
    expect(MAX_DOCX_BYTES).toBe(SERVER_MAX_DOCX_BYTES);
    expect(MAX_DRAFT_CHARS).toBe(SERVER_MAX_DRAFT_CHARS);
    expect(MAX_SOURCES).toBe(MAX_DOCUMENTS_PER_SESSION);
    expect(MAX_REFERENCES).toBe(SERVER_MAX_REFERENCES);
  });

  it("formats sizes for people", () => {
    expect(megabytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(megabytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(megabytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
