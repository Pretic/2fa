/** Browser-only password generation. All dependencies stay inside this factory
 * so the same audited implementation can be embedded in the public page. */
export function createPasswordEngine(wordlist, cryptoApi = globalThis.crypto) {
	const charsets = {
		lowercase: 'abcdefghijklmnopqrstuvwxyz',
		uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
		digits: '0123456789',
		symbols: '!@#$%^&*()-_=+[]{};:,.?',
	};
	const defaults = {
		mode: 'password',
		length: 20,
		include: { lowercase: true, uppercase: true, digits: true, symbols: true },
		excludedChars: '',
		excludeAmbiguous: true,
		requireEachClass: true,
		wordCount: 5,
		separator: '-',
		capitalization: 'none',
		addDigit: false,
		addSymbol: false,
	};
	const words = [...new Set(wordlist)];
	const boolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
	const integer = (value, fallback, min, max) => (Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback);

	function normalize(value = {}) {
		const input = value && typeof value === 'object' ? value : {};
		return {
			mode: input.mode === 'passphrase' ? 'passphrase' : 'password',
			length: integer(input.length, defaults.length, 8, 128),
			include: Object.fromEntries(Object.keys(charsets).map((key) => [key, boolean(input.include?.[key], defaults.include[key])])),
			excludedChars: typeof input.excludedChars === 'string' ? input.excludedChars.slice(0, 512) : '',
			excludeAmbiguous: boolean(input.excludeAmbiguous, true),
			requireEachClass: boolean(input.requireEachClass, true),
			wordCount: integer(input.wordCount, 5, 3, 10),
			separator: typeof input.separator === 'string' ? input.separator.slice(0, 8) : '-',
			capitalization: ['none', 'first', 'random'].includes(input.capitalization) ? input.capitalization : 'none',
			addDigit: boolean(input.addDigit, false),
			addSymbol: boolean(input.addSymbol, false),
		};
	}

	// Rejection sampling avoids modulo bias, including for large completion counts.
	function randomBelow(limit) {
		if (limit < 1n) {
			throw new Error('没有可用的随机选项。');
		}
		if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
			throw new Error('浏览器不支持安全随机数，请更换或更新浏览器。');
		}
		if (limit === 1n) {
			return 0n;
		}
		const bits = (limit - 1n).toString(2).length;
		const bytes = new Uint8Array(Math.ceil(bits / 8));
		const mask = 255 >>> (bytes.length * 8 - bits);
		let value;
		do {
			cryptoApi.getRandomValues(bytes);
			bytes[0] &= mask;
			value = 0n;
			for (const byte of bytes) {
				value = (value << 8n) | BigInt(byte);
			}
		} while (value >= limit);
		return value;
	}
	const pick = (pool) => pool[Number(randomBelow(BigInt(pool.length)))];
	function exclusions(options) {
		return new Set(Array.from(options.excludedChars + (options.excludeAmbiguous ? 'Il1O0|' : '')));
	}
	function filtered(pool, excluded) {
		return Array.from(pool).filter((char) => !excluded.has(char));
	}

	function generatePassword(input = {}) {
		const options = normalize(input);
		if (input.length !== undefined && (!Number.isInteger(input.length) || input.length < 8 || input.length > 128)) {
			throw new Error('密码长度需为 8～128 之间的整数。');
		}
		const excluded = exclusions(options);
		const groups = Object.entries(charsets)
			.filter(([key]) => options.include[key])
			.map(([key, chars]) => ({ key, chars: filtered(chars, excluded) }));
		if (!groups.length) {
			throw new Error('请至少勾选一种字符类型。');
		}
		if (options.requireEachClass && groups.some((group) => !group.chars.length)) {
			throw new Error('某类已勾选字符被全部排除。请调整排除内容，或取消该字符类型。');
		}
		const pools = groups.map((group) => group.chars).filter((pool) => pool.length);
		const union = pools.flat();
		if (union.length < 2) {
			throw new Error('排除后至少需保留 2 个可用字符。');
		}
		if (!options.requireEachClass) {
			return Array.from({ length: options.length }, () => pick(union)).join('');
		}

		// Count valid suffixes for each missing-class mask. Sampling proportional to
		// these counts gives every valid password equal probability, without retries.
		const masks = 1 << pools.length;
		const counts = Array.from({ length: options.length + 1 }, () => Array(masks).fill(0n));
		counts[0][0] = 1n;
		for (let remaining = 1; remaining <= options.length; remaining++) {
			for (let mask = 0; mask < masks; mask++) {
				counts[remaining][mask] = pools.reduce((sum, pool, i) => sum + BigInt(pool.length) * counts[remaining - 1][mask & ~(1 << i)], 0n);
			}
		}
		let missing = masks - 1;
		let result = '';
		for (let remaining = options.length; remaining > 0; remaining--) {
			let rank = randomBelow(counts[remaining][missing]);
			for (let i = 0; i < pools.length; i++) {
				const next = missing & ~(1 << i);
				const suffixes = counts[remaining - 1][next];
				const weight = BigInt(pools[i].length) * suffixes;
				if (rank < weight) {
					result += pools[i][Number(rank / suffixes)];
					missing = next;
					break;
				}
				rank -= weight;
			}
		}
		return result;
	}

	function generatePassphrase(input = {}) {
		const options = normalize(input);
		if (input.wordCount !== undefined && (!Number.isInteger(input.wordCount) || input.wordCount < 3 || input.wordCount > 10)) {
			throw new Error('单词数量需为 3～10 之间的整数。');
		}
		const excluded = exclusions(options);
		const allowed = (word) => !Array.from(word).some((char) => excluded.has(char));
		if (!allowed(options.separator)) {
			throw new Error('分隔符包含已排除的字符，请修改分隔符。');
		}
		const lower = words.filter(allowed);
		const upper = words.map((word) => word[0].toUpperCase() + word.slice(1)).filter(allowed);
		const required = options.capitalization === 'first' ? [upper] : options.capitalization === 'random' ? [lower, upper] : [lower];
		if (required.some((pool) => pool.length < 2)) {
			throw new Error('排除后可用单词不足，请减少排除的字母。');
		}
		const capitalIndex = options.capitalization === 'random' ? Number(randomBelow(BigInt(options.wordCount))) : -1;
		const result = Array.from({ length: options.wordCount }, (_, i) =>
			pick(options.capitalization === 'first' || i === capitalIndex ? upper : lower),
		);
		let phrase = result.join(options.separator);
		if (options.addDigit) {
			const digits = filtered(charsets.digits, excluded);
			if (!digits.length) {
				throw new Error('数字已全部排除，请取消附加数字或调整排除内容。');
			}
			phrase += pick(digits) + pick(digits);
		}
		if (options.addSymbol) {
			const symbols = filtered(charsets.symbols, excluded);
			if (!symbols.length) {
				throw new Error('特殊符号已全部排除，请取消附加符号或调整排除内容。');
			}
			phrase += pick(symbols);
		}
		return phrase;
	}
	return { defaults, normalize, generatePassword, generatePassphrase };
}
