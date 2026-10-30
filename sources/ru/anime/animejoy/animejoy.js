// @include: kodik_extractor

const mangayomiSources = [{
    "name": "AnimeJoy",
    "lang": "ru",
    "baseUrl": "https://animejoy.ru",
    "apiUrl": "",
    "iconUrl": "",
    "typeSource": "single",
    "itemType": 1,
    "isNsfw": false,
    "hasCloudflare": false,
    "version": "0.5.0",
    "dateFormat": "",
    "dateFormatLocale": "",
    "pkgPath": "ru/anime/animejoy.js",
    "notes": "Аниме с русскими субтитрами (DLE). Основной адрес animejoy.ru, при недоступности — официальное зеркало otakujoy.fun (актуальные адреса берутся из API зеркал, см. getBase). Каталог: /tv-serialy/, /ova/, /anime-films/. Поиск: GET /index.php?do=search&subaction=search&story=... Фильтр по жанру: /tags/<жанр>/. Плееры: playerjs — прямые mp4 1080/720, Kodik — HLS, остальные iframe."
}];

const AJ_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AJ_PAGE_SIZE = 10;
const AJ_SECTIONS = ["tv-serialy", "ova", "anime-films"];
// Main address first, then the project's own mirror. animejoy.ru is behind
// Cloudflare (its TLS cert breaks on some phones), the mirror is not.
const AJ_FALLBACK_HOSTS = ["otakujoy.fun"];
// The site publishes its mirror list at /api/. Mostly for reference: the list
// changes rarely, so the hardcoded mirror above is what actually gets used.
const AJ_MIRROR_LIST_URL = "https://animejoy.ru/api/";
// A host that fails once is skipped for a while (dead mirrors cost one timeout).
const AJ_HOST_COOLDOWN_MS = 10 * 60 * 1000;

function ajBase(source) {
    const raw = source && source.baseUrl;
    const s = typeof raw === "string" ? raw.trim() : "";
    return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, "") : "https://animejoy.ru";
}

function ajHostOf(url) {
    const m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1].replace(/^www\./i, "") : "";
}

// Rewrites a link of the working mirror back to the configured base, so the
// app keeps showing (and caching) the canonical domain.
function ajRebase(url, base) {
    const u = String(url || "");
    const host = ajHostOf(base);
    if (!host) return u;
    return u.replace(/^https?:\/\/(?:[a-z0-9-]+\.)*(?:animejoy\.[a-z]+|otakujoy\.fun)/i, "https://" + host);
}

function ajClean(s) {
    return String(s || "")
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&nbsp;/g, " ")
        .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// "Фантазии Речных заводей [04 из 23]" -> "Фантазии Речных заводей"
function ajTidyName(raw) {
    return ajClean(raw).replace(/\s*\[\s*[^\]]*\]\s*$/g, "").trim();
}

