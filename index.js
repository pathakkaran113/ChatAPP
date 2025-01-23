const http = require("http");
const express = require("express");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// User database with their keys and phone numbers
const USERS_DB = {
    'apple': { username: 'Karan', phone: '1234567890', friends: new Set() },
    'banana': { username: 'Chhavi', phone: '2345678901', friends: new Set() },
    'papaya': { username: 'Rohit', phone: '3456789012', friends: new Set() },
    'mango': { username: 'Mohit', phone: '4567890123', friends: new Set() },
    'grape': { username: 'Akshat', phone: '5678901234', friends: new Set() },
    'orange': { username: 'Bhavesh', phone: '6789012345', friends: new Set() },
    'kiwi': { username: 'Vanshika', phone: '7890123456', friends: new Set() },
    'cherry': { username: 'Kratika', phone: '8901234567', friends: new Set() },
    'peach': { username: 'Vaibhav', phone: '9012345678', friends: new Set() },
    'pear': { username: 'Uditi', phone: '0123456789', friends: new Set() },
    'plum': { username: 'Palak', phone: '1122334455', friends: new Set() },
    'fig': { username: 'Neha', phone: '2233445566', friends: new Set() },
    'date': { username: 'Tanay', phone: '3344556677', friends: new Set() },
    'lime': { username: 'Devangi', phone: '4455667788', friends: new Set() },
    'lemon': { username: 'Shradha', phone: '5566778899', friends: new Set() },
    'potato': { username: 'Aman', phone: '5566778811', friends: new Set() }
};

// Reverse lookup for phone numbers to keys
const PHONE_TO_KEY = Object.entries(USERS_DB).reduce((acc, [key, data]) => {
    acc[data.phone] = key;
    return acc;
}, {});

// Store private messages between users
const privateMessages = {};

// Store online users
const onlineUsers = new Set();

// Store socket id mapping
const userSocketMap = new Map();

// Maximum messages to store per chat
const MAX_MESSAGES = 100;

// Helper function to get or create chat history
function getChatHistory(user1, user2) {
    const chatId = [user1, user2].sort().join(':');
    if (!privateMessages[chatId]) {
        privateMessages[chatId] = [];
    }
    return privateMessages[chatId];
}

// Helper function to get socket id for a username
function getUserSocketId(username) {
    return userSocketMap.get(username);
}

// Socket.io with authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (USERS_DB[token]) {
        socket.username = USERS_DB[token].username;
        socket.userKey = token;
        next();
    } else {
        next(new Error("Authentication failed"));
    }
});

io.on("connection", (socket) => {
    console.log(`User ${socket.username} connected`);
    onlineUsers.add(socket.username);
    userSocketMap.set(socket.username, socket.id);

    // Send user info immediately after connection
    socket.emit("user-info", {
        username: socket.username,
        phone: USERS_DB[socket.userKey].phone
    });

    // Broadcast user connection to other users
    socket.broadcast.emit("user-connected", socket.username);

    // Send current user's friend list
    socket.emit("friend-list", {
        friends: Array.from(USERS_DB[socket.userKey].friends).map(phone => ({
            username: USERS_DB[PHONE_TO_KEY[phone]].username,
            phone: phone,
            online: onlineUsers.has(USERS_DB[PHONE_TO_KEY[phone]].username)
        }))
    });

    // Handle add friend request
    socket.on("add-friend", (phoneNumber) => {
        if (PHONE_TO_KEY[phoneNumber]) {
            if (phoneNumber === USERS_DB[socket.userKey].phone) {
                socket.emit("friend-error", "You cannot add yourself as a friend");
                return;
            }
            USERS_DB[socket.userKey].friends.add(phoneNumber);
            socket.emit("friend-added", {
                username: USERS_DB[PHONE_TO_KEY[phoneNumber]].username,
                phone: phoneNumber,
                online: onlineUsers.has(USERS_DB[PHONE_TO_KEY[phoneNumber]].username)
            });
        } else {
            socket.emit("friend-error", "User not found");
        }
    });

    // Handle remove friend request
    socket.on("remove-friend", (phoneNumber) => {
        USERS_DB[socket.userKey].friends.delete(phoneNumber);
        socket.emit("friend-removed", phoneNumber);
    });

    // Handle private messages
    socket.on("private-message", (data) => {
        const recipientKey = PHONE_TO_KEY[data.to];
        if (!recipientKey || !USERS_DB[socket.userKey].friends.has(data.to)) {
            return;
        }

        const messageData = {
            from: socket.username,
            fromPhone: USERS_DB[socket.userKey].phone,
            to: USERS_DB[recipientKey].username,
            toPhone: data.to,
            message: data.message,
            timestamp: new Date().toISOString(),
            messageId: Date.now().toString() + Math.random().toString(36).substr(2, 9)
        };

        // Store message in chat history
        const chatHistory = getChatHistory(socket.username, USERS_DB[recipientKey].username);
        chatHistory.push(messageData);

        if (chatHistory.length > MAX_MESSAGES) {
            chatHistory.shift();
        }

        socket.emit("private-message", messageData);
        const recipientSocket = getUserSocketId(USERS_DB[recipientKey].username);
        if (recipientSocket) {
            io.to(recipientSocket).emit("private-message", messageData);
        }
    });

    // Handle chat history request
    socket.on("get-chat-history", (data) => {
        const recipientKey = PHONE_TO_KEY[data.with];
        if (recipientKey) {
            const chatHistory = getChatHistory(socket.username, USERS_DB[recipientKey].username);
            socket.emit("message-history", {
                messages: chatHistory
            });
        }
    });

    // Handle message deletion
    socket.on("delete-message", (data) => {
        const recipientKey = PHONE_TO_KEY[data.with];
        if (recipientKey) {
            const chatHistory = getChatHistory(socket.username, USERS_DB[recipientKey].username);
            const messageIndex = chatHistory.findIndex(msg => 
                msg.messageId === data.messageId && msg.from === socket.username
            );

            if (messageIndex !== -1) {
                chatHistory.splice(messageIndex, 1);
                socket.emit("message-deleted", { messageId: data.messageId });
                const recipientSocket = getUserSocketId(USERS_DB[recipientKey].username);
                if (recipientSocket) {
                    io.to(recipientSocket).emit("message-deleted", { messageId: data.messageId });
                }
            }
        }
    });

    // Handle user logout
    socket.on("logout", () => {
        socket.disconnect(true);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
        console.log(`User ${socket.username} disconnected`);
        onlineUsers.delete(socket.username);
        userSocketMap.delete(socket.username);
        socket.broadcast.emit("user-disconnected", socket.username);
    });
});

// Serve static files
app.use(express.static(path.resolve("./public")));

// Handle all routes
app.get("/*", (req, res) => {
    res.sendFile(path.resolve("./public/index.html"));
});

server.listen(9000, () => console.log(`Server Started at PORT:9000`));