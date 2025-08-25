import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { SimpleCloudflareBrowserService } from './simple-browser-service';
import { SiteAnalysisResult, PageAnalysis, LYTXRecommendation, PageAnalysisSchema, LYTXRecommendationSchema } from './types';
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

  async analyzeSite(url: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();
    
    console.log(`🔍 [${analysisId}] Starting site analysis for: ${url}`, {
      timestamp: new Date().toISOString(),
      url
    });
    
    try {
      // Step 1: Fetch the webpage HTML using Cloudflare Browser Rendering
      console.log(`🌐 [${analysisId}] Step 1: Fetching HTML content...`);
      
      const pageContent = await this.browserService.renderPage(url, {
        takeScreenshot: false,
        useCache: true,
        blockResources: true,
        optimizeForContent: true,
      });
      
      console.log(`✅ [${analysisId}] HTML content fetched successfully`, {
        htmlLength: pageContent.html.length,
        title: pageContent.title,
        loadTime: pageContent.metadata.loadTime
      });

      // Step 2: Analyze page structure using AI with structured output
      console.log(`🤖 [${analysisId}] Step 2: Analyzing page structure with AI...`);
      const lytxDetected = hasLytxScriptTag(pageContent.html);
      if (lytxDetected) {
        console.log(`🔎 [${analysisId}] Detected existing LYTX script tag in HTML.`);
      }
      
      // Start page analysis (will run in parallel with recommendations) 
      const pageAnalysisPromise = Promise.race([
        generateObject({
          model: openai(DEFAULT_MODEL),
          schema: PageAnalysisSchema,
          prompt: `Analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Page analysis timeout after 60 seconds')), 60000))
      ]);

      // Step 3: Generate LYTX recommendations in parallel
      console.log(`🏷️ [${analysisId}] Step 3: Generating LYTX recommendations in parallel...`);
      
      // This will create a placeholder analysis for the recommendations prompt
      const basicPageData = {
        title: pageContent.title || 'Unknown Page',
        url: pageContent.url,
        hasLytx: lytxDetected
      };
      
      const recommendationsPromise = Promise.race([
        generateObject({
          model: openai(DEFAULT_MODEL),
          schema: LYTXRecommendationSchema,
          prompt: `You are a LYTX analytics expert. Generate LYTX implementation recommendations for this webpage.

IMPORTANT IMPLEMENTATION RULES:
1) The core tag MUST use: <script defer data-domain="<domain>" src="https://lytx.io/lytx.js?account=<ACCOUNT>"></script>
2) For custom events, ALWAYS use: window.lytxApi.event('<ACCOUNT>', 'web', '<event_name>')
3) Do NOT use 'lytrack', 'analytics.lytx.io', or other vendors. Use only LYTX patterns above.
4) Provide minimal, copy-pasteable code that matches these rules.

Page Info:
- URL: ${basicPageData.url}
- Title: ${basicPageData.title}
- LYTX Detection: ${lytxDetected ? 'LYTX already installed - acknowledge in tagPlacements and avoid duplicating core tag' : 'LYTX not detected - include core tag placement'}

Focus on conversion impact and provide clear implementation guidance.`,
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LYTX recommendations timeout after 60 seconds')), 60000))
      ]);

      // Wait for both AI calls to complete in parallel
      console.log(`⏳ [${analysisId}] Waiting for parallel AI analysis to complete...`);
      const [pageAnalysisResult, recommendationsResult] = await Promise.all([
        pageAnalysisPromise,
        recommendationsPromise
      ]);
      
      // Extract structured data from AI response
      console.log(`📊 [${analysisId}] Processing structured analysis response...`);
      
      let pageAnalysis: PageAnalysis = pageAnalysisResult.object;

      // Ensure analytics reflects detected LYTX script
      if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
      }
      console.log(`✅ [${analysisId}] Page analysis completed successfully:`, {
        title: pageAnalysis.title,
        headingsCount: pageAnalysis.headings.length,
        framework: pageAnalysis.technicalStack.framework,
        cms: pageAnalysis.technicalStack.cms,
        analyticsCount: pageAnalysis.technicalStack.analytics.length
      });

      // (LYTX recommendations are now generated in parallel above)

      // Extract structured recommendations from AI response
      console.log(`📋 [${analysisId}] Processing LYTX recommendations...`);
      
      let lytxRecommendations: LYTXRecommendation = recommendationsResult.object;

      // Enforce vendor-specific implementation details post-parse as a safeguard
      lytxRecommendations.tagPlacements = lytxRecommendations.tagPlacements.map(p => ({
        ...p,
        code: p.code
          .replace(/analytics\.lytx\.io\S*/gi, 'lytx.io/lytx.js?account=<ACCOUNT>')
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      lytxRecommendations.trackingEvents = lytxRecommendations.trackingEvents.map(e => ({
        ...e,
        implementation: e.implementation
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      // If LYTX already installed, avoid duplicate core tag recommendations and add acknowledgement
      if (pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        const isCoreTagCode = (code: string) => /lytx\.io\/lytx\.js|analytics\.lytx\.io/i.test(code);
        let placements = lytxRecommendations.tagPlacements.filter(p => !isCoreTagCode(p.code));
        const acknowledgment = {
          location: 'head' as const,
          reason: 'LYTX appears to be already installed on this site. Verify configuration and ensure events are firing as expected.',
          priority: 'low' as const,
          code: ''
        };
        placements = [acknowledgment, ...placements];
        lytxRecommendations.tagPlacements = placements;
      }

      console.log(`✅ [${analysisId}] LYTX recommendations completed successfully:`, {
        tagPlacementsCount: lytxRecommendations.tagPlacements.length,
          trackingEventsCount: lytxRecommendations.trackingEvents.length,
          optimizationsCount: lytxRecommendations.optimizations.length
        });

      // Step 4: Combine results
      console.log(`📦 [${analysisId}] Step 4: Combining results...`);
      const totalTime = Date.now() - startTime;
      
      const analysisResult: SiteAnalysisResult = {
        pageAnalysis: {
          ...pageAnalysis,
          // Add metadata about potential bot protection
          ...(pageAnalysis.title.toLowerCase().includes('attention required') && {
            technicalStack: {
              ...pageAnalysis.technicalStack,
              analytics: [...pageAnalysis.technicalStack.analytics, 'Bot Protection Detected']
            }
          })
        },
        lytxRecommendations,
        analysisId,
        timestamp: new Date().toISOString(),
      };

      console.log(`🏁 [${analysisId}] Site analysis completed successfully in ${totalTime}ms`, {
        url,
        totalTime: `${totalTime}ms`,
        htmlSize: pageContent.html.length,
        pageTitle: pageAnalysis.title,
        recommendationsGenerated: lytxRecommendations.tagPlacements.length + lytxRecommendations.trackingEvents.length + lytxRecommendations.optimizations.length
      });

      return analysisResult;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`💥 [${analysisId}] Site analysis failed after ${totalTime}ms:`, {
        url,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
        totalTime: `${totalTime}ms`,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async analyzeMultiplePages(urls: string[], options: {
    concurrency?: number;
  } = {}): Promise<SiteAnalysisResult[]> {
    const { concurrency = 3 } = options; // Default to 3 concurrent requests
    const batchId = crypto.randomUUID();
    
    console.log(`🚀 [${batchId}] Starting parallel analysis of ${urls.length} URLs with concurrency=${concurrency}`);
    
    // Use Promise.allSettled to process all URLs in parallel while handling failures gracefully
    const promises = urls.map(async (url, index) => {
      try {
        console.log(`📄 [${batchId}] Starting analysis ${index + 1}/${urls.length}: ${url}`);
        const result = await this.analyzeSite(url);
        console.log(`✅ [${batchId}] Completed analysis ${index + 1}/${urls.length}: ${url}`);
        return { status: 'fulfilled' as const, value: result, url };
      } catch (error) {
        console.error(`❌ [${batchId}] Failed analysis ${index + 1}/${urls.length}: ${url}:`, error);
        return { status: 'rejected' as const, reason: error, url };
      }
    });

    // Process with controlled concurrency to avoid overwhelming the system
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
        // Errors are already logged in the individual promises above
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

  // Analyze provided HTML directly (no fetching/rendering)
  async analyzeProvidedHtml(url: string, html: string): Promise<SiteAnalysisResult> {
    const analysisId = crypto.randomUUID();
    const startTime = Date.now();
    console.log(`🔍 [${analysisId}] Starting direct HTML analysis for: ${url}`);

    // Prepare a faux pageContent
    const pageContent = {
      html,
      title: (html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || 'No title found').trim(),
      url,
      metadata: {
        viewport: { width: 1280, height: 720 },
        loadTime: 0,
        timestamp: new Date().toISOString(),
      },
    } as const;

    try {
      // Reuse the same AI steps as analyzeSite
      console.log(`🤖 [${analysisId}] Analyzing page structure with AI (provided HTML)...`);
      const lytxDetected = hasLytxScriptTag(pageContent.html);
      const pageAnalysisResult = await generateObject({
        model: openai(DEFAULT_MODEL),
        schema: PageAnalysisSchema,
        prompt: `Analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
      });

      let pageAnalysis: PageAnalysis = pageAnalysisResult.object;
      if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
      }

      // Recommendations
      const recommendationsResult = await generateObject({
        model: openai(DEFAULT_MODEL),
        schema: LYTXRecommendationSchema,
        prompt: `You are a LYTX analytics expert. Generate LYTX implementation recommendations based on this page analysis.

IMPORTANT IMPLEMENTATION RULES:
1) The core tag MUST use: <script defer data-domain="<domain>" src="https://lytx.io/lytx.js?account=<ACCOUNT>"></script>
2) For custom events, ALWAYS use: window.lytxApi.event('<ACCOUNT>', 'web', '<event_name>')
3) Do NOT use 'lytrack', 'analytics.lytx.io', or other vendors. Use only LYTX patterns above.
4) Provide minimal, copy-pasteable code that matches these rules.

Page Analysis Data:
${JSON.stringify(pageAnalysis, null, 2)}

LYTX Detection: ${pageAnalysis.technicalStack.analytics.includes('LYTX') ? 'LYTX already installed - acknowledge in tagPlacements and avoid duplicating core tag' : 'LYTX not detected - include core tag placement'}

Focus on conversion impact and provide clear implementation guidance.`,
      });

      let lytxRecommendations: LYTXRecommendation = recommendationsResult.object;
      lytxRecommendations.tagPlacements = lytxRecommendations.tagPlacements.map(p => ({
        ...p,
        code: p.code
          .replace(/analytics\.lytx\.io\S*/gi, 'lytx.io/lytx.js?account=<ACCOUNT>')
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      lytxRecommendations.trackingEvents = lytxRecommendations.trackingEvents.map(e => ({
        ...e,
        implementation: e.implementation
          .replace(/lytrack\s*\(/gi, "window.lytxApi.event('<ACCOUNT>', 'web', ")
      }));
      if (pageAnalysis.technicalStack.analytics.includes('LYTX')) {
        const isCoreTagCode = (code: string) => /lytx\.io\/lytx\.js|analytics\.lytx\.io/i.test(code);
        let placements = lytxRecommendations.tagPlacements.filter(p => !isCoreTagCode(p.code));
        placements = [{
          location: 'head' as const,
          reason: 'LYTX appears to be already installed on this site. Verify configuration and ensure events are firing as expected.',
          priority: 'low' as const,
          code: ''
        }, ...placements];
        lytxRecommendations.tagPlacements = placements;
      }

      const totalTime = Date.now() - startTime;
      const analysisResult: SiteAnalysisResult = {
        pageAnalysis,
        lytxRecommendations,
        analysisId,
        timestamp: new Date().toISOString(),
      };
      console.log(`🏁 [${analysisId}] Direct HTML analysis completed in ${totalTime}ms`);
      return analysisResult;
    } catch (error) {
      console.error(`💥 [${analysisId}] Direct HTML analysis failed:`, error);
      throw error;
    }
  }
}