import { DurableObject } from "cloudflare:workers";
import { env } from 'cloudflare:workers';

import { SiteAnalysisService } from './analysis-service';

import { OptimizedCloudflareBrowserService } from './optimized-browser-service';
import { SessionData } from "@/api/session";

export class SessionAnalysisManager extends DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  private startTime: number = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.startTime = Date.now();
  }

  private logExecutionStats(message: string) {
    const now = Date.now();
    const executionTime = now - this.startTime;
    const executionMinutes = Math.floor(executionTime / 60000);
    const executionSeconds = Math.floor((executionTime % 60000) / 1000);

    console.log(`⏱️  DO EXECUTION [${executionMinutes}:${executionSeconds.toString().padStart(2, '0')}] ${message}`);

    // Warn if approaching limits
    if (executionTime > 4 * 60 * 1000) { // 4 minutes
      console.warn(`⚠️  DO EXECUTION WARNING: Approaching 5-minute limit (${executionMinutes}:${executionSeconds.toString().padStart(2, '0')} elapsed)`);
    }
    if (executionTime > 4.5 * 60 * 1000) { // 4.5 minutes
      console.error(`🚨 DO EXECUTION CRITICAL: Very close to 5-minute limit (${executionMinutes}:${executionSeconds.toString().padStart(2, '0')} elapsed)`);
    }
  }

  private async externalServiceFetch(url: string) {
    console.log(`External 📡 Fetching ${url}...`);
    const request = await fetch(`${env.EXTERNAL_FETCHER}/api/crawl?url=${url}`, {
      method: 'GET',
      headers: {
        'X-API-KEY': process.env.EXTERNAL_FETCHER_API_KEY,
      },
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
  private async staticFetch(url: string) {
    console.log(`Static 📡 Fetching ${url}...`);
    const request = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    });
    if (request.ok && request.status === 200) {
      const html = await request.text();
      return html;
    } else {
      return null

    }

  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/start' && request.method === 'POST') {

      const { sessionId, sessionData } = await request.json() as { sessionId: string, sessionData: SessionData };
      return this.startAnalysis(sessionId, sessionData);
    }

    return new Response('Not found', { status: 404 });
  }

  async startAnalysis(sessionId: string, sessionData: SessionData): Promise<Response> {
    console.log(`🚀 Durable Object: Starting analysis for session ${sessionId}`);

    // Start analysis immediately (not in background)
    this.performAnalysis(sessionId, sessionData);

    return new Response(JSON.stringify({
      success: true,
      message: "Analysis started"
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async performAnalysis(sessionId: string, sessionData: SessionData) {
    const updateSession = async (updates: Partial<SessionData>) => {
      try {
        if (!env.SITE_ANALYSIS_CACHE) {
          console.error(`❌ No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
          return;
        }

        const currentData = await env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
        if (!currentData) {
          console.error(`❌ Session ${sessionId} not found in cache`);
          return;
        }

        const data = JSON.parse(currentData) as SessionData;
        const updatedData = {
          ...data,
          ...updates,
          updatedAt: new Date().toISOString()
        } as SessionData;

        console.log(`📝 DO: Updating session ${sessionId}:`, { status: updatedData.status, stage: updatedData.progress?.stage });

        await env.SITE_ANALYSIS_CACHE.put(
          `session:${sessionId}`,
          JSON.stringify(updatedData),
          { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
        );
      } catch (error) {
        console.error(`💥 DO: Failed to update session ${sessionId}:`, error);
      }
    };

    try {
      this.logExecutionStats(`Starting performAnalysis for session ${sessionId}`);

      // Check for required environment variables first
      console.log(`🔍 DO: Checking environment for session ${sessionId}...`);
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not configured. Cannot proceed with analysis.');
      }
      console.log(`✅ DO: OPENAI_API_KEY is configured for session ${sessionId}`);
      this.logExecutionStats(`Environment check completed`);

      // Import the analysis service dynamically
      console.log(`📦 DO: Importing analysis services for session ${sessionId}...`);
      // const { SiteAnalysisService } = await import('./analysis-service');
      // const  OptimizedCloudflareBrowserService } = await import('./optimized-browser-service');
      console.log(`✅ DO: Services imported successfully for session ${sessionId}`);
      this.logExecutionStats(`Services imported`);

      if (sessionData.crawl) {
        // Update status to crawling
        await updateSession({
          status: 'crawling',
          progress: {
            stage: 'crawling',
            message: `Crawling pages from ${sessionData.url}...`
          }
        });

        // Step 1: Crawl links
        console.log(`🕷️ DO: Starting crawl for session ${sessionId}`);
        let initial_html: string;

        if (!sessionData.usePuppeteer) {
          let tryStatic: string | null = null;
          if (sessionData.useExternalFetcher) {
            tryStatic = await this.externalServiceFetch(sessionData.url);
          } else {
            tryStatic = await this.staticFetch(sessionData.url);
          }
          if (tryStatic) {
            initial_html = tryStatic;
          } else {
            //TODO: Handle error on frontend ask user if they want to crawl with puppeteer
            throw new Error('Fetch content failed');
          }
        } else {
          const browser = new OptimizedCloudflareBrowserService();
          const page = await browser.renderPage(sessionData.url, {
            useCache: true,
            blockResources: true,
            optimizeForContent: true
          });
          initial_html = page.html;
        }


        // Extract internal links
        const internalLinks = this.extractInternalLinks(initial_html, sessionData.url, sessionData.maxPages - 1);
        const rootUrlInLinks = internalLinks.includes(sessionData.url);
        const urlsToAnalyze = rootUrlInLinks
          ? internalLinks.slice(0, sessionData.maxPages)
          : [sessionData.url, ...internalLinks.slice(0, sessionData.maxPages - 1)];

        // Update with found URLs
        await updateSession({
          status: 'analyzing',
          progress: {
            stage: 'analyzing',
            current: 0,
            total: urlsToAnalyze.length,
            message: `Found ${internalLinks.length} internal links. Analyzing ${urlsToAnalyze.length} pages...`,
            urls: urlsToAnalyze,
            allUrls: internalLinks
          }
        });

        // Step 2: Analyze pages in parallel with graceful failure handling
        console.log(`🤖 DO: Starting parallel analysis for session ${sessionId}`);
        const analysisService = new SiteAnalysisService();

        try {
          // Add timeout protection (5 minutes max)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Analysis timeout after 5 minutes')), 5 * 60 * 1000);
          });

          this.logExecutionStats(`Starting streaming analysis of ${urlsToAnalyze.length} URLs`);

          // Use streaming analysis to update results progressively
          const allResults: any[] = [];

          await Promise.race([
            analysisService.analyzeMultiplePagesStreaming(urlsToAnalyze, {
              usePuppeteer: sessionData.usePuppeteer,
              useExternalFetcher: sessionData.useExternalFetcher,
              externalFetcherUrl: env.EXTERNAL_FETCHER,
              concurrency: Math.min(urlsToAnalyze.length, 3),
              onResult: async (result, completedCount, totalCount) => {
                this.logExecutionStats(`Processing result ${completedCount}/${totalCount}`);
                console.log(`📊 DO: onResult callback called for session ${sessionId} - ${completedCount}/${totalCount}`);

                // Add result to our tracking array
                allResults.push(result);
                console.log(`📊 DO: Added result to allResults array, now has ${allResults.length} results`);

                // Update session with partial results
                console.log(`📊 DO: Updating session ${sessionId} with ${allResults.length} results`);
                await updateSession({
                  status: 'analyzing',
                  progress: {
                    stage: 'analyzing',
                    current: completedCount,
                    total: totalCount,
                    message: `Analysis in progress: ${completedCount}/${totalCount} pages completed`,
                    urls: urlsToAnalyze
                  },
                  results: [...allResults], // Include all results so far
                  updatedAt: new Date().toISOString(),
                });

                console.log(`📊 DO: Successfully updated session ${sessionId} with result ${completedCount}/${totalCount}`);
              },
              onError: async (error, url, completedCount, totalCount) => {
                console.warn(`⚠️ DO: onError callback called for session ${sessionId} - ${completedCount}/${totalCount}`);
                console.warn(`⚠️ DO: Failed to analyze ${url} for session ${sessionId}:`, error);

                // Update progress even for errors
                console.log(`📊 DO: Updating session ${sessionId} after error with ${allResults.length} results`);
                await updateSession({
                  status: 'analyzing',
                  progress: {
                    stage: 'analyzing',
                    current: completedCount,
                    total: totalCount,
                    message: `Analysis in progress: ${completedCount}/${totalCount} pages processed (some failures)`,
                    urls: urlsToAnalyze
                  },
                  results: [...allResults], // Include successful results
                  updatedAt: new Date().toISOString(),
                });
                console.log(`📊 DO: Successfully updated session ${sessionId} after error`);
              }
            }),
            timeoutPromise
          ]) as any[];

          this.logExecutionStats(`Streaming analysis completed with ${allResults.length}/${urlsToAnalyze.length} results`);
          console.log(`✅ DO: Streaming analysis completed for session ${sessionId} with ${allResults.length} results`);

          // Complete session with final results
          await updateSession({
            status: 'completed',
            progress: {
              stage: 'completed',
              current: allResults.length,
              total: urlsToAnalyze.length,
              message: `Analysis completed: ${allResults.length}/${urlsToAnalyze.length} pages analyzed`
            },
            results: allResults,
            updatedAt: new Date().toISOString(),
          });

        } catch (error) {
          this.logExecutionStats(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
          console.error(`⚠️ DO: Analysis failed for session ${sessionId}, attempting to get partial results:`, error);

          // Try to get any results that may have been completed before the timeout
          // Complete the session with empty results rather than leaving it hanging
          await updateSession({
            status: 'completed',
            progress: {
              stage: 'completed',
              current: 0,
              total: urlsToAnalyze.length,
              message: `Analysis completed with errors. Unable to process pages due to: ${error instanceof Error ? error.message : 'Unknown error'}`
            },
            results: [],
            error: error instanceof Error ? error.message : 'Analysis failed'
          });
        }

      } else {
        // Single page analysis
        await updateSession({
          status: 'analyzing',
          progress: {
            stage: 'analyzing',
            current: 0,
            total: 1,
            message: `Analyzing ${sessionData.url}...`
          }
        });

        console.log(`🤖 DO: Starting single page analysis for session ${sessionId}`);
        const analysisService = new SiteAnalysisService();

        try {
          // Add timeout protection (3 minutes max for single page)
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Single page analysis timeout after 3 minutes')), 3 * 60 * 1000);
          });

          const result = await Promise.race([
            analysisService.analyzeSite(sessionData.url, sessionData.usePuppeteer, sessionData.useExternalFetcher, env.EXTERNAL_FETCHER),
            timeoutPromise
          ]) as any;

          await updateSession({
            status: 'completed',
            progress: {
              stage: 'completed',
              current: 1,
              total: 1,
              message: 'Analysis completed successfully!'
            },
            results: [result]
          });

        } catch (error) {
          console.error(`⚠️ DO: Single page analysis failed for session ${sessionId}:`, error);

          // Complete session with error but don't leave it hanging
          await updateSession({
            status: 'completed',
            progress: {
              stage: 'completed',
              current: 0,
              total: 1,
              message: `Single page analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            },
            results: [],
            error: error instanceof Error ? error.message : 'Analysis failed'
          });
        }
      }

      console.log(`✅ DO: Background analysis completed for session ${sessionId}`);

    } catch (error) {
      console.error(`❌ DO: Background analysis failed for session ${sessionId}:`, error);

      await updateSession({
        status: 'error',
        progress: {
          stage: 'error',
          message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        },
        error: error instanceof Error ? error.message : 'Analysis failed'
      });
    }
  }

  // Helper function to extract internal links
  private extractInternalLinks(html: string, baseUrl: string, limit: number): string[] {
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
}
