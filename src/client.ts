/**
 * MindVaultClient — 第三方应用接入 MindVault Core 的主入口
 *
 * 支持两种授权方式:
 *   1. OAuth 2.0 + PKCE (推荐) — 完整的 client 注册、授权码流程、token 刷新
 *   2. 简单 session token (兼容旧版) — app.register + app.request_auth
 *
 * @example OAuth 2.0 flow:
 * ```ts
 * import { MindVaultClient } from '@aincore/sdk'
 *
 * const mv = new MindVaultClient({ name: '我的研究助手' })
 * await mv.discover()
 *
 * // OAuth 注册
 * const { client_id, client_secret } = await mv.registerOAuth()
 *
 * // PKCE 授权
 * const { verifier, challenge } = mv.generatePKCE()
 * const { authorizationCode } = await mv.authorize(
 *   'inference:read knowledge:read knowledge:write offline_access',
 *   challenge,
 * )
 *
 * // 换取 token
 * const tokenSet = await mv.exchangeCode(authorizationCode, verifier)
 *
 * // 使用 API
 * const reply = await mv.chat({ messages: [{ role: 'user', content: '你好' }] })
 * ```
 *
 * @example Legacy simple auth:
 * ```ts
 * const mv = new MindVaultClient({ name: '我的研究助手' })
 * await mv.discover()
 * await mv.requestAuth({ models: ['Qwen3.5-0.8B'] })
 * const reply = await mv.chat({ messages: [{ role: 'user', content: '你好' }] })
 * ```
 */
import { UDSTransport } from './transports/uds.js'
import { OAuthClient, generatePKCE, type OAuthClientConfig, type OAuthTokenSet, type OAuthIntrospection } from './oauth.js'
import type {
  MindVaultClientOptions,
  AuthRequest,
  AuthResult,
  DiscoveryResult,
  CoreStatus,
  KnowledgeBaseGrant,
  ModelInfo,
  ChatParams,
  ChatResult,
  SearchResult,
  NoteListItem,
  NoteContext,
  UserProfile,
} from './types.js'

export type {
  MindVaultClientOptions,
  AuthRequest,
  AuthResult,
  DiscoveryResult,
  CoreStatus,
  KnowledgeBaseGrant,
  ModelInfo,
  ChatParams,
  ChatResult,
  SearchResult,
  NoteListItem,
  NoteContext,
  UserProfile,
  OAuthClientConfig,
  OAuthTokenSet,
  OAuthIntrospection,
}

export class MindVaultClient {
  private transport: UDSTransport
  public oauth: OAuthClient
  private appId: string | null = null
  private sessionToken: string | null = null
  private appName: string
  private appIcon: string
  private appVendor: string
  private useOAuth = false

  constructor(options: MindVaultClientOptions) {
    this.transport = new UDSTransport(options.socketPath)
    this.oauth = new OAuthClient(this.transport)
    this.appName = options.name
    this.appIcon = options.icon || ''
    this.appVendor = options.vendor || ''
  }

  // ============================================================
  // Discovery & Registration
  // ============================================================

  /** 检测 MindVault Core 是否可用 */
  async discover(): Promise<DiscoveryResult | null> {
    const connected = await this.transport.connect()
    if (!connected) return null
    try {
      return await this.transport.call('app.ping') as DiscoveryResult
    } catch {
      return null
    }
  }

  /** 注册应用到 MindVault Core (旧版简单注册) */
  async register(): Promise<string> {
    const result = await this.transport.call('app.register', {
      name: this.appName,
      icon: this.appIcon,
      vendor: this.appVendor,
    }) as { app_id: string }
    this.appId = result.app_id
    return this.appId
  }

  // ============================================================
  // OAuth 2.0 Authorization (推荐)
  // ============================================================

  /**
   * 生成 PKCE 验证参数
   *
   * 在调用 authorize() 前调用，保存 verifier 并在 exchangeCode() 中使用。
   */
  generatePKCE(): { verifier: string; challenge: string } {
    return generatePKCE()
  }

