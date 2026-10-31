/** Materialize React Native's lazy WHATWG globals before replacing fetch. */
function installFixtureTransport(fixture, socket, runtime = globalThis) {
  // RN initializes Headers/Request/Response as a side effect of its first
  // fetch read. Replacing the lazy property first leaves those types undefined.
  const platformFetch = runtime.fetch;
  if ([platformFetch, runtime.Headers, runtime.Request, runtime.Response].some(value => typeof value !== 'function')) {
    throw new Error('Native HTTP primitives must initialize before the isolated UI transport.');
  }
  runtime.fetch = fixture.fetch;
  runtime.WebSocket = socket;
}

module.exports = { installFixtureTransport };
