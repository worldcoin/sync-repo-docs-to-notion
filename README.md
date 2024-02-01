# Sync repository documentation to Notion

- markdown files sync supported only
- autofix relative repository urls
- syncs only updated documents
- no images support for now (instead please use mermaid.js embeddable diagrams)
- appends md5:hash to each document (to check for changes)

## Inputs

All configuration are done with environment variables for compatibility with other ci's.

## Outputs

## Example usage

### Unity Version Control

To use it in Unity DevOps, you will need to create a new build configuration for the Plastic (aka Unity VCS) repository. In the Advanced settings, set the environment variables described in the yaml below. `RELATIVE_URLS_ROOT` can be left blank. DEBUG = 1 will show additional console logs. Create a new shell script e.g. `readmeToNotion.sh` and paste the following:

```bash
#!/usr/bin/env bash

## Source profile
. ~/.profile

## Install NVM modules and set version
nvm install 16.20.0
nvm use 16.20.0

export FOLDER="./"

git clone https://github.com/ZeroSpace-Studios/sync-repo-docs-to-notion.git
node sync-repo-docs-to-notion/dist/index.js
```

Set either your pre-build script or post-build script to the `readmeToNotion.sh`. In the basic settings, also set Auto-build so that the README gets automatically updated in Notion whenever you've updated the project. (Currently this feature is not working as expected as Unity DevOps have decided to automatically cancel auto-build if your project fails to build).

See the `ZS_1123_VolumetricRnD` configuration as an example.

### GitHub Actions

See the `AnimationTools` repo as an example.

```yaml
on:
  push:
    branches:
      - master
jobs:
  notion_sync:
    timeout-minutes: 10
    runs-on: [ubuntu]
    steps:
      - uses: actions/checkout@v3
      - name: sync repo docs to notions
        uses: ZeroSpace-Studios/sync-repo-docs-to-notion@main
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_ROOT_PAGE_ID: https://www.notion.so/MyRootPage-jdskdjs8yd83dheeee
          FOLDER: "${{ github.workspace }}"
          RELATIVE_URLS_ROOT: "${{ github.server_url }}/${{ github.repository }}"
          IGNORE_CREATE_ERRORS: 1
          DEBUG: 1
```

or with manual launch:

```yaml
on: workflow_dispatch
```

or launch only if any .md files changed:

```yaml
on:
  push:
    branches:
      - master
jobs:
  notion_sync:
    timeout-minutes: 10
    runs-on: [ubuntu]
    steps:
      - uses: actions/checkout@v3
      - name: get changed files
        id: changed-files-specific
        uses: tj-actions/changed-files@v37
        with:
          files: |
            *.md
      - name: sync repo docs to notions
        if: steps.changed-files-specific.outputs.any_changed == 'true'
        uses: ZeroSpace-Studios/sync-repo-docs-to-notion@main
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_ROOT_PAGE_ID: https://www.notion.so/MyRootPage-jdskdjs8yd83dheeee
          FOLDER: "${{ github.workspace }}"
          RELATIVE_URLS_ROOT: "${{ github.server_url }}/${{ github.repository }}"
          IGNORE_CREATE_ERRORS: 1
          DEBUG: 1
```

### Warnings
- Deletion is slow, if you changed a lot of documents it's easier to cleanup Notion first, and then run the action


## Local installation

- install [nvm for windows](https://github.com/coreybutler/nvm-windows)
- nvm install 16.20.0
- nvm use 16.20.0
- clone this project
- navigate to cloned project
- npm install
- set environment variables:
```bash
$env:FOLDER=$pwd # your project root directory (where the README is located)
$env:NOTION_TOKEN='your_notion_token'
$env:NOTION_ROOT_PAGE_ID='your_page_id'
$env:RELATIVE_URLS_ROOT='null'
```
- node index.js
