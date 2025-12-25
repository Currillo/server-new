
// Shared constants between client and server logic

const ARENA_WIDTH = 18;
const ARENA_HEIGHT = 32;

// --- UPGRADE SYSTEM (Synced) ---
const MAX_LEVEL = 16;

// Cards required to reach next level (index 0 = level 1->2)
const CARDS_REQUIRED = [
    0, 2, 4, 10, 20, 50, 100, 200, 400, 800, 1000, 1500, 2000, 3000, 5000, 0
];

// Gold cost to reach next level
const UPGRADE_COSTS = [
    0, 5, 20, 50, 150, 400, 1000, 2000, 4000, 8000, 15000, 35000, 75000, 100000, 0, 0
];

const BASE_STATS = {
  hp: 100, damage: 10, hitSpeed: 1, range: 1, speed: 2, 
  deployTime: 1, targetPreference: 'ANY', transport: 'GROUND', 
  count: 1, radius: 0.5, splashRadius: 0
};

// Full Card List Synced with Client
const CARDS = {
  // Arena 0
  'knight': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 600, damage: 75, hitSpeed: 1.5, speed: 3, radius: 0.6 } },
  'archers': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 125, damage: 50, hitSpeed: 1.2, range: 5, count: 2, speed: 3, radius: 0.4, projectileType: 'ARROW' } },
  'goblins': { cost: 2, type: 'TROOP', stats: { ...BASE_STATS, hp: 70, damage: 50, hitSpeed: 1.1, count: 3, speed: 4.5, radius: 0.4 } },
  'giant': { cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 2000, damage: 150, hitSpeed: 1.5, speed: 1.5, targetPreference: 'BUILDINGS', radius: 1.0 } },
  'minions': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 200, damage: 90, hitSpeed: 1.1, count: 3, speed: 4.5, transport: 'AIR', radius: 0.5, projectileType: 'STANDARD' } },
  'fireball': { cost: 4, type: 'SPELL', stats: { ...BASE_STATS, damage: 500, range: 2.5, deployTime: 0, projectileType: 'FIREBALL', knockback: 1.0 } },
  'musketeer': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 300, damage: 150, hitSpeed: 1.5, range: 6, speed: 3, radius: 0.5, projectileType: 'STANDARD' } },

  // Arena 1
  'spear_goblins': { cost: 2, type: 'TROOP', stats: { ...BASE_STATS, hp: 60, damage: 40, hitSpeed: 1.2, range: 5, count: 3, speed: 4.5, radius: 0.4, projectileType: 'ARROW' } },
  'goblin_barrel': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 300, damage: 100, hitSpeed: 1.0, count: 3, speed: 4.5, radius: 0.4 } }, // Treated as Troop that spawns anywhere
  'mini_pekka': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 600, damage: 400, hitSpeed: 1.8, speed: 3, radius: 0.6 } },
  'valkyrie': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 1400, damage: 150, hitSpeed: 1.5, speed: 3, radius: 0.6, splashRadius: 2.0 } },
  'skarmy': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 60, damage: 60, hitSpeed: 1, count: 10, speed: 4, radius: 0.3 } },

  // Arena 3
  'zap': { cost: 2, type: 'SPELL', stats: { ...BASE_STATS, damage: 150, range: 2.5, deployTime: 0, projectileType: 'ZAP', stunDuration: 0.5 } },
  'wizard': { cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 500, damage: 130, hitSpeed: 1.5, range: 5, speed: 3, radius: 0.5, splashRadius: 1.5, projectileType: 'FIREBALL' } },
  'baby_dragon': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 1000, damage: 75, hitSpeed: 1.5, range: 3, speed: 3, transport: 'AIR', radius: 0.7, splashRadius: 1.5, projectileType: 'FIREBALL' } },
  'skeletons': { cost: 1, type: 'TROOP', stats: { ...BASE_STATS, hp: 50, damage: 40, hitSpeed: 1.0, count: 3, speed: 4.5, radius: 0.3 } },
  'hog_rider': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 1300, damage: 150, hitSpeed: 1.5, speed: 4.5, targetPreference: 'BUILDINGS', radius: 0.8 } },

  // Arena 4
  'balloon': { cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 900, damage: 450, hitSpeed: 2.0, speed: 3.5, transport: 'AIR', targetPreference: 'BUILDINGS', radius: 1.0, splashRadius: 2.0 } },
  'prince': { cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 1000, damage: 300, hitSpeed: 1.5, speed: 4.5, radius: 0.7 } },
  'log': { cost: 2, type: 'SPELL', stats: { ...BASE_STATS, damage: 200, range: 10, deployTime: 0, projectileType: 'LOG', knockback: 2.0, piercing: true, speed: 8, splashRadius: 1.2 } },

  // Arena 5
  'pekka': { cost: 7, type: 'TROOP', stats: { ...BASE_STATS, hp: 4000, damage: 600, hitSpeed: 1.8, speed: 1.5, radius: 1.0 } },
  'minion_horde': { cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 200, damage: 90, hitSpeed: 1.1, count: 6, speed: 4.5, transport: 'AIR', radius: 0.5, projectileType: 'STANDARD' } },

  // Arena 6
  'mega_minion': { cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 600, damage: 180, hitSpeed: 1.5, speed: 3, transport: 'AIR', radius: 0.7, projectileType: 'STANDARD' } },

  // Arena 8
  'electro_wizard': { cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 600, damage: 100, hitSpeed: 1.8, range: 5, speed: 3.5, radius: 0.6, projectileType: 'BEAM', maxTargets: 2, stunDuration: 0.5, spawnDamage: 159, splashRadius: 2.0 } },

  // Towers
  'tower_princess': { cost: 0, type: 'BUILDING', stats: { ...BASE_STATS, hp: 2500, damage: 100, hitSpeed: 0.8, range: 7.5, speed: 0, radius: 1.5, projectileType: 'ARROW' } },
  'tower_king': { cost: 0, type: 'BUILDING', stats: { ...BASE_STATS, hp: 4000, damage: 120, hitSpeed: 1, range: 7, speed: 0, radius: 2, projectileType: 'FIREBALL' } }
};

const CHEST_DATA = {
    SILVER: { minGold: 20, maxGold: 50, cards: 3 },
    GOLD: { minGold: 100, maxGold: 300, cards: 10 },
    MAGICAL: { minGold: 400, maxGold: 800, cards: 30 },
    LEGENDARY: { minGold: 0, maxGold: 0, cards: 1 }
};

module.exports = { CARDS, ARENA_WIDTH, ARENA_HEIGHT, UPGRADE_COSTS, CARDS_REQUIRED, CHEST_DATA };
