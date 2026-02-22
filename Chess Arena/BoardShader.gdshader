shader_type canvas_item;

uniform ivec2 moves[27];//max num posible moves

void fragment() {
ivec2 coords = ivec2(vec2(2.0,2.0)+(UV-vec2(0.0185264972,0.0184628596))/vec2(0.1206376562,0.1202232718))-ivec2(2,2);
for(int i=0;i<27;i++){
	if(coords==moves[i]){
    	COLOR = texture(TEXTURE, UV) *  vec4(1.0, 1.0, 0.0, 1.0);
	}
}

}
//2321 × 2329 pix
//43 pix margine left
//43 bottom
