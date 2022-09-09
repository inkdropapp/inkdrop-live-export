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
  try {
    const res = await liveExport.callApi('/')
    expect(typeof res).toBe('object')
    expect(res.ok).toBe(true)
  } catch (e) {
    console.error(e)
    throw e
  }
})

test('Get latest sequence number', async () => {
  const res = await liveExport.getLatestSeq()
  expect(typeof res).toBe('number')
})

test('Get notes with bookId', async () => {
  const res = await liveExport.getNotes('book:-wDNxxN_a')
  expect(typeof res).toBe('object')
})

test('Export notes', async () => {
  const sub = await liveExport.start({
    live: true,
    bookId: 'book:-wDNxxN_a',
    preProcessNote: ({ note, frontmatter, tags }) => {
      frontmatter.title = note.title
      frontmatter.slug = toKebabCase(note.title)
      frontmatter.tags = tags.map(t => t.name)
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
        const fn = `${frontmatter.slug}_${toKebabCase(
          mdastNode.alt
        )}${extension}`
        const res = {
          filePath: `./tmp/${fn}`,
          url: `./${fn}`
        }
        if (mdastNode.alt === 'thumbnail') {
          frontmatter.heroImage = res.filePath
        }
        return res
      } else return false
    },
    postProcessNote: ({ md }) => {
      const md2 = md.replace(/\!\[thumbnail\]\(.*\)\n/, '')
      return md2
    }
  })
  expect(typeof sub).toBe('object')
  expect(typeof sub.stop).toBe('function')

  await setTimeout(59000)
  sub.stop()
})
