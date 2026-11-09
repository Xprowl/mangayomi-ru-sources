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
    "version": "0.5.5",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/mintmanga.js",
    "notes": "0.5.4: РіР»Р°РІС‹ С‡РёС‚Р°СЋС‚СЃСЏ СЃ СЂР°Р±РѕС‡РµРіРѕ Р·РµСЂРєР°Р»Р° 2.mintmanga.one РЅР°РїСЂСЏРјСѓСЋ (СЂРµРґРёСЂРµРєС‚ СЃ mintmanga.live Р»РѕРјР°Р» Referer, Рё СЃР°Р№С‚ РѕС‚РґР°РІР°Р» 404 СЃ deleted1.png). РЎС‚Р°СЂС‹Рµ РіР»Р°РІС‹ СЃ РјС‘СЂС‚РІС‹С… Р±Р»РѕРіРѕРІ mintmanga.one/.com/.me РїРµСЂРµРЅР°РїСЂР°РІР»СЏСЋС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё. 0.5.1+: СЂРёРґРµСЂ Р¶РёРІС‘С‚ РЅР° mintmanga.live, Р° .one/.com вЂ” WordPress-Р±Р»РѕРі Р±РµР· С‚Р°Р№С‚Р»РѕРІ; РїСЂРё Р±Р»РѕРєРёСЂРѕРІРєРµ РјРѕР¶РЅРѕ РїРµСЂРµРѕРїСЂРµРґРµР»РёС‚СЊ baseUrl РІ РЅР°СЃС‚СЂРѕР№РєР°С…."
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
