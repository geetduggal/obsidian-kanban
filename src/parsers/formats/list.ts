import update from 'immutability-helper';
import { Content, List, Parent, Root } from 'mdast';
import { ListItem } from 'mdast-util-from-markdown/lib';
import { toString } from 'mdast-util-to-string';
import { stringifyYaml } from 'obsidian';
import { KanbanSettings } from 'src/Settings';
import { StateManager } from 'src/StateManager';
import { generateInstanceId } from 'src/components/helpers';
import {
  Board,
  BoardTemplate,
  Item,
  ItemData,
  ItemTemplate,
  Lane,
  LaneTemplate,
} from 'src/components/types';
import { laneTitleWithMaxItems } from 'src/helpers';
import { defaultSort } from 'src/helpers/util';
import { t } from 'src/lang/helpers';
import { visit } from 'unist-util-visit';

import { archiveString, completeString } from '../common';
import { DateNode, FileNode, TimeNode, ValueNode } from '../extensions/types';
import {
  ContentBoundary,
  getNextOfType,
  getNodeContentBoundary,
  getPrevSibling,
  getStringFromBoundary,
} from '../helpers/ast';
import { hydrateItem, preprocessTitle } from '../helpers/hydrateBoard';
import { extractInlineFields, taskFields } from '../helpers/inlineMetadata';
import {
  addBlockId,
  dedentNewLines,
  executeDeletion,
  indentNewLines,
  markRangeForDeletion,
  parseLaneTitle,
  removeBlockId,
  replaceBrs,
  replaceNewLines,
} from '../helpers/parser';
import { parseFragment } from '../parseMarkdown';

interface TaskItem extends ListItem {
  checkChar?: string;
}

