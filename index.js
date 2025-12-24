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
const USERS = {}; // id -> { id, username, gold, gems, trophies, currentDeck, ownedCards }

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
        gold: 1000,
        gems: 100,
        level: 1,
        xp: 0,
        trophies: 0,
        ownedCards: starterCards,
        currentDeck: ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'mini_pekka', 'baby_dragon', 'prince']
    };

    USERS[id] = newUser;

    // Send token as just the ID for this simple server
    res.json({
        token: id, 
        profile: newUser
    });
});

// 2. Login
app.post('/api/auth/login', (req, res) => {
    // For this simple recreation, we just look up by username if provided, 
    // but the client usually registers guests.
    // If client sends a "token" in headers, we use that for session.
    res.status(401).json({ message: "Login not implemented in simple mode. Use register." });
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

// 5. Mock Shop/Upgrade Endpoints to prevent crashes
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
    console.log(`User connected: ${socket.user.username}`);

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
        cleanupUser(socket.id);
    });
});

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Mode: In-Memory (No Database)`);
});