extends CanvasLayer

func ScreenPulse(ColorTint,edge_intensityINP:float=2.0):
	
	$ColorRect2.material.set_shader_parameter("ColorTint",ColorTint) 
	$ColorRect2.material.set_shader_parameter("edge_intensityINP",edge_intensityINP) 
	$ColorRect2.material.set_shader_parameter("timeOffset",Time.get_ticks_msec() / 1000.0) 



func _on_timer_timeout() -> void:
	queue_free()
