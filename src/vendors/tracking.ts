import type { KlaviyoClient, KlaviyoEventProperties } from "@vendors/klaviyo";
import { klaviyo } from "@vendors/klaviyo";
import type { LytxApi } from "@vendors/lytx";
declare global {
	interface Window {
		klaviyo: KlaviyoClient;
		lytxApi?: LytxApi;
		gtag: any;
	}
}

// Klaviyo tracking functions
export async function trackKlaviyo(eventName: string, properties: KlaviyoEventProperties): Promise<void> {
	if (typeof window === 'undefined' || !window.klaviyo) {
		return;
	}
	await klaviyo.track(eventName, properties);
}

// LYTX tracking functions
export function trackLytx(eventName: string, apiKey: string): void {
	if (typeof window === 'undefined' || !window.lytxApi) {
		return;
	}
	window.lytxApi.event(apiKey, 'web', eventName);
}

// Google Analytics 4 tracking functions
export function trackGA4(eventName: string, parameters: Record<string, any>): void {
	if (typeof window === 'undefined' || !window.gtag) {
		return;
	}
	window.gtag('event', eventName, parameters);
}