  /**
   * OAuth 2.0 客户端注册
   *
   * 注册后将获得 client_id / client_secret，用于后续 OAuth 流程。
   * 凭据会自动存储在 oauth 子客户端中。
   */
  async registerOAuth(): Promise<OAuthClientConfig> {
    const config = await this.oauth.register(this.appName, this.appIcon, this.appVendor)
    this.useOAuth = true
    return config
  }

  /**
   * 发起 OAuth 授权 — 获取 authorizationCode
   *
   * @param scopes       空格分隔的作用域，如 "inference:read knowledge:read offline_access"
   * @param codeChallenge PKCE S256 code_challenge
   * @param state        可选防 CSRF 状态值
   */
  async authorize(
    scopes: string,
    codeChallenge: string,
    state?: string
  ): Promise<{ authorizationCode: string; state?: string }> {
    return this.oauth.authorize(scopes, codeChallenge, state)
  }

  /**
   * 用 authorizationCode 换取 access_token
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokenSet> {
    const tokenSet = await this.oauth.exchangeCode(code, codeVerifier)
    this.useOAuth = true
    return tokenSet
  }

  /**
   * 刷新 OAuth access_token
   */
  async refreshOAuthToken(): Promise<OAuthTokenSet> {
    return this.oauth.refreshToken()
  }

  /**
   * 检查 OAuth token 是否有效
   */
  async introspectOAuthToken(token?: string): Promise<OAuthIntrospection> {
    return this.oauth.introspectToken(token)
  }

  /**
   * 从持久化存储恢复 OAuth 凭据
   */
  restoreOAuthConfig(config: OAuthClientConfig): void {
    this.oauth.setConfig(config)
    this.useOAuth = true
  }

  /**
   * 从持久化存储恢复 OAuth token 集
   */
  restoreOAuthTokenSet(tokenSet: OAuthTokenSet): void {
    this.oauth.setTokenSet(tokenSet)
    this.useOAuth = true
  }

  // ============================================================
  // Simple session-token Authorization (兼容旧版)
  // ============================================================

  /**
   * 请求授权 — 触发 MindVault Core UI 弹窗，用户确认后获得 session_token
   * 如果尚未注册，会自动注册。
   */
  async requestAuth(auth: AuthRequest): Promise<AuthResult> {
    if (!this.appId) {
      await this.register()
    }

    const result = await this.transport.call('app.request_auth', {
      app_id: this.appId,
      models: auth.models,
      knowledge_bases: auth.knowledgeBases || [],
      timeout_ms: auth.timeoutMs,
    }) as AuthResult

    if (result.granted && result.session_token) {
      this.sessionToken = result.session_token
    }

    return result
  }

  /** 查询当前应用的授权范围 */
  async listGrants(): Promise<{ models: string[]; kb_paths: string[]; kb_grants?: KnowledgeBaseGrant[] }> {
    this.ensureAuth()
    return this.transport.call('app.list_grants', {
      session_token: this.sessionToken,
    }) as Promise<{ models: string[]; kb_paths: string[]; kb_grants?: KnowledgeBaseGrant[] }>
  }

  /** 撤销所有授权 */
  async revokeAuth(): Promise<void> {
    if (this.useOAuth) {
      await this.oauth.revokeClient()
      return
    }
    this.ensureAuth()
    await this.transport.call('app.revoke_auth', {
      session_token: this.sessionToken,
    })
    this.sessionToken = null
  }

  // ============================================================
  // AI Features
  // ============================================================

  /** 聊天补全 */
  async chat(params: ChatParams): Promise<ChatResult> {
    const auth = await this.resolveAuthParams()
    const result = await this.transport.call('chat.completions', {
      ...auth,
      messages: params.messages,
      max_tokens: params.max_tokens ?? 512,
      temperature: params.temperature ?? 0.7,
      model: params.model,
    })
    return normalizeChatResult(result)
  }

  /** 列出可用模型 */
  async listModels(): Promise<ModelInfo[]> {
    const auth = await this.resolveAuthParams()
    return this.transport.call(this.useOAuth ? 'models.list' : 'app.list_models', auth) as Promise<ModelInfo[]>
  }

