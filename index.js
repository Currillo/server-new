require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Modules
const { handleMatchmaking, getRoomBySocketId, cleanupUser } = require('./socket/matchmaking');
const { CARDS } = require('./gameData');

// --- In-Memory Database ---
const USERS = {}; // id -> UserProfile
const CLANS = {}; // id -> Clan object

// Initialize
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Mock API Routes for Client Compatibility ---

// 1. Auth / Register
app.post('/api/auth/register', (req, res) => {
    const { username } = req.body;
    const id = uuidv4();
    
    // Default starter deck & cards
    const starterCards = Object.keys(CARDS).map(key => ({
        id: key, 
        level: 1, 
        count: 0 
    }));
    
    const newUser = {
        _id: id,
        id: id,
        username: username || `Guest_${id.substr(0,4)}`,
        name: username || `Guest_${id.substr(0,4)}`, // Sync name/username
        gold: 1000,
        gems: 100,
        level: 1,
        xp: 0,
        trophies: 0,
        clanId: null,
        ownedCards: starterCards,
        currentDeck: ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'mini_pekka', 'baby_dragon', 'prince']
    };

    USERS[id] = newUser;

    res.json({
        token: id, 
        profile: newUser
    });
});

// 2. Login
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

// 3. Get Profile (Protected)
app.get('/api/auth/profile', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = USERS[token];
    if (user) {
        res.json(user);
    } else {
        res.status(401).json({ message: "Invalid Token" });
    }
});

// 4. Update Deck
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

// 5. Mock Shop/Upgrade Endpoints
app.post('/api/player/upgrade', (req, res) => res.json({ success: false, message: "Not implemented in simple server" }));
app.post('/api/player/shop/buy', (req, res) => res.json({ success: false, message: "Not implemented in simple server" }));


// --- Socket.IO Setup ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000
});

// Auth Middleware: expects token in handshake
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    const user = USERS[token];
    if (user) {
        socket.user = user;
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

io.on('connection', (socket) => {
    console.log(`✅ Conectado: ${socket.user.username}`);

    // --- Clan Logic ---

    // Join Clan Room on connect if user has clan
    if (socket.user.clanId && CLANS[socket.user.clanId]) {
        socket.join(socket.user.clanId);
        // Send initial clan data
        socket.emit('clan_data', CLANS[socket.user.clanId]);
    }

    socket.on('get_clans', () => {
        // Return list of available clans (simplified search)
        const clanList = Object.values(CLANS).map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            memberCount: c.members.length
        }));
        socket.emit('clan_list', clanList);
    });

    socket.on('create_clan', ({ name, description }) => {
        if (socket.user.clanId) return; // Already in clan
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
        USERS[socket.user.id].clanId = clanId; // Persist

        socket.join(clanId);
        socket.emit('clan_joined', newClan);
        io.emit('clan_list_update'); // Notify others of new clan
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
        
        // Notify clan
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
        // Keep history limited to 50
        if (CLANS[clanId].messages.length > 50) CLANS[clanId].messages.shift();

        io.to(clanId).emit('clan_message', msg);
    });

    socket.on('react_message', ({ messageId, emoji }) => {
        const clanId = socket.user.clanId;
        if (!clanId || !CLANS[clanId]) return;

        const msg = CLANS[clanId].messages.find(m => m.id === messageId);
        if (msg) {
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
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Desconectado: ${socket.user.username}`);
        cleanupUser(socket.id);
    });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Mode: In-Memory (No Database)`);
});
