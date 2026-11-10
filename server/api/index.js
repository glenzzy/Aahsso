// Vercel entry: every /api/* request is rewritten here (see vercel.json) and handled by the same Express app
// that `node src/index.js` runs. Static files (public/) are served by Vercel's CDN, not by this function.
module.exports = require('../src/index.js').app;
