extends Sprite2D

var normalPieceDistribution=[
"p","p","p","p","p","p",
"k",
"q",
"r","r",
"n","n","n",
"b","b","b"
]

var moveNum=0
var engine

var lastTurnEngineEval=0

var Score:float=0
var displayedScore:int=0
var highScore:int=0
var isInGame:bool=false

var resetNextFrame:bool=false

func _process(delta: float) -> void:
	
	if resetNextFrame:
		_ready()
		resetNextFrame=false
	
	if Score!=displayedScore:
		displayedScore=Score
		%Score.text="Score: "+str(displayedScore)
		if displayedScore>highScore:
			highScore=displayedScore
			%HighScore.text="High Score: "+str(highScore)




func addRandomOppPiece(blackPieces=5):
	var piece=addPieceRandPos(randPieceType(true,normalPieceDistribution),3)#opp piece
	var rand=randi_range(0,20)
	if (blackPieces==4 and rand==0) or (blackPieces==3 and rand<3) or (blackPieces<3 and rand<6):
		piece.get_node("Control").makeConvertablePiece()



func addPieceRandPos(pieceType,movesUntilFormed):
	var randPos
	if pieceType.to_upper()=="P":
		var y
		if !Global.isBlack(pieceType):#opp can start on 6 or 7
			y=randi_range(6,7)
		else:
			y=randi_range(0,1)
			
		
		randPos=Vector2(randi_range(0,7),y)
		while !Global.isSpaceOpen(randPos):#will always terminate, #pieces<10ish
			randPos=Vector2(randi_range(0,7),y)
	
	else:
		randPos=Vector2(randi_range(0,7),randi_range(0,7))
		while !Global.isSpaceOpen(randPos):#will always terminate, #pieces<10ish
			randPos=Vector2(randi_range(0,7),randi_range(0,7))
	
	return createPiece(randPos,pieceType,movesUntilFormed)



func createPiece(pos,type:String,movesToForm=0):
	var piece=preload("res://Piece.tscn").instantiate()
	$BoardOrigin.add_child(piece)
	piece.get_node("Control").initiate(pos,type,movesToForm)
	return piece



func _ready() -> void:
	engine = null
	
	# Disconnect old signal to prevent stacking on reset
	if Global.is_connected("piece_moved", Callable(self, "_piece_moved")):
		Global.disconnect("piece_moved", Callable(self, "_piece_moved"))
	
	Load()
	
	Global.main=self
	
	%HighScore.text="High Score: "+str(highScore)
	
	engine=preload("res://Engine.gd").new()
	Global.engine=engine
	randomize()
	Global.connect("piece_moved", Callable(self, "_piece_moved"))
	displayMoves([])
	Global.enPassantTarget = Vector2i(-1, -1)
	
	if !isInGame:
		#createPiece(Vector2(1,1),"K",0)
		createPiece(Vector2(5,6),"P",0)
		#createPiece(Vector2(6,6),"k",0)
		#createPiece(Vector2(6,7),"k",0)
		
		
		var otherType=normalPieceDistribution[randi_range(0,normalPieceDistribution.size()-1)].to_upper()
		addPieceRandPos(otherType,0)
		
		
		addRandomOppPiece()
		addRandomOppPiece()
		addRandomOppPiece()
		isInGame=true
	
	
	Global.notInitalBoardCreation=true



func move(mv:Move):
	Global.emit_signal("piece_moved", mv.from, mv.to, mv.isEnPassant)



