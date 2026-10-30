// === kodik_extractor.js ===
// Universal Kodik iframe -> direct HLS/MP4 resolver.
// Used by animego, animelib, animedia, anixart, yummyanime — any site that
// embeds `//kodikplayer.com/seria/{id}/{hash}/{q}` or similar iframes.
//
// Flow:
//   1. Fetch the iframe HTML.
//   2. Parse `urlParams = '{"d":..,"d_sign":..,"pd":..,"pd_sign":..,"ref":..,"ref_sign":..}'`.
//   3. Extract type/id/hash from the iframe path.
//   4. POST those values (form-urlencoded) to `https://{pd}/ftor`.
//   5. Response: `{links: {ugly:[{src}], bad:[...], good:[...]}}` — keys map to 360/480/720.
//   6. Each `src` is ROT18-rotated + base64; decode into an HLS URL.

// --- helpers ---

function kodikBase64Decode(s) {
    // Tolerate URL-safe alphabet + missing padding
    let str = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = str.length % 4;
    if (pad) str += "=".repeat(4 - pad);
    if (typeof atob === "function") {
        try { return atob(str); } catch (e) { /* fall through */ }
    }
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < str.length; i += 4) {
        const c1 = chars.indexOf(str.charAt(i));
        const c2 = chars.indexOf(str.charAt(i + 1));
        const c3p = str.charAt(i + 2) === "=" ? 0 : chars.indexOf(str.charAt(i + 2));
        const c4p = str.charAt(i + 3) === "=" ? 0 : chars.indexOf(str.charAt(i + 3));
        if (c1 < 0 || c2 < 0) break;
        const n = (c1 << 18) | (c2 << 12) | (c3p << 6) | c4p;
        out += String.fromCharCode((n >> 16) & 0xff);
        if (str.charAt(i + 2) !== "=") out += String.fromCharCode((n >> 8) & 0xff);
        if (str.charAt(i + 3) !== "=") out += String.fromCharCode(n & 0xff);
    }
    return out;
}

// ROT18-ish: shift each letter +18 wrapping within its case (matches kodik player.js inline atob)
function kodikRot18Decode(t) {
    if (!t) return "";
    const rotated = String(t).replace(/[a-zA-Z]/g, function (ch) {
        const max = ch <= "Z" ? 90 : 122;
        const code = ch.charCodeAt(0) + 18;
        return String.fromCharCode(max >= code ? code : code - 26);
    });
    return kodikBase64Decode(rotated);
}

function kodikDecodeSrc(src) {
    if (!src) return "";
    const s = String(src);
    // Some kodik responses already return a URL with "//"; use as-is
    if (s.indexOf("//") >= 0) return s.startsWith("http") ? s : ("https:" + s);
    const decoded = kodikRot18Decode(s);
    if (!decoded) return "";
    return decoded.startsWith("http") ? decoded : ("https:" + decoded);
}

