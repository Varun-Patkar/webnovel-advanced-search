# WebNovel Search — Reverse‑Engineered API Reference

> Research notes captured by inspecting live network traffic on `www.webnovel.com` (desktop, server‑rendered) and `m.webnovel.com` (mobile SPA that calls JSON APIs). The goal is to build a static, GitHub‑Pages‑hostable **advanced live search** page on top of these endpoints.

---

## 1. TL;DR — what powers WebNovel search

| Surface | URL the user sees | How it actually gets data |
|---|---|---|
| Desktop keyword search | `www.webnovel.com/search?keywords=...&type=novel` | **Server‑side rendered** HTML. Same data is available as JSON from `/go/pcm/search/result`. |
| Desktop tag pages | `www.webnovel.com/tags/naruto-novel`, `/tags/naruto-fanfic` | **Server‑side rendered** HTML, `Popular` / `New` sort via query param. |
| Mobile advanced tag picker | `m.webnovel.com/search/advancedTags` | SPA → `GET /go/pcm/search/get-tag-list?categoryType=...` |
| Mobile advanced results | `m.webnovel.com/search/advancedResult?...` | SPA → `GET /go/pcm/search/get-search-list?...` |
| Mobile keyword search | `m.webnovel.com/search?keywords=...&type=novel` | SPA → `GET /go/pcm/search/result?...` |

**The 4 JSON endpoints we care about all live under the same base path and are the real engine behind everything:**

```
https://www.webnovel.com/go/pcm/search/...      (works on www and m subdomains)
https://m.webnovel.com/go/pcm/search/...
```

All of them are plain `GET` requests returning `{"code":0,"data":{...},"msg":"Success"}`.

---

## 2. Authentication / required plumbing

Every `/go/pcm/...` call needs a **CSRF token** passed as the `_csrfToken` query parameter. Its value must equal the `_csrfToken` cookie that WebNovel sets on first visit.

```
?_csrfToken=Vbgn6UvdxNGjeS2ig5L7oXIdfOqiGtVYaeZwgoF4
```

Key facts discovered:

- **No login required.** Anonymous visitors get a `_csrfToken` cookie and can call all search endpoints.
- The token is **stable per browser session** (cookie‑backed). A fresh visit to any WebNovel page mints one.
- Requests also send `webnovel-content-language: en` and trace headers, but those are **not required** for the search endpoints to return data (the token + cookie are what matter).
- **Cloudflare** protects the site. Plain `curl` / `Invoke-WebRequest` get a "Just a moment…" JS challenge and are blocked. A real browser (or a server that solves/inherits the cookie) is needed.

### ⚠️ Feasibility for a GitHub‑Pages‑only site — TESTED

I ran live cross‑origin tests from a neutral origin (`https://example.com`) against the API. Results:

| Test | Origin | `_csrfToken` | Cookie sent | Result |
|---|---|---|---|---|
| Baseline | `www.webnovel.com` (same‑origin) | valid | yes | **200** `{"code":0,...}` ✅ |
| Invalid token | `www.webnovel.com` (same‑origin) | wrong | yes | **200** `{"code":1,...,"msg":"Fail"}` |
| Cross‑origin, no creds | `example.com` | valid | no | **400** `{}` ❌ |
| Cross‑origin, with creds | `example.com` | valid | (SameSite blocks) | **400** `{}` ❌ |

**What this proves:**

1. **CORS is *open*** — the `400` response was *readable* from `example.com` (a true CORS block would throw `TypeError: Failed to fetch` and hide the status). So WebNovel's edge does return permissive `Access-Control-Allow-Origin`.
2. **But there is an Origin/CSRF gate.** A cross‑origin request is rejected with `400 {}` *before* reaching the normal app handler (which would otherwise return `200 {"code":1,...}`). A **valid** token does **not** help cross‑origin. This gate keys off the `Origin`/`Referer` header and/or the `SameSite` `_csrfToken` cookie — **none of which a browser page on another origin can set or spoof.**
3. **Pasting a token does NOT fix it.** The blocker is the request's *origin*, not the token value. So the "ask the user to paste their token" idea is not enough on its own.

**Public CORS proxies were also tested and do NOT work:**
- `api.allorigins.win` → returns Cloudflare's *"Just a moment…"* JS challenge (server‑side fetches get bot‑walled).
- `corsproxy.io` → `403 "Free usage is limited to localhost and development environments"` (no longer free for production).

**Conclusion:** A page hosted **only** on GitHub Pages **cannot** call these WebNovel endpoints directly from the browser, and free public proxies don't work either (Cloudflare bot challenge + paywalls). See §6 for the realistic options.

