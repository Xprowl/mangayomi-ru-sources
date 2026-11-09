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
    "version": "0.4.5",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/readmanga.js",
    "notes": "Р В РЎвЂ™Р В РЎвЂќР РЋРІР‚С™Р РЋРЎвЂњР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ mirror: 3.readmanga.ru. Р В РІР‚СњР РЋР вЂљР РЋРЎвЂњР В РЎвЂ“Р В РЎвЂР В Р’Вµ: web.usagi.one, readmanga.io, readmanga.live (Р РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™). Р В РЎСџР РЋР вЂљР В РЎвЂ Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂќР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В РЎвЂќР В Р’Вµ Р В Р’В·Р В Р’В°Р В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р вЂ  Р В Р вЂ¦Р В Р’В°Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РІвЂћвЂ“Р В РЎвЂќР В Р’В°Р РЋРІР‚В¦."
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
