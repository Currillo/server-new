
const { v4: uuidv4 } = require('uuid');
const { CARDS, ARENA_WIDTH, ARENA_HEIGHT } = require('../gameData');

const TICK_RATE = 30; // 30 FPS
const ELIXIR_RATE = 2.8;
const MAX_ELIXIR = 10;

class GameRoom {
  constructor(roomId, player1, player2, io, onMatchEnd) {
    this.roomId = roomId;
    this.io = io;
    this.onMatchEnd = onMatchEnd; // Callback for server-side economy updates
    
    // Players map: ID -> Data
    this.players = {
      [player1.id]: { ...player1, team: 'PLAYER' },
      [player2.id]: { ...player2, team: 'ENEMY' } 
    };

    // Store explicit references to who is who for orientation
    this.player1Id = player1.id; // Bottom Player
    this.player2Id = player2.id; // Top Player
    this.isFriendly = false; // Flag to determine if stats should update

    // P1 is "Bottom" (y=0..16 visually for them), P2 is "Top"
    // Server coordinates are absolute 0..32.
    // P1 Base at y=0, P2 Base at y=32.
    
    this.gameState = {
      time: 180, // 3 minutes
      gameOver: false,
      winner: null,
      elixir: { [player1.id]: 5, [player2.id]: 5 },
      entities: [],
      projectiles: []
    };

    this.spawnTowers(player1.id, 'BOTTOM');
    this.spawnTowers(player2.id, 'TOP');

    this.intervalId = null;
    this.lastTime = Date.now();
  }

  spawnTowers(playerId, side) {
    const yPrincess = side === 'BOTTOM' ? 6.5 : ARENA_HEIGHT - 6.5;
    const yKing = side === 'BOTTOM' ? 2.5 : ARENA_HEIGHT - 2.5;

    this.gameState.entities.push(
      this.createEntity('tower_princess', playerId, { x: 3.5, y: yPrincess }),
      this.createEntity('tower_princess', playerId, { x: ARENA_WIDTH - 3.5, y: yPrincess }),
      this.createEntity('tower_king', playerId, { x: ARENA_WIDTH / 2, y: yKing })
    );
  }

  createEntity(defId, ownerId, pos) {
    const def = CARDS[defId];
    if (!def) {
        console.error(`[GameRoom] Invalid Card ID: ${defId}`);
        return null;
    }

    return {
      id: uuidv4(),
      defId,
      ownerId,
      position: { ...pos },
      hp: def.stats.hp,
      maxHp: def.stats.hp,
      state: 'DEPLOYING', // Start with deploy time
      targetId: null,
      lastAttackTime: 0,
      deployTimer: def.stats.deployTime,
      deathTimer: 0,
      facingRight: true
    };
  }

  start() {
    console.log(`[Room ${this.roomId}] Game Loop Started`);
    this.io.to(this.roomId).emit('game_start', { 
      players: this.players,
      player1Id: this.player1Id,
      player2Id: this.player2Id,
      endTime: Date.now() + 180000,
      isFriendly: this.isFriendly
    });
    
    this.intervalId = setInterval(() => this.update(), 1000 / TICK_RATE);
  }

  update() {
    if (this.gameState.gameOver) {
      clearInterval(this.intervalId);
      return;
    }

    const now = Date.now();
    const dt = (now - this.lastTime) / 1000; // Delta time in seconds
    this.lastTime = now;

    // 1. Time & Elixir
    this.gameState.time -= dt;
    if (this.gameState.time <= 0) {
        this.endGame('DRAW');
        return;
    }

    Object.keys(this.players).forEach(pid => {
      const rate = this.gameState.time <= 60 ? ELIXIR_RATE / 2 : ELIXIR_RATE;
      this.gameState.elixir[pid] = Math.min(MAX_ELIXIR, this.gameState.elixir[pid] + dt / rate);
    });

    // 2. Projectiles
    this.updateProjectiles(dt);

    // 3. Entities
    for (let i = this.gameState.entities.length - 1; i >= 0; i--) {
        const ent = this.gameState.entities[i];
        
        // Safety: ensure entity def still exists (shouldn't happen but prevents crashes)
        if (!CARDS[ent.defId]) {
            this.gameState.entities.splice(i, 1);
            continue;
        }

        // Handle Dying State (Visual feedback buffer)
        if (ent.state === 'DYING') {
            ent.deathTimer = (ent.deathTimer || 1) - dt;
            if (ent.deathTimer <= 0) {
                this.gameState.entities.splice(i, 1);
            }
            continue; // Skip normal update logic for dying units
        }

        this.updateEntity(ent, dt);
        
        if (ent.hp <= 0) {
            // Transition to DYING instead of removing immediately
            ent.state = 'DYING';
            ent.deathTimer = 1.0; // 1 second visual decay
            
            if (ent.defId === 'tower_king') {
                const winnerId = Object.keys(this.players).find(id => id !== ent.ownerId);
                this.endGame(winnerId);
                // Do NOT return here, allow the DYING state to be broadcast in the final frame
            }
        }
    }

    // 4. Broadcast
    this.io.to(this.roomId).emit('game_update', {
        time: this.gameState.time,
        elixir: this.gameState.elixir,
        entities: this.gameState.entities,
        projectiles: this.gameState.projectiles
    });
  }

