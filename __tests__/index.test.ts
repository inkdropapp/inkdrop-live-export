import { LiveExporter, toKebabCase } from '../src'
import { setTimeout } from 'timers/promises'
import { jest } from '@jest/globals'

let liveExport: LiveExporter

jest.setTimeout(60000)

beforeAll(() => {
  liveExport = new LiveExporter({
    username: 'foo',
    password: 'bar',
    port: 19841
  })
})

test('Check API reachability', async () => {
  const res = await liveExport.callApi('/')
  expect(typeof res).toBe('object')
  expect(res.ok).toBe(true)
})

test('Get latest sequence number', async () => {
  const res = await liveExport.getLatestSeq()
  expect(typeof res).toBe('number')
})

test('Get notes with bookId', async () => {
  const res = await liveExport.getNotes(
    'book:9dc6a7a7-a0e4-4eeb-997c-32b385767dc2'
  )
  expect(typeof res).toBe('object')
})

test('Export notes', async () => {
  const sub = await liveExport.start({
    live: true,
    bookId: 'book:9dc6a7a7-a0e4-4eeb-997c-32b385767dc2',
    preProcessNote: ({ note, frontmatter }) => {
      frontmatter.title = note.title
      frontmatter.slug = toKebabCase(note.title)
    },
    pathForNote: ({ /* note, */ frontmatter }) => {
      if (frontmatter.public) {
        return `./tmp/${frontmatter.slug}.md`
      } else return false
    },
    urlForNote: ({ frontmatter }) => {
      if (frontmatter.public) {
        return `./${frontmatter.slug}.md`
      } else return false
    },
    pathForFile: ({ mdastNode, /* note, file, */ extension, frontmatter }) => {
      if (frontmatter.slug && mdastNode.alt) {
        const fn = `${frontmatter.slug}_${mdastNode.alt}${extension}`
        return {
          filePath: `./tmp/${fn}`,
          url: `./${fn}`
        }
      } else return false
    }
  })
  expect(typeof sub).toBe('object')
  expect(typeof sub.stop).toBe('function')

  await setTimeout(59000)
  sub.stop()
})
