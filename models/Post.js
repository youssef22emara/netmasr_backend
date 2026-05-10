const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['text', 'youtube', 'facebook', 'link'],
            default: 'text',
            required: true
        },
        caption: {
            type: String,
            required: true
        },
        contentUrl: {
            type: String,
            default: null
        },
        youtubeId: {
            type: String,
            default: null
        },
        likes: {
            type: Number,
            default: 0
        },
        dislikes: {
            type: Number,
            default: 0
        },
        order: {
            type: Number,
            default: 0
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Post', postSchema);
