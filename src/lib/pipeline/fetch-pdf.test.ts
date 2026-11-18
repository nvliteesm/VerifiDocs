import { describe, expect, it } from "vitest";
import { PdfFetchError, checkLink, checkedLookup, fetchPdf, isBlockedAddress, type Answer, type Transport } from "./fetch-pdf";

const PDF = new TextEncoder().encode("%PDF-1.7\nsome pdf bytes");

/** A fake server: each URL maps to an answer (status, headers, body chunks). Records the URLs asked for. */
function fakeTransport(routes: Record<string, { status?: number; headers?: Record<string, string>; chunks?: Uint8Array[] } | Error>) {
  const asked: string[] = [];
  const closed: string[] = [];
  const transport: Transport = async (url) => {
    asked.push(url.toString());
    const route = routes[url.toString()];
    if (!route) throw new Error("no such route");
    if (route instanceof Error) throw route;
    const answer: Answer = {
      status: route.status ?? 200,
      headers: route.headers ?? { "content-type": "application/pdf" },
      body: (async function* () {
        for (const chunk of route.chunks ?? [PDF]) yield chunk;
      })(),
      close: () => closed.push(url.toString()),
    };
    return answer;
  };
  return { transport, asked, closed };
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no error";
  } catch (error) {
    return error instanceof PdfFetchError ? error.reason : `other: ${(error as Error).message}`;
  }
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "255.255.255.255", "198.18.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:0a00:0001::1", "2001:db8::1", "not an address",
  ])("refuses %s", (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each(["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2a00:1450:4001:80b::200e"])(
    "allows %s",
    (address) => expect(isBlockedAddress(address)).toBe(false),
  );
});

describe("checkLink", () => {
  it("allows https, turns http into https, and refuses everything else", () => {
    expect(checkLink("https://arxiv.org/pdf/1706.03762").toString()).toBe("https://arxiv.org/pdf/1706.03762");
    expect(checkLink("http://repo.example.org/a.pdf").toString()).toBe("https://repo.example.org/a.pdf");
    for (const bad of ["ftp://x.org/a.pdf", "file:///etc/passwd", "https://user:pw@x.org/a.pdf", "https://x.org:8443/a.pdf", "not a link"]) {
      expect(() => checkLink(bad), bad).toThrowError(PdfFetchError);
    }
  });

  it("refuses a link to a private address or a local name before any connection", () => {
    for (const link of ["https://127.0.0.1/a.pdf", "https://[::1]/a.pdf", "https://169.254.169.254/latest", "https://localhost/a.pdf", "https://db.internal/a.pdf"]) {
      expect(() => checkLink(link), link).toThrow(/blocked_address/);
    }
  });
});

