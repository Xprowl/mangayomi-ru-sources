// @include: pawchive_base

const mangayomiSources = [{
    "name": "Pawchive",
    "lang": "all",
    "baseUrl": "https://pawchive.pw",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "1.0.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "all/manga/pawchive.js",
    "notes": "Публичный архив постов с Patreon, Pixiv Fanbox и Discord (pawchive.pw) — без логина, токенов и cookie. Глав на сайте нет: пост — одна публикация с любым числом вложений, поэтому пост показывается как тайтл с одной главой, а её страницы — картинки поста. Видео и архивы перечислены в описании. Пустой поиск открывает авторов архива (фильтр «Источник»: подборка + сервис); поиск с текстом ищет по постам. Сайт отдаёт 50 постов на страницу без общего лимита."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return PW_BASE; }

    getHeaders(url) { return pwHeaders(); }

    get supportsLatest() { return true; }

    getFilterList() {
        const services = PW_SERVICES.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }));
        const sources = PW_SOURCES.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }));
        return [
            {
                type_name: "SelectFilter",
                type: "source",
                name: "Подборка (пустой поиск)",
                state: 0,
                values: sources
            },
            {
                type_name: "SelectFilter",
                type: "a_service",
                name: "Сервис авторов",
                state: 0,
                values: services
            },
            {
                type_name: "SelectFilter",
                type: "a_sort",
                name: "Сортировка авторов",
                state: 0,
                values: [
                    { type_name: "SelectOption", name: "По популярности", value: "favorited" },
                    { type_name: "SelectOption", name: "По дате обновления", value: "updated" },
                    { type_name: "SelectOption", name: "По дате индексации", value: "indexed" },
                    { type_name: "SelectOption", name: "По алфавиту", value: "name" }
                ]
            }
        ];
    }

    pwOption(filters, index, fallback) {
        const f = filters && filters[index];
        if (!f || f.state === undefined || f.state === null) return fallback;
        const i = Number(f.state);
        return isNaN(i) ? fallback : i;
    }

    pwService(filters) {
        const i = this.pwOption(filters, 1, 0);
        return (PW_SERVICES[i] || PW_SERVICES[0])[1];
    }

    pwSource(filters) {
        const i = this.pwOption(filters, 0, 0);
        return (PW_SOURCES[i] || PW_SOURCES[0])[1];
    }

    pwAuthorSort(filters) {
        const i = this.pwOption(filters, 2, 0);
        return ["favorited", "updated", "indexed", "name"][i] || "favorited";
    }

    async pwGet(path) {
        const full = path.indexOf("http") === 0 ? path : PW_BASE + path;
        const res = await this.client.get(full, pwHeaders());
        if (!res || res.statusCode !== 200) return "";
        return res.body || "";
    }

    // -------------------------------------------------------------- lists

    pwCard(item) {
        return {
            name: item.name + (item.service ? " · " + pwServiceName(item.service) : ""),
            imageUrl: item.imageUrl,
            link: item.link
        };
    }

    async pwPosts(path, page) {
        const p = Math.max(1, Number(page) || 1);
        const html = await this.pwGet(path + (path.indexOf("?") >= 0 ? "&" : "?") + "o=" + (p - 1) * PW_PER_PAGE);
        if (!html) return { list: [], hasNextPage: false };
        const list = pwParsePosts(html).map(x => this.pwCard(x));
        const total = pwTotal(html);
        const hasNext = list.length >= PW_PER_PAGE && (total ? p * PW_PER_PAGE < total : true);
        return { list: list, hasNextPage: hasNext };
    }

    // One random post: it opens straight away, so it can be added to the library.
    async pwRandom() {
        const res = await this.client.get(PW_BASE + "/posts/random", pwHeaders());
        const location = (res && res.headers && (res.headers.location || res.headers.Location)) || "";
        const path = pwPostPath(location);
        if (!path) return { list: [], hasNextPage: false };
        const html = await this.pwGet(path);
        const post = html ? pwParsePost(html) : null;
        const name = (post && post.title) || ("Случайный пост " + path.split("/").pop());
        return {
            list: [{
                name: name + (post && post.service ? " · " + pwServiceName(post.service) : ""),
                imageUrl: (post && post.files && post.files[0] && post.files[0].thumb) || "",
                link: path
            }],
            hasNextPage: false
        };
    }

    async getLatestUpdates(page) {
        return await this.pwPosts("/posts", page);
    }

    // Best posts of the archive (the popular page holds 500 of them).
    async getPopular(page) {
        return await this.pwPosts("/posts/popular", page);
    }

    async search(query, page, filters) {
        const text = String(query || "").trim();
        if (text) return await this.pwPosts("/posts?q=" + encodeURIComponent(text), page);
        return await this.pwAuthorList(page, filters);
    }

    // ------------------------------------------------------------ authors

    // Creators come from the site's own JSON list (about 15 MB, one request);
    // it is kept for the session and paged here.
    async pwCreators() {
        if (this.creators) return this.creators;
        const res = await this.client.get(PW_BASE + "/api/v1/creators", {
            "User-Agent": PW_UA,
            "Accept": "application/json"
        });
        if (!res || res.statusCode !== 200) return [];
        let data = [];
        try {
            data = JSON.parse(res.body || "[]");
        } catch (e) {
            return [];
        }
        this.creators = Array.isArray(data) ? data : [];
        return this.creators;
    }

    async pwAuthorList(page, filters) {
        const p = Math.max(1, Number(page) || 1);
        const service = this.pwService(filters);
        const sort = this.pwAuthorSort(filters);
        const all = await this.pwCreators();
        if (!all.length) return { list: [], hasNextPage: false };
        let items = service ? all.filter(x => String(x.service || "").toLowerCase() === service) : all.slice();
        const key = sort === "name" ? "name" : sort;
        items.sort((a, b) => {
            if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
            return (Number(b[key]) || 0) - (Number(a[key]) || 0);
        });
        const start = (p - 1) * PW_PER_PAGE;
        const slice = items.slice(start, start + PW_PER_PAGE);
        const list = slice.map(x => ({
            name: x.name + (x.favorited ? " · " + x.favorited + " ♥" : "") + (x.service ? " · " + pwServiceName(x.service) : ""),
            imageUrl: pwIconHref(x.service, x.id),
            link: "/" + String(x.service || "patreon") + "/user/" + x.id
        }));
        return { list: list, hasNextPage: start + slice.length < items.length };
    }

    // ------------------------------------------------------------- detail

    async getPost(url) {
        const path = pwPostPath(url);
        if (!path) throw new Error("Не удалось определить пост Pawchive по ссылке: " + url);
        const html = await this.pwGet(path);
        if (!html) throw new Error("Пост Pawchive недоступен: " + path);
        const post = pwParsePost(html);
        if (!post.id) throw new Error("Пост Pawchive недоступен: " + path);
        post.path = path;
        return post;
    }

    pwPages(post) {
        const images = [];
        const others = [];
        for (const f of post.files || []) {
            const name = f.name || "";
            const url = f.thumb || f.href || "";
            if (!url) continue;
            if (!name || PW_IMAGE_EXT.test(name)) images.push(url);
            else others.push(name + (PW_VIDEO_EXT.test(name) ? " (видео)" : ""));
        }
        return { images: images, others: others };
    }

    // A creator link (no post id) lists that creator's posts.
    async getArtist(url) {
        const userPath = pwUserPath(url);
        const html = await this.pwGet(userPath);
        if (!html) throw new Error("Автор Pawchive недоступен: " + url);
        const posts = pwParsePosts(html);
        const total = pwTotal(html);
        const service = userPath.split("/")[1] || "";
        const user = pwUserId(userPath);
        const title = pwText((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
        const name = (posts[0] && posts[0].authorName) ||
            title.replace(/^Posts of\s+/i, "").replace(/\s+from\s+[A-Za-z ]+\|\s*Pawchive\s*$/i, "").trim();
        if (!posts.length) {
            return {
                name: name || ("Pawchive " + user),
                imageUrl: pwIconHref(service, user),
                description: "У этого автора пока нет открытых постов.",
                author: name, artist: name, genre: [pwServiceName(service)],
                status: 1, chapters: []
            };
        }
        // Each listed post is a chapter, so a creator's title can be read
        // straight from the list.
        const chapters = posts.filter(x => x.link).map(x => ({
            name: (x.name || ("Пост " + x.id)).slice(0, 120),
            url: x.link,
            dateUpload: x.date ? String(Date.parse(x.date.replace(" ", "T")) || "") : "",
            scanlator: ""
        }));
        const description = [
            pwServiceName(service) + " · автор",
            "Постов в архиве: " + (total || posts.length),
            "Профиль: " + PW_BASE + userPath,
            "",
            "Глав в этом тайтле: " + chapters.length + " — это посты автора, по одному на главу."
        ].join("\n");
        return {
            name: name || ("Pawchive " + pwServiceName(service) + " " + user),
            imageUrl: posts[0].imageUrl || pwIconHref(service, user),
            description: description,
            author: name, artist: name,
            genre: [pwServiceName(service)],
            status: 1,
            chapters: chapters
        };
    }

    async getDetail(url) {
        if (pwUserId(url) && !pwPostPath(url)) return await this.getArtist(url);

        const post = await this.getPost(url);
        const { images, others } = this.pwPages(post);
        const lines = [];
        lines.push(pwServiceName(post.service) + (post.author ? " · " + post.author : ""));
        if (post.published) lines.push("Опубликован: " + post.published);
        lines.push("Картинок: " + images.length + " · файлов всего: " + (post.files || []).length);
        if (post.authorLink) lines.push("Автор: " + PW_BASE + post.authorLink);
        lines.push("Пост: " + PW_BASE + post.path);
        if (post.body) lines.push("", post.body);
        if (others.length) lines.push("", "Другие файлы (не картинки): " + others.join(", "));
        if (post.tags && post.tags.length) lines.push("", "Теги: " + post.tags.join(", "));
        if (!images.length) lines.push("", "В этом посте нет картинок — только файлы, перечисленные выше.");
        const chapters = [];
        if (images.length) {
            chapters.push({
                name: "Пост — " + images.length + " стр.",
                url: post.path,
                dateUpload: pwPostDate(post),
                scanlator: ""
            });
        }
        return {
            name: post.title || ("Пост #" + post.id),
            imageUrl: images[0] || "",
            description: lines.join("\n"),
            author: post.author || "",
            artist: post.author || "",
            genre: (post.tags || []).slice(0, 12),
            status: 1,
            chapters: chapters
        };
    }

    // -------------------------------------------------------------- pages

    async getPageList(url) {
        const post = await this.getPost(url);
        const { images } = this.pwPages(post);
        return images.map(x => ({ url: x, headers: pwHeaders() }));
    }
}
