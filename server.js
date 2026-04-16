require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const complaintRoutes = require('./routes/complaintRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors()); // Allow cross-origin requests from frontend
app.use(express.json()); // Parse incoming JSON requests

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Routes
app.use('/api/complaints', complaintRoutes);

// Base route for testing
app.get('/', (req, res) => {
    res.send('NetMasr Backend API is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`🚀 NetMasr Backend Server is running on port ${PORT}`);
    console.log(`===============================================`);
});
