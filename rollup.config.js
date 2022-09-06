import path from 'path'
import packageJson from './package.json'
import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'

const baseName = path.join('lib', 'index')

export default [
  {
    input: 'src/index.ts',
    output: [
      {
        file: `${baseName}.cjs`,
        format: 'cjs',
        strict: true,
        sourcemap: true,
        exports: 'auto'
      },
      {
        file: `${baseName}.js`,
        format: 'esm',
        strict: true,
        sourcemap: true
      }
    ],
    external: [
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.peerDependencies || [])
    ],
    plugins: [typescript(), resolve()]
  }
]
