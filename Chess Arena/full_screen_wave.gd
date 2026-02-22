extends CanvasLayer


func startWave(center):
	
	$ColorRect2.material.set_shader_parameter("center",center) 
	$ColorRect2.material.set_shader_parameter("timeOffset",Time.get_ticks_msec() / 1000.0) 



func _on_timer_timeout() -> void:
	queue_free()
