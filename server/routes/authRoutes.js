const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/google', authController.googleLogin);
router.put('/profile', requireAuth, authController.updateProfile);
router.get('/profile', requireAuth, authController.getProfile);

module.exports = router;
