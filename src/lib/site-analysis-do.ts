import { SiteAnalysisService } from './analysis-service';
import { SiteAnalysisResult } from './types';

export interface SiteAnalysisOptions {
  usePuppeteer: boolean;
  useExternalFetcher: boolean;
  externalFetcherUrl?: string;
}

export class SiteAnalysisDO implements DurableObject {
  protected state: DurableObjectState;
  protected env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');

    if (request.method === 'POST' && pathParts[1] === 'analyze') {
      return this.handleAnalyzeRequest(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleAnalyzeRequest(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        sessionId: string;
        url: string;
        options: SiteAnalysisOptions;
      };

      const { sessionId, url, options } = body;

      console.log(`🎯 SiteAnalysisDO: Starting analysis for ${url} in session ${sessionId}`);

      // Perform the analysis
      const result = await this.analyzeSite(sessionId, url, options);

      return new Response(JSON.stringify({
        success: true,
        result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error(`💥 SiteAnalysisDO: Analysis failed:`, error);

      return new Response(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async analyzeSite(sessionId: string, url: string, options: SiteAnalysisOptions): Promise<SiteAnalysisResult> {
    const analysisService = new SiteAnalysisService();

    console.log(`🤖 SiteAnalysisDO: Analyzing ${url} with options:`, options);

    try {
      // Perform the site analysis
      const result = await analysisService.analyzeSite(
        url,
        options.usePuppeteer,
        options.useExternalFetcher,
        options.externalFetcherUrl
      );

      console.log(`✅ SiteAnalysisDO: Analysis completed for ${url}`);

      // Update the session with this result
      await this.updateSessionWithResult(sessionId, url, result);

      return result;

    } catch (error) {
      console.error(`❌ SiteAnalysisDO: Analysis failed for ${url}:`, error);

      // Update session with error for this URL
      await this.updateSessionWithError(sessionId, url, error);

      throw error;
    }
  }

  private async updateSessionWithResult(sessionId: string, url: string, result: SiteAnalysisResult): Promise<void> {
    try {
      if (!this.env.SITE_ANALYSIS_CACHE) {
        console.error(`❌ SiteAnalysisDO: No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
        return;
      }

      const currentData = await this.env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
      if (!currentData) {
        console.error(`❌ SiteAnalysisDO: Session ${sessionId} not found in cache`);
        return;
      }

      const sessionData = JSON.parse(currentData) as any;

      // Add this result to the session
      if (!sessionData.results) {
        sessionData.results = [];
      }

      // Find existing result for this URL or add new one
      const existingIndex = sessionData.results.findIndex((r: any) => r.pageAnalysis?.url === url);
      if (existingIndex >= 0) {
        sessionData.results[existingIndex] = result;
      } else {
        sessionData.results.push(result);
      }

      // Update progress
      sessionData.progress = {
        ...sessionData.progress,
        current: sessionData.results.length,
        stage: sessionData.results.length >= sessionData.urls?.length ? 'completed' : 'analyzing'
      };

      // Update session status if all URLs are done
      if (sessionData.results.length >= sessionData.urls?.length) {
        sessionData.status = 'completed';
      }

      sessionData.updatedAt = new Date().toISOString();

      console.log(`📊 SiteAnalysisDO: Updated session ${sessionId} with result for ${url} (${sessionData.results.length}/${sessionData.urls?.length})`);

      await this.env.SITE_ANALYSIS_CACHE.put(
        `session:${sessionId}`,
        JSON.stringify(sessionData),
        { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
      );

    } catch (error) {
      console.error(`💥 SiteAnalysisDO: Failed to update session ${sessionId}:`, error);
    }
  }

  private async updateSessionWithError(sessionId: string, url: string, error: any): Promise<void> {
    try {
      if (!this.env.SITE_ANALYSIS_CACHE) {
        console.error(`❌ SiteAnalysisDO: No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
        return;
      }

      const currentData = await this.env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
      if (!currentData) {
        console.error(`❌ SiteAnalysisDO: Session ${sessionId} not found in cache`);
        return;
      }

      const sessionData = JSON.parse(currentData) as any;

      // Add error result for this URL
      if (!sessionData.results) {
        sessionData.results = [];
      }

      const errorResult = {
        pageAnalysis: {
          url,
          title: 'Analysis Failed',
          description: `Failed to analyze: ${error instanceof Error ? error.message : String(error)}`,
          headings: [],
          keyContent: '',
          technicalStack: {
            framework: null,
            cms: null,
            analytics: []
          },
          seoMetrics: {
            hasMetaTitle: false,
            hasMetaDescription: false,
            hasStructuredData: false,
            imageCount: 0,
            linkCount: 0
          }
        },
        lytxRecommendations: {
          tagPlacements: [],
          trackingEvents: [],
          optimizations: []
        },
        analysisId: `error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };

      // Find existing result for this URL or add new one
      const existingIndex = sessionData.results.findIndex((r: any) => r.pageAnalysis?.url === url);
      if (existingIndex >= 0) {
        sessionData.results[existingIndex] = errorResult;
      } else {
        sessionData.results.push(errorResult);
      }

      // Update progress
      sessionData.progress = {
        ...sessionData.progress,
        current: sessionData.results.length,
        stage: sessionData.results.length >= sessionData.urls?.length ? 'completed' : 'analyzing'
      };

      // Update session status if all URLs are done
      if (sessionData.results.length >= sessionData.urls?.length) {
        sessionData.status = 'completed';
      }

      sessionData.updatedAt = new Date().toISOString();

      console.log(`📊 SiteAnalysisDO: Updated session ${sessionId} with error for ${url} (${sessionData.results.length}/${sessionData.urls?.length})`);

      await this.env.SITE_ANALYSIS_CACHE.put(
        `session:${sessionId}`,
        JSON.stringify(sessionData),
        { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
      );

    } catch (updateError) {
      console.error(`💥 SiteAnalysisDO: Failed to update session ${sessionId} with error:`, updateError);
    }
  }
}