const mongoose = require('mongoose');

const TweetSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true
    },
    text: {
        type: String,
        default: ''
    },
    date: {
        type: Date,
        required: true
    },
});

module.exports = mongoose.model('Tweet', TweetSchema);