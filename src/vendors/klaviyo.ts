// Klaviyo Client-Side TypeScript Integration
// Based on Klaviyo JavaScript API Documentation

// Global Klaviyo object type declaration
declare global {
	interface Window {
		klaviyo: KlaviyoClient;
		_klOnsite: any[];
	}
}

// Core Types
export interface KlaviyoIdentifyProperties {
	email?: string;
	phone_number?: string;
	first_name?: string;
	last_name?: string;
	title?: string;
	organization?: string;
	[key: string]: any; // Allow custom properties
}

export interface KlaviyoEventProperties {
	[key: string]: string | number | boolean | Date | string[] | number[] | null | undefined;
}

export interface KlaviyoProductItem {
	ProductName?: string;
	ProductID?: string;
	SKU?: string;
	Categories?: string[];
	ImageURL?: string;
	URL?: string;
	Brand?: string;
	Price?: number;
	CompareAtPrice?: number;
	[key: string]: any;
}

export interface KlaviyoEcommerceItem {
	ItemName?: string;
	ItemID?: string;
	SKU?: string;
	Categories?: string[];
	ImageURL?: string;
	URL?: string;
	Brand?: string;
	Price?: number;
	Quantity?: number;
	[key: string]: any;
}

export interface KlaviyoOrderProperties {
	$event_id?: string;
	$value?: number;
	OrderId?: string;
	Categories?: string[];
	ItemNames?: string[];
	Brands?: string[];
	Discount?: number;
	DiscountCode?: string;
	Items?: KlaviyoEcommerceItem[];
	[key: string]: any;
}

// Callback function types
export type KlaviyoCallback<T = any> = (result: T) => void;

// Klaviyo Client Interface
export interface KlaviyoClient {
	// Core methods
	identify(
		properties: KlaviyoIdentifyProperties,
		callback?: KlaviyoCallback<object>
	): Promise<object>;
	track(
		event: string,
		properties?: KlaviyoEventProperties,
		callback?: KlaviyoCallback<boolean>
	): Promise<boolean>;
	trackViewedItem(item: KlaviyoProductItem, callback?: KlaviyoCallback<void>): Promise<void>;

	// Form methods
	openForm(formId: string, callback?: KlaviyoCallback<void>): void;

	// Configuration methods
	account(accountId?: string, callback?: KlaviyoCallback<string>): Promise<string>;
	cookieDomain(domain?: string, callback?: KlaviyoCallback<string>): Promise<string>;
	isIdentified(callback?: KlaviyoCallback<boolean>): Promise<boolean>;

	// Legacy push method support
	push(args: any[]): void;
}

// Klaviyo Client Class Implementation
export class KlaviyoClientImpl implements KlaviyoClient {
	private ensureKlaviyoLoaded(): void {
		if (typeof window === 'undefined') {
			throw new Error('Klaviyo client can only be used in browser environment');
		}

		// if (!window.klaviyo) {
		// 	console.(
		// 		'Klaviyo script not loaded. Make sure to include the Klaviyo snippet on your page.'
		// 	);
		// }
	}

	async identify(
		properties: KlaviyoIdentifyProperties,
		callback?: KlaviyoCallback<object>
	): Promise<object> {
		this.ensureKlaviyoLoaded();

		if (!properties.email && !properties.phone_number) {
			throw new Error('Either email or phone_number is required for identification');
		}

		return window.klaviyo.identify(properties, callback);
	}

	async track(
		event: string,
		properties?: KlaviyoEventProperties,
		callback?: KlaviyoCallback<boolean>
	): Promise<boolean> {
		this.ensureKlaviyoLoaded();

		if (!event || typeof event !== 'string') {
			throw new Error('Event name is required and must be a string');
		}

		return window.klaviyo.track(event, properties, callback);
	}

	async trackViewedItem(item: KlaviyoProductItem, callback?: KlaviyoCallback<void>): Promise<void> {
		this.ensureKlaviyoLoaded();
		return window.klaviyo.trackViewedItem(item, callback);
	}

	openForm(formId: string, callback?: KlaviyoCallback<void>): void {
		this.ensureKlaviyoLoaded();

		if (!formId || typeof formId !== 'string') {
			throw new Error('Form ID is required and must be a string');
		}

		window.klaviyo.openForm(formId, callback);
	}

	async account(accountId?: string, callback?: KlaviyoCallback<string>): Promise<string> {
		this.ensureKlaviyoLoaded();
		return window.klaviyo.account(accountId, callback);
	}

	async cookieDomain(domain?: string, callback?: KlaviyoCallback<string>): Promise<string> {
		this.ensureKlaviyoLoaded();
		return window.klaviyo.cookieDomain(domain, callback);
	}

