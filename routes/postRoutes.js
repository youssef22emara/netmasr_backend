const express = require('express');
const router = express.Router();
const Post = require('../models/Post');

const ADMIN_KEY = process.env.ADMIN_KEY || 'Youssef@NetMasr.2026.722008';

// Admin Key Verification Middleware
const verifyAdminKey = (req, res, next) => {
    const adminKey = req.header('x-admin-key');
    if (adminKey !== ADMIN_KEY) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid admin key' });
    }
    next();
};

// Helper: Extract YouTube video ID from URL
function extractYouTubeId(url) {
    if (!url) return null;
    
    try {
        // Match patterns:
        // https://www.youtube.com/watch?v=VIDEO_ID
        // https://youtu.be/VIDEO_ID
        // https://www.youtube.com/embed/VIDEO_ID
        
        let videoId = null;
        
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const patterns = [
                /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
                /youtube\.com\/embed\/([^&\n?#]+)/
            ];
            
            for (let pattern of patterns) {
                const match = url.match(pattern);
                if (match && match[1]) {
                    videoId = match[1];
                    break;
                }
            }
        }
        
        return videoId;
    } catch (err) {
        return null;
    }
}

// Helper: Detect content type from URL
function detectPostType(contentUrl) {
    if (!contentUrl || contentUrl.trim() === '') return 'text';
    
    if (contentUrl.includes('youtube.com') || contentUrl.includes('youtu.be')) {
        return 'youtube';
    }
    if (contentUrl.includes('facebook.com')) {
        return 'facebook';
    }
    
    return 'link';
}

// GET /api/posts - Get all posts
router.get('/', async (req, res) => {
    try {
        const posts = await Post.find()
            .sort({ order: -1, createdAt: -1 })
            .exec();
        
        res.json({
            success: true,
            data: posts
        });
    } catch (err) {
        console.error('Error fetching posts:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch posts' });
    }
});

// POST /api/posts - Create new post (Admin only)
router.post('/', verifyAdminKey, async (req, res) => {
    try {
        const { caption, contentUrl } = req.body;
        
        if (!caption || caption.trim() === '') {
            return res.status(400).json({ success: false, message: 'Caption is required' });
        }
        
        const postType = detectPostType(contentUrl);
        let youtubeId = null;
        
        if (postType === 'youtube') {
            youtubeId = extractYouTubeId(contentUrl);
            if (!youtubeId) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid YouTube URL or unable to extract video ID' 
                });
            }
        }
        
        const newPost = new Post({
            type: postType,
            caption: caption.trim(),
            contentUrl: contentUrl && contentUrl.trim() ? contentUrl.trim() : null,
            youtubeId: youtubeId,
            order: 0
        });
        
        await newPost.save();
        
        res.status(201).json({
            success: true,
            message: 'Post created successfully',
            data: newPost
        });
    } catch (err) {
        console.error('Error creating post:', err);
        res.status(500).json({ success: false, message: 'Failed to create post' });
    }
});

// PUT /api/posts/:id - Edit post caption (Admin only)
router.put('/:id', verifyAdminKey, async (req, res) => {
    try {
        const { id } = req.params;
        const { caption } = req.body;
        
        if (!caption || caption.trim() === '') {
            return res.status(400).json({ success: false, message: 'Caption is required' });
        }
        
        const post = await Post.findByIdAndUpdate(
            id,
            { caption: caption.trim() },
            { new: true }
        );
        
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }
        
        res.json({
            success: true,
            message: 'Post updated successfully',
            data: post
        });
    } catch (err) {
        console.error('Error updating post:', err);
        res.status(500).json({ success: false, message: 'Failed to update post' });
    }
});

// DELETE /api/posts/:id - Delete post (Admin only)
router.delete('/:id', verifyAdminKey, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await Post.findByIdAndDelete(id);
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }
        
        res.json({ success: true, message: 'Post deleted successfully' });
    } catch (err) {
        console.error('Error deleting post:', err);
        res.status(500).json({ success: false, message: 'Failed to delete post' });
    }
});

// PATCH /api/posts/:id/react - Like or dislike post
router.patch('/:id/react', async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        
        if (!action || !['like', 'dislike'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Use "like" or "dislike"' });
        }
        
        const updateObj = action === 'like' ? { $inc: { likes: 1 } } : { $inc: { dislikes: 1 } };
        
        const post = await Post.findByIdAndUpdate(id, updateObj, { new: true });
        
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }
        
        res.json({
            success: true,
            data: {
                id: post._id,
                likes: post.likes,
                dislikes: post.dislikes
            }
        });
    } catch (err) {
        console.error('Error updating reaction:', err);
        res.status(500).json({ success: false, message: 'Failed to update reaction' });
    }
});

module.exports = router;
