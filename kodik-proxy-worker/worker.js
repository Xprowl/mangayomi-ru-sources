/**
 * Kodik video proxy — a free Cloudflare Worker (Workers Free: 100 000 requests/day).
 *
 * Why: Kodik's CDN sits behind DDoS-Guard and is geo-restricted, so the app has to
 * handshake on every request and playback starts slowly (or is blocked outside RU).
 * The worker fetches each playlist/segment once from Cloudflare's network (outside the
 * blocked region), caches it with the edge cache and serves it without DDoS-Guard.
 *
 * Quota: a series is ~250 segments. Each segment is stored in Cloudflare's edge cache
 * for a week, and cache hits are answered by Cloudflare *without* running (and
 * billing) the worker — only the first download of a segment costs a request. So the
 * free 100k/day is roughly "first download of ~400 episodes' worth of segments".
 *
 * Usage:
 *   1. Install Wrangler:            npm i -g wrangler
 *   2. wrangler login
 *   3. From this folder:            wrangler deploy
 *   4. Copy the printed URL (https://kodik-proxy.<name>.workers.dev) into the
 *      AnimeOn source settings → "Прокси для видео".
 *
 * Request:  GET https://<worker>/?u=<encodeURIComponent(kodik-or-cdn-url)>
 * Playlists (*.m3u8) come back with their segment lines rewritten to go through the
 * worker as well, so the player only ever talks to the worker.
 */

const ALLOWED_HOSTS = [
  "kodikplayer.com",
  "kodik.info",
  "kodik.cc",
  "solodcdn.com",
  "kodikres.com"
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PLAYLIST_TTL = 60;        // seconds
const MEDIA_TTL = 7 * 86400;    // seconds — segments never change

function hostAllowed(host) {
  const h = String(host || "").toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a));
}

function corsHeaders(extra) {
  return Object.assign(
    {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS"
    },
    extra || {}
  );
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json" })
  });
}

function isPlaylist(url, contentType) {
  return /\.m3u8(\?|$)/i.test(url.pathname + url.search) || /mpegurl/i.test(contentType || "");
}

/** Rewrite a playlist so every URI goes back through this worker. */
function rewritePlaylist(body, target, workerOrigin) {
  const base = new URL(target);
  return body
    .split("\n")
    .map((line) => {
      const l = line.trim();
      if (!l) return line;
      // #EXT-X-KEY / #EXT-X-MAP carry URIs too
      if (l.startsWith("#EXT-X-KEY") || l.startsWith("#EXT-X-MAP")) {
        return l.replace(/URI="([^"]+)"/, (_, uri) => {
          const abs = new URL(uri, base).toString();
          if (!hostAllowed(new URL(abs).host)) return `URI="${abs}"`;
          return `URI="${workerOrigin}/?u=${encodeURIComponent(abs)}"`;
        });
      }
      if (l.startsWith("#")) return line;
      const abs = new URL(l, base).toString();
      if (!hostAllowed(new URL(abs).host)) return abs;
      return `${workerOrigin}/?u=${encodeURIComponent(abs)}`;
    })
    .join("\n");
}

/** Turn the upstream response into ours: playlists rewritten, media passed through. */
async function buildResponse(upstream, parsed, origin, method, ttl) {
  const contentType = upstream.headers.get("Content-Type") || "";

  if (isPlaylist(parsed, contentType)) {
    const text = await upstream.text();
    return new Response(rewritePlaylist(text, parsed.toString(), origin), {
      status: upstream.status,
      headers: corsHeaders({
        "Content-Type": "application/x-mpegURL",
        "Cache-Control": `public, max-age=${ttl}`
      })
    });
  }

  const headers = corsHeaders({});
  for (const name of ["Content-Type", "Content-Length", "Accept-Ranges", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  if (!headers["Content-Type"]) headers["Content-Type"] = "video/MP2T";
  headers["Cache-Control"] = `public, max-age=${ttl}`;

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, "method_not_allowed");
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("u");
    if (!target) return jsonError(400, "missing_u");

    let parsed;
    try {
      parsed = new URL(target.startsWith("//") ? "https:" + target : target);
    } catch (e) {
      return jsonError(400, "bad_url");
    }
    if (parsed.protocol !== "https:" || !hostAllowed(parsed.hostname)) {
      return jsonError(403, "host_not_allowed");
    }

    const range = request.headers.get("Range");
    const upstreamHeaders = {
      "User-Agent": UA,
      "Referer": "https://kodikplayer.com/",
      "Accept": "*/*",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"
    };
    if (range) upstreamHeaders["Range"] = range;

    // A playlist lives a minute, media a week. A cache hit is answered by Cloudflare
    // itself, so replays and seeks cost no worker requests at all.
    const cache = caches.default;
    const cacheKey = new Request(parsed.toString(), { method: "GET" });
    const playlistRequest = isPlaylist(parsed, "");
    const ttl = playlistRequest ? PLAYLIST_TTL : MEDIA_TTL;

    if (!range) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        // Playlists are cached raw, so they still need rewriting for this origin.
        const contentType = cached.headers.get("Content-Type") || "";
        return buildResponse(cached, parsed, url.origin, request.method, ttl);
      }
    }

    let upstream;
    try {
      upstream = await fetch(parsed.toString(), { headers: upstreamHeaders, redirect: "follow" });
    } catch (e) {
      return jsonError(502, "upstream_unreachable");
    }

    if (!range && upstream.ok) {
      // Cache the raw body; the rewritten playlist is produced on every response.
      await cache.put(
        cacheKey,
        new Response(upstream.clone().body, {
          headers: {
            "Content-Type": upstream.headers.get("Content-Type") || (playlistRequest ? "application/x-mpegURL" : "video/MP2T"),
            "Cache-Control": `public, max-age=${ttl}`
          }
        })
      );
    }

    return buildResponse(upstream, parsed, url.origin, request.method, ttl);
  }
};
