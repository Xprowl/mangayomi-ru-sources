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
    "version": "0.5.6",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/mintmanga.js",
    "notes": "0.5.4: Р С–Р В»Р В°Р Р†РЎвЂ№ РЎвЂЎР С‘РЎвЂљР В°РЎР‹РЎвЂљРЎРѓРЎРЏ РЎРѓ РЎР‚Р В°Р В±Р С•РЎвЂЎР ВµР С–Р С• Р В·Р ВµРЎР‚Р С”Р В°Р В»Р В° 2.mintmanga.one Р Р…Р В°Р С—РЎР‚РЎРЏР СРЎС“РЎР‹ (РЎР‚Р ВµР Т‘Р С‘РЎР‚Р ВµР С”РЎвЂљ РЎРѓ mintmanga.live Р В»Р С•Р СР В°Р В» Referer, Р С‘ РЎРѓР В°Р в„–РЎвЂљ Р С•РЎвЂљР Т‘Р В°Р Р†Р В°Р В» 404 РЎРѓ deleted1.png). Р РЋРЎвЂљР В°РЎР‚РЎвЂ№Р Вµ Р С–Р В»Р В°Р Р†РЎвЂ№ РЎРѓ Р СРЎвЂРЎР‚РЎвЂљР Р†РЎвЂ№РЎвЂ¦ Р В±Р В»Р С•Р С–Р С•Р Р† mintmanga.one/.com/.me Р С—Р ВµРЎР‚Р ВµР Р…Р В°Р С—РЎР‚Р В°Р Р†Р В»РЎРЏРЎР‹РЎвЂљРЎРѓРЎРЏ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘. 0.5.1+: РЎР‚Р С‘Р Т‘Р ВµРЎР‚ Р В¶Р С‘Р Р†РЎвЂРЎвЂљ Р Р…Р В° mintmanga.live, Р В° .one/.com РІР‚вЂќ WordPress-Р В±Р В»Р С•Р С– Р В±Р ВµР В· РЎвЂљР В°Р в„–РЎвЂљР В»Р С•Р Р†; Р С—РЎР‚Р С‘ Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р Вµ Р СР С•Р В¶Р Р…Р С• Р С—Р ВµРЎР‚Р ВµР С•Р С—РЎР‚Р ВµР Т‘Р ВµР В»Р С‘РЎвЂљРЎРЉ baseUrl Р Р† Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р В°РЎвЂ¦."
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
