const mangayomiSources = [{
    "name": "AniStar",
    "lang": "ru",
    "baseUrl": "https://v31.astar.bz",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.3.3",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/anistar.js",
    "notes": "AniStar (v31.astar.bz, DLE-движок, windows-1251). Каталог /anime/page/N/, жанры /filter/janrs/<urlencoded>/. Серии и плееры — из iframe /test/player2/videoas_p2p_new.php: HLS (адаптивный) + MP4 360/720 с CDN an-media.org (нужен Referer сайта). Встроенный поиск DLE по аниме не работает — поиск идёт по каталогу."
}];

const AS_BASE = "https://v31.astar.bz";
// Transcoding reader (returns the page as UTF-8 text).
const AS_PROXY = "https://r.jina.ai/";
const AS_PAGE_SIZE = 10;

function asBase(source) {
    const raw = source && source.baseUrl;
    const s = typeof raw === "string" ? raw.trim() : "";
    return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : AS_BASE;
}

function asUnescape(s) {
    if (!s) return "";
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&laquo;/g, "«")
        .replace(/&raquo;/g, "»")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

// CP1251 byte → character. The 0xC0–0xFF range is contiguous, 0xA8/0xB8 are Ё/ё.
const AS_CP1251_HIGH = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁё";
// The 0x80–0xBF half of the same table (punctuation, Ukrainian/Serbian letters).
const AS_CP1251_LOW = "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ\u00A0ЎўЈ¤Ґ¦§Ё©Є«¬\u00AD®Ї°±Ііґµ¶·ё№є»јЅѕї";

function asCp1251Byte(ch) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) return c;
    let i = AS_CP1251_LOW.indexOf(ch);
    if (i >= 0) return 0x80 + i;
    i = AS_CP1251_HIGH.indexOf(ch);
    if (i >= 0 && i < 64) return 0xC0 + i;
    return -1;
}

function asDecode1251(bytes) {
    if (!bytes || !bytes.length) return "";
    // Native decoder first (some runtimes ship one), manual table as the fallback.
    try {
        if (typeof TextDecoder !== "undefined") {
            const native = new TextDecoder("windows-1251").decode(bytes);
            if (native && native.indexOf("\uFFFD") < 0) return native;
        }
    } catch (e) { /* no native decoder for this label */ }

    let out = "";
    const chunk = [];
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b < 0x80) chunk.push(String.fromCharCode(b));
        else if (b >= 0xC0) chunk.push(AS_CP1251_HIGH.charAt(b - 0xC0));
        else if (b === 0xA8) chunk.push("Ё");
        else if (b === 0xB8) chunk.push("ё");
        else chunk.push("");
    }
    out = chunk.join("");
    return out;
}

// Repairs text that was decoded as UTF-8 from UTF-8 bytes but is still full of U+FFFD,
// by reading the surviving latin characters of the CP1251 page instead.
function asFixMojibake(text) {
    return String(text || "").replace(/\uFFFD+/g, "");
}

// The runtime sometimes decodes CP1251 bytes as Latin-1/Windows-1252, which turns
// "Магия" into "Ìàãèÿ". Each character then still holds the original byte value, so the
// text is repaired by mapping the characters straight back to CP1251.
const AS_LATIN1_TO_CP1251 = {
    0xC0: "А", 0xC1: "Б", 0xC2: "В", 0xC3: "Г", 0xC4: "Д", 0xC5: "Е", 0xC6: "Ж", 0xC7: "З",
    0xC8: "И", 0xC9: "Й", 0xCA: "К", 0xCB: "Л", 0xCC: "М", 0xCD: "Н", 0xCE: "О", 0xCF: "П",
    0xD0: "Р", 0xD1: "С", 0xD2: "Т", 0xD3: "У", 0xD4: "Ф", 0xD5: "Х", 0xD6: "Ц", 0xD7: "Ч",
    0xD8: "Ш", 0xD9: "Щ", 0xDA: "Ъ", 0xDB: "Ы", 0xDC: "Ь", 0xDD: "Э", 0xDE: "Ю", 0xDF: "Я",
    0xE0: "а", 0xE1: "б", 0xE2: "в", 0xE3: "г", 0xE4: "д", 0xE5: "е", 0xE6: "ж", 0xE7: "з",
    0xE8: "и", 0xE9: "й", 0xEA: "к", 0xEB: "л", 0xEC: "м", 0xED: "н", 0xEE: "о", 0xEF: "п",
    0xF0: "р", 0xF1: "с", 0xF2: "т", 0xF3: "у", 0xF4: "ф", 0xF5: "х", 0xF6: "ц", 0xF7: "ч",
    0xF8: "ш", 0xF9: "щ", 0xFA: "ъ", 0xFB: "ы", 0xFC: "ь", 0xFD: "э", 0xFE: "ю", 0xFF: "я",
    0xA8: "Ё", 0xB8: "ё", 0xB9: "№"
};

