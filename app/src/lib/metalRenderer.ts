export interface MetalParameters {
  accent: string; reflection: number; contrast: number; speed: number;
  depth: number; grain: number; mouse: boolean; seed: number;
}
const vertex = `attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`;

const fragment = `precision highp float;
uniform vec2 resolution, pointer;
uniform float time, reflection, contrast, speed, depth, grain, seed, interaction;
uniform vec3 accent;
float field(vec2 p) {
 float t=time*speed*.025;
 p+=vec2(sin(p.y*1.4+t)+sin(p.x*.7-p.y*.8)*.4,cos(p.x*1.05-t))*.85;
 float fold=p.y*2.4+p.x*.65+sin(p.x*1.25+t)*1.3;
 float h=sin(fold)*.53;
 h+=sin(fold*2.1+p.x*.7-t*.3)*.17;
 h+=sin(p.x*2.3-p.y*.85+t*.6)*.24;
 vec2 m=(pointer-.5)*vec2(resolution.x/resolution.y,1.)*4.;
 h-=exp(-dot(p-m,p-m)*2.)*interaction*.15;
 return h;
}
void main() {
 vec2 uv=gl_FragCoord.xy/resolution;
 vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.)*4.;
 p+=vec2(sin(seed*.017),cos(seed*.023))*3.;
 float e=.008; float h=field(p);
 vec3 n=normalize(vec3((h-field(p+vec2(e,0.)))/e*depth,(h-field(p+vec2(0.,e)))/e*depth,1.));
 vec3 r=reflect(normalize(vec3(p*.13,-1.)),n);


 float strip=r.y+.13+sin(r.x*3.)*.16;
 float panel=exp(-pow(strip*2.,2.))*.85;
 float band=exp(-pow(strip*9.,2.));
 float edge=exp(-pow((r.x*.65+r.y*.35-.51)*15.,2.));
 float rim=exp(-pow((r.y-.63+r.x*.2)*8.,2.))*.6;
 float light=pow(max(panel+band*.9+edge*.7+rim,0.),contrast)*reflection;
 float saturation=max(accent.r,max(accent.g,accent.b))-min(accent.r,min(accent.g,accent.b));
 float tint= smoothstep(.08,.48,saturation);
 vec3 metal=mix(vec3(.78,.79,.82),accent,tint*.94);
 vec3 base=mix(vec3(.006,.007,.011),metal*.038,clamp(h*.5+.5,0.,1.));
 vec3 color=base+metal*light*.72;


 float white=pow(max(band,edge),1.8)*reflection;
 color+=mix(vec3(.92,.91,.94),sqrt(accent),tint*.22)*white*.85;
 float vignette=1.-.25*smoothstep(.2,.85,length(uv-.5));
 float noise=fract(sin(dot(gl_FragCoord.xy+seed,vec2(12.9898,78.233)))*43758.5453)-.5;
 gl_FragColor=vec4(clamp(color*vignette+noise*grain*.018,0.,1.),1.);
}`;

export class MetalRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private shaders: WebGLShader[] = [];
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader allocation failed');
      gl.shaderSource(shader, source); gl.compileShader(shader); this.shaders.push(shader); return shader;
    };
    const program = gl.createProgram(); const buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error('WebGL allocation failed');
    this.program = program; this.buffer = buffer;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
  }
  async warmUp() {
    const gl = this.gl;
    const extension = gl.getExtension('KHR_parallel_shader_compile');
    const deadline = performance.now() + 4000;
    while (extension && !gl.getProgramParameter(this.program, extension.COMPLETION_STATUS_KHR)) {
      if (performance.now() > deadline) throw new Error('Shader warm-up timeout');
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of ['resolution','pointer','time','reflection','contrast','speed','depth','grain','seed','interaction','accent']) this.uniforms.set(name, gl.getUniformLocation(this.program,name));
  }
  draw(parameters: MetalParameters, time: number, pointer: [number,number], quality: 'maximum' | 'balanced') {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const rect = this.canvas.getBoundingClientRect();
    const limit = quality === 'maximum' ? 1920 : 1280;
    const ratio = Math.min(devicePixelRatio || 1, quality === 'maximum' ? 1.25 : .85, limit / Math.max(rect.width,rect.height));
    const w=Math.max(1,Math.round(rect.width*ratio)), h=Math.max(1,Math.round(rect.height*ratio));
    if(this.canvas.width!==w || this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h); gl.useProgram(this.program);
    const u=(name:string)=>this.uniforms.get(name)??null;
    gl.uniform2f(u('resolution'),w,h); gl.uniform2f(u('pointer'),pointer[0],pointer[1]);
    gl.uniform1f(u('time'),time); gl.uniform1f(u('reflection'),parameters.reflection/100);
    gl.uniform1f(u('contrast'),parameters.contrast/100); gl.uniform1f(u('speed'),parameters.speed/100);
    gl.uniform1f(u('depth'),parameters.depth/100); gl.uniform1f(u('grain'),parameters.grain/100);
    gl.uniform1f(u('seed'),parameters.seed); gl.uniform1f(u('interaction'),parameters.mouse?1:0);
    const color=/^#[\da-f]{6}$/i.test(parameters.accent)?parameters.accent:'#8b7cff';
    gl.uniform3f(u('accent'),parseInt(color.slice(1,3),16)/255,parseInt(color.slice(3,5),16)/255,parseInt(color.slice(5,7),16)/255);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  dispose() { this.shaders.forEach(s=>this.gl.deleteShader(s)); this.gl.deleteBuffer(this.buffer); this.gl.deleteProgram(this.program); }
}
