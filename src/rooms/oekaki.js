module.exports = function setupOekaki(io, manager, socket) {
    socket.on('oekaki:join', (data) => manager.joinRoom(socket, 'oekaki', data));
    socket.on('oekaki:rejoin', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        if (manager.rooms[key]) {
            socket.join(key);
            socket.emit('oekaki:joined', {
                room: roomId,
                users: Array.from(manager.rooms[key].users.values())
            });
            socket.emit('oekaki:color', { room: roomId, color: manager.rooms[key].currentColor });
            socket.emit('oekaki:layers', {
                room: roomId,
                layers: manager.rooms[key].layers,
                activeLayerId: manager.rooms[key].activeLayerId
            });
            manager.rooms[key].oekaki.forEach(stroke => socket.emit('oekaki:stroke', stroke));
        }
    });
    socket.on('oekaki:leave', () => manager.leaveRoom(socket, 'oekaki'));
    socket.on('oekaki:stroke', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
        if (!room || !data.color) return;
        room.currentColor = data.color;
        socket.to(key).emit('oekaki:color', { room: roomId, color: data.color });
    });
    socket.on('oekaki:clear', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
        if (!room) return;
        room.oekaki = [];
        io.to(key).emit('oekaki:clear', { room: roomId });
    });
    socket.on('oekaki:import', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
        if (!room || !data.layer) return;
        room.layers.push(data.layer);
        socket.to(key).emit('oekaki:layer:create', { room: roomId, layer: data.layer });
    });
    socket.on('oekaki:layer:delete', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
        if (!room || !data.id) return;
        room.layers = room.layers.filter(l => l.id !== data.id);
        room.oekaki = room.oekaki.filter(s => s.layerId !== data.id);
        io.to(key).emit('oekaki:layer:delete', { room: roomId, id: data.id });
    });
    socket.on('oekaki:layer:active', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
        if (!room || !data.id) return;
        room.activeLayerId = data.id;
        socket.to(key).emit('oekaki:layer:active', { room: roomId, id: data.id });
    });
    socket.on('oekaki:layer:visible', (data) => {
        const roomId = (data.room || '').toString().trim().toUpperCase();
        const key = `oekaki:${roomId}`;
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
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
        const room = manager.rooms[key];
        if (!room || !Array.isArray(data.order)) return;
        const map = {};
        room.layers.forEach(l => map[l.id] = l);
        room.layers = data.order.map(id => map[id]).filter(Boolean);
        io.to(key).emit('oekaki:layer:reorder', { room: roomId, order: room.layers.map(l => l.id) });
    });
};
