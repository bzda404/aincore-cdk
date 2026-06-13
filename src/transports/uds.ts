/**
 * UDS Transport — 连接 AinCore 的底层通信层
 * 纯 Node.js 实现，零依赖
 */
import { connect, type Socket } from 'net'
import { platform } from 'os'

const DEFAULT_SOCKET_PATH = platform() === 'win32'
  ? '\\\\.\\pipe\\aincore'
  : '/tmp/aincore.sock'

const DEFAULT_CALL_TIMEOUT_MS = 150_000
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export class UDSTransport {
  private socket: Socket | null = null
  private buffer = ''
  private pendingCalls = new Map<number, PendingCall>()
  private requestId = 0
  private connected = false
  private socketPath: string
  private defaultTimeoutMs: number
  private connectTimeoutMs: number

  /** In-flight connect promise — reused to prevent concurrent connect() races */
  private connecting: Promise<boolean> | null = null

  constructor(socketPath?: string, options?: { timeoutMs?: number; connectTimeoutMs?: number }) {
    this.socketPath = socketPath || DEFAULT_SOCKET_PATH
    this.defaultTimeoutMs = options?.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  }

  /** 连接到 AinCore（并发安全：多次调用复用同一个连接 promise） */
  async connect(): Promise<boolean> {
    if (this.connected) return true
    if (this.connecting) return this.connecting

    this.connecting = this.doConnect()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  /** 发送 JSON-RPC 请求 */
  async call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<unknown> {
    if (!this.connected || !this.socket) {
      const reconnected = await this.connect()
      if (!reconnected) throw new Error('无法连接到 AinCore')
    }

    const id = ++this.requestId
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    const callTimeout = timeoutMs ?? this.defaultTimeoutMs

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`请求超时 (${callTimeout}ms): ${method}`))
      }, callTimeout)

      const pending: PendingCall = {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject:  (reason) => { clearTimeout(timer); reject(reason) },
        timeout: timer,
      }
      this.pendingCalls.set(id, pending)

      // Catch write errors synchronously — reject the pending call immediately
      this.socket!.write(message, (err) => {
        if (err) {
          this.pendingCalls.delete(id)
          clearTimeout(timer)
          reject(new Error(`写入失败: ${err.message}`))
        }
      })
    })
  }

  /** 断开连接 */
  disconnect(): void {
    this.connecting = null
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
      this.connected = false
    }
  }

  get isConnected(): boolean {
    return this.connected
  }

  // ============================================================
  // Private
  // ============================================================

  private doConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect(this.socketPath)

      // Connection timeout — prevents hanging indefinitely
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, this.connectTimeoutMs)

      socket.once('connect', () => {
        clearTimeout(timeout)
        this.socket = socket
        this.connected = true
        this.attachSocketListeners(socket)
        resolve(true)
      })

      socket.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  private attachSocketListeners(socket: Socket): void {
    socket.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    socket.on('close', () => {
      this.connected = false
      this.socket = null
      const error = new Error('连接已关闭')
      for (const pending of this.pendingCalls.values()) {
        clearTimeout(pending.timeout)
        pending.reject(error)
      }
      this.pendingCalls.clear()
    })

    socket.on('error', () => {
      this.connected = false
    })
  }

  private processBuffer(): void {
    const messages = this.buffer.split('\n')
    this.buffer = messages.pop() || ''

    for (const msg of messages) {
      if (!msg.trim()) continue
      try {
        const response = JSON.parse(msg)
        const pending = this.pendingCalls.get(response.id)
        if (pending) {
          this.pendingCalls.delete(response.id)
          if (response.error) {
            pending.reject(new Error(response.error.message))
          } else {
            pending.resolve(response.result)
          }
        }
      } catch {
        // 服务端发送了非 JSON 数据，忽略
      }
    }
  }
}