  updateEntity(ent, dt) {
    if (ent.state === 'DEPLOYING') {
        ent.deployTimer -= dt;
        if (ent.deployTimer <= 0) ent.state = 'IDLE';
        return;
    }

    const def = CARDS[ent.defId];
    if (def.type === 'BUILDING') return;

    // AI Logic: Find Target or Move
    let target = null;
    if (ent.targetId) {
        target = this.gameState.entities.find(e => e.id === ent.targetId && e.state !== 'DYING');
    }
    
    if (!target || target.hp <= 0) {
        ent.targetId = null;
        target = this.findTarget(ent, def.stats);
        if (target) ent.targetId = target.id;
    }

    if (target) {
        const dx = target.position.x - ent.position.x;
        const dy = target.position.y - ent.position.y;
        const distSq = dx*dx + dy*dy;
        const range = def.stats.range + 0.5 + (CARDS[target.defId]?.stats?.radius || 0.5); 
        
        if (distSq <= range * range) {
            // Attack
            ent.state = 'ATTACK';
            ent.lastAttackTime += dt;
            if (ent.lastAttackTime >= def.stats.hitSpeed) {
                ent.lastAttackTime = 0;
                this.performAttack(ent, target, def.stats);
            }
        } else {
            // Move towards target
            ent.state = 'MOVE';
            this.moveTowards(ent, target.position, def.stats.speed, dt);
        }
    } else {
        // No target? Move towards enemy King Tower end
        // Player 1 (Bottom, ID in players[0] key usually) -> goes to Y=32
        // Player 2 (Top) -> goes to Y=0
        
        const isPlayer1 = ent.ownerId === this.player1Id;
        
        const bridgeY = ARENA_HEIGHT / 2;
        const targetY = isPlayer1 ? ARENA_HEIGHT - 2.5 : 2.5;

        // Bridge Logic
        const needsBridge = isPlayer1 ? ent.position.y < bridgeY : ent.position.y > bridgeY;
        
        if (needsBridge) {
             const isLeft = ent.position.x < ARENA_WIDTH / 2;
             const bridgeX = isLeft ? 3.5 : ARENA_WIDTH - 3.5;
             this.moveTowards(ent, { x: bridgeX, y: bridgeY }, def.stats.speed, dt);
        } else {
             this.moveTowards(ent, { x: ARENA_WIDTH/2, y: targetY }, def.stats.speed, dt);
        }
    }
  }

  moveTowards(ent, targetPos, speed, dt) {
      const dx = targetPos.x - ent.position.x;
      const dy = targetPos.y - ent.position.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      
      if (dist > 0.1) {
          const move = Math.min(dist, speed * dt);
          ent.position.x += (dx/dist) * move;
          ent.position.y += (dy/dist) * move;
          ent.facingRight = dx > 0;
      }
  }

  findTarget(me, stats) {
      let nearest = null;
      let minDstSq = Infinity;

      for (const other of this.gameState.entities) {
          if (other.ownerId === me.ownerId) continue;
          if (other.state === 'DYING') continue;
          if (stats.targetPreference === 'BUILDINGS' && CARDS[other.defId].type !== 'BUILDING') continue;

          const d2 = (me.position.x - other.position.x)**2 + (me.position.y - other.position.y)**2;
          if (d2 < minDstSq) {
              minDstSq = d2;
              nearest = other;
          }
      }
      return nearest;
  }

  performAttack(source, target, stats) {
      if (stats.range > 1.5) {
          // Projectile
          this.gameState.projectiles.push({
              id: uuidv4(),
              ownerId: source.ownerId,
              targetId: target.id,
              targetPos: { ...target.position },
              damage: stats.damage,
              speed: 12,
              position: { ...source.position },
              splashRadius: stats.splashRadius || 0
          });
      } else {
          // Instant Melee
          if (stats.splashRadius > 0) {
              this.gameState.entities.forEach(e => {
                  if (e.ownerId !== source.ownerId && e.state !== 'DYING') {
                      const d2 = (e.position.x - source.position.x)**2 + (e.position.y - source.position.y)**2;
                      if (d2 <= stats.splashRadius**2) {
                          e.hp -= stats.damage;
                      }
                  }
              });
          } else {
              target.hp -= stats.damage;
          }
      }
  }

