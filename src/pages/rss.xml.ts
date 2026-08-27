import rss from '@astrojs/rss';
import { getPublishedArticles } from '../lib/articles.js';

export async function GET(context: any) {
  const articles = getPublishedArticles();
  
  return rss({
    title: 'BE UNCONVENTIONAL HQ',
    description: 'Film, television, and gaming coverage.',
    site: context.site || 'https://beunconventionalhq.com',
    items: articles.map((post) => ({
      title: post.title,
      pubDate: new Date(post.isoDate),
      description: post.excerpt,
      link: `/intel/${post.slug}`,
    })),
    customData: `<language>en-us</language>`,
  });
}
