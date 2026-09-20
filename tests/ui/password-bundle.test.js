import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');

function browserHarness(html) {
	const elements = new Map();
	for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
		const attributes = Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
		const listeners = new Map();
		const classes = new Set();
		const element = {
			value: attributes.value || '',
			attributes,
			hidden: /\bhidden\b/.test(match[2]),
			disabled: /\bdisabled\b/.test(match[2]),
			open: false,
			classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
			addEventListener: (name, listener) => listeners.set(name, listener),
			setAttribute: (name, value) => {
				attributes[name] = value;
			},
			focus: vi.fn(),
			select: vi.fn(),
			showModal: () => {
				element.open = true;
			},
			close: () => {
				element.open = false;
				listeners.get('close')?.();
			},
			fire: (name) => listeners.get(name)?.({ target: element, preventDefault() {} }),
		};
		elements.set(match[3], element);
	}
	const writeText = vi.fn().mockResolvedValue(undefined);
	const fetch = vi.fn();
	const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
	expect(script).toBeDefined();
	// A fresh browser context deliberately has no Worker-side esbuild helpers.
	runInContext(
		script,
		createContext({
			crypto: webcrypto,
			document: { getElementById: (id) => elements.get(id) || null, addEventListener: vi.fn() },
			window: { isSecureContext: true },
			navigator: { clipboard: { writeText } },
			localStorage: { getItem: () => null, setItem: vi.fn() },
			fetch,
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		}),
		{ timeout: 5000 },
	);
	return { elements, writeText, fetch };
}

describe('Public entry in the actual Wrangler deployment bundle', () => {
	it.each([false, true])(
		'runs generation, copy and login after bundling (minify=%s)',
		async (minify) => {
			const temporary = mkdtempSync(join(tmpdir(), '2fa-password-bundle-'));
			try {
				execFileSync(
					process.execPath,
					[wrangler, 'deploy', '--dry-run', '--env', '', '--outdir', temporary, ...(minify ? ['--minify'] : [])],
					{
						cwd: root,
						env: {
							...process.env,
							CI: 'true',
							WRANGLER_HIDE_BANNER: 'true',
							WRANGLER_SEND_METRICS: 'false',
							WRANGLER_SEND_ERROR_REPORTS: 'false',
							WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'),
						},
						stdio: 'pipe',
						windowsHide: true,
						timeout: 60000,
					},
				);
				const bundle = readFileSync(join(temporary, 'worker.js'), 'utf8');
				const worker = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
				const response = await worker.default.fetch(
					new Request('https://bundle.example.test/'),
					{ LOG_LEVEL: 'ERROR' },
					{ waitUntil() {} },
				);
				expect(response.status).toBe(200);
				const html = await response.text();
				const { elements, writeText, fetch } = browserHarness(html);
				const output = elements.get('password-output');
				expect(output.value).toHaveLength(20);
				expect(elements.get('copy-password').disabled).toBe(false);
				output.value = '';
				elements.get('generate-password').fire('click');
				expect(output.value).toHaveLength(20);
				await elements.get('copy-password').fire('click');
				expect(writeText).toHaveBeenCalledWith(output.value);
				expect(elements.get('copy-text').textContent).toBe('已复制！');
				elements.get('open-login').fire('click');
				expect(elements.get('login-dialog').open).toBe(true);
				expect(elements.get('login-password').focus).toHaveBeenCalledOnce();
				elements.get('close-login').fire('click');
				expect(elements.get('login-dialog').open).toBe(false);
				expect(fetch).not.toHaveBeenCalled();
			} finally {
				// This directory is created exclusively for this test, under the OS temp directory.
				rmSync(temporary, { recursive: true, force: true });
			}
		},
		90000,
	);
});
