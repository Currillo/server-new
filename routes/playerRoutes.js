const express = require('express');
const router = express.Router();
const { protect } = require('../utils/auth');
const { upgradeCard, buyShopItem, startUnlockChest, openChest } = require('../controllers/playerController');

router.post('/upgrade', protect, upgradeCard);
router.post('/shop/buy', protect, buyShopItem);
router.post('/chest/unlock', protect, startUnlockChest);
router.post('/chest/open', protect, openChest);

module.exports = router;