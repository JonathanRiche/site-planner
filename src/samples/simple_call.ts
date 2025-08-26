import { generateObject, streamObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { z } from 'zod';
// export const DEFAULT_MODEL = 'gpt-5-nano' as const;
export const DEFAULT_MODEL = 'gpt-5-mini' as const;
// export const DEFAULT_MODEL = 'gpt-5' as const;
export const PageAnalysisSchema = z.object({
	url: z.string(),
	title: z.string(),
	description: z.string().optional(),
	headings: z.array(z.object({
		level: z.number(),
		text: z.string(),
	})),
	keyContent: z.string(),
	technicalStack: z.object({
		framework: z.string().optional(),
		cms: z.string().optional(),
		analytics: z.array(z.string()),
	}),
	seoMetrics: z.object({
		hasMetaTitle: z.boolean(),
		hasMetaDescription: z.boolean(),
		hasStructuredData: z.boolean(),
		imageCount: z.number(),
		linkCount: z.number(),
	}),
});
export const LYTXRecommendationSchema = z.object({
	tagPlacements: z.array(z.object({
		location: z.enum(['head', 'body_start', 'body_end', 'after_content']),
		reason: z.string(),
		priority: z.enum(['high', 'medium', 'low']),
		code: z.string(),
	})),
	trackingEvents: z.array(z.object({
		event: z.string(),
		trigger: z.string(),
		implementation: z.string(),
		conversionImpact: z.enum(['high', 'medium', 'low']).optional(),
		conversionReason: z.string().optional(),
	})),
	optimizations: z.array(z.object({
		category: z.enum(['performance', 'user_experience', 'conversion']),
		suggestion: z.string(),
		impact: z.enum(['high', 'medium', 'low']),
	})),
})
export const SiteAnalysisResult = z.object({
	pageAnalysis: PageAnalysisSchema,
	lytxRecommendations: LYTXRecommendationSchema,
	analysisId: z.string(),
	timestamp: z.string(),
});
export type PageAnalysis = z.infer<typeof PageAnalysisSchema>;

export type LYTXRecommendation = z.infer<typeof LYTXRecommendationSchema>;

export type SiteAnalysisResult = z.infer<typeof SiteAnalysisResult>;
const openai = createOpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});
async function staticFetch(url: string) {

	console.log(`Static 📡 Fetching ${url}...`);
	const request = await fetch(url, {
		method: 'GET',
		headers: {
			'Content-Type': 'text/html',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
		}
	});
	if (request.ok) {
		const html = await request.text();
		console.log("Content ok", request.status, html.length);
		return html;

	} else {

		console.log('Error fetching static content');
		return null;

	}

}
function truncateHtml(html: string, maxLength: number = 3000): string {
	if (html.length <= maxLength) {
		return html;
	}

	// Try to truncate at a reasonable HTML boundary
	let truncated = html.substring(0, maxLength);
	const lastClosingTag = truncated.lastIndexOf('</');

	if (lastClosingTag > maxLength * 0.8) {
		// If we have a reasonable closing tag near the end, truncate there
		truncated = truncated.substring(0, lastClosingTag);
	}

	return truncated + '\n... (truncated due to size)';
}
function hasLytxScriptTag(html: string): boolean {
	if (!html) return false;
	return /<script[^>]+src=["'][^"']*(?:lytx\.io\/lytx\.js|analytics\.lytx\.io)[^"']*["'][^>]*>/i.test(html)
		|| /window\.(?:lytx|lytxApi)\b/i.test(html);
}
async function checkSite(url: string, html: string) {

	const truncatedHtml = truncateHtml(html);

	const lytxDetected = hasLytxScriptTag(html);
	console.log("Passing content through AI...");
	const stat_timer = Date.now();
	const { partialObjectStream, usage } = streamObject({
		model: openai(DEFAULT_MODEL),
		schema: SiteAnalysisResult,
		prompt: `Analyze this webpage HTML: ${url}

HTML:
${truncatedHtml}

LYTX Detection: ${lytxDetected ? 'Existing LYTX script detected - include "LYTX" in analytics array' : 'No LYTX script detected'}`,
	});

	// let pageAnalysis: PageAnalysis = pageAnalysisResult.object;
	// if (lytxDetected && !pageAnalysis.technicalStack.analytics.includes('LYTX')) {
	// 	pageAnalysis.technicalStack.analytics = [...pageAnalysis.technicalStack.analytics, 'LYTX'];
	// }
	// console.log(pageAnalysisResult.object);
	for await (const partialObject of partialObjectStream) {
		console.clear();
		console.dir(partialObject, { depth: null });
	}
	const end_timer = Date.now();
	console.log(`📡 Analyzed ${url} in ${(end_timer - stat_timer) / 1000} seconds`);
	const tokens = await usage;
	console.log(`📡 Tokens used: ${tokens.totalTokens} with ${DEFAULT_MODEL}`);


}

const urlToCrawl = process.argv[2];
console.log(`Crawling ${urlToCrawl}`);
if (!urlToCrawl) {
	throw new Error('No URL provided');
}
const htmlContent = await staticFetch(urlToCrawl);
if (htmlContent && urlToCrawl) {
	await checkSite(urlToCrawl, htmlContent);
}
