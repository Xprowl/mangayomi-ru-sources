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
    "version": "0.4.4",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/allhentai.js",
    "notes": "18+. allhentai.ru РЎР‚Р ВµР Т‘Р С‘РЎР‚Р ВµР С”РЎвЂљР С‘РЎвЂљРЎРѓРЎРЏ Р Р…Р В° allhen.online РІР‚вЂќ Р Р…Р С•Р СР ВµРЎР‚ Р С—Р ВµРЎР‚Р ВµР Т‘ Р Т‘Р С•Р СР ВµР Р…Р С•Р С (20.) РЎР‚Р ВµР С–РЎС“Р В»РЎРЏРЎР‚Р Р…Р С• Р СР ВµР Р…РЎРЏР ВµРЎвЂљРЎРѓРЎРЏ. Р СџРЎР‚Р С‘ 'Failed host lookup' Р В·Р В°Р в„–Р Т‘Р С‘РЎвЂљР Вµ Р Р…Р В° https://allhentai.ru/ Р Р† Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р Вµ, Р С—Р С•РЎРѓР СР С•РЎвЂљРЎР‚Р С‘РЎвЂљР Вµ Р Р…Р В° Р С”Р В°Р С”Р С•Р в„– mirror Р С—Р ВµРЎР‚Р ВµР В±РЎР‚Р В°РЎРѓРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ, Р С‘ Р Р†Р С—Р С‘РЎв‚¬Р С‘РЎвЂљР Вµ Р ВµР С–Р С• Р Р† Р Р…Р В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р В°РЎвЂ¦ Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”Р В°."
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
