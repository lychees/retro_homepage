/**
 * 茶绘房间模块
 * 支持图层、SAI风格调色环、取色器、文字、导出/导入
 */
(function () {
    'use strict';

    var roomId = null;
    var nick = '';
    var canvas, ctx;
    var drawing = false;
    var currentTool = 'pen';
    var currentColor = '#000000';
    var currentAlpha = 1;
    var currentSize = 4;
    var currentFont = '20px VT323, monospace';
    var lastPos = null;
    var currentGroupId = null;
    var chatRoom = null;
    var localStrokes = [];
    var replayTimer = null;

    // 图层
    var layers = [];
    var activeLayerId = null;

    // 调色环
    var wheelCanvas, wheelCtx;
    var wheelDragging = false;
    var wheelHue = 0;
    var wheelSat = 0;
    var wheelVal = 0;

    // 常用颜色
    var maxPresets = 8;
    var activePresetIndex = 0;
    var colorPresets = [
        { color: '#000000', alpha: 1 },
        { color: '#ffffff', alpha: 1 },
        { color: '#ff0000', alpha: 1 },
        { color: '#00ff00', alpha: 1 },
        { color: '#0000ff', alpha: 1 },
        { color: '#ffff00', alpha: 1 },
        { color: '#ff00ff', alpha: 1 },
        { color: '#00ffff', alpha: 1 }
    ];

    function $(id) { return document.getElementById(id); }

    function generateId(prefix) {
        return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function bindOnce() {
        var createBtn = $('oekaki-create');
        var clearBtn = $('oekaki-clear');
        var leaveBtn = $('oekaki-leave');
        var downloadBtn = $('oekaki-download');
        var replayBtn = $('oekaki-replay');
        var undoBtn = $('oekaki-undo');
        var exportBtn = $('oekaki-export');
        var importInput = $('oekaki-import');
        var addLayerBtn = $('oekaki-add-layer');
        var delLayerBtn = $('oekaki-del-layer');
        var renameLayerBtn = $('oekaki-rename-layer');

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
        var submitBtn = $('oekaki-submit');
        if (submitBtn && !submitBtn._bound) {
            submitBtn._bound = true;
            submitBtn.addEventListener('click', submitToGallery);
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
        if (addLayerBtn && !addLayerBtn._bound) {
            addLayerBtn._bound = true;
            addLayerBtn.addEventListener('click', function () {
                createLayer('图层 ' + (layers.length + 1));
            });
        }
        if (delLayerBtn && !delLayerBtn._bound) {
            delLayerBtn._bound = true;
            delLayerBtn.addEventListener('click', deleteActiveLayer);
        }
        if (renameLayerBtn && !renameLayerBtn._bound) {
            renameLayerBtn._bound = true;
            renameLayerBtn.addEventListener('click', renameActiveLayer);
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

        var alphaSlider = $('oekaki-alpha');
        if (alphaSlider && !alphaSlider._bound) {
            alphaSlider._bound = true;
            alphaSlider.addEventListener('input', function () {
                setAlpha(parseInt(alphaSlider.value, 10) / 100, true);
            });
        }
        bindRgbaInputs();
    }

    function bindRgbaInputs() {
        var ids = ['oekaki-r', 'oekaki-g', 'oekaki-b'];
        ids.forEach(function (id) {
            var input = $(id);
            if (!input || input._bound) return;
            input._bound = true;
            input.addEventListener('input', function () {
                var r = clampChannel($('oekaki-r').value);
                var g = clampChannel($('oekaki-g').value);
                var b = clampChannel($('oekaki-b').value);
                var hex = rgbToHex(r, g, b);
                setColor(hex, currentAlpha, true);
                overwriteActivePreset(hex, currentAlpha);
            });
        });
        var aInput = $('oekaki-a');
        if (aInput && !aInput._bound) {
            aInput._bound = true;
            aInput.addEventListener('input', function () {
                var a = parseFloat(aInput.value);
                if (isNaN(a)) return;
                setAlpha(Math.max(0, Math.min(1, a)), true);
                overwriteActivePreset(currentColor, currentAlpha);
            });
        }
    }

    function clampChannel(v) {
        var n = parseInt(v, 10);
        if (isNaN(n)) return 0;
        return Math.max(0, Math.min(255, n));
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
            var pos = getPos(e);
            if (currentTool === 'text') {
                placeText(pos.x, pos.y);
                return;
            }
            if (currentTool === 'eyedropper') {
                pickColor(pos.x, pos.y);
                return;
            }
            drawing = true;
            currentGroupId = generateId('group');
            lastPos = pos;
        }

        function move(e) {
            e.preventDefault();
            if (currentTool === 'text' || currentTool === 'eyedropper' || !drawing || !lastPos) return;
            var pos = getPos(e);
            drawStroke(lastPos, pos, currentTool, currentColor, currentSize, currentAlpha, true, null, currentGroupId);
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

    // ===== 颜色工具 =====

    function setColor(color, alpha, emit) {
        if (typeof alpha === 'number') currentAlpha = Math.max(0, Math.min(1, alpha));
        currentColor = color;
        var box = $('oekaki-current-color');
        if (box) {
            box.style.background = color;
            box.style.opacity = currentAlpha;
        }
        updateWheelFromColor(color);
        updateAlphaUI();
        updateRgbaUI();
        if (emit && roomId) {
            window.socket.emit('oekaki:color', { room: roomId, color: color, alpha: currentAlpha });
        }
    }

    function setAlpha(alpha, emit) {
        currentAlpha = Math.max(0, Math.min(1, alpha));
        var box = $('oekaki-current-color');
        if (box) box.style.opacity = currentAlpha;
        updateAlphaUI();
        updateRgbaUI();
        if (emit && roomId) {
            window.socket.emit('oekaki:color', { room: roomId, color: currentColor, alpha: currentAlpha });
        }
    }

    function updateAlphaUI() {
        var slider = $('oekaki-alpha');
        var label = $('oekaki-alpha-value');
        if (slider) slider.value = Math.round(currentAlpha * 100);
        if (label) label.textContent = Math.round(currentAlpha * 100) + '%';
    }

    function updateRgbaUI() {
        var rgb = hexToRgb(currentColor) || { r: 0, g: 0, b: 0 };
        var rInput = $('oekaki-r');
        var gInput = $('oekaki-g');
        var bInput = $('oekaki-b');
        var aInput = $('oekaki-a');
        var text = $('oekaki-rgba-text');
        if (rInput) rInput.value = rgb.r;
        if (gInput) gInput.value = rgb.g;
        if (bInput) bInput.value = rgb.b;
        if (aInput) aInput.value = Math.round(currentAlpha * 100) / 100;
        if (text) text.textContent = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + (Math.round(currentAlpha * 100) / 100) + ')';
    }

    function selectPreset(index) {
        if (index < 0 || index >= maxPresets || !colorPresets[index]) return;
        activePresetIndex = index;
        renderColorPresets();
        var item = colorPresets[index];
        setColor(item.color, item.alpha, true);
        currentTool = 'pen';
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        var pen = document.querySelector('[data-tool="pen"]');
        if (pen) pen.classList.add('active');
    }

    function overwriteActivePreset(color, alpha) {
        if (!color || color[0] !== '#') return;
        colorPresets[activePresetIndex] = { color: color.toLowerCase(), alpha: alpha == null ? 1 : alpha };
        renderColorPresets();
    }

    function renderColorPresets() {
        var container = $('oekaki-color-presets');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < maxPresets; i++) {
            var div = document.createElement('div');
            var item = colorPresets[i];
            var classes = ['color-preset'];
            if (!item) classes.push('empty');
            if (i === activePresetIndex) classes.push('active');
            div.className = classes.join(' ');
            if (item) {
                div.style.background = item.color;
                div.style.opacity = item.alpha;
                div.title = item.color + ' · 不透明度 ' + Math.round(item.alpha * 100) + '%';
            }
            div.addEventListener('click', (function (idx) {
                return function () { selectPreset(idx); };
            })(i));
            container.appendChild(div);
        }
    }

    function pickColor(x, y) {
        if (!ctx) return;
        var pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        var hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
        setColor(hex, pixel[3] / 255, true);
        overwriteActivePreset(currentColor, currentAlpha);
        // 取色后自动切回画笔
        currentTool = 'pen';
        document.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        var pen = document.querySelector('[data-tool="pen"]');
        if (pen) pen.classList.add('active');
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(function (v) {
            var hex = Math.max(0, Math.min(255, v)).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
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

    function updateWheelFromColor(color) {
        var rgb = hexToRgb(color);
        if (!rgb) return;
        var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        wheelHue = hsv.h;
        wheelSat = hsv.s;
        wheelVal = hsv.v;
        drawColorWheel();
    }

    function hexToRgb(hex) {
        var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function bindColorWheel() {
        wheelCanvas = $('oekaki-color-wheel');
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
                // 色相环（与 canvas arc 同方向：顺时针从右侧 0° 开始）
                var angle = Math.atan2(dy, dx);
                if (angle < 0) angle += Math.PI * 2;
                wheelHue = angle / (Math.PI * 2);
            } else if (dist < innerR) {
                // SV 三角形（简化为中心三角形）
                setWheelSVFromPoint(dx, dy, innerR);
            }
            updateColorFromWheel(true);
            drawColorWheel();
        }

        wheelCanvas.addEventListener('mousedown', function (e) {
            wheelDragging = true;
            handle(e);
        });
        document.addEventListener('mousemove', function (e) {
            if (!wheelDragging) return;
            handle(e);
        });
        document.addEventListener('mouseup', function () {
            wheelDragging = false;
        });
        wheelCanvas.addEventListener('touchstart', function (e) {
            wheelDragging = true;
            handle(e);
        }, { passive: false });
        document.addEventListener('touchmove', function (e) {
            if (!wheelDragging) return;
            handle(e);
        }, { passive: false });
        document.addEventListener('touchend', function () {
            wheelDragging = false;
        });
    }

    function setWheelSVFromPoint(dx, dy, radius) {
        // 将内部圆映射到 SV：x -> saturation, y -> value
        var nx = Math.max(-1, Math.min(1, dx / radius));
        var ny = Math.max(-1, Math.min(1, dy / radius));
        wheelSat = (nx + 1) / 2;
        wheelVal = 1 - (ny + 1) / 2;
    }

    function updateColorFromWheel(emit) {
        var rgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
        var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
        setColor(hex, currentAlpha, emit);
        overwriteActivePreset(hex, currentAlpha);
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

        // 色相环
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

        // SV 内圆（当前色相下的饱和/明度）
        var grad = wheelCtx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
        var hueRgb = hsvToRgb(wheelHue, 1, 1);
        grad.addColorStop(0, 'rgb(255,255,255)');
        grad.addColorStop(0.5, 'rgb(' + hueRgb.r + ',' + hueRgb.g + ',' + hueRgb.b + ')');
        grad.addColorStop(1, 'rgb(0,0,0)');
        wheelCtx.beginPath();
        wheelCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
        wheelCtx.fillStyle = grad;
        wheelCtx.fill();

        // 当前选择指示器
        var rgb = hsvToRgb(wheelHue, wheelSat, wheelVal);
        wheelCtx.beginPath();
        wheelCtx.arc(cx, cy, innerR * 0.35, 0, Math.PI * 2);
        wheelCtx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
        wheelCtx.fill();
        wheelCtx.strokeStyle = '#ffffff';
        wheelCtx.lineWidth = 2;
        wheelCtx.stroke();
    }

    // ===== 图层工具 =====

    function initLayers() {
        layers = [{ id: generateId('layer'), name: '图层 1', visible: true, opacity: 1 }];
        activeLayerId = layers[0].id;
        renderLayerList();
        bindLayerOpacity();
    }

    function createLayer(name, fromServer) {
        var layer = { id: generateId('layer'), name: name || '新图层', visible: true, opacity: 1 };
        layers.push(layer);
        activeLayerId = layer.id;
        renderLayerList();
        updateLayerOpacityUI();
        if (!fromServer && roomId) {
            window.socket.emit('oekaki:layer:create', { room: roomId, layer: layer });
        }
        return layer;
    }

    function deleteActiveLayer() {
        if (layers.length <= 1) {
            alert('至少需要保留一个图层');
            return;
        }
        var idx = layers.findIndex(function (l) { return l.id === activeLayerId; });
        if (idx < 0) return;
        var deletedId = layers[idx].id;
        layers.splice(idx, 1);
        localStrokes = localStrokes.filter(function (s) { return s.layerId !== deletedId; });
        activeLayerId = layers[Math.min(idx, layers.length - 1)].id;
        renderLayerList();
        redrawAllStrokes();
        updateLayerOpacityUI();
        if (roomId) {
            window.socket.emit('oekaki:layer:delete', { room: roomId, id: deletedId });
        }
    }

    function renameActiveLayer() {
        var layer = layers.find(function (l) { return l.id === activeLayerId; });
        if (!layer) return;
        var newName = prompt('请输入新图层名称：', layer.name);
        if (!newName || !newName.trim()) return;
        layer.name = newName.trim().substring(0, 20);
        renderLayerList();
        if (roomId) {
            window.socket.emit('oekaki:layer:rename', { room: roomId, id: layer.id, name: layer.name });
        }
    }

    function setActiveLayer(id, fromServer) {
        activeLayerId = id;
        renderLayerList();
        updateLayerOpacityUI();
        if (!fromServer && roomId) {
            window.socket.emit('oekaki:layer:active', { room: roomId, id: id });
        }
    }

    function setLayerOpacity(id, opacity, fromServer) {
        var layer = layers.find(function (l) { return l.id === id; });
        if (!layer) return;
        layer.opacity = Math.max(0, Math.min(1, opacity));
        renderLayerList();
        redrawAllStrokes();
        if (id === activeLayerId) updateLayerOpacityUI();
        if (!fromServer && roomId) {
            window.socket.emit('oekaki:layer:opacity', { room: roomId, id: id, opacity: layer.opacity });
        }
    }

    function toggleLayerVisible(id, fromServer) {
        var layer = layers.find(function (l) { return l.id === id; });
        if (!layer) return;
        layer.visible = !layer.visible;
        renderLayerList();
        redrawAllStrokes();
        if (!fromServer && roomId) {
            window.socket.emit('oekaki:layer:visible', { room: roomId, id: id, visible: layer.visible });
        }
    }

    function reorderLayers(newOrder, fromServer) {
        if (!newOrder || newOrder.length !== layers.length) return;
        var map = {};
        layers.forEach(function (l) { map[l.id] = l; });
        layers = newOrder.map(function (id) { return map[id]; }).filter(Boolean);
        renderLayerList();
        redrawAllStrokes();
        if (!fromServer && roomId) {
            window.socket.emit('oekaki:layer:reorder', { room: roomId, order: layers.map(function (l) { return l.id; }) });
        }
    }

    function bindLayerOpacity() {
        var slider = $('oekaki-layer-opacity');
        if (slider && !slider._bound) {
            slider._bound = true;
            slider.addEventListener('input', function () {
                var opacity = parseInt(slider.value, 10) / 100;
                setLayerOpacity(activeLayerId, opacity);
            });
        }
    }

    function updateLayerOpacityUI() {
        var slider = $('oekaki-layer-opacity');
        var label = $('oekaki-layer-opacity-value');
        var layer = layers.find(function (l) { return l.id === activeLayerId; });
        var opacity = layer ? layer.opacity : 1;
        if (slider) slider.value = Math.round(opacity * 100);
        if (label) label.textContent = Math.round(opacity * 100) + '%';
    }

    function renderLayerList() {
        var ul = $('oekaki-layer-list');
        if (!ul) return;
        ul.innerHTML = '';
        layers.slice().reverse().forEach(function (layer) {
            var li = document.createElement('li');
            li.className = layer.id === activeLayerId ? 'active' : '';
            li.setAttribute('data-layer-id', layer.id);
            li.draggable = true;

            var handle = document.createElement('span');
            handle.className = 'drag-handle';
            handle.textContent = '≡';

            var eye = document.createElement('span');
            eye.className = 'eye' + (layer.visible ? '' : ' hidden');
            eye.textContent = '👁';
            eye.addEventListener('click', function (e) {
                e.stopPropagation();
                toggleLayerVisible(layer.id);
            });

            var name = document.createElement('span');
            name.textContent = layer.name + ' · ' + Math.round((layer.opacity || 1) * 100) + '%';
            name.style.flex = '1';
            name.style.overflow = 'hidden';
            name.style.textOverflow = 'ellipsis';

            li.appendChild(handle);
            li.appendChild(eye);
            li.appendChild(name);
            li.addEventListener('click', function () {
                setActiveLayer(layer.id);
            });

            li.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('text/plain', layer.id);
                li.classList.add('dragging');
            });
            li.addEventListener('dragend', function () {
                li.classList.remove('dragging');
            });
            li.addEventListener('dragover', function (e) {
                e.preventDefault();
            });
            li.addEventListener('drop', function (e) {
                e.preventDefault();
                var draggedId = e.dataTransfer.getData('text/plain');
                if (!draggedId || draggedId === layer.id) return;
                var currentOrder = layers.map(function (l) { return l.id; });
                var fromIdx = currentOrder.indexOf(draggedId);
                var toIdx = currentOrder.indexOf(layer.id);
                if (fromIdx < 0 || toIdx < 0) return;
                currentOrder.splice(fromIdx, 1);
                currentOrder.splice(toIdx, 0, draggedId);
                reorderLayers(currentOrder);
            });

            ul.appendChild(li);
        });
    }

    function setLayers(newLayers, newActiveId) {
        layers = newLayers && newLayers.length ? newLayers.map(function (l) {
            return {
                id: l.id,
                name: l.name,
                visible: l.visible !== false,
                opacity: l.opacity == null ? 1 : l.opacity
            };
        }) : [{ id: generateId('layer'), name: '图层 1', visible: true, opacity: 1 }];
        activeLayerId = newActiveId || layers[0].id;
        renderLayerList();
        updateLayerOpacityUI();
        redrawAllStrokes();
    }

    function getActiveLayerId() {
        return activeLayerId || (layers[0] && layers[0].id);
    }

    // ===== 绘制 =====

    function drawStroke(from, to, tool, color, size, alpha, emit, strokeId, groupId) {
        if (!ctx) return;
        var layerId = getActiveLayerId();
        var layer = layers.find(function (l) { return l.id === layerId; });
        var globalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = (alpha == null ? 1 : alpha) * (layer ? layer.opacity : 1);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = size;
        ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
        ctx.stroke();
        ctx.globalAlpha = globalAlpha;

        if (emit && roomId) {
            var id = strokeId || generateId('stroke');
            var stroke = {
                id: id,
                room: roomId,
                type: 'line',
                layerId: layerId,
                groupId: groupId || null,
                from: from,
                to: to,
                tool: tool,
                color: color,
                alpha: alpha == null ? 1 : alpha,
                size: size
            };
            localStrokes.push(stroke);
            window.socket.emit('oekaki:stroke', stroke);
        }
    }

    function placeText(x, y) {
        var text = prompt('请输入文字：');
        if (!text || !text.trim()) return;
        drawText(x, y, text.trim(), currentColor, currentSize, currentAlpha, true);
    }

    function drawText(x, y, text, color, size, alpha, emit, strokeId) {
        if (!ctx) return;
        var layerId = getActiveLayerId();
        var layer = layers.find(function (l) { return l.id === layerId; });
        var globalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = (alpha == null ? 1 : alpha) * (layer ? layer.opacity : 1);
        ctx.font = Math.max(size * 5, 14) + 'px VT323, monospace';
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, y);
        ctx.globalAlpha = globalAlpha;

        if (emit && roomId) {
            var id = strokeId || generateId('stroke');
            var stroke = {
                id: id,
                room: roomId,
                type: 'text',
                layerId: layerId,
                groupId: generateId('group'),
                x: x,
                y: y,
                text: text,
                color: color,
                alpha: alpha == null ? 1 : alpha,
                size: size
            };
            localStrokes.push(stroke);
            window.socket.emit('oekaki:stroke', stroke);
        }
    }

    function renderStroke(s) {
        if (!ctx) return;
        var layer = layers.find(function (l) { return l.id === s.layerId; });
        var alpha = s.alpha == null ? 1 : s.alpha;
        var opacity = layer ? layer.opacity : 1;
        ctx.globalAlpha = alpha * opacity;
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
        ctx.globalAlpha = 1;
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

    function submitToGallery() {
        if (!canvas) return;
        var title = prompt('给这幅作品起个标题（最多 40 字）：');
        if (!title) return;
        var author = $('oekaki-nick') && $('oekaki-nick').value ? $('oekaki-nick').value.trim() : '匿名';
        var imageData = canvas.toDataURL('image/png');
        var btn = $('oekaki-submit');
        if (btn) { btn.disabled = true; btn.textContent = '投稿中…'; }
        fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'oekaki', title: title, author: author, imageData: imageData })
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

    function undoLastStroke() {
        if (!roomId || localStrokes.length === 0) return;
        var stroke = localStrokes[localStrokes.length - 1];
        if (stroke.groupId) {
            window.socket.emit('oekaki:undoGroup', { room: roomId, groupId: stroke.groupId });
        } else {
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
        layers.forEach(function (layer) {
            if (!layer.visible) return;
            localStrokes.filter(function (s) { return s.layerId === layer.id; }).forEach(renderStroke);
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
            renderStroke(localStrokes[i]);
            i++;
        }, 30);
    }

    function exportStrokes() {
        var data = {
            version: 2,
            canvas: { width: canvas.width, height: canvas.height },
            layers: layers,
            activeLayerId: activeLayerId,
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
                importProcess(data);
            } catch (err) {
                alert('导入失败：' + err.message);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    function importProcess(data) {
        var importedLayers = data.layers && data.layers.length ? data.layers : [{ id: generateId('layer'), name: '导入图层', visible: true, opacity: 1 }];
        importedLayers.forEach(function (l) {
            if (l.opacity == null) l.opacity = 1;
        });
        var idMap = {};
        importedLayers.forEach(function (l) {
            var newId = generateId('layer');
            idMap[l.id] = newId;
            l.id = newId;
        });

        var importedStrokes = data.strokes.map(function (s) {
            var copy = JSON.parse(JSON.stringify(s));
            copy.id = generateId('stroke') + '_' + (s.id || '');
            copy.room = roomId;
            copy.layerId = idMap[s.layerId] || importedLayers[0].id;
            if (copy.alpha == null) copy.alpha = 1;
            return copy;
        });

        layers = layers.concat(importedLayers);
        localStrokes = localStrokes.concat(importedStrokes);
        activeLayerId = importedLayers[importedLayers.length - 1].id;
        renderLayerList();
        updateLayerOpacityUI();
        redrawAllStrokes();

        if (roomId) {
            window.socket.emit('oekaki:import', {
                room: roomId,
                layers: importedLayers,
                strokes: importedStrokes,
                activeLayerId: activeLayerId
            });
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
        bindColorWheel();
        initLayers();
        bindKeys();
        renderColorPresets();
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
        layers = [];
        activeLayerId = null;
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
        window.socket.off('oekaki:layer:create');
        window.socket.off('oekaki:layer:delete');
        window.socket.off('oekaki:layer:rename');
        window.socket.off('oekaki:layer:active');
        window.socket.off('oekaki:layer:visible');
        window.socket.off('oekaki:layer:opacity');
        window.socket.off('oekaki:layer:reorder');
        window.socket.off('oekaki:layers');
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
            setColor(data.color, data.alpha, false);
        });
        window.socket.on('oekaki:layer:create', function (data) {
            if (data.room !== roomId || !data.layer) return;
            createLayer(data.layer.name, true);
        });
        window.socket.on('oekaki:layer:delete', function (data) {
            if (data.room !== roomId) return;
            var idx = layers.findIndex(function (l) { return l.id === data.id; });
            if (idx < 0) return;
            layers.splice(idx, 1);
            localStrokes = localStrokes.filter(function (s) { return s.layerId !== data.id; });
            if (activeLayerId === data.id) activeLayerId = layers[0] && layers[0].id;
            renderLayerList();
            updateLayerOpacityUI();
            redrawAllStrokes();
        });
        window.socket.on('oekaki:layer:rename', function (data) {
            if (data.room !== roomId) return;
            var layer = layers.find(function (l) { return l.id === data.id; });
            if (!layer) return;
            layer.name = data.name;
            renderLayerList();
        });
        window.socket.on('oekaki:layer:active', function (data) {
            if (data.room !== roomId) return;
            activeLayerId = data.id;
            renderLayerList();
            updateLayerOpacityUI();
        });
        window.socket.on('oekaki:layer:visible', function (data) {
            if (data.room !== roomId) return;
            var layer = layers.find(function (l) { return l.id === data.id; });
            if (!layer) return;
            layer.visible = data.visible;
            renderLayerList();
            redrawAllStrokes();
        });
        window.socket.on('oekaki:layer:opacity', function (data) {
            if (data.room !== roomId) return;
            var layer = layers.find(function (l) { return l.id === data.id; });
            if (!layer) return;
            layer.opacity = data.opacity;
            renderLayerList();
            if (data.id === activeLayerId) updateLayerOpacityUI();
            redrawAllStrokes();
        });
        window.socket.on('oekaki:layer:reorder', function (data) {
            if (data.room !== roomId || !Array.isArray(data.order)) return;
            reorderLayers(data.order, true);
        });
        window.socket.on('oekaki:layers', function (data) {
            if (data.room !== roomId) return;
            setLayers(data.layers, data.activeLayerId);
        });
        window.socket.on('oekaki:import', function (data) {
            if (data.room !== roomId || !Array.isArray(data.strokes)) return;
            if (data.layers) {
                data.layers.forEach(function (l) {
                    if (l.opacity == null) l.opacity = 1;
                    if (!layers.some(function (existing) { return existing.id === l.id; })) {
                        layers.push(l);
                    }
                });
            }
            data.strokes.forEach(function (s) {
                if (s.alpha == null) s.alpha = 1;
                if (!localStrokes.some(function (ls) { return ls.id === s.id; })) {
                    localStrokes.push(s);
                }
            });
            renderLayerList();
            updateLayerOpacityUI();
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
            bindColorWheel();
            renderColorPresets();
            window.socket.emit('oekaki:rejoin', { room: roomId });
            if (chatRoom) {
                chatRoom.roomId = roomId;
                chatRoom.bindSocket();
                chatRoom.join(nick);
            }
        }
    };
})();
