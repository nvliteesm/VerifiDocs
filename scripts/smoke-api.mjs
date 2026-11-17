// A live end-to-end check of the API over real HTTP: create a run, extract claims, upload and ingest a real PDF,
// check every claim (up to 5 in flight, as the browser will), and print the verdicts with every request's time.
//
//   1. npm run dev            (in another terminal; uses the Neon dev branch and your Gemini key)
//   2. npm run smoke:api
//
// It uses a synthetic draft and a public paper (arXiv 1706.03762) held in memory, never written to disk. It refuses
// to run unless NEON_BRANCH is "dev", and it deletes its own test session and events when it finishes.
import { createHash } from "node:crypto";
import postgres from "postgres";

if (process.env.NEON_BRANCH !== "dev") {
  console.error('Refusing to run: NEON_BRANCH is not "dev". This script writes test data and deletes it.');
  process.exit(1);
}

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const BUDGET_MS = 10_000;
let cookie = null;
const timings = [];

async function call(method, path, { json, form } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const started = performance.now();
  const response = await fetch(BASE + path, { method, headers, body });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 120);
  }
  timings.push({ label: `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`, status: response.status, ms });
  return { status: response.status, data, setCookie, ms };
}

const DRAFT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder (Vaswani et al., 2017). " +
  "The Transformer achieved 28.4 BLEU on the WMT 2014 English-to-German translation task (Vaswani et al., 2017). " +
  "The model was trained for three weeks on a single GPU (Vaswani et al., 2017). " +
  "Transformers were first proposed in 1995.\n\nReferences\n\n" +
  "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.";

try {
  // A cross-site write must be refused, and must not start a session.
  const evil = await fetch(BASE + "/api/runs", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ draft: DRAFT }),
  });
  console.log(`cross-site POST -> ${evil.status} | set-cookie: ${evil.headers.get("set-cookie") ? "YES (bad)" : "none"}`);

  const created = await call("POST", "/api/runs", { json: { draft: DRAFT } });
  console.log("create run ->", created.status, JSON.stringify(created.data));
  console.log("cookie:", created.setCookie?.replace(/vd_session=[^;]+/, "vd_session=<token>"));
  const runId = created.data.runId;

  for (let unit = 0; unit < created.data.unitCount; unit += 1) {
    const reply = await call("POST", `/api/runs/${runId}/extract`, { json: { unit } });
    console.log(`extract unit ${unit} ->`, reply.status, JSON.stringify(reply.data));
  }

  const pdf = await fetch("https://arxiv.org/pdf/1706.03762", { headers: { "user-agent": "VerifiDocs-portfolio/0.1" } });
  const form = new FormData();
  form.set("file", new Blob([await pdf.arrayBuffer()], { type: "application/pdf" }), "attention-is-all-you-need.pdf");
  const upload = await call("POST", "/api/sources", { form });
  console.log("upload ->", upload.status, JSON.stringify(upload.data));
  let progress;
  do {
    progress = await call("POST", `/api/sources/${upload.data.documentId}/ingest`);
    console.log("ingest ->", progress.status, JSON.stringify(progress.data));
  } while (progress.status === 200 && !progress.data.done);

  const run = await call("GET", `/api/runs/${runId}`);
  console.log(`run before checks: ${run.data.run.status}, ${run.data.claims.length} claims`);

  const results = await Promise.all(
    run.data.claims.map(async (claim) => {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const reply = await call("POST", `/api/claims/${claim.id}/check`);
        if (reply.status === 200 && reply.data.outcome === "done") return { claim, reply: reply.data, attempt };
        if (reply.status !== 200 && !reply.data?.error?.retry) return { claim, reply: reply.data, attempt };
      }
      return { claim, reply: "gave up", attempt: 4 };
    }),
  );

  console.log("\nVERDICTS");
  for (const { claim, reply, attempt } of results) {
    const v = reply.verdict ?? {};
    console.log(`- ${(v.verdict ?? JSON.stringify(reply)).padEnd(20)} stage ${v.exitStage} p.${v.page ?? "-"} attempts ${attempt} | ${claim.text.slice(0, 62)}...`);
    if (v.quote) console.log(`    quote: "${v.quote.slice(0, 90)}..."`);
    if (v.fixSuggestion) console.log(`    fix:   ${v.fixSuggestion}`);
    if (!v.quote && v.reason) console.log(`    why:   ${v.reason.slice(0, 110)}`);
  }

  const final = await call("GET", `/api/runs/${runId}`);
  const order = final.data.fixList.map((id) => final.data.claims.find((c) => c.id === id).verdict).join(" > ");
  console.log(`\nrun: ${final.data.run.status} | counts: ${JSON.stringify(final.data.counts)} | fix list: ${order || "(empty)"}`);

  const slowest = [...timings].sort((a, b) => b.ms - a.ms);
  console.log("\nREQUEST TIMES (ms)");
  for (const t of slowest.slice(0, 8)) console.log(`  ${String(t.ms).padStart(6)}  ${t.status}  ${t.label}`);
  const over = timings.filter((t) => t.ms > BUDGET_MS).length;
  console.log(`  requests: ${timings.length}, over ${BUDGET_MS / 1000} s: ${over}, slowest: ${slowest[0].ms} ms`);
  if (over > 0) process.exitCode = 1;
} finally {
  // Remove this run's test data. Events have no foreign key to sessions, so they are deleted explicitly.
  if (cookie) {
    const sql = postgres(process.env.DATABASE_URL_UNPOOLED, { max: 1, onnotice() {} });
    const hash = createHash("sha256").update(cookie.split("=")[1]).digest("hex");
    const [session] = await sql`select id from sessions where token_hash = ${hash}`;
    if (session) {
      await sql`delete from events where session_id = ${session.id}`;
      await sql`delete from sessions where id = ${session.id}`;
      console.log("cleanup: removed the test session and its events");
    }
    await sql.end();
  }
}
