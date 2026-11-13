// @include: nhentai_base

const mangayomiSources = [{
    "name": "nhentai",
    "lang": "all",
    "baseUrl": "https://nhentai.xxx",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "1.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "all/manga/nhentai.js",
    "notes": "Додзинси и манга с nhentai (зеркало nhentai.xxx). В галерее нет глав: галерея — тайтл с одной главой, страницы главы — все страницы галереи. Поиск — по тегам и названию через поиск сайта (любые теги nhentai: sole-female, full-color, «Exact Tag» в кавычках и т.д.), язык — фильтром. «Популярное» — раздел Popular, «Обновления» — свежие загрузки. Без логина и cookie."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return NH_BASE; }

    getHeaders(url) { return nhHeaders(); }

    get supportsLatest() { return true; }

    getFilterList() {
        return [
            {
                type_name: "SelectFilter",
                type: "language",
                name: "Язык",
                state: 0,
                values: NH_LANGUAGES.map(x => ({ type_name: "SelectOption", name: x[0], value: x[0] }))
            },
            {
                type_name: "SortFilter",
                type: "sort",
                name: "Сортировка поиска",
                state: { type_name: "SortState", index: 0, ascending: false },
                values: [
                    { type_name: "SelectOption", name: "Новые", value: "latest" },
                    { type_name: "SelectOption", name: "Популярные", value: "popular" }
                ]
            }
        ];
    }

    nhLanguage(filters) {
        const f = filters && filters[0];
        const i = f && f.state !== undefined ? Number(f.state) : 0;
        return (NH_LANGUAGES[i] || NH_LANGUAGES[0])[1];
    }

    nhPopular(filters) {
        const f = filters && filters[1];
        return !!(f && f.state && f.state.index === 1);
    }

    // A page of cards from a listing path ("/tag/x/" without ?page=N).
    async nhList(path, page) {
        const p = Math.max(1, Number(page) || 1);
        const url = NH_BASE + path + (path.indexOf("?") >= 0 ? "&" : "?") + "page=" + p;
        const res = await this.client.get(url, nhHeaders());
        if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
        const body = res.body || "";
        const items = nhParseList(body);
        const list = items.map(x => ({
            name: x.name,
            imageUrl: x.imageUrl,
            link: x.link
        }));
        return { list: list, hasNextPage: nhHasNext(body) };
    }

    // Popular: the site's popular search, page after page. On the first page
    // the home page's "Popular Now" cards go on top (they are a teaser of just
    // a few galleries), so the first screen has a full page of cards.
    async getPopular(page) {
        const p = Math.max(1, Number(page) || 1);
        const res = await this.nhList("/search/?key=&sort=popular", p);
        const list = res.list.slice();
        if (p === 1) {
            const seen = {};
            for (const x of list) seen[x.link] = true;
            const home = await this.client.get(NH_BASE + "/", nhHeaders());
            const body = home && home.statusCode === 200 ? home.body || "" : "";
            const start = body.indexOf("Popular Now");
            if (start >= 0) {
                const end = body.indexOf("New Uploads", start);
                let section = end > start ? body.slice(start, end) : body.slice(start);
                const first = section.search(/class="gallery_item"/);
                section = section.slice(first >= 0 ? first : 0).replace(/<script[\s\S]*?<\/script>/g, "");
                for (const x of nhParseList(section)) {
                    if (seen[x.link]) continue;
                    seen[x.link] = true;
                    list.unshift({ name: x.name, imageUrl: x.imageUrl, link: x.link });
                }
            }
        }
        return { list: list, hasNextPage: res.hasNextPage };
    }

    async getLatestUpdates(page) {
        return await this.nhList("/search/?key=", page);
    }

    // Search: the query goes to the site's search box. When only filters are
    // set, the language listing is used; popular sort switches the search.
    async search(query, page, filters) {
        const text = String(query || "").trim();
        const lang = this.nhLanguage(filters);
        const popular = this.nhPopular(filters);
        if (!text) {
            if (lang) return await this.nhList("/language/" + lang + "/", page);
            return await this.nhList("/search/?key=" + (popular ? "&sort=popular" : ""), page);
        }
        const q = "key=" + encodeURIComponent(text) + (lang ? "&language=" + lang : "") + (popular ? "&sort=popular" : "");
        return await this.nhList("/search/?" + q, page);
    }

    async getDetail(url) {
        const path = nhGalleryPath(url);
        if (!path) throw new Error("Не удалось определить галерею nhentai по ссылке: " + url);
        const res = await this.client.get(NH_BASE + path, nhHeaders());
        const g = nhGallery(res && res.body ? res.body : "");
        if (!g.name) throw new Error("Галерея nhentai недоступна: " + path);
        const genre = [];
        for (const key of ["artists", "parodies", "characters", "groups", "category"]) {
            for (const v of (g.groups[key] || []).slice(0, 4)) genre.push(key.charAt(0).toUpperCase() + key.slice(1) + ": " + v);
        }
        for (const v of (g.groups["tags"] || []).slice(0, 8)) genre.push(v);
        const chapters = [];
        if (g.pages > 0) {
            // One chapter per gallery; its URL is the gallery, so the page list
            // can always be rebuilt from it.
            chapters.push({
                name: "Галерея — " + g.pages + " стр.",
                url: path,
                dateUpload: g.uploaded ? String(Date.parse(g.uploaded) || "") : "",
                scanlator: ""
            });
        }
        const description = [
            [g.jpName].filter(x => x).join(""),
            "Страниц: " + g.pages,
            (g.groups["artists"] || []).length ? "Авторы: " + g.groups["artists"].join(", ") : "",
            (g.groups["languages"] || []).length ? "Язык: " + g.groups["languages"].join(", ") : "",
            (g.groups["category"] || []).length ? "Категория: " + g.groups["category"].join(", ") : "",
            "",
            g.tags.join(" · "),
            "",
            "Галерея: " + NH_BASE + path
        ].filter((x, i) => x || i < 6).join("\n");
        return {
            name: g.name || g.jpName || ("Галерея " + nhGalleryId(path)),
            imageUrl: g.cover,
            description: description,
            author: (g.groups["artists"] || []).join(", "),
            artist: (g.groups["artists"] || []).join(", "),
            genre: genre,
            status: 1,
            chapters: chapters
        };
    }

    // Pages of the gallery: the reader lists page numbers (/g/<id>/<n>/), and
    // only the first reader page is read — it names the picture folder, so
    // every other page's address follows the same pattern.
    async getPageList(url) {
        const path = nhGalleryPath(url);
        if (!path) return [];
        this.pageCache = this.pageCache || {};
        if (this.pageCache[path]) return this.pageCache[path];

        const res = await this.client.get(NH_BASE + path, nhHeaders());
        const total = nhGallery(res && res.body ? res.body : "").pages;
        if (!total) return [];

        const first = await this.client.get(NH_BASE + path + "1/", nhHeaders());
        const body = first && first.statusCode === 200 ? first.body || "" : "";
        const sample = nhReaderImage(body);
        const have = nhTotalPages(body) || total;
        let pages = [];
        const m = sample.match(/^(https:\/\/[^\/]+\/[^\/]+\/[^\/]+\/)(\d+)\.(webp|jpg|jpeg|png)$/i);
        if (m) {
            // <dir>/<folder>/<n>.<ext>: build every page from the first one.
            const ext = m[3];
            pages = [];
            for (let n = 1; n <= have; n++) pages.push(m[1] + n + "." + ext);
        } else {
            // Fallback: read each reader page for its picture.
            const readers = [];
            for (let n = 1; n <= have; n++) readers.push(path + n + "/");
            const imgs = await nhMapLimit(readers, 6, async (r) => {
                try {
                    const x = await this.client.get(NH_BASE + r, nhHeaders());
                    return x && x.statusCode === 200 ? nhReaderImage(x.body || "") : "";
                } catch (e) {
                    return "";
                }
            });
            pages = imgs.filter(x => x);
        }
        const out = pages.map(x => ({ url: x, headers: nhHeaders() }));
        this.pageCache[path] = out;
        const keys = Object.keys(this.pageCache);
        if (keys.length > 12) delete this.pageCache[keys[0]];
        return out;
    }
}
