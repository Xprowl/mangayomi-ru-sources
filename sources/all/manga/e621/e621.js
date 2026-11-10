// @include: e621_base

const mangayomiSources = [{
    "name": "e621",
    "lang": "all",
    "baseUrl": "https://e621.net",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "1.0.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "all/manga/e621.js",
    "notes": "Фурри-борда e621.net через открытый JSON API (без логина и токенов). На сайте нет глав: каждый пост — одна картинка, поэтому пост показывается как тайтл с одной главой. Фильтры: рейтинг (Safe / Questionable / Explicit) и сортировка (новые, по оценке, за неделю, случайные). В поиск можно писать любые теги борды через пробел, минус исключает тег. Видео-посты (webm) открываются стоп-кадром."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return E6_BASE; }

    getHeaders(url) { return e6Headers(); }

    get supportsLatest() { return true; }

    getFilterList() {
        return [
            {
                type_name: "SelectFilter",
                type: "rating",
                name: "Рейтинг",
                state: 0,
                values: E6_RATINGS.map(x => ({ type_name: "SelectOption", name: x[0], value: x[0] }))
            },
            {
                type_name: "SelectFilter",
                type: "sort",
                name: "Сортировка",
                state: 0,
                values: E6_SORTS.map(x => ({ type_name: "SelectOption", name: x[0], value: x[0] }))
            }
        ];
    }

    // One page of posts for a tag string.
    async fetchList(tags, page) {
        let body = "";
        try {
            const res = await this.client.get(e6ListUrl(tags, page), e6Headers());
            // 410 = the site refuses pages past 750, which is the end of the list.
            if (!res || res.statusCode !== 200) return { list: [], hasNextPage: false };
            body = res.body || "";
        } catch (e) {
            return { list: [], hasNextPage: false };
        }
        let posts = [];
        try {
            posts = (JSON.parse(body).posts) || [];
        } catch (e) {
            return { list: [], hasNextPage: false };
        }
        const list = posts.map(e6Tile);
        const p = Number(page) || 1;
        return { list: list, hasNextPage: list.length >= E6_PAGE_SIZE && p < E6_MAX_PAGE };
    }

    async getPopular(page) {
        return await this.fetchList("order:score", page);
    }

    async getLatestUpdates(page) {
        return await this.fetchList("", page);
    }

    async search(query, page, filters) {
        return await this.fetchList(e6TagsQuery(query, filters), page);
    }

    // One post: the app needs a title with a chapter to open and read it.
    async getPost(url) {
        const id = e6PostId(url);
        if (!id) throw new Error("Не удалось определить номер поста e621");
        const res = await this.client.get(e6PostUrl(id), e6Headers());
        if (!res || res.statusCode !== 200) {
            throw new Error("Пост e621 #" + id + " недоступен (удалён или скрыт)");
        }
        const data = JSON.parse(res.body || "{}");
        const post = data.post || data;
        if (!post || !post.id) throw new Error("Пост e621 #" + id + " недоступен");
        return post;
    }

    async getDetail(url) {
        const post = await this.getPost(url);
        const created = Date.parse(post.created_at || "");
        return {
            name: e6Title(post),
            imageUrl: e6Cover(post),
            description: e6Description(post),
            author: ((post.tags || {}).artist || []).map(e6Pretty).join(", "),
            artist: ((post.tags || {}).artist || []).map(e6Pretty).join(", "),
            genre: e6Genres(post),
            status: 1,
            chapters: [{
                name: e6IsVideo(post) ? "Видео (стоп-кадр)" : "Картинка",
                url: "/posts/" + post.id,
                dateUpload: isNaN(created) ? "" : String(created),
                scanlator: ""
            }]
        };
    }

    async getPageList(url) {
        const post = await this.getPost(url);
        const image = e6Image(post);
        if (!image) return [];
        return [{ url: image, headers: e6Headers() }];
    }
}
