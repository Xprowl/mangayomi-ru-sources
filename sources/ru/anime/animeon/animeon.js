// @include: kodik_extractor

const mangayomiSources = [{
    "name": "AnimeOn",
    "lang": "ru",
    "baseUrl": "https://animeon.cc",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.8.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/animeon.js",
    "notes": "AnimeOn (animeon.cc, Next.js). Everything comes from the site's own JSON API: catalog /api/anime (search, genre, kind, status, year, sort), title page /api/anime/<slug>. Episodes are in the title JSON (translations -> episodes -> Kodik seria link). Every episode row carries its dub in scanlator, so the dub is switched with Mangayomi's own episode filter (Filter -> group by scanlator); only the watched dub is resolved on play; the full dub list also stays available in the player (voiceList) and the next episode continues in the same dub. Video — Kodik HLS 240/360/480/720 (referer animeon.cc) plus the player iframe as a fallback. An optional free Cloudflare Worker proxy (settings -> animeon_proxy) can sit between the app and Kodik; if Kodik has dropped an episode, the same episode is retried in up to two other voice-overs. Titles without any translation (announcements) have no episodes."
}];

const AO_BASE = "https://animeon.cc";
const AO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AO_PAGE_SIZE = 20;
const AO_CACHE_TTL = 10 * 60 * 1000;
const AO_VIDEO_CACHE_TTL = 30 * 60 * 1000;

const AO_GENRES = [
    "Экшен", "Комедия", "Фэнтези", "Приключения", "Фантастика", "Драма", "Романтика",
    "Сёнен", "Школа", "Исторический", "Сверхъестественное", "Сэйнэн", "Тайна",
    "Взрослые персонажи", "Меха", "Боевые искусства", "Этти", "Военное",
    "Повседневность", "Супер сила", "Исэкай", "Гарем", "Музыка", "Спорт", "Мифология",
    "Триллер", "Сёдзё", "Космос", "Ужасы", "Психологическое", "Пародия", "Детское",
    "Жестокость", "Городское фэнтези", "Махо-сёдзё", "Антропоморфизм", "CGDCT",
    "Гэг-юмор", "Детектив", "Удостоено наград", "Реинкарнация", "Командный спорт",
    "Работа", "Самураи", "Вампиры", "Стратегические игры", "Путешествие во времени",
    "Иясикэй", "Яой", "Дзёсей", "Идолы (Жен.)", "Гурман", "Любовный многоугольник",
    "Исполнительское искусство", "Видеоигры", "Культура отаку",
    "Организованная преступность", "Гонки", "Юри", "Выживание", "Реверс-гарем",
    "Авангард", "Изобразительное искусство", "Питомцы", "Игра с высокими ставками",
    "Спортивные единоборства", "Забота о детях", "Идолы (Муж.)",
    "Романтический подтекст", "Шоу-бизнес", "Хулиганы", "Кроссдрессинг", "Медицина",
    "Сёдзё-ай", "Магическая смена пола", "Злодейка", "Эротика", "Образовательное",
    "Хентай", "Сёнен-ай"
];

const AO_KINDS = [
    ["ТВ-сериал", "tv"],
    ["Фильм", "movie"],
    ["OVA", "ova"],
    ["ONA", "ona"],
    ["Спешл", "special"],
    ["Клип", "music"]
];

function aoBase(source) {
    const raw = source && source.baseUrl;
    const s = typeof raw === "string" ? raw.trim() : "";
    return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : AO_BASE;
}

