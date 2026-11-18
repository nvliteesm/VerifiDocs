// Fetch an open-access PDF for "Check against this paper" (docs/source-discovery.md, phase 2, step 4).
//
// The link comes from OpenAlex and can point at any host, so this is the one place the server opens a connection
// it does not choose. Rules (server-side request forgery):
//   - https only, on the standard port, with no user name or password in the link; an http link is tried as https;
//   - every address a host name resolves to is checked AT CONNECT TIME (a custom DNS lookup on Node's own https
//     module), so a name that points at a private, loopback, link-local or reserved address is refused, even if it
//     changes between a check and the connection; a link to an address itself is checked the same way;
//   - redirects are followed by hand, at most 3, each one checked again;
//   - only a PDF: a web page is refused at its headers, and the first bytes must be "%PDF-";
//   - 10 MB at most (counted while reading), 8 seconds for the whole fetch.
// The PDF is held in memory only and never stored (hard rule 4). A link is never logged: failures are reasons.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";

export const MAX_PDF_FETCH_BYTES = 10 * 1024 * 1024;
export const PDF_FETCH_DEADLINE_MS = 8_000;
export const MAX_REDIRECTS = 3;

export type PdfFetchFailure =
  | "bad_link" // not https (after the http upgrade), another port, credentials, or not a URL
  | "blocked_address" // the host is, or resolves to, a private or reserved address
  | "too_many_redirects"
  | "not_pdf" // a web page, or bytes that do not start with %PDF-
  | "too_large"
  | "timeout"
  | "http_error" // the server answered with an error status
  | "unreachable"; // the connection failed

export class PdfFetchError extends Error {
  override name = "PdfFetchError";
  readonly reason: PdfFetchFailure;
  constructor(reason: PdfFetchFailure) {
    super(`The PDF could not be fetched (${reason}).`);
    this.reason = reason;
  }
}

// ---- Addresses -------------------------------------------------------------------------------------------------

function ipv4Number(address: string): number {
  return address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
];

function blockedIpv4(address: string): boolean {
  const n = ipv4Number(address);
  return IPV4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((ipv4Number(base) & mask) >>> 0);
  });
}

/** Expands an IPv6 address to its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase().split("%")[0]!;
  // An embedded IPv4 tail ("::ffff:10.0.0.1") becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const n = ipv4Number(v4[1]!);
    text = text.slice(0, -v4[1]!.length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail === undefined ? [] : new Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((group) => parseInt(group || "0", 16));
}

function blockedIpv6(address: string): boolean {
  const g = ipv6Groups(address);
  if (g.length !== 8) return true;
  const allZeroUpTo = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (allZeroUpTo(8)) return true; // ::
  if (allZeroUpTo(7) && g[7] === 1) return true; // ::1 loopback
  const embedded = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (allZeroUpTo(5) && g[5] === 0xffff) return blockedIpv4(embedded); // ::ffff:a.b.c.d (IPv4-mapped)
  if (allZeroUpTo(6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedIpv4(embedded); // NAT64
  if (g[0] === 0x2002) return blockedIpv4(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`); // 6to4
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/** True for an address the server must never connect to. Anything that is not a valid IP address is refused. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses))),
  );

/**
 * A DNS lookup for Node's connections that refuses the whole host if ANY of its addresses is blocked (so a host
 * cannot mix a public and a private address and hope the private one is used).
 */
export function checkedLookup(resolver: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
          const error = Object.assign(new Error("blocked address"), { code: "BLOCKED_ADDRESS" });
          return callback(error as NodeJS.ErrnoException, "", 0);
        }
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => a.family === options.family) : addresses;
        const list = wanted.length > 0 ? wanted : addresses;
        if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        callback(null, list[0]!.address, list[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

// ---- Links -----------------------------------------------------------------------------------------------------

/** The link to fetch, or a refusal: https on port 443, no credentials. An http link becomes https. */
export function checkLink(link: string): URL {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new PdfFetchError("bad_link");
  }
  if (url.protocol === "http:") {
    url.protocol = "https:";
    if (url.port === "80") url.port = "";
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || (url.port !== "" && url.port !== "443")) {
    throw new PdfFetchError("bad_link");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new PdfFetchError("blocked_address");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new PdfFetchError("blocked_address");
  }
  return url;
}

// ---- Transport -------------------------------------------------------------------------------------------------

export interface Answer {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Stops reading and closes the connection. */
  close: () => void;
}

/** Opens one GET. Tests pass a fake; the default uses Node's https with the checked lookup. */
export type Transport = (url: URL, signal: AbortSignal) => Promise<Answer>;

export function httpsTransport(lookup: LookupFunction = checkedLookup()): Transport {
  return (url, signal) =>
    new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          lookup,
          signal,
          headers: { "User-Agent": "VerifiDocs-portfolio/0.1", Accept: "application/pdf", "Accept-Encoding": "identity" },
        },
        (response) => {
          const headers: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(response.headers)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
          resolve({ status: response.statusCode ?? 0, headers, body: response, close: () => response.destroy() });
        },
      );
      request.on("error", reject);
    });
}

