/**
 * Phase 2: Scrape reviews for a single app (or all apps).
 * Paginates via ?page=1, ?page=2, ... and extracts review fields.
 */
const puppeteer = require('puppeteer');
const { REVIEWS, PAGINATION, DELAY, USER_AGENT } = require('./config');
const {
  delay,
  retry,
  loadCheckpoint,
  saveCheckpoint,
  saveAppReviews,
  log,
} = require('./utils');

/**
 * Parse total review count from page (heading or JSON-LD).
 */
async function getTotalReviewCount(page) {
  const fromJsonLd = await page.evaluate(() => {
    const script = document.querySelector('script[type="application/ld+json"]');
    if (!script) return null;
    try {
      const data = JSON.parse(script.textContent);
      const rating = data?.aggregateRating || data?.['@graph']?.find((n) => n?.aggregateRating);
      return rating?.ratingCount ? parseInt(rating.ratingCount, 10) : null;
    } catch {
      return null;
    }
  });
  if (fromJsonLd != null) return fromJsonLd;

  const fromHeading = await page.evaluate(() => {
    const h2 = document.querySelector('h2 .tw-text-body-md');
    if (!h2) return null;
    const text = h2.textContent.replace(/,/g, '').replace(/\s*\(([\d]+)\)\s*/, '$1');
    const n = parseInt(text, 10);
    return Number.isNaN(n) ? null : n;
  });
  return fromHeading;
}

/**
 * Extract review entries from the current page.
 */
async function extractReviewsFromPage(page, appName, appSlug) {
  return page.evaluate(
    ({ appName, appSlug }) => {
      const blocks = document.querySelectorAll('div[data-merchant-review]');
      const results = [];
      blocks.forEach((block) => {
        const ratingEl = block.querySelector('div[aria-label*="out of 5 stars"]');
        let rating = null;
        if (ratingEl) {
          const aria = ratingEl.getAttribute('aria-label') || '';
          const m = aria.match(/(\d)\s*out of 5/);
          if (m) rating = parseInt(m[1], 10);
        }

        const headerMeta = block.querySelector('.tw-order-2 .tw-text-body-xs.tw-text-fg-tertiary');
        const reviewDate = headerMeta ? headerMeta.textContent.trim() : '';

        const textEl = block.querySelector('[data-truncate-review] [data-truncate-content-copy], [data-truncate-review]');
        let reviewText = '';
        if (textEl) {
          const p = textEl.querySelector('p');
          if (p) reviewText = p.innerText.replace(/\s+/g, ' ').trim();
          else reviewText = textEl.innerText.replace(/\s+/g, ' ').trim();
        }

        const nameEl = block.querySelector('.tw-text-heading-xs.tw-text-fg-primary span[title]');
        const reviewerName = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent.trim()) : '';

        const sidebar = block.querySelector('.tw-order-1.lg\\:tw-order-1 .tw-space-y-1');
        let reviewerLocation = '';
        let usageDuration = '';
        if (sidebar) {
          const children = Array.from(sidebar.children).filter((el) => el.tagName === 'DIV');
          children.forEach((d) => {
            const t = d.textContent.trim();
            if (!t || d.querySelector('.tw-text-heading-xs')) return;
            if (/using the app|year|month|day/.test(t)) usageDuration = t;
            else reviewerLocation = reviewerLocation || t;
          });
        }

        let developerResponse = '';
        let developerResponseDate = '';
        const replyBlock = block.querySelector('[data-merchant-review-reply] [id^="review-reply-"]');
        if (replyBlock) {
          const dateEl = replyBlock.querySelector('.tw-text-body-xs.tw-text-fg-tertiary.tw-mb-sm');
          if (dateEl) {
            const full = dateEl.textContent.trim();
            const dateMatch = full.replace(/^\s*.*?replied\s*/i, '').trim();
            developerResponseDate = dateMatch;
          }
          const copyEl = replyBlock.querySelector('[data-truncate-content-copy], [data-reply-id]');
          if (copyEl) {
            const p = copyEl.querySelector('p');
            if (p) developerResponse = p.innerText.replace(/\s+/g, ' ').trim();
            else developerResponse = copyEl.innerText.replace(/\s+/g, ' ').trim();
          }
        }

        results.push({
          app_name: appName,
          app_slug: appSlug,
          reviewer_name: reviewerName,
          reviewer_location: reviewerLocation,
          rating: rating != null ? rating : '',
          review_date: reviewDate,
          usage_duration: usageDuration,
          review_text: reviewText,
          developer_response: developerResponse,
          developer_response_date: developerResponseDate,
        });
      });
      return results;
    },
    { appName, appSlug }
  );
}