export function listItemToItemData(stateManager: StateManager, md: string, item: TaskItem) {
  const moveTags = stateManager.getSetting('move-tags');
  const moveDates = stateManager.getSetting('move-dates');

  const startNode = item.children.first();
  const endNode = item.children.last();

  const start =
    startNode.type === 'paragraph'
      ? getNodeContentBoundary(startNode).start
      : startNode.position.start.offset;
  const end =
    endNode.type === 'paragraph'
      ? getNodeContentBoundary(endNode).end
      : endNode.position.end.offset;
  const itemBoundary: ContentBoundary = { start, end };

  let itemContent = getStringFromBoundary(md, itemBoundary);

  // Handle empty task
  if (itemContent === '[' + (item.checked ? item.checkChar : ' ') + ']') {
    itemContent = '';
  }

  let title = itemContent;
  let titleSearch = '';

  visit(
    item,
    ['text', 'wikilink', 'embedWikilink', 'image', 'inlineCode', 'code', 'hashtag'],
    (node: any, i, parent) => {
      if (node.type === 'hashtag') {
        if (!parent.children.first()?.value?.startsWith('```')) {
          titleSearch += ' #' + node.value;
        }
      } else {
        titleSearch += node.value || node.alt || '';
      }
    }
  );

  const itemData: ItemData = {
    titleRaw: removeBlockId(dedentNewLines(replaceBrs(itemContent))),
    blockId: undefined,
    title: '',
    titleSearch,
    titleSearchRaw: titleSearch,
    metadata: {
      dateStr: undefined,
      date: undefined,
      time: undefined,
      timeStr: undefined,
      tags: [],
      fileAccessor: undefined,
      file: undefined,
      fileMetadata: undefined,
      fileMetadataOrder: undefined,
    },
    checked: item.checked,
    checkChar: item.checked ? item.checkChar || '' : '',
  };

  visit(
    item,
    (node) => {
      return node.type !== 'paragraph';
    },
    (node, i, parent) => {
      const genericNode = node as ValueNode;

      if (genericNode.type === 'blockid') {
        itemData.blockId = genericNode.value;
        return true;
      }

      if (
        genericNode.type === 'hashtag' &&
        !(parent.children.first() as any)?.value?.startsWith('```')
      ) {
        if (!itemData.metadata.tags) {
          itemData.metadata.tags = [];
        }

        itemData.metadata.tags.push('#' + genericNode.value);

        if (moveTags) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'date' || genericNode.type === 'dateLink') {
        itemData.metadata.dateStr = (genericNode as DateNode).date;

        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'time') {
        itemData.metadata.timeStr = (genericNode as TimeNode).time;
        if (moveDates) {
          title = markRangeForDeletion(title, {
            start: node.position.start.offset - itemBoundary.start,
            end: node.position.end.offset - itemBoundary.start,
          });
        }
        return true;
      }

      if (genericNode.type === 'embedWikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }

      if (genericNode.type === 'wikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'link' && (genericNode as FileNode).fileAccessor) {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        itemData.metadata.fileMetadataOrder = (genericNode as FileNode).fileMetadataOrder;
        return true;
      }

      if (genericNode.type === 'embedLink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }
    }
  );

  itemData.title = preprocessTitle(stateManager, dedentNewLines(executeDeletion(title)));

  const firstLineEnd = itemData.title.indexOf('\n');
  const inlineFields = extractInlineFields(itemData.title, true);

  if (inlineFields?.length) {
    const inlineMetadata = (itemData.metadata.inlineMetadata = inlineFields.reduce((acc, curr) => {
      if (!taskFields.has(curr.key)) acc.push(curr);
      else if (firstLineEnd <= 0 || curr.end < firstLineEnd) acc.push(curr);

      return acc;
    }, []));

    const moveTaskData = stateManager.getSetting('move-task-metadata');
    const moveMetadata = stateManager.getSetting('inline-metadata-position') !== 'body';

    if (moveTaskData || moveMetadata) {
      let title = itemData.title;
      for (const item of [...inlineMetadata].reverse()) {
        const isTask = taskFields.has(item.key);

        if (isTask && !moveTaskData) continue;
        if (!isTask && !moveMetadata) continue;

        title = title.slice(0, item.start) + title.slice(item.end);
      }

      itemData.title = title;
    }
  }

  itemData.metadata.tags?.sort(defaultSort);

  return itemData;
}

function isArchiveLane(child: Content, children: Content[], currentIndex: number) {
  if (child.type !== 'heading' || toString(child, { includeImageAlt: false }) !== t('Archive')) {
    return false;
  }

  const prev = getPrevSibling(children, currentIndex);

  return prev && prev.type === 'thematicBreak';
}

export function astToUnhydratedBoard(
  stateManager: StateManager,
  settings: KanbanSettings,
  frontmatter: Record<string, any>,
  root: Root,
  md: string
): Board {
  const lanes: Lane[] = [];
  const archive: Item[] = [];
  const consumedListIndices = new Set<number>();

  root.children.forEach((child, index) => {
    if (child.type === 'heading') {
      const isArchive = isArchiveLane(child, root.children, index);
      const headingBoundary = getNodeContentBoundary(child as Parent);
      const title = getStringFromBoundary(md, headingBoundary);

      let shouldMarkItemsComplete = false;
      let listIndex = -1;

      // Find the next list after this heading, tracking its index
      for (let i = index + 1; i < root.children.length; i++) {
        const nextChild = root.children[i];

        if (nextChild.type === 'heading') {
          // Stop at next heading
          break;
        }

        if (nextChild.type === 'paragraph') {
          const childStr = toString(nextChild);
          if (childStr === t('Complete')) {
            shouldMarkItemsComplete = true;
            continue;
          }
        }

        if (nextChild.type === 'list') {
          listIndex = i;
          break;
        }
      }

      const list = listIndex !== -1 ? (root.children[listIndex] as List) : null;

      // Mark this list as consumed
      if (listIndex !== -1) {
        consumedListIndices.add(listIndex);
      }

      if (isArchive && list) {
        archive.push(
          ...list.children.map((listItem) => {
            return {
              ...ItemTemplate,
              id: generateInstanceId(),
              data: listItemToItemData(stateManager, md, listItem),
            };
          })
        );

        return;
      }

      if (!list) {
        lanes.push({
          ...LaneTemplate,
          children: [],
          id: generateInstanceId(),
          data: {
            ...parseLaneTitle(title),
            shouldMarkItemsComplete,
          },
        });
      } else {
        // Split list by checking line numbers for blank lines
        const listItemGroups: Item[][] = [];
        let currentGroup: Item[] = [];

        for (let i = 0; i < list.children.length; i++) {
          const listItem = list.children[i];

          // Check if there's a blank line before this item (except first item)
          if (i > 0) {
            const prevItem = list.children[i - 1];
            const prevEndLine = prevItem.position.end.line;
            const currentStartLine = listItem.position.start.line;

            // If line numbers differ by more than 1, there's a blank line
            if (currentStartLine - prevEndLine > 1) {
              // Start a new group
              listItemGroups.push(currentGroup);
              currentGroup = [];
            }
          }

          currentGroup.push({
            ...ItemTemplate,
            id: generateInstanceId(),
            data: listItemToItemData(stateManager, md, listItem),
          });
        }

        // Add the last group
        if (currentGroup.length > 0) {
          listItemGroups.push(currentGroup);
        }

        // Create lane for the first group (belongs to this heading)
        if (listItemGroups.length > 0) {
          lanes.push({
            ...LaneTemplate,
            children: listItemGroups[0],
            id: generateInstanceId(),
            data: {
              ...parseLaneTitle(title),
              shouldMarkItemsComplete,
            },
          });

          // Any additional groups become untitled lanes
          for (let i = 1; i < listItemGroups.length; i++) {
            lanes.push({
              ...LaneTemplate,
              children: listItemGroups[i],
              id: generateInstanceId(),
              data: {
                title: '',
                maxItems: undefined,
                shouldMarkItemsComplete: false,
              },
            });
          }
        }
      }
    }
  });

  // Handle root list - collect any list items that weren't consumed by headings
  // Split by blank lines to create separate untitled lanes
  root.children.forEach((child, index) => {
    if (child.type === 'list' && !consumedListIndices.has(index)) {
      const list = child as List;

      // Split list items by blank lines
      const listItemGroups: Item[][] = [];
      let currentGroup: Item[] = [];

      for (let i = 0; i < list.children.length; i++) {
        const listItem = list.children[i];

        // Check if there's a blank line before this item (except first item)
        if (i > 0) {
          const prevItem = list.children[i - 1];
          const prevEndLine = prevItem.position.end.line;
          const currentStartLine = listItem.position.start.line;

          // If line numbers differ by more than 1, there's a blank line
          if (currentStartLine - prevEndLine > 1) {
            // Start a new group
            listItemGroups.push(currentGroup);
            currentGroup = [];
          }
        }

        currentGroup.push({
          ...ItemTemplate,
          id: generateInstanceId(),
          data: listItemToItemData(stateManager, md, listItem),
        });
      }

      // Add the last group
      if (currentGroup.length > 0) {
        listItemGroups.push(currentGroup);
      }

      // Create an untitled lane for each group
      listItemGroups.forEach((group) => {
        lanes.push({
          ...LaneTemplate,
          children: group,
          id: generateInstanceId(),
          data: {
            title: '',
            maxItems: undefined,
            shouldMarkItemsComplete: false,
          },
        });
      });
    }
  });

  return {
    ...BoardTemplate,
    id: stateManager.file.path,
    children: lanes,
    data: {
      settings,
      frontmatter,
      archive,
      isSearching: false,
      errors: [],
    },
  };
}

export function updateItemContent(stateManager: StateManager, oldItem: Item, newContent: string) {
  // Use plain dash if no checkChar is set (empty string or undefined)
  let md: string;
  if (!oldItem.data.checkChar || oldItem.data.checkChar === '') {
    md = `- ${addBlockId(indentNewLines(newContent), oldItem)}`;
  } else {
    md = `- [${oldItem.data.checkChar}] ${addBlockId(indentNewLines(newContent), oldItem)}`;
  }

  const ast = parseFragment(stateManager, md);
  const itemData = listItemToItemData(stateManager, md, (ast.children[0] as List).children[0]);
  const newItem = update(oldItem, {
    data: {
      $set: itemData,
    },
  });

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function newItem(
  stateManager: StateManager,
  newContent: string,
  checkChar: string,
  forceEdit?: boolean
) {
  // Use plain dash if no checkChar is set (empty string or undefined)
  let md: string;
  if (!checkChar || checkChar === '') {
    md = `- ${indentNewLines(newContent)}`;
  } else {
    md = `- [${checkChar}] ${indentNewLines(newContent)}`;
  }

  const ast = parseFragment(stateManager, md);
  const itemData = listItemToItemData(stateManager, md, (ast.children[0] as List).children[0]);
  const shouldAutoCreateCardId = stateManager.getSetting('auto-create-card-id');

  if (shouldAutoCreateCardId && !itemData.blockId) {
    itemData.blockId = stateManager.nextCardId();
  }

  itemData.forceEditMode = !!forceEdit;

  const newItem: Item = {
    ...ItemTemplate,
    id: generateInstanceId(),
    data: itemData,
  };

  try {
    hydrateItem(stateManager, newItem);
  } catch (e) {
    console.error(e);
  }

  return newItem;
}

export function reparseBoard(stateManager: StateManager, board: Board) {
  try {
    return update(board, {
      children: {
        $set: board.children.map((lane) => {
          return update(lane, {
            children: {
              $set: lane.children.map((item) => {
                return updateItemContent(stateManager, item, item.data.titleRaw);
              }),
            },
          });
        }),
      },
    });
  } catch (e) {
    stateManager.setError(e);
    throw e;
  }
}

function itemToMd(item: Item) {
  // Use plain dash if no checkChar is set (empty string or undefined)
  if (!item.data.checkChar || item.data.checkChar === '') {
    return `- ${addBlockId(indentNewLines(item.data.titleRaw), item)}`;
  }
  return `- [${item.data.checkChar}] ${addBlockId(indentNewLines(item.data.titleRaw), item)}`;
}

function laneToMd(lane: Lane) {
  const lines: string[] = [];

  // Only write heading if title is not empty (root list has empty title)
  if (lane.data.title) {
    lines.push(`## ${replaceNewLines(laneTitleWithMaxItems(lane.data.title, lane.data.maxItems))}`);
    lines.push('');
  }

  if (lane.data.shouldMarkItemsComplete) {
    lines.push(completeString);
  }

  lane.children.forEach((item) => {
    lines.push(itemToMd(item));
  });

  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function archiveToMd(archive: Item[]) {
  if (archive.length) {
    const lines: string[] = [archiveString, '', `## ${t('Archive')}`, ''];

    archive.forEach((item) => {
      lines.push(itemToMd(item));
    });

    return lines.join('\n');
  }

  return '';
}

export function boardToMd(board: Board, stateManager?: StateManager) {
  const lanes = board.children.reduce((md, lane) => {
    return md + laneToMd(lane);
  }, '');

  // Merge board settings into frontmatter
  const combinedFrontmatter = {
    ...board.data.frontmatter,
    ...board.data.settings,
  };

  const frontmatter = ['---', '', stringifyYaml(combinedFrontmatter), '---', '', ''].join('\n');

  return frontmatter + lanes + archiveToMd(board.data.archive);
}
