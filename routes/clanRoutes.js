const express = require('express');
const router = express.Router();
const { protect } = require('../utils/auth');
const { createClan, joinClan, getClanDetails, searchClans } = require('../controllers/clanController');

router.post('/create', protect, createClan);
router.post('/join', protect, joinClan);
router.get('/my', protect, getClanDetails);
router.get('/search', protect, searchClans);

module.exports = router;