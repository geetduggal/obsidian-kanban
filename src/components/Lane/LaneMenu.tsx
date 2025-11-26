import update from 'immutability-helper';
import { Menu, Platform, TFile } from 'obsidian';
import { Dispatch, StateUpdater, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import { Path } from 'src/dnd/types';
import { defaultSort } from 'src/helpers/util';
import { t } from 'src/lang/helpers';
import { lableToName } from 'src/parsers/helpers/inlineMetadata';

import { FileSuggestModal, LaneSuggestModal } from '../FileSuggest/FileSuggestModal';
import { anyToString } from '../Item/MetadataTable';
import { KanbanContext } from '../context';
import { c, generateInstanceId } from '../helpers';
import { EditState, Lane, LaneSort, LaneTemplate } from '../types';

export type LaneAction = 'delete' | 'archive' | 'archive-items' | null;

const actionLabels = {
  delete: {
    description: t('Are you sure you want to delete this list and all its cards?'),
    confirm: t('Yes, delete list'),
  },
  archive: {
    description: t('Are you sure you want to archive this list and all its cards?'),
    confirm: t('Yes, archive list'),
  },
  'archive-items': {
    description: t('Are you sure you want to archive all cards in this list?'),
    confirm: t('Yes, archive cards'),
  },
};

export interface ConfirmActionProps {
  lane: Lane;
  action: LaneAction;
  cancel: () => void;
  onAction: () => void;
}

export function ConfirmAction({ action, cancel, onAction, lane }: ConfirmActionProps) {
  useEffect(() => {
    // Immediately execute action if lane is empty
    if (action && lane.children.length === 0) {
      onAction();
    }
  }, [action, lane.children.length]);

  if (!action || (action && lane.children.length === 0)) return null;

  return (
    <div className={c('action-confirm-wrapper')}>
      <div className={c('action-confirm-text')}>{actionLabels[action].description}</div>
      <div>
        <button onClick={onAction} className={c('confirm-action-button')}>
          {actionLabels[action].confirm}
        </button>
        <button onClick={cancel} className={c('cancel-action-button')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

async function handleMoveLaneToFile(
  stateManager: any,
  boardModifiers: any,
  lane: Lane,
  path: Path
) {
  const app = stateManager.app;

  const fileSuggest = new FileSuggestModal(app, async (targetFile) => {
    try {
      console.log('Moving lane to file:', targetFile.path);
      console.log('Lane data:', lane.data.title, 'Cards:', lane.children.length);

      const content = await app.vault.read(targetFile);
      const lines = content.split('\n');

      // Parse for existing lists
      const existingLanes: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ') && !trimmed.includes('%%')) {
          const laneTitle = trimmed.substring(3).trim();
          if (laneTitle) {
            existingLanes.push(laneTitle);
          }
        }
      }

      console.log('Found existing lanes:', existingLanes);

      const moveLaneCards = async (targetLaneTitle: string | null) => {
        try {
          console.log('moveLaneCards called with targetLaneTitle:', targetLaneTitle);

          // Re-read the file to get fresh content
          const freshContent = await app.vault.read(targetFile);
          const freshLines = freshContent.split('\n');

          let hasFrontmatter = false;
          let frontmatterEnd = -1;

          if (freshLines[0] === '---') {
            for (let i = 1; i < freshLines.length; i++) {
              if (freshLines[i] === '---') {
                frontmatterEnd = i;
                for (let j = 1; j < i; j++) {
                  if (freshLines[j].includes('kanban-plugin:')) {
                    hasFrontmatter = true;
                    break;
                  }
                }
                break;
              }
            }
          }

          let newContent: string;
          if (!hasFrontmatter) {
            if (frontmatterEnd >= 0) {
              freshLines.splice(frontmatterEnd, 0, 'kanban-plugin: basic');
              newContent = freshLines.join('\n');
            } else {
              newContent = `---\nkanban-plugin: basic\n---\n\n${freshContent}`;
            }
          } else {
            newContent = freshContent;
          }

          if (targetLaneTitle) {
            console.log('Merging into existing lane:', targetLaneTitle);
            // Merge cards into existing list
            const targetLines = newContent.split('\n');
            let insertIndex = -1;

            for (let i = 0; i < targetLines.length; i++) {
              const trimmed = targetLines[i].trim();
              if (trimmed === `## ${targetLaneTitle}`) {
                console.log('Found target lane at line:', i);
                // Find the end of this list (next ## or end of file)
                insertIndex = i + 1;
                for (let j = i + 1; j < targetLines.length; j++) {
                  if (targetLines[j].trim().startsWith('## ')) {
                    insertIndex = j;
                    break;
                  }
                  insertIndex = j + 1;
                }
                console.log('Insert index:', insertIndex);
                break;
              }
            }

            if (insertIndex !== -1) {
              const cardsMarkdown = lane.children.map((item) => {
                const checkbox = item.data.metadata.checked ? 'x' : ' ';
                return `- [${checkbox}] ${item.data.title}`;
              });

              console.log('Inserting', cardsMarkdown.length, 'cards at index', insertIndex);
              targetLines.splice(insertIndex, 0, ...cardsMarkdown);
              newContent = targetLines.join('\n');
            } else {
              console.error('Could not find insertion point for lane:', targetLaneTitle);
            }
          } else {
            console.log('Adding as new lane');
            // Add as new list
            let laneMarkdown = `\n\n## ${lane.data.title}\n\n`;
            lane.children.forEach((item) => {
              const checkbox = item.data.metadata.checked ? 'x' : ' ';
              laneMarkdown += `- [${checkbox}] ${item.data.title}\n`;
            });
            newContent += laneMarkdown;
          }

          console.log('Writing to target file...');
          await app.vault.modify(targetFile, newContent);
          console.log('File written successfully');

          console.log('Deleting lane from current board...');
          boardModifiers.deleteEntity(path);
          console.log('Lane deleted from board');

        } catch (error) {
          console.error('Error in moveLaneCards:', error);
          throw error;
        }
      };

      if (existingLanes.length > 0) {
        // Show list picker with option to create new list
        const laneSuggest = new LaneSuggestModal(
          app,
          existingLanes,
          async (selectedLane) => {
            try {
              console.log('Lane selected:', selectedLane);
              if (selectedLane === 'KEEP_SEPARATE') {
                await moveLaneCards(null);
              } else {
                await moveLaneCards(selectedLane);
              }
            } catch (error) {
              console.error('Error in lane selection callback:', error);
            }
          },
          false,
          true // allowKeepSeparate
        );
        laneSuggest.open();
      } else {
        // No existing lists, just add it
        console.log('No existing lanes, adding as new');
        await moveLaneCards(null);
      }

    } catch (error) {
      console.error('Error moving lane to file:', error);
    }
  }, false);

  fileSuggest.open();
}

export interface UseSettingsMenuParams {
  setEditState: Dispatch<StateUpdater<EditState>>;
  path: Path;
  lane: Lane;
}

export function useSettingsMenu({ setEditState, path, lane }: UseSettingsMenuParams) {
  const { stateManager, boardModifiers } = useContext(KanbanContext);
  const [confirmAction, setConfirmAction] = useState<LaneAction>(null);

  const settingsMenu = useMemo(() => {
    const metadataSortOptions = new Set<string>();
    let canSortDate = false;
    let canSortTags = false;

    lane.children.forEach((item) => {
      const taskData = item.data.metadata.inlineMetadata;
      if (taskData) {
        taskData.forEach((m) => {
          if (m.key === 'repeat') return;
          if (!metadataSortOptions.has(m.key)) metadataSortOptions.add(m.key);
        });
      }

      if (!canSortDate && item.data.metadata.date) canSortDate = true;
      if (!canSortTags && item.data.metadata.tags?.length) canSortTags = true;
    });

    const menu = new Menu()
      .addItem((item) => {
        item
          .setIcon('lucide-edit-3')
          .setTitle(t('Edit list'))
          .onClick(() => setEditState({ x: 0, y: 0 }));
      })
      .addItem((item) => {
        item
          .setIcon('lucide-archive')
          .setTitle(t('Archive cards'))
          .onClick(() => setConfirmAction('archive-items'));
      })
      .addItem((item) => {
        item
          .setIcon('lucide-folder-output')
          .setTitle(t('Move list to file...'))
          .onClick(async () => {
            await handleMoveLaneToFile(stateManager, boardModifiers, lane, path);
          });
      })
      .addSeparator()
      .addItem((i) => {
        i.setIcon('arrow-left-to-line')
          .setTitle(t('Insert list before'))
          .onClick(() =>
            boardModifiers.insertLane(path, {
              ...LaneTemplate,
              id: generateInstanceId(),
              children: [],
              data: {
                title: '',
                shouldMarkItemsComplete: false,
                forceEditMode: true,
              },
            })
          );
      })
      .addItem((i) => {
        i.setIcon('arrow-right-to-line')
          .setTitle(t('Insert list after'))
          .onClick(() => {
            const newPath = [...path];

            newPath[newPath.length - 1] = newPath[newPath.length - 1] + 1;

            boardModifiers.insertLane(newPath, {
              ...LaneTemplate,
              id: generateInstanceId(),
              children: [],
              data: {
                title: '',
                shouldMarkItemsComplete: false,
                forceEditMode: true,
              },
            });
          });
      })
      .addSeparator()
      .addItem((item) => {
        item
          .setIcon('lucide-archive')
          .setTitle(t('Archive list'))
          .onClick(() => setConfirmAction('archive'));
      })
      .addItem((item) => {
        item
          .setIcon('lucide-trash-2')
          .setTitle(t('Delete list'))
          .onClick(() => setConfirmAction('delete'));
      })
      .addSeparator();

    const addSortOptions = (menu: Menu) => {
      menu.addItem((item) => {
        item
          .setIcon('arrow-down-up')
          .setTitle(t('Sort by card text'))
          .onClick(() => {
            const children = lane.children.slice();
            const isAsc = lane.data.sorted === LaneSort.TitleAsc;

            children.sort((a, b) => {
              if (isAsc) {
                return b.data.title.localeCompare(a.data.title);
              }

              return a.data.title.localeCompare(b.data.title);
            });

            boardModifiers.updateLane(
              path,
              update(lane, {
                children: {
                  $set: children,
                },
                data: {
                  sorted: {
                    $set:
                      lane.data.sorted === LaneSort.TitleAsc
                        ? LaneSort.TitleDsc
                        : LaneSort.TitleAsc,
                  },
                },
              })
            );
          });
      });

      if (canSortDate) {
        menu.addItem((item) => {
          item
            .setIcon('arrow-down-up')
            .setTitle(t('Sort by date'))
            .onClick(() => {
              const children = lane.children.slice();
              const mod = lane.data.sorted === LaneSort.DateAsc ? -1 : 1;

              children.sort((a, b) => {
                const aDate: moment.Moment | undefined =
                  a.data.metadata.time || a.data.metadata.date;
                const bDate: moment.Moment | undefined =
                  b.data.metadata.time || b.data.metadata.date;

                if (aDate && !bDate) return -1 * mod;
                if (bDate && !aDate) return 1 * mod;
                if (!aDate && !bDate) return 0;

                return (aDate.isBefore(bDate) ? -1 : 1) * mod;
              });

              boardModifiers.updateLane(
                path,
                update(lane, {
                  children: {
                    $set: children,
                  },
                  data: {
                    sorted: {
                      $set:
                        lane.data.sorted === LaneSort.DateAsc ? LaneSort.DateDsc : LaneSort.DateAsc,
                    },
                  },
                })
              );
            });
        });
      }

      if (canSortTags) {
        menu.addItem((item) => {
          item
            .setIcon('arrow-down-up')
            .setTitle(t('Sort by tags'))
            .onClick(() => {
              const tagSortOrder = stateManager.getSetting('tag-sort');
              const children = lane.children.slice();
              const desc = lane.data.sorted === LaneSort.TagsAsc ? true : false;

              children.sort((a, b) => {
                const tagsA = a.data.metadata.tags;
                const tagsB = b.data.metadata.tags;

                if (!tagsA?.length && !tagsB?.length) return 0;
                if (!tagsA?.length) return 1;
                if (!tagsB?.length) return -1;

                const aSortOrder =
                  tagSortOrder?.findIndex((sort) => tagsA.includes(sort.tag)) ?? -1;
                const bSortOrder =
                  tagSortOrder?.findIndex((sort) => tagsB.includes(sort.tag)) ?? -1;

                if (aSortOrder > -1 && bSortOrder < 0) return desc ? 1 : -1;
                if (bSortOrder > -1 && aSortOrder < 0) return desc ? -1 : 1;
                if (aSortOrder > -1 && bSortOrder > -1) {
                  return desc ? bSortOrder - aSortOrder : aSortOrder - bSortOrder;
                }

                if (desc) return defaultSort(tagsB.join(''), tagsA.join(''));
                return defaultSort(tagsA.join(''), tagsB.join(''));
              });

              boardModifiers.updateLane(
                path,
                update(lane, {
                  children: {
                    $set: children,
                  },
                  data: {
                    sorted: {
                      $set:
                        lane.data.sorted === LaneSort.TagsAsc ? LaneSort.TagsDsc : LaneSort.TagsAsc,
                    },
                  },
                })
              );
            });
        });
      }

      if (metadataSortOptions.size) {
        metadataSortOptions.forEach((k) => {
          menu.addItem((i) => {
            i.setIcon('arrow-down-up')
              .setTitle(t('Sort by') + ' ' + lableToName(k).toLocaleLowerCase())
              .onClick(() => {
                const children = lane.children.slice();
                const desc = lane.data.sorted === k + '-asc' ? true : false;

                children.sort((a, b) => {
                  const valA = a.data.metadata.inlineMetadata?.find((m) => m.key === k);
                  const valB = b.data.metadata.inlineMetadata?.find((m) => m.key === k);

                  if (valA === undefined && valB === undefined) return 0;
                  if (valA === undefined) return 1;
                  if (valB === undefined) return -1;

                  if (desc) {
                    return defaultSort(
                      anyToString(valB.value, stateManager),
                      anyToString(valA.value, stateManager)
                    );
                  }
                  return defaultSort(
                    anyToString(valA.value, stateManager),
                    anyToString(valB.value, stateManager)
                  );
                });

                boardModifiers.updateLane(
                  path,
                  update(lane, {
                    children: {
                      $set: children,
                    },
                    data: {
                      sorted: {
                        $set: lane.data.sorted === k + '-asc' ? k + '-desc' : k + '-asc',
                      },
                    },
                  })
                );
              });
          });
        });
      }
    };

    if (Platform.isMobile) {
      addSortOptions(menu);
    } else {
      menu.addItem((item) => {
        const submenu = (item as any).setTitle(t('Sort by')).setIcon('arrow-down-up').setSubmenu();

        addSortOptions(submenu);
      });
    }

    return menu;
  }, [stateManager, setConfirmAction, path, lane]);

  return {
    settingsMenu,
    confirmAction,
    setConfirmAction,
  };
}
