
const { v4: uuidv4 } = require('uuid');
const { CARDS, ARENA_WIDTH, ARENA_HEIGHT } = require('../gameData');

const TICK_RATE = 30; // 30 FPS
const ELIXIR_RATE = 2.8;
const MAX_ELIXIR = 10;
const INTRO_DELAY_MS = 4000; // 4 seconds delay for client intro animation

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

    this.player1Id = player1.id; // Bottom Player
    this.player2Id = player2.id; // Top Player
    this.isFriendly = false;

    // Modifiers
    this.godModes = {}; 
    this.invincibility = {}; 
    this.frozenPlayers = {}; 
    this.elixirMultipliers = {}; 
    this.aiAssistance = {}; 
    this.aiTimer = 0; 

    this.matchLog = [];

    this.gameState = {
      time: 180, // 3 minutes
      gameOver: false,
      winner: null,
      elixir: { [player1.id]: 5, [player2.id]: 5 },
      entities: [],
      projectiles: []
    };
    
    this.effectQueue = []; 

    // Initial Towers
    this.spawnTowers(player1.id, 'BOTTOM');
    this.spawnTowers(player2.id, 'TOP');

    this.intervalId = null;
    this.lastTime = Date.now();
  }

  logAction(action, detail) {
      const entry = `[${Math.floor(180 - this.gameState.time)}s] ${action}: ${detail}`;
      this.matchLog.push(entry);
  }

  pushEffect(type, position, ownerId, scale = 1) {
      this.effectQueue.push({
          id: uuidv4(),
          type,
          position: { ...position },
          ownerId,
          scale
      });
  }

  // --- Admin Methods ---
  setGodMode(userId, enabled) { this.godModes[userId] = enabled; }
  setInvincibility(userId, enabled) { this.invincibility[userId] = enabled; }
  setFrozen(userId, enabled) { this.frozenPlayers[userId] = enabled; }
  setElixirMultiplier(userId, mult) { this.elixirMultipliers[userId] = mult; }
  setAI(userId, enabled) { this.aiAssistance[userId] = enabled; }
  
  destroyTowers(ownerId) {
      this.gameState.entities.forEach(e => {
          if (e.ownerId === ownerId && e.defId.startsWith('tower')) {
              e.hp = 0;
          }
      });
  }

  getLiveStats(userId) {
      const elixir = this.gameState.elixir[userId] || 0;
      const towerHp = this.gameState.entities
          .filter(e => e.ownerId === userId && e.defId.startsWith('tower'))
          .reduce((sum, e) => sum + e.hp, 0);
      const unitCount = this.gameState.entities
          .filter(e => e.ownerId === userId && !e.defId.startsWith('tower'))
          .length;

      return {
          elixir: parseFloat(elixir.toFixed(1)),
          towerHp: Math.floor(towerHp),
          unitCount,
          isFrozen: !!this.frozenPlayers[userId],
          isGodMode: !!this.godModes[userId],
          elixirMult: this.elixirMultipliers[userId] || 1,
          timeRemaining: Math.floor(this.gameState.time)
      };
  }

  addSpectator(socket) {
      socket.join(this.roomId);
      socket.emit('game_start', {
          players: this.players,
          player1Id: this.player1Id,
          player2Id: this.player2Id,
          endTime: Date.now() + (this.gameState.time * 1000),
          isFriendly: this.isFriendly,
          spectating: true
      });
  }

  spawnTowers(playerId, side) {
    const yPrincess = side === 'BOTTOM' ? 6.5 : ARENA_HEIGHT - 6.5;
    const yKing = side === 'BOTTOM' ? 2.5 : ARENA_HEIGHT - 2.5;

    const t1 = this.createEntity('tower_princess', playerId, { x: 3.5, y: yPrincess });
    const t2 = this.createEntity('tower_princess', playerId, { x: ARENA_WIDTH - 3.5, y: yPrincess });
    const t3 = this.createEntity('tower_king', playerId, { x: ARENA_WIDTH / 2, y: yKing });

    if (t1) this.gameState.entities.push(t1);
    if (t2) this.gameState.entities.push(t2);
    if (t3) this.gameState.entities.push(t3);
  }

  createEntity(defId, ownerId, pos) {
    const def = CARDS[defId];
    if (!def) return null;

    return {
      id: uuidv4(),
      defId,
      ownerId,
      position: { ...pos },
      hp: def.stats.hp,
      maxHp: def.stats.hp,
      state: 'DEPLOYING',
      targetId: null,
      lastAttackTime: 0,
      deployTimer: def.stats.deployTime,
      deathTimer: 0,
      stunTimer: 0,
      facingRight: true
    };
  }

  start() {
    this.io.to(this.roomId).emit('game_start', { 
      players: this.players,
      player1Id: this.player1Id,
      player2Id: this.player2Id,
      endTime: Date.now() + 180000 + INTRO_DELAY_MS,
      isFriendly: this.isFriendly
    });
    
    setTimeout(() => {
        this.lastTime = Date.now();
        this.intervalId = setInterval(() => this.update(), 1000 / TICK_RATE);
    }, INTRO_DELAY_MS);
  }

  update() {
    if (this.gameState.gameOver) {
        clearInterval(this.intervalId);
        return;
    }

    try {
        const now = Date.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1); 
        this.lastTime = now;

        // 1. Time Check
        this.gameState.time -= dt;
        if (this.gameState.time <= 0) {
            this.endGame(null, 'TIME_UP'); 
            return;
        }

        // 2. Elixir Generation
        Object.keys(this.players).forEach(pid => {
          const rate = this.gameState.time <= 60 ? ELIXIR_RATE / 2 : ELIXIR_RATE;
          const multiplier = this.elixirMultipliers[pid] || 1.0;
          
          if (this.godModes[pid]) {
              this.gameState.elixir[pid] = MAX_ELIXIR;
          } else {
              let current = this.gameState.elixir[pid] || 0;
              current += (dt / rate) * multiplier;
              this.gameState.elixir[pid] = Math.min(MAX_ELIXIR, current);
          }

          if (this.aiAssistance[pid]) this.runAI(pid, dt);
        });

        // 3. Update Projectiles
        this.updateProjectiles(dt);

        // 4. Update Entities & Check Deaths
        for (let i = this.gameState.entities.length - 1; i >= 0; i--) {
            const ent = this.gameState.entities[i];
            if (!ent) continue;

            if (this.frozenPlayers[ent.ownerId]) continue;

            if (ent.state === 'DYING') {
                ent.deathTimer = (ent.deathTimer || 1) - dt;
                if (ent.deathTimer <= 0) {
                    this.gameState.entities.splice(i, 1);
                }
                continue; 
            }
            
            if (ent.stunTimer > 0) {
                ent.stunTimer -= dt;
                continue;
            }

            this.updateEntity(ent, dt);
            
            if (ent.hp <= 0) {
                if (this.invincibility[ent.ownerId]) {
                    ent.hp = ent.maxHp;
                } else {
                    ent.state = 'DYING';
                    ent.deathTimer = 1.0;
                    this.pushEffect('DEATH', ent.position, ent.ownerId);
                    this.pushEffect('ELIXIR_STAIN', ent.position, ent.ownerId);
                    
                    // --- INSTANT WIN CHECK ---
                    if (ent.defId === 'tower_king') {
                        const loserId = ent.ownerId;
                        // Explicitly determine winner based on ID comparison to avoid ambiguity
                        const winnerId = loserId === this.player1Id ? this.player2Id : this.player1Id;
                        
                        // Push final state before ending
                        this.io.to(this.roomId).emit('game_update', {
                            time: this.gameState.time,
                            elixir: this.gameState.elixir,
                            entities: this.gameState.entities,
                            projectiles: this.gameState.projectiles,
                            effects: this.effectQueue
                        });
                        
                        this.endGame(winnerId, 'TOWER_DESTROYED');
                        return; // Stop update loop immediately
                    }
                }
            }
        }

        // 5. Broadcast State
        this.io.to(this.roomId).emit('game_update', {
            time: this.gameState.time,
            elixir: this.gameState.elixir,
            entities: this.gameState.entities,
            projectiles: this.gameState.projectiles,
            effects: this.effectQueue
        });
        this.effectQueue = [];

    } catch (e) {
        console.error(`[GameRoom] Error in update loop: ${e.message}`);
    }
  }

  runAI(playerId, dt) {
      this.aiTimer = (this.aiTimer || 0) + dt;
      if (this.aiTimer < 2.0) return; 
      this.aiTimer = 0;

      const elixir = this.gameState.elixir[playerId];
      if (elixir < 4) return; 

      const user = this.players[playerId];
      const deck = user.currentDeck || ['knight', 'archers', 'giant', 'musketeer'];
      const cardId = deck[Math.floor(Math.random() * deck.length)];
      const card = CARDS[cardId];

      if (card && elixir >= card.cost) {
          const isP1 = playerId === this.player1Id;
          const bridgeY = ARENA_HEIGHT / 2;
          const spawnY = isP1 ? bridgeY - 3 : bridgeY + 3; 
          const spawnX = Math.random() > 0.5 ? 4.5 : ARENA_WIDTH - 4.5;
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

    let targets = this.findTargets(ent, def.stats, def.stats.maxTargets || 1);
    
    if (ent.targetId) {
        const currentTarget = this.gameState.entities.find(e => e.id === ent.targetId && e.state !== 'DYING');
        if (!currentTarget) ent.targetId = null;
    }

    if (!ent.targetId && targets.length > 0) {
        ent.targetId = targets[0].id;
    }

    if (ent.targetId) {
        const target = this.gameState.entities.find(e => e.id === ent.targetId);
        if (target) {
            const dx = target.position.x - ent.position.x;
            const dy = target.position.y - ent.position.y;
            const distSq = dx*dx + dy*dy;
            const range = def.stats.range + 0.5 + (CARDS[target.defId]?.stats?.radius || 0.5); 
            
            if (distSq <= range * range) {
                ent.state = 'ATTACK';
                ent.lastAttackTime += dt;
                if (ent.lastAttackTime >= def.stats.hitSpeed) {
                    ent.lastAttackTime = 0;
                    targets = this.findTargets(ent, def.stats, def.stats.maxTargets || 1);
                    targets.forEach(t => this.performAttack(ent, t, def.stats));
                }
            } else {
                ent.state = 'MOVE';
                this.moveTowards(ent, target.position, def.stats.speed, dt);
            }
        }
    } else {
        const isPlayer1 = ent.ownerId === this.player1Id;
        const bridgeY = ARENA_HEIGHT / 2;
        const targetY = isPlayer1 ? ARENA_HEIGHT - 2.5 : 2.5;
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

      candidates.sort((a, b) => {
          const d1 = (me.position.x - a.position.x)**2 + (me.position.y - a.position.y)**2;
          const d2 = (me.position.x - b.position.x)**2 + (me.position.y - b.position.y)**2;
          return d1 - d2;
      });

      return candidates.slice(0, count);
  }

  performAttack(source, target, stats) {
      if (stats.range > 1.5 || stats.projectileType === 'BEAM') {
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
          if (stats.splashRadius > 0) {
              this.pushEffect('SPARKS', source.position, source.ownerId, 1.2); 
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
              this.pushEffect('SPARKS', target.position, source.ownerId);
          }
      }
  }

  updateProjectiles(dt) {
      for (let i = this.gameState.projectiles.length - 1; i >= 0; i--) {
          const p = this.gameState.projectiles[i];
          
          if (p.type === 'LOG') {
               const dx = p.targetPos.x - p.position.x;
               const dy = p.targetPos.y - p.position.y;
               const distToTarget = Math.sqrt(dx*dx + dy*dy);
               const move = p.speed * dt;
               const dirX = dx / distToTarget;
               const dirY = dy / distToTarget;
               
               p.position.x += dirX * move;
               p.position.y += dirY * move;

               this.gameState.entities.forEach(e => {
                   if (e.ownerId !== p.ownerId && e.hp > 0 && e.state !== 'DYING') {
                       if (p.hitList && !p.hitList.includes(e.id)) {
                            const d2 = (e.position.x - p.position.x)**2 + (e.position.y - p.position.y)**2;
                            if (d2 < (p.splashRadius)**2) {
                                e.hp -= p.damage;
                                p.hitList.push(e.id);
                                this.pushEffect('DUST', e.position, p.ownerId); 
                                if (p.knockback) {
                                     e.position.x += dirX * p.knockback;
                                     e.position.y += dirY * p.knockback;
                                }
                            }
                       }
                   }
               });
               
               const distTraveled = p.startPos ? Math.sqrt((p.position.x - p.startPos.x)**2 + (p.position.y - p.startPos.y)**2) : 999;
               if (distTraveled >= (p.maxRange || 10)) {
                   this.gameState.projectiles.splice(i, 1);
                   this.pushEffect('LOG_BREAK', p.position, p.ownerId);
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
              if (p.type === 'BARREL' && p.spawnUnitId) {
                  this.pushEffect('EXPLOSION', p.targetPos, p.ownerId, 1.5);
                  const count = p.spawnCount || 3;
                  const offsets = [{x: 0, y: -0.8}, {x: -0.7, y: 0.4}, {x: 0.7, y: 0.4}];
                  for (let k = 0; k < count; k++) {
                      const offset = offsets[k % 3];
                      const ent = this.createEntity(p.spawnUnitId, p.ownerId, { 
                          x: p.targetPos.x + offset.x, 
                          y: p.targetPos.y + offset.y 
                      });
                      if(ent) {
                          ent.deployTimer = 0.5;
                          this.gameState.entities.push(ent);
                      }
                  }
                  this.gameState.projectiles.splice(i, 1);
                  continue;
              }

              if (p.splashRadius > 0) {
                  if (p.type === 'ZAP') {
                      this.pushEffect('ZAP', p.targetPos, p.ownerId, 2);
                  } else {
                      this.pushEffect('EXPLOSION', p.targetPos, p.ownerId, p.splashRadius);
                  }

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
                      this.pushEffect('SPARKS', p.targetPos, p.ownerId);
                      if (p.stunDuration) target.stunTimer = p.stunDuration;
                  }
              }
              this.gameState.projectiles.splice(i, 1);
          } else {
              const move = p.speed * dt;
              p.position.x += (dx/dist) * move;
              p.position.y += (dy/dist) * move;
              
              if (p.startPos) {
                  const totalDist = Math.sqrt((p.startPos.x - p.targetPos.x)**2 + (p.startPos.y - p.targetPos.y)**2) || 1;
                  const distTraveled = Math.sqrt((p.startPos.x - p.position.x)**2 + (p.startPos.y - p.position.y)**2);
                  p.progress = Math.min(1, Math.max(0, distTraveled / totalDist));
              }
          }
      }
  }

  handleInput(playerId, { cardId, x, y }, bypassCost = false) {
      if (this.gameState.gameOver) return;

      const card = CARDS[cardId];
      if (!card) return;
      
      const isGodMode = this.godModes[playerId];
      const currentElixir = this.gameState.elixir[playerId];

      if (!bypassCost && !isGodMode) {
          if (currentElixir < card.cost - 0.1) return;
      }

      // Valid Spawn Zone Check
      const isPlayer1 = playerId === this.player1Id;
      const bridgeY = ARENA_HEIGHT / 2;
      const isGlobalSpawn = card.id === 'goblin_barrel' || card.type === 'SPELL'; // Global range cards

      if (!bypassCost && !isGlobalSpawn && card.stats.projectileType !== 'LOG') {
          // Strict spawn zone enforcement
          if (isPlayer1 && y > bridgeY) return; // P1 cannot spawn in top half
          if (!isPlayer1 && y < bridgeY) return; // P2 cannot spawn in bottom half
      }

      if (!bypassCost && !isGodMode) {
          this.gameState.elixir[playerId] -= card.cost;
      }

      this.logAction('SPAWN', `${cardId}`);

      if (card.stats.projectileType === 'LOG') {
          this.gameState.projectiles.push({
            id: uuidv4(),
            ownerId: playerId,
            targetId: null, 
            targetPos: { x, y: y + (isPlayer1 ? 10 : -10) }, 
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

      if (cardId === 'goblin_barrel') {
          this.gameState.projectiles.push({
              id: uuidv4(),
              ownerId: playerId,
              sourceId: 'king_tower',
              targetId: null,
              targetPos: { x, y },
              damage: 0,
              speed: 15,
              position: { x, y: isPlayer1 ? 0 : ARENA_HEIGHT },
              team: 'PLAYER',
              splashRadius: 1.5,
              progress: 0,
              type: 'BARREL',
              spawnUnitId: 'goblins',
              spawnCount: 3,
              startPos: { x, y: isPlayer1 ? 0 : ARENA_HEIGHT }
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
              knockback: card.stats.knockback,
              startPos: { x, y: isPlayer1 ? 0 : ARENA_HEIGHT }
          });
      } else {
          const count = card.stats.count || 1;
          const offsets = this.getSpawnOffsets(count);
          
          offsets.forEach(off => {
              const ent = this.createEntity(cardId, playerId, { x: x + off.x, y: y + off.y });
              if (bypassCost || isGodMode) {
                  ent.deployTimer = 0; 
                  ent.state = 'IDLE';
              }
              if (ent) {
                  this.gameState.entities.push(ent);
                  this.pushEffect('SPAWN', ent.position, ent.ownerId); 

                  if (card.stats.spawnDamage) {
                       const radius = card.stats.splashRadius || 2;
                        this.gameState.entities.forEach(target => {
                            if (target.ownerId !== playerId && target.hp > 0 && 
                                ((ent.position.x - target.position.x)**2 + (ent.position.y - target.position.y)**2 <= radius**2)) {
                                target.hp -= card.stats.spawnDamage;
                                if (card.stats.stunDuration) target.stunTimer = card.stats.stunDuration;
                            }
                        });
                        this.pushEffect('ZAP', ent.position, ent.ownerId, 1.5);
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
          {x:-1.0, y:0}, {x:1.0, y:0},
          {x:-0.5, y:-0.5}, {x:0.5, y:-0.5}
      ];
      if (count === 12) return Array.from({length: 12}, (_, i) => ({ 
          x: (Math.random()-0.5)*2.5, 
          y: (Math.random()-0.5)*2.5 
      }));
      return Array.from({length: count}, (_, i) => ({ x: (Math.random()-0.5)*1.5, y: (Math.random()-0.5)*1.5 }));
  }

  endGame(winnerId, reason) {
      if (this.gameState.gameOver) return;
      
      this.gameState.gameOver = true;
      this.gameState.winner = winnerId;
      
      let trophyChange = 0;
      if (!this.isFriendly && winnerId) {
          trophyChange = 30; 
      }
      
      if (this.onMatchEnd) {
          try {
              this.onMatchEnd(winnerId, this.players, this.isFriendly);
          } catch (e) {
              console.error(`[GameRoom] Error in onMatchEnd: ${e.message}`);
          }
      }
      
      this.io.to(this.roomId).emit('game_over', { 
          winnerId,
          reason,
          trophyChange 
      });
      
      clearInterval(this.intervalId);
  }
}

module.exports = GameRoom;
