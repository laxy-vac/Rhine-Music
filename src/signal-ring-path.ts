type SignalRingPaths = {
  full: Path2D;
  bridgeWide: Path2D;
  bridge: Path2D;
  length: number;
  bridgeWideStart: number;
  bridgeStart: number;
};

const TAU = Math.PI * 2;

export function createSignalRingPaths(
  points: readonly (readonly number[])[],
): SignalRingPaths {
  const count = points.length;
  if (count === 0) throw new RangeError("Signal ring requires at least one point");

  const first = points[0];
  const full = new Path2D();
  full.moveTo(first[0], first[1]);

  const distanceFromStart = new Float64Array(count);
  for (let i = 1; i < count; i++) {
    const previous = points[i - 1];
    const point = points[i];
    distanceFromStart[i] =
      distanceFromStart[i - 1] +
      Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    full.lineTo(point[0], point[1]);
  }

  full.lineTo(first[0], first[1]);
  const last = points[count - 1];
  const length =
    distanceFromStart[count - 1] +
    Math.hypot(first[0] - last[0], first[1] - last[1]);

  const rangePath = (startAngle: number, endAngle: number) => {
    const start = Math.floor((startAngle / TAU) * count);
    const end = Math.ceil((endAngle / TAU) * count);
    const path = new Path2D();
    path.moveTo(points[start][0], points[start][1]);
    for (let i = start + 1; i <= end; i++) {
      path.lineTo(points[i][0], points[i][1]);
    }
    return { path, startDistance: distanceFromStart[start] };
  };

  const wide = rangePath(Math.PI - 0.38, Math.PI + 0.38);
  const bridge = rangePath(Math.PI - 0.46, Math.PI + 0.46);

  return {
    full,
    bridgeWide: wide.path,
    bridge: bridge.path,
    length,
    bridgeWideStart: wide.startDistance,
    bridgeStart: bridge.startDistance,
  };
}