func _piece_moved(pastPos, newPosition, isEnPassant: bool = false):
	var pieceType=Global.board[pastPos.x][pastPos.y]
	
	# Score capture
	if Global.board[newPosition.x][newPosition.y]!="" and Global.isBlack(pieceType):
		Score+=engine.getPieceValue(Global.board[newPosition.x][newPosition.y])*10
	
	if Global.board[pastPos.x][pastPos.y]=="":
		return
	if Global.nodeMap[pastPos.x][pastPos.y]==null:
		return
	
	# --- Handle en passant capture ---
	if isEnPassant and pieceType.to_lower() == "p":
		# The captured pawn sits at (newPosition.x, pastPos.y)
		var epCapturedPos = Vector2i(newPosition.x, pastPos.y)
		if Global.board[epCapturedPos.x][epCapturedPos.y] != "":
			if Global.isBlack(pieceType):
				Score+=engine.getPieceValue(Global.board[epCapturedPos.x][epCapturedPos.y])*10
			# Remove captured pawn from board
			Global.board[epCapturedPos.x][epCapturedPos.y] = ""
			if Global.nodeMap[epCapturedPos.x][epCapturedPos.y] != null:
				var capturedNode = Global.nodeMap[epCapturedPos.x][epCapturedPos.y]
				Global.nodeMap[epCapturedPos.x][epCapturedPos.y] = null
				if is_instance_valid(capturedNode):
					capturedNode.get_parent().queue_free()
	
	# --- Update en passant target ---
	# If a pawn just moved 2 squares, set en passant target to the skipped square
	if pieceType.to_lower() == "p" and abs(newPosition.y - pastPos.y) == 2:
		var midY = (pastPos.y + newPosition.y) / 2
		Global.enPassantTarget = Vector2i(pastPos.x, midY)
	elif Global.isBlack(pieceType):
		# Only clear EP target after the player moves (not after engine moves)
		# EP target persists for the engine's response to the player's 2-square push
		pass
	
	# --- Update board state ---
	Global.board[newPosition.x][newPosition.y]=Global.board[pastPos.x][pastPos.y]
	Global.board[pastPos.x][pastPos.y]=""
	Global.nodeMap[newPosition.x][newPosition.y]=Global.nodeMap[pastPos.x][pastPos.y]
	Global.nodeMap[pastPos.x][pastPos.y]=null
	
	# Pawn promotion
	if Global.board[newPosition.x][newPosition.y].to_upper()=="P" and (newPosition.y==0 or newPosition.y==7):
		Global.nodeMap[newPosition.x][newPosition.y].promote(newPosition)
		if newPosition.y==0:
			Score+=15
	
	# --- If it was a player (black) move, ask the engine to respond ---
	if Global.isBlack(Global.board[newPosition.x][newPosition.y]):
		moveNum+=1
		%MoveLabel.text="Move: "+str(moveNum)
		get_node("Move Cooldown").wait_time=0.5
		get_node("Move Cooldown").start(Global.animeTime)
		Global.can_move_pieces=false
		
		if countPieces(true)!=0:
			var boardCopy = Global.board.duplicate(true)
			var awaknessMap = engine.makeAwakenesMap()
			var bestEngineMove = engine.getBestMove(boardCopy, awaknessMap, Global.enPassantTarget)
			
			Global.boardEvaluation = bestEngineMove.eval if bestEngineMove else 0
			
			if bestEngineMove != null:
				# Use call_deferred so the player's tween plays first
				call_deferred("_do_engine_move", bestEngineMove)
		
		# Clear EP target after player's turn is fully resolved
		# (engine will have already used it in getBestMove)
		Global.enPassantTarget = Vector2i(-1, -1)


# Called deferred after the player moves — plays the engine's response
func _do_engine_move(engineMove: Move):
	# Score / great-move display
	if engineMove.eval - lastTurnEngineEval < 0:
		Score -= (engineMove.eval - lastTurnEngineEval)
		
		if engineMove.eval - lastTurnEngineEval < -6:
			greatMoveDisplay(Global.nodeMap[engineMove.from.x][engineMove.from.y])
		elif engineMove.eval - lastTurnEngineEval < -3:
			goodMoveDisplay()
		
		lastTurnEngineEval = engineMove.eval
	
	# Update EP target if engine pawn moved 2 squares
	if engineMove.isTwoSquarePawn:
		var midY = (engineMove.from.y + engineMove.to.y) / 2
		Global.enPassantTarget = Vector2i(engineMove.from.x, midY)
	
	# Play the engine move (emits piece_moved signal)
	move(engineMove)
	
	# --- Post-engine-move: spawning, game-over check ---
	var whitePieces = countPieces(true)
	var blackPieces = countPieces(false)
	
	if blackPieces == 0 or engine.getAllMovesPlayer(Global.board, engine.makeAwakenesMap(), true).size() == 0:
		$GameOverLayer.visible=true
		isInGame=false
	
	if Global.addPlayerPieceNextFrame != null:
		var type = Global.addPlayerPieceNextFrame.to_upper()
		addPieceRandPos(type, 2)
		Global.addPlayerPieceNextFrame = null
	
	if whitePieces < 5 and randf_range(0, 3) < 0.5:
		addRandomOppPiece(blackPieces)
	if whitePieces < 4 and randf_range(0, 3) < 0.5:
		addRandomOppPiece(blackPieces)
	if whitePieces < 3 and randf_range(0, 3) < 0.5:
		addRandomOppPiece(blackPieces)
	if whitePieces < 2:
		addRandomOppPiece(blackPieces)
	
	Save()




