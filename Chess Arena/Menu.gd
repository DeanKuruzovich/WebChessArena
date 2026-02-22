extends Node2D


func _on_timer_timeout() -> void:
	$Title.text="Chess Arena"




func _on_normal_mode_appear_timeout() -> void:
	$EndlessMode.visible=true


func _on_other_mode_appear_timeout() -> void:
	$OtherMode.visible=true
	$Board.material=null


func _on_endless_mode_pressed() -> void:
	pass # Replace with function body.
