extends RefCounted

# =============================================================================
# SYNCHRONOUS CHESS ENGINE — optimised for web (minimal alloc in inner search)
# =============================================================================

const MAX_DEPTH: int = 3

const PIECE_VALUES = {
	"p": 1.0, "r": 4.79, "n": 2.80, "b": 3.20, "q": 9.29, "k": 4.0
}

# Incremental material score kept in sync with make/unmake
var _mat: float = 0.0  # whitePoints - blackPoints

# Undo stack for string data (from_piece, to_piece, ep_captured)
var _undo_strs: Array = []


# =============================================================================
# PUBLIC API — called from Main.gd
# =============================================================================

func getBestMove(board: Array, awaknessMap: Array, epTarget: Vector2i = Vector2i(-1, -1)) -> Move:
	_mat = _computeMaterial(board)

	var bestMove: Move = null
	var bestVal: float = -INF

	var moves: Array[Move] = _generateMovesRoot(board, awaknessMap, true, 0, epTarget)

	if moves.is_empty():
		return null

	# Sort captures first for better pruning
	moves.sort_custom(_cmpCaptureFirst.bind(board))

	for mv in moves:
		var undo = _makeMoveFast(mv.from.x, mv.from.y, mv.to.x, mv.to.y, mv.isEnPassant, board, awaknessMap)
		var nextEp = _epAfterRaw(mv.from.x, mv.from.y, mv.to.x, mv.to.y, mv.isTwoSquarePawn)
		var val = _alphaBeta(board, awaknessMap, 1, MAX_DEPTH, -INF, INF, false, nextEp)
		_unmakeMoveFast(undo, board, awaknessMap)

		mv.eval = val
		if val > bestVal:
			bestVal = val
			bestMove = mv
		elif val == bestVal and randi() % 3 == 0:
			bestMove = mv

	return bestMove


func _cmpCaptureFirst(a: Move, b: Move, board: Array) -> bool:
	var aCap = board[a.to.x][a.to.y] != "" or a.isEnPassant
	var bCap = board[b.to.x][b.to.y] != "" or b.isEnPassant
	if aCap and not bCap:
		return true
	if not aCap and bCap:
		return false
	if aCap and bCap:
		return getPieceValue(board[a.to.x][a.to.y]) > getPieceValue(board[b.to.x][b.to.y])
	return false


# =============================================================================
# ALPHA-BETA — inner search uses raw PackedInt32Array (zero Move allocations)
# Raw format: [fx, fy, tx, ty, flags, ...] in groups of 5
# flags: bit0 = en-passant, bit1 = two-square-pawn
# =============================================================================

func _alphaBeta(board: Array, awaknessMap: Array, depth: int, maxD: int, alpha: float, beta: float, isEngine: bool, epTarget: Vector2i) -> float:
	if depth >= maxD:
		return _mat  # Incremental — no board scan needed

	var raw = _genMovesRaw(board, awaknessMap, isEngine, depth, epTarget)
	var count: int = raw.size() / 5

	if count == 0:
		return -100.0 if isEngine else 100.0

	_orderMovesRaw(raw, count, board)

	if isEngine:
		var maxEval: float = -INF
		for idx in range(count):
			var b = idx * 5
			var fx = raw[b]; var fy = raw[b+1]; var tx = raw[b+2]; var ty = raw[b+3]; var fl = raw[b+4]
			var isEP = (fl & 1) != 0
			var is2sq = (fl & 2) != 0
			var undo = _makeMoveFast(fx, fy, tx, ty, isEP, board, awaknessMap)
			var nextEp = _epAfterRaw(fx, fy, tx, ty, is2sq)
			var val = _alphaBeta(board, awaknessMap, depth + 1, maxD, alpha, beta, false, nextEp)
			_unmakeMoveFast(undo, board, awaknessMap)
			if val > maxEval:
				maxEval = val
			if val > alpha:
				alpha = val
			if beta <= alpha:
				break
		return maxEval
	else:
		var minEval: float = INF
		for idx in range(count):
			var b = idx * 5
			var fx = raw[b]; var fy = raw[b+1]; var tx = raw[b+2]; var ty = raw[b+3]; var fl = raw[b+4]
			var isEP = (fl & 1) != 0
			var is2sq = (fl & 2) != 0
			var undo = _makeMoveFast(fx, fy, tx, ty, isEP, board, awaknessMap)
			var nextEp = _epAfterRaw(fx, fy, tx, ty, is2sq)
			var val = _alphaBeta(board, awaknessMap, depth + 1, maxD, alpha, beta, true, nextEp)
			_unmakeMoveFast(undo, board, awaknessMap)
			if val < minEval:
				minEval = val
			if val < beta:
				beta = val
			if beta <= alpha:
				break
		return minEval


