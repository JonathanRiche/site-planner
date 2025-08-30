import { SiteAnalysisService } from './analysis-service';
import { SiteAnalysisResult } from './types';
import { updateSessionWithResult, updateSessionWithError } from '@/session/cache';
import { createErrorResponse, createSuccessResponse, createNotFoundResponse } from '@/utilities';

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

    return createNotFoundResponse();
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

      return createSuccessResponse({ result });

    } catch (error) {
      return createErrorResponse(error, {
        context: 'SiteAnalysisDO: Analysis failed'
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
      await updateSessionWithResult(sessionId, url, result);

      return result;

    } catch (error) {
      console.error(`❌ SiteAnalysisDO: Analysis failed for ${url}:`, error);

      // Update session with error for this URL
      await updateSessionWithError(sessionId, url, error);

      throw error;
    }
  }


}