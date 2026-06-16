/**
 * 你画我猜模块
 * 复用 draw-core.js 提供的统一画图工具栏与画布输入
 */
(function () {
    'use strict';

    var socket = null;
    var roomId = null;
    var nick = '';
    var users = [];
    var scores = {};
    var status = 'waiting';
    var isDrawer = false;
    var currentDrawerId = null;
    var timeLeft = 0;
    var currentWord = '';

    var drawCore = null;
    var canvas = null;
    var ctx = null;
    var localStrokes = [];
    var replayTimer = null;

    function $(id) { return document.getElementById(id); }

    function generateId(prefix) {
        return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    window.initPictionary = function () {
        socket = window.socket;
        bindOnce();
        bindSocket();

        var query = window.currentQuery || {};
        if (query.room) {
            var roomInput = $('pictionary-room');
            var pwdInput = $('pictionary-pwd');
            if (roomInput) roomInput.value = query.room;
            if (pwdInput && query.pwd) pwdInput.value = query.pwd;
            createOrJoin();
        }

        if (socket) {
            socket.off('connect', onSocketConnect);
            socket.on('connect', onSocketConnect);
        }
    };

    function onSocketConnect() {
        if (roomId) {
            socket.emit('pictionary:rejoin', { room: roomId, nick: nick });
        }
    }

    function bindOnce() {
        var createBtn = $('pictionary-create');
        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createOrJoin);
        }
        var startBtn = $('pictionary-start');
        if (startBtn && !startBtn._bound) {
            startBtn._bound = true;
            startBtn.addEventListener('click', function () {
                if (roomId) socket.emit('pictionary:start', { room: roomId });
            });
        }
        var guessSend = $('pictionary-guess-send');
        var guessInput = $('pictionary-guess-input');
        if (guessSend && !guessSend._bound) {
            guessSend._bound = true;
            guessSend.addEventListener('click', sendGuess);
        }
        if (guessInput && !guessInput._bound) {
            guessInput._bound = true;
            guessInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') sendGuess();
            });
        }

        var replayBtn = $('pictionary-replay');
        if (replayBtn && !replayBtn._bound) {
            replayBtn._bound = true;
            replayBtn.addEventListener('click', replayStrokes);
        }
        var undoBtn = $('pictionary-undo');
        if (undoBtn && !undoBtn._bound) {
            undoBtn._bound = true;
            undoBtn.addEventListener('click', undoLastStroke);
        }
        var exportBtn = $('pictionary-export');
        if (exportBtn && !exportBtn._bound) {
            exportBtn._bound = true;
            exportBtn.addEventListener('click', exportStrokes);
        }
        var importInput = $('pictionary-import');
        if (importInput && !importInput._bound) {
            importInput._bound = true;
            importInput.addEventListener('change', handleImport);
        }
        var downloadBtn = $('pictionary-download');
        if (downloadBtn && !downloadBtn._bound) {
            downloadBtn._bound = true;
            downloadBtn.addEventListener('click', downloadCanvas);
        }
        var submitBtn = $('pictionary-submit');
        if (submitBtn && !submitBtn._bound) {
            submitBtn._bound = true;
            submitBtn.addEventListener('click', submitToGallery);
        }
        var leaveBtn = $('pictionary-leave');
        if (leaveBtn && !leaveBtn._bound) {
            leaveBtn._bound = true;
            leaveBtn.addEventListener('click', leaveRoom);
        }

        document.addEventListener('keydown', function (e) {
            var view = $('pictionary-room-view');
            if (!view || view.style.display === 'none') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undoLastStroke();
            }
        });
    }

    function createOrJoin() {
        nick = ($('pictionary-nick').value || '匿名').trim().substring(0, 16);
        roomId = ($('pictionary-room').value || window.generateRoomId()).trim().toUpperCase();
        var pwd = ($('pictionary-pwd').value || '').trim();
        if (!roomId) roomId = window.generateRoomId();
        $('pictionary-room').value = roomId;

        socket.emit('pictionary:join', { room: roomId, nick: nick, pwd: pwd });
    }

    function enterRoom() {
        $('pictionary-lobby').style.display = 'none';
        $('pictionary-room-view').style.display = 'block';
        $('pictionary-room-id').textContent = '#' + roomId;

        if (!drawCore) {
            drawCore = new window.DrawCanvas({
                canvasId: 'pictionary-canvas',
                toolbarId: 'pictionary-draw-tools',
                defaultColor: '#000000',
                defaultAlpha: 1,
                defaultSize: 4,
                defaultTextSize: 20,
                readOnly: true,
                onStroke: function (stroke) {
                    if (!roomId || !stroke) return;
                    if (!localStrokes.find(function (s) { return s.id === stroke.id; })) {
                        localStrokes.push(stroke);
                    }
                    socket.emit('pictionary:stroke', Object.assign({}, stroke, { room: roomId }));
                },
                onClear: function () {
                    if (!roomId) return;
                    socket.emit('pictionary:clear', { room: roomId });
                }
            });
            drawCore.init();
        } else {
            drawCore.setReadOnly(true);
        }
        drawCore.clear(true);
        canvas = drawCore.canvas;
        ctx = drawCore.ctx;
        localStrokes = [];
        updateOnline();
    }

    function bindSocket() {
        if (!socket) return;
        var events = ['pictionary:joined', 'pictionary:error', 'pictionary:users', 'pictionary:state', 'pictionary:stroke', 'pictionary:strokes:removed', 'pictionary:import', 'pictionary:clear', 'pictionary:message', 'pictionary:guessResult'];
        events.forEach(function (evt) { socket.off(evt); });

        socket.on('pictionary:joined', function (data) {
            users = data.users || [];
            enterRoom();
        });
        socket.on('pictionary:error', function (data) {
            alert('你画我猜：' + data.message);
        });
        socket.on('pictionary:users', function (data) {
            users = data.users || [];
            updateOnline();
        });
        socket.on('pictionary:state', function (data) {
            applyState(data);
        });
        socket.on('pictionary:stroke', function (stroke) {
            if (!stroke || !drawCore) return;
            if (!localStrokes.find(function (s) { return s.id === stroke.id; })) {
                localStrokes.push(stroke);
            }
            drawCore.renderStroke(stroke);
        });
        socket.on('pictionary:strokes:removed', function (data) {
            if (data.ids && Array.isArray(data.ids)) {
                data.ids.forEach(removeStrokeById);
            }
        });
        socket.on('pictionary:import', function (data) {
            if (!data.strokes || !Array.isArray(data.strokes)) return;
            data.strokes.forEach(function (s) {
                if (!localStrokes.find(function (ls) { return ls.id === s.id; })) {
                    localStrokes.push(s);
                }
                drawCore.renderStroke(s);
            });
        });
        socket.on('pictionary:clear', function () {
            localStrokes = [];
            if (drawCore) drawCore.clear(true);
        });
        socket.on('pictionary:message', function (data) {
            appendMessage(data);
        });
        socket.on('pictionary:guessResult', function (data) {
            appendMessage({ system: true, text: data.nick + ' 猜对了！答案是：' + data.word, time: Date.now() });
        });
    }

    function applyState(data) {
        status = data.status || 'waiting';
        isDrawer = !!data.isDrawer;
        currentDrawerId = data.drawerId || null;
        timeLeft = data.timeLeft || 0;
        currentWord = data.word || '';
        scores = {};
        (data.scores || []).forEach(function (s) { scores[s.id] = s.score; });

        updateWordUI();
        updateTimer();
        updateStatus();
        updateUserScores(data.scores || []);
        if (drawCore) {
            drawCore.setReadOnly(!isDrawer || status !== 'drawing');
        }
        updateGuessAccess();
        updateOperationAccess();
        var startBtn = $('pictionary-start');
        if (startBtn) {
            startBtn.style.display = (status === 'waiting' || status === 'reveal') ? 'block' : 'none';
        }
    }

    function updateOnline() {
        var el = $('pictionary-online');
        if (el) el.textContent = users.length;
    }

    function updateWordUI() {
        var box = $('pictionary-word');
        if (!box) return;
        if (status === 'waiting') {
            box.textContent = '等待开始…';
        } else if (status === 'reveal') {
            box.textContent = currentWord || '---';
        } else if (isDrawer) {
            box.textContent = currentWord || '---';
        } else {
            box.textContent = currentWord || '???';
        }
    }

    function updateTimer() {
        var el = $('pictionary-timer');
        if (!el) return;
        if (status === 'drawing') {
            el.textContent = '⏱️ ' + timeLeft + 's';
        } else {
            el.textContent = '--';
        }
    }

    function updateStatus() {
        var el = $('pictionary-status');
        if (!el) return;
        if (status === 'waiting') {
            el.textContent = '等待开始游戏';
        } else if (status === 'drawing') {
            if (isDrawer) {
                el.textContent = '轮到你作画，请画出题目！';
            } else {
                var drawerNick = '';
                var activeLi = document.querySelector('#pictionary-users li[data-id="' + currentDrawerId + '"]');
                if (activeLi) drawerNick = activeLi.getAttribute('data-nick') || '';
                el.textContent = '作画者：' + (drawerNick || '???') + '，快来猜词！';
            }
        } else if (status === 'reveal') {
            el.textContent = '答案揭晓：' + (currentWord || '---');
        }
    }

    function updateUserScores(scoreList) {
        var ul = $('pictionary-users');
        if (!ul) return;
        ul.innerHTML = '';
        scoreList.sort(function (a, b) { return b.score - a.score; });
        scoreList.forEach(function (s) {
            var li = document.createElement('li');
            li.setAttribute('data-id', s.id);
            li.setAttribute('data-nick', s.nick);
            var marker = s.id === currentDrawerId ? '✏️ ' : '✦ ';
            li.textContent = marker + s.nick + ' · ' + s.score + ' 分';
            ul.appendChild(li);
        });
    }

    function updateGuessAccess() {
        var guessInput = $('pictionary-guess-input');
        var guessSend = $('pictionary-guess-send');
        if (guessInput) {
            guessInput.disabled = isDrawer || status !== 'drawing';
            guessInput.placeholder = isDrawer ? '作画中无法猜测' : '输入你的猜测';
        }
        if (guessSend) guessSend.disabled = isDrawer || status !== 'drawing';
    }

    function updateOperationAccess() {
        var canEdit = isDrawer && status === 'drawing';
        ['pictionary-undo', 'pictionary-import'].forEach(function (id) {
            var el = $(id);
            if (!el) return;
            el.disabled = !canEdit;
            el.style.opacity = canEdit ? '' : '0.5';
            el.style.pointerEvents = canEdit ? '' : 'none';
        });
    }

    function sendGuess() {
        var input = $('pictionary-guess-input');
        if (!input || !roomId) return;
        var text = input.value.trim();
        if (!text) return;
        socket.emit('pictionary:guess', { room: roomId, text: text });
        input.value = '';
    }

    function redrawCanvas() {
        if (!drawCore || !ctx) return;
        drawCore.clear(true);
        localStrokes.forEach(function (s) { drawCore.renderStroke(s); });
    }

    function replayStrokes() {
        if (!drawCore || localStrokes.length === 0) return;
        if (replayTimer) {
            clearInterval(replayTimer);
            replayTimer = null;
        }
        drawCore.clear(true);
        var i = 0;
        replayTimer = setInterval(function () {
            if (i >= localStrokes.length) {
                clearInterval(replayTimer);
                replayTimer = null;
                return;
            }
            drawCore.renderStroke(localStrokes[i]);
            i++;
        }, 30);
    }

    function undoLastStroke() {
        if (!isDrawer || status !== 'drawing' || localStrokes.length === 0 || !roomId) return;
        var stroke = localStrokes[localStrokes.length - 1];
        socket.emit('pictionary:undo', { room: roomId, id: stroke.id });
    }

    function removeStrokeById(id) {
        localStrokes = localStrokes.filter(function (s) { return s.id !== id; });
        redrawCanvas();
    }

    function exportStrokes() {
        if (localStrokes.length === 0) {
            alert('当前没有可导出的作画过程');
            return;
        }
        var data = {
            version: 2,
            canvas: { width: canvas.width, height: canvas.height },
            strokes: localStrokes
        };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.download = 'pictionary-process-' + (roomId || 'solo') + '-' + Date.now() + '.json';
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
                importProcess(data);
            } catch (err) {
                alert('导入失败：' + err.message);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    function importProcess(data) {
        if (!isDrawer || status !== 'drawing' || !roomId) return;
        var importedStrokes = data.strokes.map(function (s) {
            var copy = JSON.parse(JSON.stringify(s));
            copy.id = generateId('stroke') + '_' + (s.id || '');
            copy.room = roomId;
            if (copy.alpha == null) copy.alpha = 1;
            return copy;
        });
        importedStrokes.forEach(function (s) {
            localStrokes.push(s);
            drawCore.renderStroke(s);
        });
        socket.emit('pictionary:import', { room: roomId, strokes: importedStrokes });
    }

    function downloadCanvas() {
        if (!canvas) return;
        var link = document.createElement('a');
        link.download = 'pictionary-' + (roomId || 'solo') + '-' + Date.now() + '.png';
        link.href = canvas.toDataURL();
        link.click();
    }

    function submitToGallery() {
        if (!canvas) return;
        var title = prompt('给这幅作品起个标题（最多 40 字）：');
        if (!title) return;
        var author = $('pictionary-nick') && $('pictionary-nick').value ? $('pictionary-nick').value.trim() : '匿名';
        var imageData = canvas.toDataURL('image/png');
        var btn = $('pictionary-submit');
        if (btn) { btn.disabled = true; btn.textContent = '投稿中…'; }
        fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'pictionary', title: title, author: author, imageData: imageData })
        }).then(function (res) { return res.json(); }).then(function (data) {
            if (data && data.success) {
                alert('投稿成功！请到「画廊」欣赏大家的作品。');
            } else {
                alert('投稿失败：' + (data && data.error ? data.error : '未知错误'));
            }
        }).catch(function (err) {
            alert('投稿失败：' + err.message);
        }).then(function () {
            if (btn) { btn.disabled = false; btn.textContent = '🖼️ 投稿画廊'; }
        });
    }

    function leaveRoom() {
        if (roomId) socket.emit('pictionary:leave', { room: roomId });
        if (replayTimer) {
            clearInterval(replayTimer);
            replayTimer = null;
        }
        roomId = null;
        users = [];
        localStrokes = [];
        $('pictionary-room-view').style.display = 'none';
        $('pictionary-lobby').style.display = 'block';
        $('pictionary-users').innerHTML = '';
        $('pictionary-chat-messages').innerHTML = '';
    }

    function appendMessage(data) {
        var container = $('pictionary-chat-messages');
        if (!container) return;
        var div = document.createElement('div');
        div.className = 'chat-message' + (data.system ? ' system' : '');
        var time = data.time ? new Date(data.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        if (data.system) {
            div.textContent = (time ? '[' + time + '] ' : '') + data.text;
        } else {
            div.innerHTML = '<span class="time">[' + time + ']</span><span class="nick">' + escapeHtml(data.nick) + '</span>' + escapeHtml(data.text);
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();
