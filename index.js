
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Modules
const { handleMatchmaking, getRoomByUserId, cleanupUser } = require('./socket/matchmaking');
const GameRoom = require('./socket/gameRoom'); // Import directly for friendly battles
const { CARDS, UPGRADE_COSTS, CARDS_REQUIRED, CHEST_DATA } = require('./gameData');

// --- In-Memory Database ---
const USERS = {}; // id -> UserProfile
const CLANS = {}; // id -> Clan object
const ROOMS = {}; // roomId -> GameRoom (Friendly battles stored here, matchmaking has its own)

// Initialize
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Helper: Activity Logger ---
const logUserActivity = (userId, action, detail) => {
    const user = USERS[userId];
    if (user) {
        if (!user.logs) user.logs = [];
        user.logs.unshift({
            timestamp: Date.now(),
            action,
            detail
        });
        // Keep logs manageable
        if (user.logs.length > 50) user.logs.pop();
    }
};

// --- Economy Helpers ---

const grantChest = (user) => {
    if (user.chests.length >= 4) return false;
    
    // Simple logic: 70% Silver, 30% Gold, 5% Magical
    const rand = Math.random();
    let type = 'SILVER';
    if (rand > 0.95) type = 'MAGICAL';
    else if (rand > 0.7) type = 'GOLD';

    const chest = {
        id: uuidv4(),
        type,
        status: 'LOCKED',
        unlockFinishTime: null
    };
    user.chests.push(chest);
    logUserActivity(user.id, 'CHEST_EARNED', `Type: ${type}`);
    return true;
};

// --- Mock API Routes ---

app.post('/api/auth/register', (req, res) => {
    const { username } = req.body;
    const id = uuidv4();
    
    // Default Starter Cards
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
        chests: [],
        isBanned: false,
        banExpires: null,
        isAdmin: false,
        logs: [],
        description: "Ready for battle!",
        bannerId: "bg-gradient-to-r from-blue-600 to-blue-400",
        badges: []
    };

    USERS[id] = newUser;
    logUserActivity(id, 'REGISTER', 'Account Created');

    res.json({
        token: id, 
        profile: newUser
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username } = req.body;
    const user = Object.values(USERS).find(u => u.username === username || u.name === username);
    
    if (user) {
        if (user.isBanned) {
            if (user.banExpires && Date.now() < user.banExpires) {
                const remaining = Math.ceil((user.banExpires - Date.now()) / 60000);
                return res.status(403).json({ message: `Account banned for ${remaining} minutes.` });
            } else if (!user.banExpires) {
                return res.status(403).json({ message: "Account is permanently banned." });
            }
            // Ban expired
            user.isBanned = false;
            user.banExpires = null;
        }
        logUserActivity(user.id, 'LOGIN', 'User Logged In');
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
        if (user.isBanned) return res.status(403).json({ message: "Account Banned" });
        res.json(user);
    } else {
        res.status(401).json({ message: "Invalid Token" });
    }
});

app.put('/api/auth/updateProfile', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { name, description, bannerId, badges } = req.body;

    if (user) {
        // Name Logic
        if (name && name !== user.name) {
            const exists = Object.values(USERS).find(u => (u.username === name || u.name === name) && u.id !== user.id);
            if (exists) return res.status(400).json({ message: "Name already taken" });
            user.name = name;
            user.username = name;
        }
        
        if (description !== undefined) user.description = description;
        if (bannerId !== undefined) user.bannerId = bannerId;
        if (badges !== undefined) user.badges = badges;

        logUserActivity(user.id, 'UPDATE_PROFILE', 'Edited Profile');
        res.json({ success: true, profile: user });
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
        logUserActivity(user.id, 'DECK_UPDATE', 'Deck Modified');
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
        logUserActivity(user.id, 'LEVEL_UP', `Reached Level ${user.level}`);
    }

    logUserActivity(user.id, 'UPGRADE', `Upgraded ${cardId} to Lv.${card.level}`);
    res.json({ success: true, profile: user });
});

