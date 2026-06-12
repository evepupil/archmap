import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { loadStore } from '../store/snapshot.js'
import { buildViewData, renderViewerHtml } from './view.js'

export interface ViewerServer {
  port: number
  close: () => void
}

/**
 * 实时舆图服务:监听 .archmap/,快照变更通过 SSE 推给页面。
 * 数据量小,每个请求现读现算,不做缓存。
 */
export function startViewerServer(root: string, port = 0): Promise<ViewerServer> {
  const clients = new Set<http.ServerResponse>()
  const dir = path.join(root, '.archmap')

  const freshData = () => {
    const store = loadStore(root)
    const data = buildViewData(store.root, store.snapshots)
    data.live = true
    return data
  }

  const server = http.createServer((req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0]
      if (url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(renderViewerHtml(freshData()))
      } else if (url === '/data') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(freshData()))
      } else if (url === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write(': hello\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
      } else {
        res.writeHead(404)
        res.end()
      }
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end((e as Error).message)
    }
  })

  // 心跳防止连接被中间层掐断
  const heart = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n')
  }, 30_000)
  heart.unref()

  let timer: NodeJS.Timeout | null = null
  const notify = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      for (const c of clients) c.write('data: update\n\n')
    }, 300)
  }
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(dir, { recursive: true }, notify)
  } catch {
    watcher = fs.watch(dir, notify)
  }

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({
        port: addr.port,
        close: () => {
          clearInterval(heart)
          watcher.close()
          for (const c of clients) c.end()
          server.close()
        },
      })
    })
  })
}
