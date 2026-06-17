module.exports = function createPictionary(io, { rooms }) {
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
            io.to(key).emit('pictionary:message', {
                room: room.id,
                system: true,
                text: '至少需要 2 位玩家才能开始游戏',
                time: Date.now()
            });
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

    function setupPictionary(manager) {
        return function (socket) {
            socket.on('pictionary:join', (data) => {
                manager.joinRoom(socket, 'pictionary', data);
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `pictionary:${roomId}`;
                const room = manager.rooms[key];
                if (room) {
                    broadcastPictionaryState(room, key);
                    room.strokes.forEach(stroke => socket.emit('pictionary:stroke', stroke));
                }
            });
            socket.on('pictionary:rejoin', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `pictionary:${roomId}`;
                const room = manager.rooms[key];
                if (!room) return;
                socket.join(key);
                socket.emit('pictionary:joined', {
                    room: roomId,
                    users: Array.from(room.users.values())
                });
                broadcastPictionaryState(room, key);
                room.strokes.forEach(stroke => socket.emit('pictionary:stroke', stroke));
            });
            socket.on('pictionary:leave', () => manager.leaveRoom(socket, 'pictionary'));
            socket.on('pictionary:stroke', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `pictionary:${roomId}`;
                const room = manager.rooms[key];
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
                const room = manager.rooms[key];
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
                const room = manager.rooms[key];
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
                const room = manager.rooms[key];
                if (!room || room.type !== 'pictionary') return;
                if (socket.id !== room.currentDrawer) return;
                room.strokes = [];
                io.to(key).emit('pictionary:clear', { room: roomId });
            });
            socket.on('pictionary:guess', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `pictionary:${roomId}`;
                const room = manager.rooms[key];
                if (!room || room.type !== 'pictionary') return;
                if (!room.users.has(socket.id)) return;
                handlePictionaryGuess(socket, room, key, data.text);
            });
            socket.on('pictionary:start', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `pictionary:${roomId}`;
                const room = manager.rooms[key];
                if (!room || room.type !== 'pictionary') return;
                if (!room.users.has(socket.id)) return;
                if (room.status !== 'waiting' && room.status !== 'reveal') return;
                startPictionaryTurn(room, key);
            });
        };
    }

    return {
        setup: setupPictionary,
        initPictionaryRoom,
        endPictionaryTurn
    };
};