// Chest Logic: Start Unlock
app.post('/api/player/chest/unlock', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { chestId } = req.body;
    
    if (!user) return res.status(401).send();
    
    const chest = user.chests.find(c => c.id === chestId);
    if (!chest) return res.status(404).json({ message: "Chest not found" });
    if (chest.status !== 'LOCKED') return res.status(400).json({ message: "Chest busy or ready" });

    // Check if another is unlocking
    const unlocking = user.chests.find(c => c.status === 'UNLOCKING');
    if (unlocking) return res.status(400).json({ message: "Another chest is unlocking" });

    // For Demo: Use 10 seconds instead of hours
    // const duration = (CHEST_DATA[chest.type]?.unlockSeconds || 10800) * 1000;
    const duration = 10000; // 10 seconds fixed for testing

    chest.status = 'UNLOCKING';
    chest.unlockFinishTime = Date.now() + duration;
    
    logUserActivity(user.id, 'CHEST_UNLOCK', `Started unlock for ${chest.type}`);
    res.json({ success: true, profile: user });
});

// Chest Logic: Open
app.post('/api/player/chest/open', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    const { chestId } = req.body;
    
    if (!user) return res.status(401).send();
    
    const idx = user.chests.findIndex(c => c.id === chestId);
    if (idx === -1) return res.status(404).json({ message: "Chest not found" });

    const chest = user.chests[idx];
    
    // Check timing if it was unlocking
    if (chest.status === 'UNLOCKING') {
        if (Date.now() < chest.unlockFinishTime) {
            return res.status(400).json({ message: "Not ready yet" });
        }
    } else if (chest.status === 'LOCKED') {
        // Can't open locked chest without gems (feature not implemented)
        return res.status(400).json({ message: "Chest is locked" });
    }

    // Determine Rewards
    const data = CHEST_DATA[chest.type] || CHEST_DATA['SILVER'];
    const gold = Math.floor(Math.random() * (data.maxGold - data.minGold) + data.minGold);
    const cardCount = data.cards;
    
    const rewards = { gold, cards: [] };
    
    // Give Gold
    user.gold += gold;

    // Give Cards
    const allCardIds = Object.keys(CARDS).filter(id => !id.startsWith('tower_'));
    for(let i=0; i<cardCount; i++) {
        const randId = allCardIds[Math.floor(Math.random() * allCardIds.length)];
        
        if (!user.ownedCards[randId]) {
            user.ownedCards[randId] = { level: 1, count: 0 };
        }
        user.ownedCards[randId].count++;
        rewards.cards.push(randId);
    }

    // Remove chest
    user.chests.splice(idx, 1);
    
    logUserActivity(user.id, 'CHEST_OPEN', `Opened ${chest.type}, Gold: ${gold}`);
    res.json({ success: true, profile: user, rewards });
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
        if (user.isBanned) return next(new Error("Account Banned"));
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

    // --- FULL ADMIN PANEL LOGIC ---
    // Fix: Default payload to empty object if undefined to prevent crashes accessing payload.userId
    socket.on('admin_action', ({ action, payload = {} }) => {
        const adminId = socket.user.id;
        
        // Log the command
        console.log(`[Admin] Action: ${action} from ${socket.user.username}`);

        // Safely determine target user
        let targetUser = USERS[adminId]; // Default to self
        if (payload.userId) {
            targetUser = USERS[payload.userId];
            if (!targetUser) {
                console.log(`[Admin] Target User Not Found: ${payload.userId}`);
            }
        }
        
        let room = getRoomByUserId(adminId);
        if (!room && targetUser) {
            // Check if looking for room of target user
            room = getRoomByUserId(targetUser.id) || Object.values(ROOMS).find(r => Object.keys(r.players).includes(targetUser.id));
        }

        switch(action) {
            case 'CLAIM_ADMIN':
                USERS[adminId].isAdmin = true;
                socket.emit('profile_update', USERS[adminId]);
                socket.emit('admin_data', { type: 'LOG', payload: `Admin status claimed by ${socket.user.username}` });
                break;

            case 'GET_STATS':
                const userList = Object.values(USERS).map(u => ({
                    id: u.id,
                    username: u.username,
                    isBanned: u.isBanned,
                    trophies: u.trophies,
                    gold: u.gold,
                    level: u.level,
                    isAdmin: u.isAdmin,
                    inMatch: !!(getRoomByUserId(u.id))
                }));
                const stats = {
                    uptime: process.uptime(),
                    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
                };
                socket.emit('admin_data', { type: 'USERS_LIST', payload: userList });
                socket.emit('admin_data', { type: 'SERVER_STATS', payload: stats });
                break;

            case 'GET_PLAYER_DETAILS':
                if (targetUser) {
                    // Combine profile with live stats if in match
                    let liveStats = null;
                    if (room) {
                        liveStats = room.getLiveStats(targetUser.id);
                    }
                    socket.emit('admin_data', { 
                        type: 'PLAYER_DETAILS', 
                        payload: { ...targetUser, liveStats } 
                    });
                }
                break;

            case 'BAN_USER':
                if (targetUser) {
                    targetUser.isBanned = true;
                    // Duration in minutes, defaults to permanent (null)
                    targetUser.banExpires = payload.duration ? Date.now() + (payload.duration * 60000) : null;
                    
                    logUserActivity(targetUser.id, 'BANNED', `By Admin ${socket.user.username} for ${payload.duration || 'forever'}m`);

                    // Force disconnect
                    if (targetUser.socketId) {
                        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
                        if (targetSocket) {
                            targetSocket.emit('force_logout');
                            targetSocket.disconnect(true);
                        }
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Banned user ${targetUser.username}` });
                }
                break;

            case 'KICK_USER':
                if (targetUser && targetUser.socketId) {
                    logUserActivity(targetUser.id, 'KICKED', `By Admin ${socket.user.username}`);
                    const targetSocket = io.sockets.sockets.get(targetUser.socketId);
                    if (targetSocket) {
                        targetSocket.emit('force_logout');
                        targetSocket.disconnect(true);
                        socket.emit('admin_data', { type: 'LOG', payload: `Kicked user ${targetUser.username}` });
                    }
                }
                break;

            case 'DELETE_USER':
                if (targetUser) {
                    const tId = targetUser.id;
                    // Kick first
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) {
                            ts.emit('force_logout');
                            ts.disconnect(true);
                        }
                    }
                    // Clean references
                    cleanupUser(tId, targetUser.socketId);
                    // Remove
                    delete USERS[tId];
                    socket.emit('admin_data', { type: 'LOG', payload: `Deleted user ${targetUser.username}` });
                    // Refresh list
                    socket.emit('admin_action', { action: 'GET_STATS' });
                }
                break;

            case 'RESET_USER':
                if (targetUser) {
                    targetUser.gold = 1000;
                    targetUser.gems = 100;
                    targetUser.trophies = 0;
                    targetUser.level = 1;
                    targetUser.xp = 0;
                    targetUser.ownedCards = {};
                    targetUser.chests = [];
                    const starterCardIds = ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'mini_pekka', 'baby_dragon', 'prince'];
                    starterCardIds.forEach(id => targetUser.ownedCards[id] = { level: 1, count: 0 });
                    targetUser.currentDeck = [...starterCardIds];
                    
                    logUserActivity(targetUser.id, 'RESET', `By Admin ${socket.user.username}`);

                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Reset user ${targetUser.username}` });
                }
                break;

            case 'GIVE_RESOURCES':
                if (targetUser) {
                    targetUser.gold = (targetUser.gold || 0) + (payload.gold || 0);
                    targetUser.gems = (targetUser.gems || 0) + (payload.gems || 0);
                    logUserActivity(targetUser.id, 'GIFT', `Gold: ${payload.gold}, Gems: ${payload.gems}`);
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Gave resources to ${targetUser.username}` });
                }
                break;
            
            case 'SET_RESOURCES':
                if (targetUser) {
                    if (payload.gold !== undefined) targetUser.gold = payload.gold;
                    if (payload.gems !== undefined) targetUser.gems = payload.gems;
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Set resources for ${targetUser.username}` });
                }
                break;

            case 'GIVE_CARD':
                if (targetUser && payload.cardId && payload.count) {
                    const cardId = payload.cardId;
                    const count = payload.count;
                    if (!targetUser.ownedCards[cardId]) {
                        targetUser.ownedCards[cardId] = { level: 1, count: 0 };
                    }
                    targetUser.ownedCards[cardId].count += count;
                    logUserActivity(targetUser.id, 'GIFT_CARD', `${count}x ${cardId}`);
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Gave ${count} x ${cardId} to ${targetUser.username}` });
                }
                break;

            case 'REMOVE_CARD':
                if (targetUser && payload.cardId && payload.count) {
                    const cardId = payload.cardId;
                    const count = payload.count;
                    if (targetUser.ownedCards[cardId]) {
                        targetUser.ownedCards[cardId].count = Math.max(0, targetUser.ownedCards[cardId].count - count);
                        logUserActivity(targetUser.id, 'REMOVE_CARD', `Removed ${count}x ${cardId}`);
                        if (targetUser.socketId) {
                            const ts = io.sockets.sockets.get(targetUser.socketId);
                            if (ts) ts.emit('profile_update', targetUser);
                        }
                        socket.emit('admin_data', { type: 'LOG', payload: `Removed ${count} x ${cardId} from ${targetUser.username}` });
                    }
                }
                break;

            case 'TRANSFER_CARD':
                if (targetUser && payload.receiverId && payload.cardId && payload.count) {
                    const receiverUser = USERS[payload.receiverId];
                    const cardId = payload.cardId;
                    const count = parseInt(payload.count);
                    
                    if (receiverUser && count > 0) {
                        // Check Sender balance (Sender is targetUser in this context since admin selected them)
                        if (!targetUser.ownedCards[cardId] || targetUser.ownedCards[cardId].count < count) {
                             socket.emit('admin_data', { type: 'LOG', payload: `Transfer failed: Sender ${targetUser.username} insufficient cards` });
                             return;
                        }
                        
                        // Deduct from Sender
                        targetUser.ownedCards[cardId].count -= count;
                        
                        // Add to Receiver
                        if (!receiverUser.ownedCards[cardId]) {
                            receiverUser.ownedCards[cardId] = { level: 1, count: 0 };
                        }
                        receiverUser.ownedCards[cardId].count += count;
                        
                        logUserActivity(targetUser.id, 'TRANSFER_SENT', `${count}x ${cardId} to ${receiverUser.username}`);
                        logUserActivity(receiverUser.id, 'TRANSFER_RECV', `${count}x ${cardId} from ${targetUser.username}`);
                        
                        // Update Sender
                        if (targetUser.socketId) {
                            const ts = io.sockets.sockets.get(targetUser.socketId);
                            if (ts) ts.emit('profile_update', targetUser);
                        }
                        // Update Receiver
                        if (receiverUser.socketId) {
                            const rs = io.sockets.sockets.get(receiverUser.socketId);
                            if (rs) rs.emit('profile_update', receiverUser);
                        }
                        
                        socket.emit('admin_data', { type: 'LOG', payload: `Transferred ${count} ${cardId} from ${targetUser.username} to ${receiverUser.username}` });
                    } else {
                        socket.emit('admin_data', { type: 'LOG', payload: `Transfer failed: Invalid receiver or count` });
                    }
                }
                break;

            case 'UNLOCK_ALL_CARDS':
                if (targetUser) {
                    Object.keys(CARDS).forEach(cardId => {
                        if (!cardId.startsWith('tower_')) {
                            // If card entry doesn't exist, create it. If it does, update it.
                            if (!targetUser.ownedCards[cardId]) {
                                targetUser.ownedCards[cardId] = { level: 14, count: 5000 };
                            } else {
                                targetUser.ownedCards[cardId].level = 14;
                                // Add 5000 if not already maxed out just to be safe, or just set it
                                targetUser.ownedCards[cardId].count = 5000;
                            }
                        }
                    });
                    targetUser.level = 14;
                    logUserActivity(targetUser.id, 'UNLOCK_ALL', 'Maxed out collection');
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Unlocked cards for ${targetUser.username}` });
                }
                break;

            case 'SET_LEVELS':
                if (targetUser && payload.level) {
                    const lvl = parseInt(payload.level);
                    Object.keys(targetUser.ownedCards).forEach(cardId => {
                        targetUser.ownedCards[cardId].level = lvl;
                    });
                    logUserActivity(targetUser.id, 'SET_LEVELS', `All cards set to Lv.${lvl}`);
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Set all cards to Lv.${lvl} for ${targetUser.username}` });
                }
                break;

            case 'CLONE_DECK':
                if (targetUser && payload.sourceId) {
                    const sourceUser = USERS[payload.sourceId];
                    if (sourceUser) {
                        targetUser.currentDeck = [...sourceUser.currentDeck];
                        logUserActivity(targetUser.id, 'CLONE_DECK', `From ${sourceUser.username}`);
                        if (targetUser.socketId) {
                            const ts = io.sockets.sockets.get(targetUser.socketId);
                            if (ts) ts.emit('profile_update', targetUser);
                        }
                        socket.emit('admin_data', { type: 'LOG', payload: `Cloned deck from ${sourceUser.username} to ${targetUser.username}` });
                    }
                }
                break;

            case 'TOGGLE_TEMP_ADMIN':
                if (targetUser) {
                    targetUser.isAdmin = !targetUser.isAdmin;
                    logUserActivity(targetUser.id, 'ADMIN_TOGGLE', `Status: ${targetUser.isAdmin}`);
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Toggled admin for ${targetUser.username}` });
                }
                break;

            case 'FORCE_UPDATE_INVENTORY':
                if (targetUser && targetUser.socketId) {
                    const ts = io.sockets.sockets.get(targetUser.socketId);
                    if (ts) ts.emit('profile_update', targetUser);
                    socket.emit('admin_data', { type: 'LOG', payload: `Forced update for ${targetUser.username}` });
                }
                break;

            case 'GIVE_CHEST':
                if (targetUser) {
                    if (targetUser.chests.length < 4) {
                        targetUser.chests.push({
                            id: uuidv4(),
                            type: payload.type || 'LEGENDARY',
                            status: 'LOCKED',
                            unlockFinishTime: null
                        });
                        logUserActivity(targetUser.id, 'GIFT_CHEST', `${payload.type}`);
                        if (targetUser.socketId) {
                            const ts = io.sockets.sockets.get(targetUser.socketId);
                            if (ts) ts.emit('profile_update', targetUser);
                        }
                        socket.emit('admin_data', { type: 'LOG', payload: `Gave chest to ${targetUser.username}` });
                    }
                }
                break;

            case 'INSTANT_OPEN_CHESTS':
                if (targetUser) {
                    targetUser.chests.forEach(c => {
                        if (c.status !== 'READY') {
                            c.status = 'UNLOCKING';
                            c.unlockFinishTime = Date.now(); // Ready now
                        }
                    });
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Instant opened chests for ${targetUser.username}` });
                }
                break;

            case 'FORCE_OPEN_CHEST':
                if (targetUser && payload.chestId) {
                    const chest = targetUser.chests.find(c => c.id === payload.chestId);
                    if (chest) {
                        chest.status = 'READY';
                        chest.unlockFinishTime = Date.now();
                        if (targetUser.socketId) {
                            const ts = io.sockets.sockets.get(targetUser.socketId);
                            if (ts) ts.emit('profile_update', targetUser);
                        }
                        socket.emit('admin_data', { type: 'LOG', payload: `Forced chest READY for ${targetUser.username}` });
                    }
                }
                break;

            case 'RESET_CHEST_TIMERS':
                if (targetUser) {
                    let count = 0;
                    targetUser.chests.forEach(c => {
                        if (c.status === 'UNLOCKING') {
                            c.status = 'LOCKED';
                            c.unlockFinishTime = null;
                            count++;
                        }
                    });
                    if (targetUser.socketId) {
                        const ts = io.sockets.sockets.get(targetUser.socketId);
                        if (ts) ts.emit('profile_update', targetUser);
                    }
                    socket.emit('admin_data', { type: 'LOG', payload: `Reset ${count} chest timers for ${targetUser.username}` });
                }
                break;

            // --- Gameplay Modifiers ---

            case 'TOGGLE_GOD_MODE':
                if (room) {
                    room.setGodMode(adminId, payload.enabled);
                    socket.emit('admin_data', { type: 'LOG', payload: `God Mode ${payload.enabled ? 'ON' : 'OFF'} for match` });
                }
                break;
            
            case 'TOGGLE_INVINCIBLE':
                if (room) {
                    room.setInvincibility(adminId, payload.enabled);
                    socket.emit('admin_data', { type: 'LOG', payload: `Invincibility ${payload.enabled ? 'ON' : 'OFF'} for match` });
                }
                break;

            case 'FREEZE_PLAYER':
                if (room && targetUser) {
                    room.setFrozen(targetUser.id, payload.enabled);
                    socket.emit('admin_data', { type: 'LOG', payload: `Freeze ${payload.enabled ? 'ON' : 'OFF'} for ${targetUser.username}` });
                }
                break;

            case 'SET_ELIXIR_RATE':
                if (room && targetUser) {
                    room.setElixirMultiplier(targetUser.id, payload.multiplier || 1.0);
                    socket.emit('admin_data', { type: 'LOG', payload: `Elixir Rate set to ${payload.multiplier}x for ${targetUser.username}` });
                }
                break;

            case 'TOGGLE_AI':
                if (room && targetUser) {
                    room.setAI(targetUser.id, payload.enabled);
                    socket.emit('admin_data', { type: 'LOG', payload: `AI Assistance ${payload.enabled ? 'ON' : 'OFF'} for ${targetUser.username}` });
                }
                break;

            case 'FORCE_WIN':
                if (room) {
                    room.endGame(adminId);
                    socket.emit('admin_data', { type: 'LOG', payload: `Forced Win` });
                }
                break;

            case 'FORCE_LOSE':
                if (room) {
                    const enemyId = Object.keys(room.players).find(pid => pid !== adminId);
                    room.endGame(enemyId);
                    socket.emit('admin_data', { type: 'LOG', payload: `Forced Loss` });
                }
                break;

            case 'DESTROY_TOWERS':
                if (room) {
                    const targetOwnerId = payload.team === 'PLAYER' ? adminId : Object.keys(room.players).find(pid => pid !== adminId);
                    if (targetOwnerId) {
                        room.destroyTowers(targetOwnerId);
                        socket.emit('admin_data', { type: 'LOG', payload: `Destroyed towers for ${payload.team}` });
                    }
                }
                break;

            case 'ADMIN_SPAWN':
                if (room) {
                    // Force spawn at center/bridge
                    const isP1 = room.player1Id === adminId;
                    const bridgeY = 32 / 2; 
                    const spawnY = isP1 ? bridgeY - 2 : bridgeY + 2;
                    // Bypass cost checks using the admin spawn logic inside gameRoom
                    // We call handleInput but with the bypass flag
                    room.handleInput(adminId, { cardId: payload.cardId, x: 9, y: spawnY }, true);
                    socket.emit('admin_data', { type: 'LOG', payload: `Spawned ${payload.cardId}` });
                }
                break;

            case 'BROADCAST':
                // Send to ALL connected sockets
                io.emit('admin_message', `(ADMIN): ${payload.msg}`);
                socket.emit('admin_data', { type: 'LOG', payload: `Broadcasted: ${payload.msg}` });
                break;

            case 'FORCE_END_ALL':
                const count = Object.keys(ROOMS).length;
                Object.values(ROOMS).forEach(r => r.endGame(null)); // Draw
                socket.emit('admin_data', { type: 'LOG', payload: `Ended ${count} active matches.` });
                break;
            
            case 'SEND_MESSAGE':
                if (targetUser && targetUser.socketId) {
                    logUserActivity(targetUser.id, 'MSG_RECEIVED', `From Admin: ${payload.message}`);
                    const ts = io.sockets.sockets.get(targetUser.socketId);
                    if (ts) {
                        ts.emit('admin_message', `(ADMIN): ${payload.message}`);
                        socket.emit('admin_data', { type: 'LOG', payload: `Sent message to ${targetUser.username}` });
                    }
                }
                break;

            case 'SPECTATE_MATCH':
                if (room) {
                    room.addSpectator(socket);
                    socket.emit('admin_data', { type: 'LOG', payload: `Spectating match ${room.roomId}` });
                }
                break;
        }
    });

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

        target.friendRequests.push({
            fromId: socket.user.id,
            fromName: socket.user.name
        });

        if (target.socketId) {
            const targetSocket = io.sockets.sockets.get(target.socketId);
            if (targetSocket) {
                targetSocket.emit('friend_request_received', { 
                    fromId: socket.user.id, 
                    fromName: socket.user.name 
                });
                targetSocket.emit('profile_update', target);
            }
        }
        socket.emit('success', `Request sent to ${target.name}`);
    });

    socket.on('accept_friend_request', ({ requesterId }) => {
        const user = USERS[socket.user.id];
        const requester = USERS[requesterId];

        user.friendRequests = user.friendRequests.filter(r => r.fromId !== requesterId);
        
        if (requester) {
            if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
            if (!requester.friends.includes(user.id)) requester.friends.push(user.id);

            socket.emit('profile_update', user);
            socket.emit('friend_added', { id: requester.id, name: requester.name, isOnline: !!requester.socketId });

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

        const roomId = uuidv4();
        // Create room without onMatchEnd callback (no rewards)
        const room = new GameRoom(roomId, p1, p2, io, () => {}); 
        room.isFriendly = true;
        ROOMS[roomId] = room; // Store in global ROOMS
        
        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = socket; 

        s1.join(roomId);
        s2.join(roomId);

        console.log(`⚔️ Friendly Battle Started: ${p1.name} vs ${p2.name} (Room: ${roomId})`);
        
        const startData = { 
            players: { 
                [p1.id]: { ...p1, team: 'PLAYER' }, 
                [p2.id]: { ...p2, team: 'ENEMY' } 
            },
            player1Id: p1.id,
            player2Id: p2.id,
            endTime: Date.now() + 180000,
            isFriendly: true
        };

        logUserActivity(p1.id, 'FRIENDLY_MATCH', `vs ${p2.username}`);
        logUserActivity(p2.id, 'FRIENDLY_MATCH', `vs ${p1.username}`);

        io.to(roomId).emit('game_start', startData);
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
        if (!name || name.trim().length < 3) {
             socket.emit('error', 'Clan name must be 3+ chars');
             return;
        }
        if (socket.user.clanId) {
            socket.emit('error', 'You are already in a clan');
            return;
        }
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
        if (USERS[socket.user.id]) USERS[socket.user.id].clanId = clanId;

        socket.join(clanId);
        socket.emit('clan_joined', newClan);
        socket.emit('success', `Clan '${name}' created!`);
        logUserActivity(socket.user.id, 'CREATE_CLAN', name);
        
        io.emit('clan_list', Object.values(CLANS).map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            memberCount: c.members.length
        })));
    });

    socket.on('join_clan', ({ clanId }) => {
        const clan = CLANS[clanId];
        if (!clan) return;
        if (socket.user.clanId) {
            socket.emit('error', 'You are already in a clan');
            return;
        } 

        clan.members.push(socket.user.id);
        socket.user.clanId = clanId;
        if (USERS[socket.user.id]) USERS[socket.user.id].clanId = clanId;

        socket.join(clanId);
        socket.emit('clan_joined', clan);
        socket.emit('success', 'Joined clan!');
        logUserActivity(socket.user.id, 'JOIN_CLAN', clan.name);
        
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
        
        io.emit('clan_list', Object.values(CLANS).map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            memberCount: c.members.length
        })));
    });

    socket.on('leave_clan', () => {
        const clanId = socket.user.clanId;
        if (!clanId || !CLANS[clanId]) return;

        const clan = CLANS[clanId];
        clan.members = clan.members.filter(id => id !== socket.user.id);
        
        socket.user.clanId = null;
        if (USERS[socket.user.id]) USERS[socket.user.id].clanId = null;
        
        socket.leave(clanId);
        socket.emit('clan_left');
        socket.emit('success', 'Left clan');
        logUserActivity(socket.user.id, 'LEAVE_CLAN', clan.name);

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
        
        io.emit('clan_list', Object.values(CLANS).map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            memberCount: c.members.length
        })));
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
        if (isFriendly || !winnerId) return;

        // WINNER LOGIC
        const winner = USERS[winnerId];
        if (winner) {
            const goldWon = Math.floor(Math.random() * 15) + 15;
            winner.gold += goldWon;
            winner.trophies += 30; 
            grantChest(winner);
            logUserActivity(winner.id, 'MATCH_WIN', `Gold: ${goldWon}`);

            const winnerSocket = io.sockets.sockets.get(winner.socketId);
            if (winnerSocket) {
                 winnerSocket.emit('profile_update', winner);
            }
        }

        // LOSER LOGIC
        const loserId = Object.keys(playersMap).find(pid => pid !== winnerId);
        const loser = USERS[loserId];
        if (loser) {
            const lostTrophies = 20;
            loser.trophies = Math.max(0, loser.trophies - lostTrophies);
            logUserActivity(loser.id, 'MATCH_LOSS', `-${lostTrophies} Trophies`);

            const loserSocket = io.sockets.sockets.get(loser.socketId);
            if (loserSocket) {
                loserSocket.emit('profile_update', loser);
            }
        }
    };

    socket.on('join_queue', () => {
        handleMatchmaking(io, socket, USERS[socket.user.id], onMatchEnd);
    });

    socket.on('game_input', (data) => {
        const userId = socket.user.id;
        
        let room = getRoomByUserId(userId);
        
        if (!room) {
             // Look in friendly rooms
             room = Object.values(ROOMS).find(r => Object.keys(r.players).includes(userId));
        }

        if (room) {
            room.handleInput(userId, data);
        } else {
            console.log(`[Server] Game Input Ignored: No room found for user ${userId}.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconectado: ${socket.user.username} (${socket.id})`);
        notifyFriendsStatus(socket.user.id, false);
        cleanupUser(socket.user.id, socket.id);
        
        Object.keys(ROOMS).forEach(roomId => {
            const r = ROOMS[roomId];
            if (r.players[socket.user.id]) {
                delete ROOMS[roomId];
            }
        });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Mode: In-Memory (No Database)`);
});
