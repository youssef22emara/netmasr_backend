const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);

        console.log(`[MongoDB] Database Connected Successfully`);
    } catch (error) {
        console.error(`[MongoDB] Connection Failed! Error: ${error.message}`);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;
