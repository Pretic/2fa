import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/router/handler.js';
import { hashPassword } from '../../src/utils/auth.js';
import { createServiceWorker } from '../../src/ui/serviceworker.js';

const origin = 'https://entry.example.test';
let env;
const request = (path, method = 'GET', extra = {}) =>
	new Request(origin + path, { method, ...extra, headers: { Host: new URL(origin).host, ...extra.headers } });
beforeAll(async () => {
	const data = new Map([['user_password', await hashPassword('Test-Fixture-Only-43!')]]);
	env = {
		LOG_LEVEL: 'ERROR',
		ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
		SECRETS_KV: {
			async get(key, options) {
				const value = data.get(key) ?? null;
				return value && (options === 'json' || options?.type === 'json') ? JSON.parse(value) : value;
			},
			async put(key, value) {
				data.set(key, value);
			},
			async delete(key) {
				data.delete(key);
			},
			async list() {
				return { keys: [...data.keys()].map((name) => ({ name })), list_complete: true };
			},
		},
	};
});

describe('Public entry with actual server-side authentication', () => {
	it('serves an anonymous generator without accessing storage', async () => {
		const response = await handleRequest(request('/'), { LOG_LEVEL: 'ERROR' });
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('id="password-output"');
	});
	it.each(['/admin', '/admin/'])('does not send vault markup to anonymous %s', async (path) => {
		const response = await handleRequest(request(path), env);
		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe('/');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.text()).toBe('');
	});
	it('rejects invalid cookies and preserves only known shortcut actions', async () => {
		const response = await handleRequest(
			request('/admin?action=scan&next=https://untrusted.example', 'GET', { headers: { Cookie: 'auth_token=invalid' } }),
			env,
		);
		expect(response.headers.get('Location')).toBe('/?action=scan');
	});
	it('keeps the secret API protected', async () => {
		const response = await handleRequest(request('/api/secrets'), env);
		expect(response.status).toBe(401);
	});
	it('uses the original password endpoint and cookie for login and logout', async () => {
		const login = (credential) =>
			handleRequest(
				request('/api/login', 'POST', {
					headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Requested-With': 'XMLHttpRequest' },
					body: JSON.stringify({ credential }),
				}),
				env,
			);
		const wrong = await login('wrong-password');
		expect(wrong.status).not.toBe(200);
		const valid = await login('Test-Fixture-Only-43!');
		expect(valid.status).toBe(200);
		const setCookie = valid.headers.get('Set-Cookie');
		expect(setCookie).toContain('HttpOnly');
		expect(setCookie).toContain('Secure');
		const cookie = setCookie.split(';')[0];
		const admin = await handleRequest(request('/admin', 'GET', { headers: { Cookie: cookie } }), env);
		expect(admin.status).toBe(200);
		expect(admin.headers.get('Cache-Control')).toContain('no-store');
		const html = await admin.text();
		expect(html).toContain('id="loginModal"');
		expect(html).not.toContain('id="password-output"');
		const root = await handleRequest(request('/', 'GET', { headers: { Cookie: cookie } }), env);
		expect(await root.text()).toContain('id="password-output"');
		const logout = await handleRequest(
			request('/api/logout', 'POST', { headers: { Cookie: cookie, Origin: origin, 'X-Requested-With': 'XMLHttpRequest' } }),
			env,
		);
		expect(logout.status).toBe(200);
		expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
		const afterLogout = await handleRequest(request('/admin'), env);
		expect(afterLogout.status).toBe(302);
	});
	it('supports HEAD and disallows writes on the public document', async () => {
		const head = await handleRequest(request('/', 'HEAD'), env);
		expect(head.status).toBe(200);
		expect(await head.text()).toBe('');
		expect((await handleRequest(request('/', 'POST'), env)).status).toBe(405);
	});
});

async function serviceWorkerHarness(path, method = 'GET') {
	const listeners = new Map();
	const self = { location: { origin }, addEventListener: (name, fn) => listeners.set(name, fn) };
	const fetch = vi.fn().mockRejectedValue(new Error('offline'));
	const caches = { match: vi.fn(), open: vi.fn() };
	const indexedDB = { open: vi.fn() };
	const source = await createServiceWorker().text();
	// Execute the emitted script so interpolation/escaping errors are covered.
	// eslint-disable-next-line no-new-func
	new Function('self', 'fetch', 'caches', 'indexedDB', source)(self, fetch, caches, indexedDB);
	let pending;
	listeners.get('fetch')({
		request: request(path, method),
		respondWith(value) {
			pending = value;
		},
	});
	return { pending, fetch, caches, indexedDB };
}

describe('Entry cache boundaries', () => {
	it.each(['/api/login', '/api/logout', '/api/setup', '/api/refresh-token'])(
		'never queues credentials at %s when offline',
		async (path) => {
			const worker = await serviceWorkerHarness(path, 'POST');
			await expect(worker.pending).rejects.toThrow('offline');
			expect(worker.caches.open).not.toHaveBeenCalled();
			expect(worker.indexedDB.open).not.toHaveBeenCalled();
		},
	);
	it('never serves a cached /admin document', async () => {
		const worker = await serviceWorkerHarness('/admin');
		const response = await worker.pending;
		expect(response.status).toBe(302);
		expect(response.headers.get('Location')).toBe(origin + '/');
		expect(worker.caches.match).not.toHaveBeenCalled();
	});
});
