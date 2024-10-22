const express = require('express');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { sendMagicLink } = require('../utils/auth');


const router = express.Router();
const prisma = new PrismaClient();

router.post('/verify-token', async (req, res) => {
    console.log('Authenticating user');
    console.log(req.body);

    const { token } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate a new token for the authenticated session
        const sessionToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ token: sessionToken, user: { email: user.email, userId: user.id } });
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});

// New route for sending magic link
router.post('/send-magic-link', async (req, res) => {
    const { email } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        await sendMagicLink(email, token);

        res.json({ message: 'Magic link sent successfully' });
    } catch (error) {
        console.error('Error sending magic link:', error);
        res.status(500).json({ error: 'Failed to send magic link' });
    }
});

module.exports = router;