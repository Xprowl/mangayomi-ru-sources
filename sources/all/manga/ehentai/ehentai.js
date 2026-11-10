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
    "version": "1.0.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "all/manga/ehentai.js",
    "notes": "Галереи e-hentai.org, включая русские переводы: в фильтре «Язык» по умолчанию стоит Russian. Каждая галерея — тайтл с одной главой, страниц столько, сколько в галерее. Без логина, токенов и cookie."
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
        return { list: ehParsePopular(res.body), hasNextPage: false };
    }

    async getLatestUpdates(page) {
        return await this.fetchList("language:russian", page);
    }

    async search(query, page, filters) {
        if (ehPopularSort(filters)) return await this.getPopular(page);
        const q = query && /language:/.test(query) ? String(query).trim() : ehQuery(query, filters);
        return await this.fetchList(q, page);
    }

    async fetchList(q, page) {
        // The site keeps its place in a result set in a "next" token: every
        // listing page answers with the token for the following one. Asking
        // the search again with only ?page=N repeats page 1.
        this.tokens = this.tokens || {};
        const key = q || "(all)";
        const next = page <= 1 ? 0 : this.tokens[key];
        if (next === undefined) return { list: [], hasNextPage: false };
        const res = await this.client.get(ehListUrl(q, next), ehHeaders());
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
    // Each reader page answers with the real image address, and asking for it
    // costs one request on the site. So the addresses are learnt in the
    // background, in the same order the reader goes, while the pages are
    // handed over as reader URLs right away (the app opens those with these
    // headers, so every page still shows). Once an address is known, the next
    // call returns it directly.
    async getPageList(url) {
        const full = url.indexOf("http") === 0 ? url : this.getBaseUrl() + url;
        const key = ehGalleryKey(full);
        let gallery = this.galleries && this.galleries[key];
        if (!gallery) {
            const res = await this.client.get(full, ehHeaders());
            const g = ehGallery(res.body || "");
            gallery = { total: g.pages, pages: [], next: g.firstPage, known: 0, images: {}, walking: false };
            this.galleries = this.galleries || {};
            this.galleries[key] = gallery;
        }
        // The app preloads the next pages right after this call, so the image
        // address of the first page is learnt here; the rest follows in the
        // background (walk).
        if (gallery.next && !gallery.pages.length) {
            await this.step(gallery);
        }
        this.walk(gallery);
        const out = [];
        for (const readerUrl of gallery.pages) {
            out.push({ url: gallery.images[readerUrl] || readerUrl, headers: ehHeaders() });
        }
        return out;
    }

    async step(gallery) {
        if (!gallery.next) return false;
        const res = await this.client.get(gallery.next, ehHeaders());
        if (!res || res.statusCode !== 200) { gallery.next = ""; return false; }
        const body = res.body || "";
        const img = ehPageImage(body);
        gallery.pages.push(gallery.next);
        if (img) gallery.images[gallery.next] = img;
        const next = ehPageNext(body);
        gallery.next = next || "";
        return true;
    }

    // Learns reader pages in order, a few at a time, without holding up the
    // page list. Stops at the gallery's last page; a later call resumes if the
    // previous walk was cut short by a network error.
    walk(gallery) {
        if (gallery.walking) return;
        gallery.walking = true;
        const step = () => {
            if (!gallery.next || !gallery.pages.length && gallery.total === 0) { gallery.walking = false; return; }
            if (gallery.total && gallery.pages.length >= gallery.total) { gallery.walking = false; return; }
            const url = gallery.next;
            this.client.get(url, ehHeaders()).then(res => {
                if (!res || res.statusCode !== 200) { gallery.walking = false; return; }
                const body = res.body || "";
                const img = ehPageImage(body);
                gallery.pages.push(url);
                if (img) gallery.images[url] = img;
                const next = ehPageNext(body);
                gallery.next = next || "";
                if (!next) gallery.walking = false;
                else step();
            }).catch(() => { gallery.walking = false; });
        };
        step();
    }
}
