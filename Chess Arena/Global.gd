extends Sprite2D


signal piece_moved(old_position, new_position, is_en_passant)
var can_move_pieces=true

var selectedBlack=true#add later

var animeTime=0.5#time to do animation
var addPlayerPieceNextFrame=null

var hitList=[]

var board=[]
var nodeMap=[]
var engine
var main
var bestMove

var notInitalBoardCreation=false
var boardEvaluation=0

# En passant: the square a pawn can capture to via en passant.
# Set after a 2-square pawn push, reset after each move pair.
var enPassantTarget: Vector2i = Vector2i(-1, -1)


func _ready() -> void:
	
	board=[
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""],
	["","","","","","","",""]]
	
	nodeMap=[#if fcan mocve
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	[null,null,null,null,null,null,null,null],
	]


func isSpaceOpen(space):
	return board[space.x][space.y]==""

func isBlack(st:String)->bool:
	return st.to_upper()==st and st!=""

func isWhite(st:String)->bool:
	return st.to_upper()!=st and st!=""

func isValidMove(piece:String,oldPos:Vector2i,newPos:Vector2i,BOARD=board):
	
	if newPos!=oldPos and newPos.x>-1 and newPos.x<8 and newPos.y>-1 and newPos.y<8 and (BOARD[newPos.x][newPos.y]=="" or isBlack(BOARD[oldPos.x][oldPos.y])!=isBlack(BOARD[newPos.x][newPos.y])):
		var dx = abs(newPos.x - oldPos.x)
		var dy = abs(newPos.y - oldPos.y)
		
		var dxSign=sign(newPos.x - oldPos.x)
		var dySign=sign(newPos.y - oldPos.y)
		
		match piece.to_lower():
			"p": # Pawn
				var dir = -1 if isBlack(piece) else 1
				if newPos.y - oldPos.y == dir:
					# One square forward (empty) or diagonal capture
					if dx == 0 and BOARD[newPos.x][newPos.y] == "":
						return true
					if dx == 1 and BOARD[newPos.x][newPos.y] != "":
						return true
				# Two square push from starting rank
				if newPos.y - oldPos.y == dir * 2 and dx == 0:
					var canDouble = (isBlack(piece) and (oldPos.y == 6 or oldPos.y == 7)) or (not isBlack(piece) and (oldPos.y == 0 or oldPos.y == 1))
					if canDouble and BOARD[newPos.x][newPos.y] == "" and BOARD[oldPos.x][oldPos.y + dir] == "":
						return true
				return false
			
			
			"r": # Rook
				if dx==0:
					for d in range(1, dy):
						if BOARD[oldPos.x][oldPos.y+d*dySign]!="":
							return false
					return true
				elif dy==0:
					for d in range(1, dx):
						if BOARD[oldPos.x+d*dxSign][oldPos.y]!="":
							return false
					return true
				return false
			
			"n": # Knight
				return (dx == 2 and dy == 1) or (dx == 1 and dy == 2)
			"b": # Bishop
				
				if dx != dy:
					return false
				for d in range(1, dx):
					if BOARD[oldPos.x+d*dxSign][oldPos.y+d*dySign]!="":
						return false
				return true
				
			"q": # Queen
				if (dx == dy):
					for d in range(1, dx):
						if BOARD[oldPos.x+d*dxSign][oldPos.y+d*dySign]!="":
							return false
					return true
				elif dx==0:
					for d in range(1, dy):
						if BOARD[oldPos.x][oldPos.y+d*dySign]!="":
							return false
					return true
				elif dy==0:
					for d in range(1, dx):
						if BOARD[oldPos.x+d*dxSign][oldPos.y]!="":
							return false
					return true
				return false
				
			"k": # King
				return dx <= 1 and dy <= 1
		return false
	
	# En passant: pawn moves diag to an empty square that is the EP target
	elif piece.to_lower() == "p" and newPos == enPassantTarget:
		var dir = -1 if isBlack(piece) else 1
		if newPos.y - oldPos.y == dir and abs(newPos.x - oldPos.x) == 1:
			return true
	
	return false

	
