/**
 * FC 游戏室模块（服务端 authoritative 版本）
 * 参考 https://github.com/lychees/retrochatroom
 */
(function () {
    'use strict';

    var roomId = null;
    var nick = '';
    var nes = null;
    var canvas, ctx, imageData;
    var controllers = { 1: {}, 2: {} };
    var playerSlots = [null, null];
    var assignedSlot = 0;
    var keysPressed = new Set();
    var localFrame = 0;
    var targetFrame = 0;

    // 渲染循环
    var rafId = null;
    var lastFrameTime = 0;
    var frameInterval = 1000 / 60;
    var frameDebt = 0;
    var catchUpMode = false;

    // 音频（使用 AudioBufferSourceNode 连续调度，避免 ScriptProcessorNode 断续）
    var audioCtx = null;
    var pendingSamples = [];
    var nextAudioTime = 0;
    var audioFlushThreshold = 4096; // 累积到这么多立体声样本后播放一次
    var audioMaxBuffer = 8192;      // 防止缓冲区无限增长

    function $(id) { return document.getElementById(id); }

    // 玩家 1 按键
    var P1_KEYS = {
        'KeyW': { slot: 1, button: jsnes.Controller.BUTTON_UP },
        'KeyS': { slot: 1, button: jsnes.Controller.BUTTON_DOWN },
        'KeyA': { slot: 1, button: jsnes.Controller.BUTTON_LEFT },
        'KeyD': { slot: 1, button: jsnes.Controller.BUTTON_RIGHT },
        'KeyQ': { slot: 1, button: jsnes.Controller.BUTTON_SELECT },
        'KeyE': { slot: 1, button: jsnes.Controller.BUTTON_START },
        'KeyJ': { slot: 1, button: jsnes.Controller.BUTTON_B },
        'KeyK': { slot: 1, button: jsnes.Controller.BUTTON_A }
    };

    // 玩家 2 按键
    var P2_KEYS = {
        'ArrowUp': { slot: 2, button: jsnes.Controller.BUTTON_UP },
        'ArrowDown': { slot: 2, button: jsnes.Controller.BUTTON_DOWN },
        'ArrowLeft': { slot: 2, button: jsnes.Controller.BUTTON_LEFT },
        'ArrowRight': { slot: 2, button: jsnes.Controller.BUTTON_RIGHT },
        'Insert': { slot: 2, button: jsnes.Controller.BUTTON_SELECT },
        'Enter': { slot: 2, button: jsnes.Controller.BUTTON_START },
        'Numpad1': { slot: 2, button: jsnes.Controller.BUTTON_B },
        'Digit1': { slot: 2, button: jsnes.Controller.BUTTON_B },
        'Numpad2': { slot: 2, button: jsnes.Controller.BUTTON_A },
        'Digit2': { slot: 2, button: jsnes.Controller.BUTTON_A }
    };

    function bindOnce() {
        var createBtn = $('fc-create');
        var loadBtn = $('fc-load-rom');
        var leaveBtn = $('fc-leave');

        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createOrJoin);
        }
        if (loadBtn && !loadBtn._bound) {
            loadBtn._bound = true;
            loadBtn.addEventListener('click', loadSelectedRom);
        }
        if (leaveBtn && !leaveBtn._bound) {
            leaveBtn._bound = true;
            leaveBtn.addEventListener('click', leaveRoom);
        }
    }

    function initAudio() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return;
        }
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
            nextAudioTime = audioCtx.currentTime;
        } catch (e) {
            console.error('FC 音频初始化失败', e);
        }
    }

    function audioSample(left, right) {
        if (!audioCtx) return;
        pendingSamples.push(left, right);
        // 防止缓冲区无限增长导致延迟越来越大
        if (pendingSamples.length > audioMaxBuffer) {
            pendingSamples.splice(0, pendingSamples.length - audioMaxBuffer);
        }
    }

    function flushAudio() {
        if (!audioCtx || pendingSamples.length < audioFlushThreshold) return;
        var count = Math.floor(pendingSamples.length / 2) * 2;
        var frames = count / 2;
        var buffer = audioCtx.createBuffer(2, frames, 44100);
        var left = buffer.getChannelData(0);
        var right = buffer.getChannelData(1);
        for (var i = 0; i < frames; i++) {
            left[i] = pendingSamples[i * 2];
            right[i] = pendingSamples[i * 2 + 1];
        }
        pendingSamples = pendingSamples.slice(count);

        var src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);

        var now = audioCtx.currentTime;
        if (nextAudioTime < now) nextAudioTime = now;
        src.start(nextAudioTime);
        nextAudioTime += buffer.duration;
    }

    function loadRoms() {
        fetch('/api/roms')
            .then(function (res) { return res.json(); })
            .then(function (data) {
                var select = $('fc-rom-select');
                if (!select) return;
                select.innerHTML = '<option value="">-- 选择 ROM --</option>';
                (data.roms || []).forEach(function (rom) {
                    var opt = document.createElement('option');
                    opt.value = rom.path;
                    opt.textContent = rom.name;
                    select.appendChild(opt);
                });
            })
            .catch(function (e) { console.error('加载 ROM 列表失败', e); });
    }

    function createOrJoin() {
        nick = ($('fc-nick').value || '红白机战士').trim().substring(0, 16);
        roomId = ($('fc-room').value || window.generateRoomId()).trim().toUpperCase();
        if (!roomId) roomId = window.generateRoomId();
        $('fc-room').value = roomId;
        var pwd = ($('fc-pwd') && $('fc-pwd').value || '').trim();
        window.socket.emit('fc:join', { room: roomId, nick: nick, pwd: pwd });
    }

    function enterRoom(id, users) {
        $('fc-lobby').style.display = 'none';
        $('fc-room-view').style.display = 'block';
        $('fc-room-id').textContent = '#' + id;
        updateUsers(users || []);
        loadRoms();
        bindKeys();
        setStatus('请选择 ROM 开始游戏');
    }

    function leaveRoom() {
        stopEmulator();
        if (roomId) window.socket.emit('fc:leave', { room: roomId });
        roomId = null;
        assignedSlot = 0;
        playerSlots = [null, null];
        $('fc-room-view').style.display = 'none';
        $('fc-lobby').style.display = 'block';
        $('fc-users').innerHTML = '';
        unbindKeys();
    }

    function updateUsers(users) {
        $('fc-online').textContent = users.length;
        var ul = $('fc-users');
        ul.innerHTML = '';
        users.forEach(function (u) {
            var li = document.createElement('li');
            li.textContent = '✦ ' + u;
            ul.appendChild(li);
        });
    }

    function updateSlots() {
        assignedSlot = 0;
        if (playerSlots[0] === window.socket.id) assignedSlot = 1;
        else if (playerSlots[1] === window.socket.id) assignedSlot = 2;

        var status = $('fc-status');
        if (!status) return;

        var p1Text = playerSlots[0] ? '玩家 1（已占用）' : '玩家 1（空闲）';
        var p2Text = playerSlots[1] ? '玩家 2（已占用）' : '玩家 2（空闲）';
        if (assignedSlot === 1) p1Text = '玩家 1（你）';
        if (assignedSlot === 2) p2Text = '玩家 2（你）';

        var soloHint = isSoloMode() ? ' · 单人模式：可同时使用 P1 与 P2 按键' : '';
        status.textContent = p1Text + ' / ' + p2Text + soloHint;
    }

    function isSoloMode() {
        if (!assignedSlot) return false;
        var occupied = 0;
        if (playerSlots[0]) occupied++;
        if (playerSlots[1]) occupied++;
        return occupied === 1;
    }

    function loadSelectedRom() {
        var path = $('fc-rom-select').value;
        if (!path) return;
        window.socket.emit('fc:load', { room: roomId, romPath: path });
        setStatus('正在加载 ROM...');
    }

    function loadDefaultPalette() {
        try {
            if (nes && nes.ppu && nes.ppu.palTable && nes.ppu.palTable.loadDefaultPalette) {
                nes.ppu.palTable.loadDefaultPalette();
            }
        } catch (e) {
            console.warn('加载默认调色板失败', e);
        }
    }

    function loadFCGame(data) {
        stopEmulator();
        if (!data.romData) return;

        initAudio();
        canvas = $('fc-canvas');
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        imageData = ctx.createImageData(256, 240);

        try {
            nes = new jsnes.NES({
                onFrame: renderFrame,
                onAudioSample: audioSample,
                emulateSound: true,
                sampleRate: 44100
            });

            var romString = atob(data.romData);
            nes.loadROM(romString);
            loadDefaultPalette();

            if (data.state) {
                try {
                    nes.fromJSON(data.state);
                } catch (e) {
                    console.warn('FC 状态恢复失败，从头开始', e);
                }
            }
            // 同步来的状态可能携带服务端调色板，统一重置为默认调色板
            loadDefaultPalette();

            controllers = data.controllers || { 1: {}, 2: {} };
            playerSlots = data.playerSlots || [null, null];
            localFrame = data.frame || 0;
            targetFrame = localFrame;
            catchUpMode = true;
            updateSlots();
            startGameLoop();
            setStatus('游戏运行中：' + (data.romName || '未知 ROM'));
        } catch (e) {
            setStatus('ROM 加载失败: ' + e.message);
        }
    }

    function renderFrame(frameBuffer) {
        if (!ctx || !imageData) return;
        var data = imageData.data;
        for (var i = 0; i < frameBuffer.length; i++) {
            var pixel = frameBuffer[i];
            // jsnes 像素格式为 0xRRGGBB
            data[i * 4] = (pixel >> 16) & 0xFF;
            data[i * 4 + 1] = (pixel >> 8) & 0xFF;
            data[i * 4 + 2] = pixel & 0xFF;
            data[i * 4 + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    function applyControllers() {
        if (!nes) return;
        for (var c = 1; c <= 2; c++) {
            var state = controllers[c] || {};
            for (var btn = 0; btn < 8; btn++) {
                if (state[btn]) nes.buttonDown(c, btn);
                else nes.buttonUp(c, btn);
            }
        }
    }

    function runFrame() {
        if (!nes) return;
        applyControllers();
        nes.frame();
        localFrame++;
        flushAudio();
    }

    function startGameLoop() {
        if (rafId) return;
        lastFrameTime = performance.now();
        frameDebt = 0;
        rafId = requestAnimationFrame(gameLoop);
    }

    function stopGameLoop() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastFrameTime = 0;
        frameDebt = 0;
        catchUpMode = false;
    }

    function gameLoop(timestamp) {
        if (!nes) {
            stopGameLoop();
            return;
        }

        var elapsed = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        frameDebt += elapsed / frameInterval;

        // 正常速度下运行累计的帧数
        var framesToRun = Math.floor(frameDebt);

        // 追赶模式：若落后服务端较多，加速追赶
        if (catchUpMode && targetFrame - localFrame > 5) {
            framesToRun = Math.max(framesToRun, 2);
        }

        // 若已追上或超过服务端，退出追赶模式
        if (targetFrame - localFrame <= 2) {
            catchUpMode = false;
        }

        // 限制单帧爆发，避免卡顿后一次性追太多
        if (framesToRun > 3) framesToRun = 3;
        if (framesToRun < 1) framesToRun = 0;

        for (var i = 0; i < framesToRun; i++) {
            runFrame();
        }
        frameDebt -= framesToRun;
        if (frameDebt > 2) frameDebt = 0; // 防止后台切换后 debt 爆炸

        rafId = requestAnimationFrame(gameLoop);
    }

    function stopEmulator() {
        stopGameLoop();
        nes = null;
        controllers = { 1: {}, 2: {} };
        localFrame = 0;
        targetFrame = 0;
        pendingSamples = [];
        nextAudioTime = 0;
    }

    function setStatus(text) {
        var el = $('fc-status');
        if (el) el.textContent = text;
    }

    function bindKeys() {
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
    }

    function unbindKeys() {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keyup', handleKeyUp);
    }

    function handleKeyDown(e) {
        var view = $('fc-room-view');
        if (!view || view.style.display === 'none') return;

        var map = P1_KEYS[e.code] || P2_KEYS[e.code];
        if (!map) return;

        if (!isSoloMode() && assignedSlot !== map.slot) return;

        e.preventDefault();
        if (keysPressed.has(e.code)) return;
        keysPressed.add(e.code);

        window.socket.emit('fc:button', {
            room: roomId,
            slot: map.slot,
            button: map.button,
            pressed: true
        });
    }

    function handleKeyUp(e) {
        var view = $('fc-room-view');
        if (!view || view.style.display === 'none') return;

        var map = P1_KEYS[e.code] || P2_KEYS[e.code];
        if (!map) return;
        if (!keysPressed.has(e.code)) return;
        keysPressed.delete(e.code);

        if (!isSoloMode() && assignedSlot !== map.slot) return;

        e.preventDefault();
        window.socket.emit('fc:button', {
            room: roomId,
            slot: map.slot,
            button: map.button,
            pressed: false
        });
    }

    function initSocketListeners() {
        if (!window.socket) return;
        window.socket.off('fc:joined');
        window.socket.off('fc:error');
        window.socket.off('fc:users');
        window.socket.off('fc:init');
        window.socket.off('fc:controllers');
        window.socket.off('fc:state');

        window.socket.on('fc:joined', function (data) {
            enterRoom(data.room, data.users);
        });
        window.socket.on('fc:error', function (data) {
            alert('FC 游戏室：' + data.message);
        });
        window.socket.on('fc:users', function (data) {
            if (data.room === roomId) updateUsers(data.users);
        });
        window.socket.on('fc:init', function (data) {
            if (data.room && data.room !== roomId) return;
            loadFCGame(data);
        });
        window.socket.on('fc:controllers', function (data) {
            controllers = data.controllers || { 1: {}, 2: {} };
            playerSlots = data.playerSlots || [null, null];
            if (data.frame) targetFrame = data.frame;
            updateSlots();
            // 渲染由 requestAnimationFrame 循环独立驱动，这里只更新输入状态与目标帧号
        });
        window.socket.on('fc:state', function (data) {
            if (!nes || !data.state) return;
            try {
                nes.fromJSON(data.state);
                // 统一默认调色板，防止颜色跳回偏蓝
                loadDefaultPalette();
                controllers = data.controllers || controllers;
                playerSlots = data.playerSlots || playerSlots;
                localFrame = data.frame || localFrame;
                updateSlots();
            } catch (e) {
                console.warn('FC 状态同步失败', e);
            }
        });
    }

    window.initFc = function () {
        bindOnce();
        initSocketListeners();

        var query = window.currentQuery || {};
        if (query.room && !roomId) {
            $('fc-room').value = query.room;
            if (query.pwd && $('fc-pwd')) $('fc-pwd').value = query.pwd;
            createOrJoin();
            return;
        }

        if (roomId) {
            $('fc-lobby').style.display = 'none';
            $('fc-room-view').style.display = 'block';
            $('fc-room-id').textContent = '#' + roomId;
            loadRoms();
            bindKeys();
            window.socket.emit('fc:rejoin', { room: roomId });
        }
    };
})();
