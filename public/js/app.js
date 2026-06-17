/**
 * 星間茶室 - 前端主入口
 * 负责视图加载、星空背景、Socket.io 连接与全局工具函数
 */
(function () {
    'use strict';

    window.socket = null;

    function initStarfield() {
        var container = document.getElementById('starfield');
        if (!container) return;
        container.innerHTML = '';
        var count = 120;
        for (var i = 0; i < count; i++) {
            var star = document.createElement('div');
            star.className = 'star';
            var size = Math.random() * 2 + 1;
            star.style.width = size + 'px';
            star.style.height = size + 'px';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.setProperty('--duration', (Math.random() * 3 + 2) + 's');
            star.style.animationDelay = Math.random() * 5 + 's';
            container.appendChild(star);
        }
        setInterval(function () {
            if (Math.random() > 0.7) createShootingStar(container);
        }, 2500);
    }

    function createShootingStar(container) {
        var s = document.createElement('div');
        s.className = 'shooting-star';
        s.style.left = Math.random() * 80 + '%';
        s.style.top = Math.random() * 50 + '%';
        container.appendChild(s);
        setTimeout(function () { s.remove(); }, 2000);
    }

    function initSocket() {
        if (window.io) {
            window.socket = window.io({ transports: ['websocket', 'polling'] });
        }
    }

    function loadView(path, container, query, callback) {
        var file = path === '/' ? 'index' : path;
        fetch('views/' + file + '.html')
            .then(function (res) {
                if (!res.ok) throw new Error('Not found');
                return res.text();
            })
            .then(function (html) {
                container.innerHTML = html;
                window.currentQuery = query || {};
                runInlineScripts(container);
                updateActiveMenu(path);
                if (callback) callback();
            })
            .catch(function () {
                container.innerHTML = '<div class="view-error">页面迷失在星尘中了…<br><a href="#/" data-link>返回 TOP</a></div>';
            });
    }

    function runInlineScripts(container) {
        var scripts = container.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
            var s = scripts[i];
            if (s.src) continue;
            try {
                (new Function(s.textContent))();
            } catch (e) {
                console.error('[app] script error:', e);
            }
        }
    }

    function updateActiveMenu(path) {
        var links = document.querySelectorAll('.menu-list a[data-link]');
        links.forEach(function (a) {
            var href = a.getAttribute('href') || '#/';
            var p = href.replace(/^#\//, '').replace(/\/$/, '') || '/';
            a.style.color = (p === path) ? '#ff66cc' : '';
        });
    }

    function generateRoomId() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var id = '';
        for (var i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        return id;
    }

    window.generateRoomId = generateRoomId;

    // 注册路由
    window.Router.on('/', function (path, container, query) { loadView('/', container, query); });
    window.Router.on('lobby', function (path, container, query) { loadView('lobby', container, query); });
    window.Router.on('chat', function (path, container, query) { loadView('chat', container, query); });
    window.Router.on('oekaki', function (path, container, query) { loadView('oekaki', container, query); });
    window.Router.on('fc', function (path, container, query) { loadView('fc', container, query); });
    window.Router.on('gallery', function (path, container, query) { loadView('gallery', container, query); });
    window.Router.on('pictionary', function (path, container, query) { loadView('pictionary', container, query); });
    window.Router.on('gallery', function (path, container, query) { loadView('gallery', container, query); });
    window.Router.on('user', function (path, container, query) { loadView('user', container, query); });
    window.Router.on('links', function (path, container, query) { loadView('links', container, query); });
    window.Router.on('about', function (path, container, query) { loadView('about', container, query); });

    document.addEventListener('DOMContentLoaded', function () {
        initStarfield();
        initSocket();
        window.Router.init();
    });
})();
