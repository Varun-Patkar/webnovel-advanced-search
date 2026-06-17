# WebNovel Advanced Search

A fast, **client-side advanced search** for [WebNovel](https://www.webnovel.com),
hosted entirely on **GitHub Pages**. Filter a snapshot of WebNovel's catalogue by
**included/excluded tags**, type (novel/fanfic), rating, chapter count and
keyword — all instantly in the browser.

**🔎 Live site: https://varun-patkar.github.io/webnovel-advanced-search/**

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

WebNovel's own search APIs reject cross-origin browser calls (CORS/CSRF origin
gate) and sit behind Cloudflare, so a static page cannot call them live. This
project works around that with an **on-demand snapshot crawler**: a local
Playwright run drives a real browser, pulls the data through WebNovel's internal
endpoints *same-origin*, and writes compact JSON committed into the repo. The
static site then searches those JSON files — no backend, no proxy, no runtime
CORS. See [API_RESEARCH.md](API_RESEARCH.md) for the full reverse-engineering
write-up and why this is the approach.

> ⚠️ Results are a **periodic, bounded snapshot** (a cached subset), not live
> data. Unaffiliated with WebNovel; for personal use.

## How it works

```
Your PC (on demand)                GitHub Pages (static)
┌───────────────────────┐         ┌────────────────────────┐
│ Playwright crawler     │  JSON   │ index.html + JS         │
│ → webnovel.com (same-  │ ──────▶ │ client-side filter over │
│   origin API calls)    │ commit  │ data/*.json             │
└───────────────────────┘  +push  └────────────────────────┘
```

There is **no CI / GitHub Actions**. You refresh the snapshot by running the
crawler on your own machine whenever you want fresh data, then commit & push the
regenerated `data/*.json`. GitHub Pages redeploys automatically.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html`, `assets/` | The static GitHub Pages site (UI). |
| `assets/js/data.js` | Loads the snapshot JSON. |
| `assets/js/search.js` | Pure filter/sort logic. |
| `assets/js/ui.js` | DOM rendering. |
| `assets/js/app.js` | State + event wiring. |
| `scripts/crawl.mjs` | Playwright snapshot crawler. |
| `scripts/webnovel-api.mjs` | Same-origin API client. |
| `scripts/config.mjs` | Crawl configuration (env-overridable). |
| `scripts/serve.mjs` | Local static preview server. |
| `data/*.json` | Generated snapshot (you commit this). |

## Refreshing the snapshot (on demand, on your PC)

There is no scheduler and no CI — you run it when you want fresh data:

```powershell
npm run crawl                 # full crawl: all 253 novel + 661 fanfic tags
git add data/ ; git commit -m "refresh snapshot" ; git push
```

GitHub Pages redeploys the new `data/*.json` automatically.

### Crawl settings (environment variables)

All optional; sensible defaults are used when unset. The crawler prints its
effective settings at startup so a stray leftover variable is obvious.

| Variable | Default | Meaning |
|---|---|---|
| `WN_CATEGORY_TYPES` | `1,4` | `1` = Novel, `4` = Fanfic. |
| `WN_SEXES` | `1,2` | Audience pools merged (1 male / 2 female), de-duplicated. |
| `WN_MAX_PAGES_PER_TAG` | `1` | Result pages per tag — the main size/time lever. |
| `WN_MAX_TAGS_PER_CATEGORY` | `0` | Tags per category (`0` = **all**). |
| `WN_HEADLESS` | `1` | `0` to watch the browser work. |
| `WN_CHANNEL` | `chrome` | `""` to force bundled Chromium. |

> ⚠️ **PowerShell gotcha:** env vars set with `$env:NAME=...` persist for the
> whole terminal session. If a crawl only returns a handful of books, you
> probably still have `WN_MAX_TAGS_PER_CATEGORY=1` set from an earlier test —
> clear it with `Remove-Item Env:\WN_MAX_TAGS_PER_CATEGORY` or open a new
> terminal. The startup "Settings:" line shows the value in effect.

> **Cloudflare note:** WebNovel is behind Cloudflare, whose managed challenge
> *loops* against automation. The crawler avoids this by driving your **real
> installed Google Chrome** (not bundled Chromium) with a **persistent profile**
> (`.wn-profile/`) so `cf_clearance` is reused between runs.

## Running locally

```bash
npm install
npx playwright install chrome      # real Chrome channel (beats Cloudflare)

# Quick test crawl (1 tag per category) so you can see real data fast:
WN_MAX_TAGS_PER_CATEGORY=1 npm run crawl

# Full crawl (all tags, both categories):
npm run crawl

# Preview the site exactly as GitHub Pages serves it:
npm run serve   # http://localhost:8080
```

Set `WN_HEADLESS=0` to watch it, or `WN_CHANNEL=""` to force bundled Chromium.

On Windows PowerShell, set env vars inline (remember they persist for the
session):

```powershell
$env:WN_MAX_TAGS_PER_CATEGORY=1; npm run crawl
```

## Enabling GitHub Pages

In **Settings → Pages**, set **Source = Deploy from a branch**, branch =
your default branch, folder = **`/ (root)`**. The site is plain static files at
the repo root, so no build step is needed.

## Contributing — keep the data fresh 🙏

The book data is a **snapshot** committed in `data/*.json`. The site shows its
**“last refreshed”** date in the header, so it's obvious when the data is
getting stale.

**Anyone is welcome to refresh it** — you don't need to ask. If you find the
snapshot is old and you'd like newer data:

1. Fork the repo (or clone it).
2. Run a full crawl on your machine:
   ```powershell
   npm install
   npx playwright install chrome
   npm run crawl
   ```
3. Commit the regenerated `data/*.json` and open a **pull request**. A one-line
   description like “refresh snapshot YYYY-MM-DD” is plenty.

PRs that only update `data/*.json` are safe to merge as-is.

> ℹ️ **Maintenance is best-effort / community-driven.** The original author may
> refresh it occasionally — or may forget this project entirely. There is no
> schedule and no server keeping it up to date. If the data looks stale, that's
> your cue to run the crawl and send a PR. The whole point of the design is that
> refreshing is a 10-minute, zero-cost task anyone can do.

## Notes & limitations

- The full WebNovel catalogue is too large to mirror; the snapshot is whatever
  the crawl covers (popular books across the crawled tags). Increase
  `max_pages_per_tag` for broader coverage at the cost of size.
- Tag ids, endpoints and field meanings are documented in
  [API_RESEARCH.md](API_RESEARCH.md).

## License

[MIT](LICENSE) © 2026 Varun Anand Patkar.

This project is an unofficial, fan-made tool and is **not affiliated with,
endorsed by, or connected to WebNovel / Cloudary**. All book metadata belongs to
its respective owners; this repo only caches a small public subset for search.
