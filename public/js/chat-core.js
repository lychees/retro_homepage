/**
 * 通用聊天模块
 * 可被聊天室、茶绘房间、FC 游戏室复用
 */
(function () {
    'use strict';

    function ChatRoom(type, roomId, options) {
        this.type = type;
        this.roomId = roomId;
        this.options = options || {};
        this.joined = false;
    }

    ChatRoom.prototype.$ = function (id) {
        return document.getElementById(id);
    };

    ChatRoom.prototype.init = function () {
        var self = this;
        var opts = this.options;

        var sendBtn = this.$(opts.sendId);
        var input = this.$(opts.inputId);

        if (sendBtn && !sendBtn._bound) {
            sendBtn._bound = true;
            sendBtn.addEventListener('click', function () { self.send(); });
        }
        if (input && !input._bound) {
            input._bound = true;
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') self.send();
            });
        }

        this.bindSocket();
    };

    ChatRoom.prototype.bindSocket = function () {
        var self = this;
        var type = this.type;

        if (!window.socket) return;

        window.socket.off(type + ':chat:message');
        window.socket.off(type + ':chat:users');

        window.socket.on(type + ':chat:message', function (data) {
            if (data.room !== self.roomId) return;
            self.appendMessage(data);
        });
        window.socket.on(type + ':chat:users', function (data) {
            if (data.room !== self.roomId) return;
            self.updateUsers(data.users);
        });
    };

    ChatRoom.prototype.join = function (nick) {
        if (!window.socket || !this.roomId) return;
        window.socket.emit(this.type + ':chat:join', {
            room: this.roomId,
            nick: nick || '匿名'
        });
        this.joined = true;
    };

    ChatRoom.prototype.send = function () {
        var input = this.$(this.options.inputId);
        if (!input) return;
        var text = input.value.trim();
        if (!text || !this.joined) return;
        window.socket.emit(this.type + ':chat:message', {
            room: this.roomId,
            text: text
        });
        input.value = '';
    };

    ChatRoom.prototype.appendMessage = function (data) {
        var container = this.$(this.options.messagesId);
        if (!container) return;
        var div = document.createElement('div');
        div.className = 'chat-message' + (data.system ? ' system' : '');
        var time = data.time ? new Date(data.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        if (data.system) {
            div.textContent = data.text;
        } else {
            div.innerHTML = '<span class="time">[' + time + ']</span><span class="nick">' + escapeHtml(data.nick) + '</span>' + escapeHtml(data.text);
        }
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    };

    ChatRoom.prototype.updateUsers = function (users) {
        if (this.options.onlineId) {
            var el = this.$(this.options.onlineId);
            if (el) el.textContent = users.length;
        }
        var ul = this.$(this.options.usersId);
        if (!ul) return;
        ul.innerHTML = '';
        users.forEach(function (u) {
            var li = document.createElement('li');
            li.textContent = '✦ ' + u;
            ul.appendChild(li);
        });
    };

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.ChatRoom = ChatRoom;
})();
