// Railway entry point for the background worker process.
// Railway requires a separate start command per service; this file lets the
// worker service use `node worker-start.js` without modifying worker.js itself.
require('./worker');
