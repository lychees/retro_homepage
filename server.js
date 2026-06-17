/**
 * 星間茶室 - 服务端
 * Express + Socket.io
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const jsnes = require('jsnes');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OAuth2Strategy = require('passport-oauth2').Strategy;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const ROM_DIR = path.join(__dirname, 'public', 'roms');
const SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const MAX_SUBMISSIONS = 100;

// 投稿画廊内存存储
let submissions = [];

try {
    if (fs.existsSync(SUBMISSIONS_FILE)) {
        submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, 'utf8')) || [];
    }
} catch (e) {
    console.error('加载投稿文件失败:', e.message);
    submissions = [];
}

function saveSubmissions() {
    try {
        fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(submissions, null, 2));
    } catch (e) {
        console.error('保存投稿失败:', e.message);
    }
}

// 用户系统
let users = [];

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) || [];
        }
    } catch (e) {
        console.error('加载用户文件失败:', e.message);
        users = [];
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('保存用户失败:', e.message);
    }
}

loadUsers();

async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

function getUserById(id) {
    return users.find(u => u.id === id);
}

function getUserByUsername(username) {
    return users.find(u => u.username === username);
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

function findUserByAccount(provider, providerId) {
    return users.find(u => Array.isArray(u.accounts) && u.accounts.some(a => a.provider === provider && a.id === providerId));
}

function addUserAccount(user, provider, providerId) {
    if (!Array.isArray(user.accounts)) user.accounts = [];
    if (!user.accounts.some(a => a.provider === provider)) {
        user.accounts.push({ provider: provider, id: providerId });
    }
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

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'star-tearoom-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false }
}));

function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    next();
}

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = getUserById(id);
    done(null, user || false);
});

app.use(passport.initialize());
app.use(passport.session());

const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

// QQ OAuth2 策略（自定义）
class QQStrategy extends OAuth2Strategy {
    constructor(options, verify) {
        options.authorizationURL = options.authorizationURL || 'https://graph.qq.com/oauth2.0/authorize';
        options.tokenURL = options.tokenURL || 'https://graph.qq.com/oauth2.0/token';
        options.scope = options.scope || 'get_user_info';
        options.scopeSeparator = ',';
        super(options, verify);
        this.name = 'qq';
        this._appId = options.clientID;
    }

    userProfile(accessToken, done) {
        const self = this;
        https.get('https://graph.qq.com/oauth2.0/me?access_token=' + encodeURIComponent(accessToken), function (res) {
            var body = '';
            res.on('data', function (chunk) { body += chunk; });
            res.on('end', function () {
                try {
                    var match = body.match(/"openid"\s*:\s*"([^"]+)"/);
                    var openid = match ? match[1] : null;
                    if (!openid) return done(new Error('QQ openid 解析失败'));
                    var url = 'https://graph.qq.com/user/get_user_info?access_token=' + encodeURIComponent(accessToken) +
                        '&oauth_consumer_key=' + encodeURIComponent(self._appId) +
                        '&openid=' + encodeURIComponent(openid);
                    https.get(url, function (res2) {
                        var body2 = '';
                        res2.on('data', function (chunk) { body2 += chunk; });
                        res2.on('end', function () {
                            try {
                                var json = JSON.parse(body2);
                                var profile = {
                                    provider: 'qq',
                                    id: openid,
                                    displayName: json.nickname,
                                    username: 'qq_' + openid.substring(0, 8),
                                    photos: [{ value: json.figureurl_qq_2 || json.figureurl_qq_1 || '' }]
                                };
                                done(null, profile);
                            } catch (e) {
                                done(e);
                            }
                        });
                    }).on('error', done);
                } catch (e) {
                    done(e);
                }
            });
        }).on('error', done);
    }
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

function handleOAuthCallback(req, res, provider, profile) {
    var bindUserId = req.session && req.session.bindUserId;
    delete req.session.bindUserId;
    if (bindUserId) {
        var existing = getUserById(bindUserId);
        if (existing) {
            var already = findUserByAccount(provider, profile.id);
            if (already && already.id !== existing.id) {
                return res.redirect('/#/account?error=account_already_bound');
            }
            addUserAccount(existing, provider, profile.id);
            if (!existing.avatar && profile.photos && profile.photos.length) {
                existing.avatar = sanitizeUserInput(profile.photos[0].value, 2048);
            }
            if (!existing.nickname && profile.displayName) {
                existing.nickname = sanitizeUserInput(profile.displayName, 16);
            }
            saveUsers();
            req.session.userId = existing.id;
            return res.redirect('/#/account?bind=success');
        }
    }

    var user = findUserByAccount(provider, profile.id);
    if (!user) {
        user = createOAuthUser(normalizeOAuthProfile(provider, profile));
    }
    req.session.userId = user.id;
    res.redirect('/#/');
}

function startOAuth(req, res, next, provider, options) {
    if (req.session && req.session.userId) {
        req.session.bindUserId = req.session.userId;
    }
    passport.authenticate(provider, options || {})(req, res, next);
}

// GitHub
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: BASE_URL + '/api/auth/github/callback'
    }, function (accessToken, refreshToken, profile, done) {
        done(null, profile);
    }));
    app.get('/api/auth/github', (req, res, next) => startOAuth(req, res, next, 'github', { scope: ['read:user'] }));
    app.get('/api/auth/github/callback', passport.authenticate('github', { failureRedirect: '/#/account?error=github' }), (req, res) => {
        handleOAuthCallback(req, res, 'github', req.user);
    });
}

// Google
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: BASE_URL + '/api/auth/google/callback'
    }, function (accessToken, refreshToken, profile, done) {
        done(null, profile);
    }));
    app.get('/api/auth/google', (req, res, next) => startOAuth(req, res, next, 'google', { scope: ['profile', 'email'] }));
    app.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: '/#/account?error=google' }), (req, res) => {
        handleOAuthCallback(req, res, 'google', req.user);
    });
}

// QQ
if (process.env.QQ_CLIENT_ID && process.env.QQ_CLIENT_SECRET) {
    passport.use(new QQStrategy({
        clientID: process.env.QQ_CLIENT_ID,
        clientSecret: process.env.QQ_CLIENT_SECRET,
        callbackURL: BASE_URL + '/api/auth/qq/callback'
    }, function (accessToken, refreshToken, profile, done) {
        done(null, profile);
    }));
    app.get('/api/auth/qq', (req, res, next) => startOAuth(req, res, next, 'qq'));
    app.get('/api/auth/qq/callback', passport.authenticate('qq', { failureRedirect: '/#/account?error=qq' }), (req, res) => {
        handleOAuthCallback(req, res, 'qq', req.user);
    });
}

app.get('/api/auth/providers', (req, res) => {
    res.json({
        providers: {
            github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
            google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
            qq: !!(process.env.QQ_CLIENT_ID && process.env.QQ_CLIENT_SECRET)
        }
    });
});

// ROM 列表 API
app.get('/api/roms', (req, res) => {
    let files = [];
    try {
        files = fs.readdirSync(ROM_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
    } catch (e) {
        console.error('读取 ROM 目录失败:', e.message);
        return res.json({ roms: [] });
    }

    const roms = files.map(f => {
        const clean = f
            .replace(/\.nes$/i, '')
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            .replace(/\s*\[[^\]]*\]\s*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return {
            name: clean || f,
            file: f,
            path: encodeURIComponent(f)
        };
    });

    res.json({ roms });
});

// ROM 文件服务
app.get('/roms/:name', (req, res) => {
    const filename = decodeURIComponent(req.params.name);
    const filePath = path.join(ROM_DIR, filename);
    // 防止路径穿越
    if (!filePath.startsWith(ROM_DIR)) {
        return res.status(403).send('Forbidden');
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Not found');
    }
    res.sendFile(filePath);
});

// 投稿与画廊 API
app.use(express.json({ limit: '5mb' }));

app.get('/api/gallery', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 20));
    const userIdFilter = req.query.userId || null;
    let list = submissions.slice().reverse();
    if (userIdFilter) {
        list = list.filter(s => s.userId === userIdFilter);
    }
    const total = list.length;
    const items = list.slice((page - 1) * limit, page * limit).map(s => {
        const author = getUserById(s.userId);
        return {
            id: s.id,
            type: s.type,
            title: s.title,
            author: s.author,
            userId: s.userId || null,
            authorAvatar: author ? (author.avatar || '') : '',
            thumbnail: s.thumbnail,
            timestamp: s.timestamp
        };
    });
    res.json({ total, page, limit, items });
});

app.get('/api/gallery/:id', (req, res) => {
    const item = submissions.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const author = getUserById(item.userId);
    res.json({
        id: item.id,
        type: item.type,
        title: item.title,
        author: item.author,
        userId: item.userId || null,
        authorAvatar: author ? (author.avatar || '') : '',
        imageData: item.imageData,
        timestamp: item.timestamp,
        likes: item.likes || 0,
        comments: (item.comments || []).map(c => ({
            author: c.author,
            userId: c.userId || null,
            text: c.text,
            timestamp: c.timestamp
        })),
        strokes: item.strokes || [],
        canvas: item.canvas || { width: 640, height: 480 }
    });
});

app.post('/api/gallery/:id/like', (req, res) => {
    const item = submissions.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    item.likes = (item.likes || 0) + 1;
    saveSubmissions();
    res.json({ id: item.id, likes: item.likes });
});

app.post('/api/gallery/:id/comment', (req, res) => {
    const item = submissions.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const { author, text } = req.body || {};
    const cleanText = String(text || '').trim();
    if (!cleanText) return res.status(400).json({ error: '评论内容不能为空' });
    if (cleanText.length > 200) return res.status(400).json({ error: '评论内容过长' });
    const user = req.session && req.session.userId ? getUserById(req.session.userId) : null;
    const comment = {
        author: user ? user.nickname : (String(author || '匿名').trim().substring(0, 16) || '匿名'),
        userId: user ? user.id : null,
        text: cleanText,
        timestamp: Date.now()
    };
    if (!item.comments) item.comments = [];
    item.comments.push(comment);
    if (item.comments.length > 100) item.comments = item.comments.slice(item.comments.length - 100);
    saveSubmissions();
    res.json({ id: item.id, comment });
});

app.post('/api/submit', (req, res) => {
    const { type, title, author, imageData, strokes, canvas } = req.body || {};
    if (!imageData || !imageData.startsWith('data:image')) {
        return res.status(400).json({ error: '无效的图片数据' });
    }
    if (imageData.length > 4 * 1024 * 1024) {
        return res.status(400).json({ error: '图片过大' });
    }
    const user = req.session && req.session.userId ? getUserById(req.session.userId) : null;
    const submission = {
        id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
        type: type || 'oekaki',
        title: String(title || '无题').trim().substring(0, 40),
        author: user ? user.nickname : (String(author || '匿名').trim().substring(0, 16)),
        userId: user ? user.id : null,
        imageData: imageData,
        thumbnail: createThumbnail(imageData),
        timestamp: Date.now(),
        likes: 0,
        comments: [],
        strokes: Array.isArray(strokes) ? strokes : [],
        canvas: canvas && typeof canvas.width === 'number' && typeof canvas.height === 'number'
            ? { width: canvas.width, height: canvas.height }
            : { width: 640, height: 480 }
    };
    submissions.push(submission);
    if (submissions.length > MAX_SUBMISSIONS) {
        submissions = submissions.slice(submissions.length - MAX_SUBMISSIONS);
    }
    saveSubmissions();
    res.json({ id: submission.id, success: true });
});

function createThumbnail(imageData) {
    // 简单截取 base64 前缀作为缩略图占位；生产环境应使用 sharp 等库缩放
    return imageData;
}

// ==================== 账号系统 ====================

// 账号仅通过第三方 OAuth 创建/登录，不再提供账号密码注册
app.post('/api/auth/register', (req, res) => {
    res.status(403).json({ error: '本站已关闭账号密码注册，请使用第三方账号登录。' });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    const cleanUsername = sanitizeUserInput(username, 32).toLowerCase();
    const user = getUserByUsername(cleanUsername);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    try {
        const ok = await comparePassword(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
        req.session.userId = user.id;
        res.json({ user: publicUser(user) });
    } catch (e) {
        console.error('登录失败:', e);
        res.status(500).json({ error: '登录失败' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(function (err) {
        if (err) return res.status(500).json({ error: '登出失败' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/auth/me', (req, res) => {
    const user = req.session && req.session.userId ? getUserById(req.session.userId) : null;
    res.json({ user: publicUser(user) });
});

app.post('/api/user/profile', requireAuth, async (req, res) => {
    const user = getUserById(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { nickname, avatar, bio } = req.body || {};
    if (nickname !== undefined) user.nickname = sanitizeUserInput(nickname, 16) || user.nickname;
    if (avatar !== undefined) user.avatar = sanitizeUserInput(avatar, 2048);
    if (bio !== undefined) user.bio = sanitizeUserInput(bio, 300);
    saveUsers();
    res.json({ user: publicUser(user) });
});

app.post('/api/user/social', requireAuth, (req, res) => {
    const user = getUserById(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const allowed = ['twitter', 'github', 'bilibili', 'weibo', 'homepage'];
    const social = req.body || {};
    allowed.forEach(key => {
        if (social[key] !== undefined) {
            user.social[key] = sanitizeUserInput(social[key], 120);
        }
    });
    saveUsers();
    res.json({ user: publicUser(user) });
});

app.get('/api/user/:id', (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const works = submissions
        .filter(s => s.userId === user.id)
        .slice()
        .reverse()
        .map(s => ({
            id: s.id,
            type: s.type,
            title: s.title,
            thumbnail: s.thumbnail,
            timestamp: s.timestamp
        }));
    res.json({ user: publicUser(user, { works: works }) });
});

// 兜底返回 index.html（支持 SPA hash 路由）
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 房间内存存储
const rooms = {};

function getRoom(type, roomId, password) {
    const key = `${type}:${roomId}`;
    if (!rooms[key]) {
        const base = {
            type: type,
            id: roomId,
            password: password || null,
            users: new Map() // socketId -> nick
        };
        if (type === 'fc') {
            base.romData = null;
            base.romName = '';
            base.frameCount = 0;
            base.controllers = { 1: {}, 2: {} };
            base.playerSlots = [null, null]; // [player1 socketId, player2 socketId]
            base.lastState = null;
            base.nes = null;
            base.running = false;
            base.frameTimer = null;
            base.stateTimer = null;
        }
        if (type === 'oekaki') {
            base.oekaki = [];
            base.currentColor = '#000000';
            base.layers = [{ id: 'layer_' + Date.now(), name: '图层 1', visible: true, opacity: 1 }];
            base.activeLayerId = base.layers[0].id;
        }
        if (type === 'pictionary') {
            initPictionaryRoom(base);
        }
        rooms[key] = base;
    }
    return rooms[key];
}

const PICTIONARY_WORDS = [
    '苹果', '香蕉', '橙子', '西瓜', '草莓', '葡萄', '樱桃', '柠檬',
    '猫', '狗', '兔子', '老虎', '狮子', '大象', '熊猫', '长颈鹿',
    '房子', '汽车', '飞机', '轮船', '火车', '自行车', '火箭', '飞碟',
    '太阳', '月亮', '星星', '云朵', '彩虹', '雨滴', '雪花', '闪电',
    '苹果派', '冰淇淋', '蛋糕', '汉堡', '披萨', '面条', '饺子', '寿司',
    '书包', '铅笔', '电脑', '手机', '电视', '相机', '耳机', '手表',
    '花朵', '大树', '小草', '蘑菇', '仙人掌', '向日葵', '玫瑰', '荷叶',
    '帽子', '眼镜', '围巾', '手套', '雨伞', '鞋子', '裙子', '领带',
    '足球', '篮球', '乒乓球', '羽毛球', '风筝', '气球', '滑梯', '秋千',
    '机器人', '外星人', '王子', '公主', '国王', '城堡', '宝藏', '地图'
];

function initPictionaryRoom(room) {
    room.status = 'waiting';
    room.scores = {};
    room.strokes = [];
    room.currentDrawer = null;
    room.currentWord = '';
    room.round = 0;
    room.turnIndex = 0;
    room.turnTimer = null;
    room.turnTimeLeft = 0;
    room.turnDuration = 80;
    room.correctGuessers = new Set();
}

function maskWord(word) {
    if (!word) return '';
    return word.split('').map(function () { return ' _ '; }).join('');
}

function getPictionaryScores(room) {
    return Array.from(room.users.entries()).map(function (entry) {
        return { id: entry[0], nick: entry[1], score: room.scores[entry[0]] || 0 };
    });
}

function pickNextPictionaryDrawer(room, key) {
    const socketSet = io.sockets.adapter.rooms.get(key);
    const sockets = socketSet ? Array.from(socketSet) : [];
    if (sockets.length === 0) return null;
    let idx = 0;
    if (room.currentDrawer) {
        const start = sockets.indexOf(room.currentDrawer);
        idx = start >= 0 ? (start + 1) % sockets.length : 0;
    }
    return sockets[idx];
}

function broadcastPictionaryState(room, key) {
    const base = {
        room: room.id,
        status: room.status,
        timeLeft: room.turnTimeLeft,
        drawerId: room.currentDrawer,
        drawerNick: room.currentDrawer ? room.users.get(room.currentDrawer) : '',
        round: room.round,
        scores: getPictionaryScores(room)
    };
    if (room.status === 'drawing' && room.currentDrawer) {
        // 给猜词者看占位符
        const publicState = Object.assign({}, base, { word: maskWord(room.currentWord), isDrawer: false });
        room.users.forEach(function (nick, id) {
            if (id === room.currentDrawer) return;
            io.to(id).emit('pictionary:state', publicState);
        });
        // 给作画者看原词
        const drawerState = Object.assign({}, base, { word: room.currentWord, isDrawer: true });
        io.to(room.currentDrawer).emit('pictionary:state', drawerState);
    } else {
        const state = Object.assign({}, base, { word: room.currentWord || '', isDrawer: false });
        io.to(key).emit('pictionary:state', state);
    }
}

function startPictionaryTurn(room, key) {
    if (room.turnTimer) {
        clearInterval(room.turnTimer);
        room.turnTimer = null;
    }
    const socketSet = io.sockets.adapter.rooms.get(key);
    const sockets = socketSet ? Array.from(socketSet) : [];
    if (sockets.length < 2) {
        room.status = 'waiting';
        room.currentDrawer = null;
        room.currentWord = '';
        broadcastPictionaryState(room, key);
        return;
    }
    io.to(key).emit('pictionary:clear', { room: room.id });
    room.currentDrawer = pickNextPictionaryDrawer(room, key);
    room.currentWord = PICTIONARY_WORDS[Math.floor(Math.random() * PICTIONARY_WORDS.length)];
    room.status = 'drawing';
    room.turnTimeLeft = room.turnDuration;
    room.correctGuessers = new Set();
    room.strokes = [];
    room.round++;
    broadcastPictionaryState(room, key);
    room.turnTimer = setInterval(function () {
        room.turnTimeLeft--;
        if (room.turnTimeLeft <= 0) {
            endPictionaryTurn(room, key, 'timeout');
        } else {
            broadcastPictionaryState(room, key);
        }
    }, 1000);
}

function endPictionaryTurn(room, key, reason) {
    if (room.turnTimer) {
        clearInterval(room.turnTimer);
        room.turnTimer = null;
    }
    room.status = 'reveal';
    room.strokes = [];
    broadcastPictionaryState(room, key);
    const reasonText = reason === 'timeout' ? '时间到' : (reason === 'correct' ? '有人猜对' : (reason === 'all' ? '全部猜对' : '作画者离开'));
    io.to(key).emit('pictionary:message', {
        room: room.id,
        system: true,
        text: `本回合答案：${room.currentWord}（${reasonText}）`,
        time: Date.now()
    });
    setTimeout(function () {
        if (rooms[key] && rooms[key].users.size > 0) {
            startPictionaryTurn(rooms[key], key);
        }
    }, 5000);
}

function handlePictionaryGuess(socket, room, key, text) {
    if (room.status !== 'drawing') return;
    if (socket.id === room.currentDrawer) return;
    if (room.correctGuessers.has(socket.id)) return;
    const guess = String(text || '').trim();
    if (!guess) return;
    if (guess === room.currentWord) {
        room.correctGuessers.add(socket.id);
        room.scores[socket.id] = (room.scores[socket.id] || 0) + 10;
        room.scores[room.currentDrawer] = (room.scores[room.currentDrawer] || 0) + 5;
        const nick = room.users.get(socket.id);
        io.to(key).emit('pictionary:message', {
            room: room.id,
            system: true,
            text: `${nick} 猜对了！`,
            time: Date.now()
        });
        io.to(key).emit('pictionary:guessResult', { room: room.id, correct: true, nick: nick, word: room.currentWord });
        endPictionaryTurn(room, key, 'correct');
    } else {
        const nick = room.users.get(socket.id);
        io.to(key).emit('pictionary:message', {
            room: room.id,
            nick: nick,
            text: `猜测：${guess}`,
            time: Date.now()
        });
    }
}

function broadcastRooms() {
    const list = Object.values(rooms).map(r => ({
        type: r.type,
        id: r.id,
        users: r.users.size,
        hasPwd: !!r.password
    }));
    io.emit('lobby:rooms', { rooms: list });
}

function leaveRoom(socket, type) {
    const joinedKey = socket._joined && socket._joined[type];
    if (!joinedKey) return;
    const room = rooms[joinedKey];
    if (!room) return;

    const nick = room.users.get(socket.id);
    room.users.delete(socket.id);
    socket.leave(joinedKey);
    delete socket._joined[type];

    // FC 房间释放玩家槽位
    if (room.type === 'fc') {
        if (room.playerSlots[0] === socket.id) room.playerSlots[0] = null;
        if (room.playerSlots[1] === socket.id) room.playerSlots[1] = null;
        if (room.users.size === 1) {
            // 只剩一人时回到单人模式，统一归为玩家 1，避免上一局的按键状态残留
            const remainingId = room.users.keys().next().value;
            room.playerSlots[0] = remainingId;
            room.playerSlots[1] = null;
            room.controllers = { 1: {}, 2: {} };
        }
        if (room.users.size > 0) {
            io.to(joinedKey).emit('fc:controllers', {
                controllers: room.controllers,
                playerSlots: room.playerSlots
            });
        } else {
            stopFCEmulator(room);
        }
    }

    // 你画我猜：作画者离开则结束本回合
    if (room.type === 'pictionary') {
        if (socket.id === room.currentDrawer && room.users.size > 0) {
            endPictionaryTurn(room, joinedKey, 'drawer_left');
        }
        if (room.users.size === 0 && room.turnTimer) {
            clearInterval(room.turnTimer);
            room.turnTimer = null;
        }
    }

    io.to(joinedKey).emit(`${type}:users`, {
        room: room.id,
        users: Array.from(room.users.values())
    });

    if (room.users.size === 0) {
        delete rooms[joinedKey];
    }

    if (nick) {
        io.to(joinedKey).emit(`${type}:message`, {
            room: room.id,
            system: true,
            text: `${nick} 离开了房间`,
            time: Date.now()
        });
    }

    broadcastRooms();
}

function joinRoom(socket, type, data) {
    const roomId = (data.room || '').toString().trim().toUpperCase();
    const nick = (data.nick || '匿名').toString().trim().substring(0, 16);
    const pwd = (data.pwd || '').toString().trim();
    if (!roomId) return;

    // 离开同类型其他房间
    leaveRoom(socket, type);

    const room = getRoom(type, roomId, pwd);
    const joinedKey = `${type}:${roomId}`;

    // 密码验证：房间已存在且有密码时，加入者必须提供正确密码
    if (room.password && room.password !== pwd) {
        socket.emit(`${type}:error`, {
            room: roomId,
            message: '房间密码错误'
        });
        return;
    }

    room.users.set(socket.id, nick);
    socket.join(joinedKey);
    if (!socket._joined) socket._joined = {};
    socket._joined[type] = joinedKey;

    socket.emit(`${type}:joined`, {
        room: roomId,
        users: Array.from(room.users.values())
    });

    socket.to(joinedKey).emit(`${type}:message`, {
        room: roomId,
        system: true,
        text: `${nick} 加入了房间`,
        time: Date.now()
    });

    io.to(joinedKey).emit(`${type}:users`, {
        room: roomId,
        users: Array.from(room.users.values())
    });

    // 茶绘房间发送历史笔触
    if (type === 'oekaki') {
        room.oekaki.forEach(stroke => {
            socket.emit('oekaki:stroke', stroke);
        });
    }

    // FC 房间分配玩家槽位并同步状态
    if (type === 'fc') {
        const slot = getFCPlayerSlot(room, socket.id);
        io.to(joinedKey).emit('fc:controllers', {
            controllers: room.controllers,
            playerSlots: room.playerSlots
        });
        syncFCUser(socket, room, joinedKey);
    }

    broadcastRooms();
}

// ==================== FC 模拟器（服务端 authoritative）====================

function getFCPlayerSlot(room, socketId) {
    if (room.playerSlots[0] === socketId) return 1;
    if (room.playerSlots[1] === socketId) return 2;
    if (!room.playerSlots[0]) {
        room.playerSlots[0] = socketId;
        return 1;
    }
    if (!room.playerSlots[1]) {
        room.playerSlots[1] = socketId;
        return 2;
    }
    return 0;
}

function startFCEmulator(room, key) {
    if (room.nes || !room.romData) return;

    try {
        const romString = room.romData.toString('binary');
        room.nes = new jsnes.NES({
            onFrame: () => {},
            onAudioSample: () => {},
            emulateSound: false
        });
        room.nes.loadROM(romString);
        // 使用与客户端一致的默认调色板，避免状态同步后颜色变化
        try {
            if (room.nes.ppu && room.nes.ppu.palTable && room.nes.ppu.palTable.loadDefaultPalette) {
                room.nes.ppu.palTable.loadDefaultPalette();
            }
        } catch (e) {
            console.warn('服务端加载默认调色板失败', e);
        }
    } catch (e) {
        console.error('FC ROM 加载失败:', e);
        io.to(key).emit('fc:error', { message: 'ROM 加载失败：' + e.message });
        room.nes = null;
        return;
    }

    room.running = true;
    room.frameCount = 0;

    // 60fps authoritative frame loop
    room.frameTimer = setInterval(() => {
        if (!room.nes || !room.running) return;

        for (let c = 1; c <= 2; c++) {
            const state = room.controllers[c] || {};
            for (let btn = 0; btn < 8; btn++) {
                if (state[btn]) room.nes.buttonDown(c, btn);
                else room.nes.buttonUp(c, btn);
            }
        }

        room.nes.frame();
        room.frameCount++;

        io.to(key).emit('fc:controllers', {
            frame: room.frameCount,
            controllers: room.controllers,
            playerSlots: room.playerSlots
        });
    }, 1000 / 60);

    // 每 2 秒保存一次状态，仅用于新加入者同步（不再广播给所有客户端，避免画面跳变）
    room.stateTimer = setInterval(() => {
        if (!room.nes || !room.running) return;
        try {
            room.lastState = room.nes.toJSON();
        } catch (e) {
            console.error('FC 保存状态失败:', e);
        }
    }, 2000);
}

function stopFCEmulator(room) {
    if (room.type !== 'fc') return;
    room.running = false;
    if (room.frameTimer) {
        clearInterval(room.frameTimer);
        room.frameTimer = null;
    }
    if (room.stateTimer) {
        clearInterval(room.stateTimer);
        room.stateTimer = null;
    }
    room.nes = null;
    room.frameCount = 0;
    room.lastState = null;
}

function syncFCUser(socket, room, key) {
    socket.emit('fc:init', {
        romName: room.romName,
        romData: room.romData ? room.romData.toString('base64') : null,
        frame: room.frameCount,
        state: room.lastState,
        controllers: room.controllers,
        playerSlots: room.playerSlots
    });
}

function pickRandomROM() {
    try {
        const files = fs.readdirSync(ROM_DIR).filter(f => f.toLowerCase().endsWith('.nes'));
        if (files.length === 0) return null;
        return files[Math.floor(Math.random() * files.length)];
    } catch (e) {
        return null;
    }
}

function cleanRomName(filename) {
    return filename
        .replace(/\.nes$/i, '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/\s*\[[^\]]*\]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

io.on('connection', (socket) => {
    console.log('客户端连接:', socket.id);

    // ===== 大厅 =====
    socket.on('lobby:getRooms', () => {
        const list = Object.values(rooms).map(r => ({
            type: r.type,
            id: r.id,
            users: r.users.size,
            hasPwd: !!r.password
        }));
        socket.emit('lobby:rooms', { rooms: list });
    });
    socket.on('lobby:create', (data) => {
        const type = (data.type || 'chat').toString().trim();
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const nick = (data.nick || '匿名').toString().trim().substring(0, 16);
        const pwd = (data.pwd || '').toString().trim();
        if (!['chat', 'oekaki', 'fc', 'pictionary'].includes(type)) {
            socket.emit('lobby:error', { message: '未知房间类型' });
            return;
        }
        if (!roomId) {
            socket.emit('lobby:error', { message: '房间号不能为空' });
            return;
        }
        // 预创建房间并设置密码
        getRoom(type, roomId, pwd);
        socket.emit('lobby:created', {
            type: type,
            room: roomId,
            pwd: pwd
        });
        broadcastRooms();
    });

    // ===== 聊天室 =====
    socket.on('chat:join', (data) => joinRoom(socket, 'chat', data));
    socket.on('chat:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `chat:${roomId}`;
        if (rooms[key]) {
            socket.join(key);
            socket.emit('chat:joined', {
                room: roomId,
                users: Array.from(rooms[key].users.values())
            });
        }
    });
    socket.on('chat:leave', () => leaveRoom(socket, 'chat'));

    // ===== 茶绘 =====
    socket.on('oekaki:join', (data) => joinRoom(socket, 'oekaki', data));
    socket.on('oekaki:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        if (rooms[key]) {
            socket.join(key);
            socket.emit('oekaki:joined', {
                room: roomId,
                users: Array.from(rooms[key].users.values())
            });
            socket.emit('oekaki:color', { room: roomId, color: rooms[key].currentColor });
            socket.emit('oekaki:layers', {
                room: roomId,
                layers: rooms[key].layers,
                activeLayerId: rooms[key].activeLayerId
            });
            rooms[key].oekaki.forEach(stroke => socket.emit('oekaki:stroke', stroke));
        }
    });
    socket.on('oekaki:leave', () => leaveRoom(socket, 'oekaki'));
    socket.on('oekaki:stroke', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room) return;
        const stroke = {
            id: data.id || (Date.now() + '_' + Math.random().toString(36).slice(2)),
            room: roomId,
            type: data.type || 'line',
            layerId: data.layerId || (room.layers[0] && room.layers[0].id),
            groupId: data.groupId || null,
            from: data.from,
            to: data.to,
            x: data.x,
            y: data.y,
            text: data.text,
            tool: data.tool,
            color: data.color,
            alpha: data.alpha == null ? 1 : data.alpha,
            size: data.size
        };
        room.oekaki.push(stroke);
        // 限制历史长度
        if (room.oekaki.length > 5000) room.oekaki.shift();
        socket.to(key).emit('oekaki:stroke', stroke);
    });
    socket.on('oekaki:undo', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room) return;
        const targetId = data.id;
        const idx = room.oekaki.findIndex(s => s.id === targetId);
        if (idx >= 0) {
            room.oekaki.splice(idx, 1);
            io.to(key).emit('oekaki:undo', { room: roomId, id: targetId });
        }
    });
    socket.on('oekaki:undoGroup', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.groupId) return;
        const before = room.oekaki.length;
        room.oekaki = room.oekaki.filter(s => s.groupId !== data.groupId);
        if (room.oekaki.length < before) {
            io.to(key).emit('oekaki:undoGroup', { room: roomId, groupId: data.groupId });
        }
    });
    socket.on('oekaki:color', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.color) return;
        room.currentColor = data.color;
        socket.to(key).emit('oekaki:color', { room: roomId, color: data.color });
    });
    socket.on('oekaki:clear', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room) return;
        room.oekaki = [];
        io.to(key).emit('oekaki:clear', { room: roomId });
    });
    socket.on('oekaki:import', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !Array.isArray(data.strokes)) return;
        if (data.layers) {
            room.layers = room.layers.concat(data.layers);
        }
        room.oekaki = room.oekaki.concat(data.strokes);
        if (room.oekaki.length > 5000) {
            room.oekaki = room.oekaki.slice(room.oekaki.length - 5000);
        }
        socket.to(key).emit('oekaki:import', {
            room: roomId,
            layers: data.layers,
            strokes: data.strokes,
            activeLayerId: data.activeLayerId
        });
    });
    socket.on('oekaki:layers', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !Array.isArray(data.layers)) return;
        room.layers = data.layers;
        room.activeLayerId = data.activeLayerId || room.layers[0].id;
        io.to(key).emit('oekaki:layers', {
            room: roomId,
            layers: room.layers,
            activeLayerId: room.activeLayerId
        });
    });
    socket.on('oekaki:layer:create', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.layer) return;
        room.layers.push(data.layer);
        socket.to(key).emit('oekaki:layer:create', { room: roomId, layer: data.layer });
    });
    socket.on('oekaki:layer:delete', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.id) return;
        room.layers = room.layers.filter(l => l.id !== data.id);
        room.oekaki = room.oekaki.filter(s => s.layerId !== data.id);
        io.to(key).emit('oekaki:layer:delete', { room: roomId, id: data.id });
    });
    socket.on('oekaki:layer:active', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.id) return;
        room.activeLayerId = data.id;
        socket.to(key).emit('oekaki:layer:active', { room: roomId, id: data.id });
    });
    socket.on('oekaki:layer:visible', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.id) return;
        const layer = room.layers.find(l => l.id === data.id);
        if (layer) {
            layer.visible = !!data.visible;
            io.to(key).emit('oekaki:layer:visible', { room: roomId, id: data.id, visible: layer.visible });
        }
    });
    socket.on('oekaki:layer:rename', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.id) return;
        const layer = room.layers.find(l => l.id === data.id);
        if (layer) {
            layer.name = String(data.name || '').substring(0, 20);
            io.to(key).emit('oekaki:layer:rename', { room: roomId, id: data.id, name: layer.name });
        }
    });
    socket.on('oekaki:layer:opacity', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !data.id) return;
        const layer = room.layers.find(l => l.id === data.id);
        if (layer) {
            layer.opacity = Math.max(0, Math.min(1, parseFloat(data.opacity) || 1));
            io.to(key).emit('oekaki:layer:opacity', { room: roomId, id: data.id, opacity: layer.opacity });
        }
    });
    socket.on('oekaki:layer:reorder', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = rooms[key];
        if (!room || !Array.isArray(data.order)) return;
        const map = {};
        room.layers.forEach(l => map[l.id] = l);
        room.layers = data.order.map(id => map[id]).filter(Boolean);
        io.to(key).emit('oekaki:layer:reorder', { room: roomId, order: room.layers.map(l => l.id) });
    });

    // ===== FC 游戏室 =====
    socket.on('fc:join', (data) => joinRoom(socket, 'fc', data));
    socket.on('fc:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `fc:${roomId}`;
        const room = rooms[key];
        if (!room) return;
        socket.join(key);
        socket.emit('fc:joined', {
            room: roomId,
            users: Array.from(room.users.values())
        });
        const slot = getFCPlayerSlot(room, socket.id);
        io.to(key).emit('fc:controllers', {
            controllers: room.controllers,
            playerSlots: room.playerSlots
        });
        syncFCUser(socket, room, key);
    });
    socket.on('fc:leave', () => leaveRoom(socket, 'fc'));

    socket.on('fc:load', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `fc:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'fc') return;
        if (!room.users.has(socket.id)) return;

        let filename = data.romPath ? decodeURIComponent(data.romPath) : (pickRandomROM() || '');
        if (!filename) {
            socket.emit('fc:error', { message: '没有可用的 ROM' });
            return;
        }

        const filePath = path.join(ROM_DIR, filename);
        if (!filePath.startsWith(ROM_DIR)) {
            socket.emit('fc:error', { message: '非法 ROM 路径' });
            return;
        }

        try {
            stopFCEmulator(room);
            room.romData = fs.readFileSync(filePath);
            room.romName = cleanRomName(filename);
            room.controllers = { 1: {}, 2: {} };
            room.frameCount = 0;
            room.lastState = null;
            startFCEmulator(room, key);
            io.to(key).emit('fc:init', {
                romName: room.romName,
                romData: room.romData.toString('base64'),
                frame: room.frameCount,
                state: room.lastState,
                controllers: room.controllers,
                playerSlots: room.playerSlots
            });
        } catch (e) {
            console.error('FC 加载 ROM 失败:', e);
            socket.emit('fc:error', { message: 'ROM 加载失败：' + e.message });
        }
    });

    socket.on('fc:button', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `fc:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'fc') return;
        if (!room.users.has(socket.id)) return;

        const slot = getFCPlayerSlot(room, socket.id);
        if (slot === 0) return;

        const button = parseInt(data.button, 10);
        const pressed = !!data.pressed;

        room.controllers[slot][button] = pressed;

        // 单人模式：房间只有一名玩家时，可同时控制两个手柄
        if (room.users.size === 1) {
            const otherSlot = slot === 1 ? 2 : 1;
            room.controllers[otherSlot][button] = pressed;
        }

        io.to(key).emit('fc:controllers', {
            controllers: room.controllers,
            playerSlots: room.playerSlots
        });
    });

    socket.on('fc:reset', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `fc:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'fc') return;
        if (!room.users.has(socket.id)) return;
        if (!room.nes || !room.romData) return;

        try {
            room.nes.loadROM(room.romData.toString('binary'));
            room.frameCount = 0;
            room.lastState = null;
            io.to(key).emit('fc:controllers', {
                controllers: room.controllers,
                playerSlots: room.playerSlots
            });
        } catch (e) {
            console.error('FC 重置失败:', e);
        }
    });

    // ===== 你画我猜 =====
    socket.on('pictionary:join', (data) => {
        joinRoom(socket, 'pictionary', data);
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (room) {
            broadcastPictionaryState(room, key);
            room.strokes.forEach(stroke => socket.emit('pictionary:stroke', stroke));
        }
    });
    socket.on('pictionary:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room) return;
        socket.join(key);
        socket.emit('pictionary:joined', {
            room: roomId,
            users: Array.from(room.users.values())
        });
        broadcastPictionaryState(room, key);
        room.strokes.forEach(stroke => socket.emit('pictionary:stroke', stroke));
    });
    socket.on('pictionary:leave', () => leaveRoom(socket, 'pictionary'));
    socket.on('pictionary:stroke', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (room.status !== 'drawing' || socket.id !== room.currentDrawer) return;
        const stroke = {
            id: data.id || (Date.now() + '_' + Math.random().toString(36).slice(2)),
            room: roomId,
            tool: data.tool,
            from: data.from,
            to: data.to,
            x: data.x,
            y: data.y,
            text: data.text,
            color: data.color,
            size: data.size || 4,
            alpha: data.alpha == null ? 1 : data.alpha,
            groupId: data.groupId
        };
        room.strokes.push(stroke);
        if (room.strokes.length > 3000) room.strokes.shift();
        socket.to(key).emit('pictionary:stroke', stroke);
    });
    socket.on('pictionary:undo', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (room.status !== 'drawing' || socket.id !== room.currentDrawer) return;
        const id = data.id;
        if (!id) return;
        const stroke = room.strokes.find(s => s.id === id);
        if (!stroke) return;
        const groupId = stroke.groupId;
        let removedIds;
        if (groupId) {
            removedIds = room.strokes.filter(s => s.groupId === groupId).map(s => s.id);
            room.strokes = room.strokes.filter(s => s.groupId !== groupId);
        } else {
            removedIds = [id];
            room.strokes = room.strokes.filter(s => s.id !== id);
        }
        io.to(key).emit('pictionary:strokes:removed', { room: roomId, ids: removedIds });
    });
    socket.on('pictionary:import', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (room.status !== 'drawing' || socket.id !== room.currentDrawer) return;
        const strokes = Array.isArray(data.strokes) ? data.strokes : [];
        strokes.forEach(s => {
            s.room = roomId;
            room.strokes.push(s);
        });
        if (room.strokes.length > 3000) room.strokes.splice(0, room.strokes.length - 3000);
        io.to(key).emit('pictionary:import', { room: roomId, strokes: strokes });
    });
    socket.on('pictionary:clear', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (socket.id !== room.currentDrawer) return;
        room.strokes = [];
        io.to(key).emit('pictionary:clear', { room: roomId });
    });
    socket.on('pictionary:guess', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (!room.users.has(socket.id)) return;
        handlePictionaryGuess(socket, room, key, data.text);
    });
    socket.on('pictionary:start', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `pictionary:${roomId}`;
        const room = rooms[key];
        if (!room || room.type !== 'pictionary') return;
        if (!room.users.has(socket.id)) return;
        if (room.status !== 'waiting' && room.status !== 'reveal') return;
        startPictionaryTurn(room, key);
    });

    // ===== 通用房间内聊天（聊天室 / 茶绘 / FC / 你画我猜）=====
    ['chat', 'oekaki', 'fc', 'pictionary'].forEach(type => {
        socket.on(`${type}:chat:join`, (data) => {
            const roomId = (data.room || '').toString().trim().toUpperCase();
            const key = `${type}:${roomId}`;
            const room = rooms[key];
            if (!room || !room.users.has(socket.id)) return;
            socket.emit(`${type}:chat:users`, {
                room: roomId,
                users: Array.from(room.users.values())
            });
        });
        socket.on(`${type}:chat:message`, (data) => {
            const roomId = (data.room || '').toString().trim().toUpperCase();
            const key = `${type}:${roomId}`;
            const room = rooms[key];
            if (!room || !room.users.has(socket.id)) return;
            const nick = room.users.get(socket.id);
            const payload = {
                room: roomId,
                nick: nick || '匿名',
                text: String(data.text || '').substring(0, 300),
                time: Date.now()
            };
            io.to(key).emit(`${type}:chat:message`, payload);
        });
    });

    socket.on('disconnect', () => {
        console.log('客户端断开:', socket.id);
        ['chat', 'oekaki', 'fc', 'pictionary'].forEach(type => leaveRoom(socket, type));
    });
});

function startServer(port) {
    server.listen(port, () => {
        console.log(`星間茶室已启动：http://localhost:${port}`);
        console.log(`ROM 目录：${ROM_DIR}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('服务器启动失败:', err);
            process.exit(1);
        }
    });
}

startServer(PORT);
