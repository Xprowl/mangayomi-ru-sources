// Offline test for the worker: import worker.js, stub caches.default, and check the
// playlist rewriting + segment passthrough.
import worker from "./worker.js";

const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
./720.mp4:hls:seg-1-v1-a1.ts
#EXTINF:6.000,
./720.mp4:hls:seg-2-v1-a1.ts`;

const stored = new Map();
globalThis.caches = {
  default: {
    match: async (req) => stored.get(req.url),
    put: async (req, res) => { stored.set(req.url, res); }
  }
};

let fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  if (String(url).includes("manifest.m3u8")) {
    return new Response(manifest, { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
  }
  return new Response(new Uint8Array([0x47, 1, 2, 3]), { status: 206, headers: { "Content-Type": "video/MP2T", "Content-Range": "bytes 0-3/1000" } });
};

const origin = "https://kodik-proxy.test.workers.dev";
const target = "https://cloud2.solodcdn.com/useruploads/x/480.mp4:hls:manifest.m3u8";

const r1 = await worker.fetch(new Request(`${origin}/?u=${encodeURIComponent(target)}`));
const body = await r1.text();
console.log("playlist status:", r1.status, "| ct:", r1.headers.get("Content-Type"));
const lines = body.split("\n").filter((l) => l && !l.startsWith("#"));
console.log("rewritten lines:", lines.length);
lines.forEach((l) => console.log("  ", decodeURIComponent(l.replace(origin + "/?u=", "")).slice(0, 90)));
console.log("all point at worker:", lines.every((l) => l.startsWith(origin + "/?u=")));

const seg = decodeURIComponent(lines[0].replace(origin + "/?u=", ""));
const r2 = await worker.fetch(new Request(`${origin}/?u=${encodeURIComponent(seg)}`, { headers: { Range: "bytes=0-3" } }));
console.log("segment:", r2.status, r2.headers.get("Content-Type"), r2.headers.get("Content-Range"), (await r2.arrayBuffer()).byteLength, "bytes");

const r3 = await worker.fetch(new Request(`${origin}/?u=${encodeURIComponent("https://evil.example/x.ts")}`));
console.log("foreign host:", r3.status, await r3.text());

const r4 = await worker.fetch(new Request(`${origin}/?u=${encodeURIComponent(target)}`));
await r4.text();
console.log("second playlist call served from edge cache:", fetched.filter((u) => u.includes("manifest")).length === 1);
globalThis.fetch = realFetch;
