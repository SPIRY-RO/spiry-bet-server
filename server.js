const uWS = require('uWebSockets.js');
const fastify = require('fastify')({ logger: true });
const fs = require('fs').promises; // Use promises for async file operations
const readline = require('readline');
const fastifyCors = require('@fastify/cors');
const fastifyFormbody = require('@fastify/formbody');

const port = 8080;
const RECEIVER_TOPIC = 'receivers'; // Single topic for all receivers

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
  origin: '*', // Adjust the origin as needed
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
        const ipArrayBuffer = ws.getRemoteAddressAsText();
        const ip = Buffer.from(ipArrayBuffer).toString();
        const readableIp = ip.replace(/[^0-9.]/g, ''); // Convert to readable IPv4 format
        console.log("Socket is connected from IP:", readableIp);
        ws.ip = readableIp;
        ws.subscribe(RECEIVER_TOPIC); // Subscribe all receivers to the single topic
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
                        console.log(`${role} socket registered for user: ${username}`);
                    }
                } else {
                    console.log("Username is required for registration.");
                }
            } else if (parsedMessage.type === 'signal') {
                const { action } = parsedMessage;

                // Publish the signal to all receivers
                app.publish(RECEIVER_TOPIC, action, false, false);
                console.log(`Publishing message to all receivers: ${action}`);
                logClickData('all_receivers', action);
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