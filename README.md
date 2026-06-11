# @aincore/sdk

> TypeScript SDK for Hearth

`@aincore/sdk` 是 [Hearth](https://github.com/bzda404/hearth) 本地 AI 平台的客户端 SDK。它封装了 OAuth 2.0 + PKCE 授权流程和 UDS（Unix Domain Socket）JSON-RPC 传输层，让你的 Node.js 应用能够以类型安全的方式接入 Hearth 的模型推理、知识库管理和系统状态查询等服务。

**状态：v0.3.0**

## 安装

```bash
npm install @aincore/sdk
# 或
pnpm add @aincore/sdk
```

## 快速开始

```typescript
import { MindVaultClient } from '@aincore/sdk'

const client = new MindVaultClient()

// 连接 Hearth（自动触发 OAuth 授权流程）
await client.connect()

// 调用 OpenAI 兼容的聊天接口
const response = await client.chat({
  model: 'qwen2-0.5b-instruct',
  messages: [{ role: 'user', content: '你好' }]
})

console.log(response.choices[0].message.content)

// 断开连接
await client.disconnect()
```

## 主要 API

### MindVaultClient

核心客户端类，管理连接生命周期和 API 调用。

```typescript
// 列出已安装的模型
const models = await client.listModels()

// 查询系统状态
const status = await client.getSystemStatus()

// 知识库操作
const results = await client.searchKnowledge({
  query: '关键词',
  knowledgeBasePath: '/path/to/notes'
})
```

### OAuthClient

底层 OAuth 2.0 + PKCE 客户端，适用于需要自定义授权流程的场景。

```typescript
import { OAuthClient, generatePKCE } from '@aincore/sdk'

const { codeVerifier, codeChallenge } = await generatePKCE()
const oauth = new OAuthClient({ clientId: 'your-app-id' })
const tokens = await oauth.exchangeCode(code, codeVerifier)
```

## 授权作用域

| Scope | 说明 |
|---|---|
| `inference:read` | 调用模型推理 |
| `models:read` | 列出已安装模型 |
| `models:manage` | 加载/卸载模型 |
| `knowledge:read` | 读取知识库内容 |
| `knowledge:write` | 写入知识库内容 |
| `system:status` | 读取系统状态 |
| `offline_access` | 允许刷新令牌（长期访问） |

## 传输层

SDK 使用 UDS（Unix Domain Socket）进行通信，绕过 TCP/IP 协议栈以获得更好的性能：

- **macOS / Linux**: `/tmp/mindvault.sock`
- **Windows**: `\\.\pipe\mindvault`

## 开发

```bash
git clone https://github.com/bzda404/mindvault-sdk.git
cd mindvault-sdk
pnpm install
pnpm build        # 构建
pnpm test         # 运行测试
pnpm typecheck    # 类型检查
```

## 发布

```bash
# 打标签触发 CI 自动发布到 npm
git tag v0.4.0
git push origin v0.4.0
```

## 许可证

[MIT](LICENSE)
