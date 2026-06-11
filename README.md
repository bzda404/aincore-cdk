# @aincore/sdk

> 将您的应用快速接入 AinCore 本地 AI 生态

`@aincore/sdk` 是 AinCore 平台的官方 TypeScript 客户端 SDK。它为第三方开发者提供零配置的连接体验：一行代码完成 UDS 传输连接，一个方法完成 OAuth 2.0 PKCE 授权，统一的 API 封装覆盖推理、模型管理、知识库操作和用户画像等全部 17 个 JSON-RPC 方法。

```bash
npm install @aincore/sdk
```

## 核心定位

`@aincore/sdk` 在 AinCore Hub-and-Spoke 架构中充当 **Spoke 侧的桥梁**：

```
您的应用
   │
   │  @aincore/sdk
   │  ├── AinCoreClient        ← 统一入口
   │  ├── OAuthClient          ← OAuth 2.0 PKCE 封装
   │  └── UDSTransport         ← Unix Domain Socket 传输层
   │
   ▼
AinCore (Core Hub)
   ├── llama.cpp 推理引擎
   ├── OAuth 2.0 授权中心
   ├── 隐私哨兵
   └── SQLite 持久化
```

## 设计原则

- **零运行时依赖** — 仅使用 Node.js 内置模块（`net` · `os` · `crypto`），无第三方运行时
- **完整 TypeScript 类型** — 16 个导出接口，严格类型推断，`strict` 模式编译
- **双认证兼容** — 同时支持 OAuth 2.0 PKCE（推荐）和遗留 Session Token 两种认证模式
- **ESM 原生** — `"type": "module"`，ES2022 target，Node16 module resolution

## 快速开始

### 最小示例：OAuth + 推理

```typescript
import { AinCoreClient, generatePKCE } from '@aincore/sdk'

const client = new AinCoreClient({
  name: 'My App',
  vendor: 'my-company',
  icon: '🚀'
})

// 1. 发现 Core 服务
const discovery = await client.discover()
if (!discovery) throw new Error('AinCore not running')

// 2. OAuth 2.0 PKCE 授权
client.registerOAuth()
const { verifier, challenge } = generatePKCE()
const { authorizationCode } = await client.authorize(
  'inference:read offline_access', challenge
)
await client.exchangeCode(authorizationCode, verifier)

// 3. 调用推理
const result = await client.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 256,
  temperature: 0.7
})
console.log(result.content)

client.disconnect()
```

### 知识库操作

```typescript
// 搜索笔记
const results = await client.search('机器学习笔记', 'my-kb', 10)

// 读取笔记
const { content, metadata } = await client.readNote('/notes/ai/intro.md')

// 写入笔记
await client.writeNote('/notes/ai/new-note.md', '# New Note\n\nContent here.')

// 列出知识库内容
const notes = await client.listNotes('my-kb', true) // recursive
```

### 用户画像

```typescript
// 读取当前用户画像
const profile = await client.getProfile()
console.log(profile.display_name, profile.language)

// 更新偏好
await client.updateProfile({
  communication_style: 'technical',
  custom_instructions: '偏好代码示例和简洁回答'
})
```

## API 参考

### `AinCoreClient`

统一入口类，封装传输层和认证逻辑。

```typescript
new AinCoreClient(options: AinCoreClientOptions)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | **必填** — 应用名称，显示在授权弹窗中 |
| `vendor` | `string` | 应用供应商 |
| `icon` | `string` | 应用图标（emoji 或 URL） |
| `socketPath` | `string` | 覆盖默认 UDS 路径 |

#### 发现与注册

| 方法 | 返回类型 | 说明 |
|---|---|---|
| `discover()` | `DiscoveryResult \| null` | 探测 Core 服务是否运行，连接失败返回 `null` |
| `register()` | `string` | 注册应用，返回 `app_id` |

#### OAuth 2.0 授权（7 个方法）

| 方法 | 说明 |
|---|---|
| `generatePKCE()` | 生成 S256 PKCE 密钥对（`verifier` + `challenge`） |
| `registerOAuth()` | 注册 OAuth 客户端，返回 `client_id` + `client_secret` |
| `authorize(scopes, challenge, state?)` | 发起授权码请求，返回 `authorizationCode` |
| `exchangeCode(code, verifier)` | 交换授权码为 Token 对（access + refresh） |
| `refreshOAuthToken()` | 刷新 access_token（需 `offline_access` 作用域） |
| `introspectOAuthToken(token?)` | 验证 Token 有效性 |
| `restoreOAuthConfig(config)` / `restoreOAuthTokenSet(tokenSet)` | 从持久化存储恢复 OAuth 状态 |

#### AI 推理

| 方法 | 返回类型 | 说明 |
|---|---|---|
| `chat(params)` | `ChatResult` | 调用模型推理（OpenAI 兼容格式） |
| `listModels()` | `ModelInfo[]` | 列出已安装模型 |
| `getStatus()` | `CoreStatus` | 获取 Core 运行状态 |

#### 知识库操作

| 方法 | 说明 |
|---|---|
| `search(query, kb?, limit?)` | BM25 全文搜索，默认 Top-20 |
| `readNote(path)` | 读取笔记内容与元数据 |
| `listNotes(kb, recursive?)` | 列出知识库文件 |
| `writeNote(path, content)` | 创建/覆盖笔记 |
| `getContext(path, range?)` | 获取行范围上下文 |

#### 用户画像

| 方法 | 说明 |
|---|---|
| `getProfile()` | 读取用户画像（无需认证） |
| `updateProfile(partial)` | 更新用户画像字段 |

#### 生命周期

| 方法 | 说明 |
|---|---|
| `disconnect()` | 关闭 UDS 连接 |

### `OAuthClient`

独立的 OAuth 2.0 子客户端，可通过 `client.oauth` 直接访问，也支持独立使用。

**支持的 JSON-RPC 方法：**
`oauth.register` · `oauth.authorize` · `oauth.token` · `oauth.revoke` · `oauth.revoke_client` · `oauth.introspect`

**Token 自动续期：** `getAccessToken()` 在 Token 过期前 5 分钟自动触发 `refreshToken()`（需 `offline_access` 作用域）。

### 传输层：`UDSTransport`

底层 Unix Domain Socket 传输，零外部依赖：

| 特性 | 实现 |
|---|---|
| **Socket 路径** | macOS/Linux: `/tmp/aincore.sock` · Windows: `\\.\pipe\aincore` |
| **消息帧** | 换行分隔 JSON（`\n` delimiter） |
| **请求 ID** | 单调递增整数，支持并发多路复用 |
| **连接管理** | `call()` 方法懒重连（断开后下次调用自动重连） |
| **关闭语义** | socket 关闭时 reject 所有 pending Promise |

### 类型定义

16 个导出接口覆盖所有 API 交互：

```typescript
// 客户端配置
AinCoreClientOptions

