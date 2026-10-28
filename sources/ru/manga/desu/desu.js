const mangayomiSources = [{
    "name": "Desu.Me",
    "lang": "ru",
    "baseUrl": "https://desu.uno",
    "apiUrl": "https://desu.uno/api/manga",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 0,
    "isNsfw": false,
    "hasCloudflare": true,
    "version": "0.6.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/manga/desu.js",
    "notes": "Desu.me → desu.city → desu.uno. Старый /manga/api убит (410 Gone). Каталог/поиск — HTML, детали/главы/страницы — новый JSON API /api/manga/{id}."
}];

const DESU_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DESU_PAGE_SIZE = 24;

function desuFindFilter(filters, type) {
    if (!filters || !filters.length) return null;
    for (let i = 0; i < filters.length; i++) {
        const f = filters[i];
        if (f && f.type === type) return f;
    }
    return null;
}

function desuUnescape(s) {
    if (!s) return "";
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&laquo;/g, "«")
        .replace(/&raquo;/g, "»")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    // ---------- helpers ----------

    base() {
        const override = (new SharedPreferences()).get("override_base_url");
        if (override && override.trim()) return override.trim().replace(/\/+$/, "");
        return this.source.baseUrl;
    }

    abs(u) {
        if (!u) return "";
        if (u.indexOf("http") === 0) return u;
        if (u.indexOf("//") === 0) return "https:" + u;
        const b = this.base();
        return u.charAt(0) === "/" ? b + u : b + "/" + u;
    }

    apiManga(id) {
        return this.base() + "/api/manga/" + id;
    }

    get headers() {
        return {
            "User-Agent": DESU_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.8",
            "Referer": this.base() + "/manga/"
        };
    }

    get jsonHeaders() {
        return {
            "User-Agent": DESU_UA,
            "Accept": "application/json",
            "Accept-Language": "ru,en;q=0.8",
            "Referer": this.base() + "/manga/"
        };
    }

    get imageHeaders() {
        return {
            "User-Agent": DESU_UA,
            "Referer": this.base() + "/"
        };
    }

    mangaIdFromLink(link) {
        if (!link) return "";
        const m = String(link).match(/\.(\d+)\/?$/);
        if (m) return m[1];
        const m2 = String(link).match(/\/(\d+)\/?$/);
        return m2 ? m2[1] : "";
    }

    emptyDetail(name) {
        return {
            name: name || "",
            imageUrl: "",
            description: "",
            author: "",
            genre: [],
            status: 5,
            chapters: []
        };
    }

    // ---------- catalog ----------

    buildCatalogUrl(page, opts) {
        const params = ["page=" + page];
        if (opts.search) params.push("search=" + encodeURIComponent(opts.search));
        if (opts.orderBy && opts.orderBy !== "updated") params.push("order_by=" + opts.orderBy);
        if (opts.kinds && opts.kinds.length) params.push("kinds=" + opts.kinds.join(","));
        if (opts.status && opts.status.length) params.push("status=" + opts.status.join(","));
        if (opts.genres && opts.genres.length) params.push("genres=" + opts.genres.join(","));
        return this.base() + "/manga/?" + params.join("&");
    }

    async fetchCatalog(page, opts) {
        const url = this.buildCatalogUrl(page, opts || {});
        const res = await this.client.get(url, this.headers);
        if (res.statusCode !== 200) return { list: [], hasNextPage: false };
        return this.parseCatalog(res.body, page);
    }

    parseCatalog(htmlBody, page) {
        const list = [];
        let hasNextPage = false;
        try {
            const doc = new Document(htmlBody);
            const items = doc.select("div.animeList li.memberListItem");

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const a = item.selectFirst("a.avatar") || item.selectFirst("a[href*='manga/']");
                if (!a) continue;

                let href = a.attr("href") || "";
                // On desu.uno links are relative without a leading slash: "manga/slug.123/"
                if (href.indexOf("manga/") === 0) href = "/" + href;
                if (!href || href.indexOf("/manga/") < 0) continue;

                let name = "";
                const ruSpan = item.selectFirst("div.oTitle span");
                if (ruSpan) name = desuUnescape(ruSpan.text);

                if (!name) {
                    const titleEl = item.selectFirst("h3 a.animeTitle");
                    if (titleEl) name = desuUnescape(titleEl.attr("title") || titleEl.text);
                }
                if (!name) name = desuUnescape(a.attr("title") || "");
                if (!name) continue;

                let imageUrl = "";
                const coverSpan = item.selectFirst("span.img");
                if (coverSpan) {
                    const style = coverSpan.attr("style") || "";
                    const mm = style.match(/url\(['"]?([^'")]+)['"]?\)/);
                    if (mm) imageUrl = mm[1];
                }
                if (!imageUrl) {
                    const img = item.selectFirst("img");
                    if (img) imageUrl = img.attr("data-src") || img.attr("src") || "";
                }

                list.push({
                    name: name,
                    imageUrl: this.abs(imageUrl),
                    link: href
                });
            }

            const nav = doc.selectFirst("div.PageNav");
            if (nav) {
                const nextNum = String(page + 1);
                const links = nav.select("a");
                for (let j = 0; j < links.length; j++) {
                    const h = links[j].attr("href") || "";
                    const m = h.match(/[?&]page=(\d+)/);
                    if (m && m[1] === nextNum) { hasNextPage = true; break; }
                }
            } else {
                hasNextPage = list.length >= DESU_PAGE_SIZE;
            }
        } catch (e) {
            return { list: [], hasNextPage: false };
        }
        return { list: list, hasNextPage: hasNextPage };
    }

    async getPopular(page) {
        return await this.fetchCatalog(page, { orderBy: "popular" });
    }

    async getLatestUpdates(page) {
        return await this.fetchCatalog(page, { orderBy: "updated" });
    }

    async search(query, page, filters) {
        const opts = {};

        const fOrder = desuFindFilter(filters, "order");
        if (fOrder && fOrder.values && fOrder.values.length) {
            const idx = (fOrder.state && fOrder.state.index != null) ? fOrder.state.index : 0;
            const v = fOrder.values[idx] ? fOrder.values[idx].value : "";
            if (v) opts.orderBy = v;
        }

        const kinds = [];
        const fKinds = desuFindFilter(filters, "kinds");
        if (fKinds && fKinds.state) {
            for (let i = 0; i < fKinds.state.length; i++) {
                const x = fKinds.state[i];
                if (x && (x.state === true || x.state === 1)) kinds.push(x.value);
            }
        }
        if (kinds.length) opts.kinds = kinds;

        const statuses = [];
        const fStatus = desuFindFilter(filters, "status");
        if (fStatus && fStatus.state) {
            for (let i = 0; i < fStatus.state.length; i++) {
                const x = fStatus.state[i];
                if (x && (x.state === true || x.state === 1)) statuses.push(x.value);
            }
        }
        if (statuses.length) opts.status = statuses;

        const genres = [];
        const fGenres = desuFindFilter(filters, "genres");
        if (fGenres && fGenres.state) {
            for (let i = 0; i < fGenres.state.length; i++) {
                const x = fGenres.state[i];
                if (!x) continue;
                if (x.state === true || x.state === 1) {
                    genres.push(x.value);
                } else if (x.state === 2) {
                    genres.push(String(x.value).replace("-", "-!"));
                }
            }
        }
        if (genres.length) opts.genres = genres;

        if (query && query.trim()) opts.search = query.trim();

        return await this.fetchCatalog(page, opts);
    }

    // ---------- detail ----------

    async getDetail(link) {
        const id = this.mangaIdFromLink(link);
        if (!id) return this.emptyDetail(link);

        const res = await this.client.get(this.apiManga(id), this.jsonHeaders);
        if (res.statusCode !== 200) return this.emptyDetail(link);

        let m = {};
        try {
            const parsed = JSON.parse(res.body);
            m = (parsed && parsed.manga) || {};
        } catch (e) {
            return this.emptyDetail(link);
        }

        // chapters
        const chapters = [];
        const cRes = await this.client.get(this.apiManga(id) + "/chapters", this.jsonHeaders);
        if (cRes.statusCode === 200) {
            try {
                const parsed = JSON.parse(cRes.body);
                const arr = (parsed && parsed.chapters) || [];
                for (let i = 0; i < arr.length; i++) {
                    const c = arr[i];
                    if (!c || c.is_readable === false) continue;
                    const volPart = (c.volume && c.volume !== "0" && c.volume !== 0) ? " (т. " + c.volume + ")" : "";
                    const titlePart = c.title ? ": " + c.title : "";
                    chapters.push({
                        name: "Глава " + c.number + titlePart + volPart,
                        url: this.apiManga(id) + "/chapters/" + c.id,
                        dateUpload: c.publish_date ? String(c.publish_date * 1000) : String(Date.now()),
                        scanlator: null
                    });
                }
            } catch (e) { /* ignore broken chapters json */ }
        }

        // genres
        const genre = [];
        if (m.genres && m.genres.length) {
            for (let i = 0; i < m.genres.length; i++) {
                const g = m.genres[i];
                const gname = g ? (g.name || g.russian || "") : "";
                if (gname && genre.indexOf(gname) < 0) genre.push(gname);
            }
        }

        // authors
        let author = "";
        if (m.authors && m.authors.length) {
            const names = [];
            for (let i = 0; i < m.authors.length; i++) {
                const a = m.authors[i];
                const aname = a ? (a.name || "") : "";
                if (aname) names.push(aname);
            }
            author = names.join(", ");
        }

        // status
        const statusMap = { "ongoing": 0, "released": 1, "copyrighted": 3, "anons": 4 };
        let status = 5;
        if (m.status && statusMap[m.status] != null) status = statusMap[m.status];

        let imageUrl = "";
        if (m.cover) imageUrl = m.cover.preview || m.cover.original || m.cover.x120 || m.cover.snippet || "";

        return {
            name: desuUnescape(m.russian || m.name || ""),
            imageUrl: this.abs(imageUrl),
            description: m.description || "",
            author: author,
            genre: genre,
            status: status,
            chapters: chapters
        };
    }

    // ---------- pages ----------

    async getPageList(url) {
        if (!url) return [];

        let apiUrl = url;
        // Backward compatibility: derive the API endpoint from a classic reader URL
        if (apiUrl.indexOf("/api/manga/") < 0) {
            const m = String(apiUrl).match(/(?:^|\/)(?:manga|ranobe)\/[^\/]+\.(\d+)\/.*?\/(?:ch|chapter)(\d+)/i);
            if (m) apiUrl = this.apiManga(m[1]) + "/chapters/" + m[2];
        }

        const res = await this.client.get(apiUrl, this.jsonHeaders);
        if (res.statusCode !== 200) return [];

        let pages = [];
        try {
            const parsed = JSON.parse(res.body);
            const ch = (parsed && parsed.chapter) || {};
            pages = ch.pages || [];
        } catch (e) {
            return [];
        }

        const out = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const u = (typeof p === "string") ? p : (p && p.url ? p.url : "");
            if (u) out.push({ url: this.abs(u), headers: this.imageHeaders });
        }
        return out;
    }

    // ---------- filters ----------

    getFilterList() {
        return [
            {
                type_name: "SelectFilter",
                type: "order",
                name: "Сортировка",
                state: 0,
                values: [
                    ["По популярности", "popular"],
                    ["По обновлению", "updated"],
                    ["По алфавиту", "name"],
                    ["По добавлению", "id"]
                ].map(function (x) { return { type_name: "SelectOption", name: x[0], value: x[1] }; })
            },
            {
                type_name: "GroupFilter",
                type: "kinds",
                name: "Тип",
                state: [
                    ["Манга", "manga"],
                    ["Манхва", "manhwa"],
                    ["Маньхуа", "manhua"],
                    ["Ваншот", "one_shot"],
                    ["Комикс", "comics"]
                ].map(function (x) { return { type_name: "CheckBox", name: x[0], value: x[1] }; })
            },
            {
                type_name: "GroupFilter",
                type: "status",
                name: "Статус",
                state: [
                    ["Выходит", "ongoing"],
                    ["Издано", "released"],
                    ["Переводится", "continued"],
                    ["Завершено", "completed"],
                    ["Без 18+", "no18plus"]
                ].map(function (x) { return { type_name: "CheckBox", name: x[0], value: x[1] }; })
            },
            {
                type_name: "GroupFilter",
                type: "genres",
                name: "Жанры",
                state: [
                    ["Безумие", "90-Dementia"],
                    ["Боевые искусства", "66-Martial Arts"],
                    ["В цвете", "70-Color"],
                    ["Вампиры", "64-Vampire"],
                    ["Веб", "84-Web"],
                    ["Гарем", "71-Harem"],
                    ["Героическое фэнтези", "92-Heroic Fantasy"],
                    ["Демоны", "72-Demons"],
                    ["Детектив", "46-Mystery"],
                    ["Дзёсей", "87-Josei"],
                    ["Драма", "50-Drama"],
                    ["Ёнкома", "95-Yonkoma"],
                    ["Игры", "79-Game"],
                    ["Исекай", "89-Isekai"],
                    ["Исторический", "69-Historical"],
                    ["Комедия", "49-Comedy"],
                    ["Космос", "85-Space"],
                    ["ЛитRPG", "77-LitRPG"],
                    ["Магия", "58-Magic"],
                    ["Меха", "83-Mecha"],
                    ["Мистика", "61-Mystic"],
                    ["Музыка", "78-Music"],
                    ["Научная фантастика", "96-Sci-Fi"],
                    ["Пародия", "86-Parody"],
                    ["Повседневность", "54-Slice of Life"],
                    ["Постапокалиптика", "93-Post Apocalyptic"],
                    ["Приключения", "68-Adventure"],
                    ["Психологическое", "67-Psychological"],
                    ["Романтика", "62-Romance"],
                    ["Самураи", "88-Samurai"],
                    ["Сверхъестественное", "48-Supernatural"],
                    ["Сёдзе", "63-Shoujo"],
                    ["Сейнен", "52-Seinen"],
                    ["Сёнен", "47-Shounen"],
                    ["Спорт", "76-Sports"],
                    ["Супер сила", "82-Super Power"],
                    ["Трагедия", "91-Tragedy"],
                    ["Триллер", "81-Thriller"],
                    ["Ужасы", "80-Horror"],
                    ["Фантастика", "53-Fiction"],
                    ["Фэнтези", "57-Fantasy"],
                    ["Хентай", "59-Hentai"],
                    ["Школа", "60-School"],
                    ["Экшен", "56-Action"],
                    ["Этти", "51-Ecchi"],
                    ["Азартные игры", "142-Gambling"],
                    ["Алхимия", "143-Alchemy"],
                    ["Ангелы", "145-Angels"],
                    ["Антигерой", "146-Anti-hero"],
                    ["Антиутопия", "147-Dystopia"],
                    ["Апокалипсис", "148-Apocalypse"],
                    ["Аристократия", "243-Aristocracy"],
                    ["Армия", "149-Army"],
                    ["Артефакты", "150-Artifacts"],
                    ["Боги", "151-Gods"],
                    ["Бои на мечах", "152-Sword Fighting"],
                    ["Борьба за власть", "153-Power Struggle"],
                    ["Брат и сестра", "154-Brother and Sister"],
                    ["Будущее", "155-Future"],
                    ["Ведьма", "156-Witch"],
                    ["Вестерн", "157-Western"],
                    ["Видеоигры", "158-Video Games"],
                    ["Виртуальная реальность", "159-Virtual Reality"],
                    ["Владыка демонов", "160-Demon Lord"],
                    ["Военные", "161-Military"],
                    ["Война", "162-War"],
                    ["Волшебники / маги", "163-Wizards / Mages"],
                    ["Волшебные существа", "164-Magical Creatures"],
                    ["Воспоминания из другого мира", "165-Memories from Another World"],
                    ["Выживание", "166-Survival"],
                    ["ГГ женщина", "167-Female MC"],
                    ["ГГ имба", "168-IMBA MC"],
                    ["ГГ мужчина", "169-Male MC"],
                    ["Геймеры", "170-Gamers"],
                    ["Гильдии", "171-Guilds"],
                    ["Глупый ГГ", "172-Stupid MC"],
                    ["Гоблины", "173-Goblins"],
                    ["Горничные", "174-Maids"],
                    ["Гяру", "176-Gyaru"],
                    ["Драконы", "177-Dragons"],
                    ["Дружба", "178-Friendship"],
                    ["Жестокий мир", "179-Cruel World"],
                    ["Животные компаньоны", "180-Animal Companions"],
                    ["Завоевание мира", "181-World Conquest"],
                    ["Зверолюди", "182-Beastmen"],
                    ["Злые духи", "183-Evil Spirits"],
                    ["Зомби", "184-Zombies"],
                    ["Игровые элементы", "185-Gaming elements"],
                    ["Империи", "186-Empires"],
                    ["Квесты", "188-Quests"],
                    ["Кулинария", "189-Cooking"],
                    ["Культивирование", "190-Cultivation"],
                    ["Легендарное оружие", "191-Legendary weapons"],
                    ["Магическая академия", "193-Magic academy"],
                    ["Мафия", "194-Mafia"],
                    ["Медицина", "195-Medicine"],
                    ["Месть", "196-Revenge"],
                    ["Моли", "192-Moli"],
                    ["Монстродевушки", "197-Monster girls"],
                    ["Монстры", "198-Monsters"],
                    ["Мурим", "199-Murim"],
                    ["Навыки / способности", "200-Skills / abilities"],
                    ["Наёмники", "201-Mercenaries"],
                    ["Насилие / жестокость", "202-Violence / cruelty"],
                    ["Нежить", "203-Undead"],
                    ["Ниндзя", "204-Ninja"],
                    ["Обмен телами", "205-Body swap"],
                    ["Обратный Гарем", "206-Reverse Harem"],
                    ["Огнестрельное оружие", "207-Firearms"],
                    ["Офисные Работники", "208-Office workers"],
                    ["Пираты", "209-Pirates"],
                    ["Подземелья", "210-Dungeons"],
                    ["Политика", "211-Politics"],
                    ["Полиция", "212-Police"],
                    ["Полноцветный", "214-Full color"],
                    ["Путешествие во времени", "217-Time travel"],
                    ["Рабы", "218-Slaves"],
                    ["Разумные расы", "219-Sentient races"],
                    ["Ранги силы", "220-Power ranks"],
                    ["Реинкарнация", "221-Reincarnation"],
                    ["Роботы", "222-Robots"],
                    ["Рыцари", "223-Knights"],
                    ["Система", "225-System"],
                    ["Скрытие личности", "226-Identity hiding"],
                    ["Спасение мира", "227-Saving the world"],
                    ["Спортивное тело", "228-Sports body"],
                    ["Средневековье", "229-Middle Ages"],
                    ["Стимпанк", "230-Steampunk"],
                    ["Супергерои", "231-Superheroes"],
                    ["Традиционные игры", "232-Traditional games"],
                    ["Умный ГГ", "233-Smart GG"],
                    ["Учитель", "234-Teacher"],
                    ["Философия", "235-Philosophy"],
                    ["Хикикомори", "236-Hikikomori"],
                    ["Холодное оружие", "237-Cold weapons"],
                    ["Шантаж", "238-Blackmail"],
                    ["Эльфы", "239-Elves"],
                    ["Якудза", "240-Yakuza"],
                    ["Яндере", "241-Yandere"],
                    ["Япония", "242-Japan"]
                ].map(function (x) { return { type_name: "CheckBox", name: x[0], value: x[1] }; })
            }
        ];
    }

    getSourcePreferences() {
        return [{
            key: "override_base_url",
            editTextPreference: {
                title: "Переопределить baseUrl",
                summary: "Альтернативный mirror при блокировке desu.uno (desu.city/desu.me редиректят сюда).",
                value: "",
                dialogTitle: "Base URL",
                dialogMessage: "Без слэша в конце"
            }
        }];
    }
}
