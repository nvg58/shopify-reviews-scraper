/**
 * Phase 1: Discover "print on demand" apps from Shopify App Store search.
 * Saves checkpoint to data/apps.json.
 */
const puppeteer = require('puppeteer');
const { SEARCH, DELAY, USER_AGENT } = require('./config');
const { delay, retry, loadCheckpoint, saveCheckpoint, log } = require('./utils');

const URL = 'https://apps.shopify.com/categories/finding-products-sourcing-options-print-on-demand-pod/all?search_id=8ee3e6f6-78fe-45cb-9330-e4117f636c4f&surface_detail=finding-products-sourcing-options-print-on-demand-pod&surface_inter_position=2&surface_type=category&surface_version=redesign&page=1';

/**
 * Extract app list from current page (app cards with data attributes or links).
 * Filters out apps with certain keywords or no reviews.
 */
async function extractAppsFromPage(page) {
  return page.evaluate((config) => {
    const cards = document.querySelectorAll(config.appCard);
    const seen = new Set();
    const apps = [];
    const filtered = [];
    const skipKeywords = /drop\s*shipping|dropshipping|personalizer|dropship|product\s*designer/i;
    
    cards.forEach((el) => {
      const handle = el.getAttribute(config.appHandleAttr);
      const name = el.getAttribute(config.appNameAttr);
      if (!handle || seen.has(handle)) return;
      // Skip non-app routes
      if (/^(categories|stories|search|login|partner)/.test(handle)) return;
      seen.add(handle);
      
      // Extract review count from sr-only span with "total reviews"
      let reviewCount = 0;
      const srOnlySpans = el.querySelectorAll('.tw-sr-only');
      for (const span of srOnlySpans) {
        const text = span.textContent;
        if (/total reviews/i.test(text)) {
          const match = text.match(/(\d+)\s+total reviews/i);
          if (match) {
            reviewCount = parseInt(match[1], 10);
            break;
          }
        }
      }
      
      // Check filters and track reason
      let skipReason = null;
      if (skipKeywords.test(name)) {
        skipReason = 'keyword filter';
      } else if (reviewCount === 0) {
        skipReason = 'no reviews';
      }
      
      if (skipReason) {
        filtered.push({ name, slug: handle, reason: skipReason, review_count: reviewCount });
        return;
      }
      
      // Extract description from the card
      let description = '';
      const descDivs = el.querySelectorAll('.tw-text-fg-secondary.tw-text-body-xs');
      for (const div of descDivs) {
        const text = div.textContent.trim();
        // Skip if it's the rating/pricing line (starts with number, contains • or "star")
        if (text && text.length > 15 && !/^\d/.test(text) && !/•|star|out of/i.test(text)) {
          description = text;
          break;
        }
      }
      
      apps.push({ 
        name: name || handle, 
        slug: handle,
        description: description,
        review_count: reviewCount
      });
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
        if (name.length > 0 && name.length < 200 && !skipKeywords.test(name)) {
          apps.push({ name, slug, description: '', review_count: 0 });
        }
      });
    }
    return { apps, filtered };
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

    const result = await extractAppsFromPage(page);
    const batch = result.apps;
    const filteredBatch = result.filtered;
    
    let newCount = 0;
    for (const app of batch) {
      if (!seen.has(app.slug)) {
        seen.add(app.slug);
        allApps.push(app);
        newCount++;
      }
    }
    log(`  Found ${batch.length} apps (${newCount} new), filtered out ${filteredBatch.length}, total: ${allApps.length}`);
    
    // Log filtered apps
    if (filteredBatch.length > 0) {
      filteredBatch.forEach(f => {
        log(`    ✗ Skipped: ${f.name} (${f.slug}) - ${f.reason}${f.review_count > 0 ? ` [${f.review_count} reviews]` : ''}`);
      });
    }

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

    const url = URL;
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
      const result = await extractAppsFromPage(page);
      apps.push(...result.apps);
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
