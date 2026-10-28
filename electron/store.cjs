const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, "state.json");
    this.state = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : { projects: [], rules: [], tasks: [], operations: [] };
    this.inbox = path.join(root, "inbox");
    fs.mkdirSync(this.inbox, { recursive: true });
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }
  project(name, dirs) {
    if (!name.trim() || !dirs.length) throw Error("请输入项目名称并选择目录");
    const resolved = dirs.map((d) => fs.realpathSync(d));
    if (
      new Set(
        resolved.map((d) =>
          process.platform === "win32" ? d.toLowerCase() : d,
        ),
      ).size !== resolved.length
    )
      throw Error("目录重复");
    for (const d of resolved) {
      if (!fs.statSync(d).isDirectory()) throw Error("请选择文件夹");
      for (const other of [
        ...this.state.projects.flatMap((p) => p.dirs),
        ...resolved.filter((x) => x !== d),
        this.root,
      ]) {
        const a = d.toLowerCase(),
          b = other.toLowerCase();
        if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep))
          throw Error("目录已绑定或存在父子目录重叠");
      }
    }
    const p = { id: crypto.randomUUID(), name: name.trim(), dirs: resolved };
    this.state.projects.push(p);
    this.save();
    return p;
  }
  plan(source, projectId, explicit) {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (projectId && !project) throw Error("项目不存在");
    const allowed = project
      ? project.dirs
      : this.state.projects.flatMap((p) => p.dirs);
    if (explicit) {
      if (!allowed.includes(explicit)) throw Error("目标目录未绑定");
      return explicit;
    }
    const name = path.basename(source).toLowerCase();
    const hits = this.state.rules
      .filter(
        (r) =>
          (!project || project.dirs.includes(r.target)) &&
          allowed.includes(r.target) &&
          (r.kind === "extension"
            ? path.extname(name) === r.pattern.toLowerCase()
            : name.includes(r.pattern.toLowerCase())),
      )
      .sort((a, b) => b.priority - a.priority);
    if (hits.length) {
      const top = hits.filter((r) => r.priority === hits[0].priority);
      if (new Set(top.map((r) => r.target)).size > 1)
        throw Error("规则冲突，请选择具体目录");
      return hits[0].target;
    }
    return project ? project.dirs[0] : this.inbox;
  }
  transfer(source, target, mode = "move") {
    if (!["move", "copy"].includes(mode)) throw Error("操作无效");
    source = fs.realpathSync(source);
    if (
      ![this.inbox, ...this.state.projects.flatMap((p) => p.dirs)].includes(
        target,
      )
    )
      throw Error("目标未授权");
    if (!fs.statSync(source).isFile())
      throw Error("第一版请逐个导入文件；文件夹请使用绑定入口");
    let dest = path.join(target, path.basename(source));
    if (source === dest) throw Error("文件已在目标目录");
    const ext = path.extname(dest),
      base = dest.slice(0, dest.length - ext.length);
    let n = 1;
    while (fs.existsSync(dest)) dest = base + " (" + n++ + ")" + ext;
    const op = {
      id: crypto.randomUUID(),
      source,
      dest,
      mode,
      status: "pending",
      time: new Date().toISOString(),
    };
    this.state.operations.push(op);
    this.save();
    try {
      const before = fs.statSync(source);
      fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
      const hash = (f) =>
        crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
      op.hash = hash(dest);
      const after = fs.statSync(source);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        hash(source) !== op.hash
      )
        throw Error("源文件发生变化，已保留原件");
      if (mode === "move") {
        fs.unlinkSync(source);
        this.relink(source, dest);
      }
      op.status = "done";
    } catch (e) {
      op.status = "failed";
      op.error = e.message;
      this.save();
      throw e;
    }
    this.save();
    return op;
  }
  relink(source, dest) {
    for (const task of this.state.tasks)
      task.files = (task.files || []).map((f) => (f === source ? dest : f));
  }
  task(d) {
    const old = this.state.tasks.find((t) => t.id === d.id);
    if (d.id && !old) throw Error("待办不存在");
    const title = d.title ?? old?.title;
    if (typeof title !== "string" || !title.trim()) throw Error("请输入待办");
    const q = d.q ?? old?.q ?? 0;
    if (!Number.isInteger(q) || q < 0 || q > 3) throw Error("象限无效");
    const projectId = d.projectId ?? old?.projectId ?? "";
    if (projectId && !this.state.projects.some((p) => p.id === projectId))
      throw Error("项目不存在");
    if (d.done !== undefined && typeof d.done !== "boolean")
      throw Error("完成状态无效");
    if (
      d.files !== undefined &&
      (!Array.isArray(d.files) ||
        d.files.some((f) => typeof f !== "string" || !path.isAbsolute(f)))
    )
      throw Error("附件路径无效");
    if (old) {
      Object.assign(old, {
        title: title.trim(),
        q,
        projectId,
        done: d.done ?? old.done,
      });
    } else {
      this.state.tasks.push({
        id: crypto.randomUUID(),
        title: title.trim(),
        q,
        done: false,
        projectId,
        files: d.files || [],
      });
    }
    this.save();
  }
  undo(id) {
    const o = this.state.operations.find((o) => o.id === id);
    if (!o || o.status !== "done") throw Error("此操作无法撤销");
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(o.dest))
      .digest("hex");
    if (hash !== o.hash) throw Error("文件已修改，无法自动撤销");
    if (o.mode === "move") {
      fs.copyFileSync(o.dest, o.source, fs.constants.COPYFILE_EXCL);
    }
    fs.unlinkSync(o.dest);
    if (o.mode === "move") this.relink(o.dest, o.source);
    o.status = "undone";
    this.save();
  }
}
module.exports = { Store };
