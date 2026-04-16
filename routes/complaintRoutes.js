const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');

// Helper: Calculate Trust Score
async function calculateTrustScore(newComp) {
    let scoreParams = 0;
    
    // 1. Is phone valid length?
    if (newComp.phoneType === 'mobile' && newComp.phoneNumber && newComp.phoneNumber.length === 11) {
        scoreParams += 1;
    } else if (newComp.phoneType === 'landline' && newComp.phoneNumber && newComp.phoneNumber.length >= 9 && newComp.phoneNumber.length <= 10) {
        scoreParams += 1;
    }
    
    // 2. Are all core fields completely filled?
    if (newComp.governorate && newComp.company && newComp.category && newComp.description && newComp.description.length > 10) {
        scoreParams += 1;
    }

    // 3. Repeated Governorate/Category alignment
    const similarCount = await Complaint.countDocuments({
        governorate: newComp.governorate,
        category: newComp.category,
        company: newComp.company
    });

    if (similarCount >= 3) {
        scoreParams += 1;
    }

    if (scoreParams === 3) return 'High Confidence';
    if (scoreParams === 2) return 'Medium';
    return 'Low';
}

// @route   POST /api/complaints
// @desc    Add a new complaint
router.post('/', async (req, res) => {
    try {
        console.log('[API] Processing new complaint submission...');
        const data = req.body;

        if (!data.phoneNumber || data.phoneNumber.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'Phone number is strictly required.' });
        }

        // Limit Check: Has this number submitted in the last 7 days?
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const existsInLimit = await Complaint.findOne({ 
            phoneNumber: data.phoneNumber, 
            createdAt: { $gte: sevenDaysAgo } 
        });

        if (existsInLimit) {
            return res.status(400).json({ 
                success: false, 
                message: 'You already have an active complaint this week. Please follow up on your existing complaint.',
                code: 'LIMIT_EXCEEDED'
            });
        }

        // Dynamically Generate Sequence customId based on the last recorded entry
        const lastComplaint = await Complaint.findOne().sort({ _id: -1 });
        let sequence = 1;
        if (lastComplaint && lastComplaint.customId && lastComplaint.customId.startsWith('NETMASR-')) {
            const parts = lastComplaint.customId.split('-');
            if (parts.length === 3) {
                sequence = parseInt(parts[2], 10) + 1;
            }
        }
        
        const currentYear = new Date().getFullYear();
        const customId = `NETMASR-${currentYear}-${String(sequence).padStart(4, '0')}`;
        
        // Calculate Heuristic Trust Score from MongoDB History
        const trustScore = await calculateTrustScore(data);

        // Build the Model
        const newComplaint = new Complaint({
            ...data,
            customId: customId,
            trustScore: trustScore
        });

        // Save permanently to MongoDB Database
        await newComplaint.save();
        
        console.log(`[API] Success! Complaint stored permanently to DB. customId: ${customId}`);

        res.status(201).json({
            success: true,
            message: 'Complaint submitted successfully',
            data: newComplaint
        });
    } catch (error) {
        console.error('[API] Error submitting complaint:', error);
        res.status(500).json({ success: false, message: 'Server error while saving to database.' });
    }
});

// Helper: Get ISO Week Number
function getISOWeekNum(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d - yearStart) / 86400000) + 1)/7);
}

// @route   GET /api/complaints
// @desc    Return all complaints & compute infinite weekly dashboard statistics
router.get('/', async (req, res) => {
    try {
        const allComplaints = await Complaint.find().sort({ createdAt: -1 });

        const weeklyAggregation = {};

        allComplaints.forEach(c => {
            const d = new Date(c.createdAt);
            const code = `${d.getFullYear()}-W${getISOWeekNum(d).toString().padStart(2, '0')}`;
            
            if (!weeklyAggregation[code]) {
                weeklyAggregation[code] = 0;
            }
            weeklyAggregation[code]++;
        });

        const sortedWeeks = Object.keys(weeklyAggregation).sort((a, b) => b.localeCompare(a));
        const weeklyProgression = [];
        
        for (let i = 0; i < sortedWeeks.length; i++) {
            const currentCode = sortedWeeks[i];
            const currentCount = weeklyAggregation[currentCode];
            
            let previousCount = 0;
            if (i + 1 < sortedWeeks.length) {
                previousCount = weeklyAggregation[sortedWeeks[i+1]];
            }
            
            let growthPerc = 0;
            if (previousCount === 0) {
                growthPerc = currentCount > 0 ? 100 : 0;
            } else {
                growthPerc = Math.round(((currentCount - previousCount) / previousCount) * 100);
            }

            weeklyProgression.push({
                weekCode: currentCode,
                totalComplaints: currentCount,
                previousComplaints: previousCount,
                growthPercentage: growthPerc
            });
        }

        res.status(200).json({
            success: true,
            count: allComplaints.length,
            weeklyProgression: weeklyProgression,
            data: allComplaints
        });
    } catch (error) {
        console.error('[API] Error fetching complaints:', error);
        res.status(500).json({ success: false, message: 'Server error retrieving data.' });
    }
});

// @route   GET /api/complaints/track
// @desc    Secure tracking route expecting ?id=XXX&phone=XXX
router.get('/track', async (req, res) => {
    try {
        const idParam = req.query.id;
        const phoneParam = req.query.phone;

        console.log(`[API] Secure Tracking Database Route Hit - customId: ${idParam} | Phone: ${phoneParam}`);

        if (!idParam || !phoneParam) {
            return res.status(400).json({ success: false, message: 'Complaint ID and Phone are strictly required.' });
        }
        
        // Exact match database query checking customId!
        const foundComplaint = await Complaint.findOne({
            customId: { $regex: new RegExp(`^${idParam}$`, 'i') }, 
            phoneNumber: phoneParam 
        });

        if (foundComplaint) {
            return res.status(200).json({ success: true, data: foundComplaint });
        } else {
            return res.status(404).json({ success: false, message: 'Complaint ID or phone number is incorrect.' });
        }
    } catch (error) {
        console.error('[API] Error fetching track:', error);
        res.status(500).json({ success: false, message: 'Server error performing database lookup.' });
    }
});

// @route   GET /api/stats (NEW EXPERIMENTAL ENDPOINT)
// @desc    Compute total complaints & grouping via MongoDB Aggregation Pipeline
router.get('/stats', async (req, res) => {
    try {
        const total = await Complaint.countDocuments();
        
        const companyGrouping = await Complaint.aggregate([
            { $group: { _id: "$company", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const formattedCompanies = {};
        companyGrouping.forEach(c => {
            formattedCompanies[c._id] = c.count;
        });

        res.status(200).json({
            success: true,
            totalComplaints: total,
            companies: formattedCompanies
        });
    } catch (error) {
         console.error('[API] Error formulating stats:', error);
         res.status(500).json({ success: false, message: 'Server error running MongoDB stats aggregation.' });
    }
});

module.exports = router;
