import debug from 'debug'
import fs from 'fs'
import { Note, File as IDFile } from 'inkdrop-model'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkStringify from 'remark-stringify'
import { visit } from 'unist-util-visit'
import yaml from 'js-yaml'
import { YAML, Image as ImageNode, Link as LinkNode, Root } from 'mdast'

const log = debug('inkdrop:export')

type YAMLData = Record<string, any>

interface LiveExportConfig {
  hostname?: string
  username: string
  password: string
  port: number
}

interface ExportParams {
  live?: boolean
  bookId: string
  since?: number
  filter?: (note: Note) => boolean
  pathForNote: (data: {
    note: Note
    frontmatter: YAMLData
  }) =>
    | string
    | undefined
    | null
    | false
    | Promise<string | undefined | null | false>
  urlForNote?: (data: {
    note: Note
    frontmatter: YAMLData
  }) =>
    | string
    | undefined
    | null
    | false
    | Promise<string | undefined | null | false>
  pathForFile: (data: {
    mdastNode: ImageNode
    note: Note
    file: IDFile
    extension: string
    frontmatter: YAMLData
  }) =>
    | { filePath: string; url: string }
    | undefined
    | null
    | false
    | Promise<{ filePath: string; url: string } | undefined | null | false>
  preProcessNote?: (data: {
    note: Note
    frontmatter: YAMLData
    mdast: Root
  }) => any
  postProcessNote?: (data: { md: string; frontmatter: YAMLData }) => string
}

export const extractDocIdFromUri = (uri: string): string | undefined => {
  const [, fileId] = uri.match(/inkdrop:\/\/([^\/]*)/) || []
  return fileId
}

export class LiveExporter {
  config: LiveExportConfig
  fileNameMap: { [id: string]: string } = {}
  exportParams: ExportParams | undefined

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
    const url = new URL(`http://${hostname || '127.0.0.1'}:${port}${path}`)
    Object.keys(query).forEach(key => url.searchParams.append(key, query[key]))

    const response = await fetch(url, {
      method: 'GET',
      headers
    }).then(response => response.json())
    log('response:', response)

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

  async getDoc(docId: string, options: Record<string, any> = {}): Promise<any> {
    return this.callApi(`/${docId}`, options)
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
    this.fileNameMap[file._id] = toPath
  }

  writeNote(toPath: string, noteId: string, md: string) {
    const oldPath = this.fileNameMap[noteId]
    if (oldPath && oldPath !== toPath) {
      fs.unlinkSync(oldPath)
    }
    fs.writeFileSync(toPath, md)
    this.fileNameMap[noteId] = toPath
  }

  removeExportedFile(docId: string) {
    const filePath = this.fileNameMap[docId]
    if (filePath) {
      fs.unlinkSync(filePath)
      delete this.fileNameMap[docId]
    }
  }

  async parseNote(note: Note, params: ExportParams) {
    const md = note.body
    const tree = unified().use(remarkParse).use(remarkFrontmatter).parse(md)
    const yamlNode = tree.children.find(child => child.type === 'yaml') as
      | YAML
      | undefined
    const yamlData = (yaml.load(yamlNode?.value || '') as any) || {}

    if (params.preProcessNote) {
      params.preProcessNote({ note, frontmatter: yamlData, mdast: tree })
    }

    log('tree:', JSON.stringify(tree, null, 4))
    log('yaml data:', yamlData)

    return {
      note: note,
      tree,
      yamlNode,
      yamlData
    }
  }

