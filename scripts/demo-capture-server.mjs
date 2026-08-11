/**
 * Receiving end for the Standard Mode demo captures.
 *
 *   node scripts/demo-capture-server.mjs
 *
 * The capture itself happens in a real browser session (scripts/demo-driver.js),
 * which cannot write to disk. This serves the driver to that page and takes the
 * finished recording back off it. Deliberately outside the Next app: nothing
 * about recording marketing demos belongs in the product's route surface.
 */

import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const PORT = 3211;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  if (url.pathname === "/driver.js") {
    const source = await readFile(resolve(here, "demo-driver.js"), "utf8");
    return res.writeHead(200, { ...cors, "content-type": "text/javascript" }).end(source);
  }

  if (req.method === "POST" && url.pathname === "/upload") {
    // Only ever writes inside public/demos, under a name we sanitize — this
    // listens on a local port and should not become a file-write primitive.
    const name = (url.searchParams.get("name") ?? "").replace(/[^a-z0-9.-]/gi, "");
    if (!name || name.includes("..")) return res.writeHead(400, cors).end("bad name");
    const buffer = await body(req);
    const target = resolve(root, "public/demos", name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    console.log(`wrote public/demos/${name} — ${(buffer.length / 1024).toFixed(0)} KB`);
    return res.writeHead(200, { ...cors, "content-type": "application/json" }).end(JSON.stringify({ bytes: buffer.length }));
  }

  /*
   * Hands the already-signed-in session across to the capture browser.
   *
   * The recording has to happen in a visible, compositing window, which is a
   * different browser from the one holding the session. Rather than sign in
   * again — or put an auth token through a chat transcript — the signed-in
   * page POSTs its own cookie straight to disk here, and the CDP driver reads
   * it from there. Written outside the repo, and deleted after the run.
   */
  if (req.method === "POST" && url.pathname === "/session") {
    const target = process.env.DEMO_SESSION_FILE;
    if (!target) return res.writeHead(503, cors).end("no session file configured");
    await writeFile(target, await body(req));
    console.log("stored capture session cookie");
    return res.writeHead(200, cors).end("ok");
  }

  if (req.method === "POST" && url.pathname === "/report") {
    const buffer = await body(req);
    const name = (url.searchParams.get("name") ?? "report").replace(/[^a-z0-9.-]/gi, "");
    const target = resolve(root, "output/demo-runs", `${name}.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    console.log(`wrote output/demo-runs/${name}.json`);
    return res.writeHead(200, cors).end("ok");
  }

  res.writeHead(404, cors).end("not found");
}).listen(PORT, () => console.log(`demo capture server on http://localhost:${PORT}`));
