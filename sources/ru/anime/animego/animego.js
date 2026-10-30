// @include: kodik_extractor

const mangayomiSources = [{
    "name": "AnimeGO",
    "lang": "ru",
    "baseUrl": "https://animego.me",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.8.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/animego.js",
    "notes": "Каталог — бесконечная лента: страница N открывается как /anime/{N} (ноль-индексированная), старый ?page=N больше не листается. Поиск: /search/anime?q=… (выдача одна, без страниц), результаты переранжируются локально. Эпизоды и плееры: AJAX /player/{id} с кэшем. CVH отдаётся через API (HLS первым — быстрый старт), Kodik → HLS."
}];

const AG_BASE = "https://animego.me";
const AG_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AG_PAGE_SIZE = 20;
// CVH (the VK player behind most dubs) identifies itself with a constant
// publisher/aggregator pair; the embedded iframe carries the same values.
const AG_CVH_PUBLISHER = "747";
const AG_CVH_AGGREGATOR = "mali";

function agBase(source) {
    const raw = source && source.baseUrl;
    const s = typeof raw === "string" ? raw.trim() : "";
    return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : AG_BASE;
}

// Titles are compared in a normalised form: lower case, ё→е, punctuation gone.
function agNorm(text) {
    return String(text || "").toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^0-9a-zа-я]+/g, " ")
        .trim();
}

