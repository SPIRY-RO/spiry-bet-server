const uWS = require('uWebSockets.js');
const fastify = require('fastify')({ logger: true });
const fs = require('fs').promises; // Use promises for async file operations
const readline = require('readline');
const fastifyCors = require('@fastify/cors');
const fastifyFormbody = require('@fastify/formbody');
const ip = require('ip');
const geoip = require('geoip-lite');

const port = 8080;
const UP_RECEIVER_TOPIC = 'up_receivers'; // Topic for up_ receivers
const DOWN_RECEIVER_TOPIC = 'down_receivers'; // Topic for down_ receivers

// Mapping to store active sockets by username
let activeSockets = {};

// Load accounts data asynchronously
let accounts = [];
async function loadAccounts() {
    try {
        const data = await fs.readFile('accounts.json', 'utf8');
        accounts = JSON.parse(data);
        console.log('Accounts loaded successfully:', accounts);
    } catch (err) {
        console.error('Error reading or parsing accounts.json:', err);
    }
}
loadAccounts();

// Fastify setup
fastify.register(fastifyCors, {
  origin: '*', // Allow any origin
  methods: ['GET', 'POST'] // Adjust the methods as needed
});
fastify.register(fastifyFormbody);

// Login endpoint
fastify.post('/login', (request, reply) => {
    console.log("Login request received:", request.body);

    const { username, password } = request.body;

    // Validate input
    if (!username || !password) {
        return reply.status(400).send({ success: false, message: 'Username and password are required' });
    }

    // Find the user in the accounts list
    const user = accounts.find(account => account.username === username && account.password === password);

    if (user) {
        reply.status(200).send({ success: true, message: 'Login successful' });
    } else {
        reply.status(401).send({ success: false, message: 'Invalid credentials' });
    }
});

// Start the Fastify server
fastify.listen({ port: 3001, host: '0.0.0.0' }) // Bind to all network interfaces
  .then((address) => {
    fastify.log.info(`Server listening on ${address}`);
  })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });

// WebSocket setup using uWebSockets.js
const app = uWS.App();

app.ws('/*', {
    open: (ws, req) => {
        let ipAddress = req.getHeader('x-forwarded-for');
        if (!ipAddress) {
            const ipArrayBuffer = ws.getRemoteAddressAsText();
            ipAddress = ip.toString(Buffer.from(ipArrayBuffer).toString('utf8').replace(/\0/g, ''));
        }
        const geo = geoip.lookup(ipAddress);

        console.log("Socket is connected from IP:", ipAddress);
        if (geo) {
            console.log(`Country: ${geo.country}, Region: ${geo.region}`);
        }

        ws.ip = ipAddress;
        ws.pingInterval = setInterval(() => {
            ws.ping();
            for (let [username, sockets] of Object.entries(activeSockets)) {
                sockets.forEach(s => {
                    if (s.socket === ws) {
                        if (Date.now() - s.lastPing > 10000) {
                            s.missedPongs++;
                        }
                        s.lastPing = Date.now();
                    }
                });
            }
        }, 10000);
    },
    message: (ws, message, isBinary) => {
        try {
            const parsedMessage = JSON.parse(Buffer.from(message).toString());
            console.log("Message received:", parsedMessage);

            if (parsedMessage.type === 'register') {
                const { role, username } = parsedMessage;
                if (username) {
                    if (role == "receiver") {
                        // Register socket with username
                        if (!activeSockets[username]) {
                            activeSockets[username] = [];
                        }
                        activeSockets[username].push({ socket: ws, ip: ws.ip, ping: 0, missedPongs: 0 });

                        // Subscribe to the appropriate topic based on the username prefix
                        if (username.startsWith('up_')) {
                            ws.subscribe(UP_RECEIVER_TOPIC);
                        } else if (username.startsWith('down_')) {
                            ws.subscribe(DOWN_RECEIVER_TOPIC);
                        }

                        console.log(`${role} socket registered for user: ${username}`);
                    }
                } else {
                    console.log("Username is required for registration.");
                }
            } else if (parsedMessage.type === 'signal') {
                const { action, username: sender } = parsedMessage;

                if (!sender) {
                    console.log("Sender is required for signal messages.");
                    return;
                }

                console.log(`Signal received from sender: ${sender}`);

                // Determine the topic based on the sender's prefix
                let topic;
                if (sender.startsWith('up_')) {
                    topic = UP_RECEIVER_TOPIC;
                } else if (sender.startsWith('down_')) {
                    topic = DOWN_RECEIVER_TOPIC;
                }

                // Publish the signal to the appropriate topic
                if (topic) {
                    app.publish(topic, action, false, false);
                    console.log(`Publishing message to ${topic}: ${action}`);
                    logClickData(sender, action);
                } else {
                    console.log("Invalid sender prefix.");
                }
            }
        } catch (e) {
            console.log("Error parsing message:", e);
        }
    },
    close: (ws) => {
        // Remove socket from activeSockets if closed
        for (let [username, sockets] of Object.entries(activeSockets)) {
            const index = sockets.findIndex(s => s.socket === ws);
            if (index !== -1) {
                sockets.splice(index, 1);
                console.log(`Socket for user ${username} has been closed and removed.`);
                if (sockets.length === 0) {
                    delete activeSockets[username];
                }
                break;
            }
        }
        clearInterval(ws.pingInterval);
    },
    pong: (ws) => {
        const now = Date.now();
        for (let [username, sockets] of Object.entries(activeSockets)) {
            sockets.forEach(s => {
                if (s.socket === ws) {
                    s.ping = now - s.lastPing;
                    s.missedPongs = 0; // Reset missed pongs on successful pong
                }
            });
        }
    }
}).listen(port, (token) => {
    if (token) {
        console.log(`WebSocket server is running on ws://localhost:${port}`);
    } else {
        console.log(`Failed to listen to port ${port}`);
    }
});

// Function to log click data
async function logClickData(username, action) {
    const timestamp = new Date().toISOString();
    const logMessage = `User: ${username}, Action: ${action}, Timestamp: ${timestamp}`;
    console.log(logMessage);
    try {
        await fs.appendFile('clicks.log', logMessage + '\n');
    } catch (err) {
        console.error('Error logging click data:', err);
    }
}

// ASCII panel to display connected clients and their ping times
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

setInterval(() => {
    console.clear();
    console.log('Connected Clients:');
    console.log('Username\tIP Address\tPing (ms)\tMissed Pongs');
    for (let [username, sockets] of Object.entries(activeSockets)) {
        sockets.forEach(s => {
            console.log(`${username}\t${s.ip}\t${s.ping}\t${s.missedPongs}`);
        });
    }
}, 5000);