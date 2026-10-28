const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../electron/store.cjs");
const pause = () => new Promise((r) => setTimeout(r, 30));
async function setup(t, side = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikicba-ui-"));
  const dir = path.join(root, "project");
  fs.mkdirSync(dir);
  const store = new Store(path.join(root, "data"));
  const bundle = await build({
    entryPoints: [path.join(__dirname, "../src/main.jsx")],
    bundle: true,
    write: false,
    format: "iife",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/" + (side ? "?side=1" : ""),
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const calls = [];
  dom.window.desktop = {
    filePath: (f) => f.path,
    call: async (method, d = {}) => {
      calls.push({ method, d });
      switch (method) {
        case "state":
          return structuredClone({ ...store.state, inbox: store.inbox });
        case "pick":
          return [dir];
        case "project":
          return store.project(d.name, d.dirs);
        case "task":
          return store.task(d);
        case "rule":
          store.state.rules.push(d);
          store.save();
          return true;
        case "files":
          return [];
        default:
          return true;
      }
    },
  };
  dom.window.eval(bundle.outputFiles[0].text);
  await pause();
  t.after(() => {
    dom.window.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const doc = dom.window.document;
  const button = (text) => {
    const b = [...doc.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
    assert.ok(b, `Missing button ${text}`);
    b.click();
  };
  async function answer(text) {
    await pause();
    const input = doc.querySelector("[role=dialog] input");
    assert.ok(input, "Application modal is visible");
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, text);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await pause();
    doc.querySelector("[role=dialog] form");
    doc
      .querySelector("form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await pause();
  }
  return { dom, doc, store, button, answer, calls, dir };
}
test("project creation, rule form, task editing and completion use application dialogs", async (t) => {
  const { dom, doc, store, button, answer, dir } = await setup(t);
  button("＋ 新建项目");
  await answer("Wiki");
  assert.equal(store.state.projects[0].name, "Wiki");
  assert.ok(doc.body.textContent.includes(dir));
  button("分流规则");
  await pause();
  button("＋ 添加规则");
  await answer(".pptx");
  await answer("1");
  await answer("10");
  assert.equal(store.state.rules[0].target, dir);
  button("四象限待办");
  await pause();
  button("＋");
  await answer("Review notes");
  assert.equal(store.state.tasks[0].title, "Review notes");
  const span = [...doc.querySelectorAll("article span")][0];
  span.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
  await answer("Review slides");
  assert.equal(store.state.tasks[0].title, "Review slides");
  doc.querySelector("article input").click();
  await pause();
  assert.equal(store.state.tasks[0].done, true);
});
test("floating window exposes task navigation and pin/dock controls", async (t) => {
  const { dom, doc, calls, button } = await setup(t, true);
  const select = doc.querySelector('[aria-label="悬浮窗页面"]');
  select.value = "tasks";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await pause();
  assert.equal(doc.querySelectorAll(".quadrant").length, 4);
  button("靠右");
  await pause();
  assert.ok(calls.some((c) => c.method === "dock" && c.d.left === false));
  button("收起");
  await pause();
  assert.equal(doc.querySelectorAll(".quadrant").length, 0);
  button("展开");
  await pause();
  assert.equal(doc.querySelectorAll(".quadrant").length, 4);
});
