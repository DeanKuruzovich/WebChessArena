shader_type canvas_item;


uniform float speed : hint_range(0.0, 10.0, 0.1) = 3.0;
uniform float height : hint_range(0.0, 0.1, 0.001) = 0.003;
uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;

uniform float timeOffset = 0.0;

uniform vec2 center =vec2(0,0);

void fragment() {
	float Time=TIME-timeOffset;
    // Use SCREEN_UV to get texture coordinates for the entire screen
    vec2 position = vec2(-1.0,-1.0) + 2.0 * SCREEN_UV;//-1-1,-1-1

    // Calculate the distance from the center of the screen
    float difFromCenter = length((position-center)/SCREEN_PIXEL_SIZE)*length(SCREEN_PIXEL_SIZE);

	if(difFromCenter<0.1){
		COLOR=vec4(0,0,0,1);
	}else{
	float outwardRad=Time*2.0;
	float disFromRad=abs(difFromCenter-outwardRad*0.7)*10.0;

    // Modify the UVs based on wave distortion
    vec2 uv = SCREEN_UV -position*(0.02*clamp(1.0-disFromRad,0,1.0));

    // Sample the screen texture at the new UV coordinates
    vec3 col = texture(screen_texture, uv).xyz;

    // Set the final color output
    COLOR = vec4(col, 1.0);
	}
}