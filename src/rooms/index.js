const createFC = require('./fc');
const createPictionary = require('./pictionary');

module.exports = function createRoomManager(io) {
    const rooms = {};
    const fc = createFC(io);
    const pictionary = createPictionary(io, { rooms });

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
                pictionary.initPictionaryRoom(base);
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
                fc.stopFCEmulator(room);
            }
        }

        // 你画我猜：作画者离开则结束本回合
        if (room.type === 'pictionary') {
            if (socket.id === room.currentDrawer && room.users.size > 0) {
                pictionary.endPictionaryTurn(room, joinedKey, 'drawer_left');
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
            const slot = fc.getFCPlayerSlot(room, socket.id);
            io.to(joinedKey).emit('fc:controllers', {
                controllers: room.controllers,
                playerSlots: room.playerSlots
            });
            fc.syncFCUser(socket, room, joinedKey);
        }

        broadcastRooms();
    }

    return {
        rooms,
        getRoom,
        leaveRoom,
        joinRoom,
        broadcastRooms,
        fc,
        pictionary
    };
};
