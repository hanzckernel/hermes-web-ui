import { io, Socket } from 'socket.io-client'
import { getToken } from '../../auth'
import type { GatewayManager } from '../gateway-manager'

// ─── Types ────────────────────────────────────────────────────

interface AgentConfig {
    profile: string
    name: string
    description: string
    invited: number
}

interface MessageData {
    id: string
    roomId: string
    senderId: string
    senderName: string
    content: string
    timestamp: number
}

interface MemberData {
    id: string
    name: string
    joinedAt: number
}

interface JoinResult {
    roomId: string
    roomName: string
    members: MemberData[]
    messages: MessageData[]
    rooms: string[]
}

export interface AgentEventHandler {
    onMessage?: (data: { roomId: string; msg: MessageData }) => void
    onTyping?: (data: { roomId: string; userId: string; userName: string }) => void
    onStopTyping?: (data: { roomId: string; userId: string; userName: string }) => void
    onMemberJoined?: (data: { roomId: string; memberId: string; memberName: string; members: MemberData[] }) => void
    onMemberLeft?: (data: { roomId: string; memberId: string; memberName: string; members: MemberData[] }) => void
}

// ─── Agent Client (single connection) ─────────────────────────

class AgentClient {
    readonly agentId: string
    readonly profile: string
    readonly name: string
    private socket: Socket | null = null
    private joinedRooms = new Set<string>()
    private handlers: AgentEventHandler
    private port: number = 8648
    private _reconnecting = false
    private gatewayManager: GatewayManager | null = null

    constructor(config: AgentConfig, handlers: AgentEventHandler = {}) {
        this.agentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        this.profile = config.profile
        this.name = config.name
        this.handlers = handlers
    }

    get connected(): boolean {
        return this.socket?.connected ?? false
    }

    get id(): string | undefined {
        return this.socket?.id
    }

    setGatewayManager(manager: GatewayManager): void {
        this.gatewayManager = manager
    }

    async connect(port = 8648): Promise<void> {
        this.port = port
        const token = await getToken()

        this.socket = io(`http://127.0.0.1:${port}/api/hermes/group-chat`, {
            auth: {
                token: token || undefined,
                name: this.name,
            },
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
        })

        this.bindEvents()

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000)

            this.socket!.on('connect', () => {
                clearTimeout(timeout)
                resolve()
            })

