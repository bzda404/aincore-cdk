/**
 * UDS Transport — 连接 AinCore 的底层通信层
 * 纯 Node.js 实现，零依赖
 */
import { connect, type Socket } from 'net'
import { platform } from 'os'

const DEFAULT_SOCKET_PATH = platform() === 'win32'
  ? '\\\\.\\pipe\\aincore'
  : '/tmp/aincore.sock'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

export class UDSTransport {
  private socket: Socket | null = null
  private buffer = ''
  private pendingCalls = new Map<number, PendingCall>()
  private requestId = 0
  private connected = false
  private socketPath: string

  constructor(socketPath?: string) {
    this.socketPath = socketPath || DEFAULT_SOCKET_PATH
  }

  /** 连接到 AinCore */
  async connect(): Promise<boolean> {
    if (this.connected) return true

    return new Promise((resolve) => {
      try {
        this.socket = connect(this.socketPath)

        this.socket.on('connect', () => {
          this.connected = true
          resolve(true)
        })

        this.socket.on('data', (data: Buffer) => {
          this.buffer += data.toString()
          this.processBuffer()
        })

        this.socket.on('close', () => {
          this.connected = false
          this.socket = null
          for (const pending of this.pendingCalls.values()) {
            pending.reject(new Error('连接已关闭'))
          }
          this.pendingCalls.clear()
        })

        this.socket.on('error', () => {
          this.connected = false
          resolve(false)
        })
      } catch {
        resolve(false)
      }
    })
  }

  /** 发送 JSON-RPC 请求 */
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected || !this.socket) {
      const reconnected = await this.connect()
      if (!reconnected) throw new Error('无法连接到 AinCore')
    }

    const id = ++this.requestId
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

    return new Promise((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject })
      this.socket!.write(message)
    })
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
      this.connected = false
    }
  }

  get isConnected(): boolean {
    return this.connected
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
        // 忽略无效消息
      }
    }
  }
}
