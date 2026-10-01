// Disposable-test runner only: never read a checkout's .env or inherited secrets.
module.exports = { config: () => ({ parsed: {} }) };
