import debug from 'debug'
import fs from 'fs'
import { Note, File as IDFile } from 'inkdrop-model'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkStringify from 'remark-stringify'
import { Root } from 'remark-parse/lib/index.js'
import { visit } from 'unist-util-visit'
import yaml from 'js-yaml'
import { YAML, Image as ImageNode } from 'mdast'

const log = debug('inkdrop:export')

type YAMLData = Record<string, any>

interface LiveExportConfig {
  hostname?: string
  username: string
  password: string
  port: number
}

interface ExportParams {
  bookId: string
  since?: number
  filter?: (note: Note) => boolean
  pathForNote: (data: {
    note: Note
    frontmatter: YAMLData
  }) => string | undefined | null | false
  pathForFile: (data: {
    mdastNode: ImageNode
    note: Note
    file: IDFile
    extension: string
    frontmatter: YAMLData
  }) => { filePath: string; url: string } | undefined | null | false
  onPreProcess?: (note: Note) => Note
  onPreExport?: (data: string) => string
}

export class LiveExporter {
  config: LiveExportConfig
  fileNameMap: { [id: string]: string } = {}

  constructor(config: LiveExportConfig) {
    this.config = config
  }

  async callApi(path: string, query: Record<string, any> = {}) {
    const { hostname, username, password, port } = this.config
    const headers = new Headers()
    headers.set(
      'Authorization',
      'Basic ' + Buffer.from(username + ':' + password).toString('base64')
    )
    const url = new URL(`http://${hostname || 'localhost'}:${port}${path}`)
    log('query:', query)
    Object.keys(query).forEach(key => url.searchParams.append(key, query[key]))
    log('url:', url)

    const response = await fetch(url, {
      method: 'GET',
      headers
    }).then(response => response.json())

    return response
  }

  async getLatestSeq(): Promise<number> {
    const res = await this.callApi('/_changes', {
      include_docs: false,
      descending: true,
      limit: 1
    })
    return res.last_seq
  }

  async getChanges(since: number) {
    return this.callApi('/_changes', {
      since,
      include_docs: true
    })
  }

  async getNotes(bookId: string): Promise<Note[]> {
    return this.callApi('/notes', {
      keyword: `bookId:${bookId}`,
      sort: 'updatedAt',
      descending: true
    })
  }

  async getFile(fileId: string): Promise<IDFile> {
    return this.callApi(`/${fileId}`, {
      attachments: true
    })
  }

  getYamlFrontmatter(tree: Root): Record<string, any> {
    const yamlNode = tree.children.find(child => child.type === 'yaml') as
      | YAML
      | undefined
    const yamlData = (yaml.load(yamlNode?.value || '') as any) || {}
    return yamlData
  }

  extractImages(tree: Root) {
    const images: ImageNode[] = []
    visit(tree, { type: 'image' }, el => {
      images.push(el as ImageNode)
    })
    return images
  }

  getExtensionForFile(file: IDFile) {
    switch (file.contentType) {
      case 'image/jpeg':
        return '.jpg'
      case 'image/svg+xml':
        return '.svg'
      default:
        return '.' + file.contentType.split('/')[1]
    }
  }

  writeFile(toPath: string, file: IDFile) {
    const oldPath = this.fileNameMap[file._id]
    if (oldPath && oldPath !== toPath) {
      fs.unlinkSync(oldPath)
    }

    const base64Data = file._attachments.index.data as string
    const data = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(toPath, data)
  }

  writeNote(toPath: string, noteId: string, md: string) {
    const oldPath = this.fileNameMap[noteId]
    if (oldPath && oldPath !== toPath) {
      fs.unlinkSync(oldPath)
    }
    fs.writeFileSync(toPath, md)
  }

  async exportNote(note: Note, params: ExportParams) {
    log('exporting note:', note.body)
    if (params.onPreProcess) {
      note = params.onPreProcess(note)
    }
    let md = note.body
    const tree = unified().use(remarkParse).use(remarkFrontmatter).parse(md)
    const yamlData = this.getYamlFrontmatter(tree)
    const images = this.extractImages(tree)
    log('tree:', JSON.stringify(tree, null, 4))
    log('yaml data:', yamlData)
    log('images:', images)

    const fnNote = params.pathForNote({ note, frontmatter: yamlData })

    if (fnNote) {
      for (const i of images.reverse()) {
        const { url } = i
        if (url.startsWith('inkdrop://file:')) {
          const [, fileId] = url.match(/inkdrop:\/\/([^\/]*)/) || []
          if (fileId) {
            try {
              const idFile = await this.getFile(fileId)
              const ext = this.getExtensionForFile(idFile)
              const { filePath: fnFile, url: urlFile } =
                params.pathForFile({
                  mdastNode: i,
                  note,
                  file: idFile,
                  extension: ext,
                  frontmatter: yamlData
                }) || {}
              log('file:', idFile)
              log('destF:', fnFile)
              const start = i.position?.start?.offset
              const end = i.position?.end?.offset
              if (
                fnFile &&
                urlFile &&
                typeof start === 'number' &&
                typeof end === 'number'
              ) {
                this.writeFile(fnFile, idFile)
                this.fileNameMap[idFile._id] = fnFile
                const mdImage: ImageNode = {
                  ...i,
                  url: urlFile
                }
                const mdImageStr = unified()
                  .use(remarkStringify)
                  .stringify({ type: 'root', children: [mdImage] })
                md = md.substring(0, start) + mdImageStr + md.substring(end + 1)
              }
            } catch (e) {
              log('Failed to get a file:', fileId, i)
              log(e)
            }
          }
        }
      }

      this.writeNote(fnNote, note._id, md)
      this.fileNameMap[note._id] = fnNote
    }
  }

  async watchChanges(params: ExportParams) {
    let since = params.since ?? (await this.getLatestSeq())
    const timer = setInterval(async () => {
      try {
        const { results, last_seq } = await this.getChanges(since)
        for (const change of results) {
          if (
            change.id.startsWith('note:') &&
            change.doc.bookId === params.bookId
          ) {
            const note = change.doc
            await this.exportNote(note, params)
          }
          const fnForId = this.fileNameMap[change.id]
          if (change.doc._deleted && fnForId) {
            fs.unlinkSync(fnForId)
            delete this.fileNameMap[change.id]
          }
        }

        since = last_seq
      } catch (e) {
        log(e)
        clearInterval(timer)
      }
    }, 500)

    return {
      stop: () => {
        clearInterval(timer)
      }
    }
  }

  async start(params: ExportParams) {
    const notes = await this.getNotes(params.bookId)
    for (const n of notes) {
      await this.exportNote({ ...n }, params)
    }

    return this.watchChanges(params)
  }
}