  async getStatus(): Promise<CoreStatus> {
    return this.transport.call('status') as Promise<CoreStatus>
  }

  // ============================================================
  // Knowledge Base Access
  // ============================================================

  /** 搜索知识库 */
  async search(query: string, kb?: string, limit: number = 20): Promise<SearchResult[]> {
    const auth = await this.resolveAuthParams()
    const result = await this.transport.call('search_notes', {
      ...auth,
      query,
      kb,
      limit,
    }) as SearchResult[]
    return result
  }

  /** 读笔记 */
  async readNote(path: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const auth = await this.resolveAuthParams()
    const result = await this.transport.call('read_note', {
      ...auth,
      path,
    })

    const direct = result as { content?: unknown; metadata?: Record<string, unknown> }
    if (typeof direct.content === 'string') {
      return { content: direct.content, metadata: direct.metadata || {} }
    }

    const raw = result as { content?: Array<{ type: 'text'; text: string }> }
    const text = raw.content?.find(c => c.type === 'text')?.text || ''
    try {
      return JSON.parse(text)
    } catch {
      return { content: text, metadata: {} }
    }
  }

  /** 列出知识库目录 */
  async listNotes(kb: string, recursive: boolean = false): Promise<NoteListItem[]> {
    const auth = await this.resolveAuthParams()
    const result = await this.transport.call('list_notes', {
      ...auth,
      kb,
      recursive,
    }) as NoteListItem[]
    return result
  }

  /** 写笔记 */
  async writeNote(path: string, content: string): Promise<void> {
    const auth = await this.resolveAuthParams()
    await this.transport.call('write_note', {
      ...auth,
      path,
      content,
    })
  }

  /** 获取笔记片段上下文 */
  async getContext(path: string, range?: [number, number]): Promise<NoteContext> {
    const auth = await this.resolveAuthParams()
    return this.transport.call('get_context', {
      ...auth,
      path,
      range,
    }) as Promise<NoteContext>
  }

  // ============================================================
  // User Profile
  // ============================================================

  /** 获取用户画像（AI 记忆） */
  async getProfile(): Promise<UserProfile> {
    return this.transport.call('profile.get') as Promise<UserProfile>
  }

  /** 更新用户画像（部分更新） */
  async updateProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
    return this.transport.call(
      'profile.update',
      profile as Record<string, unknown>,
    ) as Promise<UserProfile>
  }

  // ============================================================
  // Utilities
  // ============================================================

  /** 断开 */
  disconnect(): void {
    this.transport.disconnect()
    this.sessionToken = null
  }

  /**
   * 解析认证 token：
   * - 如果使用 OAuth，返回 access_token
   * - 如果使用旧版 session token，返回 session_token
   */
  private async resolveAuthToken(): Promise<string> {
    if (this.useOAuth) {
      return this.oauth.getAccessToken()
    }
    return this.ensureSessionToken()
  }

  private async resolveAuthParams(): Promise<{ access_token: string } | { session_token: string }> {
    if (this.useOAuth) {
      return { access_token: await this.oauth.getAccessToken() }
    }
    return { session_token: this.ensureSessionToken() }
  }

  private ensureSessionToken(): string {
    if (!this.sessionToken) {
      throw new Error('未授权 — 请先调用 requestAuth() 或完成 OAuth 流程')
    }
    return this.sessionToken
  }

  private ensureAuth(): void {
    if (this.useOAuth) return
    this.ensureSessionToken()
  }
}

function normalizeChatResult(result: unknown): ChatResult {
  const direct = result as ChatResult
  if (typeof direct?.content === 'string') return direct

  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const choices = Array.isArray(record.choices) ? record.choices : []
  const first = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {}
  const message = first.message && typeof first.message === 'object' ? first.message as Record<string, unknown> : null
  const content = typeof message?.content === 'string'
    ? message.content
    : typeof first.text === 'string'
      ? first.text
      : ''

  const usage = record.usage && typeof record.usage === 'object'
    ? record.usage as ChatResult['usage']
    : undefined

  return {
    content,
    model: typeof record.model === 'string' ? record.model : undefined,
    usage,
  }
}
