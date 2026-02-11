/**
 * Phase 1: Discover "print on demand" apps from Shopify App Store search.
 * Saves checkpoint to data/apps.json.
 */
const puppeteer = require('puppeteer');
const { SEARCH, DELAY, USER_AGENT } = require('./config');
const { delay, retry, loadCheckpoint, saveCheckpoint, log } = require('./utils');

const SEARCH_QUERY = 'print on demand';

/**
 * Extract app list from current page (app cards with data attributes or links).
 */
async function extractAppsFromPage(page) {
  return page.evaluate((config) => {
    const cards = document.querySelectorAll(config.appCard);
    const seen = new Set();
    const apps = [];
    cards.forEach((el) => {
      const handle = el.getAttribute(config.appHandleAttr);
      const name = el.getAttribute(config.appNameAttr);
      if (!handle || seen.has(handle)) return;
      // Skip non-app routes
      if (/^(categories|stories|search|login|partner)/.test(handle)) return;
      seen.add(handle);
      apps.push({ name: name || handle, slug: handle });
    });
    // Fallback: any link to /slug that looks like an app (single path segment, not categories/stories)
    if (apps.length === 0) {
      document.querySelectorAll('a[href^="/"]').forEach((a) => {
        const href = a.getAttribute('href');
        const match = href.match(/^\/([^/?]+)/);
        if (!match) return;
        const slug = match[1];
        if (/^(categories|stories|search|login|partner|cdn|\.well-known)/.test(slug)) return;
        if (seen.has(slug)) return;
        seen.add(slug);
        const name = a.textContent.trim().split('\n')[0].trim() || slug;
        if (name.length > 0 && name.length < 200) apps.push({ name, slug });
      });
    }
    return apps;
  }, SEARCH);
}

/**
 * Collect apps from paginated search results.
 */
async function collectAllApps(page, baseUrl) {
  const allApps = [];
  const seen = new Set();
  let pageNum = 1;
  const maxPages = SEARCH.maxPages;

  while (pageNum <= maxPages) {
    log(`  Search page ${pageNum}...`);
    
    // Scroll to load any lazy content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000, 2000);

    const batch = await extractAppsFromPage(page);
    let newCount = 0;
    for (const app of batch) {
      if (!seen.has(app.slug)) {
        seen.add(app.slug);
        allApps.push(app);
        newCount++;
      }
    }
    log(`  Found ${batch.length} apps (${newCount} new), total: ${allApps.length}`);

    if (newCount === 0 && pageNum > 1) break;

    // Check for next page using config selector
    const nextPageUrl = await page.evaluate((selector) => {
      const nextLink = document.querySelector(selector);
      return nextLink ? nextLink.href : null;
    }, SEARCH.nextPageLink).catch(() => null);

    if (!nextPageUrl) {
      log(`  No more pages found.`);
      break;
    }

    // Navigate to next page
    pageNum++;
    await retry(async () => {
      await page.goto(nextPageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    });
    await delay(DELAY.minMs, DELAY.maxMs);
  }

  return allApps;
}

/**
 * Discover all apps from search results; optionally resume from checkpoint.
 */
async function discoverApps(options = {}) {
  const { headless = true, resume = true } = options;
  const checkpoint = resume ? loadCheckpoint('apps.json') : null;
  if (checkpoint && Array.isArray(checkpoint) && checkpoint.length > 0) {
    log(`Resuming: found ${checkpoint.length} apps in checkpoint.`);
    return checkpoint;
  }

  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });

    const url = SEARCH.url(SEARCH_QUERY);
    log(`Navigating to ${url}`);
    await retry(async () => {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    });
    await delay(DELAY.minMs, DELAY.maxMs);

    // Wait for app cards or main content
    await page.waitForSelector('main, [data-app-card-handle-value], .tw-grid', { timeout: 15000 }).catch(() => {});

    const apps = await collectAllApps(page, url);

    if (apps.length === 0) {
      log('No apps found. Trying single page extraction...');
      const singlePage = await extractAppsFromPage(page);
      apps.push(...singlePage);
    }

    const unique = [];
    const bySlug = new Map();
    for (const a of apps) {
      if (!bySlug.has(a.slug)) {
        bySlug.set(a.slug, a);
        unique.push(a);
      }
    }

    log(`Discovered ${unique.length} apps.`);
    saveCheckpoint('apps.json', unique);
    return unique;
  } finally {
    await browser.close();
  }
}

module.exports = { discoverApps, extractAppsFromPage };
