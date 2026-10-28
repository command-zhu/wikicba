import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const api = window.desktop;
const quadrants = ["重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急"];
function App() {
  const [s, S] = useState({
      projects: [],
      rules: [],
      tasks: [],
      operations: [],
    }),
    [tab, T] = useState("projects"),
    [message, M] = useState(""),
    [copy, C] = useState(false),
    [filter, F] = useState(""),
    [files, B] = useState([]),
    [dir, D] = useState(""),
    [collapsed, K] = useState(false),
    [question, Q] = useState(null);
  async function ask(label, value = "") {
    return new Promise((resolve) => Q({ label, value, resolve }));
  }
  const side = new URLSearchParams(location.search).has("side");
  async function refresh() {
    if (api) {
      try {
        S(await api.call("state"));
      } catch (e) {
        M(e.message);
      }
    }
  }
  useEffect(() => {
    const errors = (e) => {
      e.preventDefault();
      M(e.reason?.message || "操作失败");
    };
    window.addEventListener("unhandledrejection", errors);
    refresh();
    const i = setInterval(refresh, 2000);
    return () => {
      clearInterval(i);
      window.removeEventListener("unhandledrejection", errors);
    };
  }, []);
  async function run(method, data) {
    try {
      const r = await api.call(method, data);
      await refresh();
      return r;
    } catch (e) {
      M(e.message);
      throw e;
    }
  }
  async function browse(d) {
    try {
      D(d);
      B(await run("files", { dir: d }));
    } catch {}
  }
  async function drop(e, projectId, q, explicit) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("task");
    if (taskId) {
      if (q !== undefined) await run("task", { id: taskId, q });
      return;
    }
    for (const f of Array.from(e.dataTransfer.files)) {
      try {
        const source = api.filePath(f);
        if (q !== undefined) {
          await run("task", {
            title: f.name,
            q,
            files: [source],
            projectId: filter,
          });
          M("已创建待办并关联原文件");
        } else {
          const target = await run("plan", {
            source,
            projectId,
            target: explicit,
          });
          await run("transfer", {
            source,
            projectId,
            target,
            mode: copy ? "copy" : "move",
          });
          M(`已${copy ? "复制" : "移动"}到 ${target}`);
        }
      } catch {}
    }
    if (dir) browse(dir);
  }
  async function newProject() {
    const name = await ask("项目名称");
    if (!name) return;
    const dirs = await run("pick");
    if (dirs.length) await run("project", { name, dirs });
  }
  async function newRule() {
    const options = s.projects.flatMap((p) => p.dirs);
    if (!options.length) {
      M("请先绑定项目目录");
      return;
    }
    const pattern = await ask(
      "匹配内容：扩展名以点开头，如 .pptx；或输入关键词，如 周会",
    );
    if (!pattern) return;
    const chosen = await ask(
      "目标目录编号：\n" + options.map((d, i) => `${i + 1}. ${d}`).join("\n"),
      "1",
    );
    if (!chosen) return;
    const target = options[Number(chosen) - 1];
    const priorityText = await ask("优先级（越大越优先）", "10");
    if (priorityText === null) return;
    const priority = Number(priorityText);
    await run("rule", {
      pattern,
      kind: pattern.startsWith(".") ? "extension" : "keyword",
      target,
      priority,
    });
  }
  async function task(q) {
    const title = await ask("写下待办");
    if (title) await run("task", { title, q, projectId: filter });
  }
  if (!api)
    return (
      <main>
        <h1>WikiCBA</h1>
        <p>请使用 npm start 启动桌面应用，以访问本地文件与待办。</p>
      </main>
    );
  return (
    <div className={side ? "app side" : "app"}>
      {question && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-label={question.label}
            onSubmit={(e) => {
              e.preventDefault();
              question.resolve(question.value);
              Q(null);
            }}
          >
            <label>
              {question.label}
              <input
                autoFocus
                value={question.value}
                onChange={(e) => Q({ ...question, value: e.target.value })}
              />
            </label>
            <div>
              <button
                type="button"
                onClick={() => {
                  question.resolve(null);
                  Q(null);
                }}
              >
                取消
              </button>
              <button type="submit">确定</button>
            </div>
          </form>
        </div>
      )}
      <aside>
        <div className="brand">
          W<span>WikiCBA</span>
        </div>
        <small>本地资料与行动工作台</small>
        <nav>
          {[
            ["projects", "项目与收集"],
            ["tasks", "四象限待办"],
            ["rules", "分流规则"],
            ["history", "操作记录"],
          ].map(([k, v]) => (
            <button className={tab === k ? "active" : ""} onClick={() => T(k)}>
              {v}
            </button>
          ))}
        </nav>
        <button onClick={() => run("side")}>打开桌面悬浮窗</button>
        <label>
          <input
            type="checkbox"
            onChange={(e) => run("startup", { value: e.target.checked })}
          />
          开机启动
        </label>
      </aside>
      <main>
        <header>
          <div>
            <small>YOUR PERSONAL WORKSPACE</small>
            <h1>
              {
                {
                  projects: "把资料放到对的地方",
                  tasks: "让重要的事先发生",
                  rules: "简单规则，即时分流",
                  history: "每次整理都有迹可循",
                }[tab]
              }
            </h1>
          </div>
          <span className="badge">
            {s.tasks.filter((t) => !t.done).length} 项待办
          </span>
        </header>
        {side && (
          <div className="toolbar">
            <select
              aria-label="悬浮窗页面"
              value={tab}
              onChange={(e) => T(e.target.value)}
            >
              <option value="projects">项目与收集</option>
              <option value="tasks">四象限待办</option>
              <option value="rules">分流规则</option>
              <option value="history">操作记录</option>
            </select>
            <button onClick={() => K(!collapsed)}>
              {collapsed ? "展开" : "收起"}
            </button>
            <button onClick={() => run("dock", { left: true })}>靠左</button>
            <button onClick={() => run("dock", { left: false })}>靠右</button>
            <label>
              <input
                type="checkbox"
                defaultChecked
                onChange={(e) => run("pin", { value: e.target.checked })}
              />
              置顶
            </label>
          </div>
        )}
        {message && (
          <div className="notice" onClick={() => M("")}>
            {message} ×
          </div>
        )}
        {!collapsed && (
          <>
            {tab === "projects" && (
              <>
                <div className="toolbar">
                  <p>拖入文件，按规则自动收纳到真实目录。</p>
                  <label>
                    <input
                      type="checkbox"
                      checked={copy}
                      onChange={(e) => C(e.target.checked)}
                    />
                    复制模式（默认移动）
                  </label>
                  <button onClick={newProject}>＋ 新建项目</button>
                </div>
                <section
                  className="inbox"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e)}
                >
                  <div>
                    <h2>收集入口 / 杂物区</h2>
                    <p>拖入文件 · 唯一命中规则直接归档 · 未匹配进入杂物区</p>
                  </div>
                  <button onClick={() => browse(s.inbox)}>查看杂物</button>
                </section>
                <div className="grid">
                  {s.projects.map((p) => (
                    <section
                      key={p.id}
                      className="project"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, p.id)}
                    >
                      <span className="folder">▰</span>
                      <h2>{p.name}</h2>
                      <p>{p.dirs.length} 个绑定目录 · 首项为默认收纳目录</p>
                      {p.dirs.map((d) => (
                        <button
                          key={d}
                          className="path"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.stopPropagation();
                            drop(e, p.id, undefined, d);
                          }}
                          onClick={() => browse(d)}
                        >
                          {d}
                        </button>
                      ))}
                    </section>
                  ))}
                  {!s.projects.length && (
                    <section className="empty">
                      <h2>从你的第一个项目开始</h2>
                      <p>绑定已有文件夹，保留原来的目录结构。</p>
                      <button onClick={newProject}>绑定项目目录</button>
                    </section>
                  )}
                </div>
                {dir && (
                  <section className="listing">
                    <h3>{dir}</h3>
                    {files.length ? (
                      files.map((f) => (
                        <div key={f.path} className="file">
                          <span>{f.name}</span>
                          <button
                            onClick={() => run("reveal", { path: f.path })}
                          >
                            定位
                          </button>
                          <button
                            onClick={async () => {
                              const index = await ask(
                                "归类目标编号：\n" +
                                  s.projects
                                    .flatMap((p) => p.dirs)
                                    .map((d, i) => `${i + 1}. ${d}`)
                                    .join("\n"),
                              );
                              if (!index) return;
                              const target = s.projects.flatMap((p) => p.dirs)[
                                Number(index) - 1
                              ];
                              if (!target) {
                                M("请选择有效目录编号");
                                return;
                              }
                              try {
                                await run("transfer", {
                                  source: f.path,
                                  target,
                                  mode: "move",
                                });
                                browse(dir);
                              } catch {}
                            }}
                          >
                            归类
                          </button>
                        </div>
                      ))
                    ) : (
                      <p>目录中暂无文件</p>
                    )}
                  </section>
                )}
              </>
            )}
            {tab === "tasks" && (
              <>
                <div className="toolbar">
                  <p>拖动卡片改变象限；拖入文件创建关联待办。</p>
                  <select value={filter} onChange={(e) => F(e.target.value)}>
                    <option value="">全部项目</option>
                    {s.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="quadrants">
                  {quadrants.map((name, q) => (
                    <section
                      key={q}
                      className={"quadrant q" + q}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, undefined, q)}
                    >
                      <h2>
                        {name}
                        <button onClick={() => task(q)}>＋</button>
                      </h2>
                      {s.tasks
                        .filter(
                          (t) =>
                            t.q === q && (!filter || t.projectId === filter),
                        )
                        .map((t) => (
                          <article
                            key={t.id}
                            draggable
                            onDragStart={(e) =>
                              e.dataTransfer.setData("task", t.id)
                            }
                            className={t.done ? "done" : ""}
                          >
                            <input
                              type="checkbox"
                              checked={t.done}
                              onChange={(e) =>
                                run("task", {
                                  id: t.id,
                                  done: e.target.checked,
                                })
                              }
                            />
                            <span
                              onDoubleClick={async () => {
                                const title = await ask("编辑待办", t.title);
                                if (title) run("task", { id: t.id, title });
                              }}
                            >
                              {t.title}
                            </span>
                            {t.files?.length > 0 && (
                              <small>{t.files.length} 个关联文件</small>
                            )}
                          </article>
                        ))}
                    </section>
                  ))}
                </div>
              </>
            )}
            {tab === "rules" && (
              <>
                <button onClick={newRule}>＋ 添加规则</button>
                <p>
                  关键词或扩展名匹配，优先级越大越先执行；同级多个目标会停止归档。
                </p>
                {s.rules.map((r) => (
                  <section key={r.id} className="file">
                    <b>{r.pattern}</b>
                    <span>
                      → {r.target} · 优先级 {r.priority}
                    </span>
                    <button onClick={() => run("deleteRule", { id: r.id })}>
                      删除
                    </button>
                  </section>
                ))}
              </>
            )}
            {tab === "history" &&
              s.operations
                .slice()
                .reverse()
                .map((o) => (
                  <section key={o.id} className="listing">
                    <b>
                      {o.mode === "move" ? "移动" : "复制"} · {o.status}
                    </b>
                    <p>
                      {o.source} → {o.dest}
                    </p>
                    <small>
                      {o.time} {o.error}
                    </small>
                    {o.status === "done" && (
                      <button onClick={() => run("undo", { id: o.id })}>
                        撤销
                      </button>
                    )}
                  </section>
                ))}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