	async isIdentified(callback?: KlaviyoCallback<boolean>): Promise<boolean> {
		this.ensureKlaviyoLoaded();
		return window.klaviyo.isIdentified(callback);
	}

	push(args: any[]): void {
		this.ensureKlaviyoLoaded();
		window.klaviyo.push(args);
	}
}

// Predefined Event Types for E-commerce
export const KLAVIYO_EVENTS = {
	// Product Events
	VIEWED_PRODUCT: 'Viewed Product',
	ADDED_TO_CART: 'Added to Cart',
	REMOVED_FROM_CART: 'Removed from Cart',
	STARTED_CHECKOUT: 'Started Checkout',
	PLACED_ORDER: 'Placed Order',
	ORDERED_PRODUCT: 'Ordered Product',
	FULFILLED_ORDER: 'Fulfilled Order',
	CANCELLED_ORDER: 'Cancelled Order',
	REFUNDED_ORDER: 'Refunded Order',

	// Engagement Events
	VIEWED_CATEGORY: 'Viewed Category',
	SEARCHED: 'Searched',
	SUBSCRIBED: 'Subscribed',
	UNSUBSCRIBED: 'Unsubscribed',

	// Custom Events
	ADDED_LIKE: 'Added Like',
	SHARED_PRODUCT: 'Shared Product',
	WISHLIST_ADDED: 'Added to Wishlist',
	WISHLIST_REMOVED: 'Removed from Wishlist',

	// User Events
	SIGNED_UP: 'Signed Up',
	LOGGED_IN: 'Logged In',
	LOGGED_OUT: 'Logged Out',
	PROFILE_UPDATED: 'Profile Updated'
} as const;

// Helper Functions
export class KlaviyoHelpers {
	private client: KlaviyoClient;

	constructor(client: KlaviyoClient) {
		this.client = client;
	}

	// E-commerce tracking helpers
	async trackProductView(product: KlaviyoProductItem): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.VIEWED_PRODUCT, product);
	}

	async trackAddToCart(product: KlaviyoEcommerceItem): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.ADDED_TO_CART, {
			...product,
			$value: product.Price ? product.Price * (product.Quantity || 1) : undefined
		});
	}

	async trackRemoveFromCart(product: KlaviyoEcommerceItem): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.REMOVED_FROM_CART, {
			...product,
			$value: product.Price ? product.Price * (product.Quantity || 1) : undefined
		});
	}

	async trackStartedCheckout(orderProperties: KlaviyoOrderProperties): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.STARTED_CHECKOUT, orderProperties);
	}

	async trackPlacedOrder(orderProperties: KlaviyoOrderProperties): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.PLACED_ORDER, orderProperties);
	}

	async trackSearch(query: string, results?: number): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.SEARCHED, {
			SearchQuery: query,
			ResultsCount: results
		});
	}

	async trackCategoryView(categoryName: string, categoryId?: string): Promise<boolean> {
		return this.client.track(KLAVIYO_EVENTS.VIEWED_CATEGORY, {
			CategoryName: categoryName,
			CategoryID: categoryId
		});
	}

	// User lifecycle helpers
	async trackSignUp(userProperties: KlaviyoIdentifyProperties): Promise<boolean> {
		await this.client.identify(userProperties);
		return this.client.track(KLAVIYO_EVENTS.SIGNED_UP, {
			SignUpDate: new Date().toISOString(),
			...userProperties
		});
	}

	async trackLogin(userProperties: KlaviyoIdentifyProperties): Promise<boolean> {
		await this.client.identify(userProperties);
		return this.client.track(KLAVIYO_EVENTS.LOGGED_IN, {
			LoginDate: new Date().toISOString()
		});
	}

	async trackSubscription(email: string, listId?: string, source?: string): Promise<boolean> {
		await this.client.identify({ email });
		return this.client.track(KLAVIYO_EVENTS.SUBSCRIBED, {
			ListID: listId,
			Source: source,
			SubscriptionDate: new Date().toISOString()
		});
	}

	// Custom event helpers
	async trackCustomEvent(eventName: string, properties?: KlaviyoEventProperties): Promise<boolean> {
		return this.client.track(eventName, {
			...properties,
			Timestamp: new Date().toISOString()
		});
	}

	// Batch tracking for multiple events
	async trackMultipleEvents(
		events: Array<{ name: string; properties?: KlaviyoEventProperties }>
	): Promise<boolean[]> {
		const promises = events.map((event) => this.client.track(event.name, event.properties));
		return Promise.all(promises);
	}
}

// Main Klaviyo instance
export const klaviyo = new KlaviyoClientImpl();
export const klaviyoHelpers = new KlaviyoHelpers(klaviyo);

// Default export for convenience
export default {
	klaviyo,
	klaviyoHelpers,
	KLAVIYO_EVENTS,
	KlaviyoClientImpl,
	KlaviyoHelpers
};
