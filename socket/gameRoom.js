
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

    // Admin / Modifiers
    this.godModes = {}; // userId -> boolean
    this.invincibility = {}; // userId -> boolean
    this.frozenPlayers = {}; // userId -> boolean
    this.elixirMultipliers = {}; // userId -> number
    this.aiAssistance = {}; // userId -> boolean
    this.aiTimer = 0; // throttle AI moves

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

  // --- Admin Methods ---
  setGodMode(userId, enabled) {
      this.godModes[userId] = enabled;
  }

  setInvincibility(userId, enabled) {
      this.invincibility[userId] = enabled;
  }

  setFrozen(userId, enabled) {
      this.frozenPlayers[userId] = enabled;
  }

  setElixirMultiplier(userId, mult) {
      this.elixirMultipliers[userId] = mult;
  }

  setAI(userId, enabled) {
      this.aiAssistance[userId] = enabled;
  }

  destroyTowers(ownerId) {
      this.gameState.entities.forEach(e => {
          if (e.ownerId === ownerId && e.defId.startsWith('tower')) {
              e.hp = 0;
          }
      });
  }

  // NEW: Get lightweight stats for admin inspector
  getLiveStats(userId) {
      const elixir = this.gameState.elixir[userId] || 0;
      
      // Calculate total tower HP
      const towerHp = this.gameState.entities
          .filter(e => e.ownerId === userId && e.defId.startsWith('tower'))
          .reduce((sum, e) => sum + e.hp, 0);

      // Count active units (excluding towers)
      const unitCount = this.gameState.entities
          .filter(e => e.ownerId === userId && !e.defId.startsWith('tower'))
          .length;

      return {
          elixir: parseFloat(elixir.toFixed(1)),
          towerHp: Math.floor(towerHp),
          unitCount,
          isFrozen: !!this.frozenPlayers[userId],
          elixirMult: this.elixirMultipliers[userId] || 1
      };
  }

  addSpectator(socket) {
      socket.join(this.roomId);
      // Emit game_start to the spectator so their client initializes the engine
      socket.emit('game_start', {
          players: this.players,
          player1Id: this.player1Id,
          player2Id: this.player2Id,
          endTime: Date.now() + (this.gameState.time * 1000),
          isFriendly: this.isFriendly,
          spectating: true
      });
      console.log(`[GameRoom] Spectator ${socket.user.username} joined room ${this.roomId}`);
  }
  // ---------------------

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
      stunTimer: 0,
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
      
      // Admin Elixir Multiplier
      const multiplier = this.elixirMultipliers[pid] || 1.0;

      // God Mode Override
      if (this.godModes[pid]) {
          this.gameState.elixir[pid] = MAX_ELIXIR;
      } else {
          // Normal Gain * Multiplier
          this.gameState.elixir[pid] = Math.min(MAX_ELIXIR, this.gameState.elixir[pid] + (dt / rate) * multiplier);
      }

      // Check AI Assistance
      if (this.aiAssistance[pid]) {
          this.runAI(pid, dt);
      }
    });

    // 2. Projectiles
    this.updateProjectiles(dt);

    // 3. Entities
    for (let i = this.gameState.entities.length - 1; i >= 0; i--) {
        const ent = this.gameState.entities[i];
        
        if (!CARDS[ent.defId]) {
            this.gameState.entities.splice(i, 1);
            continue;
        }

        // Freeze Logic: If owner is frozen, skip update (except deployment timer for simplicity)
        if (this.frozenPlayers[ent.ownerId]) {
            continue;
        }

        // Handle Dying State (Visual feedback buffer)
        if (ent.state === 'DYING') {
            ent.deathTimer = (ent.deathTimer || 1) - dt;
            if (ent.deathTimer <= 0) {
                this.gameState.entities.splice(i, 1);
            }
            continue; 
        }
        
        // Handle Stun
        if (ent.stunTimer > 0) {
            ent.stunTimer -= dt;
            continue;
        }

        this.updateEntity(ent, dt);
        
        if (ent.hp <= 0) {
            // Invincibility Override
            if (this.invincibility[ent.ownerId]) {
                ent.hp = ent.maxHp; // Heal instantly
            } else {
                ent.state = 'DYING';
                ent.deathTimer = 1.0; 
                
                if (ent.defId === 'tower_king') {
                    const winnerId = Object.keys(this.players).find(id => id !== ent.ownerId);
                    this.endGame(winnerId);
                }
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

  runAI(playerId, dt) {
      this.aiTimer = (this.aiTimer || 0) + dt;
      if (this.aiTimer < 2.0) return; // Check every 2 seconds
      this.aiTimer = 0;

      const elixir = this.gameState.elixir[playerId];
      if (elixir < 4) return; // Wait for some elixir

      // Pick a random card from user's current deck (simplified, assuming standard list)
      const user = this.players[playerId];
      const deck = user.currentDeck || ['knight', 'archers', 'giant', 'musketeer'];
      const cardId = deck[Math.floor(Math.random() * deck.length)];
      const card = CARDS[cardId];

      if (card && elixir >= card.cost) {
          // Simple placement logic
          const isP1 = playerId === this.player1Id;
          const bridgeY = ARENA_HEIGHT / 2;
          const spawnY = isP1 ? bridgeY - 3 : bridgeY + 3; 
          const spawnX = Math.random() > 0.5 ? 4.5 : ARENA_WIDTH - 4.5; // Left or Right Lane

          this.handleInput(playerId, { cardId, x: spawnX, y: spawnY });
      }
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
    let targets = this.findTargets(ent, def.stats, def.stats.maxTargets || 1);
    
    // Check if current target is invalid
    if (ent.targetId) {
        const currentTarget = this.gameState.entities.find(e => e.id === ent.targetId && e.state !== 'DYING');
        if (!currentTarget) ent.targetId = null;
    }

    if (!ent.targetId && targets.length > 0) {
        ent.targetId = targets[0].id;
    }

    if (ent.targetId) {
        // We have at least one target (the primary one)
        const target = this.gameState.entities.find(e => e.id === ent.targetId);
        
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
                    
                    // Attack ALL targets
                    targets = this.findTargets(ent, def.stats, def.stats.maxTargets || 1);
                    targets.forEach(t => this.performAttack(ent, t, def.stats));
                }
            } else {
                // Move towards PRIMARY target
                ent.state = 'MOVE';
                this.moveTowards(ent, target.position, def.stats.speed, dt);
            }
        }
    } else {
        // No target? Move towards enemy King Tower end
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

  findTargets(me, stats, count) {
      let candidates = this.gameState.entities.filter(other => {
          if (other.ownerId === me.ownerId) return false;
          if (other.state === 'DYING') return false;
          if (stats.targetPreference === 'BUILDINGS' && CARDS[other.defId].type !== 'BUILDING') return false;
          return true;
      });

      // Sort by distance
      candidates.sort((a, b) => {
          const d1 = (me.position.x - a.position.x)**2 + (me.position.y - a.position.y)**2;
          const d2 = (me.position.x - b.position.x)**2 + (me.position.y - b.position.y)**2;
          return d1 - d2;
      });

      return candidates.slice(0, count);
  }

  performAttack(source, target, stats) {
      if (stats.range > 1.5 || stats.projectileType === 'BEAM') {
          // Projectile
          this.gameState.projectiles.push({
              id: uuidv4(),
              ownerId: source.ownerId,
              targetId: target.id,
              targetPos: { ...target.position },
              damage: stats.damage,
              speed: stats.projectileType === 'BEAM' ? 30 : 12,
              position: { ...source.position },
              splashRadius: stats.splashRadius || 0,
              type: stats.projectileType || 'STANDARD',
              stunDuration: stats.stunDuration
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
          
          if (p.type === 'LOG') {
               // Log Logic
               const dx = p.targetPos.x - p.position.x;
               const dy = p.targetPos.y - p.position.y;
               const distToTarget = Math.sqrt(dx*dx + dy*dy);
               const move = p.speed * dt;
               const dirX = dx / distToTarget;
               const dirY = dy / distToTarget;
               
               p.position.x += dirX * move;
               p.position.y += dirY * move;

               // Collision
               this.gameState.entities.forEach(e => {
                   if (e.ownerId !== p.ownerId && e.hp > 0 && e.state !== 'DYING') {
                       if (p.hitList && !p.hitList.includes(e.id)) {
                            // Check collision
                            const d2 = (e.position.x - p.position.x)**2 + (e.position.y - p.position.y)**2;
                            if (d2 < (p.splashRadius)**2) {
                                e.hp -= p.damage;
                                p.hitList.push(e.id);
                                if (p.knockback) {
                                     e.position.x += dirX * p.knockback;
                                     e.position.y += dirY * p.knockback;
                                     e.position.x = Math.max(0, Math.min(ARENA_WIDTH, e.position.x));
                                     e.position.y = Math.max(0, Math.min(ARENA_HEIGHT, e.position.y));
                                }
                            }
                       }
                   }
               });
               
               const distTraveled = p.startPos ? Math.sqrt((p.position.x - p.startPos.x)**2 + (p.position.y - p.startPos.y)**2) : 999;
               if (distTraveled >= (p.maxRange || 10)) {
                   this.gameState.projectiles.splice(i, 1);
               }
               continue;
          }

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
                        if (d2 <= p.splashRadius**2) {
                            e.hp -= p.damage;
                            if (p.stunDuration) e.stunTimer = p.stunDuration;
                            if (p.knockback) {
                                const pushX = e.position.x - p.targetPos.x;
                                const pushY = e.position.y - p.targetPos.y;
                                const pushLen = Math.sqrt(pushX*pushX + pushY*pushY) || 1;
                                e.position.x += (pushX/pushLen) * p.knockback;
                                e.position.y += (pushY/pushLen) * p.knockback;
                            }
                        }
                    }
                  });
              } else if (p.targetId) {
                  const target = this.gameState.entities.find(e => e.id === p.targetId);
                  if (target) {
                      target.hp -= p.damage;
                      if (p.stunDuration) target.stunTimer = p.stunDuration;
                  }
              }
              this.gameState.projectiles.splice(i, 1);
          } else {
              const move = p.speed * dt;
              p.position.x += (dx/dist) * move;
              p.position.y += (dy/dist) * move;
          }
      }
  }

  handleInput(playerId, { cardId, x, y }, bypassCost = false) {
      if (this.gameState.gameOver) return;

      const card = CARDS[cardId];
      if (!card) {
          console.log(`[GameRoom] handleInput failed: Invalid Card ${cardId}`);
          return;
      }
      
      // Allow slight floating point tolerance for Elixir
      if (!bypassCost && this.gameState.elixir[playerId] < card.cost - 0.1) {
          console.log(`[GameRoom] handleInput failed: Not enough elixir ${playerId} needs ${card.cost} has ${this.gameState.elixir[playerId]}`);
          return;
      }

      // Validate Side (skip validation if admin spawn or spell)
      const isPlayer1 = playerId === this.player1Id;
      const bridgeY = ARENA_HEIGHT / 2;
      
      // Goblin Barrel and Miner can spawn anywhere (we simulate goblin_barrel check via name or added prop in future)
      const isGlobalSpawn = card.id === 'goblin_barrel' || card.type === 'SPELL';

      if (!bypassCost && !isGlobalSpawn && card.stats.projectileType !== 'LOG') {
          if (isPlayer1 && y > bridgeY) {
              console.log(`[GameRoom] handleInput failed: P1 tried to spawn at ${y} (Enemy Side)`);
              return;
          }
          if (!isPlayer1 && y < bridgeY) {
              console.log(`[GameRoom] handleInput failed: P2 tried to spawn at ${y} (Enemy Side)`);
              return;
          }
      }

      if (!bypassCost && !this.godModes[playerId]) {
          this.gameState.elixir[playerId] -= card.cost;
      }

      // SPecial LOG Logic
      if (card.stats.projectileType === 'LOG') {
          this.gameState.projectiles.push({
            id: uuidv4(),
            ownerId: playerId,
            targetId: null, // Log doesn't target an entity, it targets a direction
            targetPos: { x, y: y + (isPlayer1 ? 10 : -10) }, // Move forward
            damage: card.stats.damage,
            speed: card.stats.speed,
            position: { x, y }, 
            splashRadius: card.stats.splashRadius || 1.0,
            type: 'LOG',
            knockback: card.stats.knockback || 2.0,
            piercing: true,
            hitList: [],
            maxRange: card.stats.range,
            startPos: { x, y }
          });
          return;
      }

      if (card.type === 'SPELL') {
          this.gameState.projectiles.push({
              id: uuidv4(),
              ownerId: playerId,
              targetId: null,
              targetPos: { x, y },
              damage: card.stats.damage,
              speed: 15,
              position: { x, y: isPlayer1 ? 0 : ARENA_HEIGHT },
              splashRadius: card.stats.range,
              type: card.stats.projectileType || 'FIREBALL',
              stunDuration: card.stats.stunDuration,
              knockback: card.stats.knockback
          });
      } else {
          const count = card.stats.count || 1;
          const offsets = this.getSpawnOffsets(count);
          
          offsets.forEach(off => {
              const ent = this.createEntity(cardId, playerId, { x: x + off.x, y: y + off.y });
              
              if (bypassCost) {
                  ent.deployTimer = 0; // Instant deploy for admin spawns
                  ent.state = 'IDLE';
              }

              if (ent) {
                  this.gameState.entities.push(ent);

                  // Spawn Damage (E-Wiz)
                  if (card.stats.spawnDamage) {
                       const radius = card.stats.splashRadius || 2;
                        this.gameState.entities.forEach(target => {
                            if (target.ownerId !== playerId && target.hp > 0 && 
                                ((ent.position.x - target.position.x)**2 + (ent.position.y - target.position.y)**2 <= radius**2)) {
                                target.hp -= card.stats.spawnDamage;
                                if (card.stats.stunDuration) target.stunTimer = card.stats.stunDuration;
                            }
                        });
                        // Visual
                        this.gameState.projectiles.push({
                            id: uuidv4(),
                            ownerId: playerId,
                            targetId: null,
                            targetPos: ent.position,
                            damage: 0,
                            speed: 0,
                            position: ent.position,
                            splashRadius: 0,
                            type: 'ZAP'
                        });
                  }
              }
          });
      }
  }

  getSpawnOffsets(count) {
      if (count === 1) return [{x:0, y:0}];
      if (count === 2) return [{x:-0.5, y:0}, {x:0.5, y:0}];
      if (count === 3) return [{x:0, y:0.8}, {x:-0.7, y:-0.4}, {x:0.7, y:-0.4}]; 
      if (count === 6) return [
          {x:-0.5, y:0.5}, {x:0.5, y:0.5},
          {x:-0.5, y:-0.5}, {x:0.5, y:-0.5},
          {x:-1.0, y:0}, {x:1.0, y:0}
      ];
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
