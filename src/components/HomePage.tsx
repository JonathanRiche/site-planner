'use client';

import { useMemo, useState } from 'react';
import { createLytxTag, inferDomainFromUrl } from '@vendors/lytx';

interface AnalysisResult {
  pageAnalysis: {
    url: string;
    title: string;
    description?: string;
    headings: { level: number; text: string }[];
    keyContent: string;
    technicalStack: {
      framework?: string;
      cms?: string;
      analytics: string[];
    };
    seoMetrics: {
      hasMetaTitle: boolean;
      hasMetaDescription: boolean;
      hasStructuredData: boolean;
      imageCount: number;
      linkCount: number;
    };
  };
  lytxRecommendations: {
    tagPlacements: {
      location: string;
      reason: string;
      priority: string;
      code: string;
    }[];
    trackingEvents: {
      event: string;
      trigger: string;
      implementation: string;
      conversionImpact?: 'high' | 'medium' | 'low';
      conversionReason?: string;
    }[];
    optimizations: {
      category: string;
      suggestion: string;
      impact: string;
    }[];
  };
  analysisId: string;
  timestamp: string;
}

export function HomePage() {
  const [url, setUrl] = useState('');
  const [lytxKey, setLytxKey] = useState('');
  const [crawl, setCrawl] = useState<boolean>(true);
  const [maxPages, setMaxPages] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnalysisResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [progress, setProgress] = useState<
    | { stage: 'idle' }
    | { stage: 'crawling'; url: string; allUrls?: string[]; selectedUrls?: string[] }
    | { stage: 'analyzing'; current: number; total: number }
  >({ stage: 'idle' });

  const analyzeWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setProgress({ stage: 'idle' });

    try {
      if (crawl) {
        setProgress({ stage: 'crawling', url });
        // Step 1: crawl links first for feedback
        const crawlRes = await fetch('/api/crawl-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, maxPages }),
        });
        if (!crawlRes.ok) throw new Error(`Crawl failed: ${crawlRes.statusText}`);
        const { urls, allUrls } = await crawlRes.json() as { urls: string[]; allUrls: string[] };
        setProgress({ stage: 'crawling', url, allUrls, selectedUrls: urls });

        // Step 2: analyze all pages
        setProgress({ stage: 'analyzing', current: 0, total: urls.length });
        const analyzeRes = await fetch('/api/analyze-crawl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, maxPages }),
        });
        if (!analyzeRes.ok) throw new Error(`Analysis failed: ${analyzeRes.statusText}`);
        const arr: AnalysisResult[] = await analyzeRes.json();
        setResults(arr);
        setSelectedIndex(0);
        setProgress({ stage: 'idle' });
      } else {
        setProgress({ stage: 'analyzing', current: 0, total: 1 });
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!response.ok) throw new Error(`Analysis failed: ${response.statusText}`);
        const single: AnalysisResult = await response.json();
        setResults([single]);
        setSelectedIndex(0);
        setProgress({ stage: 'idle' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const selectedResult = Array.isArray(results) && results.length > 0
    ? results[Math.min(selectedIndex, results.length - 1)]
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Site Planner
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Intelligent website analysis for optimal LYTX.io analytics integration. 
            Get comprehensive recommendations for tag placement, tracking, and optimization.
          </p>
        </header>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <form onSubmit={analyzeWebsite} className="space-y-4">
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                Website URL to analyze
              </label>
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={loading}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={crawl}
                  onChange={(e) => setCrawl(e.target.checked)}
                  disabled={loading}
                />
                Crawl internal links
              </label>
              <div className="flex items-center gap-2">
                <label htmlFor="maxPages" className="text-sm text-gray-700">Max pages</label>
                <input
                  type="number"
                  id="maxPages"
                  min={1}
                  max={20}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-20 px-2 py-1 border border-gray-300 rounded"
                  disabled={loading || !crawl}
                />
              </div>
            </div>
            <div>
              <label htmlFor="lytxKey" className="block text-sm font-medium text-gray-700 mb-2">
                Optional: LYTX Account Key (to generate embed snippet)
              </label>
              <input
                type="text"
                id="lytxKey"
                value={lytxKey}
                onChange={(e) => setLytxKey(e.target.value)}
                placeholder="acct_123..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !url}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze Website'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Analysis Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
                {error.includes('blocked') && (
                  <div className="mt-3 text-sm text-red-600">
                    <strong>Bot Protection Detected:</strong> This website is using security measures that may block automated analysis. 
                    This is common with sites protected by Cloudflare, Imperva, or other security services.
                    <br />
                    <em>Tip: Try analyzing a different page on the same domain or wait a few minutes before retrying.</em>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {(progress.stage !== 'idle') && (
          <div className="mb-6">
            {progress.stage === 'crawling' && (
              <div className="space-y-2">
                <div className="text-sm text-gray-700">Crawling pages from <strong>{progress.url}</strong>…</div>
                {progress.allUrls && (
                  <div className="text-xs text-gray-600">
                    Found {progress.allUrls.length} internal links. Crawling up to {progress.selectedUrls?.length} due to max pages limit.
                  </div>
                )}
                {progress.allUrls && (
                  <div className="max-h-40 overflow-auto border border-gray-200 rounded p-2 bg-white text-xs">
                    {progress.allUrls.map((u) => {
                      const chosen = progress.selectedUrls?.includes(u);
                      return (
                        <div key={u} className="flex items-center gap-2 py-0.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${chosen ? 'bg-blue-600' : 'bg-gray-300'}`} />
                          <span className={chosen ? 'text-gray-800' : 'text-gray-500'}>{u}</span>
                          {!chosen && <span className="ml-auto text-gray-400">skipped</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {progress.stage === 'analyzing' && (
              <div className="text-sm text-gray-700">Analyzing pages…</div>
            )}
            <div className="mt-2 h-2 w-full bg-gray-200 rounded">
              <div
                className={`h-2 rounded ${progress.stage === 'crawling' ? 'bg-yellow-500' : 'bg-blue-600'}`}
                style={{ width: progress.stage === 'crawling' ? '30%' : '70%' }}
              />
            </div>
          </div>
        )}

        {selectedResult && (
          <div className="space-y-6">
            {results && results.length > 1 && (
              <div className="grid md:grid-cols-2 gap-4">
                {results.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedIndex(i)}
                    className={`text-left w-full border rounded-lg p-4 transition-colors cursor-pointer ${
                      i === selectedIndex ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="text-xs text-gray-500 mb-1">{new URL(r.pageAnalysis.url).hostname}</div>
                    <div className="font-medium text-gray-900 truncate">{r.pageAnalysis.title || r.pageAnalysis.url}</div>
                    <div className="text-xs text-gray-600 truncate">{r.pageAnalysis.url}</div>
                  </button>
                ))}
              </div>
            )}

            <section className="space-y-6">
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-2xl font-bold text-gray-900">Page Analysis</h2>
                    {results && results.length > 1 && (
                      <span className="text-sm text-gray-500">{selectedIndex + 1} of {results.length}</span>
                    )}
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-2">Basic Information</h3>
                      <p><strong>Title:</strong> {selectedResult.pageAnalysis.title}</p>
                      {selectedResult.pageAnalysis.description && (
                        <p><strong>Description:</strong> {selectedResult.pageAnalysis.description}</p>
                      )}
                      <p><strong>URL:</strong> {selectedResult.pageAnalysis.url}</p>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-2">Technical Stack</h3>
                      {selectedResult.pageAnalysis.technicalStack.framework && (
                        <p><strong>Framework:</strong> {selectedResult.pageAnalysis.technicalStack.framework}</p>
                      )}
                      {selectedResult.pageAnalysis.technicalStack.cms && (
                        <p><strong>CMS:</strong> {selectedResult.pageAnalysis.technicalStack.cms}</p>
                      )}
                      <p><strong>Analytics:</strong> {selectedResult.pageAnalysis.technicalStack.analytics.join(', ') || 'None detected'}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">LYTX Implementation Recommendations</h2>
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Tag Placements</h3>
                      <div className="space-y-4">
                        {selectedResult.lytxRecommendations.tagPlacements.map((placement, index) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-medium text-gray-800">Location: {placement.location}</h4>
                              <span className={`px-2 py-1 text-xs rounded ${
                                placement.priority === 'high' ? 'bg-red-100 text-red-800'
                                  : placement.priority === 'medium' ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {placement.priority} priority
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-3">{placement.reason}</p>
                            <div className="relative">
                              <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                                <code>{placement.code}</code>
                              </pre>
                              <div className="absolute top-2 right-2">
                                <CopyButton text={placement.code} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Tracking Events</h3>
                      <div className="space-y-3">
                    {selectedResult.lytxRecommendations.trackingEvents.map((event, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h4 className="font-medium text-gray-800">{event.event}</h4>
                            <p className="text-sm text-gray-600 mb-2">Trigger: {event.trigger}</p>
                            {event.conversionImpact && (
                              <div className="text-xs inline-flex items-center gap-2 mb-2">
                                <span className={`px-2 py-1 rounded ${
                                  event.conversionImpact === 'high' ? 'bg-red-100 text-red-800' :
                                  event.conversionImpact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                  'bg-green-100 text-green-800'
                                }`}>
                                  {event.conversionImpact} conversion impact
                                </span>
                                {event.conversionReason && (
                                  <span className="text-gray-600">{event.conversionReason}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="relative">
                          <pre className="bg-gray-50 p-2 rounded text-sm overflow-x-auto">
                            <code>{event.implementation}</code>
                          </pre>
                          <div className="absolute top-2 right-2">
                            <CopyButton text={event.implementation} small />
                          </div>
                        </div>
                      </div>
                    ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Optimization Suggestions</h3>
                      <div className="space-y-3">
                        {selectedResult.lytxRecommendations.optimizations.map((optimization, index) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-medium text-gray-800 capitalize">{optimization.category}</h4>
                              <span className={`px-2 py-1 text-xs rounded ${
                                optimization.impact === 'high' ? 'bg-red-100 text-red-800'
                                  : optimization.impact === 'medium' ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-green-100 text-green-800'
                              }`}>
                                {optimization.impact} impact
                              </span>
                            </div>
                            <p className="text-sm text-gray-600">{optimization.suggestion}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {lytxKey && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">Generated Embed Snippet</h3>
                  <EmbedSnippet url={selectedResult.pageAnalysis.url} accountKey={lytxKey} />
                  </div>
                )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function EmbedSnippet({ url, accountKey }: { url: string; accountKey: string }) {
  const domain = useMemo(() => inferDomainFromUrl(url), [url]);
  const snippet = useMemo(() => createLytxTag(accountKey, domain), [accountKey, domain]);
  return (
    <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
      <code>{snippet}</code>
    </pre>
  );
}

function CopyButton({ text, small = false }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const sizeClasses = small ? 'p-1 text-xs' : 'p-2 text-sm';
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 bg-white/80 hover:bg-white text-gray-700 border border-gray-300 rounded ${sizeClasses}`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={small ? 'w-4 h-4' : 'w-5 h-5'}>
        <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
      </svg>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}