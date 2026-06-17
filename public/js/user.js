/**
 * 用户个人主页
 */
(function () {
    'use strict';

    function api(path) {
        return fetch('/api' + path).then(function (res) {
            return res.json().then(function (data) {
                if (!res.ok) throw new Error(data.error || '请求失败');
                return data;
            });
        });
    }

    function avatarUrl(user) {
        if (user && user.avatar) return user.avatar;
        return 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'96\' height=\'96\'%3E%3Crect width=\'96\' height=\'96\' fill=\'%23333\'/%3E%3Ctext x=\'50%25\' y=\'55%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%23aaa\' font-family=\'monospace\' font-size=\'40\'%3E?%3C/text%3E%3C/svg%3E';
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderProfile(user) {
        var area = document.getElementById('user-profile-area');
        if (!area) return;

        var social = user.social || {};
        var socialHtml = '';
        var links = [
            { key: 'homepage', label: '主页' },
            { key: 'twitter', label: 'Twitter' },
            { key: 'github', label: 'GitHub' },
            { key: 'bilibili', label: 'Bilibili' },
            { key: 'weibo', label: 'Weibo' }
        ];
        links.forEach(function (l) {
            var v = social[l.key];
            if (!v) return;
            var url = v;
            if (l.key === 'twitter' && !/^https?:\/\//.test(url)) url = 'https://twitter.com/' + url.replace(/^@/, '');
            if (l.key === 'github' && !/^https?:\/\//.test(url)) url = 'https://github.com/' + url;
            if (l.key === 'bilibili' && /^\d+$/.test(v)) url = 'https://space.bilibili.com/' + v;
            socialHtml += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + l.label + '</a>';
        });

        area.innerHTML = '<div class="profile-header">' +
            '<img src="' + avatarUrl(user) + '" alt="avatar" class="user-avatar-large">' +
            '<div>' +
                '<h2>' + escapeHtml(user.nickname || user.username) + '</h2>' +
                '<div style="color:#8888cc;font-size:15px;">@' + escapeHtml(user.username) + '</div>' +
                (user.bio ? '<div class="profile-bio">' + escapeHtml(user.bio) + '</div>' : '') +
                (socialHtml ? '<div class="profile-social">' + socialHtml + '</div>' : '') +
            '</div>' +
        '</div>';
    }

    function renderWorks(works) {
        var grid = document.getElementById('user-works-grid');
        if (!grid) return;
        if (!works.length) {
            grid.innerHTML = '<p style="color:#8888cc;">这位旅人还没有投稿。</p>';
            return;
        }
        grid.innerHTML = works.map(function (item) {
            return '<div class="gallery-item" data-id="' + item.id + '">' +
                '<img src="' + item.thumbnail + '" alt="' + escapeHtml(item.title) + '">' +
                '<div class="gallery-title">' + escapeHtml(item.title) + '</div>' +
                '<div class="gallery-meta">' + new Date(item.timestamp).toLocaleDateString() + '</div>' +
            '</div>';
        }).join('');
        grid.querySelectorAll('.gallery-item').forEach(function (el) {
            el.addEventListener('click', function () {
                if (window.Gallery && window.Gallery.openItem) {
                    window.Gallery.openItem(el.getAttribute('data-id'));
                } else {
                    window.location.hash = '#/gallery?id=' + encodeURIComponent(el.getAttribute('data-id'));
                }
            });
        });
    }

    function init() {
        var query = window.currentQuery || {};
        var userId = query.id;
        if (!userId) {
            document.getElementById('user-profile-area').innerHTML = '未指定用户 ID';
            return;
        }
        api('/user/' + encodeURIComponent(userId)).then(function (data) {
            renderProfile(data.user);
            renderWorks(data.user.works || []);
        }).catch(function (e) {
            document.getElementById('user-profile-area').innerHTML = '加载失败：' + e.message;
        });
    }

    window.initUser = init;
})();