  updateProjectiles(dt) {
      for (let i = this.gameState.projectiles.length - 1; i >= 0; i--) {
          const p = this.gameState.projectiles[i];
          
          if (p.targetId) {
              const target = this.gameState.entities.find(e => e.id === p.targetId);
              if (target) p.targetPos = target.position;
          }

          const dx = p.targetPos.x - p.position.x;
          const dy = p.targetPos.y - p.position.y;
          const dist = Math.sqrt(dx*dx + dy*dy);

          if (dist < 0.5) {
              if (p.splashRadius > 0) {
                  this.gameState.entities.forEach(e => {
                    if (e.ownerId !== p.ownerId && e.state !== 'DYING') {
                        const d2 = (e.position.x - p.targetPos.x)**2 + (e.position.y - p.targetPos.y)**2;
                        if (d2 <= p.splashRadius**2) e.hp -= p.damage;
                    }
                  });
              } else if (p.targetId) {
                  const target = this.gameState.entities.find(e => e.id === p.targetId);
                  if (target) target.hp -= p.damage;
              }
              this.gameState.projectiles.splice(i, 1);
          } else {
              const move = p.speed * dt;
              p.position.x += (dx/dist) * move;
              p.position.y += (dy/dist) * move;
          }
      }
  }

  handleInput(playerId, { cardId, x, y }) {
      if (this.gameState.gameOver) return;

      const card = CARDS[cardId];
      if (!card) {
          console.log(`[GameRoom] Player ${playerId} tried to spawn invalid card ${cardId}`);
          return;
      }
      
      // Allow slight floating point tolerance for Elixir
      if (this.gameState.elixir[playerId] < card.cost - 0.1) {
          return;
      }

      // Validate Side
      const isPlayer1 = playerId === this.player1Id;
      const bridgeY = ARENA_HEIGHT / 2;
      
      if (card.type !== 'SPELL') {
          if (isPlayer1 && y > bridgeY) return;
          if (!isPlayer1 && y < bridgeY) return;
      }

      this.gameState.elixir[playerId] -= card.cost;
      console.log(`[GameRoom] Spawning ${cardId} for ${playerId} at ${x.toFixed(1)}, ${y.toFixed(1)}`);

      if (card.type === 'SPELL') {
          this.gameState.projectiles.push({
              id: uuidv4(),
              ownerId: playerId,
              targetId: null,
              targetPos: { x, y },
              damage: card.stats.damage,
              speed: 15,
              position: { x, y: isPlayer1 ? 0 : ARENA_HEIGHT },
              splashRadius: card.stats.range
          });
      } else {
          const count = card.stats.count || 1;
          const offsets = this.getSpawnOffsets(count);
          
          offsets.forEach(off => {
              const ent = this.createEntity(cardId, playerId, { x: x + off.x, y: y + off.y });
              if (ent) this.gameState.entities.push(ent);
          });
      }
  }

  getSpawnOffsets(count) {
      if (count === 1) return [{x:0, y:0}];
      if (count === 2) return [{x:-0.5, y:0}, {x:0.5, y:0}];
      if (count === 3) return [{x:0, y:0.8}, {x:-0.7, y:-0.4}, {x:0.7, y:-0.4}]; 
      return Array.from({length: count}, (_, i) => ({ x: (Math.random()-0.5)*1.5, y: (Math.random()-0.5)*1.5 }));
  }

  endGame(winnerId) {
      if (this.gameState.gameOver) return;
      
      this.gameState.gameOver = true;
      this.gameState.winner = winnerId;
      
      // Calculate Trophies
      let trophyChange = 0;
      if (!this.isFriendly && winnerId) {
          trophyChange = 30; // Standard reward
      }
      
      // Execute Server Callback for Economy (Gold/Chests)
      if (this.onMatchEnd) {
          this.onMatchEnd(winnerId, this.players, this.isFriendly);
      }
      
      this.io.to(this.roomId).emit('game_over', { 
          winnerId,
          trophyChange // Clients can use this if they want authoritative data
      });
      console.log(`[Room ${this.roomId}] Game Over. Winner: ${winnerId}, Trophies: ${trophyChange}`);
      
      clearInterval(this.intervalId);
  }
}

module.exports = GameRoom;