describe("checkedLookup", () => {
  const run = (addresses: { address: string; family: number }[], all = false) =>
    new Promise<{ error: (NodeJS.ErrnoException & { code?: string }) | null; result: unknown }>((resolve) =>
      checkedLookup(async () => addresses)("x.org", { all } as never, ((error: NodeJS.ErrnoException | null, address: unknown) =>
        resolve({ error, result: address })) as never),
    );

  it("passes a public address through", async () => {
    expect(await run([{ address: "93.184.216.34", family: 4 }])).toEqual({ error: null, result: "93.184.216.34" });
    expect((await run([{ address: "93.184.216.34", family: 4 }], true)).result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("refuses the host when any address it resolves to is private (a name that points inside)", async () => {
    expect((await run([{ address: "10.0.0.5", family: 4 }])).error?.code).toBe("BLOCKED_ADDRESS");
    expect((await run([{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }])).error?.code).toBe("BLOCKED_ADDRESS");
  });
});

describe("fetchPdf", () => {
  it("returns the PDF bytes", async () => {
    const { transport } = fakeTransport({ "https://repo.example.org/a.pdf": {} });
    expect(new TextDecoder().decode(await fetchPdf("http://repo.example.org/a.pdf", { transport }))).toBe("%PDF-1.7\nsome pdf bytes");
  });

  it("follows up to three redirects, checking each one, and refuses a fourth", async () => {
    const hop = (to: string) => ({ status: 302, headers: { location: to } });
    const ok = fakeTransport({
      "https://a.org/1": hop("https://b.org/2"),
      "https://b.org/2": hop("/3"),
      "https://b.org/3": hop("https://c.org/4.pdf"),
      "https://c.org/4.pdf": {},
    });
    expect((await fetchPdf("https://a.org/1", { transport: ok.transport })).byteLength).toBe(PDF.byteLength);
    expect(ok.asked).toHaveLength(4);

    const long = fakeTransport({
      "https://a.org/1": hop("https://a.org/2"),
      "https://a.org/2": hop("https://a.org/3"),
      "https://a.org/3": hop("https://a.org/4"),
      "https://a.org/4": hop("https://a.org/5"),
    });
    expect(await reason(fetchPdf("https://a.org/1", { transport: long.transport }))).toBe("too_many_redirects");
  });

  it("refuses a redirect to a private address or to plain http on another port", async () => {
    const inside = fakeTransport({ "https://a.org/1": { status: 301, headers: { location: "https://169.254.169.254/latest/meta-data" } } });
    expect(await reason(fetchPdf("https://a.org/1", { transport: inside.transport }))).toBe("blocked_address");
    expect(inside.asked).toEqual(["https://a.org/1"]);
    const port = fakeTransport({ "https://a.org/1": { status: 302, headers: { location: "http://a.org:8080/x.pdf" } } });
    expect(await reason(fetchPdf("https://a.org/1", { transport: port.transport }))).toBe("bad_link");
  });

  it("refuses a web page at its headers, and bytes that are not a PDF, without reading on", async () => {
    const page = fakeTransport({ "https://a.org/p": { headers: { "content-type": "text/html; charset=utf-8" } } });
    expect(await reason(fetchPdf("https://a.org/p", { transport: page.transport }))).toBe("not_pdf");
    expect(page.closed).toEqual(["https://a.org/p"]);

    const fake = fakeTransport({ "https://a.org/p": { headers: { "content-type": "application/octet-stream" }, chunks: [new TextEncoder().encode("<html>login</html>")] } });
    expect(await reason(fetchPdf("https://a.org/p", { transport: fake.transport }))).toBe("not_pdf");
    const empty = fakeTransport({ "https://a.org/p": { chunks: [] } });
    expect(await reason(fetchPdf("https://a.org/p", { transport: empty.transport }))).toBe("not_pdf");
  });

  it("checks the first bytes even when they arrive split across chunks", async () => {
    const split = fakeTransport({ "https://a.org/p": { chunks: [new TextEncoder().encode("%P"), new TextEncoder().encode("DF-1.4 rest")] } });
    expect((await fetchPdf("https://a.org/p", { transport: split.transport })).byteLength).toBe(13);
  });

  it("refuses more than the size limit, by header or while reading", async () => {
    const declared = fakeTransport({ "https://a.org/p": { headers: { "content-type": "application/pdf", "content-length": "99999999" } } });
    expect(await reason(fetchPdf("https://a.org/p", { transport: declared.transport }))).toBe("too_large");
    const big = fakeTransport({ "https://a.org/p": { chunks: [PDF, new Uint8Array(40), new Uint8Array(40)] } });
    expect(await reason(fetchPdf("https://a.org/p", { transport: big.transport, maxBytes: 60 }))).toBe("too_large");
  });

  it("reports an error status, a failed connection, a blocked lookup and the deadline as plain reasons", async () => {
    expect(await reason(fetchPdf("https://a.org/p", { transport: fakeTransport({ "https://a.org/p": { status: 403 } }).transport }))).toBe("http_error");
    expect(await reason(fetchPdf("https://a.org/p", { transport: fakeTransport({ "https://a.org/p": new Error("ECONNRESET") }).transport }))).toBe("unreachable");
    const blocked = Object.assign(new Error("blocked address"), { code: "BLOCKED_ADDRESS" });
    expect(await reason(fetchPdf("https://a.org/p", { transport: fakeTransport({ "https://a.org/p": blocked }).transport }))).toBe("blocked_address");
    const slow: Transport = (_url, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await reason(fetchPdf("https://a.org/p", { transport: slow, deadlineMs: 20 }))).toBe("timeout");
  });

  it("never puts the link in its error message", async () => {
    try {
      await fetchPdf("https://secret-host.example/private/token=abc.pdf", { transport: fakeTransport({}).transport });
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/secret-host|token/);
    }
  });
});

describe("the hard deadline", () => {
  it("gives up on time even when the transport ignores the abort signal (a DNS lookup cannot be cancelled)", async () => {
    const stuck: Transport = () => new Promise(() => {});
    const started = Date.now();
    expect(await reason(fetchPdf("https://a.org/p", { transport: stuck, deadlineMs: 50 }))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