  async exportNote(note: Note, params: ExportParams) {
    log('exporting note:', note.body)
    let md = note.body
    const { tree, yamlNode, yamlData } = await this.parseNote(note, params)

    const fnNote = await params.pathForNote({ note, frontmatter: yamlData })

    if (fnNote) {
      const nodes: (ImageNode | LinkNode)[] = []
      visit(
        tree,
        [{ type: 'image' }, { type: 'link' }],
        el => {
          if (el.type === 'image' && el.url.startsWith('inkdrop://file:')) {
            nodes.push(el)
          } else if (
            el.type === 'link' &&
            el.url.startsWith('inkdrop://note/')
          ) {
            nodes.push(el)
          }
        },
        true // reverse
      )

      for (const node of nodes) {
        /*
         * Process internal images
         */
        if (node.type === 'image') {
          const fileId = extractDocIdFromUri(node.url)
          if (fileId) {
            try {
              const idFile: IDFile = await this.getDoc(fileId, {
                attachments: true
              })
              const ext = this.getExtensionForFile(idFile)
              const { filePath: fnFile, url: urlFile } =
                (await params.pathForFile({
                  mdastNode: node,
                  note,
                  file: idFile,
                  extension: ext,
                  frontmatter: yamlData
                })) || {}
              log('file:', idFile)
              log('destF:', fnFile)
              const start = node.position?.start?.offset
              const end = node.position?.end?.offset
              if (
                fnFile &&
                urlFile &&
                typeof start === 'number' &&
                typeof end === 'number'
              ) {
                this.writeFile(fnFile, idFile)
                const mdImage: ImageNode = {
                  ...node,
                  url: urlFile
                }
                const mdImageStr = unified()
                  .use(remarkStringify)
                  .stringify({ type: 'root', children: [mdImage] })
                md = md.substring(0, start) + mdImageStr + md.substring(end + 1)
              } else {
                this.removeExportedFile(fileId)
              }
            } catch (e) {
              log('Failed to get a file:', fileId, node)
              log(e)
            }
          }
        } else if (node.type === 'link') {
          /*
           * Process internal links
           */
          const [, noteIdPre] =
            node.url.match(/inkdrop:\/\/(note\/([^\/]*))/) || []
          if (noteIdPre && params.urlForNote) {
            const linkDestNoteId = noteIdPre.replace('/', ':')
            const linkDestNote: Note = await this.getDoc(linkDestNoteId)
            const { yamlData } = await this.parseNote(note, params)
            log('process internal link:', node, linkDestNoteId, yamlData)
            const url = await params.urlForNote({
              note: linkDestNote,
              frontmatter: yamlData
            })
            const start = node.position?.start?.offset
            const end = node.position?.end?.offset
            if (url && start && end) {
              const mdLink: LinkNode = {
                ...node,
                url
              }
              const mdLinkStr = unified()
                .use(remarkStringify)
                .stringify({ type: 'root', children: [mdLink] })
              md = md.substring(0, start) + mdLinkStr + md.substring(end + 1)
            }
          }
        }
      }

      if (yamlNode) {
        md =
          md.substring(0, yamlNode.position?.start.offset || 0) +
          `---\n` +
          yaml.dump(yamlData) +
          `---` +
          md.substring(yamlNode.position?.end.offset || 0 + 1)
      }

      md = params.postProcessNote
        ? params.postProcessNote({ md, frontmatter: yamlData })
        : md
      this.writeNote(fnNote, note._id, md)
    } else {
      this.removeExportedFile(note._id)
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
          if (change.doc._deleted) {
            this.removeExportedFile(change.id)
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

  async start(
    params: ExportParams & { live: true }
  ): Promise<{ stop: () => void }>
  async start(params: ExportParams & { live: undefined | false }): Promise<true>
  async start(params: ExportParams) {
    this.exportParams = params
    const notes = await this.getNotes(params.bookId)
    for (const n of notes) {
      await this.exportNote({ ...n }, params)
    }

    if (params.live) {
      return this.watchChanges(params)
    } else {
      return true
    }
  }
}

export const kebabCaseToPascalCase = (string = '') => {
  return string.replace(/(^\w|-\w)/g, replaceString =>
    replaceString.replace(/-/, '').toUpperCase()
  )
}

export const toKebabCase = (str: string) => {
  return str
    .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    ?.map(x => x.toLowerCase())
    ?.join('-')
}
