class_name Move

var from: Vector2i
var to: Vector2i
var eval: float = 0.0
var isEngineMove: bool
var isEnPassant: bool = false
var isTwoSquarePawn: bool = false

func _init(from: Vector2i, to: Vector2i, depth: int, isNullMove: bool = false) -> void:
	self.from = from
	self.to = to
	self.eval = 0.0
	isEngineMove = depth % 2 == 1 # even depth = player (black), odd = engine (white)