---

## 3. Endpoint reference

### 3.1 Keyword search — `GET /go/pcm/search/result`

The engine behind both desktop `/search` and mobile keyword search.

**Query parameters**

| Param | Required | Example | Meaning |
|---|---|---|---|
| `_csrfToken` | yes | `Vbgn...` | CSRF token (== cookie) |
| `keywords` | yes | `naruto` | Free‑text query (title / author / tag) |
| `type` | yes | `novel` | Content type: `novel`, `fanfic`, `manga` |
| `orderBy` | no | `1` | Sort order (`1` = default/relevance; other values map to popularity/rating/updated) |
| `pageIndex` | no | `1` | Page number (results are paginated) |

**Response shape**

```jsonc
{
  "code": 0,
  "data": {
    "bookInfo": {
      "total": 185,          // total matches
      "isLast": 0,           // 0 = more pages, 1 = last page
      "bookItems": [
        {
          "bookId": "16007634306765005",
          "bookName": "The Adventures of Naruto & Scarlet",
          "novelType": 0,
          "description": "….",
          "categoryId": 70016,
          "categoryName": "FANTASY",
          "authorName": "BlueObserver",
          "totalScore": 4.63,         // average rating (0–5)
          "translateMode": -1,
          "tagInfo": [
            { "id": 41000069, "tagName": "NARUTO", "enTagName": "NARUTO", "likeCount": 117, "like": false },
            { "id": 41000125, "tagName": "REBIRTH", "enTagName": "REBIRTH", "likeCount": 75,  "like": false }
          ],
          "coverUpdateTime": 1581259384024
        }
        // …
      ]
    }
  },
  "msg": "Success"
}
```

> **Cover image URL pattern:** book covers are served from WebNovel's image CDN keyed by `bookId` (and busted by `coverUpdateTime`), e.g.
> `https://book-pic.webnovel.com/bookcover/{bookId}` (mobile) / `https://img.webnovel.com/bookcover/{bookId}/...`. Confirm the exact host against a rendered `<img>` when building the UI.

---

### 3.2 Tag catalog — `GET /go/pcm/search/get-tag-list`

Returns the grouped tag taxonomy used to build the advanced‑filter UI (the `setting / plot / character / tone …` groups in the mobile picker).

**Query parameters**

| Param | Required | Example | Meaning |
|---|---|---|---|
| `_csrfToken` | yes | `Vbgn...` | CSRF token |
| `categoryType` | yes | `1` | **`1` = Novel**, **`4` = Fanfic**. (`2` returns `{"code":1,...,"msg":"Fail"}`.) |

**Response shape**

```jsonc
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": 100003,
        "name": "setting",       // tag group / facet name
        "totalCount": 82,        // number of tags in this group
        "tagInfos": [
          { "id": 41000016, "tagName": "system",     "enTagName": "", "likeCount": 0, "like": false },
          { "id": 41000884, "tagName": "magic",       "enTagName": "", "likeCount": 0, "like": false },
          { "id": 41000147, "tagName": "r18",         "enTagName": "", "likeCount": 0, "like": false },
          { "id": 41001330, "tagName": "superpowers", "enTagName": "", "likeCount": 0, "like": false },
          { "id": 41000224, "tagName": "cultivation", "enTagName": "", "likeCount": 0, "like": false }
          // …
        ]
      }
      // groups: setting (82), plot (67), character (87), tone (17), …
    ]
  },
  "msg": "Success"
}
```

- Each tag's `id` (e.g. `41000884` = *magic*) is what you feed into the results endpoint as `tagId` / `negTagId`.
- The mobile UI also offers `Popular` vs `A‑Z` ordering of tags **client‑side** (the API returns them in popularity order).

---

### 3.3 Advanced tag search — `GET /go/pcm/search/get-search-list`

The core of the advanced search. Returns books matching included/excluded tags.

**Query parameters**

| Param | Required | Example | Meaning |
|---|---|---|---|
| `_csrfToken` | yes | `Vbgn...` | CSRF token |
| `sex` | yes | `1` | Audience orientation: **`1` = male‑oriented**, **`2` = female‑oriented**. Changes the candidate pool & ranking. |
| `categoryType` | yes | `1` | `1` = Novel, `4` = Fanfic (same mapping as tag catalog) |
| `tagId` | yes | `41000884` or `41000884,41000121` | Included tag id(s). **Comma‑separated = AND** (book must have all). |
| `negTagId` | no | `41000010` | Excluded tag id(s), comma‑separated. Books with these are filtered out. |
| `pageIndex` | yes | `1` | Page number |
| `orderBy` | no | `2` | Sort order (changes ranking; `1`/`2`/… ≈ popular / rating / updated) |

