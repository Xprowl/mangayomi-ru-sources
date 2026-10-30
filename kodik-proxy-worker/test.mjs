// Offline test for the worker: import worker.js, stub caches.default, and check the
// playlist rewriting + segment passthrough + caching behaviour.
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
    put: async (req, res) => { stored.set(req.url, new Response(await res.arrayBuffer(), { headers: res.headers })); }
  }
};

let upstreamCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  upstreamCalls++;
  if (String(url).includes("manifest.m3u8")) {
    return new Response(manifest, { status: 200, headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
  }
  return new Response(new Uint8Array([0x47, 1, 2, 3]), { status: 206, headers: { "Content-Type": "video/MP2T", "Content-Range": "bytes 0-3/1000" } });
};

const origin = "https://kodik-proxy.test.workers.dev";
const target = "https://cloud2.solodcdn.com/useruploads/x/480.mp4:hls:manifest.m3u8";
const get = (u, headers) => worker.fetch(new Request(`${origin}/?u=${encodeURIComponent(u)}`, { headers }));

const r1 = await get(target);
const body = await r1.text();
const lines = body.split("\n").filter((l) => l && !l.startsWith("#"));
console.log("playlist:", r1.status, "| rewritten:", lines.length, "| all via worker:", lines.every((l) => l.startsWith(origin + "/?u=")));

const r1b = await get(target);
await r1b.text();
console.log("playlist again from cache:", upstreamCalls === 1, "| content-type:", r1b.headers.get("Content-Type"));
console.log("playlist cache-control:", r1b.headers.get("Cache-Control"));

const seg = decodeURIComponent(lines[0].replace(origin + "/?u=", ""));
const r2 = await get(seg, { Range: "bytes=0-3" });
console.log("segment:", r2.status, r2.headers.get("Content-Type"), r2.headers.get("Content-Range"), (await r2.arrayBuffer()).byteLength, "bytes");

const before = upstreamCalls;
await (await get(seg)).arrayBuffer();
console.log("segment cached (served without hitting upstream):", upstreamCalls === before, "| ttl:", (await get(seg)).headers.get("Cache-Control"));

const r3 = await get("https://evil.example/x.ts");
console.log("foreign host:", r3.status);

const r4 = await get("https://sky.solodcdn.com/x/480.mp4:hls:seg-1-v1-a1.ts");
console.log("media cache-control:", r4.headers.get("Cache-Control"));
globalThis.fetch = realFetch;
