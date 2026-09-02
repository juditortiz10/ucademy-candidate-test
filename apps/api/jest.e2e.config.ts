/**
 * Configuración de los tests e2e.
 *
 * Van aparte de los unitarios porque arrancan la aplicación Nest completa y
 * levantan un MongoDB en memoria: son más lentos y descargan un binario la
 * primera vez. Así `npm run test:api` sigue siendo rápido y sin dependencias
 * externas.
 */
export default {
  displayName: 'candidate-api-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/src/e2e/**/*.e2e-spec.ts'],
  maxWorkers: 1,
};
