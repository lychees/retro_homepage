# 星間茶室 (Star Tearoom)

参考 [yachiyo.net](https://yachiyo.net/) 设计语言、以「宇宙与星空」为主题的个人主页。
支持创建聊天室、茶绘房间与 FC 联机游戏室，并可通过宇宙大厅统一浏览、创建和加入房间。

## 功能

- 🌌 星空主题 SPA 首页
- 🏛️ 宇宙大厅：统一浏览所有聊天室 / 茶绘 / FC 房间
- 🔒 房间加密：创建房间时可选择是否添加密码
- 💬 实时聊天室
- 🎨 多人联机茶绘画板（含内置聊天）
- 🎮 FC / NES 联机游戏室（含内置聊天，服务端权威帧同步，单人模式可用 2P 按键）

## 运行

```bash
npm install
npm start
```

访问 http://localhost:3000

## ROM 来源

FC ROM 文件读取自 `D:\Dev\retroblog3\public\roms`，由 `/api/roms` 接口列出并通过 `/roms/:name` 提供下载。

## 按键说明

**玩家 1**
- 方向：W A S D
- 选择：Q
- 开始：E
- B：J
- A：K

**玩家 2**
- 方向：↑ ← ↓ →
- 选择：Insert
- 开始：Enter
- B：1 / Numpad1
- A：2 / Numpad2
