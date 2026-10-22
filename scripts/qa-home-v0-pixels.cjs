'use strict';
const assert=require('node:assert/strict'),zlib=require('node:zlib');
function pixels(buffer) {
  let width, height, channels, chunks = [];
  for (let i = 8; i < buffer.length;) {
    const n = buffer.readUInt32BE(i), type = buffer.toString('ascii', i + 4, i + 8), data = buffer.subarray(i + 8, i + 8 + n); i += n + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); channels = data[9] === 6 ? 4 : 3; assert.ok([2,6].includes(data[9])); }
    if (type === 'IDAT') chunks.push(data);
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), stride = width * channels, decoded = Buffer.alloc(height * stride);
  const paeth = (a,b,c) => { const p = a+b-c, pa=Math.abs(p-a), pb=Math.abs(p-b), pc=Math.abs(p-c); return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };
  for (let y=0;y<height;y++) for (let x=0;x<stride;x++) {
    const i=y*stride+x, a=x>=channels?decoded[i-channels]:0, b=y?decoded[i-stride]:0, c=y&&x>=channels?decoded[i-stride-channels]:0;
    const filter=raw[y*(stride+1)], predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
    assert.notEqual(predictor,undefined); decoded[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
  }
  return { width,height,channels,data:decoded };
}

module.exports={pixels};
