// @include: grouple_base

const mangayomiSources = [{
    "name": "ReadManga",
    "lang": "ru",
    "baseUrl": "https://3.readmanga.ru",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.4.4",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/readmanga.js",
    "notes": "Р С’Р С”РЎвЂљРЎС“Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– mirror: 3.readmanga.ru. Р вЂќРЎР‚РЎС“Р С–Р С‘Р Вµ: web.usagi.one, readmanga.io, readmanga.live (РЎР‚Р ВµР Т‘Р С‘РЎР‚Р ВµР С”РЎвЂљ). Р СџРЎР‚Р С‘ Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р Вµ Р В·Р В°Р СР ВµР Р…Р С‘РЎвЂљР Вµ Р Р† Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р В°РЎвЂ¦."
}];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    getBaseUrl() { return groupleBaseUrlFrom(this.source); }

    // Used by Mangayomi when loading covers: the Grouple image CDN rejects
    // hotlinks, so it needs the site as Referer (see groupleImageHeaders).
    getHeaders(url) { return groupleImageHeaders(this.getBaseUrl()); }

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

    async getDetail(url) {
        return await groupleGetDetail(this.client, this.getBaseUrl(), url);
    }

    async getPageList(url) {
        return await groupleGetPageList(this.client, this.getBaseUrl(), url);
    }

    getFilterList() { return groupleFilterList(); }
    getSourcePreferences() { return groupleSourcePreferences(); }
}
