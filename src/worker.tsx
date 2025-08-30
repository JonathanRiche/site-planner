import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import { SessionPage } from "./components/SessionPage";
import analyzeHtmlHandler from "./api/analyze-html";
import sessionHandler from "./api/session";
import { SimpleBrowserSessionManager } from "./lib/simple-session-manager";
import { SessionAnalysisManager } from "./lib/session-analysis-manager";
import { SiteAnalysisDO } from "./lib/site-analysis-do";
export type AppContext = {
};
export default defineApp([
	render(Document, [

		route("/", () => <HomePage />),
		route("/session/:sessionId", ({ params }) => <SessionPage sessionId={params.sessionId} />),
		route("/api/analyze-html", analyzeHtmlHandler),

		route("/api/session", sessionHandler),
		route("/api/session/:sessionId", sessionHandler),
	]),
]);

// Export Durable Objects
export { SimpleBrowserSessionManager as BrowserSessionManager };
export { SessionAnalysisManager };
export { SiteAnalysisDO };
