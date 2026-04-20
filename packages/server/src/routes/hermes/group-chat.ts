import Router from '@koa/router'
import type { GroupChatServer } from '../../services/hermes/group-chat'

export const groupChatRoutes = new Router()

let chatServer: GroupChatServer | null = null

export function setGroupChatServer(server: GroupChatServer) {
    chatServer = server
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// Create room
groupChatRoutes.post('/api/hermes/group-chat/rooms', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const { name, inviteCode, agents } = ctx.request.body as {
        name?: string
        inviteCode?: string
        agents?: { profile: string; name?: string; description?: string; invited?: boolean }[]
    }
    if (!name || !inviteCode) {
        ctx.status = 400
        ctx.body = { error: 'name and inviteCode are required' }
        return
    }

    const roomId = generateId()
    const storage = chatServer.getStorage()
    storage.saveRoom(roomId, name, inviteCode)

    // Save agents to DB and auto-connect via Socket.IO
    const addedAgents = []
    for (const a of agents || []) {
        const agentId = generateId()
        const agent = storage.addRoomAgent(roomId, agentId, a.profile, a.name || a.profile, a.description || '', a.invited ? 1 : 0)
        addedAgents.push(agent)

        try {
            const client = await chatServer.agentClients.createAgent({
                profile: agent.profile,
                name: agent.name,
                description: agent.description,
                invited: agent.invited,
            })
            await chatServer.agentClients.addAgentToRoom(roomId, client)
        } catch (err: any) {
            console.error(`[GroupChat] Failed to connect agent ${a.profile} to room ${roomId}: ${err.message}`)
        }
    }

    const room = storage.getRoom(roomId)
    ctx.body = { room, agents: addedAgents }
})

// List rooms
groupChatRoutes.get('/api/hermes/group-chat/rooms', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const rooms = chatServer.getStorage().getAllRooms()
    ctx.body = { rooms }
})

// Get room by invite code
groupChatRoutes.get('/api/hermes/group-chat/rooms/join/:code', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const room = chatServer.getStorage().getRoomByInviteCode(ctx.params.code)
    if (!room) {
        ctx.status = 404
        ctx.body = { error: 'Room not found' }
        return
    }

    ctx.body = { room }
})

// Update room invite code
groupChatRoutes.put('/api/hermes/group-chat/rooms/:roomId/invite-code', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const { inviteCode } = ctx.request.body as { inviteCode?: string }
    if (!inviteCode) {
        ctx.status = 400
        ctx.body = { error: 'inviteCode is required' }
        return
    }

    chatServer.getStorage().updateRoomInviteCode(ctx.params.roomId, inviteCode)
    ctx.body = { success: true }
})

// Add agent to room
groupChatRoutes.post('/api/hermes/group-chat/rooms/:roomId/agents', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const { profile, name, description, invited } = ctx.request.body as { profile?: string; name?: string; description?: string; invited?: boolean }
    if (!profile) {
        ctx.status = 400
        ctx.body = { error: 'profile is required' }
        return
    }

    const agentId = generateId()
    const agent = chatServer.getStorage().addRoomAgent(ctx.params.roomId, agentId, profile, name || profile, description || '', invited ? 1 : 0)

    // Auto-connect agent via Socket.IO
    try {
        const client = await chatServer.agentClients.createAgent({
            profile: agent.profile,
            name: agent.name,
            description: agent.description,
            invited: agent.invited,
        })
        await chatServer.agentClients.addAgentToRoom(ctx.params.roomId, client)
    } catch (err: any) {
        console.error(`[GroupChat] Failed to connect agent ${profile} to room ${ctx.params.roomId}: ${err.message}`)
    }

    ctx.body = { agent }
})

// List agents in room
groupChatRoutes.get('/api/hermes/group-chat/rooms/:roomId/agents', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    const agents = chatServer.getStorage().getRoomAgents(ctx.params.roomId)
    ctx.body = { agents }
})

// Remove agent from room
groupChatRoutes.delete('/api/hermes/group-chat/rooms/:roomId/agents/:agentId', async (ctx) => {
    if (!chatServer) {
        ctx.status = 503
        ctx.body = { error: 'Group chat not initialized' }
        return
    }

    chatServer.getStorage().removeRoomAgent(ctx.params.agentId)
    chatServer.agentClients.removeAgentFromRoom(ctx.params.roomId, ctx.params.agentId)
    ctx.body = { success: true }
})
