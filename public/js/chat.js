/**
 * 聊天室模块
 * 复用 chat-core.js 中的 ChatRoom
 */
(function () {
    'use strict';

    var roomId = null;
    var nick = '';
    var joined = false;
    var chatRoom = null;

    function $(id) { return document.getElementById(id); }

    function bindOnce() {
        var createBtn = $('chat-create');
        var leaveBtn = $('chat-leave');

        if (createBtn && !createBtn._bound) {
            createBtn._bound = true;
            createBtn.addEventListener('click', createOrJoin);
        }
        if (leaveBtn && !leaveBtn._bound) {
            leaveBtn._bound = true;
            leaveBtn.addEventListener('click', leaveRoom);
        }
    }

    function createOrJoin() {
        nick = ($('chat-nick').value || '宇宙旅人').trim().substring(0, 16);
        roomId = ($('chat-room').value || window.generateRoomId()).trim().toUpperCase();
        if (!roomId) roomId = window.generateRoomId();
        $('chat-room').value = roomId;

        var pwd = ($('chat-pwd') && $('chat-pwd').value || '').trim();
        window.socket.emit('chat:join', { room: roomId, nick: nick, pwd: pwd });
    }

    function enterRoom(id, users) {
        $('chat-lobby').style.display = 'none';
        $('chat-room-view').style.display = 'block';
        $('chat-room-id').textContent = '#' + id;
        joined = true;
        if (!chatRoom) {
            chatRoom = new window.ChatRoom('chat', id, {
                messagesId: 'chat-messages',
                inputId: 'chat-input',
                sendId: 'chat-send',
                usersId: 'chat-users',
                onlineId: 'chat-online'
            });
            chatRoom.init();
        }
        chatRoom.roomId = id;
        chatRoom.join(nick);
        chatRoom.updateUsers(users || []);
    }

    function leaveRoom() {
        if (roomId) window.socket.emit('chat:leave', { room: roomId });
        roomId = null;
        joined = false;
        chatRoom = null;
        $('chat-room-view').style.display = 'none';
        $('chat-lobby').style.display = 'block';
        $('chat-messages').innerHTML = '';
        $('chat-users').innerHTML = '';
    }

    function initSocketListeners() {
        if (!window.socket) return;
        window.socket.off('chat:joined');
        window.socket.off('chat:error');

        window.socket.on('chat:joined', function (data) {
            enterRoom(data.room, data.users);
        });
        window.socket.on('chat:error', function (data) {
            alert('聊天室：' + data.message);
        });
    }

    window.initChat = function () {
        bindOnce();
        initSocketListeners();

        var query = window.currentQuery || {};
        if (query.room && !joined) {
            $('chat-room').value = query.room;
            if (query.pwd && $('chat-pwd')) $('chat-pwd').value = query.pwd;
            createOrJoin();
            return;
        }

        if (joined && roomId) {
            $('chat-lobby').style.display = 'none';
            $('chat-room-view').style.display = 'block';
            $('chat-room-id').textContent = '#' + roomId;
            window.socket.emit('chat:rejoin', { room: roomId });
            if (chatRoom) {
                chatRoom.roomId = roomId;
                chatRoom.bindSocket();
                chatRoom.join(nick);
            }
        }
    };
})();
