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

// Purchases endpoints

app.get('/api/purchases', async (req, res) => {
    console.log('Fetching purchases');
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const purchases = await prisma.purchase.findMany({ where: { userId: user.id } });
        res.json(purchases);
    } catch (error) {
        console.error('Error fetching purchases:', error);
        res.status(500).json({ error: 'Error fetching purchases' });
    }
});

app.get('/api/buckets', async (req, res) => {
    console.log('Fetching buckets');
    try {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const buckets = await prisma.bucket.findMany({
            where: { userId },
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
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const newBucket = await prisma.bucket.create({
            data: { name, userId }
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
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const templates = await prisma.messageTemplate.findMany({
            where: { userId }
        });
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
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const newTemplate = await prisma.messageTemplate.create({
            data: {
                title,
                message,
                user: {
                    connect: { id: userId }
                }
            },
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
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const template = await prisma.messageTemplate.findFirst({
            where: { id, userId },
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
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const updatedTemplate = await prisma.messageTemplate.updateMany({
            where: { id, userId },
            data: { title, message },
        });
        if (updatedTemplate.count === 0) {
            return res.status(404).json({ error: 'Message template not found or you do not have permission to update it' });
        }
        res.json({ message: 'Template updated successfully' });
    } catch (error) {
        console.error('Error updating message template:', error);
        res.status(500).json({ error: 'Error updating message template' });
    }
});

// Delete a message template
app.delete('/api/message-templates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const deletedTemplate = await prisma.messageTemplate.deleteMany({
            where: { id, userId },
        });
        if (deletedTemplate.count === 0) {
            return res.status(404).json({ error: 'Message template not found or you do not have permission to delete it' });
        }
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





app.listen(5000, () => {
    console.log('Server is running on port 5000');
});

