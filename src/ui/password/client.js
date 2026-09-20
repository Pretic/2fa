/** Self-contained browser controller; serialized into the public page. */
export function initPasswordPage(engine) {
	const $ = (id) => document.getElementById(id);
	const storageKey = 'password-generator-settings';
	let settings = engine.normalize();
	try {
		settings = engine.normalize(JSON.parse(localStorage.getItem(storageKey) || 'null'));
	} catch {
		/* Storage is optional. */
	}
	const output = $('password-output');
	const copyButton = $('copy-password');
	const dialog = $('login-dialog');
	let copyTimer;
	let loginController;
	let submitting = false;

	function save() {
		try {
			localStorage.setItem(storageKey, JSON.stringify(settings));
		} catch {
			/* Never persist generated passwords. */
		}
	}
	function generate() {
		clearTimeout(copyTimer);
		copyButton.classList.remove('copied');
		$('copy-text').textContent = '复制密码';
		$('copy-status').textContent = '';
		try {
			output.value = settings.mode === 'password' ? engine.generatePassword(settings) : engine.generatePassphrase(settings);
			$('generator-error').hidden = true;
			copyButton.disabled = false;
		} catch (error) {
			output.value = '';
			copyButton.disabled = true;
			$('generator-error').textContent = error.message;
			$('generator-error').hidden = false;
		}
	}
	function render() {
		const phrase = settings.mode === 'passphrase';
		$('password-mode').setAttribute('aria-pressed', String(!phrase));
		$('passphrase-mode').setAttribute('aria-pressed', String(phrase));
		$('mode-hint').textContent = phrase ? '使用随机单词组合生成便于记忆的密码短语' : '根据自定义字符类型生成高强度随机密码';
		$('output-label').textContent = phrase ? '生成的新密码短语' : '生成的新密码';
		$('length-label').textContent = phrase ? '单词数量' : '密码长度';
		$('length-hint').textContent = phrase ? '建议使用 5 个及以上随机单词。' : '密码越长越安全，建议至少保留 16 位以上。';
		for (const id of ['length-range', 'length-number']) {
			$(id).min = phrase ? '3' : '8';
			$(id).max = phrase ? '10' : '128';
			$(id).value = phrase ? settings.wordCount : settings.length;
			$(id).setAttribute('aria-label', phrase ? '单词数量' : '密码长度');
		}
		$('character-types').hidden = phrase;
		$('phrase-options').hidden = !phrase;
		$('require-each-row').hidden = phrase;
		for (const key of Object.keys(settings.include)) {
			$(key).checked = settings.include[key];
		}
		$('excluded-chars').value = settings.excludedChars;
		for (const key of ['excludeAmbiguous', 'requireEachClass', 'addDigit', 'addSymbol']) {
			$(key).checked = settings[key];
		}
		$('separator').value = settings.separator;
		$('capitalization').value = settings.capitalization;
	}
	function update() {
		save();
		generate();
	}
	function mode(value) {
		settings.mode = value;
		render();
		update();
	}
	$('password-mode').addEventListener('click', () => mode('password'));
	$('passphrase-mode').addEventListener('click', () => mode('passphrase'));
	$('generate-password').addEventListener('click', generate);
	for (const id of ['length-range', 'length-number']) {
		$(id).addEventListener('input', (event) => {
			const key = settings.mode === 'password' ? 'length' : 'wordCount';
			settings[key] = event.target.value === '' ? NaN : Number(event.target.value);
			const other = $(id === 'length-range' ? 'length-number' : 'length-range');
			if (Number.isFinite(settings[key])) {
				other.value = settings[key];
			}
			if (Number.isInteger(settings[key]) && settings[key] >= Number(event.target.min) && settings[key] <= Number(event.target.max)) {
				save();
			}
			generate();
		});
	}
	$('length-number').addEventListener('blur', (event) => {
		const key = settings.mode === 'password' ? 'length' : 'wordCount';
		const value = settings[key];
		settings[key] = Number.isFinite(value)
			? Math.max(Number(event.target.min), Math.min(Number(event.target.max), Math.round(value)))
			: engine.defaults[key];
		render();
		update();
	});
	for (const key of Object.keys(settings.include)) {
		$(key).addEventListener('change', (event) => {
			settings.include[key] = event.target.checked;
			update();
		});
	}
	for (const key of ['excludeAmbiguous', 'requireEachClass', 'addDigit', 'addSymbol']) {
		$(key).addEventListener('change', (event) => {
			settings[key] = event.target.checked;
			update();
		});
	}
	$('excluded-chars').addEventListener('input', (event) => {
		settings.excludedChars = event.target.value;
		update();
	});
	$('separator').addEventListener('input', (event) => {
		settings.separator = event.target.value;
		update();
	});
	$('capitalization').addEventListener('change', (event) => {
		settings.capitalization = event.target.value;
		update();
	});
	$('reset-settings').addEventListener('click', () => {
		settings = engine.normalize();
		render();
		update();
	});
	output.addEventListener('click', () => output.select());

	async function copy() {
		const password = output.value;
		if (!password) {
			return;
		}
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error('clipboard unavailable');
			}
			await navigator.clipboard.writeText(password);
		} catch {
			output.focus();
			output.select();
			try {
				if (!document.execCommand('copy')) {
					throw new Error('copy unavailable');
				}
			} catch {
				$('copy-status').textContent = '自动复制不可用，密码已选中，请手动复制。';
				$('generator-error').textContent = '自动复制不可用，密码已选中，请手动复制。';
				$('generator-error').hidden = false;
				return;
			}
		}
		if (output.value !== password) {
			return;
		}
		copyButton.classList.add('copied');
		$('copy-text').textContent = '已复制！';
		$('copy-status').textContent = '密码已复制到剪贴板';
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copyButton.classList.remove('copied');
			$('copy-text').textContent = '复制密码';
		}, 1800);
	}
	copyButton.addEventListener('click', copy);

	function clearLogin() {
		loginController?.abort();
		loginController = null;
		submitting = false;
		$('login-submit').disabled = false;
		$('login-submit').textContent = '登录';
		$('login-password').value = '';
		$('login-password').type = 'password';
		$('toggle-password').setAttribute('aria-label', '显示密码');
		$('toggle-password').setAttribute('aria-pressed', 'false');
		$('login-error').hidden = true;
	}
	$('open-login').addEventListener('click', () => {
		clearLogin();
		$('login-warning').hidden = window.isSecureContext;
		dialog.showModal();
		$('login-password').focus();
	});
	$('close-login').addEventListener('click', () => dialog.close());
	dialog.addEventListener('close', () => {
		clearLogin();
		$('open-login').focus();
	});
	dialog.addEventListener('click', (event) => {
		const rect = dialog.getBoundingClientRect();
		if (
			event.target === dialog &&
			(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
		) {
			dialog.close();
		}
	});
	$('toggle-password').addEventListener('click', () => {
		const visible = $('login-password').type === 'password';
		$('login-password').type = visible ? 'text' : 'password';
		$('toggle-password').setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
		$('toggle-password').setAttribute('aria-pressed', String(visible));
	});
	$('login-form').addEventListener('submit', async (event) => {
		event.preventDefault();
		if (submitting) {
			return;
		}
		const credential = $('login-password').value;
		if (!credential) {
			$('login-password').focus();
			return;
		}
		if (!window.isSecureContext) {
			$('login-warning').hidden = false;
			return;
		}
		submitting = true;
		const button = $('login-submit');
		button.disabled = true;
		button.textContent = '登录中…';
		$('login-error').hidden = true;
		const controller = new AbortController();
		loginController = controller;
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch('/api/login', {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
				body: JSON.stringify({ credential }),
				signal: controller.signal,
			});
			const data = await response.json().catch(() => ({}));
			if (controller.signal.aborted || !dialog.open || loginController !== controller) {
				return;
			}
			if (response.ok && data.success) {
				$('login-password').value = '';
				// Forward only known, non-secret PWA actions. Never accept an arbitrary redirect.
				const action = new URL(window.location.href).searchParams.get('action');
				window.location.replace('/admin' + (['add', 'scan'].includes(action) ? '?action=' + action : ''));
				return;
			}
			throw new Error(
				response.status === 429
					? '尝试次数过多，请稍后再试。'
					: response.status >= 500
						? '登录服务暂不可用，请稍后再试。'
						: data.message || '密码错误，请重试。',
			);
		} catch (error) {
			if (dialog.open && loginController === controller) {
				$('login-error').textContent =
					error.name === 'AbortError'
						? '请求超时，请检查网络后重试。'
						: error instanceof TypeError
							? '网络连接失败，请稍后重试。'
							: error.message;
				$('login-error').hidden = false;
				$('login-password').value = '';
				$('login-password').focus();
			}
		} finally {
			clearTimeout(timer);
			if (loginController === controller) {
				loginController = null;
				submitting = false;
				button.disabled = false;
				button.textContent = '登录';
			}
		}
	});
	document.addEventListener('keydown', (event) => {
		if (dialog.open || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat) {
			return;
		}
		if (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY/.test(event.target.tagName)) {
			return;
		}
		switch (event.key.toLowerCase()) {
			case 'g':
				event.preventDefault();
				generate();
				break;
			case 'c':
				event.preventDefault();
				copy();
				break;
			case 'l':
				event.preventDefault();
				$('length-number').focus();
				$('length-number').select();
				break;
			case 'm':
				event.preventDefault();
				mode(settings.mode === 'password' ? 'passphrase' : 'password');
				break;
			case 's':
				event.preventDefault();
				if (settings.mode === 'password') {
					settings.include.symbols = !settings.include.symbols;
				} else {
					settings.addSymbol = !settings.addSymbol;
				}
				render();
				update();
				break;
		}
	});
	// Update an existing installation, but do not install a service worker for visitors.
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker
			.getRegistration()
			.then((registration) => registration?.update())
			.catch(() => {});
	}
	render();
	generate();
}
