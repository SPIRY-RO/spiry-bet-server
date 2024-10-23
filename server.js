const WebSocket = require('ws');
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = new WebSocket.Server({ port: 8080 });

// Mapping to store active sockets by username
let activeSockets = {};
let disconnectStats = {};

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

// Heartbeat function to keep connections alive
function heartbeat() {
    this.isAlive = true;
}

server.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', heartbeat);

    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);
            // Handle incoming messages
        } catch (e) {
            console.log("Error parsing message:", e);
        }
    });

    socket.on('close', (code, reason) => {
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

        // Log disconnect reason
        const reasonText = reason.toString() || 'Unknown reason';
        disconnectStats[reasonText] = (disconnectStats[reasonText] || 0) + 1;
        console.log(`Socket closed with code ${code} and reason: ${reasonText}`);
    });
});

// Ping clients every 30 seconds to check if they are still alive
const interval = setInterval(() => {
    server.clients.forEach((socket) => {
        if (socket.isAlive === false) {
            socket.terminate();
            return;
        }

        socket.isAlive = false;
        socket.ping();
    });
}, 30000);

server.on('close', () => {
    clearInterval(interval);
    // Optionally, write disconnect stats to a file
    fs.writeFileSync('disconnectStats.json', JSON.stringify(disconnectStats, null, 2));
});

app.listen(3001, () => {
    console.log('Express server is running on http://localhost:3000');
});

console.log('WebSocket server is running on ws://localhost:8080');