            this.socket!.on('connect_error', (err) => {
                clearTimeout(timeout)
                reject(err)
            })
        })
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect()
            this.socket = null
            this.joinedRooms.clear()
        }
    }

    async joinRoom(roomId: string): Promise<JoinResult> {
        this.ensureConnected()
        return new Promise((resolve, reject) => {
            this.socket!.emit('join', { roomId }, (res: JoinResult | { error: string }) => {
                if ('error' in res) {
                    reject(new Error(res.error))
                } else {
                    this.joinedRooms.add(roomId)
                    resolve(res)
                }
            })
        })
    }

    sendMessage(roomId: string, content: string): Promise<string> {
        this.ensureConnected()
        return new Promise((resolve, reject) => {
            this.socket!.emit('message', { roomId, content }, (res: { id?: string; error?: string }) => {
                if (res.error) {
                    reject(new Error(res.error))
                } else {
                    resolve(res.id!)
                }
            })
        })
    }

    startTyping(roomId: string): void {
        this.ensureConnected()
        this.socket!.emit('typing', { roomId })
    }

    stopTyping(roomId: string): void {
        this.ensureConnected()
        this.socket!.emit('stop_typing', { roomId })
    }

    getJoinedRooms(): string[] {
        return Array.from(this.joinedRooms)
    }

    private async deleteSession(upstream: string, apiKey: string | null, runId: string): Promise<void> {
        try {
            await fetch(`${upstream}/v1/sessions/${runId}`, {
                method: 'DELETE',
                headers: {
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                signal: AbortSignal.timeout(10000),
            })
        } catch (err: any) {
            console.warn(`[AgentClients] ${this.name}: failed to delete session ${runId}: ${err.message}`)
        }
    }

    private ensureConnected(): void {
        if (!this.socket?.connected) {
            throw new Error(`Agent "${this.name}" is not connected`)
        }
    }

    // ─── Hermes Gateway Integration ────────────────────────────

    /**
     * Forward a user message to Hermes gateway and stream the reply back to the room.
     */
    private async handleUserMessage(roomId: string, msg: MessageData): Promise<void> {
        if (!this.gatewayManager) return

        // Ignore own messages and messages mentioning own name
        if (msg.senderId === this.socket?.id) return
        if (!msg.content.toLowerCase().includes(`@${this.name.toLowerCase()}`)) return

        const upstream = this.gatewayManager.getUpstream(this.profile)
        const apiKey = this.gatewayManager.getApiKey(this.profile)
        if (!upstream) {
            console.error(`[AgentClients] ${this.name}: no gateway upstream for profile "${this.profile}"`)
            return
        }

        try {
            // Notify room that agent is typing
            this.startTyping(roomId)

            // Generate unique session_id per agent per interaction
            const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

            // Start a run on Hermes gateway
            const runRes = await fetch(`${upstream}/v1/runs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                },
                body: JSON.stringify({
                    input: msg.content,
                    session_id: sessionId,
                }),
                signal: AbortSignal.timeout(120000),
            })

            if (!runRes.ok) {
                const text = await runRes.text().catch(() => '')
                console.error(`[AgentClients] ${this.name}: gateway run failed (${runRes.status}): ${text}`)
                this.stopTyping(roomId)
                return
            }

            const { run_id } = await runRes.json() as { run_id: string }
            if (!run_id) {
                this.stopTyping(roomId)
                return
            }

            // Stream events from Hermes
            const eventsUrl = new URL(`${upstream}/v1/runs/${run_id}/events`)
            if (apiKey) eventsUrl.searchParams.set('token', apiKey)
            const source = new EventSource(eventsUrl.toString())

            let fullContent = ''

            source.onmessage = (e) => {
                try {
                    const parsed = JSON.parse(e.data)

                    if (parsed.event === 'run.completed') {
                        source.close()
                        if (fullContent) {
                            this.stopTyping(roomId)
                            this.sendMessage(roomId, fullContent)
                        }
                        this.deleteSession(upstream, apiKey, sessionId).catch(() => {})
                        return
                    }

                    if (parsed.event === 'run.failed') {
                        source.close()
                        this.stopTyping(roomId)
                        this.deleteSession(upstream, apiKey, sessionId).catch(() => {})
                        return
                    }

                    // Accumulate message deltas
                    if (parsed.event === 'message' && parsed.delta) {
                        fullContent += parsed.delta
                    }
                } catch {
                    // ignore parse errors
                }
            }

            source.onerror = () => {
                source.close()
                this.stopTyping(roomId)
            }
        } catch (err: any) {
            console.error(`[AgentClients] ${this.name}: error handling message: ${err.message}`)
            this.stopTyping(roomId)
        }
    }

    private bindEvents(): void {
        const s = this.socket!

        s.on('message', (msg: MessageData) => {
            // Forward to Hermes gateway for AI response
            this.handleUserMessage(msg.roomId, msg).catch((err) => {
                console.error(`[AgentClients] ${this.name}: handleUserMessage error: ${err.message}`)
            })
            // Also notify external handlers
            this.handlers.onMessage?.({ roomId: msg.roomId, msg })
        })

        s.on('typing', (data: any) => {
            this.handlers.onTyping?.(data)
        })

        s.on('stop_typing', (data: any) => {
            this.handlers.onStopTyping?.(data)
        })

        s.on('member_joined', (data: any) => {
            this.handlers.onMemberJoined?.(data)
        })

        s.on('member_left', (data: any) => {
            this.handlers.onMemberLeft?.(data)
        })

        // Auto rejoin rooms on reconnect
        s.io.on('reconnect', async () => {
            if (this._reconnecting) return
            this._reconnecting = true
            console.log(`[AgentClients] ${this.name} reconnecting, rejoining ${this.joinedRooms.size} rooms...`)
            const rooms = Array.from(this.joinedRooms)
            for (const roomId of rooms) {
                try {
                    await this.joinRoom(roomId)
                } catch (err: any) {
                    console.error(`[AgentClients] ${this.name} failed to rejoin room ${roomId}: ${err.message}`)
                }
            }
            this._reconnecting = false
        })
    }
}

// ─── AgentClients (roomId -> agents) ──────────────────────────

export class AgentClients {
    private rooms = new Map<string, Map<string, AgentClient>>()

    /**
     * Create an agent client and connect it to the server.
     * The agent will NOT auto-join any room — call addAgentToRoom separately.
     */
    async createAgent(config: AgentConfig, handlers?: AgentEventHandler, port?: number): Promise<AgentClient> {
        const client = new AgentClient(config, handlers)
        await client.connect(port)
        console.log(`[AgentClients] Connected: ${client.name} (${client.agentId})`)
        return client
    }

    /**
     * Connect an agent to a room.
     */
    async addAgentToRoom(roomId: string, client: AgentClient): Promise<JoinResult> {
        let room = this.rooms.get(roomId)
        if (!room) {
            room = new Map()
            this.rooms.set(roomId, room)
        }

        room.set(client.agentId, client)
        const result = await client.joinRoom(roomId)
        console.log(`[AgentClients] ${client.name} joined room: ${roomId}`)
        return result
    }

    /**
     * Remove an agent from a room and disconnect it.
     */
    removeAgentFromRoom(roomId: string, agentId: string): void {
        const room = this.rooms.get(roomId)
        if (!room) return

        const client = room.get(agentId)
        if (client) {
            client.disconnect()
            room.delete(agentId)
            console.log(`[AgentClients] ${client.name} left room: ${roomId}`)
        }

        if (room.size === 0) {
            this.rooms.delete(roomId)
        }
    }

    /**
     * Get all agents in a room.
     */
    getAgents(roomId: string): AgentClient[] {
        const room = this.rooms.get(roomId)
        return room ? Array.from(room.values()) : []
    }

    /**
     * Get a specific agent in a room.
     */
    getAgent(roomId: string, agentId: string): AgentClient | undefined {
        return this.rooms.get(roomId)?.get(agentId)
    }

    /**
     * Get all room IDs that have agents.
     */
    getRoomIds(): string[] {
        return Array.from(this.rooms.keys())
    }

    /**
     * Send a message from a specific agent in a room.
     */
    async sendMessage(roomId: string, agentId: string, content: string): Promise<string> {
        const client = this.getAgent(roomId, agentId)
        if (!client) {
            throw new Error(`Agent "${agentId}" not found in room "${roomId}"`)
        }
        return client.sendMessage(roomId, content)
    }

    /**
     * Broadcast a message from all agents in a room.
     */
    async broadcastFromRoom(roomId: string, content: string): Promise<string[]> {
        const agents = this.getAgents(roomId)
        return Promise.all(agents.map((agent) => agent.sendMessage(roomId, content)))
    }

    /**
     * Disconnect all agents in a room.
     */
    disconnectRoom(roomId: string): void {
        const room = this.rooms.get(roomId)
        if (!room) return

        room.forEach((client) => client.disconnect())
        this.rooms.delete(roomId)
        console.log(`[AgentClients] All agents disconnected from room: ${roomId}`)
    }

    /**
     * Disconnect all agents in all rooms.
     */
    disconnectAll(): void {
        this.rooms.forEach((room) => {
            room.forEach((client) => client.disconnect())
        })
        this.rooms.clear()
        console.log('[AgentClients] All agents disconnected')
    }

    /**
     * Set gateway manager for all existing and future agents.
     */
    setGatewayManager(manager: GatewayManager): void {
        this.rooms.forEach((room) => {
            room.forEach((client) => client.setGatewayManager(manager))
        })
    }
}
