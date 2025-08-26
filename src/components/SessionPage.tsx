'use client';

import { useState, useEffect } from 'react';
import { createLytxTag, inferDomainFromUrl } from '@vendors/lytx';

interface SessionData {
  id: string;
  url: string;
  crawl: boolean;
  maxPages: number;
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'error';
  progress: {
    stage: 'idle' | 'crawling' | 'analyzing' | 'completed' | 'error';
    current?: number;
    total?: number;
    message?: string;
    urls?: string[];
    allUrls?: string[];
  };
  results?: any[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface SessionPageProps {
  sessionId: string;
}

export function SessionPage({ sessionId }: SessionPageProps) {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lytxKey, setLytxKey] = useState('');

  // Poll for session updates
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/session/${sessionId}`);
        if (!response.ok) {
          throw new Error(`Session not found: ${response.statusText}`);
        }
        const data: SessionData = await response.json();
        setSessionData(data);

        // Stop polling when analysis is complete or failed
        if (data.status === 'completed' || data.status === 'error') {
          setLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch session');
        setLoading(false);
      }
    };

    // Initial fetch
    fetchSession();

    // Set up polling interval (every 2 seconds while in progress)
    const interval = setInterval(() => {
      if (sessionData?.status !== 'completed' && sessionData?.status !== 'error') {
        fetchSession();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [sessionId, sessionData?.status]);

  // Handle case where session is not found or there's an error
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold text-red-800 mb-2">Session Error</h2>
            <p className="text-red-700">{error}</p>
            <a
              href="/"
              className="inline-block mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Start New Analysis
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while fetching session data
  if (!sessionData) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedResult = sessionData.results && sessionData.results.length > 0
    ? sessionData.results[Math.min(selectedIndex, sessionData.results.length - 1)]
    : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Site Analysis Results
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Analyzing: <strong>{sessionData.url}</strong>
          </p>
          <div className="mt-2 text-sm text-gray-500">
            Session: {sessionId}
            <br />
            Crawled: {new Date(sessionData.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })} {sessionData.status === 'completed' && sessionData.updatedAt !== sessionData.createdAt &&
              `(completed ${new Date(sessionData.updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })})`
            }
          </div>
        </header>

        {/* Progress Section */}
        {sessionData.status !== 'completed' && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">Analysis Progress</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${sessionData.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    sessionData.status === 'crawling' ? 'bg-blue-100 text-blue-800' :
                      sessionData.status === 'analyzing' ? 'bg-purple-100 text-purple-800' :
                        sessionData.status === 'error' ? 'bg-red-100 text-red-800' :
                          'bg-green-100 text-green-800'
                  }`}>
                  {sessionData.status.charAt(0).toUpperCase() + sessionData.status.slice(1)}
                </span>
              </div>

              {sessionData.progress.message && (
                <p className="text-gray-600">{sessionData.progress.message}</p>
              )}

              {/* Progress bar */}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${sessionData.status === 'crawling' ? 'bg-blue-600' :
                      sessionData.status === 'analyzing' ? 'bg-purple-600' :
                        sessionData.status === 'error' ? 'bg-red-600' :
                          'bg-green-600'
                    }`}
                  style={{
                    width: sessionData.progress.total
                      ? `${Math.round((sessionData.progress.current || 0) / sessionData.progress.total * 100)}%`
                      : sessionData.status === 'pending' ? '10%' :
                        sessionData.status === 'crawling' ? '25%' :
                          sessionData.status === 'analyzing' ? '50%' :
                            '100%'
                  }}
                />
              </div>

              {/* URL List */}
              {sessionData.progress.allUrls && sessionData.progress.allUrls.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Found URLs ({sessionData.progress.allUrls.length} total):
                  </h3>
                  <div className="max-h-32 overflow-auto border border-gray-200 rounded p-2 bg-gray-50 text-xs">
                    {sessionData.progress.allUrls.map((url, index) => {
                      const selected = sessionData.progress.urls?.includes(url);
                      return (
                        <div key={index} className="flex items-center gap-2 py-0.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${selected ? 'bg-blue-600' : 'bg-gray-300'
                            }`} />
                          <span className={selected ? 'text-gray-800' : 'text-gray-500'}>
                            {url}
                          </span>
                          {!selected && <span className="ml-auto text-gray-400">skipped</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Section */}
        {sessionData.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Analysis Failed</h2>
            <p className="text-red-700">{sessionData.error || 'An unknown error occurred'}</p>
            <a
              href="/"
              className="inline-block mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Start New Analysis
            </a>
          </div>
        )}

        {/* Results Section */}
        {sessionData.results && sessionData.results.length > 0 && (
          <div className="space-y-6">
            {/* LYTX Key Input */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <label htmlFor="lytxKey" className="block text-sm font-medium text-gray-700 mb-2">
                Optional: LYTX Account Key (to generate embed snippets)
              </label>
              <input
                type="text"
                id="lytxKey"
                value={lytxKey}
                onChange={(e) => setLytxKey(e.target.value)}
                placeholder="acct_123..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Page Selection */}
            {sessionData.results.length > 1 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">
                  Analyzed Pages ({sessionData.results.length} total)
                </h2>
                <div className="grid md:grid-cols-2 gap-4">
                  {sessionData.results.map((result, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`text-left w-full border rounded-lg p-4 transition-colors cursor-pointer ${i === selectedIndex ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <div className="text-xs text-gray-500 mb-1">
                        {new URL(result.pageAnalysis.url).hostname}
                      </div>
                      <div className="font-medium text-gray-900 truncate">
                        {result.pageAnalysis.title || result.pageAnalysis.url}
                      </div>
                      <div className="text-xs text-gray-600 truncate">
                        {result.pageAnalysis.url}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Selected Result Details */}
            {selectedResult && (
              <section className="space-y-6">
                <div className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-2xl font-bold text-gray-900">Page Analysis</h2>
                    {sessionData.results && sessionData.results.length > 1 && (
                      <span className="text-sm text-gray-500">
                        {selectedIndex + 1} of {sessionData.results.length}
                      </span>
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

                {/* LYTX Recommendations - Same as in HomePage */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">LYTX Implementation Recommendations</h2>
                  <div className="space-y-6">
                    {/* Tag Placements */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Tag Placements</h3>
                      <div className="space-y-4">
                        {selectedResult.lytxRecommendations.tagPlacements.map((placement: any, index: number) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-medium text-gray-800">Location: {placement.location}</h4>
                              <span className={`px-2 py-1 text-xs rounded ${placement.priority === 'high' ? 'bg-red-100 text-red-800'
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

                    {/* Tracking Events */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Tracking Events</h3>
                      <div className="space-y-3">
                        {selectedResult.lytxRecommendations.trackingEvents.map((event: any, index: number) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h4 className="font-medium text-gray-800">{event.event}</h4>
                                <p className="text-sm text-gray-600 mb-2">Trigger: {event.trigger}</p>
                                {event.conversionImpact && (
                                  <div className="text-xs inline-flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-1 rounded ${event.conversionImpact === 'high' ? 'bg-red-100 text-red-800' :
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

                    {/* Optimizations */}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 mb-3">Optimization Suggestions</h3>
                      <div className="space-y-3">
                        {selectedResult.lytxRecommendations.optimizations.map((optimization: any, index: number) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-medium text-gray-800 capitalize">{optimization.category}</h4>
                              <span className={`px-2 py-1 text-xs rounded ${optimization.impact === 'high' ? 'bg-red-100 text-red-800'
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

                {/* Generated Embed Snippet */}
                {lytxKey && (
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">Generated Embed Snippet</h3>
                    <EmbedSnippet url={selectedResult.pageAnalysis.url} accountKey={lytxKey} />
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper components (same as HomePage)
function EmbedSnippet({ url, accountKey }: { url: string; accountKey: string }) {
  const domain = inferDomainFromUrl(url);
  const snippet = createLytxTag(accountKey, domain);
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
