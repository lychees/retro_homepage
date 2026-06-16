/**
 * 你画我猜模块
 * 复用茶绘的调色环、RGBA、常用颜色、取色器等画图工具
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

    var canvas = null;
    var ctx = null;
    var drawing = false;
    var lastPos = null;

    var currentTool = 'pen';
    var currentColor = '#000000';
    var currentAlpha = 1;
    var currentSize = 4;

    var wheelCanvas = null;
    var wheelCtx = null;
    var wheelDragging = false;
    var wheelHue = 0;
    var wheelSat = 0;
    var wheelVal = 0;

    var colorPresets = [
        { color: '#000000', alpha: 1 }, { color: '#ffffff', alpha: 1 },
        { color: '#ff0000', alpha: 1 }, { color: '#00ff00', alpha: 1 },
        { color: '#0000ff', alpha: 1 }, { color: '#ffff00', alpha: 1 },
        { color: '#ff00ff', alpha: 1 }, { color: '#00ffff', alpha: 1 }
    ];

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
        var clearBtn = $('pictionary-clear');
        if (clearBtn && !clearBtn._bound) {
            clearBtn._bound = true;
            clearBtn.addEventListener('click', function () {
                if (!isDrawer || status !== 'drawing') return;
                clearCanvas();
                socket.emit('pictionary:clear', { room: roomId });
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
        bindTools();
        bindBrushSizes();
        bindColorPresets();
        bindColorWheel();
        bindAlphaSlider();
        bindRgbaInputs();
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

        canvas = $('pictionary-canvas');
        ctx = canvas.getContext('2d');
        bindCanvas();
        clearCanvas();
        setColor('#000000', 1);
        drawColorWheel();
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
            renderStroke(stroke);
        });
        socket.on('pictionary:clear', function () {
            clearCanvas();
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
        updateToolAccess();
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

    function updateToolAccess() {
        var canDraw = isDrawer && status === 'drawing';
        var tools = document.querySelectorAll('#pictionary-room-view .tool-btn');
        tools.forEach(function (btn) {
            btn.style.opacity = canDraw ? '' : '0.5';
            btn.style.pointerEvents = canDraw ? '' : 'none';
        });
        var clearBtn = $('pictionary-clear');
        if (clearBtn) {
            clearBtn.style.opacity = canDraw ? '' : '0.5';
            clearBtn.style.pointerEvents = canDraw ? '' : 'none';
        }
        if (wheelCanvas) {
            wheelCanvas.style.pointerEvents = canDraw ? '' : 'none';
            wheelCanvas.style.opacity = canDraw ? '' : '0.6';
        }
        ['pictionary-r','pictionary-g','pictionary-b','pictionary-a','pictionary-alpha'].forEach(function (id) {
            var input = $(id);
            if (input) input.disabled = !canDraw;
        });
        var startBtn = $('pictionary-start');
        if (startBtn) {
            startBtn.style.display = (status === 'waiting' || status === 'reveal') ? 'block' : 'none';
        }
        var guessInput = $('pictionary-guess-input');
        var guessSend = $('pictionary-guess-send');
        if (guessInput) {
            guessInput.disabled = isDrawer || status !== 'drawing';
            guessInput.placeholder = isDrawer ? '作画中无法猜测' : '输入你的猜测';
        }
        if (guessSend) guessSend.disabled = isDrawer || status !== 'drawing';
    }

    function bindTools() {
        var tools = document.querySelectorAll('#pictionary-room-view [data-tool]');
        tools.forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                tools.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                currentTool = btn.getAttribute('data-tool');
            });
        });
    }

    function bindBrushSizes() {
        var sizes = document.querySelectorAll('#pictionary-brush-sizes span');
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

    function bindColorPresets() {
        var container = $('pictionary-color-presets');
        if (!container || container._bound) return;
        container._bound = true;
        container.innerHTML = '';
        colorPresets.forEach(function (item) {
            var div = document.createElement('div');
            div.className = 'color-preset';
            div.style.background = item.color;
            div.style.opacity = item.alpha;
            div.title = item.color;
            div.addEventListener('click', function () {
                setColor(item.color, item.alpha);
                currentTool = 'pen';
                setActiveTool('pen');
            });
            container.appendChild(div);
        });
    }

    function setActiveTool(tool) {
        document.querySelectorAll('#pictionary-room-view [data-tool]').forEach(function (b) { b.classList.remove('active'); });
        var btn = document.querySelector('#pictionary-room-view [data-tool="' + tool + '"]');
        if (btn) btn.classList.add('active');
    }

    function bindAlphaSlider() {
        var slider = $('pictionary-alpha');
        if (!slider || slider._bound) return;
        slider._bound = true;
        slider.addEventListener('input', function () {
            setAlpha(parseInt(slider.value, 10) / 100);
        });
    }

    function bindRgbaInputs() {
        var ids = ['pictionary-r', 'pictionary-g', 'pictionary-b'];
        ids.forEach(function (id) {
            var input = $(id);
            if (!input || input._bound) return;
            input._bound = true;
            input.addEventListener('input', function () {
                var r = clampChannel($('pictionary-r').value);
                var g = clampChannel($('pictionary-g').value);
                var b = clampChannel($('pictionary-b').value);
                setColor(rgbToHex(r, g, b), currentAlpha);
            });
        });
        var aInput = $('pictionary-a');
        if (aInput && !aInput._bound) {
            aInput._bound = true;
            aInput.addEventListener('input', function () {
                var a = parseFloat(aInput.value);
                if (isNaN(a)) return;
                setAlpha(Math.max(0, Math.min(1, a)));
            });
        }
    }

    function clampChannel(v) {
        var n = parseInt(v, 10);
        if (isNaN(n)) return 0;
        return Math.max(0, Math.min(255, n));
    }

    function setColor(color, alpha) {
        if (typeof alpha === 'number') currentAlpha = Math.max(0, Math.min(1, alpha));
        currentColor = color;
        var box = $('pictionary-current-color');
        if (box) {
            box.style.background = color;
            box.style.opacity = currentAlpha;
        }
        updateWheelFromColor(color);
        updateAlphaUI();
        updateRgbaUI();
    }

    function setAlpha(alpha) {
        currentAlpha = Math.max(0, Math.min(1, alpha));
        var box = $('pictionary-current-color');
        if (box) box.style.opacity = currentAlpha;
        updateAlphaUI();
        updateRgbaUI();
    }

    function updateAlphaUI() {
        var slider = $('pictionary-alpha');
        var label = $('pictionary-alpha-value');
        if (slider) slider.value = Math.round(currentAlpha * 100);
        if (label) label.textContent = Math.round(currentAlpha * 100) + '%';
    }

    function updateRgbaUI() {
        var rgb = hexToRgb(currentColor) || { r: 0, g: 0, b: 0 };
        var ids = ['pictionary-r', 'pictionary-g', 'pictionary-b', 'pictionary-a'];
        var vals = [rgb.r, rgb.g, rgb.b, Math.round(currentAlpha * 100) / 100];
        ids.forEach(function (id, i) {
            var input = $(id);
            if (input) input.value = vals[i];
        });
        var text = $('pictionary-rgba-text');
        if (text) text.textContent = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + (Math.round(currentAlpha * 100) / 100) + ')';
    }

    function bindColorWheel() {
        wheelCanvas = $('pictionary-color-wheel');
        if (!wheelCanvas) return;
        wheelCtx = wheelCanvas.getContext('2d');
        drawColorWheel();

        function getPos(e) {
            var rect = wheelCanvas.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (wheelCanvas.width / rect.width),
                y: (clientY - rect.top) * (wheelCanvas.height / rect.height)
            };
        }

        function handle(e) {
            e.preventDefault();
            var pos = getPos(e);
            var cx = wheelCanvas.width / 2;
            var cy = wheelCanvas.height / 2;
            var dx = pos.x - cx;
            var dy = pos.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var outerR = cx - 4;
            var innerR = outerR * 0.55;

            if (dist >= innerR && dist <= outerR) {
                var angle = Math.atan2(dy, dx);
                if (angle < 0) angle += Math.PI * 2;
                wheelHue = angle / (Math.PI * 2);
            } else if (dist < innerR) {
                setWheelSVFromPoint(dx, dy, innerR);
            }
            updateColorFromWheel();
            drawColorWheel();
        }

        wheelCanvas.addEventListener('mousedown', function (e) { wheelDragging = true; handle(e); });
        document.addEventListener('mousemove', function (e) { if (wheelDragging) handle(e); });
        document.addEventListener('mouseup', function () { wheelDragging = false; });
        wheelCanvas.addEventListener('touchstart', function (e) { wheelDragging = true; handle(e); }, { passive: false });
        document.addEventListener('touchmove', function (e) { if (wheelDragging) handle(e); }, { passive: false });
        document.addEventListener('touchend', function () { wheelDragging = false; });
    }

    function setWheelSVFromPoint(dx, dy, radius) {
        var nx = Math.max(-1, Math.min(1, dx / radius));
        var ny = Math.max(-1, Math.min(1, dy / radius));
        wheelSat = (nx + 1) / 2;
        wheelVal = 1 - (ny + 1) / 2;
    }

    function updateColorFromWheel() {
        var rgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
        setColor(rgbToHex(rgb.r, rgb.g, rgb.b), currentAlpha);
    }

    function drawColorWheel() {
        if (!wheelCtx) return;
        var w = wheelCanvas.width;
        var h = wheelCanvas.height;
        var cx = w / 2;
        var cy = h / 2;
        var outerR = cx - 4;
        var innerR = outerR * 0.55;

        wheelCtx.clearRect(0, 0, w, h);

        for (var angle = 0; angle < 360; angle++) {
            var start = (angle - 1) * Math.PI / 180;
            var end = (angle + 1) * Math.PI / 180;
            var rgb = hsvToRgb(angle / 360, 1, 1);
            wheelCtx.beginPath();
            wheelCtx.arc(cx, cy, outerR, start, end);
            wheelCtx.arc(cx, cy, innerR, end, start, true);
            wheelCtx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
            wheelCtx.fill();
        }

        var grad = wheelCtx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
        var hueRgb = hsvToRgb(wheelHue, 1, 1);
        grad.addColorStop(0, 'rgb(255,255,255)');
        grad.addColorStop(0.5, 'rgb(' + hueRgb.r + ',' + hueRgb.g + ',' + hueRgb.b + ')');
        grad.addColorStop(1, 'rgb(0,0,0)');
        wheelCtx.beginPath();
        wheelCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
        wheelCtx.fillStyle = grad;
        wheelCtx.fill();

        var curRgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
        wheelCtx.beginPath();
        wheelCtx.arc(cx, cy, innerR * 0.35, 0, Math.PI * 2);
        wheelCtx.fillStyle = 'rgb(' + curRgb.r + ',' + curRgb.g + ',' + curRgb.b + ')';
        wheelCtx.fill();
        wheelCtx.strokeStyle = '#ffffff';
        wheelCtx.lineWidth = 2;
        wheelCtx.stroke();
    }

    function updateWheelFromColor(color) {
        var rgb = hexToRgb(color);
        if (!rgb) return;
        var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        wheelHue = hsv.h;
        wheelSat = hsv.s;
        wheelVal = hsv.v;
        drawColorWheel();
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(function (v) {
            var hex = Math.max(0, Math.min(255, v)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    }

    function hexToRgb(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var h, s, v = max;
        var d = max - min;
        s = max === 0 ? 0 : d / max;
        if (max === min) {
            h = 0;
        } else {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return { h: h, s: s, v: v };
    }

    function hsvToRgb(h, s, v) {
        var r, g, b;
        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            case 5: r = v; g = p; b = q; break;
        }
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    function bindCanvas() {
        if (!canvas || canvas._bound) return;
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
            if (!isDrawer || status !== 'drawing') return;
            e.preventDefault();
            var pos = getPos(e);
            if (currentTool === 'eyedropper') {
                pickColor(pos.x, pos.y);
                return;
            }
            drawing = true;
            lastPos = pos;
        }
        function move(e) {
            if (!drawing || !isDrawer || status !== 'drawing') return;
            e.preventDefault();
            var pos = getPos(e);
            var stroke = {
                room: roomId,
                from: lastPos,
                to: pos,
                color: currentTool === 'eraser' ? '#ffffff' : currentColor,
                size: currentSize,
                alpha: currentTool === 'eraser' ? 1 : currentAlpha
            };
            renderStroke(stroke);
            socket.emit('pictionary:stroke', stroke);
            lastPos = pos;
        }
        function end() {
            drawing = false;
            lastPos = null;
        }
        canvas.addEventListener('mousedown', start);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', end);
    }

    function pickColor(x, y) {
        if (!ctx) return;
        var pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        var hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
        setColor(hex, pixel[3] / 255);
        currentTool = 'pen';
        setActiveTool('pen');
    }

    function renderStroke(stroke) {
        if (!ctx || !stroke || !stroke.from || !stroke.to) return;
        ctx.globalAlpha = stroke.alpha == null ? 1 : stroke.alpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.color || '#000000';
        ctx.lineWidth = stroke.size || 4;
        ctx.beginPath();
        ctx.moveTo(stroke.from.x, stroke.from.y);
        ctx.lineTo(stroke.to.x, stroke.to.y);
        ctx.stroke();
    }

    function clearCanvas() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
