import { createPasswordEngine } from './password/core.js';
import { initPasswordPage } from './password/client.js';
import { passwordStyles } from './password/styles.js';
import { WORDLIST, WORDLIST_LICENSE } from './password/wordlist.js';

const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
const copyIcon = icon(
	'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
);
const refreshIcon = icon('<path d="M3 4v5h5m13 11v-5h-5M4 9a8 8 0 0 1 13-5l4 5M3 15l4 5a8 8 0 0 0 13-5"/>');
const chevron = icon('<path d="m6 9 6 6 6-6"/>');

/** The public document contains no vault markup, OTP data, or backend modules. */
export function createPasswordPage() {
	const nonce = crypto.randomUUID().replaceAll('-', '');
	const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>在线密码生成器</title><meta name="description" content="在浏览器中生成随机密码和密码短语。"><meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23155dfb'/%3E%3Cpath d='M10 12h12M10 16h12M10 20h8' stroke='white' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E">
<style nonce="${nonce}">${passwordStyles}</style></head><body>
<button type="button" id="open-login" class="entry-icon" aria-label="登录" title="登录">${icon('<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>')}</button>
<h1 class="sr-only">在线密码生成器</h1><main class="generator stack">
<div><label id="output-label" for="password-output" class="output-label">生成的新密码</label>
<input id="password-output" class="output" type="text" readonly autocomplete="off" spellcheck="false" aria-label="生成的密码">
<div class="actions"><button id="copy-password" type="button" class="btn primary" disabled>${copyIcon}<span id="copy-text">复制密码</span></button><button id="generate-password" type="button" class="btn">${refreshIcon}<span>生成新密码</span></button></div>
<div id="copy-status" class="sr-only" role="status" aria-live="polite"></div><p id="generator-error" class="error" role="alert" hidden></p></div>
<div class="section stack">
<div><span class="section-label">模式</span><div class="tabs" role="group" aria-label="生成模式"><button id="password-mode" type="button" aria-pressed="true">普通密码</button><button id="passphrase-mode" type="button" aria-pressed="false">密码短语（词组）</button></div><p id="mode-hint" class="hint">根据自定义字符类型生成高强度随机密码</p></div>
<div><label id="length-label" for="length-number" class="section-label">密码长度</label><div class="range-row"><input id="length-range" type="range" min="8" max="128" value="20" aria-label="密码长度"><input id="length-number" class="text-input" type="number" min="8" max="128" step="1" value="20" inputmode="numeric" aria-label="密码长度"></div><p id="length-hint" class="hint">密码越长越安全，建议至少保留 16 位以上。</p></div>
<fieldset id="character-types"><legend>包含的字符类型</legend><p class="hint">勾选你希望包含在密码中的字符种类</p><div class="char-grid">
<label class="choice"><input id="lowercase" type="checkbox" checked><span><span>小写字母</span><span class="hint">a, b, c, d...</span></span></label>
<label class="choice"><input id="uppercase" type="checkbox" checked><span><span>大写字母</span><span class="hint">A, B, C, D...</span></span></label>
<label class="choice"><input id="digits" type="checkbox" checked><span><span>数字</span><span class="hint">0, 1, 2, 3...</span></span></label>
<label class="choice"><input id="symbols" type="checkbox" checked><span><span>特殊符号</span><span class="hint">!, @, #, $...</span></span></label>
</div></fieldset>
<div id="phrase-options" hidden><div class="phrase-options"><label><span class="section-label">单词分隔符</span><input id="separator" class="text-input" type="text" value="-" maxlength="8" autocomplete="off" spellcheck="false"><span class="hint">可用 -、_、空格或留空</span></label><label><span class="section-label">大小写规则</span><select id="capitalization"><option value="none">全小写</option><option value="first">每个单词首字母大写</option><option value="random">随机一个单词首字母大写</option></select></label></div><div class="phrase-checks"><label><input id="addDigit" type="checkbox">末尾附加两位数字</label><label><input id="addSymbol" type="checkbox">末尾附加特殊符号</label></div></div>
<div class="panel"><label for="excluded-chars" class="section-label">排除部分字符</label><input id="excluded-chars" class="text-input exclude-input" type="text" maxlength="512" placeholder="例如：abc012!@#" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="excluded-hint"><p id="excluded-hint" class="hint">逐个输入不想出现的字符，区分大小写，无需分隔符。</p></div>
<label class="choice"><input id="excludeAmbiguous" type="checkbox" checked><span><span>排除易混淆字符</span><span class="hint">排除长相相似的字符（如 I, l, 1, O, 0 等），避免手动输入或辨认时出错</span></span></label>
<details class="advanced"><summary>高级选项${chevron}</summary><div class="advanced-body"><label class="choice" id="require-each-row"><input id="requireEachClass" type="checkbox" checked><span><span>每种已选字符至少包含一个</span><span class="hint">确保生成的密码包含所有勾选的字符类型</span></span></label><button id="reset-settings" class="btn reset" type="button">恢复默认设置</button></div></details>
</div>
<div class="shortcuts">键盘快捷键： <kbd>G</kbd> 生成新密码，<kbd>C</kbd> 复制，<kbd>L</kbd> 聚焦长度/单词数，<kbd>S</kbd> 切换特殊字符，<kbd>M</kbd> 切换生成模式</div>
<noscript><p class="error">请启用 JavaScript 后使用密码生成器。</p></noscript>
</main>
<dialog id="login-dialog" aria-labelledby="login-title"><button id="close-login" type="button" class="close-dialog" aria-label="关闭">${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button><h2 id="login-title">登录</h2>
<form id="login-form" action="/api/login" method="post"><label class="section-label" for="login-password">密码</label><div class="login-password"><input id="login-password" class="text-input" type="password" autocomplete="current-password" placeholder="请输入密码" required><button id="toggle-password" type="button" class="toggle-password" aria-label="显示密码" aria-pressed="false">${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>')}</button></div><p id="login-warning" class="login-warning" hidden>请使用 HTTPS 访问后登录，避免密码泄露或登录状态无法保存。</p><p id="login-error" class="error" role="alert" hidden></p><button id="login-submit" class="btn primary login-submit" type="submit">登录</button></form></dialog>
<script nonce="${nonce}">/* ${WORDLIST_LICENSE} */
(${initPasswordPage.toString()})((${createPasswordEngine.toString()})(${JSON.stringify(WORDLIST)}));</script>
</body></html>`;
	return new Response(html, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Public-Page': 'password-generator-v1',
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'X-Frame-Options': 'DENY',
			'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; worker-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`,
		},
	});
}
