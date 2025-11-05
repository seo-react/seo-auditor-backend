import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';

const visited = new Set();
const queue = [];

export async function crawlSite(startUrl, maxDepth = 3) {
  queue.push({ url: startUrl, depth: 0 });
  const report = [];

  const baseDomain = new URL(startUrl).hostname;

  while (queue.length > 0) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > maxDepth) continue;

    visited.add(url);
    try {
      const res = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(res.data);

      const title = $('title').text().trim();
      const description = $('meta[name="description"]').attr('content') || '';
      const h1 = $('h1').length;
      const h2 = $('h2').length;
      const canonical = $('link[rel="canonical"]').attr('href') || '';
      const noindex = $('meta[name="robots"]').attr('content')?.includes('noindex') || false;

      report.push({ url, status: res.status, title, description, h1, h2, canonical, noindex, depth });

      const links = $('a[href]')
        .map((i, el) => $(el).attr('href'))
        .get()
        .filter(href => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:'))
        .map(href => href.startsWith('/')
          ? new URL(href, startUrl).href
          : href)
        .filter(href => new URL(href).hostname === baseDomain);

      for (const link of links) {
        if (!visited.has(link)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    } catch (err) {
      report.push({ url, status: err.response?.status || 'Erro', depth });
    }
  }

  return report;
}
