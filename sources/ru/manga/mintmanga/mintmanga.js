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
    "version": "0.5.7",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/mintmanga.js",
    "notes": "0.5.4: Р В РЎвЂ“Р В Р’В»Р В Р’В°Р В Р вЂ Р РЋРІР‚в„– Р РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р РЋР вЂ№Р РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р РЋР С“ Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР В РЎвЂ“Р В РЎвЂў Р В Р’В·Р В Р’ВµР РЋР вЂљР В РЎвЂќР В Р’В°Р В Р’В»Р В Р’В° 2.mintmanga.one Р В Р вЂ¦Р В Р’В°Р В РЎвЂ”Р РЋР вЂљР РЋР РЏР В РЎВР РЋРЎвЂњР РЋР вЂ№ (Р РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™ Р РЋР С“ mintmanga.live Р В Р’В»Р В РЎвЂўР В РЎВР В Р’В°Р В Р’В» Referer, Р В РЎвЂ Р РЋР С“Р В Р’В°Р В РІвЂћвЂ“Р РЋРІР‚С™ Р В РЎвЂўР РЋРІР‚С™Р В РўвЂР В Р’В°Р В Р вЂ Р В Р’В°Р В Р’В» 404 Р РЋР С“ deleted1.png). Р В Р Р‹Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР РЋРІР‚в„–Р В Р’Вµ Р В РЎвЂ“Р В Р’В»Р В Р’В°Р В Р вЂ Р РЋРІР‚в„– Р РЋР С“ Р В РЎВР РЋРІР‚ВР РЋР вЂљР РЋРІР‚С™Р В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂ“Р В РЎвЂўР В Р вЂ  mintmanga.one/.com/.me Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ¦Р В Р’В°Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В»Р РЋР РЏР РЋР вЂ№Р РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР В РЎВР В Р’В°Р РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂ. 0.5.1+: Р РЋР вЂљР В РЎвЂР В РўвЂР В Р’ВµР РЋР вЂљ Р В Р’В¶Р В РЎвЂР В Р вЂ Р РЋРІР‚ВР РЋРІР‚С™ Р В Р вЂ¦Р В Р’В° mintmanga.live, Р В Р’В° .one/.com Р Р†Р вЂљРІР‚Сњ WordPress-Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂ“ Р В Р’В±Р В Р’ВµР В Р’В· Р РЋРІР‚С™Р В Р’В°Р В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’В»Р В РЎвЂўР В Р вЂ ; Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В±Р В Р’В»Р В РЎвЂўР В РЎвЂќР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В РЎвЂќР В Р’Вµ Р В РЎВР В РЎвЂўР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РЎвЂўР В РЎвЂ”Р РЋР вЂљР В Р’ВµР В РўвЂР В Р’ВµР В Р’В»Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ baseUrl Р В Р вЂ  Р В Р вЂ¦Р В Р’В°Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РІвЂћвЂ“Р В РЎвЂќР В Р’В°Р РЋРІР‚В¦."
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