// True when the string looks like CP1251 bytes read as Latin-1 ("Ìàãèÿ"): real
// Cyrillic is absent and at least two mapped characters stand next to each other.
// Two in a row are enough because mangled titles often mix Russian words with a
// long Latin original ("Å, äðóã / Kanojo no Tomodachi"): the ASCII part must not
// dilute the evidence, or such titles stay broken.
function asLooksLatin1(text) {
    const s = String(text || "");
    if (!s) return false;
    if (/[\u0400-\u04FF]/.test(s)) return false;
    let run = 0, best = 0;
    for (let i = 0; i < s.length; i++) {
        if (AS_LATIN1_TO_CP1251[s.charCodeAt(i)]) {
            run++;
            if (run > best) best = run;
        } else {
            run = 0;
        }
    }
    return best >= 2;
}

function asRepairLatin1(text) {
    let s = String(text || "");
    // Case 0: the page is UTF-8 but was decoded as CP1251 ("РЎРµСЂРёСЏ" = "Серия").
    //         Self-validating: the bytes only form valid UTF-8 when this is the case.
    s = asRepairUtf8AsCp1251(s);
    // Case 1: CP1251 bytes read as Latin-1 ("Ìàãèÿ" = "Магия").
    if (!asLooksLatin1(s)) return s;
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) out += s.charAt(i);
        else if (AS_LATIN1_TO_CP1251[c]) out += AS_LATIN1_TO_CP1251[c];
        else out += s.charAt(i);
    }
    return out;
}

// Turns "РЎРµСЂРёСЏ" back into "Серия": every character is mapped to the CP1251
// byte it came from and the bytes are read as UTF-8.
function asRepairUtf8AsCp1251(text) {
    const s = String(text || "");
    if (!s) return s;
    // Only strings whose characters are all CP1251 codepoints can be rebuilt.
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
        const b = asCp1251Byte(s.charAt(i));
        if (b < 0) return s;
        bytes.push(b);
    }
    let decoded = "";
    try {
        if (typeof TextDecoder === "undefined") return s;
        try {
            decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        } catch (e) {
            decoded = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
            if (decoded.indexOf("\uFFFD") >= 0) return s;
        }
    } catch (e) {
        return s;
    }
    if (!decoded || decoded === s) return s;
    // Accept it only when real Cyrillic came out of it.
    return /[\u0400-\u04FF]/.test(decoded) ? decoded : s;
}

