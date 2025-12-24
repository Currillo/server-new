require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Modules
const { handleMatchmaking, getRoomBySocketId, cleanupUser } = require('./socket/matchmaking');
const GameRoom = require('./socket/gameRoom'); // Import directly for friendly battles
const { CARDS } = require('./gameData');

// --- In-Memory Database ---
const USERS = {}; // id -> UserProfile
const CLANS = {}; // id -> Clan object
const ROOMS = {}; // roomId -> GameRoom (Shared with matchmaking)

// Initialize
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Mock API Routes ---

app.post('/api/auth/register', (req, res) => {
    const { username } = req.body;
    const id = uuidv4();
    
    const starterCards = Object.keys(CARDS).map(key => ({
        id: key, 
        level: 1, 
        count: 0 
    }));
    
    const newUser = {
        _id: id,
        id: id,
        username: username || `Guest_${id.substr(0,4)}`,
        name: username || `Guest_${id.substr(0,4)}`,
        gold: 1000,
        gems: 100,
        level: 1,
        xp: 0,
        trophies: 0,
        clanId: null,
        friends: [],
        friendRequests: [],
        ownedCards: starterCards,
        currentDeck: ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'mini_pekka', 'baby_dragon', 'prince']
    };

    USERS[id] = newUser;

    res.json({
        token: id, 
        profile: newUser
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username } = req.body;
    const user = Object.values(USERS).find(u => u.username === username || u.name === username);
    
    if (user) {
        res.json({
            token: user.id,
            profile: user
        });
    } else {
        res.status(401).json({ message: "User not found. Please register." });
    }
});

app.get('/api/auth/profile', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    if (user) {
        res.json(user);
    } else {
        res.status(401).json({ message: "Invalid Token" });
    }
});

app.put('/api/auth/deck', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { deck } = req.body;

    if (user && deck && deck.length === 8) {
        user.currentDeck = deck;
        res.json({ success: true, currentDeck: deck });
    } else {
        res.status(400).json({ message: "Invalid request" });
    }
});

app.post('/api/player/upgrade', (req, res) => res.json({ success: false, message: "Not implemented in simple server" }));
app.post('/api/player/shop/buy', (req, res) => res.json({ success: false, message: "Not implemented in simple server" }));


// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const user = USERS[token];
    if (user) {
        socket.user = user;
        // Associate socket ID with user for direct messaging
        user.socketId = socket.id;
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

io.on('connection', (socket) => {
    console.log(`✅ Conectado: ${socket.user.username}`);
    USERS[socket.user.id].socketId = socket.id; // Ensure latest socket ID

    // Broadcast online status to friends
    notifyFriendsStatus(socket.user.id, true);

    // --- Friends Logic ---

    socket.on('send_friend_request', ({ targetUsername }) => {
        const target = Object.values(USERS).find(u => u.username === targetUsername || u.name === targetUsername);
        
        if (!target) {
            socket.emit('error', 'User not found');
            return;
        }
        if (target.id === socket.user.id) {
            socket.emit('error', 'Cannot add yourself');
            return;
        }
        if (socket.user.friends.includes(target.id)) {
            socket.emit('error', 'Already friends');
            return;
        }
        if (target.friendRequests.find(r => r.fromId === socket.user.id)) {
            socket.emit('error', 'Request already sent');
            return;
        }

        // Add request
        target.friendRequests.push({
            fromId: socket.user.id,
            fromName: socket.user.name
        });

        // Notify target if online
        if (target.socketId) {
            io.to(target.socketId).emit('friend_request_received', { 
                fromId: socket.user.id, 
                fromName: socket.user.name 
            });
            // Update their profile data view
            io.to(target.socketId).emit('profile_update', target);
        }

        socket.emit('success', `Request sent to ${target.name}`);
    });

    socket.on('accept_friend_request', ({ requesterId }) => {
        const user = USERS[socket.user.id];
        const requester = USERS[requesterId];

        // Remove request
        user.friendRequests = user.friendRequests.filter(r => r.fromId !== requesterId);
        
        if (requester) {
            // Add to friends lists
            if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
            if (!requester.friends.includes(user.id)) requester.friends.push(user.id);

            // Notify both
            socket.emit('profile_update', user);
            socket.emit('friend_added', { id: requester.id, name: requester.name, isOnline: !!requester.socketId });

            if (requester.socketId) {
                io.to(requester.socketId).emit('profile_update', requester);
                io.to(requester.socketId).emit('friend_added', { id: user.id, name: user.name, isOnline: true });
            }
        } else {
             socket.emit('profile_update', user); // Just update removal
        }
    });

    socket.on('decline_friend_request', ({ requesterId }) => {
        const user = USERS[socket.user.id];
        user.friendRequests = user.friendRequests.filter(r => r.fromId !== requesterId);
        socket.emit('profile_update', user);
    });

    socket.on('get_friends_status', () => {
        const friendsData = socket.user.friends.map(fid => {
            const friend = USERS[fid];
            if (!friend) return null;
            // Check if socket is active in io.sockets
            const isOnline = friend.socketId && io.sockets.sockets.get(friend.socketId);
            return {
                id: friend.id,
                name: friend.name,
                isOnline: !!isOnline
            };
        }).filter(f => f);
        socket.emit('friends_status', friendsData);
    });

    // --- Friendly Battle Logic ---

    socket.on('invite_friendly_battle', ({ friendId }) => {
        const friend = USERS[friendId];
        if (!friend) return;
        
        const friendSocket = friend.socketId && io.sockets.sockets.get(friend.socketId);
        if (friendSocket) {
            io.to(friend.socketId).emit('friendly_invite', {
                inviterId: socket.user.id,
                inviterName: socket.user.name
            });
            socket.emit('success', 'Invite sent');
        } else {
            socket.emit('error', 'Friend is offline');
        }
    });

    socket.on('accept_friendly_battle', ({ inviterId }) => {
        const p1 = USERS[inviterId];
        const p2 = socket.user;

        if (!p1 || !p1.socketId || !io.sockets.sockets.get(p1.socketId)) {
            socket.emit('error', 'Inviter is no longer available');
            return;
        }

        // Create Friendly Room
        const roomId = uuidv4();
        const room = new GameRoom(roomId, p1, p2, io);
        ROOMS[roomId] = room; // Store globally if needed for cleanup, though matchmaking handles its own
        
        // Join Sockets
        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = socket; // Current socket

        s1.join(roomId);
        s2.join(roomId);

        // Start Game with FRIENDLY flag
        // We override the start method or emit a specific payload
        console.log(`⚔️ Friendly Battle: ${p1.name} vs ${p2.name}`);
        
        io.to(roomId).emit('game_start', { 
            players: { 
                [p1.id]: { ...p1, team: 'PLAYER' }, 
                [p2.id]: { ...p2, team: 'ENEMY' } 
            },
            endTime: Date.now() + 180000,
            isFriendly: true
        });

        room.start();
    });

    socket.on('reject_friendly_battle', ({ inviterId }) => {
         const inviter = USERS[inviterId];
         if (inviter && inviter.socketId) {
             io.to(inviter.socketId).emit('error', `${socket.user.name} declined your invite.`);
         }
    });

    // --- Clan Logic ---

    if (socket.user.clanId && CLANS[socket.user.clanId]) {
        socket.join(socket.user.clanId);
    }

    socket.on('get_clans', () => {
        const clanList = Object.values(CLANS).map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            memberCount: c.members.length
        }));
        socket.emit('clan_list', clanList);
    });

    socket.on('get_clan_data', () => {
        const clanId = socket.user.clanId;
        if (clanId && CLANS[clanId]) {
            socket.join(clanId);
            socket.emit('clan_data', CLANS[clanId]);
        }
    });

    socket.on('create_clan', ({ name, description }) => {
        if (socket.user.clanId) return;
        if (Object.values(CLANS).find(c => c.name === name)) {
            socket.emit('error', 'Clan name taken');
            return;
        }

        const clanId = uuidv4();
        const newClan = {
            id: clanId,
            name,
            description,
            members: [socket.user.id],
            messages: []
        };

        CLANS[clanId] = newClan;
        socket.user.clanId = clanId;
        USERS[socket.user.id].clanId = clanId;

        socket.join(clanId);
        socket.emit('clan_joined', newClan);
        io.emit('clan_list_update');
    });

    socket.on('join_clan', ({ clanId }) => {
        const clan = CLANS[clanId];
        if (!clan) return;
        if (socket.user.clanId) return; 

        clan.members.push(socket.user.id);
        socket.user.clanId = clanId;
        USERS[socket.user.id].clanId = clanId;

        socket.join(clanId);
        socket.emit('clan_joined', clan);
        
        const sysMsg = {
            id: uuidv4(),
            senderId: 'SYSTEM',
            senderName: 'System',
            content: `${socket.user.username} joined the clan!`,
            timestamp: Date.now(),
            reactions: {}
        };
        clan.messages.push(sysMsg);
        io.to(clanId).emit('clan_message', sysMsg);
    });

    socket.on('leave_clan', () => {
        const clanId = socket.user.clanId;
        if (!clanId || !CLANS[clanId]) return;

        const clan = CLANS[clanId];
        clan.members = clan.members.filter(id => id !== socket.user.id);
        
        socket.user.clanId = null;
        USERS[socket.user.id].clanId = null;
        socket.leave(clanId);

        socket.emit('clan_left');

        if (clan.members.length === 0) {
            delete CLANS[clanId];
        } else {
             const sysMsg = {
                id: uuidv4(),
                senderId: 'SYSTEM',
                senderName: 'System',
                content: `${socket.user.username} left the clan.`,
                timestamp: Date.now(),
                reactions: {}
            };
            clan.messages.push(sysMsg);
            io.to(clanId).emit('clan_message', sysMsg);
        }
    });

    socket.on('send_clan_message', ({ content }) => {
        const clanId = socket.user.clanId;
        if (!clanId || !CLANS[clanId]) return;

        const msg = {
            id: uuidv4(),
            senderId: socket.user.id,
            senderName: socket.user.username,
            content,
            timestamp: Date.now(),
            reactions: {}
        };

        CLANS[clanId].messages.push(msg);
        if (CLANS[clanId].messages.length > 50) CLANS[clanId].messages.shift();

        io.to(clanId).emit('clan_message', msg);
    });

    socket.on('react_message', ({ messageId, emoji }) => {
        const clanId = socket.user.clanId;
        if (!clanId || !CLANS[clanId]) return;

        const msg = CLANS[clanId].messages.find(m => m.id === messageId);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (!msg.reactions[emoji]) msg.reactions[emoji] = 0;
            msg.reactions[emoji]++;
            io.to(clanId).emit('clan_reaction_update', { messageId, reactions: msg.reactions });
        }
    });

    // --- Gameplay ---
    socket.on('join_queue', () => {
        handleMatchmaking(io, socket, socket.user);
    });

    socket.on('game_input', (data) => {
        const room = getRoomBySocketId(socket.id);
        if (room) {
            room.handleInput(socket.user.id, data);
        } else {
             // Check if it's a friendly room in global ROOMS
             const friendlyRoom = Object.values(ROOMS).find(r => Object.keys(r.players).includes(socket.user.id));
             if (friendlyRoom) friendlyRoom.handleInput(socket.user.id, data);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconectado: ${socket.user.username}`);
        notifyFriendsStatus(socket.user.id, false);
        cleanupUser(socket.id);
    });
});

function notifyFriendsStatus(userId, isOnline) {
    const user = USERS[userId];
    if (!user) return;
    
    user.friends.forEach(fid => {
        const friend = USERS[fid];
        if (friend && friend.socketId) {
            io.to(friend.socketId).emit('friend_status_update', { id: userId, isOnline });
        }
    });
}

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Mode: In-Memory (No Database)`);
});
