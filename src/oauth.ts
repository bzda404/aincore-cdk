/**
 * OAuth 2.0 Client — PKCE Authorization Code Flow 实现
 *
 * 用于 @mindvault/sdk 中完成完整的 OAuth 2.0 授权流程:
 *   1. 注册 OAuth 客户端 (oauth.register)
 *   2. 发起授权请求 (oauth.authorize) — PKCE S256
 *   3. 换取 access_token (oauth.token)
 *   4. 刷新 token (oauth.token + refresh_token)
 *   5. 撤销 token (oauth.revoke)
 *   6. 内省 token (oauth.introspect)
 */

import { randomBytes, createHash } from 'crypto'
import type { UDSTransport } from './transports/uds'

export interface OAuthClientConfig {
  client_id: string
  client_secret: string
}

export interface OAuthTokenSet {
  access_token: string
  refresh_token: string | null
  token_type: 'Bearer'
  expires_in: number       // seconds
  scope: string
  obtained_at: number      // Date.now()
}

export interface OAuthIntrospection {
  active: boolean
  client_id?: string
  scope?: string
  token_type?: string
}

/**
 * 生成 PKCE code_verifier 和 code_challenge (S256)
 */
export function generatePKCE(): { verifier: string; challenge: string } {
  // 43-128 char random string
  const bytes = randomBytes(32)
  const verifier = bytes.toString('base64url')
  const hash = createHash('sha256')
  hash.update(verifier)
  const challenge = hash.digest('base64url')
  return { verifier, challenge }
}

/**
 * OAuth 2.0 客户端
 *
 * 封装了完整的 OAuth 2.0 Authorization Code + PKCE 流程,
 * 自动管理 token 过期和刷新。
 */
export class OAuthClient {
  private transport: UDSTransport
  private config: OAuthClientConfig | null = null
  private tokenSet: OAuthTokenSet | null = null

  constructor(transport: UDSTransport) {
    this.transport = transport
  }

  // ============================================================
  // Registration
  // ============================================================

  /**
   * 注册 OAuth 客户端
   *
   * 如果已有 client_id/secret, 可以直接 setConfig() 跳过注册。
   */
  async register(appName: string, appIcon: string = '', appVendor: string = ''): Promise<OAuthClientConfig> {
    const result = await this.transport.call('oauth.register', {
      app_name: appName,
      app_icon: appIcon,
      app_vendor: appVendor,
    }) as OAuthClientConfig

    this.config = result
    return result
  }

  /** 直接设置已知的 OAuth 客户端凭据 (跳过注册步骤) */
  setConfig(config: OAuthClientConfig): void {
    this.config = config
  }

  getClientId(): string | null {
    return this.config?.client_id ?? null
  }

  // ============================================================
  // Authorization Code Flow
  // ============================================================

  /**
   * 发起授权码流程 — Step 1: 获取 authorizationCode
   *
   * @param scopes       请求的作用域 (空格分隔)
   * @param codeChallenge PKCE code_challenge (由 generatePKCE() 生成)
   * @param state        防 CSRF 状态值 (可选)
   *
   * @returns { authorizationCode, state }
   */
  async authorize(
    scopes: string,
    codeChallenge: string,
    state?: string
  ): Promise<{ authorizationCode: string; state?: string }> {
    if (!this.config) {
      throw new Error('未注册 OAuth 客户端，请先调用 register() 或 setConfig()')
    }

    const params: Record<string, unknown> = {
      client_id: this.config.client_id,
      scope: scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }

    if (state !== undefined) {
      params.state = state
    }

    const result = await this.transport.call('oauth.authorize', params) as {
      authorizationCode?: string
      authorization_code?: string
      state?: string
    }
    const authorizationCode = result.authorizationCode || result.authorization_code
    if (!authorizationCode) {
      throw new Error('OAuth authorize 响应缺少 authorization_code')
    }
    return { authorizationCode, state: result.state }
  }

  /**
   * 换取令牌 — Step 2: 用 authorizationCode 换取 access_token
   *
   * @param code         authorizationCode
   * @param codeVerifier PKCE code_verifier (与 authorize() 中使用的 verifier 对应)
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokenSet> {
    if (!this.config) {
      throw new Error('未注册 OAuth 客户端')
    }

    const result = await this.transport.call('oauth.token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
    }) as OAuthTokenSet

    this.tokenSet = {
      ...result,
      obtained_at: Date.now(),
    }

    return this.tokenSet
  }

  // ============================================================
  // Token management
  // ============================================================

  /**
   * 刷新 access_token
   */
  async refreshToken(): Promise<OAuthTokenSet> {
    if (!this.config) throw new Error('未注册 OAuth 客户端')
    if (!this.tokenSet?.refresh_token) throw new Error('没有 refresh_token 可用')

    const result = await this.transport.call('oauth.token', {
      grant_type: 'refresh_token',
      refresh_token: this.tokenSet.refresh_token,
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
    }) as OAuthTokenSet

    this.tokenSet = {
      ...result,
      obtained_at: Date.now(),
    }

    return this.tokenSet
  }

  /**
   * 撤销当前 token
   */
  async revokeToken(token?: string): Promise<boolean> {
    const t = token || this.tokenSet?.access_token
    if (!t) throw new Error('没有可撤销的 token')

    const result = await this.transport.call('oauth.revoke', { token: t }) as { revoked: boolean }
    if (t === this.tokenSet?.access_token) {
      this.tokenSet = null
    }
    return result.revoked
  }

  async revokeClient(): Promise<boolean> {
    if (!this.config) throw new Error('未注册 OAuth 客户端')
    const result = await this.transport.call('oauth.revoke_client', {
      client_id: this.config.client_id,
      client_secret: this.config.client_secret,
    }) as { success: boolean }
    this.tokenSet = null
    return result.success
  }

  /**
   * 获取当前有效的 access_token, 必要时自动刷新
   */
  async getAccessToken(): Promise<string> {
    if (!this.tokenSet) throw new Error('未授权 — 请先完成 OAuth 流程')

    // 检查是否在 5 分钟内过期
    const expiresAt = this.tokenSet.obtained_at + this.tokenSet.expires_in * 1000
    if (Date.now() > expiresAt - 300_000) {
      // 尝试刷新
      if (this.tokenSet.refresh_token) {
        await this.refreshToken()
      } else {
        throw new Error('access_token 即将过期且无 refresh_token')
      }
    }

    return this.tokenSet.access_token
  }

  /**
   * 内省 token
   */
  async introspectToken(token?: string): Promise<OAuthIntrospection> {
    const t = token || this.tokenSet?.access_token
    if (!t) throw new Error('没有可内省的 token')

    return this.transport.call('oauth.introspect', { token: t }) as Promise<OAuthIntrospection>
  }

  /**
   * 获取当前 token 集
   */
  getTokenSet(): OAuthTokenSet | null {
    return this.tokenSet
  }

  /**
   * 恢复 token 集 (从持久化存储中加载)
   */
  setTokenSet(tokenSet: OAuthTokenSet): void {
    this.tokenSet = tokenSet
  }

  /**
   * 检查是否已授权
   */
  isAuthorized(): boolean {
    return this.tokenSet !== null
  }
}
