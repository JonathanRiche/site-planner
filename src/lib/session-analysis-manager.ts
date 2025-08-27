import { env } from 'cloudflare:workers';

import { SiteAnalysisService } from './analysis-service';

import { OptimizedCloudflareBrowserService } from './optimized-browser-service';
import type { SessionData } from "@/api/session";
//NOTE: THIS DO IS JUST LOGGIN AND FETCHING SITE ANALYSIS
export class SessionAnalysisManager implements DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  private startTime: number = 0;

  constructor(state: DurableObjectState, env: Env) {
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');

    if (request.method === 'POST' && pathParts[1] === 'start') {
      return this.handleStartRequest(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleStartRequest(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        sessionId: string;
        sessionData: SessionData;
      };

      const { sessionId, sessionData } = body;

      console.log(`🚀 Durable Object: Starting analysis for session ${sessionId}`);

      // Start analysis immediately (not in background)
      this.performAnalysis(sessionId, sessionData);

      return new Response(JSON.stringify({
        success: true,
        message: "Analysis started"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error(`💥 DO: Failed to start analysis:`, error);
      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async performAnalysis(sessionId: string, sessionData: SessionData) {
    const updateSession = async (updates: Partial<SessionData>) => {
      try {
        if (!this.env.SITE_ANALYSIS_CACHE) {
          console.error(`❌ No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
          return;
        }

        const currentData = await this.env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
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

        await this.env.SITE_ANALYSIS_CACHE.put(
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

      let urlsToAnalyze: string[] = [];

      if (sessionData.crawl) {
        // Update status to crawling
        await updateSession({
          status: 'crawling',
          progress: {
            stage: 'crawling',
            current: 0,
            total: sessionData.maxPages,
            message: 'Starting site crawl...'
          }
        });

        // Perform crawling
        console.log(`🕷️ DO: Starting crawl for session ${sessionId}`);
        urlsToAnalyze = await this.performCrawling(sessionData);
        console.log(`✅ DO: Crawl completed for session ${sessionId}, found ${urlsToAnalyze.length} URLs`);

        // Update session with crawled URLs
        await updateSession({
          progress: {
            stage: 'crawling',
            current: urlsToAnalyze.length,
            total: sessionData.maxPages,
            message: `Crawl completed: found ${urlsToAnalyze.length} pages`,
            urls: urlsToAnalyze,
            allUrls: urlsToAnalyze
          }
        });
      } else {
        // Use provided URLs
        urlsToAnalyze = sessionData.urls || [sessionData.url];
      }

      // Start analysis by spawning individual DOs
      console.log(`🚀 DO: Starting analysis by spawning ${urlsToAnalyze.length} individual DOs for session ${sessionId}`);
      await updateSession({
        status: 'analyzing',
        progress: {
          stage: 'analyzing',
          current: 0,
          total: urlsToAnalyze.length,
          message: 'Starting individual site analyses...',
          urls: urlsToAnalyze
        }
      });

      this.logExecutionStats(`Spawning ${urlsToAnalyze.length} individual site analysis DOs`);

      // Spawn individual DOs for each URL
      const siteAnalysisPromises = urlsToAnalyze.map(async (url, index) => {
        try {
          console.log(`🎯 DO: Spawning SiteAnalysisDO ${index + 1}/${urlsToAnalyze.length} for ${url}`);

          // Create unique DO ID for this session + URL combination
          const doId = this.env.SITE_ANALYSIS_DO.idFromName(`${sessionId}:${url}`);
          const siteDO = this.env.SITE_ANALYSIS_DO.get(doId);

          // Call the analyze endpoint
          const response = await siteDO.fetch(new Request(`http://internal/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              url,
              options: {
                usePuppeteer: sessionData.usePuppeteer,
                useExternalFetcher: sessionData.useExternalFetcher,
                externalFetcherUrl: this.env.EXTERNAL_FETCHER
              }
            })
          }));

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`SiteAnalysisDO failed: ${errorText}`);
          }

          const result = await response.json();
          console.log(`✅ DO: SiteAnalysisDO ${index + 1}/${urlsToAnalyze.length} completed for ${url}`);
          return result;
        } catch (error) {
          console.error(`❌ DO: SiteAnalysisDO ${index + 1}/${urlsToAnalyze.length} failed for ${url}:`, error);
          throw error;
        }
      });

      // Wait for all individual DOs to complete
      console.log(`⏳ DO: Waiting for all ${urlsToAnalyze.length} site analyses to complete...`);
      await Promise.allSettled(siteAnalysisPromises);

      this.logExecutionStats(`All individual site analyses completed`);
      console.log(`✅ DO: All individual site analyses completed for session ${sessionId}`);

      // The session will be updated progressively by each SiteAnalysisDO
      // No need to do final update here as each DO updates the session

    } catch (error) {
      this.logExecutionStats(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`💥 DO: Analysis failed for session ${sessionId}:`, errorMessage);

      await updateSession({
        status: 'error',
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async performCrawling(sessionData: SessionData): Promise<string[]> {
    const { url, maxPages } = sessionData;
    console.log(`🕷️ Crawling ${url} with maxPages=${maxPages}`);

    try {
      // Fetch the base page HTML
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'text/html',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.error(`❌ Failed to fetch ${url}: ${response.status}`);
        return [url];
      }

      const html = await response.text();
      console.log(`📄 Fetched ${html.length} chars from ${url}`);

      // Extract internal links
      const urls = this.extractInternalLinks(html, url, maxPages);

      // Always include the base URL first
      const allUrls = [url, ...urls.filter(url => url !== url)];

      // Limit to maxPages
      const limitedUrls = allUrls.slice(0, maxPages);

      console.log(`✅ Found ${limitedUrls.length} URLs: ${limitedUrls.join(', ')}`);
      return limitedUrls;

    } catch (error) {
      console.error(`💥 Crawling failed for ${url}:`, error);
      return [url];
    }
  }

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

    return Array.from(hrefs);
  }
}
