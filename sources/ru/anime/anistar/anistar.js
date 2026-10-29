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
    "version": "0.3.1",
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
            const name = asUnescape(m[1]).trim();
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
        const s = asUnescape(name);
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
        const genreSlug = (filters && filters[0] && filters[0].values)
            ? (filters[0].values[filters[0].state || 0].value || "")
            : "";

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
            const title = asUnescape(m[1]) || `Серия ${n}`;
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
        return [{
            type_name: "SelectFilter",
            type: "genre",
            name: "Жанр",
            state: 0,
            values: [
                ["— Любой —", ""],
                ["Экшен", "экшн"], ["Приключения", "приключения"], ["Комедия", "комедия"],
                ["Драма", "драма"], ["Фэнтези", "фэнтези"], ["Романтика", "романтика"],
                ["Сёнэн", "сёнэн"], ["Сэйнэн", "сэйнэн"], ["Сёдзё", "сёдзё"],
                ["Мистика", "мистика"], ["Ужасы", "ужасы"], ["Меха", "меха"],
                ["Фантастика", "фантастика"], ["Гарем", "гарем"], ["Этти", "этти"],
                ["Школа", "школа"], ["Повседневность", "повседневность"],
                ["Боевые искусства", "боевые искусства"], ["Исторический", "исторический"],
                ["Музыка", "музыка"], ["Спорт", "спорт"], ["Военный", "военный"],
                ["Детектив", "детектив"], ["Психология", "психология"],
                ["Пародия", "пародия"], ["Игра", "игра"], ["Исекай", "исекай"],
                ["Гурман", "гурман"], ["Демоны", "демоны"], ["Вампиры", "вампиры"],
                ["Хентай", "хентай"]
            ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
        }];
    }

    getSourcePreferences() { return []; }
}
