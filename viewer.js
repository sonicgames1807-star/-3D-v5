import { bounds, vertexNormals } from "./mesh-core.js";
const V = `#version 300 es\nlayout(location=0) in vec3 aPos;layout(location=1) in vec3 aNormal;uniform mat4 uMVP;out vec3 vNormal;void main(){gl_Position=uMVP*vec4(aPos,1.);gl_PointSize=4.;vNormal=aNormal;}`;
const F = `#version 300 es\nprecision highp float;in vec3 vNormal;uniform vec3 uColor;out vec4 frag;void main(){vec3 n=normalize(vNormal);float d=max(dot(n,normalize(vec3(-.35,.8,.5))),0.);float light=.34+.66*d;frag=vec4(uColor*light,1.);}`;
function shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, V));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, F));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw Error(gl.getProgramInfoLog(p));
  return p;
}
const sub = (a, b) => a.map((v, i) => v - b[i]),
  dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm = (a) => {
    const l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  };
function lookAt(eye, center, up) {
  const z = norm(sub(eye, center)),
    x = norm(cross(up, z)),
    y = cross(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2),
    nf = 1 / (near - far);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
  return o;
}
export class MeshViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!this.gl)
      throw Error(
        "WebGL 2 не поддерживается этим браузером. Обновите браузер или включите аппаратное ускорение.",
      );
    const g = this.gl;
    this.prog = program(g);
    this.mvpLoc = g.getUniformLocation(this.prog, "uMVP");
    this.colorLoc = g.getUniformLocation(this.prog, "uColor");
    this.gridBuffer = g.createBuffer();
    this.gpuMeshes = new WeakMap();
    this.activeGpu = null;
    this.mesh = null;
    this.source = null;
    this.renderTask = null;
    this.wire = false;
    this.grid = true;
    this.compare = false;
    this.target = [0, 0, 0];
    this.distance = 3;
    this.az = 0.7;
    this.el = 0.35;
    this.fov = Math.PI / 4;
    this.drag = null;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bind();
    this.loop();
  }
  resize() {
    const d = Math.min(devicePixelRatio || 1, 2),
      r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(r.width * d));
    this.canvas.height = Math.max(1, Math.floor(r.height * d));
    if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.requestRender();
  }
  setMesh(mesh, source) {
    this.mesh = mesh;
    this.source = source;
    this.upload(mesh);
    if (mesh) this.fit(mesh);
  }
  release(mesh) {
    if (!mesh) return;
    if (this.renderTask?.mesh === mesh) this.requestRender();
    const b = this.gpuMeshes.get(mesh);
    if (b) {
      this.gl.deleteBuffer(b.vbo);
      this.gl.deleteBuffer(b.ibo);
      if (b.lineIbo) this.gl.deleteBuffer(b.lineIbo);
      this.gpuMeshes.delete(mesh);
      if (this.activeGpu === b) this.activeGpu = null;
    }
  }
  upload(mesh) {
    if (!mesh) return;
    const cached = this.gpuMeshes.get(mesh);
    if (cached) {
      this.activeGpu = cached;
      this.meshBounds = cached.bounds;
      return;
    }
    const g = this.gl,
      n =
        mesh.normals && mesh.normals.length === mesh.positions.length
          ? mesh.normals
          : vertexNormals(mesh),
      data = new Float32Array((mesh.positions.length / 3) * 6);
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      data.set(mesh.positions.subarray(i * 3, i * 3 + 3), i * 6);
      data.set(n.subarray(i * 3, i * 3 + 3), i * 6 + 3);
    }
    const vbo = g.createBuffer(),
      ibo = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, vbo);
    g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, mesh.indices, g.STATIC_DRAW);
    const value = {
      vbo,
      ibo,
      lineIbo: null,
      edgeCount: 0,
      edgeBuilt: false,
      faceCount: mesh.indices.length,
      bounds: bounds(mesh),
    };
    this.gpuMeshes.set(mesh, value);
    this.activeGpu = value;
    this.meshBounds = value.bounds;
    this.requestRender();
  }
  ensureEdges(mesh, b) {
    if (b.edgeBuilt) return true;
    if (b.faceCount / 3 > 100000) return false;
    const g = this.gl,
      edges = new Set(),
      list = [];
    for (let i = 0; i < mesh.indices.length; i += 3)
      for (const [a, c] of [
        [mesh.indices[i], mesh.indices[i + 1]],
        [mesh.indices[i + 1], mesh.indices[i + 2]],
        [mesh.indices[i + 2], mesh.indices[i]],
      ]) {
        const lo = Math.min(a, c),
          hi = Math.max(a, c),
          key = `${lo}:${hi}`;
        if (!edges.has(key)) {
          edges.add(key);
          list.push(lo, hi);
        }
      }
    b.lineIbo = g.createBuffer();
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b.lineIbo);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint32Array(list), g.STATIC_DRAW);
    b.edgeCount = list.length;
    b.edgeBuilt = true;
    return true;
  }
  fit(mesh = this.mesh) {
    if (!mesh) return;
    const b = bounds(mesh);
    this.target = b.center;
    this.distance = Math.max(b.diagonal * 1.7, 0.01);
    this.requestRender();
  }
  resetView() {
    this.az = 0.7;
    this.el = 0.35;
    if (this.mesh) this.fit(this.mesh);
  }
  camera() {
    const c = Math.cos(this.el),
      eye = [
        this.target[0] + this.distance * c * Math.sin(this.az),
        this.target[1] + this.distance * Math.sin(this.el),
        this.target[2] + this.distance * c * Math.cos(this.az),
      ],
      forward = norm(sub(this.target, eye)),
      right = norm(cross(forward, [0, 1, 0])),
      up = norm(cross(right, forward));
    return { eye, forward, right, up };
  }
  mvp() {
    const c = this.camera(),
      view = lookAt(c.eye, this.target, [0, 1, 0]),
      proj = perspective(
        this.fov,
        this.canvas.width / this.canvas.height,
        0.001,
        Math.max(10000, this.distance * 100),
      );
    return mul(proj, view);
  }
  draw(mesh, color, range = null) {
    const g = this.gl;
    if (!mesh) return;
    this.upload(mesh);
    const b = this.activeGpu;
    g.bindBuffer(g.ARRAY_BUFFER, b.vbo);
    g.vertexAttribPointer(0, 3, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(1, 3, g.FLOAT, false, 24, 12);
    g.enableVertexAttribArray(1);
    g.uniform3fv(this.colorLoc, color);
    if (b.faceCount === 0) {
      g.drawArrays(g.POINTS, 0, mesh.positions.length / 3);
    } else if (range) {
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b.ibo);
      g.drawElements(g.TRIANGLES, range.count, g.UNSIGNED_INT, range.start * 4);
    } else if (this.wire && this.ensureEdges(mesh, b)) {
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b.lineIbo);
      g.drawElements(g.LINES, b.edgeCount, g.UNSIGNED_INT, 0);
    } else {
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b.ibo);
      g.drawElements(g.TRIANGLES, b.faceCount, g.UNSIGNED_INT, 0);
    }
  }
  drawGrid() {
    if (!this.grid) return;
    const g = this.gl,
      b = this.mesh
        ? this.meshBounds || bounds(this.mesh)
        : { center: [0, 0, 0], diagonal: 2 },
      size = Math.max(b.diagonal, 1) * 1.4,
      y = b.center[1] - size * 0.3,
      step = size / 16,
      verts = [];
    for (let i = -8; i <= 8; i++) {
      const x = b.center[0] + i * step,
        z = b.center[2] + i * step;
      verts.push(
        x,
        y,
        b.center[2] - 8 * step,
        0,
        1,
        0,
        x,
        y,
        b.center[2] + 8 * step,
        0,
        1,
        0,
        b.center[0] - 8 * step,
        y,
        z,
        0,
        1,
        0,
        b.center[0] + 8 * step,
        y,
        z,
        0,
        1,
        0,
      );
    }
    g.bindBuffer(g.ARRAY_BUFFER, this.gridBuffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(verts), g.STATIC_DRAW);
    g.vertexAttribPointer(0, 3, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(1, 3, g.FLOAT, false, 24, 12);
    g.enableVertexAttribArray(1);
    g.uniform3fv(this.colorLoc, [0.22, 0.29, 0.37]);
    g.drawArrays(g.LINES, 0, verts.length / 6);
  }
  render() {
    const g = this.gl;
    if (!g) return;
    if (this.dirty) {
      this.renderTask = null;
      g.enable(g.DEPTH_TEST);
      g.clearColor(0.055, 0.075, 0.105, 1);
      g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      g.useProgram(this.prog);
      g.uniformMatrix4fv(this.mvpLoc, false, this.mvp());
      const mesh = this.compare && this.source ? this.source : this.mesh,
        color =
          this.compare && this.source ? [0.24, 0.62, 0.88] : [0.98, 0.65, 0.3];
      if (mesh) {
        this.upload(mesh);
        this.renderTask = {
          mesh,
          color,
          offset: 0,
          total: this.activeGpu.faceCount,
        };
      }
      this.dirty = false;
    }
    const task = this.renderTask;
    if (!task) {
      this.drawGrid();
      return;
    }
    const chunk = 90000;
    if (task.total > chunk) {
      const count = Math.min(chunk, task.total - task.offset);
      this.draw(task.mesh, task.color, { start: task.offset, count });
      task.offset += count;
      if (task.offset >= task.total) {
        this.renderTask = null;
        this.drawGrid();
      }
      return;
    }
    this.draw(task.mesh, task.color);
    this.drawGrid();
    this.renderTask = null;
    this.dirty = false;
  }
  requestRender() {
    this.dirty = true;
    this.renderTask = null;
  }
  loop() {
    if (this.dirty || this.renderTask) this.render();
    requestAnimationFrame(() => this.loop());
  }
  bind() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if ((this.onBrush || this.onBrushRay) && e.button === 0) {
        this.drag = { brush: true };
        c.setPointerCapture(e.pointerId);
        this.pick(e.clientX, e.clientY);
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, button: e.button };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (this.onCursor) this.onCursor(e);
      if (this.drag?.brush) {
        if (this.brushClickOnly) return;
        const now = performance.now();
        if (now - this.lastBrushPick > 24) {
          this.lastBrushPick = now;
          this.pick(e.clientX, e.clientY);
        }
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.button === 2 || this.drag.button === 1) {
        const cam = this.camera(),
          s = this.distance * 0.0018;
        this.target = this.target.map(
          (v, i) => v - cam.right[i] * dx * s + cam.up[i] * dy * s,
        );
        this.requestRender();
      } else {
        this.az += dx * 0.008;
        this.el = Math.max(-1.48, Math.min(1.48, this.el + dy * 0.008));
        this.requestRender();
      }
    });
    c.addEventListener("pointerup", () => {
      if (this.drag?.brush && this.onBrushEnd) this.onBrushEnd();
      this.drag = null;
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance *= Math.exp(e.deltaY * 0.001);
        this.distance = Math.max(0.0001, Math.min(1e6, this.distance));
        this.requestRender();
      },
      { passive: false },
    );
  }
  ray(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect(),
      x = ((clientX - r.left) / r.width) * 2 - 1,
      y = 1 - ((clientY - r.top) / r.height) * 2,
      cam = this.camera(),
      t = Math.tan(this.fov / 2),
      dir = norm(
        cam.forward.map(
          (v, i) =>
            v + cam.right[i] * x * t * (r.width / r.height) + cam.up[i] * y * t,
        ),
      );
    return { origin: cam.eye, dir };
  }
  pick(x, y) {
    if (!this.mesh || (!this.onBrush && !this.onBrushRay)) return;
    const { origin, dir } = this.ray(x, y);
    if (this.onBrushRay) {
      this.onBrushRay({ origin, direction: dir });
      return;
    }
    const p = this.mesh.positions,
      ix = this.mesh.indices;
    let best = Infinity,
      hit = null;
    for (let i = 0; i < ix.length; i += 3) {
      const ia = ix[i] * 3,
        ib = ix[i + 1] * 3,
        ic = ix[i + 2] * 3,
        a = [p[ia], p[ia + 1], p[ia + 2]],
        b = [p[ib], p[ib + 1], p[ib + 2]],
        c = [p[ic], p[ic + 1], p[ic + 2]],
        e1 = sub(b, a),
        e2 = sub(c, a),
        h = cross(dir, e2),
        det = dot(e1, h);
      if (Math.abs(det) < 1e-10) continue;
      const inv = 1 / det,
        s = sub(origin, a),
        u = inv * dot(s, h);
      if (u < 0 || u > 1) continue;
      const q = cross(s, e1),
        v = inv * dot(dir, q);
      if (v < 0 || u + v > 1) continue;
      const t = inv * dot(e2, q);
      if (t > 1e-5 && t < best) {
        best = t;
        hit = origin.map((v, k) => v + dir[k] * t);
      }
    }
    if (hit) this.onBrush(hit, dir);
  }
  screenRadius(world) {
    const h = this.canvas.clientHeight;
    return Math.max(
      5,
      Math.min(180, (world / (2 * this.distance * Math.tan(this.fov / 2))) * h),
    );
  }
}
