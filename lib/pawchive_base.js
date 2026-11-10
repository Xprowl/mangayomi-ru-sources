// Pawchive — a public archive of Patreon / Pixiv Fanbox / Discord posts.
//
// The site has no chapters: a post is one publication with any number of
// attached files (pictures, videos, archives). So a post is shown as a title
// with one chapter, and the chapter's pages are the post's attached pictures.
//
// Pictures come from img.pawchive.pw. The post page links full files through
// temporary signed URLs (they expire after a few hours), so pages use the
// site's own preview pictures instead: stable links, no token, HTTP/2 fine.
//
// Plain HTML + a small JSON endpoint, no login, no cookie.

const PW_BASE = "https://pawchive.pw";
const PW_PER_PAGE = 50;
const PW_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Files the reader can show; videos, archives and documents are listed in
// the description instead of the page list.
const PW_IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const PW_VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i;

const PW_SERVICES = [
    ["Все", ""],
    ["Patreon", "patreon"],
    ["Pixiv Fanbox", "fanbox"],
    ["Discord", "discord"]
];

const PW_SOURCES = [
    ["Свежие", "latest"],
    ["Популярные", "popular"],
    ["Авторы по популярности", "artists"],
    ["Случайный пост", "random"]
];

function pwHeaders() {
    return {
        "User-Agent": PW_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
        "Referer": PW_BASE + "/"
    };
}

function pwUnescape(s) {
    return String(s || "")
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

function pwText(html) {
    return pwUnescape(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function pwServiceName(service) {
    const s = String(service || "").toLowerCase();
    if (s === "patreon") return "Patreon";
    if (s === "fanbox") return "Pixiv Fanbox";
    if (s === "discord") return "Discord";
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// A post URL is /<service>/user/<user>/post/<id>.
function pwPostPath(url) {
    const m = String(url || "").match(/\/([a-z]+)\/user\/(\d+)\/post\/(\d+)/i);
    return m ? "/" + m[1].toLowerCase() + "/user/" + m[2] + "/post/" + m[3] : "";
}

// /<service>/user/<id> — a creator.
function pwUserPath(url) {
    const m = String(url || "").match(/\/([a-z]+)\/user\/(\d+)/i);
    return m ? "/" + m[1].toLowerCase() + "/user/" + m[2] : "";
}

function pwUserId(url) {
    const m = String(url || "").match(/\/user\/(\d+)/);
    return m ? m[1] : "";
}

function pwIconHref(service, user) {
    return PW_BASE + "/icons/" + String(service || "").toLowerCase() + "/" + String(user || "");
}

// ---------------------------------------------------------------- listings

// Post cards: <article class="post-card ..." data-service="..."> with the post
// link, title, preview picture, date and file count.
function pwParsePosts(html) {
    const list = [];
    const seen = {};
    for (const block of String(html || "").split(/<article\s+class="post-card/).slice(1)) {
        const link = (block.match(/href="(\/[a-z]+\/user\/\d+\/post\/\d+)"/i) || [])[1];
        if (!link || seen[link]) continue;
        seen[link] = true;
        const title = pwText((block.match(/post-card__header">([\s\S]*?)<\/header>/) || [])[1] || "");
        const image = (block.match(/class="post-card__image"[^>]*src="([^"]+)"/) || [])[1] ||
            (block.match(/<img[^>]+src="(https:\/\/img\.pawchive\.pw\/[^"]+)"/) || [])[1] || "";
        const date = (block.match(/datetime="([^"]+)"/) || [])[1] || "";
        const files = Number(((block.match(/(\d+)\s+attachments?/) || [])[1]) || 0);
        const service = (block.match(/data-service="([^"]+)"/) || [])[1] || (link.split("/")[1] || "");
        const id = (block.match(/data-id="(\d+)"/) || [])[1] || (link.split("/").pop() || "");
        list.push({
            id: id,
            name: title || ("Пост #" + id),
            imageUrl: image,
            link: link,
            service: service,
            date: date,
            files: files
        });
    }
    return list;
}

// "Showing 1 - 50 of 24895022" -> 24895022 (0 when there is no pager).
function pwTotal(html) {
    const m = String(html || "").match(/Showing\s+[\d,]+\s*-\s*[\d,]+\s+of\s+([\d,]+)/i);
    return m ? Number(m[1].replace(/,/g, "")) || 0 : 0;
}

// ------------------------------------------------------------------- posts

// Everything the post page says about its author, title, tags and files.
function pwParsePost(html) {
    const user = (html.match(/data-user="(\d+)"/) || [])[1] || "";
    const id = (html.match(/data-id="(\d+)"/) || [])[1] || "";
    const service = (html.match(/data-service="([^"]+)"/) || [])[1] || "";
    const author = pwText((html.match(/post__user-name"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "");
    const authorLink = (html.match(/post__user-profile"[^>]*href="([^"]+)"/) || [])[1] ||
        (user ? "/" + service + "/user/" + user : "");
    const title = pwText((html.match(/post__title">([\s\S]*?)<\/h1>/) || [])[1] || "")
        .replace(/\s*\(P(atreon|ixiv Fanbox|ixiv|atreon)\)\s*$/i, "")
        .replace(/\s*\((Patreon|Fanbox|Discord)\)\s*$/i, "");
    const publishedRaw = pwText((html.match(/post__published"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/) || [])[1] || "");
    const published = (publishedRaw.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/) || [])[1] || "";
    const body = ((html.match(/class="post__content">([\s\S]*?)<h2>Files<\/h2>/) || [])[1] || "").trim();
    const tags = [];
    for (const m of html.matchAll(/href="[^"]*\/user\/\d+\/\?tag=[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
        const tag = pwText(m[1]);
        if (tag) tags.push(tag);
    }
    // Files: each thumbnail figure holds the anchor (temporary full-size link
    // + download name) and the preview picture.
    const files = [];
    const parts = String(html || "").split(/class="post__thumbnail"/).slice(1);
    for (const part of parts) {
        const href = (part.match(/class="fileThumb"[^>]*href="([^"]+)"/) || [])[1] ||
            (part.match(/href="(https:\/\/t\d+\.[^"]+)"/) || [])[1] || "";
        const download = pwUnescape((part.match(/download="([^"]+)"/) || [])[1] || "");
        const img = (part.match(/<img[^>]+src="(https:\/\/img\.pawchive\.pw\/[^"]+)"/) || [])[1] ||
            (part.match(/<img[^>]+data-src="(https:\/\/img\.pawchive\.pw\/[^"]+)"/) || [])[1] || "";
        // The file name is either the download attribute or the link's last path part.
        const name = download || (href.split("?")[0].split("/").pop() || "");
        if (!img && !href) continue;
        files.push({ name: name, thumb: img, href: href.replace(/&amp;/g, "&") });
    }
    return {
        id: id, service: service, user: user, author: author, authorLink: authorLink,
        title: title, published: published,
        body: pwText(body), tags: tags, files: files
    };
}

function pwPostDate(post) {
    const d = Date.parse(String(post.published || "").replace(" ", "T"));
    return isNaN(d) ? "" : String(d);
}
