
const express = require('express');
const router = express.Router();
const { protect } = require('../utils/auth');
const { registerUser, loginUser, getUserProfile, updateDeck, updateProfile } = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/profile', protect, getUserProfile);
router.put('/deck', protect, updateDeck);
router.put('/updateProfile', protect, updateProfile); // New Route

module.exports = router;
