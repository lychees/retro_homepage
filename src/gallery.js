const express = require('express');
const { MAX_SUBMISSIONS } = require('./config');
const { submissions, getUserById, saveSubmissions } = require('./store');
const { createThumbnail } = require('./utils');

const router = express.Router();

router.get('/api/gallery', (req, res) => {
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

router.get('/api/gallery/:id', (req, res) => {
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

router.post('/api/gallery/:id/like', (req, res) => {
    const item = submissions.find(s => s.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    item.likes = (item.likes || 0) + 1;
    saveSubmissions();
    res.json({ id: item.id, likes: item.likes });
});

router.post('/api/gallery/:id/comment', (req, res) => {
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

router.post('/api/submit', (req, res) => {
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
        submissions.splice(0, submissions.length - MAX_SUBMISSIONS);
    }
    saveSubmissions();
    res.json({ id: submission.id, success: true });
});

module.exports = router;
