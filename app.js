import {
  parseSTL,
  parseOBJ,
  parsePLY,
  parseOFF,
  parseGLTF,
  parseGLB,
  stats,
  makeExample,
  cloneMesh,
  brushSmooth,
  exportOBJ,
  exportSTL,
  exportPLY,
} from "./mesh-core.js";
import { MeshViewer } from "./viewer.js";
const $ = (id) => document.getElementById(id);
const MAX_FILE_BYTES = 250 * 1024 * 1024,
  MAX_TRIANGLES = 4000000,
  MAX_VERTICES = MAX_TRIANGLES * 3,
  LARGE_MESH_TRIANGLES = 100000;
let mesh = null,
  source = null,
  meshDiagonal = 1,
  activeWorker = null,
  activeImportWorker = null,
  activeBrushWorker = null,
  history = [],
  future = [],
  brushOn = false,
  strokeBefore = null,
  strokeChanged = 0;
const viewer = new MeshViewer($("canvas"));
function fmt(n) {
  return new Intl.NumberFormat("ru-RU").format(n);
}
function updateStats() {
  if (!mesh) return;
  const s = stats(mesh),
    b = s.bounds;
  meshDiagonal = b.diagonal;
  $("vertices").textContent = fmt(s.vertices);
  $("faces").textContent = fmt(s.faces);
  $("dimensions").textContent =
    b.size.map((v) => v.toPrecision(3)).join(" × ") + " · усл. ед.";
  $("currentFaces").textContent = fmt(s.faces);
  updateTarget();
  $("meshDiagnostics").textContent = s.faces
    ? s.boundaryEdges === null
      ? "Границы не проверялись · крупная сетка"
      : s.boundaryEdges
        ? `Открытые рёбра: ${fmt(s.boundaryEdges)}`
        : "Открытые рёбра не обнаружены"
    : "Облако точек · граней нет";
}
function updateTarget() {
  if (!mesh) return;
  const n = mesh.indices.length / 3;
  if (!n) {
    $("currentFaces").textContent = "0";
    $("targetFaces").textContent = "нет поверхности";
    return;
  }
  const r = Number($("reducePercent").value);
  $("targetFaces").textContent =
    "≈ " + fmt(Math.max(4, Math.floor(n * (1 - r / 100))));
}
function setNotice(text, error = false) {
  const el = $("notice");
  el.textContent = text;
  el.classList.remove("hidden", "error");
  if (error) el.classList.add("error");
  clearTimeout(setNotice.timer);
  setNotice.timer = setTimeout(() => el.classList.add("hidden"), 7000);
}
function snapshotMesh(m) {
  const c = cloneMesh(m);
  if (m.normals) c.normals = new Float32Array(m.normals);
  return c;
}
function updateHistory() {
  $("undoBtn").disabled = !history.length;
  $("redoBtn").disabled = !future.length;
  const n = history.length,
    word =
      n % 10 === 1 && n % 100 !== 11
        ? "действие"
        : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)
          ? "действия"
          : "действий";
  $("historyLabel").textContent = n ? `${n} ${word}` : "История пуста";
}
function commit(before, label) {
  if (!before) return;
  history.push({ mesh: before, label });
  const limit = mesh && mesh.indices.length / 3 > LARGE_MESH_TRIANGLES ? 2 : 8;
  if (history.length > limit) history.shift();
  future = [];
  updateHistory();
  $("statusText").textContent = `Изменение применено: ${label}`;
}
function showMesh() {
  viewer.mesh = mesh;
  viewer.source = source;
  viewer.upload(mesh);
  viewer.requestRender();
  updateStats();
  const faces = mesh.indices.length / 3,
    hasFaces = faces > 0,
    large = faces > LARGE_MESH_TRIANGLES;
  $("saveBtn").disabled = false;
  $("exportFormat").disabled = false;
  $("exportFormat").querySelector("[value=stl]").disabled = !hasFaces;
  $("exportFormat").querySelector("[value=obj]").disabled = !hasFaces;
  $("exportFormat").querySelector("[value=ply]").disabled = false;
  if (!hasFaces) $("exportFormat").value = "ply";
  $("resetBtn").disabled = false;
  $("smoothBtn").disabled = !hasFaces;
  $("reduceBtn").disabled = !hasFaces;
  $("reduceBtn").title = "Упростить модель в фоновом потоке";
  $("brushToggle").disabled = !hasFaces;
  $("brushToggle").title = large
    ? "Кисть для крупной сетки работает по одному клику в фоне"
    : "Включить кисть";
  $("preserveBoundary").disabled = large;
  $("preserveBoundary").checked = !large;
  $("brushBoundary").disabled = large;
  $("displayMode").querySelector("[value=wire]").disabled = large;
  if (large && $("displayMode").value === "wire")
    $("displayMode").value = "solid";
  $("compareToggle").disabled = false;
  $("welcome").classList.add("hidden");
  $("viewStatus").textContent = !hasFaces
    ? "Загружено облако точек"
    : large
      ? "Крупная сетка загружена"
      : "Модель загружена";
  $("fileName").textContent = mesh.name;
  const ext = mesh.name.split(".").pop().toLowerCase();
  const labels = {
    stl: "STL · только геометрия",
    obj: "OBJ · UV/MTL не переносятся",
    ply: hasFaces
      ? "PLY · вершины и грани, без цвета"
      : "PLY · облако точек без граней",
    off: "OFF · геометрия, без цвета",
    gltf: "glTF 2.0 · геометрия, без материалов",
    glb: "GLB 2.0 · геометрия, без материалов",
  };
  $("fileFormat").textContent = labels[ext] || "3D-сетка";
  updateHistory();
}
function load(meshIn) {
  if (mesh) viewer.release(mesh);
  mesh = meshIn;
  source = cloneMesh(meshIn);
  if (meshIn.normals) source.normals = meshIn.normals;
  history = [];
  future = [];
  brushOn = false;
  strokeBefore = null;
  strokeChanged = 0;
  viewer.onBrush = null;
  viewer.onBrushRay = null;
  viewer.brushClickOnly = false;
  $("brushToggle").textContent = "Включить кисть";
  $("brushToggle").classList.remove("active");
  $("compareToggle").checked = false;
  viewer.compare = false;
  viewer.setMesh(mesh, source);
  showMesh();
  $("statusText").textContent = mesh.indices.length
    ? `Модель загружена · ${fmt(mesh.indices.length / 3)} треугольников`
    : "Облако точек загружено";
  setNotice(
    !mesh.indices.length
      ? "Облако точек загружено. Можно просматривать и экспортировать PLY; операции сетки недоступны без граней."
      : mesh.indices.length / 3 > LARGE_MESH_TRIANGLES
        ? "Крупная сетка загружена. Кисть обрабатывает отдельные клики в фоне; упрощение и сглаживание также выполняются в фоне. Защита открытых краёв для такой сетки недоступна."
        : "Модель загружена. Исходная геометрия сохранена для сравнения и отмены.",
  );
}
$("openBtn").onclick = $("welcomeOpen").onclick = () => $("fileInput").click();
function importLargeSTL(buffer, name) {
  return new Promise((resolve, reject) => {
    const w = new Worker("./mesh-import-worker.js", { type: "module" }),
      ids = [
        "openBtn",
        "saveBtn",
        "exportFormat",
        "smoothBtn",
        "reduceBtn",
        "brushToggle",
        "undoBtn",
        "redoBtn",
        "resetBtn",
        "fileInput",
      ],
      previous = new Map(ids.map((id) => [id, $(id).disabled]));
    activeImportWorker = w;
    $("progressLabel").textContent = "Загрузка крупного STL…";
    $("progressOverlay").classList.remove("hidden");
    for (const id of ids) $(id).disabled = true;
    $("statusText").textContent = "Импорт STL выполняется в фоновом потоке";
    const finish = () => {
      w.terminate();
      if (activeImportWorker === w) activeImportWorker = null;
      $("progressOverlay").classList.add("hidden");
      for (const [id, value] of previous) $(id).disabled = value;
    };
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === "status") {
        $("progressLabel").textContent = d.label;
        return;
      }
      finish();
      if (d.type === "error") {
        reject(new Error(d.message));
        return;
      }
      if (d.type === "result")
        resolve({
          positions: new Float32Array(d.positions),
          indices: new Uint32Array(d.indices),
          normals: new Float32Array(d.normals),
          name: d.name,
        });
    };
    w.onerror = () => {
      finish();
      reject(
        new Error(
          "Фоновый импорт STL завершился с ошибкой. Проверьте файл или попробуйте binary STL.",
        ),
      );
    };
    $("cancelOperationBtn").onclick = () => {
      if (activeImportWorker === w) {
        finish();
        $("statusText").textContent =
          "Загрузка отменена; текущий документ не изменён.";
        resolve(null);
      }
    };
    w.postMessage({ buffer, name }, [buffer]);
  });
}
function binarySTLHeaderCount(header, fileSize) {
  if (header.byteLength < 84) return null;
  const n = new DataView(header).getUint32(80, true);
  return n > 0 && 84 + n * 50 <= fileSize ? n : null;
}
$("fileInput").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    const f = files.find((file) =>
      ["stl", "obj", "ply", "off", "gltf", "glb"].includes(
        file.name.split(".").pop().toLowerCase(),
      ),
    );
    if (!f)
      throw Error(
        "Выберите главный файл модели: STL, OBJ, PLY, OFF, glTF или GLB.",
      );
    if (files.some((file) => file.size > MAX_FILE_BYTES))
      throw Error(
        "Файл или связанный файл больше лимита 250 МиБ. Для крупных сеток используйте binary STL.",
      );
    const ext = f.name.split(".").pop().toLowerCase();
    let count = null;
    if (ext === "stl")
      count = binarySTLHeaderCount(await f.slice(0, 84).arrayBuffer(), f.size);
    if (count && count > MAX_TRIANGLES)
      throw Error(
        "STL содержит больше 4 млн треугольников — превышен лимит браузерной версии.",
      );
    const ab = await f.arrayBuffer();
    let m;
    if (ext === "stl") {
      if ((count && count > 100000) || f.size > 16 * 1024 * 1024)
        m = await importLargeSTL(ab, f.name);
      else m = parseSTL(ab, f.name);
    } else if (ext === "obj")
      m = parseOBJ(new TextDecoder().decode(ab), f.name);
    else if (ext === "ply") m = parsePLY(ab, f.name);
    else if (ext === "off") m = parseOFF(new TextDecoder().decode(ab), f.name);
    else if (ext === "gltf")
      m = await parseGLTF(new TextDecoder().decode(ab), f.name, files);
    else if (ext === "glb") m = await parseGLB(ab, f.name, files);
    if (!m) return;
    if (m.indices.length / 3 > MAX_TRIANGLES)
      throw Error("Сетка превышает лимит 4 млн треугольников.");
    if (m.positions.length / 3 > MAX_VERTICES)
      throw Error("Сетка превышает лимит 12 млн вершин.");
    load(m);
  } catch (err) {
    setNotice(err.message || "Не удалось открыть модель.", true);
  } finally {
    e.target.value = "";
  }
});
$("exampleBtn").onclick = () => load(makeExample());
function runWorkerOperation(label, operation, params) {
  if (!mesh || activeWorker || activeBrushWorker) return;
  const before = snapshotMesh(mesh),
    old = mesh,
    started = performance.now(),
    w = new Worker("./mesh-worker.js", { type: "module" }),
    ids = [
      "openBtn",
      "fileInput",
      "saveBtn",
      "exportFormat",
      "smoothBtn",
      "reduceBtn",
      "brushToggle",
      "undoBtn",
      "redoBtn",
      "resetBtn",
    ],
    previous = new Map(ids.map((id) => [id, $(id).disabled]));
  let finished = false;
  activeWorker = w;
  $("progressLabel").textContent =
    label === "сглаживание"
      ? "Сглаживание копии модели…"
      : "Упрощение копии модели…";
  $("progressOverlay").classList.remove("hidden");
  for (const id of ids) $(id).disabled = true;
  $("statusText").textContent = `${label}: выполняется в фоновом потоке`;
  const finish = () => {
    if (finished) return;
    finished = true;
    w.terminate();
    if (activeWorker === w) activeWorker = null;
    $("progressOverlay").classList.add("hidden");
    for (const [id, value] of previous) $(id).disabled = value;
  };
  const restore = () => {
    viewer.release(old);
    mesh = before;
    viewer.mesh = mesh;
    viewer.source = source;
    viewer.upload(mesh);
    viewer.requestRender();
    updateStats();
  };
  w.onmessage = (e) => {
    const d = e.data;
    if (d.type === "status") {
      $("progressLabel").textContent = d.label;
      return;
    }
    if (d.type === "error") {
      finish();
      restore();
      setNotice(d.message, true);
      $("statusText").textContent =
        "Операция не выполнена; исходное состояние сохранено";
      return;
    }
    if (d.type === "result") {
      if (operation === "simplify" && d.unchanged) {
        viewer.release(old);
        mesh = before;
        finish();
        showMesh();
        $("statusText").textContent = "Упрощение ничего не изменило.";
        setNotice(
          `В диапазоне ${params.minAngle}–${params.maxAngle}° не найдено участков для сокращения. Увеличьте верхний угол или процент сокращения.`,
        );
        return;
      }
      mesh = {
        positions: new Float32Array(d.positions),
        indices: new Uint32Array(d.indices),
        normals: new Float32Array(d.normals),
        name: d.name,
      };
      viewer.release(old);
      finish();
      commit(before, label);
      showMesh();
      $("statusText").textContent =
        `${label}: завершено за ${((performance.now() - started) / 1000).toFixed(2)} с`;
      if (operation === "simplify") {
        const actual = mesh.indices.length / 3;
        setNotice(
          `Сетка упрощена: ${fmt(actual)} треугольников (цель около ${fmt(params.targetFaces)}), угол ${params.minAngle}–${params.maxAngle}°. Исходник не изменён.`,
        );
      }
    }
  };
  w.onerror = () => {
    finish();
    restore();
    setNotice(
      "Фоновая обработка завершилась с ошибкой. Исходная модель сохранена.",
      true,
    );
  };
  $("cancelOperationBtn").onclick = () => {
    if (activeWorker === w) {
      finish();
      restore();
      $("statusText").textContent = "Операция отменена; модель не изменилась.";
      setNotice("Операция отменена. Последнее корректное состояние сохранено.");
    }
  };
  try {
    const positions = mesh.positions,
      indices = mesh.indices;
    w.postMessage(
      {
        operation,
        params,
        name: mesh.name,
        positions: positions.buffer,
        indices: indices.buffer,
      },
      [positions.buffer, indices.buffer],
    );
  } catch (error) {
    finish();
    restore();
    setNotice(error.message || "Не удалось запустить фоновую обработку.", true);
  }
}
function runLargeBrush(ray) {
  if (!mesh || activeBrushWorker || activeWorker || activeImportWorker) return;
  const before = snapshotMesh(mesh),
    old = mesh,
    w = new Worker("./mesh-worker.js", { type: "module" }),
    ids = [
      "openBtn",
      "fileInput",
      "saveBtn",
      "exportFormat",
      "smoothBtn",
      "reduceBtn",
      "brushToggle",
      "undoBtn",
      "redoBtn",
      "resetBtn",
    ],
    previous = new Map(ids.map((id) => [id, $(id).disabled]));
  let finished = false;
  activeBrushWorker = w;
  $("progressLabel").textContent = "Кисть выбирает область в фоне…";
  $("progressOverlay").classList.remove("hidden");
  for (const id of ids) $(id).disabled = true;
  $("statusText").textContent = "Кисть: выполняется один клик в фоновом потоке";
  const finish = () => {
    if (finished) return;
    finished = true;
    w.terminate();
    if (activeBrushWorker === w) activeBrushWorker = null;
    $("progressOverlay").classList.add("hidden");
    for (const [id, value] of previous) $(id).disabled = value;
  };
  const restore = () => {
    viewer.release(old);
    mesh = before;
    viewer.mesh = mesh;
    viewer.source = source;
    viewer.upload(mesh);
    viewer.requestRender();
    updateStats();
  };
  w.onmessage = (e) => {
    const d = e.data;
    if (d.type === "status") {
      $("progressLabel").textContent = d.label;
      return;
    }
    if (d.type === "error") {
      finish();
      restore();
      setNotice(d.message, true);
      $("statusText").textContent =
        "Кисть не выполнена; исходное состояние восстановлено.";
      return;
    }
    if (d.type !== "brush-result") return;
    const positions = new Float32Array(d.positions),
      indices = new Uint32Array(d.indices);
    if (!d.changed) {
      old.positions = positions;
      old.indices = indices;
      finish();
      $("statusText").textContent = d.hit
        ? "В этой области нечего сглаживать."
        : "Клик не попал в поверхность модели.";
      return;
    }
    const next = {
      positions,
      indices,
      normals: new Float32Array(d.normals),
      name: old.name,
    };
    viewer.release(old);
    mesh = next;
    finish();
    commit(before, "мазок кистью");
    showMesh();
    $("statusText").textContent =
      `Мазок применён · изменено вершин: ${fmt(d.changed)}`;
  };
  w.onerror = () => {
    finish();
    restore();
    $("statusText").textContent =
      "Кисть не выполнена; исходное состояние восстановлено.";
    setNotice(
      "Фоновая кисть завершилась с ошибкой. Исходное состояние восстановлено.",
      true,
    );
  };
  $("cancelOperationBtn").onclick = () => {
    if (activeBrushWorker === w) {
      finish();
      restore();
      $("statusText").textContent = "Кисть отменена; модель не изменилась.";
      setNotice("Клик кистью отменён. Модель восстановлена.");
    }
  };
  try {
    const positions = mesh.positions,
      indices = mesh.indices;
    w.postMessage(
      {
        operation: "brush",
        name: mesh.name,
        ray,
        params: {
          radius: (meshDiagonal * Number($("brushRadius").value)) / 100,
          strength: Number($("brushStrength").value) / 100,
          preserveBoundary: false,
        },
        positions: positions.buffer,
        indices: indices.buffer,
      },
      [positions.buffer, indices.buffer],
    );
  } catch (error) {
    finish();
    restore();
    setNotice(error.message || "Не удалось запустить фоновую кисть.", true);
  }
}
$("smoothBtn").onclick = () =>
  runWorkerOperation("сглаживание", "smooth", {
    strength: Number($("smoothStrength").value) / 100,
    iterations: Math.max(1, Math.min(12, Number($("iterations").value) || 1)),
    preserveBoundary: $("preserveBoundary").checked,
  });
