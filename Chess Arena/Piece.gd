extends Control

var dragging:bool = false


var type:String
var pastPos:Vector2i
var lastMoveTime=0
var cloud
var movesUntilFormed
var Sparkle
var convertable:bool=false

var onBlackTeam:bool

func _ready() -> void:
	if not Global.is_connected("piece_moved", Callable(self, "_piece_moved")):
		Global.connect("piece_moved", Callable(self, "_piece_moved"))
	


@onready var texture = get_parent().get_node("Piece").material

func makeConvertablePiece():
	Sparkle=Sprite2D.new()
	Sparkle.texture=load("res://Sparkle.png")
	Sparkle.z_index=1.5
	get_parent().add_child(Sparkle)
	convertable=true
	

func initiate(pos,type,movesToForm):
	
	pastPos=pos
	get_parent().position=(pos)*Vector2(280,280)+Vector2(140,140)
	
	movesUntilFormed=movesToForm
	
	Global.board[pos.x][pos.y]=type
	Global.nodeMap[pos.x][pos.y]=self
	
	
	texture.set_shader_parameter("fadeIn",floor((1.0/(movesToForm+1))*100)/100) 
	
	if movesUntilFormed!=0:
		cloud=Sprite2D.new()
		cloud.texture=load("res://cloud.png")
		cloud.z_index=2
		get_parent().add_child(cloud)
	
	
	get_parent().get_node("Piece").texture=getTexture(type)
	
	
	
	
	self.type=type
	
	
	if !isBlack():#cannot move white
		mouse_filter=Control.MOUSE_FILTER_IGNORE
	


func _gui_input(event):
	
	if movesUntilFormed==0:
		if event is InputEventMouseButton:
			if event.pressed and event.button_index == MOUSE_BUTTON_LEFT and self not in Global.hitList:
				dragging = true
				Global.main.displayMoves(Global.engine.getMoves(pastPos, Global.board, Global.enPassantTarget))
			
			elif !event.pressed and dragging:
				dragging = false
				Global.main.displayMoves([])
				var newPosition=Vector2i((get_parent().position/Vector2(280,280)).floor())
				
				if Global.isValidMove(type,pastPos,newPosition) and Global.can_move_pieces:
					# Detect en passant: pawn moves diag to empty square at EP target
					var isEP = (type.to_lower() == "p" and newPosition.x != pastPos.x and Global.board[newPosition.x][newPosition.y] == "" and newPosition == Global.enPassantTarget)
					Global.emit_signal("piece_moved", Vector2i(pastPos.x, pastPos.y), newPosition, isEP)
				
				else:
					get_parent().position=pastPos*Vector2i(280,280)+Vector2i(140,140)
		
		
		elif event is InputEventMouseMotion and dragging:
			get_parent().global_position+= event.relative

func getTexture(type):
	if !Global.selectedBlack:
		if Global.isBlack(type):
			type=type.lower()
		else:
			type=type.upper()
	match type:
		"p": # Pawn
			return preload("res://PieceTextures/white_pawn.png")
		"r": # Rook
			return preload("res://PieceTextures/white_rook.png")
		"n": # Knight
			return preload("res://PieceTextures/white_knight.png")
		"b": # Bishop
			return preload("res://PieceTextures/white_bishop.png")
		"q": # Queen
			return preload("res://PieceTextures/white_queen.png")
		"k": # King
			return preload("res://PieceTextures/white_king.png")
		
		"P": # Pawn
			return preload("res://PieceTextures/black_pawn.png")
		"R": # Rook
			return preload("res://PieceTextures/black_rook.png")
		"N": # Knight
			return preload("res://PieceTextures/black_knight.png")
		"B": # Bishop
			return preload("res://PieceTextures/black_bishop.png")
		"Q": # Queen
			return preload("res://PieceTextures/black_queen.png")
		"K": # King
			return preload("res://PieceTextures/black_king.png")


func isBlack():#isblack
	return (type.to_upper()==type)


func _piece_moved(movedFrom:Vector2i, movedTo:Vector2i, isEnPassant: bool = false):
	if movedFrom==Vector2i(pastPos):#this piece is the one moving
		if isBlack():
			get_parent().position=movedTo*Vector2i(280,280)+Vector2i(140,140)
		else:
			move_to(movedTo*Vector2i(280,280)+Vector2i(140,140),Global.animeTime)
		pastPos=movedTo
	
	elif movedTo==Vector2i(pastPos):
		# Normal capture — this piece is being taken
		if isBlack():
			killAtEndOfAnimeTime(get_parent())
		else:
			get_parent().queue_free()
		if convertable:
			Global.addPlayerPieceNextFrame=type
	
	elif isEnPassant and Vector2i(movedTo.x, movedFrom.y) == Vector2i(pastPos):
		# En passant capture — this pawn is the one being captured
		if isBlack():
			killAtEndOfAnimeTime(get_parent())
		else:
			get_parent().queue_free()
		if convertable:
			Global.addPlayerPieceNextFrame=type
	
	if movesUntilFormed!=0:
		movesUntilFormed-=1
		if movesUntilFormed>0:
			texture.set_shader_parameter("fadeIn",floor((1.0/(movesUntilFormed))*100)/100) 
			
			if movesUntilFormed==2:
				#get_parent().get_node("Piece").z_index=1
				pass
			elif movesUntilFormed<=1 and cloud!=null:
				killAtEndOfAnimeTime(cloud)
				


func killAtEndOfAnimeTime(node):
	Global.hitList.append(node)

func move_to(target_position: Vector2, duration: float):
	var tween = create_tween()
	tween.tween_property(get_parent(), "position", target_position, duration)

func promote(pos):
	
	if Global.isBlack(type):
		Global.board[pos.x][pos.y]="Q"
		type="Q"
	else:
		Global.board[pos.x][pos.y]="q"
		type="q"
	
	get_parent().get_node("Piece").texture=getTexture(type)

func exportPieceDat():
	return {"posX":pastPos.x,"posY":pastPos.y,"type":type,"movesUntilFormed":movesUntilFormed,"convertable":convertable}
