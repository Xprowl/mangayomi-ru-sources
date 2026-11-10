// e621 — a furry image board (booru). There are no "chapters" on the site:
// every post is one picture, so a post is shown as a title with a single
// chapter holding that one image.
//
// Everything comes from the public JSON API (no login, no token, no HTML
// parsing): /posts.json for the lists and /posts/<id>.json for one post.
// Images are served from static1.e621.net, which answers HTTP/2 normally.

const E6_BASE = "https://e621.net";
const E6_PAGE_SIZE = 30;
const E6_MAX_PAGE = 750;
// e621 asks clients to identify themselves in the User-Agent.
const E6_UA = "Mangayomi-RU-Sources/1.0 (github.com/Xprowl/mangayomi-ru-sources)";

const E6_RATINGS = [
    ["Любой", ""],
    ["Safe", "rating:s"],
    ["Questionable", "rating:q"],
    ["Explicit", "rating:e"]
];

const E6_SORTS = [
    ["Новые", ""],
    ["По оценке (всё время)", "order:score"],
    ["Популярные за неделю", "order:score date:week"],
    ["Случайные", "order:random"]
];

function e6Headers() {
    return {
        "User-Agent": E6_UA,
        "Accept": "application/json"
    };
}

// "fox_hound" -> "Fox hound" (booru tags use underscores).
function e6Pretty(tag) {
    const s = String(tag || "").replace(/_/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function e6TagsQuery(query, filters) {
    const rating = (filters && filters[0] && E6_RATINGS[Number(filters[0].state) || 0]) || E6_RATINGS[0];
    const sort = (filters && filters[1] && E6_SORTS[Number(filters[1].state) || 0]) || E6_SORTS[0];
    // The site's search box: space-separated tags, plus its rating and sort
    // meta-tags.
    return [String(query || "").trim(), rating[1], sort[1]]
        .filter(x => x)
        .join(" ")
        .trim();
}

function e6ListUrl(tags, page) {
    const p = Math.max(1, Math.min(Number(page) || 1, E6_MAX_PAGE));
    // Booru tags are space separated; %20 works and keeps "-tag" exclusions.
    return E6_BASE + "/posts.json?limit=" + E6_PAGE_SIZE + "&page=" + p + "&tags=" + encodeURIComponent(tags || "");
}

function e6PostUrl(id) {
    return E6_BASE + "/posts/" + String(id || "").replace(/[^0-9]/g, "") + ".json";
}

function e6IsVideo(post) {
    const ext = String((post.file && post.file.ext) || "").toLowerCase();
    return ext === "webm" || ext === "mp4" || ext === "swf";
}

// The picture itself. Animated posts (webm) are handed over as the still
// sample, because the reader can only show images.
function e6Image(post) {
    const file = (post.file && post.file.url) || "";
    const sample = (post.sample && post.sample.url) || "";
    const preview = (post.preview && post.preview.url) || "";
    if (file && !e6IsVideo(post)) return file;
    return sample || file || preview;
}

// The card picture: the site's own small preview (30 of them per list page).
function e6Cover(post) {
    const preview = (post.preview && post.preview.url) || "";
    const sample = (post.sample && post.sample.url) || "";
    return preview || sample || e6Image(post);
}

function e6PostId(url) {
    const m = String(url || "").match(/posts\/(\d+)/);
    return m ? m[1] : String(url || "").replace(/[^0-9]/g, "");
}

function e6Title(post) {
    const tags = post.tags || {};
    const artists = (tags.artist || []).map(e6Pretty);
    const chars = (tags.character || []).map(e6Pretty);
    const species = (tags.species || []).map(e6Pretty);
    const parts = [];
    if (artists.length) parts.push(artists.slice(0, 3).join(", "));
    const subject = chars.length ? chars : species;
    if (subject.length) parts.push(subject.slice(0, 3).join(", "));
    if (!parts.length) {
        const general = (tags.general || []).slice(0, 3).map(e6Pretty);
        parts.push(general.length ? general.join(", ") : "e621");
    }
    return parts.join(" — ") + " #" + post.id;
}

function e6TagLine(post, category, limit) {
    const values = ((post.tags || {})[category] || []).map(e6Pretty);
    if (!values.length) return "";
    const shown = values.slice(0, limit || values.length);
    return shown.join(", ") + (values.length > shown.length ? " …" : "");
}

function e6Description(post) {
    const score = (post.score && post.score.total) || 0;
    const rating = { s: "Safe", q: "Questionable", e: "Explicit" }[post.rating] || post.rating || "";
    const lines = [];
    lines.push("Рейтинг: " + rating + " · Оценка: " + score + " · В избранном: " + (post.fav_count || 0) + " · Комментарии: " + (post.comment_count || 0));
    const created = String(post.created_at || "").slice(0, 10);
    if (created) lines.push("Загружен: " + created);
    const source = ((post.sources || [])[0]) || "";
    if (source) lines.push("Источник: " + source);
    lines.push("Пост: " + E6_BASE + "/posts/" + post.id);
    for (const [label, category, limit] of [
        ["Художники", "artist"],
        ["Персонажи", "character", 15],
        ["Вид", "species", 15],
        ["Серии", "copyright"],
        ["Теги", "general", 40]
    ]) {
        const line = e6TagLine(post, category, limit);
        if (line) lines.push(label + ": " + line);
    }
    return lines.join("\n");
}

function e6Genres(post) {
    const genre = [];
    const tags = post.tags || {};
    for (const [prefix, category] of [["artist", "artist"], ["character", "character"], ["species", "species"], ["copyright", "copyright"]]) {
        for (const tag of (tags[category] || []).slice(0, 6)) {
            genre.push(prefix + ": " + e6Pretty(tag));
        }
    }
    return genre.slice(0, 16);
}

function e6Tile(post) {
    return {
        name: e6Title(post),
        imageUrl: e6Cover(post),
        link: "/posts/" + post.id
    };
}
