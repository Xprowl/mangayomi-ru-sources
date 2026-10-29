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
    "version": "0.1.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/anistar.js",
    "notes": "AniStar (v31.astar.bz, DLE-движок, windows-1251). Каталог /anime/page/N/, жанры /filter/janrs/<urlencoded>/. Серии и плееры — из iframe /test/player2/videoas_p2p_new.php: HLS (адаптивный) + MP4 360/720 с CDN an-media.org (нужен Referer сайта). Встроенный поиск DLE по аниме не работает — поиск идёт по каталогу."
}];

const AS_BASE = "https://v31.astar.bz";
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
        const res = await this.client.get(url, this.headers);
        const body = res && res.body ? String(res.body) : "";
        if (res && res.statusCode === 200 && body && body.indexOf("�") < 0) return body;
        const decoded = await this.xhr1251(url);
        return decoded || body;
    }

    xhr1251(url) {
        return new Promise(resolve => {
            try {
                if (typeof XMLHttpRequest === "undefined" || !/^https?:\/\//i.test(String(url))) return resolve("");
                const xhr = new XMLHttpRequest();
                xhr.open("GET", url, true);
                xhr.responseType = "arraybuffer";
                xhr.setRequestHeader("Accept-Language", "ru-RU,ru;q=0.9");
                xhr.setRequestHeader("Referer", asBase(this.source) + "/");
                xhr.onload = function () {
                    if (xhr.status !== 200 || !xhr.response) return resolve("");
                    try {
                        const text = new TextDecoder("windows-1251").decode(new Uint8Array(xhr.response));
                        resolve(text);
                    } catch (e) {
                        resolve("");
                    }
                };
                xhr.onerror = function () { resolve(""); };
                xhr.ontimeout = function () { resolve(""); };
                xhr.send();
            } catch (e) {
                resolve("");
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

    // Titles come from a windows-1251 page read as bytes; U+FFFD markers mean the
    // decode failed, so fall back to the URL slug.
    tidyName(name, href) {
        let s = asUnescape(name);
        if (s && s.indexOf("�") < 0) return s;
        const m = String(href || "").match(/\/(\d+)-([^/.]+)\.html/);
        if (!m) return s || String(href || "");
        return m[2].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
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
        return this.parseCatalog(body);
    }

    async getLatestUpdates(page) {
        const url = page <= 1 ? `${asBase(this.source)}/anime/` : `${asBase(this.source)}/anime/page/${page}/`;
        const body = await this.fetch1251(url);
        if (!body) return { list: [], hasNextPage: false };
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
        const parsed = this.parseCatalog(body);

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

        let playerUrl = "";
        const iframe = body.match(/src="(\/test\/player2\/videoas[^"]*)"/);
        if (iframe) playerUrl = this.abs(asUnescape(iframe[1]));

        // The player page carries the full episode playlist.
        const episodes = playerUrl ? await this.parseEpisodes(playerUrl) : [];
        return { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: episodes };
    }

    async parseEpisodes(playerUrl) {
        const body = await this.fetch1251(playerUrl);
        if (!body) return [];

        const episodes = [];
        // Each playlist entry starts with title:"…"; the number of entries is the
        // episode count (the field order inside an entry varies by title).
        const titleRe = /title:"([^"]*)"/g;
        let m;
        let n = 0;
        while ((m = titleRe.exec(body)) !== null) {
            const title = asUnescape(m[1]);
            // Skip non-episode titles (quality labels inside files[]/files_mp4[]).
            if (/^\d{3,4}$/.test(title)) continue;
            n++;
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
        const addVideo = (u, label) => {
            const full = this.abs(u);
            if (!full || seen[full]) return;
            seen[full] = true;
            videos.push({ url: full, originalUrl: full, quality: label, headers: { "User-Agent": this.headers["User-Agent"], "Referer": asBase(this.source) + "/" } });
        };

        // HLS from the playlist_hls.php proxy link (file:"…?360=<encoded>&720=<encoded>").
        // AniStar always serves this proxy form, and the proxy is required anyway: raw
        // sfv URLs carry a signed key with "+" and are rejected (403).
        const proxyM = chunk.match(/file:"(\/test\/player2\/playlist_hls\.php[^"]*)"/);
        if (proxyM) {
            const proxyRes = await this.fetch1251(this.abs(proxyM[1]));
            if (proxyRes) {
                const lines = proxyRes.split("\n").map(x => x.trim()).filter(l => l && !l.startsWith("#"));
                const tagPath = String(proxyM[1]).indexOf("720=") >= 0 ? /\/720\./ : /\/360\./;
                // Each stream is wrapped in the proxy again: the raw sfv URL (signed key
                // with "+") is rejected directly, the proxied one plays.
                for (const line of lines) {
                    const tag = /\/720\./.test(line) ? "HQ" : /\/360\./.test(line) ? "SD" : (tagPath.test(line) ? "HQ" : "stream");
                    const wrapped = `${asBase(this.source)}/test/player2/playlist_hls.php?q=${encodeURIComponent(line)}&type=.mp4`;
                    addVideo(wrapped, `AniStar · HLS ${tag}`);
                }
            }
        } else {
            // Some pages expose the streams directly.
            const hlsRe = /file:"(https:[^"]+\.m3u8[^"]*)"/g;
            let m;
            while ((m = hlsRe.exec(chunk)) !== null) {
                addVideo(`${asBase(this.source)}/test/player2/playlist_hls.php?q=${encodeURIComponent(m[1])}&type=.mp4`, "AniStar · HLS");
            }
        }
        // MP4 variants from files_mp4[]
        {
            const mp4Re = /title:"([^"]*)"\s*,\s*file:"(https:[^"]+\.mp4[^"]*)"/g;
            let m;
            while ((m = mp4Re.exec(chunk)) !== null) {
                addVideo(m[2], `AniStar · MP4 ${m[1]}`);
            }
        }

        // Block-based playlists (older layout): resolve the master playlist directly.
        if (videos.length === 0) {
            const master = chunk.match(/file:"(\/test\/player2\/playlist_hls\.php[^"]*)"/);
            if (master) {
                const plBody = await this.fetch1251(this.abs(master[1]));
                if (plBody) {
                    const lines = plBody.split("\n").map(x => x.trim());
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        if (!line || line.startsWith("#")) continue;
                        const tag = line.indexOf("sfv.") >= 0 ? "HQ" : line.indexOf("sf2.") >= 0 ? "SD" : `#${i}`;
                        addVideo(line, `AniStar · HLS ${tag}`);
                    }
                }
            }
        }

        // MP4 first: some players cannot follow the adaptive playlist.
        videos.sort((a, b) => {
            const am = a.quality.indexOf("MP4") >= 0 ? 0 : 1;
            const bm = b.quality.indexOf("MP4") >= 0 ? 0 : 1;
            return am - bm;
        });
        return videos;
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
