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
    "version": "0.3.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/animeon.js",
    "notes": "AnimeOn (animeon.cc, Next.js). Everything comes from the site's own JSON API: catalog /api/anime (search, genre, kind, status, year, sort), title page /api/anime/<slug>. Episodes and voice-overs are in the title JSON (translations -> episodes -> Kodik seria link), so no HTML parsing is needed. Video — Kodik HLS 240/360/480/720 (referer animeon.cc) plus the player iframe as a fallback. If Kodik has dropped an episode, the same episode is retried in up to two other voice-overs. Titles without any translation (announcements) have no episodes."
}];

const AO_BASE = "https://animeon.cc";
const AO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AO_PAGE_SIZE = 20;
const AO_CACHE_TTL = 10 * 60 * 1000;

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
        const empty = { name: "", imageUrl: "", description: "", genre: [], status: 5, episodes: [] };
        const slug = aoSlug(url);
        if (!slug) return empty;
        const data = await this.detailData(slug);
        if (!data) return empty;

        const base = aoBase(this.source);
        const md = data.material_data || {};
        const description = String(md.anime_description || data.description || "").trim();
        const imageUrl = aoPoster(base, { poster: data.poster, material_data: md });

        return {
            name: data.title,
            imageUrl: imageUrl,
            description: description,
            genre: (data.genres || md.anime_genres || []).slice(0, 40),
            status: this.mapStatus(data.status || md.anime_status),
            episodes: this.buildEpisodes(data, base)
        };
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
    // By default every episode is listed once per voice-over; the "Озвучка" setting in the
    // source preferences narrows the list down to a single dub.
    buildEpisodes(data, base) {
        const seen = {};
        const translations = data.translations || {};
        const slug = data.anime_url || "";

        const tracks = Object.keys(translations).map(name => {
            const t = translations[name] || {};
            return {
                name: name,
                type: t.type || "",
                viewers: Number(t.viewers || 0),
                season: t.season || 0,
                episodes: t.episodes || {}
            };
        }).filter(t => t.name && Object.keys(t.episodes).length > 0);

        tracks.sort((a, b) => b.viewers - a.viewers || a.name.localeCompare(b.name));

        // The voice-over does not matter for the episode list: getVideoList asks Kodik
        // for every translation of the episode anyway, so one row per episode is enough.
        const fill = String(aoPref(AO_PREF_FILL, '1')) === '1';
        const main = tracks[0];

        const rows = [];
        const covered = {};

        const addTrack = (t, opts) => {
            opts = opts || {};
            const tag = aoTrackTag(t);
            const keys = Object.keys(t.episodes).map(k => {
                const num = parseInt(k, 10);
                return { key: k, num: isNaN(num) ? 0 : num };
            }).sort((a, b) => (a.num || 0) - (b.num || 0) || a.key.localeCompare(b.key));

            for (const item of keys) {
                if (opts.skipCovered && covered[item.key]) continue;
                const entry = t.episodes[item.key];
                let link = entry && entry.link ? String(entry.link) : '';
                if (!link) continue;
                if (link.startsWith('//')) link = 'https:' + link;
                const label = item.num > 0 ? 'Серия ' + item.num : item.key;
                covered[item.key] = true;
                rows.push({
                    num: item.num,
                    name: opts.fill ? label + ' · ' + tag : label,
                    // link || voice-over || slug || episode key — the trailing parts let
                    // getVideoList retry the same episode in another voice-over.
                    url: link + '||' + tag + '||' + slug + '||' + item.key
                });
            }
        };

        addTrack(main, {});
        // Fill the episode gaps of the main voice-over from the others (subtitle-only
        // releases often miss the last raw episodes). Rows then say who voices them.
        if (fill) {
            for (const t of tracks) {
                if (t !== main) addTrack(t, { skipCovered: true, fill: true });
            }
        }

        rows.sort((a, b) => (a.num || 1e9) - (b.num || 1e9));

        const stamp = Date.now().toString();
        return rows.map(r => ({ name: r.name, url: r.url, dateUpload: stamp, scanlator: null }));
    }

    async getVideoList(url) {
        const raw = String(url || "").trim();
        if (!raw) return [];
        const parts = raw.split("||");
        let link = parts[0] || "";
        const label = parts[1] || "AnimeOn";
        const slug = parts[2] || "";
        const epKey = parts[3] || "";
        if (link.startsWith("//")) link = "https:" + link;
        if (!/^https?:\/\//i.test(link)) return [];

        // Kodik resolves to HLS 240–720 with the site's referer; the iframe is appended
        // as the last option by the shared extractor.
        const videos = await kodikExtract(this.client, link, aoBase(this.source), label, { allTranslations: true });
        if (this.hasHls(videos)) return videos;

        // Kodik drops individual episodes over time (the iframe answers 500 and the
        // extractor returns nothing). The same episode normally still exists in another
        // voice-over, so try a couple of them before reporting "no video".
        for (const alt of await this.altLinks(slug, epKey, link)) {
            const tried = await kodikExtract(this.client, alt.link, aoBase(this.source), alt.tag);
            if (this.hasHls(tried)) return tried;
        }
        return videos;
    }

    hasHls(videos) {
        return (videos || []).some(v => / \d+p$/.test(String(v.quality || "")));
    }

    // Other voice-overs that have the same episode key, most watched first.
    async altLinks(slug, epKey, usedLink) {
        if (!slug || !epKey) return [];
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
