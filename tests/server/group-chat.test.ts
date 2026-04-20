import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock auth so token check is skipped
vi.mock('../../packages/server/src/services/auth', () => ({
    getToken: vi.fn().mockResolvedValue(null),
}))

// Mock socket.io — we only test REST routes, not Socket.IO
vi.mock('socket.io', () => {
    const listeners: Record<string, any> = {}
    return {
        Server: vi.fn().mockImplementation(() => ({
            use: vi.fn(),
            on: vi.fn((event: string, fn: any) => { listeners[event] = fn }),
            to: vi.fn().mockReturnThis(),
            emit: vi.fn(),
        })),
    }
})

// Mock socket.io-client — agent connections are not tested here
vi.mock('socket.io-client', () => {
    const noopSocket = {
        connected: true,
        id: 'mock-agent-id',
        connect: vi.fn().mockReturnThis(),
        disconnect: vi.fn(),
        on: vi.fn().mockImplementation(function (this: any, event: string, fn: any) {
            if (event === 'connect') {
                setTimeout(() => fn(), 0)
            }
            return this
        }),
        emit: vi.fn().mockImplementation(function (this: any, event: string, data: any, ack?: any) {
            // Auto-call ack for 'join' and 'message' events
            if (ack && typeof ack === 'function') {
                if (event === 'join') {
                    ack({ roomId: data?.roomId || 'general', roomName: data?.roomId || 'general', members: [], messages: [], rooms: [] })
                } else if (event === 'message') {
                    ack({ id: 'mock-msg-id' })
                }
            }
        }),
        io: { on: vi.fn() },
    }
    return {
        io: vi.fn().mockReturnValue(noopSocket),
    }
})

const testDir = mkdtempSync(join(tmpdir(), 'hermes-test-'))
let testIndex = 0

