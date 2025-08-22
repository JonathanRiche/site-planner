import { SiteAnalysisService } from '../lib/analysis-service';
import { getDb, searches } from '../lib/db';

import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";
export default async function analyzeHandler({ request }: RequestInfo<any, AppContext>) {
  // Only handle POST requests for this endpoint
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Allow': 'POST'
        },
      }
    );
  }
  try {
    const body: { url: string } = await request.json();
    const url = body.url;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Use Cloudflare Browser Rendering with proper environment
    const analysisService = new SiteAnalysisService();

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in .dev.vars');
    }

    const result = await analysisService.analyzeSite(url);
    // Persist search
    try {
      const db = getDb();
      await db.insert(searches).values({
        id: result.analysisId,
        url: url
      });
    } catch (dbErr) {
      console.warn('Failed to persist search:', dbErr);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Analysis API error:', error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Analysis failed',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
