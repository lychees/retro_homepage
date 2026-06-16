/**
 * 茶绘房间模块
 */
(function () {
    'use strict';

    var roomId = null;
    var nick = '';
    var canvas, ctx;
    var drawing = false;
    var currentTool = 'pen';
    var currentColor = '#000000';
    var currentSize = 4;
    var lastPos = null;
    var chatRoom = null;
    var localStrokes = [];
    var replayTimer = null;

    function $(id) { return document.getElementById(id); }

    function bindOnce() {
        var createBtn = $('oekaki-create');
        var clearBtn = $('oekaki-clear');
        var leaveBtn = $('oekaki-leave');
        var downloadBtn = $('oekaki-download');
        var replayBtn = $('oekaki-replay');
        var undoBtn = $('oekaki-undo');

        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createOrJoin);
        }
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                clearCanvas();
                localStrokes = [];
                if (roomId) window.socket.emit('oekaki:clear', { room: roomId });
            });
        }
        if (leaveBtn && !leaveBtn._bound) {
            leaveBtn._bound = true;
            leaveBtn.addEventListener('click', leaveRoom);
        }
        if (downloadBtn && !downloadBtn._bound) {
            downloadBtn._bound = true;
            downloadBtn.addEventListener('click', downloadCanvas);
        }
        if (replayBtn && !replayBtn._bound) {
            replayBtn._bound = true;
            replayBtn.addEventListener('click', replayStrokes);
        }
        if (undoBtn && !undoBtn._bound) {
            undoBtn._bound = true;
            undoBtn.addEventListener('click', undoLastStroke);
        }
    }

    function bindTools() {
        var tools = document.querySelectorAll('[data-tool]');
        tools.forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                tools.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                currentTool = btn.getAttribute('data-tool');
            });
        });

        var colors = document.querySelectorAll('[data-color]');
        colors.forEach(function (sw) {
            if (sw._bound) return;
            sw._bound = true;
            sw.addEventListener('click', function () {
                colors.forEach(function (c) { c.classList.remove('active'); });
                sw.classList.add('active');
                currentColor = sw.getAttribute('data-color');
                currentTool = 'pen';
                document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
                document.querySelector('[data-tool="pen"]').classList.add('active');
            });
        });

        var sizes = document.querySelectorAll('#brush-sizes span');
        sizes.forEach(function (s) {
            if (s._bound) return;
            s._bound = true;
            s.addEventListener('click', function () {
                sizes.forEach(function (x) { x.classList.remove('active'); });
                s.classList.add('active');
                currentSize = parseInt(s.getAttribute('data-size'), 10);
            });
        });
    }

    function bindKeys() {
        document.addEventListener('keydown', handleKeyDown);
    }

    function unbindKeys() {
        document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
        var view = $('oekaki-room-view');
        if (!view || view.style.display === 'none') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoLastStroke();
        }
    }

    function bindCanvas() {
        canvas = $('oekaki-canvas');
        if (!canvas || canvas._bound) return;
        ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        canvas._bound = true;

        function getPos(e) {
            var rect = canvas.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        }

        function start(e) {
            e.preventDefault();
            drawing = true;
            lastPos = getPos(e);
        }

        function move(e) {
            e.preventDefault();
            if (!drawing || !lastPos) return;
            var pos = getPos(e);
            drawStroke(lastPos, pos, currentTool, currentColor, currentSize, true);
            lastPos = pos;
        }

        function end(e) {
            e.preventDefault();
            drawing = false;
            lastPos = null;
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end, { passive: false });
    }

    function drawStroke(from, to, tool, color, size, emit, strokeId) {
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = size;
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.stroke();

        if (emit && roomId) {
            var id = strokeId || (Date.now() + '_' + Math.random().toString(36).slice(2));
            var stroke = {
                id: id,
                room: roomId,
                from: from,
                to: to,
                tool: tool,
                color: color,
                size: size
            };
            localStrokes.push(stroke);
            window.socket.emit('oekaki:stroke', stroke);
        }
    }

    function clearCanvas() {
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function downloadCanvas() {
        if (!canvas) return;
        var link = document.createElement('a');
        link.download = 'oekaki-' + (roomId || 'solo') + '-' + Date.now() + '.png';
        link.href = canvas.toDataURL();
        link.click();
    }

    function undoLastStroke() {
        if (!roomId || localStrokes.length === 0) return;
        var stroke = localStrokes[localStrokes.length - 1];
        window.socket.emit('oekaki:undo', { room: roomId, id: stroke.id });
    }

    function removeStrokeById(id) {
        localStrokes = localStrokes.filter(function (s) { return s.id !== id; });
        redrawAllStrokes();
    }

    function redrawAllStrokes() {
        if (!ctx) return;
        clearCanvas();
        localStrokes.forEach(function (s) {
            ctx.beginPath();
            ctx.moveTo(s.from.x, s.from.y);
            ctx.lineTo(s.to.x, s.to.y);
            ctx.lineWidth = s.size;
            ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
            ctx.stroke();
        });
    }

    function replayStrokes() {
        if (!ctx || localStrokes.length === 0) return;
        if (replayTimer) {
            clearInterval(replayTimer);
            replayTimer = null;
        }
        clearCanvas();
        var i = 0;
        replayTimer = setInterval(function () {
            if (i >= localStrokes.length) {
                clearInterval(replayTimer);
                replayTimer = null;
                return;
            }
            var s = localStrokes[i];
            ctx.beginPath();
            ctx.moveTo(s.from.x, s.from.y);
            ctx.lineTo(s.to.x, s.to.y);
            ctx.lineWidth = s.size;
            ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
            ctx.stroke();
            i++;
        }, 30); // 约 33fps 回放
    }

    function createOrJoin() {
        nick = ($('oekaki-nick').value || '涂鸦星人').trim().substring(0, 16);
        roomId = ($('oekaki-room').value || window.generateRoomId()).trim().toUpperCase();
        if (!roomId) roomId = window.generateRoomId();
        $('oekaki-room').value = roomId;
        var pwd = ($('oekaki-pwd') && $('oekaki-pwd').value || '').trim();
        window.socket.emit('oekaki:join', { room: roomId, nick: nick, pwd: pwd });
    }

    function enterRoom(id, users) {
        $('oekaki-lobby').style.display = 'none';
        $('oekaki-room-view').style.display = 'block';
        $('oekaki-room-id').textContent = '#' + id;
        bindCanvas();
        bindTools();
        bindKeys();
        clearCanvas();
        localStrokes = [];
        updateUsers(users || []);
        if (!chatRoom) {
            chatRoom = new window.ChatRoom('oekaki', id, {
                messagesId: 'oekaki-chat-messages',
                inputId: 'oekaki-chat-input',
                sendId: 'oekaki-chat-send',
                usersId: 'oekaki-users',
                onlineId: 'oekaki-online'
            });
            chatRoom.init();
        }
        chatRoom.roomId = id;
        chatRoom.join(nick);
        chatRoom.updateUsers(users || []);
    }

    function leaveRoom() {
        if (roomId) window.socket.emit('oekaki:leave', { room: roomId });
        unbindKeys();
        if (replayTimer) {
            clearInterval(replayTimer);
            replayTimer = null;
        }
        roomId = null;
        chatRoom = null;
        localStrokes = [];
        $('oekaki-room-view').style.display = 'none';
        $('oekaki-lobby').style.display = 'block';
        $('oekaki-users').innerHTML = '';
        $('oekaki-chat-messages').innerHTML = '';
    }

    function updateUsers(users) {
        $('oekaki-online').textContent = users.length;
        var ul = $('oekaki-users');
        ul.innerHTML = '';
        users.forEach(function (u) {
            var li = document.createElement('li');
            li.textContent = '✦ ' + u;
            ul.appendChild(li);
        });
    }

    function initSocketListeners() {
        if (!window.socket) return;
        window.socket.off('oekaki:joined');
        window.socket.off('oekaki:error');
        window.socket.off('oekaki:stroke');
        window.socket.off('oekaki:undo');
        window.socket.off('oekaki:clear');
        window.socket.off('oekaki:users');

        window.socket.on('oekaki:joined', function (data) {
            enterRoom(data.room, data.users);
        });
        window.socket.on('oekaki:error', function (data) {
            alert('茶绘房间：' + data.message);
        });
        window.socket.on('oekaki:stroke', function (data) {
            if (data.room !== roomId) return;
            // 避免重复添加自己发出的笔触
            var exists = localStrokes.some(function (s) { return s.id === data.id; });
            if (!exists) localStrokes.push(data);
            drawStroke(data.from, data.to, data.tool, data.color, data.size, false, data.id);
        });
        window.socket.on('oekaki:undo', function (data) {
            if (data.room !== roomId) return;
            removeStrokeById(data.id);
        });
        window.socket.on('oekaki:clear', function (data) {
            if (data.room !== roomId) return;
            localStrokes = [];
            clearCanvas();
        });
        window.socket.on('oekaki:users', function (data) {
            if (data.room === roomId) updateUsers(data.users);
        });
    }

    window.initOekaki = function () {
        bindOnce();
        bindTools();
        initSocketListeners();

        var query = window.currentQuery || {};
        if (query.room && !roomId) {
            $('oekaki-room').value = query.room;
            if (query.pwd && $('oekaki-pwd')) $('oekaki-pwd').value = query.pwd;
            createOrJoin();
            return;
        }

        if (roomId) {
            $('oekaki-lobby').style.display = 'none';
            $('oekaki-room-view').style.display = 'block';
            $('oekaki-room-id').textContent = '#' + roomId;
            bindCanvas();
            window.socket.emit('oekaki:rejoin', { room: roomId });
            if (chatRoom) {
                chatRoom.roomId = roomId;
                chatRoom.bindSocket();
                chatRoom.join(nick);
            }
        }
    };
})();
