
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Modules
const { handleMatchmaking, getRoomByUserId, cleanupUser } = require('./socket/matchmaking');
const GameRoom = require('./socket/gameRoom'); // Import directly for friendly battles
const { CARDS, UPGRADE_COSTS, CARDS_REQUIRED } = require('./gameData');

// --- In-Memory Database ---
const USERS = {}; // id -> UserProfile
const CLANS = {}; // id -> Clan object
const ROOMS = {}; // roomId -> GameRoom (Friendly battles stored here, matchmaking has its own)

// Initialize
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Economy Helpers ---

const grantChest = (user) => {
    if (user.chests.length >= 4) return false;
    
    // Simple logic: 70% Silver, 30% Gold
    const isGold = Math.random() > 0.7;
    const chest = {
        id: uuidv4(),
        type: isGold ? 'GOLD' : 'SILVER',
        unlockTime: null,
        isReady: false
    };
    user.chests.push(chest);
    return true;
};

// --- Mock API Routes ---

app.post('/api/auth/register', (req, res) => {
    const { username } = req.body;
    const id = uuidv4();
    
    // Default Starter Cards
    // Initialize ALL cards to 0 count, level 1, but mark starter deck as owned
    // Actually simpler: just give starter cards with count 0
    const starterCardIds = ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'mini_pekka', 'baby_dragon', 'prince'];
    
    const ownedCards = {};
    Object.keys(CARDS).forEach(key => {
        const isStarter = starterCardIds.includes(key);
        ownedCards[key] = { level: 1, count: isStarter ? 0 : 0 };
    });

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
        ownedCards: ownedCards,
        currentDeck: [...starterCardIds],
        chests: []
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

app.post('/api/player/upgrade', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { cardId } = req.body;

    if (!user || !user.ownedCards[cardId]) return res.status(400).json({ message: "Invalid Request" });

    const card = user.ownedCards[cardId];
    if (card.level >= 16) return res.status(400).json({ message: "Max level reached" });

    const cost = UPGRADE_COSTS[card.level];
    const reqCards = CARDS_REQUIRED[card.level];

    if (user.gold < cost) return res.status(400).json({ message: "Not enough gold" });
    if (card.count < reqCards) return res.status(400).json({ message: "Not enough cards" });

    // Execute
    user.gold -= cost;
    card.count -= reqCards;
    card.level++;
    user.xp += 10 * card.level;

    // Simple Level Up Logic
    if (user.xp >= user.level * 500) {
        user.xp -= user.level * 500;
        user.level++;
    }

    res.json({ success: true, profile: user });
});

app.post('/api/player/chest/open', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { chestId } = req.body;
    
    if (!user) return res.status(401).send();
    
    const idx = user.chests.findIndex(c => c.id === chestId);
    if (idx === -1) return res.status(404).json({ message: "Chest not found" });

    // For demo: Instant open (no timer needed)
    const chest = user.chests[idx];
    user.chests.splice(idx, 1);

    const isGold = chest.type === 'GOLD';
    const goldReward = isGold ? 200 : 50;
    const cardsCount = isGold ? 20 : 5;
    
    // Rewards
    user.gold += goldReward;

    // Random Cards
    const allCardIds = Object.keys(CARDS).filter(id => !id.startsWith('tower_'));
    for(let i=0; i<cardsCount; i++) {
        const randId = allCardIds[Math.floor(Math.random() * allCardIds.length)];
        if (!user.ownedCards[randId]) {
            user.ownedCards[randId] = { level: 1, count: 0 };
        }
        user.ownedCards[randId].count++;
    }

    res.json({ success: true, profile: user, rewards: { gold: goldReward, cards: cardsCount } });
});


// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000
});

