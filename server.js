const WebSocket = require('ws');
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = new WebSocket.Server({ port: 8080 });

// Mapping to store active sockets by username
let activeSockets = {};

// Load accounts data
let accounts = [];
fs.readFile('accounts.json', 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading accounts.json:', err);
    } else {
        try {
            accounts = JSON.parse(data);
            console.log('Accounts loaded successfully:', accounts);
        } catch (parseError) {
            console.error('Error parsing accounts.json:', parseError);
        }
    }
});

// Express setup
app.use(cors());
app.use(bodyParser.json());

// Login endpoint
app.post('/login', (req, res) => {
    console.log("Login request received:", req.body);

    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    // Find the user in the accounts list
    const user = accounts.find(account => account.username === username && account.password === password);

    if (user) {
        res.status(200).json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Start the Express server
app.listen(3001, () => {
    console.log('Express server is running on http://localhost:3000');
});

// WebSocket setup
server.on('connection', (socket) => {
    console.log("Socket is connected.");

    socket.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            console.log("Message received:", parsedMessage);

            if (parsedMessage.type === 'register') {
                const { role, username } = parsedMessage;
                if (username) {
                    if (role == "receiver") {
                        // Register socket with username
                        if (!activeSockets[username]) {
                            activeSockets[username] = [];
                        }
                        activeSockets[username].push(socket);
                        console.log(`${role} socket registered for user: ${username}`);
                    }
                } else {
                    console.log("Username is required for registration.");
                }
            } else if (parsedMessage.type === 'signal') {
                let { usernames, username, action } = parsedMessage;

                // Normalize usernames to an array
                if (!usernames && username) {
                    usernames = [username];
                }

                // Validate usernames
                if (!Array.isArray(usernames)) {
                    console.log("Invalid usernames format.");
                    return;
                }

                // Check if the usernames exist in accounts
                const validUsernames = usernames.filter(username => 
                    accounts.some(account => account.username === username)
                );

                if (validUsernames.length === 0) {
                    console.log(`None of the usernames exist.`);
                    return;
                }

                // Send the signal to the corresponding sockets
                validUsernames.forEach(username => {
                    if (activeSockets[username]) {
                        activeSockets[username].forEach(socket => {
                            socket.send(action);
                            console.log(`Sending message to ${username}: ${action}`);
                        });
                    } else {
                        console.log(`No active receiver socket found for username: ${username}`);
                    }
                });

                // Special case for impulse1: send the signal twice
                if (activeSockets['impulse1']) {
                    activeSockets['impulse1'].forEach(socket => {
                        socket.send(action);
                        socket.send(action);
                        console.log(`Sending message to impulse1 twice: ${action}`);
                    });
                }
            }
        } catch (e) {
            console.log("Error parsing message:", e);
        }
    });

    socket.on('close', () => {
        // Remove socket from activeSockets if closed
        for (let [username, sockets] of Object.entries(activeSockets)) {
            const index = sockets.indexOf(socket);
            if (index !== -1) {
                sockets.splice(index, 1);
                console.log(`Socket for user ${username} has been closed and removed.`);
                if (sockets.length === 0) {
                    delete activeSockets[username];
                }
                break;
            }
        }
    });
});

console.log('WebSocket server is running on ws://localhost:8080');