import { OptimizedCloudflareBrowserService } from '../lib/optimized-browser-service';

import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";

function extractInternalLinks(html: string, baseUrl: string, limit: number): string[] {
  const base = new URL(baseUrl);
  const hrefs = new Set<string>();

  const anchorRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) && hrefs.size < limit * 2) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    try {
      const url = new URL(raw, base);
      if (url.origin !== base.origin) continue;
      if (/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|pdf|zip|rar|7z|mp4|mp3)(\?.*)?$/i.test(url.pathname)) continue;
      url.hash = '';
      hrefs.add(url.toString());
    } catch {}
  }

  const seenPath = new Set<string>();
  const result: string[] = [];
  for (const u of hrefs) {
    const p = new URL(u).pathname;
    if (seenPath.has(p)) continue;
    seenPath.add(p);
    result.push(u);
    if (result.length >= limit) break;
  }
  return result;
}

export default async function crawlLinksHandler({ request }: RequestInfo<any, AppContext>) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  try {
    const body: { url: string; maxPages?: number } = await request.json();
    const rootUrl = body.url;
    const maxPages = Math.min(Math.max(body.maxPages ?? 5, 1), 20);
    if (!rootUrl) {
      return new Response(JSON.stringify({ error: 'URL is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const browser = new OptimizedCloudflareBrowserService();
    const page = await browser.renderPage(rootUrl, { 
      useCache: true, 
      blockResources: true, 
      optimizeForContent: true 
    });
    const allUrls = extractInternalLinks(page.html, page.url, 100);
    const selected = [new URL(rootUrl).toString(), ...allUrls.slice(0, Math.max(0, maxPages - 1))];
    return new Response(JSON.stringify({ urls: selected, allUrls }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Crawl links API error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Crawl failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
