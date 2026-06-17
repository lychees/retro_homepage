/**
 * 通用房间会话辅助模块
 * 抽取聊天室、茶绘、你画我猜、FC 游戏室的公共生命周期逻辑
 */
(function () {
    'use strict';

    var TYPE_NAMES = {
        chat: '聊天室',
        oekaki: '茶绘房间',
        pictionary: '你画我猜',
        fc: 'FC 游戏室'
    };

    function generateId(prefix) {
        return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function RoomSession(config) {
        this.type = config.type;
        this.typeName = config.typeName || TYPE_NAMES[config.type] || config.type;
        this.elements = config.elements || {};
        this.onEnter = config.onEnter || function () {};
        this.onLeave = config.onLeave || function () {};
        this.onRejoin = config.onRejoin || function () {};
        this.chatOptions = config.chatOptions || null;
        this.bindExtra = config.bindExtra || null;

        this.roomId = null;
        this.nick = '';
        this.joined = false;
        this.chatRoom = null;
        this._connectHandler = null;
    }

    RoomSession.prototype.$ = function (id) {
        return document.getElementById(id);
    };

    RoomSession.prototype.defaultNick = function () {
        var defaults = {
            chat: '宇宙旅人',
            oekaki: '涂鸦星人',
            pictionary: '匿名',
            fc: '红白机战士'
        };
        return defaults[this.type] || '匿名';
    };

    RoomSession.prototype.emit = function (event, payload) {
        if (!window.socket) return;
        window.socket.emit(event, payload);
    };

    RoomSession.prototype.getRoomId = function () {
        return this.roomId;
    };

    RoomSession.prototype.getNick = function () {
        return this.nick;
    };

    RoomSession.prototype.isJoined = function () {
        return this.joined;
    };

    RoomSession.prototype.showRoomView = function () {
        var el = this.elements;
        var lobby = el.lobbyView ? this.$(el.lobbyView) : null;
        var room = el.roomView ? this.$(el.roomView) : null;
        var roomIdEl = el.roomId ? this.$(el.roomId) : null;
        if (lobby) lobby.style.display = 'none';
        if (room) room.style.display = 'block';
        if (roomIdEl && this.roomId) roomIdEl.textContent = '#' + this.roomId;
    };

    RoomSession.prototype.showLobbyView = function () {
        var el = this.elements;
        var lobby = el.lobbyView ? this.$(el.lobbyView) : null;
        var room = el.roomView ? this.$(el.roomView) : null;
        if (room) room.style.display = 'none';
        if (lobby) lobby.style.display = 'block';
    };

    RoomSession.prototype.bindOnce = function () {
        var self = this;
        var el = this.elements;

        var createBtn = el.create ? this.$(el.create) : null;
        var leaveBtn = el.leave ? this.$(el.leave) : null;

        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', function () { self.createOrJoin(); });
        }
        if (leaveBtn && !leaveBtn._bound) {
            leaveBtn._bound = true;
            leaveBtn.addEventListener('click', function () { self.leaveRoom(); });
        }

        if (typeof this.bindExtra === 'function') this.bindExtra();
    };

    RoomSession.prototype.userNick = function () {
        return window.currentUser && window.currentUser.nickname ? window.currentUser.nickname : '';
    };

    RoomSession.prototype.fillNickInput = function () {
        var nickInput = this.elements.nick ? this.$(this.elements.nick) : null;
        var userNick = this.userNick();
        if (nickInput && userNick && !nickInput.value.trim()) {
            nickInput.value = userNick;
        }
    };

    RoomSession.prototype.createOrJoin = function () {
        var el = this.elements;
        var nickInput = el.nick ? this.$(el.nick) : null;
        var roomInput = el.room ? this.$(el.room) : null;
        var pwdInput = el.pwd ? this.$(el.pwd) : null;

        this.fillNickInput();
        this.nick = (nickInput && nickInput.value || this.userNick() || this.defaultNick()).trim().substring(0, 16);
        this.roomId = (roomInput && roomInput.value || window.generateRoomId()).trim().toUpperCase();
        if (!this.roomId) this.roomId = window.generateRoomId();
        if (roomInput) roomInput.value = this.roomId;

        var pwd = (pwdInput && pwdInput.value || '').trim();
        this.emit(this.type + ':join', { room: this.roomId, nick: this.nick, pwd: pwd });
    };

    RoomSession.prototype.enterRoom = function (id, users) {
        this.roomId = id;
        this.joined = true;
        this.showRoomView();
        this.onEnter(id, users || []);

        if (this.chatOptions && !this.chatRoom) {
            this.chatRoom = new window.ChatRoom(this.type, id, this.chatOptions);
            this.chatRoom.init();
        }
        if (this.chatRoom) {
            this.chatRoom.roomId = id;
            this.chatRoom.join(this.nick);
            this.chatRoom.updateUsers(users || []);
        }
    };

    RoomSession.prototype.leaveRoom = function () {
        if (this.roomId) this.emit(this.type + ':leave', { room: this.roomId });
        this.joined = false;
        this.chatRoom = null;
        this.showLobbyView();
        this.onLeave();
    };

    RoomSession.prototype.rejoin = function () {
        if (!this.roomId || !this.joined || !window.socket) return;
        this.showRoomView();
        this.emit(this.type + ':rejoin', { room: this.roomId });
        this.onRejoin();
        if (this.chatRoom) {
            this.chatRoom.roomId = this.roomId;
            this.chatRoom.bindSocket();
            this.chatRoom.join(this.nick);
        }
    };

    RoomSession.prototype.initSocketListeners = function () {
        var self = this;
        if (!window.socket) return;

        window.socket.off(this.type + ':joined');
        window.socket.off(this.type + ':error');

        window.socket.on(this.type + ':joined', function (data) {
            self.enterRoom(data.room, data.users);
        });
        window.socket.on(this.type + ':error', function (data) {
            alert(self.typeName + '：' + data.message);
        });
    };

    RoomSession.prototype.bindConnectHandler = function () {
        var self = this;
        if (!window.socket) return;
        if (this._connectHandler) window.socket.off('connect', this._connectHandler);
        this._connectHandler = function () { self.rejoin(); };
        window.socket.on('connect', this._connectHandler);
    };

    RoomSession.prototype.init = function () {
        var self = this;
        this.bindOnce();
        this.initSocketListeners();
        this.bindConnectHandler();
        this.fillNickInput();

        var query = window.currentQuery || {};
        if (query.room && !this.joined) {
            var roomInput = this.elements.room ? this.$(this.elements.room) : null;
            var pwdInput = this.elements.pwd ? this.$(this.elements.pwd) : null;
            if (roomInput) roomInput.value = query.room;
            if (pwdInput && query.pwd) pwdInput.value = query.pwd;
            this.createOrJoin();
            return;
        }

        if (this.joined && this.roomId) {
            this.rejoin();
        }
    };

    window.generateId = generateId;
    window.RoomSession = RoomSession;
})();
