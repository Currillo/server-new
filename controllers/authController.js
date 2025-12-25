
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

exports.registerUser = async (req, res) => {
  const { username, password } = req.body;
  try {
    const userExists = await User.findOne({ username });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Initial starter cards
    const starterCards = [
      { id: 'knight', level: 1, count: 0 },
      { id: 'archers', level: 1, count: 0 },
      { id: 'giant', level: 1, count: 0 },
      { id: 'musketeer', level: 1, count: 0 },
      { id: 'mini_pekka', level: 1, count: 0 },
      { id: 'baby_dragon', level: 1, count: 0 },
      { id: 'prince', level: 1, count: 0 },
      { id: 'fireball', level: 1, count: 0 },
      { id: 'valkyrie', level: 1, count: 0 },
      { id: 'wizard', level: 1, count: 0 },
      { id: 'electro_wizard', level: 1, count: 0 },
      { id: 'skeletons', level: 1, count: 0 },
      { id: 'goblins', level: 1, count: 0 },
      { id: 'spear_goblins', level: 1, count: 0 },
      { id: 'minions', level: 1, count: 0 },
      { id: 'minion_horde', level: 1, count: 0 },
      { id: 'hog_rider', level: 1, count: 0 },
      { id: 'goblin_barrel', level: 1, count: 0 },
      { id: 'balloon', level: 1, count: 0 },
      { id: 'mega_minion', level: 1, count: 0 },
      { id: 'pekka', level: 1, count: 0 }
    ];

    const user = await User.create({
      username,
      password: hashedPassword,
      ownedCards: starterCards,
      currentDeck: ['knight', 'archers', 'giant', 'musketeer', 'mini_pekka', 'baby_dragon', 'prince', 'fireball']
    });

    res.status(201).json({
      _id: user.id,
      username: user.username,
      token: generateToken(user.id),
      profile: {
          _id: user.id,
          name: user.username,
          gold: user.gold,
          gems: user.gems,
          level: user.level,
          ownedCards: user.ownedCards,
          currentDeck: user.currentDeck,
          trophies: user.trophies,
          chests: user.chests,
          friends: user.friends,
          friendRequests: user.friendRequests,
          clanId: user.clanId,
          description: user.description,
          bannerId: user.bannerId,
          badges: user.badges
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.loginUser = async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user.id,
        username: user.username,
        token: generateToken(user.id),
        profile: {
            _id: user.id,
            name: user.username,
            gold: user.gold,
            gems: user.gems,
            level: user.level,
            ownedCards: user.ownedCards,
            currentDeck: user.currentDeck,
            trophies: user.trophies,
            chests: user.chests,
            friends: user.friends,
            friendRequests: user.friendRequests,
            clanId: user.clanId,
            description: user.description,
            bannerId: user.bannerId,
            badges: user.badges
        }
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getUserProfile = async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
};

exports.updateDeck = async (req, res) => {
    const { deck } = req.body;
    if (!deck || deck.length !== 8) {
        return res.status(400).json({ message: "Deck must contain 8 cards" });
    }
    const user = await User.findById(req.user.id);
    user.currentDeck = deck;
    await user.save();
    res.json({ success: true, currentDeck: user.currentDeck });
};

// New Controller Method
exports.updateProfile = async (req, res) => {
    const { name, description, bannerId, badges } = req.body;
    const user = await User.findById(req.user.id);
    
    if (user) {
        // Name check (simple uniqueness check simulation)
        if (name && name !== user.username) {
            const exists = await User.findOne({ username: name });
            if (exists) return res.status(400).json({ message: "Name taken" });
            user.username = name;
        }
        
        user.description = description || user.description;
        user.bannerId = bannerId || user.bannerId;
        user.badges = badges || user.badges;
        
        await user.save();
        
        // Return full profile similar to login
        res.json({ 
            success: true, 
            profile: {
                _id: user.id,
                name: user.username,
                gold: user.gold,
                gems: user.gems,
                level: user.level,
                ownedCards: user.ownedCards,
                currentDeck: user.currentDeck,
                trophies: user.trophies,
                chests: user.chests,
                friends: user.friends,
                friendRequests: user.friendRequests,
                clanId: user.clanId,
                description: user.description,
                bannerId: user.bannerId,
                badges: user.badges
            }
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};
