shader_type canvas_item;
//uniform vec3 ColorTint=vec3(1,0.8,0);
uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;

uniform float edge_intensityINP = 2.0;
uniform float dropFactor=2.0;
uniform float cornerIntensityINP=1.6;
uniform float MaxColor=0.85;
uniform vec3 ColorTint=vec3(1,0.8,0);
uniform float timeOffset = 0.0;

void fragment() {
	float Time=TIME-timeOffset;
	vec2 uv = SCREEN_UV;

	float XScaler=SCREEN_PIXEL_SIZE.y/SCREEN_PIXEL_SIZE.x;

	float timeScaler=sin(clamp(Time,0,PI));



	float edge_intensity=edge_intensityINP*timeScaler;
	float cornerIntensity=cornerIntensityINP*timeScaler;



    float light = pow(edge_intensity / (uv.x *XScaler*40.0), dropFactor);
    light += pow(edge_intensity / ((1.0 - uv.x) * XScaler*40.0), dropFactor);
    light += pow(edge_intensity / (uv.y*40.0), dropFactor);
    light += pow(edge_intensity / ((1.0 - uv.y)*40.0), dropFactor);




	light+=pow(cornerIntensity/(40.0*distance(uv,vec2(0,0))),dropFactor);
	light+=pow(cornerIntensity/(40.0*distance(uv,vec2(1,0))),dropFactor);
	light+=pow(cornerIntensity/(40.0*distance(uv,vec2(0,1))),dropFactor);
	light+=pow(cornerIntensity/(40.0*distance(uv,vec2(1,1))),dropFactor);

    // Sample the screen texture
    vec4 screenColor = texture(screen_texture, SCREEN_UV);

    vec3 finalColor = mix(screenColor.rgb, ColorTint, clamp(light, 0.0, MaxColor));

    // Output the final color
    COLOR =vec4(finalColor, screenColor.a);
}

