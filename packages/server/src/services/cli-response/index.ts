/**
 * CliResponse — Socket.IO 消息接收服务
 *
 * 核心职责：
 *   1. 基于 Socket.IO 管理 WebSocket 连接
 *   2. 接收客户端消息并通过事件分发
 *   3. 提供 HTTP POST 端点供外部 CLI (curl) 推送消息
 *   4. 支持房间、广播、定向发送
 */

import { Server as SocketIOServer, type Socket, type ServerOptions } from 'socket.io'
import Router from '@koa/router'
import type { Server as HttpServer } from 'http'

// ============================
// 类型
// ============================

export interface CliResponseConfig extends Partial<ServerOptions> {
    /** Socket.IO 路径，默认 /socket.io/cli-response */
    path?: string
}

interface ClientInfo {
    socket: Socket
    id: string
    connectedAt: number
}

type MessageHandler = (message: any, client: ClientInfo) => void | Promise<void>

// ============================
// CliResponse
// ============================

export class CliResponse {
    private io: SocketIOServer | null = null
    private clients = new Map<string, ClientInfo>()
    private path: string
    private serverOptions: Partial<ServerOptions>
    private handlers: MessageHandler[] = []

    constructor(config?: CliResponseConfig) {
        this.path = config?.path || '/socket.io/cli-response'
        this.serverOptions = {
            ...config,
            path: this.path,
        }
    }

    /** 挂载到 HTTP Server，创建 Socket.IO 实例 */
    attach(httpServer: HttpServer): void {
        if (this.io) {
            throw new Error('CliResponse already attached')
        }

        this.io = new SocketIOServer(httpServer, {
            cors: { origin: '*' },
            ...this.serverOptions,
        })

        this.io.on('connection', (socket) => {
            this.handleConnection(socket)
        })

        console.log(`[CliResponse] Socket.IO attached at ${this.path}`)
    }

    /** 获取 Socket.IO 实例 */
    getIO(): SocketIOServer {
        if (!this.io) throw new Error('CliResponse not attached')
        return this.io
    }

    /** 获取 Koa 路由（HTTP POST 端点，供 curl / 外部 CLI 推送消息） */
    getRoutes(): Router {
        const router = new Router()

        // POST /api/hermes/cli-response — 推送消息，通过 Socket.IO 广播给前端
        router.post('/api/hermes/cli-response', async (ctx) => {
            const body = ctx.request.body as any

            // body 格式: { event: string, data?: any } 或纯文本/JSON
            const event = body?.event || 'message'
            const data = body?.data !== undefined ? body.data : body
            console.log(event, data)
            this.broadcast(event, data)

            console.log(`[CliResponse] HTTP received: event=${event}, clients=${this.clients.size}`)

            ctx.body = { ok: true, clients: this.clients.size }
        })

        return router
    }

    /** 注册消息处理函数（监听 'message' 事件） */
    onMessage(handler: MessageHandler): void {
        this.handlers.push(handler)
    }

    /** 注册自定义事件处理函数 */
    onEvent(event: string, handler: (data: any, client: ClientInfo) => void): void {
        if (!this.io) {
            throw new Error('CliResponse not attached')
        }

        this.io.on('connection', (socket) => {
            socket.on(event, (data: any) => {
                const client = this.clients.get(socket.id)
                if (client) handler(data, client)
            })
        })
    }

    /** 移除消息处理函数 */
    offMessage(handler: MessageHandler): void {
        this.handlers = this.handlers.filter(h => h !== handler)
    }

    /** 获取当前连接的客户端数量 */
    getClientCount(): number {
        return this.clients.size
    }

    /** 向所有已连接的客户端广播 */
    broadcast(event: string, data?: any): void {
        this.io?.emit(event, data)
    }

    /** 向指定客户端发送 */
    sendTo(clientId: string, event: string, data?: any): boolean {
        const socket = this.io?.sockets.sockets.get(clientId)
        if (!socket?.connected) return false
        socket.emit(event, data)
        return true
    }

    /** 向房间广播 */
    broadcastToRoom(room: string, event: string, data?: any): void {
        this.io?.to(room).emit(event, data)
    }

    /** 将客户端加入房间 */
    joinRoom(clientId: string, room: string): boolean {
        const socket = this.io?.sockets.sockets.get(clientId)
        if (!socket?.connected) return false
        socket.join(room)
        return true
    }

    /** 将客户端移出房间 */
    leaveRoom(clientId: string, room: string): boolean {
        const socket = this.io?.sockets.sockets.get(clientId)
        if (!socket?.connected) return false
        socket.leave(room)
        return true
    }

    /** 断开所有客户端 */
    disconnectAll(): void {
        this.io?.disconnectSockets(true)
        this.clients.clear()
    }

    /** 销毁服务 */
    destroy(): void {
        this.disconnectAll()
        this.io?.close()
        this.io = null
        this.handlers = []
        this.clients.clear()
        console.log('[CliResponse] Destroyed')
    }

    // ============================
    // 内部方法
    // ============================

    private handleConnection(socket: Socket): void {
        const client: ClientInfo = {
            socket,
            id: socket.id,
            connectedAt: Date.now(),
        }
        this.clients.set(socket.id, client)

        console.log(`[CliResponse] Client connected: ${socket.id} (${this.clients.size} total)`)

        // 处理 'message' 事件
        socket.on('message', (data: any) => {
            for (const handler of this.handlers) {
                try {
                    handler(data, client)
                } catch (err) {
                    console.error(`[CliResponse] Handler error for ${socket.id}:`, err)
                }
            }
        })

        socket.on('disconnect', (reason: string) => {
            this.clients.delete(socket.id)
            console.log(`[CliResponse] Client disconnected: ${socket.id} (${reason}, ${this.clients.size} total)`)
        })

        socket.on('error', (err: Error) => {
            console.error(`[CliResponse] Client ${socket.id} error:`, err.message)
        })
    }
}
