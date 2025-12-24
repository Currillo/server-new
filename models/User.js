const mongoose = require('mongoose');

const CardSchema = new mongoose.Schema({
  id: { type: String, required: true },
  level: { type: Number, default: 1 },
  count: { type: Number, default: 0 }, // Cards collected towards next upgrade
  rarity: { type: String, enum: ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'], default: 'COMMON' }
}, { _id: false });

const ChestSchema = new mongoose.Schema({
  id: { type: String, default: () => Math.random().toString(36).substr(2, 9) },
  type: { type: String, enum: ['SILVER', 'GOLD', 'MAGICAL'], default: 'SILVER' },
  unlockTime: { type: Date, default: null }, // Null if not unlocking, Date if unlocking
  isReady: { type: Boolean, default: false }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // Economy
  gold: { type: Number, default: 1000 },
  gems: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  trophies: { type: Number, default: 0 },

  // Gameplay
  ownedCards: [CardSchema],
  currentDeck: { 
    type: [String], 
    default: ['knight', 'archers', 'giant', 'musketeer', 'skarmy', 'fireball', 'knight', 'archers'] 
  },
  chests: { type: [ChestSchema], default: [] }, // Max 4 slots

  // Social
  clanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', default: null },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);