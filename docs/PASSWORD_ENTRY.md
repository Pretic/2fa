# 密码生成器入口

访问根路径 `/` 会显示独立的在线密码生成器。右上角的用户图标打开密码登录窗口，验证成功后进入 `/admin`。继续使用已有登录密码、KV 和环境变量，不需要重新初始化或导入密钥。

## 使用

普通密码支持 8～128 位、大小写字母、数字、特殊符号、排除易混淆字符。“排除部分字符”按每个字符原样排除，区分大小写，可一次输入多个字符，无需逗号或空格分隔。例如 `abc012!@#` 会排除这九个字符。空格或逗号本身也是排除对象，不是分隔符。

密码短语模式保留随机词组、分隔符、大小写和末尾数字/符号设置。排除规则同样生效：筛除包含禁用字符的单词，而不是删除字母破坏单词；分隔符或附加字符与排除规则冲突时，会提示调整设置。

当已选字符类型被全部排除、可用字符少于两个、词库不足或输入长度不合法时，会清空结果并停用复制。默认要求每种勾选的字符类型至少出现一次，可在高级选项中取消。随机数由浏览器 Web Crypto 提供；不支持安全随机数时拒绝生成，不回退到 `Math.random()`。

## 登录与缓存

- `/admin` 和 `/admin/` 均由服务端验证已有登录凭据。未登录时重定向到生成器，不下发后台页面 HTML。密钥 API 的认证规则保持不变。
- 登录沿用 `/api/login`、已有密码哈希及 HttpOnly/Secure Cookie。不要使用不安全的 HTTP 域名访问。
- 退出或会话失效后返回 `/`；浏览器恢复历史后台页面时重新向服务端验证。
- Service Worker 使用新的缓存版本，删除旧版本缓存；不离线缓存后台页面，也不把登录、登出、设置密码或刷新会话请求加入离线队列。
- 生成的密码只在浏览器内存中处理，不上传、不保存历史。localStorage 只保存生成选项，不保存生成结果或登录密码。
- 已有有效会话可直接访问 `/admin`。本功能是入口伪装，不是“隐藏后台即可保证安全”；公开 API 名称、源码、原有 PWA 元数据等并未全部隐藏。

全新部署仍需手动访问 `/setup` 完成首次设置。已有部署不要重新设置密码或更换 KV。

## 更新

沿用原仓库部署方式发布此版本。连接 Git 自动部署的 Worker 需确认部署成功；手动部署则重新构建并发布。若已经打开旧页面，部署后重新加载；旧 PWA 用户可能还需关闭旧标签页后重新进入，以完成 Service Worker 更新。

Wrangler 配置中的 `keep_names = false` 必须保留：生成器将独立函数序列化为浏览器脚本，默认的函数名保留转换会注入只存在于 Worker 中的 `__name` 辅助函数，导致生成及登录按钮失效。该设置兼容现有 Git 自动部署，无需新增发布流程，也不改变 Worker 名称、KV 绑定、生产环境变量或原有密码。词库许可保留在源码中，不在页面底部添加链接。

## 验证

```bash
npm ci
npm run build
node scripts/build-release.js --minify --output=dist/worker.min.js
npx vitest run tests/ui/password-generator.test.js tests/ui/password-entry.test.js tests/router/handler.test.js tests/ui/serviceworker-offline.test.js tests/ui/login-dialog.test.js tests/scripts/build-release-code.test.js
npx vitest run tests/ui/password-bundle.test.js
```

测试使用合成密码和内存 KV，不读取生产密钥。包含生成边界、批量字符排除、短语排除、错误规则、真实认证处理函数、后台访问控制、登录/退出、HEAD 方法和离线缓存边界。

打包回归测试通过 Wrangler dry-run 生成普通及压缩产物，再执行实际页面内嵌脚本，检查首次生成、重新生成、复制及登录窗口，防止仅测试源码时漏掉打包错误。
