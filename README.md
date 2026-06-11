# @aincore/sdk

> AinCore 本地 AI 平台的 TypeScript 通信 SDK

`@aincore/sdk` 是 [AinCore](https://github.com/bzda404/aincore) 本地 AI 计算平台的官方客户端 SDK。它封装了 OAuth 2.0 + PKCE 授权流程和 UDS（Unix Domain Socket）JSON-RPC 传输层，让你的 Node.js 应用能够以类型安全的方式接入 AinCore 的模型推理、知识库管理、系统状态查询和 AI 记忆等服务。

**状态：v0.4.1** · 零运行时依赖 · 纯 TypeScript · MIT 协议

## 特性

- **双认证模式** — 推荐的 OAuth 2.0 + PKCE 完整授权码流程，或兼容旧版的 Session Token 模式
- **UDS JSON-RPC 传输** — 通过 Unix Domain Socket 通信，绕过 TCP/IP 协议栈，零外部依赖
- **OpenAI 兼容接口** — `client.chat()` 提供与 OpenAI Chat Completions 兼容的调用格式
- **完整类型覆盖** — 16 个导出 TypeScript 接口，覆盖所有 API 请求和响应
- **Token 自动管理** — access_token 到期前 5 分钟自动刷新（需要 refresh_token）
- **AI 记忆 API** — 读写用户画像（语言、沟通风格、自定义指令），影响所有 AI 对话的系统提示

## 安装

```bash
npm install @aincore/sdk
# 或
pnpm add @aincore/sdk
```

## 快速开始

```typescript
import { AinCoreClient } from '@aincore/sdk'

const client = new AinCoreClient({ name: '我的应用' })

// 连接 AinCore（自动触发 OAuth 2.0 PKCE 授权流程）
await client.discover()
const oauthConfig = await client.registerOAuth()
const pkce = client.generatePKCE()
const { authorizationCode } = await client.authorize(
  'inference:read offline_access',
  pkce.challenge
)
await client.exchangeCode(authorizationCode, pkce.verifier)

// 调用 OpenAI 兼容的聊天接口
const response = await client.chat({
  model: 'qwen2.5-0.5b-instruct',
  messages: [{ role: 'user', content: '你好' }]
})

console.log(response.content)

// 断开连接
client.disconnect()
```

## API 参考

### 连接与发现

```typescript
// 检查 AinCore 是否在运行
const discovery = await client.discover()

// 获取系统状态（无需认证）
const status = await client.getStatus()
```

### AI 推理

```typescript
// 聊天补全（OpenAI 兼容）
const response = await client.chat({
  messages: [{ role: 'user', content: '解释量子计算' }],
  model: 'qwen2.5-0.5b-instruct',
  max_tokens: 1024,       // 默认 512
  temperature: 0.7        // 默认 0.7
})
// response: { content: string, model?: string, usage?: { prompt_tokens, completion_tokens, total_tokens } }

// 列出已安装的模型
const models = await client.listModels()
// model: { id, name, family, parameterSize, quantization, sizeBytes }
```

### 知识库操作

```typescript
// 搜索笔记
const results = await client.search('关键词', '/path/to/kb', 20)
// result: { path, title, snippet, score }

// 读取笔记
const note = await client.readNote('/path/to/note.md')
// note: { content: string, metadata: Record<string, unknown> }

// 列出笔记
const notes = await client.listNotes('/path/to/kb', true)
// note: { path, title, size, lastModified, isDirectory }

// 写入笔记
await client.writeNote('/path/to/note.md', '# Hello\n\nContent here')

// 获取上下文片段（支持行范围）
const ctx = await client.getContext('/path/to/note.md', [10, 50])
// ctx: { path, context, start, end }
```

### AI 记忆（用户画像）

```typescript
// 获取用户画像
const profile = await client.getProfile()
// profile: { display_name, language, communication_style, custom_instructions, preferences, updated_at }

// 更新用户画像（部分更新）
await client.updateProfile({
  display_name: '万权',
  language: 'zh-CN',
  communication_style: '简洁专业',
  custom_instructions: '回答时优先使用代码示例'
})
```

### OAuth 2.0 完整流程

```typescript
import { AinCoreClient } from '@aincore/sdk'

const client = new AinCoreClient({ name: '我的应用', vendor: 'MyOrg' })

// 1. 发现 AinCore
await client.discover()

// 2. 注册 OAuth 客户端
const { client_id, client_secret } = await client.registerOAuth()

// 3. 生成 PKCE 并请求授权
const pkce = client.generatePKCE()
const { authorizationCode } = await client.authorize(
  'inference:read knowledge:read offline_access',
  pkce.challenge
)

// 4. 交换 Token
const tokens = await client.exchangeCode(authorizationCode, pkce.verifier)
// tokens: { access_token, refresh_token, token_type: 'Bearer', expires_in, scope }

// 5. Token 内省
const info = await client.introspectOAuthToken()
// info: { active: boolean, client_id?, scope? }

// 6. 撤销授权
await client.revokeAuth()

// Token 持久化（用于跨会话恢复）
const config = { client_id, client_secret }
client.restoreOAuthConfig(config)   // 恢复凭据
client.restoreOAuthTokenSet(tokens) // 恢复 Token
```

## 授权作用域

| Scope | 类别 | 说明 |
|---|---|---|
| `inference:read` | 推理 | 调用模型推理（chat.completions） |
| `models:read` | 模型 | 列出已安装模型 |
| `models:manage` | 模型 | 加载 / 卸载模型 |
| `knowledge:read` | 知识库 | 读取知识库内容 |
| `knowledge:write` | 知识库 | 写入知识库内容（隐含 `knowledge:read`） |
| `system:status` | 系统 | 读取系统状态 |
| `offline_access` | 特殊 | 允许刷新令牌（长期访问） |

## 传输层

SDK 使用 UDS（Unix Domain Socket）进行通信，绕过 TCP/IP 协议栈以获得更好的性能和安全性：

- **macOS / Linux**: `/tmp/aincore.sock`
- **Windows**: `\\.\pipeaincore`

协议为换行分隔的 JSON-RPC 2.0，所有请求包含单调递增的 `id`，响应通过 `id` 匹配到对应的 Promise。

## 类型导出

```typescript
// 客户端配置
AinCoreClientOptions   // { name, icon?, vendor?, socketPath?, timeoutMs? }
AuthRequest              // { models, knowledgeBases?, timeoutMs? }
AuthResult               // { granted, session_token?, granted_models?, granted_kbs? }

// OAuth
OAuthClientConfig        // { client_id, client_secret }
OAuthTokenSet            // { access_token, refresh_token, token_type, expires_in, scope, obtained_at }
OAuthIntrospection       // { active, client_id?, scope?, token_type? }

// 数据模型
DiscoveryResult          // { protocol_version, name, features, requires_auth }
ModelInfo                // { id, name, family, parameterSize, quantization, sizeBytes }
ChatParams               // { messages, max_tokens?, temperature?, model? }
ChatResult               // { content, model?, usage? }
SearchResult             // { path, title, snippet, score }
NoteListItem             // { path, title, size, lastModified, isDirectory }
NoteContext              // { path, context, start, end }
UserProfile              // { display_name, language, communication_style, custom_instructions, preferences, updated_at }
KnowledgeBaseGrant       // { path, label?, scope: 'read' | 'read_write' }
KnowledgeBaseAuthRequest // { path, label, scope? }
```

## 开发

```bash
git clone https://github.com/bzda404/aincore-cdk.git
cd aincore-cdk
pnpm install
pnpm build        # 构建 (tsc)
pnpm test         # 运行测试 (Vitest)
pnpm lint         # 类型检查 (tsc --noEmit)
```

## 发布

```bash
# 打标签触发 CI 自动发布到 npm
git tag v0.4.1
git push origin v0.4.1
```

## 许可证

[MIT](LICENSE)
