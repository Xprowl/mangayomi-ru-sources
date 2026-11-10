// E-Hentai — galleries from e-hentai.org, including Russian translations.
//
// A gallery has no chapters: it is one set of pages, so it is listed as a
// title with a single chapter. The pages are the site's reader URLs
// (/s/<hash>/<id>-<n>): each answers with the real image address.
//
// E-Hentai throttles like a gallery reader does — a few pages per second — so
// nothing here probes the site page by page in bulk. The reader pages asked
// for are the ones the app is about to show (see getPageList); they are
// resolved in parallel, two at a time, and cached for the session.
//
// Plain HTML, no login, no token, no cookie.

const EH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EH_BASE = "https://e-hentai.org";
const EH_LANGS = ["", "english", "chinese", "japanese", "korean", "russian", "translated"];
const EH_CONCURRENCY = 2;
const EH_MAX_PAGES = 400;

function ehHeaders() {
    return {
        "User-Agent": EH_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8"
    };
}

function ehUnescape(s) {
    return String(s || "")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function ehText(html) {
    return ehUnescape(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ filters

function ehFilterList() {
    const cats = ["Doujinshi", "Manga", "Artist CG", "Game CG", "Western", "Non-H", "Image Set", "Cosplay", "Asian Porn", "Misc"];
    return [
        {
            type_name: "SelectFilter",
            type: "language",
            name: "Язык (тег language)",
            state: 5,
            values: ["Любой"].concat(EH_LANGS.slice(1).map(x => x.charAt(0).toUpperCase() + x.slice(1)))
                .map((name, i) => ({ type_name: "SelectOption", name: name, value: String(i) }))
        },
        {
            type_name: "GroupFilter",
            type: "cats",
            name: "Категории",
            state: cats.map(name => ({ type_name: "CheckBox", name: name, value: "0" }))
        },
        {
            type_name: "GroupFilter",
            type: "flags",
            name: "Дополнительно",
            state: [{ type_name: "CheckBox", name: "Только переведённые", value: "0" }]
        },
        {
            type_name: "SortFilter",
            type: "sort",
            name: "Сортировка",
            state: { type_name: "SortState", index: 0, ascending: false },
            values: [
                ["По дате добавления", "posted"],
                ["По популярности", "popular"]
            ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
        }
    ];
}

function ehQuery(query, filters) {
    const parts = [];
    const langFilter = (filters && filters[0]) || null;
    const lang = langFilter && langFilter.state !== undefined ? Number(langFilter.state) : 5;
    if (lang > 0 && lang < EH_LANGS.length) parts.push("language:" + EH_LANGS[lang]);
    const flags = (filters && filters[2]) || null;
    if (flags && Array.isArray(flags.state) && flags.state[0] && flags.state[0].state === true) {
        parts.push("language:translated");
    }
    const text = String(query || "").trim();
    if (text) parts.push(text);
    return parts.join(" ").trim();
}

function ehPopularSort(filters) {
    const sort = (filters && filters[3]) || null;
    return !!(sort && sort.state && sort.state.index === 1);
}

function ehListUrl(q, page) {
    // next=0 asks the site to start from the beginning of that search; ?page=
    // asks for the follow-up page of the same result set.
    return EH_BASE + "/?f_search=" + encodeURIComponent(q) + "&f_cats=1023&next=0&page=" + (page || 1);
}

// ---------------------------------------------------------------- listings

function ehThumb(block) {
    const lazy = block.match(/<img[^>]+data-src="(https:\/\/[^"]+)"/);
    if (lazy) return lazy[1];
    const near = block.match(/id="it\d+"[\s\S]{0,900}?<img[^>]+src="(https:\/\/[^"]+\.(?:webp|jpg|jpeg|png))"/);
    return near ? near[1] : "";
}

function ehTile(block) {
    const link = (block.match(/href="(https:\/\/e-hentai\.org\/g\/[^"]+)"/) || [])[1];
    const name = (block.match(/<div class="glink">([\s\S]*?)<\/div>/) || [])[1];
    if (!link || !name) return null;
    const category = ehText((block.match(/<div class="cn ct[a-z0-9]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "");
    return { name: ehText(name), imageUrl: ehThumb(block), link: link.replace(EH_BASE, ""), category: category };
}

function ehUnique(list) {
    const seen = {};
    return list.filter(x => (seen[x.link] ? false : (seen[x.link] = true)));
}

function ehParseList(html) {
    const list = [];
    for (const block of String(html || "").split('<td class="gl2c">').slice(1)) {
        const tile = ehTile(block);
        if (tile) list.push(tile);
    }
    return ehUnique(list);
}

function ehParsePopular(html) {
    const list = [];
    for (const m of String(html || "").matchAll(/<a href="(https:\/\/e-hentai\.org\/g\/[^"]+)"[^>]*>\s*<div class="glink">([\s\S]*?)<\/div>/g)) {
        list.push({ name: ehText(m[2]), imageUrl: "", link: m[1].replace(EH_BASE, "") });
    }
    return ehUnique(list);
}

// Token for the following listing page: the site prints it as the href of
// its own "next" pager link.
function ehNextToken(html) {
    const m = String(html || "").match(/id="dnext"[^>]*href="([^"]+)"/);
    if (!m) return "";
    const token = m[1].replace(/&amp;/g, "&").match(/[?&]next=([^&"]+)/);
    return token ? token[1] : "";
}

// ------------------------------------------------------------------ gallery

function ehGallery(html) {
    const name = ehText((html.match(/<h1[^>]*id="gn"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
    const jpName = ehText((html.match(/<h1[^>]*id="gj"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
    // The cover is the gd1 panel's background image (or a plain img there on
    // older layouts); gdt is only the thumbnail strip, not the title's cover.
    // The cover is the gd1 panel background image; older layouts put a plain
    // img there instead. gdt is the thumbnail strip, not the title cover.
    const cover = (html.match(/<div id="gd1"[\s\S]{0,400}?url\((https:\/\/[^)]+)\)/) || [])[1] ||
        (html.match(/<div id="gd1"[\s\S]{0,600}?<img[^>]+src="(https:\/\/[^"]+)"/) || [])[1] || "";
    const pages = Number(((html.match(/Length:[\s\S]{0,160}?(\d+)\s+pages/) || [])[1]) || 0);
    const firstPage = (html.match(/href="(https:\/\/e-hentai\.org\/s\/[^"]+)"/) || [])[1] || "";
    const tags = [];
    for (const m of html.matchAll(/id="td_([a-z]+):[a-z0-9_' ]+"[^>]*>[\s\S]{0,300}?<a [^>]*>([\s\S]*?)<\/a>/g)) {
        const value = ehText(m[2]).split("|")[0].trim();
        if (value) tags.push(m[1] + ": " + value);
    }
    const category = ehText((html.match(/<td class="gdt1">Category:<\/td><td class="gdt2">([\s\S]*?)<\/td>/) || [])[1] || "");
    return { name: name || jpName, jpName: jpName, cover: cover, pages: pages, firstPage: firstPage, tags: tags, category: category };
}

function ehPageImage(html) {
    const m = html.match(/<img id="img"[^>]*src="([^"]+)"/);
    return m ? ehUnescape(m[1]) : "";
}

function ehPageNext(html) {
    const m = html.match(/<a id="next"[^>]*href="([^"]+)"/);
    return m ? ehUnescape(m[1]) : "";
}

function ehPageNumber(url) {
    const m = String(url || "").match(/\/s\/[0-9a-f]+\/(\d+)-(\d+)/);
    return m ? Number(m[2]) : 0;
}

function ehGalleryKey(url) {
    const m = String(url || "").match(/\/g\/(\d+)\/([0-9a-f]+)/);
    return m ? m[1] + "/" + m[2] : "";
}
