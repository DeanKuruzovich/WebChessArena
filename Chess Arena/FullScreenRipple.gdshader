shader_type canvas_item;

uniform float wave_count : hint_range(1.0, 20.0, 1.0) = 20.0;
uniform float speed : hint_range(0.0, 10.0, 0.1) = 3.0;
uniform float height : hint_range(0.0, 0.1, 0.001) = 0.003;
uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;

void fragment() {
    // Use SCREEN_UV to get texture coordinates for the entire screen
    vec2 cPos = -1.0 + 2.0 * SCREEN_UV;

    // Calculate the distance from the center of the screen
    float cLength = length(cPos);

    // Modify the UVs based on wave distortion
    vec2 uv = SCREEN_UV + (cPos / cLength) * cos(cLength * wave_count - TIME * speed) * height;

    // Sample the screen texture at the new UV coordinates
    vec3 col = texture(screen_texture, uv).xyz;

    // Set the final color output
    COLOR = vec4(col, 1.0);
}
