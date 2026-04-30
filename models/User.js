const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    googleId: { type: String, default: '', index: true },
    avatar: { type: String, default: '' },
    authProvider: { type: String, enum: ['password', 'google'], default: 'password' },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', UserSchema);
