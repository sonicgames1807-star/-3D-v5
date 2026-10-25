import { parseSTL, vertexNormals } from "./mesh-core.js";
self.addEventListener("message", async ({ data }) => {
  try {
    self.postMessage({
      type: "status",
      label: "Читаем STL и индексируем вершины…",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const mesh = parseSTL(data.buffer, data.name);
    const normals = vertexNormals(mesh);
    self.postMessage(
      {
        type: "result",
        positions: mesh.positions.buffer,
        indices: mesh.indices.buffer,
        normals: normals.buffer,
        name: mesh.name,
      },
      [mesh.positions.buffer, mesh.indices.buffer, normals.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error?.message || "Не удалось прочитать STL.",
    });
  }
});