# =============================================================================
# FAST MAKE / UNMAKE — no Dictionary, incremental material
# =============================================================================

func _makeMoveFast(fx: int, fy: int, tx: int, ty: int, isEP: bool, board: Array, awk: Array) -> PackedInt32Array:
	var from_piece: String = board[fx][fy]
	var to_piece: String = board[tx][ty]
	var fa: int = awk[fx][fy]
	var ta: int = awk[tx][ty]
	var ep_cap: String = ""
	var epx: int = -1
	var epy: int = -1

	# Adjust incremental material for capture
	if to_piece != "":
		var capVal = getPieceValue(to_piece)
		if Global.isBlack(to_piece):
			_mat += capVal
		else:
			_mat -= capVal

	if isEP:
		epx = tx; epy = fy
		ep_cap = board[tx][fy]
		if ep_cap != "":
			var epVal = getPieceValue(ep_cap)
			if Global.isBlack(ep_cap):
				_mat += epVal
			else:
				_mat -= epVal
		board[tx][fy] = ""

	# Promotion
	var placed: String
	if from_piece.to_upper() == "P" and (ty == 0 or ty == 7):
		placed = "Q" if Global.isBlack(from_piece) else "q"
		var pawnVal = getPieceValue(from_piece)
		var queenVal = getPieceValue(placed)
		if Global.isBlack(from_piece):
			_mat += pawnVal
			_mat -= queenVal
		else:
			_mat -= pawnVal
			_mat += queenVal
	else:
		placed = from_piece

	board[tx][ty] = placed
	board[fx][fy] = ""
	awk[tx][ty] = fa
	awk[fx][fy] = 0

	_undo_strs.push_back([from_piece, to_piece, ep_cap])
	return PackedInt32Array([fx, fy, tx, ty, fa, ta, epx, epy])


func _unmakeMoveFast(undo: PackedInt32Array, board: Array, awk: Array) -> void:
	var strs: Array = _undo_strs.pop_back()
	var from_piece: String = strs[0]
	var to_piece: String = strs[1]
	var ep_cap: String = strs[2]

	var fx = undo[0]; var fy = undo[1]; var tx = undo[2]; var ty = undo[3]
	var fa = undo[4]; var ta = undo[5]; var epx = undo[6]; var epy = undo[7]

	# Undo promotion material
	if from_piece.to_upper() == "P" and (ty == 0 or ty == 7):
		var current_placed: String = board[tx][ty]
		var pawnVal = getPieceValue(from_piece)
		var queenVal = getPieceValue(current_placed)
		if Global.isBlack(from_piece):
			_mat -= pawnVal
			_mat += queenVal
		else:
			_mat += pawnVal
			_mat -= queenVal

	board[fx][fy] = from_piece
	board[tx][ty] = to_piece
	awk[fx][fy] = fa
	awk[tx][ty] = ta

	# Undo capture material
	if to_piece != "":
		var capVal = getPieceValue(to_piece)
		if Global.isBlack(to_piece):
			_mat -= capVal
		else:
			_mat += capVal

	if epx != -1:
		board[epx][epy] = ep_cap
		if ep_cap != "":
			var epVal = getPieceValue(ep_cap)
			if Global.isBlack(ep_cap):
				_mat -= epVal
			else:
				_mat += epVal


func _epAfterRaw(fx: int, fy: int, tx: int, ty: int, is2sq: bool) -> Vector2i:
	if is2sq:
		return Vector2i(fx, (fy + ty) / 2)
	return Vector2i(-1, -1)


# =============================================================================
# MATERIAL HELPERS
# =============================================================================

func _computeMaterial(board: Array) -> float:
	var w: float = 0.0
	var b: float = 0.0
	for i in range(8):
		for j in range(8):
			var p = board[i][j]
			if p != "":
				var v = getPieceValue(p)
				if Global.isBlack(p):
					b += v
				else:
					w += v
	return w - b