// "https://animeon.cc/anime/naruto-20" → "naruto-20".
function aoSlug(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    const m = s.match(/\/anime\/([^/?#]+)/);
    if (m) return m[1];
    return s.replace(/^\/+|\/+$/g, "").split("/").pop();
}

function aoPoster(base, item) {
    const raw = String((item && (item.poster || item.anime_poster)) || "").trim();
    const fallback = String((item && item.material_data && (item.material_data.anime_poster || item.material_data.poster_url)) || "").trim();
    const pick = raw || fallback;
    if (!pick) return "";
    if (/^https?:\/\//i.test(pick)) return pick;
    if (pick.startsWith("//")) return "https:" + pick;
    return base + (pick.startsWith("/") ? pick : "/" + pick);
}

function aoFilterValue(filters, index) {
    const f = filters && filters[index];
    if (!f || !f.values || !f.values.length) return "";
    const option = f.values[f.state || 0];
    return option && typeof option === "object" ? (option.value || "") : "";
}

// --- voice-over (озвучка) selection -------------------------------------------
// Kodik hides the voice-over list behind its Premium flag: the /ftor response only
// contains links for the current translation. Drop that flag (and the quality one)
// and it returns links for EVERY translation of the episode, which is how the player
// gets a normal "озвучка" switch.
const AO_PREF_DUB = "animeon_dub";
const AO_PREF_FILL = "animeon_dub_fill";
function aoPref(key, fallback) {
    try {
        if (typeof SharedPreferences === "undefined") return fallback;
        const value = new SharedPreferences().get(key);
        return value === undefined || value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

function aoTrackTag(track) {
    return track.name + (track.type === "subtitles" ? " · субтитры" : "");
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get headers() {
        return {
            "User-Agent": AO_UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": aoBase(this.source) + "/"
        };
    }

    // The whole site is driven by its own JSON API — one helper for every call.
    async api(path) {
        const url = /^https?:\/\//i.test(path) ? path : aoBase(this.source) + path;
        let res;
        try { res = await this.client.get(url, this.headers); } catch (e) { return null; }
        if (!res || res.statusCode !== 200 || !res.body) return null;
        try { return JSON.parse(res.body); } catch (e) { return null; }
    }

    // Title JSON is up to ~1 MB (One Piece), and the episode fallback below may need
    // it again right after getDetail — keep it for a few minutes.
    async detailData(slug) {
        if (slug) this._lastSlug = slug;
        if (!slug) return null;
        this._detailCache = this._detailCache || {};
        const hit = this._detailCache[slug];
        if (hit && Date.now() - hit.at < AO_CACHE_TTL) return hit.data;
        const data = await this.api("/api/anime/" + encodeURIComponent(slug));
        if (!data || !data.title) return null;
        this._detailCache[slug] = { at: Date.now(), data: data };
        return data;
    }

    toList(json, page) {
        const base = aoBase(this.source);
        const items = (json && json.items) || [];
        const list = [];
        for (const it of items) {
            if (!it || !it.anime_url) continue;
            list.push({
                name: it.title + (it.year ? ` (${it.year})` : ""),
                imageUrl: aoPoster(base, it),
                link: base + "/anime/" + it.anime_url
            });
        }
        const totalPages = (json && json.total_pages) || 0;
        return { list: list, hasNextPage: totalPages ? page < totalPages : list.length >= AO_PAGE_SIZE };
    }

    async getPopular(page) {
        const json = await this.api(`/api/anime?page=${page}&limit=${AO_PAGE_SIZE}&sort=votes`);
        return this.toList(json, page);
    }

    async getLatestUpdates(page) {
        const json = await this.api(`/api/anime?page=${page}&limit=${AO_PAGE_SIZE}&sort=updated`);
        return this.toList(json, page);
    }

    async search(query, page, filters) {
        const genre = aoFilterValue(filters, 0);
        const kind = aoFilterValue(filters, 1);
        const year = aoFilterValue(filters, 2);
        const status = aoFilterValue(filters, 3);
        const sort = aoFilterValue(filters, 4);

        const params = [`page=${page}`, `limit=${AO_PAGE_SIZE}`];
        const q = String(query || "").trim();
        if (q) params.push("search=" + encodeURIComponent(q));
        if (genre) params.push("genre=" + encodeURIComponent(genre));
        if (kind) params.push("kind=" + encodeURIComponent(kind));
        if (year) {
            params.push("year_from=" + encodeURIComponent(year));
            params.push("year_to=" + encodeURIComponent(year));
        }
        if (status) params.push("status=" + encodeURIComponent(status));
        // Without an explicit sort the API keeps its own relevance for text queries.
        if (sort) params.push("sort=" + encodeURIComponent(sort));

        const json = await this.api("/api/anime?" + params.join("&"));
        return this.toList(json, page);
    }

    async getDetail(url) {
        const empty = { name: '', imageUrl: '', description: '', genre: [], status: 5, episodes: [] };
        const slug = aoSlug(url);
        if (!slug) return empty;
        const data = await this.detailData(slug);
        if (!data) return empty;

        const base = aoBase(this.source);
        const md = data.material_data || {};
        const description = String(md.anime_description || data.description || '').trim();
        const imageUrl = aoPoster(base, { poster: data.poster, material_data: md });

        return {
            name: data.title,
            imageUrl: imageUrl,
            description: description,
            genre: (data.genres || md.anime_genres || []).slice(0, 40),
            status: this.mapStatus(data.status || md.anime_status),
            // Episode rows carry the voice-over in scanlator, so Mangayomi's own
            // episode filter (Filter → 'Фильтр по группам') switches dubs offline.
            episodes: this.buildEpisodes(data, base)
        };
    }

    // Mangayomi's detail page has no custom episode-list filters (no applyFilter hook),
    // but it does group episodes by scanlator — the same list the manga sources fill
    // with translator groups. Titles with several dubs always list every episode in
    // every dub, so that filter is where the voice-over is switched.
    dubTracks(data) {
        const translations = (data && data.translations) || {};
        const tracks = Object.keys(translations).map(name => {
            const t = translations[name] || {};
            return {
                name: name,
                type: t.type || '',
                viewers: Number(t.viewers || 0),
                season: Number(t.season || 0),
                episodes: t.episodes || {}
            };
        }).filter(t => t.name && Object.keys(t.episodes).length > 0);
        const seasons = new Set(tracks.map(t => t.season || 1));
        for (const t of tracks) t.seasonsCount = seasons.size;
        return tracks.sort((a, b) => b.viewers - a.viewers || a.name.localeCompare(b.name));
    }

    mapStatus(status) {
        // Mangayomi: 0 ongoing, 1 completed, 2 licensed, 3 on hiatus, 4 canceled, 5 unknown.
        switch (String(status || "").toLowerCase()) {
            case "ongoing": return 0;
            case "released": return 1;
            case "anons":
            case "announced": return 3;
            default: return 5;
        }
    }

    // The title JSON groups Kodik links by voice-over: translations[name].episodes[n].link.
    // Every episode is listed once per voice-over, and scanlator carries the studio —
    // that is what Mangayomi's episode filter groups by. The most watched dub leads.
    // dub limits the list to a single voice-over (used when a link is retried).
    buildEpisodes(data, base, dub) {
        const tracks = this.dubTracks(data);
        const main = dub ? tracks.find(t => t.name === dub) : null;
        const list = main ? [main] : tracks;
        const slug = data.anime_url || '';

        const rows = [];
        const seen = {};
        const stamp = Date.now().toString();

        for (const t of list) {
            const tag = aoTrackTag(t);
            const keys = Object.keys(t.episodes).map(k => {
                const num = parseInt(k, 10);
                return { key: k, num: isNaN(num) ? 0 : num };
            }).sort((a, b) => (a.num || 0) - (b.num || 0) || a.key.localeCompare(b.key));

            for (const item of keys) {
                const entry = t.episodes[item.key];
                let link = entry && entry.link ? String(entry.link) : '';
                if (!link) continue;
                if (link.startsWith('//')) link = 'https:' + link;
                // Season+tracks keep the names unique: Mangayomi drops episodes whose
                // (name, scanlator) pair already exists.
                const name = (item.num > 0 ? 'Episode ' + item.num : item.key) + (t.seasonsCount > 1 ? ' · сезон ' + t.season : '');
                const dedupe = name + '|' + tag + '|' + link;
                if (seen[dedupe]) continue;
                seen[dedupe] = true;
                rows.push({
                    num: item.num,
                    name: name,
                    // link || voice-over || slug || episode key — the trailing parts let
                    // getVideoList retry the same episode in another voice-over.
                    url: link + '||' + tag + '||' + slug + '||' + item.key,
                    dateUpload: stamp,
                    // Mangayomi's episode filter ('Фильтр по группам') groups by this.
                    scanlator: tag
                });
            }
        }

        rows.sort((a, b) => (a.num || 1e9) - (b.num || 1e9));
        return rows.map(r => ({
            name: r.name,
            url: r.url,
            dateUpload: r.dateUpload,
            scanlator: r.scanlator
        }));
    }

    async getVideoList(url) {
        const raw = String(url || '').trim();
        if (!raw) return [];
        const parts = raw.split('||');
        let link = parts[0] || '';
        const label = parts[1] || 'AnimeOn';
        const slug = parts[2] || '';
        const epKey = parts[3] || '';
        if (link.startsWith('//')) link = 'https:' + link;
        if (!/^https?:\/\//i.test(link)) return [];

        // Speed first: only the episode's own voice-over is resolved (~0.8 s). The other
        // voice-overs of the same episode are added on demand by voiceList() when the
        // episode was just opened — a mediaPlayerClose call means the user has seen the
        // list, so the extra dubs are not worth delaying playback.
        this._videoCache = this._videoCache || {};
        const hit = this._videoCache[link];
        if (hit && Date.now() - hit.at < AO_VIDEO_CACHE_TTL) return this.rewriteProxy(this.reorder(hit.videos, label));

        const videos = await kodikExtract(this.client, link, aoBase(this.source), label, {});
        if (this.hasHls(videos)) {
            this._videoCache[link] = { at: Date.now(), videos: videos, full: false };
            this._lastEp = link;
            return this.rewriteProxy(this.reorder(videos, label));
        }

        // Kodik drops individual episodes over time (the iframe answers 500 and the
        // extractor returns nothing). The same episode normally still exists in another
        // voice-over, so try a couple of them before reporting 'no video'.
        for (const alt of await this.altLinks(slug, epKey, link)) {
            const tried = await kodikExtract(this.client, alt.link, aoBase(this.source), alt.tag, {});
            if (this.hasHls(tried)) {
                this._videoCache[link] = { at: Date.now(), videos: tried, full: false };
                this._lastEp = link;
                return this.rewriteProxy(this.reorder(tried, alt.tag));
            }
        }
        return videos;
    }

    // Optional free proxy (a Cloudflare Worker from cloudflare/kodik-proxy-worker.js):
    // Kodik's CDN is behind DDoS-Guard and geo-restricted, the worker fetches the stream
    // once from outside and serves it without the checks, so playback starts at once.
    // The shared kodik_proxy helper reads the same preference (animeon_proxy).
    rewriteProxy(videos) {
        return kodikProxyVideos(videos);
    }

    async voiceList(url) {
        const raw = String(url || '').trim();
        if (!raw) return [];
        let link = (raw.split('||')[0] || '').trim();
        if (!link) link = this._lastEp || '';
        if (link.startsWith('//')) link = 'https:' + link;
        if (!/^https?:\/\//i.test(link)) return [];

        this._videoCache = this._videoCache || {};
        const hit = this._videoCache[link];
        if (hit && hit.full) return this.rewriteProxy(this.reorder(hit.videos, ''));
        const videos = await kodikExtract(this.client, link, aoBase(this.source), 'AnimeOn', { allTranslations: true });
        if (!this.hasHls(videos)) return [];
        this._videoCache[link] = { at: Date.now(), videos: videos, full: true };
        return this.rewriteProxy(this.reorder(videos, ''));
    }

    // Kodik answers quality by quality, and every entry is a separate voice-over, so the
    // player menu is rebuilt as
    //   Studio Band 720p      <- default source (starts playing right away)
    //   2x2 720p | 2x2 480p | AniDUB 720p | AniDUB 480p | ...
    // i.e. the default first, then one block per voice-over (highest quality first).
    reorder(videos, firstTag) {
        const list = (videos || []).slice();
        const tag = (q) => String(q || '').replace(/ \d+p$/, '');
        const quality = (v) => parseInt((String(v.quality).match(/(\d+)p/) || [0, 0])[1], 10);
        const order = [];
        const groups = {};
        for (const v of list) {
            const t = tag(v.quality);
            if (!groups[t]) { groups[t] = []; order.push(t); }
            groups[t].push(v);
        }
        if (!order.length) return list;
        // The default source (first item) must stay first — the player starts on it.
        const main = list[0];
        const mainTag = tag(main.quality);
        const out = [main];
        const others = list.filter(v => v !== main);
        // One block per voice-over; the default's own block leads, the rest keep the
        // order Kodik listed them in.
        const lead = others.filter(v => tag(v.quality) === mainTag).sort((a, b) => quality(b) - quality(a));
        const rest = others.filter(v => tag(v.quality) !== mainTag);
        out.push.apply(out, lead);
        for (const t of order) {
            if (t === mainTag) continue;
            for (const v of rest.filter(x => tag(x.quality) === t).sort((a, b) => quality(b) - quality(a))) {
                out.push(v);
            }
        }
        return out;
    }

    // Mangayomi calls this for autoplay "next episode": only the voice-over that was being
    // watched is resolved (one voice-over instead of all of them), which keeps the
    // transition between episodes as fast as a normal first play.
    async nextEpisodeSources(prev, allPrev) {
        const tag = (q) => String(q || "").replace(/ \d+p$/, "");
        const wanted = tag(prev && prev.quality);
        const cached = (allPrev || []).filter(v => tag(v.quality) === wanted).sort(
            (a, b) => this.qualityNum(b.quality) - this.qualityNum(a.quality)
        );
        if (cached.length) return this.reorder(cached, wanted);
        const url = String((prev && prev.originalUrl) || "").trim();
        if (!/^https?:\/\//i.test(url)) return [];
        return await kodikExtract(this.client, url, aoBase(this.source), wanted || "AnimeOn", {});
    }

    qualityNum(quality) {
        return parseInt((String(quality || "").match(/(\d+)p/) || [0, 0])[1], 10) || 0;
    }

    hasHls(videos) {
        return (videos || []).some(v => / \d+p$/.test(String(v.quality || "")));
    }

    // Other voice-overs that have the same episode key, most watched first.
    async altLinks(slug, epKey, usedLink) {        if (!slug || !epKey) return [];
        const data = await this.detailData(slug);
        if (!data) return [];
        const translations = data.translations || {};
        const rows = [];
        for (const name of Object.keys(translations)) {
            const t = translations[name] || {};
            const entry = (t.episodes || {})[epKey];
            let link = entry && entry.link ? String(entry.link) : "";
            if (!link) continue;
            if (link.startsWith("//")) link = "https:" + link;
            if (link === usedLink) continue;
            rows.push({
                link: link,
                tag: name + (t.type === "subtitles" ? " · субтитры" : ""),
                viewers: Number(t.viewers || 0)
            });
        }
        rows.sort((a, b) => b.viewers - a.viewers);
        return rows.slice(0, 2);
    }

    getFilterList() {
        const withAny = (arr) => [["— Любой —", ""]].concat(arr);

        const genreValues = withAny(AO_GENRES.map(g => [g, g]));
        const kindValues = withAny(AO_KINDS.map(k => [k[0], k[1]]));

        const years = [];
        for (let y = 2027; y >= 1960; y--) years.push([String(y), String(y)]);

        const statusValues = [
            ["— Любой —", ""],
            ["Онгоинг", "ongoing"],
            ["Вышел", "released"],
            ["Анонс", "anons"]
        ];

        const sortValues = [
            ["По популярности", "votes"],
            ["По рейтингу", "rating"],
            ["По дате выхода", "date"],
            ["По обновлению", "updated"]
        ];

        const select = (type, name, values, state) => ({
            type_name: "SelectFilter",
            type: type,
            name: name,
            state: state || 0,
            values: values.map(v => ({ type_name: "SelectOption", name: v[0], value: v[1] }))
        });

        return [
            select("genre", "Жанр", genreValues, 0),
            select("kind", "Тип", kindValues, 0),
            select("year", "Год", withAny(years), 0),
            select("status", "Статус", statusValues, 0),
            select("sort", "Сортировка", sortValues, 0)
        ];
    }

    // Kodik already offers every voice-over of the episode in the player, so all that
    // is left here is filling the episode gaps of the main voice-over.
    getSourcePreferences() {
        return [
            kodikProxyPreference(),
            {
                key: AO_PREF_FILL,
                listPreference: {
                    title: "Добивать пробелы другой озвучкой",
                    summary: "Если у основной озвучки нет некоторых серий — показать их из других озвучек (с пометкой студии в названии).",
                    valueIndex: 1,
                    entries: ["Нет", "Да"],
                    entryValues: ["0", "1"]
                }
            }
        ];
    }
}
