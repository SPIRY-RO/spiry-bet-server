const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let androidReceiverSocket = null;
let desktopReceiverSocket = null;

io.on('connection', (socket) => {
    console.log('New client connected');

    // Identify the type of client connecting
    socket.on('clientType', (clientType) => {
        if (clientType === 'Android') {
            console.log('AndroidSender registered');

            // Handle click events from AndroidSender
            socket.on('click', (clickData) => {
                console.log('Received click from AndroidSender:', clickData);

                // Forward click data to AndroidReceiver if connected
                if (androidReceiverSocket) {
                    androidReceiverSocket.emit('click', clickData);
                    console.log('Forwarded click to AndroidReceiver:', clickData);
                }

                // Forward click data to DesktopReceiver if connected
                if (desktopReceiverSocket) {
                    desktopReceiverSocket.emit('click', clickData);
                    console.log('Forwarded click to DesktopReceiver:', clickData);
                }
            });
        } else if (clientType === 'AndroidReceiver') {
            androidReceiverSocket = socket;
            console.log('AndroidReceiver registered');

            // Handle click event from AndroidReceiver (if necessary)
            socket.on('click', (clickData) => {
                console.log('Received click from AndroidReceiver:', clickData);
                // Additional logic for AndroidReceiver clicks (if any) can go here
            });
        } else if (clientType === 'DesktopReceiver') {
            desktopReceiverSocket = socket;
            console.log('DesktopReceiver registered');
            // Handle click event from DesktopReceiver (if necessary)
            socket.on('click', (clickData) => {
                console.log('Received click from DesktopReceiver:', clickData);
                // Additional logic for DesktopReceiver clicks (if any) can go here
            });
        }
    });

    // Handle disconnections
    socket.on('disconnect', () => {
        console.log('Client disconnected');

        // Check if the disconnecting client is AndroidReceiver or DesktopReceiver
        if (socket === androidReceiverSocket) {
            console.log('AndroidReceiver disconnected');
            androidReceiverSocket = null;
        } else if (socket === desktopReceiverSocket) {
            console.log('DesktopReceiver disconnected');
            desktopReceiverSocket = null;
        }
    });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
