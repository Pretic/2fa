import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServiceWorker } from '../../src/ui/serviceworker.js';

function publicGenerator(body, init = {}) {
	return new Response(body, { ...init, headers: { ...init.headers, 'X-Public-Page': 'password-generator-v1' } });
}

async function navigationHarness(
	cachedResponse,
	fetchImpl,
	{ cacheUnavailable = false, openCache = null, request = new Request('https://2fa.example.com/'), install = false } = {},
) {
	const listeners = new Map();
	const self = {
		location: { origin: 'https://2fa.example.com' },
		addEventListener: (type, callback) => listeners.set(type, callback),
		skipWaiting: vi.fn(async () => {}),
	};
	const fetch = fetchImpl || vi.fn().mockRejectedValue(new TypeError('Network unavailable'));
	const put = vi.fn(async () => {});
	const addAll = vi.fn(async () => {});
	const caches = { match: vi.fn().mockResolvedValue(cachedResponse), open: vi.fn(async () => ({ put, addAll })) };
	if (openCache) {
		caches.open.mockImplementation(async () => {
			await openCache;
			return { put, addAll };
		});
	}
	if (cacheUnavailable) {
		caches.match.mockRejectedValue(new Error('Storage unavailable'));
		caches.open.mockRejectedValue(new Error('Storage unavailable'));
	}
	const quietConsole = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
	const source = await createServiceWorker({ SW_VERSION: 'offline-page-test' }).text();
	// Execute the emitted worker so malformed escaping in embedded HTML also fails this test.
	// eslint-disable-next-line no-new-func
	new Function('self', 'location', 'fetch', 'caches', 'console', source)(self, self.location, fetch, caches, quietConsole);

	let responsePromise;
	let background;
	listeners.get(install ? 'install' : 'fetch')({
		request,
		respondWith: (response) => {
			responsePromise = response;
		},
		waitUntil: (operation) => {
			background = operation;
		},
	});
	return { responsePromise, background, fetch, put, addAll, caches, self };
}

async function navigateOffline(cachedResponse) {
	return (await navigationHarness(cachedResponse)).responsePromise;
}

afterEach(() => vi.useRealTimers());

