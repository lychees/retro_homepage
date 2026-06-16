/**
 * 简易 hash 路由
 * 支持 #/、#/chat、#/oekaki、#/fc、#/about、#/lobby
 * 同时支持 query string，如 #/chat?room=ABC&pwd=secret
 */
(function () {
    'use strict';

    function parseQuery(qs) {
        var query = {};
        if (!qs) return query;
        var parts = qs.split('&');
        for (var i = 0; i < parts.length; i++) {
            var pair = parts[i].split('=');
            var key = decodeURIComponent(pair[0] || '');
            var value = decodeURIComponent(pair[1] || '');
            query[key] = value;
        }
        return query;
    }

    window.Router = {
        routes: {},
        current: '',
        query: {},

        on: function (path, handler) {
            this.routes[path] = handler;
            return this;
        },

        navigate: function (path) {
            window.location.hash = '#/' + path;
        },

        resolve: function () {
            var hash = window.location.hash || '#/';
            var mainPart = hash.replace(/^#\//, '').split('?');
            var path = mainPart[0].replace(/\/$/, '') || '/';
            this.current = path;
            this.query = parseQuery(mainPart[1]);

            var handler = this.routes[path];
            if (!handler) handler = this.routes['/'];

            var app = document.getElementById('app');
            if (!app) return;
            app.innerHTML = '<div class="view-loading">正在穿越星门…</div>';

            handler(path, app, this.query);
        },

        init: function () {
            var self = this;
            window.addEventListener('hashchange', function () { self.resolve(); });
            if (window.location.hash) {
                self.resolve();
            } else {
                window.location.hash = '#/';
            }
        }
    };
})();
