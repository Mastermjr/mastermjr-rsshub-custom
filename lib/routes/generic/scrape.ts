/**
 * @file scrape.ts
 * @description Generic blog scraper route for RSSHub. Auto-detects blog post listings
 *   on any URL using three heuristic strategies: links-with-headings, repeated containers,
 *   and heading links. Strips navigation chrome before analysis.
 * @rationale Provides a zero-config feed for any standard blog page, avoiding the need
 *   to write a custom route per site. Three-strategy fallback maximises coverage.
 *
 * @decision DEC-SCRAPER-001
 * @title Three-strategy heuristic scraper with nav-stripping
 * @status accepted
 * @rationale Links-with-headings covers most modern blogs; container heuristics handle
 *   CMS-generated list pages; heading-links is a last-resort fallback. Nav-stripping
 *   first reduces false positives from navigation elements that share these patterns.
 */
import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { load, type CheerioAPI, type Element } from 'cheerio';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/scrape/:url{.+}',
    categories: ['other'],
    example: '/generic/scrape/https%3A%2F%2Fwww.liquid.ai%2Fcompany%2Fblog',
    parameters: {
        url: 'URL-encoded target page URL',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
    },
    name: 'Generic Blog Scraper',
    maintainers: ['mastermjr'],
    handler,
    url: '',
};

// ============================================================
// Heuristics for finding blog post items on any page
// ============================================================

// Common selectors for blog post containers, ordered by specificity
const CONTAINER_SELECTORS = [
    'article',
    '[class*="post"]',
    '[class*="blog"]',
    '[class*="article"]',
    '[class*="entry"]',
    '[class*="card"]',
    '[class*="item"]',
    '.collection-item',        // Webflow
    '[role="article"]',
];

// Common selectors for titles within a container
const TITLE_SELECTORS = ['h1 a', 'h2 a', 'h3 a', 'h2', 'h3', 'h4', '[class*="title"]', '[class*="heading"]'];

// Common selectors for dates
const DATE_SELECTORS = ['time', '[datetime]', '[class*="date"]', '[class*="time"]', '[class*="published"]', '[class*="meta"]'];

// Common date patterns
const DATE_PATTERNS = [
    /(\d{4})-(\d{2})-(\d{2})/,                              // 2025-03-15
    /(\w+ \d{1,2},? \d{4})/,                                // March 15, 2025
    /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/,                 // 3.15.25 or 3/15/2025
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})/i,  // 15 March 2025
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})/i, // March 15, 2025
];

function extractDate(text: string): Date | undefined {
    if (!text) {
        return undefined;
    }

    for (const pattern of DATE_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            try {
                // Handle M.D.YY format (like liquid.ai uses)
                if (pattern === DATE_PATTERNS[2]) {
                    const parts = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
                    if (parts) {
                        let year = parts[3];
                        if (year.length === 2) {
                            year = `20${year}`;
                        }
                        return parseDate(`${year}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`);
                    }
                }
                return parseDate(match[0]);
            } catch {
                // Try next pattern
            }
        }
    }
    return undefined;
}

function resolveUrl(href: string, baseUrl: string): string {
    try {
        return new URL(href, baseUrl).href;
    } catch {
        return href;
    }
}

// Strategy 1: Find <a> tags that contain headings (very common blog pattern)
function strategyLinksWithHeadings($: CheerioAPI, baseUrl: string) {
    const items: any[] = [];
    const seen = new Set<string>();

    // Look for <a> tags containing h2 or h3
    $('a:has(h2), a:has(h3)').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const title = $el.find('h2, h3').first().text().trim();

        if (!title || !href || seen.has(href)) {
            return;
        }
        seen.add(href);

        // Look for a date anywhere near this element
        const parentText = $el.parent().text();
        const siblingText = $el.next().text();
        const dateText = $el.find(DATE_SELECTORS.join(',')).first().text() || parentText || siblingText;
        const pubDate = extractDate(dateText);

        items.push({
            title,
            link: resolveUrl(href, baseUrl),
            pubDate,
        });
    });

    return items;
}

