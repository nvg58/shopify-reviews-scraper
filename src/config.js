/**
 * Selectors and URLs for Shopify App Store scraping.
 * Update these if the site structure changes.
 */
const BASE_URL = 'https://apps.shopify.com';

const SEARCH = {
  url: (q) => `${BASE_URL}/search?q=${encodeURIComponent(q)}`,
  /** App cards on search/category (data attributes) */
  appCard: '[data-app-card-handle-value]',
  appNameAttr: 'data-app-card-name-value',
  appHandleAttr: 'data-app-card-handle-value',
  appLinkAttr: 'data-app-card-app-link-value',
  /** Load more / pagination on search - optional */
  loadMoreButton: '[data-search-load-more], button:has-text("Load more"), a[rel="next"]',
};

const REVIEWS = {
  url: (slug) => `${BASE_URL}/${slug}/reviews`,
  urlPage: (slug, page) => `${BASE_URL}/${slug}/reviews?page=${page}`,
  /** Total count from sidebar or JSON-LD */
  totalCountFromHeading: 'h2 .tw-text-body-md',
  /** JSON-LD script for aggregateRating.ratingCount */
  jsonLdScript: 'script[type="application/ld+json"]',
  /** Each review block (exclude reply divs by id pattern) */
  reviewBlock: 'div[id^="review-"][id*=""]', // we filter in code: id starts with "review-" and doesn't start with "review-reply"
  /** Within a review block */
  ratingAria: 'div[aria-label*="out of 5 stars"]',
  reviewDate: '.tw-order-2 .tw-text-body-xs.tw-text-fg-tertiary', // first one in the header row
  reviewText: '[data-truncate-review] [data-truncate-content-copy], [data-truncate-review]',
  reviewerName: '.tw-text-heading-xs.tw-text-fg-primary span[title]',
  /** Sidebar meta: location and usage (divs in .tw-space-y-1) */
  sidebarMeta: '.tw-order-1.lg\\:tw-order-1 .tw-space-y-1 div',
  /** Developer reply container */
  replyContainer: '[data-merchant-review-reply] [id^="review-reply-"]',
  replyDate: '.tw-text-body-xs.tw-text-fg-tertiary.tw-mb-sm',
  replyText: '[data-truncate-review] [data-truncate-content-copy], [data-reply-id]',
  /** Pagination */
  pagination: '[data-pagination-controls]',
  nextPageLink: '[data-pagination-controls] a[rel="next"]',
  lastPageNumber: '[data-pagination-controls] a[aria-label*="Page"]', // last numeric link before "Next"
};

const PAGINATION = {
  reviewsPerPage: 10,
};

const DELAY = {
  minMs: 3000,
  maxMs: 5000,
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

module.exports = {
  BASE_URL,
  SEARCH,
  REVIEWS,
  PAGINATION,
  DELAY,
  USER_AGENT,
};
