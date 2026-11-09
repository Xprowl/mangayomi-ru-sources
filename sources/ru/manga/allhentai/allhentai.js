// @include: grouple_base

const mangayomiSources = [{
    "name": "AllHentai",
    "lang": "ru",
    "baseUrl": "https://20.allhen.online",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": false,
    "version": "0.4.5",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/allhentai.js",
    "notes": "18+. allhentai.ru Р РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В Р вЂ¦Р В Р’В° allhen.online Р Р†Р вЂљРІР‚Сњ Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР РЋР вЂљ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂ Р В РўвЂР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂўР В РЎВ (20.) Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р РЋРЎвЂњР В Р’В»Р РЋР РЏР РЋР вЂљР В Р вЂ¦Р В РЎвЂў Р В РЎВР В Р’ВµР В Р вЂ¦Р РЋР РЏР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ. Р В РЎСџР РЋР вЂљР В РЎвЂ 'Failed host lookup' Р В Р’В·Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р вЂ¦Р В Р’В° https://allhentai.ru/ Р В Р вЂ  Р В Р’В±Р РЋР вЂљР В Р’В°Р РЋРЎвЂњР В Р’В·Р В Р’ВµР РЋР вЂљР В Р’Вµ, Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р В РЎВР В РЎвЂўР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р вЂ¦Р В Р’В° Р В РЎвЂќР В Р’В°Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ mirror Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В±Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚в„–Р В Р вЂ Р В Р’В°Р В Р’ВµР РЋРІР‚С™, Р В РЎвЂ Р В Р вЂ Р В РЎвЂ”Р В РЎвЂР РЋРІвЂљВ¬Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’ВµР В РЎвЂ“Р В РЎвЂў Р В Р вЂ  Р В Р вЂ¦Р В Р’В°Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РІвЂћвЂ“Р В РЎвЂќР В Р’В°Р РЋРІР‚В¦ Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂР В РЎвЂќР В Р’В°."
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

    async getDetail(url) { return await groupleGetDetail(this.client, this.getBaseUrl(), url); }
    async getPageList(url) { return await groupleGetPageList(this.client, this.getBaseUrl(), url); }
    getFilterList() { return groupleFilterList(); }
    getSourcePreferences() { return groupleSourcePreferences(); }
}
