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
    var currentFont = '20px VT323, monospace';
    var lastPos = null;
    var currentGroupId = null;
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
        var exportBtn = $('oekaki-export');
        var importInput = $('oekaki-import');

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
        if (exportBtn && !exportBtn._bound) {
            exportBtn._bound = true;
            exportBtn.addEventListener('click', exportStrokes);
        }
        if (importInput && !importInput._bound) {
            importInput._bound = true;
            importInput.addEventListener('change', handleImport);
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
                setColor(sw.getAttribute('data-color'), true);
                currentTool = 'pen';
                document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
                document.querySelector('[data-tool="pen"]').classList.add('active');
            });
        });

        var picker = $('oekaki-color-picker');
        if (picker && !picker._bound) {
            picker._bound = true;
            picker.addEventListener('input', function () {
                setColor(picker.value, true);
                currentTool = 'pen';
                document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
                document.querySelector('[data-tool="pen"]').classList.add('active');
            });
        }

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
            if (currentTool === 'text') {
                var pos = getPos(e);
                placeText(pos.x, pos.y);
                return;
            }
            drawing = true;
            currentGroupId = Date.now() + '_' + Math.random().toString(36).slice(2);
            lastPos = getPos(e);
        }

        function move(e) {
            e.preventDefault();
            if (currentTool === 'text' || !drawing || !lastPos) return;
            var pos = getPos(e);
            drawStroke(lastPos, pos, currentTool, currentColor, currentSize, true, null, currentGroupId);
            lastPos = pos;
        }

        function end(e) {
            e.preventDefault();
            drawing = false;
            lastPos = null;
            currentGroupId = null;
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', end);
        canvas.addEventListener('mouseleave', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end, { passive: false });
    }

    function setColor(color, emit) {
        currentColor = color;
        var picker = $('oekaki-color-picker');
        if (picker) picker.value = color;
        document.querySelectorAll('[data-color]').forEach(function (c) {
            if (c.getAttribute('data-color').toLowerCase() === color.toLowerCase()) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });
        if (emit && roomId) {
            window.socket.emit('oekaki:color', { room: roomId, color: color });
        }
    }

    function drawStroke(from, to, tool, color, size, emit, strokeId, groupId) {
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
                type: 'line',
                groupId: groupId || null,
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

    function placeText(x, y) {
        var text = prompt('请输入文字：');
        if (!text || !text.trim()) return;
        drawText(x, y, text.trim(), currentColor, currentSize, true);
    }

    function drawText(x, y, text, color, size, emit, strokeId) {
        if (!ctx) return;
        ctx.font = Math.max(size * 5, 14) + 'px VT323, monospace';
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, y);

        if (emit && roomId) {
            var id = strokeId || (Date.now() + '_' + Math.random().toString(36).slice(2));
            var groupId = Date.now() + '_' + Math.random().toString(36).slice(2);
            var stroke = {
                id: id,
                room: roomId,
                type: 'text',
                groupId: groupId,
                x: x,
                y: y,
                text: text,
                color: color,
                size: size
            };
            localStrokes.push(stroke);
            window.socket.emit('oekaki:stroke', stroke);
        }
    }

    function renderStroke(s) {
        if (!ctx) return;
        if (s.type === 'text') {
            ctx.font = Math.max((s.size || 4) * 5, 14) + 'px VT323, monospace';
            ctx.fillStyle = s.color;
            ctx.textBaseline = 'top';
            ctx.fillText(s.text, s.x, s.y);
        } else {
            ctx.beginPath();
            ctx.moveTo(s.from.x, s.from.y);
            ctx.lineTo(s.to.x, s.to.y);
            ctx.lineWidth = s.size;
            ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
            ctx.stroke();
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
        if (stroke.groupId) {
            window.socket.emit('oekaki:undoGroup', { room: roomId, groupId: stroke.groupId });
        } else {
            // 兼容无 groupId 的历史笔触（导入或旧数据）
            window.socket.emit('oekaki:undo', { room: roomId, id: stroke.id });
        }
    }

    function removeStrokeById(id) {
        localStrokes = localStrokes.filter(function (s) { return s.id !== id; });
        redrawAllStrokes();
    }

    function removeStrokeGroup(groupId) {
        localStrokes = localStrokes.filter(function (s) { return s.groupId !== groupId; });
        redrawAllStrokes();
    }

    function redrawAllStrokes() {
        if (!ctx) return;
        clearCanvas();
        localStrokes.forEach(renderStroke);
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
            renderStroke(localStrokes[i]);
            i++;
        }, 30); // 约 33fps 回放
    }

    function exportStrokes() {
        var data = {
            version: 1,
            canvas: { width: canvas.width, height: canvas.height },
            strokes: localStrokes
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.download = 'oekaki-process-' + (roomId || 'solo') + '-' + Date.now() + '.oekaki.json';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function handleImport(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (event) {
            try {
                var data = JSON.parse(event.target.result);
                if (!data || !Array.isArray(data.strokes)) {
                    alert('导入失败：文件格式不正确');
                    return;
                }
                importStrokes(data.strokes);
            } catch (err) {
                alert('导入失败：' + err.message);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    function importStrokes(strokes) {
        // 给导入的笔触重新生成 id，避免与现有 id 冲突
        var imported = strokes.map(function (s) {
            var copy = JSON.parse(JSON.stringify(s));
            copy.id = Date.now() + '_' + Math.random().toString(36).slice(2) + '_' + (s.id || '');
            copy.room = roomId;
            return copy;
        });
        localStrokes = localStrokes.concat(imported);
        redrawAllStrokes();
        if (roomId) {
            window.socket.emit('oekaki:import', { room: roomId, strokes: imported });
        }
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
        window.socket.off('oekaki:undoGroup');
        window.socket.off('oekaki:color');
        window.socket.off('oekaki:import');
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
            renderStroke(data);
        });
        window.socket.on('oekaki:undo', function (data) {
            if (data.room !== roomId) return;
            removeStrokeById(data.id);
        });
        window.socket.on('oekaki:undoGroup', function (data) {
            if (data.room !== roomId) return;
            removeStrokeGroup(data.groupId);
        });
        window.socket.on('oekaki:color', function (data) {
            if (data.room !== roomId) return;
            setColor(data.color, false);
        });
        window.socket.on('oekaki:import', function (data) {
            if (data.room !== roomId || !Array.isArray(data.strokes)) return;
            data.strokes.forEach(function (s) {
                if (!localStrokes.some(function (ls) { return ls.id === s.id; })) {
                    localStrokes.push(s);
                }
            });
            redrawAllStrokes();
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
