# 总管静默主动跟进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if selected. Follow the tasks and verification gates below.

**Goal:** 项目群聊静默达到配置时长后，登记一次由总管自主判断的后台跟进；无需公开回复时不产生群消息。

**Architecture:** 在 Home 现有一秒调度周期内维护项目级静默游标，生成带平台来源的普通 Task／协调 Request，复用现有角色串行、设备容量和原生会话。程序只判断触发是否有效及是否重复，不判断业务是否需要协作。

**Tech Stack:** JavaScript ESM、Node.js 22、现有 SQLite records、原生浏览器模块；不新增依赖。

**Spec:** [design-supervisor-proactive-followup.md](design-supervisor-proactive-followup.md)。用户已要求按十分钟、直接调用总管的修订方案开发；本计划已按用户选择在当前会话实施并完成隔离验收，尚未发布或启用真实项目。

## Global Constraints

- 默认关闭，静默时长默认十分钟；本次不启用任何真实项目，不部署。
- 使用 Home 持久化时间和稳定消息顺序；启用时记录当前末尾，历史不补发。
- 仅新的正常完整消息重置计时；自身跟进及所属咨询／续接链不形成新触发。
- 忙碌、离线、容量不足、暂停仍走现有限制；不打断活动 Run。
- 不增加分类模型，不改变公共／自定义提示词、审核规则、报告结论或审批权限。
- 不修改现有用户定时任务，不实现或测试发送 IM 通知。
- 本地验证脚本放忽略目录 `.local/proactive-followup/`，不提交测试数据库、日志或凭据。

## Review Focus

1. 到期、消息到达、关闭开关及启动竞争：最后一次启动校验与创建 Run 必须在同一事务中。
2. 总管咨询后收到迟到回复：沿原请求关系继续，不因这条回复重新开启静默轮次。
3. 已有续接只覆盖部分事项：按明确的消息／请求关联去重，不能因为“总管有任务”吞掉其他事项。
4. CLI 返回“无需跟进”文字：后台结束必须真的不入群，包括流式气泡、兜底结束消息和重启恢复补发。
5. 启用、重启、修改时长以及重复投递：不扫描补发旧历史、不重复登记、不提前消费失败事件。

---

### Task 1: 项目设置和持久静默游标

**Files:** 创建 `src/proactive-followup.mjs`；修改 `src/store.mjs`、`src/home.mjs`、`src/locales/en.mjs`、`src/locales/zh.mjs`、`package.json`。

**Interfaces:**
- `ProactiveFollowup(db, rooms, {clock})`：共享 Home Store 和 Rooms，不创建后台进程。
- `get(projectId)` 返回 `{enabled, silenceMinutes, revision, anchorMessageId, dueAt, requestId, waitingReason}`，默认 `{enabled:false,silenceMinutes:10,revision:0}`。
- `save(projectId,{enabled,silenceMinutes,revision})` 校验布尔值和 1–10080 的整数分钟，乐观锁拒绝旧配置；时长变化从原有效消息重新计算，不重置消息发生时间。
- `GET/POST /api/projects/:id/proactive-followup` 复用现有认证；只有页面配置入口，不增加 Agent 自行启用入口。
- 项目配置／游标使用 `proactiveFollowups` records；历史触发证据放关联 Task／Request，不再建一套执行状态机。

- [x] 编写 `.local/proactive-followup/state.test.mjs`：默认关闭／十分钟；错误输入；保存版本冲突；启用前历史不触发；同 ID 重投和记录更新不计作新消息。
- [x] 运行 `node --test .local/proactive-followup/state.test.mjs`，确认新增行为尚不存在而失败。
- [x] 增量读取项目新消息，以 SQLite 持久顺序作游标；首次持久化时由 Home 记录时间。筛选正常完整人类／Agent 消息，排除平台回执和本功能因果链。
- [x] 实现设置保存和游标更新；删除项目时仅清理该项目对应跟进配置。
- [x] 重跑该组测试，覆盖同毫秒两条消息、旧日期导入、关闭再启用及两个项目独立计时。

### Task 2: 单次登记、派发前复核、协作去重

**Files:** `src/proactive-followup.mjs`、`src/home.mjs`、`src/rooms.mjs`、`src/store.mjs`、`src/role-calls.mjs`、`src/role-discussions.mjs`；仅必要时给 `src/scheduled-jobs.mjs` 的巡检请求增加明确事项引用。

**Interfaces:**
- `tick()` 在现有 `scheduleChat()` 中调用；处理新消息、到期登记和失效待处理项，返回是否改变状态。
- `prepareStart(taskId)` 在 `Store.startTask()` 的事务内再次核对开关、最新消息与关联请求，返回有效任务或撤销尚未启动的旧触发。
- `proactiveFollowup` 元数据包含稳定事件 ID、项目、锚点／消息范围、到期／触发时间、原请求关联；通过服务端维护的请求父子链传递，不让模型填写身份或跟进来源。
- 扩展现有 `Rooms.postSystemTask()` 支持本功能的平台来源；不能调用现有 `Rooms.post()` 冒充用户消息。
- 仍由 `Rooms.schedule()`、`RoleCalls` 和 `RoleSessions` 执行，普通用户任务和已有回复续接优先；总管配置在实际启动时读取。

