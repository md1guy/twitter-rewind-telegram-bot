const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    telegram_id: {
        type: String,
        required: true,
        unique: true,
    },
    twitter_username: {
        type: String,
        required: true,
    },
    subscribed: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('User', UserSchema);
