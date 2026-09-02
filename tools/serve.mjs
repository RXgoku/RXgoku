// Minimal static server for local checks. `node tools/serve.mjs [dir] [port]`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 8080);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain" };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(dir, p);
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found: " + p); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${dir} on http://localhost:${port}`));
