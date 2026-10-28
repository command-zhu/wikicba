const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../electron/store.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wikicba-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "project");
  fs.mkdirSync(dir);
  const s = new Store(path.join(root, "data"));
  const p = s.project("Demo", [dir]);
  return { root, dir, s, p };
}
test("move, collision-safe copy, persistence and undo", (t) => {
  const { root, dir, s } = fixture(t);
  const source = path.join(root, "a.txt");
  fs.writeFileSync(source, "hello");
  const op = s.transfer(source, dir);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(op.dest, "utf8"), "hello");
  s.undo(op.id);
  assert.equal(fs.readFileSync(source, "utf8"), "hello");
  assert.equal(fs.existsSync(op.dest), false);
  const c = s.transfer(source, dir, "copy");
  const c2 = s.transfer(source, dir, "copy");
  assert.notEqual(c.dest, c2.dest);
  assert.equal(new Store(s.root).state.operations.length, 3);
});
test("priority, conflicts and fallback", (t) => {
  const { root, dir, s, p } = fixture(t);
  const second = path.join(root, "meetings");
  fs.mkdirSync(second);
  p.dirs.push(second);
  s.state.rules = [
    { kind: "extension", pattern: ".pptx", priority: 1, target: dir },
    { kind: "keyword", pattern: "周会", priority: 2, target: second },
  ];
  assert.equal(s.plan("周会.pptx", p.id), second);
  assert.equal(s.plan("other.pdf"), s.inbox);
  s.state.rules.push({
    kind: "keyword",
    pattern: "周会",
    priority: 2,
    target: dir,
  });
  assert.throws(() => s.plan("周会.pptx", p.id), /冲突/);
  assert.equal(s.plan("周会.pptx", p.id, dir), dir);
});
test("reject overlapping bindings and modified undo", (t) => {
  const { root, dir, s } = fixture(t);
  assert.throws(() => s.project("Again", [dir]), /重叠/);
  const source = path.join(root, "a.txt");
  fs.writeFileSync(source, "a");
  const op = s.transfer(source, dir);
  fs.writeFileSync(op.dest, "changed");
  assert.throws(() => s.undo(op.id), /修改/);
  assert.throws(() => s.transfer(op.dest, root), /授权/);
});
test("tasks validate, persist and follow file moves and undo", (t) => {
  const { root, dir, s, p } = fixture(t);
  const source = path.join(root, "note.txt");
  fs.writeFileSync(source, "note");
  s.task({ title: "Review", q: 1, projectId: p.id, files: [source] });
  const task = s.state.tasks[0];
  s.task({ id: task.id, q: 2, done: true });
  const moved = s.transfer(source, dir);
  assert.equal(task.files[0], moved.dest);
  s.undo(moved.id);
  assert.equal(task.files[0], source);
  const restored = new Store(s.root).state.tasks[0];
  assert.equal(restored.q, 2);
  assert.equal(restored.done, true);
  assert.throws(() => s.task({ title: "bad", q: 4 }), /象限/);
  assert.throws(() => s.task({ title: "bad", projectId: "missing" }), /项目/);
  assert.throws(() => s.task({ id: "missing", title: "bad" }), /不存在/);
});
test("undo refuses occupied original without changing either file", (t) => {
  const { root, dir, s } = fixture(t);
  const source = path.join(root, "note.txt");
  fs.writeFileSync(source, "original");
  const moved = s.transfer(source, dir);
  fs.writeFileSync(source, "new");
  assert.throws(() => s.undo(moved.id));
  assert.equal(fs.readFileSync(source, "utf8"), "new");
  assert.equal(fs.readFileSync(moved.dest, "utf8"), "original");
  assert.equal(moved.status, "done");
});
test("directory imports and invalid destinations leave sources untouched", (t) => {
  const { root, dir, s } = fixture(t);
  assert.throws(() => s.transfer(root, dir), /文件夹/);
  const source = path.join(root, "note.txt");
  fs.writeFileSync(source, "safe");
  assert.throws(() => s.plan(source, undefined, "not-bound"), /未绑定/);
  assert.equal(fs.readFileSync(source, "utf8"), "safe");
  assert.throws(() => s.project("duplicates", [dir, dir]));
});
