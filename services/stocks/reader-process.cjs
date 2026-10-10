// Wait for close (including drained stdout), even when a zero-reader child exited earlier.
async function stopReader(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0 && child.signalCode !== 'SIGTERM') throw Error(`READER_EXIT:${child.exitCode}:${child.signalCode}`);
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Error('READER_DRAIN_TIMEOUT')); }, timeoutMs);
    function finish(error) { clearTimeout(timer); child.removeListener('close', closed); child.removeListener('error', failed); error ? reject(error) : resolve(); }
    function closed(code, signal) { finish(code === 0 || signal === 'SIGTERM' ? undefined : Error(`READER_EXIT:${code}:${signal}`)); }
    function failed(error) { finish(error); }
    child.once('close', closed); child.once('error', failed);
    child.kill('SIGTERM');
  });
}
module.exports = { stopReader };
