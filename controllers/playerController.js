const User = require('../models/User');

// --- Helper Functions ---

const getUpgradeCost = (level) => {
    return Math.floor(50 * Math.pow(2, level - 1));
};

const getCardsRequired = (level) => {
    return Math.floor(10 * Math.pow(2, level - 1));
};

const CHEST_CONFIG = {
    'SILVER': { unlockTimeMs: 3 * 60 * 60 * 1000, gold: [20, 50], cards: 3, rares: 0 }, // 3 Hours
    'GOLD': { unlockTimeMs: 8 * 60 * 60 * 1000, gold: [100, 300], cards: 10, rares: 3 }, // 8 Hours
    'MAGICAL': { unlockTimeMs: 12 * 60 * 60 * 1000, gold: [400, 800], cards: 30, rares: 10 } // 12 Hours
};

// --- Controllers ---

exports.upgradeCard = async (req, res) => {
    const { cardId } = req.body;
    try {
        const user = await User.findById(req.user.id);
        const cardIndex = user.ownedCards.findIndex(c => c.id === cardId);
        
        if (cardIndex === -1) {
            return res.status(400).json({ message: "Card not owned" });
        }

        const card = user.ownedCards[cardIndex];
        const cost = getUpgradeCost(card.level);
        const reqCards = getCardsRequired(card.level);

        if (user.gold < cost) return res.status(400).json({ message: "Not enough gold" });
        if (card.count < reqCards) return res.status(400).json({ message: "Not enough cards" });

        // Execute Upgrade
        user.gold -= cost;
        card.count -= reqCards;
        card.level += 1;
        user.xp += 10 * card.level; // Grant XP
        
        // Level up user?
        const xpReq = user.level * 1000;
        if (user.xp >= xpReq) {
            user.level++;
            user.xp -= xpReq;
        }

        await user.save();
        res.json({ 
            success: true, 
            ownedCards: user.ownedCards, 
            gold: user.gold, 
            level: user.level, 
            xp: user.xp 
        });

    } catch (error) {
        throw new Error(error.message);
    }
};

exports.buyShopItem = async (req, res) => {
    const { type, itemId, cost, count, currency } = req.body; // currency: 'GOLD' or 'GEMS'
    try {
        const user = await User.findById(req.user.id);

        if (currency === 'GEMS' && user.gems < cost) return res.status(400).json({ message: "Not enough gems" });
        if (currency === 'GOLD' && user.gold < cost) return res.status(400).json({ message: "Not enough gold" });

        // Deduct
        if (currency === 'GEMS') user.gems -= cost;
        else user.gold -= cost;

        // Grant
        if (type === 'CARD') {
            const card = user.ownedCards.find(c => c.id === itemId);
            if (card) {
                card.count += count;
            } else {
                user.ownedCards.push({ id: itemId, level: 1, count: count });
            }
        } else if (type === 'GOLD') {
            user.gold += count; // Buying gold with gems
        }

        await user.save();
        res.json({ 
            success: true, 
            gold: user.gold, 
            gems: user.gems, 
            ownedCards: user.ownedCards 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.startUnlockChest = async (req, res) => {
    const { chestId } = req.body;
    try {
        const user = await User.findById(req.user.id);
        const chest = user.chests.find(c => c.id === chestId);

        if (!chest) return res.status(404).json({ message: "Chest not found" });
        if (chest.unlockTime) return res.status(400).json({ message: "Chest already unlocking" });
        if (chest.isReady) return res.status(400).json({ message: "Chest is ready to open" });

        // Check if user is already unlocking another chest (limit 1)
        const isUnlockingAny = user.chests.some(c => c.unlockTime !== null && !c.isReady);
        if (isUnlockingAny) return res.status(400).json({ message: "Another chest is currently unlocking" });

        const config = CHEST_CONFIG[chest.type] || CHEST_CONFIG['SILVER'];
        
        // For development/testing: Unlock in 10 seconds instead of hours
        // const unlockDuration = config.unlockTimeMs; 
        const unlockDuration = 10000; 

        chest.unlockTime = new Date(Date.now() + unlockDuration);
        
        await user.save();
        res.json({ success: true, chests: user.chests });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.openChest = async (req, res) => {
    const { chestId } = req.body;
    try {
        const user = await User.findById(req.user.id);
        const chestIndex = user.chests.findIndex(c => c.id === chestId);
        
        if (chestIndex === -1) return res.status(404).json({ message: "Chest not found" });
        
        const chest = user.chests[chestIndex];

        // Logic check: Is it ready?
        const now = new Date();
        const isTimeUp = chest.unlockTime && new Date(chest.unlockTime) <= now;
        
        // Allow instant open with gems logic here if needed, for now strict time
        if (!isTimeUp && !chest.isReady) {
            return res.status(400).json({ message: "Chest not ready yet" });
        }

        // Generate Rewards
        const config = CHEST_CONFIG[chest.type] || CHEST_CONFIG['SILVER'];
        const goldReward = Math.floor(Math.random() * (config.gold[1] - config.gold[0]) + config.gold[0]);
        const gemsReward = Math.floor(Math.random() * 5); // 0-4 gems

        user.gold += goldReward;
        user.gems += gemsReward;

        // Card Rewards Logic (Simplified)
        // In a real app, pick random cards from available pool
        const rewardCards = [];
        const possibleCards = ['knight', 'archers', 'giant', 'musketeer', 'skarmy', 'fireball'];
        
        for(let i=0; i<config.cards; i++) {
            const randomId = possibleCards[Math.floor(Math.random() * possibleCards.length)];
            const existing = user.ownedCards.find(c => c.id === randomId);
            if (existing) {
                existing.count++;
            } else {
                user.ownedCards.push({ id: randomId, level: 1, count: 1 });
            }
            rewardCards.push(randomId);
        }

        // Remove chest
        user.chests.splice(chestIndex, 1);
        
        await user.save();
        
        res.json({ 
            success: true, 
            rewards: { gold: goldReward, gems: gemsReward, cards: rewardCards },
            userProfile: {
                gold: user.gold,
                gems: user.gems,
                ownedCards: user.ownedCards,
                chests: user.chests
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};