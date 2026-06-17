/**
 * 茶绘房间模块
 * 支持图层、SAI风格调色环、取色器、文字、导出/导入
 */
(function () {
    'use strict';

    var roomId = null;
    var nick = '';
    var canvas, ctx;
    var chatRoom = null;
    var localStrokes = [];
    var replayTimer = null;
    var drawCore = null;

    // 图层
    var layers = [];
    var activeLayerId = null;

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
                if (drawCore) drawCore.clear();
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

        var audioFileInput = $('oekaki-audio-file');
        var audioPlayer = $('oekaki-audio');
        if (audioFileInput && audioPlayer && !audioFileInput._bound) {
            audioFileInput._bound = true;
            audioFileInput.addEventListener('change', function (e) {
                var file = e.target.files && e.target.files[0];
                if (!file) return;
                audioPlayer.src = URL.createObjectURL(file);
                audioPlayer.play().catch(function () {});
            });
        }
    }

    function initDrawCore() {
        if (drawCore) return;
        drawCore = new window.DrawCanvas({
            canvasId: 'oekaki-canvas',
            toolbarId: 'oekaki-draw-tools',
            defaultColor: '#000000',
            defaultAlpha: 1,
            defaultSize: 4,
            defaultTextSize: 20,
            activePresetIndex: 0,
            onStroke: function (stroke) {
                if (!roomId) return;
                var s = {
                    id: stroke.id || generateId('stroke'),
                    room: roomId,
                    type: stroke.tool === 'text' ? 'text' : 'line',
                    layerId: stroke.layerId || getActiveLayerId(),
                    groupId: stroke.groupId || null,
                    from: stroke.from,
                    to: stroke.to,
                    x: stroke.x,
                    y: stroke.y,
                    text: stroke.text,
                    tool: stroke.tool,
                    color: stroke.color,
                    alpha: stroke.alpha == null ? 1 : stroke.alpha,
                    size: stroke.size
                };
                localStrokes.push(s);
                window.socket.emit('oekaki:stroke', s);
            },
            onClear: function () {
                localStrokes = [];
                if (roomId) window.socket.emit('oekaki:clear', { room: roomId });
            },
            onColorChange: function (color, alpha) {
                overwriteActivePreset(color, alpha);
                if (roomId) window.socket.emit('oekaki:color', { room: roomId, color: color, alpha: alpha });
            }
        });
        drawCore.init();
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

    // ===== 颜色工具（由 draw-core 提供）=====

    function overwriteActivePreset(color, alpha) {
        if (!drawCore || !color || color[0] !== '#') return;
        var idx = drawCore.activePresetIndex;
        if (idx < 0 || idx >= drawCore.colorPresets.length) return;
        drawCore.colorPresets[idx] = { color: color.toLowerCase(), alpha: alpha == null ? 1 : alpha };
        drawCore.renderColorPresets();
    }

    function syncDrawCoreOpacity() {
        if (!drawCore) return;
        var layer = layers.find(function (l) { return l.id === activeLayerId; });
        drawCore.strokeOpacity = layer ? layer.opacity : 1;
    }

    // ===== 图层工具 =====

    function initLayers() {
        layers = [{ id: generateId('layer'), name: '图层 1', visible: true, opacity: 1 }];
        activeLayerId = layers[0].id;
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
        renderLayerList();
        bindLayerOpacity();
    }

    function createLayer(name, fromServer) {
        var layer = { id: generateId('layer'), name: name || '新图层', visible: true, opacity: 1 };
        layers.push(layer);
        activeLayerId = layer.id;
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
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
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
        renderLayerList();
        redrawAllStrokes();
        updateLayerOpacityUI();
        if (roomId) {
            window.socket.emit('oekaki:layer:delete', { room: roomId, id: deletedId });
        }
    }

    function renameActiveLayer() {
        renameLayer(activeLayerId);
    }

    function renameLayer(id) {
        var layer = layers.find(function (l) { return l.id === id; });
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
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
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
        if (id === activeLayerId) syncDrawCoreOpacity();
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
            name.title = '双击重命名';
            name.addEventListener('dblclick', function (e) {
                e.stopPropagation();
                renameLayer(layer.id);
            });

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
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
        renderLayerList();
        updateLayerOpacityUI();
        redrawAllStrokes();
    }

    function getActiveLayerId() {
        return activeLayerId || (layers[0] && layers[0].id);
    }

    // ===== 绘制 =====

    function renderStroke(s) {
        if (!drawCore) return;
        var layer = layers.find(function (l) { return l.id === s.layerId; });
        drawCore.renderStroke(s, layer ? layer.opacity : 1);
    }

    function clearCanvas() {
        if (drawCore) drawCore.clear(true);
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
            body: JSON.stringify({
                type: 'oekaki',
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
        if (drawCore) drawCore.setLayerId(activeLayerId);
        syncDrawCoreOpacity();
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
        initDrawCore();
        canvas = drawCore.canvas;
        ctx = drawCore.ctx;
        initLayers();
        bindKeys();
        drawCore.clear(true);
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
            if (drawCore) drawCore.setColor(data.color, data.alpha, true);
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
            if (drawCore) drawCore.setLayerId(activeLayerId);
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
            if (drawCore) drawCore.setLayerId(activeLayerId);
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
            if (data.id === activeLayerId) syncDrawCoreOpacity();
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
            initDrawCore();
            canvas = drawCore.canvas;
            ctx = drawCore.ctx;
            window.socket.emit('oekaki:rejoin', { room: roomId });
            if (chatRoom) {
                chatRoom.roomId = roomId;
                chatRoom.bindSocket();
                chatRoom.join(nick);
            }
        }
    };
})();
