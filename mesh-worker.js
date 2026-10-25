import {
  brushSmoothInPlace,
  pickRay,
  smooth,
  simplify,
  vertexNormals,
} from "./mesh-core.js";
self.addEventListener("message", async ({ data }) => {
  try {
    self.postMessage({
      type: "status",
      label:
        data.operation === "brush"
          ? "Выбор и сглаживание в фоне…"
          : "Вычисление на копии модели…",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = {
      positions: new Float32Array(data.positions),
      indices: new Uint32Array(data.indices),
      name: data.name,
    };
    let result;
    if (data.operation === "smooth") result = smooth(input, data.params);
    else if (data.operation === "simplify")
      result = simplify(input, data.params.targetFaces, data.params);
    else if (data.operation === "brush") {
      self.postMessage({
        type: "status",
        label: "Ищу поверхность под курсором…",
      });
      const hit = pickRay(input, data.ray.origin, data.ray.direction);
      if (!hit) {
        self.postMessage(
          {
            type: "brush-result",
            hit: false,
            changed: 0,
            positions: input.positions.buffer,
            indices: input.indices.buffer,
          },
          [input.positions.buffer, input.indices.buffer],
        );
        return;
      }
      self.postMessage({ type: "status", label: "Сглаживаю область кисти…" });
      const brushed = brushSmoothInPlace(input, hit, {
        ...data.params,
        rayDirection: data.ray.direction,
      });
      result = brushed.mesh;
      self.postMessage({ type: "status", label: "Обновляю нормали…" });
      const normals = vertexNormals(result);
      self.postMessage(
        {
          type: "brush-result",
          hit: true,
          changed: brushed.changed,
          positions: result.positions.buffer,
          indices: result.indices.buffer,
          normals: normals.buffer,
        },
        [result.positions.buffer, result.indices.buffer, normals.buffer],
      );
      return;
    } else throw Error("Неизвестная операция.");
    const normals = vertexNormals(result);
    self.postMessage(
      {
        type: "result",
        positions: result.positions.buffer,
        indices: result.indices.buffer,
        normals: normals.buffer,
        name: result.name,
        unchanged: data.operation === "simplify" && result.unchanged === true,
      },
      [result.positions.buffer, result.indices.buffer, normals.buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error?.message || "Операция не выполнена.",
    });
  }
});
