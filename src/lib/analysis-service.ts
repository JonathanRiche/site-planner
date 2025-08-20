import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { CloudflareBrowserService } from './browser-service';
import { SiteAnalysisResult, PageAnalysis, LYTXRecommendation } from './types';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper utilities to extract valid JSON from LLM responses that may include
// markdown fences, pre/post text, or additional formatting.
function extractJsonFromResponse(text: string): string {
  if (!text) return text;

  // Normalize and strip BOM/zero-width spaces
  let working = text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();

  // 1) Prefer fenced code blocks (json/js/javascript)
  const fenceMatch = working.match(/```(?:json|js|javascript)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    working = fenceMatch[1].trim();
  }

  // Remove accidental leading language hint like "json" at the top
  if (/^json\s*[\r\n]/i.test(working)) {
    working = working.replace(/^json\s*[\r\n]+/i, '');
  }

  // If it already starts with a JSON container, try as-is
  const startsLikeJson = /^(\{|\[)/.test(working);
  if (startsLikeJson) {
    return working;
  }

  // 2) Fallback: find the first balanced JSON object/array segment in the text
  const balanced = extractBalancedJsonSegment(working);
  if (balanced) {
    return balanced.trim();
  }

  // 3) Last resort: try on original text in case fences were incomplete
  const balancedFromOriginal = extractBalancedJsonSegment(text);
  if (balancedFromOriginal) {
    return balancedFromOriginal.trim();
  }

  // If nothing better found, return trimmed input; caller will attempt JSON.parse and handle errors
  return working;
}

// Scans input for the first balanced top-level JSON object or array, ignoring braces inside strings
function extractBalancedJsonSegment(source: string): string | null {
  if (!source) return null;

  const startIndex = findFirstJsonContainerIndex(source);
  if (startIndex === -1) return null;

  const openingChar = source[startIndex];
  const closingChar = openingChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let stringQuote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      inString = true;
      stringQuote = char as '"' | "'";
      continue;
    }

    if (char === openingChar) {
      depth += 1;
    } else if (char === closingChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function findFirstJsonContainerIndex(text: string): number {
  const objIndex = text.indexOf('{');
  const arrIndex = text.indexOf('[');
  if (objIndex === -1 && arrIndex === -1) return -1;
  if (objIndex === -1) return arrIndex;
  if (arrIndex === -1) return objIndex;
  return Math.min(objIndex, arrIndex);
}

// Detect presence of LYTX script in raw HTML
function hasLytxScriptTag(html: string): boolean {
  if (!html) return false;
  return /<script[^>]+src=["'][^"']*(?:lytx\.io\/lytx\.js|analytics\.lytx\.io)[^"']*["'][^>]*>/i.test(html)
    || /window\.(?:lytx|lytxApi)\b/i.test(html);
}

export class SiteAnalysisService {
  private browserService: CloudflareBrowserService;

  constructor() {
    this.browserService = new CloudflareBrowserService();
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
      
      let pageContent;
      try {
        pageContent = await this.browserService.renderPage(url, {
          takeScreenshot: false,
          useCache: true,
        });
      } catch (error) {
        // If we get blocked content error, clear cache and retry once without cache
        if (error instanceof Error && error.message.includes('blocked')) {
          console.warn(`🚫 [${analysisId}] Got blocked content, clearing cache and retrying...`);
          await this.browserService.clearCache(url, { takeScreenshot: false, useCache: true });
          
          // Retry without cache
          console.log(`🔄 [${analysisId}] Retrying without cache...`);
          pageContent = await this.browserService.renderPage(url, {
            takeScreenshot: false,
            useCache: false,
          });
        } else {
          console.error(`💥 [${analysisId}] Browser service error:`, error);
          throw error;
        }
      }
      
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
      const pageAnalysisResult = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `You are a website analysis expert. Analyze the provided HTML and return a JSON object with the following structure:
{
  "url": "string",
  "title": "string", 
  "description": "string (optional)",
  "headings": [{"level": number, "text": "string"}],
  "keyContent": "string (first 500 chars of main content)",
  "technicalStack": {
    "framework": "string (optional - React, Next.js, etc)",
    "cms": "string (optional - WordPress, Shopify, etc)", 
    "analytics": ["string array of detected analytics tools"]
  },
  "seoMetrics": {
    "hasMetaTitle": boolean,
    "hasMetaDescription": boolean,
    "hasStructuredData": boolean,
    "imageCount": number,
    "linkCount": number
  }
}

Only return valid JSON, no other text or markdown formatting.`,
          },
          {
            role: 'user',
            content: `Please analyze this webpage HTML: ${pageContent.url}

HTML (truncated if needed):
${pageContent.html.substring(0, 8000)} ${pageContent.html.length > 8000 ? '... (truncated)' : ''}`,
          },
          {
            role: 'system',
            content: `Detector note: Existing LYTX script present in HTML = ${lytxDetected}. If true, ensure the analytics list includes "LYTX".`,
          },
        ],
      });

      // Parse the JSON response
      console.log(`📊 [${analysisId}] Parsing AI analysis response...`, {
        responseLength: pageAnalysisResult.text.length,
        preview: pageAnalysisResult.text.substring(0, 200)
      });
      
      let pageAnalysis: PageAnalysis;
      try {
        // Extract JSON from response (handles markdown code blocks)
        const cleanJson = extractJsonFromResponse(pageAnalysisResult.text);
        console.log(`🧹 [${analysisId}] Cleaned JSON:`, {
          originalLength: pageAnalysisResult.text.length,
          cleanedLength: cleanJson.length,
          hasMarkdown: pageAnalysisResult.text.includes('```'),
          preview: cleanJson.substring(0, 200)
        });
        
        pageAnalysis = JSON.parse(cleanJson);

        // Ensure analytics reflects detected LYTX script
        if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
          pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
        }
        console.log(`✅ [${analysisId}] Page analysis parsed successfully:`, {
          title: pageAnalysis.title,
          headingsCount: pageAnalysis.headings.length,
          framework: pageAnalysis.technicalStack.framework,
          cms: pageAnalysis.technicalStack.cms,
          analyticsCount: pageAnalysis.technicalStack.analytics.length
        });
      } catch (parseError) {
        console.error(`💥 [${analysisId}] Failed to parse page analysis JSON:`, {
          error: parseError,
          rawResponse: pageAnalysisResult.text.substring(0, 500),
          cleanedJson: extractJsonFromResponse(pageAnalysisResult.text).substring(0, 500)
        });
        throw new Error('AI returned invalid JSON for page analysis');
      }

      // Step 3: Generate LYTX recommendations
      console.log(`🏷️ [${analysisId}] Step 3: Generating LYTX recommendations...`);
      const recommendationsResult = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `You are a LYTX analytics expert. Based on page analysis data, provide LYTX implementation recommendations in this JSON format. IMPORTANT IMPLEMENTATION RULES:
1) The core tag MUST use: <script defer data-domain="<domain>" src="https://lytx.io/lytx.js?account=<ACCOUNT>"></script>
2) For custom events, ALWAYS use: window.lytxApi.event('<ACCOUNT>', 'web', '<event_name>')
3) Do NOT use 'lytrack', 'analytics.lytx.io', or other vendors. Use only LYTX patterns above.
4) Provide minimal, copy-pasteable code that matches these rules.

{
  "tagPlacements": [{
    "location": "head|body_start|body_end|after_content",
    "reason": "string explaining why this placement",
    "priority": "high|medium|low", 
    "code": "string with actual implementation code"
  }],
  "trackingEvents": [{
    "event": "string event name",
    "trigger": "string describing when it triggers", 
    "implementation": "string with code example"
  }],
  "optimizations": [{
    "category": "performance|user_experience|conversion",
    "suggestion": "string describing the optimization",
    "impact": "high|medium|low"
  }]
}

Focus on LYTX-specific implementation. Only return valid JSON, no other text or markdown formatting.`,
          },
          {
            role: 'user',
            content: `Generate LYTX recommendations for this page analysis:
${JSON.stringify(pageAnalysis, null, 2)}

Consider the technical stack, content type, and existing analytics when making recommendations.`,
          },
          {
            role: 'system',
            content: `Detector note: LYTX already installed on site = ${pageAnalysis.technicalStack.analytics.includes('LYTX')}. If true, acknowledge it in tagPlacements and avoid duplicating the core tag.`,
          },
        ],
      });

      // Parse the LYTX recommendations
      console.log(`📋 [${analysisId}] Parsing LYTX recommendations...`, {
        responseLength: recommendationsResult.text.length
      });
      
      let lytxRecommendations: LYTXRecommendation;
      try {
        // Extract JSON from response (handles markdown code blocks)
        const cleanJson = extractJsonFromResponse(recommendationsResult.text);
        lytxRecommendations = JSON.parse(cleanJson);

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

        console.log(`✅ [${analysisId}] LYTX recommendations parsed successfully:`, {
          tagPlacementsCount: lytxRecommendations.tagPlacements.length,
          trackingEventsCount: lytxRecommendations.trackingEvents.length,
          optimizationsCount: lytxRecommendations.optimizations.length
        });
      } catch (parseError) {
        console.error(`💥 [${analysisId}] Failed to parse LYTX recommendations JSON:`, {
          error: parseError,
          rawResponse: recommendationsResult.text.substring(0, 500),
          cleanedJson: extractJsonFromResponse(recommendationsResult.text).substring(0, 500)
        });
        throw new Error('AI returned invalid JSON for LYTX recommendations');
      }

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

  async analyzeMultiplePages(urls: string[]): Promise<SiteAnalysisResult[]> {
    const results: SiteAnalysisResult[] = [];
    
    for (const url of urls) {
      try {
        const result = await this.analyzeSite(url);
        results.push(result);
      } catch (error) {
        console.error(`Failed to analyze ${url}:`, error);
        // Continue with other URLs even if one fails
      }
    }
    
    return results;
  }
}