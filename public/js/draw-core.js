/**
 * 公共画图核心
 * 为茶绘 / 你画我猜等模式提供统一的画图工具栏、调色、画布输入与笔触渲染。
 */
(function () {
    'use strict';

    var DEFAULT_PRESETS = [
        { color: '#000000', alpha: 1 }, { color: '#ffffff', alpha: 1 },
        { color: '#ff0000', alpha: 1 }, { color: '#00ff00', alpha: 1 },
        { color: '#0000ff', alpha: 1 }, { color: '#ffff00', alpha: 1 },
        { color: '#ff00ff', alpha: 1 }, { color: '#00ffff', alpha: 1 }
    ];

    function $(id) { return document.getElementById(id); }

    function DrawCanvas(options) {
        this.options = options || {};
        this.canvasId = this.options.canvasId;
        this.toolbarId = this.options.toolbarId;
        this.onStroke = this.options.onStroke || function () {};
        this.onClear = this.options.onClear || function () {};
        this.onColorChange = this.options.onColorChange || null;
        this.readOnly = !!this.options.readOnly;
        this.layerId = this.options.layerId || null;

        this.canvas = $(this.canvasId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.drawing = false;
        this.lastPos = null;
        this.currentGroupId = null;

        this.currentTool = 'pen';
        this.currentColor = this.options.defaultColor || '#000000';
        this.currentAlpha = this.options.defaultAlpha != null ? this.options.defaultAlpha : 1;
        this.currentSize = this.options.defaultSize || 4;
        this.currentTextSize = this.options.defaultTextSize || 20;
        this.strokeOpacity = this.options.strokeOpacity != null ? this.options.strokeOpacity : 1;
        this.zoom = 1;
        this.minZoom = 0.25;
        this.maxZoom = 4;
        this.zoomStep = 0.1;

        this.selection = null;
        this.selecting = false;
        this.movingSelection = false;
        this.moveStart = null;
        this.moveOffset = null;
        this.selectionImageData = null;
        this.selectionOverlay = null;
        this.selectionPreview = null;

        this.colorPresets = this.options.colorPresets || DEFAULT_PRESETS;
        this.activePresetIndex = this.options.activePresetIndex != null ? this.options.activePresetIndex : -1;

        this.wheelCanvas = null;
        this.wheelCtx = null;
        this.wheelDragging = false;
        this.wheelHue = 0;
        this.wheelSat = 0;
        this.wheelVal = 0;

        this.toolbar = null;
        this.els = {};
    }

    DrawCanvas.prototype.init = function () {
        this.buildToolbar();
        this.bindToolbar();
        this.bindCanvas();
        this.setColor(this.currentColor, this.currentAlpha);
        this.applyZoom();
    };

    DrawCanvas.prototype.buildToolbar = function () {
        var root = $(this.toolbarId);
        if (!root) return;
        this.toolbar = root;
        root.innerHTML = '';
        root.className = 'draw-tools';

        var html =
            '<div class="tool-row">' +
                '<div class="tool-btn active" data-tool="pen" title="画笔">✏️</div>' +
                '<div class="tool-btn" data-tool="eraser" title="橡皮">🧼</div>' +
                '<div class="tool-btn" data-tool="text" title="文字">T</div>' +
                '<div class="tool-btn" data-tool="eyedropper" title="取色器">💧</div>' +
                '<div class="tool-btn" data-tool="select" title="区域选择">⛶</div>' +
            '</div>' +
            '<div class="selection-actions-row" style="display:none;">' +
                '<button class="btn small select-clear-btn" title="清除选中区域">🗑️ 清除</button>' +
                '<button class="btn small select-deselect-btn" title="取消选择">✖</button>' +
            '</div>' +
            '<div class="tool-btn draw-clear-btn" title="清空" style="width:100%;margin-top:6px;">🗑️ 清空</div>' +

            '<div class="color-wheel-title">调色环</div>' +
            '<canvas class="color-wheel" width="140" height="140"></canvas>' +
            '<div class="current-color-box" style="background:#000000;"></div>' +

            '<div class="rgba-row">' +
                '<label>RGBA</label>' +
                '<div class="rgba-inputs">' +
                    '<input type="number" class="rgba-r" min="0" max="255" value="0" title="R">' +
                    '<input type="number" class="rgba-g" min="0" max="255" value="0" title="G">' +
                    '<input type="number" class="rgba-b" min="0" max="255" value="0" title="B">' +
                    '<input type="number" class="rgba-a" min="0" max="1" step="0.01" value="1" title="A">' +
                '</div>' +
                '<div class="rgba-text">rgba(0, 0, 0, 1)</div>' +
            '</div>' +

            '<div class="alpha-row">' +
                '<label>不透明度</label>' +
                '<input type="range" class="alpha-slider" min="0" max="100" value="100">' +
                '<span class="alpha-value">100%</span>' +
            '</div>' +

            '<div class="color-presets-title">常用颜色</div>' +
            '<div class="color-presets"></div>' +

            '<div class="brush-title">粗细</div>' +
            '<div class="brush-size">' +
                '<span style="width:4px;height:4px;" data-size="2"></span>' +
                '<span style="width:8px;height:8px;" data-size="4" class="active"></span>' +
                '<span style="width:12px;height:12px;" data-size="8"></span>' +
                '<span style="width:18px;height:18px;" data-size="16"></span>' +
            '</div>' +
            '<div class="size-input-row">' +
                '<label>画笔粗细</label>' +
                '<input type="number" class="brush-size-input" min="1" max="100" value="4">' +
            '</div>' +
            '<div class="text-size-row" style="display:none;">' +
                '<label>文字大小</label>' +
                '<input type="number" class="text-size-input" min="8" max="200" value="20">' +
            '</div>' +

            '<div class="zoom-row">' +
                '<label>画布缩放</label>' +
                '<div class="zoom-controls">' +
                    '<button class="btn small zoom-out" title="缩小">-</button>' +
                    '<span class="zoom-value">100%</span>' +
                    '<button class="btn small zoom-in" title="放大">+</button>' +
                    '<button class="btn small zoom-reset" title="重置">⟲</button>' +
                '</div>' +
            '</div>';

        root.innerHTML = html;

        this.els.colorWheel = root.querySelector('.color-wheel');
        this.els.currentColorBox = root.querySelector('.current-color-box');
        this.els.r = root.querySelector('.rgba-r');
        this.els.g = root.querySelector('.rgba-g');
        this.els.b = root.querySelector('.rgba-b');
        this.els.a = root.querySelector('.rgba-a');
        this.els.rgbaText = root.querySelector('.rgba-text');
        this.els.alphaSlider = root.querySelector('.alpha-slider');
        this.els.alphaValue = root.querySelector('.alpha-value');
        this.els.presets = root.querySelector('.color-presets');
        this.els.clearBtn = root.querySelector('.draw-clear-btn');
        this.els.brushSizeInput = root.querySelector('.brush-size-input');
        this.els.textSizeRow = root.querySelector('.text-size-row');
        this.els.textSizeInput = root.querySelector('.text-size-input');
        this.els.zoomOut = root.querySelector('.zoom-out');
        this.els.zoomIn = root.querySelector('.zoom-in');
        this.els.zoomReset = root.querySelector('.zoom-reset');
        this.els.zoomValue = root.querySelector('.zoom-value');
        this.els.selectionActions = root.querySelector('.selection-actions-row');
        this.els.selectClearBtn = root.querySelector('.select-clear-btn');
        this.els.selectDeselectBtn = root.querySelector('.select-deselect-btn');

        this.wheelCanvas = this.els.colorWheel;
        this.wheelCtx = this.wheelCanvas ? this.wheelCanvas.getContext('2d') : null;
    };

    DrawCanvas.prototype.bindToolbar = function () {
        var self = this;
        var root = this.toolbar;
        if (!root) return;

        var tools = root.querySelectorAll('[data-tool]');
        tools.forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                tools.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                var prevTool = self.currentTool;
                self.currentTool = btn.getAttribute('data-tool');
                if (self.els.textSizeRow) {
                    self.els.textSizeRow.style.display = self.currentTool === 'text' ? 'block' : 'none';
                }
                if (self.els.selectionActions) {
                    self.els.selectionActions.style.display = self.currentTool === 'select' ? 'flex' : 'none';
                }
                if (prevTool === 'select' && self.currentTool !== 'select') {
                    self.deselect();
                }
            });
        });

        var sizes = root.querySelectorAll('.brush-size span');
        sizes.forEach(function (s) {
            if (s._bound) return;
            s._bound = true;
            s.addEventListener('click', function () {
                sizes.forEach(function (x) { x.classList.remove('active'); });
                s.classList.add('active');
                self.currentSize = parseInt(s.getAttribute('data-size'), 10);
                if (self.els.brushSizeInput) self.els.brushSizeInput.value = self.currentSize;
            });
        });

        if (this.els.brushSizeInput && !this.els.brushSizeInput._bound) {
            this.els.brushSizeInput._bound = true;
            this.els.brushSizeInput.addEventListener('input', function () {
                var v = parseInt(self.els.brushSizeInput.value, 10);
                if (isNaN(v)) return;
                self.currentSize = Math.max(1, Math.min(100, v));
                sizes.forEach(function (s) {
                    s.classList.toggle('active', parseInt(s.getAttribute('data-size'), 10) === self.currentSize);
                });
            });
        }

        if (this.els.textSizeInput && !this.els.textSizeInput._bound) {
            this.els.textSizeInput._bound = true;
            this.els.textSizeInput.addEventListener('input', function () {
                var v = parseInt(self.els.textSizeInput.value, 10);
                if (isNaN(v)) return;
                self.currentTextSize = Math.max(8, Math.min(200, v));
            });
        }

        if (this.els.alphaSlider && !this.els.alphaSlider._bound) {
            this.els.alphaSlider._bound = true;
            this.els.alphaSlider.addEventListener('input', function () {
                self.setAlpha(parseInt(self.els.alphaSlider.value, 10) / 100);
            });
        }

        this.bindRgbaInputs();
        this.renderColorPresets();
        this.bindColorWheel();

        if (this.els.clearBtn && !this.els.clearBtn._bound) {
            this.els.clearBtn._bound = true;
            this.els.clearBtn.addEventListener('click', function () {
                if (self.readOnly) return;
                self.clear();
                self.onClear();
            });
        }

        if (this.els.zoomIn && !this.els.zoomIn._bound) {
            this.els.zoomIn._bound = true;
            this.els.zoomIn.addEventListener('click', function () { self.zoomIn(); });
        }
        if (this.els.zoomOut && !this.els.zoomOut._bound) {
            this.els.zoomOut._bound = true;
            this.els.zoomOut.addEventListener('click', function () { self.zoomOut(); });
        }
        if (this.els.zoomReset && !this.els.zoomReset._bound) {
            this.els.zoomReset._bound = true;
            this.els.zoomReset.addEventListener('click', function () { self.resetZoom(); });
        }

        if (this.els.selectClearBtn && !this.els.selectClearBtn._bound) {
            this.els.selectClearBtn._bound = true;
            this.els.selectClearBtn.addEventListener('click', function () {
                if (self.readOnly) return;
                self.clearSelection();
            });
        }
        if (this.els.selectDeselectBtn && !this.els.selectDeselectBtn._bound) {
            this.els.selectDeselectBtn._bound = true;
            this.els.selectDeselectBtn.addEventListener('click', function () {
                self.deselect();
            });
        }
    };

    DrawCanvas.prototype.bindRgbaInputs = function () {
        var self = this;
        var inputs = [this.els.r, this.els.g, this.els.b];
        inputs.forEach(function (input) {
            if (!input || input._bound) return;
            input._bound = true;
            input.addEventListener('input', function () {
                var r = clampChannel(self.els.r.value);
                var g = clampChannel(self.els.g.value);
                var b = clampChannel(self.els.b.value);
                self.setColor(rgbToHex(r, g, b), self.currentAlpha);
            });
        });
        if (this.els.a && !this.els.a._bound) {
            this.els.a._bound = true;
            this.els.a.addEventListener('input', function () {
                var a = parseFloat(self.els.a.value);
                if (isNaN(a)) return;
                self.setAlpha(Math.max(0, Math.min(1, a)));
            });
        }
    };

    DrawCanvas.prototype.bindColorWheel = function () {
        var self = this;
        if (!this.wheelCanvas) return;
        this.drawColorWheel();

        function getPos(e) {
            var rect = self.wheelCanvas.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (self.wheelCanvas.width / rect.width),
                y: (clientY - rect.top) * (self.wheelCanvas.height / rect.height)
            };
        }

        function handle(e) {
            e.preventDefault();
            var pos = getPos(e);
            var cx = self.wheelCanvas.width / 2;
            var cy = self.wheelCanvas.height / 2;
            var dx = pos.x - cx;
            var dy = pos.y - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            var outerR = cx - 4;
            var innerR = outerR * 0.55;

            if (dist >= innerR && dist <= outerR) {
                var angle = Math.atan2(dy, dx);
                if (angle < 0) angle += Math.PI * 2;
                self.wheelHue = angle / (Math.PI * 2);
            } else if (dist < innerR) {
                self.setWheelSVFromPoint(dx, dy, innerR);
            }
            self.updateColorFromWheel();
            self.drawColorWheel();
        }

        this.wheelCanvas.addEventListener('mousedown', function (e) { self.wheelDragging = true; handle(e); });
        document.addEventListener('mousemove', function (e) { if (self.wheelDragging) handle(e); });
        document.addEventListener('mouseup', function () { self.wheelDragging = false; });
        this.wheelCanvas.addEventListener('touchstart', function (e) { self.wheelDragging = true; handle(e); }, { passive: false });
        document.addEventListener('touchmove', function (e) { if (self.wheelDragging) handle(e); }, { passive: false });
        document.addEventListener('touchend', function () { self.wheelDragging = false; });
    };

    DrawCanvas.prototype.setWheelSVFromPoint = function (dx, dy, radius) {
        var nx = Math.max(-1, Math.min(1, dx / radius));
        var ny = Math.max(-1, Math.min(1, dy / radius));
        this.wheelSat = (nx + 1) / 2;
        this.wheelVal = 1 - (ny + 1) / 2;
    };

    DrawCanvas.prototype.updateColorFromWheel = function () {
        var rgb = hsvToRgb(this.wheelHue, this.wheelSat, this.wheelVal);
        this.setColor(rgbToHex(rgb.r, rgb.g, rgb.b), this.currentAlpha);
    };

    DrawCanvas.prototype.drawColorWheel = function () {
        if (!this.wheelCtx) return;
        var w = this.wheelCanvas.width;
        var h = this.wheelCanvas.height;
        var cx = w / 2;
        var cy = h / 2;
        var outerR = cx - 4;
        var innerR = outerR * 0.55;

        this.wheelCtx.clearRect(0, 0, w, h);

        for (var angle = 0; angle < 360; angle++) {
            var start = (angle - 1) * Math.PI / 180;
            var end = (angle + 1) * Math.PI / 180;
            var rgb = hsvToRgb(angle / 360, 1, 1);
            this.wheelCtx.beginPath();
            this.wheelCtx.arc(cx, cy, outerR, start, end);
            this.wheelCtx.arc(cx, cy, innerR, end, start, true);
            this.wheelCtx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
            this.wheelCtx.fill();
        }

        var grad = this.wheelCtx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
        var hueRgb = hsvToRgb(this.wheelHue, 1, 1);
        grad.addColorStop(0, 'rgb(255,255,255)');
        grad.addColorStop(0.5, 'rgb(' + hueRgb.r + ',' + hueRgb.g + ',' + hueRgb.b + ')');
        grad.addColorStop(1, 'rgb(0,0,0)');
        this.wheelCtx.beginPath();
        this.wheelCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
        this.wheelCtx.fillStyle = grad;
        this.wheelCtx.fill();

        var curRgb = hsvToRgb(this.wheelHue, this.wheelSat, this.wheelVal);
        this.wheelCtx.beginPath();
        this.wheelCtx.arc(cx, cy, innerR * 0.35, 0, Math.PI * 2);
        this.wheelCtx.fillStyle = 'rgb(' + curRgb.r + ',' + curRgb.g + ',' + curRgb.b + ')';
        this.wheelCtx.fill();
        this.wheelCtx.strokeStyle = '#ffffff';
        this.wheelCtx.lineWidth = 2;
        this.wheelCtx.stroke();
    };

    DrawCanvas.prototype.updateWheelFromColor = function (color) {
        var rgb = hexToRgb(color);
        if (!rgb) return;
        var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        this.wheelHue = hsv.h;
        this.wheelSat = hsv.s;
        this.wheelVal = hsv.v;
        this.drawColorWheel();
    };

    DrawCanvas.prototype.renderColorPresets = function () {
        var self = this;
        var container = this.els.presets;
        if (!container) return;
        container.innerHTML = '';
        this.colorPresets.forEach(function (item, i) {
            var div = document.createElement('div');
            var classes = ['color-preset'];
            if (i === self.activePresetIndex) classes.push('active');
            div.className = classes.join(' ');
            div.style.background = item.color;
            div.style.opacity = item.alpha;
            div.title = item.color;
            div.addEventListener('click', function () {
                self.activePresetIndex = i;
                self.setColor(item.color, item.alpha);
                self.currentTool = 'pen';
                self.setActiveTool('pen');
                self.renderColorPresets();
            });
            container.appendChild(div);
        });
    };

    DrawCanvas.prototype.setActiveTool = function (tool) {
        if (!this.toolbar) return;
        var prevTool = this.currentTool;
        this.toolbar.querySelectorAll('[data-tool]').forEach(function (b) { b.classList.remove('active'); });
        var btn = this.toolbar.querySelector('[data-tool="' + tool + '"]');
        if (btn) btn.classList.add('active');
        this.currentTool = tool;
        if (this.els.textSizeRow) {
            this.els.textSizeRow.style.display = tool === 'text' ? 'block' : 'none';
        }
        if (this.els.selectionActions) {
            this.els.selectionActions.style.display = tool === 'select' ? 'flex' : 'none';
        }
        if (prevTool === 'select' && tool !== 'select') {
            this.deselect();
        }
    };

    DrawCanvas.prototype.setColor = function (color, alpha) {
        if (typeof alpha === 'number') this.currentAlpha = Math.max(0, Math.min(1, alpha));
        this.currentColor = color;
        if (this.els.currentColorBox) {
            this.els.currentColorBox.style.background = color;
            this.els.currentColorBox.style.opacity = this.currentAlpha;
        }
        this.updateWheelFromColor(color);
        this.updateAlphaUI();
        this.updateRgbaUI();
        if (this.onColorChange) this.onColorChange(color, this.currentAlpha);
    };

    DrawCanvas.prototype.setAlpha = function (alpha) {
        this.currentAlpha = Math.max(0, Math.min(1, alpha));
        if (this.els.currentColorBox) this.els.currentColorBox.style.opacity = this.currentAlpha;
        this.updateAlphaUI();
        this.updateRgbaUI();
        if (this.onColorChange) this.onColorChange(this.currentColor, this.currentAlpha);
    };

    DrawCanvas.prototype.updateAlphaUI = function () {
        if (this.els.alphaSlider) this.els.alphaSlider.value = Math.round(this.currentAlpha * 100);
        if (this.els.alphaValue) this.els.alphaValue.textContent = Math.round(this.currentAlpha * 100) + '%';
    };

    DrawCanvas.prototype.updateRgbaUI = function () {
        var rgb = hexToRgb(this.currentColor) || { r: 0, g: 0, b: 0 };
        if (this.els.r) this.els.r.value = rgb.r;
        if (this.els.g) this.els.g.value = rgb.g;
        if (this.els.b) this.els.b.value = rgb.b;
        if (this.els.a) this.els.a.value = Math.round(this.currentAlpha * 100) / 100;
        if (this.els.rgbaText) {
            this.els.rgbaText.textContent = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + (Math.round(this.currentAlpha * 100) / 100) + ')';
        }
    };

    DrawCanvas.prototype.setReadOnly = function (readOnly) {
        this.readOnly = !!readOnly;
        if (!this.toolbar) return;
        var self = this;
        this.toolbar.querySelectorAll('.tool-btn, .draw-clear-btn, .color-preset, .brush-size span, .rgba-inputs input, .alpha-slider, .brush-size-input, .text-size-input, .selection-actions-row .btn').forEach(function (el) {
            el.disabled = self.readOnly;
            el.style.opacity = self.readOnly ? '0.5' : '';
            el.style.pointerEvents = self.readOnly ? 'none' : '';
        });
        if (this.wheelCanvas) {
            this.wheelCanvas.style.pointerEvents = this.readOnly ? 'none' : '';
            this.wheelCanvas.style.opacity = this.readOnly ? '0.6' : '';
        }
    };

    DrawCanvas.prototype.setLayerId = function (layerId) {
        this.layerId = layerId;
    };

    DrawCanvas.prototype.setActivePresetIndex = function (index) {
        this.activePresetIndex = index;
        this.renderColorPresets();
    };

    DrawCanvas.prototype.setZoom = function (zoom) {
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
        this.applyZoom();
    };

    DrawCanvas.prototype.applyZoom = function () {
        if (!this.canvas) return;
        this.canvas.style.transform = 'scale(' + this.zoom + ')';
        this.canvas.style.transformOrigin = 'center center';
        if (this.els.zoomValue) {
            this.els.zoomValue.textContent = Math.round(this.zoom * 100) + '%';
        }
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.zoomIn = function () {
        this.setZoom(this.zoom + this.zoomStep);
    };

    DrawCanvas.prototype.zoomOut = function () {
        this.setZoom(this.zoom - this.zoomStep);
    };

    DrawCanvas.prototype.resetZoom = function () {
        this.setZoom(1);
    };

    DrawCanvas.prototype.ensureSelectionOverlay = function () {
        if (this.selectionOverlay) return;
        if (!this.canvas || !this.canvas.parentNode) return;
        var overlay = document.createElement('div');
        overlay.className = 'draw-selection-overlay';
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        this.canvas.parentNode.appendChild(overlay);
        this.selectionOverlay = overlay;
        this.selectionPreview = document.createElement('canvas');
    };

    DrawCanvas.prototype.updateSelectionOverlay = function () {
        if (!this.selectionOverlay) return;
        if (!this.selection || (this.selection.w <= 0 && this.selection.h <= 0)) {
            this.selectionOverlay.style.display = 'none';
            return;
        }
        var cRect = this.canvas.getBoundingClientRect();
        var pRect = this.canvas.parentNode.getBoundingClientRect();
        var scaleX = cRect.width / this.canvas.width;
        var scaleY = cRect.height / this.canvas.height;
        var x = this.selection.x * scaleX + (cRect.left - pRect.left);
        var y = this.selection.y * scaleY + (cRect.top - pRect.top);
        var w = this.selection.w * scaleX;
        var h = this.selection.h * scaleY;
        this.selectionOverlay.style.display = 'block';
        this.selectionOverlay.style.left = x + 'px';
        this.selectionOverlay.style.top = y + 'px';
        this.selectionOverlay.style.width = w + 'px';
        this.selectionOverlay.style.height = h + 'px';
    };

    DrawCanvas.prototype.normalizeSelection = function (a, b) {
        var x1 = Math.max(0, Math.min(this.canvas.width, Math.min(a.x, b.x)));
        var y1 = Math.max(0, Math.min(this.canvas.height, Math.min(a.y, b.y)));
        var x2 = Math.max(0, Math.min(this.canvas.width, Math.max(a.x, b.x)));
        var y2 = Math.max(0, Math.min(this.canvas.height, Math.max(a.y, b.y)));
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };

    DrawCanvas.prototype.pointInSelection = function (pos) {
        if (!this.selection) return false;
        return pos.x >= this.selection.x && pos.x <= this.selection.x + this.selection.w &&
               pos.y >= this.selection.y && pos.y <= this.selection.y + this.selection.h;
    };

    DrawCanvas.prototype.startSelection = function (pos) {
        this.deselect();
        this.selecting = true;
        this.selectionStart = pos;
        this.selection = { x: pos.x, y: pos.y, w: 0, h: 0 };
        this.ensureSelectionOverlay();
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.updateSelection = function (pos) {
        if (!this.selecting || !this.selectionStart) return;
        this.selection = this.normalizeSelection(this.selectionStart, pos);
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.finishSelection = function () {
        this.selecting = false;
        this.selectionStart = null;
        if (!this.selection || this.selection.w < 2 || this.selection.h < 2) {
            this.deselect();
            return;
        }
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.startMoveSelection = function (pos) {
        if (!this.selection || !this.ctx) return;
        this.movingSelection = true;
        this.moveStart = pos;
        this.moveOffset = { x: 0, y: 0 };
        this.moveOriginalSelection = { x: this.selection.x, y: this.selection.y, w: this.selection.w, h: this.selection.h };
        try {
            this.selectionImageData = this.ctx.getImageData(Math.floor(this.selection.x), Math.floor(this.selection.y), Math.ceil(this.selection.w), Math.ceil(this.selection.h));
            this.selectionPreview.width = this.selectionImageData.width;
            this.selectionPreview.height = this.selectionImageData.height;
            this.selectionPreview.getContext('2d').putImageData(this.selectionImageData, 0, 0);
            this.selectionOverlay.style.backgroundImage = 'url(' + this.selectionPreview.toDataURL() + ')';
            this.selectionOverlay.style.backgroundSize = '100% 100%';
            this.selectionOverlay.style.backgroundRepeat = 'no-repeat';
        } catch (e) {
            this.selectionImageData = null;
        }
    };

    DrawCanvas.prototype.updateMoveSelection = function (pos) {
        if (!this.movingSelection || !this.moveStart || !this.selection) return;
        this.moveOffset = { x: pos.x - this.moveStart.x, y: pos.y - this.moveStart.y };
        var moved = {
            x: this.selection.x + this.moveOffset.x,
            y: this.selection.y + this.moveOffset.y,
            w: this.selection.w,
            h: this.selection.h
        };
        this.selection = moved;
        this.moveStart = pos;
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.finishMoveSelection = function () {
        if (!this.movingSelection || !this.selection || !this.ctx) {
            this.movingSelection = false;
            return;
        }
        var moved = this.moveOriginalSelection && (this.selection.x !== this.moveOriginalSelection.x || this.selection.y !== this.moveOriginalSelection.y);
        if (moved && this.selectionPreview) {
            var orig = this.moveOriginalSelection;
            this.ctx.save();
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(Math.floor(orig.x), Math.floor(orig.y), Math.ceil(orig.w), Math.ceil(orig.h));
            this.ctx.drawImage(this.selectionPreview, Math.floor(this.selection.x), Math.floor(this.selection.y));
            this.ctx.restore();
        }
        this.movingSelection = false;
        this.moveStart = null;
        this.moveOffset = null;
        this.moveOriginalSelection = null;
        if (this.selectionOverlay) {
            this.selectionOverlay.style.backgroundImage = '';
        }
        this.selectionImageData = null;
        this.updateSelectionOverlay();
    };

    DrawCanvas.prototype.clearSelection = function () {
        if (!this.selection || !this.ctx || this.readOnly) return;
        this.ctx.save();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(Math.floor(this.selection.x), Math.floor(this.selection.y), Math.ceil(this.selection.w), Math.ceil(this.selection.h));
        this.ctx.restore();
        this.deselect();
    };

    DrawCanvas.prototype.deselect = function () {
        this.selection = null;
        this.selecting = false;
        this.movingSelection = false;
        this.moveStart = null;
        this.moveOffset = null;
        this.moveOriginalSelection = null;
        this.selectionImageData = null;
        if (this.selectionOverlay) {
            this.selectionOverlay.style.display = 'none';
            this.selectionOverlay.style.backgroundImage = '';
        }
    };

    DrawCanvas.prototype.bindCanvas = function () {
        var self = this;
        if (!this.canvas || this.canvas._drawBound) return;
        this.canvas._drawBound = true;

        function getPos(e) {
            var rect = self.canvas.getBoundingClientRect();
            var clientX = e.touches ? e.touches[0].clientX : e.clientX;
            var clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (self.canvas.width / rect.width),
                y: (clientY - rect.top) * (self.canvas.height / rect.height)
            };
        }

        function start(e) {
            if (self.readOnly) return;
            e.preventDefault();
            var pos = getPos(e);
            if (self.currentTool === 'eyedropper') {
                self.pickColor(pos.x, pos.y);
                return;
            }
            if (self.currentTool === 'text') {
                self.handleTextInput(pos.x, pos.y);
                return;
            }
            if (self.currentTool === 'select') {
                if (self.selection && self.pointInSelection(pos)) {
                    self.startMoveSelection(pos);
                } else {
                    self.startSelection(pos);
                }
                return;
            }
            self.drawing = true;
            self.lastPos = pos;
            self.currentGroupId = generateId('group');
        }

        function move(e) {
            if (self.readOnly) return;
            e.preventDefault();
            var pos = getPos(e);
            if (self.currentTool === 'select') {
                if (self.selecting) self.updateSelection(pos);
                else if (self.movingSelection) self.updateMoveSelection(pos);
                return;
            }
            if (!self.drawing) return;
            var stroke = {
                id: generateId('stroke'),
                layerId: self.layerId,
                groupId: self.currentGroupId,
                from: self.lastPos,
                to: pos,
                color: self.currentTool === 'eraser' ? '#ffffff' : self.currentColor,
                size: self.currentSize,
                alpha: self.currentTool === 'eraser' ? 1 : self.currentAlpha,
                tool: self.currentTool === 'eraser' ? 'eraser' : 'pen'
            };
            self.renderStroke(stroke, self.strokeOpacity);
            self.onStroke(stroke);
            self.lastPos = pos;
        }

        function end() {
            if (self.currentTool === 'select') {
                if (self.selecting) self.finishSelection();
                else if (self.movingSelection) self.finishMoveSelection();
                return;
            }
            self.drawing = false;
            self.lastPos = null;
            self.currentGroupId = null;
        }

        this.canvas.addEventListener('mousedown', start);
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', end);
        this.canvas.addEventListener('touchstart', start, { passive: false });
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', end);
        this.canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            if (e.deltaY < 0) self.zoomIn();
            else self.zoomOut();
        }, { passive: false });

        if (!this._selectKeysBound) {
            this._selectKeysBound = true;
            document.addEventListener('keydown', function (e) {
                if (self.currentTool !== 'select' || !self.selection) return;
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    self.clearSelection();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    self.deselect();
                }
            });
        }
    };

    DrawCanvas.prototype.handleTextInput = function (x, y) {
        var self = this;
        var text = prompt('输入文字（将显示在画布上）：');
        if (!text || !text.trim()) return;
        text = text.trim();
        var stroke = {
            id: generateId('stroke'),
            layerId: this.layerId,
            groupId: null,
            x: x,
            y: y,
            text: text,
            color: this.currentColor,
            size: this.currentTextSize,
            alpha: this.currentAlpha,
            tool: 'text'
        };
        this.renderStroke(stroke, this.strokeOpacity);
        this.onStroke(stroke);
    };

    DrawCanvas.prototype.pickColor = function (x, y) {
        if (!this.ctx) return;
        var pixel = this.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        var hex = rgbToHex(pixel[0], pixel[1], pixel[2]);
        this.setColor(hex, pixel[3] / 255);
        this.currentTool = 'pen';
        this.setActiveTool('pen');
    };

    DrawCanvas.prototype.renderStroke = function (stroke, layerOpacity) {
        if (!this.ctx || !stroke) return;
        layerOpacity = layerOpacity == null ? 1 : layerOpacity;
        if (stroke.tool === 'text') {
            this.ctx.save();
            this.ctx.globalAlpha = (stroke.alpha == null ? 1 : stroke.alpha) * layerOpacity;
            this.ctx.fillStyle = stroke.color || '#000000';
            this.ctx.font = 'bold ' + Math.max(stroke.size || 20, 12) + 'px VT323, monospace';
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(stroke.text, stroke.x, stroke.y);
            this.ctx.restore();
            return;
        }
        if (!stroke.from || !stroke.to) return;
        this.ctx.save();
        this.ctx.globalAlpha = (stroke.alpha == null ? 1 : stroke.alpha) * layerOpacity;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.strokeStyle = stroke.color || '#000000';
        this.ctx.lineWidth = stroke.size || 4;
        this.ctx.beginPath();
        this.ctx.moveTo(stroke.from.x, stroke.from.y);
        this.ctx.lineTo(stroke.to.x, stroke.to.y);
        this.ctx.stroke();
        this.ctx.restore();
    };

    DrawCanvas.prototype.clear = function (silent) {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (!silent && this.onClear) this.onClear();
    };

    function generateId(prefix) {
        return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function clampChannel(v) {
        var n = parseInt(v, 10);
        if (isNaN(n)) return 0;
        return Math.max(0, Math.min(255, n));
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

    window.DrawCanvas = DrawCanvas;
})();
