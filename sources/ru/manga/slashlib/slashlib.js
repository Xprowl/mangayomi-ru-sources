// @include: lib_family_base

const mangayomiSources = [{
    "name": "SlashLib",
    "lang": "ru",
    "baseUrl": "https://slashlib.me",
    "apiUrl": "https://api.cdnlibs.org/api",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": true,
    "hasCloudflare": true,
    "version": "0.1.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/slashlib.js",
    "notes": "SlashLib — яой/юри манга, семейство Lib (site_id=2). API api.cdnlibs.org. Сайт отдаёт SPA и редиректит на v2.shlib.life, API от домена не зависит. Для 18+/платных глав нужен Bearer token: DevTools → Network → любой XHR к api.cdnlibs.org → Authorization → вставить в Settings. Обложки идут через weserv.nl (cover.imglib.info отдаёт 403 напрямую)."
}];

const SLASHLIB_SITE_ID = 2;

// 56 жанров, доступных site_id=2 (из /api/constants?fields[]=genres, отфильтровано
// по site_ids). Отдельный список нужен потому, что /api/genres требует авторизации.
const SLASHLIB_GENRES = [
    ["Арт", 32],
    ["Безумие", 91],
    ["Боевик", 34],
    ["Боевые искусства", 35],
    ["Вампиры", 36],
    ["Военное", 89],
    ["Гарем", 37],
    ["Гендерная интрига", 38],
    ["Героическое фэнтези", 39],
    ["Демоны", 81],
    ["Детектив", 40],
    ["Дзёсэй", 41],
    ["Домсабверс", 93],
    ["Драма", 43],
    ["Игра", 44],
    ["Исекай", 79],
    ["История", 45],
    ["Киберпанк", 46],
    ["Кодомо", 76],
    ["Комедия", 47],
    ["Космос", 83],
    ["Магия", 85],
    ["Махо-сёдзё", 48],
    ["Машины", 90],
    ["Меха", 49],
    ["Мистика", 50],
    ["Музыка", 80],
    ["Научная фантастика", 51],
    ["Омегаверс", 77],
    ["Пародия", 86],
    ["Повседневность", 52],
    ["Полиция", 82],
    ["Постапокалиптика", 53],
    ["Приключения", 54],
    ["Психология", 55],
    ["Романтика", 56],
    ["Самурайский боевик", 57],
    ["Сверхъестественное", 58],
    ["Сёдзё", 59],
    ["Сёдзё-ай", 60],
    ["Сёнэн", 61],
    ["Сёнэн-ай", 62],
    ["Спорт", 63],
    ["Супер сила", 87],
    ["Сэйнэн", 64],
    ["Трагедия", 65],
    ["Триллер", 66],
    ["Ужасы", 67],
    ["Фантастика", 68],
    ["Фэнтези", 69],
    ["Хантерверс", 92],
    ["Школа", 70],
    ["Эротика", 71],
    ["Этти", 72],
    ["Юри", 73],
    ["Яой", 74]
];

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    async getPopular(page) { return await libGetPopular(this.client, this.source, SLASHLIB_SITE_ID, "manga", page); }
    async getLatestUpdates(page) { return await libGetLatest(this.client, this.source, SLASHLIB_SITE_ID, "manga", page); }
    async search(query, page, filters) { return await libSearch(this.client, this.source, SLASHLIB_SITE_ID, "manga", query, page, filters); }
    async getDetail(slug) { return await libMangaDetail(this.client, this.source, SLASHLIB_SITE_ID, slug); }
    async getPageList(url) { return await libMangaPageList(this.client, this.source, SLASHLIB_SITE_ID, url); }
    getFilterList() { return libFilterList(SLASHLIB_GENRES); }
    getSourcePreferences() { return libSourcePreferences(); }
}
