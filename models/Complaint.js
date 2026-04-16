const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema({
    customId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        default: ''
    },
    phoneType: {
        type: String,
        enum: ['mobile', 'landline'],
        required: true
    },
    phoneNumber: {
        type: String,
        required: true,
        index: true
    },
    governorate: {
        type: String,
        required: true
    },
    company: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    refusedComplaint: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['Submitted', 'Under Review', 'Escalated', 'Resolved'],
        default: 'Submitted'
    },
    trustScore: {
        type: String,
        enum: ['High Confidence', 'Medium', 'Low'],
        default: 'Medium'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Complaint', ComplaintSchema);
