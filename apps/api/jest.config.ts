export default {
  displayName: 'candidate-api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Los e2e tienen su propia config (jest.e2e.config.ts): son lentos y
  // levantan Mongo en memoria.
  testPathIgnorePatterns: ['<rootDir>/src/e2e/'],
  coverageDirectory: '../../coverage/apps/api',
};
