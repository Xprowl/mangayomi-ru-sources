// @include: ehentai_base

const mangayomiSources = [{
    "name": "E-Hentai",
    "lang": "all",
    "baseUrl": "https://e-hentai.org",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "1.0.1",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "all/manga/ehentai.js",
    "notes": "Галереи e-hentai.org, включая русские переводы: в фильтре «Язык» по умолчанию стоит Russian. Каждая галерея — тайтл с одной главой; страницы главы — все страницы галереи, подгружаются сразу целиком. Без логина, токенов и cookie. 1.0.1: обложки в «Популярном», полный список страниц вместо одной, Referer для картинок."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return EH_BASE; }

    getHeaders(url) { return ehHeaders(); }

    async getPopular(page) {
        // The popular page has no paging of its own.
        if (page > 1) return { list: [], hasNextPage: false };
        const res = await this.client.get(EH_BASE + "/popular", ehHeaders());
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        const list = ehParseList(res.body || "");
        return { list: list.length ? list : ehParsePopular(res.body), hasNextPage: false };
    }

    async getLatestUpdates(page) {
        return await this.fetchList("language:russian", page);
    }

    async search(query, page, filters) {
        if (ehPopularSort(filters)) return await this.getPopular(page);
        const q = query && /language:/.test(query) ? String(query).trim() : ehQuery(query, filters);
        return await this.fetchList(q, page, ehCategoryMask(filters));
    }

    async fetchList(q, page, cats) {
        // The site keeps its place in a result set in a "next" token: every
        // listing page answers with the token for the following one. Asking
        // the search again with only ?page=N repeats page 1.
        this.tokens = this.tokens || {};
        const key = (q || "(all)") + "|" + (cats || "");
        const next = page <= 1 ? 0 : this.tokens[key];
        if (next === undefined) return { list: [], hasNextPage: false };
        const res = await this.client.get(ehListUrl(q, next, cats), ehHeaders());
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        const body = res.body || "";
        if (/No hits found/i.test(body)) return { list: [], hasNextPage: false };
        const token = ehNextToken(body);
        if (token) this.tokens[key] = token;
        else delete this.tokens[key];
        const list = ehParseList(body);
        return { list: list, hasNextPage: list.length >= 25 && !!token };
    }

    async getDetail(url) {
        const full = url.indexOf("http") === 0 ? url : this.getBaseUrl() + url;
        const res = await this.client.get(full, ehHeaders());
        const g = ehGallery(res.body || "");
        const chapters = [];
        if (g.firstPage && g.pages > 0) {
            // One chapter per gallery; the URL is the gallery itself, so the
            // source can rebuild the reader page from it at any time.
            chapters.push({
                name: "Галерея — " + g.pages + " стр.",
                url: full,
                dateUpload: "",
                scanlator: ""
            });
        }
        const genre = [];
        for (const tag of g.tags) {
            const m = tag.match(/^(language|parody|male|female|mixed|other|artist|group): (.+)$/);
            if (m) genre.push(m[2]);
        }
        return {
            name: g.name || g.jpName || "E-Hentai",
            imageUrl: g.cover,
            description: [g.jpName, g.tags.join(" · ")].filter(x => x).join("\n"),
            author: "",
            artist: "",
            genre: genre,
            status: 1,
            chapters: chapters
        };
    }

    // Pages of the gallery, in order.
    //
    // The app asks for the page list once and keeps it, so every page has to be
    // returned here. The gallery's own ?p= listings hand out the reader URLs in
    // batches of 20 (a couple of requests), and each reader page is then read
    // for its image address with a few requests in flight. Both results are
    // cached for the session, so reopening a gallery is instant.
    async getPageList(url) {
        const full = url.indexOf("http") === 0 ? url : this.getBaseUrl() + url;
        const key = ehGalleryKey(full);
        this.pageCache = this.pageCache || {};
        const cached = this.pageCache[key];
        if (cached) return cached.map(x => ({ url: x, headers: ehHeaders() }));

        let total = 0;
        let first = "";
        try {
            const res = await this.client.get(full, ehHeaders());
            const g = ehGallery(res.body || "");
            total = g.pages;
            first = g.firstPage;
        } catch (e) {}

        // All reader URLs from the gallery's batch listings.
        let readers = [];
        if (total > 0) {
            const listings = Math.ceil(total / 20);
            for (let p = 0; p < listings; p++) {
                try {
                    const res = await this.client.get(ehGalleryListingUrl(full, p), ehHeaders());
                    if (res && res.statusCode === 200) readers = readers.concat(ehReaderPages(res.body || ""));
                } catch (e) {}
            }
            readers = ehUniqueUrls(readers).sort((a, b) => ehPageNumber(a) - ehPageNumber(b));
        }

        // Fallback when the batch listing gives nothing: follow the page chain.
        if (!readers.length && first) {
            readers = await this.chainPages(first, total || EH_MAX_PAGES);
        }

        // Image address of every page, a few requests in flight.
        const urls = await ehMapLimit(readers, EH_CONCURRENCY, async (readerUrl) => {
            const img = await this.readerImage(readerUrl);
            return img || readerUrl;
        });

        this.pageCache[key] = urls;
        const keys = Object.keys(this.pageCache);
        if (keys.length > 12) delete this.pageCache[keys[0]];
        return urls.map(x => ({ url: x, headers: ehHeaders() }));
    }

    // Follows the reader's own "next" links; only used when the gallery
    // listings cannot be read.
    async chainPages(first, total) {
        const out = [];
        let cur = first.indexOf("http") === 0 ? first : EH_BASE + first;
        while (cur && out.length < Math.min(total || EH_MAX_PAGES, EH_MAX_PAGES)) {
            out.push(cur);
            let next = "";
            try {
                const res = await this.client.get(cur, ehHeaders());
                if (!res || res.statusCode !== 200) break;
                next = ehPageNext(res.body || "");
            } catch (e) {
                break;
            }
            cur = next;
        }
        return out;
    }

    // Image address of one reader page, or "" when it cannot be learnt.
    async readerImage(readerUrl) {
        try {
            const res = await this.client.get(readerUrl, ehHeaders());
            if (!res || res.statusCode !== 200) return "";
            return ehPageImage(res.body || "");
        } catch (e) {
            return "";
        }
    }
}
