const fs = require('fs')
const crypto = require('crypto')

const { globSync } = require('glob')
const { markdownToBlocks } = require('@tryfabric/martian')
const { Client } = require('@notionhq/client')
const { title } = require('process')

const REQUIRED_ENV_VARS = ['FOLDER', 'NOTION_TOKEN', 'NOTION_ROOT_PAGE_ID', 'RELATIVE_URLS_ROOT']
const DEBUG = !!process.env.DEBUG
const IGNORE_CREATE_ERRORS = process.env.IGNORE_CREATE_ERRORS !== undefined ? !!process.env.IGNORE_CREATE_ERRORS : true

const DOCUMENT_HASH_TAG_REGEXP = /^md5:/

const notion = new Client({
  auth: process.env.NOTION_TOKEN
})

// TODO: delete page instead of many blocks for updates? (optionable)
// TODO: append github link to footer for each doc?
// FIX: fixing relative url ->  mailto:Protobuf@2.6
// TODO: NEXT: add folders list support ?
// TODO: how to import images?

const validateRequiredEnvVariables = () => {
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      console.log(`${varName} not provided`)
      process.exit(1)
    }
  })
}

const getNotionRootPageId = () => {
  const notionUrlMatch = process.env.NOTION_ROOT_PAGE_ID.match(/[^-]*$/)
  if (notionUrlMatch == null) {
    throw new SyntaxError('Provided page was not in a valid format, url must end with "-<page-id>"')
  }
  return notionUrlMatch[0]
}

const getFilesToProcess = () => {
  // let files = globSync(`${process.env.FOLDER}/**/*.md`, { ignore: 'node_modules/**' });
  // Currently only interested in uploading README files
  // let files = globSync(`${process.env.FOLDER}/**/README.md`, { ignore: 'node_modules/**', nocase: true });
  let files = globSync(`${process.env.FOLDER}/README.md`, { ignore: 'node_modules/**', nocase: true });

  let allFiles = globSync(`${process.env.FOLDER}/**/*`, { ignore: 'node_modules/**', nodir: true });
  console.log(process.env.FOLDER);
  files.forEach(file => {
      console.log(file);
  });

  console.log("all files:");
  allFiles.forEach(file => {
    console.log(file);
  });

  // pop readme to top
  const readmePath = `${process.env.FOLDER}/README.md`;
  if (files.includes(readmePath)) {
    files = files.filter((path) => path !== readmePath);
    files.unshift(readmePath);
  }

  // Create a map mapping title (first heading) to file path
  const filesToHeadings = files.reduce((acc, filePath) => {
    const title = titleFromFirstHeading(filePath);
    acc.set(title, filePath);
    return acc;
  }, new Map());

  return filesToHeadings;
};

const deleteBlocksSequentially = function(idsToDelete) {
  // Check if the array is empty and resolve immediately if it is
  if (!idsToDelete || idsToDelete.length === 0) {
    return Promise.resolve();
  }

  const deleteOne = (index) => {
    return new Promise((resolve, reject) => {
      const id = idsToDelete[index];
      notion.blocks.delete({ block_id: id })
        .then(() => {
          console.log('Block deleted:', id);

          // If there are more IDs to delete, call deleteOne recursively
          if (index < idsToDelete.length - 1) {
            resolve(deleteOne(index + 1));
          } else {
            console.log('Block deletion complete');
            resolve();
          }
        })
        .catch((error) => {
          reject(error);
        });
    });
  };

  // Start the deletion process with the first ID in the array
  return deleteOne(0);
};

const deepReplaceValue = (target, lookupKey, newValueFn) => {
  if (Array.isArray(target)) {
    target.forEach((obj) => {
      deepReplaceValue(obj, lookupKey, newValueFn)
    })
  } else if (typeof target === 'object') {
    for (const key in target) {
      if (typeof target[key] === 'object') {
        deepReplaceValue(target[key], lookupKey, newValueFn)
      } else {
        if (key === lookupKey) {
          target[key] = newValueFn(target[key])
        }
      }
    }
  }
  return target
}