// Kodik lists the other voice-overs in the iframe's `movie-translations-box`: every
// option carries the seria id + hash of that voice-over for the SAME episode.
function kodikParseTranslations(body) {
    const out = [];
    if (!body) return out;
    const boxIdx = body.indexOf("movie-translations-box");
    const scope = boxIdx >= 0 ? body.slice(boxIdx, boxIdx + 60000) : body;
    const re = /<option\b([^>]*)>([\s\S]*?)<\/option>/g;
    let m;
    while ((m = re.exec(scope)) !== null) {
        const attrs = m[1];
        const grab = function (name) {
            const mm = attrs.match(new RegExp("data-" + name + '="([^"]*)"'));
            return mm ? mm[1] : "";
        };
        const id = grab("media-id");
        const hash = grab("media-hash");
        if (!id || !hash) continue;
        const title = (grab("title") || m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
        if (!title || out.some(function (t) { return t.id === id && t.hash === hash; })) continue;
        const type = grab("translation-type");
        out.push({
            title: title + (type === "subtitles" ? " · субтитры" : ""),
            id: id,
            hash: hash
        });
    }
    return out;
}

// Parse `{host}` and path parts from a kodikplayer-like URL, tolerating `//` prefix.
function kodikParseUrl(raw) {
    if (!raw) return null;
    let u = String(raw);
    if (u.startsWith("//")) u = "https:" + u;
    if (!/^https?:\/\//.test(u)) return null;
    const m = u.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/);
    if (!m) return null;
    const host = m[1];
    const path = m[2] || "";
    const parts = path.split("/").filter(function (x) { return x; });
    // Expected: [type, id, hash, quality?]
    return {
        full: u,
        host: host,
        type: parts[0] || "",
        id: parts[1] || "",
        hash: parts[2] || ""
    };
}

// Fetch a Kodik `serial/{id}/{hash}/{q}` iframe and enumerate all episodes inside it.// Returns an array of { season, episode, title, id, hash, translationTitle } — each
// item can be converted to a seria URL via kodikBuildSeriaUrl().
async function kodikFetchSerialEpisodes(client, serialUrl, refererUrl) {
    const parsed = kodikParseUrl(serialUrl);
    if (!parsed || parsed.type !== "serial") return [];
    const pageHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Referer": refererUrl || "https://"
    };
    let res;
    try { res = await client.get(parsed.full, pageHeaders); } catch (e) { return []; }
    if (!res || res.statusCode !== 200 || !res.body) return [];
    const body = res.body;

    // Extract current season from serial-seasons-box (if any — fallback season=1)
    let currentSeason = "1";
    const seasonSelect = body.match(/<div[^>]*class="[^"]*serial-seasons-box[^"]*"[^>]*>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/);
    if (seasonSelect) {
        const sel = seasonSelect[1].match(/<option[^>]*selected[^>]*value="([^"]+)"/);
        const any = sel || seasonSelect[1].match(/<option[^>]*value="([^"]+)"/);
        if (any) currentSeason = any[1];
    }

    // Episode selector — serial-series-box
    const seriesBlock = body.match(/<div[^>]*class="[^"]*serial-series-box[^"]*"[^>]*>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/);
    if (!seriesBlock) return [];
    const options = [];
    const optRe = /<option[^>]*value="([^"]+)"[^>]*data-id="([^"]+)"[^>]*data-hash="([^"]+)"[^>]*(?:data-title="([^"]*)")?[^>]*>/g;
    let m;
    while ((m = optRe.exec(seriesBlock[1])) !== null) {
        options.push({
            season: currentSeason,
            episode: m[1],
            id: m[2],
            hash: m[3],
            title: (m[4] || `${m[1]} серия`).trim()
        });
    }
    return options;
}

function kodikBuildSeriaUrl(id, hash, quality) {
    return `//kodikplayer.com/seria/${id}/${hash}/${quality || "720"}p`;
}

// --- /ftor plumbing -----------------------------------------------------------

const KODIK_QUALITIES = ["240", "360", "480", "720", "1080", "2160"];
const KODIK_KEY_ALIASES = { "360": "ugly", "480": "bad", "720": "good", "1080": "great" };

// Build the FormData body from the iframe's `urlParams`.
function kodikFtorBody(bodyStr, id, hash) {
    const page = String(bodyStr || "");
    const m = page.match(/urlParams\s*=\s*'([^']+)'/);
    if (!m) return null;
    let params;
    try { params = JSON.parse(m[1]); } catch (e) { return null; }
    const typeMatch = page.match(/var\s+type\s*=\s*"([^"]+)"/);
    const type = typeMatch ? typeMatch[1] : "seria";
    const dec = function (s) { try { return decodeURIComponent(String(s || "")); } catch (e) { return String(s || ""); } };
    const obj = {
        d: params.d || "",
        d_sign: dec(params.d_sign),
        pd: params.pd || "",
        pd_sign: dec(params.pd_sign),
        ref: dec(params.ref),
        ref_sign: dec(params.ref_sign),
        type: type,
        id: id,
        hash: hash
    };
    return {
        pd: params.pd || "",
        str: Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&")
    };
}