/**
 * Scrape all review pages for one app.
 */
async function scrapeAppReviews(browser, app, options = {}) {
  const { delayMin = DELAY.minMs, delayMax = DELAY.maxMs } = options;
  const { name: appName, slug: appSlug } = app;
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1280, height: 800 });

  try {
    const url = REVIEWS.url(appSlug);
    log(`  Opening ${appSlug} reviews: ${url}`);
    await retry(async () => {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    });
    await delay(delayMin, delayMax);

    const totalCount = await getTotalReviewCount(page);
    const totalPages = totalCount != null
      ? Math.ceil(totalCount / PAGINATION.reviewsPerPage)
      : null;
    if (totalCount != null) log(`  Total reviews: ${totalCount}, pages: ~${totalPages}`);

    const allReviews = [];
    let pageNum = 1;
    const maxPages = totalPages != null ? totalPages : 500;

    while (pageNum <= maxPages) {
      if (pageNum > 1) {
        const pageUrl = REVIEWS.urlPage(appSlug, pageNum);
        await retry(async () => {
          await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        });
        await delay(delayMin, delayMax);
      }

      const batch = await extractReviewsFromPage(page, appName, appSlug);
      allReviews.push(...batch);
      log(`  Page ${pageNum}: ${batch.length} reviews (total: ${allReviews.length})`);

      if (batch.length === 0) break;
      if (totalPages != null && pageNum >= totalPages) break;
      const nextLink = await page.$('[data-pagination-controls] a[rel="next"]');
      if (!nextLink) break;
      pageNum++;
    }

    return allReviews;
  } finally {
    await page.close();
  }
}

/**
 * Scrape reviews for all apps. Uses checkpoint to skip already-scraped apps.
 */
async function scrapeAllReviews(apps, options = {}) {
  const { headless = true, resume = true, startFromSlug = null } = options;
  const scraped = resume ? loadCheckpoint('scraped_app_slugs.json', []) : [];
  const scrapedSet = new Set(Array.isArray(scraped) ? scraped : []);

  const toProcess = startFromSlug
    ? apps.filter((a) => a.slug === startFromSlug || !scrapedSet.has(a.slug))
    : apps.filter((a) => !scrapedSet.has(a.slug));

  if (toProcess.length === 0 && apps.length > 0) {
    log('All apps already scraped (resume). Load existing all_reviews from data/.');
    return loadCheckpoint('all_reviews.json', []);
  }

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const allReviews = resume ? loadCheckpoint('all_reviews.json', []) : [];
  const bySlug = new Map();
  allReviews.forEach((r) => {
    if (!bySlug.has(r.app_slug)) bySlug.set(r.app_slug, []);
    bySlug.get(r.app_slug).push(r);
  });

  try {
    for (let i = 0; i < toProcess.length; i++) {
      const app = toProcess[i];
      log(`[${i + 1}/${toProcess.length}] ${app.name} (${app.slug})`);
      const reviews = await scrapeAppReviews(browser, app, options);
      bySlug.set(app.slug, reviews);
      scrapedSet.add(app.slug);
      saveCheckpoint('scraped_app_slugs.json', [...scrapedSet]);
      saveAppReviews(app.slug, reviews);
      const flat = [];
      bySlug.forEach((arr) => flat.push(...arr));
      saveCheckpoint('all_reviews.json', flat);
    }

    const flat = [];
    bySlug.forEach((arr) => flat.push(...arr));
    return flat;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeAppReviews,
  scrapeAllReviews,
  extractReviewsFromPage,
  getTotalReviewCount,
};