// Selected value of a SelectFilter (Mangayomi keeps the chosen index in `state`).
function asFilterValue(filter) {
    if (!filter || !filter.values || !filter.values.length) return "";
    const option = filter.values[filter.state || 0];
    return option && typeof option === "object" ? (option.value || "") : "";
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    // The site is DLE-based and serves windows-1251 pages. Mangayomi's Client decodes
    // text as UTF-8, which turns Cyrillic into U+FFFD, so every request is repeated
    // through XMLHttpRequest with an explicit windows-1251 decoder when needed.
    get headers() {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": asBase(this.source) + "/"
        };
    }

    async fetch1251(url) {
        // 1) Raw bytes through XHR (works when the runtime exposes them).
        const bytes = await this.xhrCharset(url);
        if (bytes) {
            const decodedBytes = asDecode1251(bytes);
            if (decodedBytes && decodedBytes.indexOf("\uFFFD") < 0) return decodedBytes;
        }

        // 2) Plain request. Fine when the server already speaks UTF-8 or the runtime
        //    honours the charset header of the page.
        const res = await this.client.get(url, this.headers);
        const body = res && res.body ? String(res.body) : "";
        if (res && res.statusCode === 200 && body && body.indexOf("\uFFFD") < 0) return asFixMojibake(body);

        // 3) Transcoding proxy (markdown): the page is already UTF-8 text here, so
        //    Cyrillic survives. Parsed by parseMarkdownCatalog / parseMarkdownPage.
        const proxied = await this.client.get(AS_PROXY + url, { "Accept": "text/plain" });
        const proxiedBody = proxied && proxied.body ? String(proxied.body) : "";
        if (proxied && proxied.statusCode === 200 && proxiedBody.indexOf("Markdown Content") >= 0) {
            return "ASMD:" + proxiedBody;
        }
        return asFixMojibake(body);
    }

    // Markdown pages returned by the proxy start with this marker.
    isMarkdown(body) {
        return String(body || "").indexOf("ASMD:") === 0;
    }

    mdText(body) {
        return String(body || "").replace(/^ASMD:/, "");
    }

    // Player hash: the site serves it as a constant on the article page; the value
    // from the p2p player page works for every id.
    async playerHash(id) {
        const res = await this.client.get(`${asBase(this.source)}/test/player2/videoas_p2p_new.php?id=` + id + "&hash=", this.headers);
        const body = res && res.body ? String(res.body) : "";
        const m = body.match(/hash=([a-f0-9]{32})/);
        return m ? m[1] : "e86810a34113e404545a05b7e75444b6";
    }

    // Markdown catalogue of the proxy. Link text is the title, the poster next to it
    // is the cover: "[Герб демонов / Demons' Crest](https://…/11052-gerb-demonov-….html)"
    // preceded by "![Image N](…/uploads/posters/11052/…)".
    parseMarkdownCatalog(md) {
        const text = String(md || "");
        // Poster lines: "![Image N](…/uploads/posters/<id>/cover.jpg)"
        const posters = [];
        const posterRe = /!\[Image \d+[^\]]*\]\(([^)\s]*?\/uploads\/posters\/(\d+)\/[^)\s]+)\)/g;
        let p;
        while ((p = posterRe.exec(text)) !== null) {
            posters.push({ at: p.index, url: p[1], id: p[2] });
        }

        // Title links: "[Название](https://…/<id>-slug.html)" — skip "Смотреть".
        const list = [];
        const seen = {};
        const titleRe = /\[([^\]\n]{3,160})\]\((https?:\/\/[^)\s]*?\/(\d+)-[a-z0-9\-]+\.html)\)/g;
        let m;
        while ((m = titleRe.exec(text)) !== null) {
            const name = asRepairLatin1(asUnescape(m[1])).trim();
            const link = m[2];
            const id = m[3];
            if (!name || name === "Смотреть" || seen[id]) continue;
            // Category pages (/filter/…) also link articles; keep only titles.
            if (String(link).indexOf("/filter/") >= 0) continue;
            seen[id] = true;
            // Nearest poster within the same card (they are listed just above).
            let cover = "";
            for (let i = posters.length - 1; i >= 0; i--) {
                if (posters[i].at < m.index) {
                    cover = posters[i].id === id || m.index - posters[i].at < 4000 ? posters[i].url : "";
                    break;
                }
            }
            list.push({ name: name, imageUrl: cover, link: link });
        }
        return { list: list, hasNextPage: list.length >= 8 };
    }

    // Raw bytes of the page, or "" when the runtime cannot provide them.
    xhrCharset(url) {
        return new Promise(resolve => {
            try {
                if (typeof XMLHttpRequest === "undefined" || !/^https?:\/\//i.test(String(url))) return resolve(null);
                const xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader("Accept-Language", "ru-RU,ru;q=0.9");
                xhr.setRequestHeader("Referer", asBase(this.source) + "/");
                xhr.onload = function () {
                    if (xhr.status !== 200 || !xhr.response) return resolve(null);
                    resolve(new Uint8Array(xhr.response));
                };
                xhr.onerror = function () { resolve(null); };
                xhr.ontimeout = function () { resolve(null); };
                xhr.send();
            } catch (e) {
                resolve(null);
            }
        });
    }

    abs(u) {
        const s = String(u || "").trim();
        if (!s) return "";
        if (s.startsWith("http")) return s;
        if (s.startsWith("//")) return "https:" + s;
        return asBase(this.source) + (s.startsWith("/") ? s : "/" + s);
    }

    // Titles come from a windows-1251 page. When the text is unreadable (U+FFFD from a
    // UTF-8 decode of CP1251 bytes) fall back to the readable latin slug in the URL,
    // e.g. "3274-one-piece-van-pis.html" → "One Piece Van Pis".
    tidyName(name, href) {
        const s = asRepairLatin1(asUnescape(name));
        let readable = s.replace(/\uFFFD+/g, "").replace(/\s+/g, " ").trim();
        // ", / One Piece" → "One Piece": drop separators left behind by the lost Cyrillic.
        readable = readable.replace(/^[\s/|,\-–—]+|[\s/|,\-–—]+$/g, "").trim();
        if (readable && readable.replace(/[^A-Za-z0-9]/g, "").length >= 2) return readable;
        const m = String(href || "").match(/\/(\d+)-([^/.]+)\.html/);
        if (!m) return readable || String(href || "");
        return m[2]
            .replace(/-+/g, " ")
            .replace(/\b([a-z])/g, c => c.toUpperCase())
            .trim();
    }

    parseCatalog(htmlBody) {
        const doc = new Document(htmlBody);
        const list = [];
        const seen = {};

        let cards = doc.select("div.news");
        for (const card of cards) {
            const titleA = card.selectFirst(".title_left a");
            if (!titleA) continue;
            const href = titleA.attr("href") || "";
            if (!/\/\d+-[^/]+\.html$/.test(href) || seen[href]) continue;
            seen[href] = true;
            const name = this.tidyName(titleA.attr("title") || titleA.text || "", href);
            if (!name) continue;
            const img = card.selectFirst("img[itemprop='image']") || card.selectFirst("img.main-img");
            const imageUrl = img ? this.abs(img.attr("src") || img.attr("data-src") || "") : "";
            list.push({ name: name, imageUrl: imageUrl, link: href });
        }

        if (list.length === 0) {
            // Fallback: bare links to articles.
            const anchors = doc.select("a");
            for (const a of anchors) {
                const href = a.attr("href") || "";
                if (!/\/\d+-[^/]+\.html$/.test(href) || seen[href]) continue;
                seen[href] = true;
                const name = this.tidyName(a.attr("title") || a.text || "", href);
                if (!name) continue;
                list.push({ name: name, imageUrl: "", link: href });
            }
        }

        return { list: list, hasNextPage: list.length >= AS_PAGE_SIZE };
    }

    async getPopular(page) {
        // "Новинки(онгоинги)" mirrors the site's own main feed.
        const url = page <= 1 ? `${asBase(this.source)}/new/` : `${asBase(this.source)}/new/page/${page}/`;
        const body = await this.fetch1251(url);
        if (!body) return { list: [], hasNextPage: false };
        if (this.isMarkdown(body)) return this.parseMarkdownCatalog(this.mdText(body));
        return this.parseCatalog(body);
    }

    async getLatestUpdates(page) {
        const url = page <= 1 ? `${asBase(this.source)}/anime/` : `${asBase(this.source)}/anime/page/${page}/`;
        const body = await this.fetch1251(url);
        if (!body) return { list: [], hasNextPage: false };
        if (this.isMarkdown(body)) return this.parseMarkdownCatalog(this.mdText(body));
        return this.parseCatalog(body);
    }

    async search(query, page, filters) {
        // The DLE search module returns nothing for anime titles, so the catalog is
        // filtered locally instead (page by page, until a match shows up).
        const genreSlug = asFilterValue(filters && filters[0]) || asFilterValue(filters && filters[1]);

        const base = genreSlug
            ? `${asBase(this.source)}/filter/janrs/${encodeURIComponent(genreSlug)}`
            : `${asBase(this.source)}/anime`;
        const url = page <= 1 ? `${base}/` : `${base}/page/${page}/`;

        const body = await this.fetch1251(url);
        if (!body) return { list: [], hasNextPage: false };
        const parsed = this.isMarkdown(body) ? this.parseMarkdownCatalog(this.mdText(body)) : this.parseCatalog(body);

        if (!query || !query.trim()) return parsed;

        const q = query.trim().toLowerCase();
        const matched = parsed.list.filter(m => m.name.toLowerCase().indexOf(q) >= 0);
        return { list: matched, hasNextPage: parsed.hasNextPage };
    }

    async getDetail(url) {
        const pageUrl = this.abs(url);
        const body = await this.fetch1251(pageUrl);
        const empty = { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: [] };
        if (!body) return empty;

        // Markdown page: no iframe markup, but the player URL is built from the id.
        if (this.isMarkdown(body)) {
            const idMatch = pageUrl.match(/\/(\d+)-/);
            if (!idMatch) return empty;
            const hash = await this.playerHash(idMatch[1]);
            if (!hash) return empty;
            const playerUrl = `${asBase(this.source)}/test/player2/videoas.php?id=${idMatch[1]}&hash=${hash}`;
            return { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: await this.parseEpisodes(playerUrl) };
        }

        let playerUrl = "";
        const iframe = body.match(/src="(\/test\/player2\/videoas[^"]*)"/);
        if (iframe) playerUrl = this.abs(asUnescape(iframe[1]));

        // The player page carries the full episode playlist.
        const episodes = playerUrl ? await this.parseEpisodes(playerUrl) : [];
        return { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: episodes };
    }

    async parseEpisodes(playerUrl) {
        let body = await this.fetch1251(playerUrl);
        if (!body) return [];
        // The proxy answers with markdown for this URL — the playlist is not there,
        // so the playlist is requested without the proxy (it is plain HTML anyway).
        if (this.isMarkdown(body)) {
            const direct = await this.client.get(playerUrl, this.headers);
            body = direct && direct.body ? String(direct.body) : "";
            if (!body || body.indexOf("playlst") < 0) return [];
        }

        const episodes = [];
        // Each playlist entry starts with title:"…"; only those are episodes. Looking
        // for title:"…" anywhere also matches the quality labels inside files[].
        const titleRe = /\{\s*\n?\s*title:"([^"]*)"/g;
        let m;
        let n = 0;
        while ((m = titleRe.exec(body)) !== null) {
            n++;
            const title = asRepairLatin1(asUnescape(m[1])) || `Серия ${n}`;
            // Each episode URL re-fetches the same player page and picks the n-th item.
            episodes.push({
                name: title,
                url: playerUrl + "#" + n,
                dateUpload: Date.now().toString(),
                scanlator: null
            });
        }

        if (episodes.length === 0) {
            // No playlist markup — expose the player itself as a single episode.
            episodes.push({ name: "Серия 1", url: playerUrl + "#1", dateUpload: Date.now().toString(), scanlator: null });
        }
        return episodes.reverse();
    }

    async getVideoList(url) {
        const parts = String(url || "").split("#");
        const playerUrl = parts[0];
        const index = parseInt(parts[1] || "1") || 1;
        const raw = await this.fetch1251(playerUrl);
        if (!raw) return [];
        const body = raw.replace(/&amp;/g, "&");

        // Split the playlist into per-episode chunks.
        const chunks = body.split(/\{\s*\n?\s*title:"/).slice(1);
        const chunk = chunks[index - 1] || chunks[0] || "";
        if (!chunk) return [];

        const videos = [];
        const seen = {};
        const addVideo = (u, label, hdrs) => {
            const full = this.abs(u);
            if (!full || seen[full]) return;
            seen[full] = true;
            videos.push({
                url: full,
                originalUrl: full,
                quality: label,
                headers: hdrs || { "User-Agent": this.headers["User-Agent"], "Referer": asBase(this.source) + "/" }
            });
        };

        // MP4 first: these are exact files and play everywhere.
        {
            const mp4Re = /title:"([^"]*)"\s*,\s*file:"(https:[^"]+\.mp4[^"]*)"/g;
            let m;
            while ((m = mp4Re.exec(chunk)) !== null) {
                addVideo(m[2], `AniStar · MP4 ${m[1]}`);
            }
        }

        // HLS: the site's own master playlist is the ONLY working route — it proxies the
        // signed sfv CDN links (raw ones answer 403) and must not be wrapped again.
        const masterM = chunk.match(/file:"(\/test\/player2\/playlist_hls\.php\?[^"]*)"/);
        if (masterM) {
            const info = this.parseProxyParams(masterM[1]);
            addVideo(masterM[1], `AniStar · HLS (${info.length > 1 ? "адаптивный" : "поток"})`);
        }

        return videos;
    }

    // playlist_hls.php?360=<encoded>&720=<encoded>&type=.mp4 → list of available streams
    parseProxyParams(proxyUrl) {
        const out = [];
        const m = String(proxyUrl || "").match(/[?&](\d{3,4})=([^&]+)/g) || [];
        for (const pair of m) {
            const parts = pair.replace(/^[?&]/, "").split("=");
            if (!parts[1]) continue;
            try { out.push({ quality: parts[0], url: decodeURIComponent(parts[1]) }); } catch (e) { /* skip */ }
        }
        return out;
    }
    getFilterList() {
        // Values are the words the site itself uses: Cyrillic genres are taken from
        // /filter/janrs/<word>/, the adult tags keep the site's English spelling.
        const genres = [
            "Боевик", "Боевые искусства", "Военное", "Вестерн", "Гарем", "Гурман",
            "Демоны", "Детектив", "Дзёсэй", "Драма", "Игры", "Исторический", "Китай",
            "Комедия", "Магия", "Меха", "Музыкальное", "Мюзикл", "Пародия",
            "Повседневность", "Приключения", "Психологическое", "Романтика", "Самураи",
            "Сверхъестественное", "Спорт", "Супер сила", "Сэйнэн", "Сёдзё", "Сёдзё-ай",
            "Сёнен", "Сёнен-ай", "Триллер", "Ужасы", "Фантастика", "Фэнтези", "Школа",
            "Экшен", "Этти"
        ];
        const adult = [
            "Ahegao", "All sex", "Anal sex", "BDSM", "Big tits", "Blackmail", "Bondage",
            "Cheating", "Cosplay", "Creampie", "Dark skin", "Drugs", "Elf",
            "Emotionless sex", "Erotic", "Futanari", "Gangbang", "Gigantic Breasts",
            "Group", "Group sex", "Gyaru", "Harem", "Horror Oral", "Incest", "Lactation",
            "Maid", "Milf", "Milk", "Mind Break", "Mind Control", "Monster girl",
            "Netorare", "NTR", "Nun", "Nurse", "Oral", "Oral sex", "Oral sex Gyaru",
            "Paizuri", "Pregnant", "Prostitution", "Rape", "School uniform",
            "Schoolgirl uniform", "Slavery", "Slut", "Small tits", "Softcore", "Student",
            "Succubus", "Tentacles", "Toys", "Torture", "Trap", "Twins", "Virgin", "Yuri"
        ];
        const options = (list) => [["— Любой —", ""]].concat(list.map(x => [x, x]))
            .map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }));

        return [
            {
                type_name: "SelectFilter",
                type: "genre",
                name: "Жанр",
                state: 0,
                values: options(genres)
            },
            {
                type_name: "SelectFilter",
                type: "genre",
                name: "Теги 18+",
                state: 0,
                values: options(adult)
            }
        ];
    }

    getSourcePreferences() { return []; }
}
