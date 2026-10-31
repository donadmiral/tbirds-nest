const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const evidence = require('../fixtures/media3-bframe-clipping.json');
const body = method => method.slice(method.indexOf('{'));

test('exact upstream clipping methods reproduce the real three-frame loss and preserve all in-range reordered frames after the fix', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(evidence.sourceAsset)).digest('hex'), evidence.sourceSha256);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bframe-methods-'));
  const source = String.raw`import java.util.*;
public final class BFrameMethods {
 static final long[] TIMES={${evidence.packets.map(x => `${x.ptsUs}L`).join(',')}};
 static final int[] FLAGS={${evidence.packets.map((x, i) => (x.key ? 1 : 0) | (i === evidence.packets.length - 1 ? 2 : 0)).join(',')}};
 static final class C {static final long TIME_END_OF_SOURCE=Long.MIN_VALUE,TIME_UNSET=Long.MIN_VALUE+1;static final int INDEX_UNSET=-1,BUFFER_FLAG_KEY_FRAME=1,BUFFER_FLAG_LAST_SAMPLE=2,BUFFER_FLAG_END_OF_STREAM=4,RESULT_NOTHING_READ=-3,RESULT_BUFFER_READ=-4,RESULT_FORMAT_READ=-5;}
 @interface ReadDataResult {}
 static final class DecoderInputBuffer {long timeUs;int flags;boolean waitingForKeys;void clear(){timeUs=0;flags=0;}void setFlags(int value){flags=value;}}
 static final class Format {int encoderDelay,encoderPadding;Format buildUpon(){return this;}Format setEncoderDelay(int value){encoderDelay=value;return this;}Format setEncoderPadding(int value){encoderPadding=value;return this;}Format build(){return this;}}
 static final class FormatHolder {Format format=new Format();}
 static final class Assertions {static <T>T checkNotNull(T value){return Objects.requireNonNull(value);}}
 static final class Child {int index;int readData(FormatHolder format,DecoderInputBuffer buffer,int flags){if(index==TIMES.length)return C.RESULT_NOTHING_READ;buffer.timeUs=TIMES[index++];buffer.flags=0;return C.RESULT_BUFFER_READ;}}
 static final class Old {
  final Child childStream=new Child();long startUs,endUs;boolean sentEos;
  Old(long start,long end){startUs=start;endUs=end;}
  boolean isPendingInitialDiscontinuity(){return false;}
  long getBufferedPositionUs(){return childStream.index==TIMES.length?C.TIME_END_OF_SOURCE:TIMES[TIMES.length-1];}
  int readData(FormatHolder formatHolder,DecoderInputBuffer buffer,int readFlags) ${body(evidence.methods.oldClipping.method)}
 }
 static final class Queue {
  long readEndTimeUs;int readEndTimeAbsoluteIndex=-1,readEndTimeAbsoluteIndexCandidate=-1,maxReorder;
  Queue(long end,int reorder){readEndTimeUs=end;maxReorder=reorder;}
  int getUpstreamMaxNumReorderSamples(){return maxReorder;}
  ${evidence.methods.queue.method}
 }
 static final class SampleStream {static final int FLAG_STRICT_DURATION=1;int getFlags(){return FLAG_STRICT_DURATION;}}
 static final class Renderer {
  final List<Long> decodeOnlyPresentationTimestamps=new ArrayList<>();long start,end;
  Renderer(long first,long last){start=first;end=last;}
  long getStreamEndPositionUs(){return end;}long getStreamOffsetUs(){return 0;}long getLastResetPositionUs(){return start;}
  SampleStream getStream(){return new SampleStream();}static <T>T checkNotNull(T value){return Objects.requireNonNull(value);}
  ${evidence.methods.renderer.method}
 }
 public static void main(String[] args) {
  long start=Long.parseLong(args[0]),end=Long.parseLong(args[1]);int reorder=Integer.parseInt(args[2]);
  List<Long> old=new ArrayList<>(),updated=new ArrayList<>();Old stream=new Old(start,end);DecoderInputBuffer buffer=new DecoderInputBuffer();
  for(int i=0;i<=TIMES.length;i++){int read=stream.readData(new FormatHolder(),buffer,0);if((buffer.flags&C.BUFFER_FLAG_END_OF_STREAM)!=0)break;if(read==C.RESULT_BUFFER_READ&&buffer.timeUs>=start)old.add(buffer.timeUs);}
  Queue queue=new Queue(end,reorder);for(int i=0;i<TIMES.length;i++)queue.updateReadEndTimeState(i,TIMES[i],FLAGS[i]);
  int limit=queue.readEndTimeAbsoluteIndex<0?TIMES.length:queue.readEndTimeAbsoluteIndex;Renderer renderer=new Renderer(start,end);
  for(int i=0;i<limit;i++){buffer.timeUs=TIMES[i];renderer.onDecoderInputReady(buffer);}
  for(int i=0;i<limit;i++)if(!renderer.decodeOnlyPresentationTimestamps.contains(TIMES[i]))updated.add(TIMES[i]);
  Collections.sort(old);Collections.sort(updated);
  System.out.println("{\"old\":"+old+",\"updated\":"+updated+",\"readLimit\":"+limit+"}");
 }
}`;
  try {
    fs.writeFileSync(path.join(directory, 'BFrameMethods.java'), source);
    const compiled = spawnSync('java', ['com.sun.tools.javac.Main', '-d', directory, path.join(directory, 'BFrameMethods.java')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    for (const [start, end] of [[500000, 2000000], [0, 1500000], [700000, 1733333], [0, 2999999]]) {
      for (const reorder of [2, 16]) {
        const output = spawnSync('java', ['-cp', directory, 'BFrameMethods', String(start), String(end), String(reorder)], { encoding: 'utf8', timeout: 10000 });
        assert.equal(output.status, 0, output.stdout + output.stderr);
        const observed = JSON.parse(output.stdout);
        const expected = evidence.packets.map(x => x.ptsUs).filter(time => time >= start && time < end).sort((a, b) => a - b);
        assert.deepEqual(observed.updated, expected, `clip ${start}–${end}, reorder ${reorder}`);
        if (start === 500000 && end === 2000000) {
          assert.equal(observed.old.length, 42); assert.equal(observed.updated.length, 45);
          assert.deepEqual(observed.updated.filter(value => !observed.old.includes(value)), [1900000, 1933333, 1966667]);
          assert.equal(Math.max(...observed.old), 1866667);
        }
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
