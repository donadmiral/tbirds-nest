// Set KOTLINC to a Kotlin compiler when running the JVM check outside an Android build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { patchFileReads } = require('../../plugins/withLargeFileReads');
const pkg = require.resolve('expo-file-system/package.json');
const version = require(pkg).version;
const source = fs.readFileSync(path.join(path.dirname(pkg), 'android/src/main/java/expo/modules/filesystem/FileSystemFileHandle.kt'), 'utf8');
const adapted = patchFileReads(source, version);

test('Android prebuild patches only the reviewed file reader and is idempotent', () => {
  assert.equal(patchFileReads(adapted, version), adapted);
  assert.match(adapted, /minOf\(length.toLong\(\), remaining\).toInt\(\)/);
  assert.throws(() => patchFileReads('different source', version), /reviewed SDK/);
  assert.throws(() => patchFileReads(source, '99'), /upgrading/);
  assert.ok(require('../../app.json').expo.plugins.includes('./plugins/withLargeFileReads'));
});

const kotlinc = process.env.KOTLINC || 'kotlinc';
const compiler = spawnSync(kotlinc, ['-version'], { encoding: 'utf8' });
test('actual Android FileSystemFileHandle reads a sparse 3 GiB file at both boundaries', { skip: compiler.error?.code === 'ENOENT' && 'Kotlin compiler unavailable' }, t => {
  assert.equal(compiler.status, 0, compiler.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-large-read-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Reader.kt'), adapted);
  fs.writeFileSync(path.join(dir, 'SharedRef.kt'), `package expo.modules.kotlin.sharedobjects
open class SharedRef<T>(val ref: T) { open fun sharedObjectDidRelease() {} }`);
  fs.writeFileSync(path.join(dir, 'Check.kt'), `package expo.modules.filesystem
import java.io.File
import java.io.RandomAccessFile
class FileSystemFile(val javaFile: File)
class UnableToReadHandleException(s: String) : Exception(s)
class UnableToWriteHandleException(s: String) : Exception(s)
fun main() {
  val file = File("fixture.bin")
  val end = 3L * 1024 * 1024 * 1024
  RandomAccessFile(file, "rw").use { f -> f.setLength(end); f.write(1); f.seek(end - 1); f.write(2) }
  FileSystemFileHandle(FileSystemFile(file)).use { reader ->
    val chunk = reader.read(6 * 1024 * 1024)
    check(chunk.size == 6 * 1024 * 1024 && chunk.first() == 1.toByte())
    reader.offset = end - 1
    check(reader.read(1024).contentEquals(byteArrayOf(2)))
    check(reader.read(1024).isEmpty())
  }
}`);
  const compile = spawnSync(kotlinc, ['Reader.kt', 'SharedRef.kt', 'Check.kt', '-d', 'classes'], { cwd: dir, encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync(path.join(path.dirname(kotlinc), 'kotlin'), ['-classpath', 'classes', 'expo.modules.filesystem.CheckKt'], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});
