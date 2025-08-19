import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "./Document";
import { HomePage } from "./components/HomePage";
import analyzeHandler from "./api/analyze";

export default defineApp([
	async ({ ctx }: any) => {
	},
	render(Document, [
		route("/", () => <HomePage />),
		route("/api/analyze", analyzeHandler),
	]),
]);