// 认证
AuthRequest · AuthResult · DiscoveryResult · KnowledgeBaseGrant · KnowledgeBaseAuthRequest

// 推理
ChatParams · ChatResult · ModelInfo · CoreStatus

// 知识库
SearchResult · NoteListItem · NoteContext

// 用户画像
UserProfile

// OAuth（来自 OAuthClient）
OAuthClientConfig · OAuthTokenSet · OAuthIntrospection
```

## 支持的 JSON-RPC 方法

SDK 封装了以下 17 个 AinCore JSON-RPC 方法：

| 类别 | 方法 | SDK 调用 |
|---|---|---|
| 发现 | `app.ping` | `discover()` |
| 注册 | `app.register` | `register()` |
| OAuth | `oauth.register` · `authorize` · `token` · `revoke` · `revoke_client` · `introspect` | `registerOAuth()` · `authorize()` · `exchangeCode()` · `refreshOAuthToken()` · `revokeToken()` · `revokeClient()` · `introspectOAuthToken()` |
| 遗留认证 | `app.request_auth` · `app.list_grants` · `app.revoke_auth` | `requestAuth()` · `listGrants()` · `revokeAuth()` |
| 推理 | `chat.completions` | `chat()` |
| 模型 | `models.list` · `app.list_models` | `listModels()` |
| 状态 | `status` | `getStatus()` |
| 知识库 | `search_notes` · `read_note` · `list_notes` · `write_note` · `get_context` | `search()` · `readNote()` · `listNotes()` · `writeNote()` · `getContext()` |
| 画像 | `profile.get` · `profile.update` | `getProfile()` · `updateProfile()` |

## 授权作用域

| 作用域 | 说明 |
|---|---|
| `inference:read` | 调用模型推理 |
| `models:read` | 列出已安装模型 |
| `models:manage` | 加载/卸载模型 |
| `knowledge:read` | 读取知识库 |
| `knowledge:write` | 写入知识库（隐含 `knowledge:read`） |
| `system:status` | 读取系统状态 |
| `offline_access` | 允许 refresh_token（长期访问） |

## 技术规格

| 项目 | 规格 |
|---|---|
| 运行时依赖 | **零**（仅 Node.js 内置模块） |
| 语言 | TypeScript 5.9 (strict) |
| 编译目标 | ES2022 · Node16 module |
| 模块格式 | ESM（`"type": "module"`） |
| 测试 | Vitest（16 个单元测试） |
| 包大小 | 13.6 kB (tgz) · 51.6 kB (unpacked) |
| 发布文件 | `dist/` + `README.md` |

## 开发

```bash
git clone https://github.com/bzda404/aincore-cdk.git
cd aincore-cdk
pnpm install
pnpm build          # tsc 编译
pnpm test           # 运行 16 个单元测试
pnpm lint           # 类型检查
```

## 生态

| 项目 | 说明 |
|---|---|
| [AinCore](https://github.com/bzda404/aincore) | 本地 AI 算力平台核心枢纽（llama.cpp 推理 + OAuth 授权 + 隐私哨兵） |
| [AinCore Notes](https://github.com/bzda404/aincore-notes) | AI 知识管理应用（Markdown 编辑器 + MCP 协议 + 隐私拦截器） |

## 许可证

[MIT](LICENSE)
