<p align="center">
  <img src="assets/readme/tradingnote-logo.jpg" alt="TradingNote 标志" width="112">
</p>

<h1 align="center">TradingNote</h1>

<p align="center"><strong>看清交易，积累经验，验证策略。</strong></p>
<p align="center">为个人投资者打造的 AI 交易记录与复盘助手。</p>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

---

## 🎯 项目介绍

每笔交易都会留下盈亏，但当时的判断很容易被遗忘。TradingNote 将交易、持仓、笔记和可用的市场信息放在一起，帮助你回看：**当时怎么想、后来发生了什么、哪些行为值得继续观察**。

产品围绕一条简单的路径展开：**记录 → 复盘 → 洞察 → 验证 → 学习**。你负责做决定，TradingNote 帮你把每次决定看得更清楚。

这个仓库是面向移动端的产品原型。下方截图使用示例数据；实时生成的 AI 内容、Feed 和策略回测需要本地 API 及相应的数据服务。

## ✨ 核心功能

| 模块 | 你可以做什么 |
| --- | --- |
| **Today** | 预览资产表现、查看交易日历、记录交易与笔记、回看全部交易笔记，并阅读 AI 每日总结。 |
| **Agent · 交易复盘** | 结合交易时间线与可用的市场背景，回看某笔交易。 |
| **Agent · 行为洞察** | 围绕自己的记录提问，了解交易风格、行为习惯及其依据。 |
| **Agent · 策略回测** | 对 A 股或美股标的进行历史模拟，支持 SMA、RSI、MACD、布林带及成交量策略，查看收益、回撤和已完成交易的胜率。 |
| **Tracking** | 查看持仓及盈亏，结合标的价格走势、交易时间线和个人笔记追踪投资过程，并借助 AI 回顾结果与决策。 |
| **Feed** | 阅读结合市场话题与投资书籍的短文，在学习中保持更平稳的观察视角。 |

## 📱 产品截图

### Today · 记录与每日复盘

在同一页面查看资产概览、交易日历、交易记录入口和 AI 每日总结；展开后的总结会结合市场变化与已记录的组合表现。进入 **All Trades** 页面，还能按时间回看交易及其笔记。

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/readme/01-overview.png" alt="Today 页面：资产概览、交易日历、每日总结及交易记录入口" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/03-daily-summary.png" alt="Today 页面中 AI 每日总结的详细内容" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/02-all-trades-notes.png" alt="All Trades 页面：按时间列出的交易记录及对应笔记" width="230"></td>
  </tr>
</table>

### Agent · 理解行为，检验想法

让 AI 结合交易背景复盘单笔交易、分析整体交易风格，再用历史数据初步检验策略想法。

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/readme/09-review-trades.png" alt="Agent 的 Review Trades 功能：交易结论、成交概览和市场背景" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/08-behavior-summary.png" alt="Agent 对交易风格和行为习惯的分析" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/06-backtest-result.png" alt="Agent 策略回测结果、表现指标与收益曲线" width="230"></td>
  </tr>
</table>

### Tracking · 追踪持仓与决策

先查看持仓概览，再进入标的详情，将价格走势、交易记录与个人笔记放在一起回看。AI Tracking 进一步梳理盈亏结果、决策过程和可供下次借鉴的经验。

<table>
  <tr>
    <td align="center" width="33%"><img src="assets/readme/10-tracking-portfolio.png" alt="Tracking 持仓概览：当前持仓及盈亏表现" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/11-tracking-detail.png" alt="标的详情：价格图表、交易时间线与笔记" width="230"></td>
    <td align="center" width="33%"><img src="assets/readme/12-tracking-ai.png" alt="AI Tracking：盈亏、决策过程与经验总结" width="230"></td>
  </tr>
</table>

### Feed · 持续学习，保持平常心

每日阅读为投资者提供知识补充，也帮助你在市场噪声中放慢节奏。点开文章可阅读完整内容，了解市场事件与投资书籍观点之间的联系。

<p align="center">
  <img src="assets/readme/13-feed.png" alt="Feed 页面：投资者教育与交易心理相关内容" width="260">
  <img src="assets/readme/14-feed-article.png" alt="Feed 文章详情页：结合市场事件讨论投资心理和风险管理" width="260">
</p>

## 🚀 快速开始

### 1. 启动前端

需要先安装 Node.js 和 npm。在终端中执行：

```sh
git clone https://github.com/Zia-Zeng/TradingNote.git
cd TradingNote
npm ci
npm run dev
```

打开 Vite 输出的本地地址，通常是 `http://127.0.0.1:5173/`。前端可以使用示例数据浏览。

### 2. 启动 API，体验联网功能

在**另一个终端**进入 `backend/`，创建 Python 虚拟环境、安装依赖并复制配置模板。

<details>
<summary>Windows PowerShell</summary>

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# 如需 AI 生成功能，在 .env 中设置 DEEPSEEK_API_KEY。
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

</details>

<details>
<summary>macOS / Linux</summary>

```sh
cd backend
python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# 如需 AI 生成功能，在 .env 中设置 DEEPSEEK_API_KEY。
./.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

</details>

请在执行最后一行命令前编辑 `backend/.env`。同一模板还列出了可选的行情、搜索和回测配置。密钥应保存在后端配置中，不要写进前端变量或提交到仓库。

API 文档位于 `http://127.0.0.1:8000/docs`。前端默认连接这个本地 API；如需连接其他地址，在前端 `.env` 中设置 `VITE_API_BASE_URL`。部分回测还需要额外的行情访问能力或 SuperMind 运行器，详情见[开发文档](DEVELOPMENT.md)。

## 🗂️ 文件导航

```text
.
├── src/                  React 页面、组件和前端工具
│   ├── pages/            Today、Agent、Tracking、Feed 等页面
│   ├── components/       可复用的界面组件
│   └── lib/              API、数据导入和笔记相关工具
├── backend/
│   ├── app/              FastAPI 接口、存储、AI 和行情处理
│   ├── strategies/       回测策略实现
│   └── tests/            后端检查
├── public/               PWA 配置和应用图标
├── assets/readme/         README 使用的 Logo 与产品截图
├── DEVELOPMENT.md        API 与功能的详细开发说明
├── README.md             英文版
└── README.zh-CN.md       中文版
```

## 🛠️ 技术栈

前端使用 React、TypeScript、Vite 和 Tailwind CSS；后端使用 Python、FastAPI 和 SQLite。AI 与行情服务通过后端环境变量配置。

## 🤝 参与贡献

欢迎反馈问题并提交范围清晰的改进。报告问题时请附上复现步骤；提交代码前请移除密钥和个人交易数据。

> TradingNote 是用于记录、学习和历史模拟的产品原型。回测结果不能预测未来表现，应用也不会连接券商或执行交易。