// Middleware to attach user
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const user = USERS[token];
    if (user) {
        socket.user = user;
        // Important: Update the socket ID on the master record immediately
        user.socketId = socket.id; 
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

io.on('connection', (socket) => {
    console.log(`✅ Conectado: ${socket.user.username} (${socket.id})`);
    
    // Update live socket mapping
    USERS[socket.user.id].socketId = socket.id;

    // Notify friends that user is online
    notifyFriendsStatus(socket.user.id, true);

    // --- Friends Logic ---

    socket.on('send_friend_request', ({ targetUsername }) => {
        console.log(`[FriendRequest] From: ${socket.user.username} To: ${targetUsername}`);
        
        const target = Object.values(USERS).find(u => u.username === targetUsername || u.name === targetUsername);
        
        if (!target) {
            console.log(`[FriendRequest] Failed: Target '${targetUsername}' not found.`);
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

        // 1. Add request to database
        target.friendRequests.push({
            fromId: socket.user.id,
            fromName: socket.user.name
        });
        console.log(`[FriendRequest] Added to DB for ${target.username}. Current Requests: ${target.friendRequests.length}`);

        // 2. Real-time Notification
        if (target.socketId) {
            // Check if socket is actually connected
            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('friend_request_received', { 
                    fromId: socket.user.id, 
                    fromName: socket.user.name 
                });
                // Force profile update to show badge
                targetSocket.emit('profile_update', target);
                console.log(`[FriendRequest] Notification SENT to socket ${target.socketId}`);
            } else {
                console.log(`[FriendRequest] Target socket ${target.socketId} not found in active sockets.`);
            }
        } else {
            console.log(`[FriendRequest] Target ${target.username} has no socketId (Offline).`);
        }

        socket.emit('success', `Request sent to ${target.name}`);
    });

    socket.on('accept_friend_request', ({ requesterId }) => {
        const user = USERS[socket.user.id];
        const requester = USERS[requesterId];

        console.log(`[FriendRequest] ${user.username} accepting ${requester ? requester.username : requesterId}`);

        // Remove request
        user.friendRequests = user.friendRequests.filter(r => r.fromId !== requesterId);
        
        if (requester) {
            // Add mutual friendship
            if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
            if (!requester.friends.includes(user.id)) requester.friends.push(user.id);

            // Notify User
            socket.emit('profile_update', user);
            socket.emit('friend_added', { id: requester.id, name: requester.name, isOnline: !!requester.socketId });

            // Notify Requester
            if (requester.socketId) {
                const reqSocket = io.sockets.sockets.get(requester.socketId);
                if (reqSocket) {
                    reqSocket.emit('profile_update', requester);
                    reqSocket.emit('friend_added', { id: user.id, name: user.name, isOnline: true });
                }
            }
        } else {
             socket.emit('profile_update', user); 
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
            const isOnline = friend.socketId && io.sockets.sockets.get(friend.socketId);
            return {
                id: friend.id,
                name: friend.name,
                isOnline: !!isOnline
            };
        }).filter(f => f);
        socket.emit('friends_status', friendsData);
    });

    // Explicit profile refresh for clients
    socket.on('refresh_profile', () => {
        socket.emit('profile_update', USERS[socket.user.id]);
    });

    // --- Friendly Battle Logic ---

    socket.on('invite_friendly_battle', ({ friendId }) => {
        const friend = USERS[friendId];
        if (!friend) return;
        
        const friendSocket = friend.socketId && io.sockets.sockets.get(friend.socketId);
        if (friendSocket) {
            friendSocket.emit('friendly_invite', {
                inviterId: socket.user.id,
                inviterName: socket.user.name
            });
            socket.emit('success', 'Invite sent');
        } else {
            socket.emit('error', 'Friend is offline');
        }
    });

    socket.on('accept_friendly_battle', ({ inviterId }) => {
        const p1 = USERS[inviterId]; // Inviter
        const p2 = USERS[socket.user.id]; // Acceptor

        if (!p1 || !p1.socketId || !io.sockets.sockets.get(p1.socketId)) {
            socket.emit('error', 'Inviter is no longer available');
            return;
        }

        // Create Friendly Room with dummy match end logic for Friendly
        const roomId = uuidv4();
        const room = new GameRoom(roomId, p1, p2, io, () => {}); // No reward callback
        room.isFriendly = true; // MARK AS FRIENDLY
        ROOMS[roomId] = room; // Store in friendly list
        
        // Join Sockets
        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = socket; 

        s1.join(roomId);
        s2.join(roomId);

        console.log(`⚔️ Friendly Battle Started: ${p1.name} vs ${p2.name} (Room: ${roomId})`);
        
        // Broadcast Start
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
         const invSocket = inviter?.socketId && io.sockets.sockets.get(inviter.socketId);
         if (invSocket) {
             invSocket.emit('error', `${socket.user.name} declined your invite.`);
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
    const onMatchEnd = (winnerId, playersMap, isFriendly) => {
        // Handle Economy (Chests + Gold)
        if (isFriendly || !winnerId) return;

        const winner = USERS[winnerId];
        if (!winner) return;

        // Gold Reward (Win = 15-30 Gold)
        const goldWon = Math.floor(Math.random() * 15) + 15;
        winner.gold += goldWon;
        winner.trophies = Math.max(0, winner.trophies + 30); // Ensure trophy sync

        // Chest Reward
        grantChest(winner);

        // Notify client to update profile immediately
        const winnerSocket = io.sockets.sockets.get(winner.socketId);
        if (winnerSocket) {
             winnerSocket.emit('profile_update', winner);
        }
    };

    socket.on('join_queue', () => {
        handleMatchmaking(io, socket, USERS[socket.user.id], onMatchEnd);
    });

    socket.on('game_input', (data) => {
        // Robust Room Lookup: Check matchmaking rooms first, then friendly rooms
        // We use User ID, not Socket ID, for stability
        const userId = socket.user.id;
        
        let room = getRoomByUserId(userId);
        
        if (!room) {
             // Check friendly rooms
             room = Object.values(ROOMS).find(r => Object.keys(r.players).includes(userId));
        }

        if (room) {
            room.handleInput(userId, data);
        } else {
            console.warn(`[GameInput] No room found for user ${userId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconectado: ${socket.user.username} (${socket.id})`);
        notifyFriendsStatus(socket.user.id, false);
        cleanupUser(socket.user.id, socket.id);
    });
});

function notifyFriendsStatus(userId, isOnline) {
    const user = USERS[userId];
    if (!user) return;
    
    user.friends.forEach(fid => {
        const friend = USERS[fid];
        if (friend && friend.socketId) {
            const friendSocket = io.sockets.sockets.get(friend.socketId);
            if(friendSocket) {
                friendSocket.emit('friend_status_update', { id: userId, isOnline });
            }
        }
    });
}

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Mode: In-Memory (No Database)`);
});
