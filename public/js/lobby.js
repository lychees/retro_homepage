/**
 * 宇宙大厅模块
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function bindOnce() {
        var createBtn = $('lobby-create');
        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createRoom);
        }
    }

    function createRoom() {
        var type = $('lobby-type').value;
        var nick = ($('lobby-nick').value || '宇宙旅人').trim().substring(0, 16);
        var roomId = ($('lobby-room').value || window.generateRoomId()).trim().toUpperCase();
        var pwd = $('lobby-pwd').value.trim();
        if (!roomId) roomId = window.generateRoomId();
        $('lobby-room').value = roomId;

        window.socket.emit('lobby:create', {
            type: type,
            room: roomId,
            nick: nick,
            pwd: pwd
        });
    }

    function enterRoom(type, roomId, pwd) {
        var qs = 'room=' + encodeURIComponent(roomId);
        if (pwd) qs += '&pwd=' + encodeURIComponent(pwd);
        window.location.hash = '#/' + type + '?' + qs;
    }

    function renderRooms(rooms) {
        var container = $('lobby-room-list');
        var countEl = $('room-count');
        if (!container) return;
        if (countEl) countEl.textContent = '(' + rooms.length + ')';

        if (!rooms.length) {
            container.innerHTML = '<div class="room-card" style="cursor:default;"><p style="color:#7777aa;">当前没有开放的房间，快去创建一个吧！</p></div>';
            return;
        }

        container.innerHTML = '';
        rooms.forEach(function (r) {
            var card = document.createElement('div');
            card.className = 'room-card';
            var icon = r.type === 'chat' ? '💬' : r.type === 'oekaki' ? '🎨' : '🎮';
            var typeName = r.type === 'chat' ? '聊天室' : r.type === 'oekaki' ? '茶绘房间' : 'FC 游戏室';
            var lock = r.hasPwd ? '🔒 ' : '';
            card.innerHTML =
                '<div class="icon" style="color:#00ffff">' + icon + '</div>' +
                '<h3>' + lock + '#' + escapeHtml(r.id) + '</h3>' +
                '<p>' + typeName + ' · 在线 ' + r.users + ' 人</p>';
            card.addEventListener('click', function () {
                if (r.hasPwd) {
                    var pwd = prompt('该房间已加密，请输入密码：');
                    if (pwd === null) return;
                    enterRoom(r.type, r.id, pwd.trim());
                } else {
                    enterRoom(r.type, r.id, '');
                }
            });
            container.appendChild(card);
        });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function initSocketListeners() {
        if (!window.socket) return;
        window.socket.off('lobby:created');
        window.socket.off('lobby:rooms');
        window.socket.off('lobby:error');

        window.socket.on('lobby:created', function (data) {
            enterRoom(data.type, data.room, data.pwd || '');
        });
        window.socket.on('lobby:rooms', function (data) {
            renderRooms(data.rooms || []);
        });
        window.socket.on('lobby:error', function (data) {
            alert('大厅错误：' + data.message);
        });
    }

    window.initLobby = function () {
        bindOnce();
        initSocketListeners();
        window.socket.emit('lobby:getRooms');
    };
})();
