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
    "version": "0.4.3",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/allhentai.js",
    "notes": "18+. allhentai.ru СЂРµРґРёСЂРµРєС‚РёС‚СЃСЏ РЅР° allhen.online вЂ” РЅРѕРјРµСЂ РїРµСЂРµРґ РґРѕРјРµРЅРѕРј (20.) СЂРµРіСѓР»СЏСЂРЅРѕ РјРµРЅСЏРµС‚СЃСЏ. РџСЂРё 'Failed host lookup' Р·Р°Р№РґРёС‚Рµ РЅР° https://allhentai.ru/ РІ Р±СЂР°СѓР·РµСЂРµ, РїРѕСЃРјРѕС‚СЂРёС‚Рµ РЅР° РєР°РєРѕР№ mirror РїРµСЂРµР±СЂР°СЃС‹РІР°РµС‚, Рё РІРїРёС€РёС‚Рµ РµРіРѕ РІ РЅР°СЃС‚СЂРѕР№РєР°С… РёСЃС‚РѕС‡РЅРёРєР°."
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