// Strategy 2: Find repeated container elements with titles and links
function strategyContainers($: CheerioAPI, baseUrl: string) {
    const items: any[] = [];
    const seen = new Set<string>();

    for (const containerSel of CONTAINER_SELECTORS) {
        const containers = $(containerSel);
        // Need at least 3 similar containers to be confident it's a list
        if (containers.length < 3) {
            continue;
        }

        containers.each((_, el) => {
            const $el = $(el);

            // Find title
            let title = '';
            let link = '';
            for (const titleSel of TITLE_SELECTORS) {
                const $title = $el.find(titleSel).first();
                if ($title.length) {
                    title = $title.text().trim();
                    link = $title.attr('href') || $title.closest('a').attr('href') || '';
                    break;
                }
            }

            // Fall back: if the container itself is an <a>, use it
            if (!link && $el.is('a')) {
                link = $el.attr('href') || '';
            }
            if (!title) {
                title = $el.find('a').first().text().trim();
                link = link || $el.find('a').first().attr('href') || '';
            }

            if (!title || title.length < 5 || title.length > 300 || !link || seen.has(link)) {
                return;
            }
            seen.add(link);

            // Find date
            let pubDate: Date | undefined;
            for (const dateSel of DATE_SELECTORS) {
                const $date = $el.find(dateSel).first();
                if ($date.length) {
                    pubDate = extractDate($date.attr('datetime') || $date.text());
                    if (pubDate) {
                        break;
                    }
                }
            }
            // Last resort: scan all text in the container for a date
            if (!pubDate) {
                pubDate = extractDate($el.text());
            }

            items.push({
                title,
                link: resolveUrl(link, baseUrl),
                pubDate,
            });
        });

        // If we found items with this selector, stop trying others
        if (items.length >= 3) {
            break;
        }
        items.length = 0; // Reset and try next selector
    }

    return items;
}

// Strategy 3: Last resort — find all h2/h3 elements that are siblings with links
function strategyHeadings($: CheerioAPI, baseUrl: string) {
    const items: any[] = [];
    const seen = new Set<string>();

    $('h2 a, h3 a').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const title = $el.text().trim();

        if (!title || !href || seen.has(href)) {
            return;
        }
        seen.add(href);

        // Look for date in the parent or next sibling
        const $parent = $el.closest('div, section, li');
        const pubDate = extractDate($parent.text());

        items.push({
            title,
            link: resolveUrl(href, baseUrl),
            pubDate,
        });
    });

    return items;
}

async function handler(ctx) {
    const encodedUrl = ctx.req.param('url');
    const targetUrl = decodeURIComponent(encodedUrl);

    // Validate URL
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        throw new Error(`Invalid URL: ${targetUrl}`);
    }

    const response = await ofetch(targetUrl);
    const $ = load(response);

    // Remove nav, header, footer, sidebar to reduce noise
    $('nav, header, footer, aside, [role="navigation"], [class*="sidebar"], [class*="footer"], [class*="header"], [class*="nav"]').remove();

    // Try strategies in order of reliability
    let items = strategyLinksWithHeadings($, parsedUrl.origin);

    if (items.length < 2) {
        items = strategyContainers($, parsedUrl.origin);
    }

    if (items.length < 2) {
        items = strategyHeadings($, parsedUrl.origin);
    }

    // Deduplicate by link
    const uniqueItems = [...new Map(items.map((item) => [item.link, item])).values()];

    // Filter out items that look like navigation (very short titles, same domain root, etc.)
    const filtered = uniqueItems.filter(
        (item) =>
            item.title.length >= 10 && // Skip very short "titles" that are probably nav
            !item.link.match(/^https?:\/\/[^/]+\/?$/) // Skip bare domain links
    );

    const pageTitle = $('title').text().trim() || $('h1').first().text().trim() || parsedUrl.hostname;

    return {
        title: pageTitle,
        link: targetUrl,
        description: `Auto-generated feed for ${targetUrl}`,
        item: filtered.length > 0 ? filtered : uniqueItems.slice(0, 30),
    };
}
