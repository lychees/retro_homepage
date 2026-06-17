# 星間茶室 (Star Tearoom)

参考 [yachiyo.net](https://yachiyo.net/) 的复古个人站设计语言，以「宇宙与星空」为主题的互动式个人主页。集星空首页、实时聊天室、多人茶绘与 FC/NES 联机游戏于一体，所有房间通过「宇宙大厅」统一浏览、创建与加入。

## 功能概览

- 🌌 星空主题 SPA 首页（动态星空 + 流星动画）
- 🏛️ 宇宙大厅：统一浏览聊天室 / 茶绘 / FC 房间
- 🔒 房间加密：创建房间时可选择是否添加密码
- 💬 实时聊天室（支持系统消息、在线列表）
- 🎨 多人联机茶绘画板（画笔 / 橡皮 / 文字 / 取色 / 图层、SAI 调色环、RGBA、历史同步、导出/导入作画过程）
- 🎮 FC / NES 联机游戏室（服务端权威帧同步、内置聊天、单人模式可用 2P 按键）
- 🖼️ 星间画廊：投稿、点赞、评论、回放作画过程、导出过程
- 🧩 你画我猜：复用茶绘工具，回合制猜词，回合开始/猜对音效
- 👤 账号系统：注册/登录、设置昵称/头像/简介、绑定社交媒体，点击头像进入个人主页

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js |
| Web 框架 | Express 4 |
| 实时通信 | Socket.io 4（支持 `websocket` 与 `polling` 回退） |
| FC 模拟器 | jsnes |
| 前端 | 原生 JavaScript（无构建工具）、原生 Canvas 2D |
| 样式 | CSS 变量 + 自定义动画 |
| 路由 | 自定义 hash 路由（支持 query string） |

## 项目结构

```
retrohomepage2/
├── server.js                 # Express + Socket.io 服务端入口
├── package.json
├── public/
│   ├── index.html            # SPA 外壳
│   ├── css/
│   │   └── style.css         # 星空主题样式
│   ├── js/
│   │   ├── app.js            # 前端入口：星空、Socket、视图加载
│   │   ├── router.js         # hash 路由与 query string 解析
│   │   ├── lobby.js          # 宇宙大厅
│   │   ├── chat.js           # 聊天室房间页
│   │   ├── chat-core.js      # 通用聊天组件（被三类房间复用）
│   │   ├── auth.js           # 全局账号入口与登录/注册/设置弹窗
│   │   ├── oekaki.js         # 茶绘房间
│   │   ├── pictionary.js     # 你画我猜房间
│   │   ├── gallery.js        # 星间画廊
│   │   ├── user.js           # 用户个人主页
│   │   └── fc.js             # FC 游戏室
│   └── libs/
│       └── jsnes.js          # jsnes 模拟器（浏览器端用）
├── views/
│   ├── index.html            # 首页视图
│   ├── lobby.html            # 大厅视图
│   ├── chat.html             # 聊天室视图
│   ├── oekaki.html           # 茶绘视图
│   ├── pictionary.html       # 你画我猜视图
│   ├── gallery.html          # 画廊视图
│   ├── user.html             # 用户主页视图
│   ├── fc.html               # FC 游戏室视图
│   ├── links.html            # 链接集页面
│   └── about.html            # 关于页
└── README.md
```

## 快速开始

```bash
npm install
npm start
```

默认监听 `http://localhost:3000`；若 3000 被占用则自动尝试 3001、3002……

### 环境变量

复制 `.env.example` 为 `.env` 并填写需要的配置：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `SESSION_SECRET` | 会话密钥（生产环境必填） |
| `BASE_URL` | 站点根地址，用于 OAuth 回调（默认 `http://localhost:3000`） |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth 应用凭证 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth 应用凭证 |
| `QQ_CLIENT_ID` / `QQ_CLIENT_SECRET` | QQ 互联应用凭证 |

未配置的 OAuth 提供方会自动隐藏对应的登录/绑定按钮。

## ROM 配置

FC ROM 文件存放在项目本地目录：

```
public/roms/
```

服务端启动时会自动扫描该目录下的 `.nes` 文件。如需更换 ROM 目录，可在 `server.js` 中修改 `ROM_DIR` 变量。提供以下接口：

- `GET /api/roms` —— 列出可用 `.nes` 文件
- `GET /roms/:name` —— 下载指定 ROM

## 按键说明

### 玩家 1

| 功能 | 按键 |
|------|------|
| 方向 | W / A / S / D |
| Select | Q |
| Start | E |
| B | J |
| A | K |

### 玩家 2

| 功能 | 按键 |
|------|------|
| 方向 | ↑ / ← / ↓ / → |
| Select | Insert |
| Start | Enter |
| B | `1` 或 Numpad1 |
| A | `2` 或 Numpad2 |

> 单人模式下，房间只有一名玩家时，P1 与 P2 按键会同时生效。

## 核心代码逻辑

### 1. 前端架构：原生 JS SPA

`public/js/router.js` 实现了一个轻量 hash 路由器：

```js
window.Router = {
    routes: {},
    on: function (path, handler) { this.routes[path] = handler; },
    resolve: function () {
        // 解析 #/path?room=ABC&pwd=secret
        var mainPart = hash.replace(/^#\//, '').split('?');
        var path = mainPart[0].replace(/\/$/, '') || '/';
        this.query = parseQuery(mainPart[1]);
        this.routes[path](path, app, this.query);
    }
};
```

`public/js/app.js` 在 `DOMContentLoaded` 后初始化星空背景、Socket.io 连接，并注册各视图路由。视图通过 `fetch('views/{name}.html')` 动态加载，视图中的内联脚本会由 `runInlineScripts()` 使用 `new Function()` 执行，使每个视图仍能保持独立的初始化逻辑（如 `window.initFc()`）。

### 2. 宇宙大厅

`public/js/lobby.js` 通过 `lobby:getRooms` 拉取房间列表，渲染为卡片。点击卡片时：

- 无密码房间：直接进入 `#/{type}?room=ID`
- 有密码房间：弹出 prompt 输入密码，再进入 `#/{type}?room=ID&pwd=PASSWORD`

创建房间时向服务端 emit `lobby:create`，服务端返回 `lobby:created` 后自动跳转。

### 3. 通用聊天组件

`public/js/chat-core.js` 提供 `ChatRoom` 类，被聊天室、茶绘、FC 三类房间复用。事件命名采用 `{type}:chat:*` 前缀：

- `{type}:chat:join` —— 加入聊天频道
- `{type}:chat:message` —— 发送/接收消息
- `{type}:chat:users` —— 在线用户列表

`appendMessage` 区分系统消息与普通消息，并自动滚动到底部。

### 4. 茶绘房间

`public/js/oekaki.js` 在本地 Canvas 上监听鼠标/触摸事件，每一笔 `move` 都会把 `from / to / tool / color / size` 通过 `oekaki:stroke` 广播给房间其他人。

服务端在 `server.js` 中维护 `room.oekaki` 数组作为历史笔触，新加入者会收到完整历史，保证画布状态一致。历史长度上限 5000 笔，超出时移除最早笔触。

### 5. FC 游戏室：服务端权威帧同步

这是项目最复杂的模块，参考了 [retrochatroom](https://github.com/lychees/retrochatroom) 的架构。

#### 5.1 服务端模拟器

`server.js` 中的 `startFCEmulator(room, key)` 在房间加载 ROM 后启动一个服务端 jsnes 实例：

```js
room.nes = new jsnes.NES({
    onFrame: () => {},
    onAudioSample: () => {},
    emulateSound: false   // 服务端只负责画面与输入状态
});
room.nes.loadROM(romString);
room.nes.ppu.palTable.loadDefaultPalette(); // 与客户端统一调色板
```

一个 60fps 的定时器负责：

1. 将当前 `room.controllers` 应用到手柄 1/2
2. 调用 `room.nes.frame()` 推进一帧
3. 递增 `room.frameCount`
4. 向房间内所有人广播 `fc:controllers`（含帧号、控制器状态、玩家槽位）

每 2 秒额外广播一次 `fc:state`，携带服务端 `nes.toJSON()` 序列化状态，用于：

- 新玩家加入后快速同步
- 修正客户端模拟漂移

#### 5.2 客户端帧同步

`public/js/fc.js` 中，客户端同样运行一个 jsnes 实例，但**不主动循环**，而是靠收到 `fc:controllers` 事件后追赶服务端帧号：

```js
socket.on('fc:controllers', function (data) {
    controllers = data.controllers;
    playerSlots = data.playerSlots;
    if (nes && data.frame) {
        var targetFrame = data.frame;
        var diff = targetFrame - localFrame;
        if (diff > 0) {
            var runCount = Math.min(diff, 3); // 最多一回合追 3 帧
            for (var i = 0; i < runCount; i++) runFrame();
        }
    }
});
```

`runFrame()` 流程：

1. `applyControllers()` —— 把服务端广播的最新按键状态设置到本地手柄
2. `nes.frame()` —— 执行一帧并触发 `onFrame` / `onAudioSample` 回调
3. `localFrame++`
4. `flushAudio()` —— 把累积的音频样本播放出去

`fc:state` 事件用于强同步：客户端 `nes.fromJSON(data.state)` 后重新加载默认调色板，保证颜色不会因为服务端/客户端调色板差异而跳变。

#### 5.3 音频输出

为了避免 `ScriptProcessorNode` 常见的爆音与断续问题，`public/js/fc.js` 改用 `AudioBufferSourceNode` 连续调度：

```js
var pendingSamples = [];
var nextAudioTime = 0;

function audioSample(left, right) {
    pendingSamples.push(left, right);
    if (pendingSamples.length > 8192) {
        pendingSamples.splice(0, pendingSamples.length - 8192);
    }
}

function flushAudio() {
    if (pendingSamples.length < 4096) return;
    var buffer = audioCtx.createBuffer(2, frames, 44100);
    // 写入左右声道 ...
    var src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    if (nextAudioTime < audioCtx.currentTime) nextAudioTime = audioCtx.currentTime;
    src.start(nextAudioTime);
    nextAudioTime += buffer.duration;
}
```

每次累积约 4096 个立体声样本（≈93ms）后创建 buffer 并调度到 `nextAudioTime`，形成连续播放队列；同时设置 8192 样本上限防止延迟无限增长。

#### 5.4 单人 2P 模式

`server.js` 在收到按键事件时判断：

```js
if (room.users.size === 1) {
    const otherSlot = slot === 1 ? 2 : 1;
    room.controllers[otherSlot][button] = pressed;
}
```

当房间只有一名玩家时，该玩家按下的任意槽位按键会同时写入两个控制器，使得单人模式下也能使用 P2 按键操作。

客户端同样通过 `isSoloMode()` 放行所有按键，不限制玩家只能按自己槽位的键。

#### 5.5 颜色处理

jsnes 的 `onFrame` 返回的像素格式为 `0xRRGGBB`。渲染时按 R-G-B 顺序写入 `ImageData`：

```js
data[i * 4]     = (pixel >> 16) & 0xFF; // R
data[i * 4 + 1] = (pixel >> 8)  & 0xFF; // G
data[i * 4 + 2] = pixel         & 0xFF; // B
data[i * 4 + 3] = 255;                  // A
```

服务端与客户端在加载 ROM 后都会调用 `loadDefaultPalette()`，确保调色板一致，避免状态同步后颜色跳变。

### 6. 账号系统与个人主页

`public/js/auth.js` 维护全局登录态，侧边栏显示当前用户头像/昵称入口。**本站不提供账号密码注册，仅支持通过 GitHub / Google / QQ 第三方 OAuth 登录；首次 OAuth 登录即自动创建账号。** 登录后可在「设置」中修改：

- 昵称（≤16 字）
- 头像 URL / Data URI
- 个人简介（≤300 字）
- 社交媒体：Twitter、GitHub、Bilibili、Weibo、个人主页
- 绑定/解绑 OAuth 账号

后端接口：

| 接口 | 说明 |
|------|------|
| `GET /api/auth/providers` | 查看已启用的 OAuth 提供方 |
| `GET /api/auth/github` / `/api/auth/github/callback` | GitHub OAuth 登录/绑定 |
| `GET /api/auth/google` / `/api/auth/google/callback` | Google OAuth 登录/绑定 |
| `GET /api/auth/qq` / `/api/auth/qq/callback` | QQ OAuth 登录/绑定 |
| `POST /api/auth/logout` | 登出 |
| `GET /api/auth/me` | 当前登录用户信息 |
| `POST /api/user/profile` | 修改昵称/头像/简介（需登录） |
| `POST /api/user/social` | 修改社交链接（需登录） |
| `GET /api/user/:id` | 公开用户资料与全部投稿 |

登录用户投稿画廊时，作品会记录 `userId`，并在画廊列表/详情/评论中显示可点击的头像，跳转至 `#/user/:id` 个人主页。个人主页会列出该用户的所有投稿作品。

## 设计决策

1. **原生 JS 无构建**：项目规模不大，原生 JS 足以支持；同时避免构建工具带来的复杂度。
2. **服务端权威 FC**：由服务端运行唯一模拟器，客户端只渲染，保证所有玩家看到完全一致的画面，也天然解决作弊与不同步问题。
3. **事件驱动渲染**：客户端不主动跑 60fps 循环，而是根据服务端广播的帧号追赶，减少 CPU 占用并降低漂移。
4. **聊天组件复用**：`ChatRoom` 类抽象出聊天逻辑，使三类房间都能内置聊天而代码不重复。

## 许可证

MIT
