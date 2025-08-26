import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { SimpleCloudflareBrowserService } from './simple-browser-service';
import { SiteAnalysisResult } from './types';
import { DEFAULT_MODEL } from './defaults';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Detect presence of LYTX script in raw HTML
function hasLytxScriptTag(html: string): boolean {
  if (!html) return false;
  return /<script[^>]+src=["'][^"']*(?:lytx\.io\/lytx\.js|analytics\.lytx\.io)[^"']*["'][^>]*>/i.test(html)
    || /window\.(?:lytx|lytxApi)\b/i.test(html);
}

export class SiteAnalysisService {
  private browserService: SimpleCloudflareBrowserService;

  constructor() {
    this.browserService = new SimpleCloudflareBrowserService();
  }

  // Simple HTML truncation like your script
  private truncateHtml(html: string, maxLength: number = 3000): string {
    if (html.length <= maxLength) {
      return html;
    }

    // Try to truncate at a reasonable HTML boundary
    let truncated = html.substring(0, maxLength);
    const lastClosingTag = truncated.lastIndexOf('</');

    if (lastClosingTag > maxLength * 0.8) {
      // If we have a reasonable closing tag near the end, truncate there
      truncated = truncated.substring(0, lastClosingTag);
    }

    return truncated + '\n... (truncated due to size)';
  }

  // External service fetch - will be called from Durable Object context where env is available
  private async externalServiceFetch(url: string, externalFetcherUrl?: string) {
    console.log(`External 📡 Fetching ${url}...`);
    if (!externalFetcherUrl) {
      throw new Error('External fetcher URL not provided');
    }
    const request = await fetch(`${externalFetcherUrl}/fetch-site?site=${url}`, {
      method: 'GET',
    });
    if (request.ok) {
      const html = await request.text();
      console.log("Content ok", request.status, html.length);
      return html;
    } else {
      console.log('Error fetching static content');
      return null;
    }
  }

  // Simple static fetch like your script
  private async staticFetch(url: string) {
    console.log(`Static 📡 Fetching ${url}...`);
    const request = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    });
    if (request.ok) {
      const html = await request.text();
      console.log("Content ok", request.status, html.length);
      return html;
    } else {
      console.log('Error fetching static content');
      return null;
    }
  }

  // Simplified single AI call analysis like your script
  async analyzeSite(url: string, usePuppeteer: boolean, useExternalFetcher?: boolean, externalFetcherUrl?: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();

    console.log(`🔍 [${analysisId}] Starting site analysis for: ${url}`, {
      timestamp: new Date().toISOString(),
      url
    });

    try {
      // Step 1: Fetch HTML content
      console.log(`🌐 [${analysisId}] Step 1: Fetching HTML content... external : ${useExternalFetcher} pupputeer : ${usePuppeteer} `);
      let html: string;
      
      if (!usePuppeteer) {
        let tryStatic: string | null = null;
        if (useExternalFetcher && externalFetcherUrl) {
          tryStatic = await this.externalServiceFetch(url, externalFetcherUrl);
        } else {
          tryStatic = await this.staticFetch(url);
        }
        if (tryStatic) {
          html = tryStatic;
        } else {
          throw new Error('Static fetch failed');
        }
      } else {
        const pageContent = await this.browserService.renderPage(url, {
          takeScreenshot: false,
          useCache: true,
          blockResources: true,
          optimizeForContent: true,
        });
        html = pageContent.html;
      }

      console.log(`✅ [${analysisId}] HTML content fetched successfully`, {
        htmlLength: html.length,
      });

      // Step 2: Single AI call for complete analysis (like your script)
      console.log(`🤖 [${analysisId}] Step 2: Running single AI analysis...`);
      
      const truncatedHtml = this.truncateHtml(html);
      const lytxDetected = hasLytxScriptTag(html);
      
      console.log(`📝 [${analysisId}] HTML truncated from ${html.length} to ${truncatedHtml.length} chars`);
      console.log(`🔎 [${analysisId}] LYTX Detection: ${lytxDetected ? 'Found' : 'Not found'}`);

      const analysisResult = await generateObject({
        model: openai(DEFAULT_MODEL),
        schema: SiteAnalysisResult,
        prompt: `Analyze this webpage HTML: ${url}

HTML:
${truncatedHtml}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
      });

      const totalTime = Date.now() - startTime;
      
      // Add metadata
      const result: SiteAnalysisResult = {
        ...analysisResult.object,
        analysisId,
        timestamp: new Date().toISOString(),
      };

      console.log(`🏁 [${analysisId}] Site analysis completed successfully in ${totalTime}ms`, {
        url,
        totalTime: `${totalTime}ms`,
        htmlSize: html.length,
        pageTitle: result.pageAnalysis.title,
      });

      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`💥 [${analysisId}] Site analysis failed after ${totalTime}ms:`, {
        url,
        error: error instanceof Error ? error.message : String(error),
        totalTime: `${totalTime}ms`,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  // Simplified multiple page analysis
  async analyzeMultiplePages(urls: string[], options: {
    concurrency?: number;
    usePuppeteer: boolean;
    useExternalFetcher?: boolean;
    externalFetcherUrl?: string;
  }): Promise<SiteAnalysisResult[]> {
    const { concurrency = 3, usePuppeteer, useExternalFetcher, externalFetcherUrl } = options;
    const batchId = crypto.randomUUID();

    console.log(`🚀 [${batchId}] Starting parallel analysis of ${urls.length} URLs with concurrency=${concurrency}`);

    const promises = urls.map(async (url, index) => {
      try {
        console.log(`📄 [${batchId}] Starting analysis ${index + 1}/${urls.length}: ${url}`);
        const result = await this.analyzeSite(url, usePuppeteer, useExternalFetcher, externalFetcherUrl);
        console.log(`✅ [${batchId}] Completed analysis ${index + 1}/${urls.length}: ${url}`);
        return { status: 'fulfilled' as const, value: result, url };
      } catch (error) {
        console.error(`❌ [${batchId}] Failed analysis ${index + 1}/${urls.length}: ${url}:`, error);
        return { status: 'rejected' as const, reason: error, url };
      }
    });

    const results: SiteAnalysisResult[] = [];
    const batches: Promise<any>[][] = [];

    // Split into batches of concurrent requests
    for (let i = 0; i < promises.length; i += concurrency) {
      batches.push(promises.slice(i, i + concurrency));
    }

    for (const [batchIndex, batch] of batches.entries()) {
      console.log(`🔄 [${batchId}] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} URLs)`);
      const batchStartTime = Date.now();

      const batchResults = await Promise.allSettled(batch);

      // Extract successful results
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled' && promiseResult.value.status === 'fulfilled') {
          results.push(promiseResult.value.value);
        }
      }

      console.log(`✅ [${batchId}] Batch ${batchIndex + 1}/${batches.length} completed in ${Date.now() - batchStartTime}ms`);
    }

    const successCount = results.length;
    const failureCount = urls.length - successCount;

    console.log(`🏁 [${batchId}] Parallel analysis completed:`, {
      totalUrls: urls.length,
      successful: successCount,
      failed: failureCount,
      successRate: `${Math.round((successCount / urls.length) * 100)}%`,
      concurrency
    });

    return results;
  }

  // Simplified direct HTML analysis
  async analyzeProvidedHtml(url: string, html: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();
    console.log(`🔍 [${analysisId}] Starting direct HTML analysis for: ${url}`);

    try {
      const truncatedHtml = this.truncateHtml(html);
      const lytxDetected = hasLytxScriptTag(html);
      
      console.log(`📝 [${analysisId}] HTML truncated from ${html.length} to ${truncatedHtml.length} chars`);
      console.log(`🔎 [${analysisId}] LYTX Detection: ${lytxDetected ? 'Found' : 'Not found'}`);

      const analysisResult = await generateObject({
        model: openai(DEFAULT_MODEL),
        schema: SiteAnalysisResult,
        prompt: `Analyze this webpage HTML: ${url}

HTML:
${truncatedHtml}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
      });

      const totalTime = Date.now() - startTime;
      
      const result: SiteAnalysisResult = {
        ...analysisResult.object,
        analysisId,
        timestamp: new Date().toISOString(),
      };

      console.log(`🏁 [${analysisId}] Direct HTML analysis completed in ${totalTime}ms`);
      return result;
    } catch (error) {
      console.error(`💥 [${analysisId}] Direct HTML analysis failed:`, error);
      throw error;
    }
  }
}