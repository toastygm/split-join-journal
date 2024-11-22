function splitContent(page, heading) {
    if (!page || !heading) return [];

    const parts = splitHtml(page.text.content, heading);
    const pageEntries = [];
    for (let idx = 0; idx < parts.length; idx++) {
        let newName;
        let newContent = parts[idx];
        if (idx == 0) {
            newName = "Header";
            const header = newContent.trim();
            if (header == "") continue;
        } else {
            newName = $(parts[idx]).text();
            newContent = parts[++idx];
        }

        const pageData = {
            "name": newName || " ",
        }

        if (newContent) {
            pageData["text.content"] = newContent;
        }

        pageEntries.push(pageData);
    }

    return pageEntries;
}

function currentHeadings(html) {
    const content = $("<div>" + html + "</div>");
    const possibleHeadings = {
        "h1": game.i18n.localize("SPLITJOINJNL.HEADING1"),
        "h2": game.i18n.localize("SPLITJOINJNL.HEADING2"),
        "h3": game.i18n.localize("SPLITJOINJNL.HEADING3"),
        "h4": game.i18n.localize("SPLITJOINJNL.HEADING4"),
        "h5": game.i18n.localize("SPLITJOINJNL.HEADING5"),
        "h6": game.i18n.localize("SPLITJOINJNL.HEADING6"),
        "h7": game.i18n.localize("SPLITJOINJNL.HEADING7")
    }

    const existingHeadings = [];

    for (const heading in possibleHeadings) {
        const parts = content.find(heading);
        if (parts.length > 0) {
            existingHeadings.push([heading, possibleHeadings[heading]]);
        }
    }

    return existingHeadings;
}

function handleSplitPageContextMenu(html, options) {

    options.push({
        name: game.i18n.localize("SPLITJOINJNL.SPLITPAGE.contextMenu"),
        icon: '<i class="fas fa-list-ul"></i>',
        condition: game.user.isGM,
        callback: async (header) => {
            const pageId = header.data("page-id");
            const page = game.journal.reduce((foundPage, jnl) => {
                if (!foundPage) {
                    foundPage = jnl.pages.get(pageId);
                }
                return foundPage;
            }, undefined);
        
            // only enable context item for text pages, otherwise ignore
            if (page?.type != "text") {
                const msg = game.i18n.format("SPLITJOINJNL.SPLITPAGE.errorNotText", {journalName: page.parent.name, pageName: page.name});
                ui.notifications.info(msg);
                console.log(`split-join-journal | ${msg}`);
                return;
            }
        
            const availHeadings = currentHeadings(page.text.content);
            if (availHeadings.length) {
                const splitJournalPageDialog = 'modules/split-join-journal/templates/split-journal-page-dialog.html';
                const dialogOptions = {
                    "defaultJournalName": page.name,
                    "headings": {}
                };

                availHeadings.forEach(([key, val]) => {
                    dialogOptions.headings[key] = val;
                    if (!dialogOptions.defaultHeading) dialogOptions.defaultHeading = key;
                });
            
                const dlghtml = await renderTemplate(splitJournalPageDialog, dialogOptions);

                // request header level and new journal name
                Dialog.prompt({
                    title: game.i18n.localize("SPLITJOINJNL.SPLITPAGE.title"),
                    content: dlghtml.trim(),
                    label: game.i18n.localize("SPLITJOINJNL.SPLITPAGE.splitSubmit"),
                    rejectClose: false,
                    callback: async html => {
                        const form = html[0].querySelector("form");
                        const selectedHeading = form.selectedHeading.value;
                        const newJournalName = form.journalName.value;
                        splitJournalPageIntoSeparatePages(selectedHeading, page, newJournalName);
                    }
                });
            } else {
                const msg = game.i18n.format("SPLITJOINJNL.SPLITPAGE.errorNoHeadings", {journalName: page.parent.name, pageName: page.name});
                ui.notifications.info(msg);
                console.log(`split-join-journal | ${msg}`);
            }
        }
    });
}

/**
 * Add context menu item to a Journal to extract a JournalEntry page into 
 * @param {*} html 
 * @param {*} options 
 */
async function handleJournalContextMenu(html, options) {
    options.push({
        name: game.i18n.localize("SPLITJOINJNL.SPLITJOURNAL.contextMenu"),
        icon: '<i class="fas fa-split"></i>',
        condition: game.user.isGM,
        callback: async (header) => {
            const journalId = header.data("document-id");
            const journal = game.journal.get(journalId);
            const splitJournalDialog = 'modules/split-join-journal/templates/split-journal-dialog.html';
            const dialogOptions = {
                "defaultFolderName": journal.name
            };
        
            const dlghtml = await renderTemplate(splitJournalDialog, dialogOptions);

            // request header level and new journal name
            Dialog.prompt({
                title: game.i18n.localize("SPLITJOINJNL.SPLITJOURNAL.title"),
                content: dlghtml.trim(),
                label: game.i18n.localize("SPLITJOINJNL.SPLITJOURNAL.splitSubmit"),
                rejectClose: false,
                callback: async html => {
                    const form = html[0].querySelector("form");
                    const folderName = form.folderName.value;
                    splitJournalPagesIntoSeparateJournals(journal, folderName);
                }
            });

        }
    });
}