describe('group-chat routes', () => {
    let setGroupChatServer: any
    let groupChatRoutes: any
    let storage: any

    beforeEach(async () => {
        vi.resetModules()

        // Each test gets its own config mock with a fresh data dir
        const dataDir = join(testDir, `run-${testIndex++}`)
        vi.doMock('../../packages/server/src/config', () => ({
            config: {
                port: 8648,
                upstream: 'http://127.0.0.1:8642',
                uploadDir: '/tmp/hermes-test-uploads',
                dataDir,
                corsOrigins: '*',
            },
        }))

        const mod = await import('../../packages/server/src/routes/hermes/group-chat')
        setGroupChatServer = mod.setGroupChatServer
        groupChatRoutes = mod.groupChatRoutes
    })

    afterEach(() => {
        if (storage) {
            storage.close()
            storage = null
        }
    })

    afterAll(() => {
        rmSync(testDir, { recursive: true, force: true })
    })

    async function createServer() {
        const { GroupChatServer } = await import('../../packages/server/src/services/hermes/group-chat')
        const httpServer = { listen: vi.fn(), on: vi.fn() } as any
        const server = new GroupChatServer(httpServer)
        setGroupChatServer(server)
        storage = server.getStorage()
        return { server, storage }
    }

    function findHandler(path: string, method: string) {
        const layer = groupChatRoutes.stack.find(
            (entry: any) => entry.path === path && entry.methods.includes(method)
        )
        return layer?.stack?.[0]
    }

    function makeCtx(body: any = {}, params: Record<string, string> = {}) {
        return { request: { body }, params, body: null, status: 200 }
    }

    describe('POST /api/hermes/group-chat/rooms', () => {
        it('creates a room with agents', async () => {
            const { storage: s } = await createServer()

            const handler = findHandler('/api/hermes/group-chat/rooms', 'POST')
            const ctx = makeCtx({
                name: 'Test Room',
                inviteCode: 'abc123',
                agents: [
                    { profile: 'claude', name: 'Claude', description: 'AI assistant', invited: true },
                    { profile: 'gpt' },
                ],
            })

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.room).toBeDefined()
            expect(ctx.body.room.name).toBe('Test Room')
            expect(ctx.body.room.inviteCode).toBe('abc123')
            expect(ctx.body.agents).toHaveLength(2)
            expect(ctx.body.agents[0].profile).toBe('claude')
            expect(ctx.body.agents[0].invited).toBe(1)
            expect(ctx.body.agents[1].name).toBe('gpt') // defaults to profile
            expect(ctx.body.agents[1].description).toBe('')
            expect(ctx.body.agents[1].invited).toBe(0)
        })

        it('rejects missing name', async () => {
            await createServer()

            const handler = findHandler('/api/hermes/group-chat/rooms', 'POST')
            const ctx = makeCtx({ inviteCode: 'abc' })

            await handler(ctx)

            expect(ctx.status).toBe(400)
            expect(ctx.body.error).toMatch(/name.*inviteCode/i)
        })

        it('rejects missing inviteCode', async () => {
            await createServer()

            const handler = findHandler('/api/hermes/group-chat/rooms', 'POST')
            const ctx = makeCtx({ name: 'Room' })

            await handler(ctx)

            expect(ctx.status).toBe(400)
        })
    })

    describe('GET /api/hermes/group-chat/rooms', () => {
        it('lists all rooms', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'code1')
            s.saveRoom('r2', 'Room 2', 'code2')

            const handler = findHandler('/api/hermes/group-chat/rooms', 'GET')
            const ctx = makeCtx()

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.rooms).toHaveLength(2)
        })
    })

    describe('GET /api/hermes/group-chat/rooms/join/:code', () => {
        it('finds room by invite code', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'mycode')

            const handler = findHandler('/api/hermes/group-chat/rooms/join/:code', 'GET')
            const ctx = makeCtx({}, { code: 'mycode' })

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.room.id).toBe('r1')
        })

        it('returns 404 for unknown code', async () => {
            await createServer()

            const handler = findHandler('/api/hermes/group-chat/rooms/join/:code', 'GET')
            const ctx = makeCtx({}, { code: 'nonexist' })

            await handler(ctx)

            expect(ctx.status).toBe(404)
        })
    })

    describe('POST /api/hermes/group-chat/rooms/:roomId/agents', () => {
        it('adds an agent to a room', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'code1')

            const handler = findHandler('/api/hermes/group-chat/rooms/:roomId/agents', 'POST')
            const ctx = makeCtx(
                { profile: 'claude', name: 'Claude', description: 'Helper', invited: true },
                { roomId: 'r1' }
            )

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.agent.profile).toBe('claude')
            expect(ctx.body.agent.invited).toBe(1)
            expect(ctx.body.agent.agentId).toBeDefined()
            expect(ctx.body.agent.agentId).toBeDefined()
        })

        it('rejects missing profile', async () => {
            await createServer()

            const handler = findHandler('/api/hermes/group-chat/rooms/:roomId/agents', 'POST')
            const ctx = makeCtx({ name: 'No Profile' }, { roomId: 'r1' })

            await handler(ctx)

            expect(ctx.status).toBe(400)
        })
    })

    describe('GET /api/hermes/group-chat/rooms/:roomId/agents', () => {
        it('lists agents in a room', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'code1')
            s.addRoomAgent('r1', 'a1', 'claude', 'Claude', 'desc', 0)
            s.addRoomAgent('r1', 'a2', 'gpt', 'GPT', 'desc', 1)

            const handler = findHandler('/api/hermes/group-chat/rooms/:roomId/agents', 'GET')
            const ctx = makeCtx({}, { roomId: 'r1' })

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.agents).toHaveLength(2)
        })
    })

    describe('DELETE /api/hermes/group-chat/rooms/:roomId/agents/:agentId', () => {
        it('removes an agent from a room', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'code1')
            const agent = s.addRoomAgent('r1', 'a1', 'claude', 'Claude', '', 0)

            const handler = findHandler('/api/hermes/group-chat/rooms/:roomId/agents/:agentId', 'DELETE')
            const ctx = makeCtx({}, { roomId: 'r1', agentId: agent.id })

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(ctx.body.success).toBe(true)
            expect(s.getRoomAgents('r1')).toHaveLength(0)
        })
    })

    describe('PUT /api/hermes/group-chat/rooms/:roomId/invite-code', () => {
        it('updates room invite code', async () => {
            const { storage: s } = await createServer()

            s.saveRoom('r1', 'Room 1', 'oldcode')

            const handler = findHandler('/api/hermes/group-chat/rooms/:roomId/invite-code', 'PUT')
            const ctx = makeCtx({ inviteCode: 'newcode' }, { roomId: 'r1' })

            await handler(ctx)

            expect(ctx.status).toBe(200)
            expect(s.getRoomByInviteCode('newcode')).toBeDefined()
            expect(s.getRoomByInviteCode('oldcode')).toBeUndefined()
        })
    })
})
