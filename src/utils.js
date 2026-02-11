const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REVIEWS_DIR = path.join(DATA_DIR, 'reviews');

/**
 * Random delay between min and max milliseconds.
 */
function delay(minMs = 3000, maxMs = 5000) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function up to maxRetries times with exponential backoff.
 */
async function retry(fn, maxRetries = 3, baseDelayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`  Attempt ${attempt}/${maxRetries} failed: ${err.message}. Retrying in ${waitMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Load JSON checkpoint file, or return defaultValue if it doesn't exist.
 */
function loadCheckpoint(filename, defaultValue = null) {
  const filePath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return defaultValue;
}

/**
 * Save JSON checkpoint file.
 */
function saveCheckpoint(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Save per-app reviews JSON.
 */
function saveAppReviews(slug, reviews) {
  const filePath = path.join(REVIEWS_DIR, `${slug}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(reviews, null, 2), 'utf-8');
}

/**
 * Write all reviews to CSV.
 */
async function writeAllReviewsCsv(allReviews) {
  const filePath = path.join(DATA_DIR, 'all_reviews.csv');
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'app_name', title: 'App Name' },
      { id: 'app_slug', title: 'App Slug' },
      { id: 'reviewer_name', title: 'Reviewer Name' },
      { id: 'reviewer_location', title: 'Reviewer Location' },
      { id: 'rating', title: 'Rating' },
      { id: 'review_date', title: 'Review Date' },
      { id: 'usage_duration', title: 'Usage Duration' },
      { id: 'review_text', title: 'Review Text' },
      { id: 'developer_response', title: 'Developer Response' },
      { id: 'developer_response_date', title: 'Developer Response Date' },
    ],
  });
  await csvWriter.writeRecords(allReviews);
  console.log(`CSV written to ${filePath} (${allReviews.length} reviews)`);
}

/**
 * Write combined JSON.
 */
function writeAllReviewsJson(allReviews) {
  const filePath = path.join(DATA_DIR, 'all_reviews.json');
  fs.writeFileSync(filePath, JSON.stringify(allReviews, null, 2), 'utf-8');
  console.log(`JSON written to ${filePath} (${allReviews.length} reviews)`);
}

function log(msg) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${msg}`);
}

module.exports = {
  DATA_DIR,
  REVIEWS_DIR,
  delay,
  retry,
  loadCheckpoint,
  saveCheckpoint,
  saveAppReviews,
  writeAllReviewsCsv,
  writeAllReviewsJson,
  log,
};