**Response shape**

```jsonc
{
  "code": 0,
  "data": {
    "bookInfos": [
      {
        "bookId": "22196546206090805",
        "bookName": "Shadow Slave",
        "categoryId": 70002,
        "categoryName": "Fantasy",
        "categoryType": 1,
        "authorName": "Guiltythree",
        "coverUpdateTime": 1705256017438,
        "totalScore": 4.71,
        "tagInfos": [
          { "id": 41000884, "tagName": "MAGIC",   "enTagName": "", "likeCount": 0, "like": false }
          // …
        ],
        "description": "….",
        "pvNum": 105399003,        // total views
        "chapterNum": 3048,        // chapter count
        "mtl": false,              // machine‑translated flag
        "collectionNum": 858372,   // # of users who added to library
        "bookType": 0,
        "inLibrary": 0
      }
      // …
    ],
    "totalCount": 10000,           // total matches (appears capped at 10000)
    "last": false,                 // true on final page
    "pageIndex": 1,
    "chapterConfigItems": [        // available "chapter count" filter buckets
      { "ChapterNum": "<300",      "ChapterCode": 1 },
      { "ChapterNum": "300-1000",  "ChapterCode": 2 },
      { "ChapterNum": ">1000",     "ChapterCode": 3 }
    ]
  },
  "msg": "Success"
}
```

- `chapterConfigItems` strongly implies an extra **chapter‑count filter** parameter (e.g. `chapterNum` / `chapterCode` = `1|2|3`). Worth probing when implementing — pass the `ChapterCode` value.
- A **completion/status filter** (ongoing vs completed) likely exists too; check the mobile UI's filter bar and capture the param if you need it.
- `totalCount` is capped at `10000` for broad queries.

---

### 3.4 Trending / hot searches — `GET /go/pcm/search/getHotSearch`

Used to seed the empty search box with suggestions.

```jsonc
{
  "code": 0,
  "data": {
    "items": [
      { "type": 1, "id": "8212987205006305",  "name": "Trial Marriage Husband: Need to Work Hard", "enName": "" },
      { "type": 1, "id": "11005006906230105", "name": "Release that Man",     "enName": "" },
      { "type": 1, "id": "7834223205001705",  "name": "I'm Really a Superstar","enName": "" }
    ]
  },
  "msg": "Success"
}
```

Only needs `_csrfToken`.

---

## 4. Known id mappings (cheat sheet)

| Concept | Param | Values seen |
|---|---|---|
| Content type (keyword search) | `type` | `novel`, `fanfic`, `manga` |
| Content type (tag endpoints) | `categoryType` | `1` = Novel, `4` = Fanfic (`2` = invalid) |
| Audience | `sex` | `1` = male‑oriented, `2` = female‑oriented |
| Chapter count buckets | `ChapterCode` | `1` = `<300`, `2` = `300–1000`, `3` = `>1000` |
| Example tag ids | `tagId` | `41000884` magic · `41000121` action · `41000010` romance · `41000016` system · `41000069` naruto · `41001330` superpowers · `41000224` cultivation |

> Tag ids in the `41xxxxxx` and `51xxxxxx` ranges both appear; treat the id as an opaque integer from `get-tag-list`.

---

## 5. Response envelope (all endpoints)

```jsonc
{
  "code": 0,          // 0 = success, 1 = failure
  "data": { … },      // null on failure
  "msg": "Success"    // or "Fail"
}
```

Always check `code === 0` before reading `data`.

---

## 6. Hosting options (given "GitHub Pages only, nothing paid")

Ranked by how close they stay to the constraint. **A pure GitHub‑Pages‑only build is not achievable** for the `www`/`m` web endpoints (proven in §2). Realistic free paths:

### Option A — GitHub Pages UI + free **Cloudflare Worker** proxy *(recommended)*
- The Worker is **free** (100k requests/day), not a server you run, deployed in minutes.
- It forges `Origin`/`Referer: https://www.webnovel.com`, attaches a `_csrfToken`, and returns `Access-Control-Allow-Origin: *`.
- **Caveat to verify:** the Worker's `fetch` to WebNovel may itself hit Cloudflare's bot challenge. If so, the Worker needs a `_csrfToken` (+ possibly `cf_clearance`) value harvested once from a real browser and refreshed periodically — exactly the "paste a token occasionally" UX you mentioned, but stored in the Worker instead of the page.
- Net: ~30 lines of Worker code + the static UI. Stays free; one tiny non‑GitHub piece.