// POST /ftor and return the decoded `links` map ({720: [{src}], …}) or null.
async function kodikFtor(client, host, bodyStr, headers, id, hash) {
    const data = kodikFtorBody(bodyStr, id, hash);
    if (!data) return null;
    const postHeaders = {
        "User-Agent": headers["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://" + host,
        "Referer": "https://" + host + "/" + "seria/" + id + "/" + hash + "/720p"
    };
    const pd = data.pd || host;
    const ftorUrl = "https://" + pd + "/ftor";
    let res;
    try {
        // A cold /ftor takes ~150–200 ms while the page itself is cached; the shared
        // lane keeps two requests in flight so a 7-voice-over episode resolves in ~1 s.
        res = await kodikLaneGet(client, ftorUrl, postHeaders, data.str);
        if (!res || res.statusCode !== 200) {
            // Some runtimes expect an object body instead of a pre-encoded string.
            const obj = {};
            data.str.split("&").forEach(function (pair) {
                const i = pair.indexOf("=");
                obj[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
            });
            res = await client.post(ftorUrl, postHeaders, obj);
        }
    } catch (e) { return null; }
    if (!res || res.statusCode !== 200 || !res.body) return null;
    try { return JSON.parse(res.body).links || {}; } catch (e) { return null; }
}

var kodikFtorTrail = null; // shared {active, queue} — see kodikFtor

// Same 2-at-a-time lane for GET/POST when many iframes are resolved at once.
// `body` may be a string (POST) — the body is passed through untouched.
function kodikLaneGet(client, url, headers, body) {
    let trail = kodikFtorTrail;
    if (!trail) trail = kodikFtorTrail = { active: 0, queue: [] };
    return new Promise(function (resolve) {
        const run = function () {
            trail.active++;
            Promise.resolve()
                .then(function () {
                    return body === undefined ? client.get(url, headers) : client.post(url, headers, body);
                })
                .catch(function () { return null; })
                .then(function (r) {
                    trail.active--;
                    const next = trail.queue.shift();
                    if (next) next();
                    resolve(r);
                });
        };
        if (trail.active < 2) run(); else trail.queue.push(run);
    });
}

// Quality links of one voice-over (falls back to the ugly/bad/good aliases).
// Order for the player menu: the first entry stays the default source (highest
// quality, first voice-over), then every other voice-over follows with its own
// qualities in a fixed order — so one continuous block per озвучка.
function kodikOrderVideos(videos) {
    const tag = function (v) { return String(v.quality || "").replace(/ \d+p$/, ""); };
    const groups = [];
    const byTag = {};
    for (const v of videos) {
        const t = tag(v);
        if (!byTag[t]) { byTag[t] = []; groups.push(t); }
        byTag[t].push(v);
    }
    for (const t of groups) {
        byTag[t].sort(function (a, b) { return (b._q || 0) - (a._q || 0); });
    }
    const main = byTag[groups[0]] ? byTag[groups[0]][0] : null;
    const out = main ? [main] : [];
    for (const t of groups) {
        for (const v of byTag[t]) if (v !== main) out.push(v);
    }
    videos.length = 0;
    videos.push.apply(videos, out);
    return videos;
}
function kodikTrackQuality(links) {
    if (!links) return null;
    for (let i = KODIK_QUALITIES.length - 1; i >= 0; i--) {
        const q = KODIK_QUALITIES[i];
        const arr = links[q] || links[KODIK_KEY_ALIASES[q]];
        if (arr && arr.length && arr[0] && arr[0].src) return { q: q, src: arr[0].src };
    }
    return null;
}

// Main entry. Returns array of Mangayomi video objects.
// `playerUrl`  the kodik iframe URL (may start with // or https).
// `refererUrl` site base URL that was used when embedding the iframe (Referer).
// `labelPrefix` prepended to each quality, e.g. "AniBoom · AniLiberty" or "Kodik".
// `options.allTranslations` — drop Kodik's Premium flags so /ftor returns the links of
//    every translation of the episode; each translation becomes its own player source
//    ("AniDUB 720p", "Субтитры 720p", …) and the player's quality menu doubles as the
//    voice-over switch. Also skips the "source is dead" check on the current voicing.
async function kodikExtract(client, playerUrl, refererUrl, labelPrefix, options) {
    const allTranslations = !!(options && options.allTranslations);
    const parsed = kodikParseUrl(playerUrl);
    if (!parsed || !parsed.type || !parsed.id || !parsed.hash) return [];
    const pageHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Referer": (refererUrl || "https://") + (refererUrl && !refererUrl.endsWith("/") ? "/" : "")
    };

    // The HLS/CDN hosts never accept the site Referer we had to send to Kodik —
    // they require Kodik's own origin. Without this the player stays on an endless
    // loading spinner because every segment request is rejected.
    const streamHeaders = {
        "User-Agent": pageHeaders["User-Agent"],
        "Referer": "https://" + parsed.host + "/",
        "Origin": "https://" + parsed.host
    };

    let pageRes;
    try { pageRes = await client.get(parsed.full, pageHeaders); } catch (e) { return []; }
    if (!pageRes || pageRes.statusCode !== 200 || !pageRes.body) return [];

    const host = parsed.host;
    const videos = [];
    const seen = {};
    const prefix = labelPrefix || 'Kodik';

    const push = function (title, link) {
        const full = link ? kodikDecodeSrc(link.src) : '';
        if (!full || seen[full]) return;
        seen[full] = true;
        videos.push({
            url: full,
            originalUrl: full,
            // The player's quality list doubles as the voice-over switch:
            // 'AniDUB 720p', 'Субтитры 720p', ...
            quality: (title ? String(title) : prefix) + ' ' + link.q + 'p',
            headers: streamHeaders,
            _q: parseInt(link.q, 10)
        });
    };

    // One player source per voice-over: Kodik exposes the seria id + hash of every
    // translation in the iframe's movie-translations-box. The voice-over the site
    // embeds is resolved first (the player starts on it), the rest follow in the lane.
    const translations = kodikParseTranslations(pageRes.body);
    const selfTitle = translations.find(function (t) {
        return t.id === parsed.id && t.hash === parsed.hash;
    });
    const others = translations.filter(function (t) {
        return !(t.id === parsed.id && t.hash === parsed.hash);
    });

    const current = kodikTrackQuality(await kodikFtor(client, host, pageRes.body, pageHeaders, parsed.id, parsed.hash));
    if (current) push(allTranslations && selfTitle ? selfTitle.title : '', current);

    if (allTranslations) {
        const resolved = await Promise.all(others.map(function (t) {
            // Both requests go through the shared 2-at-a-time lane: the iframe carries
            // urlParams (signed, short-lived) and /ftor turns them into HLS links.
            const url = 'https://' + host + '/' + (parsed.type || 'seria') + '/' + t.id + '/' + t.hash + '/720p';
            return kodikLaneGet(client, url, pageHeaders).then(function (res) {
                if (!res || res.statusCode !== 200 || !res.body) return null;
                return kodikFtor(client, host, res.body, pageHeaders, t.id, t.hash).then(function (links) {
                    return { title: t.title, link: kodikTrackQuality(links) };
                });
            }).catch(function () { return null; });
        }));
        for (const item of resolved) {
            if (item && item.link) push(item.title, item.link);
        }
        kodikOrderVideos(videos);
    }

    for (const v of videos) delete v._q;
    videos.sort(function (a, b) {
        const qa = parseInt((a.quality.match(/(\d+)p/) || [0, 0])[1], 10);
        const qb = parseInt((b.quality.match(/(\d+)p/) || [0, 0])[1], 10);
        return qb - qa;
    });
// Iframe fallback. Kodik's solodcdn HLS uses `:hls:` in path segments
    // (`/720.mp4:hls:seg-1-v1-a1.ts`) which Mangayomi's libmpv-based player
    // sometimes rejects as malformed URL. Append the raw kodik iframe URL as
    // the LAST option so users can switch to it if direct HLS fails.
    videos.push({
        url: parsed.full,
        originalUrl: parsed.full,
        quality: prefix + " · iframe (fallback)",
        headers: {
            "User-Agent": pageHeaders["User-Agent"],
            "Referer": (refererUrl || "https://") + (refererUrl && !refererUrl.endsWith("/") ? "/" : "")
        }
    });
    return videos;
}
