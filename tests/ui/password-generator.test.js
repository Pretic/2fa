import { describe, expect, it } from 'vitest';
import { createPasswordEngine } from '../../src/ui/password/core.js';
import { WORDLIST } from '../../src/ui/password/wordlist.js';
import { createPasswordPage } from '../../src/ui/passwordPage.js';

const engine = createPasswordEngine(WORDLIST);
const oneClass = (key) => Object.fromEntries(['lowercase', 'uppercase', 'digits', 'symbols'].map((k) => [k, k === key]));

describe('Public password generator', () => {
	it('uses a unique, nonempty bundled word list', () => {
		expect(WORDLIST.length).toBeGreaterThanOrEqual(1000);
		expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
		expect(WORDLIST.every((word) => /^[a-z]+$/.test(word))).toBe(true);
	});
	it.each([8, 20, 64, 128])('generates exact length %i with every selected class', (length) => {
		for (let i = 0; i < 40; i++) {
			const value = engine.generatePassword({ length });
			expect(value).toHaveLength(length);
			expect(value).toMatch(/[a-z]/);
			expect(value).toMatch(/[A-Z]/);
			expect(value).toMatch(/[2-9]/);
			expect(value).toMatch(/[^a-zA-Z0-9]/);
			expect(value).not.toMatch(/[Il1O0|]/);
		}
	});
	it.each(['lowercase', 'uppercase', 'digits', 'symbols'])('supports only %s', (key) => {
		const patterns = { lowercase: /^[a-z]+$/, uppercase: /^[A-Z]+$/, digits: /^[2-9]+$/, symbols: /^[^a-zA-Z0-9]+$/ };
		expect(engine.generatePassword({ include: oneClass(key) })).toMatch(patterns[key]);
	});
	it('excludes multiple literal characters, not regular expressions', () => {
		const excludedChars = 'abcXYZ239!@#[]^.-\\😀';
		for (let i = 0; i < 100; i++) {
			const value = engine.generatePassword({ length: 64, excludedChars });
			expect([...value].some((char) => excludedChars.includes(char))).toBe(false);
		}
	});
	it('treats exclusion case-sensitively and allows duplicate exclusions', () => {
		const value = engine.generatePassword({ include: oneClass('uppercase'), excludedChars: 'abcdefabcdef', excludeAmbiguous: false });
		expect(value).toHaveLength(20);
	});
	it('rejects an empty checked category instead of silently ignoring it', () => {
		expect(() => engine.generatePassword({ excludedChars: '0123456789' })).toThrow(/全部排除/);
		expect(engine.generatePassword({ excludedChars: '0123456789', requireEachClass: false })).not.toMatch(/[0-9]/);
	});
	it('rejects zero/one remaining characters and no selected classes', () => {
		expect(() => engine.generatePassword({ include: oneClass('none') })).toThrow();
		expect(() => engine.generatePassword({ include: oneClass('digits'), excludedChars: '012345678', excludeAmbiguous: false })).toThrow(
			/至少/,
		);
		expect(() => engine.generatePassword({ include: oneClass('digits'), excludedChars: '0123456789', requireEachClass: false })).toThrow();
	});
	it.each([0, 7, 129, 8.5, NaN, Infinity, '20'])('rejects invalid length %s', (length) => {
		expect(() => engine.generatePassword({ length })).toThrow(/整数/);
	});
	it('never falls back to insecure randomness', () => {
		expect(() => createPasswordEngine(WORDLIST, null).generatePassword()).toThrow(/安全随机数/);
	});
	it('normalizes malformed saved settings without trusting their types', () => {
		expect(engine.normalize(null).length).toBe(20);
		const value = engine.normalize({ length: 999, include: { digits: 'false' }, excludedChars: {}, separator: {}, wordCount: 0 });
		expect(value.length).toBe(128);
		expect(value.include.digits).toBe(true);
		expect(value.excludedChars).toBe('');
		expect(value.separator).toBe('-');
		expect(value.wordCount).toBe(3);
	});
	it.each(['none', 'first', 'random'])('filters whole words with %s capitalization', (capitalization) => {
		for (let i = 0; i < 30; i++) {
			const value = engine.generatePassphrase({ wordCount: 5, capitalization, excludedChars: 'abc12!@#', addDigit: true, addSymbol: true });
			expect(value.slice(0, -3).split('-')).toHaveLength(5);
			expect(value).not.toMatch(/[abc12!@#Il1O0|]/);
		}
	});
	it('validates separators and optional suffixes against exclusions', () => {
		expect(() => engine.generatePassphrase({ excludedChars: '-' })).toThrow(/分隔符/);
		expect(() => engine.generatePassphrase({ excludedChars: '0123456789', addDigit: true })).toThrow(/数字已全部排除/);
		expect(() => engine.generatePassphrase({ separator: '', excludedChars: '!@#$%^&*()-_=+[]{};:,.?', addSymbol: true })).toThrow(
			/符号已全部排除/,
		);
		expect(() => engine.generatePassphrase({ excludedChars: 'abcdefghijklmnopqrstuvwxyz' })).toThrow(/单词不足/);
	});
	it('has no visible old heading/footer, and places custom exclusions first', async () => {
		const response = createPasswordPage();
		const html = await response.text();
		expect(html).toContain('id="open-login"');
		expect(html).toContain('id="login-dialog"');
		expect(html).not.toContain('Awesome Password Generator');
		expect(html).not.toContain('View source code');
		expect(html).not.toContain('id="secretsList"');
		expect(html).not.toContain('src="http');
		expect(html.indexOf('id="excluded-chars"')).toBeLessThan(html.indexOf('id="excludeAmbiguous"'));
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		const nonce = response.headers.get('Content-Security-Policy').match(/nonce-([^']+)/)[1];
		expect(html).toContain(`<script nonce="${nonce}">`);
		expect(response.headers.get('X-Public-Page')).toBe('password-generator-v1');
	});
});
