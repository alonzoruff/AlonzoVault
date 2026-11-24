'use strict';
/*
 * Vercel entry point. Vercel runs this file as a function for every
 * request (see vercel.json) and calls the same handler that Render
 * runs through its own web server in server.js. Nothing here is used
 * on Render.
 */
module.exports = require('../server.js').handler;
