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

    function $(id) { return document.getElementById(id); }

    function bindOnce() {
        var createBtn = $('oekaki-create');
        var clearBtn = $('oekaki-clear');
        var leaveBtn = $('oekaki-leave');
        var downloadBtn = $('oekaki-download');

        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createOrJoin);
        }
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                clearCanvas();
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

    function drawStroke(from, to, tool, color, size, emit) {
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = size;
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.stroke();

        if (emit && roomId) {
            window.socket.emit('oekaki:stroke', {
                room: roomId,
                from: from,
                to: to,
                tool: tool,
                color: color,
                size: size
            });
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
        clearCanvas();
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
        roomId = null;
        chatRoom = null;
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
            drawStroke(data.from, data.to, data.tool, data.color, data.size, false);
        });
        window.socket.on('oekaki:clear', function (data) {
            if (data.room !== roomId) return;
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
