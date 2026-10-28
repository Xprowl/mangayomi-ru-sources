// @include: kodik_extractor

const mangayomiSources = [{
    "name": "Anixart",
    "lang": "ru",
    "baseUrl": "https://anixart.tv",
    "apiUrl": "https://api.anixsekai.com",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.4.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/anixart.js",
    "notes": "Anixart переехал: api.anixart.tv больше не отвечает (DDoS-Guard рвёт TLS), актуальный API — api.anixsekai.com. Поиск отдаёт JSON (POST /search/releases/{page}), у фильтра каталога пагинация по номеру страницы (0, 1, 2…). Озвучки (AniDUB, AniLibria, SHIZA и др.) через Kodik → HLS."
}];

const AX_BASE = "https://anixart.tv";
const AX_API = "https://api.anixsekai.com";
const AX_PAGE_SIZE = 25;

// Never rely on this.source:* — if the Host app supplies an empty apiUrl the URL
// becomes relative and rhttp throws "relative URL without a base".
function axApi(source) {
    const raw = source && source.apiUrl;
    const s = typeof raw === "string" ? raw.trim() : "";
    return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : AX_API;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    // Mangayomi counts pages from 1, the API from 0. A numeric chapter/page part
    // like "filter/1" would make the endpoint answer 400, hence page - 1.
    get headers() {
        return {
            "User-Agent": "Anixart/13.0 (Android)",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": AX_BASE + "/"
        };
    }

    mapList(items) {
        return (items || []).map(r => ({
            name: r.title_ru || r.title_original || r.title_alt || String(r.id),
            imageUrl: r.image || "",
            link: String(r.id)
        }));
    }

    buildFilterBody(sort, filters) {
        const parts = [`sort=${sort}`];
        if (filters && filters.length) {
            // [1] Genres — TriState. 1 = include, 2 = exclude (is_genres_excluded_mode_enabled).
            const f1 = filters[1];
            const included = [], excluded = [];
            if (f1 && f1.state) {
                for (const g of f1.state) {
                    if (g.state === 1) included.push(g.value);
                    else if (g.state === 2) excluded.push(g.value);
                }
            }
            if (included.length) parts.push(`genres=${encodeURIComponent(included.join(","))}`);
            if (excluded.length) {
                parts.push(`genres=${encodeURIComponent(excluded.join(","))}`);
                parts.push(`is_genres_excluded_mode_enabled=true`);
            }
            // [2] Status
            const f2 = filters[2];
            if (f2 && f2.values) {
                const idx = f2.state || 0;
                const v = f2.values[idx].value;
                if (v) parts.push(`status=${v}`);
            }
            // [3] Category (TV/Movie/OVA/ONA/Special)
            const f3 = filters[3];
            if (f3 && f3.values) {
                const idx = f3.state || 0;
                const v = f3.values[idx].value;
                if (v) parts.push(`category=${v}`);
            }
        }
        return parts.join("&");
    }

    async fetchFilter(sort, page, filters) {
        const body = this.buildFilterBody(sort, filters);
        const baseUrl = `${axApi(this.source)}/filter/${page - 1}`;
        let res = await this.client.get(`${baseUrl}?${body}`, this.headers);
        if (!res || res.statusCode !== 200 || !res.body) {
            // POST fallback: some edge nodes reject long query strings.
            const postHeaders = Object.assign({}, this.headers, { "Content-Type": "application/x-www-form-urlencoded" });
            res = await this.client.post(baseUrl, postHeaders, body);
        }
        if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
        let json;
        try { json = JSON.parse(res.body); } catch (e) { return { list: [], hasNextPage: false }; }
        const content = json.content || [];
        // The API does not fill total_page_count; a short page means the end.
        return { list: this.mapList(content), hasNextPage: content.length >= AX_PAGE_SIZE };
    }

    async getPopular(page) { return await this.fetchFilter(4, page); }
    async getLatestUpdates(page) { return await this.fetchFilter(1, page); }

    async search(query, page, filters) {
        if (query && query.trim()) {
            // The search endpoint only accepts a JSON body (form/GET answer 400).
            const res = await this.client.post(
                `${axApi(this.source)}/search/releases/${page - 1}`,
                Object.assign({}, this.headers, { "Content-Type": "application/json" }),
                JSON.stringify({ query: query.trim() })
            );
            if (res && res.statusCode === 200 && res.body) {
                try {
                    const json = JSON.parse(res.body);
                    const list = this.mapList(json.content || json.releases || []);
                    if (list.length || page > 1) return { list, hasNextPage: list.length >= AX_PAGE_SIZE };
                } catch (e) { /* fall back to catalog filtering */ }
            }
            const pop = await this.getPopular(page);
            const q = query.trim().toLowerCase();
            return {
                list: pop.list.filter(m => m.name.toLowerCase().indexOf(q) >= 0),
                hasNextPage: pop.hasNextPage
            };
        }

        // Sort comes from filter[0] when present, otherwise views (4).
        let sort = 4;
        if (filters && filters[0] && filters[0].values) {
            const idx = (filters[0].state && filters[0].state.index != null) ? filters[0].state.index : 0;
            const v = parseInt(filters[0].values[idx] && filters[0].values[idx].value);
            if (!isNaN(v)) sort = v;
        }
        return await this.fetchFilter(sort, page, filters);
    }

    parseStatus(s) {
        if (!s) return 5;
        const id = s.id;
        if (id === 1) return 1; // вышел
        if (id === 2) return 0; // онгоинг
        if (id === 3) return 4; // анонс
        const name = (s.name || "").toLowerCase();
        if (name.indexOf("онго") >= 0 || name.indexOf("выход") >= 0) return 0;
        if (name.indexOf("законч") >= 0 || name.indexOf("заверш") >= 0 || name.indexOf("выш") >= 0) return 1;
        if (name.indexOf("анонс") >= 0) return 4;
        return 5;
    }

    // Dubs for one episode are packed into the episode URL so getVideoList can
    // rebuild the per-provider list without extra requests.
    packDubs(dubs) {
        return dubs.map(d => `${d.typeName}|${d.providerName}|${d.url}`).join("\n");
    }

    async getDetail(url) {
        const id = String(url).replace(/\D/g, "");
        const res = await this.client.get(`${axApi(this.source)}/release/${id}`, this.headers);
        if (!res || res.statusCode !== 200) {
            return { name: id, imageUrl: "", description: `(Ошибка загрузки: HTTP ${res ? res.statusCode : 0})`, status: 5, genre: [], episodes: [] };
        }
        let r = {};
        try { r = (JSON.parse(res.body).release) || {}; } catch (e) {
            return { name: id, imageUrl: "", description: "(Ошибка разбора ответа API)", status: 5, genre: [], episodes: [] };
        }

        const typesRes = await this.client.get(`${axApi(this.source)}/episode/${id}`, this.headers);
        let types = [];
        if (typesRes && typesRes.statusCode === 200) {
            try { types = JSON.parse(typesRes.body).types || []; } catch (e) { types = []; }
        }

        // position → { position, name, dubs: [{typeName, providerName, url}] }
        const byPos = {};
        for (const t of types) {
            const typeName = t.name || "";
            const sourcesRes = await this.client.get(`${axApi(this.source)}/episode/${id}/${t.id}`, this.headers);
            if (!sourcesRes || sourcesRes.statusCode !== 200) continue;
            let sources = [];
            try { sources = JSON.parse(sourcesRes.body).sources || []; } catch (e) { continue; }
            for (const s of sources) {
                const providerName = s.name || "";
                const epsRes = await this.client.get(`${axApi(this.source)}/episode/${id}/${t.id}/${s.id}`, this.headers);
                if (!epsRes || epsRes.statusCode !== 200) continue;
                let eps = [];
                try { eps = JSON.parse(epsRes.body).episodes || []; } catch (e) { continue; }
                for (const e of eps) {
                    const key = String(e.position || e.name || e["@id"]);
                    if (!byPos[key]) byPos[key] = { position: e.position || 0, name: e.name, dubs: [] };
                    byPos[key].dubs.push({ typeName, providerName, url: e.url || e.iframe || "" });
                }
            }
        }

        const episodes = Object.keys(byPos).map(k => byPos[k]).sort((a, b) => (a.position || 0) - (b.position || 0))
            .map(ep => ({
                name: ep.name || `Эпизод ${ep.position}`,
                url: this.packDubs(ep.dubs),
                dateUpload: Date.now().toString(),
                scanlator: null
            })).reverse();

        const genre = r.genres ? String(r.genres).split(",").map(x => x.trim()).filter(Boolean) : [];

        return {
            name: r.title_ru || r.title_original || id,
            imageUrl: r.image || "",
            description: r.description || "",
            author: r.director || r.author || "",
            genre: genre,
            status: this.parseStatus(r.status),
            episodes
        };
    }

    async getVideoList(url) {
        const videos = [];
        const lines = (url || "").split("\n").filter(x => x.trim());
        for (const line of lines) {
            const parts = line.split("|");
            if (parts.length < 3) continue;
            const typeName = parts[0];
            const providerName = parts[1];
            const playerUrl = parts.slice(2).join("|");
            if (!playerUrl) continue;

            if (providerName.toLowerCase() === "kodik" || playerUrl.indexOf("kodikplayer") >= 0) {
                const extracted = await kodikExtract(this.client, playerUrl, AX_BASE, `Anixart · ${typeName}`);
                for (const vid of extracted) videos.push(vid);
                continue;
            }

            let src = playerUrl;
            if (src.startsWith("//")) src = "https:" + src;
            videos.push({
                url: src,
                originalUrl: src,
                quality: `Anixart · ${typeName} (${providerName})`,
                headers: { "User-Agent": this.headers["User-Agent"], "Referer": AX_BASE + "/" }
            });
        }
        return videos;
    }

    getFilterList() {
        return [
            {
                type_name: "SortFilter",
                type: "sort",
                name: "Сортировка",
                state: { type_name: "SortState", index: 0, ascending: false },
                values: [
                    ["По просмотрам", "4"],
                    ["Новые эпизоды", "1"],
                    ["По рейтингу", "2"],
                    ["По кол-ву оценок", "3"],
                    ["По дате добавления", "5"],
                    ["По алфавиту", "6"]
                ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            },
            {
                type_name: "GroupFilter",
                type: "genres",
                name: "Жанры",
                state: [
                    "Экшен", "Приключения", "Комедия", "Драма", "Фэнтези", "Романтика",
                    "Школа", "Сёнэн", "Сёдзё", "Сэйнэн", "Спорт", "Ужасы", "Детектив",
                    "Триллер", "Меха", "Магия", "Исекай", "Повседневность",
                    "Сверхъестественное", "Психологическое", "Пародия", "Фантастика",
                    "Музыка", "Махо-сёдзё", "Вампиры", "Военное", "Игры", "Исторический",
                    "Полиция", "Боевые искусства", "Самураи", "Космос", "Демоны",
                    "Дзёсэй", "Супер сила", "Гарем", "Этти", "Кодомо"
                ].map(x => ({ type_name: "TriState", name: x, value: x }))
            },
            {
                type_name: "SelectFilter",
                type: "status",
                name: "Статус",
                state: 0,
                values: [
                    ["— Любой —", ""], ["Онгоинг", "1"], ["Вышел", "2"], ["Анонс", "3"]
                ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            },
            {
                type_name: "SelectFilter",
                type: "category",
                name: "Категория",
                state: 0,
                values: [
                    ["— Любая —", ""], ["TV Сериал", "1"], ["Фильм", "2"],
                    ["OVA", "3"], ["ONA", "4"], ["Спешл", "5"]
                ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
            }
        ];
    }
    getSourcePreferences() { return []; }
}
