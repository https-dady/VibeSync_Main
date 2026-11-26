'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  testTimeout: 60000,
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
};