// The site's search is an OR-based fuzzy set: a query like "тетрадь смерти"
// returns everything that has either word. Results that contain the whole
// query go first; if there are none, results sharing at least one word stay;
// only when nothing matches at all is the raw order returned. Without this the
// wanted title can sit below a dozen unrelated ones.
function agRank(list, query) {
    const q = agNorm(query);
    if (!q) return list;
    const words = q.split(" ").filter(w => w.length >= 2);
    if (!words.length) words.push(q);

    const scored = list.map((item, index) => {
        const name = agNorm(item.name);
        let hits = 0;
        for (const w of words) {
            if (name.indexOf(w) >= 0) hits++;
        }
        let score = hits * 100;
        if (name === q) score = 3000;
        else if (name.indexOf(q) === 0) score = 2000;
        else if (name.indexOf(q) >= 0) score = 1000;
        else if (name.indexOf(words[0]) === 0) score += 250;
        if (hits === words.length && words.length > 1) score += 400;
        return { item: item, score: score, hits: hits, index: index };
    });

    const full = scored.filter(x => x.hits === words.length);
    const partial = scored.filter(x => x.hits > 0);
    // A one-word query keeps everything the site returned (its index also matches
    // other word forms), just ordered by relevance. For several words, results with
    // the whole phrase win; otherwise those sharing at least one word.
    const pool = words.length === 1
        ? scored
        : (full.length ? full : (partial.length ? partial : scored));
    pool.sort((a, b) => b.score - a.score || a.index - b.index);
    return pool.map(x => x.item);
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get headers() {
        return {
            "User-Agent": AG_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": agBase(this.source) + "/"
        };
    }

    get ajaxHeaders() {
        return {
            "User-Agent": AG_UA,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": agBase(this.source) + "/",
            "X-Requested-With": "XMLHttpRequest"
        };
    }

    absUrl(u) {
        const s = String(u || "").trim();
        if (!s) return "";
        if (s.startsWith("http")) return s;
        if (s.startsWith("//")) return "https:" + s;
        return agBase(this.source) + (s.startsWith("/") ? s : "/" + s);
    }

    parseCatalog(htmlBody) {
        const doc = new Document(htmlBody);
        const list = [];
        const seen = {};

        // Cards come in two flavours: div.ani-list__item (catalog feed) and
        // div.ani-grid__item (search results). Both hold .image__img + a title <a>.
        const items = doc.select("div.ani-list__item, div.ani-grid__item");
        for (const card of items) {
            const titleA = card.selectFirst(".ani-list__item-title a") ||
                card.selectFirst(".ani-grid__item-title a") ||
                card.selectFirst("a.ani-list__item-picture") ||
                card.selectFirst("a.ani-grid__item-picture") ||
                card.selectFirst("a");
            if (!titleA) continue;
            const href = titleA.attr("href") || "";
            if (!/^\/anime\/[^/]+-\d+\/?$/.test(href) || seen[href]) continue;
            seen[href] = true;
            const name = (titleA.attr("title") || titleA.text || "").trim();
            if (!name) continue;
            const img = card.selectFirst("img.image__img") || card.selectFirst("img");
            const imageUrl = img ? this.absUrl(img.attr("src") || img.attr("data-src") || "") : "";
            list.push({ name, imageUrl, link: href });
        }

        // Fallback for layouts without .ani-list__item wrappers.
        if (list.length === 0) {
            const anchors = doc.select("a");
            for (const a of anchors) {
                const h = a.attr("href") || "";
                if (!/^\/anime\/[^/]+-\d+\/?$/.test(h) || seen[h]) continue;
                if (/^\/anime\/(top-250|genre|status|type|season)/.test(h)) continue;
                seen[h] = true;
                const name = (a.attr("title") || a.text || "").trim();
                if (!name || name.length < 2) continue;
                const img = a.selectFirst("img");
                const imageUrl = img ? this.absUrl(img.attr("src") || img.attr("data-src") || "") : "";
                list.push({ name, imageUrl, link: h });
            }
        }

        return { list, hasNextPage: list.length >= AG_PAGE_SIZE };
    }

    // The catalog is an infinite feed: /anime/1, /anime/2 … (page-based ?page=N is
    // ignored by the server, every page returns the same first 20 titles).
    catalogUrl(page, sort, direction) {
        const n = page <= 1 ? "" : "/" + (page - 1);
        return `${agBase(this.source)}/anime${n}?sort=${sort}&direction=${direction || "desc"}`;
    }

    async getPopular(page) {
        const res = await this.client.get(this.catalogUrl(page, "rating"), this.headers);
        if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
        return this.parseCatalog(res.body);
    }

    async getLatestUpdates(page) {
        const res = await this.client.get(this.catalogUrl(page, "startDate"), this.headers);
        if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
        return this.parseCatalog(res.body);
    }

    async search(query, page, filters) {
        if (query && query.trim()) {
            // The search endpoint ignores &page and always returns the whole fuzzy
            // result set, so one request is all there is; rank it locally instead of
            // pretending there are more pages.
            const res = await this.client.get(`${agBase(this.source)}/search/anime?q=${encodeURIComponent(query.trim())}`, this.headers);
            if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
            const parsed = this.parseCatalog(res.body);
            return { list: agRank(parsed.list, query), hasNextPage: false };
        }

        // Path-based filters: /anime/genre/{slug}, /anime/status/{slug}, /anime/type/{slug}
        let base = `${agBase(this.source)}/anime`;
        if (filters && filters.length) {
            const f0 = filters[0]; // Genre
            if (f0 && f0.values) {
                const slug = f0.values[f0.state || 0].value;
                if (slug) base += `/genre/${slug}`;
            }
            const f1 = filters[1]; // Status
            if (f1 && f1.values && base === `${agBase(this.source)}/anime`) {
                const slug = f1.values[f1.state || 0].value;
                if (slug) base += `/status/${slug}`;
            }
            const f2 = filters[2]; // Type
            if (f2 && f2.values && base === `${agBase(this.source)}/anime`) {
                const slug = f2.values[f2.state || 0].value;
                if (slug) base += `/type/${slug}`;
            }
        }

        let sort = "rating", dir = "desc";
        if (filters && filters[3] && filters[3].values) {
            const idx = (filters[3].state && filters[3].state.index) || 0;
            sort = filters[3].values[idx].value || "rating";
            dir = filters[3].state && filters[3].state.ascending ? "asc" : "desc";
        }

        // Filtered lists are not paginated by the site — one page is enough.
        const res = await this.client.get(`${base}?sort=${sort}&direction=${dir}`, this.headers);
        if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
        const parsed = this.parseCatalog(res.body);
        parsed.hasNextPage = false;
        return parsed;
    }

    animeIdFromUrl(url) {
        const m = String(url || "").match(/\/anime\/[^/]*-(\d+)\/?/);
        return m ? m[1] : "";
    }

    // The player AJAX (episode ids + translation buttons) is fetched both when the
    // anime page opens and when an episode is tapped. It changes rarely, so a short
    // in-memory cache saves a whole round trip on every episode click.
    async playerContent(animeId) {
        const id = String(animeId || "");
        if (!id) return "";
        const now = Date.now();
        if (!this._playerCache) this._playerCache = {};
        const hit = this._playerCache[id];
        if (hit && now - hit.at < 5 * 60 * 1000) return hit.content;

        const res = await this.client.get(`${agBase(this.source)}/player/${id}`, this.ajaxHeaders);
        if (!res || res.statusCode !== 200) return "";
        let content = "";
        try { content = (JSON.parse(res.body).data || {}).content || ""; } catch (e) { return ""; }
        content = content.replace(/&amp;/g, "&");
        this._playerCache[id] = { at: now, content: content };
        return content;
    }

    async getDetail(url) {
        // Only the player AJAX is needed: it carries every episode id, its number
        // and the player buttons for all dubs.
        const animeId = this.animeIdFromUrl(url);
        if (!animeId) return { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: [] };

        const empty = { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: [] };
        const content = await this.playerContent(animeId);
        if (!content) return empty;

        // CVH/AniBoom links inside the HTML point at episode 1 with the default dub;
        // the current episode and the chosen translation are known per episode, so
        // rebuild those links here instead of relying on the buttons' data-player.
        this._translations = this.parseTranslations(content);
        return { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: this.parseEpisodes(content, animeId) };
    }

    parseTranslations(content) {
        const out = [];
        const re = /data-action="anime-player#chooseTranslation"[\s\S]{0,400}?data-translation-id="(\d+)"[\s\S]{0,400}?<span class="text-truncate">([^<]+)<\/span>/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            out.push({ id: m[1], name: m[2].trim() });
        }
        return out;
    }

    // Episode URLs carry everything needed to rebuild the per-dub player links:
    //   animego:/player/{animeId}?ep={episodeId}&tr={translationId}
    encodeEpisode(animeId, episodeId, translationId) {
        return `animego:/player/${animeId}?ep=${episodeId}&tr=${translationId || ""}`;
    }

    decodeEpisode(ref) {
        const m = String(ref || "").match(/animego:\/player\/(\d+)\?ep=(\d+)(?:&tr=(\d+))?/);
        if (!m) return null;
        return { animeId: m[1], episodeId: m[2], translationId: m[3] || "" };
    }

    // Episodes come as <div data-episode="8590" data-episode-number="1" …>.
    parseEpisodes(content, animeId) {
        const episodes = [];
        const translations = this._translations || [];
        const anchorRe = /data-episode="(\d+)"/g;
        let m;
        while ((m = anchorRe.exec(content)) !== null) {
            const id = m[1];
            const start = content.lastIndexOf("<", m.index);
            const tag = start >= 0 ? content.slice(start, m.index) : "";
            const numMatch = tag.match(/data-episode-number="(\d+)"/);
            const num = numMatch ? numMatch[1] : "";

            if (translations.length > 1) {
                // One Mangayomi episode per (episode, dub) so the dubs stay separate.
                for (const tr of translations) {
                    episodes.push({
                        name: `${num ? "Серия " + num : "Серия"} · ${tr.name}`,
                        url: this.encodeEpisode(animeId, id, tr.id),
                        dateUpload: Date.now().toString(),
                        scanlator: tr.name
                    });
                }
            } else {
                const tr = translations[0];
                episodes.push({
                    name: num ? `Серия ${num}` : "Серия",
                    url: this.encodeEpisode(animeId, id, tr ? tr.id : ""),
                    dateUpload: Date.now().toString(),
                    scanlator: tr ? tr.name : null
                });
            }
        }
        // Newest first, as every other source does.
        return episodes.reverse();
    }

    // --- CVH / AniBoom (VK-hosted video with an okcdn HLS) ---

    async cvhPlaylist(titleId, publisherId, aggregator) {
        const url = `https://plapi.cdnvideohub.com/api/v1/player/sv/playlist?pub=${publisherId}&id=${titleId}&aggr=${aggregator}`;
        const res = await this.client.get(url, { "User-Agent": AG_UA, "Accept": "application/json" });
        if (!res || res.statusCode !== 200) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    async cvhVideo(vkId) {
        const res = await this.client.get(`https://plapi.cdnvideohub.com/api/v1/player/sv/video/${vkId}`, { "User-Agent": AG_UA, "Accept": "application/json" });
        if (!res || res.statusCode !== 200) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    cvhVideos(info, translation, episode) {
        const videos = [];
        if (!info || !info.sources) return videos;
        const headers = { "User-Agent": AG_UA, "Referer": "https://animego.me/", "Origin": "https://animego.me" };
        const seen = {};
        const prefix = translation ? `${translation} · ` : "";
        // HLS goes first: it is segmented and starts playing almost immediately,
        // while the progressive MP4 files are 200–300 MB and make the player wait
        // for a large buffer (which is what felt slow next to AniStar).
        const mpeg = [
            ["mpegFullHdUrl", "1080p"], ["mpegHighUrl", "720p"], ["mpegMediumUrl", "480p"],
            ["mpegLowUrl", "360p"], ["mpegLowestUrl", "240p"], ["mpegTinyUrl", "144p"],
            ["mpegQhdUrl", "1440p"], ["mpeg2kUrl", "2K"], ["mpeg4kUrl", "4K"]
        ];
        const push = (u, label) => {
            if (!u || seen[u]) return;
            seen[u] = true;
            videos.push({ url: u, originalUrl: u, quality: label, headers });
        };
        if (info.sources.hlsUrl) push(info.sources.hlsUrl, `AnimeGO · ${prefix}HLS (adaptive)`);
        for (const m of mpeg) push(info.sources[m[0]], `AnimeGO · ${prefix}${m[1]} (mp4)`);
        return videos;
    }

    async cvhResolve(animeId, epNumber, translationName, content) {
        let html = content;
        if (!html) html = await this.playerContent(animeId);
        if (!html) return null;

        const cvhTag = html.match(/<[a-z]+[^>]*data-player="[^"]*cdn-iframe[^"]*"[^>]*>/i);
        if (!cvhTag) return null;
        // /cdn-iframe/{titleId}/{episode}/{???}?dubbing=…
        const path = cvhTag[0].match(/cdn-iframe\/(\d+)/);
        const titleId = path ? path[1] : "";
        if (!titleId) return null;

        // Publisher/aggregator are constant for this player, so the embedded iframe
        // page is only fetched if the defaults are ever rejected.
        let publisherId = AG_CVH_PUBLISHER;
        let aggregator = AG_CVH_AGGREGATOR;
        let list = await this.cvhPlaylist(titleId, publisherId, aggregator);
        if (!list || !list.items) {
            const iframeUrl = this.absUrl((cvhTag[0].match(/data-player="([^"]+)"/) || [])[1] || "");
            const iframe = iframeUrl ? await this.client.get(iframeUrl, this.headers) : null;
            if (iframe && iframe.statusCode === 200) {
                const pm = iframe.body.match(/data-publisher-id="(\d+)"/);
                const am = iframe.body.match(/data-aggregator="([^"]+)"/);
                publisherId = pm ? pm[1] : "";
                aggregator = am ? am[1] : "";
                if (publisherId) list = await this.cvhPlaylist(titleId, publisherId, aggregator);
            }
        }
        if (!list || !list.items) return null;
        const wanted = String(epNumber || "");
        let item = list.items.filter(x => String(x.episode) === wanted);
        if (translationName) {
            const byDub = item.filter(x => (x.voiceStudio || "") === translationName);
            if (byDub.length) item = byDub;
        }
        item = item.filter(x => x.vkId);
        if (!item.length) return null;
        // Prefer full dubs, then subtitles.
        item.sort((a, b) => {
            const rank = x => (x.voiceType === "Дубляж" ? 0 : x.voiceType === "Многоголосый" ? 1 : 2);
            return rank(a) - rank(b);
        });
        const info = await this.cvhVideo(item[0].vkId);
        // Label with the studio that actually answered, not with the requested one.
        return this.cvhVideos(info, item[0].voiceStudio || translationName || "", epNumber);
    }

    async getVideoList(url) {
        // Internal reference from getDetail.
        const ref = this.decodeEpisode(url);
        if (ref) return await this.resolveEpisode(ref.animeId, ref.episodeId, ref.translationId);

        const u = this.absUrl(url);
        const playerId = (u.match(/\/player\/(\d+)/) || [])[1] || "";
        const content = playerId ? await this.playerContent(playerId) : "";
        if (!content) {
            const res = await this.client.get(u, this.ajaxHeaders);
            if (!res || res.statusCode !== 200) return [];
            let body = "";
            try { body = (JSON.parse(res.body).data || {}).content || ""; } catch (e) { return []; }
            return await this.videosFromPlayerContent(body.replace(/&amp;/g, "&"));
        }
        return await this.videosFromPlayerContent(content);
    }

    async resolveEpisode(animeId, episodeId, translationId) {
        const content = await this.playerContent(animeId);
        if (!content) return [];

        const translations = this.parseTranslations(content);
        const tr = translations.filter(t => String(t.id) === String(translationId))[0] || translations[0] || { id: "", name: "" };
        let epNumber = "";
        let mm;
        const epRe = /data-episode="(\d+)"/g;
        while ((mm = epRe.exec(content)) !== null) {
            if (mm[1] !== String(episodeId)) continue;
            const start = content.lastIndexOf("<", mm.index);
            const tag = start >= 0 ? content.slice(start, mm.index) : "";
            const numM = tag.match(/data-episode-number="(\d+)"/);
            epNumber = numM ? numM[1] : "";
            break;
        }

        // CVH and the other players are independent: start both, but do not wait for
        // the slower one (Kodik makes extra requests) when CVH already answered.
        const othersPromise = this.videosFromPlayerContent(content, epNumber, tr.name).catch(() => []);
        let cvh = null;
        if (epNumber) {
            cvh = await this.cvhResolve(animeId, epNumber, tr.name, content).catch(() => null);
        }
        if (cvh && cvh.length) return cvh;
        return await othersPromise;
    }

    // AniBoom embeds its stream as a doubly HTML-escaped JSON blob inside the iframe
    // page: &quot;hls&quot;:&quot;{\&quot;src\&quot;:\&quot;https:\\\/\\\/poppy…\/master.m3u8\&quot;…}&quot;
    async aniboomResolve(playerUrl) {
        const res = await this.client.get(playerUrl, { "User-Agent": AG_UA, "Referer": agBase(this.source) + "/" });
        if (!res || res.statusCode !== 200) return [];
        // Unescape repeatedly: HTML entities first, then the JSON backslashes.
        // Backslashes are removed wholesale — they never belong in an http(s) URL.
        let s = String(res.body || "");
        for (let i = 0; i < 4; i++) {
            const next = s
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, "&")
                .replace(/&#0?39;/g, "'")
                .replace(/&#047;/g, "/")
                .replace(/\\+/g, "");
            if (next === s) break;
            s = next;
        }
        const videos = [];
        const seen = {};
        const headers = { "User-Agent": AG_UA, "Referer": "https://aniboom.one/" };
        const push = (u, label) => {
            if (!u || seen[u]) return;
            const clean = String(u).replace(/\\/g, "");
            seen[clean] = true;
            videos.push({ url: clean, originalUrl: clean, quality: label, headers });
        };
        // After unescaping the payload looks like: "hls":"{"src":"https://…/master.m3u8",…}"
        // (the inner braces are quoted, so match on the src value only).
        const master = s.match(/"hls"\s*:\s*"\{\s*"src"\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/) ||
            s.match(/"src"\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/);
        if (master) push(master[1], "AnimeGO · AniBoom HLS (adaptive)");
        const dash = s.match(/"dash"\s*:\s*"\{\s*"src"\s*:\s*"(https?:[^"]+\.mpd[^"]*)"/) ||
            s.match(/"src"\s*:\s*"(https?:[^"]+\.mpd[^"]*)"/);
        if (dash) push(dash[1], "AnimeGO · AniBoom DASH");
        return videos;
    }

    async videosFromPlayerContent(content, epNumber, translationName) {
        const videos = [];
        const re = /<[a-z]+[^>]*data-player="([^"]+)"[^>]*>/gi;
        let m;
        while ((m = re.exec(content)) !== null) {
            const tag = m[0];
            const playerUrl = m[1];
            const provM = tag.match(/data-provider-title="([^"]*)"/);
            const trM = tag.match(/data-translation-title="([^"]*)"/);
            const provider = provM ? provM[1] : "";
            const translation = trM ? trM[1] : "";
            if (!playerUrl) continue;

            let src = this.absUrl(playerUrl);
            const prov = provider.toLowerCase();

            if (prov === "kodik" || src.indexOf("kodikplayer") >= 0) {
                const kodikVids = await kodikExtract(this.client, src, agBase(this.source), `AnimeGO · ${translation || "Kodik"}`);
                for (const v of kodikProxyVideos(kodikVids)) videos.push(v);
                continue;
            }

            // CVH is resolved through its API below (see resolveEpisode); the static
            // link always points at episode 1, so it is only a last-resort fallback.
            if (prov === "cvh") continue;

            if (prov === "aniboom") {
                try {
                    const ab = await this.aniboomResolve(src);
                    for (const v of ab) videos.push(v);
                } catch (e) { /* ignore */ }
                if (videos.length) continue;
            }

            videos.push({
                url: src,
                originalUrl: src,
                quality: `AnimeGO · ${translation || provider} (${provider})`,
                headers: { "User-Agent": AG_UA, "Referer": agBase(this.source) + "/" }
            });
        }
        return videos;
    }

    getFilterList() {
        const genres = [
            ["— Любой —", ""], ["Боевик", "action"], ["Приключения", "adventure"],
            ["Комедия", "comedy"], ["Драма", "drama"], ["Фэнтези", "fantasy"],
            ["Ужасы", "horror"], ["Мистика", "mystery"], ["Мифология", "mythology"],
            ["Романтика", "romance"], ["Научная фантастика", "sci-fi"], ["Сэйнэн", "seinen"],
            ["Сёнен", "shounen"], ["Сёдзё", "shoujo"], ["Сверхъестественное", "supernatural"],
            ["Повседневность", "slice-of-life"], ["Гурман", "gourmet"],
            ["Меха", "mecha"], ["Музыка", "music"], ["Спорт", "sports"],
            ["Этти", "ecchi"], ["Гарем", "harem"], ["Школа", "school"],
            ["Исторический", "historical"], ["Психологическое", "psychological"],
            ["Триллер", "thriller"], ["Исекай", "isekai"],
            ["Боевые искусства", "martial-arts"], ["Магия", "magic"],
            ["Демоны", "demons"], ["Вампиры", "vampires"]
        ];
        const statuses = [
            ["— Любой —", ""], ["Онгоинг", "ongoing"], ["Вышло", "released"], ["Анонс", "anons"]
        ];
        const types = [
            ["— Любой —", ""], ["TV Сериал", "tv"], ["Фильм", "movie"],
            ["ONA", "ona"], ["OVA", "ova"], ["Спешл", "special"]
        ];
        return [
            {
                type_name: "SelectFilter", type: "genre", name: "Жанр", state: 0,
                values: genres.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            },
            {
                type_name: "SelectFilter", type: "status", name: "Статус", state: 0,
                values: statuses.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            },
            {
                type_name: "SelectFilter", type: "type", name: "Тип", state: 0,
                values: types.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            },
            {
                type_name: "SortFilter", type: "sort", name: "Сортировка",
                state: { type_name: "SortState", index: 0, ascending: false },
                values: [
                    ["Рейтинг", "rating"], ["Дата начала", "startDate"], ["Название", "name"]
                ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            }
        ];
    }
    getSourcePreferences() { return [kodikProxyPreference()]; }
}
