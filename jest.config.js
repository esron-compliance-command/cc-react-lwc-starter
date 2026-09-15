const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    // Scope Jest to the LWC source only. Without this it also picks up the Vitest suites under
    // react-src and the Playwright specs under e2e, and fails on imports it was never meant to
    // resolve. Three test runners in one repo is normal; letting them collide is not.
    roots: ['<rootDir>/force-app'],
    moduleNameMapper: {
        '^@salesforce/apex/StarterListController.fetchList$':
            '<rootDir>/force-app/test/jest-mocks/apex/fetchList'
    }
};
