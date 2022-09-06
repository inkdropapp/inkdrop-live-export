Inkdrop Live Export
===================

An [Inkdrop](https://www.inkdrop.app/) module which allows you to programmatically export notes to local filesystem via [the local HTTP server](https://docs.inkdrop.app/manual/accessing-the-local-database#accessing-via-http-advanced).
It supports live export, which continuously exports notes as the changes occur.

## Prerequisites

* NodeJS >= 16

## How to use it

### Enable the Inkdrop local server

Follow [the instruction in the documentation](https://docs.inkdrop.app/manual/accessing-the-local-database#accessing-via-http-advanced).

Now you should be able to invoke the API like so:

```sh
curl http://username:password@localhost:19840/
# => {"version":"5.5.1","ok":true}
```

## Install

Suppose that you have a static website project such as a blog or a documentation, and you are in its root directory.

```sh
cd <PROJECT_ROOT>
npm i -D @inkdropapp/live-export
```

## TODO

...

Check out [index.test.ts](./__tests__/index.test.ts) for usage at the moment.

