import { SiteAnalysisService } from '../lib/analysis-service';
import { env } from 'cloudflare:workers';

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
      const db = env.SITE_PLANNER_DB as D1Database;
      await db.exec(`CREATE TABLE IF NOT EXISTS searches (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );`);
      await db.prepare(`INSERT INTO searches (id, url) VALUES (?1, ?2)`).bind(result.analysisId, url).run();
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
