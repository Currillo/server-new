const GameRoom = require('./gameRoom');
const { v4: uuidv4 } = require('uuid');

let queue = [];
const rooms = {};

// Matchmaking Logic
const handleMatchmaking = (io, socket, user) => {
    // 1. Check if already in queue
    if (queue.find(u => u.id === user.id)) return;

    // 2. Add to queue
    const queueItem = { ...user, socketId: socket.id };
    queue.push(queueItem);
    console.log(`[Matchmaking] User ${user.username} joined queue. Size: ${queue.length}`);

    // 3. Try to match
    if (queue.length >= 2) {
        const p1 = queue.shift();
        const p2 = queue.shift();

        const roomId = uuidv4();
        
        // Join sockets to room
        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = io.sockets.sockets.get(p2.socketId);

        if (s1 && s2) {
            s1.join(roomId);
            s2.join(roomId);
            
            // Create Room
            const room = new GameRoom(roomId, p1, p2, io);
            rooms[roomId] = room;
            room.start();
        } else {
            // Handle disconnect race condition
            if (s1) queue.unshift(p1);
            if (s2) queue.unshift(p2);
        }
    }
};

const getRoomBySocketId = (socketId) => {
    return Object.values(rooms).find(r => 
        Object.keys(r.players).some(id => r.players[id].socketId === socketId || r.players[id].id === socket.user?.id) // Check both mapped ID and socket ID
    );
};

const cleanupUser = (socketId) => {
    // Remove from queue
    queue = queue.filter(u => u.socketId !== socketId);
    
    // Check active rooms
    const room = Object.values(rooms).find(r => 
        Object.values(r.players).some(p => p.socketId === socketId)
    );

    if (room && !room.gameState.gameOver) {
        const disconnectedPlayerId = Object.keys(room.players).find(pid => room.players[pid].socketId === socketId);
        if (disconnectedPlayerId) {
             const winnerId = Object.keys(room.players).find(pid => pid !== disconnectedPlayerId);
             room.endGame(winnerId);
             // Cleanup room ref after delay
             setTimeout(() => {
                 delete rooms[room.roomId];
             }, 5000);
        }
    }
};

module.exports = { handleMatchmaking, getRoomBySocketId, cleanupUser };