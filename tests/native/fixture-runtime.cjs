let current;
function installFixtureRuntime(fixture) {
  if (current) throw new Error('The isolated native fixture was installed twice.');
  current = fixture;
}
function fixtureRuntime() {
  if (!current) throw new Error('The isolated native fixture is not installed.');
  return current;
}
module.exports = { installFixtureRuntime, fixtureRuntime };
