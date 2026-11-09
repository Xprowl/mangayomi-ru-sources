// @include: grouple_base

const mangayomiSources = [{
    "name": "MintManga",
    "lang": "ru",
    "baseUrl": "https://mintmanga.live",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.5.2",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/mintmanga.js",
    "notes": "MintManga — теперь mintmanga.one (WordPress-сайт, не Grouple). 0.5.0: старые зеркала (*.mintmanga.com, 2.mintmanga.one, mintmanga.live) отдают «NOT FOUND», поэтому baseUrl смотрит на mintmanga.one; остальные зеркала можно переопределить в настройках источника. Прежняя Grouple-читка (mintmanga.one/<slug>__A123) отдаётся только поддоменами вида 24.mintmanga.one, которые резолвятся не из всех сетей."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return groupleBaseUrlFrom(this.source); }

    async getPopular(page) {
        const baseUrl = this.getBaseUrl();
        const res = await this.client.get(groupleListUrl(baseUrl, "RATING", page), groupleHeaders(baseUrl));
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        return groupleParseList(res.body, baseUrl);
    }

    async getLatestUpdates(page) {
        const baseUrl = this.getBaseUrl();
        const res = await this.client.get(groupleListUrl(baseUrl, "UPDATED", page), groupleHeaders(baseUrl));
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        return groupleParseList(res.body, baseUrl);
    }

    async search(query, page, filters) {
        const baseUrl = this.getBaseUrl();
        const url = groupleSearchUrl(baseUrl, query, page, filters);
        const res = await this.client.get(url, groupleHeaders(baseUrl));
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        return groupleParseList(res.body, baseUrl);
    }

    async getDetail(url) { return await groupleGetDetail(this.client, this.getBaseUrl(), url); }
    async getPageList(url) { return await groupleGetPageList(this.client, this.getBaseUrl(), url); }
    getFilterList() { return groupleFilterList(); }
    getSourcePreferences() { return groupleSourcePreferences(); }
}
