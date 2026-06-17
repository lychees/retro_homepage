const fs = require('fs');
const path = require('path');
const jsnes = require('jsnes');
const { ROM_DIR } = require('../config');

module.exports = function createFC(io) {
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

    function setupFC(manager) {
        return function (socket) {
            socket.on('fc:join', (data) => manager.joinRoom(socket, 'fc', data));
            socket.on('fc:rejoin', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `fc:${roomId}`;
                const room = manager.rooms[key];
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
            socket.on('fc:leave', () => manager.leaveRoom(socket, 'fc'));

            socket.on('fc:load', (data) => {
                const roomId = (data.room || '').toString().trim().toUpperCase();
                const key = `fc:${roomId}`;
                const room = manager.rooms[key];
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
                const room = manager.rooms[key];
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
                const room = manager.rooms[key];
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
        };
    }

    return {
        setup: setupFC,
        getFCPlayerSlot,
        startFCEmulator,
        stopFCEmulator,
        syncFCUser,
        pickRandomROM,
        cleanRomName
    };
};
