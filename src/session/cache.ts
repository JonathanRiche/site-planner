import { SiteAnalysisResult } from '@/lib/types';
import type { SessionData } from '@/api/session';
import { env } from 'cloudflare:workers';
import { SESSION_TTL } from '@/lib/defaults';

/**
 * Generic session update utility
 */
export async function updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
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

    console.log(`📝 Updating session ${sessionId}:`, {
      status: updatedData.status,
      stage: updatedData.progress?.stage
    });

    await env.SITE_ANALYSIS_CACHE.put(
      `session:${sessionId}`,
      JSON.stringify(updatedData),
      { expirationTtl: SESSION_TTL }
    );
  } catch (error) {
    console.error(`💥 Failed to update session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * Update session with analysis result for a specific URL
 */
export async function updateSessionWithResult(sessionId: string, url: string, result: SiteAnalysisResult): Promise<void> {
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

    const sessionData = JSON.parse(currentData) as SessionData;

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
    const totalUrls = sessionData.urls?.length || 1;
    sessionData.progress = {
      ...sessionData.progress,
      current: sessionData.results.length,
      stage: sessionData.results.length >= totalUrls ? 'completed' : 'analyzing'
    };

    // Update session status if all URLs are done
    if (sessionData.results.length >= totalUrls) {
      sessionData.status = 'completed';
    }

    sessionData.updatedAt = new Date().toISOString();

    console.log(`📊 Updated session ${sessionId} with result for ${url} (${sessionData.results.length}/${totalUrls})`);

    await env.SITE_ANALYSIS_CACHE.put(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      { expirationTtl: SESSION_TTL }
    );

  } catch (error) {
    console.error(`💥 Failed to update session ${sessionId} with result:`, error);
    throw error;
  }
}

/**
 * Update session with error for a specific URL
 */
export async function updateSessionWithError(sessionId: string, url: string, error: any): Promise<void> {
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

    const sessionData = JSON.parse(currentData) as SessionData;

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
    const totalUrls = sessionData.urls?.length || 1;
    sessionData.progress = {
      ...sessionData.progress,
      current: sessionData.results.length,
      stage: sessionData.results.length >= totalUrls ? 'completed' : 'analyzing'
    };

    // Update session status if all URLs are done
    if (sessionData.results.length >= totalUrls) {
      sessionData.status = 'completed';
    }

    sessionData.updatedAt = new Date().toISOString();

    console.log(`📊 Updated session ${sessionId} with error for ${url} (${sessionData.results.length}/${totalUrls})`);

    await env.SITE_ANALYSIS_CACHE.put(
      `session:${sessionId}`,
      JSON.stringify(sessionData),
      { expirationTtl: SESSION_TTL }
    );

  } catch (updateError) {
    console.error(`💥 Failed to update session ${sessionId} with error:`, updateError);
    throw updateError;
  }
}

/**
 * Get session data from cache
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
  try {
    if (!env.SITE_ANALYSIS_CACHE) {
      console.error(`❌ No SITE_ANALYSIS_CACHE available for session ${sessionId}`);
      return null;
    }

    const currentData = await env.SITE_ANALYSIS_CACHE.get(`session:${sessionId}`);
    if (!currentData) {
      console.error(`❌ Session ${sessionId} not found in cache`);
      return null;
    }

    return JSON.parse(currentData) as SessionData;
  } catch (error) {
    console.error(`💥 Failed to get session ${sessionId}:`, error);
    throw error;
  }
}
