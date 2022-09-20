Inkdrop Live Export
===================

An [Inkdrop](https://www.inkdrop.app/) module which allows you to programmatically export notes to local filesystem via [the local HTTP server](https://docs.inkdrop.app/manual/accessing-the-local-database#accessing-via-http-advanced).
It supports live export, which continuously exports notes as the changes occur.

## Prerequisites

* NodeJS >= 16
* Inkdrop >= 5.5.1

## How to use it

### Enable the Inkdrop local server

Follow [the instruction in the documentation](https://docs.inkdrop.app/manual/accessing-the-local-database#accessing-via-http-advanced).

Now you should be able to invoke the API like so:

```sh
curl http://username:password@localhost:19840/
# => {"version":"5.5.1","ok":true}
```

### Install dev-tools plugin

It helps copy notebook IDs quickly from the context menu.

https://my.inkdrop.app/plugins/dev-tools

Then, copy a `bookId` of a notebook you'd like to export by right-clicking the notebook on the sidebar and select **Copy Notebook ID**.

![Copy notebook ID](https://github.com/inkdropapp/inkdrop-dev-tools/raw/v0.1.0/docs/copy-notebook-id.png)

### Install live-export

Suppose that you have a static website project such as a blog or a documentation, and you are in its root directory.

```sh
cd <PROJECT_ROOT>
npm i -D @inkdropapp/live-export
```

### Example

Create a file `import.mjs` (It must be an ES Module).
Initialize a live exporter:

```js
import { LiveExporter, toKebabCase } from '@inkdropapp/live-export'

const liveExport = new LiveExporter({
  username: 'foo',
  password: 'bar',
  port: 19840
})
```

Then, start exporting like so:

```js
const sub = await liveExport.start({
  live: true,
  bookId: '<YOUR_BOOK_ID>',
  preProcessNote: ({ note, frontmatter, tags }) => {
    frontmatter.title = note.title
    // Convert note title to kebab case (eg. "kebab-case-note-title")
    frontmatter.slug = toKebabCase(note.title)
    frontmatter.tags = tags.map(t => t.name)
  },
  pathForNote: ({ /* note, */ frontmatter }) => {
    // export only if it's public
    if (frontmatter.public) {
      return `./<PATH_TO_EXPORT_NOTES>/${frontmatter.slug}.md`
    } else return false
  },
  urlForNote: ({ frontmatter }) => {
    if (frontmatter.public) {
      return `/<URL_TO_LINK_NOTES>/${frontmatter.slug}`
    } else return false
  },
  pathForFile: ({ mdastNode, /* note, file, */ extension, frontmatter }) => {
    if (frontmatter.slug && mdastNode.alt) {
      const fn = `${frontmatter.slug}_${toKebabCase(
        mdastNode.alt
      )}${extension}`
      const res = {
        filePath: `./<PATH_TO_EXPORT_IMAGES>/${fn}`,
        url: `./<URL_TO_LINK_IMAGES>/${fn}`
      }
      if (mdastNode.alt === 'thumbnail') {
        frontmatter.heroImage = res.filePath
      }
      return res
    } else return false
  },
  postProcessNote: ({ md }) => {
    // Remove the thumbnail image from the Markdown body
    const md2 = md.replace(/\!\[thumbnail\]\(.*\)\n/, '')
    return md2
  }
})
```

If you would like to cancel/stop exporting:

```js
sub.stop()
```

And run it:

```sh
node --experimental-vm-modules import.mjs
```


## `start()` parameters

### `bookId: string`

The notebook ID to export. Required.

### `live?: boolean`

If true, it continuously exports as you change notes in Inkdrop.
If false, it performs one-time export.

`false` by default.

### `pathForNote(data)`

Generate a path to export the specified note

* `data.note`: [`Note`](https://docs.inkdrop.app/reference/data-models#note) - The note to export
* `data.frontmatter`: `Record<string, any>` - The YAML frontmatter of the note
* `data.tags`: An array of [`Tag`](https://docs.inkdrop.app/reference/data-models#tag) - The tags of the note
* Returns: `string | false | Promise<...>` - A destination path to export. If it returns false, the note will be skipped exporting.

### `urlForNote(data)`

Generate a URL for the specified note.
It is necessary to link from the note to another note.

* `data.note`: [`Note`](https://docs.inkdrop.app/reference/data-models#note) - The note to export
* `data.frontmatter`: `Record<string, any>` - The YAML frontmatter of the note
* `data.tags`: An array of [`Tag`](https://docs.inkdrop.app/reference/data-models#tag) - The tags of the note
* Returns: `string | false | Promise<...>` - A url/relative path. If it returns false, the note will be skipped processing.

### `pathForFile(data)`

Generate a path and URL to export the specified image file.

* `data.note`: [`Note`](https://docs.inkdrop.app/reference/data-models#note) - The note data
* `data.mdastNode`: [`Image`](https://github.com/syntax-tree/mdast#image) - The mdast node of the image
* `data.file`: [`File`](https://docs.inkdrop.app/reference/data-models#file) - The attached image file data to export
* `data.extension`: `string` - The file extension of the image (e.g., '.jpg', '.png')
* `data.frontmatter`: `Record<string, any>` - The YAML frontmatter of the note
* `data.tags`: An array of [`Tag`](https://docs.inkdrop.app/reference/data-models#tag) - The tags of the note
* Returns: `{ filePath: string; url: string } | false | Promise<...>` - A destination file path to export and url to link. If it returns false, the image will be skipped exporting.

### `preProcessNote(data)`

Pre-process the specified note.
It is useful to update the frontmatter information based on the note metadata.

* `data.note`: [`Note`](https://docs.inkdrop.app/reference/data-models#note) - The note data
* `data.frontmatter`: `Record<string, any>` - The YAML frontmatter of the note
* `data.tags`: An array of [`Tag`](https://docs.inkdrop.app/reference/data-models#tag) - The tags of the note
* `data.mdast`: [`Root`](https://github.com/syntax-tree/mdast#root) - The mdast root node of the note
* Returns: `any | Promise<any>`

### `postProcessNote(data)`

Post-process the specified note right before writing the note to a file.
It is useful to tweak the Markdown data (e.g., deleting unnecessary lines).

* `data.md`: `string` - The Markdown data
* `data.frontmatter`: `Record<string, any>` - The YAML frontmatter of the note
* `data.tags`: An array of [`Tag`](https://docs.inkdrop.app/reference/data-models#tag) - The tags of the note
* Returns: `string | Promise<string>` - Returns the processed Markdown string


## FAQ

### How can I see the access logs of the local server?

Run the app with a `--enable-logging` flag. See [the documentation](https://docs.inkdrop.app/manual/troubleshooting#enable-logging) for more detail.
