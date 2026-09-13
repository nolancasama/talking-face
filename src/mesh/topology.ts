export const MESH_OUTER_LIP_INDICES = [
  61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91,
] as const;

export const MESH_INNER_LIP_INDICES = [
  78, 80, 82, 13, 312, 310, 308, 318, 317, 14, 87, 88,
] as const;

export const MESH_BOUNDARY_INDICES = [
  205, 187, 214, 172, 136, 152, 434, 397, 365, 378, 411, 425,
] as const;

export const TOPOLOGY_VERSION = 1;

export interface MeshTopology {
  readonly version: number;
  readonly vertexCount: number;
  readonly landmarkIndices: readonly (number | null)[];
  readonly triangles: readonly (readonly [number, number, number])[];
}

const OUTER_LIP_VERTEX_IDS = vertexIds(0, MESH_OUTER_LIP_INDICES.length);
const INNER_LIP_VERTEX_IDS = vertexIds(
  OUTER_LIP_VERTEX_IDS.length,
  MESH_INNER_LIP_INDICES.length,
);
const BOUNDARY_VERTEX_IDS = vertexIds(
  OUTER_LIP_VERTEX_IDS.length + INNER_LIP_VERTEX_IDS.length,
  MESH_BOUNDARY_INDICES.length,
);
const CENTROID_VERTEX_ID = 36;

const triangles = [
  ...zigzag(INNER_LIP_VERTEX_IDS, OUTER_LIP_VERTEX_IDS),
  ...zigzag(OUTER_LIP_VERTEX_IDS, BOUNDARY_VERTEX_IDS),
  ...fan(CENTROID_VERTEX_ID, INNER_LIP_VERTEX_IDS),
].map((triangle) => Object.freeze(triangle));

export const DEFAULT_TOPOLOGY: MeshTopology = Object.freeze({
  version: TOPOLOGY_VERSION,
  vertexCount: 37,
  landmarkIndices: Object.freeze([
    ...MESH_OUTER_LIP_INDICES,
    ...MESH_INNER_LIP_INDICES,
    ...MESH_BOUNDARY_INDICES,
    null,
  ]),
  triangles: Object.freeze(triangles),
});

function vertexIds(start: number, count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function zigzag(
  inner: readonly number[],
  outer: readonly number[],
): Array<readonly [number, number, number]> {
  if (inner.length !== outer.length) {
    throw new Error('Mesh rings must contain the same number of vertices');
  }
  const result: Array<readonly [number, number, number]> = [];
  for (let index = 0; index < inner.length; index += 1) {
    const next = (index + 1) % inner.length;
    result.push(
      [inner[index]!, outer[index]!, outer[next]!],
      [inner[index]!, outer[next]!, inner[next]!],
    );
  }
  return result;
}

function fan(
  centre: number,
  ring: readonly number[],
): Array<readonly [number, number, number]> {
  return ring.map((vertex, index) => [
    centre,
    vertex,
    ring[(index + 1) % ring.length]!,
  ]);
}