const titleFromFirstHeading = (filePath) => {
  // Read the content of the file
  const fileContent = fs.readFileSync(filePath, 'utf8');

  // Use a regular expression to find the first Markdown heading
  const match = fileContent.match(/^#\s*(.+)/m);
  if (match && match[1]) {
    // Return the first heading without the '# ' prefix
    return match[1].trim();
  } else {
    // If no heading is found, return a default title or handle it as needed
    return 'Default Title';
  }
}

const fileToNotionBlocks = (filePath) => {
  const mdContent = fs.readFileSync(filePath, 'utf8')
  let newBlocks = markdownToBlocks(mdContent)

  const fileHash = crypto.createHash('md5').update(mdContent).digest('hex')
  const hashBlock = markdownToBlocks(`md5:${fileHash}`)
  newBlocks.push(hashBlock[0])

  // fix relative urls
  newBlocks = deepReplaceValue(JSON.parse(JSON.stringify(newBlocks)), 'url', (url) => {
    if (url.match(/^http/)) {
      return url
    } else if (url.match(/^#/)) {
      DEBUG && console.log('fixing #-url -> ', url)
      // FIXME: don't know what to do with this problem
      //        url likes this:
      //        #1.-сделки-и-договоры-сделки-post
      return process.env.RELATIVE_URLS_ROOT
    // } else if (url.match(/\.png$|\.jpg$|\.jpeg$|\.webp/)) {
    //   DEBUG && console.log('fixing img url -> ', url)
    //   return `${process.env.RELATIVE_URLS_ROOT}/blob/master/${url}`
    } else {
      DEBUG && console.log('fixing relative url -> ', url)
      return `${process.env.RELATIVE_URLS_ROOT}/tree/master/${url}`
    }
  })

  return newBlocks
}

const createPagesSequentially = (pageTitleToFileMap, rootPage) => {
  // Check if the array is empty and resolve immediately if it is
  if (!pageTitleToFileMap || pageTitleToFileMap.length === 0) {
    return Promise.resolve();
  }

  const entries = Array.from(pageTitleToFileMap.entries());

  const createOne = (index) => {
    return new Promise((resolve, reject) => {
      if (index >= entries.length) {
        return resolve();
      }

      const [title, filePath] = entries[index];
      const newBlocks = fileToNotionBlocks(filePath); // Convert file to Notion blocks using the filePath

      notion.pages.create({
        parent: {
          type: 'page_id',
          page_id: rootPage.id
        },
        properties: {
          title: {
            title: [{ text: { content: title } }], type: 'title'
          }
        }
      }).then((pageResponse) => {
        console.log('Page created', title);

        notion.blocks.children.append({ block_id: pageResponse.id, children: newBlocks }).then(() => {
          // Check if there are more entries to process
          if (index < entries.length - 1) {
            resolve(createOne(index + 1));
          } else {
            resolve();
          }
        }).catch((error) => {
          if (IGNORE_CREATE_ERRORS) {
            console.log('Blocks appending failed, but error ignored', error);
            if (index < entries.length - 1) {
              resolve(createOne(index + 1));
            } else {
              resolve();
            }
          } else {
            reject(error);
          }
        });
      }).catch((error) => {
        reject(error);
      });
    });
  };

  // Start the page creation process with the first entry in the Map
  return createOne(0);
};

const updatePagesSequentially = (titlesToIdMap, titlesToPathsMap, blocksWithChildPages) => {
  // Check if the array is empty and resolve immediately if it is
  if (!titlesToIdMap || titlesToIdMap.length === 0) {
    return Promise.resolve();
  }
    
  const titles = Array.from(titlesToIdMap.keys());

  const updateOne = (titleIndex) => {
    return new Promise((resolve, reject) => {
      if (titleIndex >= titles.length) {
        return resolve();
      }
      const title = titles[titleIndex];
      const filepath = titlesToPathsMap.get(title);
      const pageId = titlesToIdMap.get(filepath);

      const blockWithChildPage = blocksWithChildPages.find((r) => r.child_page?.id === pageId);

      if (!blockWithChildPage) {
        console.log('block not found on readme, skip ... (this is error)', filepath);
        return resolve(updateOne(titleIndex + 1)); // Move to the next file
      }

      notion.blocks.children.list({ block_id: blockWithChildPage.id }).then((pageBlocksResponse) => {
        const updatedNotionBlocks = fileToNotionBlocks(filepath)

        // change detection
        let isChanged = false
        const fileContent = fs.readFileSync(filepath, 'utf8')
        const fileMD5 = crypto.createHash('md5').update(fileContent).digest('hex')
        const md5Block = pageBlocksResponse.results.slice(-1)[0]
        const md5RichText = md5Block?.paragraph?.rich_text[0]

        if (md5RichText?.text?.content?.match(DOCUMENT_HASH_TAG_REGEXP)) {
          const md5 = md5RichText.text.content.split(DOCUMENT_HASH_TAG_REGEXP).slice(-1)[0]

          if (md5 !== fileMD5) isChanged = true
        } else {
          isChanged = true
        }

        DEBUG && console.log('is changed ->', filepath, isChanged)

        const idsToRemove = pageBlocksResponse.results.map((e) => e.id)

        if (isChanged) {
          deleteBlocksSequentially(idsToRemove).then(() => {
            // update page with new content
            notion.blocks.children.append({
              block_id: blockWithChildPage.id,
              children: updatedNotionBlocks
            }).then(() => {
              return resolve()
            }).catch((error) => {
              if (IGNORE_CREATE_ERRORS) {
                console.log('Blocks appending failed, error ignored', error)
                console.log('Try append error on page')

                const errorBlocks = markdownToBlocks(`Blocks appending failed with error: ${error}`)

                notion.blocks.children.append({
                  block_id: blockWithChildPage.id,
                  children: errorBlocks
                }).then(() => {
                  return resolve()
                })
                return resolve()
              } else {
                reject(error)
              }
            })
          })
        } else {
          return resolve()
        }
      });
    });
  };
  return updateOne(0); // Start with the first file
}

const run = function () {
  DEBUG && console.log('Running inside folder: ', process.env.FOLDER)

  notion.pages.retrieve({ page_id: getNotionRootPageId() }).then((rootPage) => {
    // DEBUG && console.log('Files to sync ->', filesToCreate)
    // const toCreate = filesToCreate.map((e) => titleFromFilePath(e))

    notion.blocks.children.list({ block_id: getNotionRootPageId() }).then((blocksResponse) => {
      const blocksTitlesToIds = new Map();
      blocksResponse.results.forEach(block => {
        if (block.child_page && block.child_page.title && block.id) {
          blocksTitlesToIds.set(block.child_page.title, block.id);
        }
      });
      
      const filesTitlesToPaths = getFilesToProcess(); // Assuming this returns a Map
    
      // title -> id
      const updateMap = new Map();
    
      filesTitlesToPaths.forEach((path, title) => {
        if (blocksTitlesToIds.has(title)) {
          updateMap.set(title, blocksTitlesToIds.get(title));
        }
      });

      const filePathMap = new Map();
      filesTitlesToPaths.forEach((path, title) => {
        filePathMap.set(title, path);
      })
    
      // title -> path
      const createMap = new Map();
    
      filesTitlesToPaths.forEach((path, title) => {
        if (!blocksTitlesToIds.has(title)) {
          createMap.set(title, path);
        }
      });
    
      const deleteList = [];
    
      blocksTitlesToIds.forEach((id, title) => {
        if (!filesTitlesToPaths.has(title)) {
          deleteList.push(id);
        }
      });

      console.log('updateList ->', updateMap);
      console.log('createList ->', createMap);
      // console.log('deleteList ->', deleteList);

      updatePagesSequentially(updateMap, filePathMap, blocksResponse.results).then(() => {
        console.log('--- all pages updated')

        createPagesSequentially(createMap, rootPage).then(() => {
          console.log('--- new pages created')

          // Disable deletion for now - not needed for our use case
          // deleteBlocksSequentially(deleteList).then(() => {
          //   console.log('--- sync complete')
          // })
        })
      })
    })
  }).catch((error) => {
    console.log('Root page not found', error)
    process.exit(1)
  })
}

validateRequiredEnvVariables()
run()
