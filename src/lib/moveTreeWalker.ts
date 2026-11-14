/** Server-supplied UCI prefix tree. A leaf represents a complete legal turn.
 * Compatibility type extracted from dicechess-play; see UPSTREAM.md.
 */
export interface MoveTree {
	[uci: string]: MoveTree;
}