// ---- Fetch -----------------------------------------------------------------------------------------------------

const PDF_TYPES = new Set(["application/pdf", "application/x-pdf", "application/octet-stream", "binary/octet-stream"]);

export interface FetchPdfOptions {
  transport?: Transport;
  deadlineMs?: number;
  maxBytes?: number;
}

function failureOf(error: unknown, signal: AbortSignal): PdfFetchError {
  if (error instanceof PdfFetchError) return error;
  if (signal.aborted) return new PdfFetchError("timeout");
  if ((error as NodeJS.ErrnoException)?.code === "BLOCKED_ADDRESS") return new PdfFetchError("blocked_address");
  return new PdfFetchError("unreachable");
}

/**
 * Fetches one PDF under the rules above. Throws PdfFetchError with a reason; never returns anything but a PDF.
 * The deadline also holds where the abort signal cannot reach (a DNS lookup cannot be cancelled once started): a
 * browser test saw a failed fetch take 37.7 s in all, so the whole fetch races a timer 500 ms past the deadline.
 */
export async function fetchPdf(link: string, options: FetchPdfOptions = {}): Promise<Uint8Array> {
  const deadlineMs = options.deadlineMs ?? PDF_FETCH_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfFetchError("timeout")), deadlineMs + 500);
  });
  try {
    return await Promise.race([fetchWithin(link, { ...options, deadlineMs }), cap]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithin(link: string, options: FetchPdfOptions): Promise<Uint8Array> {
  const transport = options.transport ?? httpsTransport();
  const maxBytes = options.maxBytes ?? MAX_PDF_FETCH_BYTES;
  const signal = AbortSignal.timeout(options.deadlineMs ?? PDF_FETCH_DEADLINE_MS);

  let url = checkLink(link);
  for (let hop = 0; ; hop += 1) {
    let answer: Answer;
    try {
      answer = await transport(url, signal);
    } catch (error) {
      throw failureOf(error, signal);
    }

    if ([301, 302, 303, 307, 308].includes(answer.status)) {
      answer.close();
      if (hop >= MAX_REDIRECTS) throw new PdfFetchError("too_many_redirects");
      const location = answer.headers.location;
      if (!location) throw new PdfFetchError("http_error");
      url = checkLink(new URL(location, url).toString());
      continue;
    }
    if (answer.status !== 200) {
      answer.close();
      throw new PdfFetchError("http_error");
    }

    const type = (answer.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "" && !PDF_TYPES.has(type)) {
      answer.close();
      throw new PdfFetchError("not_pdf");
    }
    if (Number(answer.headers["content-length"] ?? 0) > maxBytes) {
      answer.close();
      throw new PdfFetchError("too_large");
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    let headChecked = false;
    try {
      for await (const chunk of answer.body) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          answer.close();
          throw new PdfFetchError("too_large");
        }
        chunks.push(chunk);
        // Check the first bytes as soon as there are five, so a large non-PDF is not read to the end.
        if (!headChecked && size >= 5) {
          headChecked = true;
          if (new TextDecoder("latin1").decode(concat(chunks, 5)) !== "%PDF-") {
            answer.close();
            throw new PdfFetchError("not_pdf");
          }
        }
      }
    } catch (error) {
      throw failureOf(error, signal);
    }
    if (!headChecked) throw new PdfFetchError("not_pdf");
    return concat(chunks, size);
  }
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const part = chunk.subarray(0, length - offset);
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
