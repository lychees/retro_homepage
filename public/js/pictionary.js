/**
 * 你画我猜模块
 * 复用 draw-core.js 提供的统一画图工具栏与画布输入
 */
(function () {
    'use strict';

    var socket = null;
    var users = [];
    var scores = {};
    var status = 'waiting';
    var lastStatus = 'waiting';
    var isDrawer = false;
    var currentDrawerId = null;
    var timeLeft = 0;
    var currentWord = '';

    var drawCore = null;
    var canvas = null;
    var ctx = null;
    var localStrokes = [];
    var replayTimer = null;
    var audioCtx = null;

    function $(id) { return document.getElementById(id); }

    function bindExtra() {
        var startBtn = $('pictionary-start');
        var guessSend = $('pictionary-guess-send');
        var guessInput = $('pictionary-guess-input');
        var replayBtn = $('pictionary-replay');
        var undoBtn = $('pictionary-undo');
        var exportBtn = $('pictionary-export');
        var importInput = $('pictionary-import');
        var downloadBtn = $('pictionary-download');
        var submitBtn = $('pictionary-submit');

        if (startBtn && !startBtn._bound) {
            startBtn._bound = true;
            startBtn.addEventListener('click', function () {
                if (pictionarySession.roomId) socket.emit('pictionary:start', { room: pictionarySession.roomId });
            });
        }
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
        if (downloadBtn && !downloadBtn._bound) {
            downloadBtn._bound = true;
            downloadBtn.addEventListener('click', downloadCanvas);
        }
        if (submitBtn && !submitBtn._bound) {
            submitBtn._bound = true;
            submitBtn.addEventListener('click', submitToGallery);
        }

        var audioFileInput = $('pictionary-audio-file');
        var audioPlayer = $('pictionary-audio');
        if (audioFileInput && audioPlayer && !audioFileInput._bound) {
            audioFileInput._bound = true;
            audioFileInput.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                audioPlayer.src = URL.createObjectURL(file);
                audioPlayer.play().catch(function () {});
            });
        }

        document.addEventListener('click', initAudioCtx, { once: true });

        document.addEventListener('keydown', function (e) {
            var view = $('pictionary-room-view');
            if (!view || view.style.display === 'none') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                undoLastStroke();
            }
        });
    }

    var pictionarySession = new window.RoomSession({
        type: 'pictionary',
        elements: {
            create: 'pictionary-create',
            leave: 'pictionary-leave',
            nick: 'pictionary-nick',
            room: 'pictionary-room',
            pwd: 'pictionary-pwd',
            lobbyView: 'pictionary-lobby',
            roomView: 'pictionary-room-view',
            roomId: 'pictionary-room-id'
        },
        bindExtra: bindExtra,
        onEnter: function (id, userList) {
            users = userList || [];
            enterRoom();
        },
        onLeave: function () {
            if (replayTimer) {
                clearInterval(replayTimer);
                replayTimer = null;
            }
            users = [];
            localStrokes = [];
            status = 'waiting';
            isDrawer = false;
            currentDrawerId = null;
            $('pictionary-users').innerHTML = '';
            $('pictionary-chat-messages').innerHTML = '';
        },
        onRejoin: function () {
            if (!drawCore) return;
            canvas = drawCore.canvas;
            ctx = drawCore.ctx;
        }
    });

    function initAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(function () {});
        }
    }

    function playTone(freq, duration, type) {
        initAudioCtx();
        if (!audioCtx) return;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        var now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.start(now);
        osc.stop(now + duration);
    }

    function playStartSound() {
        playTone(523.25, 0.18, 'sine');
        setTimeout(function () { playTone(659.25, 0.18, 'sine'); }, 150);
    }

    function playCorrectSound() {
        playTone(880, 0.1, 'square');
        setTimeout(function () { playTone(1108.73, 0.35, 'square'); }, 100);
    }

    function enterRoom() {
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
                    if (!pictionarySession.roomId || !stroke) return;
                    if (!localStrokes.find(function (s) { return s.id === stroke.id; })) {
                        localStrokes.push(stroke);
                    }
                    socket.emit('pictionary:stroke', Object.assign({}, stroke, { room: pictionarySession.roomId }));
                },
                onClear: function () {
                    if (!pictionarySession.roomId) return;
                    socket.emit('pictionary:clear', { room: pictionarySession.roomId });
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
        var events = ['pictionary:users', 'pictionary:state', 'pictionary:stroke', 'pictionary:strokes:removed', 'pictionary:import', 'pictionary:clear', 'pictionary:message', 'pictionary:guessResult'];
        events.forEach(function (evt) { socket.off(evt); });

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
            if (data.correct) playCorrectSound();
        });
    }

    function applyState(data) {
        var oldStatus = status;
        status = data.status || 'waiting';
        isDrawer = !!data.isDrawer;
        currentDrawerId = data.drawerId || null;
        timeLeft = data.timeLeft || 0;
        currentWord = data.word || '';
        scores = {};
        (data.scores || []).forEach(function (s) { scores[s.id] = s.score; });

        if (oldStatus !== 'drawing' && status === 'drawing') {
            playStartSound();
        }
        lastStatus = status;

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
        var banner = $('pictionary-drawer-banner');
        if (!el) return;
        if (status === 'waiting') {
            el.textContent = '等待开始游戏';
            if (banner) {
                banner.textContent = '等待开始…';
                banner.className = 'pictionary-drawer-banner';
            }
        } else if (status === 'drawing') {
            if (isDrawer) {
                el.textContent = '轮到你作画，请画出题目！';
                if (banner) {
                    banner.textContent = '✏️ 你是当前作画者';
                    banner.className = 'pictionary-drawer-banner self';
                }
            } else {
                var drawerNick = '';
                var activeLi = document.querySelector('#pictionary-users li[data-id="' + currentDrawerId + '"]');
                if (activeLi) drawerNick = activeLi.getAttribute('data-nick') || '';
                el.textContent = '作画者：' + (drawerNick || '???') + '，快来猜词！';
                if (banner) {
                    banner.textContent = '✏️ 当前作画者：' + (drawerNick || '???');
                    banner.className = 'pictionary-drawer-banner';
                }
            }
        } else if (status === 'reveal') {
            el.textContent = '答案揭晓：' + (currentWord || '---');
            if (banner) {
                banner.textContent = '🔍 答案揭晓中';
                banner.className = 'pictionary-drawer-banner';
            }
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
            var isCurrentDrawer = s.id === currentDrawerId && status === 'drawing';
            if (isCurrentDrawer) li.className = 'active';
            var marker = isCurrentDrawer ? '✏️ ' : '✦ ';
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
        if (!input || !pictionarySession.roomId) return;
        var text = input.value.trim();
        if (!text) return;
        socket.emit('pictionary:guess', { room: pictionarySession.roomId, text: text });
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
        if (!isDrawer || status !== 'drawing' || localStrokes.length === 0 || !pictionarySession.roomId) return;
        var stroke = localStrokes[localStrokes.length - 1];
        socket.emit('pictionary:undo', { room: pictionarySession.roomId, id: stroke.id });
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
        link.download = 'pictionary-process-' + (pictionarySession.roomId || 'solo') + '-' + Date.now() + '.json';
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
        if (!isDrawer || status !== 'drawing' || !pictionarySession.roomId) return;
        var importedStrokes = data.strokes.map(function (s) {
            var copy = JSON.parse(JSON.stringify(s));
            copy.id = window.generateId('stroke') + '_' + (s.id || '');
            copy.room = pictionarySession.roomId;
            if (copy.alpha == null) copy.alpha = 1;
            return copy;
        });
        importedStrokes.forEach(function (s) {
            localStrokes.push(s);
            drawCore.renderStroke(s);
        });
        socket.emit('pictionary:import', { room: pictionarySession.roomId, strokes: importedStrokes });
    }

    function downloadCanvas() {
        if (!canvas) return;
        var link = document.createElement('a');
        link.download = 'pictionary-' + (pictionarySession.roomId || 'solo') + '-' + Date.now() + '.png';
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
            body: JSON.stringify({
                type: 'pictionary',
                title: title,
                author: author,
                imageData: imageData,
                strokes: localStrokes,
                canvas: { width: canvas.width, height: canvas.height }
            })
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

    window.initPictionary = function () {
        socket = window.socket;
        pictionarySession.init();
        bindSocket();
    };
})();
