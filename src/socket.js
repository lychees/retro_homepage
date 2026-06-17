const setupLobby = require('./rooms/lobby');
const setupChat = require('./rooms/chat');
const setupOekaki = require('./rooms/oekaki');
const createFC = require('./rooms/fc');
const createPictionary = require('./rooms/pictionary');

module.exports = function setupSockets(io) {
    const createRoomManager = require('./rooms');
    const manager = createRoomManager(io);
    const fc = createFC(io);
    const pictionary = createPictionary(io, { rooms: manager.rooms });

    io.on('connection', (socket) => {
        console.log('客户端连接:', socket.id);

        setupLobby(io, manager, socket);
        setupChat(io, manager, socket);
        setupOekaki(io, manager, socket);
        fc.setup(manager)(socket);
        pictionary.setup(manager)(socket);

        socket.on('disconnect', () => {
            console.log('客户端断开:', socket.id);
            ['chat', 'oekaki', 'fc', 'pictionary'].forEach(type => manager.leaveRoom(socket, type));
        });
    });

    return manager;
};
