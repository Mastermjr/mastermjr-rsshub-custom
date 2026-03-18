/**
 * @file blog.ts
 * @description Site-specific RSSHub route for the Liquid AI blog (liquid.ai/company/blog).
 *   Parses blog post links, titles, and M.D.YY dates from the listing page.
 * @rationale Custom route produces higher-quality output than the generic scraper because
 *   it targets liquid.ai's exact HTML structure and date format directly.
 */
import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/blog/:category?',
    categories: ['blog'],
    example: '/liquidai/blog',
    parameters: {
        category: 'Category filter (optional): All, News, Product, Models. Default: All',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
    },
    radar: [
        {
            source: ['www.liquid.ai/company/blog', 'www.liquid.ai/blog/*'],
            target: '/liquidai/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['mastermjr'],
    handler,
    url: 'www.liquid.ai/company/blog',
};

async function handler(ctx) {
    const category = ctx.req.param('category') || 'All';
    const baseUrl = 'https://www.liquid.ai';
    const pageUrl = `${baseUrl}/company/blog?category=${category}`;

    const response = await ofetch(pageUrl);
    const $ = load(response);

    // Each blog post is an <a> tag containing an h2 title, category, and date
    const items = $('a[href^="/blog/"]')
        .toArray()
        .map((el) => {
            const $el = $(el);
            const href = $el.attr('href');
            const title = $el.find('h2').first().text().trim();
            const dateText = $el.contents().last().text().trim();

            // Skip if no title (navigation links, etc.)
            if (!title || !href) {
                return null;
            }

            // Parse date like "3.5.26" → "2026-03-05"
            let pubDate;
            const dateMatch = dateText.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
            if (dateMatch) {
                const month = dateMatch[1].padStart(2, '0');
                const day = dateMatch[2].padStart(2, '0');
                let year = dateMatch[3];
                if (year.length === 2) {
                    year = `20${year}`;
                }
                pubDate = parseDate(`${year}-${month}-${day}`);
            }

            return {
                title,
                link: `${baseUrl}${href}`,
                pubDate,
            };
        })
        .filter(Boolean);

    return {
        title: `Liquid AI Blog${category !== 'All' ? ` - ${category}` : ''}`,
        link: pageUrl,
        description: 'Liquid AI blog posts on foundation models, research, and product updates',
        item: items,
    };
}
