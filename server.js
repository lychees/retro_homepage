/**
 * 星間茶室 - 服务端
 * Express + Socket.io
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const jsnes = require('jsnes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const ROM_DIR = path.join(__dirname, 'public', 'roms');

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

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
        rooms[key] = base;
    }
    return rooms[key];
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
        if (room.users.size > 0) {
            io.to(joinedKey).emit('fc:controllers', {
                controllers: room.controllers,
                playerSlots: room.playerSlots
            });
        } else {
            stopFCEmulator(room);
        }
    }

    io.to(joinedKey).emit(`${type}:users`, {
        room: room.id,
        users: Array.from(room.users.values())
    });

    if (room.users.size === 0 && type !== 'oekaki') {
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
        if (!['chat', 'oekaki', 'fc'].includes(type)) {
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
        io.to(key).emit('oekaki:color', { room: roomId, color: data.color });
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

    // ===== 通用房间内聊天（聊天室 / 茶绘 / FC）=====
    ['chat', 'oekaki', 'fc'].forEach(type => {
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
        ['chat', 'oekaki', 'fc'].forEach(type => leaveRoom(socket, type));
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