# =============================================================================
# RAW MOVE GENERATION (inner search — no Move objects)
# Returns PackedInt32Array: [fx, fy, tx, ty, flags, ...] in groups of 5
# =============================================================================

func _genMovesRaw(board: Array, awk: Array, isEngine: bool, depth: int, epTarget: Vector2i) -> PackedInt32Array:
	var raw = PackedInt32Array()
	for i in range(8):
		for j in range(8):
			var p = board[i][j]
			if p != "":
				var pIsWhite = Global.isWhite(p)
				if isEngine == pIsWhite and awk[i][j] <= depth:
					var targets = getMoves(Vector2i(i, j), board, epTarget)
					var isPawn = (p.to_lower() == "p")
					for t in targets:
						var fl: int = 0
						if isPawn:
							if int(t.x) != i and board[int(t.x)][int(t.y)] == "":
								fl |= 1  # en passant
							if abs(int(t.y) - j) == 2:
								fl |= 2  # two-square
						raw.append(i)
						raw.append(j)
						raw.append(int(t.x))
						raw.append(int(t.y))
						raw.append(fl)
	return raw


# In-place move ordering: swap captures to the front
func _orderMovesRaw(raw: PackedInt32Array, count: int, board: Array) -> void:
	var front: int = 0
	for idx in range(count):
		var b = idx * 5
		var tx = raw[b + 2]; var ty = raw[b + 3]; var fl = raw[b + 4]
		if board[tx][ty] != "" or (fl & 1) != 0:
			if idx != front:
				var fb = front * 5
				for k in range(5):
					var tmp = raw[fb + k]
					raw[fb + k] = raw[b + k]
					raw[b + k] = tmp
			front += 1


# Root-only: creates Move objects (needed by Main.gd)
func _generateMovesRoot(board: Array, awaknessMap: Array, isEngine: bool, depth: int, epTarget: Vector2i) -> Array[Move]:
	var moves: Array[Move] = []
	for i in range(8):
		for j in range(8):
			if board[i][j] != "":
				var piece = board[i][j]
				var pieceIsWhite = Global.isWhite(piece)
				if isEngine == pieceIsWhite and _isAwake(i, j, depth, awaknessMap):
					var targets = getMoves(Vector2i(i, j), board, epTarget)
					for t in targets:
						var mv = Move.new(Vector2i(i, j), Vector2i(t), depth)
						if piece.to_lower() == "p" and t.x != i and board[int(t.x)][int(t.y)] == "":
							mv.isEnPassant = true
						if piece.to_lower() == "p" and abs(t.y - j) == 2:
							mv.isTwoSquarePawn = true
						moves.append(mv)
	return moves


# Returns all legal destination squares for one side (used for game-over check)
func getAllMovesPlayer(board: Array, awaknessMap: Array, isBlackSide: bool) -> PackedVector2Array:
	var moves = PackedVector2Array()
	for i in range(8):
		for j in range(8):
			if board[i][j] != "" and Global.isBlack(board[i][j]) == isBlackSide and _isAwake(i, j, 0, awaknessMap):
				moves.append_array(getMoves(Vector2i(i, j), board, Global.enPassantTarget))
	return moves


# =============================================================================
# PIECE MOVE GENERATORS — also used by Piece.gd for drag highlighting
# =============================================================================

func getMoves(pos: Vector2i, board: Array, epTarget: Vector2i = Vector2i(-1, -1)) -> PackedVector2Array:
	var piece = board[pos.x][pos.y]
	match piece.to_lower():
		"p":
			return pawnMoves(pos, board, epTarget)
		"r":
			return rookMoves(pos, board)
		"n":
			return knightMoves(pos, board)
		"b":
			return bishopMoves(pos, board)
		"q":
			var out = rookMoves(pos, board)
			out.append_array(bishopMoves(pos, board))
			return out
	return kingMoves(pos, board)


func _simpleMoveCheck(oldPos: Vector2i, newPos: Vector2i, board: Array) -> bool:
	if newPos.x < 0 or newPos.x > 7 or newPos.y < 0 or newPos.y > 7:
		return false
	if board[newPos.x][newPos.y] == "":
		return true
	return Global.isBlack(board[oldPos.x][oldPos.y]) != Global.isBlack(board[newPos.x][newPos.y])


