
// Shared constants between client and server logic

const ARENA_WIDTH = 18;
const ARENA_HEIGHT = 32;

// --- UPGRADE SYSTEM (Synced) ---
const MAX_LEVEL = 14;

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
  count: 1, radius: 0.5, splashRadius: 0, projectileType: 'STANDARD'
};

// Full Card List Synced with Client (Stats aligned to Lvl 9 Standard feel)
const CARDS = {
  // Arena 0
  'knight': { id: 'knight', name: 'Knight', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 1000, damage: 120, hitSpeed: 1.2, speed: 3, radius: 0.6 } },
  'archers': { id: 'archers', name: 'Archers', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 180, damage: 70, hitSpeed: 1.2, range: 5, count: 2, speed: 3, radius: 0.4, projectileType: 'ARROW' } },
  'goblins': { id: 'goblins', name: 'Goblins', cost: 2, type: 'TROOP', stats: { ...BASE_STATS, hp: 120, damage: 80, hitSpeed: 1.1, count: 3, speed: 5, radius: 0.4 } },
  'giant': { id: 'giant', name: 'Giant', cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 2400, damage: 160, hitSpeed: 1.5, speed: 1.5, targetPreference: 'BUILDINGS', radius: 1.2 } },
  'minions': { id: 'minions', name: 'Minions', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 130, damage: 60, hitSpeed: 1.0, count: 3, speed: 4.5, transport: 'AIR', radius: 0.5, projectileType: 'STANDARD' } },
  'fireball': { id: 'fireball', name: 'Fireball', cost: 4, type: 'SPELL', stats: { ...BASE_STATS, damage: 350, range: 2.5, deployTime: 0, projectileType: 'FIREBALL', knockback: 1.5 } },
  'musketeer': { id: 'musketeer', name: 'Musketeer', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 450, damage: 130, hitSpeed: 1.1, range: 6, speed: 3, radius: 0.5, projectileType: 'STANDARD' } },

  // Arena 1
  'spear_goblins': { id: 'spear_goblins', name: 'Spear Goblins', cost: 2, type: 'TROOP', stats: { ...BASE_STATS, hp: 80, damage: 45, hitSpeed: 1.3, range: 5, count: 3, speed: 5, radius: 0.4, projectileType: 'ARROW' } },
  'goblin_barrel': { id: 'goblin_barrel', name: 'Goblin Barrel', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 120, damage: 80, hitSpeed: 1.1, count: 3, speed: 5, radius: 0.4 } }, 
  'mini_pekka': { id: 'mini_pekka', name: 'Mini P.E.K.K.A', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 800, damage: 400, hitSpeed: 1.8, speed: 4, radius: 0.6 } },
  'valkyrie': { id: 'valkyrie', name: 'Valkyrie', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 1200, damage: 150, hitSpeed: 1.5, speed: 3, radius: 0.6, splashRadius: 2.0 } },
  'skarmy': { id: 'skarmy', name: 'Skeleton Army', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 50, damage: 50, hitSpeed: 1, count: 12, speed: 4, radius: 0.25 } },

  // Arena 3
  'zap': { id: 'zap', name: 'Zap', cost: 2, type: 'SPELL', stats: { ...BASE_STATS, damage: 120, range: 2.5, deployTime: 0, projectileType: 'ZAP', stunDuration: 0.5 } },
  'wizard': { id: 'wizard', name: 'Wizard', cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 450, damage: 160, hitSpeed: 1.4, range: 5, speed: 3, radius: 0.5, splashRadius: 1.5, projectileType: 'FIREBALL' } },
  'baby_dragon': { id: 'baby_dragon', name: 'Baby Dragon', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 800, damage: 100, hitSpeed: 1.6, range: 3.5, speed: 3.5, transport: 'AIR', radius: 0.8, splashRadius: 1.5, projectileType: 'FIREBALL' } },
  'skeletons': { id: 'skeletons', name: 'Skeletons', cost: 1, type: 'TROOP', stats: { ...BASE_STATS, hp: 50, damage: 50, hitSpeed: 1.0, count: 3, speed: 4.5, radius: 0.25 } },
  'hog_rider': { id: 'hog_rider', name: 'Hog Rider', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 1000, damage: 180, hitSpeed: 1.6, speed: 5.5, targetPreference: 'BUILDINGS', radius: 0.8 } },

  // Arena 4
  'balloon': { id: 'balloon', name: 'Balloon', cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 1000, damage: 600, hitSpeed: 3.0, speed: 3, transport: 'AIR', targetPreference: 'BUILDINGS', radius: 1.2, splashRadius: 2.0 } },
  'prince': { id: 'prince', name: 'Prince', cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 1100, damage: 250, hitSpeed: 1.5, speed: 4, radius: 0.7 } },
  'log': { id: 'log', name: 'The Log', cost: 2, type: 'SPELL', stats: { ...BASE_STATS, damage: 200, range: 10, deployTime: 0, projectileType: 'LOG', knockback: 2.0, piercing: true, speed: 8, splashRadius: 1.0 } },

  // Arena 5
  'pekka': { id: 'pekka', name: 'P.E.K.K.A', cost: 7, type: 'TROOP', stats: { ...BASE_STATS, hp: 2400, damage: 600, hitSpeed: 1.8, speed: 1.5, radius: 1.2 } },
  'minion_horde': { id: 'minion_horde', name: 'Minion Horde', cost: 5, type: 'TROOP', stats: { ...BASE_STATS, hp: 130, damage: 60, hitSpeed: 1.0, count: 6, speed: 4.5, transport: 'AIR', radius: 0.5, projectileType: 'STANDARD' } },

  // Arena 6
  'mega_minion': { id: 'mega_minion', name: 'Mega Minion', cost: 3, type: 'TROOP', stats: { ...BASE_STATS, hp: 500, damage: 200, hitSpeed: 1.6, speed: 3, transport: 'AIR', radius: 0.7, projectileType: 'STANDARD' } },

  // Arena 8
  'electro_wizard': { id: 'electro_wizard', name: 'Electro Wizard', cost: 4, type: 'TROOP', stats: { ...BASE_STATS, hp: 500, damage: 120, hitSpeed: 1.8, range: 5, speed: 3.5, radius: 0.6, projectileType: 'BEAM', maxTargets: 2, stunDuration: 0.5, spawnDamage: 120, splashRadius: 1.5 } },

  // Towers
  'tower_princess': { id: 'tower_princess', name: 'Princess Tower', cost: 0, type: 'BUILDING', stats: { ...BASE_STATS, hp: 1600, damage: 70, hitSpeed: 0.8, range: 7.5, speed: 0, radius: 1.5, projectileType: 'ARROW' } },
  'tower_king': { id: 'tower_king', name: 'King Tower', cost: 0, type: 'BUILDING', stats: { ...BASE_STATS, hp: 2800, damage: 80, hitSpeed: 1, range: 7, speed: 0, radius: 2, projectileType: 'FIREBALL' } }
};

const CHEST_DATA = {
    SILVER: { minGold: 20, maxGold: 50, cards: 3 },
    GOLD: { minGold: 100, maxGold: 300, cards: 10 },
    MAGICAL: { minGold: 400, maxGold: 800, cards: 30 },
    LEGENDARY: { minGold: 0, maxGold: 0, cards: 1 }
};

module.exports = { CARDS, ARENA_WIDTH, ARENA_HEIGHT, UPGRADE_COSTS, CARDS_REQUIRED, CHEST_DATA };