$("reduceBtn").onclick = () => {
  const target = Math.max(
    4,
    Math.floor(
      (mesh.indices.length / 3) * (1 - Number($("reducePercent").value) / 100),
    ),
  );
  runWorkerOperation("упрощение", "simplify", {
    targetFaces: target,
    ...readAngleRange(),
  });
};
$("resetBtn").onclick = () => {
  if (!source) return;
  const before = snapshotMesh(mesh),
    old = mesh;
  mesh = cloneMesh(source);
  if (source.normals) mesh.normals = source.normals;
  viewer.release(old);
  commit(before, "сброс к исходнику");
  showMesh();
  setNotice("Восстановлена исходная геометрия.");
};
$("undoBtn").onclick = () => {
  if (!history.length) return;
  future.push({ mesh: snapshotMesh(mesh) });
  const item = history.pop(),
    old = mesh;
  mesh = item.mesh;
  viewer.release(old);
  showMesh();
  updateHistory();
  $("statusText").textContent = `Отменено: ${item.label}`;
};
$("redoBtn").onclick = () => {
  if (!future.length) return;
  history.push({ mesh: snapshotMesh(mesh), label: "повтор" });
  const old = mesh;
  mesh = future.pop().mesh;
  viewer.release(old);
  showMesh();
  updateHistory();
  $("statusText").textContent = "Изменение повторено";
};
$("smoothStrength").oninput = (e) =>
  ($("strengthValue").textContent = e.target.value + "%");
