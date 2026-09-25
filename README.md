![banner](https://p.ipic.vip/005vfl.png)

> 找个空教室，本来不应该这么难。

## 这东西是干嘛的？

众所周知，Scientia 提供的网络查询页面**难用得像屎**。想知道某栋楼现在有没有空教室，你得打开那个充满年代感的网页，选地点、选周数、选星期、选时间，然后进行一些毫无反应的让你怀疑你电脑卡死了的等待，最后面对一堆并不那么适合人类阅读的结果。如果你只是想找个地方坐下来写作业——**祝你好运**。

去年期末季我还没有搞到稳定工位的时候，我曾经连续将近两周一直在品尝这坨美味的屎，而今年为了给可怜的 CPU 找到一间可怜的教室来办活动，我不得不又双叒的品鉴它。

| <img src="https://p.ipic.vip/d714rb.png" alt="image-20260925203724343" style="zoom: 50%;" /> | <img src="https://p.ipic.vip/r5biud.png" alt="image-20260925205522617" style="zoom:50%;" /> |
| :------------------------------------------------------------: | :------------------------------------------------------------: |
| 显然这个看起来糟透了                                         | 这个就直观、现代很多了                                       |

所以我做了这个。**RoomRadar** 是一个给 UNNC 用的空教室 / 空间查询工具：选一下时间、教学楼或者人数，然后直接告诉你哪里有空。就这么简单。

## 能干什么

RoomRadar 目前支持：

* 按教学楼、容量、日期、Academic Week、星期、时间段筛选空教室
* 比较不同日期 / 周次的使用情况
* 查看 30 分钟粒度的 occupancy timeline
* 按教学楼或容量浏览所有房间
* 同时查询普通教室和 Meeting Room

查询过程中结果会一批一批回来，不需要等所有房间全部查完才显示。简单来说：**不用再和 Scientia 搏斗了**。

## 数据从哪来？

普通教室的数据来自 UNNC 的 Scientia Timetabling System。RoomRadar 并没有自己维护一份课表数据库——每次点击 **立即查询**，后端都会重新向 Scientia 请求最新的数据。也就是说：不缓存 timetable、不存 timetable、也不偷偷维护一份不知道什么时候过期的数据，你看到的基本就是当前源站返回的东西。

> [!WARNING]
>
> 你可能会注意到我们提供了连接 Meeting Room Booking 的功能，但是请放心我们不会保存任何人的任何登录信息，所有登录请求直接发送给单点认证登录的后端，我们不会也没办法存储任何人的登录密码。

## 大概是怎么跑的

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 · Vite · Tailwind CSS 4 · shadcn-vue |
| 后端 | Node.js · Express |
| 数据库 | 没有（目前根本不需要） |

浏览器不会直接去折腾 Scientia，而是通过本地 Express API 查询，主要两个接口：

```text
GET  /api/catalog                 # 房间列表 + Academic Week 配置
POST /api/availability/stream     # 真正的 availability 查询
```

## 为什么查询不是一次性返回？

Scientia 没有快到值得我们这么信任它。如果一个房间一个房间查，体验会非常痛苦，所以后端会把多个房间、多个 Week 尽量合并进同一个 upstream request，同时把 Scientia 请求的并发限制在 **2 个**。每完成一批，结果就直接 stream 回前端。

所以你会看到房间结果逐渐出现，而不是盯着满屏的 `Loading...` 开始怀疑网站是不是挂了。如果你修改筛选条件，之前还没结束的浏览器请求也会被取消；新的查询只有在你再次点击 **立即查询** 后才会开始。

## Meeting Room

显然学校除了 Scientia 里的普通教室，还有 `meetingroombooking.nottingham.edu.cn` 里的 Meeting Room。那当然也得一起查。

RoomRadar 可以通过学校 ADFS 登录 Meeting Room Booking 系统，然后读取 Meeting Room 列表和 timetable。登录流程全部由后端代理，用户名和密码只会被转发给学校的 SSO，**不会被 RoomRadar 保存**。如果 ADFS 要求额外验证码，会通过 `POST /api/mrb/login/mfa` 继续完成验证；登录成功后的 bearer token 会保存在浏览器的 `localStorage`。

为了避免和 Scientia 的 room ID 撞车，Meeting Room 的 ID 会统一加上 `mrb:` 前缀。两边的数据最后会被整理成同一种格式，所以对于前端来说，**教室就是教室**——至于它到底来自 Scientia 还是 Meeting Room Booking，查询的时候两边会并行跑。

## 一个很重要的事情

RoomRadar 对 Meeting Room Booking 系统目前只做**读取**：只读取房间和 timetable，不会调用 booking / cancellation / check-in 相关的接口。所以这个项目不是一个 Meeting Room 抢房机器人——至少现在不是。



***



## 本地开发

先装依赖，然后启动开发服务：

```bash
npm install
npm run dev
```

前端跑在 `http://localhost:5173`，API 跑在 `http://localhost:3001`。生产环境则是：

```bash
npm run build
npm start
```

## 部署

先复制环境变量文件并进行配置：

```bash
cp .env.example .env
```

```text
FRONTEND_PORT
BACKEND_PORT
BACKEND_HOST   # 只有在后端跑在另一台机器上的时候才需要
```

然后执行：

```bash
./deploy.sh
```

脚本会安装 dependencies、build 前端、设置 `VITE_API_BASE` 并启动 PM2，最终会有 `${PM2_APP_NAME}-api` 和 `${PM2_APP_NAME}-web` 两个进程。`.env` 已经被 gitignore，请不要手滑 commit。

## Scientia

如果你对这个项目为什么会诞生感到好奇，可以亲自体验一下这个[可爱的系统](http://timetablingunnc.nottingham.ac.uk:8017/room.htm)。

Room metadata 来自 `/js/filter.js`，具体 timetable 数据来自 Scientia 的 reporting endpoint（`/reporting/TextSpreadsheet;location;id;...`）。看完以后你大概就能理解这个项目存在的意义了。

## 最后

这个项目没有什么宏大的目标。最开始只是因为：

> **我只是想找个空教室，为什么要这么麻烦？**

如果它顺便也帮你少点几次 Scientia，那挺好，请礼貌给 star。

---

当然，如果这玩意 violate 了任何一个学校 IT 的相关 Policy，请通过任何方式联系我，让我们来看看如何让他满足相关 regulation.

Made with ❤️ by GentleLijie
