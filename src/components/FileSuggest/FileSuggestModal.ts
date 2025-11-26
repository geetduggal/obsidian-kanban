import { App, FuzzySuggestModal, TFile } from 'obsidian';

export interface FileSelection {
  file: TFile;
  lane?: string;
  createInbox?: boolean;
}

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
  private onChooseCallback: (file: TFile) => void;
  private allowNonMarkdown: boolean;

  constructor(
    app: App,
    onChoose: (file: TFile) => void,
    allowNonMarkdown = false
  ) {
    super(app);
    this.onChooseCallback = onChoose;
    this.allowNonMarkdown = allowNonMarkdown;
    this.setPlaceholder('Type file name to move item to...');
  }

  getItems(): TFile[] {
    const files: TFile[] = [];
    const allFiles = this.app.vault.getMarkdownFiles();

    allFiles.forEach((file) => {
      if (this.allowNonMarkdown || file.extension === 'md') {
        files.push(file);
      }
    });

    return files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChooseCallback(file);
  }
}

export class LaneSuggestModal extends FuzzySuggestModal<string> {
  private lanes: string[];
  private onChooseCallback: (lane: string | 'CREATE_INBOX' | 'KEEP_SEPARATE') => void;
  private allowCreateInbox: boolean;
  private allowKeepSeparate: boolean;

  constructor(
    app: App,
    lanes: string[],
    onChoose: (lane: string | 'CREATE_INBOX' | 'KEEP_SEPARATE') => void,
    allowCreateInbox = false,
    allowKeepSeparate = false
  ) {
    super(app);
    this.lanes = lanes;
    this.onChooseCallback = onChoose;
    this.allowCreateInbox = allowCreateInbox;
    this.allowKeepSeparate = allowKeepSeparate;
    this.setPlaceholder('Select a list to move to...');
  }

  getItems(): string[] {
    const items = [...this.lanes];
    if (this.allowCreateInbox && this.lanes.length === 0) {
      items.push('CREATE_INBOX');
    }
    if (this.allowKeepSeparate && this.lanes.length > 0) {
      items.push('KEEP_SEPARATE');
    }
    return items;
  }

  getItemText(lane: string): string {
    if (lane === 'CREATE_INBOX') {
      return '➕ Create new "Inbox" list';
    }
    if (lane === 'KEEP_SEPARATE') {
      return '➕ Keep as separate list';
    }
    return lane;
  }

  onChooseItem(lane: string): void {
    this.onChooseCallback(lane);
  }
}