// "1 серия", "TV", "Мovie" -> episode number, 0 when it is not an episode at all.
function ajEpisodeNum(label) {
    const m = String(label || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

class DefaultExtension extends MProvider {
    constructor() {
        super();
        this.client = new Client();
    }

    get headers() {
        return {
            "User-Agent": AJ_UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Referer": (this._base || ajBase(this.source)) + "/"
        };
    }

    absUrl(u) {
        if (!u) return "";
        let s = String(u).trim();
        if (s.startsWith("//")) s = "https:" + s;
        if (s.startsWith("http")) return ajRebase(s, ajBase(this.source));
        return ajBase(this.source) + (s.startsWith("/") ? s : "/" + s);
    }

    // Mirror lists are plain text/HTML with one or more *.host tokens; only
    // domains that answer for this DLE site are accepted.
    parseMirrorList(body, base) {
        const host = ajHostOf(base);
        const out = [];
        const re = /(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:ru|fun|com|me|top|online|site|xyz|pro|su|cc|one|tv))\b/gi;
        let m;
        while ((m = re.exec(String(body || ""))) !== null) {
            const h = m[1].toLowerCase().replace(/^www\./, "");
            if (h === host || out.indexOf(h) >= 0) continue;
            if (!/joy/.test(h)) continue;
            out.push(h);
        }
        return out.slice(0, 6);
    }

    async getBase() {
        const base = ajBase(this.source);
        const host = ajHostOf(base);
        if (this._base && this._baseHost === host) return this._base;
        const probe = async (candidate) => {
            try {
                const res = await this.client.get(candidate + "/tv-serialy/", this.headers);
                if (!res || res.statusCode !== 200 || !res.body) return false;
                return res.body.indexOf("ntitle") >= 0 || res.body.indexOf("shortstory") >= 0;
            } catch (e) {
                return false;
            }
        };
        this._dead = this._dead || {};
        const fresh = (host) => !this._dead[host] || (Date.now() - this._dead[host]) > AJ_HOST_COOLDOWN_MS;
        let picked = base;
        if (fresh(host) && !(await probe(base))) this._dead[host] = Date.now();
        if (picked !== base || this._dead[host]) {
            picked = "";
            const candidates = AJ_FALLBACK_HOSTS.map(h => "https://" + h);
            try {
                const res = await this.client.get(AJ_MIRROR_LIST_URL, this.headers);
                if (res && res.statusCode === 200 && res.body) {
                    for (const h of this.parseMirrorList(res.body, base)) candidates.push("https://" + h);
                }
            } catch (e) { /* list unavailable — keep the hardcoded mirror */ }
            for (const cand of candidates) {
                const h = ajHostOf(cand);
                if (!fresh(h)) continue;
                if (await probe(cand)) { picked = cand; break; }
                this._dead[h] = Date.now();
            }
            if (!picked) picked = base;
        }
        this._base = picked;
        this._baseHost = host;
        return picked;
    }

    // External embed ("//kodikplayer.com/...") -> absolute URL of the embed itself.
    absOrProto(u) {
        const s = String(u || "").trim();
        if (s.startsWith("//")) return "https:" + s;
        return s;
    }

    async fetchBody(path) {
        const base = await this.getBase();
        const url = path && /^https?:\/\//i.test(path) ? ajRebase(path, base) : base + (String(path).startsWith("/") ? path : "/" + path);
        try {
            const res = await this.client.get(url, this.headers);
            if (!res || res.statusCode !== 200 || !res.body) return "";
            return res.body;
        } catch (e) {
            return "";
        }
    }

    parseCatalog(htmlBody) {
        const doc = new Document(htmlBody);
        const list = [];
        const seen = {};
        let items = doc.select("article.block.story");
        if (items.length === 0) items = doc.select("article.shortstory");
        if (items.length === 0) items = doc.select("article.story");
        for (const it of items) {
            const titleA = it.selectFirst("h2.ntitle a") || it.selectFirst("h3.ntitle a");
            if (!titleA) continue;
            const href = this.absUrl(titleA.attr("href") || "");
            if (!href || seen[href]) continue;
            // Article pages only: /tv-serialy/123-slug.html, /anime-films/..., /ova/...
            if (!/\/(tv-serialy|anime-films|full_tv|ova)\/\d+-[^/]+\.html$/.test(href)) continue;
            seen[href] = true;
            const name = ajTidyName(titleA.attr("title") || titleA.text || "");
            if (!name) continue;

            let imageUrl = "";
            const imgTag = it.selectFirst("picture img") || it.selectFirst("img");
            if (imgTag) imageUrl = this.absUrl(imgTag.attr("src") || imgTag.attr("data-src") || "");
            if (!imageUrl) {
                const ogImg = htmlBody.match(new RegExp('<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']'));
                if (ogImg) imageUrl = ogImg[1];
            }
            list.push({ name: name, imageUrl: imageUrl, link: href });
        }
        return { list: list, hasNextPage: list.length >= AJ_PAGE_SIZE };
    }

    async getPopular(page) {
        const p = page <= 1 ? 1 : page;
        const body = await this.fetchBody(p === 1 ? "/tv-serialy/" : `/tv-serialy/page/${p}/`);
        if (!body) return { list: [], hasNextPage: false };
        return this.parseCatalog(body);
    }

    async getLatestUpdates(page) {
        // The front page mixes news, so ongoing releases come from the site's sort.
        const p = page <= 1 ? 1 : page;
        const body = await this.fetchBody(p === 1 ? "/ongoing/" : `/ongoing/page/${p}/`);
        if (!body) return { list: [], hasNextPage: false };
        const parsed = this.parseCatalog(body);
        if (parsed.list.length) return parsed;
        return await this.getPopular(page);
    }

    async search(query, page, filters) {
        const tag = ajClean(filters && filters[0] ? String(filters[0]).replace(/^🔞\s*/, "") : "");
        const q = String(query || "").trim();
        const p = page <= 1 ? 1 : page;

        if (q && !tag) {
            const url = `/index.php?do=search&subaction=search&story=${encodeURIComponent(q)}&search_start=${p}`;
            const body = await this.fetchBody(url);
            if (!body) return { list: [], hasNextPage: false };
            const parsed = this.parseCatalog(body);
            // Server-side fuzzy search: 10 per page until the tail spills over.
            parsed.hasNextPage = parsed.list.length >= AJ_PAGE_SIZE;
            return parsed;
        }

        // Genre/tag listing (tags accept only the plain word, no prefix).
        if (tag) {
            const base = `/tags/${encodeURIComponent(tag)}/`;
            const body = await this.fetchBody(p === 1 ? base : `${base}page/${p}/`);
            if (!body) return { list: [], hasNextPage: false };
            return this.parseCatalog(body);
        }

        return await this.getPopular(page);
    }

    // Playlists are inlined into the article: group tabs (AL, TV…), player tabs
    // (Наш плеер, Kodik, VK…) and episode rows with data-file attributes.
    // Ids are "_"-joined indexes: "<group>_<player>_[<ep>]" or, on long series,
    // "<group>_<player>_<season>_<ep>". A season step repeats the player index
    // (0_0_1_0 -> 0_0_2_0), so when ids reach four parts the third one is the season.
    parsePlaylists(htmlBody) {
        const doc = new Document(htmlBody);
        const groups = [];
        const players = [];
        const rows = [];
        // Folder levels: "<group>_<folder>_<ep>" = 3, "<group>_<player>_<folder>_<ep>" = 4.
        let levels = 2;

        for (const li of doc.select(".playlists-lists li")) {
            const id = li.attr("data-id") || "";
            const label = ajClean(li.text || "");
            if (!id || !label) continue;
            const parts = id.split("_").filter(x => x !== "");
            if (parts.length === 2) groups.push({ id: id, label: label });
            else if (parts.length === 3) {
                // Panels 0_N_M of the same group hold range tabs ("291+ серии").
                const isPanel = Array.from(doc.select(".playlists-lists > div")).some(div => (div.attr("data-id") || "") === parts.slice(0, 2).join("_"));
                if (isPanel) players.push({ id: id, group: parts[0] + "_" + parts[1], label: label, range: true });
                else players.push({ id: id, group: parts[0] + "_" + parts[1], label: label });
                levels = Math.max(levels, 3);
            } else if (parts.length >= 4) {
                players.push({ id: id, group: parts.slice(0, 2).join("_"), label: label, season: parts.slice(2, -1).join("_") });
                levels = Math.max(levels, 4);
            }
        }
        for (const li of doc.select(".playlists-videos li")) {
            const file = li.attr("data-file") || "";
            const id = li.attr("data-id") || "";
            if (!file || !id) continue;
            const label = ajClean(li.text || "");
            // Player tabs of short titles are sometimes junk markers ("." / "\u0060").
            if (!label || /^[\s.`~\-]+$/.test(label)) continue;
            rows.push({ file: file, id: id, label: label });
        }
        for (const r of rows) {
            const parts = r.id.split("_").filter(x => x !== "");
            if (parts.length >= 4) levels = Math.max(levels, 4);
            else if (parts.length === 3) levels = Math.max(levels, 3);
        }
        return { groups: groups, players: players, rows: rows, levels: levels };
    }

    // The site loads the playlists over AJAX: the article only carries
    // data-news_id plus a JSON wrapper around the same markup.
    async fetchPlaylistsAjax(htmlBody) {
        const m = String(htmlBody || "").match(/data-news_id=["'](\d+)["']/);
        const empty = { groups: [], players: [], rows: [] };
        if (!m) return empty;
        const headers = Object.assign({}, this.headers, {
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01"
        });
        const url = `${await this.getBase()}/engine/ajax/playlists.php?news_id=${m[1]}&xfield=playlist`;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await this.client.get(url, headers);
                if (res && res.statusCode === 200 && res.body) {
                    let html = res.body;
                    try {
                        const data = JSON.parse(res.body);
                        if (data && data.response) html = data.response;
                    } catch (e) { /* already raw HTML */ }
                    const pl = this.parsePlaylists(html);
                    if (pl.rows.length) return pl;
                }
            } catch (e) { /* retry once */ }
        }
        return empty;
    }

    // Rows carry data-id="<group>_<player>" (AJAX markup), "<group>_<player>_<ep>"
    // (older inline markup) or "<group>_<player>_<season>_<ep>" (long series).
    playerIdFromRow(id, players, groups, levels) {
        const s = String(id || "");
        if (players && players.some(p => p.id === s)) return s;
        if (groups && groups.some(g => g.id === s)) return s;
        const parts = s.split("_").filter(x => x !== "");
        // The season part may itself contain "_", so the depth comes from how many
        // parts the player tabs actually use.
        let depth = 2;
        if (players && players.length) {
            depth = 2;
            for (const p of players) depth = Math.max(depth, p.id.split("_").filter(x => x !== "").length);
        } else if (levels && levels >= 4) {
            depth = 3;
        }
        if (parts.length > depth) {
            const key = parts.slice(0, depth).join("_");
            if (players && players.some(p => p.id === key)) return key;
            const two = parts.slice(0, 2).join("_");
            if (!players || !players.length || players.some(p => p.id === two)) return two;
            return key;
        }
        return s;
    }

    playerName(id, players, groups) {
        for (const pl of players) if (pl.id === id) return pl.label;
        for (const g of groups || []) if (g.id === id) return g.label;
        const parts = String(id || "").split("_");
        return parts.length >= 3 ? "Плеер " + parts[2] : "Плеер";
    }

    // Player tab label for a folder group "<group>_<player>_<folder>".
    playerGroupLabel(groupId, folder, pl) {
        const pi = String(folder).split("_")[0];
        const tab = (pl.players || []).find(p => {
            const parts = p.id.split("_");
            return parts.length === 3 && parts.slice(0, 2).join("_") === groupId && parts[2] === pi;
        });
        return tab ? tab.label : "";
    }

    // Long series nest rows as "<group>_<player>_<folder>_<ep>"; the folder index
    // numbers episodes inside the player tab (e.g. 1101-1110).
    folderLabel(groupId, folder) {
        void groupId;
        return String(folder);
    }

    // "291 серия", "1 cерия", "SP 2" -> numbered row; "291+ серии", "TV", "Фильм" -> folder / whole.
    isEpisodeLabel(label) {
        const s = this.normLabel(label);
        if (!s) return false;
        if (/^\d+\s*(?:серия|эп|ep|series|sezon|season)/i.test(s)) return true;
        if (/^(?:sp|ova|ona|спешл|recap|рекап|фильм|movie)/i.test(s)) return true;
        return false;
    }

    // "1101 серия " / "1 Cерия" -> "1101 серия": mixed latin/cyrillic copies from
    // the site must still count as the same episode.
    normLabel(label) {
        return String(label || "")
            .replace(/[\u00A0\u2000-\u200B]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
            .replace(/c/g, "с");
    }

    // Direct mp4 (playerjs) first, then Kodik HLS, then the third-party iframes.
    playerRank(name, file) {
        const f = String(file || "");
        if (f.indexOf("playerjs") >= 0) return 0;
        if (f.indexOf("kodik") >= 0) return 1;
        if (String(name || "").toLowerCase().indexOf("наш") >= 0) return 2;
        return 3;
    }

    // Episode label -> sortable order. Supports "1 серия", "1101 серия", "SP"/"SP 2";
    // unknown labels keep their position before episode 1.
    rowOrder(label, index) {
        const s = String(label || "");
        const ep = s.match(/^\s*(\d+)\s*(?:серия|эп|ep|series)?\s*$/i);
        if (ep) return parseInt(ep[1], 10);
        return -1 + index / 100000;
    }

    async getDetail(url) {
        const detailUrl = this.absUrl(url);
        let body = await this.fetchBody(detailUrl);
        // The site throttles bursts of requests; a retry with a plain Accept fixes
        // the otherwise empty 200 pages seen on long-running series.
        if (!body || body.indexOf("data-news_id") < 0) {
            const retryHeaders = Object.assign({}, this.headers, { "Accept": "*/*", "Referer": detailUrl });
            try {
                const res = await this.client.get(detailUrl, retryHeaders);
                if (res && res.statusCode === 200 && res.body) body = res.body;
            } catch (e) { /* keep the first body */ }
        }
        const doc = new Document(body);
        if (!body) {
            return { name: ajClean(url), imageUrl: "", description: "", genre: [], status: 5, episodes: [] };
        }

        const nameEl = doc.selectFirst("h1.ntitle") || doc.selectFirst("article h1") || doc.selectFirst("h1");
        const romanjiEl = doc.selectFirst("h1.romanji") || doc.selectFirst(".romanji");
        const name = ajTidyName(nameEl ? nameEl.text : "");
        const altName = ajClean(romanjiEl ? romanjiEl.text : "");

        let imageUrl = "";
        const ogImg = body.match(/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/);
        if (ogImg) imageUrl = this.absUrl(ogImg[1]);
        if (!imageUrl) {
            const img = doc.selectFirst("article picture img") || doc.selectFirst("article img");
            if (img) imageUrl = this.absUrl(img.attr("src") || img.attr("data-src") || "");
        }

        const descEl = doc.selectFirst("div.blkdesc") || doc.selectFirst(".fullstory, .story-text");
        const description = ajClean(descEl ? descEl.text : "");
        const genre = doc.select("div.blkdesc a[href*='/tags/']").map(e => ajClean(e.text)).filter(x => x);
        if (altName && altName !== name) genre.unshift(altName);

        // Episodes: one entry per episode with every player packed as "name||url".
        let pl = this.parsePlaylists(body);
        if (!pl.rows.length) pl = await this.fetchPlaylistsAjax(body);

        // Folder tabs of long series repeat the player index per season, so the
        // folder index does not say which season a row belongs to. The row's own
        // season index does; learn the folder -> season map from the rows upfront.
        const folderSeason = {};
        for (const row of pl.rows) {
            const parts = row.id.split("_").filter(x => x !== "");
            if (parts.length < 4) continue;
            folderSeason[parts[0] + "_" + parts[1] + "_" + parts[2]] = "1";
        }

        const groups = [];
        const seenGroup = {};
        for (const row of pl.rows) {
            // Rows of long series also carry a folder index: group by it as well so
            // "Серия 1 — player → ep 1" pairs up on every folder.
            const gid = pl.levels >= 4
                ? row.id.split("_").filter(x => x !== "").slice(0, 3).join("_")
                : row.id.split("_").slice(0, 2).join("_");
            if (!seenGroup[gid]) {
                seenGroup[gid] = { id: gid, lastLabel: "", items: [] };
                groups.push(seenGroup[gid]);
            }
            const g = seenGroup[gid];
            const playerId = this.playerIdFromRow(row.id, pl.players, pl.groups, pl.levels);
            let player = this.playerName(playerId, pl.players, pl.groups);
            // Nested folders repeat the player index; labels only live at level 3.
            if (!pl.players.some(p => p.id === playerId)) {
                const pi = playerId.split("_").pop();
                const tab = pl.players.find(p => p.id.split("_").length === 3 && p.id.split("_").pop() === pi);
                if (tab) player = tab.label;
            }
            const file = row.file;
            const isDirect = file.indexOf("playerjs") >= 0 || file.indexOf("file=[") >= 0 || file.indexOf("kodik") >= 0;
            const parts = row.id.split("_").filter(x => x !== "");
            // Nested rows end with their own episode index; the middle part is the
            // folder (season) index that both the rows and the player tabs carry.
            const folder = parts.length >= 3 ? parts.slice(2, parts.length - 1).join("_") : "";
            const inSeason = folder;

            // "TV"/"Фильм" rows are whole-season links; each gets its own entry.
            // Folder tabs ("1101-1110", "291+ серии") never are.
            const isFolderTab = pl.players.some(p => p.range && p.label === row.label);
            const whole = !this.isEpisodeLabel(row.label) && !isFolderTab;
            g.items.push({
                player: player,
                playerId: playerId,
                season: inSeason,
                file: file,
                label: row.label,
                whole: whole,
                direct: isDirect,
                groupLabel: g.lastLabel,
                folder: folder !== "" ? this.folderLabel(gid, folder) : "",
                order: this.rowOrder(row.label, g.items.length),
                rank: this.playerRank(player, file)
            });
            // AJAX markup flattens players into a plain list: the first row of each
            // player run tells us which player the following rows belong to.
            g.lastLabel = player;
        }

        // Episode rows are split across sub-tabs ("1101-1110", "1111-1120") and
        // every row's data-id ends with the sub-tab index, not the episode itself.
        // The sub-tab label is what tells episodes apart, and directories like
        // "Спэшл" or "Фильм" only make sense with their sub-tab in the name.
        const episodes = [];
        const multiGroup = pl.groups.length > 1;
        // Groups that behave like providers (one row per episode, same labels) repeat
        // each other: only those get the player name in the episode title.
        const gPlayerTagMap = {};
        for (const g of groups) {
            const lbl = g.items.reduce((a, it) => { a[this.normLabel(it.label)] = true; return a; }, {});
            gPlayerTagMap[g.id] = Object.keys(lbl).length;
        }
        const seenEp = {};
        for (const g of groups) {
            if (!g.items.length) continue;
            const gParts = g.id.split("_");
            // Range sub-tab ("1101-1110") of this folder, "" when the title is not split.
            const gSeasonTab = gParts.length >= 3 ? (pl.players.find(x => x.id === g.id) || {}).label || "" : "";
            const gInfo = pl.groups.find(x => x.id === (gParts.length >= 3 ? gParts.slice(0, 2).join("_") : g.id));
            const multiPlayer = Object.keys(g.items.reduce((a, it) => { a[it.player] = true; return a; }, {})).length > 1;
            const groupTag = gInfo && gInfo.label && !gPlayerIsGroup(gInfo.label, g, pl) ? " · " + gInfo.label : "";

            const whole = g.items.filter(it => it.whole).sort((a, b) => a.rank - b.rank);
            for (const it of whole) {
                const tag = it.season ? " · " + it.season : groupTag;
                episodes.push({
                    name: it.label + tag,
                    url: it.player + "||" + it.file,
                    dateUpload: Date.now().toString(),
                    scanlator: null
                });
            }

            const numbered = g.items.filter(it => !it.whole);
            if (!numbered.length) continue;
            const byLabel = {};
            const order = [];
            for (const it of numbered) {
                const key = this.normLabel(it.label) + "|" + it.season;
                if (!byLabel[key]) {
                    byLabel[key] = [];
                    order.push(key);
                }
                byLabel[key].push(it);
            }
            for (const key of order) {
                const items = byLabel[key].slice().sort((a, b) => a.rank - b.rank);
                const label = items[0].label;
                const m = String(label).match(/(\d+)/);
                const num = m ? parseInt(m[1], 10) : 0;
                let name;
                if (num > 0) name = "Серия " + num;
                else if (items[0].season) name = label + " · " + items[0].season;
                else name = label;
                // In a players-only playlist the group tab IS the player, so it is
                // the only thing telling two "Серия 1" rows apart.
                // Translation ("Ziggy Team 1180") and, for split titles, the range tab
                // ("1101-1110") keep same-numbered rows apart. A players-only playlist
                // gets the player name instead of the translation.
                if (groupTag) name += groupTag;
                const isPlayerList = !multiPlayer && (gPlayerTagMap[g.id] || 0) > 1;
                if (isPlayerList && !groupTag) name += " · " + gInfo.label;
                if (gSeasonTab) name += " · " + gSeasonTab;
                // The same episode must not be listed twice (same name + same players).
                const url = items.map(r => r.player + "||" + r.file).join("\n");
                const dedupeKey = g.id + "|" + name + "|" + url;
                if (seenEp[dedupeKey]) continue;
                seenEp[dedupeKey] = true;
                episodes.push({ name: name, url: url, dateUpload: Date.now().toString(), scanlator: null });
            }
        }

        // Cheap helper: group label equals a player tab ("AL" for the whole title).
        function gPlayerIsGroup(label, g, pl) {
            const names = (pl.players || []).filter(p => p.id.split("_").length === 3 && p.id.split("_").slice(0, 2).join("_") === g.id.split("_").slice(0, 2).join("_")).map(p => p.label);
            return names.length >= 4 && names.indexOf(label) >= 0;
        }

        const clean = episodes.map(e => ({ name: e.name, url: e.url, dateUpload: e.dateUpload, scanlator: null }));

        // Fallback: no playlist markup at all — expose the page itself.
        if (!clean.length) {
            clean.push({
                name: "Все серии",
                url: detailUrl,
                dateUpload: Date.now().toString(),
                scanlator: null
            });
        }

        return {
            name: name || ajClean(url),
            imageUrl: imageUrl,
            description: description,
            genre: genre,
            status: 5,
            episodes: clean
        };
    }

    // playerjs file list: "file=[1080p]url,[720p]url" or plain "file=url".
    playerjsSources(file) {
        const m = String(file).match(/file=([^&]+)/);
        const raw = m ? decodeURIComponent(m[1]) : "";
        const out = [];
        const re = /\[(\d+)p\]([^,\[]+)/g;
        let q;
        while ((q = re.exec(raw)) !== null) {
            const u = q[2].trim();
            if (!u || !/^https?:\/\//.test(u)) continue;
            out.push({ url: u, quality: parseInt(q[1], 10) });
        }
        if (!out.length && /^https?:\/\//.test(raw)) out.push({ url: raw.split(",")[0].trim(), quality: 0 });
        return out;
    }

    async getVideoList(url) {
        const packed = String(url || "");
        // Detail that found no playlist markup hands over the page URL itself:
        // re-read the playlists here so the user never gets an empty list.
        if (packed.indexOf("||") < 0) {
            if (/^https?:\/\/[^/]+\/(tv-serialy|ova|anime-films|full_tv)\//.test(packed)) {
                return await this.videosFromPage(packed);
            }
            return [];
        }

        const lines = packed.split("\n").filter(x => x.trim());
        const videos = [];
        const seen = {};
        const streamHeaders = { "User-Agent": AJ_UA, "Referer": (this._base || ajBase(this.source)) + "/" };

        const push = (u, quality, headers) => {
            if (!u || seen[u]) return;
            seen[u] = true;
            videos.push({ url: u, originalUrl: u, quality: quality, headers: headers });
        };

        for (const line of lines) {
            const idx = line.indexOf("||");
            if (idx < 0) continue;
            const provider = line.substring(0, idx) || "Плеер";
            const fileUrl = line.substring(idx + 2);
            if (!fileUrl) continue;

            if (fileUrl.indexOf("kodik") >= 0) {
                let kv = [];
                try { kv = await kodikExtract(this.client, fileUrl, this._base || ajBase(this.source), "Kodik"); } catch (e) { kv = []; }
                for (const v of kodikProxyVideos(kv)) push(v.url, v.quality, v.headers);
                // Kodik is often geo-blocked: keep its page as a last resort.
                push(this.absOrProto(fileUrl), "Kodik · iframe", streamHeaders);
                continue;
            }

            if (fileUrl.indexOf("playerjs") >= 0 || fileUrl.indexOf("file=[") >= 0) {
                const srcs = this.playerjsSources(fileUrl);
                for (const s of srcs) {
                    push(this.absUrl(s.url), s.quality > 0 ? `${provider} ${s.quality}p` : provider, streamHeaders);
                }
                // The playerjs wrapper itself plays the same mp4s; keep it last.
                push(this.absOrProto(fileUrl), `${provider} · iframe`, streamHeaders);
                continue;
            }

            push(this.absUrl(fileUrl), provider, streamHeaders);
        }

        // Highest quality first, iframes last.
        const rank = (v) => {
            const m = String(v.quality).match(/(\d+)p/);
            return m ? parseInt(m[1], 10) : -1;
        };
        videos.sort((a, b) => rank(b) - rank(a));
        return videos;
    }

    // Fallback for detail pages that came back without playlists: read every
    // player link of the article and show them as a single flat list.
    async videosFromPage(pageUrl) {
        const body = await this.fetchBody(pageUrl);
        if (!body) return [];
        let pl = this.parsePlaylists(body);
        if (!pl.rows.length) pl = await this.fetchPlaylistsAjax(body);
        const videos = [];
        const seen = {};
        const streamHeaders = { "User-Agent": AJ_UA, "Referer": (this._base || ajBase(this.source)) + "/" };
        const push = (u, quality, headers) => {
            if (!u || seen[u]) return;
            seen[u] = true;
            videos.push({ url: u, originalUrl: u, quality: quality, headers: headers });
        };
        const files = [];
        for (const row of pl.rows) {
            if (files.indexOf(row.file) >= 0) continue;
            files.push(row.file);
        }
        const primary = files.slice(0, 12);
        for (const file of primary) {
            if (file.indexOf("kodik") >= 0) {
                let kv = [];
                try { kv = await kodikExtract(this.client, file, this._base || ajBase(this.source), "Kodik"); } catch (e) { kv = []; }
                for (const v of kodikProxyVideos(kv)) push(v.url, v.quality, v.headers);
                push(this.absOrProto(file), "Kodik · iframe", streamHeaders);
                continue;
            }
            if (file.indexOf("playerjs") >= 0 || file.indexOf("file=[") >= 0) {
                for (const s of this.playerjsSources(file)) {
                    push(this.absUrl(s.url), s.quality > 0 ? "Наш плеер " + s.quality + "p" : "Наш плеер", streamHeaders);
                }
                push(this.absOrProto(file), "Наш плеер · iframe", streamHeaders);
                continue;
            }
            push(this.absUrl(file), "Плеер", streamHeaders);
        }
        return videos;
    }

    getFilterList() {
        const genres = [
            "Боевые искусства", "Боевик", "Война", "Детектив", "Дзёсэй", "Драма",
            "История", "Киберпанк", "Кодомо", "Комедия", "Махо-сёдзё", "Меха",
            "Мистика", "Музыкальный", "Образовательный", "Пародия", "Повседневность",
            "Приключения", "Романтика", "Самурайский боевик", "Сёдзё", "Сёнэн", "Сказка",
            "Спорт", "Сэйнэн", "Триллер", "Ужасы", "Фантастика", "Фэнтези", "Школа", "Этти"
        ];
        const values = [["— Любой —", ""]];
        for (const g of genres) values.push([g, g]);
        return [{
            type_name: "SelectFilter",
            type: "genre",
            name: "Жанр",
            state: 0,
            values: values.map(x => ({ type_name: "SelectOption", name: x[0], value: x[1] }))
        }];
    }

    getSourcePreferences() { return [kodikProxyPreference()]; }
}
