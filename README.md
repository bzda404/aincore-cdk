# @mindvault/sdk

MindVault Client SDK — 将您的 Node.js/Electron 应用快速接入 MindVault Core 本地 AI 生态。

## 特性

- **零配置** — 无需设置端口、API Key、环境变量
- **OAuth 授权** — PKCE 授权码流程，用户在 Core UI 中确认范围
- **UDS 通信** — Unix Domain Socket，本地极速、无网络开销
- **完整类型** — TypeScript 原生支持

## 安装

```bash
npm install @mindvault/sdk
```

## 快速开始

```ts
import { MindVaultClient } from '@mindvault/sdk'

const mv = new MindVaultClient({
  name: '我的研究助手',
  icon: '🔬',
  vendor: 'MyLab Inc.',
})

// 1. 检测 MindVault Core 是否可用
const info = await mv.discover()
if (!info) {
  console.log('请先启动 MindVault Core')
  process.exit(1)
}
console.log(`已连接: ${info.name} v${info.protocol_version}`)

// 2. OAuth 注册 + PKCE 授权（触发 Core 授权弹窗）
await mv.registerOAuth()
const { verifier, challenge } = mv.generatePKCE()
const auth = await mv.authorize('inference:read knowledge:read offline_access', challenge)
await mv.exchangeCode(auth.authorizationCode, verifier)

console.log('授权成功！')

// 3. 调用 AI
const reply = await mv.chat({
  messages: [{ role: 'user', content: '总结这篇论文的核心方法' }],
})
console.log(reply.content)

// 4. 搜索知识库
const results = await mv.search('实验数据')
for (const r of results) {
  console.log(`- ${r.title}: ${r.snippet.slice(0, 80)}...`)
}

// 5. 读笔记
const note = await mv.readNote('/Users/me/Documents/research/methods.md')
console.log(note.content)
```

## API

### `new MindVaultClient(options)`

| 参数 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 应用名称（必填） |
| `icon` | `string` | 应用图标（emoji） |
| `vendor` | `string` | 开发者名称 |
| `socketPath` | `string` | UDS 路径（默认 `/tmp/mindvault.sock`） |

### `discover()` → `DiscoveryResult | null`

检测 MindVault Core 可用性。

### `registerOAuth()` → `OAuthClientConfig`

注册 OAuth 客户端，返回 `client_id` 和 `client_secret`。

### `generatePKCE()` → `{ verifier, challenge }`

生成 PKCE S256 参数。

### `authorize(scopes, challenge, state?)` → `{ authorizationCode, state? }`

发起 OAuth 授权。用户在 Core UI 中确认后返回授权码。

### `exchangeCode(code, verifier)` → `OAuthTokenSet`

用授权码换取 access token。后续 `chat/search/readNote` 会自动携带 `access_token`。

### `chat(params)` → `ChatResult`

```ts
interface ChatParams {
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  model?: string
}
```

### `search(query, kb?, limit?)` → `SearchResult[]`

### `readNote(path)` → `{ content, metadata }`

### `writeNote(path, content)` → `void`

### `listNotes(kb, recursive?)` → `NoteListItem[]`

### `getContext(path, range?)` → `NoteContext`

### `listModels()` → `ModelInfo[]`

### `revokeAuth()` → `void`

撤销当前应用的授权。

### `requestAuth(auth)` → `AuthResult`

旧版 session-token 授权接口，仅为兼容保留；新应用请使用 OAuth。

## 协议

Model Hub 通过 UDS JSON-RPC 2.0 暴露服务。如果您不使用 Node.js SDK，可以直接实现 JSON-RPC 调用：

```bash
# 通过 UDS 发送 JSON-RPC
echo '{"jsonrpc":"2.0","id":1,"method":"app.ping"}' | nc -U /tmp/mindvault.sock
```

## 许可证

MIT