/**
 * Add context menu item to a folder to merge journals in a folder
 * into pages of a new journal
 * @param {String} html 
 * @param {Object} options 
 */
async function handleJournalFolderContextMenu(html, options) {
    options.push({
        name: game.i18n.localize("SPLITJOINJNL.MERGEFOLDER.contextMenu"),
        icon: '<i class="fas fa-code-merge"></i>',
        condition: li => game.user.isGM && game.folders.get(li.parent().data("folder-id"))?.contents.length,
        callback: async (header) => {
            const journalFolderId = header.parent().data("folder-id");
            const folder = game.folders.get(journalFolderId);
            mergeJournalFolderIntoSingleJournal(folder);
        }
    });
}

/**
 * Split each of the pages of a Journal into separate Journals (with one
 * page each).
 * 
 * @param {JournalEntry} journal Journal to split
 * @param {String} newFolderName If non-empty, the name of the new folder where journals
 * should be placed; otherwise journals will be placed in same folder as original journal
 * @returns 
 */
async function splitJournalPagesIntoSeparateJournals(journal, newFolderName) {
    let folder = journal.folder;

    if (!journal.pages.size) {
        ui.notifications.info(`Journal ${journal.name} has no pages`);
        return;
    }

    if (newFolderName) {
        folder = await Folder.create({name: newFolderName, folder: journal.folder, type: "JournalEntry", sorting: "m"});
    }
    
    for (let page of journal.pages) {
        const newJournal = await JournalEntry.create({name: page.name, folder: folder, sort: page.sort});

        const pageData = {
            name: page.name,
            type: page.type,
            src: page.src
        }

        switch (page.type) {
            case "text":
                Object.entries(flattenObject(page.text)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                break;

            case "image":
                Object.entries(flattenObject(page.image)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                break;

            case "video":
                Object.entries(flattenObject(page.video)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                break;
        }

        // Create a single page in the new journal with old page data
        JournalEntryPage.create(pageData, {parent: newJournal});
    }

}

/**
 * Split Journal Page into separate pages based on HTML headings.
 * @param {String} targetHeading HTML heading level to break on (e.g., h1)
 * @param {JournalEntryPage} page 
 * @param {String} newJournalName Name of new journal to create; otherwise all pages will be created
 * in current journal.
 */
async function splitJournalPageIntoSeparatePages(targetHeading, page, newJournalName) {
    const pageData = splitContent(page, targetHeading);

    if (!pageData?.length) {
        const msg = game.i18n.localize("SPLITJOINJNL.SPLITPAGE.errorJournalPageEmpty");
        ui.notifications.info(msg);
        console.log(`split-join-journal | ${msg}`);
        return;
    }

    let journal = page.parent;

    if (newJournalName.trim()) {
        // Journal name provided, so create pages in new journal
        journal = await JournalEntry.create({name: newJournalName.trim(), folder: page.parent.folder});
    }

    await JournalEntryPage.createDocuments(pageData, {parent: journal});
}

/**
 * Merge all of the Journal pages in a single folder into a new Journal with the same name as the original folder.
 * @param {Folder} folder source folder to merge
 */
async function mergeJournalFolderIntoSingleJournal(folder) {
    const newJournal = await JournalEntry.create({name: folder.name, folder: folder.folder});
    folder.contents.forEach(journal => {
        journal.pages.forEach(page => {
            const pageData = {
                name: `${journal.name} - ${page.name}`,
                type: page.type,
                src: page.src
            }
    
            switch (page.type) {
                case "text":
                    Object.entries(flattenObject(page.text)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                    break;
    
                case "image":
                    Object.entries(flattenObject(page.image)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                    break;
    
                case "video":
                    Object.entries(flattenObject(page.video)).forEach(([key, val]) => pageData[`text.${key}`] = val );
                    break;
            }
    
            // Create a single page in the new journal with old page data
            JournalEntryPage.create(pageData, {parent: newJournal});
        });
    });
}

// Add Split Journal to the entries
Hooks.on('getJournalSheetEntryContext', handleSplitPageContextMenu);
Hooks.on('getJournalDirectoryEntryContext', handleJournalContextMenu);
Hooks.on('getJournalDirectoryFolderContext', handleJournalFolderContextMenu);
