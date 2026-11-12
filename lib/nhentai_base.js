// nhentai — a doujinshi/manga gallery site (mirror of nhentai galleries).
//
// A gallery has no chapters: it is one set of pages, so it is shown as a title
// with a single chapter. The site lists every page number in the reader URL
// (/g/<id>/<n>/), and the reader page itself names the real picture
// (iN.nhentaimg.com/<dir>/<folder>/<n>.webp), which is what the reader needs.

const NH_BASE = "https://nhentai.xxx";
const NH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const NH_PER_PAGE = 25;

const NH_LANGUAGES = [
    ["Любой", ""], ["English", "english"], ["日本語", "japanese"], ["中文", "chinese"],
    ["한국어", "korean"], ["Translated", "translated"]
];

function nhHeaders() {
    return {
        "User-Agent": NH_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        "Referer": NH_BASE + "/"
    };
}

function nhUnescape(s) {
    return String(s || "")
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&rsaquo;/g, "›").replace(/&lsaquo;/g, "‹").replace(/&raquo;/g, "»")
        .replace(/&amp;/g, "&");
}

function nhText(html) {
    return nhUnescape(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// /g/123456/ or 123456 -> the gallery path.
function nhGalleryPath(url) {
    const m = String(url || "").match(/\/g\/(\d+)/);
    return m ? "/g/" + m[1] + "/" : "";
}

function nhGalleryId(url) {
    const m = String(url || "").match(/\/g\/(\d+)/);
    return m ? m[1] : "";
}

// ---------------------------------------------------------------- listings

// Cards: <div class="gallery_item" ...><a href="/g/<id>/" title="...">
// with a lazy preview and a caption that repeats the title and page count.
function nhParseList(html) {
    const list = [];
    const seen = {};
    for (const block of String(html || "").split(/class="gallery_item"/).slice(1)) {
        const path = nhGalleryPath(([...(block.matchAll(/href="(\/g\/\d+\/)"/g))].slice(-1)[0] || [])[1] || "");
        if (!path || seen[path]) continue;
        seen[path] = true;
        const anchor = (block.match(/<a[^>]*href="\/g\/\d+\/"[^>]*>/) || [])[0] || "";
        const title = nhUnescape((anchor.match(/title="([^"]*)"/) || [])[1] || "");
        const caption = nhText((block.match(/class="caption">([\s\S]*?)<\/div>/) || [])[1] || "");
        const image = (block.match(/data-src="(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/) || [])[1] ||
            ([...(block.matchAll(/src="(https:\/\/i\d+\.nhentaimg\.com\/[^"]+)"/g))].slice(-1)[0] || [])[1] || "";
        const pages = Number(((caption.match(/\[(\d+)\s*Pages?\]/i) || [])[1]) || 0);
        // The caption begins with the author in brackets: "[Enari] [26 Pages] Title".
        const author = (caption.match(/^\[([^\]]+)\]\s*\[/) || [])[1] || "";
        list.push({
            name: title || caption,
            imageUrl: image,
            link: path,
            caption: caption,
            author: author,
            pages: pages
        });
    }
    return list;
}

// Whether the listing has a following page: the pager prints "Next" as a link.
function nhHasNext(html) {
    const m = String(html || "").match(/class='pagination'[\s\S]*?<\/ul>/);
    if (!m) return false;
    return /href='[^']*page=\d+[^']*'[^>]*>\s*Next/i.test(m[0]);
}

// ------------------------------------------------------------------ gallery

function nhGallery(html) {
    const info = String(html || "");
    const name = nhText((info.match(/<div class="info">\s*<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
    const jpName = nhText((info.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "");
    const cover = (info.match(/class="cover">[\s\S]{0,300}?<img[^>]*(?:data-src|src)="(https:\/\/[^"]+)"/) || [])[1] || "";
    const pages = Number(((info.match(/Pages:\s*<\/span>[\s\S]{0,200}?class="tag_name pages">(\d+)</) || [])[1]) || 0);
    const uploaded = (info.match(/data-utc="([^"]+)"/) || [])[1] || "";
    // Tag groups: each <li class='tags'> starts with its group name ("Tags",
    // "Artists", "Languages", "Category", "Parodies", "Characters", "Groups").
    const tags = [];
    const groups = {};
    for (const li of info.matchAll(/<li class='tags'>[\s\S]*?<span class='text'>([^<]+)<\/span>([\s\S]*?)<\/li>/g)) {
        const group = nhText(li[1]).toLowerCase();
        const values = [];
        for (const a of li[2].matchAll(/class='tag_name'>([\s\S]*?)<\/span>/g)) {
            const v = nhText(a[1]);
            if (v) values.push(v);
        }
        if (!values.length) continue;
        const ns = group === "tags" ? "tag" : group === "artists" ? "artist" :
            group === "languages" ? "language" : group === "character" ? "character" :
            group === "characters" ? "character" : group === "groups" ? "group" :
            group === "parodies" ? "parody" : group === "category" ? "category" : group;
        groups[group] = values;
        for (const v of values) tags.push(ns + ": " + v);
    }
    return {
        name: name || jpName,
        jpName: jpName,
        cover: cover,
        pages: pages,
        uploaded: uploaded,
        tags: tags,
        groups: groups
    };
}

// The reader page names the picture and the gallery's picture folder.
function nhReaderImage(html) {
    const src = String(html || "");
    const direct = (src.match(/id="fimg"[^>]*(?:data-src|src)="(https:\/\/[^"]+\.(?:webp|jpg|jpeg|png))"/) || [])[1];
    if (direct) return direct;
    // Older markup: the folder lives in hidden inputs, the page number in the URL.
    const dir = (src.match(/id="image_dir" value="([^"]+)"/) || [])[1];
    const folder = (src.match(/id="gallery_id" value="([^"]+)"/) || [])[1];
    const server = (src.match(/id="server_id" value="([^"]+)"/) || [])[1];
    const page = (src.match(/class="cr">(\d+)</) || [])[1];
    if (!dir || !folder || !page) return "";
    return "https://i" + (server || "5") + ".nhentaimg.com/" + dir + "/" + folder + "/" + page + ".webp";
}

function nhReaderPage(html) {
    const m = String(html || "").match(/class="cr">(\d+)</);
    return m ? Number(m[1]) : 0;
}

function nhTotalPages(html) {
    const m = String(html || "").match(/class="tp">(\d+)</);
    return m ? Number(m[1]) : 0;
}

// Runs fn over items with at most `limit` calls in flight; results keep order.
function nhMapLimit(items, limit, fn) {
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
