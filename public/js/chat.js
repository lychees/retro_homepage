/**
 * 聊天室模块
 * 复用 room-common.js 中的 RoomSession 与 chat-core.js 中的 ChatRoom
 */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    var chatSession = new window.RoomSession({
        type: 'chat',
        elements: {
            create: 'chat-create',
            leave: 'chat-leave',
            nick: 'chat-nick',
            room: 'chat-room',
            pwd: 'chat-pwd',
            lobbyView: 'chat-lobby',
            roomView: 'chat-room-view',
            roomId: 'chat-room-id'
        },
        chatOptions: {
            messagesId: 'chat-messages',
            inputId: 'chat-input',
            sendId: 'chat-send',
            usersId: 'chat-users',
            onlineId: 'chat-online'
        },
        onLeave: function () {
            $('chat-messages').innerHTML = '';
            $('chat-users').innerHTML = '';
        }
    });

    window.initChat = function () {
        chatSession.init();
    };
})();
