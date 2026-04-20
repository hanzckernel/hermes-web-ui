import { DatabaseSync } from 'node:sqlite'
import { Server, Socket } from 'socket.io'
import type { Server as HttpServer } from 'http'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { getToken } from '../../auth'
import { config } from '../../../config'
import { AgentClients } from './agent-clients'

// ─── Types ────────────────────────────────────────────────────

interface ChatMessage {
    id: string
    roomId: string
    senderId: string
    senderName: string
    content: string
    timestamp: number
}

interface RoomAgent {
    id: string
    roomId: string
    agentId: string
    profile: string
    name: string
    description: string
    invited: number
}

interface Member {
    id: string
    name: string
    joinedAt: number
}

// ─── SQLite Storage ───────────────────────────────────────────

class ChatStorage {
    private db: DatabaseSync

    constructor(dbPath: string) {
        this.db = new DatabaseSync(dbPath)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS rooms (
                id       TEXT PRIMARY KEY,
                name     TEXT NOT NULL,
                inviteCode TEXT UNIQUE
            )
        `)
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id        TEXT PRIMARY KEY,
                roomId    TEXT NOT NULL,
                senderId  TEXT NOT NULL,
                senderName TEXT NOT NULL,
                content   TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (roomId) REFERENCES rooms(id)
            )
        `)
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(roomId, timestamp)')
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS room_agents (
                id          TEXT PRIMARY KEY,
                roomId      TEXT NOT NULL,
                agentId     TEXT NOT NULL,
                profile     TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                invited     INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (roomId) REFERENCES rooms(id)
            )
        `)
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_room_agents_room ON room_agents(roomId)')
    }

    // ─── Rooms ────────────────────────────────────────────────

    getRoom(roomId: string): { id: string; name: string; inviteCode: string | null } | undefined {
        return this.db.prepare('SELECT id, name, inviteCode FROM rooms WHERE id = ?').get(roomId) as any
    }

    getRoomByInviteCode(code: string): { id: string; name: string; inviteCode: string | null } | undefined {
        return this.db.prepare('SELECT id, name, inviteCode FROM rooms WHERE inviteCode = ?').get(code) as any
    }

    getAllRooms(): { id: string; name: string; inviteCode: string | null }[] {
        return this.db.prepare('SELECT id, name, inviteCode FROM rooms ORDER BY id').all() as any[]
    }

    saveRoom(id: string, name: string, inviteCode?: string): void {
        this.db.prepare('INSERT OR IGNORE INTO rooms (id, name, inviteCode) VALUES (?, ?, ?)').run(id, name, inviteCode || null)
    }

    updateRoomInviteCode(roomId: string, inviteCode: string): void {
        this.db.prepare('UPDATE rooms SET inviteCode = ? WHERE id = ?').run(inviteCode, roomId)
    }

    // ─── Messages ─────────────────────────────────────────────

    getMessages(roomId: string, limit = 500): ChatMessage[] {
        const rows = this.db.prepare(
            'SELECT id, roomId, senderId, senderName, content, timestamp FROM messages WHERE roomId = ? ORDER BY timestamp DESC LIMIT ?'
        ).all(roomId, limit) as any[]
        return rows.reverse() // return in chronological order
    }

    addMessage(msg: ChatMessage): void {
        this.db.prepare(
            'INSERT INTO messages (id, roomId, senderId, senderName, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(msg.id, msg.roomId, msg.senderId, msg.senderName, msg.content, msg.timestamp)
    }

    pruneMessages(roomId: string, keep = 500): void {
        const count = (this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE roomId = ?').get(roomId) as any).c
        if (count > keep) {
            const cutoff = this.db.prepare(
                'SELECT timestamp FROM messages WHERE roomId = ? ORDER BY timestamp DESC LIMIT 1 OFFSET ?'
            ).get(roomId, keep - 1) as any
            if (cutoff) {
                this.db.prepare('DELETE FROM messages WHERE roomId = ? AND timestamp < ?').run(roomId, cutoff.timestamp)
            }
        }
    }

    // ─── Room Agents ──────────────────────────────────────────

    getRoomAgents(roomId: string): RoomAgent[] {
        return this.db.prepare(
            'SELECT id, roomId, agentId, profile, name, description, invited FROM room_agents WHERE roomId = ?'
        ).all(roomId) as unknown as RoomAgent[]
    }

    addRoomAgent(roomId: string, agentId: string, profile: string, name: string, description: string, invited: number): RoomAgent {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        this.db.prepare(
            'INSERT INTO room_agents (id, roomId, agentId, profile, name, description, invited) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(id, roomId, agentId, profile, name, description, invited)
        return { id, roomId, agentId, profile, name, description, invited }
    }

    removeRoomAgent(agentId: string): void {
        this.db.prepare('DELETE FROM room_agents WHERE id = ?').run(agentId)
    }

    close(): void {
        this.db.close()
    }
}

// ─── ChatRoom (in-memory, for online members) ─────────────────

class ChatRoom {
    readonly id: string
    name: string
    readonly members = new Map<string, Member>()

    constructor(id: string, name?: string) {
        this.id = id
        this.name = name || id
    }

    addMember(id: string, name: string): Member {
        const member: Member = { id, name, joinedAt: Date.now() }
        this.members.set(id, member)
        return member
    }

    removeMember(id: string): Member | undefined {
        const member = this.members.get(id)
        this.members.delete(id)
        return member
    }

    getMembersList(): Member[] {
        return Array.from(this.members.values())
    }

    hasMember(id: string): boolean {
        return this.members.has(id)
    }
}

// ─── GroupChat Server ────────────────────────────────────────

export class GroupChatServer {
    private io: Server
    private storage: ChatStorage
    private rooms = new Map<string, ChatRoom>()
    private userNames = new Map<string, string>()
    readonly agentClients = new AgentClients()
    private gatewayManager: any = null

    setGatewayManager(manager: any): void {
        this.gatewayManager = manager
        this.agentClients.setGatewayManager(manager)
    }

    constructor(httpServer: HttpServer) {
        const dbPath = join(config.dataDir, 'webui.db')
        mkdirSync(config.dataDir, { recursive: true })
        this.storage = new ChatStorage(dbPath)

        this.io = new Server(httpServer, {
            path: '/api/hermes/group-chat',
            cors: { origin: '*', methods: ['GET', 'POST'] },
        })
        this.io.use(this.authMiddleware.bind(this))
        this.io.on('connection', this.onConnection.bind(this))

        // Restore persisted rooms into memory
        this.storage.getAllRooms().forEach((row) => {
            this.rooms.set(row.id, new ChatRoom(row.id, row.name))
        })

        console.log('[GroupChat] Socket.IO ready at /group-chat')

        // Restore agent connections from SQLite
        this.restoreAgents()
    }

    getIO(): Server {
        return this.io
    }

    getStorage(): ChatStorage {
        return this.storage
    }

    getRoomIds(): string[] {
        return Array.from(this.rooms.keys())
    }

    // ─── Restore Agents ─────────────────────────────────────────

    private async restoreAgents(): Promise<void> {
        const rooms = this.storage.getAllRooms()
        let total = 0

        for (const room of rooms) {
            const agents = this.storage.getRoomAgents(room.id)
            for (const agent of agents) {
                try {
                    const client = await this.agentClients.createAgent({
                        profile: agent.profile,
                        name: agent.name,
                        description: agent.description,
                        invited: agent.invited,
                    })
                    await this.agentClients.addAgentToRoom(room.id, client)
                    total++
                } catch (err: any) {
                    console.error(`[GroupChat] Failed to restore agent ${agent.name} in room ${room.id}: ${err.message}`)
                }
            }
        }

        if (total > 0) {
            console.log(`[GroupChat] Restored ${total} agent(s) across ${rooms.length} room(s)`)
        }
    }

    // ─── Auth ───────────────────────────────────────────────────

    private async authMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
        const authToken = await getToken()
        if (authToken) {
            const token = socket.handshake.auth.token || socket.handshake.query.token || ''
            if (token !== authToken) {
                return next(new Error('Unauthorized'))
            }
        }
        next()
    }

    // ─── Connection ─────────────────────────────────────────────

    private onConnection(socket: Socket): void {
        const userId = socket.id
        const userName = (socket.handshake.auth.name as string) || `User-${userId.slice(0, 6)}`
        this.userNames.set(userId, userName)

        console.log(`[GroupChat] Connected: ${userName} (${userId})`)

        socket.on('join', (data: { roomId?: string; name?: string }, ack) => this.handleJoin(socket, data, ack))
        socket.on('message', (data: { roomId?: string; content: string }, ack) => this.handleMessage(socket, data, ack))
        socket.on('typing', (data: { roomId?: string }) => this.handleTyping(socket, data))
        socket.on('stop_typing', (data: { roomId?: string }) => this.handleStopTyping(socket, data))
        socket.on('disconnect', () => this.handleDisconnect(socket))
    }

    // ─── Handlers ───────────────────────────────────────────────

    private handleJoin(socket: Socket, data: { roomId?: string; name?: string }, ack?: (res: any) => void): void {
        const userId = socket.id
        if (data.name) this.userNames.set(userId, data.name)
        const userName = this.userNames.get(userId)!

        const roomId = data.roomId || 'general'
        let room = this.rooms.get(roomId)
        if (!room) {
            room = new ChatRoom(roomId)
            this.rooms.set(roomId, room)
            this.storage.saveRoom(roomId, roomId)
        }

        room.addMember(userId, userName)
        socket.join(roomId)

        socket.to(roomId).emit('member_joined', {
            roomId,
            memberId: userId,
            memberName: userName,
            members: room.getMembersList(),
        })

        // Load history from SQLite
        const messages = this.storage.getMessages(roomId)

        ack?.({
            roomId,
            roomName: room.name,
            members: room.getMembersList(),
            messages,
            rooms: this.getRoomIds(),
        })

        console.log(`[GroupChat] ${userName} joined room: ${roomId}`)
    }

    private handleMessage(socket: Socket, data: { roomId?: string; content: string }, ack?: (res: any) => void): void {
        const userId = socket.id
        const roomId = data.roomId || 'general'
        const room = this.rooms.get(roomId)

        if (!room || !room.hasMember(userId)) {
            ack?.({ error: 'Not in room' })
            return
        }

        const msg: ChatMessage = {
            id: this.generateId(),
            roomId,
            senderId: userId,
            senderName: this.userNames.get(userId)!,
            content: data.content,
            timestamp: Date.now(),
        }

        this.storage.addMessage(msg)
        this.storage.pruneMessages(roomId)
        this.io.to(roomId).emit('message', msg)
        ack?.({ id: msg.id })
    }

    private handleTyping(socket: Socket, data: { roomId?: string }): void {
        const roomId = data.roomId || 'general'
        socket.to(roomId).emit('typing', {
            roomId,
            userId: socket.id,
            userName: this.userNames.get(socket.id),
        })
    }

    private handleStopTyping(socket: Socket, data: { roomId?: string }): void {
        const roomId = data.roomId || 'general'
        socket.to(roomId).emit('stop_typing', {
            roomId,
            userId: socket.id,
            userName: this.userNames.get(socket.id),
        })
    }

    private handleDisconnect(socket: Socket): void {
        const userId = socket.id
        const userName = this.userNames.get(userId)

        console.log(`[GroupChat] Disconnected: ${userName} (${userId})`)

        this.leaveAllRooms(socket, userId, userName || userId)
        this.userNames.delete(userId)
    }

    // ─── Helpers ────────────────────────────────────────────────

    private leaveAllRooms(socket: Socket, userId: string, userName: string): void {
        this.rooms.forEach((room, rid) => {
            if (room.hasMember(userId)) {
                room.removeMember(userId)
                socket.leave(rid)
                this.io.to(rid).emit('member_left', {
                    roomId: rid,
                    memberId: userId,
                    memberName: userName,
                    members: room.getMembersList(),
                })
            }
        })
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    }
}
