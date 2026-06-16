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

    function $(id) { return document.getElementById(id); }

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
                    if (!roomId) return;
                    socket.emit('pictionary:stroke', stroke);
                },
                onClear: function () {
                    if (!roomId) return;
                    socket.emit('pictionary:clear', { room: roomId });
                }
            });
            drawCore.init();
            drawCore.clear(true);
        } else {
            drawCore.setReadOnly(true);
            drawCore.clear(true);
        }
    }

    function bindSocket() {
        if (!socket) return;
        var events = ['pictionary:joined', 'pictionary:error', 'pictionary:users', 'pictionary:state', 'pictionary:stroke', 'pictionary:clear', 'pictionary:message', 'pictionary:guessResult'];
        events.forEach(function (evt) { socket.off(evt); });

        socket.on('pictionary:joined', function (data) {
            users = data.users || [];
            enterRoom();
            updateOnline();
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
            if (drawCore) drawCore.renderStroke(stroke);
        });
        socket.on('pictionary:clear', function () {
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

    function sendGuess() {
        var input = $('pictionary-guess-input');
        if (!input || !roomId) return;
        var text = input.value.trim();
        if (!text) return;
        socket.emit('pictionary:guess', { room: roomId, text: text });
        input.value = '';
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
