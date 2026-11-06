// Static server for the built app: gzip like a CDN, SPA fallback, immutable assets.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
const [root, port] = [process.argv[2], Number(process.argv[3])];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(root, "index.html");
  const body = readFileSync(p);
  const type = TYPES[extname(p)] ?? "application/octet-stream";
  const headers = { "content-type": type, "cache-control": p.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" };
  if (/gzip/.test(req.headers["accept-encoding"] ?? "") && /text|javascript|svg|json/.test(type)) { res.writeHead(200, { ...headers, "content-encoding": "gzip" }); res.end(gzipSync(body)); }
  else { res.writeHead(200, headers); res.end(body); }
}).listen(port, () => console.log("serving", root, "on", port));
