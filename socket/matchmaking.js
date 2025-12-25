
const GameRoom = require('./gameRoom');
const { v4: uuidv4 } = require('uuid');

let queue = []; // Array of { id, username, socketId, ... }
const rooms = {}; // roomId -> GameRoom

// Matchmaking Logic
const handleMatchmaking = (io, socket, user, onMatchEnd) => {
    // 1. Remove from queue if already there (avoid duplicates)
    queue = queue.filter(u => u.id !== user.id);

    // 2. Add to queue
    const queueItem = { ...user, socketId: socket.id };
    queue.push(queueItem);
    console.log(`[Matchmaking] ${user.username} joined queue. Waiting: ${queue.length}`);

    // 3. Try to match
    if (queue.length >= 2) {
        // Pop two players
        const p1 = queue.shift();
        const p2 = queue.shift();

        // Verify they are still connected
        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = io.sockets.sockets.get(p2.socketId);

        if (s1 && s2) {
            const roomId = uuidv4();
            
            s1.join(roomId);
            s2.join(roomId);
            
            console.log(`⚔️ MATCH FOUND: ${p1.username} vs ${p2.username} (Room: ${roomId})`);

            // Create Room with callback for economy
            const room = new GameRoom(roomId, p1, p2, io, onMatchEnd);
            rooms[roomId] = room;
            room.start();
        } else {
            console.log(`[Matchmaking] Match failed (disconnect). Re-queueing active players.`);
            // Put active players back at the front
            if (s2) queue.unshift(p2);
            if (s1) queue.unshift(p1);
        }
    }
};

const getRoomByUserId = (userId) => {
    return Object.values(rooms).find(r => 
        Object.keys(r.players).includes(userId)
    );
};

const cleanupUser = (userId, socketId) => {
    // Remove from queue
    const queueIndex = queue.findIndex(u => u.id === userId);
    if (queueIndex !== -1) {
        queue.splice(queueIndex, 1);
        console.log(`[Matchmaking] User ${userId} removed from queue.`);
    }

    // Check active rooms
    // We find if the user is in a room AND if that user currently has the disconnected socketId
    // (Prevents killing a game if user reconnected on another socket, though in this simple app socketId dictates connection)
    const room = Object.values(rooms).find(r => 
        r.players[userId] && r.players[userId].socketId === socketId
    );

    if (room && !room.gameState.gameOver) {
        console.log(`[Matchmaking] User disconnected during match. Ending Room ${room.roomId}`);
        const winnerId = Object.keys(room.players).find(pid => pid !== userId);
        room.endGame(winnerId);
        
        // Remove room reference after a short delay
        setTimeout(() => {
            if (rooms[room.roomId]) {
                delete rooms[room.roomId];
                console.log(`[Matchmaking] Room ${room.roomId} cleaned up.`);
            }
        }, 5000);
    }
};

module.exports = { handleMatchmaking, getRoomByUserId, cleanupUser };
