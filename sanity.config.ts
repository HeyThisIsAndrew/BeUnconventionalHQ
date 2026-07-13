import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './schema'

export default defineConfig({
  name: 'default',
  title: 'Be Unconventional HQ',

  projectId: '38nhxsib',
  dataset: 'production',

  plugins: [structureTool()],

  schema: {
    types: schemaTypes,
  },
})
