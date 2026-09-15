// sfdx-lwc-jest cannot resolve @salesforce/apex/* imports on its own; each one is mapped to a
// stub here (see jest.config.js). The host test replaces this with its own mock per case.
export default jest.fn();