describe('Service Worker offline navigation', () => {
	it.each([401, 403])('preserves authorization denial %s even with a never-ending body', async (status) => {
		vi.useFakeTimers();
		const denied = new Response(new ReadableStream(), { status });
		const h = await navigationHarness(
			publicGenerator('Cached app'),
			vi.fn(async () => denied),
		);
		expect(await h.responsePromise).toBe(denied);
		expect(h.put).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('serves a complete network page when cache storage is unavailable', async () => {
		const h = await navigationHarness(
			null,
			vi.fn(async () => publicGenerator('New app')),
			{ cacheUnavailable: true },
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		await h.background;
	});

	it('retains a cacheable copy when the page consumes HTML before cache storage opens', async () => {
		let finishOpen;
		const openCache = new Promise((resolve) => {
			finishOpen = resolve;
		});
		const h = await navigationHarness(
			null,
			vi.fn(async () => publicGenerator('New app')),
			{ openCache },
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		finishOpen();
		await h.background;
		expect(await h.put.mock.calls[0][1].text()).toBe('New app');
	});

	it('uses the cached shell during a server outage without caching the error response', async () => {
		const cached = publicGenerator('Cached app');
		const h = await navigationHarness(
			cached,
			vi.fn(async () => new Response('Unavailable', { status: 503 })),
		);
		expect(await h.responsePromise).toBe(cached);
		expect(h.put).not.toHaveBeenCalled();
	});
	it('returns a complete offline document with a retry link when the page is not cached', async () => {
		const response = await navigateOffline();
		const html = await response.text();

		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain('name="viewport"');
		expect(html).toContain('href="/" data-standalone-i18n="offlineReload">Reload</a>');
		const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
		expect(scripts).toHaveLength(2);
		for (const script of scripts) {
			// eslint-disable-next-line no-new-func
			expect(() => new Function(script[1])).not.toThrow();
		}
	});

	it('serves only the cached public generator before falling back to the offline document', async () => {
		const cachedResponse = new Response('<!DOCTYPE html><title>Cached generator</title>', {
			headers: { 'X-Public-Page': 'password-generator-v1' },
		});
		const response = await navigateOffline(cachedResponse);

		expect(response).toBe(cachedResponse);
		expect(response.status).toBe(200);
	});

	it.each(['headers', 'body'])('falls back to cached HTML within 1.5 seconds when %s never arrives', async (phase) => {
		vi.useFakeTimers();
		const cached = publicGenerator('Cached app');
		const fetch = vi.fn(() => (phase === 'headers' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream()))));
		const h = await navigationHarness(cached, fetch);
		await vi.advanceTimersByTimeAsync(1500);
		expect(await h.responsePromise).toBe(cached);
		expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.put).not.toHaveBeenCalled();
	});

	it('returns the offline document within 8 seconds without a cached shell', async () => {
		vi.useFakeTimers();
		const h = await navigationHarness(
			null,
			vi.fn(() => new Promise(() => {})),
		);
		await vi.advanceTimersByTimeAsync(8000);
		expect((await h.responsePromise).status).toBe(503);
	});

	it('never replaces the cached shell with a timed-out body that finishes later', async () => {
		vi.useFakeTimers();
		let stream;
		const response = publicGenerator(
			new ReadableStream({
				start(controller) {
					stream = controller;
				},
			}),
		);
		const h = await navigationHarness(
			publicGenerator('Cached app'),
			vi.fn(async () => response),
		);
		await vi.advanceTimersByTimeAsync(1500);
		expect(await (await h.responsePromise).text()).toBe('Cached app');
		stream.enqueue(new TextEncoder().encode('Late app'));
		stream.close();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.put).not.toHaveBeenCalled();
	});

	it('returns and caches a complete successful network document and clears the deadline', async () => {
		vi.useFakeTimers();
		const h = await navigationHarness(
			publicGenerator('Old app'),
			vi.fn(async () => publicGenerator('New app', { headers: { 'Content-Type': 'text/html' } })),
		);
		expect(await (await h.responsePromise).text()).toBe('New app');
		await h.background;
		expect(await h.put.mock.calls[0][1].text()).toBe('New app');
		expect(vi.getTimerCount()).toBe(0);
	});
});

it('rejects an old cached vault document', async () => {
	const response = await navigateOffline(new Response('<html>Old private vault</html>'));
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain('Old private vault');
});


