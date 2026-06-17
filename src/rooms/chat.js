module.exports = function setupChat(io, manager, socket) {
    ['chat', 'oekaki', 'fc', 'pictionary'].forEach(type => {
        socket.on(`${type}:chat:join`, (data) => {
            const roomId = (data.room || '').toString().trim().toUpperCase();
            const key = `${type}:${roomId}`;
            const room = manager.rooms[key];
            if (!room || !room.users.has(socket.id)) return;
            socket.emit(`${type}:chat:users`, {
                room: roomId,
                users: Array.from(room.users.values())
            });
        });
        socket.on(`${type}:chat:message`, (data) => {
            const roomId = (data.room || '').toString().trim().toUpperCase();
            const key = `${type}:${roomId}`;
            const room = manager.rooms[key];
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

    // 聊天室基础事件
    socket.on('chat:join', (data) => manager.joinRoom(socket, 'chat', data));
    socket.on('chat:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `chat:${roomId}`;
        if (manager.rooms[key]) {
            socket.join(key);
            socket.emit('chat:joined', {
                room: roomId,
                users: Array.from(manager.rooms[key].users.values())
            });
        }
    });
    socket.on('chat:leave', () => manager.leaveRoom(socket, 'chat'));
};
