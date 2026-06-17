/**
 * 星間茶室 - 服务端
 * Express + Socket.io
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const { Server } = require('socket.io');

const { PORT, SESSION_SECRET } = require('./src/config');
const auth = require('./src/auth');
const galleryRouter = require('./src/gallery');
const romsRouter = require('./src/roms');
const setupSockets = require('./src/socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ['websocket', 'polling']
});

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.json({ limit: '5mb' }));

// 路由
app.use(auth.router);
app.use(galleryRouter);
app.use(romsRouter);

// Socket.io 房间逻辑
setupSockets(io);

// 兜底返回 index.html（支持 SPA hash 路由）
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`星間茶室已启动：http://localhost:${PORT}`);
    const { ROM_DIR } = require('./src/config');
    console.log(`ROM 目录：${ROM_DIR}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请先结束占用该端口的进程。`);
    } else {
        console.error('服务器启动失败:', err);
    }
    process.exit(1);
});
