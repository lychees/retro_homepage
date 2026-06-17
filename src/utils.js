const bcrypt = require('bcryptjs');
const { users, saveUsers, getUserByUsername } = require('./store');

async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

function publicUser(u, extras) {
    if (!u) return null;
    const obj = {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar || '',
        bio: u.bio || '',
        social: u.social || {},
        providers: Array.isArray(u.accounts) ? u.accounts.map(a => a.provider) : [],
        createdAt: u.createdAt
    };
    if (extras) Object.assign(obj, extras);
    return obj;
}

function sanitizeUserInput(str, maxLen) {
    return String(str || '').trim().substring(0, maxLen).replace(/[<>]/g, '');
}

function generateUsername(base) {
    var clean = String(base || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 16);
    if (!clean) clean = 'user';
    if (!getUserByUsername(clean)) return clean;
    var suffix = 2;
    while (suffix < 1000) {
        var name = clean.substring(0, 16 - String(suffix).length - 1) + '_' + suffix;
        if (!getUserByUsername(name)) return name;
        suffix++;
    }
    return clean + '_' + Date.now().toString(36);
}

function createOAuthUser(profile) {
    var user = {
        id: 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        username: generateUsername(profile.username),
        passwordHash: '',
        nickname: sanitizeUserInput(profile.nickname, 16) || generateUsername(profile.username),
        avatar: sanitizeUserInput(profile.avatar, 2048),
        bio: '',
        social: {},
        accounts: [{ provider: profile.provider, id: profile.providerId }],
        createdAt: Date.now()
    };
    users.push(user);
    saveUsers();
    return user;
}

function normalizeOAuthProfile(provider, profile) {
    var avatar = '';
    if (profile.photos && profile.photos.length) avatar = profile.photos[0].value;
    var username = '';
    if (provider === 'github') username = profile.username || '';
    if (provider === 'google') {
        if (profile.emails && profile.emails.length) username = profile.emails[0].value.split('@')[0];
    }
    if (provider === 'qq') username = profile.username || '';
    return {
        provider: provider,
        providerId: profile.id,
        username: username,
        nickname: profile.displayName || username,
        avatar: avatar
    };
}

function createThumbnail(imageData) {
    // 简单截取 base64 前缀作为缩略图占位；生产环境应使用 sharp 等库缩放
    return imageData;
}

module.exports = {
    hashPassword,
    comparePassword,
    publicUser,
    sanitizeUserInput,
    generateUsername,
    createOAuthUser,
    normalizeOAuthProfile,
    createThumbnail
};
