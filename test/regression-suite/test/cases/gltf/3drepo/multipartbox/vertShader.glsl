precision highp float;
attribute vec3 position;
attribute vec3 normal;
varying vec3 v_normal;
uniform mat3 normalMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
void main(void) {
vec4 pos = modelViewMatrix * vec4(position,1.0);
v_normal = normalMatrix * normal;
gl_Position = projectionMatrix * pos;
}
