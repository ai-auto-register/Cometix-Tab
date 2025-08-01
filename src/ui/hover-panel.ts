import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

export class HoverPanel {
  private static currentPanel: HoverPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.update();
    
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );
  }

  public static show(context: vscode.ExtensionContext) {
    if (HoverPanel.currentPanel) {
      HoverPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // 创建一个小的webview面板，模拟悬浮效果
    const panel = vscode.window.createWebviewPanel(
      'cometixTabHover',
      '代码完成',
      {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false
      },
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: []
      }
    );

    HoverPanel.currentPanel = new HoverPanel(panel, context.extensionUri);
  }

  private static async handleAction(action: string, config: any, isSnoozing: boolean) {
    const logger = Logger.getInstance();
    
    switch (action) {
      case 'toggle':
        await ConfigManager.updateConfig('enabled', !config.enabled);
        vscode.window.showInformationMessage(
          config.enabled ? 'AI补全已禁用' : 'AI补全已启用'
        );
        break;

      case 'model':
        await HoverPanel.showModelSelector();
        break;

      case 'snooze':
        if (isSnoozing) {
          await ConfigManager.updateConfig('snoozeUntil', 0);
          vscode.window.showInformationMessage('已取消Snooze');
        } else {
          await HoverPanel.showSnoozeSelector();
        }
        break;
    }
  }

  private static async showModelSelector() {
    const config = ConfigManager.getConfig();
    const models = [
      {
        label: '$(auto-fix) auto (默认)',
        detail: '自动选择最适合的模型',
        picked: config.model === 'auto',
        value: 'auto'
      },
      {
        label: '$(zap) fast',
        detail: '快速响应，适合简单补全',
        picked: config.model === 'fast',
        value: 'fast'
      },
      {
        label: '$(rocket) advanced',
        detail: '高级模型，适合复杂代码生成',
        picked: config.model === 'advanced',
        value: 'advanced'
      }
    ];

    const selected = await vscode.window.showQuickPick(models, {
      title: '选择AI补全模型',
      placeHolder: '选择模型类型'
    });

    if (selected) {
      await ConfigManager.updateConfig('model', selected.value);
      vscode.window.showInformationMessage(`已切换到 ${selected.value} 模型`);
    }
  }

  private static async showSnoozeSelector() {
    const options = [
      { label: '$(clock) 5分钟', minutes: 5 },
      { label: '$(clock) 15分钟', minutes: 15 },
      { label: '$(clock) 30分钟', minutes: 30 },
      { label: '$(clock) 1小时', minutes: 60 },
      { label: '$(clock) 2小时', minutes: 120 }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      title: 'Snooze AI补全',
      placeHolder: '选择暂停时长'
    });

    if (selected) {
      const snoozeUntil = Date.now() + (selected.minutes * 60 * 1000);
      await ConfigManager.updateConfig('snoozeUntil', snoozeUntil);
      vscode.window.showInformationMessage(`AI补全已暂停 ${selected.minutes}分钟`);
    }
  }

  private update() {
    const config = ConfigManager.getConfig();
    const isSnoozing = config.snoozeUntil > Date.now();
    
    this.panel.webview.html = this.getWebviewContent(config, isSnoozing);
  }

  private async handleMessage(message: any) {
    const config = ConfigManager.getConfig();
    const isSnoozing = config.snoozeUntil > Date.now();
    
    if (message.command) {
      await HoverPanel.handleAction(message.command, config, isSnoozing);
      this.update();
    }
  }

  private dispose() {
    if (HoverPanel.currentPanel === this) {
      HoverPanel.currentPanel = undefined;
    }

    this.panel.dispose();

    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getWebviewContent(config: any, isSnoozing: boolean): string {
    const statusColor = config.enabled && !isSnoozing ? '#28a745' : '#dc3545';
    const statusText = isSnoozing ? 'Snoozing' : (config.enabled ? '已启用' : '已禁用');
    const toggleText = config.enabled ? '禁用' : '启用';
    const snoozeText = isSnoozing ? '取消Snooze' : 'Snooze';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 16px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          .status {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
          }
          .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${statusColor};
          }
          .buttons {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .button {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          }
          .button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .info {
            margin-top: 12px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
          }
        </style>
      </head>
      <body>
        <div class="status">
          <div class="status-dot"></div>
          <span>Cometix Tab - ${statusText}</span>
        </div>
        
        <div class="buttons">
          <button class="button" onclick="sendMessage('toggle')">${toggleText}</button>
          <button class="button" onclick="sendMessage('model')">模型: ${config.model}</button>
          <button class="button" onclick="sendMessage('snooze')">${snoozeText}</button>
        </div>
        
        <div class="info">
          当前模型: ${config.model}<br>
          ${isSnoozing ? `Snooze至: ${new Date(config.snoozeUntil).toLocaleTimeString()}` : ''}
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          function sendMessage(command) {
            vscode.postMessage({ command });
          }
        </script>
      </body>
      </html>
    `;
  }
}