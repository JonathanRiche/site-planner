
export type Platform = "tv" | "web" | "app" | "other";
/**
 * These are GDPR,CCPA Privacy compliant web events
 */
export interface WebEvent {
	/**We track the page URL of each page view on your website. 
	* We use this to show you which pages have been viewed and how many 
	* times a particular page has been viewed.
      
	* The hostname and path are collected. 
	* Query parameters are discarded, except for these special query parameters: 
	* ref=, source=, utm_source=, utm_medium=, utm_campaign=, utm_content= and utm_term=. 
	*/
	page_url?: string;
	/**
	 * We use the referrer string to show you the number of
	 * visitors referred to your website from links on other sites.
	 */
	referer?: string;
	/**
	 * We use this to show you what browsers and browser version numbers
	 * people use when visiting your website.
	 * This is derived from the User-Agent HTTP header.
	 * The full User-Agent is discarded.
	 */
	browser?: string;
	/**
	 * We use this to show you what operating systems people use when visiting your website.
	 * We show the brand of the operating system and the version number.
	 * This is derived from the User-Agent HTTP header.
	 * The full User-Agent is discarded.
	 */
	operating_system?: string;
	/**
	 * We use this to show you what devices people use when visiting your website.
	 * Devices are categorized into desktop, mobile or tablet.
	 * This is derived from the User-Agent HTTP header.
	 * The full User-Agent is discarded.
	 */
	device_type?: string;
	/**
	 * We look up the visitor’s location using their IP address.
	 * We do not track anything more granular than the city level
	 * and the IP address of the visitor is discarded.
	 * We never store IP addresses in our database or logs.
	 */
	country?: IncomingRequestCfProperties["country"];
	region?: IncomingRequestCfProperties["region"];
	city?: IncomingRequestCfProperties["city"];
	postal?: IncomingRequestCfProperties["postalCode"];
	/**
	 * Random string hash to count uniques
	 * Old salts are deleted every 24 hours to avoid the possibility of
	 * linking visitor information from one day to the next.
	 * Forgetting used salts also removes the possibility of the original
	 * IP addresses being revealed in a brute-force attack.
	 * The raw IP address and User-Agent are rendered completely inaccessible to anyone,
	 * including ourselves.
	 *
	 * hash(daily_salt + website_domain + ip_address + user_agent)
	 */
	rid?: string | null;
	/**
	 * Page event
	 */
	event?: ("page_view" | "form_fill" | "phone_call " | "screen_view") & string;
	tag_id?: string;
	client_page_url?: string;
	screen_width?: number;
	screen_height?: number;
	/**@deprecated**/
	account_id?: number;
	team_id?: number;
	site_id?: number;
	query_params?: Array<Record<string, string>>;
	bot_data?: Record<string, string>;
	custom_data?: Record<string, string>;
}
type SiteConfig = { site: string, tag: string };
export interface LytxApi {
	emit: (url?: URL) => void;
	event: (account: string, platformName: 'web', event: string | null) => void;
	rid: () => string | null;
	debugMode: boolean;
	currentSiteConfig: SiteConfig
	track_web_events: boolean;
	trackCustomEvents: (account: string, platformName: Platform | undefined, event: WebEvent["event"] | null, macros: string) => void

}


export function createLytxTag(apiKey: string, domain: string): string {
  const safeDomain = domain.replace(/"/g, '');
  const safeApiKey = encodeURIComponent(apiKey);
  return `<script defer data-domain="${safeDomain}" src="https://lytx.io/lytx.js?account=${safeApiKey}"></script>`;
}

export function inferDomainFromUrl(inputUrl: string): string {
  try {
    return new URL(inputUrl).hostname;
  } catch {
    return inputUrl.replace(/^https?:\/\//, '').split('/')[0];
  }
}
