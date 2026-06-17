module.exports = function setupLobby(io, manager, socket) {
    socket.on('lobby:getRooms', () => {
        const list = Object.values(manager.rooms).map(r => ({
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
        manager.getRoom(type, roomId, pwd);
        socket.emit('lobby:created', {
            type: type,
            room: roomId,
            pwd: pwd
        });
        manager.broadcastRooms();
    });
};
