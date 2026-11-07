class LivePCM extends AudioWorkletProcessor {
 constructor(){super();this.ring=new Float32Array(48000);this.read=0;this.write=0;this.count=0;this.capture=[];this.paused=false;
 this.port.onmessage=({data})=>{
  if(data.type==='pause'){this.paused=data.value;this.capture=[];return;}
  if(data.type==='clear'){this.count=0;this.read=this.write=0;return;}
  if(data.pcm){const pcm=new Int16Array(data.pcm);if(this.count+pcm.length>this.ring.length){this.port.postMessage({error:'playback_overflow'});return;}
  for(const n of pcm){this.ring[this.write]=n/32768;this.write=(this.write+1)%this.ring.length;this.count++;}}
 };
 }
 process(inputs,outputs){
  const source=inputs[0]?.[0];
  if(source&&!this.paused){for(const sample of source)this.capture.push(Math.max(-32768,Math.min(32767,Math.round(sample*32768))));
   if(this.capture.length>=2400){const pcm=new Int16Array(this.capture);this.capture=[];this.port.postMessage({pcm:pcm.buffer},[pcm.buffer]);}}
  for(const out of outputs[0]||[]){for(let i=0;i<out.length;i++){out[i]=this.count?this.ring[this.read]:0;if(this.count){this.count--;this.read=(this.read+1)%this.ring.length;}}}
  return true;
 }
}
registerProcessor('live-pcm',LivePCM);
