const express = require('express');
const https = require('https');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const OAuth2Strategy = require('passport-oauth2').Strategy;

const { BASE_URL } = require('../config');
const { users, saveUsers, getUserById, findUserByAccount, addUserAccount } = require('../store');
const { sanitizeUserInput, createOAuthUser, normalizeOAuthProfile, publicUser } = require('../utils');

const router = express.Router();

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = getUserById(id);
    done(null, user || false);
});

function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: '请先登录' });
    }
    next();
}

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
    router.get('/api/auth/github', (req, res, next) => startOAuth(req, res, next, 'github', { scope: ['read:user'] }));
    router.get('/api/auth/github/callback', passport.authenticate('github', { failureRedirect: '/#/account?error=github' }), (req, res) => {
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
    router.get('/api/auth/google', (req, res, next) => startOAuth(req, res, next, 'google', { scope: ['profile', 'email'] }));
    router.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: '/#/account?error=google' }), (req, res) => {
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
    router.get('/api/auth/qq', (req, res, next) => startOAuth(req, res, next, 'qq'));
    router.get('/api/auth/qq/callback', passport.authenticate('qq', { failureRedirect: '/#/account?error=qq' }), (req, res) => {
        handleOAuthCallback(req, res, 'qq', req.user);
    });
}

router.get('/api/auth/providers', (req, res) => {
    res.json({
        providers: {
            github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
            google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
            qq: !!(process.env.QQ_CLIENT_ID && process.env.QQ_CLIENT_SECRET)
        }
    });
});

// 账号仅通过第三方 OAuth 创建/登录，不再提供账号密码注册
router.post('/api/auth/register', (req, res) => {
    res.status(403).json({ error: '本站已关闭账号密码注册，请使用第三方账号登录。' });
});

router.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    const cleanUsername = sanitizeUserInput(username, 32).toLowerCase();
    const user = getUserByUsername(cleanUsername);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    try {
        const { comparePassword } = require('../utils');
        const ok = await comparePassword(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: '用户名或密码错误' });
        req.session.userId = user.id;
        res.json({ user: publicUser(user) });
    } catch (e) {
        console.error('登录失败:', e);
        res.status(500).json({ error: '登录失败' });
    }
});

router.post('/api/auth/logout', (req, res) => {
    req.session.destroy(function (err) {
        if (err) return res.status(500).json({ error: '登出失败' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

router.get('/api/auth/me', (req, res) => {
    const user = req.session && req.session.userId ? getUserById(req.session.userId) : null;
    res.json({ user: publicUser(user) });
});

router.post('/api/user/profile', requireAuth, async (req, res) => {
    const user = getUserById(req.session.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { nickname, avatar, bio } = req.body || {};
    if (nickname !== undefined) user.nickname = sanitizeUserInput(nickname, 16) || user.nickname;
    if (avatar !== undefined) user.avatar = sanitizeUserInput(avatar, 2048);
    if (bio !== undefined) user.bio = sanitizeUserInput(bio, 300);
    saveUsers();
    res.json({ user: publicUser(user) });
});

router.post('/api/user/social', requireAuth, (req, res) => {
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

router.get('/api/user/:id', (req, res) => {
    const user = getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { submissions } = require('../store');
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

module.exports = { router, requireAuth };