- [x] 编写 `.local/proactive-followup/scheduling.test.mjs`，红灯覆盖 599999ms 不触发、600000ms 只登记一次、跨多轮 tick／Home 重启仍仅一个请求。
- [x] 实现稳定事件编号和登记事务。每项目最多一个未执行跟进；离线、总管未配置或忙碌保留待处理证据及原因，不提前标成完成。
- [x] 复用可证明覆盖相同消息／请求的有效续接或巡检；只覆盖部分事项时，将未覆盖事项保留给同一待执行跟进。禁止仅凭文本相似或总管忙碌判断重复。
- [x] 关闭开关、新消息到达，仅撤销尚未开始的本功能首轮任务／请求；不能取消已经开始的跟进咨询、已有等待或普通任务。
- [x] 测试到期／新消息／关闭／暂停竞争、离线恢复、容量满、同一总管不并发、最新模型配置；分别测试原 `call/wait` 和 `discuss` 回复链及不同事项不误吞。

### Task 3: 最小事件输入与真正安静结束

**Files:** `src/proactive-followup.mjs`、`src/run-context.mjs`、`src/rooms.mjs`、`src/role-calls.mjs`、`public/room.js`；必要的详情标签放 `public/app.js` 和语言包。

**Interfaces:**
- 本次平台事件使用用户方案中的短文本，以实际配置时长替换“十分钟”，明确平台来源并附消息／任务入口。
- 给本轮输入提供最近最多 12 条完整消息的短摘录（总字符预算 8000），必要原用户要求引用、关联运行／等待摘要；长内容注明全文入口。不改变普通回合上下文或公共提示词。
- **推荐的安静结束实现：本功能总管回合默认仅留后台 Run 记录，不自动把最终文字或流式片段发到群里；确需公开时使用现有 `wb note`，提问和审批沿原入口。** 当前事件附一句说明即可，不新增判断工具、静默关键词或业务报告结论。
- 跟进总管的咨询续接继承后台可见性；角色的普通任务不继承。明确公开的消息依然带因果关联，防止唤醒自己。
- 执行详情／实时现场可以查看输入、输出、触发范围及结束状态，安静不等于没有审计记录。

- [x] 编写 `.local/proactive-followup/visibility.test.mjs`：自然语言“无需跟进”、空输出、流式片段、结束兜底和重启重放均不产生本功能总管群气泡；真实失败仍在 Run 详情保留。
- [x] 给新来源添加 `platform` 上下文标识，不能误标为 `human`；截断摘录保留消息编号和读取入口，用户原文不改写。
- [x] 实现后台展示过滤及完成消息策略；`wb note` 明确发布时正常可见，既有用户确认／权限处理保持不变。
- [x] 覆盖“发起咨询→登记等待→收到回复→原会话续接→安静结束”，确保回复不产生第二个跟进；验证普通任务空输出、业务报告及既有错误展示不变。

### Task 4: 页面设置、真实验收和交付

**Files:** `public/index.html`、`public/project-settings.js`、`public/app.js`、`public/locales/zh.js`、`public/sw.js`、必要的局部 `public/styles.css`；更新 README、ARCHITECTURE 和本设计状态。

**Interfaces:** 项目设置仅两个可编辑项：开关、无新消息分钟数；状态展示复用 `get(projectId)` 和已存在的任务／执行详情入口。不添加模型选择器或额外运行模式。

- [x] 写 `.local/proactive-followup/browser.mjs`，先验证当前页面缺少控件；再实现保存、错误反馈、版本冲突和项目切换隔离。
- [x] 桌面及 390px 真实浏览器验证：默认关闭、默认十分钟、保存重开保持、排队原因、后台详情能打开；关闭不停止活动 Run。
- [x] 隔离 Home／Worker 使用可控时钟验证所有计时边界；真实 CLI 不修改时钟协议，至少跑一轮真实十分钟静默触发。
- [x] 真实总管分别验证“已交付安静结束”“角色正常运行不重复派工”“需协作并收到真实回复”“需要用户选择”；测试用户确认只登记，不擅自代用户答复，也不发送新增 IM 通知。
- [x] 确认实际输入无小模型调用、沿用总管原生会话和最新配置；如果原生会话恢复失败，如实记录执行异常，不伪造成功或自动反复重跑。
- [x] 运行 `npm ci`、`npm run check`、`npm test`、本地专项测试和 `git diff --check`；安排独立代码审查，修复影响本功能的发现。
- [x] 只提交已验证的相关改动；报告开发、测试、提交情况以及仍未部署／启用的边界。真实项目启用和发布另按用户指令执行。

## 实施方式建议

推荐当前会话直接实现四个任务，最后做一次独立审核。它们共享消息来源和请求关联契约，分成多个并行实现会增加接口往返；页面测试可在核心契约稳定后独立验证。

已采用当前会话直接实现、独立审核的方式。审核发现的“背景摘录误去重”和“切换绑定使用旧模型”均已通过复现测试修复；真实 Codex 场景的记录与边界见设计文档第 10 节。