describe('Service Worker public cache boundary', () => {
	it.each([null, 'vault', 'password-generator-v2'])('does not cache a network document with marker %s', async (marker) => {
		const headers = marker === null ? {} : { 'X-Public-Page': marker };
		const h = await navigationHarness(
			publicGenerator('Cached generator'),
			vi.fn(async () => new Response('<html>Private vault</html>', { headers })),
		);
		expect(await (await h.responsePromise).text()).toBe('<html>Private vault</html>');
		await h.background;
		expect(h.caches.open).not.toHaveBeenCalled();
		expect(h.put).not.toHaveBeenCalled();
	});

	it.each([
		{ marker: 'vault', status: 200 },
		{ marker: 'password-generator-v2', status: 200 },
		{ marker: 'password-generator-v1', status: 403 },
	])('rejects a cached document that is not a successful public generator: %j', async ({ marker, status }) => {
		const response = await navigateOffline(new Response('Unsafe cached document', { status, headers: { 'X-Public-Page': marker } }));
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain('Unsafe cached document');
	});

	it('uses the uncached deadline when only an old private vault is cached', async () => {
		vi.useFakeTimers();
		const h = await navigationHarness(new Response('Old private vault'), vi.fn(() => new Promise(() => {})));
		let settled = false;
		h.responsePromise.then(() => { settled = true; });
		await vi.advanceTimersByTimeAsync(1500);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(6500);
		const response = await h.responsePromise;
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain('Old private vault');
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.put).not.toHaveBeenCalled();
	});

	it.each(['/admin', '/admin/'])('never reads or writes the vault cache for %s', async (path) => {
		const vault = new Response('Private vault');
		const request = new Request('https://2fa.example.com' + path);
		const h = await navigationHarness(new Response('Old private vault'), vi.fn(async () => vault), { request });
		expect(await h.responsePromise).toBe(vault);
		expect(h.fetch).toHaveBeenCalledWith(request, { cache: 'no-store', redirect: 'follow' });
		expect(h.caches.match).not.toHaveBeenCalled();
		expect(h.caches.open).not.toHaveBeenCalled();
		expect(h.put).not.toHaveBeenCalled();
	});

	it.each(['/admin', '/admin/'])('redirects offline %s to the public root without exposing the cached vault', async (path) => {
		const h = await navigationHarness(new Response('Old private vault'), null, {
			request: new Request('https://2fa.example.com' + path),
		});
		const response = await h.responsePromise;
		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe('https://2fa.example.com/');
		expect(h.caches.match).not.toHaveBeenCalled();
		expect(h.put).not.toHaveBeenCalled();
	});

	it.each(['/api/login', '/api/logout', '/api/setup', '/api/refresh-token'])(
		'passes %s directly to the network without caching or queueing credentials',
		async (path) => {
			const request = new Request('https://2fa.example.com' + path, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-only-password' }),
			});
			const h = await navigationHarness(new Response('Old credential response'), null, { request });
			await expect(h.responsePromise).rejects.toThrow('Network unavailable');
			expect(h.fetch).toHaveBeenCalledWith(request);
			expect(h.caches.match).not.toHaveBeenCalled();
			expect(h.caches.open).not.toHaveBeenCalled();
			expect(h.put).not.toHaveBeenCalled();
		},
	);

	it.each([
		new Request('https://2fa.example.com/', { method: 'POST', body: 'not a navigation' }),
		new Request('https://other.example.com/'),
	])('does not apply the public-root cache to a non-GET or cross-origin request: %s', async (request) => {
		const h = await navigationHarness(publicGenerator('Cached generator'), vi.fn(async () => publicGenerator('Other document')), { request });
		expect(await (await h.responsePromise).text()).toBe('Other document');
		expect(h.caches.match).not.toHaveBeenCalled();
		expect(h.put).not.toHaveBeenCalled();
	});
});

describe('Service Worker public generator installation', () => {
	it('validates the public root separately from static precaching', async () => {
		const h = await navigationHarness(null, vi.fn(async () => publicGenerator('Public generator')), { install: true });
		await h.background;
		expect(h.addAll).toHaveBeenCalledWith(['/manifest.json', '/icon-192.png', '/icon-512.png']);
		expect(h.fetch).toHaveBeenCalledWith('/', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
		expect(h.put).toHaveBeenCalledOnce();
		expect(h.put.mock.calls[0][0]).toBe('/');
		expect(await h.put.mock.calls[0][1].text()).toBe('Public generator');
		expect(h.self.skipWaiting).toHaveBeenCalledOnce();
	});

	it.each([null, 'vault', 'password-generator-v2'])('never precaches a root document with marker %s', async (marker) => {
		const h = await navigationHarness(null, vi.fn(async () => new Response('Private vault', {
			headers: marker === null ? {} : { 'X-Public-Page': marker },
		})), { install: true });
		await h.background;
		expect(h.addAll.mock.calls[0][0]).not.toContain('/');
		expect(h.put).not.toHaveBeenCalled();
		expect(h.self.skipWaiting).toHaveBeenCalledOnce();
	});

	it('finishes installation after a root timeout and never caches a body that finishes later', async () => {
		vi.useFakeTimers();
		let stream;
		const response = publicGenerator(new ReadableStream({ start(controller) { stream = controller; } }));
		const h = await navigationHarness(null, vi.fn(async () => response), { install: true });
		await vi.advanceTimersByTimeAsync(8000);
		await h.background;
		expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
		expect(h.self.skipWaiting).toHaveBeenCalledOnce();
		stream.enqueue(new TextEncoder().encode('Late generator'));
		stream.close();
		await vi.advanceTimersByTimeAsync(1);
		expect(h.put).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
