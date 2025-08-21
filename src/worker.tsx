import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import analyzeHandler from "./api/analyze";
import analyzeCrawlHandler from "./api/analyze-crawl";
import crawlLinksHandler from "./api/crawl-links";
export type AppContext = {
};
export default defineApp([
	async ({ ctx }: any) => {
	},
	render(Document, [
		route("/", () => <HomePage />),
		route("/api/analyze", analyzeHandler),
		route("/api/analyze-crawl", analyzeCrawlHandler),
		route("/api/crawl-links", crawlLinksHandler),
	]),
]);
