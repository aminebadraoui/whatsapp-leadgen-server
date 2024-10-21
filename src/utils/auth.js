const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');


const generateToken = (userId) => {
    console.log('Generating token for user:', userId);
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
});


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        type: 'OAuth2',
        user: 'contact@leadchatapp.com',
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        accessToken: oauth2Client.getAccessToken(),
    }
});

const sendMagicLink = async (email, token) => {
    console.log('Sending magic link to:', email);
    console.log('Token:', token);

    const magicLink = `${process.env.CLIENT_URL}/auth?token=${token}`;

    try {
        await transporter.sendMail({
            from: '"Lead Chat App" <contact@leadchatapp.com>',
            to: email,
            subject: 'Your Magic Link for Lead Chat App',
            html: `
          <h1>Welcome to Lead Chat App!</h1>
          <p>Click the button below to log in:</p>
          <a href="${magicLink}" style="background-color: #4CAF50; border: none; color: white; padding: 15px 32px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; margin: 4px 2px; cursor: pointer;">Log In</a>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${magicLink}</p>
          <p>This link will expire in 1 hour for security reasons.</p>
          <p>If you didn't request this login link, please ignore this email.</p>
        `
        });
        console.log('Magic link email sent successfully');
    } catch (error) {
        console.error('Error sending magic link email:', error);
        throw new Error('Failed to send magic link email');
    }
};

module.exports = { sendMagicLink };

module.exports = { generateToken, sendMagicLink };