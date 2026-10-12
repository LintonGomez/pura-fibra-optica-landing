#!/usr/bin/env node
'use strict';

const { createPasswordHash } = require('../server');

if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
  process.stderr.write('New CRM password (12+ characters; input hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  process.stdin.on('data', (chunk) => {
    for (const char of chunk.toString('utf8')) {
      if (char === '\u0003') {
        process.stdin.setRawMode(false);
        process.stderr.write('\nCancelled.\n');
        process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write('\n');
        try {
          process.stdout.write(createPasswordHash(password) + '\n');
          process.exit(0);
        } catch (error) {
          process.stderr.write(error.message + '\n');
          process.exit(1);
        }
      } else if (char === '\u007f' || char === '\b') {
        password = password.slice(0, -1);
      } else {
        password += char;
      }
    }
  });
} else {
  let password = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { password += chunk; });
  process.stdin.on('end', () => {
    try {
      process.stdout.write(createPasswordHash(password.replace(/[\r\n]+$/, '')) + '\n');
    } catch (error) {
      process.stderr.write(error.message + '\n');
      process.exitCode = 1;
    }
  });
}
