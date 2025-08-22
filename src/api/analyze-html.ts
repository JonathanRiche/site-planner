import { SiteAnalysisService } from '../lib/analysis-service';
import type { AppContext } from "@/worker";
import type { RequestInfo } from "rwsdk/worker";

export default async function analyzeHtmlHandler({ request, env }: RequestInfo<any, AppContext>) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  try {
    const body: { url: string; html: string } = await request.json();
    const { url, html } = body;

    if (!url || !html) {
      return new Response(JSON.stringify({ error: 'Both url and html are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const analysisService = new SiteAnalysisService();
    const result = await analysisService.analyzeProvidedHtml(url, html);
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
    console.error('Analyze HTML API error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Analyze HTML failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
