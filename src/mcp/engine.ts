import { ArchmapError } from '../util.js'
import { SERVER_INSTRUCTIONS } from './instructions.js'
import { callTool, filterTools, TOOL_DEFS, truncateOutput, type ToolDef } from './tools.js'

export interface RpcMessage {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

export interface EngineOptions {
  cwd: string
  version: string
  /** 工具白名单(来自 ARCHMAP_MCP_TOOLS),undefined = 全开 */
  allow?: string
}

/**
 * 手写的最小 MCP 引擎(stdio、newline-delimited JSON-RPC)。
 * 只支持 tools 能力——archmap 无资源、无提示词、无 daemon,不需要 SDK。
 */
export class McpEngine {
  private readonly tools: ToolDef[]

  constructor(private readonly opts: EngineOptions) {
    this.tools = filterTools(TOOL_DEFS, opts.allow)
  }

  async handle(msg: RpcMessage): Promise<RpcMessage | null> {
    if (!msg.method) return null // 对方的 response,忽略
    const isNotification = msg.id === undefined
    switch (msg.method) {
      case 'initialize':
        return this.result(msg, {
          protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'archmap', version: this.opts.version },
          instructions: SERVER_INSTRUCTIONS,
        })
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null
      case 'ping':
        return this.result(msg, {})
      case 'tools/list':
        return this.result(msg, { tools: this.tools })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        if (!this.tools.some((t) => t.name === name))
          return this.error(msg, -32602, `未知或未启用的工具: ${name}`)
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
        try {
          const text = truncateOutput(await callTool(name, args, this.opts.cwd))
          return this.result(msg, { content: [{ type: 'text', text }] })
        } catch (e) {
          // 业务失败(校验不过等)走 isError 内容,AI 可读提示重试;其余抛协议错误
          if (e instanceof ArchmapError)
            return this.result(msg, { content: [{ type: 'text', text: e.message }], isError: true })
          return this.error(msg, -32603, (e as Error).message)
        }
      }
      default:
        return isNotification ? null : this.error(msg, -32601, `不支持的方法: ${msg.method}`)
    }
  }

  private result(msg: RpcMessage, result: unknown): RpcMessage {
    return { jsonrpc: '2.0', id: msg.id ?? null, result }
  }

  private error(msg: RpcMessage, code: number, message: string): RpcMessage {
    return { jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } }
  }
}

/** stdio 主循环:按行读 JSON-RPC,串行处理保证顺序 */
export function runStdioServer(engine: McpEngine): void {
  let buf = ''
  let chain: Promise<void> = Promise.resolve()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      chain = chain.then(async () => {
        let msg: RpcMessage
        try {
          msg = JSON.parse(line) as RpcMessage
        } catch {
          return
        }
        const resp = await engine.handle(msg)
        if (resp) process.stdout.write(JSON.stringify(resp) + '\n')
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
}
