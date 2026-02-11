# Shopify App Reviews Scraper

Node.js + Puppeteer scraper that discovers "print on demand" apps from the Shopify App Store search, then scrapes all reviews for each app and outputs CSV and JSON.

## Setup

```bash
npm install
npx puppeteer browsers install chrome   # required for Puppeteer
```

## Usage

**Full run** (discover apps → scrape reviews → write CSV/JSON):

```bash
npm start
# or
node src/index.js
```

**Phase 1 only** (discover apps, save to `data/apps.json`):

```bash
npm run discover
```

**Phase 2 only** (scrape reviews using existing `data/apps.json`):

```bash
npm run reviews
```

**Options**

- `--headful` — Run browser in headed mode (visible window).
- `--no-resume` — Ignore checkpoints and start from scratch.

Examples:

```bash
node src/index.js --headful
node src/index.js --no-resume
node src/index.js --discover --no-resume
```

## Behavior

- **Discovery:** Opens `https://apps.shopify.com/search?q=print+on+demand`, waits for results, scrolls to load more, and collects app name + slug from app cards. Saves to `data/apps.json`.
- **Reviews:** For each app, opens `https://apps.shopify.com/{slug}/reviews`, reads total count, then paginates with `?page=1`, `?page=2`, … and extracts per-review fields. Saves per-app JSON to `data/reviews/{slug}.json` and updates `data/all_reviews.json` and `data/scraped_app_slugs.json` as it goes.
- **Output:** Writes `data/all_reviews.csv` and `data/all_reviews.json` when the run finishes (or when resuming, from the combined checkpoint).
- **Rate limiting:** 3–5 second random delay between page requests.
- **Retries:** Up to 3 retries with exponential backoff on failures.
- **Resume:** If interrupted, run again without `--no-resume` to continue from the last completed app.

## Output fields

| Field | Description |
|-------|-------------|
| app_name | App display name |
| app_slug | URL slug (e.g. `printify`) |
| reviewer_name | Name shown on review |
| reviewer_location | Location if shown |
| rating | Star count (1–5) |
| review_date | Date text |
| usage_duration | e.g. "Over 2 years using the app" |
| review_text | Full review body |
| developer_response | Developer reply text |
| developer_response_date | Reply date text |

## File layout

```
data/
  apps.json           # Discovered apps (checkpoint)
  scraped_app_slugs.json  # Slugs already scraped (resume)
  all_reviews.json   # Combined reviews
  all_reviews.csv    # Combined CSV
  reviews/
    printful.json
    printify.json
    ...
```

## If Shopify changes the site

Update selectors and URLs in `src/config.js` so the scraper can find app cards and review blocks without changing the rest of the code.
# shopify-reviews-scraper
