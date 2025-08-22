import { SiteAnalysisService } from '../lib/analysis-service';
import { CloudflareBrowserService } from '../lib/browser-service';
import { getDb, searches } from '../lib/db';

import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";

function extractInternalLinks(html: string, baseUrl: string, limit: number): string[] {
  const base = new URL(baseUrl);
  const hrefs = new Set<string>();

  // Find anchor hrefs
  const anchorRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) && hrefs.size < limit * 2) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;

    try {
      const url = new URL(raw, base);
      // Same origin only
      if (url.origin !== base.origin) continue;
      // Skip files (images, assets, docs)
      if (/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|pdf|zip|rar|7z|mp4|mp3)(\?.*)?$/i.test(url.pathname)) continue;

      // Normalize: drop hash, keep path+search minimally to avoid duplicates
      url.hash = '';
      const normalized = url.toString();
      hrefs.add(normalized);
    } catch {
      continue;
    }
  }

  // De-duplicate by pathname first, then limit
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

export default async function analyzeCrawlHandler({ request }: RequestInfo<any, AppContext>) {
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

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in .dev.vars');
    }

    const browser = new CloudflareBrowserService();
    const page = await browser.renderPage(rootUrl, { useCache: true });

    const internalLinks = extractInternalLinks(page.html, page.url, maxPages - 1);

    // Include root first
    const urlsToAnalyze = [new URL(rootUrl).toString(), ...internalLinks];

    const analysisService = new SiteAnalysisService();
    const results = await analysisService.analyzeMultiplePages(urlsToAnalyze);

    // Persist searches
    try {
      const db = getDb();
      for (const r of results) {
        await db.insert(searches).values({
          id: r.analysisId,
          url: r.pageAnalysis.url
        });
      }
    } catch (dbErr) {
      console.warn('Failed to persist searches:', dbErr);
    }

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Analyze crawl API error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Crawl analysis failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
