require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const stripeRoutes = require('./routes/stripe');
const authRoutes = require('./routes/auth');

const prisma = new PrismaClient();

const app = express();

let isAuthenticated = false;
let clientReady = false;

app.use(cors({
    origin: '*', // Replace with your frontend URL
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json({
    verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/api/stripe/webhook')) {
            req.rawBody = buf.toString();
        }
    },
}));

app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Stripe endpoints
app.use('/api/stripe/', stripeRoutes);

// Auth endpoints
app.use('/api/auth', authRoutes);

// REST API endpoints

app.get('/', async (req, res) => {
    res.json({ message: 'Welcome to the WhatsApp Lead Generation API' });
});

app.get('/api/buckets', async (req, res) => {
    console.log('Fetching buckets');
    try {
        const buckets = await prisma.bucket.findMany({
            include: { _count: { select: { contacts: true } } }
        });
        res.json(buckets.map(bucket => ({
            ...bucket,
            contacts: { length: bucket._count.contacts }
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching buckets' });
    }
});

app.post('/api/buckets', async (req, res) => {
    try {
        const { name } = req.body;
        const newBucket = await prisma.bucket.create({
            data: { name }
        });
        res.json(newBucket);
    } catch (error) {
        res.status(500).json({ error: 'Error creating bucket' });
    }
});

app.get('/api/buckets/:bucketId/contacts', async (req, res) => {
    try {
        const { bucketId } = req.params;
        const contacts = await prisma.contact.findMany({
            where: { bucketId },
        });
        res.json(contacts);
    } catch (error) {
        console.error('Error fetching bucket contacts:', error);
        res.status(500).json({ error: 'Error fetching bucket contacts' });
    }
});

app.post('/api/export', async (req, res) => {
    try {
        const { bucketId, contacts } = req.body;

        // Get existing contacts in the bucket
        const existingContacts = await prisma.contact.findMany({
            where: { bucketId },
            select: { whatsappId: true }
        });

        const existingWhatsappIds = new Set(existingContacts.map(c => c.whatsappId));

        // Filter out contacts that already exist in the bucket
        const newContacts = contacts.filter(contact => !existingWhatsappIds.has(contact.id));

        // Add new contacts to the bucket
        const createdContacts = await prisma.$transaction(
            newContacts.map(contact =>
                prisma.contact.upsert({
                    where: { whatsappId: contact.id },
                    update: {
                        name: contact.name,
                        phoneNumber: contact.phoneNumber,
                        groupId: contact.groupId,
                        groupName: contact.groupName,
                        bucketId: bucketId
                    },
                    create: {
                        whatsappId: contact.id,
                        name: contact.name,
                        phoneNumber: contact.phoneNumber,
                        groupId: contact.groupId,
                        groupName: contact.groupName,
                        bucketId: bucketId
                    }
                })
            )
        );

        res.json({
            message: 'Contacts exported successfully',
            addedContacts: createdContacts.length,
            skippedContacts: contacts.length - createdContacts.length
        });
    } catch (error) {
        console.error('Error exporting contacts:', error);
        res.status(500).json({ error: 'Error exporting contacts', details: error.message });
    }
});

// Get all message templates
app.get('/api/message-templates', async (req, res) => {
    try {
        const templates = await prisma.messageTemplate.findMany();
        console.log('Templates:', templates);
        res.json(templates);
    } catch (error) {
        console.error('Error fetching message templates:', error);
        res.status(500).json({ error: 'Error fetching message templates' });
    }
});

// Create a new message template
app.post('/api/message-templates', async (req, res) => {
    try {
        const { title, message } = req.body;
        const newTemplate = await prisma.messageTemplate.create({
            data: { title, message },
        });
        res.json(newTemplate);
    } catch (error) {
        console.error('Error creating message template:', error);
        res.status(500).json({ error: 'Error creating message template' });
    }
});

// Get a specific message template
app.get('/api/message-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const template = await prisma.messageTemplate.findUnique({
            where: { id },
        });
        if (template) {
            res.json(template);
        } else {
            res.status(404).json({ error: 'Message template not found' });
        }
    } catch (error) {
        console.error('Error fetching message template:', error);
        res.status(500).json({ error: 'Error fetching message template' });
    }
});

// Update a message template
app.put('/api/message-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, message } = req.body;
        const updatedTemplate = await prisma.messageTemplate.update({
            where: { id },
            data: { title, message },
        });
        res.json(updatedTemplate);
    } catch (error) {
        console.error('Error updating message template:', error);
        res.status(500).json({ error: 'Error updating message template' });
    }
});

// Delete a message template
app.delete('/api/message-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.messageTemplate.delete({
            where: { id },
        });
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting message template:', error);
        res.status(500).json({ error: 'Error deleting message template' });
    }
});

app.get('/api/client-status', (req, res) => {
    res.json({
        isReady: clientReady,
        isAuthenticated: isAuthenticated
    });
});

// Whatsapp Auth endpoints

app.post('/api/whatsapp-auth/session-exists', async (req, res) => {
    const { userId, session } = req.body;
    const sessionPath = path.join(__dirname, 'whatsapp-sessions', `${userId}_${session}.zip`);

    if (fs.existsSync(sessionPath)) {
        res.json({ exists: true });
    } else {
        res.json({ exists: false });
    }
});

app.post('/api/whatsapp-auth/:userId/:session', async (req, res) => {
    const { userId, session } = req.params;
    const sessionPath = path.join(__dirname, 'whatsapp-sessions', `${userId}_${session}.zip`);

    fs.writeFileSync(sessionPath, req.body.data);
    res.status(200).json({ message: 'Session saved successfully' });
});

app.delete('/api/whatsapp-auth/:userId/:session', async (req, res) => {
    const { userId, session } = req.params;
    const sessionPath = path.join(__dirname, 'whatsapp-sessions', `${userId}_${session}.zip`);

    if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
        res.status(200).json({ message: 'Session deleted successfully' });
    } else {
        res.status(404).json({ message: 'Session not found' });
    }
});

app.post('/api/whatsapp-auth/verify', async (req, res) => {
    const { session, userId } = req.body;
    try {
        const whatsappAuth = await prisma.whatsappAuth.findFirst({
            where: {
                session: session,
                userId: userId
            }
        });
        if (whatsappAuth) {
            res.json({ isValid: true });
        } else {
            res.json({ isValid: false });
        }
    } catch (error) {
        console.error('Error verifying WhatsApp session:', error);
        res.status(500).json({ error: 'Failed to verify WhatsApp session' });
    }
});

app.post('/api/whatsapp-auth/save', async (req, res) => {
    const { userId, session, data } = req.body;
    try {
        // Ensure the directory exists
        const sessionDir = path.join(__dirname, 'whatsapp-sessions');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Save the session data
        console.log("Saving session data", data);
        const sessionPath = path.join(sessionDir, `${session}.json`);
        fs.writeFileSync(sessionPath, data);  // data should already be a string

        // Update or create the WhatsappAuth entry in the database
        await prisma.whatsappAuth.upsert({
            where: {
                userId: userId
            },
            update: {
                session: session
            },
            create: {
                userId: userId,
                session: session
            }
        });

        res.status(200).json({ message: 'Session saved successfully' });
    } catch (error) {
        console.error('Error saving WhatsApp session:', error);
        res.status(500).json({ error: 'Failed to save WhatsApp session', details: error.message });
    }
});


app.listen(5000, () => {
    console.log('Server is running on port 5000');
});