func _on_Timer_timeout() -> void:#pice move timer
	Global.can_move_pieces=true
	for i in range(Global.hitList.size()):
		if is_instance_valid(Global.hitList[i]):
			Global.hitList[i].queue_free()
	Global.hitList=[]
	
	if greatMoveMoved:
		greatMovePieceArrives(greatMovePieceMoved)


func countPieces(white):
	var count=0
	for i in range(0,8):
		for j in range(0,8):
			if Global.board[i][j]!="":
				if Global.isBlack(Global.board[i][j])!=white:
					count+=1
	return count


func _on_reset_pressed() -> void:
	isInGame=false
	
	for child in $BoardOrigin.get_children():
		child.queue_free()
	$MenuLayer.visible=false
	$GameOverLayer.visible=false
	Save()
	resetNextFrame=true
	Global._ready()



func randPieceType(opponent,pieceDistribution):
	if opponent:
		return pieceDistribution[randi_range(0,pieceDistribution.size()-1)]
	else:
		return pieceDistribution[randi_range(0,pieceDistribution.size()-1)].to_upper()


func Save():
	var sceneData = {"highScore": highScore,"Pieces":saveBoardData(),"InGame":isInGame}
	var jsonString = JSON.stringify(sceneData)
	DirAccess.make_dir_recursive_absolute("user://Data")
	var jsonFile = FileAccess.open("user://Data/Save.json", FileAccess.WRITE)
	if jsonFile:
		jsonFile.store_line(jsonString)
		jsonFile.close()


func Load():
	if not FileAccess.file_exists("user://Data/Save.json"):
		return
	var jsonFile = FileAccess.open("user://Data/Save.json", FileAccess.READ)
	if jsonFile == null:
		return
	var jsonString = jsonFile.get_as_text()
	jsonFile.close()
	var Data = JSON.parse_string(jsonString)
	if Data == null:
		return
	highScore = Data.get("highScore", 0)
	isInGame = Data.get("InGame", false)
	
	if isInGame:
		loadFromBoard(Data["Pieces"])


func saveBoardData():
	var pieces=[]
	for i in range(0,8):
		for j in range(0,8):
			if Global.nodeMap[i][j]!=null:
				pieces.append(Global.nodeMap[i][j].exportPieceDat())
	
	return pieces


func loadFromBoard(pieces):
	
	for i in range(pieces.size()):
		makePieceFromExport(pieces[i])

#return {"pos":pastPos,"type":type,"movesUntilFormed":movesUntilFormed,"convertable":convertable}
func makePieceFromExport(export):
	
	var piece=preload("res://Piece.tscn").instantiate()
	$BoardOrigin.add_child(piece)
	
	
	piece.get_node("Control").initiate(Vector2(int(export["posX"]),int(export["posY"])),export["type"],int(export["movesUntilFormed"]))
	if export["convertable"]:
		piece.get_node("Control").makeConvertablePiece()
	
	



func _on_menu_pressed() -> void:
	$MenuLayer.visible=true

func _on_close_menu_pressed() -> void:
	$MenuLayer.visible=false

var greatMovePieceMoved=null
var greatMoveMoved=false
var greatMoveNode
func greatMoveDisplay(pieceMoved):
	greatMoveNode=preload("res://greate_move.tscn").instantiate()
	add_child(greatMoveNode)
	
	greatMoveMoved=true
	greatMovePieceMoved=pieceMoved
	
	var timer=Timer.new()
	
	add_child(timer)
	timer.timeout.connect(greatMoveTimeout)
	timer.one_shot=true
	timer.start(2)



func greatMoveTimeout():
	greatMoveNode.queue_free()

func goodMoveDisplay():
	pass


func displayMoves(moves):
	if moves.size()==0:
		material=null
	
	else:
		material=preload("res://MoveHighlight.tres")
		for i in range(moves.size(),27):
			moves.append(Vector2(-2,-2))
		
		material.set_shader_parameter("moves", moves)


func get_screen_position(node) -> Vector2:
	var camera := get_viewport().get_camera_2d()
	if camera:
		return (node.global_position - camera.get_screen_center_position())/ get_viewport_rect().size
	return node.global_position  # Fallback if no camera


func greatMovePieceArrives(pieceMoved):
	var wave=load("res://full_screen_wave.tscn").instantiate()
	$Camera2D.add_child(wave)
	wave.startWave(get_screen_position(pieceMoved))
	
	var ScreenPulse=load("res://ScreenEdgePulse.tscn").instantiate()
	$Camera2D.add_child(ScreenPulse)
	ScreenPulse.ScreenPulse(Color(1,0.8,0),2.0)#ColorTint,edge_intensityINP:float=2.0
