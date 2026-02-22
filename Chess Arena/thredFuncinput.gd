class_name thredScanInput

var branch:Array[Move]
var localBoard
var localAwaknessMap
var targetDepth:int
var path:Array[int]=[]


func _init(branch:Array[Move],localBoard,localAwaknessMap,targetDepth:int,path:Array[int]=[]):
	self.branch=branch
	self.localBoard=localBoard
	self.localAwaknessMap=localAwaknessMap
	self.targetDepth=targetDepth
	self.path=path
