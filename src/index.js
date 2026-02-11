#!/usr/bin/env node
/**
 * Shopify App Reviews Scraper — Main entry point.
 *
 * Usage:
 *   node src/index.js              # Full run: discover apps → scrape reviews → output CSV/JSON
 *   node src/index.js --discover    # Phase 1 only: discover apps, save to data/apps.json
 *   node src/index.js --reviews     # Phase 2 only: load apps from data/apps.json, scrape reviews
 *   node src/index.js --headful     # Run browser in headed mode (see the browser)
 *   node src/index.js --no-resume   # Ignore checkpoints and start fresh
 */
const fs = require('fs');
const path = require('path');
const { discoverApps } = require('./discoverApps');
const { scrapeAllReviews } = require('./scrapeReviews');
const {
  DATA_DIR,
  REVIEWS_DIR,
  loadCheckpoint,
  saveCheckpoint,
  writeAllReviewsCsv,
  writeAllReviewsJson,
  log,
} = require('./utils');

const args = process.argv.slice(2);
const flags = {
  discoverOnly: args.includes('--discover'),
  reviewsOnly: args.includes('--reviews'),
  headful: args.includes('--headful'),
  noResume: args.includes('--no-resume'),
};

async function main() {
  // Ensure data dirs exist
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(REVIEWS_DIR, { recursive: true });

  let apps = loadCheckpoint('apps.json', []);
  if (!flags.reviewsOnly) {
    log('Phase 1: App discovery');
    apps = await discoverApps({
      headless: !flags.headful,
      resume: !flags.noResume,
    });
    if (apps.length === 0) {
      log('No apps found. Check search URL and selectors in src/config.js');
      process.exit(1);
    }
    if (flags.discoverOnly) {
      log('Discovery only. Exiting. Run without --discover to scrape reviews.');
      return;
    }
  }

  if (apps.length === 0) {
    log('No apps in data/apps.json. Run without --reviews to discover apps first.');
    process.exit(1);
  }

  log('Phase 2: Review scraping');
  const allReviews = await scrapeAllReviews(apps, {
    headless: !flags.headful,
    resume: !flags.noResume,
  });

  log('Phase 3: Output');
  if (allReviews.length > 0) {
    await writeAllReviewsCsv(allReviews);
    writeAllReviewsJson(allReviews);
  } else {
    log('No reviews to write.');
  }

  log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
