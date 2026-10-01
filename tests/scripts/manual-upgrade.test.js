import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'smol-toml';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('Manual-only customized upstream integration', () => {
	it('does not install automatic GitHub workflows', () => {
		const path = new URL('.github/workflows/', root);
		expect(existsSync(path) ? readdirSync(path).filter((name) => /\.ya?ml$/.test(name)) : []).toEqual([]);
	});

	it('preserves browser serialization and both Durable Object bindings', () => {
		const config = parse(read('wrangler.toml'));
		expect(config.keep_names).toBe(false);
		for (const env of [config, config.env.development]) {
			expect(env.kv_namespaces).toEqual(expect.arrayContaining([expect.objectContaining({ binding: 'SECRETS_KV' })]));
			expect(env.durable_objects.bindings).toContainEqual({ name: 'SECRETS_STORE', class_name: 'SecretsStore' });
		}
		expect(config.migrations).toContainEqual({ tag: 'v1', new_sqlite_classes: ['SecretsStore'] });
		expect(read('src/worker.js')).toMatch(/export.*SecretsStore/);
	});
});
