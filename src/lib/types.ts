import { z } from 'zod';

export type NewSessionRequest = {
  url: string;
  crawl?: boolean;
  maxPages?: number;
  usePuppeteer?: boolean;
  useExternalFetcher?: boolean;
  extraInstructions?: string;
  concurrency?: number;
};


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
});

export const SiteAnalysisResult = z.object({
  pageAnalysis: PageAnalysisSchema,
  lytxRecommendations: LYTXRecommendationSchema,
  analysisId: z.string(),
  timestamp: z.string(),
  detectedLytxAccount: z.string().nullable().optional(),
});

export type PageAnalysis = z.infer<typeof PageAnalysisSchema>;
export type LYTXRecommendation = z.infer<typeof LYTXRecommendationSchema>;
export type SiteAnalysisResult = z.infer<typeof SiteAnalysisResult>;
