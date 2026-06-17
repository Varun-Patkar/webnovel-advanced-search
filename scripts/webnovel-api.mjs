/**
 * webnovel-api.mjs
 * -----------------------------------------------------------------------------
 * Thin client for WebNovel's internal search endpoints (see API_RESEARCH.md).
 *
 * Crucial design point: every request is executed *inside* a real browser page
 * via `page.evaluate(fetch(...))`. Because that page is loaded on
 * `www.webnovel.com`, the fetch is **same-origin** — it carries the
 * `_csrfToken` cookie automatically and is not rejected by the cross-origin
 * `400` gate that blocks foreign callers. This is the entire reason the crawler
 * works where a static GitHub Pages page cannot.
 *
 * All endpoints return the envelope: { code: 0, data: {...}, msg: "Success" }.
 */

/**
 * Sleep helper for politeness delays.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the `_csrfToken` value from the loaded page's cookies.
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
export async function readCsrfToken(page) {
  return page.evaluate(() => {
    const match = document.cookie.match(/_csrfToken=([^;]+)/);
    return match ? match[1] : null;
  });
}

/**
 * Perform a single same-origin GET against a /go/pcm/search endpoint and return
 * the parsed JSON envelope. Runs entirely inside the page context.
 *
 * @param {import('playwright').Page} page
 * @param {string} path  Endpoint path, e.g. "search/get-tag-list".
 * @param {Record<string, string|number>} params  Query params (token added by caller).
 * @returns {Promise<{status:number, json:any}>}
 */
async function apiGet(page, path, params) {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `/go/pcm/${path}?${query}`;

  return page.evaluate(async (u) => {
    const res = await fetch(u, {
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'webnovel-content-language': 'en',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }, url);
}

/**
 * Retry wrapper around {@link apiGet}. Treats any response whose envelope code
 * is not 0 (or any thrown/HTTP error) as a retryable failure.
 *
 * @param {import('playwright').Page} page
 * @param {string} path
 * @param {Record<string, string|number>} params
 * @param {{maxRetries:number, delayMs:number}} opts
 * @returns {Promise<any|null>}  The `data` object on success, else null.
 */
async function apiGetWithRetry(page, path, params, opts) {
  for (let attempt = 1; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const { status, json } = await apiGet(page, path, params);
      if (status === 200 && json && json.code === 0) {
        return json.data;
      }
      // Non-fatal: log and back off before retrying.
      console.warn(
        `  [retry ${attempt}/${opts.maxRetries}] ${path} -> status=${status} code=${json?.code}`,
      );
    } catch (err) {
      console.warn(`  [retry ${attempt}/${opts.maxRetries}] ${path} threw: ${err.message}`);
    }
    await sleep(opts.delayMs * attempt);
  }
  return null;
}

/**
 * Fetch the grouped tag catalogue for a category type.
 * @param {import('playwright').Page} page
 * @param {string} token  CSRF token.
 * @param {number} categoryType  1 = novel, 4 = fanfic.
 * @param {{maxRetries:number, delayMs:number}} opts
 * @returns {Promise<Array<{id:number,name:string,totalCount:number,tagInfos:any[]}>>}
 */
export async function getTagList(page, token, categoryType, opts) {
  const data = await apiGetWithRetry(
    page,
    'search/get-tag-list',
    { _csrfToken: token, categoryType },
    opts,
  );
  return data?.items ?? [];
}

/**
 * Fetch one page of advanced tag-search results.
 * @param {import('playwright').Page} page
 * @param {string} token  CSRF token.
 * @param {object} q  Query: { sex, categoryType, tagId, negTagId, pageIndex, orderBy }.
 * @param {{maxRetries:number, delayMs:number}} opts
 * @returns {Promise<{books:any[], last:boolean, total:number}>}
 */
export async function getSearchList(page, token, q, opts) {
  const data = await apiGetWithRetry(
    page,
    'search/get-search-list',
    {
      _csrfToken: token,
      sex: q.sex,
      categoryType: q.categoryType,
      tagId: q.tagId,
      negTagId: q.negTagId ?? '',
      pageIndex: q.pageIndex,
      orderBy: q.orderBy,
    },
    opts,
  );
  if (!data) return { books: [], last: true, total: 0 };
  return {
    books: data.bookInfos ?? [],
    last: Boolean(data.last),
    total: data.totalCount ?? 0,
  };
}