$("brushRadius").oninput = (e) =>
  ($("radiusValue").textContent = e.target.value + "%");
$("brushStrength").oninput = (e) =>
  ($("brushStrengthValue").textContent = e.target.value + "%");
$("reducePercent").oninput = (e) => {
  $("reduceValue").textContent = e.target.value + "%";
  updateTarget();
};
function readAngleRange() {
  let minAngle = Math.max(0, Math.min(180, Number($("minAngle").value) || 0)),
    maxAngle = Math.max(0, Math.min(180, Number($("maxAngle").value) || 0));
  if (minAngle > maxAngle) [minAngle, maxAngle] = [maxAngle, minAngle];
  $("minAngle").value = String(minAngle);
  $("maxAngle").value = String(maxAngle);
  return { minAngle, maxAngle };
}
$("minAngle").onchange = $("maxAngle").onchange = readAngleRange;
document.querySelectorAll("[data-step]").forEach(
  (b) =>
    (b.onclick = () => {
      const x = $(b.dataset.target);
      x.value = Math.max(
        Number(x.min),
        Math.min(Number(x.max), Number(x.value) + Number(b.dataset.step)),
      );
    }),
);
document.querySelectorAll(".tab").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".tab")
        .forEach((x) => x.classList.toggle("active", x === b));
      for (const id of ["smooth", "brush", "reduce"])
        $(`panel-${id}`).classList.toggle("hidden", id !== b.dataset.tab);
      if (b.dataset.tab !== "brush") toggleBrush(false);
    }),
);
function toggleBrush(force) {
  brushOn = force ?? !brushOn;
  $("brushToggle").textContent = brushOn ? "Выключить кисть" : "Включить кисть";
  $("brushToggle").classList.toggle("active", brushOn);
  $("brushHint").classList.toggle("hidden", !brushOn);
  $("viewStatus").textContent = brushOn
    ? "Режим кисти активен"
    : "Модель загружена";
  $("canvas").style.cursor = brushOn ? "crosshair" : "grab";
  $("brushCursor").classList.toggle("hidden", !brushOn);
  const large = mesh && mesh.indices.length / 3 > LARGE_MESH_TRIANGLES;
  viewer.onBrushRay = brushOn && large ? runLargeBrush : null;
  viewer.brushClickOnly = Boolean(brushOn && large);
  viewer.onBrush =
    brushOn && !large
      ? (point, rayDirection) => {
          if (!strokeBefore) strokeBefore = snapshotMesh(mesh);
          const radius = (meshDiagonal * Number($("brushRadius").value)) / 100;
          const result = brushSmooth(mesh, point, {
            radius,
            strength: Number($("brushStrength").value) / 100,
            preserveBoundary: $("brushBoundary").checked,
            rayDirection,
          });
          if (result.changed) {
            const old = mesh;
            mesh = result.mesh;
            viewer.release(old);
            strokeChanged += result.changed;
            viewer.mesh = mesh;
            viewer.upload(mesh);
          }
        }
      : null;
  viewer.onBrushEnd = () => {
    if (strokeBefore) {
      if (strokeChanged) {
        commit(strokeBefore, "мазок кистью");
        updateStats();
      }
      strokeBefore = null;
      strokeChanged = 0;
    }
  };
}
$("brushToggle").onclick = () => toggleBrush();
viewer.onCursor = (e) => {
  if (!brushOn) return;
  const box = $("canvas").getBoundingClientRect(),
    cursor = $("brushCursor");
  cursor.style.left = e.clientX - box.left + "px";
  cursor.style.top = e.clientY - box.top + "px";
  const radius = (meshDiagonal * Number($("brushRadius").value)) / 100;
  const px = viewer.screenRadius(radius);
  cursor.style.width = cursor.style.height = px * 2 + "px";
};
$("compareToggle").onchange = (e) => {
  viewer.compare = e.target.checked;
  $("viewStatus").textContent = e.target.checked
    ? "Показан исходный скан"
    : "Показана обработанная модель";
  viewer.requestRender();
};
$("displayMode").onchange = (e) => {
  viewer.wire = e.target.value === "wire";
  viewer.requestRender();
};
$("gridToggle").onclick = () => {
  $("gridToggle").classList.toggle("active");
  viewer.grid = $("gridToggle").classList.contains("active");
  viewer.requestRender();
};
$("fitBtn").onclick = () => viewer.fit();
$("resetViewBtn").onclick = () => viewer.resetView();
function safeExportName(filename, ext) {
  const map = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  const stem =
    filename
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .split("")
      .map((c) => map[c] ?? c)
      .join("")
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "model";
  return `${stem}_processed.${ext}`;
}
$("saveBtn").onclick = () => {
  if (!mesh) return;
  const ext = $("exportFormat").value,
    exporters = {
      stl: () => exportSTL(mesh),
      obj: () => exportOBJ(mesh),
      ply: () => exportPLY(mesh),
    },
    blob = exporters[ext](),
    base = safeExportName(mesh.name, ext),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = base;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
  $("statusText").textContent = `Сохранена копия: ${base}`;
  setNotice(`Экспорт создан: ${base}. Исходный файл не перезаписан.`);
};
window.addEventListener("keydown", (e) => {
  if (activeWorker || activeImportWorker || activeBrushWorker) return;
  if (e.target.matches("input,select,textarea")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    $("fileInput").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    $("saveBtn").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $("undoBtn").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    $("redoBtn").click();
  }
  if (e.key.toLowerCase() === "b" && mesh) {
    document.querySelector('[data-tab="brush"]').click();
    toggleBrush();
  }
});
