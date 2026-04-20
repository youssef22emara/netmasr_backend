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

        // Verify reCAPTCHA
        if (!data.recaptchaToken) {
            return res.status(400).json({ success: false, message: 'Missing reCAPTCHA token. Please reload the page.' });
        }

        const verifyResponse = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=6LchBcEsAAAAACox6yVJCiiCbX9DxxUsZB8SM02n&response=${data.recaptchaToken}`
        });
        
        const verifyData = await verifyResponse.json();

        if (!verifyData.success || verifyData.score < 0.5) {
            console.log('[API] reCAPTCHA failed or score too low:', verifyData);
            return res.status(403).json({ success: false, message: 'تم رفض الطلب — يبدو أنك روبوت. حاول مجدداً.' });
        }

        // Calculate exact timestamp for Last Friday at 00:00 (Egypt Time / UTC+2)
        function getLastFridayUTC2() {
            const now = new Date();
            const utcMs = now.getTime();
            // Shift perspective by 2 hours conceptually
            const egyptMs = utcMs + (2 * 60 * 60 * 1000);
            const egyptDate = new Date(egyptMs);
            
            // Set mathematically to absolute midnight.
            egyptDate.setUTCHours(0, 0, 0, 0);
            
            // Week day: 0=Sun, 1=Mon ... 5=Fri
            const day = egyptDate.getUTCDay();
            const diff = (day + 7 - 5) % 7;
            egyptDate.setUTCDate(egyptDate.getUTCDate() - diff);
            
            // Revert back out of conceptual mode by subtracting 2 hours to get true UTC epoch map
            const trueUtcLimitMs = egyptDate.getTime() - (2 * 60 * 60 * 1000);
            return new Date(trueUtcLimitMs);
        }

        const activeLimitDate = getLastFridayUTC2();

        // Limit Check: Has this number submitted since last Friday 00:00?
        const existsInLimit = await Complaint.findOne({ 
            phoneNumber: data.phoneNumber, 
            createdAt: { $gte: activeLimitDate } 
        });

        if (existsInLimit) {
            return res.status(400).json({ 
                success: false, 
                message: 'لقد سجلت شكوى هذا الأسبوع. يمكنك التسجيل مجدداً يوم الجمعة القادم.',
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

// @route   GET /api/complaints/check
// @desc    Check real-time if a phone number submitted since last Friday
router.get('/check', async (req, res) => {
    try {
        const phoneParam = req.query.phone;
        if (!phoneParam || phoneParam.length < 9) {
            return res.status(400).json({ success: false, message: 'Invalid phone string.' });
        }

        const now = new Date();
        const egyptOffset = 2 * 60; // UTC+2
        const egyptNow = new Date(now.getTime() + (egyptOffset * 60000));
        const dayOfWeek = egyptNow.getUTCDay(); // 0=Sun, 5=Fri
        const daysFromFriday = (dayOfWeek >= 5) ? dayOfWeek - 5 : dayOfWeek + 2;
        const lastFriday = new Date(egyptNow);
        lastFriday.setUTCDate(egyptNow.getUTCDate() - daysFromFriday);
        lastFriday.setUTCHours(0, 0, 0, 0);
        const lastFridayUTC = new Date(lastFriday.getTime() - (egyptOffset * 60000));

        const foundComplaint = await Complaint.findOne({
            phoneNumber: phoneParam,
            createdAt: { $gte: lastFridayUTC }
        });

        if (foundComplaint) {
            return res.status(200).json({ available: false });
        } else {
            return res.status(200).json({ available: true });
        }
    } catch (error) {
        console.error('[API] Error checking phone:', error);
        res.status(500).json({ success: false, message: 'Server error' });
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