func rookMoves(pos: Vector2i, board: Array) -> PackedVector2Array:
	var out = PackedVector2Array()
	for dir in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]:
		for i in range(1, 8):
			var np = pos + dir * i
			if not _simpleMoveCheck(pos, np, board):
				break
			out.append(np)
			if board[np.x][np.y] != "":
				break
	return out


func bishopMoves(pos: Vector2i, board: Array) -> PackedVector2Array:
	var out = PackedVector2Array()
	for dir in [Vector2i(1,1), Vector2i(-1,1), Vector2i(1,-1), Vector2i(-1,-1)]:
		for i in range(1, 8):
			var np = pos + dir * i
			if not _simpleMoveCheck(pos, np, board):
				break
			out.append(np)
			if board[np.x][np.y] != "":
				break
	return out


func knightMoves(pos: Vector2i, board: Array) -> PackedVector2Array:
	var out = PackedVector2Array()
	for offset in [Vector2i(2,1), Vector2i(1,2), Vector2i(-2,1), Vector2i(-1,2), Vector2i(2,-1), Vector2i(1,-2), Vector2i(-2,-1), Vector2i(-1,-2)]:
		var np = pos + offset
		if _simpleMoveCheck(pos, np, board):
			out.append(np)
	return out


func kingMoves(pos: Vector2i, board: Array) -> PackedVector2Array:
	var out = PackedVector2Array()
	for offset in [Vector2i(1,1), Vector2i(1,0), Vector2i(1,-1), Vector2i(0,1), Vector2i(0,-1), Vector2i(-1,1), Vector2i(-1,0), Vector2i(-1,-1)]:
		var np = pos + offset
		if _simpleMoveCheck(pos, np, board):
			out.append(np)
	return out


func pawnMoves(pos: Vector2i, board: Array, epTarget: Vector2i = Vector2i(-1, -1)) -> PackedVector2Array:
	var out = PackedVector2Array()
	var isBlk = Global.isBlack(board[pos.x][pos.y])
	var dir = -1 if isBlk else 1  # black moves up (y-1), white moves down (y+1)

	var ny = pos.y + dir
	if ny < 0 or ny > 7:
		return out

	# Forward one
	if board[pos.x][ny] == "":
		out.append(Vector2i(pos.x, ny))
		# Forward two from starting rank
		var startRank = 6 if isBlk else 1  # black pawns start y=6, white y=1 (spawned at 6-7)
		# Also allow y=7 for black and y=0 for white since pieces spawn on edges
		var canDoublePush = (isBlk and (pos.y == 6 or pos.y == 7)) or (not isBlk and (pos.y == 0 or pos.y == 1))
		var ny2 = pos.y + dir * 2
		if canDoublePush and ny2 >= 0 and ny2 <= 7 and board[pos.x][ny2] == "":
			out.append(Vector2i(pos.x, ny2))

	# Diagonal captures
	if pos.x < 7 and board[pos.x + 1][ny] != "" and Global.isBlack(board[pos.x + 1][ny]) != isBlk:
		out.append(Vector2i(pos.x + 1, ny))
	if pos.x > 0 and board[pos.x - 1][ny] != "" and Global.isBlack(board[pos.x - 1][ny]) != isBlk:
		out.append(Vector2i(pos.x - 1, ny))

	# En passant captures
	if epTarget != Vector2i(-1, -1) and ny == epTarget.y:
		if pos.x + 1 == epTarget.x or pos.x - 1 == epTarget.x:
			# Must be an enemy pawn on the EP file at our rank
			var epPawnY = pos.y
			if board[epTarget.x][epPawnY] != "" and board[epTarget.x][epPawnY].to_lower() == "p" and Global.isBlack(board[epTarget.x][epPawnY]) != isBlk:
				out.append(epTarget)

	return out


func getPieceValue(piece: String) -> float:
	return PIECE_VALUES.get(piece.to_lower(), 4.0)


# =============================================================================
# UTILITY
# =============================================================================

func makeAwakenesMap() -> Array:
	var awakenesMap = []
	for i in range(8):
		awakenesMap.append([])
		for j in range(8):
			var node = Global.nodeMap[i][j]
			if node != null and "movesUntilFormed" in node:
				awakenesMap[i].append(node.movesUntilFormed)
			else:
				awakenesMap[i].append(0)
	return awakenesMap


func _isAwake(i: int, j: int, depth: int, awaknessMap: Array) -> bool:
	return awaknessMap[i][j] <= depth
