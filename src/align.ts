// 複数選択したオブジェクトの整列・均等割り付け(PowerPointの「配置」相当)。
// 矩形(外接矩形)だけを扱う純粋関数。座標は同一座標系ならどの単位でもよい。
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AlignMode = "left" | "right" | "distribute-h" | "distribute-v";

/** 均等割り付けに必要な最小オブジェクト数(両端を固定し、間を等間隔にする)。 */
export const MIN_DISTRIBUTE = 3;

/**
 * 各矩形の移動量 [dx, dy] を返す(入力と同じ順序)。
 * - left / right: 全体の最も左 / 右の端に揃える
 * - distribute-h / v: 中心位置の順に並べ、両端のオブジェクトは動かさず、間の空き(隙間)が等しくなるよう並べる
 *   (矩形が重なっている場合、隙間は負になりうる)
 */
export function computeAlign(rects: Rect[], mode: AlignMode): [number, number][] {
  const moves: [number, number][] = rects.map(() => [0, 0]);
  if (rects.length < 2) return moves;

  if (mode === "left") {
    const edge = Math.min(...rects.map((r) => r.left));
    rects.forEach((r, i) => (moves[i] = [edge - r.left, 0]));
  } else if (mode === "right") {
    const edge = Math.max(...rects.map((r) => r.left + r.width));
    rects.forEach((r, i) => (moves[i] = [edge - (r.left + r.width), 0]));
  } else {
    if (rects.length < MIN_DISTRIBUTE) return moves;
    const horizontal = mode === "distribute-h";
    const start = (r: Rect) => (horizontal ? r.left : r.top);
    const size = (r: Rect) => (horizontal ? r.width : r.height);
    // 並び順は中心位置で決める(矩形が重なっても、両端が一意に定まり動かないようにするため)。
    const center = (r: Rect) => start(r) + size(r) / 2;
    const order = rects.map((_, i) => i).sort((a, b) => center(rects[a]!) - center(rects[b]!));
    const first = rects[order[0]!]!;
    const last = rects[order[order.length - 1]!]!;
    const span = start(last) + size(last) - start(first);
    const total = order.reduce((sum, i) => sum + size(rects[i]!), 0);
    const gap = (span - total) / (rects.length - 1);
    let pos = start(first);
    for (const i of order) {
      const r = rects[i]!;
      const d = pos - start(r);
      moves[i] = horizontal ? [d, 0] : [0, d];
      pos += size(r) + gap;
    }
    // 両端は動かさない(浮動小数点の誤差で微小にずれるのを防ぐ)。
    moves[order[0]!] = [0, 0];
    moves[order[order.length - 1]!] = [0, 0];
  }
  return moves;
}