### Option B — WebNovel's **mobile‑app / legacy API** — ❌ **INVESTIGATED, dead end**
Tested cross‑origin from `https://example.com` with a valid token:
- `/apiajax/search/AutoCompleteApi` and `/apiajax/search/SearchAjax` → **hard CORS block** (`No 'Access-Control-Allow-Origin' header`).
- `/go/pcm/search/*` → same `400 {}` origin gate.
- The most‑maintained open‑source WebNovel client (LNReader `plugins/english/webnovel.ts`) uses **no JSON API at all** — it scrapes the HTML of `/search?keywords=…` and category pages, and only works because it runs in a **native app where CORS isn't enforced**.

**Conclusion:** there is no origin‑agnostic, CORS‑open WebNovel JSON endpoint. A pure browser‑only GitHub Pages page cannot call WebNovel live. (Confirmed three independent ways: direct call, legacy `/apiajax`, community clients.)

### Option B′ — **GitHub Actions pre‑crawl → static JSON** *(truly GitHub‑only, $0, recommended for tag search)*
Sidesteps CORS/CSRF completely because at runtime the page only reads **its own static files**.
- A scheduled **GitHub Actions** workflow (free on public repos) runs **Playwright** (a real browser → passes Cloudflare, holds the cookie, satisfies the origin gate), calls the 4 documented APIs, and commits JSON into the repo: `data/tags-novel.json`, `data/tags-fanfic.json`, `data/books-index.json`.
- GitHub Pages serves the JSON; the page does **client‑side** filter/search over it — instant, no runtime call to WebNovel.
- **Trade‑off:** periodic **snapshot**, not live; you mirror a **bounded subset** (the full catalog is too large for one JSON). Ideal for the advanced **tag filter** + a sizable cached book index; not for arbitrary live keyword search of every book.
- Refresh cadence = workflow schedule (e.g. `cron` every 6–24 h).

### Option C — Public CORS proxy — **does not work** (tested)
- allorigins → Cloudflare challenge; corsproxy.io → free tier blocked. Don't rely on these.

### Option D — Other free serverless (Vercel/Netlify/Deno Deploy functions)
- Same role as the Worker, all have free tiers. Same Cloudflare caveat as Option A.

```
Option A:
┌─────────────────────────┐   fetch JSON     ┌────────────────────────┐  forged Origin+token  ┌──────────────────┐
│  GitHub Pages (static)  │ ───────────────▶ │  Cloudflare Worker     │ ────────────────────▶ │  webnovel.com    │
│  HTML + JS UI           │   CORS: *        │  (free, ~30 lines)     │ ◀──────────────────── │  /go/pcm/search/ │
└─────────────────────────┘ ◀─────────────── └────────────────────────┘                       └──────────────────┘
```

**Front‑end flow (same regardless of proxy)**
1. On load: `GET /api/get-tag-list?categoryType=1` (and `=4`) → build the include/exclude tag chips, grouped by facet.
2. Live keyword box: debounce input → `GET /api/result?keywords=...&type=novel&pageIndex=1`.
3. Advanced mode: collect selected include tag ids → `tagId=a,b,c`, exclude ids → `negTagId=x,y`, plus `sex`, `categoryType`, `orderBy`, `pageIndex` → `GET /api/get-search-list?...`.
4. Infinite scroll / pagination: increment `pageIndex` until `last === true` (advanced) or `isLast === 1` (keyword).
5. Render: cover (`bookId`), `bookName`, `authorName`, `totalScore`, `chapterNum`, `pvNum`, tag chips; link to `https://www.webnovel.com/book/{bookId}`.

**Proxy responsibilities (Options A/D)**
- Send `Referer`/`Origin: https://www.webnovel.com` and a valid `_csrfToken` (matching cookie if required).
- Whitelist only the 4 search paths.
- Add `Access-Control-Allow-Origin: *` (or your Pages origin) and cache responses briefly.

---

## 7. Open items to confirm during implementation
- **Does a Cloudflare Worker `fetch` pass WebNovel's Cloudflare challenge?** (Decides whether Option A is turnkey or needs a periodically‑refreshed token.)
- ~~Mobile‑app API (Option B)~~ — investigated, no CORS‑open endpoint exists.
- Exact `orderBy` value → label mapping (popular / rating / new / most‑collected).
- The precise param name for the chapter‑count filter (`chapterCode`?) and any status/completion filter.
- Whether `get-search-list` accepts `keywords` too (combined tag + text search).
- Canonical cover‑image host (`book-pic.webnovel.com` vs `img.webnovel.com`) and size suffixes.
- Page size returned per `pageIndex` (for UI paging math).
