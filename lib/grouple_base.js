// === grouple_base.js ===
// Shared helpers for Grouple-engine sites: ReadManga, MintManga, SelfManga,
// AllHentai, Usagi, SeiManga, ZazaZa. They all share one HTML template.
// Usage: this file is prepended to each Grouple extension at build time
// (via `// @include: grouple_base` directive in the source file).
//
// Pagination is offset-based with step 70.

const GROUPLE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GROUPLE_PAGE_SIZE = 50;

function groupleHeaders(baseUrl) {
    // Referer must be set to google.com for the HTML pages; mirror domains 403
    // requests from unknown referers. Images are the opposite (see below).
    const h = {
        "User-Agent": GROUPLE_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Referer": "https://www.google.com/"
    };
    // Optional session cookie — Grouple sites serve /static/deleted1.png
    // placeholders for removed chapters and for some adult titles.
    // Paste full cookie string from DevTools → Application → Cookies.
    const cookie = (new SharedPreferences()).get("grouple_session_cookie");
    if (cookie && cookie.trim()) h["Cookie"] = cookie.trim();
    return h;
}

// The image CDNs (zz./sm./gr.one-way.work) reject hotlinks: with a google
// Referer or no Referer at all they answer 403, which is why MintManga covers
// and page images stayed blank. They do accept the site itself as Referer, so
// image requests use a separate header set. This is also what Mangayomi gets
// from getHeaders() when it loads covers before any request is made.
function groupleImageHeaders(baseUrl) {
    const h = groupleHeaders(baseUrl);
    h["Referer"] = String(baseUrl || "").replace(/\/+$/, "") + "/";
    h["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
    delete h["Accept-Language"];
    return h;
}

// Old MintManga library entries still point at the dead WordPress mirrors
// (mintmanga.one / *.mintmanga.com / .me). The app stores absolute chapter
// and title URLs, so rewriting only baseUrl does not help those. ReadManga
// library entries can also point at a mirror the numbered reader has
// replaced (e.g. readmanga.live) while the catalog still answers from it.
// Re-point any such host at the current base or the reader mirror.
function groupleRewriteHost(baseUrl, url) {
    const u = String(url || "");
    const m = u.match(/^https?:\/\/([^\/?#]+)([\s\S]*)$/i);
    if (!m) return u;
    const host = m[1].toLowerCase().replace(/:\d+$/, "");
    const path = m[2] || "/";
    if (/^(?:(?:www|[0-9]+)\.)?mintmanga\.(?:one|com|me)$/.test(host)) {
        return String(baseUrl || "").replace(/\/+$/, "") + path;
    }
    // Only chapter URLs are moved to the mirror; title and catalog pages
    // already work from the canonical host the app stored.
    const mirror = groupleMirrorHost(baseUrl);
    if (mirror && /\/(?:vol\d+|ch)\/[^\/?#]+/.test(path) && groupleHost(u) !== groupleHost(baseUrl)) {
        return groupleUrlOn(mirror, path);
    }
    return u;
}

function groupleAbs(baseUrl, u) {
    if (!u) return "";
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return baseUrl + u;
    if (u.startsWith("http")) return u;
    return baseUrl + "/" + u;
}

// Grouple answers its adult (18+) age gate with the `mtr` query parameter.
// Requested without it, a chapter of a mature title returns the age warning
// instead of the reader (there is no `readerInit` in the response), so the app
// shows an empty chapter even though the title page itself is fine. Old saved
// chapters, "next chapter" links and deep links can arrive without the flag,
// so every reader URL is normalised here instead of only in getDetail.
function groupleChapterUrl(url) {
    const clean = String(url || "").split("#")[0];
    const q = clean.indexOf("?");
    const path = q >= 0 ? clean.slice(0, q) : clean;
    const params = (q >= 0 ? clean.slice(q + 1).split("&") : [])
        .filter(p => p && !/^mtr=/i.test(p));
    params.push("mtr=1");
    return path + "?" + params.join("&");
}

function groupleParseDate(text) {
    if (!text) return Date.now();
    const t = text.toLowerCase();
    const now = new Date();
    if (t.includes("сегодня")) return now.getTime();
    if (t.includes("вчера")) return now.getTime() - 86400000;
    // DD.MM.YY or DD.MM.YYYY
    const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) {
        let y = parseInt(m[3]);
        if (y < 100) y += 2000;
        return new Date(y, parseInt(m[2]) - 1, parseInt(m[1])).getTime();
    }
    return Date.now();
}

function groupleStatus(text) {
    if (!text) return 5;
    const t = text.toLowerCase();
    if (t.includes("продолжается") || t.includes("выходит") || t.includes("онгоинг")) return 0;
    if (t.includes("лицензирова") || t.includes("завершен") || t.includes("завершён")) return 1;
    if (t.includes("заморожен") || t.includes("приостанов")) return 2;
    if (t.includes("прекращ") || t.includes("брошен")) return 3;
    return 5;
}

// Parse a catalog/search listing page. Returns {list, hasNextPage}.
// Selectors come from Grouple template (stable for >5 years across mirrors).
function groupleParseList(htmlBody, baseUrl) {
    const doc = new Document(htmlBody);
    // Selector is just "div.tile" (the card also has .col-sm-6 and el_NNN but base class is tile)
    const tiles = doc.select("div.tile");
    const list = [];
    for (const tile of tiles) {
        const linkEl = tile.selectFirst("div.img a.non-hover") || tile.selectFirst("div.img a") || tile.selectFirst("h3 a");
        if (!linkEl) continue;
        const link = linkEl.attr("href");
        if (!link) continue;
        // Image — prefer data-original (lazy), fall back to src/data-src/original
        const imgEl = tile.selectFirst("div.img img") || tile.selectFirst("img");
        let imageUrl = "";
        let imgTitle = "";
        if (imgEl) {
            imageUrl = imgEl.attr("data-original") || imgEl.attr("original") || imgEl.attr("data-src") || imgEl.attr("src") || "";
            imgTitle = (imgEl.attr("title") || "").trim();
            if (imageUrl) {
                imageUrl = imageUrl.startsWith("//") ? "https:" + imageUrl : groupleAbs(baseUrl, imageUrl);
            }
        }
        // Title — prefer img[title], then h3 a title/text, then linkEl
        let name = imgTitle;
        if (!name) {
            const h3a = tile.selectFirst("h3 a");
            if (h3a) name = (h3a.attr("title") || h3a.text || "").trim();
        }
        if (!name) name = (linkEl.attr("title") || linkEl.text || "").trim();
        if (!name) continue;

        list.push({
            name: name,
            imageUrl: imageUrl,
            link: link.startsWith("http") ? link.replace(baseUrl, "") : link
        });
    }
    const hasNextPage = tiles.length >= GROUPLE_PAGE_SIZE;
    return { list: list, hasNextPage: hasNextPage };
}

// Build catalog URL with sorting + offset
function groupleListUrl(baseUrl, sort, page) {
    const offset = (page - 1) * GROUPLE_PAGE_SIZE;
    return `${baseUrl}/list?sortType=${sort}&offset=${offset}`;
}

async function groupleGetDetail(client, baseUrl, link) {
    const res = await client.get(groupleAbs(baseUrl, groupleRewriteHost(baseUrl, link)), groupleHeaders(baseUrl));
    const doc = new Document(res.body);

    // Title — new 2026 layout uses cr-hero-names__main (fallback to legacy h1.names for usagi.one-style mirrors)
    const nameEl = doc.selectFirst("h1.cr-hero-names__main")
                || doc.selectFirst("h1.names span.name")
                || doc.selectFirst("span.name")
                || doc.selectFirst("h1.names")
                || doc.selectFirst("h1");
    const name = nameEl ? nameEl.text.trim() : "";

    // Chapters are parsed first: an empty list must be told apart from a page
    // that failed to load, and the description follows the same notice cleanup.
    const chapters = groupleMergeChapters(
        groupleParseChapters(doc, baseUrl),
        groupleParseChaptersFromBody(res.body, baseUrl)
    );
    const brokenTitle = !name && !chapters.length;
    // A chapter-less title is not a dead title, so nothing below depends on
    // `chapters` being non-empty.

    // Cover — cr-hero-poster__img (new) or picture-fotorama (legacy)
    let imageUrl = "";
    const picImg = doc.selectFirst("img.cr-hero-poster__img")
                || doc.selectFirst("div.picture-fotorama img")
                || doc.selectFirst("img.manga-cover");
    if (picImg) {
        imageUrl = picImg.attr("data-src") || picImg.attr("data-full") || picImg.attr("data-thumb") || picImg.attr("src") || "";
        if (imageUrl && !imageUrl.startsWith("http")) {
            imageUrl = imageUrl.startsWith("//") ? "https:" + imageUrl : groupleAbs(baseUrl, imageUrl);
        }
    }

    // Description
    let description = "";
    const metaDesc = doc.selectFirst("meta[itemprop=description]");
    if (metaDesc) description = (metaDesc.attr("content") || "").trim();
    if (!description) {
        const d = doc.selectFirst("div.cr-description__content") || doc.selectFirst("div.manga-description");
        if (d) description = d.text.trim();
    }

    // Author / artist / genre — new layout uses /list/person/ and /list/category/
    // (legacy layout used span.elem_author a.person-link + a.element-link)
    let persons = doc.select("a[href*='/list/person/']").map(e => e.text.replace(/\s+/g, " ").trim()).filter(x => x);
    // Dedup + drop entries that look like ratings/inflated text
    const seenPersons = {};
    persons = persons.filter(p => {
        if (seenPersons[p]) return false;
        seenPersons[p] = true;
        // Keep only short-ish names (real author names are <60 chars)
        return p.length < 60 && !/\d/.test(p);
    });
    const author = persons.length ? persons.join(", ")
        : doc.select("span.elem_author a.person-link, span.elem_screenwriter a.person-link").map(e => e.text.trim()).filter(x => x).join(", ");
    const artist = doc.select("span.elem_illustrator a.person-link").map(e => e.text.trim()).filter(x => x).join(", ");

    // The age gate is answered by the server, but the page still ships its
    // "blocked for anonymous / need a year" banners; keep them out of the
    // description people read.
    const notices = doc.select("[data-ui-view-hide*='blocked'], .mtr-message, .age-restricted-notice");
    for (let i = 0; i < notices.length; i++) {
        const notice = (notices[i].text || "").replace(/\s+/g, " ").trim();
        if (notice && notice.length < 400) description = description.split(notice).join("");
    }
    description = description.replace(/\s+/g, " ").trim();

    let genre = doc.select("a[href*='/list/category/']").map(e => e.text.trim()).filter(x => x);
    if (!genre.length) {
        genre = doc.select("span.elem_genre a.element-link, span.elem_tag a.element-link")
            .map(e => e.text.trim()).filter(x => x);
    }
    // Add genres from legacy /list/genre if present
    const legacyGenres = doc.select("a[href*='/list/genre/']").map(e => e.text.trim()).filter(x => x);
    for (const g of legacyGenres) if (genre.indexOf(g) < 0) genre.push(g);

    // Status — cr-info-details-item__status (new) or p.subject-meta text (legacy)
    let statusText = "";
    const statusEl = doc.selectFirst(".cr-info-details-item__status");
    if (statusEl) statusText = statusEl.text || "";
    if (!statusText) {
        const metas = doc.select("p.subject-meta");
        for (const m of metas) {
            const txt = m.text;
            if (txt && txt.indexOf("Статус тайтла") >= 0) { statusText = txt; break; }
        }
        if (!statusText) {
            const anyMeta = doc.selectFirst(".subject-meta");
            if (anyMeta) statusText = anyMeta.text || "";
        }
    }
    const status = groupleStatus(statusText);

    // A page with neither a title nor a chapter table is not a title with no
    // chapters: the site answered with a block page ("Тебе сюда нельзя") or a
    // 404. Reporting an empty title as working hides that. A title with a name
    // but no chapters yet is legitimate.
    if (brokenTitle) {
        throw new Error("Grouple: страница тайтла не загрузилась (блокировка или 404)");
    }

    return {
        name: name,
        imageUrl: imageUrl,
        description: description,
        author: author,
        artist: artist,
        status: status,
        genre: genre,
        chapters: chapters
    };
}

// Chapters — new layout: tr.item-row > td.item-title > a.chapter-link.cp-l
// Legacy: div.chapters-link table tr > a.chapter-link
function groupleParseChapters(doc, baseUrl) {
    const chapters = [];
    let rows = doc.select("tr.item-row");
    if (!rows.length) rows = doc.select("div.chapters-link table tr, table.table-chapters tr");
    // Some titles print a row without a link — the site's own placeholder
    // ("Продолжение следует..."), or a "Читать с начала" button whose link is
    // a comment. Those used to take the place of a real chapter.
    let skippedRows = 0;
    for (const row of rows) {
        // Only row cells link to chapters. Some titles carry an extra table
        // row ("Читать с начала" / "Продолжение следует...") whose link points
        // at a comment or a font file; those were getting through and, on a
        // title whose chapters are gone, took the place of every chapter.
        const cells = row.select("td");
        if (!cells.length) { skippedRows++; continue; }
        let a = null;
        for (const cell of cells) {
            a = cell.selectFirst("a.chapter-link.cp-l")
                || cell.selectFirst("a.chapter-link")
                || cell.selectFirst("a[href]");
            if (a && a.attr("href")) break;
            a = null;
        }
        if (!a) { skippedRows++; continue; }
        const href = a.attr("href");
        if (!href) { skippedRows++; continue; }
        if (href === "/" || href.indexOf("#") === 0) { skippedRows++; continue; }
        const fullTitle = (a.text || "").replace(" новое", "").trim();
        if (!fullTitle) { skippedRows++; continue; }
        // Site shows "V - C[: Subtitle]" e.g. "1 - 5: Начало" — re-emit in
        // v0.7.70-compatible "Глава C: Subtitle (т. V)" so ChapterRecognition
        // picks the chapter number, not the volume (see groupleChapterTitle).
        const title = groupleChapterTitle(fullTitle, href);

        let dateTxt = "";
        const dateTd = row.selectFirst("td[data-date-raw]");
        if (dateTd) dateTxt = dateTd.attr("data-date-raw") || dateTd.text;
        if (!dateTxt) {
            const dCell = row.selectFirst("td.date") || row.selectFirst("td[data-date]");
            if (dCell) dateTxt = dCell.attr("data-date-raw") || dCell.attr("data-date") || dCell.text;
        }
        if (!dateTxt) {
            const tds = row.select("td");
            if (tds.length) dateTxt = (tds[tds.length - 1].text || "").trim();
        }

        const scanlator = ((a.attr("title") || "").replace(" (Переводчик)", "").trim()) || null;

        chapters.push({
            name: title,
            url: groupleChapterUrl(href),
            dateUpload: groupleParseDate(dateTxt).toString(),
            scanlator: scanlator
        });
    }

    // A title whose every row was unusable is not a title without chapters:
    // the parse is what failed. Saying so beats showing an empty chapter list
    // that looks like the site removed all of them.
    if (!chapters.length && skippedRows) {
        throw new Error("Grouple: не удалось разобрать список глав (" + skippedRows + " строк)");
    }
    // No chapter rows at all: some titles really have none (nothing uploaded
    // yet). That is not an error.
    return chapters;
}

// Keep the DOM parse's text helper in one place: rows carry inline tags
function groupleTextOf(html) {
    return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Mapping used by every chapter title, shared by both parsers.
function groupleChapterTitle(fullTitle, href) {
    const hrefChapter = (String(href).match(/\/vol\d+\/(\d+(?:\.\d+)?)\s*$/) || [])[1] || "";
    const m = fullTitle.match(/^(\d+)\s*[-—]\s*(\d+(?:\.\d+)?)\s*(?:[:—]\s*(.*))?$/);
    if (m) {
        const volNum = m[1];
        const chNum = m[2];
        const sub = (m[3] || "").trim();
        const volSuffix = volNum && volNum !== "0" ? ` (т. ${volNum})` : "";
        return `Глава ${chNum}${sub ? `: ${sub}` : ""}${volSuffix}`;
    }
    // "13 Экстра" rows point at /vol13/65.5 and have no "V - C" part.
    const extra = fullTitle.match(/^(\d+)\s+(.+)$/);
    if (hrefChapter && extra && !/^\d+\s*[-—]/.test(fullTitle)) {
        const volSuffix = extra[1] && extra[1] !== "0" ? ` (т. ${extra[1]})` : "";
        return `Глава ${hrefChapter}: ${extra[2].trim()}${volSuffix}`;
    }
    // No "V - C" part either, but the link still tells the number ("1 Пролог").
    if (hrefChapter && /^\d+$/.test(fullTitle)) {
        const volNum = (String(href).match(/\/vol(\d+)\//) || [])[1] || "";
        const volSuffix = volNum && volNum !== "0" ? ` (т. ${volNum})` : "";
        return `Глава ${hrefChapter}${volSuffix}`;
    }
    return fullTitle;
}

// Same chapters, read straight from the response body instead of the DOM.
// The Grouple markup can change shape between mirrors and page versions
// (`tr.item-row` rows whose title link is not a `chapter-link` any more, for
// instance), and a DOM extension quietly returning nothing turned that into
// "this title has no chapters". Every `/volN/C` link inside a row that also
// names a volume and a chapter is taken here; the two lists are merged.
function groupleParseChaptersFromBody(body, baseUrl) {
    const chapters = [];
    const chunks = String(body || "").split(/<tr[^>]*class="[^"]*item-row/i).slice(1);
    for (const chunk of chunks) {
        const row = chunk.split(/<tr[\s>]/i)[0];
        const meta = row.match(/data-vol="(\d+)"[^>]*data-num="(\d+)"/i);
        if (!meta) continue;
        const link = row.match(/<a[^>]+href="([^"]*\/vol\d+\/\d+(?:\.\d+)?)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!link) continue;
        const href = link[1];
        if (href.indexOf("#") === 0) continue;
        const raw = groupleTextOf(link[2]).replace(" новое", "").trim();
        if (!raw) continue;
        const date = (row.match(/data-date-raw="([^"]*)"/i) || [])[1] || "";
        const scan = (row.match(/<a[^>]+href="[^"]*\/vol\d+\/\d+(?:\.\d+)?[^"]*"[^>]+title="([^"]*)"/i) || [])[1] || "";
        chapters.push({
            name: groupleChapterTitle(raw, href),
            url: groupleChapterUrl(href),
            dateUpload: groupleParseDate(date).toString(),
            scanlator: scan.replace(" (Переводчик)", "").trim() || null
        });
    }
    return chapters;
}

// Merge the fallback parse into the DOM one, DOM order first (the site's
// order), then whatever only the fallback knew about.
function groupleMergeChapters(primary, secondary) {
    const seen = {};
    const out = [];
    for (const list of [primary, secondary]) {
        for (const ch of list) {
            const key = String(ch.url || "").replace(/\?.*$/, "");
            if (!key || seen[key]) continue;
            seen[key] = true;
            out.push(ch);
        }
    }
    return out;
}

// Parse page entries out of a reader HTML body.
// The actual JS call on modern Grouple sites is:
//   readerInit(chapterInfo, [['https://host/','',"path",w,h], ...])
// Entries use MIXED quotes — host/empty are single-quoted, path is double-quoted.
// Older sites used `rm_h.initReader(...)` with all-single-quoted entries.
function groupleParsePages(body, baseUrl) {
    const pages = [];

    // Locate the outer array literal passed to the reader-init function.
    let idx = body.indexOf("readerInit(");
    if (idx < 0) idx = body.indexOf("rm_h.initReader(");
    if (idx < 0) idx = body.indexOf("rm_h.readerDoInit(");
    if (idx < 0) return pages;

    // Find the second argument array: first "[[" after the marker
    const startMarker = body.indexOf("[[", idx);
    if (startMarker < 0) return pages;
    const endMarker = body.indexOf("]]", startMarker);
    if (endMarker < 0) return pages;

    const inner = body.substring(startMarker + 1, endMarker + 1); // e.g. "[host,'',path,w,h],[...]"
    // Each entry is `['host','',"path",w,h]` — capture 3 quoted tokens
    const entryRe = /\[\s*(['"])([^'"]*)\1\s*,\s*(['"])([^'"]*)\3\s*,\s*(['"])([^'"]*)\5\s*(?:,\s*[^\]]+)?\]/g;
    let m;
    while ((m = entryRe.exec(inner)) !== null) {
        const host = m[2] || "";
        const extra = m[4] || "";
        const path = m[6] || "";
        let full;
        if (extra && extra.startsWith("/manga/")) {
            full = host + path;
        } else if (!host && path.startsWith("/static/")) {
            full = baseUrl + path;
        } else if (host) {
            full = host + extra + path;
        } else {
            full = path;
        }
        if (!/^https?:/.test(full)) {
            if (full.startsWith("//")) full = "https:" + full;
            else full = "https:" + full;
        }
        // Strip ?query from one-way.work placeholders where chapters sometimes have expiring tokens
        if (full.indexOf("one-way.work") >= 0 && full.indexOf("?") > 0) {
            full = full.substring(0, full.indexOf("?"));
        }
        pages.push({ url: full, headers: groupleImageHeaders(baseUrl) });
    }
    return pages;
}

// Grouple serves the reader on a numbered mirror: mintmanga.live redirects to
// 2.mintmanga.one, readmanga.ru to 1.readmanga.club, and so on. That hop is a
// 301, and HTTP clients may replace the Referer with the previous URL while
// following it. Detail and catalog pages tolerate that, but the reader is
// strict: only a google.com Referer gets real pages. With the site as Referer
// it answers 404 and every page is /static/deleted1.png; with no Referer at
// all it answers "NOT FOUND". Either way the app sees an empty chapter.
//
// So request the numbered mirror directly (no 301 to mangle the Referer) and
// only fall back to the canonical host if the mirror has moved.
const GROUPLE_MIRROR_HOSTS = {
    "mintmanga.live": "2.mintmanga.one",
    "mintmanga.one": "2.mintmanga.one",
    "readmanga.ru": "1.readmanga.club",
    "readmanga.live": "1.readmanga.club",
    "readmanga.io": "1.readmanga.club",
    "allhen.online": "20.allhen.online",
    "allhentai.ru": "20.allhen.online"
};

function groupleHost(url) {
    const m = String(url || "").match(/^https?:\/\/([^\/?#:]+)/i);
    return m ? m[1].toLowerCase() : "";
}

function groupleMirrorHost(baseUrl) {
    const host = groupleHost(baseUrl);
    return GROUPLE_MIRROR_HOSTS[host] || GROUPLE_MIRROR_HOSTS[host.replace(/^[0-9]+\./, "")] || "";
}

// Keep path + query, drop whatever host the stored chapter URL has.
function groupleChapterPath(url) {
    const m = String(url || "").match(/^https?:\/\/[^\/?#]+([\s\S]*)$/i);
    const rest = m ? (m[1] || "/") : String(url || "");
    return rest.charAt(0) === "/" ? rest : "/" + rest;
}

function groupleUrlOn(host, path) {
    return "https://" + host + (path.charAt(0) === "/" ? path : "/" + path);
}

// The mirror's own canonical link, used when a 404 page reveals a renamed host.
function groupleCanonicalHost(body, baseUrl) {
    const m = String(body || "").match(/<link[^>]+rel=["']?canonical["']?[^>]+href=["']https?:\/\/([^\/"'?#]+)/i);
    if (!m) return "";
    const label = groupleHost(baseUrl).replace(/^[0-9]+\./, "").split(".")[0];
    return label && m[1].toLowerCase().indexOf(label) >= 0 ? m[1].toLowerCase() : "";
}

async function groupleGetPageList(client, baseUrl, chapterUrl) {
    const path = groupleChapterPath(groupleChapterUrl(groupleRewriteHost(baseUrl, chapterUrl)));
    const baseHost = groupleHost(baseUrl);
    const mirror = groupleMirrorHost(baseUrl);

    const hosts = [];
    if (mirror) hosts.push(mirror);
    if (baseHost && hosts.indexOf(baseHost) < 0) hosts.push(baseHost);

    let lastBody = "";
    for (const host of hosts) {
        let res;
        try {
            res = await client.get(groupleUrlOn(host, path), groupleHeaders(baseUrl));
        } catch (e) {
            continue;
        }
        const body = (res && res.body) || "";
        if (!lastBody) lastBody = body;
        // A chapter pulled by the publisher (or blocked for the current
        // session) is answered with /static/deleted1.png for every page.
        // Passing those on makes the reader show dozens of identical
        // placeholders, so drop them: a mix keeps its real pages, a fully
        // removed chapter reports no pages.
        const pages = groupleParsePages(body, baseUrl)
            .filter(p => !/\/static\/deleted1\.png/i.test(p.url));
        if (pages.length) return pages;
    }

    // Last resort: a 404 page still prints its canonical URL, so the current
    // numbered mirror can be recovered even after it was renamed.
    const discovered = groupleCanonicalHost(lastBody, baseUrl);
    if (discovered && hosts.indexOf(discovered) < 0) {
        try {
            const res = await client.get(groupleUrlOn(discovered, path), groupleHeaders(baseUrl));
            return groupleParsePages((res && res.body) || "", baseUrl)
                .filter(p => !/\/static\/deleted1\.png/i.test(p.url));
        } catch (e) {}
    }
    return [];
}

// Common filter list — sort + genre slug list (shared across Grouple sites: readmanga, mintmanga, selfmanga, allhentai).
function groupleFilterList() {
    const genres = [
        ["Арт", "art"], ["Боевик", "action"], ["Боевые искусства", "martial_arts"],
        ["Вампиры", "vampires"], ["Гарем", "harem"], ["Гендерная интрига", "gender_intriga"],
        ["Героическое фэнтези", "heroic_fantasy"], ["Детектив", "detective"],
        ["Дзёсэй", "josei"], ["Додзинси", "doujinshi"], ["Драма", "drama"],
        ["Игра", "game"], ["Исэкай", "isekai"], ["История", "historical"],
        ["Киберпанк", "cyberpunk"], ["Кодомо", "codomo"], ["Комедия", "comedy"],
        ["Махо-сёдзё", "maho_shoujo"], ["Меха", "mecha"], ["Мистика", "mystery"],
        ["Музыка", "music"], ["Научная фантастика", "sci_fi"], ["Повседневность", "natural"],
        ["Постапокалиптика", "postapocalypse"], ["Приключения", "adventure"],
        ["Психология", "psychological"], ["Романтика", "romance"],
        ["Сверхъестественное", "supernatural"], ["Сёдзё", "shoujo"],
        ["Сёдзё-ай", "shoujo_ai"], ["Сёнэн", "shounen"], ["Сёнэн-ай", "shounen_ai"],
        ["Спорт", "sports"], ["Сэйнэн", "seinen"], ["Трагедия", "tragedy"],
        ["Триллер", "thriller"], ["Ужасы", "horror"], ["Фантастика", "fantasy"],
        ["Фэнтези", "fantastic"], ["Школа", "school"], ["Этти", "ecchi"],
        ["Эротика", "erotica"]
    ];
    return [
        {
            type_name: "SortFilter",
            type: "sort",
            name: "Сортировка",
            state: { type_name: "SortState", index: 0, ascending: false },
            values: [
                ["Популярность", "RATING"],
                ["Просмотры", "POPULARITY"],
                ["Обновлённое", "UPDATED"],
                ["Новое", "CREATED"],
                ["Имя", "NAME"]
            ].map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
        },
        {
            type_name: "SelectFilter",
            type: "genre",
            name: "Жанр",
            state: 0,
            values: [["Любой", ""]].concat(genres).map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
        },
        {
            type_name: "GroupFilter",
            type: "flags",
            name: "Доп. фильтры",
            state: [
                ["Высокий рейтинг", "s_high_rate"],
                ["Одиночные", "s_single"],
                ["Для взрослых", "s_mature"],
                ["Переведено", "s_translated"],
                ["Брошенные", "s_abandoned_popular"],
                ["Много глав", "s_many_chapters"],
                ["Ожидает загрузки", "s_wait_upload"]
            ].map(x => ({ type_name: "CheckBox", name: x[0], value: x[1] }))
        }
    ];
}

// Build a catalog URL that honors filter state.
function groupleSearchUrl(baseUrl, query, page, filters) {
    const offset = (page - 1) * 70;
    // Resolve sort
    let sort = "RATING";
    let asc = false;
    if (filters && filters[0] && filters[0].values) {
        const idx = (filters[0].state && filters[0].state.index) || 0;
        sort = filters[0].values[idx].value;
        asc = !!(filters[0].state && filters[0].state.ascending);
    }
    // Genre slug (single-select)
    let genreSlug = "";
    if (filters && filters[1] && filters[1].values) {
        const idx = filters[1].state || 0;
        genreSlug = filters[1].values[idx].value;
    }
    // Flags
    const flagPairs = [];
    if (filters && filters[2] && filters[2].state) {
        for (const f of filters[2].state) if (f.state) flagPairs.push(`${f.value}=1`);
    }

    let url;
    if (query) {
        // Advanced search endpoint
        url = `${baseUrl}/search/advancedResults?q=${encodeURIComponent(query)}&offset=${offset}&sortType=${sort}${asc ? "&sortDirection=ASC" : ""}`;
        if (genreSlug) url += `&el_${genreSlug}=1`;
    } else if (genreSlug) {
        // Genre-scoped listing
        url = `${baseUrl}/list/genre/${genreSlug}?sortType=${sort}&offset=${offset}${asc ? "&sortDirection=ASC" : ""}`;
    } else {
        // Plain listing
        url = `${baseUrl}/list?sortType=${sort}&offset=${offset}${asc ? "&sortDirection=ASC" : ""}`;
    }
    for (const fp of flagPairs) url += `&${fp}`;
    return url;
}

// Base URL resolver: respects user override from SharedPreferences
function groupleBaseUrlFrom(source) {
    // MintManga: the reader lives on mintmanga.live / 2.mintmanga.one, while
    // mintmanga.one and *.mintmanga.com are WordPress sites that keep the same
    // <div class="tile"> catalogue but answer "нет результатов" for every title.
    // A manual override always wins; otherwise the known blog hosts are swapped.
    const override = String((new SharedPreferences()).get("override_base_url") || "").trim();
    if (override) return override.replace(/\/+$/, "");
    let host = String((source && source.baseUrl) || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^[0-9]+\./, "");
    if (/^mintmanga\.(?:one|com|me)$/i.test(host)) return "https://mintmanga.live";
    return String((source && source.baseUrl) || "").replace(/\/+$/, "");
}

// Shared preferences definition — same for every Grouple source
function groupleSourcePreferences() {
    return [
        {
            key: "override_base_url",
            editTextPreference: {
                title: "Переопределить baseUrl",
                summary: "Альтернативный mirror при блокировке. Без слеша в конце. Оставьте пустым для значения по умолчанию.",
                value: "",
                dialogTitle: "Base URL",
                dialogMessage: "Например: https://web.usagi.one"
            }
        },
        {
            key: "grouple_session_cookie",
            editTextPreference: {
                title: "Session cookie",
                summary: "ОПЦИОНАЛЬНО. 18+ работает и без неё — расширение само отвечает на возрастной гейт сайта (?mtr=1). Cookie нужен только для платных/снятых глав, если у вас есть аккаунт: скопируйте ВСЮ строку Cookie в DevTools (F12) → Application → Cookies после логина.",
                value: "",
                dialogTitle: "Cookie",
                dialogMessage: "Пример: PHPSESSID=abc...; user_id=12345; user_token=def..."
            }
        }
    ];
}
