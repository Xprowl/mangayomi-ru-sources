// E-Hentai — galleries from e-hentai.org, including Russian translations.
//
// A gallery has no chapters: it is one set of pages, so it is listed as a
// title with a single chapter. The pages are the site's reader URLs
// (/s/<hash>/<id>-<n>): each answers with the real image address.
//
// The site lists a gallery's reader URLs in batches of 20 (?p=0, ?p=1, …), and
// those batch pages are cheap. Each reader page then has to be read once for
// its image address; that is done a few requests at a time and cached for the
// session, so the whole page list arrives in one go and reopening is instant.
//
// Plain HTML, no login, no token, no cookie.

const EH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EH_BASE = "https://e-hentai.org";
const EH_LANGS = ["", "english", "chinese", "japanese", "korean", "russian", "translated"];
const EH_CONCURRENCY = 6;
const EH_MAX_PAGES = 400;

function ehHeaders() {
    return {
        "User-Agent": EH_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        // The image CDN (ehgt.org / *.hath.network) answers browsers; a site
        // referer makes sure it also answers when the app sends its own.
        "Referer": EH_BASE + "/"
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
    // The site's category bits (the search form's own values). Checked boxes
    // are the categories to keep; unchecked ones are left out.
    const cats = [
        ["Doujinshi", 2], ["Manga", 4], ["Artist CG", 8], ["Game CG", 16],
        ["Western", 512], ["Non-H", 256], ["Image Set", 32], ["Cosplay", 64],
        ["Asian Porn", 128], ["Misc", 1]
    ];
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
            state: cats.map(x => ({ type_name: "CheckBox", name: x[0], value: String(x[1]) }))
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

// f_cats is the mask of the categories the search leaves out; with none
// ticked it stays empty (the site then shows everything).
function ehCategoryMask(filters) {
    const group = (filters && filters[1]) || null;
    if (!group || !Array.isArray(group.state)) return "";
    let selected = 0;
    let any = false;
    for (const box of group.state) {
        if (!box || box.state !== true) continue;
        any = true;
        selected += Number(box.value) || 0;
    }
    if (!any) return "";
    const mask = 1023 - selected;
    return mask > 0 ? String(mask) : "";
}

function ehListUrl(q, next, cats) {
    // The result set is addressed by its "next" token: 0 starts it over, and
    // every listing page answers with the token of the following one. A bare
    // ?page=N would just repeat page 1.
    const token = next === null || next === undefined || next === "" ? 0 : next;
    return EH_BASE + "/?f_search=" + encodeURIComponent(q) + "&f_cats=" + (cats || 0) + "&next=" + encodeURIComponent(token);
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
    // The popular page is the same grid as search results, so the usual tile
    // parser gets its covers too; this fallback only reads links and names.
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

// Reader URLs from a gallery page (?p=0, ?p=1, …): the site lists the pages
// in batches of 20 with their thumbnails. Sorted by page number, duplicates
// dropped, so a gallery's whole page list is a handful of requests.
function ehReaderPages(html) {
    const seen = {};
    const list = [];
    for (const m of String(html || "").matchAll(/<a href="(https:\/\/e-hentai\.org\/s\/[^"]+)"/g)) {
        const url = ehUnescape(m[1]);
        if (!url || seen[url]) continue;
        seen[url] = true;
        list.push(url);
    }
    return list.sort((a, b) => ehPageNumber(a) - ehPageNumber(b));
}

// Runs fn over items with at most `limit` calls in flight; results keep order.
function ehMapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let index = 0;
    const worker = async () => {
        while (index < items.length) {
            const i = index++;
            out[i] = await fn(items[i], i);
        }
    };
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
    return Promise.all(workers).then(() => out);
}

// The gallery's page-batch listings: "<gallery>/?p=0" shows pages 1–20, and
// so on. Used to collect every reader URL without following 20 next links.
function ehGalleryListingUrl(galleryUrl, p) {
    return String(galleryUrl || "").replace(/\/$/, "") + "/?p=" + (p || 0);
}

function ehUniqueUrls(list) {
    const seen = {};
    return list.filter(u => (u && !seen[u] ? (seen[u] = true) : false));
}
