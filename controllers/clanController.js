const Clan = require('../models/Clan');
const User = require('../models/User');

exports.createClan = async (req, res) => {
    const { name, description } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (user.clanId) return res.status(400).json({ message: "Already in a clan" });
        if (user.gold < 1000) return res.status(400).json({ message: "Not enough gold (1000 required)" });

        const existing = await Clan.findOne({ name });
        if (existing) return res.status(400).json({ message: "Clan name taken" });

        const clan = await Clan.create({
            name,
            description,
            leader: user._id,
            members: [user._id]
        });

        user.gold -= 1000;
        user.clanId = clan._id;
        await user.save();

        res.status(201).json(clan);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.joinClan = async (req, res) => {
    const { clanId } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (user.clanId) return res.status(400).json({ message: "Already in a clan" });

        const clan = await Clan.findById(clanId);
        if (!clan) return res.status(404).json({ message: "Clan not found" });
        if (clan.members.length >= 50) return res.status(400).json({ message: "Clan is full" });

        clan.members.push(user._id);
        await clan.save();

        user.clanId = clan._id;
        await user.save();

        res.json({ success: true, clan });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getClanDetails = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.clanId) return res.json(null);

        const clan = await Clan.findById(user.clanId).populate('members', 'username trophies level');
        res.json(clan);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.searchClans = async (req, res) => {
    try {
        const clans = await Clan.find().limit(20).populate('members', 'username'); // Simple list
        res.json(clans);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};