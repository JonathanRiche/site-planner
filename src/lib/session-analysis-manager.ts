import { env } from 'cloudflare:workers';

import { SiteAnalysisService } from './analysis-service';

import { OptimizedCloudflareBrowserService } from './optimized-browser-service';
import { SessionData } from "@/api/session";

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
        urlsToAnalyze = await this.performCrawling(sessionData.url, sessionData.maxPages);
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

  private async performCrawling(baseUrl: string, maxPages: number): Promise<string[]> {
    // This is a placeholder - you'll need to implement the actual crawling logic
    // For now, just return the base URL
    console.log(`🕷️ Crawling ${baseUrl} with maxPages=${maxPages}`);
    return [baseUrl];
  }
}