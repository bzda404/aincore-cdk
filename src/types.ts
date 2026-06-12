/**
 * AinCore SDK — Type definitions
 */

export interface AinCoreClientOptions {
  /** 应用名称（显示在授权弹窗中） */
  name: string
  /** 应用图标（emoji 或 URL） */
  icon?: string
  /** 开发者名称 */
  vendor?: string
  /** UDS socket 路径覆盖（默认 /tmp/aincore.sock） */
  socketPath?: string
  /** 请求超时 (ms)，默认 120000 */
  timeoutMs?: number
}

export interface AuthRequest {
  /** 请求的模型名称列表 */
  models: string[]
  /** 请求的知识库列表 */
  knowledgeBases?: KnowledgeBaseAuthRequest[]
  /** 授权超时 (ms) */
  timeoutMs?: number
}

export interface KnowledgeBaseAuthRequest {
  path: string
  label: string
  /** 默认 read_write；传 read 时只请求读取/search/getContext 权限。 */
  scope?: 'read' | 'read_write'
}

export interface KnowledgeBaseGrant {
  path: string
  label?: string
  scope: 'read' | 'read_write'
}

export interface AuthResult {
  granted: boolean
  session_token?: string
  expires_at?: string | null
  granted_models?: string[]
  granted_kbs?: string[]
  granted_knowledge_bases?: KnowledgeBaseGrant[]
  reason?: string
}

export interface DiscoveryResult {
  protocol_version: string
  name: string
  features: string[]
  requires_auth: boolean
  transport?: 'uds'
  socketPath?: string
}

export interface CoreStatus {
  running: boolean
  transport: 'uds'
  socketPath: string
  loadedModel: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  scheduler?: unknown
  privacy?: unknown
}

export interface ModelInfo {
  id: string
  name: string
  family: string
  parameterSize: string
  quantization: string
  sizeBytes: number
}

export interface ChatParams {
  messages: Array<{ role: string; content: string }>
  max_tokens?: number
  temperature?: number
  model?: string
  /** Extra params passed through to the server (e.g. _skip_profile_injection) */
  extra?: Record<string, unknown>
}

export interface ChatResult {
  content: string
  model?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens?: number }
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
  score: number
}

export interface NoteListItem {
  path: string
  title: string
  size: number
  lastModified: string
  isDirectory: boolean
}

export interface NoteContext {
  path: string
  context: string
  start: number
  end: number
}

export interface UserProfile {
  display_name: string
  language: string
  communication_style: string
  custom_instructions: string
  preferences: Record<string, unknown>
  updated_at: string
}
