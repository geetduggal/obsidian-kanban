import Preact from 'preact/compat';
import { Dispatch, StateUpdater } from 'preact/hooks';
import { StateManager } from 'src/StateManager';
import { Item } from 'src/components/types';
import { displayCardId } from 'src/helpers/cardId';
import { t } from 'src/lang/helpers';

import { Icon } from '../Icon/Icon';
import { c } from '../helpers';
import { EditState, EditingState, isEditing } from '../types';

interface ItemMenuButtonProps {
  editState: EditState;
  setEditState: Dispatch<StateUpdater<EditState>>;
  showMenu: (e: MouseEvent, internalLinkPath?: string) => void;
  item: Item;
  stateManager: StateManager;
}

export const ItemMenuButton = Preact.memo(function ItemMenuButton({
  editState,
  setEditState,
  showMenu,
  item,
  stateManager,
}: ItemMenuButtonProps) {
  const showCardId = stateManager.useSetting('show-card-id');
  const size = stateManager.useSetting('card-id-size') || 'large';
  const cardId = displayCardId(item.data.blockId);
  const hasCardId = !!(showCardId && cardId && !isEditing(editState));

  const ignoreAttr = Preact.useMemo(() => {
    if (editState) {
      return {
        'data-ignore-drag': true,
      };
    }

    return {};
  }, [editState]);

  return (
    <div {...ignoreAttr} className={c('item-postfix-button-wrapper')}>
      {isEditing(editState) ? (
        <button
          type="button"
          data-ignore-drag={true}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setEditState(EditingState.cancel)}
          className={`${c('item-postfix-button')} is-enabled clickable-icon`}
          aria-label={t('Cancel')}
        >
          <Icon name="lucide-x" />
        </button>
      ) : (
        <button
          type="button"
          data-ignore-drag={true}
          onPointerDown={(e) => e.preventDefault()}
          onClick={showMenu as any}
          className={`${c('item-postfix-button')} clickable-icon ${
            hasCardId ? `has-card-id ${size === 'large' ? 'is-large' : ''}` : ''
          }`}
          aria-label={t('More options')}
        >
          {hasCardId && (
            <span className={c('item-postfix-id-text')}>
              <span className={c('item-postfix-id-value')}>{cardId}</span>
            </span>
          )}
          <Icon name="lucide-more-vertical" />
        </button>
      )}
    </div>
  );
});
